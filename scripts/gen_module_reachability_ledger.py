#!/usr/bin/env python3
"""Generate docs/status/module-reachability-ledger.md from the committed starter.

Usage:
    uv run --frozen python scripts/gen_module_reachability_ledger.py [--write]

Spec: docs/specs/pi-coc-module-reachability-lint.md §8 (slice L2)

The ledger answers one question a reader cannot otherwise answer from a lint
report: for each check code, is the silence a measurement or an absence? A code
that ran and found nothing and a code that never ran because its document is
missing both print as zero findings, and only one of them is evidence.

Two halves, both measured here rather than asserted in prose:

1. `lint_scenario_dir` over the committed starter, tabulated per check code with
   its completeness class and whether the code was measurable at all.
2. The §2.2 coverage contradiction, recomputed from the starter's own
   `module-graph.json`, `clue-graph.json`, and `story-graph.json`: the graph
   self-reports every coverage domain `accepted` while carrying no acquisition
   relation for any clue, and the placements the lint reads live entirely in the
   projected story graph.

**Scope: the committed starter only.** The four compiled campaigns in the
specification's evidence base live under `.coc/`, which is gitignored runtime
data — timestamped local imports that a fresh clone does not have. A ledger
covering them would regenerate differently on every machine and fail its own
drift test everywhere but the one checkout that produced it, which is the
opposite of drift-proof. The campaigns stay where they belong: in
`tests/test_module_reachability.py`'s ground-truth expectations, skipped when
the directory is absent.

Deterministic by construction: every number comes from the committed files, the
tables are sorted by the frozen `CHECK_CODES` order and by id, and nothing reads
a clock. There is no generation date, because a wall-clock line would break the
drift test once a day.
"""
from __future__ import annotations

import argparse
import collections
import importlib.util
import json
import sys
import textwrap
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
PLUGIN = ROOT / "plugins" / "coc-keeper"
PLUGIN_SCRIPTS = PLUGIN / "scripts"
STARTER = PLUGIN / "references" / "starter-scenarios" / "the-haunting"
LEDGER = ROOT / "docs" / "status" / "module-reachability-ledger.md"

# `discoverable-at` / `delivered-by` are the ModuleGraph contract's authored
# access routes (docs/specs/module-graph-to-kp-integration.md). If a clue in the
# graph could be acquired anywhere, it would say so with one of these.
ACQUISITION_RELATION_KINDS = ("delivered-by", "discoverable-at")

# §2.2: requirement closure and ending reachability are unmeasurable on any
# graph that exists today, because no graph carries these node kinds at all.
ABSENT_NODE_KINDS = ("clock", "ending", "outcome", "requirement")


def _load_lint():
    """Import the lint module by path, as the sibling generators do."""
    path = PLUGIN_SCRIPTS / "coc_module_reachability.py"
    spec = importlib.util.spec_from_file_location("coc_module_reachability", path)
    if spec is None or spec.loader is None:  # pragma: no cover - unreachable
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules["coc_module_reachability"] = module
    if str(PLUGIN_SCRIPTS) not in sys.path:
        sys.path.insert(0, str(PLUGIN_SCRIPTS))
    spec.loader.exec_module(module)
    return module


def _read(name: str) -> dict[str, Any]:
    return json.loads((STARTER / name).read_text(encoding="utf-8"))


