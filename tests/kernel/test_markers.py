"""Mechanics markers: where a receipt happened (contract §16.6).

§16.3 took the numbers out of the narration and left the mechanic homeless: the prose carries the
consequence of a check and nothing says which sentence produced it. These pin the other half --
the Keeper places a token the kernel handed it, and the delivery a text consumer reads is still
the prose, with nothing rendered into it by code.
"""
from conftest import CAMPAIGN, PREGEN, open_turn

SEARCH = {"intent": "investigate", "goal": "找线索", "method": "翻找", "skill": "Spot Hidden"}


def resolve_search(kernel, call_id="t1-c1", **overrides):
    return kernel.table("resolve", call_id=call_id, action={**SEARCH, **overrides})


def test_the_kernel_hands_the_keeper_its_markers_and_they_are_names_not_receipt_ids(kernel):
    open_turn(kernel)
    rolled = resolve_search(kernel)
    assert rolled["markers"] == ["check:spot-hidden"]
    # A receipt id carries the turn and the ordinal; a marker carries neither, which is the point:
    # nothing here is for the model to copy.
    assert rolled["receipts"] == ["roll:spot-hidden-t1-c1"]

    applied = kernel.table("apply", call_id="t1-c2", effects=[
        {"kind": "clue", "clue": "knott-commission", "label": "委托条件"},
        {"kind": "time", "minutes": 10},
    ])
    assert applied["markers"] == ["clue:knott-commission", "time"]


def test_a_second_roll_of_the_same_skill_is_numbered_across_calls(kernel):
    """A marker is unique within the turn, not within the call that minted it."""
    open_turn(kernel)
    assert resolve_search(kernel, "t1-c1")["markers"] == ["check:spot-hidden"]
    assert resolve_search(kernel, "t1-c2")["markers"] == ["check:spot-hidden-2"]


def test_a_placed_marker_leaves_the_prose_and_lands_on_its_row(kernel):
    open_turn(kernel)
    resolve_search(kernel)
    kernel.table("apply", call_id="t1-c2", effects=[{"kind": "clue", "clue": "knott-commission", "label": "委托条件"}])
    text = "你翻过桌上的纸{{check:spot-hidden}}，条款写得清楚{{clue:knott-commission}}。"
    result = kernel.table("narrate", call_id="t1-c3", text=text)

    # What a text consumer reads: the prose, with nothing put in the markers' place.
    assert result["rendered_text"] == "你翻过桌上的纸，条款写得清楚。"
    assert "{{" not in result["rendered_text"]
    # What a frontend that can mount a component reads.
    assert result["marked_text"] == text

    rows = {row["kind"]: row for row in result["mechanics"]}
    assert rows["roll"]["marker"] == "check:spot-hidden"
    assert rows["clue"]["marker"] == "clue:knott-commission"


def test_a_receipt_nobody_placed_is_projected_without_a_marker(kernel):
    """Not an error: requiring a marker per receipt would make every turn brittle, and a receipt
    is never lost because its position was."""
    open_turn(kernel)
    resolve_search(kernel)
    kernel.table("apply", call_id="t1-c2", effects=[{"kind": "time", "minutes": 10}])
    result = kernel.table("narrate", call_id="t1-c3", text="你翻过桌上的纸{{check:spot-hidden}}。")

    rows = {row["kind"]: row for row in result["mechanics"]}
    assert rows["roll"]["marker"] == "check:spot-hidden"
    assert "marker" not in rows["time"]


def test_a_delivery_with_no_marker_is_exactly_what_it_was(kernel):
    open_turn(kernel)
    resolve_search(kernel)
    text = "你翻过桌上的纸，什么也没找到。"
    result = kernel.table("narrate", call_id="t1-c3", text=text)
    assert result["rendered_text"] == text
    assert "marked_text" not in result
    assert all("marker" not in row for row in result["mechanics"])


def test_a_marker_naming_no_receipt_is_refused(kernel):
    """Prose asserting a mechanic with no receipt is the §16.3 family of error, not a typo to ignore."""
    open_turn(kernel)
    resolve_search(kernel)
    error = kernel.table_err("narrate", call_id="t1-c3", text="你翻过桌上的纸{{check:library-use}}。")
    assert error["code_detail"] == "unknown_marker"
    assert error["details"]["unknown"] == ["check:library-use"]
    assert "check:spot-hidden" in error["details"]["markers"]


def test_the_same_marker_twice_is_refused(kernel):
    open_turn(kernel)
    resolve_search(kernel)
    error = kernel.table_err("narrate", call_id="t1-c3",
                             text="你翻过桌上的纸{{check:spot-hidden}}，又翻了一遍{{check:spot-hidden}}。")
    assert error["code_detail"] == "duplicate_marker"
    assert error["details"]["duplicate"] == ["check:spot-hidden"]


def test_the_play_language_check_reads_the_prose_and_not_the_tokens(kernel):
    """A marker is ASCII and is not player-facing text: a zh-Hans delivery made only of markers is
    a delivery with no Chinese in it, and must be refused as one."""
    open_turn(kernel)
    resolve_search(kernel)
    error = kernel.table_err("narrate", call_id="t1-c3", text="{{check:spot-hidden}} nothing but english")
    assert error["code_detail"] == "play_language_mismatch"


def test_ask_places_markers_the_same_way(kernel):
    open_turn(kernel)
    resolve_search(kernel)
    result = kernel.table("ask", call_id="t1-c3", prompt="你接下来做什么？",
                          options=["再翻一遍", "去问诺特"],
                          text="你翻过桌上的纸{{check:spot-hidden}}。")
    assert result["rendered_text"].startswith("你翻过桌上的纸。")
    assert result["marked_text"] == "你翻过桌上的纸{{check:spot-hidden}}。"
    assert result["mechanics"][0]["marker"] == "check:spot-hidden"


def test_the_turn_record_keeps_both_readings(kernel):
    import json
    from conftest import campaign_dir
    open_turn(kernel)
    resolve_search(kernel)
    text = "你翻过桌上的纸{{check:spot-hidden}}。"
    kernel.table("narrate", call_id="t1-c3", text=text)
    record = json.loads((campaign_dir(kernel.workspace) / "turns" / "0001.json").read_text(encoding="utf-8"))
    assert record["rendered_text"] == "你翻过桌上的纸。"
    assert record["marked_text"] == text
