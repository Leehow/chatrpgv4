#!/usr/bin/env python3
"""Deterministic sensitivity sweep over Director doctrine values (slice D5 prep).

Slice D5 retires `unknown-legacy-tuning` values one recorded experiment at a
time. Before spending a live play experiment on a value, it is worth knowing
whether the value changes any Director decision at all.

This sweep perturbs each doctrine value in turn, recomputes the D4 decision
matrix, and counts how many of its rows change. It splits the ledger into:

  - **inert in the tested matrix** — perturbing the value changes no decision.
    That is a real, falsifiable, model-free result: within this matrix the
    value cannot be shown to matter.
  - **decision-changing** — the value moves real decisions, so settling it
    needs a play experiment, not arithmetic.

Honest limits, stated because they matter:
  - "inert" means inert *in this matrix on this checkpoint*, not globally. A
    wider matrix or another campaign can move a value out of that bucket.
  - a decision change is not a quality judgement. This sweep never claims one
    value is better than another; it only says which values are worth an
    experiment.
"""
from __future__ import annotations

import argparse
import importlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
GRAPH = ROOT / "plugins" / "coc-keeper" / "references" / "director-graph.json"
OUT = ROOT / "checks" / "director-sensitivity-sweep.json"

sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(SCRIPTS))


def _access_key(node: dict) -> str:
    """The key the runtime records when this node's value is read."""
    kind = node["node_kind"]
    props = node["properties"]
    if kind == "scoring-rule":
        action = props["action_ref"].split(":", 1)[1]
        return f"{action.upper().replace('-', '_')}:{props['condition_id']}"
    if kind == "threshold":
        return props["threshold_id"]
    if kind == "multiplier":
        return f"{props['scope']}:{props['condition_id']}"
    if kind == "structure-weight":
        return "*"
    return props.get("ladder_id", "")


def _perturb(value):
    """Return a nearby but clearly different value of the same shape."""
    if isinstance(value, bool):
        return not value
    if isinstance(value, int):
        return value + 1
    if isinstance(value, float):
        return round(value + 0.2, 6) if value <= 0.7 else round(value - 0.2, 6)
    if isinstance(value, list) and value and all(
        isinstance(v, (int, float)) and not isinstance(v, bool) for v in value
    ):
        return [_perturb(v) for v in value]
    return None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("campaign_id")
    args = parser.parse_args(argv)

    baseline_mod = importlib.import_module("gen_director_decision_baseline")
    original_text = GRAPH.read_text(encoding="utf-8")
    graph = json.loads(original_text)

    # Record which doctrine values the probe actually reads. Without this,
    # a value the matrix never reaches is indistinguishable from one that
    # provably does not matter, and reporting the first as "inert" would read
    # as evidence it can be ignored.
    runtime = importlib.import_module("coc_director_runtime")
    runtime.start_access_recording()
    reference = baseline_mod.build(args.campaign_id)
    accessed = runtime.stop_access_recording()
    accessed_keys = {key for _kind, key in accessed}
    reference_rows = reference["rows"]

    # A structure weight for a structure type this checkpoint is not cannot
    # move a decision here, and calling that "inert" would be misleading: it
    # is a matrix coverage gap, not a fact about the value. Classify those
    # separately.
    meta_path = (
        ROOT / ".coc" / "campaigns" / args.campaign_id
        / "scenario" / "module-meta.json"
    )
    structure_type = json.loads(meta_path.read_text(encoding="utf-8")).get(
        "structure_type"
    )
    exercised_structure = str(structure_type or "").replace("_", "-")

    doctrine = [
        node for node in graph["nodes"]
        if node.get("plane") == "doctrine" and "value" in (node.get("properties") or {})
    ]

    results = []
    try:
        for index, node in enumerate(doctrine):
            node_id = node["node_id"]
            original = node["properties"]["value"]
            perturbed = _perturb(original)
            if (
                node_id.startswith("structure-weight:")
                and node_id.split(":")[1] != exercised_structure
            ):
                results.append({
                    "node_id": node_id, "value": original,
                    "verdict": "not-exercised",
                    "changed_rows": None,
                    "reason": (
                        f"structure weight for {node_id.split(':')[1]!r}; this "
                        f"checkpoint is {exercised_structure!r}"
                    ),
                })
                continue
            if _access_key(node) not in accessed_keys:
                results.append({
                    "node_id": node_id, "value": original,
                    "verdict": "not-exercised",
                    "changed_rows": None,
                    "reason": (
                        "the decision probe never reads this value; it belongs "
                        "to a layer the matrix does not exercise"
                    ),
                })
                continue
            if perturbed is None or perturbed == original:
                results.append({
                    "node_id": node_id, "value": original,
                    "verdict": "not-perturbable",
                    "changed_rows": None,
                })
                continue
            mutated = json.loads(original_text)
            target = next(
                row for row in mutated["nodes"] if row["node_id"] == node_id
            )
            target["properties"]["value"] = perturbed
            GRAPH.write_text(
                json.dumps(mutated, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            for name in list(sys.modules):
                if name.startswith(("coc_story_director", "coc_director_runtime")):
                    del sys.modules[name]
            trial = baseline_mod.build(args.campaign_id)
            changed = sum(
                1 for a, b in zip(reference_rows, trial["rows"])
                if a["selected_action"] != b["selected_action"]
            )
            results.append({
                "node_id": node_id,
                "value": original,
                "perturbed_to": perturbed,
                "verdict": "inert-in-matrix" if changed == 0 else "decision-changing",
                "changed_rows": changed,
            })
            print(
                f"  [{index + 1}/{len(doctrine)}] {node_id}: {changed} rows",
                file=sys.stderr,
            )
    finally:
        GRAPH.write_text(original_text, encoding="utf-8")

    inert = [r for r in results if r["verdict"] == "inert-in-matrix"]
    changing = [r for r in results if r["verdict"] == "decision-changing"]
    unexercised = [r for r in results if r["verdict"] == "not-exercised"]
    payload = {
        "schema_version": 1,
        "kind": "director-sensitivity-sweep",
        "campaign_id": args.campaign_id,
        "checkpoint_structure_type": structure_type,
        "matrix_rows": len(reference_rows),
        "scope": (
            "Perturbation sensitivity of Director doctrine values over the D4 "
            "decision matrix. 'inert-in-matrix' means inert in THIS matrix on "
            "THIS checkpoint, not globally. A decision change is not a quality "
            "judgement."
        ),
        "counts": {
            "tested": len(results),
            "inert_in_matrix": len(inert),
            "decision_changing": len(changing),
            "not_exercised": len(unexercised),
            "not_perturbable": (
                len(results) - len(inert) - len(changing) - len(unexercised)
            ),
        },
        "results": sorted(results, key=lambda r: r["node_id"]),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"ok": True, **payload["counts"], "out": str(OUT.relative_to(ROOT))}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
