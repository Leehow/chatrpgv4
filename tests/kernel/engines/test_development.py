"""Investigator development (pp.94-95): skill ticks, the frozen ending capsule,
and the settlement that applies it. Ported from the old tree's
`tests/test_development.py` (subject: `coc_development.py`) -- but NOT
literally: nearly every old test drove infrastructure that does not exist in
the port. `kernel/coc/rules/development.py`'s module docstring says why:

    "ticks live in `<campaign>/save/development-state/<inv>.json` (the old
    shared `.coc/investigators/<id>/development.jsonl` has no kernel
    equivalent -- campaigns are compile snapshots) ... the party sheet is the
    character sheet: `run_development_phase` mutates the sheet dict it is
    given and the caller writes it. Awfulness decay (sanity engine) and the
    runtime-inventory merge are not ported."

Concretely dropped (subject deleted, no successor):
- The shared `.coc/investigators/<id>/development.jsonl` +
  `development-claims.json` cross-campaign ledger, and every test built on it:
  `test_same_skill_successes_receive_distinct_stable_event_tokens`,
  `test_consumed_event_replay_keeps_source_token_across_later_session`,
  `test_capsule_does_not_treat_investigator_projection_as_tick_source`,
  `test_two_campaign_capsules_can_claim_one_reusable_event_only_once` (and
  the rest of the file past it -- not shown above but same shape: settlement
  transactions, discard-ticks, locks). `record_skill_tick` no longer reads a
  shared character file at all; ticks and claims live in one per-campaign,
  per-investigator JSON.
- `test_ending_capsule_rejects_symlinked_parent_escape` -- the old
  `_safe_campaign_child_target` symlink guard on `persist_ending_settlement_capsule`
  has no equivalent function in the port (`persist_ending_capsule` just
  `write_json_atomic`s to a path the ticket already trusts).
- Old `build_ending_settlement_capsule(campaign_dir, record)` /
  `persist_ending_settlement_capsule` are renamed `build_ending_capsule` /
  `persist_ending_capsule` with a materially different signature: the new one
  takes `sheets: dict[str, dict]` (party sheets handed in directly) instead of
  reading `.coc/investigators/<id>/character.json` itself, plus explicit
  `luck_recovery_gate` and `captured_at` arguments.

What is preserved and tested below, against the new contract:
- `skill_tick_eligible`'s exclusion rules (p.94: luck-spent,
  bonus-die-only-success, opposed-roll-loser, Cthulhu Mythos / Credit Rating
  never tick) -- a near-verbatim port of the old private helpers, now exposed
  directly instead of only observable through `record_skill_tick`.
- `record_skill_tick`'s idempotent-by-token behavior (same `source_event_id`
  replays the same tick; a different one earns a new one).
- `deterministic_development_plan` / `sanity_baseline` / `build_ending_capsule`
  / `run_development_phase`'s full lifecycle: freeze -> settle -> replay,
  additive-monotonic skill/luck merge, the 99 Luck cap and the max-SAN cap.

The full end-to-end lifecycle (record_skill_tick -> capsule -> settle) is
already exercised at the RPC seam in `tests/kernel/test_rules_families.py`
(`test_development_end_session_and_settle_ending`); the tests here focus on
engine-level invariants that seam test doesn't pin down directly.
"""

from __future__ import annotations

import sys

import pytest
from conftest import CONTENT_DIR, KERNEL_DIR

sys.path.insert(0, str(KERNEL_DIR))

from coc.rules.development import (  # noqa: E402
    build_ending_capsule,
    deterministic_development_plan,
    ending_capsule_path,
    ending_event_id,
    ending_id_for_event,
    list_endings,
    pending_settlements,
    persist_ending_capsule,
    read_development_state,
    record_skill_tick,
    run_development_phase,
    sanity_baseline,
    skill_tick_eligible,
    unclaimed_ticks,
)
from coc.rules.tables import RuleTables  # noqa: E402

RULES = CONTENT_DIR / "rulesets" / "coc7" / "rules-json"


@pytest.fixture(scope="module")
def tables() -> RuleTables:
    return RuleTables(RULES)


