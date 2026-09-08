"""Slice 1, second half: the three session families — combat, chase, sanity — behind
`resolve`, all through the RPC seam (contract §11.5, §11.9)."""

import json

from conftest import RpcClient, ask, campaign_dir, narrate, open_turn, read_json, read_jsonl
from test_rules_families import event_count, events_after, resolve, resolve_err, walk_to_confrontation

INVESTIGATOR = "thomas-hayes"
CORBITT = "walter-corbitt"


def receipts(client):
    return {r["id"]: r for r in client.table("status")["receipts"]}


def save_path(client, *parts):
    return campaign_dir(client.workspace).joinpath("save", *parts)


def sheet(client):
    return read_json(campaign_dir(client.workspace) / "party" / f"{INVESTIGATOR}.json")


def attack_and_npc_defense(client, n, *, defense="none", weapon=".38 Revolver"):
    """The investigator's shot and Corbitt's answer; returns (attack, defend, next ordinal)."""
    attack = resolve(client, f"t1-c{n}", intent="combat", goal="朝科比特开枪", method="用左轮射击",
                     target="Walter Corbitt", weapon=weapon)
    defend = resolve(client, f"t1-c{n + 1}", intent="combat", goal="他迎着子弹", method="", actor="Walter Corbitt",
                     defense=defense)
    return attack, defend, n + 2


# ---- combat ---------------------------------------------------------------------------------