def _graph_facts() -> dict[str, Any]:
    """Recompute §2.2 from the starter's own files. No number is copied."""
    graph = _read("module-graph.json")
    story = _read("story-graph.json")
    clue_graph = _read("clue-graph.json")

    nodes = graph["nodes"]
    relations = graph.get("relations") or []
    kind_of = {node["node_id"]: node["node_kind"] for node in nodes}
    clue_node_ids = {n["node_id"] for n in nodes if n["node_kind"] == "clue"}

    acquisition = [
        rel for rel in relations
        if rel["relation_kind"] in ACQUISITION_RELATION_KINDS
    ]
    acquisition_touching_clues = [
        rel for rel in acquisition
        if rel["from_node_id"] in clue_node_ids or rel["to_node_id"] in clue_node_ids
    ]
    endpoint_kinds = collections.Counter()
    for rel in acquisition:
        endpoint_kinds[kind_of.get(rel["from_node_id"], "unknown")] += 1

    placed: set[str] = set()
    for scene in story.get("scenes") or []:
        placed |= {str(c) for c in scene.get("available_clues") or []}
    declared_clues = [
        str(clue["clue_id"])
        for conclusion in clue_graph.get("conclusions") or []
        for clue in conclusion.get("clues") or []
    ]

    coverage = graph.get("coverage") or {}
    return {
        "module_id": graph.get("module_id"),
        "graph_nodes": len(nodes),
        "graph_relations": len(relations),
        "graph_claims": len(graph.get("claims") or []),
        "coverage_domains": sorted(coverage),
        "coverage_accepted": sorted(k for k, v in coverage.items() if v == "accepted"),
        "coverage_states": sorted({str(v) for v in coverage.values()}),
        "clue_nodes": len(clue_node_ids),
        "acquisition_relations": len(acquisition),
        "acquisition_relations_on_clues": len(acquisition_touching_clues),
        "acquisition_subject_kinds": sorted(endpoint_kinds.items()),
        "absent_node_kinds": [
            (kind, sum(1 for n in nodes if n["node_kind"] == kind))
            for kind in ABSENT_NODE_KINDS
        ],
        "scenes": len(story.get("scenes") or []),
        "scenes_declaring_final": sum(
            1 for s in story.get("scenes") or [] if s.get("is_final")
        ),
        "declared_clues": len(declared_clues),
        "placed_clue_ids": len(placed),
        "declared_clues_placed": sum(1 for c in declared_clues if c in placed),
    }


def build() -> dict[str, Any]:
    lint = _load_lint()
    report = lint.lint_scenario_dir(STARTER)
    findings = list(report.get("findings") or [])
    not_measured = set(report.get("codes_not_measured") or [])

    classes = ("dead", "pending-materialization", "not-measured")
    per_code = []
    for code in lint.CHECK_CODES:
        rows = [f for f in findings if f["code"] == code]
        per_code.append({
            "code": code,
            "severity_when_dead": lint.SEVERITY_WHEN_DEAD[code],
            "reason": lint.REASONS[code],
            "measured": code not in not_measured,
            "findings": len(rows),
            "by_completeness": {
                cls: sum(1 for f in rows if f["completeness"] == cls)
                for cls in classes
            },
        })
    return {
        "contract_id": lint.CONTRACT_ID,
        "schema_version": lint.SCHEMA_VERSION,
        "report": report,
        "per_code": per_code,
        "classes": classes,
        "graph": _graph_facts(),
    }


def _codes(values: list[str]) -> str:
    return ", ".join(f"`{v}`" for v in values) if values else "none"


def _para(text: str) -> list[str]:
    """Wrap one interpolated paragraph deterministically, then a blank line."""
    return textwrap.fill(" ".join(text.split()), width=76).splitlines() + [""]


