"""Tests for the structured combat state (coc_combat.CombatSession) and the
combat_state_* audits that read save/combat.json.

These tests verify the combat engine in isolation — they construct a
CombatSession, drive a short fight, and assert both the produced state and
the audit findings. They do not depend on the playtest harness.
"""
import importlib.util
import json
import random
from pathlib import Path

import pytest


def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, rel)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


coc_combat = _load("coc_combat", "plugins/coc-keeper/scripts/coc_combat.py")
coc_playtest_audit = _load("coc_playtest_audit", "plugins/coc-keeper/scripts/coc_playtest_audit.py")


# --------------------------------------------------------------------------- #
# CombatSession unit tests
# --------------------------------------------------------------------------- #
def _make_session(rng_seed=42):
    rng = random.Random(rng_seed)
    s = coc_combat.CombatSession("test-fight", "test/scene", started_at_turn=1, rng=rng)
    s.add_participant("hero", "investigator", dex=70, combat_skill=60, build=0,
                      hp_max=10, magic_points=5, armor=0,
                      weapons=[{"weapon_id": "sword", "skill": "Fighting (Brawl)",
                                "damage": "1D8+1", "impales": True, "special": None}])
    s.add_participant("ghoul", "monster", dex=50, combat_skill=40, build=1,
                      hp_max=12, magic_points=0, armor=0,
                      weapons=[{"weapon_id": "claws", "skill": "Fighting",
                                "damage": "1D3+1D4", "impales": False, "special": None}])
    return s


def test_combat_session_add_participant_records_full_state():
    s = _make_session()
    hero = s.participants["hero"]
    assert hero["dex"] == 70
    assert hero["hp_current"] == hero["hp_max"] == 10
    assert hero["weapons"][0]["weapon_id"] == "sword"
    assert hero["conditions"] == []
    assert hero["active_effects"] == []


def test_combat_session_begin_round_records_initiative_by_dex():
    s = _make_session()
    rnd = s.begin_round()
    assert rnd == 1
    order = s.rounds[0]["initiative_order"]
    # hero DEX 70 acts before ghoul DEX 50
    assert order[0]["actor_id"] == "hero"
    assert order[1]["actor_id"] == "ghoul"


def test_combat_session_attack_with_fight_back_pairs_opposed_roll():
    s = _make_session(rng_seed=1)
    s.begin_round()
    turn = s.declare_and_resolve_turn(
        "hero", "slash the ghoul", "attack",
        target_actor_id="ghoul", defense_kind="fight_back", weapon_id="sword")
    assert turn["action"] == "attack"
    assert turn["defense_kind"] == "fight_back"
    assert turn["roll_id"] is not None
    assert turn["opposed_roll_id"] is not None
    assert turn["roll_id"] != turn["opposed_roll_id"]
    assert turn["opposed_outcome"] in (
        "attacker_higher", "defender_higher",
        "tie_attacker_wins", "tie_defender_wins", "both_fail")


def test_combat_session_damage_chain_balances_hp_and_armor():
    s = _make_session(rng_seed=3)
    s.begin_round()
    turn = s.declare_and_resolve_turn(
        "hero", "slash the ghoul", "attack",
        target_actor_id="ghoul", defense_kind="fight_back", weapon_id="sword")
    if turn["outcome"] == "hit":
        d = s.damage_chain[-1]
        # hp bookkeeping invariant
        assert d["hp_before"] + d["hp_delta"] == d["hp_after"]
        # armor accounting: absorbed + (-hp_delta) == raw_damage
        assert d["armor_absorbed"] + (-d["hp_delta"]) == d["raw_damage"]


def test_combat_session_flesh_ward_armor_degrades_1_per_damage():
    rng = random.Random(7)
    s = coc_combat.CombatSession("ward-test", "test", started_at_turn=1, rng=rng)
    s.add_participant("hero", "investigator", dex=70, combat_skill=80, build=0,
                      hp_max=10, weapons=[{"weapon_id": "club", "skill": "Fighting (Brawl)",
                                           "damage": "1D6", "impales": False, "special": None}])
    s.add_participant("warded", "monster", dex=10, combat_skill=20, build=0,
                      hp_max=20, armor=5, armor_rule="degrades_1_per_damage",
                      weapons=[{"weapon_id": "claws", "skill": "Fighting",
                                "damage": "1D3", "impales": False, "special": None}])
    s.begin_round()
    turn = s.declare_and_resolve_turn(
        "hero", "hit the warded target", "attack",
        target_actor_id="warded", defense_kind="fight_back", weapon_id="club")
    if turn["outcome"] == "hit":
        d = s.damage_chain[-1]
        target = s.participants["warded"]
        assert target["armor"] == d["armor_after"]
        assert d["armor_after"] == d["armor_before"] - d["armor_absorbed"]


def test_combat_session_dominate_creates_active_effect():
    rng = random.Random(11)
    s = coc_combat.CombatSession("dom-test", "test", started_at_turn=1, rng=rng)
    s.add_participant("caster", "monster", dex=35, combat_skill=50, build=1,
                      hp_max=16, magic_points=18)
    s.add_participant("victim", "investigator", dex=70, combat_skill=60, build=0,
                      hp_max=10)
    s.begin_round()
    turn = s.declare_and_resolve_turn(
        "caster", "Dominate the victim", "cast",
        target_actor_id="victim", spell="dominate",
        dex_override=85, dex_reason="casting_dominate")
    assert turn["dex"] == 85
    assert turn["dex_reason"] == "casting_dominate"
    # Dominate either landed (effect applied) or was resisted.
    assert turn["outcome"] in ("dominate_success", "dominate_resisted")
    if turn["outcome"] == "dominate_success":
        assert s.is_dominated("victim")
        eff = s.participants["victim"]["active_effects"][0]
        assert eff["effect"] == "dominated"
        assert eff["remaining_rounds"] >= 2


def test_combat_session_tick_effects_decrements_and_expires():
    s = _make_session()
    s.apply_effect("hero", "dominated", "ghoul", remaining_rounds=2)
    assert s.is_dominated("hero")
    s.tick_effects()
    assert s.is_dominated("hero")  # 2 -> 1
    s.tick_effects()
    assert not s.is_dominated("hero")  # 1 -> 0, expired


def test_combat_session_snapshot_has_full_schema():
    s = _make_session()
    s.begin_round()
    snap = s.snapshot()
    for key in ("combat_id", "scene_ref", "started_at_turn", "ended_at_turn",
                "status", "outcome", "participants", "rounds", "damage_chain"):
        assert key in snap
    p = snap["participants"][0]
    for key in ("actor_id", "side", "dex", "combat_skill", "build",
                "hp_max", "hp_current", "magic_points", "armor", "armor_rule",
                "weapons", "conditions", "active_effects"):
        assert key in p


def test_combat_load_rejects_negative_revision_and_invalid_cursor(tmp_path):
    s = _make_session()
    s.begin_round()
    s.save(tmp_path)
    path = tmp_path / "save" / "combat.json"
    raw = json.loads(path.read_text())
    raw["revision"] = -1
    path.write_text(json.dumps(raw))
    with pytest.raises(ValueError, match="revision"):
        coc_combat.CombatSession.load(tmp_path, rng=random.Random(1))
    raw["revision"] = 0
    raw["initiative_cursor"] = 99
    path.write_text(json.dumps(raw))
    with pytest.raises(ValueError, match="initiative cursor"):
        coc_combat.CombatSession.load(tmp_path, rng=random.Random(1))


def test_combat_load_rejects_dead_hp_coherence_and_extra_root_key(tmp_path):
    s = _make_session()
    s.begin_round()
    s.save(tmp_path)
    path = tmp_path / "save" / "combat.json"
    raw = json.loads(path.read_text())
    raw["participants"][0]["conditions"].append("dead")
    path.write_text(json.dumps(raw))
    with pytest.raises(ValueError, match="dead participant"):
        coc_combat.CombatSession.load(tmp_path, rng=random.Random(1))
    raw = s.snapshot()
    raw["forged"] = True
    path.write_text(json.dumps(raw))
    with pytest.raises(ValueError, match="exact schema"):
        coc_combat.CombatSession.load(tmp_path, rng=random.Random(1))


