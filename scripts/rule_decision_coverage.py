#!/usr/bin/env python3
"""Which rule-layer decisions has a live Keeper actually settled?

Reads the diagnostic corpus produced by `pi_coc_debug_experiment.py` and
splits the RuleGraph's decision nodes three ways:

  settled   a `rules.settle` returned ok with `status: settled` for it
  refused   a lane asked for it and the rule layer said no, with which codes
  never     no lane ever asked for it at all

The three mean different things and want different work. `refused` is the
rule layer or its seeding; `never` is the Keeper not choosing the decision,
which no amount of rule-layer work fixes.

Only a settle receipt counts as evidence. Matching decision ids against the
whole log reports 43/43 and means nothing: `rules.context` hands the Keeper
the entire card catalogue, so every id appears in every lane's log whether or
not anything was settled.

Usage:
    uv run --frozen python scripts/rule_decision_coverage.py <runs-dir> [--json]

<runs-dir> is the debug store root, e.g.
    ~/Documents/TRPG/<campaign>/.coc/debug/runs
"""
from __future__ import annotations

import argparse
import collections
import json
from pathlib import Path
import sys

REPO = Path(__file__).resolve().parents[1]
GRAPH = REPO / "plugins" / "coc-keeper" / "rulesets" / "coc7" / "rule-graph.json"


def decision_nodes(graph_path: Path) -> list[str]:
    graph = json.loads(graph_path.read_text(encoding="utf-8"))
    return sorted(
        node["node_id"]
        for node in graph["nodes"]
        if node.get("node_kind") == "decision"
    )


def _settle_rows(path: Path):
    """(decision_ref requested, settled decision_ref or None, failure code)."""
    pending: dict[str, str | None] = {}
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if row.get("operation") != "rules.settle":
            continue
        event = row.get("event") or {}
        call = event.get("toolCallId")
        if row.get("phase") == "start":
            pending[call] = (event.get("args") or {}).get("decision_ref")
            continue
        requested = pending.pop(call, None)
        details = (event.get("result") or {}).get("details") or {}
        data = details.get("data") or {}
        if details.get("ok") and data.get("status") == "settled":
            yield requested, data.get("decision_ref") or requested, None
        elif requested:
            code = (details.get("error") or {}).get("code") or "unknown"
            yield requested, None, code


def measure(runs_dir: Path, decisions: list[str]) -> dict:
    settled: dict[str, set[str]] = collections.defaultdict(set)
    refused: dict[str, collections.Counter] = collections.defaultdict(
        collections.Counter
    )
    lanes = 0
    for path in sorted(runs_dir.glob("*/lanes/*/rules.jsonl")):
        lanes += 1
        lane = f"{path.parents[2].name.split('-')[-1]}/{path.parent.name}"
        for _requested, ref, code in _settle_rows(path):
            if ref is not None:
                settled[ref].add(lane)
            elif _requested:
                refused[_requested][code] += 1

    rows = []
    for decision in decisions:
        if settled[decision]:
            rows.append({
                "decision": decision,
                "state": "settled",
                "lanes": sorted(settled[decision]),
            })
        elif refused[decision]:
            rows.append({
                "decision": decision,
                "state": "refused",
                "codes": dict(refused[decision].most_common()),
            })
        else:
            rows.append({"decision": decision, "state": "never"})
    return {"lanes_read": lanes, "decisions": rows}


def render(report: dict) -> str:
    rows = report["decisions"]
    by_state = collections.Counter(row["state"] for row in rows)
    out = [
        f"{len(rows)} decisions over {report['lanes_read']} lanes: "
        f"{by_state['settled']} settled, {by_state['refused']} refused, "
        f"{by_state['never']} never asked for",
        "",
    ]
    for state, note in (
        ("settled", "a live Keeper drove these to a settle receipt"),
        ("refused", "asked for, and the rule layer said no"),
        ("never", "no lane ever asked -- not a rule-layer problem"),
    ):
        group = [row for row in rows if row["state"] == state]
        out.append(f"=== {state} ({len(group)})  {note}")
        for row in group:
            label = row["decision"].split("coc7:", 1)[-1]
            if state == "settled":
                detail = f"{len(row['lanes'])} lanes"
            elif state == "refused":
                detail = ", ".join(
                    f"{code}x{count}"
                    for code, count in list(row["codes"].items())[:3]
                )
            else:
                detail = ""
            out.append(f"    {label:<40} {detail}")
        out.append("")
    return "\n".join(out)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("runs_dir", type=Path)
    parser.add_argument("--graph", type=Path, default=GRAPH)
    parser.add_argument("--json", action="store_true")
    opts = parser.parse_args(argv)
    if not opts.runs_dir.is_dir():
        print(f"no such runs directory: {opts.runs_dir}", file=sys.stderr)
        return 2
    report = measure(opts.runs_dir, decision_nodes(opts.graph))
    print(json.dumps(report, ensure_ascii=False, indent=2) if opts.json
          else render(report))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
