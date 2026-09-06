"""The shipped RuleGraph data: intent conditions, content digest, ontology grounding.

Contract §11.7 asks for three things at once, and each one is only worth
anything if the other two hold:

- every decision the Keeper can reach by declaring an action carries an
  `available-when` condition on `intent.action_kind`, so §11.3's fallback
  routing table can be deleted rather than kept in sync by hand;
- the build manifest's `graph_content_digest` still describes the artifact on
  disk, computed exactly the way the old compiler computed it — the kernel
  refuses the package when it does not;
- the system ontology says which Director intent each of those decisions
  grounds, and says it about the same decisions.

The third is checked against the graph, not against a second copy of the
mapping, so a decision added to Task A's table without a Director edge fails
here instead of drifting.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

import pytest

WORKTREE = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(WORKTREE / "kernel"))

from coc.rules.graph_digest import (  # noqa: E402
    compute_graph_content_digest,
    graph_digest_matches,
)

GRAPH_PATH = WORKTREE / "content/rulesets/coc7/rule-graph.json"
MANIFEST_PATH = WORKTREE / "content/rulesets/coc7/rule-graph-manifest.json"
ONTOLOGY_PATH = WORKTREE / "content/ontology/system-ontology.json"
BEFORE_PATH = Path(__file__).parent / "fixtures/rule-graph.before.json"

#: The digest `rule-graph-manifest.json` declared before the intent conditions
#: were added, recomputed by the old compiler's `_json_digest` over the graph
#: kept in `fixtures/rule-graph.before.json`.  It pins the algorithm, not the
#: content: if `compute_graph_content_digest` ever stops reproducing it, every
#: manifest ever shipped has been invalidated.
PRE_CHANGE_DIGEST = "4b565dde9abb527ad1ff77a8b664a6b7fb0662e9695246a8470bf36cf1e6f4aa"

INTENT_PATH = "intent.action_kind"

#: Copied from the closed list in the old repo's
#: `plugins/coc-keeper/references/rule-graph-contract-v1.json`
#: (`registered_condition_paths`).  A condition may only read these.
REGISTERED_CONDITION_PATHS = frozenset({
    "campaign.ruleset_id", "campaign.ruleset_version",
    "actor.id", "actor.resources.hp", "actor.resources.hp_max", "actor.resources.san",
    "actor.resources.mp", "actor.resources.luck", "actor.sheet.con",
    "actor.conditions", "actor.conditions.dying", "actor.conditions.unconscious",
    "actor.conditions.major_wound", "actor.conditions.dead",
    "actor.recovery.major_wound_week_due",
    "development.settlement.pending",
    "subsystem.kind", "subsystem.snapshot.active", "scene.id",
    "intent.method", "intent.action_kind", "intent.pushed", "intent.complete_rest",
    "intent.poor_environment", "intent.rescuer_count",
    "receipt.last_outcome", "receipt.push_eligible",
    "time.day", "time.minutes_since_injury", "clock.dying",
    "chase.session.active", "chase.session.inactive", "chase.start.ready",
    "chase.pending.kind", "chase.conflict.receipt-ready",
    "magic.spell.known", "magic.learn.source-available",
    "sanity.bout.pending", "sanity.delusion.active", "sanity.treatment.due",
    "sanity.recovery.due", "sanity.insane", "sanity.gain.pending",
})

CONDITION_OPERATORS = frozenset({
    "eq", "neq", "lt", "lte", "gt", "gte", "contains", "not-contains", "exists",
})
CONDITION_COMBINATORS = frozenset({"all", "any", "not"})

#: Contract §11.7 / issue #14: the declared action kinds each decision answers.
#: This is the specification, deliberately written out rather than derived, so
#: the graph is checked against it and not against itself.
DECISION_INTENTS: dict[str, frozenset[str]] = {
    "decision:coc7:combat:attack": frozenset({"combat"}),
    "decision:coc7:combat:aim": frozenset({"combat"}),
    "decision:coc7:combat:maneuver": frozenset({"combat"}),
    "decision:coc7:combat:reload": frozenset({"combat"}),
    "decision:coc7:combat:defend": frozenset({"combat"}),
    "decision:coc7:combat:context": frozenset({"combat"}),
    "decision:coc7:combat:flee": frozenset({"flee"}),
    "decision:coc7:combat:end": frozenset({"combat", "flee"}),
    "decision:coc7:chase:start": frozenset({"flee"}),
    "decision:coc7:chase:move": frozenset({"flee", "move", "combat"}),
    "decision:coc7:chase:barrier": frozenset({"flee", "move", "combat"}),
    "decision:coc7:chase:hazard": frozenset({"flee", "move", "combat"}),
    "decision:coc7:chase:conflict": frozenset({"flee", "move", "combat"}),
    "decision:coc7:chase:end": frozenset({"flee", "move", "combat"}),
    "decision:coc7:core-check:ordinary-check": frozenset({"investigate", "move", "social"}),
    "decision:coc7:core-check:combined-check": frozenset({"investigate", "move"}),
    "decision:coc7:core-check:opposed-check": frozenset({"investigate", "social", "move"}),
    "decision:coc7:social:adjudicate-difficulty": frozenset({"social"}),
    "decision:coc7:psychology:observe-concealed": frozenset({"social", "investigate"}),
    "decision:coc7:psychology:realize-player-safe": frozenset({"social", "investigate"}),
    "decision:coc7:magic:cast-spell": frozenset({"cast"}),
    "decision:coc7:magic:learn-spell": frozenset({"investigate", "cast"}),
    "decision:coc7:healing:first-aid-ordinary": frozenset({"investigate"}),
    "decision:coc7:healing:first-aid-stabilization": frozenset({"investigate"}),
    "decision:coc7:healing:medicine-ordinary": frozenset({"investigate"}),
    "decision:coc7:healing:medicine-stabilization": frozenset({"investigate"}),
    "decision:coc7:healing:dying-hour-clock": frozenset({"investigate"}),
    "decision:coc7:healing:dying-round-clock": frozenset({"investigate"}),
    "decision:coc7:healing:weekly-major-wound-recovery": frozenset({"investigate"}),
    "decision:coc7:sanity:check": frozenset({"investigate", "combat", "flee", "move", "social"}),
}

#: Session continuations and state-driven bookkeeping.  The Keeper never
#: declares these as an action, so an intent trigger on them would mark them as
#: answering a turn they only follow.  `sanity:context` is a state query and is
#: named by neither the mapping nor the fallback routing table.
DECISIONS_WITHOUT_INTENT = frozenset({
    "decision:coc7:sanity:bout-tick",
    "decision:coc7:sanity:bout-end",
    "decision:coc7:sanity:reality-check",
    "decision:coc7:sanity:recover-temporary",
    "decision:coc7:sanity:apply-treatment",
    "decision:coc7:sanity:gain-current-san",
    "decision:coc7:sanity:insane-insight",
    "decision:coc7:sanity:context",
    "decision:coc7:push-luck:pushed-roll",
    "decision:coc7:push-luck:luck-spend",
    "decision:coc7:push-luck:luck-roll",
    "decision:coc7:development:end-session",
    "decision:coc7:development:settle-ending",
})

#: Director scoring rule -> the intent kinds it scores (its own condition_id
#: names them).  `scoring-rule:montage:montage-intent` names `montage`, which
#: no decision answers, so it grounds nothing and is absent here.
DIRECTOR_INTENT_REFS: dict[str, frozenset[str]] = {
    "ref:director:investigate-intent": frozenset({"investigate"}),
    "ref:director:social-intent": frozenset({"social"}),
    "ref:director:explicit-move-intent": frozenset({"move"}),
    "ref:director:combat-flee-cast-intent": frozenset({"combat", "flee", "cast"}),
}


def _load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def graph() -> dict[str, Any]:
    return _load(GRAPH_PATH)


@pytest.fixture(scope="module")
def manifest() -> dict[str, Any]:
    return _load(MANIFEST_PATH)


@pytest.fixture(scope="module")
def ontology() -> dict[str, Any]:
    return _load(ONTOLOGY_PATH)


@pytest.fixture(scope="module")
def nodes(graph: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {node["node_id"]: node for node in graph["nodes"]}


def _condition_paths(expression: Any) -> set[str]:
    paths: set[str] = set()
    if isinstance(expression, dict):
        if isinstance(expression.get("path"), str):
            paths.add(expression["path"])
        for value in expression.values():
            paths |= _condition_paths(value)
    elif isinstance(expression, list):
        for value in expression:
            paths |= _condition_paths(value)
    return paths


def _declared_intents(
    graph: dict[str, Any], nodes: dict[str, dict[str, Any]]
) -> dict[str, set[str]]:
    """The action kinds each decision answers, read the way the runtime reads
    them: `available-when` edges to conditions that are not hard gates and that
    test `intent.action_kind`."""
    declared: dict[str, set[str]] = {}
    for relation in graph["relations"]:
        if relation["relation_kind"] != "available-when":
            continue
        condition = nodes.get(relation["to_node_id"]) or {}
        if condition.get("hard_gate") is True:
            continue
        expression = (condition.get("properties") or {}).get("expression") or {}
        clauses = expression.get("of") if expression.get("op") in {"all", "any"} else None
        for clause in clauses if isinstance(clauses, list) else []:
            if isinstance(clause, dict) and clause.get("path") == INTENT_PATH:
                declared.setdefault(relation["from_node_id"], set()).add(clause["value"])
    return declared


# --------------------------------------------------------------------------- #
# Task B: the content digest
# --------------------------------------------------------------------------- #
def test_digest_reproduces_the_pre_change_manifest_value() -> None:
    assert compute_graph_content_digest(_load(BEFORE_PATH)) == PRE_CHANGE_DIGEST


def test_manifest_declares_the_edited_graph_digest(
    graph: dict[str, Any], manifest: dict[str, Any]
) -> None:
    assert manifest["graph_content_digest"] == compute_graph_content_digest(graph)
    assert graph_digest_matches(graph, manifest)
    assert manifest["graph_content_digest"] != PRE_CHANGE_DIGEST


def test_graph_lists_keep_the_compiler_order(graph: dict[str, Any]) -> None:
    """The digest hashes lists in order, so an out-of-order edit hashes to
    something `coc_rule_graph.build` would never have produced."""
    node_ids = [node["node_id"] for node in graph["nodes"]]
    relation_ids = [relation["relation_id"] for relation in graph["relations"]]
    assert node_ids == sorted(node_ids)
    assert relation_ids == sorted(relation_ids)
    assert len(set(node_ids)) == len(node_ids)
    assert len(set(relation_ids)) == len(relation_ids)


def test_graph_artifact_matches_the_contract_key_surface(graph: dict[str, Any]) -> None:
    assert graph["contract_id"] == "coc.rule-graph.v1"
    assert graph["schema_version"] == 1
    assert graph["ruleset_id"] == "coc7"


# --------------------------------------------------------------------------- #
# Task A: intent conditions
# --------------------------------------------------------------------------- #
def test_the_mapping_covers_every_decision_exactly_once(graph: dict[str, Any]) -> None:
    decisions = {
        node["node_id"] for node in graph["nodes"] if node["node_kind"] == "decision"
    }
    assert decisions == set(DECISION_INTENTS) | DECISIONS_WITHOUT_INTENT
    assert not set(DECISION_INTENTS) & DECISIONS_WITHOUT_INTENT


@pytest.mark.parametrize("decision_id", sorted(DECISION_INTENTS))
def test_decision_declares_its_intents(
    decision_id: str, graph: dict[str, Any], nodes: dict[str, dict[str, Any]]
) -> None:
    declared = _declared_intents(graph, nodes)
    assert declared.get(decision_id, set()) == set(DECISION_INTENTS[decision_id])


@pytest.mark.parametrize("decision_id", sorted(DECISIONS_WITHOUT_INTENT))
def test_continuation_decision_declares_no_intent(
    decision_id: str, graph: dict[str, Any], nodes: dict[str, dict[str, Any]]
) -> None:
    assert decision_id not in _declared_intents(graph, nodes)


def test_intent_conditions_are_never_hard_gates(graph: dict[str, Any]) -> None:
    """`RulesRuntime.applicability` only evaluates hard gates and
    `_intent_conditions_for` only collects the rest.  A hard-gated intent
    condition would both make the decision unavailable and stop marking it as
    answering the turn."""
    intent_conditions = [
        node for node in graph["nodes"]
        if node["node_kind"] == "condition"
        and INTENT_PATH in _condition_paths((node.get("properties") or {}).get("expression"))
    ]
    assert len(intent_conditions) == 19
    for node in intent_conditions:
        assert node["hard_gate"] is False, node["node_id"]
        assert node["authority"] == "deterministic", node["node_id"]
        assert node["audience"] == "host-internal", node["node_id"]
        assert node["visibility"] == "keeper-only", node["node_id"]
        assert node["name"] and not node["name"].endswith("."), node["node_id"]
        assert node["evidence_span_ids"], node["node_id"]
        family = node["node_id"].split(":")[2]
        assert (node["properties"] or {})["family_id"] == family, node["node_id"]


def test_intent_condition_ids_stay_semantic(graph: dict[str, Any]) -> None:
    for node in graph["nodes"]:
        expression = (node.get("properties") or {}).get("expression")
        if node["node_kind"] != "condition" or INTENT_PATH not in _condition_paths(expression):
            continue
        family = node["node_id"].split(":")[2]
        kinds = sorted(
            clause["value"] for clause in expression["of"]
            if clause.get("path") == INTENT_PATH
        )
        expected = f"condition:coc7:{family}:intent-" + "-".join(kinds)
        if len(kinds) > 1:
            expected = f"condition:coc7:{family}:intent-any-of-" + "-".join(kinds)
        assert node["node_id"] == expected


# --------------------------------------------------------------------------- #
# Graph integrity the added rows must not break
# --------------------------------------------------------------------------- #
def test_every_relation_points_at_existing_nodes(
    graph: dict[str, Any], nodes: dict[str, dict[str, Any]]
) -> None:
    dangling = [
        (relation["relation_id"], end)
        for relation in graph["relations"]
        for end in (relation["from_node_id"], relation["to_node_id"])
        if end not in nodes
    ]
    assert dangling == []


def test_condition_expressions_only_read_registered_paths(graph: dict[str, Any]) -> None:
    unregistered = {
        node["node_id"]: sorted(
            _condition_paths((node.get("properties") or {}).get("expression"))
            - REGISTERED_CONDITION_PATHS
        )
        for node in graph["nodes"]
        if node["node_kind"] == "condition"
    }
    assert {k: v for k, v in unregistered.items() if v} == {}


def test_condition_expressions_use_the_closed_operator_language(
    graph: dict[str, Any]
) -> None:
    def walk(expression: Any, node_id: str) -> None:
        assert isinstance(expression, dict), node_id
        op = expression.get("op")
        assert op in CONDITION_OPERATORS | CONDITION_COMBINATORS, (node_id, op)
        if op in {"all", "any"}:
            assert isinstance(expression["of"], list) and expression["of"], node_id
            for child in expression["of"]:
                walk(child, node_id)
        elif op == "not":
            child = expression["of"]
            for one in child if isinstance(child, list) else [child]:
                walk(one, node_id)
        else:
            assert isinstance(expression.get("path"), str), node_id

    for node in graph["nodes"]:
        if node["node_kind"] == "condition":
            walk((node.get("properties") or {})["expression"], node["node_id"])


# --------------------------------------------------------------------------- #
# Task C: the system ontology
# --------------------------------------------------------------------------- #
def test_ontology_keeps_the_registry_contract_surface(ontology: dict[str, Any]) -> None:
    assert ontology["contract_id"] == "coc.system-ontology-registry.v1"
    assert ontology["schema_version"] == 1
    assert ontology["registry_id"] == "registry:system-ontology:production"
    assert set(ontology) == {
        "contract_id", "schema_version", "registry_id",
        "graphs", "references", "relations", "coverage",
    }
    kinds = [row["graph_kind"] for row in ontology["graphs"]]
    assert sorted(kinds) == sorted(
        {"module", "rule", "live-state", "execution", "director", "text"}
    )
    assert sorted(row["graph_kind"] for row in ontology["coverage"]) == sorted(kinds)


def test_ontology_ids_are_unique_and_every_relation_end_resolves(
    ontology: dict[str, Any]
) -> None:
    ref_ids = [ref["ref_id"] for ref in ontology["references"]]
    relation_ids = [row["relation_id"] for row in ontology["relations"]]
    assert len(set(ref_ids)) == len(ref_ids)
    assert len(set(relation_ids)) == len(relation_ids)
    graph_ids = {row["graph_id"] for row in ontology["graphs"]}
    assert {ref["graph_id"] for ref in ontology["references"]} <= graph_ids
    unresolved = [
        (row["relation_id"], end)
        for row in ontology["relations"]
        for end in (row["from_ref"], row["to_ref"])
        if end not in set(ref_ids)
    ]
    assert unresolved == []


def test_ontology_rule_references_resolve_in_the_rule_graph(
    ontology: dict[str, Any], nodes: dict[str, dict[str, Any]]
) -> None:
    missing = []
    for ref in ontology["references"]:
        if ref["graph_id"] != "graph:rule:coc7" or ref["reference_kind"] != "artifact-node":
            continue
        node = nodes.get(ref["semantic_id"])
        if node is None or node["node_kind"] != ref["node_kind"]:
            missing.append(ref["ref_id"])
    assert missing == []


def test_ontology_condition_path_references_stay_registered(
    ontology: dict[str, Any]
) -> None:
    for ref in ontology["references"]:
        if ref["reference_kind"] == "registered-condition-path":
            assert ref["locator"] in REGISTERED_CONDITION_PATHS, ref["ref_id"]


def test_grounded_by_relations_run_director_to_rule_decision(
    ontology: dict[str, Any]
) -> None:
    refs = {ref["ref_id"]: ref for ref in ontology["references"]}
    for row in ontology["relations"]:
        if row["relation_kind"] != "grounded-by":
            continue
        source, target = refs[row["from_ref"]], refs[row["to_ref"]]
        assert source["graph_id"] == "graph:director:production", row["relation_id"]
        assert target["graph_id"] in {
            "graph:rule:coc7", "graph:module:the-haunting", "graph:live-state:campaign",
        }, row["relation_id"]
        assert target["node_kind"] in {
            "scene", "rule", "decision", "effect", "live-state-fact",
        }, row["relation_id"]


@pytest.mark.parametrize("director_ref", sorted(DIRECTOR_INTENT_REFS))
def test_director_intent_grounds_exactly_the_decisions_that_answer_it(
    director_ref: str,
    ontology: dict[str, Any],
    graph: dict[str, Any],
    nodes: dict[str, dict[str, Any]],
) -> None:
    """The ontology mirrors Task A: whichever decisions declare an intent, the
    Director rule that scores that intent grounds exactly those."""
    refs = {ref["ref_id"]: ref for ref in ontology["references"]}
    assert refs[director_ref]["node_kind"] == "scoring-rule"
    grounded = {
        refs[row["to_ref"]]["semantic_id"]
        for row in ontology["relations"]
        if row["relation_kind"] == "grounded-by" and row["from_ref"] == director_ref
    }
    kinds = DIRECTOR_INTENT_REFS[director_ref]
    expected = {
        decision_id
        for decision_id, declared in _declared_intents(graph, nodes).items()
        if declared & kinds
    }
    assert grounded == expected
