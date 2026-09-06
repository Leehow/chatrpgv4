from conftest import OPENING_SCENE, campaign_dir, open_turn, read_json, read_jsonl


def world(client):
    return read_json(campaign_dir(client.workspace) / "world.json")


def test_move_reachable_and_unreachable(kernel):
    open_turn(kernel)
    error = kernel.table_err("apply", call_id="t1-c1", effects=[{"kind": "move", "to": "basement-rites"}])
    assert error["code"] == "not_reachable"
    assert error["details"]["index"] == 0
    assert error["details"]["from"] == OPENING_SCENE
    assert "hall-of-records" in error["details"]["exits"]
    assert world(kernel)["active_scene"] == OPENING_SCENE

    unknown = kernel.table_err("apply", call_id="t1-c1", effects=[{"kind": "move", "to": "atlantis"}])
    assert unknown["code"] == "unknown_entity" and unknown["details"]["index"] == 0

    moved = kernel.table("apply", call_id="t1-c1", effects=[{"kind": "move", "to": "Hall of Records",
                                                              "travel_minutes": 30}])
    assert moved["receipts"] == ["move:hall-of-records-t1-c1"]
    assert moved["world"] == {"active_scene": "hall-of-records", "clock": {"minutes": 30}}
    assert moved["material_ready"] is True
    state = world(kernel)
    assert state["active_scene"] == "hall-of-records"
    assert state["visited_scenes"] == [OPENING_SCENE, "hall-of-records"]
    events = read_jsonl(campaign_dir(kernel.workspace) / "events.jsonl")
    moved_event = [e for e in events if e["type"] == "scene-moved"][0]
    assert moved_event["data"] == {"from": OPENING_SCENE, "to": "hall-of-records", "minutes": 30}
    assert moved_event["receipt"] == "move:hall-of-records-t1-c1"

    # Default travel time: the graph has none on this edge, so 0.
    back = kernel.table("apply", call_id="t1-c2", effects=[{"kind": "move", "to": "scene-newspaper-morgue"}])
    assert back["world"]["clock"] == {"minutes": 30}
    assert kernel.table("status")["receipts"][-1]["minutes"] == 0


def test_clue_here_not_here_and_duplicate(kernel):
    open_turn(kernel)
    error = kernel.table_err("apply", call_id="t1-c1", effects=[{"kind": "clue", "clue": "chapel-eye-symbol"}])
    assert error["code"] == "not_here"
    assert error["details"]["index"] == 0
    assert error["details"]["scene"] == OPENING_SCENE
    assert "knott-commission" in error["details"]["clues_here"]
    assert world(kernel)["discovered_clues"] == []

    assert kernel.table_err("apply", call_id="t1-c1",
                            effects=[{"kind": "clue", "clue": "steven-knott"}])["code"] == "unknown_entity"

    found = kernel.table("apply", call_id="t1-c1", effects=[{"kind": "clue", "clue": "clue-knott-commission",
                                                              "how": "诺特摊开合同"}])
    assert found["receipts"] == ["clue:knott-commission-t1"]
    assert "replayed" not in found
    assert world(kernel)["discovered_clues"] == ["knott-commission"]
    event = [e for e in read_jsonl(campaign_dir(kernel.workspace) / "events.jsonl") if e["type"] == "clue-discovered"][0]
    assert event["data"]["clue"] == "knott-commission" and event["data"]["how"] == "诺特摊开合同"

    again = kernel.table("apply", call_id="t1-c2", effects=[{"kind": "clue", "clue": "knott-commission"}])
    assert again["replayed"] is True
    assert again["already_discovered"] == ["knott-commission"]
    assert world(kernel)["discovered_clues"] == ["knott-commission"]
    assert len([r for r in kernel.table("status")["receipts"] if r["kind"] == "clue"]) == 1

    clues = kernel.table("look", focus="clues")
    assert clues["discovered_clues"] == ["knott-commission"]
    assert next(c for c in clues["clues_here"] if c["name"] == "knott-commission")["discovered"] is True


