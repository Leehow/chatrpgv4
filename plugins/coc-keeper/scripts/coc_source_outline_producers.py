#!/usr/bin/env python3
"""Line producers for deterministic source-outline extraction.

Each producer turns one stored source shape into the same raw line record::

    {pdf_index, order, text, weight, emphasis, width, y0, y1, page_height}

``pdf_index`` is whatever index the module-assets cache uses for that page,
never a re-derived one, so every downstream request selects the same page.
``weight`` is whatever the shape measures as glyph size - a host-measured font
size, a recognized box height, or a heading level - and is only ever compared
against the same document's own body text, never against a fixed constant.

No producer opens a PDF. The repository contains no PDF parser by design, so
exact font metrics arrive as a host-produced line list rather than being read
here.

Nothing here inspects meaning: no keyword list, title pattern, or section
vocabulary belongs in this module, and none may be added.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

PRODUCERS = frozenset({
    "host_outline", "cached_pages", "ocr_boxes", "mineru_md",
})
# Producers whose weight is a measured quantity rather than a declared size.
# Identical body text is measured at several heights depending on which
# ascenders and descenders a line happens to contain, so the body band must be
# widened for these.
CONTINUOUS_PRODUCERS = frozenset({"ocr_boxes"})
_MINERU_HEADING = re.compile(r"^(#{1,6})\s+(.*)$")


class SourceOutlineError(ValueError):
    """The requested source cannot produce a deterministic outline."""


def normalize(text: str) -> str:
    return " ".join(str(text or "").split())


_normalize = normalize


def lines_from_host_outline(path: Path) -> list[dict[str, Any]]:
    """Validate a host-produced line list; the repository never opens the PDF.

    Exact font metrics give by far the cleanest outline, but reading them means
    running a PDF parser, and this repository does not contain one — extraction
    is the host PDF skill's job, deliberately, so that no parser dependency and
    no parsing bug can live behind the campaign state.  The same boundary
    applies here: the host measures the glyphs and hands over positions, and
    this module validates and selects.

    The host writes a JSON document of raw line records.  It contains geometry
    only; if a producer puts page prose in ``text`` beyond the line's own
    content it is still just a candidate title and is filtered like any other.
    """
    try:
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SourceOutlineError(f"cannot read host outline: {exc}") from exc
    if not isinstance(payload, dict):
        raise SourceOutlineError("host outline must be an object")
    rows = payload.get("lines")
    if not isinstance(rows, list) or not rows:
        raise SourceOutlineError("host outline carries no lines")
    lines: list[dict[str, Any]] = []
    for order, row in enumerate(rows, start=1):
        if not isinstance(row, dict):
            raise SourceOutlineError("host outline lines must be objects")
        text = normalize(row.get("text"))
        if not text:
            continue
        pdf_index = row.get("pdf_index")
        weight = row.get("weight")
        if (
            isinstance(pdf_index, bool)
            or not isinstance(pdf_index, int)
            or pdf_index < 0
        ):
            raise SourceOutlineError("host outline pdf_index must be 1-based")
        if isinstance(weight, bool) or not isinstance(weight, (int, float)):
            raise SourceOutlineError("host outline weight must be numeric")
        lines.append({
            "pdf_index": pdf_index,
            "order": order,
            "text": text,
            "weight": round(float(weight), 2),
            "emphasis": bool(row.get("emphasis")),
            "width": float(row.get("width") or 0.0),
            "y0": float(row.get("y0") or 0.0),
            "y1": float(row.get("y1") or 0.0),
            "page_height": float(row.get("page_height") or 0.0) or 1.0,
        })
    if not lines:
        raise SourceOutlineError("host outline produced no usable lines")
    return lines


def lines_from_cached_pages(pages_dir: Path) -> list[dict[str, Any]]:
    """Read heading structure from the module's own registered page cache.

    This is the producer that is actually available after a normal ingest.  The
    host PDF skill writes each page as Markdown and the repository caches it
    verbatim as ``NNNN.md``, so the heading levels the skill already recovered
    are sitting in the canonical cache — no second pass over the source, and no
    parser.  Page numbering comes from the filename stem, which is exactly the
    ``pdf_index`` the cache itself is keyed by.
    """
    pages = Path(pages_dir)
    if not pages.is_dir():
        raise SourceOutlineError(f"module has no cached pages: {pages}")
    lines: list[dict[str, Any]] = []
    order = 0
    for path in sorted(pages.glob("*.md")):
        if not path.stem.isdigit():
            continue
        pdf_index = int(path.stem)
        try:
            raw = path.read_text(encoding="utf-8")
        except OSError:
            continue
        for raw_line in raw.splitlines():
            text = normalize(raw_line)
            if not text:
                continue
            match = _MINERU_HEADING.match(text)
            order += 1
            if match:
                body = normalize(match.group(2))
                if not body:
                    continue
                weight, emphasis = float(8 - len(match.group(1))), True
            else:
                body, weight, emphasis = text, 1.0, False
            lines.append({
                "pdf_index": pdf_index,
                "order": order,
                "text": body,
                "weight": weight,
                "emphasis": emphasis,
                "width": 0.0,
                "y0": 0.0,
                "y1": 0.0,
                "page_height": 1.0,
            })
    if not lines:
        raise SourceOutlineError("cached pages produced no usable lines")
    return lines


def lines_from_ocr_corpus(corpus_dir: Path) -> list[dict[str, Any]]:
    pages_dir = Path(corpus_dir) / "pages"
    if not pages_dir.is_dir():
        raise SourceOutlineError(f"corpus has no pages directory: {pages_dir}")
    lines: list[dict[str, Any]] = []
    order = 0
    for page_dir in sorted(pages_dir.iterdir()):
        head_path = page_dir / "fast" / "head.json"
        if not head_path.is_file():
            continue
        try:
            head = json.loads(head_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        structured = head.get("structured_path")
        if not isinstance(structured, str) or not structured:
            continue
        boxes_path = Path(corpus_dir) / structured
        if not boxes_path.is_file():
            continue
        try:
            payload = json.loads(boxes_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        pruned = payload.get("prunedResult")
        if not isinstance(pruned, dict):
            continue
        texts = pruned.get("rec_texts")
        boxes = pruned.get("rec_boxes")
        if not isinstance(texts, list) or not isinstance(boxes, list):
            continue
        ordinal = payload.get("source_page_ordinal")
        if not isinstance(ordinal, int) or isinstance(ordinal, bool):
            continue
        page_info = ((payload.get("dataInfo") or {}).get("pages") or [{}])[0]
        height = float(page_info.get("height") or 0.0) or 1.0
        for text, box in zip(texts, boxes):
            body = _normalize(text)
            if not body or not isinstance(box, list) or len(box) < 4:
                continue
            y0, y1 = float(box[1]), float(box[3])
            order += 1
            lines.append({
                "pdf_index": ordinal + 1,
                "order": order,
                "text": body,
                "weight": round(abs(y1 - y0), 2),
                # Recognized boxes carry no glyph styling.
                "emphasis": False,
                "width": abs(float(box[2]) - float(box[0])),
                "y0": y0,
                "y1": y1,
                "page_height": height,
            })
    return lines


_MINERU_HEADING = re.compile(r"^(#{1,6})\s+(.*)$")


def lines_from_mineru(markdown_path: Path) -> list[dict[str, Any]]:
    """Mineru already emits heading levels; map level to a comparable weight.

    Body text is assigned weight 1.0 so the shared selector still sees a real
    body mode instead of an all-heading document.
    """
    try:
        raw = Path(markdown_path).read_text(encoding="utf-8")
    except OSError as exc:
        raise SourceOutlineError(f"cannot read mineru markdown: {exc}") from exc
    lines: list[dict[str, Any]] = []
    order = 0
    for raw_line in raw.splitlines():
        text = _normalize(raw_line)
        if not text:
            continue
        match = _MINERU_HEADING.match(text)
        order += 1
        if match:
            level = len(match.group(1))
            body = _normalize(match.group(2))
            if not body:
                continue
            weight = float(8 - level)
        else:
            body, weight = text, 1.0
        lines.append({
            # Mineru exports one flat document; page binding must be supplied
            # by the caller's page map when one exists.
            "pdf_index": 0,
            "order": order,
            "text": body,
            "weight": weight,
            # Heading level already encodes the structure signal.
            "emphasis": False,
            "width": 0.0,
            "y0": 0.0,
            "y1": 0.0,
            "page_height": 1.0,
        })
    return lines


# --------------------------------------------------------------------------
# Structural selection


PRODUCER_FUNCTIONS = {
    "host_outline": lines_from_host_outline,
    "cached_pages": lines_from_cached_pages,
    "ocr_boxes": lines_from_ocr_corpus,
    "mineru_md": lines_from_mineru,
}
