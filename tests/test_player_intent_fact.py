"""The Keeper's declared player intent must reach the rule graph as a fact.

The RuleGraph can say "this card is available when the campaign state looks
like X". It could not say "the player is trying to do X", because no fact
carried the action: on 2026-09-02 the graph's 26 condition nodes read
sanity/actor/chase/receipt/development/time/magic/campaign facts and `intent`
appeared exactly once (intent.pushed). Measured consequence, from six seeded
diagnostic lanes: five finalized a whole turn with no rules call at all —
fleeing, grappling, sneaking and searching all resolved as pure fiction — and
the one lane that did settle was pulled in by an authored scene trigger, not
by the player's action.

`rules.context` now accepts the declared intent from the canonical vocabulary
and the host publishes it as `intent.action_kind`.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import coc_intent_router  # noqa: E402
import coc_starter  # noqa: E402
import coc_toolbox  # noqa: E402

# The toolbox dispatches through its own freshly loaded kernel module, so a
# spy has to be installed on that object, not on a separate import of the
# same file.
kernel = coc_toolbox.coc_operation_kernel


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


@pytest.fixture
def campaign_ws(tmp_path: Path):
    workspace = tmp_path / "workspace"
    coc_root = workspace / ".coc"
    campaign_id = "intent-fact-test"
    _write_json(
        coc_root / "runtime.json",
        {
            "schema_version": 2,
            "planner": {"kind": "deterministic"},
            "rules": {"kind": "deterministic"},
            "narrator": {"kind": "template"},
            "player": {"kind": "human"},
        },
    )
    coc_starter.quick_start(
        coc_root,
        "the-haunting",
        "thomas-hayes",
        campaign_id=campaign_id,
        title="Intent Fact Test",
    )
    return {"workspace": workspace, "campaign_id": campaign_id}


def _context(ws, **extra):
    args = {"family": "core-check", "investigator": "thomas-hayes"}
    args.update(extra)
    return coc_toolbox.run_tool(
        "rules.context", ws["workspace"], ws["campaign_id"], args,
    )


def test_the_declared_intent_is_published_as_a_graph_fact(campaign_ws):
    captured: dict[str, object] = {}
    original = kernel._facts_provider_for

    def spy(ctx, investigator_id, ruleset_id, *, player_intent=None):
        provider = original(
            ctx, investigator_id, ruleset_id, player_intent=player_intent,
        )

        def wrapped():
            facts = provider()
            captured.update(facts)
            return facts

        return wrapped

    kernel._facts_provider_for = spy
    try:
        envelope = _context(campaign_ws, player_intent="flee")
    finally:
        kernel._facts_provider_for = original

    assert envelope["ok"] is True, envelope.get("error")
    assert captured.get("intent.action_kind") == "flee"


def test_an_undeclared_intent_is_absent_rather_than_guessed(campaign_ws):
    """coc_intent_router refuses to guess an intent from missing evidence and
    degrades to `ambiguous` on the record. The host must not quietly default
    one either, or every card would evaluate against an invented action."""
    captured: dict[str, object] = {}
    original = kernel._facts_provider_for

    def spy(ctx, investigator_id, ruleset_id, *, player_intent=None):
        provider = original(
            ctx, investigator_id, ruleset_id, player_intent=player_intent,
        )

        def wrapped():
            facts = provider()
            captured.update(facts)
            return facts

        return wrapped

    kernel._facts_provider_for = spy
    try:
        envelope = _context(campaign_ws)
    finally:
        kernel._facts_provider_for = original

    assert envelope["ok"] is True, envelope.get("error")
    assert "intent.action_kind" not in captured


def test_an_intent_outside_the_vocabulary_fails_closed(campaign_ws):
    envelope = _context(campaign_ws, player_intent="grapple-the-ghost")
    assert envelope["ok"] is False
    assert envelope["error"]["code"] == "invalid_param"
    assert envelope["error"]["details"]["player_intent"] == "grapple-the-ghost"
    assert "flee" in envelope["error"]["details"]["allowed"]


def test_every_declared_class_is_accepted(campaign_ws):
    """The Keeper-facing enum and the router's vocabulary are one tuple, so a
    class the router can return can always be declared."""
    for intent in coc_intent_router.PRIMARY_INTENT_ENUM:
        envelope = _context(campaign_ws, player_intent=intent)
        assert envelope["ok"] is True, (intent, envelope.get("error"))


def test_the_keeper_contract_publishes_the_same_vocabulary():
    spec = dict(coc_toolbox.TOOLS["rules.context"])
    enum = spec["params"]["player_intent"]["enum"]
    assert enum == list(coc_intent_router.PRIMARY_INTENT_ENUM)