def test_combat_against_corbitt_with_the_revolver(tmp_path):
    client = RpcClient(tmp_path / "ws", env={"COC_KERNEL_SEED": "9"})
    try:
        open_turn(client, "我举枪对准棺材里的东西。")
        n = walk_to_confrontation(client)
        assert client.table("look")["where"]["session"] is None

        missing = resolve_err(client, f"t1-c{n}", intent="combat", goal="开枪", method="射击", target="Walter Corbitt")
        assert missing["code"] == "needs"
        assert missing["details"]["needs"] == {"field": "weapon", "options": [".38 Revolver", "unarmed"]}
        unknown = resolve_err(client, f"t1-c{n}", intent="combat", goal="开枪", method="射击", target="Walter Corbitt",
                              weapon="Tommy gun")
        assert unknown["code"] == "needs" and unknown["details"]["needs"]["field"] == "weapon"

        attack = resolve(client, f"t1-c{n}", intent="combat", goal="朝科比特开枪", method="用左轮射击",
                         target="Walter Corbitt", weapon=".38 Revolver")
        assert attack["decision"] == "combat:attack" and attack["family"] == "combat"
        outcome = attack["outcome"]
        assert outcome["kind"] == "combat" and outcome["status"] == "pending_defense" and outcome["started"] is True
        assert outcome["target"] == CORBITT and outcome["attack_kind"] == "firearm_attack"
        assert outcome["defense_options"] == ["dodge", "none"]
        assert [row["actor_id"] for row in outcome["initiative"]] == [INVESTIGATOR, CORBITT]  # readied firearm: DEX+50
        session = attack["session"]
        assert session["kind"] == "combat" and session["status"] == "active" and session["round"] == 1
        assert session["turn_of"] == INVESTIGATOR
        assert session["pending_defense"] == {"for": "npc", "actor": CORBITT, "attacker": INVESTIGATOR, "options": ["dodge", "none"]}
        assert [p["name"] for p in session["participants"]] == [INVESTIGATOR, CORBITT]
        corbitt = session["participants"][1]
        assert corbitt["hp"] == 16 and corbitt["armor"] >= 2  # Flesh Ward (2D6) from the scene's authored operation
        assert session["actions"][0]["decision"] == "combat:defend" and session["actions"][0]["for"] == "npc"
        assert attack["pending_choice"] == {**attack["pending_choice"], "name": f"defense:{INVESTIGATOR}-r1", "for": "keeper",
                                            "options": ["dodge", "none"]}
        assert f"session:combat-start-t1-c{n}" in attack["receipts"]
        assert {e["kind"] for e in attack["effects"]} == {"mp", "armor"}  # the preparations cost Corbitt MP
        assert [c["decision"] for c in attack["continuations"]] == ["combat:defend"]

        # 11.3.1: while the defense is pending nothing else resolves.
        blocked = resolve_err(client, f"t1-c{n + 1}", intent="investigate", goal="看看四周", method="用侦查")
        assert blocked["code"] == "turn_state" and blocked["details"]["required"] == "combat:defend"
        assert blocked["details"]["actor"] == CORBITT and "defense" in blocked["fix"]
        # The investigator cannot answer for the NPC.
        wrong = resolve_err(client, f"t1-c{n + 1}", intent="combat", goal="x", method="", defense="dodge")
        assert wrong["code"] == "turn_state"

        defend = resolve(client, f"t1-c{n + 1}", intent="combat", goal="他迎着子弹", method="", actor="Walter Corbitt",
                         defense="none")
        assert defend["decision"] == "combat:defend"
        outcome = defend["outcome"]
        assert outcome["kind"] == "combat" and outcome["status"] == "resolved" and outcome["actor"] == CORBITT
        assert outcome["defense"] == "none" and outcome["turn_outcome"] == "hit"
        assert outcome["rolls"][0] == {**outcome["rolls"][0], "actor": INVESTIGATOR, "skill": "Firearms (Handgun)",
                                       "target": 55, "passed": True, "receipt": f"roll:firearms-handgun-t1-c{n + 1}"}
        assert outcome["damage"][0]["expression"] == "1D10"
        assert defend["receipts"][:2] == [f"roll:firearms-handgun-t1-c{n + 1}", f"roll:hp-damage-t1-c{n + 1}"]
        assert f"delta:hp-t1-c{n + 1}" in defend["receipts"]
        hp = [e for e in defend["effects"] if e["kind"] == "hp"]
        assert hp == [{"kind": "hp", "subject": CORBITT, "before": 16, "after": 15}]  # armor took the rest
        ammo = [e for e in defend["effects"] if e["kind"] == "ammo"]
        assert ammo == [{"kind": "ammo", "subject": INVESTIGATOR, "before": 6, "after": 5, "weapon": "revolver_38_or_9mm"}]
        assert any(e["kind"] == "armor" and e["subject"] == CORBITT for e in defend["effects"])
        # Ammo spent and armor soaked are receipts the player reads, not just effects.
        logged = {r["id"]: r for r in client.table("status")["receipts"]}
        assert logged[f"delta:ammo-t1-c{n + 1}"]["resource"] == "ammo" and "label" not in logged[f"delta:ammo-t1-c{n + 1}"]
        assert logged[f"delta:armor-t1-c{n + 1}"]["resource"] == "armor"
        assert defend["session"]["turn_of"] == CORBITT and defend["session"]["pending_defense"] is None
        assert defend["pending_choice"] is None
        assert [a["decision"] for a in defend["session"]["actions"]] == ["combat:attack", "combat:maneuver", "combat:end"]
        events = read_jsonl(campaign_dir(client.workspace) / "events.jsonl")
        settled = [e for e in events if e["type"] == "decision-settled"][-1]
        assert settled["data"]["session_kind"] == "combat" and settled["data"]["session_status"] == "active"
        # hp, then the spent round, then the ward soaking the rest: three resource changes.
        assert [e["type"] for e in events][-6:] == ["roll-resolved", "roll-resolved", "resource-changed",
                                                    "resource-changed", "resource-changed", "decision-settled"]

        # Corbitt's turn: the keeper acts as him; the investigator's defense is the player's.
        strike = resolve(client, f"t1-c{n + 2}", intent="combat", goal="科比特挥刀扑上来", method="", actor="Walter Corbitt",
                         target="托马斯·海斯")
        assert strike["outcome"]["status"] == "pending_defense" and strike["outcome"]["actor"] == CORBITT
        assert strike["outcome"]["defense_options"] == ["dodge", "fight_back", "none"]
        assert strike["session"]["pending_defense"] == {"for": "player", "actor": INVESTIGATOR, "attacker": CORBITT,
                                                        "options": ["dodge", "fight_back", "none"]}
        pending = strike["pending_choice"]
        assert pending["for"] == "player" and pending["name"] == f"defense:{CORBITT}-r1"
        assert pending["options"] == ["dodge", "fight_back", "none"] and "Walter Corbitt" in pending["prompt"]
        assert [e["kind"] for e in strike["effects"]] == ["mp"]  # the floating knife costs a Magic point
        # Every resolve during the session echoes it (11.9).
        assert client.table("look")["where"]["session"]["pending_defense"]["for"] == "player"

        # The keeper hands the defense to the player through ask; the next turn answers it.
        asked = ask(client, f"t1-c{n + 3}", "科比特挥刀扑来，你怎么应对？",
                    ["躲开", "还手", "硬挨"], binds=pending["name"])
        assert asked["pending_choice"]["binds"] == pending["name"]
        answer = client.table("player_input", text="我闪开！")
        assert answer["turn"] == 2 and answer["capsule"]["where"]["session"]["pending_defense"]["for"] == "player"
        again = resolve_err(client, "t2-c1", intent="investigate", goal="x", method="用侦查")
        assert again["code"] == "turn_state" and again["details"]["actor"] == INVESTIGATOR
        dodge = resolve(client, "t2-c1", intent="combat", goal="我闪开", method="", defense="dodge",
                        choice={"pending": pending["name"], "option": "dodge"})
        assert dodge["decision"] == "combat:defend" and dodge["outcome"]["actor"] == INVESTIGATOR
        assert dodge["outcome"]["defense"] == "dodge"
        rolled = receipts(client)
        assert rolled["choice:" + asked["pending_choice"]["name"] + "-t2"]["option"] == "dodge"
        npc_roll = rolled["roll:pow-walter-corbitt-t2-c1"]
        assert npc_roll["actor"] == CORBITT and npc_roll["actor_label"] == "Walter Corbitt" and npc_roll["visibility"] == "public"
        assert npc_roll["actor_is_investigator"] is False
        assert npc_roll["round"] == 1 and npc_roll["session_kind"] == "combat"
        assert rolled["roll:dodge-t2-c1"]["actor"] == INVESTIGATOR and rolled["roll:dodge-t2-c1"]["target"] == 30
        assert dodge["session"]["status"] == "active" and dodge["session"]["round"] == 2
        assert dodge["session"]["turn_of"] == INVESTIGATOR  # round 2: the readied firearm still shoots first

        # The exchange is replay-safe under its call_id.
        assert resolve(client, "t2-c1", intent="combat", goal="我闪开", method="", defense="dodge",
                       choice={"pending": pending["name"], "option": "dodge"}) == {**dodge, "replayed": True}
        assert len([r for r in client.table("status")["receipts"] if r["kind"] == "roll"]) == 2

        rolls = [m for m in narrate(client, "t2-c2", "刀锋擦着你的脸过去。")["mechanics"] if m["kind"] == "roll"]
        assert any(m["actor_is_investigator"] is False and "actor_label" not in m and "actor" not in m for m in rolls)
        assert any(m["skill"] == "Dodge" and m["actor"] == INVESTIGATOR for m in rolls)
        first_turn = read_json(campaign_dir(client.workspace) / "turns" / "0001.json")
        assert first_turn["closed_by"] == "ask"
        assert any(r["kind"] == "session" and r["transition"] == "start" for r in first_turn["receipts"])
    finally:
        client.close()


