"""§5 narrate under §16: the text is delivered verbatim, the receipts ride beside it as
the language-neutral `mechanics` projection, and the kernel refuses a text that does not
state every public receipt's numbers (`mechanics_missing`)."""

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
        {"kind": "clue", "receipt": "clue:knott-research-leads-t1", "clue": "knott-research-leads", "label": "诺特给的查证方向"},
        {"kind": "scene", "receipt": "move:hall-of-records-t1-c1", "from": "commission-briefing", "to": "hall-of-records",
         "minutes": 0, "from_label": "Knott's Office", "to_label": "市政厅档案室"},
    ]


def test_every_receipt_is_projected_and_the_turn_closes(kernel):
    open_turn(kernel)
    roll = stage_receipts(kernel)[0]
    text = f"第一段：你掷出 {roll['roll']}，侦查 {roll['target']}。\n\n第二段：十分钟（10）过去了。\n\n第三段。"
    result = kernel.table("narrate", call_id="t1-c3", text=text)
    assert result["rendered_text"] == text
    assert [m["kind"] for m in result["mechanics"]] == ["roll", "clue", "time", "scene"]
    assert result["mechanics"][0] == {"kind": "roll", "receipt": "roll:spot-hidden-t1-c1", "actor": "thomas-hayes",
                                      "skill": "Spot Hidden", "roll": roll["roll"], "target": 55, "threshold": 55,
                                      "difficulty": "regular", "level": roll["level"], "passed": roll["passed"],
                                      "pushed": False, "visibility": "public"}
    assert result["mechanics"][2] == {"kind": "time", "receipt": "time:t1-c2", "minutes": 10}
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


def test_text_missing_a_public_number_is_refused_naming_the_receipt(kernel):
    open_turn(kernel)
    roll = stage_receipts(kernel)[0]
    error = kernel.table_err("narrate", call_id="t1-c3", text="只有一段。")
    assert error["code"] == "invalid_params" and error["code_detail"] == "mechanics_missing"
    assert error["details"]["missing"] == [
        {"receipt": "roll:spot-hidden-t1-c1", "expected": [str(roll["roll"]), "55"]},
        {"receipt": "time:t1-c2", "expected": ["10"]},
    ]
    assert str(roll["roll"]) in error["fix"] and "55" in error["fix"] and "roll:spot-hidden-t1-c1" in error["fix"]
    # only the roll's numbers stated: the time receipt is still owed
    partial = kernel.table_err("narrate", call_id="t1-c3", text=f"掷出 {roll['roll']}，基础 55。")
    assert partial["code_detail"] == "mechanics_missing"
    assert [m["receipt"] for m in partial["details"]["missing"]] == ["time:t1-c2"]
    assert kernel.table("status")["state"] == "acting"
    # names are the keeper's to word: no name is checked, only digits
    done = kernel.table("narrate", call_id="t1-c3", text=f"{roll['roll']}／55，十分钟（10）。")
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
