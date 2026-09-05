#!/usr/bin/env python3
"""Generate the DirectorGraph grounding gap ledger.

Usage:
    uv run --frozen python scripts/gen_director_grounding_ledger.py [--write]

Spec: docs/specs/pi-coc-cross-graph-wiring.md §5 W2

Slice W2 binds DirectorGraph doctrine to the ten-family RuleGraph through
``grounded-by``. This script measures how far that binding actually reaches,
so the answer is regenerated from the artifacts rather than asserted in prose
that can rot.

For every doctrine-plane node it records: the node's evidence class, whether
the registry carries a ``grounded-by`` edge for it, and the reason class for
nodes that have none. The reason classes are semantic judgments; they live in
``CLASSIFICATION`` below and are checked against the artifacts on every run:

- ``grounded``            a registry ``grounded-by`` edge exists and resolves.
- ``span-bound``          rule-derived through rulebook span bindings; the
                          RuleGraph has no node for the rule, so no edge can
                          be drawn (the fair-warning ladder, p.209).
- ``resolvable``          a real RuleGraph decision/effect/rule target exists
                          but no edge has been drawn yet. After W2 this class
                          must be empty; the test suite asserts it.
- ``pacing-state-read``   the node reads Director pacing state (stalled-turn
                          counters, low-agency counts, threat clocks, budgets,
                          ledgers, plan signals) that is not a registered
                          condition path in rule-graph-contract-v1.json, so
                          ADR 0003 decision 2 forbids a live-state edge.
- ``authored-no-source``  a design claim with no rule counterpart: structure
                          weights, tiebreaks, ladders, intent preferences,
                          scene/clue/memory policy constants.

A doctrine node missing from ``CLASSIFICATION`` fails the build, so a new
doctrine value can never slip past an unrecorded grounding judgment.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PLUGIN = ROOT / "plugins" / "coc-keeper"
DIRECTOR_GRAPH = PLUGIN / "references" / "director-graph.json"
DIRECTOR_CONTRACT = PLUGIN / "references" / "director-graph-contract-v1.json"
RULE_GRAPH = PLUGIN / "rulesets" / "coc7" / "rule-graph.json"
RULE_CONTRACT = PLUGIN / "references" / "rule-graph-contract-v1.json"
REGISTRY = PLUGIN / "references" / "system-ontology-registry-v1.json"
LEDGER = ROOT / "docs" / "status" / "director-grounding-gap.md"

GROUNDED = "grounded"
SPAN_BOUND = "span-bound"
RESOLVABLE = "resolvable"
PACING_STATE_READ = "pacing-state-read"
AUTHORED_NO_SOURCE = "authored-no-source"

PACING_REASON = (
    "reads Director pacing state (stalled turns, low-agency counts, clocks, "
    "budgets, ledgers or plan signals), not a registered RuleGraph condition "
    "path, so ADR 0003 decision 2 allows no live-state edge"
)
AUTHORED_STRUCTURE_WEIGHT = (
    "Layer-2 pacing multiplier over module structure types; no rulebook rule "
    "fixes how a structure prefers actions"
)
AUTHORED_INTENT_PREFERENCE = (
    "trigger is the classified player intent; the score is a pacing "
    "preference no rulebook rule fixes"
)

# node_id -> (reason class, reason). Semantic judgment recorded in code; the
# generator fails closed when a doctrine node is absent from this table.
CLASSIFICATION: dict[str, tuple[str, str]] = {
    # --- already grounded by registry edges -------------------------------
    "craft-directive:dying-clock-kind": (
        GROUNDED, "dying-hour-clock / dying-round-clock decisions"),
    "craft-directive:dying-forces-rescue-subsystem": (
        GROUNDED, "dying-entry rule"),
    "scoring-rule:pressure:pushed-fail-nudge": (
        GROUNDED,
        "pushed-roll decision; the nudge realises the rulebook's "
        "consequence-follows-a-pushed-failure requirement (p.83-85)"),
    "scoring-rule:subsystem:combat-flee-cast-intent": (
        GROUNDED,
        "combat attack/flee and cast-spell decisions receive the handoff; "
        "the score stays authored-doctrine because no rule fixes a pacing "
        "score"),
    # --- rule-derived through spans, no RuleGraph node --------------------
    "threshold:fair-warning-lethal-chances": (
        SPAN_BOUND,
        "rule-derived from Keeper Rulebook p.209; the RuleGraph has no "
        "fair-warning node, so no edge target exists"),
    # --- structure weights: 70 identical design claims --------------------
    **{
        f"structure-weight:{structure}:{action}": (
            AUTHORED_NO_SOURCE, AUTHORED_STRUCTURE_WEIGHT)
        for structure in (
            "branching-investigation", "campaign-sequel", "hub-sandbox",
            "hybrid-mega", "linear-acts", "multi-faction", "time-loop",
        )
        for action in (
            "character", "choice", "cut", "deepen", "montage", "payoff",
            "pressure", "recover", "reveal", "subsystem",
        )
    },
    # --- tiebreak / ladder: pure design claims -----------------------------
    "tiebreak-order:default": (
        AUTHORED_NO_SOURCE,
        "deterministic tie resolution order; no rulebook rule ranks pacing "
        "actions"),
    "affinity-ladder:pressure-move-scene-affinity": (
        AUTHORED_NO_SOURCE,
        "ranks pressure-move sources by structured scene references; the "
        "rung order is a design claim"),
    # --- scoring rules that read pacing state ------------------------------
    "scoring-rule:pressure:clock-near-full-or-stalled": (
        PACING_STATE_READ, PACING_REASON),
    "scoring-rule:pressure:yielded-scene": (
        PACING_STATE_READ, PACING_REASON),
    "scoring-rule:cut:stalled-transition-pressure": (
        PACING_STATE_READ, PACING_REASON),
    "scoring-rule:recover:stalled-turns": (
        PACING_STATE_READ, PACING_REASON),
    # --- scoring rules that are intent/design preferences ------------------
    "scoring-rule:reveal:investigate-intent": (
        AUTHORED_NO_SOURCE, AUTHORED_INTENT_PREFERENCE),
    "scoring-rule:reveal:social-intent": (
        AUTHORED_NO_SOURCE, AUTHORED_INTENT_PREFERENCE),
    "scoring-rule:montage:montage-intent": (
        AUTHORED_NO_SOURCE, AUTHORED_INTENT_PREFERENCE),
    "scoring-rule:cut:explicit-move-intent": (
        AUTHORED_NO_SOURCE, AUTHORED_INTENT_PREFERENCE),
    "scoring-rule:pressure:baseline": (
        AUTHORED_NO_SOURCE,
        "unconditional PRESSURE base score; a pacing constant no rule fixes"),
    "scoring-rule:pressure:cautious-posture-adjust": (
        AUTHORED_NO_SOURCE,
        "adjusts PRESSURE by the classified risk posture of rich player "
        "intent; a pacing preference no rule fixes"),
    "scoring-rule:pressure:reckless-posture-adjust": (
        AUTHORED_NO_SOURCE,
        "adjusts PRESSURE by the classified risk posture of rich player "
        "intent; a pacing preference no rule fixes"),
    "scoring-rule:character:agenda-npc-in-scene": (
        AUTHORED_NO_SOURCE,
        "trigger is an authored NPC agenda in the scene; the score is a "
        "design claim"),
    "scoring-rule:choice:two-undiscovered-clues": (
        AUTHORED_NO_SOURCE,
        "trigger is the scene's undiscovered clue count; the score is a "
        "design claim"),
    "scoring-rule:deepen:dramatic-question-present": (
        AUTHORED_NO_SOURCE,
        "trigger is an authored dramatic question; the score is a design "
        "claim"),
    "scoring-rule:cut:exit-condition-met": (
        AUTHORED_NO_SOURCE,
        "trigger is a met authored scene exit condition; the score is a "
        "design claim"),
    "scoring-rule:cut:main-line-complete": (
        AUTHORED_NO_SOURCE,
        "trigger is authored main-line completion; the score is a design "
        "claim"),
    "scoring-rule:payoff:structured-entity-overlap": (
        AUTHORED_NO_SOURCE,
        "trigger is structured overlap between memory cards and the scene; "
        "the score is a design claim"),
    # --- thresholds over pacing state --------------------------------------
    "threshold:cut-stalled-transition-turns": (PACING_STATE_READ, PACING_REASON),
    "threshold:default-clock-segments": (
        PACING_STATE_READ,
        "default segment count for threat clocks, a Director pacing "
        "construct distinct from the RuleGraph dying clock"),
    "threshold:override-low-agency-count": (PACING_STATE_READ, PACING_REASON),
    "threshold:override-stalled-turns": (PACING_STATE_READ, PACING_REASON),
    "threshold:pressure-clock-near-full-fraction": (PACING_STATE_READ, PACING_REASON),
    "threshold:pressure-move-low-agency-count": (PACING_STATE_READ, PACING_REASON),
    "threshold:pressure-move-stalled-gate": (PACING_STATE_READ, PACING_REASON),
    "threshold:pressure-posture-ceiling": (PACING_STATE_READ, PACING_REASON),
    "threshold:pressure-posture-floor": (PACING_STATE_READ, PACING_REASON),
    "threshold:pressure-stalled-turns": (PACING_STATE_READ, PACING_REASON),
    "threshold:pressure-yielded-low-agency-count": (PACING_STATE_READ, PACING_REASON),
    "threshold:recent-intent-window": (PACING_STATE_READ, PACING_REASON),
    "threshold:recover-stalled-turns": (PACING_STATE_READ, PACING_REASON),
    "threshold:scene-exit-pressure-continue-count": (PACING_STATE_READ, PACING_REASON),
    "threshold:storylet-need-stalled-turns": (PACING_STATE_READ, PACING_REASON),
    "threshold:storylet-recent-window": (PACING_STATE_READ, PACING_REASON),
    "threshold:storylet-used-targets-window": (PACING_STATE_READ, PACING_REASON),
    "threshold:storylet-used-window": (PACING_STATE_READ, PACING_REASON),
    "threshold:compression-max-beats-ceiling": (PACING_STATE_READ, PACING_REASON),
    "threshold:compression-max-beats-default": (PACING_STATE_READ, PACING_REASON),
    "threshold:compression-max-beats-floor": (PACING_STATE_READ, PACING_REASON),
    "threshold:compression-max-minutes-ceiling": (PACING_STATE_READ, PACING_REASON),
    "threshold:compression-max-minutes-default": (PACING_STATE_READ, PACING_REASON),
    "threshold:compression-min-beats-default": (PACING_STATE_READ, PACING_REASON),
    "threshold:low-agency-max-beats-fallback": (PACING_STATE_READ, PACING_REASON),
    "threshold:time-advance-confidence-digits": (PACING_STATE_READ, PACING_REASON),
    "threshold:time-advance-deadline-confidence": (PACING_STATE_READ, PACING_REASON),
    "threshold:time-advance-deadline-delta-minutes": (PACING_STATE_READ, PACING_REASON),
    "threshold:time-advance-default-confidence": (PACING_STATE_READ, PACING_REASON),
    "threshold:time-advance-exhaustion-confidence": (PACING_STATE_READ, PACING_REASON),
    "threshold:time-advance-exhaustion-delta-minutes": (PACING_STATE_READ, PACING_REASON),
    "threshold:time-advance-exhaustion-hours": (PACING_STATE_READ, PACING_REASON),
    # --- thresholds over scene/clue/memory/mythos structure ----------------
    "threshold:choice-undiscovered-clue-count": (
        AUTHORED_NO_SOURCE,
        "gate over the scene's authored clue list; no rulebook rule sets it"),
    "threshold:clue-policy-lead-count": (
        AUTHORED_NO_SOURCE,
        "Keeper-facing clue policy cap; a design claim"),
    "threshold:clue-route-default-priority": (
        AUTHORED_NO_SOURCE,
        "clue route priority default; a design claim"),
    "threshold:live-affordance-merge-cap": (
        AUTHORED_NO_SOURCE,
        "cap over live scene affordances; a design claim"),
    "threshold:live-affordance-minimum": (
        AUTHORED_NO_SOURCE,
        "minimum live scene affordances; a design claim"),
    "threshold:live-affordance-return-cap": (
        AUTHORED_NO_SOURCE,
        "cap over returned live scene affordances; a design claim"),
    "threshold:live-affordance-route-cap": (
        AUTHORED_NO_SOURCE,
        "cap over routed live scene affordances; a design claim"),
    "threshold:memory-callback-candidate-floor": (
        AUTHORED_NO_SOURCE,
        "memory callback candidate floor; a design claim"),
    "threshold:memory-callback-overlap-weight": (
        AUTHORED_NO_SOURCE,
        "memory callback overlap weight; a design claim"),
    "threshold:memory-callback-refs-multiplier": (
        AUTHORED_NO_SOURCE,
        "memory callback refs multiplier; a design claim"),
    "threshold:memory-callback-score-digits": (
        AUTHORED_NO_SOURCE,
        "score rounding precision for memory callbacks; a formatting "
        "constant"),
    "threshold:mythos-signature-sample": (
        AUTHORED_NO_SOURCE,
        "caps the signature elements sampled into a mythos presentation "
        "directive; a design claim"),
    "threshold:fumble-tick-bound": (
        AUTHORED_NO_SOURCE,
        "acceptance bound for authored fumble-effect clock ticks; the "
        "RuleGraph has no exceptional-effect node to ground it"),
    "threshold:score-precision-digits": (
        AUTHORED_NO_SOURCE,
        "score rounding precision; a formatting constant"),
    # --- storylet selection multipliers ------------------------------------
    "multiplier:storylet-selection:conflict-rank-gap": (
        AUTHORED_NO_SOURCE,
        "storylet selection weighting over conflict levels; a design claim"),
    "multiplier:storylet-selection:family-repeat-penalty": (
        AUTHORED_NO_SOURCE,
        "storylet family rotation penalty; a design claim"),
    "multiplier:storylet-selection:polarity-match": (
        AUTHORED_NO_SOURCE,
        "storylet polarity-match bonus; a design claim"),
    "multiplier:storylet-selection:scene-tag-generic-suppression": (
        AUTHORED_NO_SOURCE,
        "suppresses generic storylets while a scene tag summons beats; a "
        "design claim"),
    "multiplier:storylet-selection:scene-tag-summoned-boost": (
        AUTHORED_NO_SOURCE,
        "boosts scene-tag summoned storylets; a design claim"),
    "multiplier:storylet-selection:serves-deepen-npc": (
        AUTHORED_NO_SOURCE,
        "serves bonus for storylets that deepen a present NPC; a design "
        "claim"),
    "multiplier:storylet-selection:serves-reveal-clue": (
        AUTHORED_NO_SOURCE,
        "serves bonus for storylets that carry an available clue; a design "
        "claim"),
    "multiplier:storylet-selection:serves-surface-choice": (
        AUTHORED_NO_SOURCE,
        "serves bonus for storylets that surface a choice; a design claim"),
    "multiplier:storylet-selection:serves-tick-front": (
        AUTHORED_NO_SOURCE,
        "serves bonus for storylets that tick a live threat front; a design "
        "claim"),
    "multiplier:storylet-selection:trope-repeat-penalty": (
        AUTHORED_NO_SOURCE,
        "storylet trope rotation penalty; a design claim"),
}


def build() -> dict:
    director = json.loads(DIRECTOR_GRAPH.read_text("utf-8"))
    contract = json.loads(DIRECTOR_CONTRACT.read_text("utf-8"))
    rules = json.loads(RULE_GRAPH.read_text("utf-8"))
    registry = json.loads(REGISTRY.read_text("utf-8"))
    registered_paths = set(
        json.loads(RULE_CONTRACT.read_text("utf-8"))["registered_condition_paths"]
    )

    doctrine_kinds = set(contract["doctrine_node_kinds"])
    doctrine = [n for n in director["nodes"] if n["node_kind"] in doctrine_kinds]

    rule_node_ids = {n["node_id"] for n in rules["nodes"]}
    rule_groundable_ids = {
        n["node_id"]
        for n in rules["nodes"]
        if n["node_kind"] in {"decision", "effect", "rule"}
    }

    # Registry grounding edges, from director refs to rule refs.
    director_ref_ids = {
        r["ref_id"] for r in registry["references"]
        if r["graph_id"] == "graph:director:production"
    }
    ref_semantics = {r["ref_id"]: r["semantic_id"] for r in registry["references"]}
    edges_by_node: dict[str, list[str]] = {}
    for rel in registry["relations"]:
        if rel["relation_kind"] != "grounded-by":
            continue
        if rel["from_ref"] not in director_ref_ids:
            continue
        source = ref_semantics[rel["from_ref"]]
        target = ref_semantics[rel["to_ref"]]
        # Fail closed: every declared edge must resolve in the RuleGraph.
        assert target in rule_node_ids, f"dangling grounded-by target {target}"
        edges_by_node.setdefault(source, []).append(target)

    missing = sorted(
        n["node_id"] for n in doctrine if n["node_id"] not in CLASSIFICATION
    )
    assert not missing, f"unclassified doctrine nodes: {missing}"

    # Every grounding target named by a doctrine node must exist; a target
    # that does not exist is recorded, never approximated.
    for node in doctrine:
        for target in node.get("grounded_by") or []:
            assert target in rule_node_ids, (
                f"{node['node_id']} grounds into a RuleGraph node that "
                f"does not exist: {target}"
            )

    rows = []
    for node in sorted(doctrine, key=lambda n: n["node_id"]):
        node_id = node["node_id"]
        reason_class, reason = CLASSIFICATION[node_id]
        edges = sorted(edges_by_node.get(node_id, []))
        if edges:
            reason_class = GROUNDED
        rows.append({
            "node_id": node_id,
            "node_kind": node["node_kind"],
            "evidence_class": node["evidence_class"],
            "reason_class": reason_class,
            "reason": reason,
            "targets": edges,
        })

    counts = {
        GROUNDED: sum(1 for r in rows if r["reason_class"] == GROUNDED),
        SPAN_BOUND: sum(1 for r in rows if r["reason_class"] == SPAN_BOUND),
        RESOLVABLE: sum(1 for r in rows if r["reason_class"] == RESOLVABLE),
        PACING_STATE_READ: sum(
            1 for r in rows if r["reason_class"] == PACING_STATE_READ),
        AUTHORED_NO_SOURCE: sum(
            1 for r in rows if r["reason_class"] == AUTHORED_NO_SOURCE),
    }
    return {
        "rows": rows,
        "counts": counts,
        "doctrine_total": len(doctrine),
        "registered_condition_paths": len(registered_paths),
        "edges": sum(len(r["targets"]) for r in rows),
        "rule_groundable": len(rule_groundable_ids),
    }


def render(data: dict) -> str:
    counts = data["counts"]
    lines = [
        "# DirectorGraph grounding gap",
        "",
        "> **Generated** by `scripts/gen_director_grounding_ledger.py`. Do not edit by hand.",
        "> Regenerated and compared by `tests/test_director_grounding.py`, so it cannot rot.",
        "",
        f"- Doctrine-plane nodes: **{data['doctrine_total']}**",
        f"- `grounded-by` registry edges from doctrine nodes: **{data['edges']}**",
        f"- RuleGraph decision/effect/rule nodes available as targets: "
        f"**{data['rule_groundable']}**; registered condition paths: "
        f"**{data['registered_condition_paths']}**",
        "",
        "## Reason classes",
        "",
        f"| class | nodes | meaning |",
        f"| --- | :-: | --- |",
        f"| `grounded` | {counts[GROUNDED]} | a registry `grounded-by` edge exists and resolves in the RuleGraph |",
        f"| `span-bound` | {counts[SPAN_BOUND]} | rule-derived through rulebook spans; the RuleGraph has no node for the rule, so no edge target exists |",
        f"| `resolvable` | {counts[RESOLVABLE]} | a real RuleGraph target exists but no edge has been drawn — must stay zero after slice W2 |",
        f"| `pacing-state-read` | {counts[PACING_STATE_READ]} | reads Director pacing state, not a registered RuleGraph condition path, so ADR 0003 decision 2 allows no live-state edge |",
        f"| `authored-no-source` | {counts[AUTHORED_NO_SOURCE]} | a design claim with no rule counterpart |",
        "",
        "## Grounded doctrine",
        "",
        "| node | evidence class | grounded-by targets |",
        "| --- | --- | --- |",
    ]
    for row in data["rows"]:
        if row["reason_class"] != GROUNDED:
            continue
        targets = ", ".join(f"`{t}`" for t in row["targets"])
        lines.append(
            f"| `{row['node_id']}` | {row['evidence_class']} | {targets} |"
        )
    lines += [
        "",
        "## Ungrounded doctrine",
        "",
        "| node | kind | evidence class | reason class | reason |",
        "| --- | --- | --- | --- | --- |",
    ]
    for row in data["rows"]:
        if row["reason_class"] == GROUNDED:
            continue
        lines.append(
            f"| `{row['node_id']}` | {row['node_kind']} | {row['evidence_class']} "
            f"| `{row['reason_class']}` | {row['reason']} |"
        )
    lines += [
        "",
        "## What this measures",
        "",
        "Slice W2 (`docs/specs/pi-coc-cross-graph-wiring.md` §5) extended the",
        "Director's `grounded-by` surface past the dying family after the",
        "ten-family RuleGraph cutover promoted push-luck, combat and magic.",
        "The grounded set above is every doctrine node with a registry edge;",
        "each target resolves in `rulesets/coc7/rule-graph.json` and the",
        "registry validator fails closed on a dangling one.",
        "",
        "The ungrounded rows are not unfinished work. A `grounded-by` edge is",
        "only honest when the doctrine realises a rule the RuleGraph carries;",
        "pacing counters, structure weights, tiebreaks and policy constants",
        "have no such rule, and inventing approximate targets would repeat the",
        "failure class this ledger exists to prevent. The pre-cutover claim",
        "that push-luck and pacing families were \"still unresolved in the",
        "RuleGraph\" was deleted with slice W2: push-luck is resolved and now",
        "carries the pushed-failure nudge edge; the pacing family is a",
        "Director-owned construct with no RuleGraph representation, which is",
        "what `pacing-state-read` records.",
        "",
        "`scoring-rule:subsystem:combat-flee-cast-intent` keeps its",
        "`authored-doctrine` class even though it is grounded: the handoff",
        "targets are rule decisions, but no rulebook rule fixes the pacing",
        "score itself. A `grounded-by` edge records applicability, not value",
        "provenance.",
    ]
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args(argv)
    text = render(build())
    if args.write:
        LEDGER.write_text(text, encoding="utf-8")
    else:
        print(text, end="")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