def test_defense_none_and_the_snapshot_survives_a_restart(tmp_path):
    client = RpcClient(tmp_path / "ws", env={"COC_KERNEL_SEED": "6"})
    try:
        open_turn(client, "我开枪。")
        n = walk_to_confrontation(client)
        attack, defend, n = attack_and_npc_defense(client, n)
        assert defend["session"]["turn_of"] == CORBITT
        strike = resolve(client, f"t1-c{n}", intent="combat", goal="科比特扑来", method="", actor="Walter Corbitt",
                         target="托马斯·海斯")
        assert strike["pending_choice"]["for"] == "player"
        # Taking no defense: only the attacker rolls.
        stand = resolve(client, f"t1-c{n + 1}", intent="combat", goal="我硬吃这一下", method="", defense="none")
        assert stand["outcome"]["defense"] == "none" and stand["outcome"]["opposed_outcome"] == "unopposed"
        rolled = [r for r in stand["outcome"]["rolls"]]
        assert rolled[0]["actor"] == CORBITT and rolled[0]["skill"] == "POW"  # the floating knife: Corbitt's POW
        # No defense roll; the only investigator die is the CON roll a major wound may force.
        assert all(r["skill"] == "CON" for r in rolled[1:] if r["actor"] == INVESTIGATOR)
        hp = [e for e in stand["effects"] if e["kind"] == "hp"]
        if stand["outcome"]["turn_outcome"] == "hit":
            assert hp and hp[0]["subject"] == INVESTIGATOR and hp[0]["after"] < 12
            assert sheet(client)["current_hp"] == hp[0]["after"]
            healing = read_json(save_path(client, "healing-state", f"{INVESTIGATOR}.json"))
            assert healing["wound_ledger"][0]["status"] == "active"
        else:
            assert hp == []
        snapshot_before = read_json(save_path(client, "combat.json"))
        assert snapshot_before["status"] in ("active", "concluded")
    finally:
        client.close()

    # A fresh kernel on the same workspace continues the same fight from save/combat.json.
    second = RpcClient(tmp_path / "ws", env={"COC_KERNEL_SEED": "6"})
    try:
        look = second.table("look")["where"]["session"]
        if snapshot_before["status"] != "active":
            assert look is None
            return
        assert look["kind"] == "combat" and look["round"] == snapshot_before["current_round"]
        assert look["turn_of"] == snapshot_before["current_initiative"][snapshot_before["initiative_cursor"]]["actor_id"]
        actor = look["turn_of"]
        if actor == INVESTIGATOR:
            follow = resolve(second, f"t1-c{n + 2}", intent="combat", goal="再开一枪", method="", target="Walter Corbitt",
                             weapon=".38 Revolver")
        else:
            follow = resolve(second, f"t1-c{n + 2}", intent="combat", goal="他再扑", method="", actor="Walter Corbitt",
                             target="托马斯·海斯")
        assert follow["outcome"]["status"] == "pending_defense"
        assert read_json(save_path(second, "combat.json"))["revision"] == snapshot_before["revision"] + 1
        ended = resolve_err(second, f"t1-c{n + 3}", intent="combat", goal="x", method="", decision="combat:end", outcome="stalemate")
        assert ended["code"] == "turn_state"  # the pending defense comes first
    finally:
        second.close()


