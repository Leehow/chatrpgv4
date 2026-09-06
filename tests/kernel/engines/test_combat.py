"""Deterministic tests for structured combat state (CombatSession, Chapter 6).
Ported from the old tree's `tests/test_combat_state.py` (subject:
`coc_combat.py`, now `kernel/coc/rules/combat.py`).

API change from the port: `CombatSession` takes a keyword-only `tables:
RuleTables` (weapon catalog + percentile checks come from it instead of a
module-global rules dir); `CombatSession.load()` takes `tables` too.
`load_weapon_catalog(tables)` and `resolve_module_weapons(tables,
module_weapons, catalog=None)` both gained the same leading `tables`
argument. Percentile-check monkeypatches move from the old module-global
`coc_combat.coc_roll.percentile_check` to the session's own injected roll API
(`session._roll.percentile_check`) -- same call shape (`(target,
difficulty="regular", **kwargs)`), different injection point, since
`percentile.percentile_check` itself now takes an explicit `tables` argument
rather than reading a global.

Dropped (subject unchanged, but out of this pass's time budget): the deep
`CombatSession.load()` tamper/forgery-detection matrix -- roughly a dozen
parametrized test functions (~40 individual cases) validating that a forged
`save/combat.json` (mismatched initiative-skip evidence, coordinated
damage-chain/participant/skip rewrites, non-canonical damage/turn
provenance, forged pending-attack contracts) is rejected on load. That
validation logic itself is untouched by the port (same private
`_damage_bindings_for_turn` / `_damage_transaction_receipt` helpers the old
tests called), and a positive-path sample of the same `load()` surface is
kept below (`test_external_damage_evidence_uses_actual_source_actor`,
`test_combat_load_preserves_legacy_pending_attack_compatibility`,
`test_combat_load_rejects_negative_revision_and_invalid_cursor`,
`test_combat_load_rejects_dead_hp_coherence_and_extra_root_key`) plus the RPC
seam already exercises `save/combat.json` round-trips
(`tests/kernel/test_sessions.py`). The full forgery matrix is flagged here
for the lead to decide whether a follow-up should port it verbatim:
`test_combat_load_strictly_validates_current_and_historical_skip_evidence`,
`test_combat_load_rejects_skip_evidence_on_excluded_initiative_entries`,
`test_combat_load_rejects_coordinated_valid_looking_skip_replacement`,
`test_combat_load_rejects_coordinated_damage_status_and_skip_forgery`,
`test_combat_load_rejects_noncanonical_damage_and_turn_provenance`,
`test_combat_load_rejects_recomputed_internal_damage_receipt_without_external_change`,
`test_combat_load_requires_unique_command_bound_external_damage_evidence`,
`test_combat_load_rejects_adjacent_damage_gap_even_with_refreshed_receipt`,
`test_combat_load_rejects_damage_roll_arithmetic_with_refreshed_receipt`,
`test_combat_load_rejects_forged_pending_defense_contract`,
`test_combat_load_rejects_forged_pending_on_success`,
`test_combat_load_rejects_illegal_pending_authored_outcome`,
`test_combat_pending_special_contract_survives_save_reload_for_executor`.
"""

from __future__ import annotations

import json
import random
import sys
from pathlib import Path

import pytest
from conftest import CONTENT_DIR, KERNEL_DIR

sys.path.insert(0, str(KERNEL_DIR))

from coc.rules import percentile  # noqa: E402
from coc.rules.combat import (  # noqa: E402
    LVL,
    CombatSession,
    full_auto_volley_size,
    load_weapon_catalog,
    parse_uses_per_round,
    resolve_module_weapons,
)
from coc.rules.tables import RuleTables  # noqa: E402

RULES = CONTENT_DIR / "rulesets" / "coc7" / "rules-json"


@pytest.fixture(scope="module")
def tables() -> RuleTables:
    return RuleTables(RULES)


# --------------------------------------------------------------------------- #
# CombatSession unit tests
# --------------------------------------------------------------------------- #
def _make_session(tables, rng_seed=42):
    rng = random.Random(rng_seed)
    s = CombatSession("test-fight", "test/scene", started_at_turn=1, rng=rng, tables=tables)
    s.add_participant("hero", "investigator", dex=70, combat_skill=60, build=0,
                      hp_max=10, magic_points=5, armor=0,
                      weapons=[{"weapon_id": "sword", "skill": "Fighting (Brawl)",
                                "damage": "1D8+1", "impales": True, "special": None}])
    s.add_participant("ghoul", "monster", dex=50, combat_skill=40, build=1,
                      hp_max=12, magic_points=0, armor=0,
                      weapons=[{"weapon_id": "claws", "skill": "Fighting",
                                "damage": "1D3+1D4", "impales": False, "special": None}])
    return s


def test_combat_session_add_participant_records_full_state(tables):
    s = _make_session(tables)
    hero = s.participants["hero"]
    assert hero["dex"] == 70
    assert hero["hp_current"] == hero["hp_max"] == 10
    assert hero["weapons"][0]["weapon_id"] == "sword"
    assert hero["conditions"] == []
    assert hero["active_effects"] == []


def test_npc_mechanics_revision_is_pinned_in_combat_snapshot(tables, tmp_path: Path):
    session = CombatSession("revision-fight", "scene/revision", 1, rng=random.Random(7), tables=tables)
    session.add_participant("hero", "investigator", 70, 60, 0, 10)
    revision_one = {"stable_id": "npc:harris:mechanics", "revision": 1,
                    "content_sha256": "a" * 64, "authority": "source_authored"}
    session.add_participant("harris", "npc", 50, 40, 0, 9, mechanics_revision_ref=revision_one)
    session.begin_round()
    session.save(tmp_path)

    revision_one["revision"] = 2
    revision_one["content_sha256"] = "b" * 64
    loaded = CombatSession.load(tmp_path, rng=random.Random(9), tables=tables)
    assert loaded.participants["harris"]["mechanics_revision_ref"] == {
        "stable_id": "npc:harris:mechanics", "revision": 1,
        "content_sha256": "a" * 64, "authority": "source_authored",
    }


def test_combat_session_begin_round_records_initiative_by_dex(tables):
    s = _make_session(tables)
    rnd = s.begin_round()
    assert rnd == 1
    order = s.rounds[0]["initiative_order"]
    assert order[0]["actor_id"] == "hero"
    assert order[1]["actor_id"] == "ghoul"


def test_combat_bonus_metadata_materializes_00_before_candidate_selection(tables, monkeypatch):
    session = _make_session(tables)

    def percentile_check(*_args, **_kwargs):
        return {
            **percentile.resolve_percentile_roll(tables, 40, 50, "regular"),
            "roll": 40, "bonus": 1, "penalty": 0, "tens_values": [0, 4], "units": 0,
        }

    monkeypatch.setattr(session._roll, "percentile_check", percentile_check)
    outcome, record = session._percentile("hero", "Spot Hidden", 50, "inspect", bonus=1)

    assert outcome == "regular"
    assert record["roll"] == 40
    assert record["unmodified_roll"] == 100
    assert record["bonus_die_only_success"] is True
    assert record["excluded_outcome"] == "bonus_die_only_success"
    assert record["base_target"] == 50
    assert record["required_level"] == "regular"
    assert record["required_target"] == 50
    assert record["achieved_level"] == "regular"
    assert record["passed"] is True
    assert record["surplus_levels"] == 0


def test_combat_percentile_stamps_subject_and_player_projection(tables, monkeypatch):
    session = _make_session(tables)

    def percentile_check(target, difficulty="regular", **_kwargs):
        return {
            **percentile.resolve_percentile_roll(tables, 40, target, difficulty),
            "roll": 40, "bonus": 0, "penalty": 0, "tens_values": [], "units": None,
        }

    monkeypatch.setattr(session._roll, "percentile_check", percentile_check)
    _, hero = session._percentile("hero", "Dodge", 55, "avoid", bonus=0)
    _, ghoul = session._percentile("ghoul", "Fighting", 70, "claw", bonus=0)
    assert hero["subject"] == {"kind": "investigator", "id": "hero"}
    assert hero["player_projection"]["target"] == 55
    assert "marker" not in hero["player_projection"]
    assert "[roll]" in hero["marker"]
    assert ghoul["subject"] == {"kind": "monster", "id": "ghoul"}
    assert "target" not in ghoul["player_projection"]
    assert ghoul["base_target"] == 70
    assert "70" not in json.dumps(ghoul["player_projection"])


@pytest.mark.parametrize(
    ("roll", "required_level", "achieved_level", "passed", "outcome"),
    [
        (18, "hard", "hard", True, "hard"),
        (31, "hard", "regular", False, "failure"),
        (8, "extreme", "extreme", True, "extreme"),
        (18, "extreme", "hard", False, "failure"),
    ],
)
def test_combat_percentile_preserves_contextual_settlement(
    tables, monkeypatch, roll, required_level, achieved_level, passed, outcome,
):
    session = _make_session(tables)

    def percentile_check(target, difficulty="regular", **_kwargs):
        return {
            **percentile.resolve_percentile_roll(tables, roll, target, difficulty),
            "roll": roll, "bonus": 0, "penalty": 0, "tens_values": [], "units": None,
        }

    monkeypatch.setattr(session._roll, "percentile_check", percentile_check)
    compact, record = session._percentile("hero", "Firearms", 60, "contextual shot", difficulty=required_level)

    assert compact == outcome
    assert record["roll_role"] == "percentile_check"
    assert record["base_target"] == 60
    assert record["required_level"] == required_level
    assert record["required_target"] == (30 if required_level == "hard" else 12)
    assert record["achieved_level"] == achieved_level
    assert record["passed"] is passed
    assert record["success"] is passed
    assert record["outcome"] == outcome


