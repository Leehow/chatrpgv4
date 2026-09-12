"""A stat block for a person the book never gave one (contract §34.10), through the RPC seam:
the combat refusal names the rulebook's archetypes; `apply npc archetype` rolls a profile inside
the archetype's ranges with the turn's dice and pins it once; combat then opens against that
person; the book's own numbers can never be replaced; and the pin is read from the world, not
from the module graph, so it survives the campaign."""

import json

from conftest import CONTENT_DIR, campaign_dir, narrate, open_turn, read_json
from test_rules_families import resolve, resolve_err, walk_to_confrontation

ARCHETYPES = {a["archetype_id"]: a for a in json.loads(
    (CONTENT_DIR / "rulesets" / "coc7" / "rules-json" / "npc-stat-archetypes.json").read_text(encoding="utf-8"))["archetypes"]}
DERIVED = json.loads((CONTENT_DIR / "rulesets" / "coc7" / "rules-json" / "derived-attributes.json").read_text(encoding="utf-8"))


def attack_knott(client, call_id, **extra):
    return resolve_err(client, call_id, intent="combat", goal="打诺特", method="挥拳", actor="Thomas Hayes", target="Steven Knott", **extra)


def test_the_refusal_offers_the_rulebook_archetypes_and_the_source_read(kernel):
    open_turn(kernel, "我想把你打一顿")
    error = attack_knott(kernel, "t1-c1")
    assert error["code"] == "needs" and "no stat block" in error["message"]
    needs = error["details"]["needs"]
    assert needs["field"] == "archetype"
    assert needs["options"] == list(ARCHETYPES)  # the table's order, read the way the kernel reads it
    assert needs["fightable"] == []  # nobody on this stage has numbers
    fix = error["fix"]
    assert "apply npc with archetype" in fix and "lookup kind=source" in fix
    assert "Nothing without a receipt has happened" in fix
    assert "catalog" not in fix and "without dice" not in fix


def test_a_pinned_archetype_rolls_inside_its_ranges_and_derives_the_rest(seeded_kernel):
    open_turn(seeded_kernel, "我想把你打一顿")
    result = seeded_kernel.table("apply", call_id="t1-c1", effects=[{"kind": "npc", "name": "Steven Knott", "archetype": "ordinary_adult", "why": "房东，没打过架"}])
    receipt = next(r for r in seeded_kernel.table("status")["receipts"] if r["kind"] == "npc")
    profile = receipt["profile"]
    assert profile["archetype"] == "ordinary_adult"
    spec = ARCHETYPES["ordinary_adult"]
    for key, (lo, hi) in spec["characteristics"].items():
        assert lo <= profile["characteristics"][key] <= hi, key
    for key, (lo, hi) in spec["skills"].items():
        assert lo <= profile["skills"][key] <= hi, key
    c = profile["characteristics"]
    assert profile["derived"]["HP"] == (c["CON"] + c["SIZ"]) // DERIVED["hit_points"]["divisor"]
    assert profile["derived"]["MP"] == c["POW"] // DERIVED["magic_points"]["divisor"]
    assert profile["derived"]["SAN"] == c["POW"]
    assert profile["derived"]["MOV"] in (7, 8, 9)
    assert "DB" in profile["derived"] and "Build" in profile["derived"]
    world = read_json(campaign_dir(seeded_kernel.workspace) / "world.json")
    pinned = world["npc_profiles"]["steven-knott"]
    assert pinned["authority"] == "table_pinned" and pinned["why"] == "房东，没打过架" and pinned["pinned_turn"] == 1
    assert pinned["characteristics"] == c and pinned["weapons"] == []


def test_the_same_seed_rolls_the_same_profile(tmp_path):
    from conftest import RpcClient
    rolled = []
    for n in range(2):
        client = RpcClient(tmp_path / f"ws{n}", env={"COC_KERNEL_SEED": "7"})
        try:
            open_turn(client, "我想把你打一顿")
            client.table("apply", call_id="t1-c1", effects=[{"kind": "npc", "name": "Steven Knott", "archetype": "capable_adult"}])
            rolled.append(read_json(campaign_dir(client.workspace) / "world.json")["npc_profiles"]["steven-knott"]["characteristics"])
        finally:
            client.close()
    assert rolled[0] == rolled[1]


def test_combat_opens_against_the_pinned_person(seeded_kernel):
    open_turn(seeded_kernel, "我想把你打一顿")
    seeded_kernel.table("apply", call_id="t1-c1", effects=[{"kind": "npc", "name": "Steven Knott", "archetype": "ordinary_adult", "why": "房东"}])
    attack = resolve(seeded_kernel, "t1-c2", intent="combat", goal="打诺特", method="挥拳", actor="Thomas Hayes", target="Steven Knott", weapon="unarmed")
    assert attack["decision"].startswith("combat:")
    kinds = {r["kind"] for r in seeded_kernel.table("status")["receipts"]}
    assert "session" in kinds  # combat opened; the blow itself is rolled when the round reaches the actor
    started = [r for r in seeded_kernel.table("status")["receipts"] if r["kind"] == "session" and r.get("transition") == "start"]
    assert started and started[0]["family"] == "combat"
    # the pinned skills are what the person fights and dodges with
    labels = seeded_kernel.table("look", focus="npc", name="Steven Knott")
    assert labels  # the full keeper view still answers for a pinned person


def test_the_pin_is_made_once_and_survives_turns(seeded_kernel):
    open_turn(seeded_kernel, "我想把你打一顿")
    seeded_kernel.table("apply", call_id="t1-c1", effects=[{"kind": "npc", "name": "Steven Knott", "archetype": "ordinary_adult"}])
    again = seeded_kernel.table_err("apply", call_id="t1-c2", effects=[{"kind": "npc", "name": "Steven Knott", "archetype": "dangerous_actor"}])
    assert again["code"] == "invalid_params" and "already has a pinned ordinary_adult profile" in again["message"]
    narrate(seeded_kernel, "t1-c3", "诺特往后一缩。")
    seeded_kernel.table("player_input", text="我再打。")
    attack = resolve(seeded_kernel, "t2-c1", intent="combat", goal="打诺特", method="挥拳", actor="Thomas Hayes", target="Steven Knott", weapon="unarmed")
    assert attack["decision"].startswith("combat:")


def test_an_unknown_archetype_is_refused_with_the_options(kernel):
    open_turn(kernel, "我想把你打一顿")
    error = kernel.table_err("apply", call_id="t1-c1", effects=[{"kind": "npc", "name": "Steven Knott", "archetype": "boxer"}])
    assert error["code"] == "invalid_params"
    assert error["details"]["options"] == list(ARCHETYPES)
    assert "ordinary_adult" in error["fix"]


def test_the_books_numbers_cannot_be_replaced_by_an_archetype(kernel):
    open_turn(kernel, "我打量四周。")
    walk_to_confrontation(kernel)
    error = kernel.table_err("apply", call_id="t1-c9", effects=[{"kind": "npc", "name": "Walter Corbitt", "archetype": "dangerous_actor"}])
    assert error["code"] == "invalid_params"
    assert "prints Walter Corbitt's numbers" in error["message"]
    assert error["details"]["authority"] == "source_authored"
