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


def _make_run(root: Path, run_id: str, campaign_id: str,
              rolls: list[dict], events: list[dict] | None = None) -> None:
    logs = root / run_id / "sandbox" / ".coc" / "campaigns" / campaign_id / "logs"
    logs.mkdir(parents=True)
    (logs / "rolls.jsonl").write_text(
        "".join(json.dumps(r) + "\n" for r in rolls))
    (logs / "events.jsonl").write_text(
        "".join(json.dumps(e) + "\n" for e in (events or [])))


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


def test_zero_records_refuses_vacuous_pass(tmp_path, capsys):
    (tmp_path / "run-empty").mkdir()
    rc = validator.main(["prog", str(tmp_path)])
    captured = capsys.readouterr()
    assert rc == 2
    assert "0 records" in captured.err or "vacuous" in captured.err