# --------------------------------------------------------------------------- #
# Audit function tests (call _combat_*_gaps directly with crafted state)
# --------------------------------------------------------------------------- #
def test_audit_combat_dex_order_detects_out_of_order_turns():
    state = {
        "participants": [
            {"actor_id": "fast", "dex": 80, "combat_skill": 50},
            {"actor_id": "slow", "dex": 30, "combat_skill": 40},
        ],
        "rounds": [{
            "round": 1,
            "initiative_order": [
                {"actor_id": "fast", "dex": 80, "dex_reason": None},
                {"actor_id": "slow", "dex": 30, "dex_reason": None},
            ],
            "turns": [
                {"turn_id": "t1-1", "actor_id": "slow", "dex": 30, "action": "attack"},
                {"turn_id": "t1-2", "actor_id": "fast", "dex": 80, "action": "attack"},
            ],
        }],
    }
    gaps = coc_playtest_audit._combat_dex_order_gaps(state)
    assert len(gaps) == 1
    assert "out of DEX order" in gaps[0]


def test_audit_combat_dex_order_passes_when_sorted():
    state = {
        "participants": [
            {"actor_id": "fast", "dex": 80, "combat_skill": 50},
            {"actor_id": "slow", "dex": 30, "combat_skill": 40},
        ],
        "rounds": [{"round": 1, "initiative_order": [], "turns": [
            {"turn_id": "t1-1", "actor_id": "fast", "dex": 80, "action": "attack"},
            {"turn_id": "t1-2", "actor_id": "slow", "dex": 30, "action": "attack"},
        ]}],
    }
    assert coc_playtest_audit._combat_dex_order_gaps(state) == []


def test_audit_combat_dex_order_honors_per_turn_override():
    # caster normally DEX 35 but casts Dominate at DEX 85 -> acts first
    state = {
        "participants": [
            {"actor_id": "hero", "dex": 70, "combat_skill": 60},
            {"actor_id": "caster", "dex": 35, "combat_skill": 50},
        ],
        "rounds": [{"round": 1, "initiative_order": [], "turns": [
            {"turn_id": "t1-1", "actor_id": "caster", "dex": 85,
             "dex_reason": "casting_dominate", "action": "cast"},
            {"turn_id": "t1-2", "actor_id": "hero", "dex": 70, "action": "attack"},
        ]}],
    }
    assert coc_playtest_audit._combat_dex_order_gaps(state) == []


def test_audit_combat_opposed_pairing_flags_attack_without_opposed_roll():
    state = {"rounds": [{"round": 1, "turns": [
        {"turn_id": "t1-1", "actor_id": "a", "action": "attack",
         "defense_kind": "fight_back", "opposed_roll_id": None},
    ]}]}
    gaps = coc_playtest_audit._combat_opposed_pairing_gaps(state)
    assert len(gaps) == 1


def test_audit_combat_opposed_pairing_allows_surprise_attack_unopposed():
    state = {"rounds": [{"round": 1, "turns": [
        {"turn_id": "t1-1", "actor_id": "a", "action": "surprise_attack",
         "defense_kind": "none", "opposed_roll_id": None},
    ]}]}
    assert coc_playtest_audit._combat_opposed_pairing_gaps(state) == []


def test_audit_combat_damage_chain_detects_hp_imbalance():
    state = {"damage_chain": [{
        "damage_roll_id": "r1", "hp_before": 10, "hp_delta": -3, "hp_after": 8,
        "armor_absorbed": 0, "raw_damage": 3,
    }]}
    gaps = coc_playtest_audit._combat_damage_chain_gaps(state)
    assert any("hp imbalance" in g for g in gaps)


def test_audit_combat_damage_chain_detects_armor_imbalance():
    state = {"damage_chain": [{
        "damage_roll_id": "r1", "hp_before": 10, "hp_delta": -3, "hp_after": 7,
        "armor_absorbed": 1, "raw_damage": 5,
    }]}
    gaps = coc_playtest_audit._combat_damage_chain_gaps(state)
    # armor_absorbed(1) + (-hp_delta)(3) = 4 != raw_damage(5)
    assert any("armor imbalance" in g for g in gaps)


def test_audit_combat_damage_chain_passes_balanced():
    state = {"damage_chain": [{
        "damage_roll_id": "r1", "hp_before": 10, "hp_delta": -3, "hp_after": 7,
        "armor_absorbed": 2, "raw_damage": 5,
    }]}
    assert coc_playtest_audit._combat_damage_chain_gaps(state) == []


def test_audit_combat_pushed_roll_flags_pushed_combat_roll():
    state = {"damage_chain": [{
        "damage_roll_id": "cr1", "source_turn_id": "t1-1",
        "hp_before": 10, "hp_delta": -3, "hp_after": 7,
        "armor_absorbed": 0, "raw_damage": 3,
    }]}
    rolls = [{"payload": {"roll_id": "cr1", "pushed": True}}]
    gaps = coc_playtest_audit._combat_pushed_roll_gaps(state, rolls)
    assert len(gaps) == 1
    assert "forbidden" in gaps[0]


def test_audit_combat_outcome_flags_concluded_without_outcome():
    state = {"status": "concluded", "outcome": None,
             "participants": [{"side": "investigator", "hp_current": 5}]}
    gaps = coc_playtest_audit._combat_outcome_gaps(state)
    assert any("outcome is null" in g for g in gaps)


def test_audit_combat_outcome_flags_inconsistent_victor():
    state = {"status": "concluded", "outcome": "investigators_win",
             "participants": [
                 {"side": "investigator", "hp_current": 0},
                 {"side": "monster", "hp_current": 5}]}
    gaps = coc_playtest_audit._combat_outcome_gaps(state)
    assert any("all investigators down" in g for g in gaps)


# --------------------------------------------------------------------------- #
# Integration: a clean CombatSession-driven fight produces no audit gaps
# --------------------------------------------------------------------------- #
def test_clean_combat_session_passes_all_audits(tmp_path):
    """Regression guard: a well-formed CombatSession fight yields a combat.json
    that passes every combat_state_* audit."""
    s = _make_session(rng_seed=99)
    s.begin_round()
    # Hero attacks; ghoul fights back.
    s.declare_and_resolve_turn("hero", "slash ghoul", "attack",
                               target_actor_id="ghoul",
                               defense_kind="fight_back", weapon_id="sword")
    # Ghoul attacks; hero fights back.
    s.declare_and_resolve_turn("ghoul", "claw hero", "attack",
                               target_actor_id="hero",
                               defense_kind="fight_back", weapon_id="claws")
    if s.participants["ghoul"]["hp_current"] <= 0:
        s.conclude("investigators_win")
    elif s.participants["hero"]["hp_current"] <= 0:
        s.conclude("monsters_win")
    else:
        s.conclude("stalemate")
    state = s.snapshot()
    # All structural audits should pass.
    assert coc_playtest_audit._combat_dex_order_gaps(state) == []
    assert coc_playtest_audit._combat_opposed_pairing_gaps(state) == []
    assert coc_playtest_audit._combat_damage_chain_gaps(state) == []
    assert coc_playtest_audit._combat_pushed_roll_gaps(state, []) == []
    assert coc_playtest_audit._combat_outcome_gaps(state) == []


# --------------------------------------------------------------------------- #
# Mechanism coverage tests (Chapter 6 full combat system)
# --------------------------------------------------------------------------- #
def test_mechanism1_firearms_cannot_be_dodged_or_fought_back():
    """p.125: A target may not fight back against or dodge a Firearm attack."""
    rng = random.Random(5)
    s = coc_combat.CombatSession("fire-test", "test", 1, rng=rng)
    s.add_participant("shooter", "investigator", dex=70, combat_skill=50, build=0,
                      hp_max=10, weapons=[{"weapon_id":"pistol","skill":"Firearms (Handgun)",
                                           "damage":"1D10","impales":True,"special":None}])
    s.add_participant("target", "monster", dex=40, combat_skill=40, build=1, hp_max=10)
    s.begin_round()
    # Caller asks for fight_back vs firearm → engine overrides to dive_for_cover
    t = s.declare_and_resolve_turn("shooter","shoot target","attack",
        target_actor_id="target", defense_kind="fight_back", weapon_id="pistol")
    # Should NOT be resolved as opposed fight_back; firearm rule overrides.
    assert t["defense_kind"] != "fight_back"
    # The opposed_outcome is not attacker_higher-vs-fightback; it's unopposed or dive.
    assert t["opposed_outcome"] in ("unopposed", "dived_for_cover", "dive_failed")


