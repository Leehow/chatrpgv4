import json

from conftest import RpcClient, campaign_dir, create_campaign, narrate, narrate_opening, open_turn, read_json


ACTION = {"intent": "investigate", "goal": "看桌上有什么", "method": "用侦查扫一眼"}


def test_idempotent_replay_and_conflict(kernel):
    open_turn(kernel)
    first = kernel.table("resolve", call_id="t1-c1", action=ACTION)
    replay = kernel.table("resolve", call_id="t1-c1", action=ACTION)
    assert replay == {**first, "replayed": True}
    assert len(kernel.table("status")["receipts"]) == 1

    conflict = kernel.table_err("resolve", call_id="t1-c1", action={**ACTION, "goal": "别的目标"})
    assert conflict["code"] == "idempotency_conflict"

    applied = kernel.table("apply", call_id="t1-c2", effects=[{"kind": "time", "minutes": 5}])
    assert kernel.table("apply", call_id="t1-c2", effects=[{"kind": "time", "minutes": 5}]) == {**applied, "replayed": True}
    assert kernel.table("look", focus="time") == {"clock": {"minutes": 5}}
    assert kernel.table_err("apply", call_id="t1-c2", effects=[{"kind": "time", "minutes": 6}])["code"] == "idempotency_conflict"

    text = "他抬起头。"
    narrated = kernel.table("narrate", call_id="t1-c3", text=text)
    # The turn is closed; the same narrate call replays from the closed record.
    again = kernel.table("narrate", call_id="t1-c3", text=text)
    assert again == {**narrated, "replayed": True}
    assert kernel.table("status")["turn"] == 2
    assert kernel.table_err("narrate", call_id="t1-c3", text="别的文字")["code"] == "idempotency_conflict"


def test_turn_state_errors(kernel):
    create_campaign(kernel)
    narrate_opening(kernel)
    # awaiting_player: only reads and player_input.
    for method, params in (
        ("resolve", {"call_id": "t1-c1", "action": {"intent": "idle"}}),
        ("apply", {"call_id": "t1-c1", "effects": [{"kind": "time", "minutes": 1}]}),
        ("ask", {"call_id": "t1-c1", "prompt": "?", "options": ["a", "b"]}),
        ("narrate", {"call_id": "t1-c1", "text": "x"}),
    ):
        assert kernel.table_err(method, **params)["code"] == "turn_state", method
    assert kernel.table("look")
    assert kernel.table("status")["state"] == "awaiting_player"

    kernel.table("player_input", text="第一句。")
    assert kernel.table_err("player_input", text="第二句。")["code"] == "turn_state"
    assert kernel.table("status")["state"] == "open"
    kernel.table("look")
    assert kernel.table("status")["state"] == "acting"
    assert kernel.table_err("player_input", text="第三句。")["code"] == "turn_state"

    kernel.table("ask", call_id="t1-c1", prompt="去哪？", options=["左", "右"])
    assert kernel.table("status")["state"] == "asked"
    assert kernel.table_err("narrate", call_id="t1-c2", text="x")["code"] == "turn_state"
    assert kernel.table_err("resolve", call_id="t1-c2", action={"intent": "idle"})["code"] == "turn_state"
    assert kernel.table("look", focus="time") == {"clock": {"minutes": 0}}
    assert kernel.table("player_input", text="左。")["turn"] == 2


def test_ask_closes_turn_and_pending_choice_carries_over(kernel):
    open_turn(kernel, "我问诺特该从哪里查起。")
    asked = kernel.table("ask", call_id="t1-c1", prompt="你想先去哪里？",
                         options=["报社档案", "中央图书馆"], binds="first-stop")
    assert asked["state"] == "asked" and asked["turn"] == 1
    assert asked["rendered_text"] == "" and asked["mechanics"] == []
    assert asked["interaction"]["prompt"] == "你想先去哪里？"
    pending = asked["pending_choice"]
    assert pending["name"] == "ask-first-stop-t1"
    assert pending["options"] == ["报社档案", "中央图书馆"]
    assert pending["binds"] == "first-stop"
    assert kernel.table("status")["pending_choice"] == pending
    assert kernel.table("open")["pending_turn"] is None
    record = read_json(campaign_dir(kernel.workspace) / "turns" / "0001.json")
    assert record["closed_by"] == "ask" and record["rendered_text"] == asked["rendered_text"]
    transcript = kernel.table("recall", what="transcript", role="keeper")["entries"]
    assert transcript[-1]["text"] == asked["rendered_text"]

    answer = kernel.table("player_input", text="先去报社。")
    assert answer["turn"] == 2
    assert answer["capsule"]["turn"]["pending_choice"] == pending
    assert answer["capsule"]["recent"][-1] == {"turn": 1, "player": "我问诺特该从哪里查起。",
                                               "keeper": asked["rendered_text"], "closed": "explicit", "receipts": 0}

    bad = kernel.table_err("resolve", call_id="t2-c1", action={"intent": "meta", "choice": {"pending": "other", "option": "x"}})
    assert bad["code"] == "invalid_params"
    chosen = kernel.table("resolve", call_id="t2-c1", action={
        "intent": "meta", "goal": "选路", "method": "",
        "choice": {"pending": pending["name"], "option": "报社档案"}})
    assert chosen["outcome"] == {"kind": "none"} and chosen["pending_choice"] is None
    receipts = kernel.table("status")["receipts"]
    assert receipts == [{**receipts[0], "id": f"choice:{pending['name']}-t2", "kind": "choice", "option": "报社档案"}]
    kernel.table("apply", call_id="t2-c2", effects=[{"kind": "move", "to": "newspaper-morgue"}])
    narrated = kernel.table("narrate", call_id="t2-c3", text="你们出发去报社。")
    assert narrated["rendered_text"] == "你们出发去报社。"
    assert [(m["kind"], m.get("option"), m.get("to")) for m in narrated["mechanics"]] == [
        ("choice", "报社档案", None), ("scene", None, "newspaper-morgue")]