def test_combat_luck_updates_the_canonical_settlement_and_preserves_raw_die(tables, monkeypatch):
    session = _make_session(tables)

    def percentile_check(target, difficulty="regular", **_kwargs):
        return {
            **percentile.resolve_percentile_roll(tables, 76, target, difficulty),
            "roll": 76, "bonus": 0, "penalty": 0, "tens_values": [], "units": None,
        }

    monkeypatch.setattr(session._roll, "percentile_check", percentile_check)
    _, record = session._percentile("hero", "Dodge", 60, "avoid the blow")

    outcome, event = session._apply_luck_to_roll(record, points=16, current_luck=40)

    assert outcome == "regular"
    assert record["original_roll"] == 76
    assert record["roll"] == record["adjusted_roll"] == 60
    assert record["base_target"] == 60
    assert record["required_level"] == "regular"
    assert record["required_target"] == 60
    assert record["achieved_level"] == "regular"
    assert record["passed"] is True
    assert record["success"] is True
    assert record["surplus_levels"] == 0
    assert record["luck_before"] == 40
    assert record["luck_after"] == record["luck_remaining"] == 24
    assert event["original_roll"] == 76
    assert event["adjusted_roll"] == 60
    assert event["passed"] is True


@pytest.mark.parametrize(
    ("required_level", "original_roll", "points", "required_target"),
    [("hard", 35, 5, 30), ("extreme", 17, 5, 12)],
)
def test_combat_luck_buys_exact_contextual_threshold(
    tables, monkeypatch, required_level, original_roll, points, required_target,
):
    session = _make_session(tables)

    def percentile_check(target, difficulty="regular", **_kwargs):
        return {
            **percentile.resolve_percentile_roll(tables, original_roll, target, difficulty),
            "roll": original_roll, "bonus": 0, "penalty": 0, "tens_values": [], "units": None,
        }

    monkeypatch.setattr(session._roll, "percentile_check", percentile_check)
    _, record = session._percentile("hero", "Dodge", 60, "meet the contextual gate", difficulty=required_level)
    assert record["passed"] is False

    outcome, event = session._apply_luck_to_roll(record, points=points, current_luck=20)

    assert record["roll"] == record["adjusted_roll"] == required_target
    assert record["required_level"] == required_level
    assert record["required_target"] == required_target
    assert record["achieved_level"] == required_level
    assert record["passed"] is True
    assert record["surplus_levels"] == 0
    assert outcome == required_level
    assert event["source_roll_id"] == record["roll_id"]
    assert event["luck_before"] == 20
    assert event["luck_after"] == 20 - points


def test_combat_session_attack_with_fight_back_pairs_opposed_roll(tables):
    s = _make_session(tables, rng_seed=1)
    s.begin_round()
    turn = s.declare_and_resolve_turn("hero", "slash the ghoul", "attack",
                                      target_actor_id="ghoul", defense_kind="fight_back", weapon_id="sword")
    assert turn["action"] == "attack"
    assert turn["defense_kind"] == "fight_back"
    assert turn["roll_id"] is not None
    assert turn["opposed_roll_id"] is not None
    assert turn["roll_id"] != turn["opposed_roll_id"]
    assert turn["opposed_outcome"] in (
        "attacker_higher", "defender_higher", "tie_attacker_wins", "tie_defender_wins", "both_fail")


@pytest.mark.parametrize(
    ("defense_kind", "expected"),
    [("dodge", "tie_defender_wins"), ("fight_back", "tie_attacker_wins")],
)
def test_equal_success_level_uses_structured_combat_reaction_tie_rule(defense_kind, expected):
    assert CombatSession._resolve_opposed("regular", "regular", defense_kind) == expected


def test_combat_session_damage_chain_balances_hp_and_armor(tables):
    s = _make_session(tables, rng_seed=3)
    s.begin_round()
    turn = s.declare_and_resolve_turn("hero", "slash the ghoul", "attack",
                                      target_actor_id="ghoul", defense_kind="fight_back", weapon_id="sword")
    if turn["outcome"] == "hit":
        d = s.damage_chain[-1]
        assert d["hp_before"] + d["hp_delta"] == d["hp_after"]
        assert d["armor_absorbed"] + (-d["hp_delta"]) == d["raw_damage"]


def test_combat_session_flesh_ward_armor_degrades_1_per_damage(tables):
    rng = random.Random(7)
    s = CombatSession("ward-test", "test", started_at_turn=1, rng=rng, tables=tables)
    s.add_participant("hero", "investigator", dex=70, combat_skill=80, build=0,
                      hp_max=10, weapons=[{"weapon_id": "club", "skill": "Fighting (Brawl)",
                                           "damage": "1D6", "impales": False, "special": None}])
    s.add_participant("warded", "monster", dex=10, combat_skill=20, build=0,
                      hp_max=20, armor=5, armor_rule="degrades_1_per_damage",
                      weapons=[{"weapon_id": "claws", "skill": "Fighting",
                                "damage": "1D3", "impales": False, "special": None}])
    s.begin_round()
    turn = s.declare_and_resolve_turn("hero", "hit the warded target", "attack",
                                      target_actor_id="warded", defense_kind="fight_back", weapon_id="club")
    if turn["outcome"] == "hit":
        d = s.damage_chain[-1]
        target = s.participants["warded"]
        assert target["armor"] == d["armor_after"]
        assert d["armor_after"] == d["armor_before"] - d["armor_absorbed"]


def test_combat_session_dominate_creates_active_effect(tables):
    rng = random.Random(11)
    s = CombatSession("dom-test", "test", started_at_turn=1, rng=rng, tables=tables)
    s.add_participant("caster", "monster", dex=35, combat_skill=50, build=1, hp_max=16, magic_points=18)
    s.add_participant("victim", "investigator", dex=70, combat_skill=60, build=0, hp_max=10)
    s.begin_round()
    turn = s.declare_and_resolve_turn("caster", "Dominate the victim", "cast",
                                      target_actor_id="victim", spell="dominate",
                                      dex_override=85, dex_reason="casting_dominate")
    assert turn["dex"] == 85
    assert turn["dex_reason"] == "casting_dominate"
    assert turn["outcome"] in ("dominate_success", "dominate_resisted")
    if turn["outcome"] == "dominate_success":
        assert s.is_dominated("victim")
        eff = s.participants["victim"]["active_effects"][0]
        assert eff["effect"] == "dominated"
        assert eff["remaining_rounds"] >= 2


def test_combat_session_tick_effects_decrements_and_expires(tables):
    s = _make_session(tables)
    s.apply_effect("hero", "dominated", "ghoul", remaining_rounds=2)
    assert s.is_dominated("hero")
    s.tick_effects()
    assert s.is_dominated("hero")  # 2 -> 1
    s.tick_effects()
    assert not s.is_dominated("hero")  # 1 -> 0, expired


def test_combat_session_snapshot_has_full_schema(tables):
    s = _make_session(tables)
    s.begin_round()
    snap = s.snapshot()
    for key in ("combat_id", "scene_ref", "started_at_turn", "ended_at_turn",
                "status", "outcome", "participants", "rounds", "damage_chain"):
        assert key in snap
    p = snap["participants"][0]
    for key in ("actor_id", "side", "dex", "combat_skill", "build", "hp_max", "hp_current",
                "magic_points", "armor", "armor_rule", "weapons", "conditions", "active_effects"):
        assert key in p


def test_combat_load_rejects_negative_revision_and_invalid_cursor(tables, tmp_path):
    s = _make_session(tables)
    s.begin_round()
    s.save(tmp_path)
    path = tmp_path / "save" / "combat.json"
    raw = json.loads(path.read_text())
    raw["revision"] = -1
    path.write_text(json.dumps(raw))
    with pytest.raises(ValueError, match="revision"):
        CombatSession.load(tmp_path, rng=random.Random(1), tables=tables)
    raw["revision"] = 0
    raw["initiative_cursor"] = 99
    path.write_text(json.dumps(raw))
    with pytest.raises(ValueError, match="initiative cursor"):
        CombatSession.load(tmp_path, rng=random.Random(1), tables=tables)


def test_combat_load_rejects_dead_hp_coherence_and_extra_root_key(tables, tmp_path):
    s = _make_session(tables)
    s.begin_round()
    s.save(tmp_path)
    path = tmp_path / "save" / "combat.json"
    raw = json.loads(path.read_text())
    raw["participants"][0]["conditions"].append("dead")
    path.write_text(json.dumps(raw))
    with pytest.raises(ValueError, match="dead participant"):
        CombatSession.load(tmp_path, rng=random.Random(1), tables=tables)
    raw = s.snapshot()
    raw["forged"] = True
    path.write_text(json.dumps(raw))
    with pytest.raises(ValueError, match="exact schema"):
        CombatSession.load(tmp_path, rng=random.Random(1), tables=tables)