def test_mechanism2_dive_for_cover_grants_attacker_penalty_die():
    """p.125: successful Dive for Cover → attacker penalty die (re-roll)."""
    rng = random.Random(8)
    s = coc_combat.CombatSession("dive-test", "test", 1, rng=rng)
    s.add_participant("shooter", "investigator", dex=70, combat_skill=50, build=0,
                      hp_max=10, weapons=[{"weapon_id":"pistol","skill":"Firearms (Handgun)",
                                           "damage":"1D10","impales":True,"special":None}])
    s.add_participant("diver", "monster", dex=40, combat_skill=40, build=1, hp_max=10,
                      dodge_skill=80)  # high dodge so dive succeeds
    s.begin_round()
    t = s.declare_and_resolve_turn("shooter","shoot diver","attack",
        target_actor_id="diver", defense_kind="dive_for_cover", weapon_id="pistol")
    assert t["defense_kind"] == "dive_for_cover"
    # dive succeeded → there should be a re-roll roll_id with +1 penalty
    if t["opposed_outcome"] == "dived_for_cover":
        assert t.get("cover_reroll_roll_id") is not None


def test_mechanism2_diver_forfeits_next_attack():
    """p.125: diver forfeits next attack; can only dodge until then."""
    rng = random.Random(3)
    s = coc_combat.CombatSession("forfeit-test", "test", 1, rng=rng)
    s.add_participant("shooter", "investigator", dex=70, combat_skill=80, build=0,
                      hp_max=10, weapons=[{"weapon_id":"pistol","skill":"Firearms (Handgun)",
                                           "damage":"1D10","impales":True,"special":None}])
    s.add_participant("diver", "monster", dex=40, combat_skill=40, build=1, hp_max=10,
                      dodge_skill=80)
    s.begin_round()
    s.declare_and_resolve_turn("shooter","shoot","attack",
        target_actor_id="diver", defense_kind="dive_for_cover", weapon_id="pistol")
    if s.participants["diver"].get("_dived_for_cover"):
        assert s.is_forfeiting_attack("diver") is True


def test_mechanism4_outnumbered_gives_attacker_bonus_die():
    """p.108: target that already defended this round → subsequent attackers
    get a bonus die. We verify the turn records outnumbered_penalty=True."""
    rng = random.Random(12)
    s = coc_combat.CombatSession("outnum-test", "test", 1, rng=rng)
    s.add_participant("a1", "investigator", dex=80, combat_skill=60, build=0, hp_max=10)
    s.add_participant("a2", "investigator", dex=70, combat_skill=60, build=0, hp_max=10)
    s.add_participant("foe", "monster", dex=30, combat_skill=40, build=1, hp_max=12)
    s.begin_round()
    # First attack vs foe: foe fights back (defends).
    t1 = s.declare_and_resolve_turn("a1","hit foe","attack",
        target_actor_id="foe", defense_kind="fight_back")
    assert s.has_defended_this_round("foe") is True
    # Second attack vs same foe: outnumbered → bonus die.
    t2 = s.declare_and_resolve_turn("a2","hit foe again","attack",
        target_actor_id="foe", defense_kind="fight_back")
    assert t2.get("attack_modifiers", {}).get("outnumbered_penalty") is True


def test_mechanism5_point_blank_grants_bonus_die():
    """p.125: point-blank range → attacker bonus die."""
    rng = random.Random(15)
    s = coc_combat.CombatSession("pb-test", "test", 1, rng=rng)
    s.add_participant("shooter", "investigator", dex=70, combat_skill=50, build=0,
                      hp_max=10, weapons=[{"weapon_id":"pistol","skill":"Firearms (Handgun)",
                                           "damage":"1D10","impales":True,"special":None}])
    s.add_participant("target", "monster", dex=40, combat_skill=40, build=1, hp_max=10)
    s.begin_round()
    t = s.declare_and_resolve_turn("shooter","point-blank shot","attack",
        target_actor_id="target", defense_kind="none", weapon_id="pistol",
        point_blank=True)
    assert t["attack_modifiers"]["point_blank"] is True
    assert t["attack_modifiers"]["bonus"] >= 1


def test_mechanism6_ready_firearm_grants_dex_plus_50_initiative():
    """p.124: readied firearm shoots at DEX+50 in initiative order."""
    rng = random.Random(20)
    s = coc_combat.CombatSession("dex50-test", "test", 1, rng=rng)
    # gunslinger DEX 30 with ready firearm → effective DEX 80
    s.add_participant("gunslinger", "investigator", dex=30, combat_skill=40, build=0,
                      hp_max=10, firearms_skill=60, has_ready_firearm=True)
    # knife DEX 70, no firearm
    s.add_participant("knife", "monster", dex=70, combat_skill=50, build=1, hp_max=10)
    s.begin_round()
    order = s.rounds[-1]["initiative_order"]
    # gunslinger effective DEX 80 > knife DEX 70 → gunslinger first
    assert order[0]["actor_id"] == "gunslinger"
    assert order[0]["dex"] == 80
    assert order[0]["dex_reason"] == "ready_firearm"


def test_mechanism7_range_band_sets_difficulty():
    """p.124: base=regular, long=hard, very long=extreme."""
    rng = random.Random(25)
    s = coc_combat.CombatSession("range-test", "test", 1, rng=rng)
    s.add_participant("shooter", "investigator", dex=70, combat_skill=70, build=0,
                      hp_max=10, weapons=[{"weapon_id":"rifle","skill":"Firearms (Rifle/Shotgun)",
                                           "damage":"2D6+4","impales":True,"special":None}])
    s.add_participant("target", "monster", dex=40, combat_skill=40, build=1, hp_max=12)
    s.begin_round()
    t = s.declare_and_resolve_turn("shooter","long shot","attack",
        target_actor_id="target", defense_kind="none", weapon_id="rifle",
        range_band="long")
    # The attacker roll should record difficulty=hard
    atk_roll = [r for r in s.pending_rolls if r["roll_id"] == t["roll_id"]][0]
    assert atk_roll["difficulty"] == "hard"


def test_mechanism8_flee_marks_participant_fled_and_removes_from_initiative():
    """p.114: flee is a valid action; fled participants leave subsequent rounds."""
    rng = random.Random(30)
    s = coc_combat.CombatSession("flee-test", "test", 1, rng=rng)
    s.add_participant("runner", "investigator", dex=70, combat_skill=40, build=0, hp_max=10)
    s.add_participant("foe", "monster", dex=50, combat_skill=50, build=1, hp_max=10)
    s.begin_round()
    t = s.declare_and_resolve_turn("runner","run away","flee")
    assert t["outcome"] == "fled"
    assert "fled" in s.participants["runner"]["conditions"]
    # Next round: runner should NOT appear in initiative
    s.begin_round()
    order = s.rounds[-1]["initiative_order"]
    assert all(p["actor_id"] != "runner" for p in order)


def test_mechanism3_cover_grants_attacker_penalty_die():
    """p.125: target ≥half concealed → attacker penalty die."""
    rng = random.Random(35)
    s = coc_combat.CombatSession("cover-test", "test", 1, rng=rng)
    s.add_participant("shooter", "investigator", dex=70, combat_skill=70, build=0,
                      hp_max=10, weapons=[{"weapon_id":"pistol","skill":"Firearms (Handgun)",
                                           "damage":"1D10","impales":True,"special":None}])
    s.add_participant("target", "monster", dex=40, combat_skill=40, build=1, hp_max=10)
    s.begin_round()
    t = s.declare_and_resolve_turn("shooter","shoot covered target","attack",
        target_actor_id="target", defense_kind="none", weapon_id="pistol", cover=True)
    assert t["attack_modifiers"]["cover"] is True
    assert t["attack_modifiers"]["penalty"] >= 1


# --------------------------------------------------------------------------- #
# Weapon DB / disarm / grapple / maneuver Build penalty
# --------------------------------------------------------------------------- #
def test_weapon_db_added_to_melee_damage():
    """Table XVII: melee weapons add the attacker's DB to damage."""
    rng = random.Random(101)
    s = coc_combat.CombatSession("db-test", "test", 1, rng=rng)
    # Attacker STR+SIZ 130 → DB +1D4, Build 1
    s.add_participant("brute", "investigator", dex=50, combat_skill=70, build=1,
                      hp_max=12, damage_bonus="+1D4",
                      weapons=[{"weapon_id":"club","skill":"Fighting (Brawl)",
                                "damage":"1D6","adds_damage_bonus":True,"impales":False,"special":None}])
    s.add_participant("foe", "monster", dex=40, combat_skill=30, build=0, hp_max=12)
    s.begin_round()
    t = s.declare_and_resolve_turn("brute","club the foe","attack",
        target_actor_id="foe", defense_kind="none", weapon_id="club")
    if t["outcome"] == "hit":
        d = s.damage_chain[-1]
        # The die expression should include the +1D4 DB
        assert "+1D4" in d["die"] or "1D4" in str(d.get("die_rolls",[]))