def test_combat_end_by_the_keeper(seeded_kernel):
    open_turn(seeded_kernel, "我上前。")
    n = walk_to_confrontation(seeded_kernel)
    attack, defend, n = attack_and_npc_defense(seeded_kernel, n, weapon="unarmed")
    assert attack["outcome"]["attack_kind"] == "opposed_melee" and attack["outcome"]["defense_options"] == ["dodge", "fight_back", "none"]
    missing = resolve_err(seeded_kernel, f"t1-c{n}", intent="combat", goal="收手", method="", decision="combat:end")
    assert missing["code"] == "needs" and missing["details"]["needs"]["field"] == "outcome"
    ended = resolve(seeded_kernel, f"t1-c{n}", intent="combat", goal="双方僵持", method="", decision="combat:end", outcome="stalemate")
    assert ended["decision"] == "combat:end"
    assert ended["outcome"] == {**ended["outcome"], "kind": "combat", "status": "ended", "combat_outcome": "stalemate"}
    assert ended["session"]["status"] == "ended" and ended["session"]["outcome"] == "stalemate"
    assert ended["receipts"] == [f"session:combat-end-t1-c{n}"]
    assert seeded_kernel.table("look")["where"]["session"] is None
    after = resolve(seeded_kernel, f"t1-c{n + 1}", intent="investigate", goal="看清他的脸", method="用侦查")
    assert after["session"] is None  # after the ending call the session is null again
    sessions = [m for m in narrate(seeded_kernel, f"t1-c{n + 2}", "你们隔着棺材对峙。")["mechanics"] if m["kind"] == "session"]
    assert [(m["family"], m["transition"], m.get("outcome")) for m in sessions] == [("combat", "start", None),
                                                                                   ("combat", "end", "stalemate")]


# ---- flee and chase ---------------------------------------------------------------------------

