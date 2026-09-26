"""Mechanics markers: where a receipt happened (contract §16.6).

§16.3 took the numbers out of the narration and left the mechanic homeless: the prose carries the
consequence of a check and nothing says which sentence produced it. These pin the other half --
the Keeper may place a token the kernel handed it, omitted tokens receive deterministic fallback
positions, and the delivery a text consumer reads is still the prose with nothing rendered into it by code.
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
    assert result["rendered_text"] == text.replace("{{check:spot-hidden}}", "").replace("{{clue:knott-commission}}", "")
    assert result["rendered_text"].startswith("你翻过桌上的纸，条款写得清楚。")
    assert "{{" not in result["rendered_text"]
    # What a frontend that can mount a component reads.
    assert result["marked_text"] == text

    rows = {row["kind"]: row for row in result["mechanics"]}
    assert rows["roll"]["marker"] == "check:spot-hidden"
    assert rows["clue"]["marker"] == "clue:knott-commission"


def test_a_receipt_nobody_placed_gets_a_fallback_marker_after_the_delivery(kernel):
    """An omitted position is not an omitted mechanic: explicit markers stay where the Keeper put
    them and every remaining row is appended in receipt order."""
    open_turn(kernel)
    resolve_search(kernel)
    kernel.table("apply", call_id="t1-c2", effects=[{"kind": "time", "minutes": 10}])
    result = kernel.table("narrate", call_id="t1-c3",
                          text="你翻过桌上的纸{{check:spot-hidden}}。")

    assert result["marked_text"] == "你翻过桌上的纸{{check:spot-hidden}}。\n\n{{time}}"
    rows = {row["kind"]: row for row in result["mechanics"]}
    assert rows["roll"]["marker"] == "check:spot-hidden"
    assert rows["time"]["marker"] == "time"


def test_a_delivery_with_no_explicit_marker_appends_every_mechanic_without_changing_prose(kernel):
    open_turn(kernel)
    resolve_search(kernel)
    text = "你翻过桌上的纸，什么也没找到。"
    result = kernel.table("narrate", call_id="t1-c3", text=text)
    assert result["rendered_text"] == text
    assert result["marked_text"] == f"{text}\n\n{{{{check:spot-hidden}}}}"
    assert [row["marker"] for row in result["mechanics"]] == ["check:spot-hidden"]


def test_a_marker_naming_no_receipt_is_dropped_not_refused(kernel):
    """A marker is a rendering hint (§34.14): one that names no receipt of this turn leaves the text,
    the prose is delivered without it, and the Keeper is told what was dropped. Refusing used to leave
    the raw draft — braces and all — in front of the player."""
    open_turn(kernel)
    resolve_search(kernel)
    result = kernel.table("narrate", call_id="t1-c3", text="你翻过桌上的纸{{check:library-use}}，指尖沾了灰{{check:spot-hidden}}。")
    assert result["rendered_text"] == "你翻过桌上的纸，指尖沾了灰。"
    assert "{{" not in result["rendered_text"]
    assert result["marked_text"] == "你翻过桌上的纸，指尖沾了灰{{check:spot-hidden}}。"
    dropped = result["dropped_markers"]
    assert dropped["unknown"] == ["check:library-use"] and "duplicate" not in dropped
    assert "check:spot-hidden" in dropped["markers"]
    assert [row.get("marker") for row in result["mechanics"] if row["kind"] == "roll"] == ["check:spot-hidden"]


def test_only_the_first_placement_of_a_marker_stands(kernel):
    open_turn(kernel)
    resolve_search(kernel)
    result = kernel.table("narrate", call_id="t1-c3",
                          text="你翻过桌上的纸{{check:spot-hidden}}，又翻了一遍{{check:spot-hidden}}。")
    assert result["rendered_text"] == "你翻过桌上的纸，又翻了一遍。"
    assert result["marked_text"] == "你翻过桌上的纸{{check:spot-hidden}}，又翻了一遍。"
    assert result["dropped_markers"]["duplicate"] == ["check:spot-hidden"]


def test_a_delivery_whose_markers_all_miss_still_reaches_the_player(kernel):
    """The 2026-09-12 leak: every marker named a receipt that never landed, the kernel refused, and the
    host left the draft on screen. Now the prose goes out clean and the turn closes."""
    open_turn(kernel)
    result = kernel.table("narrate", call_id="t1-c1", text="{{scene:corbitt-house-ground}}你站在人行道上{{item}}。")
    assert result["rendered_text"] == "你站在人行道上。"
    assert "marked_text" not in result
    assert sorted(result["dropped_markers"]["unknown"]) == ["item", "scene:corbitt-house-ground"]


def test_a_delivery_of_a_marker_and_latin_prose_is_delivered_on_a_zh_hans_table(kernel):
    """The kernel checks no script (contract section 23): a zh-Hans delivery made of a marker and
    English prose is delivered with the marker stripped, never refused as play_language_mismatch."""
    open_turn(kernel)
    resolve_search(kernel)
    done = kernel.table("narrate", call_id="t1-c3", text="{{check:spot-hidden}} nothing but english")
    assert done["rendered_text"] == "nothing but english"
    assert done["marked_text"] == "{{check:spot-hidden}} nothing but english"


def test_ask_places_markers_the_same_way(kernel):
    open_turn(kernel)
    resolve_search(kernel)
    result = kernel.table("ask", call_id="t1-c3", prompt="你接下来做什么？",
                          options=["再翻一遍", "去问诺特"],
                          text="你翻过桌上的纸{{check:spot-hidden}}。")
    assert result["rendered_text"].startswith("你翻过桌上的纸。")
    assert result["marked_text"] == "你翻过桌上的纸{{check:spot-hidden}}。"
    assert result["mechanics"][0]["marker"] == "check:spot-hidden"


def test_a_mechanics_ask_without_story_text_still_places_every_row(kernel):
    open_turn(kernel)
    resolve_search(kernel)
    result = kernel.table("ask", call_id="t1-c3", kind="mechanics", binds="check:spot-hidden",
                          options=["accept"])
    assert result["rendered_text"] == ""
    assert result["marked_text"] == "{{check:spot-hidden}}"
    assert result["mechanics"][0]["marker"] == "check:spot-hidden"


def test_the_turn_record_keeps_both_readings(kernel):
    import json
    from conftest import campaign_dir
    open_turn(kernel)
    resolve_search(kernel)
    text = "你翻过桌上的纸{{check:spot-hidden}}。"
    kernel.table("narrate", call_id="t1-c3", text=text)
    record = json.loads((campaign_dir(kernel.workspace) / "turns" / "0001.json").read_text(encoding="utf-8"))
    assert record["rendered_text"] == text.replace("{{check:spot-hidden}}", "")
    assert record["rendered_text"].startswith("你翻过桌上的纸。")
    assert record["marked_text"] == text


def test_the_commit_subject_is_minted_from_the_rendered_text(kernel):
    """The subject is chrome a player reads in the timeline; a marker in it renders raw."""
    from conftest import git_log
    open_turn(kernel)
    resolve_search(kernel)
    kernel.table("apply", call_id="t1-c2", effects=[{"kind": "time", "minutes": 10}])
    kernel.table("narrate", call_id="t1-c3", text="你翻过桌上的纸{{check:spot-hidden}}，十分钟很快耗尽。{{time}}")
    subjects = git_log(kernel.workspace)
    assert subjects[0].startswith("turn 1: 你翻过桌上的纸，十分钟很快耗尽。")
    assert "{{" not in subjects[0]


def test_a_marker_alone_on_its_line_leaves_no_blank_paragraph(kernel):
    """A model that sets {{time}} on a line of its own must not hand the reader an empty paragraph: the record's
    rendered_text (what the driver and the history card show) closes the gap the marker left."""
    open_turn(kernel)
    kernel.table("apply", call_id="t1-c1", effects=[{"kind": "time", "minutes": 10}])
    text = "你翻过桌上的纸。\n\n{{time}}\n\n窗外的光挪到了另一面墙上。"
    result = kernel.table("narrate", call_id="t1-c2", text=text)
    assert result["rendered_text"] == "你翻过桌上的纸。\n\n窗外的光挪到了另一面墙上。"
    assert "\n\n\n" not in result["rendered_text"]


def test_a_translated_marker_never_reaches_the_rendered_text(kernel):
    """2026-09-26, table prose-mod-c t5: the Keeper wrote {{时间}} for {{time}}. The frontend strips any braces
    (§40.4); the kernel's rendered_text, which the history card, memory and remote web read, must agree."""
    open_turn(kernel)
    kernel.table("apply", call_id="t1-c1", effects=[{"kind": "time", "minutes": 10}])
    result = kernel.table("narrate", call_id="t1-c2", text="她朝上应了一声。{{时间}}脚步一阶一阶响上去。")
    assert "{{" not in result["rendered_text"] and "}}" not in result["rendered_text"]
    assert result["rendered_text"] == "她朝上应了一声。脚步一阶一阶响上去。"