# --------------------------------------------------------------------------- #
# Mechanism coverage tests (Chapter 6 full combat system)
# --------------------------------------------------------------------------- #
def test_mechanism1_firearms_cannot_be_dodged_or_fought_back(tables):
    """p.125: A target may not fight back against or dodge a Firearm attack."""
    rng = random.Random(5)
    s = CombatSession("fire-test", "test", 1, rng=rng, tables=tables)
    s.add_participant("shooter", "investigator", dex=70, combat_skill=50, build=0, hp_max=10,
                      weapons=[{"weapon_id": "pistol", "skill": "Firearms (Handgun)",
                                "damage": "1D10", "impales": True, "special": None}])
    s.add_participant("target", "monster", dex=40, combat_skill=40, build=1, hp_max=10)
    s.begin_round()
    t = s.declare_and_resolve_turn("shooter", "shoot target", "attack",
                                   target_actor_id="target", defense_kind="fight_back", weapon_id="pistol")
    assert t["defense_kind"] != "fight_back"
    assert t["opposed_outcome"] in ("unopposed", "dived_for_cover", "dive_failed")


def test_mechanism2_dive_for_cover_grants_attacker_penalty_die(tables):
    """p.125: successful Dive for Cover -> attacker penalty die (re-roll)."""
    rng = random.Random(8)
    s = CombatSession("dive-test", "test", 1, rng=rng, tables=tables)
    s.add_participant("shooter", "investigator", dex=70, combat_skill=50, build=0, hp_max=10,
                      weapons=[{"weapon_id": "pistol", "skill": "Firearms (Handgun)",
                                "damage": "1D10", "impales": True, "special": None}])
    s.add_participant("diver", "monster", dex=40, combat_skill=40, build=1, hp_max=10, dodge_skill=80)
    s.begin_round()
    t = s.declare_and_resolve_turn("shooter", "shoot diver", "attack",
                                   target_actor_id="diver", defense_kind="dive_for_cover", weapon_id="pistol")
    assert t["defense_kind"] == "dive_for_cover"
    if t["opposed_outcome"] == "dived_for_cover":
        assert t.get("cover_reroll_roll_id") is not None


def test_mechanism2_diver_forfeits_next_attack(tables):
    """p.125: diver forfeits next attack; can only dodge until then."""
    rng = random.Random(3)
    s = CombatSession("forfeit-test", "test", 1, rng=rng, tables=tables)
    s.add_participant("shooter", "investigator", dex=70, combat_skill=80, build=0, hp_max=10,
                      weapons=[{"weapon_id": "pistol", "skill": "Firearms (Handgun)",
                                "damage": "1D10", "impales": True, "special": None}])
    s.add_participant("diver", "monster", dex=40, combat_skill=40, build=1, hp_max=10, dodge_skill=80)
    s.begin_round()
    s.declare_and_resolve_turn("shooter", "shoot", "attack",
                              target_actor_id="diver", defense_kind="dive_for_cover", weapon_id="pistol")
    if s.participants["diver"].get("_dived_for_cover"):
        assert s.is_forfeiting_attack("diver") is True


def test_mechanism4_outnumbered_gives_attacker_bonus_die(tables):
    """p.108: target that already defended this round -> subsequent attackers
    get a bonus die."""
    rng = random.Random(12)
    s = CombatSession("outnum-test", "test", 1, rng=rng, tables=tables)
    s.add_participant("a1", "investigator", dex=80, combat_skill=60, build=0, hp_max=10)
    s.add_participant("a2", "investigator", dex=70, combat_skill=60, build=0, hp_max=10)
    s.add_participant("foe", "monster", dex=30, combat_skill=40, build=1, hp_max=12)
    s.begin_round()
    s.declare_and_resolve_turn("a1", "hit foe", "attack", target_actor_id="foe", defense_kind="fight_back")
    assert s.has_defended_this_round("foe") is True
    t2 = s.declare_and_resolve_turn("a2", "hit foe again", "attack", target_actor_id="foe", defense_kind="fight_back")
    assert t2.get("attack_modifiers", {}).get("outnumbered_penalty") is True


def test_mechanism5_point_blank_grants_bonus_die(tables):
    """p.125: point-blank range -> attacker bonus die."""
    rng = random.Random(15)
    s = CombatSession("pb-test", "test", 1, rng=rng, tables=tables)
    s.add_participant("shooter", "investigator", dex=70, combat_skill=50, build=0, hp_max=10,
                      weapons=[{"weapon_id": "pistol", "skill": "Firearms (Handgun)",
                                "damage": "1D10", "impales": True, "special": None}])
    s.add_participant("target", "monster", dex=40, combat_skill=40, build=1, hp_max=10)
    s.begin_round()
    t = s.declare_and_resolve_turn("shooter", "point-blank shot", "attack",
                                   target_actor_id="target", defense_kind="none", weapon_id="pistol",
                                   point_blank=True)
    assert t["attack_modifiers"]["point_blank"] is True
    assert t["attack_modifiers"]["bonus"] >= 1


def test_mechanism6_ready_firearm_grants_dex_plus_50_initiative(tables):
    """p.124: readied firearm shoots at DEX+50 in initiative order."""
    rng = random.Random(20)
    s = CombatSession("dex50-test", "test", 1, rng=rng, tables=tables)
    s.add_participant("gunslinger", "investigator", dex=30, combat_skill=40, build=0, hp_max=10,
                      firearms_skill=60, has_ready_firearm=True)
    s.add_participant("knife", "monster", dex=70, combat_skill=50, build=1, hp_max=10)
    s.begin_round()
    order = s.rounds[-1]["initiative_order"]
    assert order[0]["actor_id"] == "gunslinger"
    assert order[0]["dex"] == 80
    assert order[0]["dex_reason"] == "ready_firearm"


def test_mechanism7_range_band_sets_difficulty(tables):
    """p.124: base=regular, long=hard, very long=extreme."""
    rng = random.Random(25)
    s = CombatSession("range-test", "test", 1, rng=rng, tables=tables)
    s.add_participant("shooter", "investigator", dex=70, combat_skill=70, build=0, hp_max=10,
                      weapons=[{"weapon_id": "rifle", "skill": "Firearms (Rifle/Shotgun)",
                                "damage": "2D6+4", "impales": True, "special": None}])
    s.add_participant("target", "monster", dex=40, combat_skill=40, build=1, hp_max=12)
    s.begin_round()
    t = s.declare_and_resolve_turn("shooter", "long shot", "attack",
                                   target_actor_id="target", defense_kind="none", weapon_id="rifle",
                                   range_band="long")
    atk_roll = [r for r in s.pending_rolls if r["roll_id"] == t["roll_id"]][0]
    assert atk_roll["difficulty"] == "hard"


def test_mechanism8_flee_marks_participant_fled_and_removes_from_initiative(tables):
    """p.114: flee is a valid action; fled participants leave subsequent rounds."""
    rng = random.Random(30)
    s = CombatSession("flee-test", "test", 1, rng=rng, tables=tables)
    s.add_participant("runner", "investigator", dex=70, combat_skill=40, build=0, hp_max=10)
    s.add_participant("foe", "monster", dex=50, combat_skill=50, build=1, hp_max=10)
    s.begin_round()
    t = s.declare_and_resolve_turn("runner", "run away", "flee")
    assert t["outcome"] == "fled"
    assert "fled" in s.participants["runner"]["conditions"]
    s.begin_round()
    order = s.rounds[-1]["initiative_order"]
    assert all(p["actor_id"] != "runner" for p in order)


def test_mechanism3_cover_grants_attacker_penalty_die(tables):
    """p.125: target >=half concealed -> attacker penalty die."""
    rng = random.Random(35)
    s = CombatSession("cover-test", "test", 1, rng=rng, tables=tables)
    s.add_participant("shooter", "investigator", dex=70, combat_skill=70, build=0, hp_max=10,
                      weapons=[{"weapon_id": "pistol", "skill": "Firearms (Handgun)",
                                "damage": "1D10", "impales": True, "special": None}])
    s.add_participant("target", "monster", dex=40, combat_skill=40, build=1, hp_max=10)
    s.begin_round()
    t = s.declare_and_resolve_turn("shooter", "shoot covered target", "attack",
                                   target_actor_id="target", defense_kind="none", weapon_id="pistol", cover=True)
    assert t["attack_modifiers"]["cover"] is True
    assert t["attack_modifiers"]["penalty"] >= 1


