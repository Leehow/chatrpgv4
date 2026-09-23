"""Tests for tests/play/kpi.py (contract §13.8's read-before-write KPI).

A small synthetic telemetry.jsonl stands in for a real campaign so the
counting rules are pinned down without depending on any live playtest data.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

import kpi

KPI_SCRIPT = Path(__file__).resolve().parent / "kpi.py"


def write_telemetry(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n", encoding="utf-8")


def row(turn, tool, *, call_id=None, ok=True, code=None, ms=1):
    r = {"turn": turn, "tool": tool, "call_id": call_id, "started_at": "2026-01-01T00:00:00.000Z", "ms": ms, "ok": ok}
    if code is not None:
        r["code"] = code
    return r


SYNTHETIC_ROWS = [
    # turn 0: opening, no player_input yet -- a narrate straight away, no reads.
    row(0, "narrate", call_id="t0-c1"),
    {"turn": 0, "tool": "narrate", "event": "turn-closed", "round_trips": 1, "ok": True},

    # turn 1: two reads, then a successful apply -- the harness's own
    # table.player_input call must not be mistaken for a keeper tool call.
    {"turn": 1, "tool": "table.player_input", "started_at": "x", "ms": 1, "ok": True},
    row(1, "look"),
    row(1, "lookup"),
    row(1, "apply", call_id="t1-c1"),
    row(1, "narrate", call_id="t1-c2"),
    {"turn": 1, "tool": "narrate", "event": "turn-closed", "round_trips": 3, "ok": True},

    # turn 2: a resolve fails (needs), keeper reads once more, then a
    # *successful* resolve reaches the rules layer -- the failed resolve must
    # not count as the write that ends the read tally, and must not itself
    # count as a read.
    {"turn": 2, "tool": "table.player_input", "started_at": "x", "ms": 1, "ok": True},
    row(2, "look"),
    row(2, "resolve", call_id="t2-c1", ok=False, code="needs"),
    row(2, "recall"),
    row(2, "resolve", call_id="t2-c2"),
    row(2, "apply", call_id="t2-c3"),
    row(2, "narrate", call_id="t2-c4"),
    {"turn": 2, "tool": "narrate", "event": "turn-closed", "round_trips": 4, "ok": True},
    # a memory/verifier lane row for turn 2 -- must never be counted as a tool call.
    {"lane": "verifier", "turn": 2, "ok": True, "findings": 0},

    # turn 3: no reads at all before an immediate successful apply; no resolve
    # this turn, so it must not count toward reached_rules_layer.
    {"turn": 3, "tool": "table.player_input", "started_at": "x", "ms": 1, "ok": True},
    row(3, "apply", call_id="t3-c1"),
    row(3, "narrate", call_id="t3-c2"),
    {"turn": 3, "tool": "narrate", "event": "turn-closed", "round_trips": 2, "ok": True},
]


@pytest.fixture
def workspace(tmp_path: Path) -> Path:
    write_telemetry(tmp_path / "campaigns" / "synth" / "telemetry.jsonl", SYNTHETIC_ROWS)
    return tmp_path


def test_reads_before_write_skips_over_failed_write_attempts(workspace):
    rows = kpi.load_rows(kpi.telemetry_path(str(workspace), "synth"))
    per_turn = kpi.compute(rows)
    assert per_turn[0]["reads_before_write"] == 0
    assert per_turn[1]["reads_before_write"] == 2
    # turn 2: look, then a failed resolve (skipped, doesn't stop the count),
    # then recall, then the successful resolve stops it: 2 reads total.
    assert per_turn[2]["reads_before_write"] == 2
    assert per_turn[3]["reads_before_write"] == 0


def test_harness_player_input_is_not_a_tool_call(workspace):
    rows = kpi.load_rows(kpi.telemetry_path(str(workspace), "synth"))
    per_turn = kpi.compute(rows)
    # table.player_input rows exist for turns 1-3 but must not inflate total_calls.
    assert per_turn[1]["total_calls"] == 4  # look, lookup, apply, narrate
    assert per_turn[2]["total_calls"] == 6  # look, resolve(fail), recall, resolve, apply, narrate
    assert per_turn[3]["total_calls"] == 2  # apply, narrate


def test_event_and_lane_rows_are_excluded(workspace):
    rows = kpi.load_rows(kpi.telemetry_path(str(workspace), "synth"))
    per_turn = kpi.compute(rows)
    # turn-closed event rows and the verifier lane row on turn 2 must not appear
    # as calls: turn 2 has 6 real tool-call rows (look, resolve x2, recall, apply, narrate).
    assert per_turn[2]["total_calls"] == 6


def test_kernel_errors_and_rules_layer(workspace):
    rows = kpi.load_rows(kpi.telemetry_path(str(workspace), "synth"))
    per_turn = kpi.compute(rows)
    assert per_turn[2]["kernel_errors"] == 1
    assert per_turn[2]["reached_rules_layer"] is True   # the second, successful resolve
    assert per_turn[3]["reached_rules_layer"] is False  # no resolve at all this turn
    assert per_turn[0]["kernel_errors"] == 0


def test_turns_filter_is_inclusive(workspace):
    rows = kpi.load_rows(kpi.telemetry_path(str(workspace), "synth"))
    per_turn = kpi.compute(rows, (1, 2))
    assert set(per_turn) == {1, 2}


def test_summarize_is_deterministic_and_matches_by_hand(workspace):
    rows = kpi.load_rows(kpi.telemetry_path(str(workspace), "synth"))
    per_turn = kpi.compute(rows)
    summary = kpi.summarize(per_turn)
    assert summary["turns"] == 4
    reads = [0, 2, 2, 0]
    assert summary["reads_before_write_median"] == 1.0
    assert summary["reads_before_write_mean"] == pytest.approx(1.0)
    assert summary["reads_before_write_max"] == 2
    assert summary["reached_rules_layer_turns"] == 1
    assert summary["reached_write_turns"] == 4
    # running it twice must give byte-identical output (deterministic, no wall clock).
    again = kpi.summarize(kpi.compute(rows))
    assert again == summary


def test_cli_runs_end_to_end_and_prints_the_summary(workspace):
    result = subprocess.run(
        [sys.executable, str(KPI_SCRIPT), "--campaign", "synth", "--workspace", str(workspace)],
        capture_output=True, text=True, check=True,
    )
    assert "reads_before_write_median" in result.stdout
    assert "turn   2" in result.stdout or "turn 2" in result.stdout
    # deterministic: running twice gives identical stdout.
    again = subprocess.run(
        [sys.executable, str(KPI_SCRIPT), "--campaign", "synth", "--workspace", str(workspace)],
        capture_output=True, text=True, check=True,
    )
    assert again.stdout == result.stdout


def test_cli_turns_filter(workspace):
    result = subprocess.run(
        [sys.executable, str(KPI_SCRIPT), "--campaign", "synth", "--workspace", str(workspace), "--turns", "1-2"],
        capture_output=True, text=True, check=True,
    )
    assert "turn   0" not in result.stdout
    assert "turns: 2" in result.stdout


def test_cli_requires_campaign_unless_baseline(workspace):
    result = subprocess.run(
        [sys.executable, str(KPI_SCRIPT), "--workspace", str(workspace)],
        capture_output=True, text=True,
    )
    assert result.returncode != 0
    assert "--campaign is required" in result.stderr


def test_cli_missing_telemetry_reports_clearly(tmp_path):
    result = subprocess.run(
        [sys.executable, str(KPI_SCRIPT), "--campaign", "nope", "--workspace", str(tmp_path)],
        capture_output=True, text=True,
    )
    assert result.returncode != 0


def test_baseline_mode_reads_the_real_haunting_s0_campaign():
    """Contract §13.8 names haunting-s0 turns 13-25 explicitly; --baseline must
    read the real repo telemetry (not a fixture) when run from the repo root."""
    repo_root = Path(__file__).resolve().parents[2]
    telemetry = repo_root / ".coc" / "campaigns" / "haunting-s0" / "telemetry.jsonl"
    if not telemetry.exists():
        pytest.skip("no .coc/campaigns/haunting-s0/telemetry.jsonl in this checkout")
    result = subprocess.run(
        [sys.executable, str(KPI_SCRIPT), "--baseline"],
        cwd=str(repo_root), capture_output=True, text=True, check=True,
    )
    assert "baseline: haunting-s0 turns 13-25" in result.stdout
    assert "reads_before_write_median" in result.stdout
    assert "turns: 13" in result.stdout


def test_admission_section_counts_verdicts_reuse_and_unavailability_apart_from_delivery_time():
    """Contract §32.7: the review's own cost and outcomes, never folded into the turn's timing."""
    rows = [
        {"turn": 1, "lane": "admission", "verb": "apply", "ok": True, "verdict": "not_authorized", "admitted": False, "reused": False, "ms": 900, "key": "a"},
        {"turn": 1, "lane": "admission", "verb": "apply", "ok": True, "verdict": "not_authorized", "admitted": False, "reused": True, "ms": 0, "key": "a"},
        {"turn": 2, "lane": "admission", "verb": "resolve", "ok": True, "verdict": "entailed", "admitted": True, "reused": False, "ms": 300, "key": "b"},
        {"turn": 3, "lane": "admission", "verb": "resolve", "ok": False, "reason": "timeout", "ms": 60000, "key": "c"},
        {"turn": 0, "lane": "admission", "verb": "apply", "ok": True, "skipped": "no_player_text", "key": "d"},
        {"turn": 2, "lane": "lane-call", "subsession": "admission", "phase": "end", "ok": True, "ms": 290},
        row(2, "resolve", call_id="t2-c1", ms=5000),
    ]
    section = kpi.admission(rows)
    assert section == {
        "reviews": 2, "reused": 1, "skipped": 1,
        "verdicts": {"entailed": 1, "not_authorized": 2},
        "unavailable": {"timeout": 1},
        "review_ms": {"total": 1200, "max": 900, "mean": 600},
    }
    assert kpi.admission([row(1, "apply", call_id="t1-c1")]) == {}


def test_admission_section_splits_reviews_by_the_reviewer_that_decided_them():
    """Contract §32.10: typed and lane reviews are compared by their own rows; a lane review the
    typed route fell back to counts under the lane, with the fallback reason beside it."""
    rows = [
        {"turn": 1, "lane": "admission", "verb": "apply", "ok": True, "verdict": "authorized", "reused": False, "ms": 700, "reviewer": "jev"},
        {"turn": 1, "lane": "admission", "verb": "apply", "ok": True, "verdict": "authorized", "reused": True, "ms": 0, "reviewer": "jev"},
        {"turn": 2, "lane": "admission", "verb": "apply", "ok": True, "verdict": "entailed", "reused": False, "ms": 9000,
         "reviewer": "lane", "jev_fallback": "low_confidence"},
        {"turn": 3, "lane": "admission", "verb": "resolve", "ok": False, "reason": "timeout", "ms": 120000,
         "reviewer": "lane", "jev_fallback": "service_error"},
    ]
    section = kpi.admission(rows)
    assert section["by_reviewer"] == {
        "jev": {"reviews": 1, "unavailable": 0, "fallbacks": {}, "ms": {"total": 700, "max": 700, "mean": 700}},
        "lane": {"reviews": 2, "unavailable": 1, "fallbacks": {"low_confidence": 1, "service_error": 1},
                 "ms": {"total": 129000, "max": 120000, "mean": 64500}},
    }
    assert "by_reviewer" not in kpi.admission([{k: v for k, v in r.items() if k not in ("reviewer", "jev_fallback")} for r in rows])


def test_lane_section_tells_a_lane_that_never_worked_from_one_that_ran_clean():
    """A lane that failed every turn and a lane that never failed read the same way
    everywhere else in this tool, which is how `memory` failed 32 times in one campaign
    with nobody told. A healthy lane is listed with `failed: 0` for exactly that reason:
    silence about a lane must not be the same text as a lane that is fine."""
    rows = [
        {"turn": 0, "lane": "memory", "ok": False, "reason": "lane_error", "detail": "entity 'x' is ambiguous"},
        {"turn": 1, "lane": "memory", "ok": False, "reason": "lane_error", "detail": "entity 'x' is ambiguous"},
        {"turn": 2, "lane": "memory", "ok": False, "reason": "lane_error", "detail": "entity 'x' is ambiguous"},
        {"turn": 0, "lane": "journal", "ok": True, "ms": 12},
        {"turn": 1, "lane": "journal", "ok": True, "ms": 14},
        # A stumble is not an outage: the streak resets, and the worst run is what says so.
        {"turn": 0, "lane": "voice", "ok": False, "reason": "model_error"},
        {"turn": 1, "lane": "voice", "ok": True},
        {"turn": 2, "lane": "voice", "ok": False, "reason": "model_error"},
        # A row with no verdict of its own is a progress note, not an outcome.
        {"turn": 3, "lane": "reading", "event": "concurrency", "job_id": "read-6"},
    ]
    section = kpi.lanes(rows)
    assert section == {
        "journal": {"rows": 2, "failed": 0, "worst_streak": 0},
        "memory": {"rows": 3, "failed": 3, "worst_streak": 3, "reasons": {"lane_error": 3}},
        "voice": {"rows": 3, "failed": 2, "worst_streak": 1, "reasons": {"model_error": 2}},
    }
    assert "reading" not in section
    assert kpi.lanes([row(1, "apply", call_id="t1-c1")]) == {}


@pytest.fixture
def skill_rows():
    """Synthetic counting evidence only, never real-table acceptance evidence."""
    def skill(turn, enabled, provider, model, **overrides):
        return {"lane": "skills", "campaign": "skills-test", "turn": turn, "run_id": f"run-{turn}",
                "enabled": enabled, "provider": provider, "model": model,
                "provider_models": [{"provider": provider, "model": model,
                                     "rounds": overrides.get("provider_rounds", 2)}],
                "mixed_provider_model": False,
                "offered": ["direct-authorized-change"] if enabled else [],
                "selected": None, "invalid_selection": None,
                "tool_names": ["apply", "narrate"], "provider_rounds": 2,
                "refusal_classes": [], "delivered": True, "fallback": False, **overrides}

    return [
        skill(1, False, "grok-build", "grok-4.6", provider_rounds=4),
        skill(2, True, "grok-build", "grok-4.6", selected="direct-authorized-change"),
        skill(3, True, "grok-build", "grok-4.6", selected="direct-authorized-change",
              delivered=False, fallback=True, refusal_classes=["action_not_authorized"],
              provider_rounds=5, tool_names=["apply", "apply"]),
        skill(4, True, "grok-build", "grok-4.6", invalid_selection="not-offered"),
        skill(5, False, "deepseek", "deepseek-v4.1-flash", provider_rounds=8),
        skill(6, True, "deepseek", "deepseek-v4.1-flash", selected="direct-authorized-change",
              provider_rounds=6, tool_names=["look", "apply", "narrate"]),
    ]


def test_skills_stratify_arms_and_exact_provider_model(skill_rows):
    result = kpi.skills(skill_rows)
    assert result["rows"] == 6
    strata = {(s["provider"], s["model"], s["enabled"]): s for s in result["strata"]}
    assert len(strata) == 4
    grok = strata["grok-build", "grok-4.6", True]
    assert grok["rows"] == grok["runs"] == grok["offered_runs"] == 3
    assert grok["offered"] == {"direct-authorized-change": 3}
    assert grok["selected"] == {"direct-authorized-change": 2}
    assert grok["selected_runs"] == 2
    assert grok["selection_rate"] == 0.667
    assert grok["invalid_selections"] == 1
    assert grok["delivered_after_selection"] == {"runs": 1, "observed": 2, "rate": 0.5}
    assert grok["fallback_after_selection"] == {"runs": 1, "observed": 2, "rate": 0.5}
    assert grok["refusals"] == {"runs": 1, "observed": 3, "rate": 0.333,
                                 "classes": {"action_not_authorized": 1}}
    assert grok["provider_rounds"] == {"samples": 3, "counts": {"2": 2, "5": 1},
                                         "min": 2, "max": 5, "median": 2, "mean": 3}
    assert grok["tool_sequences"] == [{"tool_names": ["apply", "apply"], "runs": 1},
                                       {"tool_names": ["apply", "narrate"], "runs": 2}]
    off = strata["grok-build", "grok-4.6", False]
    assert off["offered_runs"] == off["selected_runs"] == 0
    assert off["selection_rate"] is None
    assert off["provider_rounds"]["mean"] == 4
    deepseek = strata["deepseek", "deepseek-v4.1-flash", True]
    assert deepseek["provider_rounds"]["mean"] == 6
    assert deepseek["delivered_after_selection"]["rate"] == 1
    assert deepseek["fallback_after_selection"]["rate"] == 0
    # Same display/model name on a different route is still a separate stratum.
    other = {**skill_rows[1], "provider": "other",
             "provider_models": [{"provider": "other", "model": "grok-4.6", "rounds": 2}]}
    assert len(kpi.skills(skill_rows + [other])["strata"]) == 5
    assert grok["comparison_eligible"] is True
    assert grok["provider_models"] == [{"provider": "grok-build", "model": "grok-4.6", "rounds": 9}]
    assert kpi.skills(list(reversed(skill_rows))) == result


def test_skills_missing_optional_fields_are_not_false_outcomes():
    result = kpi.skills([{"lane": "skills", "enabled": True, "offered": ["repair-named-gap"],
                          "selected": "repair-named-gap"}])["unavailable_identity_runs"][0]
    assert result["provider"] is result["model"] is None
    assert result["delivered_after_selection"] == {"runs": 0, "observed": 0, "rate": None}
    assert result["fallback_after_selection"]["rate"] is None
    assert result["refusals"]["rate"] is None
    assert result["provider_rounds"]["samples"] == 0
    assert result["provider_rounds"]["mean"] is None
    assert result["tool_sequences"] == []
    assert result["tool_sequences_unavailable"] == 1
    assert result["wall_ms"]["status"] == result["admission"]["status"] == "unavailable"
    assert kpi.skills(SYNTHETIC_ROWS) == {}
    assert kpi.skills([]) == {}
    unknown = kpi.skills([{"lane": "skills"}])["unavailable_identity_runs"][0]
    assert unknown["comparison_eligible"] is False
    assert unknown["enabled"] is None  # Not silently assigned to the off arm.


def test_skills_join_only_exact_run_owned_evidence(skill_rows):
    run = skill_rows[1]
    evidence = [
        {**row(2, "table.player_input"), "campaign": "skills-test"},
        {**row(2, "narrate", ms=250), "campaign": "skills-test", "started_at": "2026-01-01T00:00:10Z"},
        {"lane": "admission", "campaign": "skills-test", "turn": 2, "ok": True,
         "verdict": "entailed", "reused": False, "ms": 400},
        {"lane": "admission", "campaign": "skills-test", "turn": 2, "ok": True,
         "verdict": "entailed", "reused": True, "ms": 0},
        {"lane": "admission", "campaign": "other", "turn": 2, "ok": False, "reason": "timeout"},
    ]
    evidence = [{**r, "run_id": run["run_id"]} for r in evidence]
    section = kpi.skills([run, *evidence])["strata"][0]
    assert section["wall_ms"]["mean"] == 10250
    assert section["wall_ms"]["unavailable_runs"] == 0
    assert section["admission"]["joined_runs"] == 1
    assert section["admission"]["summary"]["reviews"] == 1
    assert section["admission"]["summary"]["reused"] == 1
    assert section["admission"]["summary"]["unavailable"] == {}
    # RPC duration alone is not wall time; absent timestamps must stay unavailable.
    untimed = [{k: v for k, v in r.items() if k != "started_at"} for r in evidence]
    assert kpi.skills([run, *untimed])["strata"][0]["wall_ms"]["status"] == "unavailable"
    # A turn with no review rows does not prove that zero reviews occurred.
    no_reviews = kpi.skills([run, *evidence[:2]])["strata"][0]
    assert no_reviews["admission"]["status"] == "unavailable"
    assert no_reviews["admission"]["summary"] == {}
    # Duplicate settled rows for the same run cannot claim its evidence twice.
    for section in kpi.skills([run, {**run, "enabled": False}, *evidence])["strata"]:
        assert section["wall_ms"]["status"] == section["admission"]["status"] == "unavailable"
    for field in ("campaign", "turn", "run_id"):
        incomplete = {k: v for k, v in run.items() if k != field}
        section = kpi.skills([incomplete, *evidence])["strata"][0]
        assert section["wall_ms"]["status"] == section["admission"]["status"] == "unavailable"
    # File-scoped identity is explicit evidence, unlike row order or matching timestamps.
    file_rows = [{k: v for k, v in r.items() if k != "campaign"} for r in [run, *evidence[:4]]]
    assert kpi.skills(file_rows, campaign="skills-test")["strata"][0]["wall_ms"]["mean"] == 10250
    for invalid_id in (None, "", " ", "different", 42):
        conflicting = [{**r, "run_id": invalid_id} for r in evidence]
        section = kpi.skills([run, *conflicting])["strata"][0]
        assert section["wall_ms"]["status"] == section["admission"]["status"] == "unavailable"
    missing_ids = [{k: v for k, v in r.items() if k != "run_id"} for r in evidence]
    section = kpi.skills([run, *missing_ids])["strata"][0]
    assert section["wall_ms"]["status"] == section["admission"]["status"] == "unavailable"


def test_skills_recovery_cannot_borrow_unledgered_run_evidence(skill_rows):
    run = skill_rows[1]
    old = [
        {**row(2, "table.player_input"), "campaign": "skills-test", "run_id": "interrupted"},
        {"lane": "admission", "campaign": "skills-test", "turn": 2, "run_id": "interrupted",
         "ok": True, "verdict": "entailed", "ms": 400},
    ]
    delivery = {**row(2, "narrate", ms=100), "campaign": "skills-test", "run_id": run["run_id"],
                "started_at": "2026-01-01T00:00:10Z"}
    for old_rows in (old, [{k: v for k, v in r.items() if k != "run_id"} for r in old]):
        section = kpi.skills([*old_rows, delivery, run])["strata"][0]
        assert section["wall_ms"]["status"] == section["admission"]["status"] == "unavailable"
    # Separate fully owned runs on the same turn can independently join their own rows.
    second = {**run, "run_id": "second", "enabled": False, "selected": None, "offered": []}
    owned = [{**r, "run_id": run["run_id"]} for r in old]
    report = kpi.skills([run, second, *owned, delivery])
    by_arm = {s["enabled"]: s for s in report["strata"]}
    assert by_arm[True]["wall_ms"]["mean"] == 10100
    assert by_arm[False]["wall_ms"]["status"] == by_arm[False]["admission"]["status"] == "unavailable"


def test_skills_mixed_run_is_separate_and_keeps_exact_identity_rounds(skill_rows):
    models = [{"provider": "route-a", "model": "model-a", "rounds": 2},
              {"provider": "route-b", "model": "model-b", "rounds": 1}]
    mixed = {**skill_rows[1], "run_id": "mixed", "provider": None, "model": None,
             "provider_rounds": 3, "provider_models": models, "mixed_provider_model": True}
    report = kpi.skills([*skill_rows, mixed])
    assert report["rows"] == 7
    assert report["strata"] == kpi.skills(skill_rows)["strata"]
    assert report["unavailable_identity_runs"] == []
    entry, = report["mixed_runs"]
    assert entry["comparison_eligible"] is False
    assert entry["identity_status"] == "mixed"
    assert entry["provider"] is entry["model"] is None
    assert entry["provider_models"] == models
    assert entry["run_id"] == "mixed"
    assert entry["provider_rounds"]["mean"] == 3
    assert entry["tool_sequences"] == [{"tool_names": ["apply", "narrate"], "runs": 1}]
    assert kpi.skills([mixed, *reversed(skill_rows)]) == report


@pytest.mark.parametrize("overrides", [
    {"provider_models": None}, {"provider_models": []}, {"provider_models": "bad"},
    {"provider_models": [None]},
    {"provider_models": [{"provider": "grok-build", "model": "grok-4.6", "rounds": True}]},
    {"provider_models": [{"provider": "grok-build", "model": "grok-4.6", "rounds": -1}]},
    {"provider_models": [{"provider": "", "model": "grok-4.6", "rounds": 2}]},
    {"provider_models": [{"provider": "grok-build", "model": [], "rounds": 2}]},
    {"mixed_provider_model": True}, {"mixed_provider_model": "false"},
    {"provider": "different"}, {"provider_rounds": 3},
    {"provider_models": [{"provider": "a", "model": "a", "rounds": 1},
                         {"provider": "b", "model": "b", "rounds": 1}]},
    {"mixed_provider_model": True,
     "provider_models": [{"provider": "a", "model": "a", "rounds": 1},
                         {"provider": "b", "model": "b", "rounds": 1}]},
    {"provider_models": [{"provider": "a", "model": "b", "rounds": 1}] * 2},
])
def test_skills_malformed_identity_is_not_comparison_eligible(skill_rows, overrides):
    report = kpi.skills([{**skill_rows[1], **overrides}])
    assert report["strata"] == []
    assert report["rows"] == 1
    entry, = report["mixed_runs"] + report["unavailable_identity_runs"]
    assert entry["identity_status"] == "unavailable"
    assert entry["comparison_eligible"] is False
    assert entry["provider"] is entry["model"] is None


@pytest.mark.parametrize("field", ["provider", "model"])
@pytest.mark.parametrize("value", [None, "", " ", "different"])
def test_skills_new_identity_requires_matching_nonempty_top_level_fields(skill_rows, field, value):
    run = {**skill_rows[1], field: value}
    report = kpi.skills([run])
    assert report["strata"] == report["mixed_runs"] == []
    entry, = report["unavailable_identity_runs"]
    assert entry["identity_status"] == "unavailable"
    assert entry["comparison_eligible"] is False


@pytest.mark.parametrize("field", ["provider", "model"])
def test_skills_new_identity_requires_present_top_level_fields(skill_rows, field):
    run = {k: v for k, v in skill_rows[1].items() if k != field}
    report = kpi.skills([run])
    assert report["strata"] == report["mixed_runs"] == []
    entry, = report["unavailable_identity_runs"]
    assert entry["identity_status"] == "unavailable"
    assert entry["comparison_eligible"] is False


def test_skills_historical_identity_counts_without_run_joins(skill_rows):
    historical = [{k: v for k, v in r.items()
                   if k not in ("run_id", "provider_models", "mixed_provider_model")} for r in skill_rows]
    report = kpi.skills(historical)
    assert report["rows"] == 6
    assert len(report["strata"]) == 4
    assert report["mixed_runs"] == report["unavailable_identity_runs"] == []
    for entry in report["strata"]:
        assert entry["provider_models_unavailable_runs"] == entry["runs"]
        assert entry["provider_models"][0]["rounds"] is None
        assert entry["provider_rounds"]["samples"] == entry["runs"]
        assert entry["tool_sequences_unavailable"] == 0
        assert entry["wall_ms"]["status"] == entry["admission"]["status"] == "unavailable"
    assert kpi.skills(SYNTHETIC_ROWS) == {}


def test_skills_cli_is_json_and_respects_turn_filter(tmp_path, skill_rows):
    write_telemetry(tmp_path / "campaigns" / "skills-test" / "telemetry.jsonl", skill_rows)
    args = [sys.executable, str(KPI_SCRIPT), "--workspace", str(tmp_path),
            "--campaign", "skills-test", "--turns", "2-3"]
    result = subprocess.run(args, capture_output=True, text=True, check=True)
    line = next(line for line in result.stdout.splitlines() if line.startswith("skills: "))
    report = json.loads(line.removeprefix("skills: "))
    assert report == kpi.skills(skill_rows, (2, 3), "skills-test")
    assert report["rows"] == 2
    assert len(report["strata"]) == 1
    assert subprocess.run(args, capture_output=True, text=True, check=True).stdout == result.stdout


def test_a_lane_failure_reaches_the_printed_report(tmp_path):
    """The section is worthless if it stops at the dict: the whole defect was that nobody
    reading a campaign's KPI ever saw these rows."""
    telemetry = tmp_path / "ws" / "campaigns" / "c1" / "telemetry.jsonl"
    telemetry.parent.mkdir(parents=True)
    write_telemetry(telemetry, [
        row(1, "apply", call_id="t1-c1", ok=True),
        {"turn": 1, "lane": "memory", "ok": False, "reason": "lane_error"},
    ])
    result = subprocess.run(
        [sys.executable, str(KPI_SCRIPT), "--workspace", str(tmp_path / "ws"), "--campaign", "c1"],
        capture_output=True, text=True, check=True,
    )
    assert "lanes:" in result.stdout
    assert "memory" in result.stdout
