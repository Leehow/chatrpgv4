"""Scope guards for parse-risk metrics: only delivered effects count."""
import importlib.util


def _load(name: str, relative_path: str):
    spec = importlib.util.spec_from_file_location(name, relative_path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


metrics = _load(
    "coc_epistemic_metrics_scope_tests",
    "plugins/coc-keeper/scripts/coc_epistemic_metrics.py",
)


def test_parse_risk_ignores_undelivered_nodes_and_ranges():
    result = metrics.compute_epistemic_metrics(
        [
            {
                "event_type": "belief_confirmed",
                "question_id": "q-delivered",
                "mode": "CONFIRM",
            }
        ],
        compile_confidence={
            "default_threshold": 0.8,
            "nodes": [
                {
                    "node_type": "question",
                    "node_id": "q-undelivered",
                    "importance": "critical",
                    "effective_confidence": 0.3,
                    "review_state": "needs_review",
                }
            ],
        },
        parse_manifest={
            "default_threshold": 0.8,
            "ranges": [
                {
                    "range_id": "range-undelivered",
                    "quality": {"overall": 0.2},
                    "review_state": "needs_review",
                }
            ],
        },
    )

    assert result["parse_risk_exposure"] == {"count": 0, "findings": []}


def test_parse_risk_counts_delivered_critical_node():
    result = metrics.compute_epistemic_metrics(
        [
            {
                "event_type": "belief_complicated",
                "question_id": "q-risk",
                "mode": "COMPLICATE",
            }
        ],
        compile_confidence={
            "default_threshold": 0.8,
            "nodes": [
                {
                    "node_type": "question",
                    "node_id": "q-risk",
                    "importance": "critical",
                    "effective_confidence": 0.5,
                    "review_state": "needs_review",
                }
            ],
        },
    )

    findings = result["parse_risk_exposure"]["findings"]
    assert result["parse_risk_exposure"]["count"] == 1
    assert findings[0]["node_id"] == "q-risk"


def test_parse_risk_counts_explicitly_linked_parse_range():
    result = metrics.compute_epistemic_metrics(
        [
            {
                "event_type": "belief_reframed",
                "question_id": "q-safe",
                "mode": "REFRAME",
                "source_range_ids": ["range-used"],
                "reveal_contract_id": "rc-safe",
                "preserve_fact_refs": ["truth-old"],
                "setup_refs": ["clue-a", "clue-b"],
            }
        ],
        parse_manifest={
            "default_threshold": 0.8,
            "ranges": [
                {
                    "range_id": "range-used",
                    "quality": {"overall": 0.6},
                    "review_state": "needs_review",
                },
                {
                    "range_id": "range-unused",
                    "quality": {"overall": 0.1},
                    "review_state": "rejected",
                },
            ],
        },
    )

    findings = result["parse_risk_exposure"]["findings"]
    assert result["parse_risk_exposure"]["count"] == 1
    assert findings[0]["range_id"] == "range-used"