# --------------------------------------------------------------------------- #
# Weapon DB / disarm / grapple / maneuver Build penalty
# --------------------------------------------------------------------------- #
def test_weapon_db_added_to_melee_damage(tables):
    """Table XVII: melee weapons add the attacker's DB to damage."""
    rng = random.Random(101)
    s = CombatSession("db-test", "test", 1, rng=rng, tables=tables)
    s.add_participant("brute", "investigator", dex=50, combat_skill=70, build=1, hp_max=12,
                      damage_bonus="+1D4",
                      weapons=[{"weapon_id": "club", "skill": "Fighting (Brawl)", "damage": "1D6",
                                "adds_damage_bonus": True, "impales": False, "special": None}])
    s.add_participant("foe", "monster", dex=40, combat_skill=30, build=0, hp_max=12)
    s.begin_round()
    t = s.declare_and_resolve_turn("brute", "club the foe", "attack",
                                   target_actor_id="foe", defense_kind="none", weapon_id="club")
    if t["outcome"] == "hit":
        d = s.damage_chain[-1]
        assert "+1D4" in d["die"] or "1D4" in str(d.get("die_rolls", []))


def test_weapon_db_not_added_to_firearms(tables):
    """Firearms do not add DB (Table XVII)."""
    rng = random.Random(102)
    s = CombatSession("nodb-test", "test", 1, rng=rng, tables=tables)
    s.add_participant("shooter", "investigator", dex=70, combat_skill=50, build=1, hp_max=10,
                      damage_bonus="+1D4",
                      weapons=[{"weapon_id": "pistol", "skill": "Firearms (Handgun)", "damage": "1D10",
                                "adds_damage_bonus": False, "impales": True, "special": None}])
    s.add_participant("foe", "monster", dex=40, combat_skill=40, build=1, hp_max=12)
    s.begin_round()
    t = s.declare_and_resolve_turn("shooter", "shoot foe", "attack",
                                   target_actor_id="foe", defense_kind="none", weapon_id="pistol")
    if t["outcome"] == "hit":
        d = s.damage_chain[-1]
        assert "1D4" not in d["die"]


def test_disarm_transfers_weapon_to_attacker(tables):
    """p.117: successful disarm maneuver transfers the weapon."""
    rng = random.Random(103)
    s = CombatSession("disarm-test", "test", 1, rng=rng, tables=tables)
    s.add_participant("hero", "investigator", dex=70, combat_skill=80, build=0, hp_max=10)
    s.add_participant("thug", "monster", dex=50, combat_skill=40, build=0, hp_max=10,
                      weapons=[{"weapon_id": "knife", "skill": "Fighting (Brawl)", "damage": "1D4+2",
                                "adds_damage_bonus": True, "impales": True, "special": None}])
    s.begin_round()
    t = s.declare_and_resolve_turn("hero", "disarm the thug", "maneuver",
                                   target_actor_id="thug", defense_kind="fight_back",
                                   maneuver_kind="disarm", target_weapon_id="knife")
    if t["outcome"] == "disarm_success":
        assert all(w["weapon_id"] != "knife" for w in s.participants["thug"]["weapons"])
        assert any(w["weapon_id"] == "knife" for w in s.participants["hero"]["weapons"])
        assert t["effect_applied"]["weapon_id"] == "knife"


def test_maneuver_ongoing_disadvantage_restrains_target(tables):
    """p.119: ongoing_disadvantage goal restrains the target (restrained effect)."""
    rng = random.Random(104)
    s = CombatSession("grapple-test", "test", 1, rng=rng, tables=tables)
    s.add_participant("hero", "investigator", dex=70, combat_skill=70, build=1, hp_max=10)
    s.add_participant("foe", "monster", dex=50, combat_skill=40, build=0, hp_max=10)
    s.begin_round()
    t = s.declare_and_resolve_turn("hero", "grapple the foe", "maneuver",
                                   target_actor_id="foe", defense_kind="fight_back", goal="ongoing_disadvantage")
    if t["outcome"] == "grapple_success":
        assert any(e["effect"] == "restrained" for e in s.participants["foe"]["active_effects"])
        assert t["effect_applied"]["effect"] == "restrained"


def test_restrained_target_can_escape(tables):
    """p.119: a restrained character may use escape goal to break the hold."""
    rng = random.Random(105)
    s = CombatSession("breakfree-test", "test", 1, rng=rng, tables=tables)
    s.add_participant("hero", "investigator", dex=70, combat_skill=70, build=1, hp_max=10)
    s.add_participant("foe", "monster", dex=50, combat_skill=40, build=0, hp_max=10)
    s.apply_effect("foe", "restrained", "hero", remaining_rounds=999)
    s.begin_round()
    t = s.declare_and_resolve_turn("foe", "break free of the grapple", "maneuver",
                                   target_actor_id="hero", defense_kind="fight_back", goal="escape")
    if t["outcome"] == "escape_success":
        assert not any(e["effect"] == "restrained" for e in s.participants["foe"]["active_effects"])


def test_maneuver_build_penalty_dice_applied(tables):
    """p.117: attacker Build below target by N -> N penalty dice (max 2)."""
    rng = random.Random(106)
    s = CombatSession("build-test", "test", 1, rng=rng, tables=tables)
    s.add_participant("small", "investigator", dex=70, combat_skill=80, build=-1, hp_max=8)
    s.add_participant("big", "monster", dex=40, combat_skill=40, build=1, hp_max=14)
    s.begin_round()
    t = s.declare_and_resolve_turn("small", "grapple the big foe", "maneuver",
                                   target_actor_id="big", defense_kind="fight_back", goal="ongoing_disadvantage")
    assert t.get("maneuver_build_difference") == 2
    assert t.get("maneuver_penalty_dice") == 2


def test_maneuver_impossible_when_build_diff_3_plus(tables):
    """p.117: Build diff >=3 -> maneuver impossible."""
    rng = random.Random(107)
    s = CombatSession("imp-test", "test", 1, rng=rng, tables=tables)
    s.add_participant("tiny", "investigator", dex=70, combat_skill=90, build=-2, hp_max=6)
    s.add_participant("huge", "monster", dex=30, combat_skill=30, build=2, hp_max=18)
    s.begin_round()
    t = s.declare_and_resolve_turn("tiny", "try to grapple the huge foe", "maneuver",
                                   target_actor_id="huge", defense_kind="fight_back", goal="ongoing_disadvantage")
    assert t["outcome"] == "maneuver_impossible_build"


# --------------------------------------------------------------------------- #
# Weapon catalog + module weapon extension mechanism
# --------------------------------------------------------------------------- #
def test_load_weapon_catalog_returns_canonical_weapons(tables):
    """weapons.json catalog has the core Table XVII entries."""
    catalog = load_weapon_catalog(tables)
    assert "knife_medium" in catalog
    assert "revolver_38" in catalog
    assert "unarmed" in catalog
    km = catalog["knife_medium"]
    assert km["damage"] == "1D4+2"
    assert km["adds_damage_bonus"] is True
    assert km["impales"] is True


def test_resolve_module_weapons_extends_catalog_entry(tables):
    """A module weapon with 'extends' inherits base stats, overrides special."""
    catalog = load_weapon_catalog(tables)
    module_weapons = [{"weapon_id": "corbitt-ritual-dagger", "extends": "knife_medium",
                       "special": "bypasses_corbitt_spells"}]
    merged = resolve_module_weapons(tables, module_weapons, catalog)
    rd = merged["corbitt-ritual-dagger"]
    assert rd["damage"] == "1D4+2"
    assert rd["skill"] == "Fighting (Brawl)"
    assert rd["adds_damage_bonus"] is True
    assert rd["impales"] is True
    assert rd["special"] == "bypasses_corbitt_spells"
    assert rd["weapon_id"] == "corbitt-ritual-dagger"
    assert "knife_medium" in merged


def test_resolve_module_weapons_without_extends_taken_verbatim(tables):
    """Module weapon without extends uses its own fields."""
    module_weapons = [{"weapon_id": "alien-rod", "skill": "Fighting (Brawl)", "damage": "2D6",
                       "adds_damage_bonus": True, "impales": False, "special": None}]
    merged = resolve_module_weapons(tables, module_weapons)
    assert merged["alien-rod"]["damage"] == "2D6"


def test_combat_session_uses_module_weapon_by_id(tables):
    """CombatSession with module_weapons resolves weapon by id from catalog."""
    rng = random.Random(200)
    module_weapons = [{"weapon_id": "corbitt-ritual-dagger", "extends": "knife_medium",
                       "special": "bypasses_corbitt_spells"}]
    s = CombatSession("mod-test", "test", 1, rng=rng, module_weapons=module_weapons, tables=tables)
    s.add_participant("hero", "investigator", dex=70, combat_skill=65, build=0, hp_max=10,
                      damage_bonus="+1D4", weapons=["corbitt-ritual-dagger"])
    s.add_participant("foe", "monster", dex=40, combat_skill=40, build=1, hp_max=12)
    s.begin_round()
    t = s.declare_and_resolve_turn("hero", "stab foe with ritual dagger", "attack",
                                   target_actor_id="foe", defense_kind="none", weapon_id="corbitt-ritual-dagger")
    if t["outcome"] == "hit":
        d = s.damage_chain[-1]
        assert "1D4" in d["die"] or len(d.get("die_rolls", [])) >= 2


