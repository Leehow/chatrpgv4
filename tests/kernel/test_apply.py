import json

from conftest import OPENING_SCENE, campaign_dir, narrate, open_turn, read_json, read_jsonl


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


def test_move_retraces_the_trail(kernel):
    """Corbitt's lair has no authored exit; the way in is still the way out, all the way back."""
    open_turn(kernel)
    path = ["newspaper-morgue", "corbitt-house-ground", "basement-rites", "corbitt-confrontation"]
    for n, scene in enumerate(path, start=1):
        kernel.table("apply", call_id=f"t1-c{n}", effects=[{"kind": "move", "to": scene, "travel_minutes": 0}])
    trail = [OPENING_SCENE, "newspaper-morgue", "corbitt-house-ground", "basement-rites"]
    assert world(kernel)["scene_trail"] == trail
    seen = kernel.table("look", focus="scene")["where"]
    assert seen["exits"] == [] and [b["to"] for b in seen["back"]] == list(reversed(trail))

    error = kernel.table_err("apply", call_id="t1-c5", effects=[{"kind": "move", "to": "central-library"}])
    assert error["code"] == "not_reachable"
    assert error["details"]["exits"] == [] and error["details"]["back"] == list(reversed(trail))
    assert "basement-rites" in error["fix"] and "corbitt-house-ground" in error["fix"]

    # Two scenes back in one move: the trail is cut to the destination.
    back = kernel.table("apply", call_id="t1-c5", effects=[{"kind": "move", "to": "corbitt-house-ground"}])
    assert back["receipts"] == ["move:corbitt-house-ground-t1-c5"]
    assert back["world"]["active_scene"] == "corbitt-house-ground"
    assert world(kernel)["scene_trail"] == [OPENING_SCENE, "newspaper-morgue"]
    kernel.table("apply", call_id="t1-c6", effects=[{"kind": "move", "to": "basement-rites"}])
    assert world(kernel)["scene_trail"] == [OPENING_SCENE, "newspaper-morgue", "corbitt-house-ground"]

    # A world written before the trail existed rebuilds it from the event log on the next call.
    state = world(kernel)
    del state["scene_trail"]
    (campaign_dir(kernel.workspace) / "world.json").write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
    kernel.table("look", focus="time")
    assert world(kernel)["scene_trail"] == [OPENING_SCENE, "newspaper-morgue", "corbitt-house-ground"]


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
    # #19 made item and cash live, §18 (#27) flag/note/ruling; npc stays reserved for §17 (#29)
    reserved = kernel.table_err("apply", call_id="t1-c1", effects=[{"kind": "time", "minutes": 1},
                                                                    {"kind": "npc", "name": "x"}])
    assert reserved["code"] == "not_implemented" and reserved["details"]["index"] == 1
    # §14.8: handout is live now; an unknown card is unknown_entity, and the batch still does not write
    unknown = kernel.table_err("apply", call_id="t1-c1", effects=[{"kind": "time", "minutes": 1},
                                                                   {"kind": "handout", "name": "x"}])
    assert unknown["code"] == "unknown_entity" and unknown["details"]["index"] == 1
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
    narrated = narrate(kernel, "t1-c2", "你摔了下去。")
    dice = next(m for m in narrated["mechanics"] if m["kind"] == "dice")
    assert dice["label"] == "damage" and dice["expression"] == "1D6" and dice["total"] == before - after
    assert {"kind": "change", "receipt": "delta:hp-t1-c1", "resource": "hp", "subject": "thomas-hayes",
            "subject_label": "托马斯·海斯", "before": before, "after": after} in narrated["mechanics"]
    bad = kernel.table_err("apply", call_id="t2-c1", effects=[{"kind": "damage", "dice": "lots"}])
    assert bad["code"] in ("invalid_params", "turn_state")


def test_damage_effect_takes_compound_rulebook_dice(kernel):
    """`1D3+1D4` is what the-haunting's own graph writes for one of its weapons; the
    no-attacker damage path must roll it instead of calling it not a dice expression."""
    open_turn(kernel)
    before = kernel.table("look", focus="investigator")["hp"]
    result = kernel.table("apply", call_id="t1-c1",
                          effects=[{"kind": "damage", "dice": "1D3+1D4", "why": "断掉的楼梯砸下来"}])
    assert any(r.startswith("roll:damage-t1") for r in result["receipts"])
    after = kernel.table("look", focus="investigator")["hp"]
    assert 2 <= before - after <= 7, "two dice, both rolled"
    narrated = narrate(kernel, "t1-c2", f"木头砸在你肩上，{before - after} 点伤。")
    dice = next(m for m in narrated["mechanics"] if m["kind"] == "dice")
    assert dice["expression"] == "1D3+1D4"
    assert len(dice["faces"]) == 2 and dice["total"] == before - after


def test_move_label_names_the_scene_from_then_on(kernel):
    """A label given once is the scene's name afterwards: capsule, receipts, checkpoint."""
    open_turn(kernel)
    kernel.table("apply", call_id="t1-c1", effects=[{"kind": "move", "to": "hall-of-records", "label": "档案馆",
                                                     "travel_minutes": 0}])
    assert world(kernel)["scene_labels"] == {"hall-of-records": "档案馆"}
    assert kernel.table("look", focus="scene")["where"]["display_name"] == "档案馆"
    kernel.table("apply", call_id="t1-c2", effects=[{"kind": "move", "to": OPENING_SCENE}])
    receipt = kernel.table("status")["receipts"][-1]
    assert receipt["from_label"] == "档案馆" and receipt["to_label"] == "Knott's Office"
    kernel.table("apply", call_id="t1-c3", effects=[{"kind": "move", "to": "hall-of-records"}])
    assert kernel.table("look", focus="scene")["where"]["display_name"] == "档案馆"
    narrated = kernel.table("narrate", call_id="t1-c4", text="你回到了档案馆。")
    assert narrated["rendered_text"] == "你回到了档案馆。"
    assert narrated["mechanics"][-1] == {**narrated["mechanics"][-1], "kind": "scene", "from": OPENING_SCENE,
                                         "to": "hall-of-records", "from_label": "Knott's Office", "to_label": "档案馆"}
    record = read_json(campaign_dir(kernel.workspace) / "turns" / "0001.json")
    assert record["world"]["scene"] == {"name": "hall-of-records", "display_name": "档案馆"}
