"""Slice 2, 12.4: the transcript road (cards, then sha-verified reads) and the history
road (timeline, events filter, diff from turn records only)."""

import json

from conftest import OPENING_SCENE, campaign_dir, open_turn, read_json, read_jsonl


def rewrite_transcript(workspace, turn, role, text):
    path = campaign_dir(workspace) / "transcript.jsonl"
    rows = read_jsonl(path)
    for row in rows:
        if row["turn"] == turn and row["role"] == role:
            row["text"] = text
    path.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")


def three_turns(client):
    open_turn(client, "第一回合的话。")
    first = client.table("narrate", call_id="t1-c1", text="第一回合的交付。\n\n第二段。")
    client.table("player_input", text="第二回合的话。")
    client.table("apply", call_id="t2-c1", effects=[{"kind": "time", "minutes": 5}])
    second = client.table("narrate", call_id="t2-c2", text="第二回合的交付。")
    client.table("player_input", text="第三回合的话。")
    return first, second


def test_transcript_cards_then_verified_read(kernel):
    first, second = three_turns(kernel)
    default = kernel.table("recall", what="transcript")
    assert default["turns"] == [1, 3]
    assert default["cards"] == [
        {"turn": 1, "role": "player", "chars": 7, "head": "第一回合的话。"},
        {"turn": 1, "role": "keeper", "chars": len(first["rendered_text"]), "head": "第一回合的交付。 第二段。"},
        {"turn": 2, "role": "player", "chars": 7, "head": "第二回合的话。"},
        {"turn": 2, "role": "keeper", "chars": len(second["rendered_text"]), "head": "第二回合的交付。 【变化】时间：+5 分钟"},
        {"turn": 3, "role": "player", "chars": 7, "head": "第三回合的话。"},
    ]
    assert [e["text"] for e in default["entries"]][:2] == ["第一回合的话。", first["rendered_text"]]  # slice-0 rows kept
    wide = kernel.table("recall", what="transcript", turns=[0, 3])
    assert "entries" not in wide and wide["cards"][0] == {"turn": 0, "role": "keeper", "chars": 15, "head": "开场。 诺特把钥匙拍在桌上。"}
    assert [c["role"] for c in kernel.table("recall", what="transcript", role="keeper")["cards"]] == ["keeper", "keeper"]

    keeper = kernel.table("recall", what="transcript", read={"turn": 1, "role": "keeper"})
    assert keeper == {"what": "transcript", "turn": 1, "role": "keeper", "text": first["rendered_text"], "verified": True}
    player = kernel.table("recall", what="transcript", read={"turn": 2, "role": "player"})
    assert player == {"what": "transcript", "turn": 2, "role": "player", "text": "第二回合的话。", "verified": True}
    missing = kernel.table_err("recall", what="transcript", read={"turn": 3, "role": "keeper"})
    assert missing["code"] == "invalid_params" and {"turn": 3, "role": "player"} in missing["details"]["available"]
    assert kernel.table_err("recall", what="transcript", read={"turn": "1", "role": "keeper"})["code"] == "invalid_params"


def test_transcript_read_flags_a_row_that_drifted_from_the_turn_record(kernel):
    first, _ = three_turns(kernel)
    rewrite_transcript(kernel.workspace, 1, "keeper", "第一回合的交付。\n\n被改过的第二段。")
    drifted = kernel.table("recall", what="transcript", read={"turn": 1, "role": "keeper"})
    assert drifted["verified"] is False and drifted["text"] == "第一回合的交付。\n\n被改过的第二段。"
    assert read_json(campaign_dir(kernel.workspace) / "turns" / "0001.json")["rendered_text"] == first["rendered_text"]
    rewrite_transcript(kernel.workspace, 2, "player", "第二回合被改的话。")
    assert kernel.table("recall", what="transcript", read={"turn": 2, "role": "player"})["verified"] is False
    # the untouched row still verifies
    assert kernel.table("recall", what="transcript", read={"turn": 2, "role": "keeper"})["verified"] is True


def history_campaign(client):
    open_turn(client, "我去档案馆。")
    client.table("apply", call_id="t1-c1", effects=[
        {"kind": "clue", "clue": "knott-keys"},
        {"kind": "move", "to": "hall-of-records", "travel_minutes": 20},
    ])
    client.table("resolve", call_id="t1-c2", action={"intent": "investigate", "goal": "找档案", "method": "翻找",
                                                    "skill": "Spot Hidden"})
    first = client.table("narrate", call_id="t1-c3", text="到了。\n\n灰尘很厚。")
    client.table("player_input", text="我推开柜子。")
    client.table("apply", call_id="t2-c1", effects=[{"kind": "damage", "dice": "1D3", "why": "柜子倒了"}])
    second = client.table("narrate", call_id="t2-c2", text="疼。")
    client.table("player_input", text="我等一下。")
    return first, second


