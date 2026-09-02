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


def test_a_card_that_answers_the_declared_intent_says_so(campaign_ws):
    """The trigger only earns its place if the Keeper can see the answer. A
    decision that declares no intent trigger stays silent, so an undeclared
    turn and an unrelated decision look exactly as they did before."""
    with_intent = _context(
        campaign_ws, family="combat", player_intent="flee",
    )
    assert with_intent["ok"] is True, with_intent.get("error")
    marked = {
        card["decision_ref"]: card["answers_declared_intent"]
        for card in with_intent["data"]["cards"]
        if "answers_declared_intent" in card
    }
    assert marked.get("decision:coc7:combat:flee") is True
    assert "decision:coc7:combat:attack" not in marked

    unrelated = _context(campaign_ws, family="combat", player_intent="social")
    assert unrelated["data"]["cards"], unrelated
    assert all(
        card.get("answers_declared_intent") is not True
        for card in unrelated["data"]["cards"]
    )

    silent = _context(campaign_ws, family="combat")
    assert all(
        "answers_declared_intent" not in card
        for card in silent["data"]["cards"]
    )


def test_the_trigger_never_gates_the_card(campaign_ws):
    """Cards are affordances. Declaring an intent must not remove a card that
    was offered without one, or the Keeper loses moves by answering a
    question it was asked."""
    without = _context(campaign_ws, family="combat")
    with_other = _context(campaign_ws, family="combat", player_intent="social")
    refs = lambda env: sorted(c["decision_ref"] for c in env["data"]["cards"])
    assert refs(with_other) == refs(without)


def test_every_intent_trigger_reads_the_registered_fact(campaign_ws):
    """A trigger keyed on an unregistered path would silently never fire."""
    import json as _json  # noqa: PLC0415

    graph = _json.loads(
        (
            ROOT / "plugins/coc-keeper/rulesets/coc7/rule-graph.json"
        ).read_text(encoding="utf-8")
    )
    contract = _json.loads(
        (
            ROOT / "plugins/coc-keeper/references/rule-graph-contract-v1.json"
        ).read_text(encoding="utf-8")
    )
    registered = set(contract["registered_condition_paths"])
    assert "intent.action_kind" in registered
    triggers = [
        node for node in graph["nodes"]
        if node["node_kind"] == "condition"
        and "intent.action_kind" in _json.dumps(node.get("properties") or {})
    ]
    assert triggers, "no decision declares an intent trigger"
    for node in triggers:
        assert node["hard_gate"] is False, node["node_id"]
        expression = _json.dumps(node["properties"]["expression"])
        for intent in coc_intent_router.PRIMARY_INTENT_ENUM:
            if f'"value": "{intent}"' in expression:
                break
        else:
            raise AssertionError(
                f"{node['node_id']} tests a value outside the intent vocabulary"
            )


def test_the_mark_survives_the_transport_projection(campaign_ws):
    """A card field the Keeper never sees is not a feature. The card
    projection compares the field set exactly and drops an unexpected shape
    whole, so an optional field must be declared optional: declaring it
    required would silently delete every card in a turn with no declared
    intent, which is every turn until the Keeper starts declaring one."""
    import coc_mcp_wire as wire  # noqa: PLC0415

    def projected(**extra):
        envelope = _context(campaign_ws, family="combat", **extra)
        assert envelope["ok"] is True, envelope.get("error")
        view = wire.project_envelope(
            "rules.context", envelope, contract_digest="sha256:test",
        )
        cards = (view.get("data") or {}).get("cards") or []
        assert cards, view
        return {card["decision_ref"]: card for card in cards}

    silent = projected()
    assert len(silent) == 8
    assert all("answers_declared_intent" not in c for c in silent.values())

    fleeing = projected(player_intent="flee")
    assert set(fleeing) == set(silent), "declaring an intent dropped a card"
    assert fleeing["decision:coc7:combat:flee"]["answers_declared_intent"] is True
    assert "answers_declared_intent" not in fleeing["decision:coc7:combat:attack"]