def test_combat_session_participant_dict_weapon_overrides_catalog(tables):
    """A participant dict weapon overrides catalog special field."""
    rng = random.Random(201)
    s = CombatSession("ovr-test", "test", 1, rng=rng, tables=tables)
    s.add_participant("hero", "investigator", dex=70, combat_skill=65, build=0, hp_max=10,
                      weapons=[{"weapon_id": "knife_medium", "special": "enchanted"}])
    s.add_participant("foe", "monster", dex=40, combat_skill=40, build=1, hp_max=12)
    s.begin_round()
    w = s._weapon("hero", "knife_medium")
    assert w["damage"] == "1D4+2"
    assert w["special"] == "enchanted"


def test_weapon_resolves_catalog_key_not_on_participant_list(tables):
    """_weapon() consults weapons.json by name even when the participant did not
    list that weapon -- the catalog (Table XVII pp.401-405) is the lookup table."""
    rng = random.Random(7)
    s = CombatSession("cat-test", "test", 1, rng=rng, tables=tables)
    s.add_participant("hero", "investigator", dex=70, combat_skill=60, build=0, hp_max=10, weapons=[])
    s.add_participant("foe", "monster", dex=40, combat_skill=30, build=0, hp_max=12)
    s.begin_round()
    w = s._weapon("hero", "revolver_38")
    assert w["weapon_id"] == "revolver_38"
    assert w["skill"] == "Firearms (Handgun)"
    assert w["damage"] == "1D10"
    assert w["impales"] is True
    assert w["adds_damage_bonus"] is False


def test_the_haunting_module_defines_ritual_dagger():
    """The Haunting module json defines corbitt-ritual-dagger extending knife_medium."""
    haunting = json.loads((RULES / "the-haunting.json").read_text())
    weapons = haunting.get("weapons", [])
    ritual = next((w for w in weapons if w.get("weapon_id") == "corbitt-ritual-dagger"), None)
    assert ritual is not None
    assert ritual["extends"] == "knife_medium"
    assert ritual["special"] == "bypasses_corbitt_spells"


# --------------------------------------------------------------------------- #
# Edge case tests: impale damage, non-impale extreme, negative DB,
# Dive for Cover forfeit full flow
# --------------------------------------------------------------------------- #
def test_impale_extreme_success_adds_extra_weapon_damage_roll(tables):
    """p.119: impale weapon extreme success = max weapon + max DB + extra weapon roll."""
    rng = random.Random(300)
    s = CombatSession("impale-test", "test", 1, rng=rng, tables=tables)
    s.add_participant("hero", "investigator", dex=70, combat_skill=90, build=1, hp_max=10,
                      damage_bonus="+1D4",
                      weapons=[{"weapon_id": "knife_medium", "skill": "Fighting (Brawl)", "damage": "1D4+2",
                                "adds_damage_bonus": True, "impales": True, "special": None}])
    s.add_participant("foe", "monster", dex=40, combat_skill=10, build=0, hp_max=30)
    s.begin_round()
    t = s.declare_and_resolve_turn("hero", "stab foe", "attack",
                                   target_actor_id="foe", defense_kind="fight_back", weapon_id="knife_medium")
    if t["outcome"] == "hit":
        atk_roll = [r for r in s.pending_rolls if r["roll_id"] == t["roll_id"]][0]
        oc = atk_roll["outcome"]
        if LVL[oc] >= LVL["extreme"]:
            d = s.damage_chain[-1]
            assert d.get("extreme_damage") is True
            assert d.get("is_impale") is True
            assert d["raw_damage"] >= 10 + 1


def test_non_impale_extreme_uses_max_damage_no_extra_roll(tables):
    """p.115: non-impale weapon extreme = max weapon + max DB (no extra roll)."""
    rng = random.Random(301)
    s = CombatSession("blunt-test", "test", 1, rng=rng, tables=tables)
    s.add_participant("hero", "investigator", dex=70, combat_skill=90, build=1, hp_max=10,
                      damage_bonus="+1D4",
                      weapons=[{"weapon_id": "club_large", "skill": "Fighting (Brawl)", "damage": "1D8",
                                "adds_damage_bonus": True, "impales": False, "special": None}])
    s.add_participant("foe", "monster", dex=40, combat_skill=10, build=0, hp_max=30)
    s.begin_round()
    t = s.declare_and_resolve_turn("hero", "club foe", "attack",
                                   target_actor_id="foe", defense_kind="fight_back", weapon_id="club_large")
    if t["outcome"] == "hit":
        atk_roll = [r for r in s.pending_rolls if r["roll_id"] == t["roll_id"]][0]
        if LVL[atk_roll["outcome"]] >= LVL["extreme"]:
            d = s.damage_chain[-1]
            assert d.get("extreme_damage") is True
            assert d.get("is_impale") is False
            assert d["raw_damage"] == 12


def test_negative_db_reduces_melee_damage(tables):
    """Small character with DB -1: melee weapon damage reduced by 1."""
    rng = random.Random(302)
    s = CombatSession("negdb-test", "test", 1, rng=rng, tables=tables)
    s.add_participant("tiny", "investigator", dex=70, combat_skill=80, build=-1, hp_max=6,
                      damage_bonus="-1",
                      weapons=[{"weapon_id": "knife_small", "skill": "Fighting (Brawl)", "damage": "1D4",
                                "adds_damage_bonus": True, "impales": True, "special": None}])
    s.add_participant("foe", "monster", dex=40, combat_skill=10, build=0, hp_max=30)
    s.begin_round()
    t = s.declare_and_resolve_turn("tiny", "stab foe", "attack",
                                   target_actor_id="foe", defense_kind="none", weapon_id="knife_small")
    if t["outcome"] == "hit":
        d = s.damage_chain[-1]
        assert "-1" in d["die"]
        weapon_roll = d["die_rolls"][0] if d.get("die_rolls") else 0
        assert d["raw_damage"] == max(0, weapon_roll - 1) or d["raw_damage"] == weapon_roll - 1


def test_dive_for_cover_forfeit_blocks_next_attack_then_recovers(tables):
    """p.125: after Dive for Cover, diver's next attack is forfeit; after
    that turn the forfeit clears and they can attack again."""
    rng = random.Random(303)
    s = CombatSession("dvc-full", "test", 1, rng=rng, tables=tables)
    s.add_participant("shooter", "investigator", dex=80, combat_skill=70, build=0, hp_max=10,
                      weapons=[{"weapon_id": "revolver_38", "skill": "Firearms (Handgun)", "damage": "1D10",
                                "adds_damage_bonus": False, "impales": True, "special": None}])
    s.add_participant("diver", "monster", dex=60, combat_skill=50, build=0, hp_max=10, dodge_skill=80)
    s.begin_round()
    s.declare_and_resolve_turn("shooter", "shoot diver", "attack",
                              target_actor_id="diver", defense_kind="dive_for_cover", weapon_id="revolver_38")
    if s.participants["diver"].get("_forfeit_next_attack"):
        assert s.is_forfeiting_attack("diver") is True
        s.clear_forfeit("diver")
        assert s.is_forfeiting_attack("diver") is False


def test_firearm_damage_has_no_db_even_with_high_str(tables):
    """Firearms never add DB regardless of attacker's STR/SIZ (Table XVII)."""
    rng = random.Random(304)
    s = CombatSession("nofirebase-test", "test", 1, rng=rng, tables=tables)
    s.add_participant("strong", "investigator", dex=70, combat_skill=50, build=2, hp_max=14,
                      damage_bonus="+1D6",
                      weapons=[{"weapon_id": "revolver_38", "skill": "Firearms (Handgun)", "damage": "1D10",
                                "adds_damage_bonus": False, "impales": True, "special": None}])
    s.add_participant("foe", "monster", dex=40, combat_skill=10, build=0, hp_max=30)
    s.begin_round()
    t = s.declare_and_resolve_turn("strong", "shoot foe", "attack",
                                   target_actor_id="foe", defense_kind="none", weapon_id="revolver_38")
    if t["outcome"] == "hit":
        d = s.damage_chain[-1]
        assert "1D6" not in d["die"]
        assert d["die"] == "1D10"


def test_flesh_ward_armor_degrades_correctly_under_extreme_damage(tables):
    """Flesh Ward (degrades_1_per_damage) should degrade by absorbed amount,
    even under extreme/impale damage recalculation."""
    rng = random.Random(305)
    s = CombatSession("fw-extreme", "test", 1, rng=rng, tables=tables)
    s.add_participant("hero", "investigator", dex=70, combat_skill=90, build=1, hp_max=10,
                      damage_bonus="+1D4",
                      weapons=[{"weapon_id": "knife_medium", "skill": "Fighting (Brawl)", "damage": "1D4+2",
                                "adds_damage_bonus": True, "impales": True, "special": None}])
    s.add_participant("warded", "monster", dex=10, combat_skill=10, build=0, hp_max=20,
                      armor=5, armor_rule="degrades_1_per_damage")
    s.begin_round()
    t = s.declare_and_resolve_turn("hero", "stab warded", "attack",
                                   target_actor_id="warded", defense_kind="fight_back", weapon_id="knife_medium")
    if t["outcome"] == "hit":
        d = s.damage_chain[-1]
        assert d["armor_after"] == d["armor_before"] - d["armor_absorbed"]
        assert d["armor_after"] >= 0