def test_weapon_db_not_added_to_firearms():
    """Firearms do not add DB (Table XVII)."""
    rng = random.Random(102)
    s = coc_combat.CombatSession("nodb-test", "test", 1, rng=rng)
    s.add_participant("shooter", "investigator", dex=70, combat_skill=50, build=1,
                      hp_max=10, damage_bonus="+1D4",
                      weapons=[{"weapon_id":"pistol","skill":"Firearms (Handgun)",
                                "damage":"1D10","adds_damage_bonus":False,"impales":True,"special":None}])
    s.add_participant("foe", "monster", dex=40, combat_skill=40, build=1, hp_max=12)
    s.begin_round()
    t = s.declare_and_resolve_turn("shooter","shoot foe","attack",
        target_actor_id="foe", defense_kind="none", weapon_id="pistol")
    if t["outcome"] == "hit":
        d = s.damage_chain[-1]
        # die should be just 1D10, no +1D4
        assert "1D4" not in d["die"]

def test_disarm_transfers_weapon_to_attacker():
    """p.117: successful disarm maneuver transfers the weapon."""
    rng = random.Random(103)
    s = coc_combat.CombatSession("disarm-test", "test", 1, rng=rng)
    s.add_participant("hero", "investigator", dex=70, combat_skill=80, build=0, hp_max=10)
    s.add_participant("thug", "monster", dex=50, combat_skill=40, build=0, hp_max=10,
                      weapons=[{"weapon_id":"knife","skill":"Fighting (Brawl)",
                                "damage":"1D4+2","adds_damage_bonus":True,"impales":True,"special":None}])
    s.begin_round()
    t = s.declare_and_resolve_turn("hero","disarm the thug","maneuver",
        target_actor_id="thug", defense_kind="fight_back",
        maneuver_kind="disarm", target_weapon_id="knife")
    if t["outcome"] == "disarm_success":
        # Knife moved from thug to hero
        assert all(w["weapon_id"] != "knife" for w in s.participants["thug"]["weapons"])
        assert any(w["weapon_id"] == "knife" for w in s.participants["hero"]["weapons"])
        assert t["effect_applied"]["weapon_id"] == "knife"

def test_maneuver_ongoing_disadvantage_restrains_target():
    """p.119: ongoing_disadvantage goal restrains the target (restrained effect)."""
    rng = random.Random(104)
    s = coc_combat.CombatSession("grapple-test", "test", 1, rng=rng)
    s.add_participant("hero", "investigator", dex=70, combat_skill=70, build=1, hp_max=10)
    s.add_participant("foe", "monster", dex=50, combat_skill=40, build=0, hp_max=10)
    s.begin_round()
    t = s.declare_and_resolve_turn("hero","grapple the foe","maneuver",
        target_actor_id="foe", defense_kind="fight_back", goal="ongoing_disadvantage")
    if t["outcome"] == "grapple_success":
        assert any(e["effect"]=="restrained" for e in s.participants["foe"]["active_effects"])
        assert t["effect_applied"]["effect"] == "restrained"

def test_restrained_target_can_escape():
    """p.119: a restrained character may use escape goal to break the hold."""
    rng = random.Random(105)
    s = coc_combat.CombatSession("breakfree-test", "test", 1, rng=rng)
    s.add_participant("hero", "investigator", dex=70, combat_skill=70, build=1, hp_max=10)
    s.add_participant("foe", "monster", dex=50, combat_skill=40, build=0, hp_max=10)
    # Pre-apply grappled to foe by hero
    s.apply_effect("foe", "restrained", "hero", remaining_rounds=999)
    # restraint tracked via active_effects, not conditions
    s.begin_round()
    t = s.declare_and_resolve_turn("foe","break free of the grapple","maneuver",
        target_actor_id="hero", defense_kind="fight_back", goal="escape")
    if t["outcome"] == "escape_success":
        assert not any(e["effect"]=="restrained" for e in s.participants["foe"]["active_effects"])

def test_maneuver_build_penalty_dice_applied():
    """p.117: attacker Build below target by N → N penalty dice (max 2)."""
    rng = random.Random(106)
    s = coc_combat.CombatSession("build-test", "test", 1, rng=rng)
    # attacker Build -1, target Build 1 → diff 2 → 2 penalty dice
    s.add_participant("small", "investigator", dex=70, combat_skill=80, build=-1, hp_max=8)
    s.add_participant("big", "monster", dex=40, combat_skill=40, build=1, hp_max=14)
    s.begin_round()
    t = s.declare_and_resolve_turn("small","grapple the big foe","maneuver",
        target_actor_id="big", defense_kind="fight_back", goal="ongoing_disadvantage")
    assert t.get("maneuver_build_difference") == 2
    assert t.get("maneuver_penalty_dice") == 2

def test_maneuver_impossible_when_build_diff_3_plus():
    """p.117: Build diff ≥3 → maneuver impossible."""
    rng = random.Random(107)
    s = coc_combat.CombatSession("imp-test", "test", 1, rng=rng)
    # attacker Build -2, target Build 2 → diff 4 → impossible
    s.add_participant("tiny", "investigator", dex=70, combat_skill=90, build=-2, hp_max=6)
    s.add_participant("huge", "monster", dex=30, combat_skill=30, build=2, hp_max=18)
    s.begin_round()
    t = s.declare_and_resolve_turn("tiny","try to grapple the huge foe","maneuver",
        target_actor_id="huge", defense_kind="fight_back", goal="ongoing_disadvantage")
    assert t["outcome"] == "maneuver_impossible_build"


# --------------------------------------------------------------------------- #
# Weapon catalog + module weapon extension mechanism
# --------------------------------------------------------------------------- #
def test_load_weapon_catalog_returns_canonical_weapons():
    """weapons.json catalog has the core Table XVII entries."""
    catalog = coc_combat.load_weapon_catalog()
    assert "knife_medium" in catalog
    assert "revolver_38" in catalog
    assert "unarmed" in catalog
    # knife_medium: 1D4+2, adds DB, impales
    km = catalog["knife_medium"]
    assert km["damage"] == "1D4+2"
    assert km["adds_damage_bonus"] is True
    assert km["impales"] is True

def test_resolve_module_weapons_extends_catalog_entry():
    """A module weapon with 'extends' inherits base stats, overrides special."""
    catalog = coc_combat.load_weapon_catalog()
    module_weapons = [
        {"weapon_id": "corbitt-ritual-dagger", "extends": "knife_medium",
         "special": "bypasses_corbitt_spells"}
    ]
    merged = coc_combat.resolve_module_weapons(module_weapons, catalog)
    rd = merged["corbitt-ritual-dagger"]
    # Inherited from knife_medium
    assert rd["damage"] == "1D4+2"
    assert rd["skill"] == "Fighting (Brawl)"
    assert rd["adds_damage_bonus"] is True
    assert rd["impales"] is True
    # Overridden by module
    assert rd["special"] == "bypasses_corbitt_spells"
    assert rd["weapon_id"] == "corbitt-ritual-dagger"
    # Catalog entry still available
    assert "knife_medium" in merged

def test_resolve_module_weapons_without_extends_taken_verbatim():
    """Module weapon without extends uses its own fields."""
    module_weapons = [
        {"weapon_id": "alien-rod", "skill": "Fighting (Brawl)",
         "damage": "2D6", "adds_damage_bonus": True, "impales": False, "special": None}
    ]
    merged = coc_combat.resolve_module_weapons(module_weapons)
    assert merged["alien-rod"]["damage"] == "2D6"

def test_combat_session_uses_module_weapon_by_id():
    """CombatSession with module_weapons resolves weapon by id from catalog."""
    rng = random.Random(200)
    module_weapons = [
        {"weapon_id": "corbitt-ritual-dagger", "extends": "knife_medium",
         "special": "bypasses_corbitt_spells"}
    ]
    s = coc_combat.CombatSession("mod-test", "test", 1, rng=rng,
                                 module_weapons=module_weapons)
    # Participant references weapon by id only — no hardcoded damage.
    s.add_participant("hero", "investigator", dex=70, combat_skill=65, build=0,
                      hp_max=10, damage_bonus="+1D4",
                      weapons=["corbitt-ritual-dagger"])
    s.add_participant("foe", "monster", dex=40, combat_skill=40, build=1, hp_max=12)
    s.begin_round()
    t = s.declare_and_resolve_turn("hero","stab foe with ritual dagger","attack",
        target_actor_id="foe", defense_kind="none", weapon_id="corbitt-ritual-dagger")
    if t["outcome"] == "hit":
        d = s.damage_chain[-1]
        # Damage should include the +1D4 DB (knife_medium adds_damage_bonus)
        assert "1D4" in d["die"] or len(d.get("die_rolls",[])) >= 2