def test_flee_continues_into_a_chase_that_runs_to_its_end(tmp_path):
    client = RpcClient(tmp_path / "ws", env={"COC_KERNEL_SEED": "9"})
    try:
        open_turn(client, "我转身就跑。")
        n = walk_to_confrontation(client)
        attack, defend, n = attack_and_npc_defense(client, n)
        strike = resolve(client, f"t1-c{n}", intent="combat", goal="科比特扑来", method="", actor="Walter Corbitt", target="托马斯·海斯")
        dodge = resolve(client, f"t1-c{n + 1}", intent="combat", goal="我闪开", method="", defense="dodge")
        n += 2
        assert dodge["session"]["round"] == 2 and dodge["session"]["turn_of"] == INVESTIGATOR

        before = event_count(client.workspace)
        fled = resolve(client, f"t1-c{n}", intent="flee", goal="我冲上楼梯", method="拔腿就跑")
        assert fled["decision"] == "combat:flee"
        assert fled["outcome"]["kind"] == "combat" and fled["outcome"]["status"] == "ended"
        assert fled["outcome"]["combat_outcome"] == "fled" and fled["outcome"]["continued"] == "chase:start"
        continuation = [c for c in fled["continuations"] if c["decision"] == "chase:start"][0]
        assert continuation["executed"] is True and continuation["outcome"]["kind"] == "chase"
        assert continuation["outcome"]["status"] in ("started", "ended")
        session = fled["session"]
        assert session["kind"] == "chase" and session["status"] in ("active", "ended")
        assert [p["name"] for p in session["participants"]] == [INVESTIGATOR, CORBITT]
        assert [p["side"] for p in session["participants"]] == ["quarry", "pursuer"]
        assert session["locations"][0]["label"] == "corbitt-confrontation" and session["locations"][-1]["label"] == "escape"
        assert f"session:combat-end-t1-c{n}" in fled["receipts"] and f"session:chase-start-t1-c{n}" in fled["receipts"]
        assert f"roll:con-t1-c{n}" in fled["receipts"] and f"roll:con-{CORBITT}-t1-c{n}" in fled["receipts"]
        assert events_after(client.workspace, before)[-1] == "decision-settled"
        assert read_json(save_path(client, "combat.json"))["status"] == "concluded"
        n += 1
        if session["status"] == "ended":
            assert session["outcome"] == "escaped"
            return
        assert session["turn_of"] == INVESTIGATOR and session["actions"][0] == {**session["actions"][0], "decision": "chase:move",
                                                                                 "action": "move:advance", "cost": 1}
        positions = {p["name"]: p["position"] for p in session["participants"]}
        assert positions == {INVESTIGATOR: 2, CORBITT: 0}  # cut to the chase: the quarry starts two locations ahead

        # While the chase runs, only chase decisions resolve.
        blocked = resolve_err(client, f"t1-c{n}", intent="investigate", goal="x", method="用侦查")
        assert blocked["code"] == "turn_state" and blocked["details"]["session"] == "chase"
        assert blocked["details"]["required"] == "chase:move"

        # A hazard on the road ahead (seeded into the snapshot: the module authors none here).
        chase_file = save_path(client, "chase.json")
        snapshot = read_json(chase_file)
        snapshot["location_chain"][3]["hazard"] = {"hazard_id": "rotten-stairs", "skill": "DEX", "difficulty": "regular",
                                                   "damage_dice": "1D3"}
        chase_file.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")
        look = client.table("look")["where"]["session"]
        assert look["pending_kind"] == "hazard" and look["actions"][0]["decision"] == "chase:hazard"
        assert look["actions"][0]["action"] == "hazard:rotten-stairs" and look["actions"][0]["skill"] == "DEX"
        assert [s["decision"] for s in client.table("look")["where"]["situations"]] == ["chase:hazard"]

        hazard = resolve(client, f"t1-c{n}", intent="flee", goal="冲下楼梯", method="", decision="chase:hazard")
        assert hazard["decision"] == "chase:hazard" and hazard["outcome"]["kind"] == "chase"
        taken = hazard["outcome"]["actions_taken"][0]
        assert taken["type"] == "hazard" and taken["hazard_id"] == "rotten-stairs" and taken["new_position"] == 3
        roll = receipts(client)[f"roll:dex-t1-c{n}"]
        assert roll["target"] == 60 and roll["roll_kind"] == "chase_check"  # the investigator's own DEX, not a default
        assert [e for e in hazard["effects"] if e["kind"] == "position"] == [{"kind": "position", "subject": INVESTIGATOR, "before": 2, "after": 3}]
        if not taken["passed"]:
            assert taken["damage"] >= 0 and any(e["kind"] == "hp" for e in hazard["effects"]) == (taken["damage"] > 0)
        n += 1

        # Play the chase out from session.actions until it ends.
        for _ in range(16):
            session = client.table("look")["where"]["session"]
            if session["status"] != "active":
                break
            action = session["actions"][0]
            params = {"intent": "flee", "goal": "跑", "method": "", "decision": action["decision"]}
            if session["turn_of"] != INVESTIGATOR:
                params["actor"] = session["turn_of"]
            if action["decision"] == "chase:conflict":
                params["target"] = action["targets"][0]
            step = client.table("resolve", call_id=f"t1-c{n}", action=params)
            assert step["decision"] == action["decision"]
            n += 1
            if step["outcome"]["status"] == "ended":
                assert step["outcome"]["chase_outcome"] in ("escaped", "captured")
                assert step["session"]["status"] == "ended" and step["session"]["outcome"] == step["outcome"]["chase_outcome"]
                assert f"session:chase-end-t1-c{n - 1}" in step["receipts"]
                break
        else:
            raise AssertionError("the chase did not end in 16 steps")
        final = read_json(chase_file)
        assert final["status"] == "concluded" and final["outcome"] in ("escaped", "captured")
        assert client.table("look")["where"]["session"] is None
        sessions = [(m["family"], m["transition"], m.get("outcome"))
                    for m in narrate(client, f"t1-c{n}", "脚步声在楼梯上炸响。")["mechanics"] if m["kind"] == "session"]
        assert ("combat", "end", "fled") in sessions and ("chase", "start", None) in sessions
        assert any(family == "chase" and transition == "end" and outcome in ("escaped", "captured")
                   for family, transition, outcome in sessions)
    finally:
        client.close()


def test_flee_without_a_pursuer_needs_one(kernel):
    open_turn(kernel, "我跑。")
    error = resolve_err(kernel, "t1-c1", intent="flee", goal="逃出办公室", method="夺门而出")
    assert error["code"] == "needs" and error["details"]["needs"]["field"] == "target"
    assert kernel.table("status")["receipts"] == []


# ---- sanity ----------------------------------------------------------------------------------