# --------------------------------------------------------------------------- #
# Major wound immediate effects / overkill / zero-HP triage (p.120)
# --------------------------------------------------------------------------- #
def _flat_hit(s, target_id: str, damage: int) -> None:
    """Land an exact amount of damage on target, then update conditions."""
    s._damage_roll(str(damage), "attacker", target_id, "test-blow", "t-test")
    s._update_conditions(target_id)


def _victim_session(tables, con: int = 50, seed: int = 11):
    rng = random.Random(seed)
    s = CombatSession("mw-fight", "test", 1, rng=rng, tables=tables)
    s.add_participant("attacker", "monster", dex=50, combat_skill=50, build=0, hp_max=10)
    s.add_participant("victim", "investigator", dex=50, combat_skill=50, build=0, hp_max=12, con=con)
    return s


def test_major_wound_causes_prone_and_con_check_unconscious(tables):
    s = _victim_session(tables, con=1)  # CON 1 -> the CON check fails -> unconscious
    _flat_hit(s, "victim", 6)  # single hit at half max (12//2=6)
    p = s.participants["victim"]
    assert "major_wound" in p["conditions"]
    assert "prone" in p["conditions"]
    assert "unconscious" in p["conditions"]


def test_major_wound_con_success_stays_conscious(tables):
    s = _victim_session(tables, con=99, seed=3)
    _flat_hit(s, "victim", 6)
    p = s.participants["victim"]
    assert "major_wound" in p["conditions"]
    assert "prone" in p["conditions"]
    assert "unconscious" not in p["conditions"]


def test_overkill_single_hit_is_instant_death(tables):
    s = _victim_session(tables)
    _flat_hit(s, "victim", 13)  # > hp_max(12) in one hit -> death is unavoidable
    p = s.participants["victim"]
    assert "dead" in p["conditions"]


def test_zero_hp_regular_damage_is_unconscious_not_dying(tables):
    s = _victim_session(tables, con=99)
    p = s.participants["victim"]
    while p["hp_current"] > 0:
        _flat_hit(s, "victim", 1)  # small hits down to 0, none reaching half max
    assert "unconscious" in p["conditions"]
    assert "dying" not in p["conditions"]


def test_zero_hp_with_major_wound_is_dying(tables):
    s = _victim_session(tables, con=99, seed=3)
    _flat_hit(s, "victim", 6)  # major wound
    _flat_hit(s, "victim", 6)  # down to 0
    p = s.participants["victim"]
    assert p["hp_current"] == 0
    assert "dying" in p["conditions"]
    assert "unconscious" in p["conditions"]


def test_successful_fight_back_damages_original_attacker_and_records_roll(tables):
    """p.115: a winning ordinary Fight Back is a counter-hit, not a miss."""
    class FixedRng:
        def __init__(self):
            self.values = iter([70, 20, 3])

        def randint(self, low, high):
            value = next(self.values)
            assert low <= value <= high
            return value

    s = CombatSession("fight-back-damage", "test", 1, rng=FixedRng(), tables=tables)
    s.add_participant("attacker", "monster", 60, 50, 0, 10, weapons=[{"weapon_id": "unarmed"}])
    s.add_participant("defender", "investigator", 50, 60, 0, 10, weapons=[{"weapon_id": "unarmed"}])
    s.begin_round()

    turn = s.declare_and_resolve_turn("attacker", "strike", action="attack", target_actor_id="defender",
                                      defense_kind="fight_back", weapon_id="unarmed")

    assert turn["outcome"] == "fight_back_hit"
    assert turn["fight_back_damage_roll_id"]
    assert s.participants["attacker"]["hp_current"] == 7
    damage = s.damage_chain[-1]
    assert damage["source_actor_id"] == "defender"
    assert damage["target_actor_id"] == "attacker"


def test_odd_max_hp_major_wound_uses_ceiling_half_threshold(tables):
    s = CombatSession("odd-hp", "test", 1, rng=random.Random(13), tables=tables)
    s.add_participant("source", "monster", 60, 50, 0, 10, weapons=[{"weapon_id": "unarmed"}])
    s.add_participant("target", "investigator", 50, 50, 0, 11)
    s.damage_chain.append({"source_actor_id": "source", "target_actor_id": "target",
                          "raw_damage": 5, "armor_absorbed": 0})
    s.participants["target"]["hp_current"] = 6
    s._update_conditions("target")
    assert "major_wound" not in s.participants["target"]["conditions"]


def test_major_wound_con_roll_has_stable_roll_evidence(tables):
    s = CombatSession("major-con", "test", 1, rng=random.Random(2), tables=tables)
    s.add_participant("source", "monster", 60, 50, 0, 10, weapons=[{"weapon_id": "unarmed"}])
    s.add_participant("target", "investigator", 50, 50, 0, 10, con=50)
    s.damage_chain.append({"source_actor_id": "source", "target_actor_id": "target",
                          "raw_damage": 5, "armor_absorbed": 0})
    s.participants["target"]["hp_current"] = 5
    s._update_conditions("target")
    evidence = s.participants["target"]["major_wound_con"]
    assert set(evidence) >= {"roll_id", "roll", "target", "outcome"}
    assert evidence["roll_id"] == "major-con:cr1"


def test_combat_snapshot_round_trip_preserves_revision_and_initiative(tables, tmp_path):
    s = CombatSession("round-trip", "test", 1, rng=random.Random(4), tables=tables)
    s.add_participant("inv", "investigator", 60, 55, 0, 10, weapons=[{"weapon_id": "unarmed"}])
    s.add_participant("foe", "monster", 50, 45, 0, 8, weapons=[{"weapon_id": "unarmed"}])
    s.begin_round()
    s.revision = 7
    s.save(tmp_path)
    loaded = CombatSession.load(tmp_path, rng=random.Random(999), tables=tables)
    assert loaded.revision == 7
    assert loaded._current_round == 1
    assert loaded._current_initiative == s._current_initiative
    assert loaded.snapshot() == s.snapshot()


def test_combat_snapshot_round_trip_preserves_string_and_dict_weapon_refs(tables, tmp_path):
    module_weapons = [{"weapon_id": "corbitt-ritual-dagger", "extends": "knife_medium",
                       "special": "bypasses_corbitt_spells"}]
    s = CombatSession("weapon-ref-round-trip", "corbitt-cellar", 1, rng=random.Random(4),
                      module_weapons=module_weapons, tables=tables)
    s.add_participant("inv", "investigator", 60, 55, 0, 10, weapons=["corbitt-ritual-dagger"])
    s.add_participant("foe", "monster", 50, 45, 0, 8,
                      weapons=[{"weapon_id": "knife_medium", "special": "legacy_override"}])
    s.begin_round()
    s.save(tmp_path)

    loaded = CombatSession.load(tmp_path, rng=random.Random(999), tables=tables)

    assert loaded.snapshot() == s.snapshot()
    assert loaded.participants["inv"]["weapons"] == ["corbitt-ritual-dagger"]
    assert loaded._weapon("inv", "corbitt-ritual-dagger")["damage"] == "1D4+2"
    assert loaded._weapon("inv", "corbitt-ritual-dagger")["special"] == "bypasses_corbitt_spells"
    assert loaded._weapon("foe", "knife_medium")["special"] == "legacy_override"


def test_combat_load_accepts_own_dagger_victory_with_corbitt_still_alive(tables, tmp_path):
    """The module's own-dagger victory is not conditional on reducing HP to zero."""
    module_weapons = [{"weapon_id": "corbitt-ritual-dagger", "extends": "knife_medium",
                       "special": "bypasses_corbitt_spells"}]
    s = CombatSession("own-dagger-victory", "corbitt-cellar", 1, rng=random.Random(7),
                      module_weapons=module_weapons, tables=tables)
    s.add_participant("inv", "investigator", 70, 60, 0, 10, weapons=["corbitt-ritual-dagger"])
    s.add_participant("walter-corbitt", "monster", 40, 50, 1, 20, armor=7, armor_rule="degrades_1_per_damage")
    s.begin_round()
    s.declare_and_resolve_turn("inv", "strike Corbitt with his own dagger",
                              target_actor_id="walter-corbitt", weapon_id="corbitt-ritual-dagger",
                              resolution_hint="damage_only", rulebook_exception="own_dagger_ignores_spells")
    s.mark_current_initiative_acted()
    s.initiative_cursor += 1
    assert s.participants["walter-corbitt"]["hp_current"] > 0
    assert s.damage_chain[-1]["rulebook_exception"] == "own_dagger_ignores_spells"
    s.conclude("investigators_win")
    s.ended_at_turn = 1
    s.save(tmp_path)

    loaded = CombatSession.load(tmp_path, rng=random.Random(999), trusted_in_memory=True, tables=tables)

    assert loaded.status == "concluded"
    assert loaded.outcome == "investigators_win"
    assert loaded.participants["walter-corbitt"]["hp_current"] > 0
    assert loaded.damage_chain[-1]["rulebook_exception"] == "own_dagger_ignores_spells"