def _success_result(skill: str = "Spot Hidden", **extra) -> dict:
    base = {"skill": skill, "outcome": "regular", "success": True, "roll": 22, "target": 45,
           "kind": "skill_check"}
    base.update(extra)
    return base


def _sheet(*, luck=40, san=50, max_san=99, skills=None, campaign_id="case-1") -> dict:
    return {
        "campaign_id": campaign_id,
        "characteristics": {"LUCK": luck, "POW": 50, "INT": 70},
        "current_luck": luck, "current_san": san, "max_san": max_san,
        "skills": dict(skills or {"Spot Hidden": 45, "Library Use": 60, "Cthulhu Mythos": 5,
                                  "Credit Rating": 40, "Persuade": 88}),
    }


# --------------------------------------------------------------------------- #
# skill_tick_eligible -- exclusion rules (structured fields only, p.94)
# --------------------------------------------------------------------------- #
def test_tick_rejects_luck_spent_improvement_ineligible(tables):
    result = _success_result(improvement_tick_eligible=False, luck_spent=5)
    assert skill_tick_eligible(tables, "Spot Hidden", result) is False


def test_tick_rejects_bonus_die_only_success(tables):
    result = _success_result(bonus=1, penalty=0, tens_values=[8, 1], units=2, roll=12, target=45,
                             excluded_outcome="bonus_die_only_success")
    assert skill_tick_eligible(tables, "Spot Hidden", result) is False


def test_bonus_die_tick_uses_physical_base_die_in_both_orders(tables):
    # Original 66 fails and appended bonus 06 succeeds: no development tick.
    excluded = _success_result(bonus=1, penalty=0, tens_values=[6, 0], units=6, roll=6, target=50)
    assert skill_tick_eligible(tables, "Spot Hidden", excluded) is False

    # Original 49 succeeds and appended bonus 59 is irrelevant: the natural
    # success remains eligible even though the extra tens die is larger.
    eligible = _success_result(bonus=1, penalty=0, tens_values=[4, 5], units=9, roll=49, target=50)
    assert skill_tick_eligible(tables, "Spot Hidden", eligible) is True


def test_tick_rejects_opposed_loser(tables):
    result = _success_result(opposed_won=False, opposed_outcome="defender_higher",
                             excluded_outcome="opposed_roll_loser")
    assert skill_tick_eligible(tables, "Spot Hidden", result) is False


def test_tick_rejects_cthulhu_mythos(tables):
    assert skill_tick_eligible(tables, "Cthulhu Mythos", _success_result(skill="Cthulhu Mythos")) is False


def test_tick_rejects_credit_rating(tables):
    assert skill_tick_eligible(tables, "Credit Rating", _success_result(skill="Credit Rating")) is False


def test_tick_accepts_qualifying_success(tables):
    assert skill_tick_eligible(tables, "Spot Hidden", _success_result()) is True


# --------------------------------------------------------------------------- #
# record_skill_tick -- idempotent by (campaign_id, investigator_id, source_kind,
# source_event_id) token, per-campaign save/development-state/<inv>.json
# --------------------------------------------------------------------------- #
def test_record_tick_rejects_ineligible_result_and_writes_nothing(tables, tmp_path):
    result = _success_result(improvement_tick_eligible=False, luck_spent=5)
    tick = record_skill_tick(tables, tmp_path, "case-1", "ada", "Spot Hidden", result,
                             source_event_id="rules.roll:1")
    assert tick is None
    assert not (tmp_path / "save" / "development-state" / "ada.json").exists()


def test_record_tick_appends_qualifying_success(tables, tmp_path):
    tick = record_skill_tick(tables, tmp_path, "case-1", "ada", "Spot Hidden", _success_result(),
                             source_event_id="rules.roll:1")
    assert tick is not None
    assert tick["skill"] == "Spot Hidden"
    assert tick["roll"] == 22
    assert "event_token" in tick
    state = read_development_state(tmp_path, "ada")
    assert list(state["ticks"].values()) == [tick]


