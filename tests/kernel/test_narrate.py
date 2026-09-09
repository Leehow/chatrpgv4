"""§5 narrate under §16: the text is delivered verbatim, the receipts ride beside it as
the language-neutral `mechanics` projection, and no number is required in story prose.

The figure check went in on 2026-09-06, out on 09-07, back on 09-08 (#84) and out for good
on 09-09 by the user's decision: numbers live on the frontend's cards, the prose is fiction.
`tests/kernel/test_narrate_numbers.py` guards the last word."""

from conftest import campaign_dir, git_log, narrate, open_turn, read_json, read_jsonl


def stage_receipts(client):
    """One roll, one clue, one time, one move, in that order; returns the receipts."""
    client.table("resolve", call_id="t1-c1", action={"intent": "investigate", "goal": "x", "method": "y",
                                                    "skill": "Spot Hidden"})
    client.table("apply", call_id="t1-c2", effects=[
        {"kind": "clue", "clue": "knott-research-leads"},
        {"kind": "time", "minutes": 10},
        {"kind": "move", "to": "hall-of-records", "travel_minutes": 20},
    ])
    return client.table("status")["receipts"]


def test_labels_ride_on_the_projection_and_the_text_is_verbatim(kernel):
    open_turn(kernel)
    kernel.table("apply", call_id="t1-c1", effects=[
        {"kind": "clue", "clue": "knott-research-leads", "label": "诺特给的查证方向"},
        {"kind": "move", "to": "hall-of-records", "label": "市政厅档案室"},
    ])
    result = kernel.table("narrate", call_id="t1-c2", text="你出了门。")
    assert result["rendered_text"] == "你出了门。"
    assert result["mechanics"] == [
        {"kind": "clue", "receipt": "clue:knott-research-leads-t1", "clue": "knott-research-leads", "label": "诺特给的查证方向",
         "summary": "Knott points them toward the Boston Globe, the Central Library / Hall of Records, "
                    "and other paper trails before they rush the house.", "call": "t1-c1"},
        {"kind": "scene", "receipt": "move:hall-of-records-t1-c1", "from": "commission-briefing", "to": "hall-of-records",
         "minutes": 0, "from_label": "Knott's Office", "to_label": "市政厅档案室", "call": "t1-c1"},
    ]


def test_every_receipt_is_projected_and_the_turn_closes(kernel):
    open_turn(kernel)
    roll = stage_receipts(kernel)[0]
    text = f"第一段：你掷出 {roll['roll']}，侦查 {roll['target']}。\n\n第二段：十分钟（10）过去了。\n\n第三段。"
    result = kernel.table("narrate", call_id="t1-c3", text=text)
    assert result["rendered_text"] == text
    assert [m["kind"] for m in result["mechanics"]] == ["roll", "clue", "time", "scene"]
    assert result["mechanics"][0] == {"kind": "roll", "receipt": "roll:spot-hidden-t1-c1", "actor": "thomas-hayes",
                                      "actor_label": "托马斯·海斯", "actor_is_investigator": True,
                                      "skill": "Spot Hidden", "roll": roll["roll"], "target": 55, "threshold": 55,
                                      "difficulty": "regular", "level": roll["level"], "passed": roll["passed"],
                                      "pushed": False, "visibility": "public", "call": "t1-c1", "family": "core-check"}
    assert result["mechanics"][2] == {"kind": "time", "receipt": "time:t1-c2", "minutes": 10, "call": "t1-c2"}
    assert result["mechanics"][3]["minutes"] == 20
    assert result["turn"] == 1 and result["receipt"] == "turn:1" and result["commit"]
    assert git_log(kernel.workspace)[0].startswith("turn 1: 第一段：你掷出")

    status = kernel.table("status")
    assert status == {"turn": 2, "state": "awaiting_player", "receipts": [], "mechanics": [], "pending_choice": None}
    record = read_json(campaign_dir(kernel.workspace) / "turns" / "0001.json")
    assert record["player_text"] == "我仔细观察诺特。"
    assert [r["id"] for r in record["receipts"]] == ["roll:spot-hidden-t1-c1", "clue:knott-research-leads-t1",
                                                    "time:t1-c2", "move:hall-of-records-t1-c2"]
    assert record["rendered_text"] == text and record["mechanics"] == result["mechanics"]
    assert "placement" not in record
    assert record["commit"] == result["commit"]
    transcript = read_jsonl(campaign_dir(kernel.workspace) / "transcript.jsonl")
    assert transcript[-1] == {**transcript[-1], "turn": 1, "role": "keeper", "text": text}
    finalized = [e for e in read_jsonl(campaign_dir(kernel.workspace) / "events.jsonl") if e["type"] == "turn-finalized"]
    assert finalized[-1]["turn"] == 1 and finalized[-1]["receipt"] == "turn:1"
    assert finalized[-1]["data"] == {"receipts": [r["id"] for r in record["receipts"]]}