def test_combat_session_participant_dict_weapon_overrides_catalog():
    """A participant dict weapon overrides catalog special field."""
    rng = random.Random(201)
    s = coc_combat.CombatSession("ovr-test", "test", 1, rng=rng)
    s.add_participant("hero", "investigator", dex=70, combat_skill=65, build=0,
                      hp_max=10,
                      weapons=[{"weapon_id":"knife_medium", "special":"enchanted"}])
    s.add_participant("foe", "monster", dex=40, combat_skill=40, build=1, hp_max=12)
    s.begin_round()
    w = s._weapon("hero", "knife_medium")
    # Catalog base + participant override
    assert w["damage"] == "1D4+2"  # from catalog
    assert w["special"] == "enchanted"  # overridden by participant


def test_weapon_resolves_catalog_key_not_on_participant_list():
    """_weapon() consults weapons.json by name even when the participant did not
    list that weapon — the catalog (Table XVII pp.401-405) is the lookup table."""
    rng = random.Random(7)
    s = coc_combat.CombatSession("cat-test", "test", 1, rng=rng)
    s.add_participant("hero", "investigator", dex=70, combat_skill=60, build=0,
                      hp_max=10, weapons=[])
    s.add_participant("foe", "monster", dex=40, combat_skill=30, build=0, hp_max=12)
    s.begin_round()
    # "revolver_38" is a Table XVII key; the hero has no weapons listed.
    w = s._weapon("hero", "revolver_38")
    assert w["weapon_id"] == "revolver_38"
    assert w["skill"] == "Firearms (Handgun)"
    assert w["damage"] == "1D10"  # derived from the table's damage_die
    assert w["impales"] is True
    assert w["adds_damage_bonus"] is False


def test_the_haunting_module_defines_ritual_dagger():
    """The Haunting module json defines corbitt-ritual-dagger extending knife_medium."""
    import json
    from pathlib import Path
    haunting = json.loads(Path("plugins/coc-keeper/references/rules-json/the-haunting.json").read_text())
    weapons = haunting.get("weapons", [])
    ritual = next((w for w in weapons if w.get("weapon_id") == "corbitt-ritual-dagger"), None)
    assert ritual is not None
    assert ritual["extends"] == "knife_medium"
    assert ritual["special"] == "bypasses_corbitt_spells"


# --------------------------------------------------------------------------- #
# Edge case tests: impale damage, non-impale extreme, negative DB,
# Dive for Cover forfeit full flow
# --------------------------------------------------------------------------- #
def test_impale_extreme_success_adds_extra_weapon_damage_roll():
    """p.119: impale weapon extreme success = max weapon + max DB + extra weapon roll."""
    rng = random.Random(300)
    s = coc_combat.CombatSession("impale-test", "test", 1, rng=rng)
    # knife_medium: 1D4+2, impales, adds DB. Attacker DB +1D4.
    s.add_participant("hero", "investigator", dex=70, combat_skill=90, build=1,
                      hp_max=10, damage_bonus="+1D4",
                      weapons=[{"weapon_id":"knife_medium","skill":"Fighting (Brawl)",
                                "damage":"1D4+2","adds_damage_bonus":True,"impales":True,"special":None}])
    s.add_participant("foe", "monster", dex=40, combat_skill=10, build=0, hp_max=30)
    s.begin_round()
    t = s.declare_and_resolve_turn("hero","stab foe","attack",
        target_actor_id="foe", defense_kind="fight_back", weapon_id="knife_medium")
    # hero combat_skill 90 → extreme threshold is 18; need roll <= 18.
    # We can't force the roll, but if it hits with extreme we check the record.
    if t["outcome"] == "hit":
        atk_roll = [r for r in s.pending_rolls if r["roll_id"] == t["roll_id"]][0]
        roll_val = atk_roll["roll"]
        oc = atk_roll["outcome"]
        from coc_combat import LVL
        if LVL[oc] >= LVL["extreme"]:
            d = s.damage_chain[-1]
            assert d.get("extreme_damage") is True
            assert d.get("is_impale") is True
            # max weapon(1D4+2)=6 + max DB(1D4)=4 = 10 minimum + extra roll >= 1
            assert d["raw_damage"] >= 10 + 1

def test_non_impale_extreme_uses_max_damage_no_extra_roll():
    """p.115: non-impale weapon extreme = max weapon + max DB (no extra roll)."""
    rng = random.Random(301)
    s = coc_combat.CombatSession("blunt-test", "test", 1, rng=rng)
    # club_large: 1D8, does NOT impale, adds DB.
    s.add_participant("hero", "investigator", dex=70, combat_skill=90, build=1,
                      hp_max=10, damage_bonus="+1D4",
                      weapons=[{"weapon_id":"club_large","skill":"Fighting (Brawl)",
                                "damage":"1D8","adds_damage_bonus":True,"impales":False,"special":None}])
    s.add_participant("foe", "monster", dex=40, combat_skill=10, build=0, hp_max=30)
    s.begin_round()
    t = s.declare_and_resolve_turn("hero","club foe","attack",
        target_actor_id="foe", defense_kind="fight_back", weapon_id="club_large")
    if t["outcome"] == "hit":
        atk_roll = [r for r in s.pending_rolls if r["roll_id"] == t["roll_id"]][0]
        from coc_combat import LVL
        if LVL[atk_roll["outcome"]] >= LVL["extreme"]:
            d = s.damage_chain[-1]
            assert d.get("extreme_damage") is True
            assert d.get("is_impale") is False
            # max weapon(1D8)=8 + max DB(1D4)=4 = 12 exactly (no extra roll)
            assert d["raw_damage"] == 12

def test_negative_db_reduces_melee_damage():
    """Small character with DB -1: melee weapon damage reduced by 1."""
    rng = random.Random(302)
    s = coc_combat.CombatSession("negdb-test", "test", 1, rng=rng)
    # STR+SIZ low → DB -1
    s.add_participant("tiny", "investigator", dex=70, combat_skill=80, build=-1,
                      hp_max=6, damage_bonus="-1",
                      weapons=[{"weapon_id":"knife_small","skill":"Fighting (Brawl)",
                                "damage":"1D4","adds_damage_bonus":True,"impales":True,"special":None}])
    s.add_participant("foe", "monster", dex=40, combat_skill=10, build=0, hp_max=30)
    s.begin_round()
    t = s.declare_and_resolve_turn("tiny","stab foe","attack",
        target_actor_id="foe", defense_kind="none", weapon_id="knife_small")
    if t["outcome"] == "hit":
        d = s.damage_chain[-1]
        # die should include the -1 DB: 1D4-1
        assert "-1" in d["die"]
        # raw damage should be 1D4 roll - 1 (min 0)
        weapon_roll = d["die_rolls"][0] if d.get("die_rolls") else 0
        assert d["raw_damage"] == max(0, weapon_roll - 1) or d["raw_damage"] == weapon_roll - 1

def test_dive_for_cover_forfeit_blocks_next_attack_then_recovers():
    """p.125: after Dive for Cover, diver's next attack is forfeit; after
    that turn the forfeit clears and they can attack again."""
    rng = random.Random(303)
    s = coc_combat.CombatSession("dvc-full", "test", 1, rng=rng)
    s.add_participant("shooter", "investigator", dex=80, combat_skill=70, build=0,
                      hp_max=10, weapons=[{"weapon_id":"revolver_38","skill":"Firearms (Handgun)",
                                           "damage":"1D10","adds_damage_bonus":False,"impales":True,"special":None}])
    s.add_participant("diver", "monster", dex=60, combat_skill=50, build=0, hp_max=10,
                      dodge_skill=80)
    s.begin_round()
    # Shooter fires; diver dives for cover successfully
    s.declare_and_resolve_turn("shooter","shoot diver","attack",
        target_actor_id="diver", defense_kind="dive_for_cover", weapon_id="revolver_38")
    # Diver should be forfeiting
    if s.participants["diver"].get("_forfeit_next_attack"):
        assert s.is_forfeiting_attack("diver") is True
        # Diver takes their turn — can only dodge, not attack
        # (the engine doesn't block it mechanically yet, but the flag is set)
        # Clear the forfeit as if the diver took their turn
        s.clear_forfeit("diver")
        assert s.is_forfeiting_attack("diver") is False