def test_distinct_source_events_earn_distinct_tokens(tables, tmp_path):
    first = record_skill_tick(tables, tmp_path, "case-1", "ada", "Spot Hidden", _success_result(),
                              source_event_id="rules.roll:first")
    second = record_skill_tick(tables, tmp_path, "case-1", "ada", "Spot Hidden", _success_result(roll=23),
                               source_event_id="rules.roll:second")
    assert first["event_token"] != second["event_token"]
    assert {row["event_token"] for row in unclaimed_ticks(tmp_path, "ada")} == {
        first["event_token"], second["event_token"]}


def test_same_source_event_replays_the_same_tick_idempotently(tables, tmp_path):
    first = record_skill_tick(tables, tmp_path, "case-1", "ada", "Spot Hidden", _success_result(),
                              source_event_id="rules.roll:durable")
    replay = record_skill_tick(tables, tmp_path, "case-1", "ada", "Spot Hidden", _success_result(),
                               source_event_id="rules.roll:durable")
    assert replay["event_token"] == first["event_token"]
    assert len(unclaimed_ticks(tmp_path, "ada")) == 1


def test_replayed_token_with_conflicting_skill_is_refused(tables, tmp_path):
    record_skill_tick(tables, tmp_path, "case-1", "ada", "Spot Hidden", _success_result(),
                      source_event_id="rules.roll:conflict")
    with pytest.raises(ValueError, match="conflicting skill"):
        record_skill_tick(tables, tmp_path, "case-1", "ada", "Listen",
                          _success_result(skill="Listen"), source_event_id="rules.roll:conflict")


# --------------------------------------------------------------------------- #
# sanity_baseline (pure)
# --------------------------------------------------------------------------- #
def test_sanity_baseline_reads_current_san_and_max_san(tables):
    baseline = sanity_baseline({"current_san": 55, "max_san": 90})
    assert baseline == {"source": "party_sheet", "current": 55, "max": 90}


def test_sanity_baseline_derives_max_san_from_cm_value_when_absent(tables):
    baseline = sanity_baseline({"current_san": 40, "cm_value": 10})
    assert baseline["max"] == 89  # 99 - 10


def test_sanity_baseline_falls_back_to_derived_san_and_floors_max_at_current(tables):
    baseline = sanity_baseline({"derived": {"SAN": 60}, "max_san": 50})
    # max is never allowed below current (a stale max_san cannot cap a higher SAN).
    assert baseline == {"source": "party_sheet", "current": 60, "max": 60}


# --------------------------------------------------------------------------- #
# deterministic_development_plan -- improvement checks, luck recovery, SAN reward
# --------------------------------------------------------------------------- #
def test_plan_is_reproducible_from_the_same_seed_material(tables):
    sanity = {"current": 50, "max": 99}
    one = deterministic_development_plan(tables, skills={"Spot Hidden": 45}, luck=40, sanity=sanity,
                                         seed_material="ending-1:ada:development.settle",
                                         scenario_reward_expr=None)
    two = deterministic_development_plan(tables, skills={"Spot Hidden": 45}, luck=40, sanity=sanity,
                                         seed_material="ending-1:ada:development.settle",
                                         scenario_reward_expr=None)
    three = deterministic_development_plan(tables, skills={"Spot Hidden": 45}, luck=40, sanity=sanity,
                                           seed_material="ending-2:ada:development.settle",
                                           scenario_reward_expr=None)
    assert one == two
    assert one["plan_sha256"] == two["plan_sha256"]
    assert one != three


def test_plan_luck_recovery_uses_percentile_recover_luck_by_default(tables):
    sanity = {"current": 50, "max": 99}
    plan = deterministic_development_plan(tables, skills={}, luck=40, sanity=sanity,
                                          seed_material="seed-a", scenario_reward_expr=None)
    recovery = plan["luck_recovery"]
    assert recovery["luck_before"] == 40
    assert recovery["rule_ref"] == "core.optional.luck_recovery"
    assert "skipped" not in recovery
    assert recovery["luck_after"] >= 40


