"""A refused settlement must say why no grant covered it.

The kernel's pre-check reported only "no live machine-issued card grant
covers this decision". That reads the same whether the Keeper settled a
decision it never asked cards for, or a grant existed and canonical state
moved underneath it — and those need different answers. Five stale
settlements across three lanes on 2026-09-02 came through here carrying no
reason at all, which is why the cause had to be hunted by hand.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import coc_rules_runtime as runtime_module  # noqa: E402

GRAPH = json.loads(
    (ROOT / "plugins/coc-keeper/rulesets/coc7/rule-graph.json").read_text(
        encoding="utf-8",
    )
)
REF = "decision:coc7:combat:flee"


def _runtime(facts):
    return runtime_module.RulesRuntime(
        GRAPH,
        ruleset_id="coc7",
        campaign_id="grant-diagnosis",
        facts_provider=lambda: dict(facts),
    )


def test_a_decision_never_asked_for_says_so():
    runtime = _runtime({"actor.id": "a"})
    why = runtime.explain_missing_grant(REF)
    assert why["reason"] == "no_grant_for_decision"
    assert "rules.context" in why["detail"]
    assert "drifted" not in why


def test_state_that_moved_names_the_keys_that_moved():
    facts = {"actor.id": "a", "actor.resources.hp": 10}
    runtime = _runtime(facts)
    runtime._grants["g1"] = {
        "grant_id": "g1",
        "decision_refs": [REF],
        "binding": {**runtime._grant_binding(), "state_revision": "sha256:old"},
    }
    why = runtime.explain_missing_grant(REF)
    assert why["reason"] == "grant_binding_drifted"
    assert why["drifted"] == ["state_revision"]


def test_a_matching_grant_is_not_reported_as_drift():
    """The first version of this method returned `grant_binding_drifted` with
    an empty key list whenever a covering grant existed — an invented cause
    that sent the investigation the wrong way."""
    runtime = _runtime({"actor.id": "a"})
    runtime._grants["g1"] = {
        "grant_id": "g1",
        "decision_refs": [REF],
        "binding": runtime._grant_binding(),
    }
    why = runtime.explain_missing_grant(REF)
    assert why["reason"] == "grant_binding_unstable"
    assert why.get("drifted") in (None, [])
    assert "moved between the two reads" in why["detail"]
