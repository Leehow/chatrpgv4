"""The coverage measurement must count settle receipts, not log mentions.

Matching decision ids against the whole diagnostic log reports every decision
as covered, because `rules.context` hands the Keeper the entire card catalogue
and every id therefore appears in every lane's log. That reading said 43/43
while the true figure was 13, and it would have declared the rule layer done.
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import sys

import pytest

ROOT = Path(__file__).resolve().parents[1]
TOOL = ROOT / "scripts" / "rule_decision_coverage.py"

SETTLED = "decision:coc7:sanity:check"
REFUSED = "decision:coc7:chase:end"
CATALOGUED = "decision:coc7:magic:learn-spell"


def _module():
    spec = importlib.util.spec_from_file_location("rule_decision_coverage", TOOL)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _settle(call, decision_ref, *, ok, code=None):
    start = {
        "operation": "rules.settle", "phase": "start",
        "event": {"toolCallId": call, "args": {"decision_ref": decision_ref}},
    }
    details = (
        {"ok": True, "data": {"status": "settled", "decision_ref": decision_ref}}
        if ok else {"ok": False, "error": {"code": code}}
    )
    end = {
        "operation": "rules.settle", "phase": "end",
        "event": {"toolCallId": call, "result": {"details": details}},
    }
    return [start, end]


@pytest.fixture
def corpus(tmp_path: Path) -> Path:
    """One lane: one decision settled, one refused, one only ever catalogued."""
    lane = tmp_path / "debug-run-r1" / "lanes" / "lane-a"
    lane.mkdir(parents=True)
    rows = [
        # The catalogue every lane receives -- every decision id appears here,
        # which is exactly what a naive substring count would score.
        {"operation": "rules.context", "phase": "end", "event": {"result": {
            "details": {"ok": True, "data": {"cards": [
                {"decision_ref": SETTLED},
                {"decision_ref": REFUSED},
                {"decision_ref": CATALOGUED},
            ]}}}}},
        *_settle("c1", SETTLED, ok=True),
        *_settle("c2", REFUSED, ok=False, code="rule_decision_stale"),
    ]
    (lane / "rules.jsonl").write_text(
        "\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n",
        encoding="utf-8",
    )
    return tmp_path


def test_only_a_settle_receipt_counts_as_coverage(corpus: Path):
    module = _module()
    report = module.measure(corpus, [SETTLED, REFUSED, CATALOGUED])
    state = {row["decision"]: row for row in report["decisions"]}

    assert state[SETTLED]["state"] == "settled"
    assert state[SETTLED]["lanes"] == ["r1/lane-a"]

    # Asked for and refused: the rule layer's problem, and the codes say which.
    assert state[REFUSED]["state"] == "refused"
    assert state[REFUSED]["codes"] == {"rule_decision_stale": 1}

    # Present in the catalogue the Keeper was shown, and never settled. A
    # count over the raw log would have called this covered.
    assert state[CATALOGUED]["state"] == "never"
    assert CATALOGUED in (corpus / "debug-run-r1" / "lanes" / "lane-a"
                          / "rules.jsonl").read_text(encoding="utf-8")


def test_the_three_states_are_reported_separately(corpus: Path):
    """`refused` and `never` want different work -- the rule layer versus the
    Keeper's choice of decision -- so collapsing them into "not covered" hides
    which one a number is measuring."""
    module = _module()
    rendered = module.render(
        module.measure(corpus, [SETTLED, REFUSED, CATALOGUED])
    )
    assert "1 settled, 1 refused, 1 never asked for" in rendered
    assert "rule_decision_stalex1" in rendered


def test_the_graph_supplies_the_denominator():
    """43 decisions, read from the shipped RuleGraph rather than frozen here;
    a hardcoded count is one more thing to forget when a family is added."""
    module = _module()
    decisions = module.decision_nodes(module.GRAPH)
    assert len(decisions) == len({*decisions})
    assert SETTLED in decisions and REFUSED in decisions
    graph = json.loads(module.GRAPH.read_text(encoding="utf-8"))
    assert len(decisions) == sum(
        node.get("node_kind") == "decision" for node in graph["nodes"]
    )


def test_the_tool_runs_end_to_end(corpus: Path):
    module = _module()
    assert module.main([str(corpus)]) == 0
    assert module.main([str(corpus / "nowhere")]) == 2


def test_context_phase_decisions_get_their_own_bucket():
    """combat:context and sanity:context implement phase `context`: the settle
    dispatch has no branch for them and never will. Scoring them against
    settle receipts measures the impossible, so they are reported apart from
    `never asked for` instead of inflating the uncovered count."""
    module = _module()
    phase = module.context_phase_nodes(module.GRAPH)
    assert phase == frozenset({
        "decision:coc7:combat:context",
        "decision:coc7:sanity:context",
    })


def test_context_phase_is_reported_separately_from_never(corpus: Path):
    module = _module()
    context_decision = "decision:coc7:sanity:context"
    report = module.measure(
        corpus, [SETTLED, context_decision], frozenset({context_decision}),
    )
    state = {row["decision"]: row for row in report["decisions"]}
    assert state[context_decision]["state"] == "context_phase"
    rendered = module.render(report)
    assert "1 context-phase read-only" in rendered
