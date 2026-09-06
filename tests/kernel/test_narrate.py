from conftest import campaign_dir, git_log, open_turn, read_json, read_jsonl


def stage_receipts(client):
    """One roll, one clue, one time, one move, in that order."""
    client.table("resolve", call_id="t1-c1", action={"intent": "investigate", "goal": "x", "method": "y",
                                                    "skill": "Spot Hidden"})
    client.table("apply", call_id="t1-c2", effects=[
        {"kind": "clue", "clue": "knott-research-leads"},
        {"kind": "time", "minutes": 10},
        {"kind": "move", "to": "hall-of-records", "travel_minutes": 20},
    ])
    roll = client.table("status")["receipts"][0]
    verdict = "通过" if roll["passed"] else "未通过"
    return [
        f"【明骰】侦查｜掷骰：{roll['roll']}；基础值：55；门槛：普通（≤55）；结果：{verdict}",
        "【变化】线索：knott-research-leads",
        "【变化】时间：+10 分钟",
        "【变化】场景：Knott's Office → hall-of-records（20 分钟）",
    ]


def test_labels_and_zero_travel_time_in_mechanics_lines(kernel):
    open_turn(kernel)
    kernel.table("apply", call_id="t1-c1", effects=[
        {"kind": "clue", "clue": "knott-research-leads", "label": "诺特给的查证方向"},
        {"kind": "move", "to": "hall-of-records", "label": "市政厅档案室"},
    ])
    result = kernel.table("narrate", call_id="t1-c2", text="你出了门。")
    assert result["rendered_text"] == (
        "你出了门。\n\n【变化】线索：诺特给的查证方向\n【变化】场景：Knott's Office → 市政厅档案室"
    )


def test_auto_placement_after_first_paragraph(kernel):
    open_turn(kernel)
    lines = stage_receipts(kernel)
    text = "第一段。\n\n第二段。\n\n第三段。"
    result = kernel.table("narrate", call_id="t1-c3", text=text)
    assert result["rendered_text"] == "第一段。\n\n" + "\n".join(lines) + "\n\n第二段。\n\n第三段。"
    assert result["turn"] == 1
    assert result["receipt"] == "turn:1"
    assert result["commit"]
    assert git_log(kernel.workspace)[0] == "turn 1: 第一段。 第二段。 第三段。"

    status = kernel.table("status")
    assert status == {"turn": 2, "state": "awaiting_player", "receipts": [], "pending_choice": None}
    record = read_json(campaign_dir(kernel.workspace) / "turns" / "0001.json")
    assert record["player_text"] == "我仔细观察诺特。"
    assert [r["id"] for r in record["receipts"]] == ["roll:spot-hidden-t1-c1", "clue:knott-research-leads-t1",
                                                    "time:t1-c2", "move:hall-of-records-t1-c2"]
    assert record["rendered_text"] == result["rendered_text"]
    assert record["commit"] == result["commit"]
    transcript = read_jsonl(campaign_dir(kernel.workspace) / "transcript.jsonl")
    assert transcript[-1] == {**transcript[-1], "turn": 1, "role": "keeper", "text": result["rendered_text"]}
    finalized = [e for e in read_jsonl(campaign_dir(kernel.workspace) / "events.jsonl") if e["type"] == "turn-finalized"]
    assert finalized[-1]["turn"] == 1 and finalized[-1]["receipt"] == "turn:1"


def test_auto_placement_with_single_paragraph_appends(kernel):
    open_turn(kernel)
    lines = stage_receipts(kernel)
    result = kernel.table("narrate", call_id="t1-c3", text="只有一段。")
    assert result["rendered_text"] == "只有一段。\n\n" + "\n".join(lines)


def test_end_placement(kernel):
    open_turn(kernel)
    lines = stage_receipts(kernel)
    result = kernel.table("narrate", call_id="t1-c3", text="第一段。\n\n第二段。", placement="end")
    assert result["rendered_text"] == "第一段。\n\n第二段。\n\n" + "\n".join(lines)
    assert kernel.table_err("narrate", call_id="t2-c1", text="x", placement="middle")["code"] in ("invalid_params", "turn_state")


def test_no_receipts_renders_text_verbatim(kernel):
    open_turn(kernel)
    result = kernel.table("narrate", call_id="t1-c1", text="诺特只是看着你。\n\n他没有说话。")
    assert result["rendered_text"] == "诺特只是看着你。\n\n他没有说话。"


def test_self_written_dice_lines_are_rejected(kernel):
    open_turn(kernel)
    for bad in ("【明骰】侦查｜掷骰：3\n\n你看见了。", "你走进大厅。\n【变化】场景：a → b（0 分钟）"):
        error = kernel.table_err("narrate", call_id="t1-c1", text=bad)
        assert error["code"] == "invalid_params"
        assert error["fix"]
    assert kernel.table("status")["state"] == "open"
    assert kernel.table_err("narrate", call_id="t1-c1", text="   ")["code"] == "invalid_params"