def test_the_scene_card_block_treats_the_mark_as_optional(campaign_ws):
    """scene.context embeds the same RuleDecisionCards, and that block's
    projector compares the field set exactly and drops an unexpected card
    whole. So the mark has to be declared OPTIONAL there: declared required it
    would delete every card in a turn with no declared intent, and undeclared
    it would delete every card that carries one."""
    import coc_mcp_wire as wire  # noqa: PLC0415

    envelope = coc_toolbox.run_tool(
        "scene.context",
        campaign_ws["workspace"],
        campaign_ws["campaign_id"],
        {"investigator": "thomas-hayes"},
    )
    block = envelope["data"]["rule_decision_cards"]
    assert block["cards"], envelope

    plain = wire._compact_rule_decision_card_block(json.loads(json.dumps(block)))
    assert plain and len(plain["cards"]) == len(block["cards"])

    marked = json.loads(json.dumps(block))
    for card in marked["cards"]:
        card["answers_declared_intent"] = True
    kept = wire._compact_rule_decision_card_block(marked)
    assert kept, "a card carrying the mark must survive the block projection"
    assert len(kept["cards"]) == len(block["cards"])
    assert all(card["answers_declared_intent"] is True for card in kept["cards"])

    undeclared = json.loads(json.dumps(block))
    for card in undeclared["cards"]:
        card["surprise_field"] = "x"
    dropped = wire._compact_rule_decision_card_block(undeclared)
    assert not (dropped or {}).get("cards"), (
        "the optional set buys one declared field, not a hole"
    )



def test_the_play_prompt_teaches_the_intent_vocabulary():
    """The Keeper reads the tool schema and does fill the argument in — three
    of six live lanes did, unprompted. It filled it in WRONGLY: "I turn and
    run for the stairs" came back as `investigate`. A closed vocabulary the
    model has to map an action onto needs the mapping stated, and the two
    observed misclassifications are named so they cannot come back silently.
    """
    prompt = (
        ROOT / "plugins/coc-keeper/pi/prompts/host-system-play.md"
    ).read_text(encoding="utf-8")
    assert "player_intent" in prompt
    # every class the Keeper may declare is explained, not just listed
    for intent in coc_intent_router.PRIMARY_INTENT_ENUM:
        if intent in {"montage"}:
            continue  # director-internal; never Keeper-declared
        assert f"`{intent}`" in prompt, intent
    assert "answers_declared_intent" in prompt


# ---------------------------------------------------------------------------
# The settle form: what to put in the call, per decision.
# ---------------------------------------------------------------------------

def test_each_card_states_the_arguments_that_settle_it(campaign_ws):
    """rules.settle takes one flat semantic_inputs schema whose property map is
    the union of every slot of every decision — legal for the tool, wrong for
    the decision. Observed live: settling decision:coc7:combat:flee, which
    takes no model-owned slot at all, the Keeper passed `source_ref` — another
    family's key, in the union, so the schema accepted it and the graph
    rejected it.

    flee listed an optional `candidate_ref` until 2026-09-02. Nothing consumed
    it: `_canonical_combat_binding` binds it for attack and maneuver only, and
    combat.resolve refuses an affordance or target outright for any other
    action. The card advertised it, the Keeper sent it, and two host-authored
    statements told it the opposite thing (r36)."""
    envelope = _context(campaign_ws, family="combat")
    forms = {
        card["decision_ref"]: card["settle_form"]
        for card in envelope["data"]["cards"]
    }
    flee = forms["decision:coc7:combat:flee"]
    assert flee["prefilled_arguments"] == {
        "decision_ref": "decision:coc7:combat:flee",
    }
    # nothing to invent: the id is the only thing the Keeper must supply
    assert flee["missing_arguments"] == ["decision_id"]
    assert flee.get("optional_arguments", []) == []
    assert "source_ref" not in json.dumps(flee)

    attack = forms["decision:coc7:combat:attack"]
    assert attack["missing_arguments"] == ["decision_id", "candidate_ref"]


