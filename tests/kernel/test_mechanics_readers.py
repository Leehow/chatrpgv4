"""RD-02: the engine reads the mechanical shapes (contract §136.12-§136.16), over the emitted kernel.

A derived haunting carries what the shipped starters do not yet: a creature with a stat block present in the
opening scene, a tome whose `mechanics.tome.spells` names a module spell, and that spell priced by
`mechanics.spell`. The creature is fought, its typed `sanity_loss` is rolled without `action.san_loss`, and the
spell is learned from the tome and cast at the stated price.
"""

import json
import shutil

from conftest import CONTENT_DIR, RpcClient, campaign_dir, open_turn, read_json
from test_rules_families import resolve, resolve_err

SOURCE = {"source_id": "pdf:call-of-cthulhu-keeper-rulebook-40th-the-haunting", "pdf_index": 452}
SPAN = "span-page-447-anchor-1"
START = "scene-commission-briefing"
HOUND = "cellar-hound"


def stated(graph, kind, slug, mechanics, name=None):
    graph["nodes"].append({"node_id": f"{kind}-{slug}", "node_kind": kind, "name": name or slug, "visibility": "keeper-only",
                           "aliases": [], "summary": f"{slug}.", "evidence_span_ids": [SPAN],
                           "properties": {"mechanics": mechanics}, "source_refs": [SOURCE]})


def hound_profile(sanity_loss):
    return {"characteristics": {"STR": 60, "CON": 50, "SIZ": 50, "DEX": 70, "POW": 40},
            "derived": {"HP": 10, "MOV": 10}, "skills": {"Fighting (Brawl)": 45, "Dodge": 35},
            "weapons": [{"weapon_id": "bite", "skill": "Fighting (Brawl)", "damage": "1D6", "uses_per_round": 1, "impale": False}],
            "sanity_loss": sanity_loss}


def derived_content(tmp_path, sanity_loss=None):
    content = tmp_path / "content"
    shutil.copytree(CONTENT_DIR, content)
    path = content / "starters" / "the-haunting" / "module-graph.json"
    graph = json.loads(path.read_text(encoding="utf-8"))
    stated(graph, "creature", HOUND, {"profile": hound_profile(sanity_loss or {"success": "0", "failure": "1D6"})}, name="Cellar hound")
    graph["relations"].append({"relation_id": "relation-rd02-hound", "relation_kind": "present-in",
                               "from_node_id": f"creature-{HOUND}", "to_node_id": START, "properties": {}})
    stated(graph, "spell", "veil-of-thorns", {"spell": {"cost_mp": 3, "cost_sanity": "1D4",
                                                        "casting_time": {"amount": 1, "unit": "round"}}}, name="Veil of Thorns")
    stated(graph, "tome", "thorn-grimoire", {"tome": {"initial_reading": {"amount": 3, "unit": "hour"},
                                                      "spells": ["spell-veil-of-thorns"]}})
    path.write_text(json.dumps(graph, ensure_ascii=False), encoding="utf-8")
    return content


def test_a_creature_with_a_stat_block_is_fought_with_the_books_numbers(tmp_path):
    client = RpcClient(tmp_path / "ws", env={"COC_KERNEL_SEED": "7"}, content=derived_content(tmp_path))
    try:
        opened = open_turn(client, "I punch the hound.")
        # Present from the book's present-in, and listed to the Keeper (§136.12).
        assert "Cellar hound" in [person["name"] for person in opened["capsule"]["present"]]
        attack = resolve(client, "t1-c1", intent="combat", goal="hit it", method="fists", target=HOUND, weapon="unarmed")
        session = attack["session"]
        assert session["kind"] == "combat" and session["status"] == "active"
        # DEX 70 from the stat block puts the hound first; its HP 10 and its own weapon are the book's.
        assert [row["actor_id"] for row in attack["outcome"]["initiative"]] == [HOUND, "thomas-hayes"]
        assert next(p for p in session["participants"] if p["name"] == HOUND)["hp_max"] == 10
        assert session["turn_of"] == HOUND and session["actions"][0]["weapons"] == ["bite"]
        snapshot = read_json(campaign_dir(client.workspace) / "save" / "combat.json")
        hound = next(p for p in snapshot["participants"] if p["actor_id"] == HOUND)
        assert (hound["combat_skill"], hound["dodge_skill"], hound["dex"]) == (45, 35, 70)
        # The book's weapon, in the engine's spelling (§136.12): impale -> impales, uses_per_round a string.
        assert hound["weapons"] == [{"weapon_id": "bite", "skill": "Fighting (Brawl)", "damage": "1D6", "uses_per_round": "1", "impales": False}]
        strike = resolve(client, "t1-c2", intent="combat", goal="it lunges", method="", actor=HOUND, target="Thomas Hayes")
        assert strike["session"]["pending_defense"]["for"] == "player"
        assert read_json(campaign_dir(client.workspace) / "save" / "combat.json")["pending_attack"]["weapon_id"] == "bite"
        resolve(client, "t1-c3", intent="combat", goal="combat:defend", method="combat:defend", actor="thomas-hayes", defense="dodge")
        swing = resolve(client, "t1-c4", intent="combat", goal="hit it", method="fists", target=HOUND, weapon="unarmed")
        pending = swing["session"]["pending_defense"]
        assert pending["for"] == "npc" and pending["actor"] == HOUND
        # The standing is computed from the stat block: Fighting (Brawl) 45 >= Dodge 35.
        assert pending["standing"] == {"defense": "fight_back", "basis": "rule-default"}
        defend = resolve(client, "t1-c5", intent="combat", goal="combat:defend", method="combat:defend", actor=HOUND,
                         defense=pending["standing"]["defense"])
        assert defend["decision"] == "combat:defend" and defend["outcome"]["defense"] == "fight_back"
        assert {"actor": HOUND, "target": 45} in [{"actor": r["actor"], "target": r["target"]} for r in defend["outcome"]["rolls"]]
    finally:
        client.close()


