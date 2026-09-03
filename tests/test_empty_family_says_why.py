"""An empty rule family must say why it is empty.

`rules.context` answered a fully gated family with
``{"status": "no_candidate_in_compiled_scope", "cards": []}`` and nothing
else. The runtime knew more than that on the same call: the loop over
candidates already built the list of decisions that failed applicability, and
`_unmet_availability` already had, per decision, the fact path, its current
value and what the graph asks of it.

Measured in run r69 (pi-coc-gate9-depth-20260901-10, lanes mg-learn-person and
mg-cast): the `magic` family answered 0 cards on every call in two lanes that
had deliberately seeded a spell teacher to open exactly that family. The
Keeper settled blind and was refused `rule_decision_stale` -- whose message
named the shut gate, "magic.spell.known is None, needs to equal True". The
information existed one call after the damage and not in the call whose whole
job is to say what is available.

Every assertion below is made on the envelope after
`coc_mcp_wire.project_envelope`, because that is the object the Keeper
receives; a field the runtime computes and the wire drops is this repo's most
repeated defect. The calls go through `coc_toolbox.run_tool`, never through
the runtime builder directly, so a call site that disappears fails the test.
"""

from __future__ import annotations

import json
from pathlib import Path

from toolbox_test_support import (  # noqa: F401
    SCRIPTS,
    coc_starter,
    coc_toolbox,
    confirm_house_rule,
)

import sys

if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import coc_mcp_wire  # noqa: E402

INVESTIGATOR = "thomas-hayes"


