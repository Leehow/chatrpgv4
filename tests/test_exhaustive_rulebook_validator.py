"""Contract tests for checks/exhaustive_rulebook_validator.py.

The validator sweeps playtest campaign logs (rolls.jsonl / events.jsonl)
against machine-checkable CoC 7e rules. Regression guard: campaign ids do
not match run ids, so the validator must *discover* campaigns under each
run's sandbox; and a sweep over zero records must refuse to pass (exit 2),
not silently print "EXHAUSTIVE CHECK PASSED".
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _load():
    spec = importlib.util.spec_from_file_location(
        "exhaustive_rulebook_validator",
        ROOT / "checks" / "exhaustive_rulebook_validator.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


validator = _load()

CLEAN_SKILL_ROLL = {
    "type": "skill",
    "payload": {"skill": "Spot Hidden", "roll": 30, "target": 55,
                "outcome": "regular_success"},
}
# p.154/F5: a failed SAN roll must carry an involuntary_action block.
VIOLATING_SAN_ROLL = {
    "type": "sanity",
    "payload": {"skill": "SAN", "roll": 70, "target": 50, "outcome": "failure"},
}
CLEAN_SAN_ROLL = {
    "type": "sanity",
    "payload": {"skill": "SAN", "roll": 30, "target": 50, "outcome": "success"},
}


def _roll_violations(payload: dict, *, kind: str = "skill_check") -> list[str]:
    violations = validator.Violations()
    validator.check_roll(
        "focused-roll",
        {"type": "roll", "kind": kind, "payload": payload},
        violations,
    )
    return violations.items


def test_hard_failure_uses_required_target_not_full_skill_value():
    violations = _roll_violations({
        "skill": "Spot Hidden",
        "roll": 54,
        "target": 55,
        "required_level": "hard",
        "required_target": 27,
        "effective_target": 27,
        "outcome": "failure",
    })

    assert violations == []


def test_regular_difficulty_keeps_full_skill_as_success_target():
    assert _roll_violations({
        "skill": "Spot Hidden",
        "roll": 56,
        "target": 55,
        "required_level": "regular",
        "required_target": 55,
        "effective_target": 55,
        "outcome": "success",
    }) == [
        "[focused-roll] A5 (p.91): outcome success but roll 56 > target 55"
    ]


def test_hard_and_extreme_successes_must_meet_the_selected_difficulty():
    hard_violations = _roll_violations({
        "skill": "Spot Hidden",
        "roll": 28,
        "target": 55,
        "required_level": "hard",
        "required_target": 27,
        "effective_target": 27,
        "outcome": "regular_success",
    })
    extreme_violations = _roll_violations({
        "skill": "Spot Hidden",
        "roll": 12,
        "target": 55,
        "required_level": "extreme",
        "required_target": 11,
        "effective_target": 11,
        "outcome": "success",
    })

    assert hard_violations == [
        "[focused-roll] A5 (p.91): outcome regular_success but roll 28 > target 27"
    ]
    assert extreme_violations == [
        "[focused-roll] A5 (p.91): outcome success but roll 12 > target 11"
    ]
    assert _roll_violations({
        "skill": "Spot Hidden",
        "roll": 27,
        "target": 55,
        "required_level": "hard",
        "required_target": 27,
        "effective_target": 27,
        "outcome": "hard",
    }) == []
    assert _roll_violations({
        "skill": "Spot Hidden",
        "roll": 11,
        "target": 55,
        "required_level": "extreme",
        "required_target": 11,
        "effective_target": 11,
        "outcome": "extreme",
    }) == []


def test_bonus_or_penalty_dice_do_not_replace_the_difficulty_target():
    for bonus, penalty, unmodified_roll in ((1, 0, 81), (0, 1, 8)):
        assert _roll_violations({
            "skill": "Spot Hidden",
            "roll": 28,
            "unmodified_roll": unmodified_roll,
            "target": 55,
            "required_level": "hard",
            "required_target": 27,
            "effective_target": 27,
            "bonus": bonus,
            "penalty": penalty,
            "outcome": "failure",
        }) == []


def test_hard_difficulty_uses_effective_target_for_fumble_band():
    violations = _roll_violations({
        "skill": "Spot Hidden",
        "roll": 96,
        "target": 55,
        "required_level": "hard",
        "required_target": 27,
        "effective_target": 27,
        "outcome": "regular_success",
    })

    assert any(
        "B3/B4" in violation and "target 27" in violation
        for violation in violations
    )


def test_opposed_roll_uses_each_sides_full_skill_not_difficulty_target():
    successful_side = {
        "skill": "DEX",
        "roll": 54,
        "target": 55,
        "required_level": "opposed",
        "difficulty": "opposed",
        "required_target": 27,
        "effective_target": 27,
        "outcome": "success",
    }
    failed_side = {**successful_side, "outcome": "failure"}

    assert _roll_violations(successful_side, kind="opposed_check") == []
    assert _roll_violations(failed_side, kind="opposed_check") == [
        "[focused-roll] A5 (p.91): outcome failure but roll 54 <= target 55"
    ]


def _make_run(root: Path, run_id: str, campaign_id: str,
              rolls: list[dict], events: list[dict] | None = None) -> None:
    logs = root / run_id / "sandbox" / ".coc" / "campaigns" / campaign_id / "logs"
    logs.mkdir(parents=True)
    (logs / "rolls.jsonl").write_text(
        "".join(json.dumps(r) + "\n" for r in rolls))
    (logs / "events.jsonl").write_text(
        "".join(json.dumps(e) + "\n" for e in (events or [])))


def _make_debug_run(
    root: Path,
    run_id: str,
    lane_id: str,
    campaign_id: str,
    rolls: list[dict],
) -> None:
    logs = (
        root / run_id / "sandboxes" / lane_id / ".coc"
        / "campaigns" / campaign_id / "logs"
    )
    logs.mkdir(parents=True)
    (logs / "rolls.jsonl").write_text(
        "".join(json.dumps(row) + "\n" for row in rolls),
        encoding="utf-8",
    )


def test_campaign_discovery_and_violation_detection(tmp_path, capsys):
    # Campaign id deliberately differs from the run id (the layout that used
    # to make the validator sweep zero records and pass vacuously).
    _make_run(tmp_path, "run-2026a", "campaign-x",
              [CLEAN_SKILL_ROLL, VIOLATING_SAN_ROLL])
    rc = validator.main(["prog", str(tmp_path)])
    out = capsys.readouterr().out
    assert rc == 1
    assert "1 rolls" in out or "2 rolls" in out  # swept real records
    assert "F5" in out
    assert "campaign-x" in out


def test_clean_run_passes(tmp_path, capsys):
    _make_run(tmp_path, "run-2026b", "campaign-y",
              [CLEAN_SKILL_ROLL, CLEAN_SAN_ROLL])
    rc = validator.main(["prog", str(tmp_path)])
    out = capsys.readouterr().out
    assert rc == 0
    assert "EXHAUSTIVE CHECK PASSED" in out


def test_debug_experiment_lane_discovery_and_distinct_label(tmp_path, capsys):
    _make_debug_run(
        tmp_path,
        "debug-rulegraph-r1",
        "healing-first-aid",
        "campaign-healing",
        [CLEAN_SKILL_ROLL],
    )
    rc = validator.main(["prog", str(tmp_path)])
    out = capsys.readouterr().out
    assert rc == 0
    assert "1 rolls" in out
    assert "EXHAUSTIVE CHECK PASSED" in out


def test_zero_records_refuses_vacuous_pass(tmp_path, capsys):
    (tmp_path / "run-empty").mkdir()
    rc = validator.main(["prog", str(tmp_path)])
    captured = capsys.readouterr()
    assert rc == 2
    assert "0 records" in captured.err or "vacuous" in captured.err