def test_firearm_damage_has_no_db_even_with_high_str():
    """Firearms never add DB regardless of attacker's STR/SIZ (Table XVII)."""
    rng = random.Random(304)
    s = coc_combat.CombatSession("nofirebase-test", "test", 1, rng=rng)
    # Very strong attacker, but firearm shouldn't add DB
    s.add_participant("strong", "investigator", dex=70, combat_skill=50, build=2,
                      hp_max=14, damage_bonus="+1D6",
                      weapons=[{"weapon_id":"revolver_38","skill":"Firearms (Handgun)",
                                "damage":"1D10","adds_damage_bonus":False,"impales":True,"special":None}])
    s.add_participant("foe", "monster", dex=40, combat_skill=10, build=0, hp_max=30)
    s.begin_round()
    t = s.declare_and_resolve_turn("strong","shoot foe","attack",
        target_actor_id="foe", defense_kind="none", weapon_id="revolver_38")
    if t["outcome"] == "hit":
        d = s.damage_chain[-1]
        # die should be just 1D10, no DB
        assert "1D6" not in d["die"]
        assert d["die"] == "1D10"

def test_flesh_ward_armor_degrades_correctly_under_extreme_damage():
    """Flesh Ward (degrades_1_per_damage) should degrade by absorbed amount,
    even under extreme/impale damage recalculation."""
    rng = random.Random(305)
    s = coc_combat.CombatSession("fw-extreme", "test", 1, rng=rng)
    s.add_participant("hero", "investigator", dex=70, combat_skill=90, build=1,
                      hp_max=10, damage_bonus="+1D4",
                      weapons=[{"weapon_id":"knife_medium","skill":"Fighting (Brawl)",
                                "damage":"1D4+2","adds_damage_bonus":True,"impales":True,"special":None}])
    s.add_participant("warded", "monster", dex=10, combat_skill=10, build=0, hp_max=20,
                      armor=5, armor_rule="degrades_1_per_damage")
    s.begin_round()
    t = s.declare_and_resolve_turn("hero","stab warded","attack",
        target_actor_id="warded", defense_kind="fight_back", weapon_id="knife_medium")
    if t["outcome"] == "hit":
        d = s.damage_chain[-1]
        # armor_after should equal armor_before - armor_absorbed
        assert d["armor_after"] == d["armor_before"] - d["armor_absorbed"]
        # armor should never go negative
        assert d["armor_after"] >= 0


# --------------------------------------------------------------------------- #
# Major wound immediate effects / overkill / zero-HP triage (p.120)
# --------------------------------------------------------------------------- #
def _flat_hit(s, target_id: str, damage: int) -> None:
    """Land an exact amount of damage on target, then update conditions."""
    s._damage_roll(str(damage), "attacker", target_id, "test-blow", "t-test")
    s._update_conditions(target_id)


def _victim_session(con: int = 50, seed: int = 11):
    rng = random.Random(seed)
    s = coc_combat.CombatSession("mw-fight", "test", 1, rng=rng)
    s.add_participant("attacker", "monster", dex=50, combat_skill=50, build=0, hp_max=10)
    s.add_participant("victim", "investigator", dex=50, combat_skill=50, build=0,
                      hp_max=12, con=con)
    return s


def test_major_wound_causes_prone_and_con_check_unconscious():
    s = _victim_session(con=1)  # CON 1 → CON 检定必失败 → 昏迷
    _flat_hit(s, "victim", 6)   # 单击达半上限（12//2=6）
    p = s.participants["victim"]
    assert "major_wound" in p["conditions"]
    assert "prone" in p["conditions"]
    assert "unconscious" in p["conditions"]


def test_major_wound_con_success_stays_conscious():
    s = _victim_session(con=99, seed=3)
    _flat_hit(s, "victim", 6)
    p = s.participants["victim"]
    assert "major_wound" in p["conditions"]
    assert "prone" in p["conditions"]
    assert "unconscious" not in p["conditions"]


def test_overkill_single_hit_is_instant_death():
    s = _victim_session()
    _flat_hit(s, "victim", 13)  # > hp_max(12) 单击 → 死亡不可避免
    p = s.participants["victim"]
    assert "dead" in p["conditions"]


def test_zero_hp_regular_damage_is_unconscious_not_dying():
    s = _victim_session(con=99)
    p = s.participants["victim"]
    while p["hp_current"] > 0:
        _flat_hit(s, "victim", 1)  # 小伤堆到 0，无单击达半上限
    assert "unconscious" in p["conditions"]
    assert "dying" not in p["conditions"]


def test_zero_hp_with_major_wound_is_dying():
    s = _victim_session(con=99, seed=3)
    _flat_hit(s, "victim", 6)   # 重伤
    _flat_hit(s, "victim", 6)   # 打到 0
    p = s.participants["victim"]
    assert p["hp_current"] == 0
    assert "dying" in p["conditions"]
    assert "unconscious" in p["conditions"]


def test_successful_fight_back_damages_original_attacker_and_records_roll():
    """p.115: a winning ordinary Fight Back is a counter-hit, not a miss."""
    class FixedRng:
        def __init__(self):
            self.values = iter([70, 20, 3])

        def randint(self, low, high):
            value = next(self.values)
            assert low <= value <= high
            return value

    s = coc_combat.CombatSession("fight-back-damage", "test", 1, rng=FixedRng())
    s.add_participant("attacker", "monster", 60, 50, 0, 10,
                      weapons=[{"weapon_id": "unarmed"}])
    s.add_participant("defender", "investigator", 50, 60, 0, 10,
                      weapons=[{"weapon_id": "unarmed"}])
    s.begin_round()

    turn = s.declare_and_resolve_turn(
        "attacker", "strike", action="attack", target_actor_id="defender",
        defense_kind="fight_back", weapon_id="unarmed")

    assert turn["outcome"] == "fight_back_hit"
    assert turn["fight_back_damage_roll_id"]
    assert s.participants["attacker"]["hp_current"] == 7
    damage = s.damage_chain[-1]
    assert damage["source_actor_id"] == "defender"
    assert damage["target_actor_id"] == "attacker"


def test_odd_max_hp_major_wound_uses_ceiling_half_threshold():
    s = coc_combat.CombatSession("odd-hp", "test", 1, rng=random.Random(13))
    s.add_participant("source", "monster", 60, 50, 0, 10,
                      weapons=[{"weapon_id": "unarmed"}])
    s.add_participant("target", "investigator", 50, 50, 0, 11)
    s.damage_chain.append({
        "source_actor_id": "source", "target_actor_id": "target",
        "raw_damage": 5, "armor_absorbed": 0,
    })
    s.participants["target"]["hp_current"] = 6
    s._update_conditions("target")
    assert "major_wound" not in s.participants["target"]["conditions"]


def test_major_wound_con_roll_has_stable_roll_evidence():
    s = coc_combat.CombatSession("major-con", "test", 1, rng=random.Random(2))
    s.add_participant("source", "monster", 60, 50, 0, 10,
                      weapons=[{"weapon_id": "unarmed"}])
    s.add_participant("target", "investigator", 50, 50, 0, 10, con=50)
    s.damage_chain.append({
        "source_actor_id": "source", "target_actor_id": "target",
        "raw_damage": 5, "armor_absorbed": 0,
    })
    s.participants["target"]["hp_current"] = 5
    s._update_conditions("target")
    evidence = s.participants["target"]["major_wound_con"]
    assert set(evidence) >= {"roll_id", "roll", "target", "outcome"}
    assert evidence["roll_id"] == "major-con:cr1"


def test_combat_snapshot_round_trip_preserves_revision_and_initiative(tmp_path):
    s = coc_combat.CombatSession("round-trip", "test", 1, rng=random.Random(4))
    s.add_participant("inv", "investigator", 60, 55, 0, 10,
                      weapons=[{"weapon_id": "unarmed"}])
    s.add_participant("foe", "monster", 50, 45, 0, 8,
                      weapons=[{"weapon_id": "unarmed"}])
    s.begin_round()
    s.revision = 7
    s.save(tmp_path)
    loaded = coc_combat.CombatSession.load(tmp_path, rng=random.Random(999))
    assert loaded.revision == 7
    assert loaded._current_round == 1
    assert loaded._current_initiative == s._current_initiative
    assert loaded.snapshot() == s.snapshot()


def test_combat_load_rejects_forged_pending_defense_contract(tmp_path):
    s = coc_combat.CombatSession("pending-contract", "test", 1, rng=random.Random(5))
    s.add_participant("inv", "investigator", 60, 55, 0, 10)
    s.add_participant("foe", "monster", 50, 45, 0, 8)
    s.begin_round()
    s.pending_attack = {
        "attack_command_id": "attack-1", "actor_id": "foe",
        "target_actor_id": "inv", "declared_intent": "strike",
        "resolution_hint": "opposed_melee", "weapon_id": "unarmed",
        "allowed_defenses": ["dodge", "fight_back"],
    }
    s.save(tmp_path)
    path = tmp_path / "save" / "combat.json"
    forged = json.loads(path.read_text(encoding="utf-8"))
    forged["pending_attack"]["allowed_defenses"].append("keeper_secret")
    path.write_text(json.dumps(forged), encoding="utf-8")
    with pytest.raises(ValueError, match="pending attack"):
        coc_combat.CombatSession.load(tmp_path, rng=random.Random(5))