def test_sanity_check_bout_recovery_and_reality_check(tmp_path):
    client = RpcClient(tmp_path / "ws", env={"COC_KERNEL_SEED": "1"})
    try:
        open_turn(client, "我掀开裹尸布。")
        n = walk_to_confrontation(client)
        # Stakes that name Sanity offer the check next to the routed decision.
        offered = resolve_err(client, f"t1-c{n}", intent="investigate", goal="看清棺材里的东西", method="用侦查",
                              stakes="理智受创", target="Walter Corbitt")
        assert offered["code"] == "needs_choice"
        assert [c["name"] for c in offered["details"]["candidates"]] == ["core-check:ordinary-check", "sanity:check"]
        missing = resolve_err(client, f"t1-c{n}", intent="investigate", goal="看清棺材里的东西", method="",
                              target="Walter Corbitt", decision="sanity:check")
        assert missing["code"] == "needs" and missing["details"]["needs"]["field"] == "involuntary"
        assert "freeze" in missing["details"]["needs"]["options"]
        no_loss = resolve_err(client, f"t1-c{n}", intent="investigate", goal="血从天花板滴下来", method="",
                              decision="sanity:check", involuntary="freeze")
        assert no_loss["code"] == "needs" and no_loss["details"]["needs"]["field"] == "san_loss"

        before = event_count(client.workspace)
        checked = resolve(client, f"t1-c{n}", intent="investigate", goal="看见科比特的尸体动了", method="",
                          target="Walter Corbitt", decision="sanity:check",
                          involuntary={"kind": "freeze", "summary": "手电筒的光柱僵在原地"})
        assert checked["decision"] == "sanity:check" and checked["family"] == "sanity"
        outcome = checked["outcome"]
        assert outcome["kind"] == "sanity" and outcome["skill"] == "SAN" and outcome["target"] == 55
        # Corbitt's profile states the cost of seeing him move: 1/1D8.
        assert outcome["level"] == "failure" and outcome["passed"] is False and outcome["san_loss"] == 8
        assert (outcome["san_before"], outcome["san_after"]) == (55, 47)
        assert outcome["involuntary_action"] == {**outcome["involuntary_action"], "kind": "freeze", "summary": "手电筒的光柱僵在原地"}
        assert outcome["temporary_insane"] is True and outcome["bout_active"] is True
        assert checked["effects"] == [{"kind": "san", "subject": INVESTIGATOR, "before": 55, "after": 47}]
        assert checked["receipts"][:3] == [f"roll:san-t1-c{n}", f"roll:san-loss-t1-c{n}", f"roll:int-t1-c{n}"]
        assert f"delta:san-t1-c{n}" in checked["receipts"] and f"session:sanity_bout-start-t1-c{n}" in checked["receipts"]
        session = checked["session"]
        assert session["kind"] == "sanity_bout" and session["status"] == "active" and session["turn_of"] == INVESTIGATOR
        assert session["bout"]["rounds_remaining"] == session["bout"]["duration_rounds"] >= 1
        assert [a["decision"] for a in session["actions"]] == ["sanity:bout-tick", "sanity:bout-end"]
        pending = checked["pending_choice"]
        assert pending["for"] == "keeper" and pending["name"] == f"bout:{INVESTIGATOR}-r1"
        assert pending["options"] == ["sanity:bout-tick", "sanity:bout-end"]
        assert sheet(client)["current_san"] == 47
        snapshot = read_json(save_path(client, "sanity-state", f"{INVESTIGATOR}.json"))
        assert snapshot["bout_active"] is True and snapshot["recovery_trigger"]["handler"] == "recover_temporary_insanity"
        # slice 2: the bout's session receipt also lands a session-changed event (12.1)
        assert events_after(client.workspace, before)[-3:] == ["resource-changed", "session-changed", "decision-settled"]
        san_roll = receipts(client)[f"roll:san-t1-c{n}"]
        assert san_roll["skill_label"] == "SAN" and san_roll["roll_kind"] == "sanity_check"

        # 11.3.1: only bout decisions while the bout runs.
        blocked = resolve_err(client, f"t1-c{n + 1}", intent="investigate", goal="x", method="用侦查")
        assert blocked["code"] == "turn_state" and blocked["details"]["session"] == "sanity_bout"
        another = resolve_err(client, f"t1-c{n + 1}", intent="investigate", goal="又一具尸体", method="", decision="sanity:check",
                              san_loss="0/1D6", involuntary="cry_out")
        assert another["code"] == "turn_state"
        rounds = session["bout"]["rounds_remaining"]
        tick = resolve(client, f"t1-c{n + 1}", intent="montage", goal="x", method="", decision="sanity:bout-tick")
        assert tick["decision"] == "sanity:bout-tick" and tick["outcome"]["status"] == "bout_tick"
        assert tick["outcome"]["bout_rounds_remaining"] == rounds - 1
        if rounds - 1 > 0:
            assert tick["session"]["status"] == "active" and tick["pending_choice"]["name"] == f"bout:{INVESTIGATOR}-r2"
            end = resolve(client, f"t1-c{n + 2}", intent="montage", goal="x", method="", decision="sanity:bout-end")
        else:
            end = tick
        assert end["outcome"]["bout_active"] is False and end["session"]["status"] == "ended"
        assert end["pending_choice"] is None
        assert any(r.startswith("session:sanity_bout-end") for r in end["receipts"])
        n += 3
        assert client.table("look")["where"]["session"] is None
        situations = {s["decision"] for s in client.table("look")["where"]["situations"]}
        assert "sanity:insane-insight" in situations and "sanity:recover-temporary" not in situations

        # Temporary insanity recovers after its 1D10 hours, once the clock reaches them.
        early = resolve_err(client, f"t1-c{n}", intent="montage", goal="x", method="", decision="sanity:recover-temporary")
        assert early["code"] in ("needs", "turn_state")
        due = snapshot["recovery_trigger"]["due_elapsed_minutes"]
        client.table("apply", call_id=f"t1-c{n}", effects=[{"kind": "time", "minutes": due}])
        assert "sanity:recover-temporary" in {s["decision"] for s in client.table("look")["where"]["situations"]}
        recovered = resolve(client, f"t1-c{n + 1}", intent="montage", goal="x", method="", decision="sanity:recover-temporary")
        assert recovered["decision"] == "sanity:recover-temporary" and recovered["outcome"]["recovered"] is True
        assert recovered["outcome"]["temporary_insane"] is False
        n += 2
        state = read_json(save_path(client, "sanity-state", f"{INVESTIGATOR}.json"))
        assert state["temporary_insane"] is False and state["recovery_trigger"] is None

        # A delusion the keeper planted; the player's suspicion calls for a reality check.
        state["active_delusion"] = {"description": "科比特还在你身后", "backstory_field": None, "resistant": False}
        state["indefinite_insane"] = True
        save_path(client, "sanity-state", f"{INVESTIGATOR}.json").write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
        assert "sanity:reality-check" in {s["decision"] for s in client.table("look")["where"]["situations"]}
        reality = resolve(client, f"t1-c{n}", intent="investigate", goal="我怀疑身后根本没人", method="",
                          decision="sanity:reality-check")
        assert reality["decision"] == "sanity:reality-check" and reality["outcome"]["kind"] == "sanity"
        assert reality["outcome"]["skill"] == "SAN" and reality["outcome"]["target"] == 47
        assert reality["receipts"][0] == f"roll:san-t1-c{n}"
        state = read_json(save_path(client, "sanity-state", f"{INVESTIGATOR}.json"))
        if reality["outcome"]["delusion_cleared"]:
            assert state["active_delusion"] is None and reality["effects"] == []
        else:
            assert reality["effects"][0] == {"kind": "san", "subject": INVESTIGATOR, "before": 47, "after": 46}
            assert reality["outcome"]["bout_active"] is True  # a failed reality check opens a new bout
        n += 1
        mechanics = narrate(client, f"t1-c{n}", "你僵在原地。\n\n它坐了起来。")["mechanics"]
        san_change = next(m for m in mechanics if m["kind"] == "change" and m["resource"] == "san")
        assert san_change == {**san_change, "subject": INVESTIGATOR, "subject_label": "托马斯·海斯", "before": 55, "after": 47}
        assert san_change["receipt"].startswith("delta:san-t1-c")
        bout = next(m for m in mechanics if m["kind"] == "session" and m["family"] == "sanity_bout")
        assert bout["transition"] == "start" and bout["outcome"] and isinstance(bout["rounds"], int)
        assert any(m["kind"] == "roll" and m["skill"] == "SAN" for m in mechanics)
        assert any(m["kind"] == "dice" and m["label"] == "SAN Loss" and m["expression"] == "1D8" for m in mechanics)
    finally:
        client.close()