def sanity_check(client, call_id, **extra):
    return dict(intent="investigate", goal="the hound's face in the dark", method="looks at it",
                decision="sanity:check", target=HOUND, involuntary="flee", **extra)


def test_sanity_check_rolls_the_typed_loss_without_action_san_loss(tmp_path):
    client = RpcClient(tmp_path / "ws", env={"COC_KERNEL_SEED": "7"}, content=derived_content(tmp_path))
    try:
        open_turn(client, "I look at the hound.")
        result = resolve(client, "t1-c1", **sanity_check(client, "t1-c1"))
        assert result["decision"] == "sanity:check"
        outcome = result["outcome"]
        # Seed 7 fails the SAN roll, so the stated failure half is rolled: the book's 1D6, not a Keeper's figure.
        assert outcome["passed"] is False and 1 <= outcome["san_loss"] <= 6
        receipts = {r["id"]: r for r in read_json(campaign_dir(client.workspace) / "turn.json")["receipts"]}
        rolled = receipts["roll:san-loss-t1-c1"]
        assert rolled["expression"] == "1D6" and rolled["total"] == outcome["san_loss"]
    finally:
        client.close()


def test_an_unstated_half_is_the_keepers_to_complete(tmp_path):
    content = derived_content(tmp_path, sanity_loss={"success": "0", "failure_unstated": True})
    client = RpcClient(tmp_path / "ws", env={"COC_KERNEL_SEED": "7"}, content=content)
    try:
        open_turn(client, "I look at the hound.")
        refused = resolve_err(client, "t1-c1", **sanity_check(client, "t1-c1"))
        assert refused["code"] == "needs" and refused["details"]["needs"]["field"] == "san_loss"
        # The Keeper's own amount completes it (spec P8).
        own = resolve(client, "t1-c1", **sanity_check(client, "t1-c1", san_loss="0/1D3"))
        assert own["decision"] == "sanity:check"
    finally:
        client.close()


def test_a_spell_named_by_a_tome_is_learned_and_cast_at_its_stated_price(tmp_path):
    client = RpcClient(tmp_path / "ws", env={"COC_KERNEL_SEED": "7"}, content=derived_content(tmp_path))
    try:
        open_turn(client, "I read the grimoire.")
        for n in range(1, 40):
            learned = resolve(client, f"t1-c{n}", intent="investigate", goal="learn the Veil of Thorns", method="study the grimoire",
                              spell="Veil of Thorns", target="thorn-grimoire")
            assert learned["decision"] == "magic:learn-spell" and learned["outcome"]["source"] == "tome"
            if learned["outcome"]["status"] == "studying":
                break
            assert learned["outcome"]["status"] == "failed"
        else:
            raise AssertionError("no successful learning roll in 39 attempts")
        client.table("apply", call_id=f"t1-c{n + 1}", effects=[{"kind": "time", "minutes": learned["outcome"]["study_due_minutes"]}])
        cast = resolve(client, f"t1-c{n + 2}", intent="cast", goal="the thorns rise", method="cast", spell="Veil of Thorns")
        assert cast["decision"] == "magic:cast-spell"
        outcome = cast["outcome"]
        assert outcome["spell"] == "Veil of Thorns" and outcome["mp_spent"] == 3, outcome
        if outcome["status"] == "cast":
            assert 1 <= outcome["san_lost"] <= 4
    finally:
        client.close()
