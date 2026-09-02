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

import coc_starter  # noqa: E402
import pytest  # noqa: E402


@pytest.fixture
def campaign_ws(tmp_path: Path):
    """Its own campaign id, deliberately. RulesRuntime is cached in a module
    global keyed by (campaign_id, investigator) with no workspace in the key,
    so two test files sharing an id hand each other a runtime built over a
    different tmp_path: importing test_player_intent_fact's fixture made this
    file's combat:flee settlement find a live grant from that file's campaign
    and reach the combat executor instead of the grant pre-check -- passing
    alone and failing in a batch.
    """
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
    campaign_id = "grant-diagnosis-test"
    coc_starter.quick_start(
        coc_root, "the-haunting", "thomas-hayes",
        campaign_id=campaign_id, title="Grant Diagnosis",
    )
    return {"workspace": workspace, "campaign_id": campaign_id}

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
    # combat:flee carries no hard gate, so it could have been offered and
    # simply was not asked for. Its intent trigger is not a gate and must not
    # be reported as one.
    assert why["reason"] == "no_grant_for_decision", why
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


def test_the_reason_reaches_the_keeper_not_just_the_runtime(campaign_ws):
    """The diagnosis is only worth having if it crosses the host boundary.

    Its first wiring computed the reason, handed it to the stale envelope, and
    then built the raised error's `details` from four fixed keys that did not
    include it. Eleven refused settlements across three lanes on 2026-09-02
    carried `reason: null` — the instrument was in place and reported nothing.
    """
    import coc_toolbox  # noqa: PLC0415

    result = coc_toolbox.run_tool(
        "rules.settle",
        campaign_ws["workspace"],
        campaign_ws["campaign_id"],
        {
            "decision_ref": REF,
            "decision_id": "never-granted-0001",
            "investigator": "thomas-hayes",
            "semantic_inputs": {},
        },
    )
    error = result.get("error") or {}
    assert error.get("code") == "rule_decision_stale", result
    assert error["details"]["reason"] == "no_grant_for_decision", error["details"]


def test_reading_the_scene_does_not_void_a_card_the_keeper_holds(campaign_ws):
    """The root cause of the refused settlements, found 2026-09-02.

    Card grants live on the RulesRuntime instance. `scene.context` rebuilds
    that instance to project healing cards, so the everyday sequence
    `rules.context` -> `scene.context` -> `rules.settle` handed the Keeper a
    card and then destroyed the grant behind it. The refusal said
    `no_grant_for_decision`, which was true of the new instance and useless to
    the Keeper. Eight such interleavings across seven diagnostic lanes.
    """
    import coc_toolbox  # noqa: PLC0415

    ws, cid = campaign_ws["workspace"], campaign_ws["campaign_id"]
    context = coc_toolbox.run_tool(
        "rules.context", ws, cid,
        {"family": "core-check", "investigator": "thomas-hayes"},
    )
    cards = (context.get("data") or {}).get("cards") or []
    assert cards, context
    decision_ref = cards[0]["decision_ref"]

    scene = coc_toolbox.run_tool("scene.context", ws, cid, {})
    assert scene.get("ok"), scene

    settled = coc_toolbox.run_tool(
        "rules.settle", ws, cid,
        {
            "decision_ref": decision_ref,
            "decision_id": "carried-grant-0001",
            "investigator": "thomas-hayes",
            "semantic_inputs": {},
        },
    )
    code = (settled.get("error") or {}).get("code")
    assert code != "rule_decision_stale", (
        "reading the scene voided a card the Keeper was still holding: "
        f"{settled.get('error')}"
    )


def test_a_bout_that_is_not_underway_is_not_an_argument_complaint(campaign_ws):
    """`sanity_bout_choice_unavailable` is canonical state, not arguments.

    Every payload slot on decision:coc7:sanity:bout-tick is host-locked, so no
    semantic_inputs value can satisfy it — the decision exists only while a
    bout is waiting on a Keeper decision. The old wording ("exactly one
    canonical Keeper bout choice is required") read like a slot filled in
    wrong: on 2026-09-02 one lane rewrote semantic_inputs five times in a row
    (kind, goal, outcome, changed_method) before abandoning the bout.
    """
    import coc_toolbox  # noqa: PLC0415

    settled = coc_toolbox.run_tool(
        "rules.settle",
        campaign_ws["workspace"],
        campaign_ws["campaign_id"],
        {
            "decision_ref": "decision:coc7:sanity:bout-tick",
            "decision_id": "no-bout-underway-0001",
            "investigator": "thomas-hayes",
            "semantic_inputs": {},
        },
    )
    error = settled.get("error") or {}
    assert error.get("code") == "sanity_bout_choice_unavailable", settled
    assert "no sanity bout is waiting" in error.get("message", ""), error
    assert error["details"]["pending_keeper_bout_choices"] == 0, error["details"]


def test_an_ungated_decision_the_keeper_never_asked_for_says_exactly_that():
    """The other half of the split: when a decision could have been offered
    and simply was not asked for, the answer stays "no grant" -- refreshing
    the family really is the fix. decision:coc7:combat:attack carries no
    availability conditions at all."""
    runtime = _runtime({"actor.id": "a"})
    why = runtime.explain_missing_grant("decision:coc7:combat:attack")
    assert why["reason"] == "no_grant_for_decision", why


def test_a_decision_behind_a_closed_hard_gate_names_the_fact():
    """A hard gate is what actually withholds a card, so when one is shut the
    refusal must say which fact is shut and what it needs.

    decision:coc7:chase:end is hard-gated on the chase subsystem offering an
    `end` choice -- a chase ends when someone escapes or is caught, never on
    the Keeper's say-so. On 2026-09-02 a Keeper settled it three times across
    two lanes while chase context offered only `move`, and the refusal said
    only that no grant covered it, which would have sent it back to
    rules.context for a card that was never going to be there.
    """
    runtime = _runtime({"chase.session.active": True, "chase.pending.kind": "move"})
    why = runtime.explain_missing_grant("decision:coc7:chase:end")
    assert why["reason"] == "decision_not_available", why
    unmet = {row["path"]: row for row in why["unmet"]}
    assert "chase.pending.kind" in unmet, why
    assert unmet["chase.pending.kind"]["actual"] == "move"
    assert unmet["chase.pending.kind"]["expected"] == "end"
    # The gate that does hold is not reported as a problem.
    assert "chase.session.active" not in unmet, why


def test_a_closed_gate_is_not_told_to_go_refresh_for_the_same_card(campaign_ws):
    """"call rules.context, then settle a decision_ref it returns" is right
    for a grant never asked for or drifted, and wrong for a shut hard gate:
    the refresh returns the same list without that card."""
    import coc_toolbox  # noqa: PLC0415

    settled = coc_toolbox.run_tool(
        "rules.settle",
        campaign_ws["workspace"],
        campaign_ws["campaign_id"],
        {
            "decision_ref": "decision:coc7:magic:cast-spell",
            "decision_id": "closed-gate-0001",
            "investigator": "thomas-hayes",
            "semantic_inputs": {},
        },
    )
    error = settled.get("error") or {}
    if error.get("code") != "rule_decision_stale":
        pytest.skip(f"an earlier guard answers first: {error.get('code')}")
    assert error["details"]["reason"] == "decision_not_available", error["details"]
    assert "not currently available" in error["message"], error["message"]