def test_the_form_names_only_slots_the_decision_declares(campaign_ws):
    """A form that named a slot the graph does not declare would send the
    Keeper straight into unknown_semantic_input, which is the failure the form
    exists to prevent."""
    import coc_rules_runtime  # noqa: PLC0415

    graph = json.loads(
        (
            ROOT / "plugins/coc-keeper/rulesets/coc7/rule-graph.json"
        ).read_text(encoding="utf-8")
    )
    runtime = coc_rules_runtime.RulesRuntime(graph)
    decisions = [
        node["node_id"] for node in graph["nodes"]
        if node["node_kind"] == "decision"
    ]
    assert len(decisions) == 43
    for decision in decisions:
        slots = runtime._slots_for(decision)
        declared = {slot["name"] for slot in slots}
        form = runtime._settle_form(decision, slots)
        assert form["prefilled_arguments"]["decision_ref"] == decision
        named = set(form["missing_arguments"][1:]) | set(
            form.get("optional_arguments") or []
        )
        assert named <= declared, (decision, named - declared)
        # and every required model-owned slot is asked for
        required = {
            slot["name"] for slot in slots
            if slot["ownership"] in coc_rules_runtime._REQUIRED_SEMANTIC_OWNERSHIPS
        }
        assert required <= set(form["missing_arguments"]), decision


def test_the_form_survives_transport_within_the_budget(campaign_ws):
    import coc_mcp_wire as wire  # noqa: PLC0415

    envelope = _context(campaign_ws, family="combat")
    view = wire.project_envelope(
        "rules.context", envelope, contract_digest="sha256:test",
    )
    size = len(json.dumps(view, ensure_ascii=False).encode("utf-8"))
    assert size <= wire.MAX_INLINE_BYTES, size
    cards = view["data"]["cards"]
    assert cards and all("settle_form" in card for card in cards)
    flee = next(
        card for card in cards
        if card["decision_ref"] == "decision:coc7:combat:flee"
    )
    assert flee["settle_form"]["missing_arguments"] == ["decision_id"]


def test_the_declared_intent_does_not_invalidate_a_card_grant(campaign_ws):
    """A card grant binds "canonical state has not moved since these cards
    were issued". With no separate state-revision provider that binding
    degrades to a digest of the whole fact set, so a fact carried only by the
    asking call invalidates every grant issued under it.

    rules.context publishes the declared intent; rules.settle does not. Before
    the exclusion the two digests differed, latest_grant_covering matched
    nothing, and the Keeper was told `rule_decision_stale` immediately after a
    successful refresh. Measured 2026-09-02: eight of fifteen failed
    settlements across three lanes, and the chase that had settled once
    stopped settling at all."""
    import coc_rules_runtime  # noqa: PLC0415

    kernel = coc_toolbox.coc_operation_kernel
    ctx = kernel.Ctx(
        Path(campaign_ws["workspace"]), campaign_ws["campaign_id"],
    )
    graph = json.loads(
        (
            ROOT / "plugins/coc-keeper/rulesets/coc7/rule-graph.json"
        ).read_text(encoding="utf-8")
    )

    def binding(intent):
        runtime = coc_rules_runtime.RulesRuntime(
            graph,
            ruleset_id="coc7",
            campaign_id=campaign_ws["campaign_id"],
            facts_provider=kernel._facts_provider_for(
                ctx, "thomas-hayes", "coc7", player_intent=intent,
            ),
        )
        return runtime._grant_binding()

    assert binding(None) == binding("flee"), (
        "declaring an intent must not move the grant binding"
    )
    assert binding("flee") == binding("investigate"), (
        "and neither must declaring a different one"
    )

    # The fact still reaches the graph; it is excluded from the binding only.
    captured: dict[str, object] = {}
    original = kernel._facts_provider_for

    def spy(ctx_, investigator_id, ruleset_id, *, player_intent=None):
        provider = original(
            ctx_, investigator_id, ruleset_id, player_intent=player_intent,
        )

        def wrapped():
            facts = provider()
            captured.update(facts)
            return facts

        return wrapped

    kernel._facts_provider_for = spy
    try:
        _context(campaign_ws, player_intent="flee")
    finally:
        kernel._facts_provider_for = original
    assert captured.get("intent.action_kind") == "flee"