def test_time_advances_the_clock(kernel):
    open_turn(kernel)
    result = kernel.table("apply", call_id="t1-c1", effects=[{"kind": "time", "minutes": 45, "why": "翻档案"}])
    assert result["receipts"] == ["time:t1-c1"]
    assert result["world"]["clock"] == {"minutes": 45}
    assert kernel.table("look", focus="time") == {"clock": {"minutes": 45}}
    both = kernel.table("apply", call_id="t1-c2", effects=[{"kind": "time", "minutes": 5}, {"kind": "time", "minutes": 10}])
    assert both["receipts"] == ["time:t1-c2", "time:t1-c2-2"]
    assert both["world"]["clock"] == {"minutes": 60}
    assert kernel.table_err("apply", call_id="t1-c3", effects=[{"kind": "time", "minutes": -1}])["code"] == "invalid_params"


def test_batch_is_atomic(kernel):
    open_turn(kernel)
    error = kernel.table_err("apply", call_id="t1-c1", effects=[
        {"kind": "clue", "clue": "knott-commission"},
        {"kind": "move", "to": "basement-rites"},
    ])
    assert error["code"] == "not_reachable"
    assert error["details"]["index"] == 1
    state = world(kernel)
    assert state["discovered_clues"] == []
    assert state["active_scene"] == OPENING_SCENE
    assert kernel.table("status")["receipts"] == []
    assert not [e for e in read_jsonl(campaign_dir(kernel.workspace) / "events.jsonl")
                if e["type"] in ("clue-discovered", "scene-moved")]

    # The batch validates sequentially: a clue at the destination is fine after the move.
    result = kernel.table("apply", call_id="t1-c1", effects=[
        {"kind": "clue", "clue": "knott-research-leads"},
        {"kind": "move", "to": "hall-of-records"},
        {"kind": "clue", "clue": "chapel-closed-1912"},
        {"kind": "time", "minutes": 15},
    ])
    assert result["receipts"] == ["clue:knott-research-leads-t1", "move:hall-of-records-t1-c1",
                                  "clue:chapel-closed-1912-t1", "time:t1-c1"]
    assert world(kernel)["discovered_clues"] == ["knott-research-leads", "chapel-closed-1912"]


def test_reserved_and_unknown_effect_kinds(kernel):
    open_turn(kernel)
    reserved = kernel.table_err("apply", call_id="t1-c1", effects=[{"kind": "time", "minutes": 1},
                                                                    {"kind": "handout", "name": "x"}])
    assert reserved["code"] == "not_implemented" and reserved["details"]["index"] == 1
    assert world(kernel)["clock"] == {"minutes": 0}
    assert kernel.table_err("apply", call_id="t1-c1", effects=[{"kind": "teleport"}])["code"] == "invalid_params"
    assert kernel.table_err("apply", call_id="t1-c1", effects=[])["code"] == "invalid_params"


def test_damage_effect_rolls_the_dice_and_moves_hp(kernel):
    open_turn(kernel)
    before = kernel.table("look", focus="investigator")["hp"]
    result = kernel.table("apply", call_id="t1-c1", effects=[{"kind": "damage", "dice": "1D6", "why": "从楼梯上摔下来"}])
    assert any(r.startswith("roll:damage-t1") for r in result["receipts"])
    assert any(r.startswith("delta:hp-t1") for r in result["receipts"])
    after = kernel.table("look", focus="investigator")["hp"]
    assert 0 <= before - after <= 6 and after < before
    narrated = kernel.table("narrate", call_id="t1-c2", text="你摔了下去。")
    assert "【明骰】伤害｜" in narrated["rendered_text"]
    assert f"【变化】生命值：" in narrated["rendered_text"]
    bad = kernel.table_err("apply", call_id="t2-c1", effects=[{"kind": "damage", "dice": "lots"}])
    assert bad["code"] in ("invalid_params", "turn_state")