def test_plan_luck_recovery_is_skipped_when_the_optional_rule_is_disabled(tables):
    sanity = {"current": 50, "max": 99}
    gate = {"option_id": "luck-recovery", "decided_by": "patch:no-luck-recovery", "layer": "house_rule"}
    plan = deterministic_development_plan(tables, skills={}, luck=40, sanity=sanity,
                                          seed_material="seed-a", scenario_reward_expr=None,
                                          luck_recovery_gate=gate)
    recovery = plan["luck_recovery"]
    assert recovery["skipped"] is True
    assert recovery["reason"] == "optional_rule_disabled"
    assert recovery["decided_by"] == "patch:no-luck-recovery"
    assert recovery["gained"] == 0
    assert recovery["luck_after"] == 40


def test_plan_grants_san_reward_only_when_a_skill_crosses_the_threshold(tables):
    """p.94: reaching >=90 via development grants a 2D6 SAN reward."""
    sanity = {"current": 50, "max": 99}
    for seed in range(1, 50):
        plan = deterministic_development_plan(
            tables, skills={"Persuade": 88}, luck=40, sanity=sanity,
            seed_material=f"seed-{seed}", scenario_reward_expr=None)
        check = plan["improvement_checks"][0]
        if check["improved"] and check["planned_value_after"] >= 90:
            assert plan["development_san_reward"] is not None
            assert plan["development_san_planned_delta"] >= 1
            return
    pytest.fail("no seed reached the SAN-reward threshold in 50 tries")


def test_plan_scenario_reward_is_capped_by_remaining_san_to_max(tables):
    sanity = {"current": 97, "max": 99}
    plan = deterministic_development_plan(tables, skills={}, luck=40, sanity=sanity,
                                          seed_material="seed-cap", scenario_reward_expr="10D6")
    # 10D6 always rolls well above 2, but the delta cannot exceed max - current.
    assert plan["scenario_san_planned_delta"] <= 2


# --------------------------------------------------------------------------- #
# build_ending_capsule / persist_ending_capsule / run_development_phase --
# freeze -> settle -> replay, additive merge, caps
# --------------------------------------------------------------------------- #
def _ending_record(ending_id: str, investigator_ids: list[str]) -> dict:
    return {"event_type": "session_ending", "ending_id": ending_id, "scene_id": "finale",
           "kind": "cliffhanger", "decision_id": ending_id, "investigator_ids": investigator_ids,
           "ts": "2026-09-05T00:00:00Z"}


def test_capsule_freezes_only_unclaimed_ticks_as_skills_checked(tables, tmp_path):
    record_skill_tick(tables, tmp_path, "case-1", "ada", "Spot Hidden", _success_result(),
                      source_event_id="rules.roll:1")
    record_skill_tick(tables, tmp_path, "case-1", "ada", "Library Use",
                      _success_result(skill="Library Use"), source_event_id="rules.roll:2")
    sheet = _sheet()
    capsule = build_ending_capsule(tables, tmp_path, _ending_record("ending-1", ["ada"]), {"ada": sheet},
                                   luck_recovery_gate=None, captured_at="2026-09-05T00:00:00Z")
    assert set(capsule["development_inputs"]["ada"]["skills_checked"]) == {"Spot Hidden", "Library Use"}
    assert capsule["ending_id"] == "ending-1"
    assert "capsule_sha256" in capsule


def test_run_development_phase_applies_plan_additively_and_claims_ticks(tables, tmp_path):
    record_skill_tick(tables, tmp_path, "case-1", "ada", "Spot Hidden", _success_result(),
                      source_event_id="rules.roll:1")
    sheet = _sheet(luck=40, san=50, skills={"Spot Hidden": 45})
    capsule = build_ending_capsule(tables, tmp_path, _ending_record("ending-2", ["ada"]), {"ada": sheet},
                                   luck_recovery_gate=None, captured_at="2026-09-05T00:00:00Z")
    result = run_development_phase(tables, tmp_path, "ada", sheet, capsule)

    assert result["status"] == "PASS"
    assert result["ending_id"] == "ending-2"
    assert result["skills_checked"] == ["Spot Hidden"]
    check = result["improvement_checks"][0]
    if check["improved"]:
        assert sheet["skills"]["Spot Hidden"] == 45 + check["gain"]
        assert check["value_after"] == sheet["skills"]["Spot Hidden"]
    else:
        assert sheet["skills"]["Spot Hidden"] == 45
    # Ticks consumed by this ending are no longer unclaimed.
    assert unclaimed_ticks(tmp_path, "ada") == []