def test_sanity_check_with_an_explicit_loss_and_no_target(seeded_kernel):
    open_turn(seeded_kernel, "我看见地上的血。")
    checked = resolve(seeded_kernel, "t1-c1", intent="investigate", goal="血从地板缝里渗出来", method="",
                      decision="sanity:check", san_loss="0/1D3", involuntary="jump_in_fright")
    outcome = checked["outcome"]
    assert outcome["kind"] == "sanity" and outcome["target"] == 55 and outcome["san_after"] == 55 - outcome["san_loss"]
    if outcome["passed"]:
        assert outcome["san_loss"] == 0 and checked["effects"] == [] and checked["receipts"] == ["roll:san-t1-c1"]
    else:
        assert 1 <= outcome["san_loss"] <= 3 and checked["effects"][0]["kind"] == "san"
        assert outcome["involuntary_action"]["kind"] == "jump_in_fright"
    assert checked["session"] is None
    bad = resolve_err(seeded_kernel, "t1-c2", intent="investigate", goal="x", method="", decision="sanity:check",
                      san_loss="one/two", involuntary="freeze")
    assert bad["code"] == "invalid_params"


# ---- move ------------------------------------------------------------------------------------

def test_apply_move_returns_the_destination_view(kernel):
    open_turn(kernel)
    moved = kernel.table("apply", call_id="t1-c1", effects=[{"kind": "move", "to": "hall-of-records"}])
    assert moved["where"]["scene"] == "hall-of-records" and moved["where"]["session"] is None
    assert moved["where"]["situations"] == [] and "exits" in moved["where"]
    assert moved["present"] == kernel.table("look")["present"]
    assert moved["where"] == kernel.table("look")["where"]
    timed = kernel.table("apply", call_id="t1-c2", effects=[{"kind": "time", "minutes": 5}])
    assert "where" not in timed


# ---- rendering -----------------------------------------------------------------------------