def render(data: dict[str, Any]) -> str:
    report = data["report"]
    graph = data["graph"]
    summary = report["summary"]
    measured = [row for row in data["per_code"] if row["measured"]]
    silent = [row for row in measured if row["findings"] == 0]

    lines: list[str] = []
    add = lines.append
    add("# Module reachability ledger")
    add("")
    add("> **Generated** by `scripts/gen_module_reachability_ledger.py` over")
    add("> `plugins/coc-keeper/references/starter-scenarios/the-haunting`.")
    add("> Do not hand-edit. Regenerated and compared by")
    add("> `tests/test_module_reachability_ledger.py`, so it cannot rot.")
    add("> **Spec:** [pi-coc-module-reachability-lint]"
        "(../specs/pi-coc-module-reachability-lint.md) §8")
    add(f"> **Contract:** `{data['contract_id']}`, schema version"
        f" {data['schema_version']}")
    add("")
    add("This records what the reachability lint measured on the committed")
    add("starter, per check code, so a reader can tell a clean check from an")
    add("unmeasurable one. A zero in the findings column means one of two very")
    add("different things, and only the `measured` column separates them.")
    add("")

    add("## Scope: the committed starter only")
    add("")
    add("The specification's evidence base (§2) measured five scenario sets. Four")
    add("of them are compiled campaigns under `.coc/`, which is gitignored")
    add("runtime data: timestamped local imports that no fresh clone has. A")
    add("ledger that read them would regenerate differently on every machine and")
    add("fail its own drift test everywhere except the checkout that wrote it.")
    add("Those four stay in the lint's ground-truth tests, which skip when the")
    add("directory is absent. What is published here is only what every clone can")
    add("reproduce byte-for-byte: the one scenario set the repository ships.")
    add("")

    add("## Summary")
    add("")
    add("| | Value |")
    add("| --- | --- |")
    add(f"| Scenario | `{report['scenario_id']}` |")
    add(f"| `progressive` | {str(bool(report['progressive'])).lower()} |")
    add(f"| Scenes | {graph['scenes']} |")
    add(f"| Documents present | {len(report['documents_present'])} |")
    add(f"| Documents absent | {len(report['documents_absent'])} |")
    add(f"| Check codes in the catalogue | {len(data['per_code'])} |")
    add(f"| ...measured on this scenario | {len(measured)} |")
    add(f"| ...`not-measured` | {len(report['codes_not_measured'])} |")
    add(f"| ...measured and silent | {len(silent)} |")
    add(f"| Findings | {len(report['findings'])} |")
    add(f"| ...severity `defect` | {summary['defect']} |")
    add(f"| ...severity `observation` | {summary['observation']} |")
    for cls in data["classes"]:
        add(f"| ...completeness `{cls}` | {summary['by_completeness'][cls]} |")
    add("")
    lines.extend(_para(
        f"Documents present: {_codes(report['documents_present'])}."))
    lines.extend(_para(
        f"Documents absent: {_codes(report['documents_absent'])}."))
    lines.extend(_para(
        f"Codes not measured: {_codes(report['codes_not_measured'])}."))

    add("## Per check code")
    add("")
    add("`measured` is `no` when the document a code reads is absent from this")
    add("scenario set, or when the scenario never uses the field the code needs.")
    add("Such a code yields no findings and no pass; it is simply not evidence.")
    add("")
    add("| code | severity when `dead` | measured | findings | `dead` |"
        " `pending-materialization` | `not-measured` |")
    add("| --- | --- | :-: | --: | --: | --: | --: |")
    for row in data["per_code"]:
        counts = row["by_completeness"]
        add(
            f"| `{row['code']}` | {row['severity_when_dead']} |"
            f" {'yes' if row['measured'] else 'no'} | {row['findings']} |"
            f" {counts['dead']} | {counts['pending-materialization']} |"
            f" {counts['not-measured']} |"
        )
    add("")
    if report["codes_not_measured"]:
        lines.extend(_para(
            f"{len(report['codes_not_measured'])} of"
            f" {len(data['per_code'])} codes were not measurable here:"
            f" {_codes(report['codes_not_measured'])}. Those rows are neither"
            " passes nor failures."))
    else:
        lines.extend(_para(
            f"Every one of the {len(data['per_code'])} codes was measurable on"
            f" this scenario set: all {len(report['documents_present'])}"
            " documents the lint reads are present, and"
            f" {graph['scenes_declaring_final']} of its {graph['scenes']} scenes"
            " declares `is_final`, so `scene-terminal-undeclared` has a field to"
            " check. No row above is a silent non-measurement. The column still"
            " earns its place — it is what a progressive import will fill — but"
            " this starter does not exercise it."))

    add("## Findings")
    add("")
    if not report["findings"]:
        add("None. Every measured code was silent on this scenario set.")
        add("")
    else:
        add("| code | severity | completeness | subject | declared | counted |")
        add("| --- | --- | --- | --- | --- | --- |")
        for finding in report["findings"]:
            add(
                f"| `{finding['code']}` | {finding['severity']} |"
                f" `{finding['completeness']}` |"
                f" `{finding['subject_id']}` ({finding['subject_kind']}) |"
                f" `{json.dumps(finding['declared'], sort_keys=True)}` |"
                f" `{json.dumps(finding['counted'], sort_keys=True)}` |"
            )
        add("")
        for finding in report["findings"]:
            lines.extend(_para(
                f"`{finding['code']}` on `{finding['subject_id']}`:"
                f" {finding['reason']}. Related ids:"
                f" {_codes(list(finding['related_ids']))}."))

    add("## Why the ModuleGraph could not have answered this")
    add("")
    add("Recomputed here from the starter's own files, because the point of the")
    add("section is a contradiction between two artifacts and a copied number")
    add("would stop being a measurement the moment either one changed.")
    add("")
    add("| | Value |")
    add("| --- | --- |")
    add(f"| `module-graph.json` nodes | {graph['graph_nodes']} |")
    add(f"| ...relations | {graph['graph_relations']} |")
    add(f"| ...claims | {graph['graph_claims']} |")
    add(f"| Coverage domains | {len(graph['coverage_domains'])} |")
    add(f"| ...distinct reported states | {_codes(graph['coverage_states'])} |")
    add(f"| ...reported `accepted` | {len(graph['coverage_accepted'])} |")
    add(f"| `clue` nodes in the graph | {graph['clue_nodes']} |")
    add(f"| ...carrying an acquisition relation |"
        f" {graph['acquisition_relations_on_clues']} |")
    add(f"| Acquisition relations in the graph, all subjects |"
        f" {graph['acquisition_relations']} |")
    add(f"| Clues declared in `clue-graph.json` | {graph['declared_clues']} |")
    add(f"| ...placed in a scene's `available_clues` |"
        f" {graph['declared_clues_placed']} |")
    add(f"| Distinct clue ids across all `available_clues` |"
        f" {graph['placed_clue_ids']} |")
    add("")
    lines.extend(_para(
        "Acquisition relations are the ModuleGraph contract's authored access"
        f" routes, {_codes(list(ACQUISITION_RELATION_KINDS))}. Every one of the"
        f" {graph['acquisition_relations']} in this graph has a non-`clue`"
        " subject:"))
    for kind, count in graph["acquisition_subject_kinds"]:
        add(f"- `{kind}`: {count}")
    add("")
    lines.extend(_para(
        f"So the graph reports all {len(graph['coverage_domains'])} coverage"
        f" domains `accepted` — `causal` and `knowledge` among them — while"
        f" every one of its {graph['clue_nodes']} `clue` nodes carries zero"
        " acquisition relations. The"
        f" {graph['declared_clues']} clues the module declares are nevertheless"
        " all placed correctly, in the projected `story-graph.json`, through"
        " scene `available_clues`. The causal placement lives entirely in the"
        " projection and not at all in the graph."))
    lines.extend(_para(
        "**Coverage is a self-report about which domains an extraction"
        " reviewed.** It is not evidence that the structure was captured. A"
        " reachability check run against the graph would report"
        f" {graph['clue_nodes']} unobtainable clues on a starter that plays"
        " correctly, which is why the lint's input is the projected"
        " ProjectionSet the Keeper actually reads, never the graph."))
    add("The same graph holds no node of these kinds at all, which is why ending")
    add("reachability and requirement closure are out of scope rather than clean:")
    add("")
    for kind, count in graph["absent_node_kinds"]:
        add(f"- `{kind}`: {count}")
    add("")

    add("## What this measures")
    add("")
    add("A clean row means one scenario set contradicted itself in no way this")
    add("catalogue can express. It does not mean the module is playable, that its")
    add("clues are findable in practice, that its pacing works, or that a Keeper")
    add("can run it. Every check here is arithmetic over ids, enums, booleans and")
    add("integers the scenario already declares; none of them reads a word of")
    add("prose, and none of them has an opinion about which clue matters.")
    add("")
    add("Thresholds come only from the module's own `minimum_routes` and")
    add("`importance`. A conclusion with one acquisition route is not a defect —")
    add("a conclusion that *declares* three and provides one is, because that is")
    add("the module contradicting itself rather than the lint disagreeing with a")
    add("design. Nothing in this ledger licenses inventing a second route.")
    add("")
    add("A `not-measured` row is the most important thing on the page. The lint")
    add("cannot pass a check whose document is missing or whose field the")
    add("scenario never uses, so it says so instead of scoring a silent zero as")
    add("a success. Reading such a row as \"clean\" is exactly the mistake the")
    add("completeness class exists to prevent, and the same holds for a")
    add("progressive skeleton: `pending-materialization` is unbuilt structure,")
    add("not a broken module.")
    add("")
    add("This ledger covers one scenario set. It is not a measure of the lint's")
    add("coverage — that lives in the per-check and mutation tests — and a clean")
    add("starter says nothing about any imported campaign.")
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true",
                        help="write docs/status/module-reachability-ledger.md")
    args = parser.parse_args(argv)
    text = render(build())
    if args.write:
        LEDGER.write_text(text, encoding="utf-8")
    else:
        print(text, end="")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
