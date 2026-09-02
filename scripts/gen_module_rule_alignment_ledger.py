#!/usr/bin/env python3
"""Generate the Module-to-Rule alignment ledger for The Haunting.

Usage:
    uv run --frozen python scripts/gen_module_rule_alignment_ledger.py [--write]

Spec: docs/specs/pi-coc-cross-graph-wiring.md §5 W3

Slice W3 aligns The Haunting's authored mechanism identities with the coc7
RuleGraph.  This script re-measures the mechanical half of that alignment —
which `module.haunting.*` identities exist in the production artifacts, where
they occur, whether any of them is exactly equal to a RuleGraph semantic id,
and whether they double as runtime provenance identifiers — so the ledger is
regenerated from the artifacts rather than asserted in prose that can rot.
The semantic verdicts (which rules each mechanism adopts, if any) are
Keeper-judgment prose owned by this file and recorded per slice W3.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
PLUGIN = ROOT / "plugins" / "coc-keeper"
HAUNTING = PLUGIN / "references" / "starter-scenarios" / "the-haunting"
MODULE_GRAPH = HAUNTING / "module-graph.json"
STORY_GRAPH = HAUNTING / "story-graph.json"
MODULE_ASSETS = HAUNTING / "module-graph-assets.json"
RULE_GRAPH = PLUGIN / "rulesets" / "coc7" / "rule-graph.json"
MODULE_RULES = PLUGIN / "rulesets" / "coc7" / "rules-json" / "the-haunting.json"
LEDGER = ROOT / "docs" / "status" / "module-rule-alignment-haunting.md"

AUTHORED_PREFIX = "module.haunting."
REF_KEYS = ("rule_ref", "runtime_rule_ref")


def _collect_refs(value: Any, path: str, out: list[tuple[str, str]]) -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            if key in REF_KEYS and isinstance(item, str) and item.startswith(AUTHORED_PREFIX):
                out.append((item, f"{path}/{key}"))
            else:
                _collect_refs(item, f"{path}/{key}", out)
    elif isinstance(value, list):
        for index, item in enumerate(value):
            _collect_refs(item, f"{path}/{index}", out)


def _occurrences_by_identity(document: Any, root_label: str) -> dict[str, list[str]]:
    found: list[tuple[str, str]] = []
    _collect_refs(document, root_label, found)
    grouped: dict[str, list[str]] = {}
    for identity, path in found:
        grouped.setdefault(identity, []).append(path)
    return grouped


def build() -> dict:
    module_graph = json.loads(MODULE_GRAPH.read_text("utf-8"))
    story_graph = json.loads(STORY_GRAPH.read_text("utf-8"))
    module_assets = json.loads(MODULE_ASSETS.read_text("utf-8"))
    rule_graph = json.loads(RULE_GRAPH.read_text("utf-8"))
    module_rules = json.loads(MODULE_RULES.read_text("utf-8"))

    # Every authored mechanism identity lives on a module-graph node: either a
    # scene's runtime_projection affordance/conclusion, or an artifact node's
    # runtime_rule_ref property.
    module_refs: dict[str, list[str]] = {}
    for node in module_graph.get("nodes", []):
        node_id = node.get("node_id", "<unnamed>")
        for identity, path in _occurrences_by_identity(
            node, f"module-graph.json#/nodes/{node_id}"
        ).items():
            module_refs.setdefault(identity, []).extend(path)

    story_refs = _occurrences_by_identity(story_graph, "story-graph.json")
    asset_refs = _occurrences_by_identity(module_assets, "module-graph-assets.json")

    rule_node_ids = sorted(
        node["node_id"]
        for node in rule_graph.get("nodes", [])
        if isinstance(node.get("node_id"), str)
    )
    rule_id_set = set(rule_node_ids)
    provenance_ids = sorted(
        row.get("source_rule_id")
        for row in (module_rules.get("rules") or {}).values()
        if isinstance(row, dict) and isinstance(row.get("source_rule_id"), str)
    )
    provenance_set = set(provenance_ids)

    identities = sorted(module_refs)
    rows = []
    for identity in identities:
        rows.append({
            "identity": identity,
            "module_graph_occurrences": len(module_refs[identity]),
            "module_graph_paths": list(module_refs[identity]),
            "story_graph_occurrences": len(story_refs.get(identity, [])),
            "asset_occurrences": len(asset_refs.get(identity, [])),
            "exact_rule_graph_match": identity in rule_id_set,
            "runtime_provenance_id": identity in provenance_set,
        })

    return {
        "identities": rows,
        "unique_identities": len(identities),
        "module_graph_occurrence_total": sum(len(v) for v in module_refs.values()),
        "rule_graph_nodes": len(rule_node_ids),
        "exact_matches": [row["identity"] for row in rows if row["exact_rule_graph_match"]],
        "provenance_overlap": [row["identity"] for row in rows if row["runtime_provenance_id"]],
        "uses_rule_edges": 0,
    }


# The semantic verdicts are slice W3's judgment record: what each authored
# mechanism was compared against in the ten-family RuleGraph, and why the
# verdict is what it is.  They live here (not in the markdown) so the ledger
# test pins judgment and measurement together.
VERDICTS = [
    {
        "identity": "module.haunting.chapel_weakened_floor",
        "verdict": "module-specific",
        "nearest": "none (rejected: `decision:coc7:push-luck:luck-roll`, "
                   "`decision:coc7:core-check:ordinary-check`)",
        "reason": "An authored hazard chain: Luck to catch the weak floor, Jump on a "
                  "failed Luck, 1D6 damage from the ten-foot fall on a failed Jump, with "
                  "an authored pushed-failure extra. The hazard *calls for* Luck and Jump "
                  "checks; it does not adopt their rule semantics, and the RuleGraph has "
                  "no falling or environmental-hazard rule for it to adopt. ADR 0003 "
                  "decision 4 excludes exactly this shape — a rule that may fire in a "
                  "subsequent condition is not an adopted rule — and ADR 0003 article 7 "
                  "names this very mechanism: the weak floor may not fabricate uses-rule.",
    },
    {
        "identity": "module.haunting.conclusion_sanity_reward",
        "verdict": "module-specific",
        "nearest": "`rule:coc7:sanity:sanity-increase` (cap channel only, not adopted)",
        "reason": "A complete authored reward schedule: destroying Corbitt grants 1D6 SAN "
                  "at the session-ending settlement. The graph's only SAN-gain rule, "
                  "sanity-increase, enumerates the channels that may raise current SAN "
                  "within maximum; it contributes the cap at settlement time but defines "
                  "neither the trigger nor the die. The mechanism's substance is wholly "
                  "authored, so the rule is a downstream bound, not an adopted semantic "
                  "(ADR 0003 decision 4). `rule:coc7:development:mastery-san-reward` was "
                  "also considered and rejected: different trigger (skill 90+) and die "
                  "(2D6). `decision:coc7:development:settle-ending` is the host settlement "
                  "procedure that consumes this authored data; consuming is not adopting.",
    },
    {
        "identity": "module.haunting.corbitt_animate_body",
        "verdict": "module-specific",
        "nearest": "none",
        "reason": "Corbitt animating his own buried corpse (2 MP, five combat rounds) is "
                  "the module's authored expression of his Mythos power. The magic family "
                  "carries no spell catalog entries and no animation/undead semantic; "
                  "cast-spell is the generic settlement shape for casts this mechanic "
                  "never performs in play (the animation predates the confrontation).",
    },
    {
        "identity": "module.haunting.corbitt_flesh_ward",
        "verdict": "module-specific",
        "nearest": "none (rejected: `rule:coc7:combat:armor-reduction`, "
                   "`rule:coc7:magic:mp-economy`, `decision:coc7:magic:cast-spell`)",
        "reason": "An authored magical ward with its own armor semantics: 2 MP, 2D6 armor "
                  "that degrades one point per damage absorbed, 24-hour duration, and an "
                  "authored exception (the own dagger bypasses it). armor-reduction is "
                  "ordinary *physical* armor and is explicitly not what this ward is; "
                  "mp-economy would only bound MP overspend consequences downstream; "
                  "cast-spell is the settlement shape of a cast that happens before play "
                  "meets it. The mechanic defines its own defense rules rather than "
                  "adopting any rule in the graph.",
    },
    {
        "identity": "module.haunting.corbitt_floating_knife_mp",
        "verdict": "module-specific",
        "nearest": "none (rejected: `rule:coc7:magic:mp-economy`)",
        "reason": "An authored upkeep cost: 1 MP per combat round keeps the animated knife "
                  "attacking. mp-economy governs the MP pool (size, overspill, "
                  "regeneration), not per-attack upkeep costs, so it can only constrain "
                  "consequences downstream — the 'may fire later' shape ADR 0003 "
                  "decision 4 excludes. The knife's attack itself is resolved through "
                  "combat semantics it *calls for* (opposed melee vs Dodge), which is "
                  "invocation, not adoption.",
    },
    {
        "identity": "module.haunting.corbitt_own_dagger",
        "verdict": "module-specific",
        "nearest": "none (rejected: `rule:coc7:combat:weapon-damage`, "
                   "`rule:coc7:healing:instant-death`)",
        "reason": "An authored kill exception: Corbitt's own ritual dagger bypasses his "
                  "wards and spells and turns him to ash on a successful hit, regardless "
                  "of hit points. No combat rule carries a 'named weapon bypasses a named "
                  "entity's magical defenses' semantic, and instant-death has a different "
                  "causal shape entirely (damage exceeding maximum HP). The exception "
                  "negates defense rules rather than adopting any of them.",
    },
    {
        "identity": "module.haunting.damaged_liber_ivonis_initial_read",
        "verdict": "module-specific",
        "nearest": "`rule:coc7:magic:learn-from-book` (parameters wholly replaced, not adopted)",
        "reason": "An authored damaged-tome read: at least three hours, Read Latin at 50, "
                  "+2 Cthulhu Mythos, up to 2 SAN loss. The generic learn-from-book rule "
                  "says 2D6 weeks and a Hard INT roll; the module replaces every parameter "
                  "(duration, skill, and outcome), so the mechanism is an authored tome "
                  "rule standing in place of the generic one, not an instance of it. "
                  "`rule:coc7:sanity:mythos-insanity-gain` was also considered: it "
                  "governs Mythos gains *through insanity*, a different trigger shape "
                  "from an authored reading outcome.",
    },
]

REASON_CLASSIFICATION = (
    "module-specific: authored mechanism with no exactly-equal coc7 Rule/Decision semantic"
)


def render(data: dict) -> str:
    lines = [
        "# Module→Rule alignment ledger — The Haunting",
        "",
        "> **Generated** by `scripts/gen_module_rule_alignment_ledger.py`. Do not edit by hand.",
        "> Regenerated and compared by `tests/test_system_ontology.py`, so it cannot rot.",
        "",
        f"- Authored `module.haunting.*` mechanism identities: **{data['unique_identities']}**"
        f" ({data['module_graph_occurrence_total']} occurrences in module-graph.json)",
        f"- Exact equality with a coc7 RuleGraph semantic id ({data['rule_graph_nodes']} nodes): "
        f"**{', '.join(data['exact_matches']) if data['exact_matches'] else 'none'}**",
        f"- `uses-rule` edges drawn: **{data['uses_rule_edges']}**",
        f"- Reason classification for every identity below: {REASON_CLASSIFICATION}",
        "",
        "| identity | module-graph occurrences | story-graph mirror | assets mirror | rules-json provenance id | exact RuleGraph match |",
        "| --- | :-: | :-: | :-: | :-: | :-: |",
    ]
    for row in data["identities"]:
        lines.append(
            f"| `{row['identity']}` | {row['module_graph_occurrences']} "
            f"| {row['story_graph_occurrences']} "
            f"| {row['asset_occurrences']} "
            f"| {'yes' if row['runtime_provenance_id'] else 'no'} "
            f"| {'yes' if row['exact_rule_graph_match'] else 'no'} |"
        )
    lines += [
        "",
        "## What this measures",
        "",
        "Slice W3 (`docs/specs/pi-coc-cross-graph-wiring.md` §5) asked, for every authored",
        "mechanism identity in the production The Haunting ModuleGraph, which coc7 rule",
        "semantic it adopts. ADR 0003 decision 4 sets the bar: `uses-rule` holds only when",
        "the authored `module_rule_ref` is exactly equal to a RuleGraph Rule/Decision",
        "semantic id, and a rule that may merely fire in a later condition is not adopted.",
        "",
        "The measurement above is the mechanical half: the identities, their locations, and",
        "the exact-equality check against all ten RuleGraph families. The verdicts below are",
        "the semantic half, judged per identity against the real rule-graph.json surface.",
        "All seven are judged module-specific, so no `uses-rule` edge is drawn, and the",
        "registry keeps module coverage at `no-proven-instance`.",
        "",
        "## Semantic verdicts",
        "",
    ]
    for verdict in VERDICTS:
        lines += [
            f"### `{verdict['identity']}` — {verdict['verdict']}",
            "",
            f"Nearest candidate(s): {verdict['nearest']}",
            "",
            verdict["reason"],
            "",
        ]
    lines += [
        "## Why no `uses-rule` edge can land here even hypothetically",
        "",
        "Two independent blocks, both verified against the code:",
        "",
        "1. **No semantic counterpart.** None of the seven identities adopts a coc7",
        "   Rule/Decision semantic (verdicts above), so there is no target semantic id to",
        "   point `module_rule_ref` at. Weak similarity is exactly what ADR 0003 decision 4",
        "   and article 7 exclude; `tests/test_system_ontology.py` fail-closes the weak-floor",
        "   probe (`module_rule_binding_mismatch`).",
        "2. **The authored ids are runtime provenance, not free labels.** All seven flow into",
        "   live play: `coc_story_director._build_rules_requests` splats authored_operation",
        "   payloads (with their `rule_ref`) verbatim into rules requests, and",
        "   `development.settle` persists the conclusion reward `rule_ref` into roll and event",
        "   logs. In addition, these identities double as `source_rule_id` rows in",
        "   `rulesets/coc7/rules-json/the-haunting.json`: "
        f"{len(data['provenance_overlap'])} of {data['unique_identities']}. The strings are asserted "
        "   verbatim by `tests/test_rules.py`, `tests/test_runtime_ops.py`, and",
        "   `tests/test_combat_state.py`. The registry validator additionally requires the",
        "   authored payload `rule_ref` to equal the registry `module_rule_ref`",
        "   (`coc_system_ontology.py` drift check), so landing a `uses-rule` edge would mean",
        "   renaming a runtime-pinned provenance identifier — a behavior change that needs",
        "   its own slice with behavior-equivalence protection, never an ontology-only edit.",
        "",
        "The registry coverage reason for the module graph names this ledger. If a future",
        "ruleset slice ever accepts a RuleGraph semantic that one of these mechanisms truly",
        "adopts, the path is: rename the authored identity through the module ruleset and",
        "its runtime provenance with a behavior-equivalence gate, then add the registry",
        "`module-authored-operation` reference and `uses-rule` relation, which the validator",
        "already supports (`test_explicit_module_rule_ref_to_rulegraph_semantic_id_is_valid`).",
        "",
    ]
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true", help="write the ledger file")
    args = parser.parse_args(argv)
    rendered = render(build())
    if args.write:
        LEDGER.write_text(rendered, encoding="utf-8")
        print(f"wrote {LEDGER}")
    else:
        print(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
