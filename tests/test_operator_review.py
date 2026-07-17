import importlib.util
import json
from pathlib import Path

import pytest


PATH = Path("plugins/coc-keeper/scripts/coc_operator_review.py")
SPEC = importlib.util.spec_from_file_location("coc_operator_review_test", PATH)
review = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(review)


def _payload(run_id="run-1", *, fact_decision="pass"):
    return {
        "schema_version": 1,
        "protocol": "operator_codex_black_box_v2",
        "run_id": run_id,
        "reviewer": {"kind": "codex", "id": "thread-reviewer"},
        "dimensions": {
            name: {
                "decision": fact_decision if name == "facts" else "pass",
                "notes": f"Reviewed {name} against the transcript and structured logs.",
                "evidence_refs": ["partial-transcript.jsonl#line-1"],
            }
            for name in review.DIMENSIONS
        },
    }


def _subagent_payload(
    run_id="run-1",
    *,
    player_id="player-agent-01",
    reviewer_id="main-reviewer-01",
):
    payload = _payload(run_id)
    payload["protocol"] = "codex_subagent_player_v1"
    payload["player"] = {"kind": "codex_subagent", "id": player_id}
    payload["reviewer"] = {"kind": "codex", "id": reviewer_id}
    return payload


def test_operator_review_requires_all_four_dimensions_and_never_claims_automated_fact_pass():
    result = review.validate_review(_payload(), run_id="run-1")
    assert result["status"] == "approved"
    assert result["automated_fact_fidelity_pass"] is False
    assert set(result["dimensions"]) == {"rules", "facts", "progression", "style"}


def test_operator_review_failure_requires_changes():
    result = review.validate_review(_payload(fact_decision="fail"), run_id="run-1")
    assert result["status"] == "changes_required"


def test_operator_review_rejects_missing_evidence_refs():
    payload = _payload()
    payload["dimensions"]["rules"]["evidence_refs"] = []
    with pytest.raises(ValueError, match="evidence_refs"):
        review.validate_review(payload, run_id="run-1")


def test_operator_v2_requires_same_codex_reviewer_kind():
    payload = _payload()
    payload["reviewer"] = {"kind": "human", "id": "different-reviewer"}
    with pytest.raises(ValueError, match="same main Codex"):
        review.validate_review(payload, run_id="run-1")


def test_codex_subagent_review_requires_separate_main_codex_reviewer():
    result = review.validate_review(
        _subagent_payload(), run_id="run-1", player_id="player-agent-01"
    )
    assert result["status"] == "approved"
    assert result["player"] == {
        "kind": "codex_subagent", "id": "player-agent-01"
    }
    assert result["reviewer"] == {"kind": "codex", "id": "main-reviewer-01"}

    with pytest.raises(ValueError, match="must be separate"):
        review.validate_review(
            _subagent_payload(reviewer_id="player-agent-01"),
            run_id="run-1",
            player_id="player-agent-01",
        )

    with pytest.raises(ValueError, match="does not match .*evidence"):
        review.validate_review(
            _subagent_payload(player_id="different-player"),
            run_id="run-1",
            player_id="player-agent-01",
        )


def _issue(
    run_id="run-1", *, issue_id="issue-1", issue_class="transition_quality",
    occurrence=1, disposition="continue_and_accumulate",
):
    return {
        "schema_version": 1,
        "protocol": "operator_codex_black_box_v2",
        "run_id": run_id,
        "issue_id": issue_id,
        "issue_class": issue_class,
        "occurrence": occurrence,
        "disposition": disposition,
        "summary": "The transition used a generic template fallback.",
        "turn_refs": ["turn-002"],
        "evidence_refs": ["partial-transcript.jsonl#line-2"],
    }


def test_operator_v2_single_style_or_transition_issue_continues_and_accumulates():
    result = review.validate_issue(_issue(), run_id="run-1")
    assert result["disposition"] == "continue_and_accumulate"
    assert result["issue_class"] == "transition_quality"


@pytest.mark.parametrize(
    "issue_class",
    sorted(review.HARD_STOP_ISSUE_CLASSES),
)
def test_operator_v2_integrity_or_crash_issue_stops_immediately(issue_class):
    result = review.validate_issue(
        _issue(issue_class=issue_class, disposition="stop_and_fix"),
        run_id="run-1",
    )
    assert result["disposition"] == "stop_and_fix"


def test_operator_v2_repeated_soft_issue_escalates_to_stop():
    result = review.validate_issue(
        _issue(
            issue_id="issue-2", occurrence=2, disposition="stop_and_fix",
        ),
        run_id="run-1",
    )
    assert result["occurrence"] == 2
    with pytest.raises(ValueError, match="disposition conflicts"):
        review.validate_issue(
            _issue(issue_id="issue-2", occurrence=2), run_id="run-1"
        )


def test_record_issue_enforces_class_occurrence_and_supports_partial_run(tmp_path):
    run_dir = tmp_path / "partial-run"
    run_dir.mkdir()
    first = _issue(run_id=run_dir.name)
    first_path = run_dir / "first.json"
    first_path.write_text(json.dumps(first), encoding="utf-8")
    ledger = review.record_issue(run_dir, first_path)

    second = _issue(
        run_id=run_dir.name,
        issue_id="issue-2",
        occurrence=2,
        disposition="stop_and_fix",
    )
    second_path = run_dir / "second.json"
    second_path.write_text(json.dumps(second), encoding="utf-8")
    assert review.record_issue(run_dir, second_path) == ledger
    rows = [json.loads(line) for line in ledger.read_text().splitlines()]
    assert [row["occurrence"] for row in rows] == [1, 2]
    assert [row["disposition"] for row in rows] == [
        "continue_and_accumulate", "stop_and_fix",
    ]

    skipped = _issue(
        run_id=run_dir.name,
        issue_id="issue-3",
        occurrence=4,
        disposition="stop_and_fix",
    )
    skipped_path = run_dir / "skipped.json"
    skipped_path.write_text(json.dumps(skipped), encoding="utf-8")
    with pytest.raises(ValueError, match="occurrence"):
        review.record_issue(run_dir, skipped_path)