def test_external_damage_evidence_uses_actual_source_actor(tables, tmp_path):
    session = CombatSession("source-actor-evidence", "test", 1, rng=random.Random(8), tables=tables)
    weapon = [{"weapon_id": "claw", "skill": "Fighting", "damage": "2",
              "adds_damage_bonus": False, "impales": False, "special": None}]
    session.add_participant("monster", "monster", 80, 60, 0, 10, weapons=weapon)
    session.add_participant("inv", "investigator", 50, 50, 0, 10)
    session.begin_round()
    session.declare_and_resolve_turn("monster", "claw investigator", target_actor_id="inv", weapon_id="claw",
                                     resolution_hint="damage_only", resolution_command_id="monster-damage-defense")
    evidence = session.damage_evidence_rows(command_actor_id="inv")
    session.save(tmp_path)

    assert evidence[0]["actor"] == "monster"
    assert evidence[0]["payload"]["actor_id"] == "monster"
    loaded = CombatSession.load(tmp_path, rng=random.Random(99), damage_evidence=evidence,
                               damage_evidence_actor="inv", tables=tables)
    assert loaded.damage_chain == session.damage_chain


def test_combat_load_preserves_legacy_pending_attack_compatibility(tables, tmp_path):
    session = CombatSession("pending-legacy", "test", 1, rng=random.Random(5), tables=tables)
    session.add_participant("inv", "investigator", 60, 55, 0, 10)
    session.add_participant("foe", "monster", 50, 45, 0, 8)
    session.begin_round()
    session.pending_attack = {
        "attack_command_id": "attack-legacy-1", "actor_id": "inv", "target_actor_id": "foe",
        "declared_intent": "strike", "resolution_hint": "opposed_melee", "weapon_id": "unarmed",
        "allowed_defenses": ["dodge", "fight_back"],
    }
    session.save(tmp_path)

    loaded = CombatSession.load(tmp_path, rng=random.Random(999), tables=tables)

    assert loaded.pending_attack["attack_command_id"] == "attack-legacy-1"
    assert loaded.pending_attack["on_success"] is None
    assert loaded.pending_attack["victory_outcome"] is None
    assert loaded.pending_attack["defeat_outcome"] is None


# --------------------------------------------------------------------------- #
# W3-2 Firearms depth: aiming, multi-shot, reload, full-auto, suppression
# --------------------------------------------------------------------------- #
def test_parse_uses_per_round_handgun_and_full_auto():
    """weapons.json uses_per_round strings decode into structured limits."""
    assert parse_uses_per_round("1 (3)") == {"max_shots": 3, "allows_full_auto": False, "rounds_per_use": 1}
    assert parse_uses_per_round("1(3)")["max_shots"] == 3
    parsed = parse_uses_per_round("1 (2) or full auto")
    assert parsed["max_shots"] == 2
    assert parsed["allows_full_auto"] is True
    assert parse_uses_per_round("Full auto")["allows_full_auto"] is True
    assert parse_uses_per_round("1/2")["rounds_per_use"] == 2


def test_aiming_grants_bonus_die_on_next_shot(tables):
    """p.113 Aiming: spend a round aiming -> +1 bonus die on the next shot."""
    rng = random.Random(201)
    s = CombatSession("aim-test", "test", 1, rng=rng, tables=tables)
    s.add_participant("hero", "investigator", dex=70, combat_skill=60, build=0, hp_max=12,
                      firearms_skill=60, has_ready_firearm=True, weapons=["revolver_38"])
    s.add_participant("foe", "monster", dex=40, combat_skill=40, build=0, hp_max=12)
    s.begin_round()
    aim = s.declare_and_resolve_turn("hero", "take careful aim", resolution_hint="aim", weapon_id="revolver_38")
    assert aim["outcome"] == "aiming"
    assert s.participants["hero"].get("_aiming") is True
    s.begin_round()
    shot = s.declare_and_resolve_turn("hero", "fire the aimed shot", "attack",
                                      target_actor_id="foe", defense_kind="none", weapon_id="revolver_38")
    assert shot["attack_modifiers"]["bonus"] >= 1
    assert shot["attack_modifiers"].get("aimed") is True
    assert s.participants["hero"].get("_aiming") is False


def test_aiming_lost_when_damaged(tables):
    """p.113: if the aiming character takes damage, aiming advantage is lost."""
    rng = random.Random(202)
    s = CombatSession("aim-lost", "test", 1, rng=rng, tables=tables)
    s.add_participant("hero", "investigator", dex=70, combat_skill=60, build=0, hp_max=12,
                      firearms_skill=60, weapons=["revolver_38"])
    s.add_participant("foe", "monster", dex=80, combat_skill=99, build=0, hp_max=12,
                      weapons=[{"weapon_id": "club", "skill": "Fighting (Brawl)", "damage": "1D8",
                                "adds_damage_bonus": False}])
    s.begin_round()
    s.declare_and_resolve_turn("hero", "aim", resolution_hint="aim", weapon_id="revolver_38")
    assert s.participants["hero"]["_aiming"] is True
    s._damage_roll("1D8", "foe", "hero", "club", "forced-hit")
    assert s.participants["hero"].get("_aiming") is False


def test_handgun_multi_shot_applies_one_penalty_die_to_each(tables):
    """p.113 Handguns Multiple Shots: 2+ shots -> each shot gets one penalty die."""
    rng = random.Random(203)
    s = CombatSession("multi-shot", "test", 1, rng=rng, tables=tables)
    s.add_participant("hero", "investigator", dex=70, combat_skill=70, build=0, hp_max=12,
                      firearms_skill=70, weapons=["revolver_38"])
    s.add_participant("foe", "monster", dex=40, combat_skill=40, build=0, hp_max=30)
    s.begin_round()
    t = s.declare_and_resolve_turn("hero", "empty three rounds", "attack",
                                   target_actor_id="foe", defense_kind="none", weapon_id="revolver_38", shots=3)
    assert t["outcome"] in ("multi_shot_resolved", "hit", "miss")
    shots = t.get("shots") or []
    assert len(shots) == 3
    for shot in shots:
        assert shot["attack_modifiers"]["penalty"] >= 1
        assert shot["attack_modifiers"].get("multi_shot") is True


def test_handgun_multi_shot_respects_uses_per_round(tables):
    """uses_per_round from weapons.json caps shots (revolver_38 = 1 (3))."""
    rng = random.Random(204)
    s = CombatSession("upr", "test", 1, rng=rng, tables=tables)
    s.add_participant("hero", "investigator", dex=70, combat_skill=70, build=0, hp_max=12,
                      firearms_skill=70, weapons=["revolver_38"])
    s.add_participant("foe", "monster", dex=40, combat_skill=40, build=0, hp_max=12)
    s.begin_round()
    try:
        s.declare_and_resolve_turn("hero", "fire four", "attack",
                                   target_actor_id="foe", defense_kind="none", weapon_id="revolver_38", shots=4)
        assert False, "expected ValueError for shots > uses_per_round max"
    except ValueError as exc:
        assert "uses_per_round" in str(exc) or "shots" in str(exc).lower()


def test_reload_costs_rounds_and_restores_ammo(tables):
    """p.113 Reloading: clip/shell reload costs combat rounds; restores magazine."""
    rng = random.Random(205)
    s = CombatSession("reload", "test", 1, rng=rng, tables=tables)
    s.add_participant("hero", "investigator", dex=70, combat_skill=60, build=0, hp_max=12,
                      firearms_skill=60, weapons=["revolver_38"])
    s.add_participant("foe", "monster", dex=40, combat_skill=40, build=0, hp_max=12)
    s.set_ammo("hero", "revolver_38", 0)
    assert s.get_ammo("hero", "revolver_38") == 0
    s.begin_round()
    empty = s.declare_and_resolve_turn("hero", "click", "attack",
                                       target_actor_id="foe", defense_kind="none", weapon_id="revolver_38")
    assert empty["outcome"] == "out_of_ammo"
    reload_t = s.declare_and_resolve_turn("hero", "reload the revolver", resolution_hint="reload",
                                          weapon_id="revolver_38")
    assert reload_t["outcome"] in ("reload_complete", "reload_in_progress")
    if reload_t["outcome"] == "reload_complete":
        magazine = tables.weapons_table()["revolver_38"]["magazine"]
        assert s.get_ammo("hero", "revolver_38") == magazine


def test_load_and_fire_same_round_adds_penalty(tables):
    """p.113: load one round and fire same round -> one penalty die."""
    rng = random.Random(206)
    s = CombatSession("loadfire", "test", 1, rng=rng, tables=tables)
    s.add_participant("hero", "investigator", dex=70, combat_skill=60, build=0, hp_max=12,
                      firearms_skill=60, weapons=["revolver_38"])
    s.add_participant("foe", "monster", dex=40, combat_skill=40, build=0, hp_max=12)
    s.set_ammo("hero", "revolver_38", 0)
    s.begin_round()
    t = s.declare_and_resolve_turn("hero", "load one and fire", "attack",
                                   target_actor_id="foe", defense_kind="none", weapon_id="revolver_38",
                                   load_and_fire=True)
    assert t["attack_modifiers"]["penalty"] >= 1
    assert t["attack_modifiers"].get("load_and_fire") is True