def test_run_development_phase_caps_luck_at_99(tables, tmp_path):
    sheet = _sheet(luck=95, skills={})
    capsule = build_ending_capsule(tables, tmp_path, _ending_record("ending-luck-cap", ["ada"]), {"ada": sheet},
                                   luck_recovery_gate=None, captured_at="2026-09-05T00:00:00Z")
    # Force a large recovery so the cap is what actually limits the result.
    for inv_input in capsule["development_inputs"].values():
        inv_input["deterministic_plan"]["luck_recovery"]["gained"] = 50
    result = run_development_phase(tables, tmp_path, "ada", sheet, capsule)
    assert result["luck_recovery"]["luck_after"] <= 99
    assert sheet["current_luck"] <= 99


def test_run_development_phase_caps_san_at_max(tables, tmp_path):
    sheet = _sheet(san=97, max_san=99, skills={})
    capsule = build_ending_capsule(tables, tmp_path, _ending_record("ending-san-cap", ["ada"]), {"ada": sheet},
                                   luck_recovery_gate=None, captured_at="2026-09-05T00:00:00Z")
    for inv_input in capsule["development_inputs"].values():
        inv_input["deterministic_plan"]["development_san_planned_delta"] = 10
        inv_input["deterministic_plan"]["scenario_san_planned_delta"] = 10
    result = run_development_phase(tables, tmp_path, "ada", sheet, capsule)
    assert result["san_after"] <= 99
    assert sheet["current_san"] <= 99


def test_replaying_a_settled_ending_returns_the_stored_receipt(tables, tmp_path):
    sheet = _sheet()
    capsule = build_ending_capsule(tables, tmp_path, _ending_record("ending-replay", ["ada"]), {"ada": sheet},
                                   luck_recovery_gate=None, captured_at="2026-09-05T00:00:00Z")
    first = run_development_phase(tables, tmp_path, "ada", dict(sheet), capsule)
    assert "replayed" not in first
    replay = run_development_phase(tables, tmp_path, "ada", dict(sheet), capsule)
    assert replay["replayed"] is True
    assert replay["ending_id"] == first["ending_id"]
    assert replay["san_after"] == first["san_after"]


def test_run_development_phase_refuses_an_ending_with_no_frozen_input_for_the_investigator(tables, tmp_path):
    sheet = _sheet()
    capsule = build_ending_capsule(tables, tmp_path, _ending_record("ending-missing", ["ada"]), {"ada": sheet},
                                   luck_recovery_gate=None, captured_at="2026-09-05T00:00:00Z")
    with pytest.raises(ValueError, match="froze no development input"):
        run_development_phase(tables, tmp_path, "not-ada", sheet, capsule)


# --------------------------------------------------------------------------- #
# ending capsule bookkeeping: path/id helpers, list_endings, pending_settlements
# --------------------------------------------------------------------------- #
def test_ending_id_and_event_id_are_stable_and_content_addressed(tables):
    record = _ending_record("", [])
    del record["ending_id"]
    ending_id = ending_id_for_event(record)
    assert ending_id.startswith("ending-")
    assert ending_id_for_event(record) == ending_id  # deterministic
    assert ending_event_id(ending_id).startswith("ending-event-")
    with pytest.raises(ValueError):
        ending_event_id("not a safe id!")


def test_list_endings_and_pending_settlements_track_unsettled_capsules(tables, tmp_path):
    sheet = _sheet()
    capsule = build_ending_capsule(tables, tmp_path, _ending_record("ending-pending", ["ada"]), {"ada": sheet},
                                   luck_recovery_gate=None, captured_at="2026-09-05T00:00:00Z")
    persist_ending_capsule(tmp_path, capsule)
    assert ending_capsule_path(tmp_path, "ending-pending").exists()

    endings = list_endings(tmp_path)
    assert [c["ending_id"] for c in endings] == ["ending-pending"]
    assert pending_settlements(tmp_path) == [("ending-pending", "ada")]

    run_development_phase(tables, tmp_path, "ada", sheet, capsule)
    assert pending_settlements(tmp_path) == []