def test_system_numbers_are_only_required_in_json(kernel):
    """§16: the kernel renders no mechanics line and demands no figure. A delivery that names
    neither the roll nor the target nor the minutes is delivered exactly as written; the
    numbers reach the player as projection rows."""
    open_turn(kernel)
    roll = stage_receipts(kernel)[0]
    prose = "你没有发现其他痕迹，收起了手里的材料。"
    done = kernel.table("narrate", call_id="t1-c3", text=prose)
    assert done["rendered_text"] == prose
    assert "【" not in done["rendered_text"], "no mechanics line was rendered into the prose"
    assert done["mechanics"][0]["roll"] == roll["roll"]
    assert done["mechanics"][0]["target"] == 55
    assert done["commit"] and kernel.table("status")["turn"] == 2


def test_placement_is_ignored_and_the_text_stays_verbatim(kernel):
    open_turn(kernel)
    stage_receipts(kernel)
    result = narrate(kernel, "t1-c3", "第一段。\n\n第二段。", placement="end")
    assert result["rendered_text"].startswith("第一段。\n\n第二段。")
    assert "【" not in result["rendered_text"]
    open_turn_again = kernel.table("player_input", text="继续。")
    assert open_turn_again["turn"] == 2
    kernel.table("apply", call_id="t2-c1", effects=[{"kind": "time", "minutes": 3}])
    assert kernel.table("narrate", call_id="t2-c2", text="3 分钟。", placement="middle")["rendered_text"] == "3 分钟。"


def test_no_receipts_renders_text_verbatim(kernel):
    open_turn(kernel)
    result = kernel.table("narrate", call_id="t1-c1", text="诺特只是看着你。\n\n他没有说话。")
    assert result["rendered_text"] == "诺特只是看着你。\n\n他没有说话。" and result["mechanics"] == []


def test_the_kernel_no_longer_polices_markers_only_numbers(kernel):
    open_turn(kernel)
    # A marker in the keeper's own prose is its business (§16: nothing is inserted, nothing stripped).
    result = kernel.table("narrate", call_id="t1-c1", text="【明骰】这是守秘人自己写的。")
    assert result["rendered_text"] == "【明骰】这是守秘人自己写的。"
    kernel.table("player_input", text="继续。")
    assert kernel.table_err("narrate", call_id="t2-c1", text="   ")["code"] == "invalid_params"


def test_opening_choice_has_ascii_identity_and_player_labels(kernel):
    from conftest import create_campaign
    create_campaign(kernel)
    kernel.table("open")
    choice = kernel.table("ask", call_id="t0-c1", prompt="你从哪里开始？", options=["前门", "后门"])
    assert choice["pending_choice"]["name"] == "ask-story-t0"
    assert choice["labels"]
    assert choice["interaction"]["options"] == ["前门", "后门"]


def test_ending_commits_campaign_status_and_remains_readable(kernel):
    from conftest import campaign_dir, read_json
    open_turn(kernel)
    kernel.table("resolve", call_id="t1-c1", action={"intent": "montage", "goal": "Settle this conclusion.",
                 "method": "", "decision": "development:end-session"})
    kernel.table("apply", call_id="t1-c2", effects=[{"kind": "ending", "scope": "campaign", "summary": "The investigators escaped."}])
    assert read_json(campaign_dir(kernel.workspace) / "campaign.json")["status"] == "active"
    done = kernel.table("narrate", call_id="t1-c3", text="你们离开了这座房子，故事到此结束。")
    assert done["commit"]
    assert read_json(campaign_dir(kernel.workspace) / "campaign.json")["status"] == "completed"
    assert kernel.table("view")["labels"]
    assert kernel.table("open")["campaign"]["status"] == "completed"
    assert kernel.table("narrate", call_id="t1-c3", text="你们离开了这座房子，故事到此结束。")["replayed"]
    accounting = kernel.table("player_input", text="核对结算。")
    assert accounting["state"] == "open" and "remains completed" in accounting["capsule"]["head"]
    assert read_json(campaign_dir(kernel.workspace) / "campaign.json")["status"] == "completed"


def test_narration_mechanics_include_existing_skill_glossary(kernel):
    open_turn(kernel)
    stage_receipts(kernel)
    result = narrate(kernel, "t1-c3", "你检查了房间。")
    assert result["labels"]["Spot Hidden"] == "侦查"