def test_pending_turn_survives_a_crash(tmp_path):
    workspace = tmp_path / "ws"
    first = RpcClient(workspace)
    try:
        open_turn(first, "我环视办公室。")
        first.table("resolve", call_id="t1-c1", action=ACTION)
        assert read_json(campaign_dir(workspace) / "turn.json")["state"] == "acting"
    finally:
        first.close()  # the process dies mid-turn

    second = RpcClient(workspace)
    try:
        opened = second.table("open")
        assert opened["opening_needed"] is False
        assert opened["turn"] == {"number": 1, "state": "acting"}
        pending = opened["pending_turn"]
        assert pending["player_text"] == "我环视办公室。"
        assert [r["id"] for r in pending["receipts"]] == ["roll:spot-hidden-t1-c1"]
        assert pending["owed"] == ["narrate"]
        assert pending["since"]
        assert pending["last_call_ordinal"] == 1  # t1-c1 was spent before the crash
        # The keeper finishes the turn in the new process.
        roll = pending["receipts"][0]
        result = second.table("narrate", call_id="t1-c2", text=f"办公室里只有雪茄味。（{roll['roll']}／{roll['target']}）")
        assert result["mechanics"][0]["kind"] == "roll" and result["mechanics"][0]["skill"] == "Spot Hidden"
        assert second.table("open")["pending_turn"] is None
    finally:
        second.close()


def test_pending_turn_from_hand_edited_turn_json(kernel):
    open_turn(kernel, "我等他开口。")
    path = campaign_dir(kernel.workspace) / "turn.json"
    turn = read_json(path)
    turn["state"] = "acting"
    path.write_text(json.dumps(turn, ensure_ascii=False), encoding="utf-8")
    opened = kernel.table("open")
    assert opened["turn"]["state"] == "acting"
    assert opened["pending_turn"]["player_text"] == "我等他开口。"
    assert opened["pending_turn"]["receipts"] == []


def test_transport_errors_do_not_kill_the_kernel(kernel):
    assert kernel.raw("not json")["error"]["code"] == "invalid_params"
    assert kernel.raw('{"id": "x", "method": 5}')["error"]["code"] == "invalid_params"
    assert kernel.err("nope.method")["code"] == "unknown_method"
    assert kernel.err("table.open", {})["code"] == "invalid_params"
    assert kernel.err("table.open", {"campaign": "ghost"})["code"] == "campaign_not_found"
    assert kernel.ok("kernel.hello")["kernel_version"]


def test_commit_failure_keeps_the_turn_open(kernel):
    from conftest import read_jsonl, repo_dir

    open_turn(kernel, "我听墙角。")
    kernel.table("resolve", call_id="t1-c1", action={"intent": "investigate", "goal": "x", "method": "y",
                                                    "skill": "Listen"})
    directory = campaign_dir(kernel.workspace)
    transcript_before = read_jsonl(directory / "transcript.jsonl")
    events_before = read_jsonl(directory / "events.jsonl")

    repo = repo_dir(kernel.workspace)
    broken = repo.with_name("c1.broken")
    repo.rename(broken)
    try:
        error = kernel.table_err("narrate", call_id="t1-c2", text="第一段。\n\n第二段。")
    finally:
        broken.rename(repo)
    assert error["code"] == "commit_failed"
    status = kernel.table("status")
    assert status["turn"] == 1 and status["state"] == "acting"
    assert [r["id"] for r in status["receipts"]] == ["roll:listen-t1-c1"]
    assert not (directory / "turns" / "0001.json").exists()
    assert read_jsonl(directory / "transcript.jsonl") == transcript_before
    assert read_jsonl(directory / "events.jsonl") == events_before
    assert kernel.table("open")["pending_turn"]["owed"] == ["narrate"]

    result = narrate(kernel, "t1-c2", "第一段。\n\n第二段。")
    assert result["commit"]
    assert [m["skill"] for m in result["mechanics"] if m["kind"] == "roll"] == ["Listen"]
    assert kernel.table("status") == {"turn": 2, "state": "awaiting_player", "receipts": [], "mechanics": [],
                                      "pending_choice": None}


def test_ask_keeps_story_mechanics_and_interaction_separate(kernel):
    open_turn(kernel)
    kernel.table("resolve", call_id="t1-c1", action={"intent": "investigate", "goal": "x", "method": "y", "skill": "Spot Hidden"})
    asked = kernel.table("ask", call_id="t1-c2", text="你举起灯，墙上有影子在动。", prompt="你要怎么做？", options=["退后", "上前"])
    assert asked["rendered_text"] == "你举起灯，墙上有影子在动。"
    assert asked["interaction"]["options"] == ["退后", "上前"]
    assert asked["interaction"]["prompt"] == "你要怎么做？"
    assert [row["kind"] for row in asked["mechanics"]] == ["roll"]


def test_mechanics_choice_has_no_question_or_numbered_prose(kernel):
    open_turn(kernel)
    bad = kernel.table_err("ask", call_id="t1-c1", kind="mechanics", prompt="怎么处理失败？", options=["push", "accept"])
    assert bad["code"] == "invalid_params"
    asked = kernel.table("ask", call_id="t1-c1", kind="mechanics", options=["push", "spend_luck", "accept"])
    assert asked["rendered_text"] == ""
    assert asked["interaction"]["kind"] == "mechanics"
    assert asked["interaction"]["options"] == ["push", "spend_luck", "accept"]
    assert not asked["interaction"]["prompt"]
