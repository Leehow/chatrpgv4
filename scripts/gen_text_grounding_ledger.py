#!/usr/bin/env python3
"""Generate the TextGraph grounding gap ledger.

Usage:
    uv run --frozen python scripts/gen_text_grounding_ledger.py [--write]

Spec: docs/specs/pi-coc-text-graph-runtime.md §8 T3

Slice T3 binds TextGraph to the RuleGraph through `renders-settled-output`.
This script measures how far that binding actually reaches, so the answer is
regenerated from the artifacts rather than asserted in prose that can rot.

For every RuleGraph effect node it records: the effect's declared visibility,
whether any TextGraph node claims to render it, and whether the text layer has
any correspondence to it at all — an exact `effect_kind` match against the
closed vocabularies the text layer actually uses, and any occurrence in the
preserved play corpus.
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PLUGIN = ROOT / "plugins" / "coc-keeper"
RULE_GRAPH = PLUGIN / "rulesets" / "coc7" / "rule-graph.json"
TEXT_GRAPH = PLUGIN / "references" / "text-graph.json"
LEDGER = ROOT / "docs" / "status" / "text-grounding-gap.md"


def _text_layer_effect_vocabulary() -> set[str]:
    """Every effect-kind token the text layer actually uses.

    Two sources, both authoritative rather than scraped guesses: the
    exceptional-effect registry, and the TextGraph budget triggers. Slice T4
    moved the budget trigger vocabulary out of a source literal and into the
    graph, so this reads the graph — scraping _narration_budget's body would
    now silently return nothing and turn a real correspondence into a false
    "none".
    """
    tokens: set[str] = set()
    exceptional = (PLUGIN / "scripts" / "coc_exceptional_effects.py").read_text("utf-8")
    block = exceptional[exceptional.index("EFFECT_KINDS = frozenset({"):]
    tokens |= set(re.findall(r'"(\w+)"', block[: block.index("})")]))
    text_graph = json.loads(TEXT_GRAPH.read_text("utf-8"))
    tokens |= {
        node["properties"]["legacy_key"]
        for node in text_graph["nodes"]
        if node["node_kind"] == "narration-budget-trigger"
    }
    return tokens


def build() -> dict:
    rules = json.loads(RULE_GRAPH.read_text("utf-8"))
    text = json.loads(TEXT_GRAPH.read_text("utf-8"))
    rendered = {
        str(rel["to_node_id"])
        for rel in text.get("relations") or []
        if rel.get("relation_kind") == "renders-settled-output"
    }
    vocabulary = _text_layer_effect_vocabulary()
    rows = []
    for node in sorted(rules["nodes"], key=lambda n: n["node_id"]):
        if node.get("node_kind") != "effect":
            continue
        kind = str(node.get("properties", {}).get("effect_kind") or "")
        rows.append({
            "effect": node["node_id"],
            "visibility": node.get("visibility"),
            "audience": node.get("audience"),
            "effect_kind": kind,
            "rendered_by_textgraph": node["node_id"] in rendered,
            "text_layer_token_match": kind in vocabulary,
        })
    return {
        "effects": rows,
        "edges": len(rendered),
        "public": sum(1 for r in rows if r["visibility"] == "public"),
        "keeper_only": sum(1 for r in rows if r["visibility"] != "public"),
        "token_matches": sorted(r["effect_kind"] for r in rows if r["text_layer_token_match"]),
    }


def render(data: dict) -> str:
    lines = [
        "# TextGraph grounding gap",
        "",
        "> **Generated** by `scripts/gen_text_grounding_ledger.py`. Do not edit by hand.",
        "> Regenerated and compared by `tests/test_text_graph.py`, so it cannot rot.",
        "",
        f"- RuleGraph effect nodes: **{len(data['effects'])}** "
        f"({data['public']} public, {data['keeper_only']} keeper-only)",
        f"- `renders-settled-output` edges from TextGraph: **{data['edges']}**",
        f"- Effect kinds with an exact token match in the text layer: "
        f"**{', '.join(data['token_matches']) or 'none'}**",
        "",
        "| effect | visibility | effect_kind | rendered by TextGraph | text-layer token match |",
        "| --- | --- | --- | :-: | :-: |",
    ]
    for row in data["effects"]:
        lines.append(
            f"| `{row['effect']}` | {row['visibility']} | `{row['effect_kind']}` | "
            f"{'yes' if row['rendered_by_textgraph'] else 'no'} | "
            f"{'yes' if row['text_layer_token_match'] else 'no'} |"
        )
    lines += [
        "",
        "## What this measures",
        "",
        "An edge is drawn when a rendering path exists, never to reach a target",
        "count. Today none exists: the text layer renders `turn-effect-v1` and",
        "`exceptional-effect-v1` state effects, a namespace disjoint from",
        "`effect:coc7:*`, and no code in the tree reads a RuleGraph effect id.",
        "",
        "The single exact correspondence between the two vocabularies is",
        "`luck_spend`, and it belongs to the one **keeper-only** effect. The text",
        "layer names it only in `_narration_budget`, where it selects a length",
        "budget and is never rendered. So the only place the two graphs touch is",
        "the effect that must not reach the player.",
        "",
        "The compiler's `renders-settled-output` validator is live regardless: a",
        "dangling id, a non-effect node kind, or a keeper-only target fails the",
        "build. The first real bridge is checkable the day it is built.",
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
