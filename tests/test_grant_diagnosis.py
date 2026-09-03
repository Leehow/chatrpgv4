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


def _campaign_ws(tmp_path: Path, campaign_id: str):
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
    coc_starter.quick_start(
        coc_root, "the-haunting", "thomas-hayes",
        campaign_id=campaign_id, title="Grant Diagnosis",
    )
    return {"workspace": workspace, "campaign_id": campaign_id}


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
    return _campaign_ws(tmp_path, "grant-diagnosis-test")


@pytest.fixture
def wire_campaign_ws(tmp_path: Path):
    """A campaign id of its own, for the same reason and one file closer.

    The runtime cache is not reset between tests either, so a refusal that
    refreshes cards leaves a live grant behind for every later test that
    settles the same decision under this campaign id: asserting on combat:flee
    a second time reached the combat executor instead of the grant pre-check
    and was refused `subsystem_transaction_failed`.
    """
    return _campaign_ws(tmp_path, "grant-diagnosis-wire-test")


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


def test_a_bout_that_is_not_underway_names_the_fact_not_the_arguments(campaign_ws):
    """Settling bout-tick before any bout exists must answer with the gate.

    Every payload slot on decision:coc7:sanity:bout-tick is host-locked, so no
    semantic_inputs value can satisfy it. The old wording ("exactly one
    canonical Keeper bout choice is required") read like a slot filled in
    wrong: on 2026-09-02 one lane rewrote semantic_inputs five times in a row
    before abandoning the bout.

    Rewording it was not enough. `_canonical_sanity_binding` runs while the
    host fills host-locked slots, which happened before the card grant was
    checked, so its precondition error shadowed the answer that actually
    decides whether the card can ever appear. Two settlements in r35 were
    still told about bout choices when what they needed was
    `sanity.bout.pending is False, needs True`.
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
    assert error.get("code") == "rule_decision_stale", settled
    details = error["details"]
    assert details["reason"] == "decision_not_available", details
    unmet = {row["path"]: row for row in details["unmet"]}
    assert "sanity.bout.pending" in unmet, details
    assert unmet["sanity.bout.pending"]["expected"] is True, unmet
    assert "not currently available" in error["message"], error["message"]



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


def test_an_existence_gate_says_present_or_absent_not_none_needs_none():
    """An operator-only leaf carries no `value`, so rendering `expected` alone
    destroyed the whole message.

    decision:coc7:healing:weekly-major-wound-recovery is gated on a major
    wound existing, no dying condition, and the weekly clock being due. On
    2026-09-02 five settle attempts across the seeded sweep were refused with
    "actor.conditions.major_wound is None, needs None" -- which reads as
    already satisfied and names nothing the Keeper could do. The gate was
    right; the sentence was useless.
    """
    runtime = _runtime({"actor.recovery.major_wound_week_due": False})
    why = runtime.explain_missing_grant(
        "decision:coc7:healing:weekly-major-wound-recovery",
    )
    assert why["reason"] == "decision_not_available", why
    unmet = {row["path"]: row for row in why["unmet"]}

    wound = unmet["actor.conditions.major_wound"]
    assert wound["op"] == "exists"
    assert wound["requirement"] == "to be present"

    due = unmet["actor.recovery.major_wound_week_due"]
    assert due["requirement"] == "to equal True"

    assert "needs None" not in why["detail"], why["detail"]
    assert "actor.conditions.major_wound is None, needs to be present" in why["detail"]


def test_a_negated_existence_gate_asks_for_absence():
    """`not exists` and `exists` are opposite requirements and must not print
    the same sentence. decision:coc7:healing:first-aid-ordinary is gated on the
    investigator *not* dying and on the injury being under an hour old."""
    runtime = _runtime({
        "actor.conditions.dying": "bleeding-out",
        "time.minutes_since_injury": 900,
    })
    why = runtime.explain_missing_grant(
        "decision:coc7:healing:first-aid-ordinary",
    )
    unmet = {row["path"]: row for row in why["unmet"]}
    assert unmet["actor.conditions.dying"]["requirement"] == "to be absent"
    assert unmet["actor.conditions.dying"]["negated"] is True
    assert unmet["time.minutes_since_injury"]["requirement"] == "to be at most 60"
    assert unmet["time.minutes_since_injury"]["negated"] is False


def _wire_projection(envelope, *, budget: int | None = None):
    """The shape the Keeper actually receives.

    `coc_toolbox.run_tool` is the host's answer, and the Keeper never sees it:
    the MCP server hands every envelope to `coc_mcp_wire.project_envelope`
    first. That projection has dropped a computed field between the runtime
    and the Keeper before, which is the same failure this file exists to
    catch, so the assertions below are made on the projected envelope rather
    than on the one the toolbox returned.

    `budget` forces the bounded branch. A stale refusal carries the whole
    refreshed card set, so a real one is routinely too big to inline and
    `_bounded_error_details` rewrites `error.details` on the way out -- 26 of
    the 198 stale refusals in the 2026-09-01 sweep arrived that way. A fixture
    campaign's card set is small enough to fit, so without this the bounded
    branch is never the one under test.
    """
    import coc_mcp_wire  # noqa: PLC0415

    original = coc_mcp_wire.MAX_INLINE_BYTES
    if budget is not None:
        coc_mcp_wire.MAX_INLINE_BYTES = budget
    try:
        return coc_mcp_wire.project_envelope(
            "rules.settle", envelope, contract_digest="sha256:test",
        )
    finally:
        coc_mcp_wire.MAX_INLINE_BYTES = original


def test_the_reason_survives_the_wire_projection_to_the_keeper(wire_campaign_ws):
    """A reason the Keeper never receives is a reason nobody has.

    The refusal is bounded on the way out: `rule_decision_stale` carries the
    whole refreshed card set, so `_bounded_error_details` rewrites
    `error.details` before it is inlined. Every test above this one stops at
    the toolbox, one projection short of the Keeper.
    """
    import coc_toolbox  # noqa: PLC0415

    settled = coc_toolbox.run_tool(
        "rules.settle",
        wire_campaign_ws["workspace"],
        wire_campaign_ws["campaign_id"],
        {
            "decision_ref": REF,
            "decision_id": "wire-never-granted-0001",
            "investigator": "thomas-hayes",
            "semantic_inputs": {},
        },
    )
    projected = _wire_projection(settled)
    error = projected.get("error") or {}
    assert error.get("code") == "rule_decision_stale", projected
    details = error.get("details") or {}
    assert details.get("reason") == "no_grant_for_decision", details
    assert details.get("refresh_operation") == "rules.context", details


def test_the_unmet_rows_survive_the_wire_projection_too(wire_campaign_ws):
    """`decision_not_available` is only actionable through its `unmet` rows.

    They name the fact that is shut, its current value and what it must be.
    The bounding step summarizes bulky collections away by key, so a list
    added later is one rule-name away from being summarized out of existence.
    """
    import coc_toolbox  # noqa: PLC0415

    settled = coc_toolbox.run_tool(
        "rules.settle",
        wire_campaign_ws["workspace"],
        wire_campaign_ws["campaign_id"],
        {
            "decision_ref": "decision:coc7:sanity:bout-tick",
            "decision_id": "wire-no-bout-0001",
            "investigator": "thomas-hayes",
            "semantic_inputs": {},
        },
    )
    for budget in (None, 4096):
        projected = _wire_projection(settled, budget=budget)
        details = (projected.get("error") or {}).get("details") or {}
        assert details.get("reason") == "decision_not_available", details
        unmet = {row["path"]: row for row in details.get("unmet") or []}
        assert "sanity.bout.pending" in unmet, (budget, details)
        row = unmet["sanity.bout.pending"]
        assert row["op"] == "eq"
        assert row["negated"] is False
        assert row["actual"] is False
        assert row["expected"] is True
        assert row["requirement"] == "to equal True"
    # The bounded pass really was the bounded pass.
    assert _wire_projection(settled, budget=4096)["wire"]["error_details_bounded"]


def test_a_grant_that_dies_after_the_precheck_answers_the_same_way(
    wire_campaign_ws, monkeypatch,
):
    """The other half of the same refusal must be told the same way.

    `rules.settle` checks `latest_grant_covering()` once, then binds canonical
    inputs, then hands that grant to `settle()`, whose own fail-closed gate
    re-reads the binding. Canonical state moving inside that window is exactly
    what the gate exists for -- and it raised with the runtime's raw envelope
    as `details`, so the Keeper received a `rule_decision_stale` with no
    `reason` key at all, no `refresh_operation` for the host-remedy circuit to
    recognise, the unprojected internal cards, and the host-internal
    `refreshed_card_grant` carried across the boundary with them.

    Nothing inside one process can wedge itself into that window, so the grant
    the pre-check hands back is staged already drifted. Everything after it --
    the binding step, `settle()`, its gate, the raise, the wire projection --
    is the real path.
    """
    import copy  # noqa: PLC0415

    import coc_toolbox  # noqa: PLC0415

    ws, cid = wire_campaign_ws["workspace"], wire_campaign_ws["campaign_id"]
    context = coc_toolbox.run_tool(
        "rules.context", ws, cid,
        {"family": "core-check", "investigator": "thomas-hayes"},
    )
    cards = (context.get("data") or {}).get("cards") or []
    assert cards, context
    decision_ref = cards[0]["decision_ref"]

    def raced(self, ref):
        grant = {
            "contract_id": runtime_module.CARD_GRANT_CONTRACT_ID,
            "schema_version": runtime_module.CARD_GRANT_SCHEMA_VERSION,
            "grant_id": "card-grant:coc7:core-check:raced",
            # Issued by this runtime and recorded in its registry, bound to a
            # canonical revision that no longer holds: what a live grant looks
            # like the instant after state moves underneath it.
            "binding": {
                **self._grant_binding(()),
                "state_revision": "sha256:moved",
            },
            "decision_refs": [ref],
            "state_scope": [],
        }
        self._grants[grant["grant_id"]] = copy.deepcopy(grant)
        return copy.deepcopy(grant)

    monkeypatch.setattr(
        runtime_module.RulesRuntime, "latest_grant_covering", raced,
    )
    settled = coc_toolbox.run_tool(
        "rules.settle", ws, cid,
        {
            "decision_ref": decision_ref,
            "decision_id": "raced-grant-0001",
            "investigator": "thomas-hayes",
            "semantic_inputs": {},
        },
    )

    projected = _wire_projection(settled)
    error = projected.get("error") or {}
    assert error.get("code") == "rule_decision_stale", projected
    details = error.get("details") or {}
    assert details.get("reason") == "grant_binding_drifted", details
    assert details.get("drifted") == ["state_revision"], details
    # The runtime's own verdict is reported beside the Keeper-facing reason,
    # never instead of it: they answer different questions.
    assert details.get("grant_check") == "grant_binding_mismatch", details
    # `nonretry-circuit` reads this key to learn the remedy is a host refresh;
    # without it the Keeper's rules.context -> re-settle is answered
    # `nonretryable_repeat_blocked`.
    assert details.get("refresh_operation") == "rules.context", details
    # Card grants stay host-internal. The raw envelope carried one out.
    assert "refreshed_card_grant" not in details, details
    assert "failure" not in details, details
    for card in details.get("refreshed_cards") or []:
        assert card.get("authority", {}).get("hard_gate") is False, card
        assert "active_exceptions" not in card, card
