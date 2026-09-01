#!/usr/bin/env python3
"""Generate docs/status/director-doctrine-ledger.md from the built DirectorGraph.

The ledger is slice D2's headline deliverable: a published record of which
Director tunables can state a reason and which cannot. It is generated, never
hand-edited, so it cannot drift from the artifact.
"""
from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GRAPH = ROOT / "plugins" / "coc-keeper" / "references" / "director-graph.json"
OUT = ROOT / "docs" / "status" / "director-doctrine-ledger.md"
SWEEP = ROOT / "checks" / "director-sensitivity-sweep.json"

UNKNOWN = "unknown-legacy-tuning"
DOCTRINE_KINDS = (
    "scoring-rule", "structure-weight", "tiebreak-order",
    "threshold", "affinity-ladder", "craft-directive",
)


def _value(node: dict) -> str:
    props = node["properties"]
    if "order" in props:
        return " > ".join(props["order"])
    if "rungs" in props:
        return " > ".join(f"{r['kind']}({r['rank']})" for r in props["rungs"])
    value = props.get("value")
    if isinstance(value, list):
        return json.dumps(value)
    comparison = props.get("comparison")
    return f"{comparison} {value}" if comparison else str(value)


def _sweep_verdicts() -> dict[str, dict]:
    if not SWEEP.is_file():
        return {}
    payload = json.loads(SWEEP.read_text(encoding="utf-8"))
    return {row["node_id"]: row for row in payload["results"]}


def main() -> int:
    graph = json.loads(GRAPH.read_text(encoding="utf-8"))
    sweep = _sweep_verdicts()
    doctrine = [n for n in graph["nodes"] if n["node_kind"] in DOCTRINE_KINDS]
    doctrine.sort(key=lambda n: (n["node_kind"], n["node_id"]))

    classes = Counter(n["evidence_class"] for n in doctrine)
    unknown = [n for n in doctrine if n.get("origin") == UNKNOWN]
    value_count = 0
    for node in doctrine:
        props = node["properties"]
        if "order" in props:
            value_count += len(props["order"])
        elif "rungs" in props:
            value_count += len(props["rungs"])
        elif isinstance(props.get("value"), list):
            value_count += len(props["value"])
        elif "value" in props:
            value_count += 1

    lines: list[str] = []
    add = lines.append
    add("# Director doctrine ledger")
    add("")
    add("> **Generated** by `scripts/gen_director_doctrine_ledger.py` from")
    add("> `plugins/coc-keeper/references/director-graph.json`. Do not hand-edit.")
    add("> **Spec:** [pi-coc-director-graph-runtime](../specs/pi-coc-director-graph-runtime.md)")
    add("> **Inventory:** [director-doctrine-inventory](director-doctrine-inventory.md)")
    add("")
    add("This is slice D2's headline deliverable. It does not explain the")
    add("Director's numbers — it records, per value, whether anyone can.")
    add("")
    add("## Summary")
    add("")
    add("| | Count |")
    add("| --- | --- |")
    add(f"| Doctrine nodes | {len(doctrine)} |")
    add(f"| Individual tunable values | {value_count} |")
    for name, count in sorted(classes.items()):
        add(f"| `{name}` | {count} |")
    add(f"| ...of which `origin: {UNKNOWN}` | {len(unknown)} |")
    add("")
    if sweep:
        payload = json.loads(SWEEP.read_text(encoding="utf-8"))
        counts = payload["counts"]
        add("### Sensitivity triage")
        add("")
        add(f"Deterministic sweep over the D4 decision matrix "
            f"(`{payload['campaign_id']}`, structure type "
            f"`{payload['checkpoint_structure_type']}`, "
            f"{payload['matrix_rows']} rows):")
        add("")
        add("| Verdict | Count | Meaning |")
        add("| --- | --- | --- |")
        add(f"| `decision-changing` | {counts['decision_changing']} | perturbing "
            "the value moves real decisions; settling it needs a play experiment |")
        add(f"| `inert-in-matrix` | {counts['inert_in_matrix']} | exercised by this "
            "checkpoint, but perturbing it changed no decision |")
        add(f"| `not-exercised` | {counts['not_exercised']} | the probe never "
            "reads it — another structure type, or a layer (storylet "
            "scheduling, time advance, affordance budget) this matrix does "
            "not exercise; the sweep says nothing about it |")
        add("")
        add("`inert-in-matrix` is a statement about this matrix on this")
        add("checkpoint, never a claim that a value is globally irrelevant. A")
        add("decision change is not a quality judgement either — the sweep only")
        add("says which values are worth spending an experiment on.")
        add("")
    pct = 100.0 * len(unknown) / len(doctrine) if doctrine else 0.0
    add(
        f"**{len(unknown)} of {len(doctrine)} doctrine nodes ({pct:.0f}%) cannot "
        "name their origin.** Each carries a `falsifiable_by` describing the "
        "DebugExperiment that could settle it. Retiring them one recorded "
        "experiment at a time is slice D5."
    )
    add("")

    add("## Values that can cite a source")
    add("")
    add("| Node | Value | Origin |")
    add("| --- | --- | --- |")
    for node in doctrine:
        if node["evidence_class"] == "authored-doctrine":
            continue
        add(f"| `{node['node_id']}` | `{_value(node)}` | {node['origin']} |")
    add("")

    add("## Values with no known origin")
    add("")
    add("Ordered by node kind. `falsifiable_by` is the experiment that would")
    add("settle the value; it is the entry point for slice D5.")
    add("")
    for kind in DOCTRINE_KINDS:
        rows = [n for n in unknown if n["node_kind"] == kind]
        if not rows:
            continue
        add(f"### `{kind}` ({len(rows)})")
        add("")
        add("| Node | Value | Sensitivity | Falsifiable by |")
        add("| --- | --- | --- | --- |")
        for node in rows:
            falsifiable = node["falsifiable_by"].replace("|", "\\|")
            verdict = (sweep.get(node["node_id"]) or {}).get("verdict", "-")
            changed = (sweep.get(node["node_id"]) or {}).get("changed_rows")
            cell = verdict if changed is None else f"{verdict} ({changed})"
            add(f"| `{node['node_id']}` | `{_value(node)}` | {cell} | {falsifiable} |")
        add("")

    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps({
        "ok": True,
        "doctrine_nodes": len(doctrine),
        "tunable_values": value_count,
        "unknown_legacy_tuning": len(unknown),
        "out": str(OUT.relative_to(ROOT)),
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