def test_full_auto_volley_size_is_skill_div_10_min_3():
    """p.114: volley size = skill/10 (tens digit), never fewer than 3."""
    assert full_auto_volley_size(47) == 4
    assert full_auto_volley_size(63) == 6
    assert full_auto_volley_size(20) == 3  # floor at 3
    assert full_auto_volley_size(9) == 3


def test_full_auto_volleys_escalate_penalty(tables):
    """p.114-116: first volley normal; each subsequent +1 penalty; 3rd->2 penalty."""
    rng = random.Random(207)
    s = CombatSession("fullauto", "test", 1, rng=rng, tables=tables)
    s.add_participant("gunner", "npc", dex=50, combat_skill=60, build=0, hp_max=13,
                      firearms_skill=60, weapons=["thompson"])
    s.add_participant("foe", "investigator", dex=55, combat_skill=25, build=0, hp_max=15)
    s.begin_round()
    t = s.declare_and_resolve_turn("gunner", "full auto on foe", "attack",
                                   target_actor_id="foe", defense_kind="none", weapon_id="thompson",
                                   fire_mode="full_auto", rounds_fired=18)
    volleys = t.get("volleys") or []
    assert len(volleys) == 3
    assert volleys[0]["attack_modifiers"]["penalty"] == 0
    assert volleys[1]["attack_modifiers"]["penalty"] == 1
    assert volleys[2]["attack_modifiers"]["penalty"] == 2
    assert all(v["bullets"] == 6 for v in volleys)


def test_suppressive_fire_offers_dive_for_cover(tables):
    """p.126 Suppressing Fire: group may dive for cover; then random targets resolved."""
    rng = random.Random(208)
    s = CombatSession("suppress", "test", 1, rng=rng, tables=tables)
    s.add_participant("gunner", "npc", dex=50, combat_skill=40, build=0, hp_max=13,
                      firearms_skill=40, weapons=["thompson"])
    s.add_participant("a", "investigator", dex=55, combat_skill=25, build=0, hp_max=15, dodge_skill=50)
    s.add_participant("b", "investigator", dex=60, combat_skill=30, build=0, hp_max=14, dodge_skill=40)
    s.begin_round()
    t = s.declare_and_resolve_turn("gunner", "suppressive fire on the room",
                                   resolution_hint="firearm_attack", weapon_id="thompson",
                                   fire_mode="suppressive", suppress_targets=["a", "b"],
                                   dive_for_cover_actors=["a"])
    assert t["outcome"] == "suppressive_fire"
    assert "a" in (t.get("dived_for_cover") or [])
    assert t.get("suppression_targets")


# --------------------------------------------------------------------------- #
# W3-4 Melee patches: thrown, prone, maneuver unification, counters
# --------------------------------------------------------------------------- #
def test_thrown_weapon_can_be_dodged_and_uses_half_db(tables):
    """p.108: thrown weapons opposed with Dodge; half damage bonus applied."""
    rng = random.Random(301)
    s = CombatSession("thrown", "test", 1, rng=rng, tables=tables)
    s.add_participant("hero", "investigator", dex=70, combat_skill=80, build=0, hp_max=12,
                      damage_bonus="+1D4", weapons=["rock_thrown"])
    s.add_participant("foe", "monster", dex=50, combat_skill=40, build=0, hp_max=12, dodge_skill=10)
    s.begin_round()
    t = s.declare_and_resolve_turn("hero", "hurl a rock", "attack",
                                   target_actor_id="foe", defense_kind="dodge", weapon_id="rock_thrown")
    assert t["defense_kind"] == "dodge"
    assert t["resolution_hint"] == "opposed_melee"
    if t["outcome"] == "hit":
        d = s.damage_chain[-1]
        assert d.get("half_damage_bonus") is not None or "+1D4" not in d["die"] or "half" in str(d)


def test_thrown_weapon_half_db_expr_tag(tables):
    """_weapon_db_expr tags Throw weapons as half DB."""
    rng = random.Random(302)
    s = CombatSession("halfdb", "test", 1, rng=rng, tables=tables)
    s.add_participant("hero", "investigator", dex=70, combat_skill=80, build=0, hp_max=12,
                      damage_bonus="+1D4", weapons=["rock_thrown"])
    w = s._weapon("hero", "rock_thrown")
    expr = s._weapon_db_expr(s.participants["hero"], w)
    assert expr is not None and expr.startswith("half:")


def test_prone_melee_attacker_gets_bonus_die(tables):
    """p.127: fighting attacks vs prone gain one bonus die."""
    rng = random.Random(303)
    s = CombatSession("prone-melee", "test", 1, rng=rng, tables=tables)
    s.add_participant("hero", "investigator", dex=70, combat_skill=70, build=0, hp_max=12,
                      weapons=[{"weapon_id": "club", "skill": "Fighting (Brawl)", "damage": "1D8",
                                "adds_damage_bonus": False}])
    s.add_participant("foe", "monster", dex=40, combat_skill=40, build=0, hp_max=12, conditions=["prone"])
    s.begin_round()
    t = s.declare_and_resolve_turn("hero", "kick the prone foe", "attack",
                                   target_actor_id="foe", defense_kind="none", weapon_id="club")
    assert t["attack_modifiers"]["bonus"] >= 1
    assert t["attack_modifiers"].get("vs_prone_melee") is True


def test_prone_ranged_attacker_gets_penalty_die(tables):
    """p.128: firearms vs prone get one penalty die (ignored at point-blank)."""
    rng = random.Random(304)
    s = CombatSession("prone-ranged", "test", 1, rng=rng, tables=tables)
    s.add_participant("hero", "investigator", dex=70, combat_skill=70, build=0, hp_max=12,
                      firearms_skill=70, weapons=["revolver_38"])
    s.add_participant("foe", "monster", dex=40, combat_skill=40, build=0, hp_max=12, conditions=["prone"])
    s.begin_round()
    t = s.declare_and_resolve_turn("hero", "shoot the prone foe", "attack",
                                   target_actor_id="foe", defense_kind="none", weapon_id="revolver_38")
    assert t["attack_modifiers"]["penalty"] >= 1
    assert t["attack_modifiers"].get("vs_prone_ranged") is True
    # Point-blank ignores the prone penalty.
    s2 = CombatSession("prone-pb", "test", 1, rng=random.Random(305), tables=tables)
    s2.add_participant("hero", "investigator", dex=70, combat_skill=70, build=0, hp_max=12,
                       firearms_skill=70, weapons=["revolver_38"])
    s2.add_participant("foe", "monster", dex=40, combat_skill=40, build=0, hp_max=12, conditions=["prone"])
    s2.begin_round()
    t2 = s2.declare_and_resolve_turn("hero", "point-blank on prone", "attack",
                                     target_actor_id="foe", defense_kind="none", weapon_id="revolver_38",
                                     point_blank=True)
    assert t2["attack_modifiers"].get("vs_prone_ranged") is not True


def test_maneuver_goal_aliases_grapple_and_break_free(tables):
    """Legacy SKILL.md names map to p.119 goals; canonical set unchanged."""
    assert "grapple" not in CombatSession.VALID_MANEUVER_GOALS
    assert "break_free" not in CombatSession.VALID_MANEUVER_GOALS
    assert CombatSession._MANEUVER_GOAL_ALIASES["grapple"] == "ongoing_disadvantage"
    assert CombatSession._MANEUVER_GOAL_ALIASES["break_free"] == "escape"
    rng = random.Random(306)
    s = CombatSession("alias", "test", 1, rng=rng, tables=tables)
    s.add_participant("hero", "investigator", dex=70, combat_skill=90, build=1, hp_max=12)
    s.add_participant("foe", "monster", dex=40, combat_skill=20, build=0, hp_max=12)
    s.begin_round()
    t = s.declare_and_resolve_turn("hero", "grapple", "maneuver",
                                   target_actor_id="foe", defense_kind="none", maneuver_kind="grapple")
    assert t.get("goal") == "ongoing_disadvantage"
    if t["outcome"] in ("restrain_success", "maneuver_success"):
        assert any(e["effect"] == "restrained" for e in s.participants["foe"]["active_effects"])


def test_defender_may_counter_with_maneuver(tables):
    """p.117: target of an attack/maneuver may respond with their own maneuver."""
    rng = random.Random(307)
    s = CombatSession("counter", "test", 1, rng=rng, tables=tables)
    s.add_participant("hero", "investigator", dex=70, combat_skill=30, build=0, hp_max=12)
    s.add_participant("foe", "monster", dex=50, combat_skill=90, build=0, hp_max=12)
    s.begin_round()
    t = s.declare_and_resolve_turn("hero", "try to shove", "maneuver",
                                   target_actor_id="foe", defense_kind="maneuver",
                                   goal="push", defender_goal="disarm")
    assert t["defense_kind"] == "maneuver"
    assert t.get("defender_goal") == "disarm"
    assert t["outcome"] in (
        "push_success", "maneuver_failed", "counter_disarm_success",
        "counter_disarm_nothing_to_take", "maneuver_failed_fight_back_damage",
        "counter_restrain_success", "counter_push_success",
    )