def _campaign(tmp_path: Path, campaign_id: str) -> dict:
    """A campaign id per test.

    RulesRuntime is cached in a module global keyed by (campaign_id,
    investigator) with no workspace in the key, so two tests sharing an id
    hand each other a runtime built over a different tmp_path.
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
    quick = coc_starter.quick_start(
        coc_root, "the-haunting", INVESTIGATOR,
        campaign_id=campaign_id, title="Empty Family Says Why",
    )
    return {
        "workspace": workspace,
        "campaign_id": campaign_id,
        "campaign_dir": Path(quick["campaign_dir"]),
    }


def _project(operation: str, envelope: dict, *, budget: int | None = None) -> dict:
    """The shape the Keeper actually receives."""
    original = coc_mcp_wire.MAX_INLINE_BYTES
    if budget is not None:
        coc_mcp_wire.MAX_INLINE_BYTES = budget
    try:
        return coc_mcp_wire.project_envelope(
            operation, envelope, contract_digest="sha256:test",
        )
    finally:
        coc_mcp_wire.MAX_INLINE_BYTES = original


def _context(ws: dict, family: str, *, budget: int | None = None, **extra) -> dict:
    args = {"family": family, "investigator": INVESTIGATOR}
    args.update(extra)
    envelope = coc_toolbox.run_tool(
        "rules.context", ws["workspace"], ws["campaign_id"], args,
    )
    assert envelope.get("ok") is True, envelope.get("error")
    return _project("rules.context", envelope, budget=budget)


def _withheld_by_ref(projected: dict) -> dict[str, dict]:
    rows = (projected.get("data") or {}).get("withheld") or []
    return {str(row["decision_ref"]): row for row in rows}


UNMET_ROW_KEYS = {"path", "op", "negated", "actual", "expected", "requirement"}


def test_an_empty_family_names_the_decisions_it_withheld(tmp_path):
    """The whole defect, on the family that produced the live evidence."""
    ws = _campaign(tmp_path, "empty-family-magic")
    projected = _context(ws, "magic")
    data = projected["data"]

    # Still a legitimate answer, not an error.
    assert projected["ok"] is True
    assert data["status"] == "no_candidate_in_compiled_scope"
    assert data["cards"] == []
    assert "error" not in projected

    withheld = _withheld_by_ref(projected)
    assert set(withheld) == {
        "decision:coc7:magic:cast-spell",
        "decision:coc7:magic:learn-spell",
    }, data.get("withheld")

    cast = withheld["decision:coc7:magic:cast-spell"]
    assert cast["label"]
    rows = {row["path"]: row for row in cast["unmet"]}
    assert "magic.spell.known" in rows, cast
    row = rows["magic.spell.known"]
    assert set(row) == UNMET_ROW_KEYS, row
    assert row["op"] == "eq"
    assert row["negated"] is False
    assert row["expected"] is True
    assert row["requirement"] == "to equal True"

    learn = withheld["decision:coc7:magic:learn-spell"]
    assert [row["path"] for row in learn["unmet"]] == [
        "magic.learn.source-available",
    ], learn


def test_the_withheld_rows_are_the_same_shape_the_refusal_uses(tmp_path):
    """One vocabulary, not two.

    `rules.settle`'s `rule_decision_stale` already answered this question
    correctly, one call too late. The offer must not invent a second way of
    saying the same thing, or the Keeper has to learn both.
    """
    ws = _campaign(tmp_path, "empty-family-vocabulary")
    offered = _withheld_by_ref(_context(ws, "magic"))

    refused = coc_toolbox.run_tool(
        "rules.settle", ws["workspace"], ws["campaign_id"],
        {
            "decision_ref": "decision:coc7:magic:cast-spell",
            "decision_id": "vocabulary-cast-0001",
            "investigator": INVESTIGATOR,
            "semantic_inputs": {},
        },
    )
    projected_refusal = _project("rules.settle", refused)
    error = projected_refusal.get("error") or {}
    assert error.get("code") == "rule_decision_stale", projected_refusal
    details = error.get("details") or {}
    assert details.get("reason") == "decision_not_available", details

    refusal_rows = {row["path"]: row for row in details.get("unmet") or []}
    offered_rows = {
        row["path"]: row
        for row in offered["decision:coc7:magic:cast-spell"]["unmet"]
    }
    assert set(refusal_rows) == set(offered_rows) == {"magic.spell.known"}
    for path, row in offered_rows.items():
        assert set(row) == set(refusal_rows[path]), (row, refusal_rows[path])
        for field in ("path", "op", "negated", "expected", "requirement"):
            assert row[field] == refusal_rows[path][field], field


def test_the_explanation_is_judged_against_the_facts_that_withheld_the_card(
    tmp_path,
):
    """The withheld rows must describe the evaluation that withheld the card.

    The coc7 adapter's `augment_facts` derives `magic.spell.known` and
    `magic.learn.source-available` from the question's own `semantic_inputs`;
    those facts do not exist in the raw canonical provider at all. Explaining
    a withheld card against the raw provider reports `actual: None` -- "no
    such fact" -- where applicability saw `False`, which is a different claim
    about a different world, and points the Keeper at the campaign state
    instead of at the call they just made.
    """
    ws = _campaign(tmp_path, "empty-family-facts")
    withheld = _withheld_by_ref(_context(ws, "magic"))
    rows = {
        row["path"]: row
        for row in withheld["decision:coc7:magic:cast-spell"]["unmet"]
    }
    assert rows["magic.spell.known"]["actual"] is False, rows


def test_a_family_that_offers_cards_still_says_what_it_held_back(tmp_path):
    """2-of-N and N-of-N are different hands and read identically without it."""
    ws = _campaign(tmp_path, "empty-family-partial")
    projected = _context(ws, "healing")
    data = projected["data"]

    assert data["status"] == "ok"
    assert data["cards"], data
    offered = {card["decision_ref"] for card in data["cards"]}
    withheld = _withheld_by_ref(projected)
    assert withheld, data
    # The two sets partition; nothing is both offered and withheld.
    assert offered.isdisjoint(withheld), (offered, set(withheld))
    assert "decision:coc7:healing:dying-round-clock" in withheld, withheld
    rows = withheld["decision:coc7:healing:dying-round-clock"]["unmet"]
    # The refs alone are cheap and much less useful: the point of the block is
    # naming the facts, on a partial hand as much as on an empty one.
    assert "actor.conditions.dying" in {row["path"] for row in rows}, rows
    for row in rows:
        assert set(row) == UNMET_ROW_KEYS, row
    # A comfortable result carries the rows themselves, not just the refs.
    assert projected["wire"].get("withheld_detail_shed") is not True
    assert projected["wire"]["measured_inline_bytes"] < coc_mcp_wire.MAX_INLINE_BYTES


def test_a_table_ruling_is_not_reported_as_a_shut_state_gate(tmp_path):
    """A card a house rule took off the table will never open this campaign.

    A card waiting on state will. Reporting both as `withheld` would send the
    Keeper looking for a state change that no play can produce, so the
    optional-rule gate keeps its own key and is not repeated -- even though
    `push-luck:luck-spend` is state-gated too, and is in `withheld` until the
    ruling lands.
    """
    ws = _campaign(tmp_path, "empty-family-ruling")
    before = _context(ws, "push-luck")
    assert "decision:coc7:push-luck:luck-spend" in _withheld_by_ref(before)

    confirm_house_rule(
        ws["campaign_dir"],
        patch_id="patch:no-luck-spend",
        relation="disables",
        target="rule:coc7:push-luck:luck-spend",
        reason="classic resource pressure",
    )

    after = _context(ws, "push-luck")
    data = after["data"]
    gates = {
        str(row["decision_ref"])
        for row in data.get("disabled_by_optional_rules") or []
    }
    assert gates == {"decision:coc7:push-luck:luck-spend"}, data
    withheld = _withheld_by_ref(after)
    assert "decision:coc7:push-luck:luck-spend" not in withheld, withheld
    # The rest of the family is unaffected: a ruling on one card is not a
    # reason to stop explaining the others.
    assert "decision:coc7:push-luck:pushed-roll" in withheld, withheld


def test_the_explanation_is_shed_before_the_cards_when_the_budget_is_tight(
    tmp_path,
):
    """The diagnostic must never be what costs a family its hand.

    `rules.context` had no oversize branch of its own, so the only thing
    downstream of a too-large result is `_minimal_identity` -- an identity
    stub with no cards at all. The refs survive the shed because the host
    rewrites canonical ids out of prose, so a ref that is not a structured
    field does not arrive.
    """
    ws = _campaign(tmp_path, "empty-family-budget")
    roomy = _context(ws, "healing")
    tight = _context(ws, "healing", budget=4000)

    assert tight["wire"]["withheld_detail_shed"] is True, tight["wire"]
    assert tight["wire"].get("identity_only") is not True, tight["wire"]
    assert tight["wire"]["measured_inline_bytes"] <= 4000
    assert tight["data"]["cards"], tight["data"]

    shed = _withheld_by_ref(tight)
    assert set(shed) == set(_withheld_by_ref(roomy)), (set(shed), roomy["data"])
    for ref, row in shed.items():
        assert set(row) <= {"decision_ref", "unmet_omitted"}, row
        assert row["unmet_omitted"] >= 1, row
        assert ref.startswith("decision:coc7:healing:"), ref
