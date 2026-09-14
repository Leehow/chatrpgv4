"""§14.8 `apply {kind: handout}`: visibility, receipt, the handout projection, the event and the
attachment — which is never invented when the module only knows a reference."""

from __future__ import annotations

from pathlib import Path

from conftest import CAMPAIGN, campaign_dir, open_turn, read_json, read_jsonl

TEXT_HANDOUT = "globe-unpublished-1918"          # handouts.json record with authored_text
REFERENCE_ONLY = "the-haunting-handout-1-knott-commission"  # rulebook card: title only, no bytes shipped
KEEPER_ONLY_ASSET = "haunting-title-skull"


def world(kernel):
    return read_json(campaign_dir(kernel.workspace) / "world.json")


def test_handout_with_authored_text_is_materialized_and_rendered(kernel):
    open_turn(kernel)
    result = kernel.table("apply", call_id="t1-c1",
                          effects=[{"kind": "handout", "name": TEXT_HANDOUT, "label": "1918 年环球报未刊稿"}])
    assert result["receipts"] == [f"handout:{TEXT_HANDOUT}-t1"]
    attachment = result["attachment"]
    assert attachment["available"] is True and attachment["media_type"] == "text/markdown"
    path = Path(attachment["path"])
    assert path.is_file() and path.parent == campaign_dir(kernel.workspace) / "handouts"
    assert path.read_text(encoding="utf-8").startswith("# ")
    assert result["attachments"] == [attachment]
    assert world(kernel)["handouts_shown"] == [TEXT_HANDOUT]

    status = kernel.table("status")
    receipt = status["receipts"][0]
    assert receipt["kind"] == "handout" and receipt["label"] == "1918 年环球报未刊稿" and receipt["visibility"] == "player-safe"

    events = [e for e in read_jsonl(campaign_dir(kernel.workspace) / "events.jsonl") if e["type"] == "handout-shown"]
    assert len(events) == 1
    assert events[0]["receipt"] == f"handout:{TEXT_HANDOUT}-t1"
    assert events[0]["data"]["handout"] == TEXT_HANDOUT and events[0]["data"]["attachment_available"] is True

    narrated = kernel.table("narrate", call_id="t1-c2", text="他把一张剪报推过来。\n\n你读了起来。")
    assert narrated["rendered_text"] == "他把一张剪报推过来。\n\n你读了起来。"
    # §16.2: a text handout's row carries its body so the frontend can unfold it into a readable
    # card -- the materialized file's H1 is the row's own name, so the body drops it.
    row = {"kind": "handout", "marker": f"handout:{TEXT_HANDOUT}", "receipt": f"handout:{TEXT_HANDOUT}-t1", "name": receipt["name"],
           "available": True, "label": "1918 年环球报未刊稿", "path": attachment["path"],
           "media_type": "text/markdown", "call": "t1-c1"}
    assert narrated["mechanics"] == [{**row, "text": narrated["mechanics"][0]["text"]}]
    projected = narrated["mechanics"][0]["text"]
    assert projected == path.read_text(encoding="utf-8").split("\n", 1)[1].strip()
    assert not projected.startswith("#")


def test_handout_without_shipped_bytes_is_declared_unavailable_not_invented(kernel):
    open_turn(kernel)
    result = kernel.table("apply", call_id="t1-c1", effects=[{"kind": "handout", "name": "Handout 1: Mr. Knott's Commission"}])
    assert result["receipts"] == [f"handout:{REFERENCE_ONLY}-t1"]
    attachment = result["attachment"]
    assert attachment["available"] is False and attachment["path"] is None
    assert not (campaign_dir(kernel.workspace) / "handouts").exists()
    # Contract §32.9: `available: false` sat in the JSON and the Keeper handed the card over in the
    # prose anyway -- three of the four handouts across three real tables. The result says it in words.
    assert REFERENCE_ONLY in result["note"] and "nothing to look at" in result["note"]
    narrated = kernel.table("narrate", call_id="t1-c2", text="诺特把委托书递过来。")
    assert narrated["mechanics"] == [{"kind": "handout", "marker": f"handout:{REFERENCE_ONLY}", "receipt": f"handout:{REFERENCE_ONLY}-t1",
                                      "name": "Handout 1: Mr. Knott's Commission", "available": False,
                                      "label": "Handout 1: Mr. Knott's Commission", "call": "t1-c1"}]


def test_a_delivered_handout_says_nothing_about_a_missing_one(kernel):
    """The note is about what could not be delivered, so a handout that carries its own text is silent."""
    open_turn(kernel)
    result = kernel.table("apply", call_id="t1-c1", effects=[{"kind": "handout", "name": TEXT_HANDOUT}])
    assert result["attachment"]["available"] is True and "note" not in result


def test_keeper_only_assets_and_unknown_names_do_not_write(kernel):
    open_turn(kernel)
    error = kernel.table_err("apply", call_id="t1-c1", effects=[{"kind": "time", "minutes": 5},
                                                                 {"kind": "handout", "name": KEEPER_ONLY_ASSET}])
    assert error["code"] == "invalid_params" and error["details"]["index"] == 1
    assert error["details"]["visibility"] == "keeper-only"
    assert world(kernel)["clock"] == {"minutes": 0} and "handouts_shown" not in world(kernel)
    unknown = kernel.table_err("apply", call_id="t1-c1", effects=[{"kind": "handout", "name": "the-missing-card"}])
    assert unknown["code"] == "unknown_entity" and "candidates" in unknown["details"]
    assert kernel.table("status")["receipts"] == []


def test_handout_replays_on_the_same_call_id(kernel):
    open_turn(kernel)
    params = {"call_id": "t1-c1", "effects": [{"kind": "handout", "name": TEXT_HANDOUT}]}
    first = kernel.table("apply", **params)
    again = kernel.table("apply", **params)
    assert again["replayed"] is True and again["receipts"] == first["receipts"]
    assert kernel.table_err("apply", call_id="t1-c1", effects=[{"kind": "handout", "name": REFERENCE_ONLY}])["code"] == "idempotency_conflict"
    assert len([e for e in read_jsonl(campaign_dir(kernel.workspace) / "events.jsonl") if e["type"] == "handout-shown"]) == 1


def test_handout_shows_up_in_the_scene_assets_the_capsule_lists(kernel):
    result = open_turn(kernel)
    assets = result["capsule"]["where"]["assets"]
    assert {"name": "Handout 1: Mr. Knott's Commission", "kind": "handout"} in assets
    assert result["capsule"]["where"]["material"] == "ready"
