#!/usr/bin/env python3
"""Deterministic document-outline extraction for progressive module sources.

The outline is the cheap whole-book index that makes on-demand parsing
possible: without it a module can only be explored by walking location edges,
which structurally cannot reach the back-matter stat blocks that 9 of 11
surveyed modules keep in a separate appendix.

Nothing here interprets meaning.  Heading candidates are selected purely by
typography (glyph weight relative to the body-text mode, emphasis when
emphasis is rare) and by structural position; semantic classification of a
section is a separate pass that consumes this outline.  There is no keyword
list, title pattern, or section vocabulary in this module, and none may be
added.

Line producers live in :mod:`coc_source_outline_producers`.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from coc_source_outline_producers import (  # noqa: E402
    CONTINUOUS_PRODUCERS,
    PRODUCER_FUNCTIONS,
    PRODUCERS,
    SourceOutlineError,
    normalize as _normalize,
)

SCHEMA_VERSION = 1
CONTRACT_ID = "coc.source-outline.v1"

# Typography thresholds.  These are structural parameters, not semantics: they
# are recorded in the outline payload so a reviewer can audit what produced a
# given row.
HEADING_WEIGHT_RATIO = 1.12
MAX_HEADING_CHARS = 60
# Share of character mass that defines the body-text weight band.  A producer
# reporting exact font sizes needs only a narrow band; one reporting measured
# pixel geometry needs a wide one, because identical body text is measured at
# several heights depending on which ascenders and descenders a line happens
# to contain.
BODY_BAND_MASS = 0.60
BODY_BAND_MASS_CONTINUOUS = 0.90
# Some layouts mark subheads by weight alone at body size (Cold Harvest uses
# ``Arial,Bold`` at 11pt for every numbered sub-location).  Emphasis only
# carries structure when it is rare: if most of the document is emphasized,
# the signal is decorative and must be ignored.
EMPHASIS_MASS_MAX = 0.20
# An emphasis-only candidate that fills the column to the justification edge
# is a bold run inside a justified paragraph, not a subhead.  Size-based
# headings are exempt: a large title legitimately spans the column.
EMPHASIS_FULL_WIDTH_RATIO = 0.98
# A dense group of same-weight lines on one page is a text block (pull quote,
# read-aloud box, caption column), never a stack of headings.  Multi-column
# layouts interleave such a box with body lines, so adjacency in page order is
# not reliable; typographic mass is.
BLOCK_RUN_MIN = 4
BLOCK_GROUP_CHARS = 150
BLOCK_GROUP_MEDIAN_CHARS = 12
# Text repeating at the same vertical band across this many pages is a running
# header/footer rather than a section title.
REPEAT_PAGE_MIN = 3
BAND_COUNT = 12

_DIGITS = re.compile(r"\d+")
_HEX = frozenset("0123456789abcdef")
# Structural rejects: a line carrying no letter-like glyph at all cannot be a
# section title in any language.  This tests character classes, not words.
_WORDLIKE = re.compile(r"[^\W\d_]", re.UNICODE)


def _require_sha256(value: Any, field: str) -> str:
    text = value if isinstance(value, str) else ""
    if len(text) != 64 or any(char not in _HEX for char in text):
        raise SourceOutlineError(f"{field} must be a lowercase SHA-256 digest")
    return text


def _repeat_key(text: str) -> str:
    """Collapse digit runs so ``Page 3`` and ``Page 4`` share one identity."""
    return _DIGITS.sub("#", text)


# --------------------------------------------------------------------------
# Structural selection
# --------------------------------------------------------------------------


def body_weight(lines: Iterable[dict[str, Any]]) -> float:
    """Character-weighted mode of line weight: the body text size."""
    weights = _weight_mass(lines)
    if not weights:
        raise SourceOutlineError("source produced no measurable text lines")
    return max(weights.items(), key=lambda item: item[1])[0]


def _weight_mass(lines: Iterable[dict[str, Any]]) -> Counter[float]:
    weights: Counter[float] = Counter()
    for line in lines:
        weights[round(float(line["weight"]), 1)] += len(line["text"])
    return weights


def body_band(
    lines: Iterable[dict[str, Any]],
    *,
    band_mass: float = BODY_BAND_MASS,
) -> tuple[float, float]:
    """Return (body weight, top of the body band).

    A text-layer PDF reports one exact font size per body line, so the band
    collapses to the mode.  A recognized OCR box reports pixel height, which
    jitters by a glyph ascender or two around the same nominal size; treating
    that jitter as a size change would classify ordinary prose as headings.
    The band is the contiguous run of weights around the mode that carries the
    bulk of the character mass, so the heading threshold is measured from the
    top of real body variation rather than from its centre.
    """
    rows = list(lines)
    weights = _weight_mass(rows)
    if not weights:
        raise SourceOutlineError("source produced no measurable text lines")
    mode = max(weights.items(), key=lambda item: item[1])[0]
    total = sum(weights.values())
    ordered = sorted(weights)
    index = ordered.index(mode)
    low = high = index
    covered = weights[mode]
    while covered < total * band_mass:
        take_low = low > 0
        take_high = high < len(ordered) - 1
        if not take_low and not take_high:
            break
        if take_high and (
            not take_low or weights[ordered[high + 1]] >= weights[ordered[low - 1]]
        ):
            high += 1
            covered += weights[ordered[high]]
        else:
            low -= 1
            covered += weights[ordered[low]]
    return mode, ordered[high]


def _running_repeats(lines: list[dict[str, Any]]) -> set[tuple[str, int]]:
    """Identify (text, band) pairs that recur across pages: headers/footers."""
    seen: dict[tuple[str, int], set[int]] = defaultdict(set)
    for line in lines:
        band = _band(line)
        seen[(_repeat_key(line["text"]), band)].add(int(line["pdf_index"]))
    return {key for key, pages in seen.items() if len(pages) >= REPEAT_PAGE_MIN}


def _band(line: dict[str, Any]) -> int:
    height = float(line.get("page_height") or 0.0)
    if height <= 0:
        return 0
    ratio = float(line.get("y0") or 0.0) / height
    return max(0, min(BAND_COUNT - 1, int(ratio * BAND_COUNT)))


def _median(values: list[int]) -> float:
    ordered = sorted(values)
    middle = len(ordered) // 2
    if not ordered:
        return 0.0
    if len(ordered) % 2:
        return float(ordered[middle])
    return (ordered[middle - 1] + ordered[middle]) / 2.0


def _block_group_orders(lines: list[dict[str, Any]]) -> set[int]:
    """Orders belonging to a same-weight prose block on one page.

    A read-aloud box or caption column is typeset above body weight but is
    prose, not a stack of section titles.  Neither per-line length nor page
    adjacency separates them: such boxes wrap into many short lines, and a
    two-column layout interleaves them with body lines so they are not
    adjacent in page order.  Typographic mass does separate them — a real
    heading group on one page stays small even when it has many members
    (a list of names), while a prose block carries paragraph-scale text.
    """
    dropped: set[int] = set()
    groups: dict[tuple[int, float, bool], list[dict[str, Any]]] = defaultdict(list)
    for line in lines:
        groups[(
            int(line["pdf_index"]),
            round(float(line["weight"]), 1),
            bool(line.get("emphasis")),
        )].append(line)
    for group in groups.values():
        if len(group) < BLOCK_RUN_MIN:
            continue
        lengths = [len(row["text"]) for row in group]
        if sum(lengths) < BLOCK_GROUP_CHARS:
            continue
        if _median(lengths) < BLOCK_GROUP_MEDIAN_CHARS:
            continue
        dropped.update(int(row["order"]) for row in group)
    return dropped


def emphasis_is_discriminative(lines: Iterable[dict[str, Any]]) -> bool:
    """True when emphasized glyphs are rare enough to mark structure."""
    total = 0
    emphasized = 0
    for line in lines:
        size = len(line["text"])
        total += size
        if line.get("emphasis"):
            emphasized += size
    if total <= 0:
        return False
    return (emphasized / total) <= EMPHASIS_MASS_MAX and emphasized > 0


def select_headings(
    lines: list[dict[str, Any]],
    *,
    body: float,
    band_top: float | None = None,
    max_chars: int = MAX_HEADING_CHARS,
) -> list[dict[str, Any]]:
    """Return heading candidates ordered by document position."""
    threshold = max(float(band_top if band_top is not None else body), body) * (
        HEADING_WEIGHT_RATIO
    )
    use_emphasis = emphasis_is_discriminative(lines)
    repeats = _running_repeats(lines)
    blocks = _block_group_orders(lines)
    column_width: dict[int, float] = defaultdict(float)
    for line in lines:
        page = int(line["pdf_index"])
        column_width[page] = max(column_width[page], float(line.get("width") or 0.0))
    kept: list[dict[str, Any]] = []
    for line in lines:
        text = line["text"]
        weight = float(line["weight"])
        emphasized = bool(line.get("emphasis")) and use_emphasis
        size_based = weight > threshold
        if not size_based and not (emphasized and weight >= body):
            continue
        if not size_based:
            full = column_width[int(line["pdf_index"])]
            if full > 0 and float(line.get("width") or 0.0) >= full * (
                EMPHASIS_FULL_WIDTH_RATIO
            ):
                continue
        if not _WORDLIKE.search(text):
            continue
        if len(text) > max_chars:
            continue
        if (_repeat_key(text), _band(line)) in repeats:
            continue
        if int(line["order"]) in blocks:
            continue
        kept.append({**line, "emphasis": emphasized})
    # Rank larger glyphs first; at equal size, an emphasized line outranks a
    # plain one, so a bold subhead never shares a rank with body-size prose.
    tiers = sorted(
        {(round(float(row["weight"]), 1), bool(row["emphasis"])) for row in kept},
        key=lambda tier: (-tier[0], not tier[1]),
    )
    rank_of = {tier: index + 1 for index, tier in enumerate(tiers)}
    return [
        {
            "pdf_index": int(row["pdf_index"]),
            "order": int(row["order"]),
            "text": row["text"],
            "weight": round(float(row["weight"]), 2),
            "emphasis": bool(row["emphasis"]),
            "size_rank": rank_of[
                (round(float(row["weight"]), 1), bool(row["emphasis"]))
            ],
        }
        for row in kept
    ]


def outline_digest(rows: list[dict[str, Any]], file_sha256: str) -> str:
    material = json.dumps(
        {"file_sha256": file_sha256, "rows": rows},
        ensure_ascii=False, sort_keys=True, separators=(",", ":"),
    )
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def build_outline(
    *,
    producer: str,
    source: Path,
    file_sha256: str,
    source_id: str,
    max_chars: int = MAX_HEADING_CHARS,
) -> dict[str, Any]:
    if producer not in PRODUCERS:
        raise SourceOutlineError(f"unknown outline producer {producer!r}")
    digest = _require_sha256(file_sha256, "file_sha256")
    lines = PRODUCER_FUNCTIONS[producer](Path(source))
    continuous = producer in CONTINUOUS_PRODUCERS
    band_mass = BODY_BAND_MASS_CONTINUOUS if continuous else BODY_BAND_MASS
    body, band_top = body_band(lines, band_mass=band_mass)
    rows = select_headings(
        lines, body=body, band_top=band_top, max_chars=max_chars,
    )
    # pdf_index is 0-based (the source-bundle contract's base), so the page
    # count is the highest index plus one.  Reporting the max directly made a
    # 23-page book claim 22 pages and put its last page outside every scope
    # check derived from the count.
    page_count = max(
        (int(line["pdf_index"]) for line in lines), default=-1,
    ) + 1
    payload = {
        "schema_version": SCHEMA_VERSION,
        "contract_id": CONTRACT_ID,
        "producer": producer,
        "source_id": str(source_id or ""),
        "file_sha256": digest,
        "page_count": page_count,
        "line_count": len(lines),
        "body_weight": body,
        "body_band_top": band_top,
        # Geometry-derived outlines carry real structure but coarser tiers than
        # a text-layer outline; downstream classification must weight them
        # accordingly rather than treat every producer as equally exact.
        "confidence_class": "coarse" if continuous else "exact",
        "selection": {
            "heading_weight_ratio": HEADING_WEIGHT_RATIO,
            "body_band_mass": band_mass,
            "max_heading_chars": max_chars,
            "block_run_min": BLOCK_RUN_MIN,
            "block_group_chars": BLOCK_GROUP_CHARS,
            "block_group_median_chars": BLOCK_GROUP_MEDIAN_CHARS,
            "repeat_page_min": REPEAT_PAGE_MIN,
            "band_count": BAND_COUNT,
            "emphasis_mass_max": EMPHASIS_MASS_MAX,
            "emphasis_used": emphasis_is_discriminative(lines),
        },
        "rows": rows,
    }
    payload["outline_sha256"] = outline_digest(rows, digest)
    return payload


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Deterministic source outline")
    parser.add_argument("--producer", required=True, choices=sorted(PRODUCERS))
    parser.add_argument("--source", required=True,
                        help="PDF path, OCR corpus dir, or mineru markdown")
    parser.add_argument("--file-sha256", default="",
                        help="defaults to sha256 of --source when it is a file")
    parser.add_argument("--source-id", default="")
    parser.add_argument("--max-chars", type=int, default=MAX_HEADING_CHARS)
    args = parser.parse_args(argv)

    source = Path(args.source).expanduser()
    file_sha256 = args.file_sha256 or (
        sha256_file(source) if source.is_file() else ""
    )
    try:
        payload = build_outline(
            producer=args.producer,
            source=source,
            file_sha256=file_sha256,
            source_id=args.source_id or f"pdf:{file_sha256[:24]}",
            max_chars=args.max_chars,
        )
    except SourceOutlineError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 1
    print(json.dumps(payload, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