def test_mechanics_projection_is_language_neutral_and_the_check_skips_keeper_rolls():
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "kernel"))
    from coc.render import mechanics

    def roll(skill, round_no, roll_value=40, target=50, actor_label=None, visibility="public", investigator=True):
        receipt = {"id": f"roll:{skill.lower()}-t1-c{round_no}", "kind": "roll", "actor": "x", "skill": skill,
                   "skill_label": skill, "target": target, "difficulty": "regular", "threshold": target,
                   "roll": roll_value, "passed": roll_value <= target, "round": round_no, "session_kind": "combat",
                   "visibility": visibility, "actor_is_investigator": investigator}
        if actor_label:
            receipt["actor_label"] = actor_label
        return receipt

    receipts = [{"id": "session:combat-start-t1-c1", "kind": "session", "family": "combat", "transition": "start"},
                roll("Handgun", 1), roll("Dodge", 1, actor_label="Walter Corbitt", investigator=False),
                {"id": "delta:hp-t1-c1", "kind": "delta", "resource": "hp", "subject": "walter-corbitt",
                 "subject_label": "Walter Corbitt", "subject_is_investigator": False, "before": 16, "after": 15},
                roll("Psychology", 2, visibility="keeper"),
                {"id": "session:sanity_bout-start-t1-c3", "kind": "session", "family": "sanity_bout", "transition": "start",
                 "outcome": "Faint", "rounds": 3, "summary": "Faint (3 rounds)"},
                {"id": "session:chase-end-t1-c4", "kind": "session", "family": "chase", "transition": "end", "outcome": "escaped"}]
    assert mechanics(receipts) == [
        {"kind": "session", "receipt": "session:combat-start-t1-c1", "family": "combat", "transition": "start"},
        {"kind": "roll", "receipt": "roll:handgun-t1-c1", "actor": "x", "actor_is_investigator": True, "skill": "Handgun", "roll": 40, "target": 50,
         "threshold": 50, "difficulty": "regular", "level": None, "passed": True, "pushed": False, "visibility": "public"},
        {"kind": "roll", "receipt": "roll:dodge-t1-c1", "actor_is_investigator": False, "skill": "Dodge", "roll": 40, "target": 50,
         "threshold": 50, "difficulty": "regular", "level": None, "passed": True, "pushed": False, "visibility": "public"},
        {"kind": "change", "receipt": "delta:hp-t1-c1", "resource": "hp", "subject_is_investigator": False, "before": 16,
         "after": 15},
        {"kind": "roll", "receipt": "roll:psychology-t1-c2", "actor": "x", "actor_is_investigator": True, "skill": "Psychology", "roll": 40, "target": 50,
         "threshold": 50, "difficulty": "regular", "level": None, "passed": True, "pushed": False, "visibility": "keeper"},
        {"kind": "session", "receipt": "session:sanity_bout-start-t1-c3", "family": "sanity_bout", "transition": "start",
         "rounds": 3, "outcome": "Faint"},
        {"kind": "session", "receipt": "session:chase-end-t1-c4", "family": "chase", "transition": "end", "outcome": "escaped"},
    ]


def test_chase_end_reads_the_schema_vocabulary_from_the_quarry_side():
    import pytest
    from coc.errors import RpcError
    from coc.sessions import chase_end_word

    assert chase_end_word(None, None, quarry_is_investigator=True) == "concluded"
    assert chase_end_word("fled", "captured", quarry_is_investigator=True) == "captured"  # the engine's verdict wins
    assert chase_end_word("fled", None, quarry_is_investigator=True) == "escaped"
    assert chase_end_word("investigators_win", None, quarry_is_investigator=True) == "escaped"
    assert chase_end_word("monsters_win", None, quarry_is_investigator=True) == "captured"
    assert chase_end_word("investigators_win", None, quarry_is_investigator=False) == "captured"
    assert chase_end_word("monsters_win", None, quarry_is_investigator=False) == "escaped"
    assert chase_end_word("stalemate", None, quarry_is_investigator=False) == "concluded"
    assert chase_end_word("captured", None, quarry_is_investigator=True) == "captured"
    with pytest.raises(RpcError) as raised:
        chase_end_word("victory", None, quarry_is_investigator=True)
    assert raised.value.code == "invalid_params"
    assert "fled" in raised.value.details["options"] and "escaped" in raised.value.details["options"]


def test_maneuver_and_nonresisting_attack_have_receipts(kernel):
    open_turn(kernel)
    n = walk_to_confrontation(kernel)
    result = resolve(kernel, f"t1-c{n}", intent="combat", decision="combat:maneuver",
                     goal="disarm", method="grip the wrist", target="Walter Corbitt", weapon="unarmed")
    assert result["decision"] == "combat:maneuver"
    assert result["receipts"]


def test_nonresisting_target_settles_in_one_attack(kernel):
    open_turn(kernel)
    n = walk_to_confrontation(kernel)
    result = resolve(kernel, f"t1-c{n}", intent="combat", goal="strike the inert body", method="shoot",
                     target="Walter Corbitt", weapon=".38 Revolver", defense="none")
    assert result["decision"] == "combat:attack"
    assert result.get("pending_choice") is None
    assert any(r.startswith("roll:") for r in result["receipts"])