def test_history_timeline_events_and_diff(kernel):
    first, second = history_campaign(kernel)
    hp_before = read_json(campaign_dir(kernel.workspace) / "turns" / "0001.json")["world"]["investigators"][0]["hp"]
    hp_after = read_json(campaign_dir(kernel.workspace) / "turns" / "0002.json")["world"]["investigators"][0]["hp"]
    assert hp_before == 12 and hp_after < hp_before

    result = kernel.table("recall", what="history")
    assert result["what"] == "history" and result["turns"] == [0, 3]
    assert result["timeline"] == [
        {"turn": 0, "commit": result["timeline"][0]["commit"], "scene": OPENING_SCENE, "clock": 0, "closed_by": "narrate",
         "receipts": {"roll": 0, "move": 0, "clue": 0, "delta": 0, "session": 0, "time": 0}, "head": "开场。 诺特把钥匙拍在桌上。"},
        {"turn": 1, "commit": first["commit"], "scene": "hall-of-records", "clock": 20, "closed_by": "narrate",
         "receipts": {"roll": 1, "move": 1, "clue": 1, "delta": 0, "session": 0, "time": 0}, "head": "到了。 灰尘很厚。"},
        {"turn": 2, "commit": second["commit"], "scene": "hall-of-records", "clock": 20, "closed_by": "narrate",
         "receipts": {"roll": 1, "move": 0, "clue": 0, "delta": 1, "session": 0, "time": 0}, "head": "疼。"},
    ]
    assert result["timeline"][0]["commit"]
    all_types = {e["type"] for e in result["events"]}
    assert {"turn-started", "player-declared", "scene-moved", "clue-discovered", "time-advanced", "roll-resolved",
            "resource-changed", "turn-finalized"} <= all_types
    assert result["events"] == read_jsonl(campaign_dir(kernel.workspace) / "events.jsonl")

    moves = kernel.table("recall", what="history", types=["scene-moved"])["events"]
    assert [(e["turn"], e["data"]["to"]) for e in moves] == [(1, "hall-of-records")]
    assert kernel.table("recall", what="history", turns=[2, 2])["timeline"][0]["turn"] == 2
    assert all(e["turn"] == 2 for e in kernel.table("recall", what="history", turns=[2, 2])["events"])
    assert kernel.table_err("recall", what="history", types=["dreamed"])["code"] == "invalid_params"

    diff = kernel.table("recall", what="history", diff=[0, 2])["diff"]
    assert diff == {
        "from": 0, "to": 2, "scene": [OPENING_SCENE, "hall-of-records"], "clock": [0, 20],
        "clues_added": ["knott-keys"],
        "resources": [{"subject": "thomas-hayes", "resource": "hp", "from": 12, "to": hp_after}],
        "sessions": [], "moves": [{"turn": 1, "from": OPENING_SCENE, "to": "hall-of-records"}],
    }
    later = kernel.table("recall", what="history", diff=[1, 2])["diff"]
    assert later["clues_added"] == [] and later["moves"] == [] and later["scene"] == ["hall-of-records", "hall-of-records"]
    assert later["resources"] == [{"subject": "thomas-hayes", "resource": "hp", "from": 12, "to": hp_after}]
    assert kernel.table_err("recall", what="history", diff=[0, 3])["details"]["closed_turns"] == [0, 1, 2]
    assert kernel.table_err("recall", what="history", diff=[2, 1])["code"] == "invalid_params"
    # nothing above read git: a rewritten record is what the diff sees
    path = campaign_dir(kernel.workspace) / "turns" / "0001.json"
    record = read_json(path)
    record["receipts"] = [r for r in record["receipts"] if r["kind"] != "clue"]
    path.write_text(json.dumps(record, ensure_ascii=False), encoding="utf-8")
    assert kernel.table("recall", what="history", diff=[0, 2])["diff"]["clues_added"] == []


def test_recall_memory_about_takes_one_word_of_a_name_people_first(kernel):
    from conftest import open_turn as _open_turn
    _open_turn(kernel)
    hits = kernel.table("recall", what="memory", about=["Knott"])
    assert hits["about"] == ["Steven Knott"], "a whole word of an NPC name resolves; the clues knott-keys/knott-commission lose to the person"
    corbitt = kernel.table("recall", what="memory", about=["Corbitt"])
    assert corbitt["about"] == ["Walter Corbitt"]
    error = kernel.table_err("recall", what="memory", about=["Atlantis"])
    assert error["code"] == "unknown_entity"