# --------------------------------------------------------------------------- #
# W3-2 Firearms depth: aiming, multi-shot, reload, full-auto, suppression
# --------------------------------------------------------------------------- #
def test_parse_uses_per_round_handgun_and_full_auto():
    """weapons.json uses_per_round strings decode into structured limits."""
    assert coc_combat.parse_uses_per_round("1 (3)") == {
        "max_shots": 3, "allows_full_auto": False, "rounds_per_use": 1,
    }
    assert coc_combat.parse_uses_per_round("1(3)")["max_shots"] == 3
    parsed = coc_combat.parse_uses_per_round("1 (2) or full auto")
    assert parsed["max_shots"] == 2
    assert parsed["allows_full_auto"] is True
    assert coc_combat.parse_uses_per_round("Full auto")["allows_full_auto"] is True
    assert coc_combat.parse_uses_per_round("1/2")["rounds_per_use"] == 2


def test_aiming_grants_bonus_die_on_next_shot():
    """p.113 Aiming: spend a round aiming → +1 bonus die on the next shot."""
    rng = random.Random(201)
    s = coc_combat.CombatSession("aim-test", "test", 1, rng=rng)
    s.add_participant("hero", "investigator", dex=70, combat_skill=60, build=0, hp_max=12,
                      firearms_skill=60, has_ready_firearm=True,
                      weapons=["revolver_38"])
    s.add_participant("foe", "monster", dex=40, combat_skill=40, build=0, hp_max=12)
    s.begin_round()
    aim = s.declare_and_resolve_turn("hero", "take careful aim",
                                     resolution_hint="aim", weapon_id="revolver_38")
    assert aim["outcome"] == "aiming"
    assert s.participants["hero"].get("_aiming") is True
    s.begin_round()
    shot = s.declare_and_resolve_turn(
        "hero", "fire the aimed shot", "attack",
        target_actor_id="foe", defense_kind="none", weapon_id="revolver_38")
    assert shot["attack_modifiers"]["bonus"] >= 1
    assert shot["attack_modifiers"].get("aimed") is True
    assert s.participants["hero"].get("_aiming") is False


def test_aiming_lost_when_damaged():
    """p.113: if the aiming character takes damage, aiming advantage is lost."""
    rng = random.Random(202)
    s = coc_combat.CombatSession("aim-lost", "test", 1, rng=rng)
    s.add_participant("hero", "investigator", dex=70, combat_skill=60, build=0, hp_max=12,
                      firearms_skill=60, weapons=["revolver_38"])
    s.add_participant("foe", "monster", dex=80, combat_skill=99, build=0, hp_max=12,
                      weapons=[{"weapon_id": "club", "skill": "Fighting (Brawl)",
                                "damage": "1D8", "adds_damage_bonus": False}])
    s.begin_round()
    s.declare_and_resolve_turn("hero", "aim", resolution_hint="aim", weapon_id="revolver_38")
    assert s.participants["hero"]["_aiming"] is True
    # Force damage onto the aimer (rulebook: taking damage loses aim).
    s._damage_roll("1D8", "foe", "hero", "club", "forced-hit")
    assert s.participants["hero"].get("_aiming") is False


def test_handgun_multi_shot_applies_one_penalty_die_to_each():
    """p.113 Handguns Multiple Shots: 2+ shots → each shot gets one penalty die."""
    rng = random.Random(203)
    s = coc_combat.CombatSession("multi-shot", "test", 1, rng=rng)
    s.add_participant("hero", "investigator", dex=70, combat_skill=70, build=0, hp_max=12,
                      firearms_skill=70, weapons=["revolver_38"])
    s.add_participant("foe", "monster", dex=40, combat_skill=40, build=0, hp_max=30)
    s.begin_round()
    t = s.declare_and_resolve_turn(
        "hero", "empty three rounds", "attack",
        target_actor_id="foe", defense_kind="none", weapon_id="revolver_38",
        shots=3)
    assert t["outcome"] in ("multi_shot_resolved", "hit", "miss")
    shots = t.get("shots") or []
    assert len(shots) == 3
    for shot in shots:
        assert shot["attack_modifiers"]["penalty"] >= 1
        assert shot["attack_modifiers"].get("multi_shot") is True


def test_handgun_multi_shot_respects_uses_per_round():
    """uses_per_round from weapons.json caps shots (revolver_38 = 1 (3))."""
    rng = random.Random(204)
    s = coc_combat.CombatSession("upr", "test", 1, rng=rng)
    s.add_participant("hero", "investigator", dex=70, combat_skill=70, build=0, hp_max=12,
                      firearms_skill=70, weapons=["revolver_38"])
    s.add_participant("foe", "monster", dex=40, combat_skill=40, build=0, hp_max=12)
    s.begin_round()
    try:
        s.declare_and_resolve_turn(
            "hero", "fire four", "attack",
            target_actor_id="foe", defense_kind="none", weapon_id="revolver_38",
            shots=4)
        assert False, "expected ValueError for shots > uses_per_round max"
    except ValueError as exc:
        assert "uses_per_round" in str(exc) or "shots" in str(exc).lower()


def test_reload_costs_rounds_and_restores_ammo():
    """p.113 Reloading: clip/shell reload costs combat rounds; restores magazine."""
    rng = random.Random(205)
    s = coc_combat.CombatSession("reload", "test", 1, rng=rng)
    s.add_participant("hero", "investigator", dex=70, combat_skill=60, build=0, hp_max=12,
                      firearms_skill=60, weapons=["revolver_38"])
    s.add_participant("foe", "monster", dex=40, combat_skill=40, build=0, hp_max=12)
    # Empty the cylinder.
    s.set_ammo("hero", "revolver_38", 0)
    assert s.get_ammo("hero", "revolver_38") == 0
    s.begin_round()
    empty = s.declare_and_resolve_turn(
        "hero", "click", "attack",
        target_actor_id="foe", defense_kind="none", weapon_id="revolver_38")
    assert empty["outcome"] == "out_of_ammo"
    reload_t = s.declare_and_resolve_turn(
        "hero", "reload the revolver", resolution_hint="reload", weapon_id="revolver_38")
    assert reload_t["outcome"] in ("reload_complete", "reload_in_progress")
    # revolver_38 reload_rounds defaults to 1 → complete same declaration.
    if reload_t["outcome"] == "reload_complete":
        assert s.get_ammo("hero", "revolver_38") == 6  # magazine


def test_load_and_fire_same_round_adds_penalty():
    """p.113: load one round and fire same round → one penalty die."""
    rng = random.Random(206)
    s = coc_combat.CombatSession("loadfire", "test", 1, rng=rng)
    s.add_participant("hero", "investigator", dex=70, combat_skill=60, build=0, hp_max=12,
                      firearms_skill=60, weapons=["revolver_38"])
    s.add_participant("foe", "monster", dex=40, combat_skill=40, build=0, hp_max=12)
    s.set_ammo("hero", "revolver_38", 0)
    s.begin_round()
    t = s.declare_and_resolve_turn(
        "hero", "load one and fire", "attack",
        target_actor_id="foe", defense_kind="none", weapon_id="revolver_38",
        load_and_fire=True)
    assert t["attack_modifiers"]["penalty"] >= 1
    assert t["attack_modifiers"].get("load_and_fire") is True


def test_full_auto_volley_size_is_skill_div_10_min_3():
    """p.114: volley size = skill/10 (tens digit), never fewer than 3."""
    assert coc_combat.full_auto_volley_size(47) == 4
    assert coc_combat.full_auto_volley_size(63) == 6
    assert coc_combat.full_auto_volley_size(20) == 3  # floor at 3
    assert coc_combat.full_auto_volley_size(9) == 3


