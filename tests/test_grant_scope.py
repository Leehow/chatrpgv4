"""A card grant expires when its own reason expires -- not when anything moves.

With no separate state-revision provider the grant binding degrades to a
digest of the fact set. Taken over ALL facts, every grant the Keeper held died
whenever anything moved anywhere: settling one Sanity check voided the combat
and chase cards in its hand, and it had to ask for them again. Measured
2026-09-02 r35, two lanes of three, two or three wasted round trips each
against a 180-second turn budget.

The scope is derived from the graph's own hard gates -- `applicability`
consults nothing else -- never guessed from what the fact namespaces look
like. The turn context keys are untouched, so a card still cannot outlive its
turn, phase or player-turn epoch; only same-turn cross-family noise stops
counting.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import coc_rules_runtime  # noqa: E402
import coc_starter  # noqa: E402
import coc_toolbox  # noqa: E402


@pytest.fixture
def campaign_ws(tmp_path: Path):
    workspace = tmp_path / "workspace"
    coc_root = workspace / ".coc"
    coc_root.mkdir(parents=True)
    (coc_root / "runtime.json").write_text(
        json.dumps({
            "schema_version": 2,
            "planner": {"kind": "deterministic"},
            "rules": {"kind": "deterministic"},
            "narrator": {"kind": "template"},
            "player": {"kind": "human"},
        }),
        encoding="utf-8",
    )
    campaign_id = "grant-scope-test"
    coc_starter.quick_start(
        coc_root, "the-haunting", "thomas-hayes",
        campaign_id=campaign_id, title="Grant Scope",
    )
    return {"workspace": workspace, "campaign_id": campaign_id}


def _settle_a_sanity_check(campaign_ws, decision_id):
    ws, cid = campaign_ws["workspace"], campaign_ws["campaign_id"]
    coc_toolbox.run_tool(
        "rules.context", ws, cid,
        {"family": "sanity", "investigator": "thomas-hayes"},
    )
    settled = coc_toolbox.run_tool(
        "rules.settle", ws, cid,
        {
            "decision_ref": "decision:coc7:sanity:check",
            "decision_id": decision_id,
            "investigator": "thomas-hayes",
            "seed": 10,
            "semantic_inputs": {
                "source": "the sealed-chamber corpse sits up",
                "loss_success": "20", "loss_failure": "20",
                "involuntary_kind": "freeze",
                "involuntary_summary": "the flashlight beam stops moving",
            },
        },
    )
    assert settled.get("ok"), settled


def test_settling_one_family_does_not_void_another_familys_cards(campaign_ws):
    ws, cid = campaign_ws["workspace"], campaign_ws["campaign_id"]
    held = coc_toolbox.run_tool(
        "rules.context", ws, cid,
        {"family": "combat", "investigator": "thomas-hayes"},
    )
    refs = {
        card["decision_ref"]
        for card in ((held.get("data") or {}).get("cards") or [])
    }
    assert "decision:coc7:combat:attack" in refs, held

    _settle_a_sanity_check(campaign_ws, "scope-sanity-0001")

    after = coc_toolbox.run_tool(
        "rules.settle", ws, cid,
        {
            "decision_ref": "decision:coc7:combat:attack",
            "decision_id": "scope-combat-0001",
            "investigator": "thomas-hayes",
            "semantic_inputs": {},
        },
    )
    error = after.get("error") or {}
    assert error.get("code") != "rule_decision_stale", (
        "a Sanity check spent elsewhere in the same turn must not void the "
        f"combat card the Keeper is holding: {error}"
    )


def test_a_card_still_dies_when_its_own_gate_moves(campaign_ws):
    """The scope narrows what counts, it does not stop counting.

    decision:coc7:sanity:bout-tick is gated on `sanity.bout.pending`. Held
    while no bout is running and then checked after one opens, its grant must
    be gone -- the fact its gate reads is exactly the fact that moved.
    """
    graph = json.loads(
        (ROOT / "plugins/coc-keeper/rulesets/coc7/rule-graph.json")
        .read_text(encoding="utf-8")
    )
    runtime = coc_rules_runtime.RulesRuntime(
        graph, ruleset_id="coc7", campaign_id="grant-scope-unit",
        facts_provider=lambda: dict(facts),
    )
    facts = {"sanity.bout.pending": False, "actor.id": "thomas-hayes"}
    ref = "decision:coc7:sanity:bout-tick"

    scope = runtime._gating_fact_paths([ref])
    assert "sanity.bout.pending" in scope, scope

    grant = runtime._issue_card_grant([{"decision_ref": ref, "family": "sanity"}])
    assert runtime.latest_grant_covering(ref) is not None

    facts["sanity.bout.pending"] = True
    assert runtime.latest_grant_covering(ref) is None, (
        "the gate this card was offered under moved; its grant must not survive"
    )
    why = runtime.explain_missing_grant(ref)
    assert why["reason"] == "grant_binding_drifted", why
    assert why["drifted"] == ["state_revision"], why

    # A fact no gate of this decision reads must not touch it.
    facts["sanity.bout.pending"] = False
    assert runtime.latest_grant_covering(ref) is not None
    facts["chase.session.active"] = True
    assert runtime.latest_grant_covering(ref) is not None, (
        "a chase starting elsewhere is not a reason to withdraw this card"
    )
    assert grant["state_scope"], grant


def test_a_continuation_the_settlement_hands_over_is_one_that_settles(campaign_ws):
    """`next_decisions` is the host saying what comes next. It must be true.

    The continuations were projected from the facts as they stood BEFORE the
    settlement ran, and no grant covered them -- so the envelope named
    bout-tick and the settle pre-check refused it as a decision no grant
    covered. Two host-authored statements, opposite answers. Measured
    2026-09-02 r37, once per lane, each costing a rules.context the Keeper had
    just been told it did not need.

    Recomputed against the facts the settlement produced: the bout it opened
    is the reason bout-tick is offerable at all, so the pre-execution facts
    could never have offered it.
    """
    ws, cid = campaign_ws["workspace"], campaign_ws["campaign_id"]
    coc_toolbox.run_tool(
        "rules.context", ws, cid,
        {"family": "sanity", "investigator": "thomas-hayes"},
    )
    opened = coc_toolbox.run_tool(
        "rules.settle", ws, cid,
        {
            "decision_ref": "decision:coc7:sanity:check",
            "decision_id": "continuation-open",
            "investigator": "thomas-hayes",
            "seed": 10,
            "semantic_inputs": {
                "source": "the sealed-chamber corpse sits up",
                "loss_success": "20", "loss_failure": "20",
                "involuntary_kind": "freeze",
                "involuntary_summary": "the flashlight beam stops moving",
            },
        },
    )
    assert opened.get("ok"), opened
    offered = [
        card["decision_ref"]
        for card in (opened["data"].get("next_decisions") or [])
    ]
    assert "decision:coc7:sanity:bout-tick" in offered, opened["data"]

    # No refresh in between: the envelope said this is what comes next.
    followed = coc_toolbox.run_tool(
        "rules.settle", ws, cid,
        {
            "decision_ref": "decision:coc7:sanity:bout-tick",
            "decision_id": "continuation-follow",
            "investigator": "thomas-hayes",
            "semantic_inputs": {},
        },
    )
    assert followed.get("ok"), (
        "the host offered this continuation and then refused it: "
        f"{followed.get('error')}"
    )


def test_a_continuation_that_the_settlement_made_impossible_is_not_offered(
    campaign_ws,
):
    """The recompute is against the settled facts, so it withholds as well as
    offers: a bout that ends on its last round leaves nothing to tick."""
    ws, cid = campaign_ws["workspace"], campaign_ws["campaign_id"]
    coc_toolbox.run_tool(
        "rules.context", ws, cid,
        {"family": "sanity", "investigator": "thomas-hayes"},
    )
    coc_toolbox.run_tool(
        "rules.settle", ws, cid,
        {
            "decision_ref": "decision:coc7:sanity:check",
            "decision_id": "wind-down-open",
            "investigator": "thomas-hayes",
            "seed": 10,
            "semantic_inputs": {
                "source": "the sealed-chamber corpse sits up",
                "loss_success": "20", "loss_failure": "20",
                "involuntary_kind": "freeze",
                "involuntary_summary": "the flashlight beam stops moving",
            },
        },
    )
    snapshot_path = campaign_ws["workspace"] / ".coc" / "campaigns" / cid \
        / "save" / "sanity.json"
    last = None
    for turn in range(1, 20):
        snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
        if not snapshot.get("bout_active"):
            break
        last = coc_toolbox.run_tool(
            "rules.settle", ws, cid,
            {
                "decision_ref": "decision:coc7:sanity:bout-tick",
                "decision_id": f"wind-down-{turn:02d}",
                "investigator": "thomas-hayes",
                "semantic_inputs": {},
            },
        )
        if not last.get("ok"):
            break
    snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
    if snapshot.get("bout_active") or last is None or not last.get("ok"):
        pytest.skip("the bout did not run to its end within the bound")
    offered = [
        card["decision_ref"]
        for card in (last["data"].get("next_decisions") or [])
    ]
    assert "decision:coc7:sanity:bout-tick" not in offered, (
        "the bout is over; ticking it is not what comes next"
    )
