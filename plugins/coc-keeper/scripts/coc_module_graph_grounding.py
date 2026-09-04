#!/usr/bin/env python3
"""Gate two: is a shard's content actually on the pages it cites?

The contract gate (`coc_module_graph.validate_shard`) checks that every
`evidence_span_ids` entry exists in the evidence catalog. It does not check
that the cited span says anything about the node or claim citing it. A shard
whose scenes are connected, whose clues are placed, whose timeline is
self-consistent and whose NPCs the book has never heard of passes it clean.

That gap is load-bearing, because the extractor is a self-review loop: findings
go back to the model and it tries again. With only a structure gate the loop
does not converge on fidelity, it converges on *pleasing the structure gate* --
structurally tidy fabrication. This repository has paid for that lesson twice
already (`validator-checks-accounting-not-content`,
`coverage-is-self-report-not-structure`).

What this gate can and cannot do
--------------------------------
It is lexical, not semantic. It answers one question per check, and it answers
it by string containment against the cited pages:

  name-not-on-cited-pages
      A node whose kind names something the *source* names -- an NPC, a
      creature, a faction, a place, an object -- declares `name` and possibly
      `aliases`. At least one of those declared strings must occur in the text
      of the spans that node cites. Note this classifies nothing: the shard
      states its own names, so no list of "what counts as a proper noun" is
      needed or wanted -- that judgement is exactly the open semantic problem
      this repository forbids hardcoding.

      It applies only to `SOURCE_NAMED_KINDS` below, because a clue, a
      conclusion, a rule or a secret is named by whoever built the graph: no
      module prints the line "clue: the wasted carcasses". Holding an
      analytic label to verbatim page containment reports 22 findings on a
      faithful shard and teaches the extraction loop to name things badly.
      Scenes sit outside it too -- a book's heading is "白日" and a graph may
      reasonably title that scene "白日的城市".

  number-not-on-cited-pages
      Every numeric literal in a node's summary/properties, or a claim's
      reason, must occur in that node or claim's own cited spans. Single digits
      included: the rules live in the single digits (a 1D3 that should be 1D6,
      a 15% that should be 50%).

It cannot tell a true statement from a false one that reuses the page's own
words, and it does not try. It makes one specific silence impossible: content
attached to pages that do not mention it.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path
from typing import Any, Iterable

# Dice and percentages carry their digits inside a token; splitting on
# non-digits first and comparing digit runs keeps "1D6", "POWx5" and "15%"
# comparable across the paraphrase in a summary and the page's own wording.
_DIGIT_RUN = re.compile(r"\d+")

# Node kinds whose `name` is a claim about the source: the book prints these
# names, so a name absent from every page the node cites is either a
# fabrication or a miscitation. The complement -- clue, conclusion, rule,
# secret, threat, clock, outcome, scene... -- carries labels the graph's author
# assigns, which no page is obliged to contain. This is a structural statement
# about the contract's own vocabulary, not a classifier over natural language;
# every entry is one line, visible, and arguable in review.
SOURCE_NAMED_KINDS = frozenset({
    "npc",
    "creature",
    "faction",
    "organization",
    "location",
    "object",
    "artifact",
    "tome",
    "spell",
    "vehicle",
    "handout",
    "investigator-template",
})


def _normalize(text: str) -> str:
    """Fold width and drop whitespace so a paraphrase still matches the page.

    Source pages arrive from OCR with the book's own line wrapping; a summary
    written from them will not reproduce that wrapping. Comparing on a
    whitespace-free, width-folded form is what makes "4-6 小时" match the
    page's "4-6小时" without loosening anything that matters.
    """
    folded = unicodedata.normalize("NFKC", text)
    return "".join(folded.split()).casefold()


def _cited_text(span_ids: Iterable[Any], catalog: dict[str, str]) -> str:
    return _normalize(
        "\n".join(catalog.get(str(sid), "") for sid in span_ids or [])
    )


def _numbers(value: Any) -> list[str]:
    """Every digit run reachable inside a value, in document order."""
    out: list[str] = []
    if isinstance(value, str):
        out.extend(_DIGIT_RUN.findall(unicodedata.normalize("NFKC", value)))
    elif isinstance(value, bool):
        pass  # a bool is not a measurement
    elif isinstance(value, (int, float)):
        out.extend(_DIGIT_RUN.findall(str(value)))
    elif isinstance(value, dict):
        for key, item in value.items():
            out.extend(_DIGIT_RUN.findall(unicodedata.normalize("NFKC", str(key))))
            out.extend(_numbers(item))
    elif isinstance(value, list):
        for item in value:
            out.extend(_numbers(item))
    return out


# A section whose spans nobody cited was, as far as any downstream consumer can
# tell, never read. Measured across the sections this repository has extracted
# by hand: 40% of spans cited (cursed-be-the-city), 44% (blood-highway's event
# timeline), 9% (Masks' Chelsea sidetrack -- thin, and visibly so). The floor
# below is deliberately far under all of them: it is not a quality bar, it is
# the line under which a reply is not an extraction at all.
DEFAULT_MIN_SPAN_CONSUMPTION = 0.05


def _finding(code: str, path: str, message: str, **extra: Any) -> dict[str, Any]:
    return {"code": code, "path": path, "message": message, **extra}


def build_catalog(evidence_packet: Any) -> dict[str, str]:
    """span_id -> the exact page text that span carries."""
    spans = evidence_packet.get("spans") if isinstance(evidence_packet, dict) else None
    catalog: dict[str, str] = {}
    for span in spans or []:
        if isinstance(span, dict) and span.get("span_id"):
            catalog[str(span["span_id"])] = str(span.get("text") or "")
    return catalog


def check_grounding(shard: Any, catalog: dict[str, str]) -> list[dict[str, Any]]:
    """Return one finding per piece of content its own citations do not carry."""
    if not isinstance(shard, dict):
        return [_finding("invalid_shard", "/", "GraphShard must be an object")]

    findings: list[dict[str, Any]] = []

    for index, node in enumerate(shard.get("nodes") or []):
        if not isinstance(node, dict):
            continue
        path = f"/nodes/{index}"
        node_id = str(node.get("node_id") or "")
        cited = _cited_text(node.get("evidence_span_ids"), catalog)

        declared = [node.get("name"), *(node.get("aliases") or [])]
        names = [_normalize(str(n)) for n in declared if str(n or "").strip()]
        kind = str(node.get("node_kind") or "")
        if kind in SOURCE_NAMED_KINDS and names and not any(n in cited for n in names):
            findings.append(_finding(
                "name-not-on-cited-pages", f"{path}/name",
                "no declared name or alias occurs in the spans this node cites",
                node_id=node_id, declared=[str(n) for n in declared if n],
            ))

        wanted = _numbers(node.get("summary")) + _numbers(node.get("properties"))
        missing = sorted({n for n in wanted if n not in cited})
        if missing:
            findings.append(_finding(
                "number-not-on-cited-pages", f"{path}/properties",
                "numbers appear here that the spans this node cites do not carry",
                node_id=node_id, numbers=missing,
            ))

    for index, claim in enumerate(shard.get("claims") or []):
        if not isinstance(claim, dict):
            continue
        path = f"/claims/{index}"
        cited = _cited_text(claim.get("evidence_span_ids"), catalog)
        missing = sorted({n for n in _numbers(claim.get("reason")) if n not in cited})
        if missing:
            findings.append(_finding(
                "number-not-on-cited-pages", f"{path}/reason",
                "numbers appear in this claim's reason that its own spans do not carry",
                claim_id=str(claim.get("claim_id") or ""), numbers=missing,
            ))

    return findings


def check_coverage(
    shard: Any,
    catalog: dict[str, str],
    *,
    floor: float = DEFAULT_MIN_SPAN_CONSUMPTION,
) -> list[dict[str, Any]]:
    """Did this reply read the section, or three paragraphs of it?

    The two gates above answer "is what you wrote on the pages you cite" and
    cannot answer "did you look at the rest". A reply carrying three nodes for
    a hundred-thousand-character section passes both of them cleanly, because
    those three nodes really are grounded. `coverage` does not help: the shard
    declares its own coverage, and a declaration is not a measurement -- this
    repository has been caught by exactly that before.

    This counts. It cannot tell a thorough extraction from a shallow one, and
    it does not try; it makes one specific silence impossible, which is a
    section that was never opened.
    """
    if not isinstance(shard, dict) or not catalog:
        return []
    cited: set[str] = set()
    for collection in ("nodes", "claims"):
        for row in shard.get(collection) or []:
            if isinstance(row, dict):
                cited.update(str(s) for s in row.get("evidence_span_ids") or [])
    available = set(catalog)
    used = cited & available
    ratio = len(used) / len(available)
    if ratio >= floor:
        return []
    unread = sorted(available - used)
    return [_finding(
        "section-largely-unread",
        "/",
        f"{len(used)} of {len(available)} evidence spans are cited "
        f"({ratio:.1%}); below the {floor:.0%} floor this is not an extraction "
        "of this section",
        cited_spans=len(used),
        available_spans=len(available),
        ratio=round(ratio, 4),
        uncited_span_sample=unread[:20],
    )]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("shard")
    parser.add_argument("--evidence-packet", required=True)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)

    shard = json.loads(Path(args.shard).read_text(encoding="utf-8"))
    packet = json.loads(Path(args.evidence_packet).read_text(encoding="utf-8"))
    findings = check_grounding(shard, build_catalog(packet))
    result = {
        "status": "PASS" if not findings else "FINDINGS",
        "finding_count": len(findings),
        "findings": findings,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2 if args.json else None))
    return 0 if not findings else 1


if __name__ == "__main__":
    sys.exit(main())