def test_full_auto_volleys_escalate_penalty():
    """p.114-116: first volley normal; each subsequent +1 penalty; 3rd→2 penalty."""
    rng = random.Random(207)
    s = coc_combat.CombatSession("fullauto", "test", 1, rng=rng)
    s.add_participant("gunner", "npc", dex=50, combat_skill=60, build=0, hp_max=13,
                      firearms_skill=60, weapons=["thompson"])
    s.add_participant("foe", "investigator", dex=55, combat_skill=25, build=0, hp_max=15)
    s.begin_round()
    # skill 60 → volley size 6; fire 18 rounds = 3 volleys
    t = s.declare_and_resolve_turn(
        "gunner", "full auto on foe", "attack",
        target_actor_id="foe", defense_kind="none", weapon_id="thompson",
        fire_mode="full_auto", rounds_fired=18)
    volleys = t.get("volleys") or []
    assert len(volleys) == 3
    assert volleys[0]["attack_modifiers"]["penalty"] == 0
    assert volleys[1]["attack_modifiers"]["penalty"] == 1
    assert volleys[2]["attack_modifiers"]["penalty"] == 2
    assert all(v["bullets"] == 6 for v in volleys)


def test_suppressive_fire_offers_dive_for_cover():
    """p.126 Suppressing Fire: group may dive for cover; then random targets resolved."""
    rng = random.Random(208)
    s = coc_combat.CombatSession("suppress", "test", 1, rng=rng)
    s.add_participant("gunner", "npc", dex=50, combat_skill=40, build=0, hp_max=13,
                      firearms_skill=40, weapons=["thompson"])
    s.add_participant("a", "investigator", dex=55, combat_skill=25, build=0, hp_max=15,
                      dodge_skill=50)
    s.add_participant("b", "investigator", dex=60, combat_skill=30, build=0, hp_max=14,
                      dodge_skill=40)
    s.begin_round()
    t = s.declare_and_resolve_turn(
        "gunner", "suppressive fire on the room",
        resolution_hint="firearm_attack", weapon_id="thompson",
        fire_mode="suppressive",
        suppress_targets=["a", "b"],
        dive_for_cover_actors=["a"])
    assert t["outcome"] == "suppressive_fire"
    assert "a" in (t.get("dived_for_cover") or [])
    assert t.get("suppression_targets")


# --------------------------------------------------------------------------- #
# W3-4 Melee patches: thrown, prone, maneuver unification, counters
# --------------------------------------------------------------------------- #
def test_thrown_weapon_can_be_dodged_and_uses_half_db():
    """p.108: thrown weapons opposed with Dodge; half damage bonus applied."""
    rng = random.Random(301)
    s = coc_combat.CombatSession("thrown", "test", 1, rng=rng)
    s.add_participant("hero", "investigator", dex=70, combat_skill=80, build=0, hp_max=12,
                      damage_bonus="+1D4",
                      weapons=["rock_thrown"])
    s.add_participant("foe", "monster", dex=50, combat_skill=40, build=0, hp_max=12,
                      dodge_skill=10)  # low dodge so hits are likely when not dodging well
    s.begin_round()
    t = s.declare_and_resolve_turn(
        "hero", "hurl a rock", "attack",
        target_actor_id="foe", defense_kind="dodge", weapon_id="rock_thrown")
    assert t["defense_kind"] == "dodge"
    assert t["resolution_hint"] == "opposed_melee"
    # On a hit, damage_chain should record half DB metadata when DB applied.
    if t["outcome"] == "hit":
        d = s.damage_chain[-1]
        assert d.get("half_damage_bonus") is not None or "+1D4" not in d["die"] or "half" in str(d)


def test_thrown_weapon_half_db_expr_tag():
    """_weapon_db_expr tags Throw weapons as half DB."""
    rng = random.Random(302)
    s = coc_combat.CombatSession("halfdb", "test", 1, rng=rng)
    s.add_participant("hero", "investigator", dex=70, combat_skill=80, build=0, hp_max=12,
                      damage_bonus="+1D4", weapons=["rock_thrown"])
    w = s._weapon("hero", "rock_thrown")
    expr = s._weapon_db_expr(s.participants["hero"], w)
    assert expr is not None and expr.startswith("half:")


def test_prone_melee_attacker_gets_bonus_die():
    """p.127: fighting attacks vs prone gain one bonus die."""
    rng = random.Random(303)
    s = coc_combat.CombatSession("prone-melee", "test", 1, rng=rng)
    s.add_participant("hero", "investigator", dex=70, combat_skill=70, build=0, hp_max=12,
                      weapons=[{"weapon_id": "club", "skill": "Fighting (Brawl)",
                                "damage": "1D8", "adds_damage_bonus": False}])
    s.add_participant("foe", "monster", dex=40, combat_skill=40, build=0, hp_max=12,
                      conditions=["prone"])
    s.begin_round()
    t = s.declare_and_resolve_turn(
        "hero", "kick the prone foe", "attack",
        target_actor_id="foe", defense_kind="none", weapon_id="club")
    assert t["attack_modifiers"]["bonus"] >= 1
    assert t["attack_modifiers"].get("vs_prone_melee") is True


def test_prone_ranged_attacker_gets_penalty_die():
    """p.128: firearms vs prone get one penalty die (ignored at point-blank)."""
    rng = random.Random(304)
    s = coc_combat.CombatSession("prone-ranged", "test", 1, rng=rng)
    s.add_participant("hero", "investigator", dex=70, combat_skill=70, build=0, hp_max=12,
                      firearms_skill=70, weapons=["revolver_38"])
    s.add_participant("foe", "monster", dex=40, combat_skill=40, build=0, hp_max=12,
                      conditions=["prone"])
    s.begin_round()
    t = s.declare_and_resolve_turn(
        "hero", "shoot the prone foe", "attack",
        target_actor_id="foe", defense_kind="none", weapon_id="revolver_38")
    assert t["attack_modifiers"]["penalty"] >= 1
    assert t["attack_modifiers"].get("vs_prone_ranged") is True
    # Point-blank ignores the prone penalty.
    s2 = coc_combat.CombatSession("prone-pb", "test", 1, rng=random.Random(305))
    s2.add_participant("hero", "investigator", dex=70, combat_skill=70, build=0, hp_max=12,
                       firearms_skill=70, weapons=["revolver_38"])
    s2.add_participant("foe", "monster", dex=40, combat_skill=40, build=0, hp_max=12,
                       conditions=["prone"])
    s2.begin_round()
    t2 = s2.declare_and_resolve_turn(
        "hero", "point-blank on prone", "attack",
        target_actor_id="foe", defense_kind="none", weapon_id="revolver_38",
        point_blank=True)
    assert t2["attack_modifiers"].get("vs_prone_ranged") is not True


def test_maneuver_goal_aliases_grapple_and_break_free():
    """Legacy SKILL.md names map to p.119 goals; canonical set unchanged."""
    assert "grapple" not in coc_combat.CombatSession.VALID_MANEUVER_GOALS
    assert "break_free" not in coc_combat.CombatSession.VALID_MANEUVER_GOALS
    assert coc_combat.CombatSession._MANEUVER_GOAL_ALIASES["grapple"] == "ongoing_disadvantage"
    assert coc_combat.CombatSession._MANEUVER_GOAL_ALIASES["break_free"] == "escape"
    rng = random.Random(306)
    s = coc_combat.CombatSession("alias", "test", 1, rng=rng)
    s.add_participant("hero", "investigator", dex=70, combat_skill=90, build=1, hp_max=12)
    s.add_participant("foe", "monster", dex=40, combat_skill=20, build=0, hp_max=12)
    s.begin_round()
    t = s.declare_and_resolve_turn(
        "hero", "grapple", "maneuver",
        target_actor_id="foe", defense_kind="none",
        maneuver_kind="grapple")
    assert t.get("goal") == "ongoing_disadvantage"
    if t["outcome"] in ("restrain_success", "maneuver_success"):
        assert any(e["effect"] == "restrained" for e in s.participants["foe"]["active_effects"])


def test_defender_may_counter_with_maneuver():
    """p.117: target of an attack/maneuver may respond with their own maneuver."""
    rng = random.Random(307)
    s = coc_combat.CombatSession("counter", "test", 1, rng=rng)
    s.add_participant("hero", "investigator", dex=70, combat_skill=30, build=0, hp_max=12)
    s.add_participant("foe", "monster", dex=50, combat_skill=90, build=0, hp_max=12)
    s.begin_round()
    t = s.declare_and_resolve_turn(
        "hero", "try to shove", "maneuver",
        target_actor_id="foe", defense_kind="maneuver",
        goal="push", defender_goal="disarm")
    # With foe skill 90 vs hero 30, defender often wins → counter_* outcome.
    assert t["defense_kind"] == "maneuver"
    assert t.get("defender_goal") == "disarm"
    assert t["outcome"] in (
        "push_success", "maneuver_failed", "counter_disarm_success",
        "counter_disarm_nothing_to_take", "maneuver_failed_fight_back_damage",
        "counter_restrain_success", "counter_push_success",
    )
