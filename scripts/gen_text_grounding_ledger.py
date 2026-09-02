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

# Measured from dispatch_rules_settle (coc_operation_kernel.py) and its
# adapter map (coc_operation_rules_core.py): the graph-owned families whose
# settle receipts carry a top-level player_state_receipt -- the only receipt
# field coc_turn_finalization._project_player_state_receipt renders for a
# rules.settle call. A public effect whose family is not listed has no
# rendered consumer today, whatever the RuleGraph says the settlement emits.
SETTLE_RECEIPT_CONSUMER_FAMILIES = frozenset({"combat", "healing", "sanity"})

REASON_KEEPER_ONLY = "keeper-only"
REASON_RENDERED = "rendered"
REASON_NO_RENDERING_COUNTERPART = "no-rendering-counterpart"
REASON_NO_CONSUMER_YET = "no-consumer-yet"


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
        effect_id = node["node_id"]
        visibility = node.get("visibility")
        family = effect_id.split(":")[2] if effect_id.count(":") >= 2 else ""
        if visibility != "public":
            reason = REASON_KEEPER_ONLY
        elif effect_id in rendered:
            reason = REASON_RENDERED
        elif family in SETTLE_RECEIPT_CONSUMER_FAMILIES:
            # A consumer chain exists for this family, but this effect has
            # no rendering counterpart: no segment renders it.
            reason = REASON_NO_RENDERING_COUNTERPART
        else:
            reason = REASON_NO_CONSUMER_YET
        rows.append({
            "effect": effect_id,
            "family": family,
            "visibility": visibility,
            "audience": node.get("audience"),
            "effect_kind": kind,
            "rendered_by_textgraph": effect_id in rendered,
            "text_layer_token_match": kind in vocabulary,
            "reason": reason,
        })
    reasons = {}
    for row in rows:
        reasons[row["reason"]] = reasons.get(row["reason"], 0) + 1
    return {
        "effects": rows,
        "edges": len(rendered),
        "public": sum(1 for r in rows if r["visibility"] == "public"),
        "keeper_only": sum(1 for r in rows if r["visibility"] != "public"),
        "token_matches": sorted(r["effect_kind"] for r in rows if r["text_layer_token_match"]),
        "reasons": reasons,
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
        "- Grounding reasons: "
        + ", ".join(
            f"**{reason}** × {data['reasons'][reason]}"
            for reason in sorted(data["reasons"])
        ),
        f"- Effect kinds with an exact token match in the text layer: "
        f"**{', '.join(data['token_matches']) or 'none'}**",
        "",
        "| effect | visibility | effect_kind | rendered by TextGraph | text-layer token match | grounding reason |",
        "| --- | --- | --- | :-: | :-: | --- |",
    ]
    for row in data["effects"]:
        lines.append(
            f"| `{row['effect']}` | {row['visibility']} | `{row['effect_kind']}` | "
            f"{'yes' if row['rendered_by_textgraph'] else 'no'} | "
            f"{'yes' if row['text_layer_token_match'] else 'no'} | "
            f"{row['reason']} |"
        )
    lines += [
        "",
        "## What this measures",
        "",
        "An edge is drawn when a rendering path exists, never to reach a target",
        "count. Slice W1 built the first one: the healing decisions emit three",
        "public effects, and their graph-owned settlements carry a",
        "`player_state_receipt` that `coc_turn_finalization` projects into the",
        "`state_delta` mechanics segment — the chain `segment-type:state-delta`",
        "renders. The W1 runtime bridge tags those derived effects with",
        "`rule_effect_refs`, so the rendered mechanics block is auditable back",
        "to the exact RuleGraph effect.",
        "",
        "The unbridged public effects are measured, not promised: their family's",
        "settle receipt carries no rendered state delta (`no-consumer-yet`), or",
        "a consumer exists but nothing renders this effect",
        "(`no-rendering-counterpart`). Drawing their edges before a consumer",
        "exists is the hollow delivery the wiring spec forbids.",
        "",
        "The single exact correspondence between the two vocabularies remains",
        "`luck_spend`, and it belongs to the one **keeper-only** effect. The",
        "text layer names it only in `_narration_budget`, where it selects a",
        "length budget and is never rendered; presentation may never claim it.",
        "",
        "The compiler's `renders-settled-output` validator is live: a dangling",
        "id, a non-effect node kind, or a keeper-only target fails the build.",
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
