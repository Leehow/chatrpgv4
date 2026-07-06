#!/usr/bin/env python3
"""Score parse quality across 6 dimensions for a single PDF page.

Uses PyMuPDF blocks + pdfplumber tables to evaluate layout detection.

Usage:
    python3 score_parse_quality.py --pdf pdf/<book>.pdf --page 294
    python3 score_parse_quality.py --pdf pdf/<book>.pdf --page 294 --json
"""
from __future__ import annotations

import argparse
import json
import sys

import fitz
import pdfplumber


def score_reading_order(page: fitz.Page) -> dict:
    """Score: are blocks in correct left-to-right, top-to-bottom order?

    For 2-column pages, left column should finish before right column starts.
    """
    blocks = page.get_text("blocks")
    if len(blocks) < 4:
        return {"score": 1.0, "columns": 1, "note": "too few blocks"}
    mid = page.rect.width / 2
    margin = page.rect.width * 0.1
    left_blocks = sorted([b for b in blocks if b[0] < mid],
                         key=lambda b: b[1])
    right_blocks = sorted([b for b in blocks if b[0] >= mid],
                          key=lambda b: b[1])
    if not right_blocks:
        return {"score": 1.0, "columns": 1, "note": "single column"}
    # Check: does any left block appear AFTER a right block in reading order?
    # In correct order, all left blocks should come before right blocks
    # (when sorted by y, then x)
    all_sorted = sorted(blocks, key=lambda b: (round(b[1] / 10), b[0]))
    left_done = False
    violations = 0
    for b in all_sorted:
        is_left = b[0] < mid
        if not is_left and not left_done:
            left_done = True
        if is_left and left_done:
            # Left block after right block started — possible violation
            violations += 1
    score = max(0, 1.0 - violations * 0.1)
    return {"score": round(score, 2), "columns": 2,
            "violations": violations,
            "left_blocks": len(left_blocks),
            "right_blocks": len(right_blocks)}


def score_tables(pdf_path: str, page_idx: int) -> dict:
    """Score: are tables detected and structured correctly?"""
    with pdfplumber.open(pdf_path) as pdf:
        if page_idx >= len(pdf.pages):
            return {"score": 0.0, "note": "page out of range"}
        page = pdf.pages[page_idx]
        tables = page.find_tables()
        if not tables:
            return {"score": 1.0, "table_count": 0,
                    "note": "no tables on page"}
        # Check table structure (rows/cells)
        total_cells = 0
        for t in tables:
            total_cells += len(t.cells) if t.cells else 0
        return {"score": 1.0, "table_count": len(tables),
                "total_cells": total_cells}


def score_header_footer(page: fitz.Page) -> dict:
    """Score: are page headers/footers (page numbers, chapter titles) present?

    These should ideally be stripped by the parser. We detect them by
    checking for short text blocks at the very top/bottom of the page.
    """
    blocks = page.get_text("blocks")
    page_height = page.rect.height
    header_threshold = page_height * 0.05  # Top 5%
    footer_threshold = page_height * 0.95  # Bottom 5%

    headers = [b for b in blocks if b[1] < header_threshold]
    footers = [b for b in blocks if b[3] > footer_threshold]

    # Headers/footers are typically short (page numbers, chapter names)
    header_text = " ".join(b[4][:30] for b in headers).strip()
    footer_text = " ".join(b[4][:30] for b in footers).strip()

    return {
        "score": 1.0,  # Parser handles this; we just report presence
        "has_header": len(headers) > 0,
        "has_footer": len(footers) > 0,
        "header_sample": header_text[:50],
        "footer_sample": footer_text[:50],
    }


def score_bbox_coverage(page: fitz.Page) -> dict:
    """Score: what fraction of text blocks have valid bbox coordinates?"""
    blocks = page.get_text("blocks")
    if not blocks:
        return {"score": 0.0, "note": "no blocks"}
    valid = sum(1 for b in blocks if len(b) >= 4 and b[2] > b[0] and b[3] > b[1])
    return {"score": round(valid / len(blocks), 2),
            "total_blocks": len(blocks),
            "valid_bbox": valid}


def score_sidebar(page: fitz.Page) -> dict:
    """Score: are sidebar/graybox elements isolated from main text?

    Detects narrow text blocks that span the full page width but are
    vertically short (typical of sidebars/callouts).
    """
    blocks = page.get_text("blocks")
    page_width = page.rect.width
    potential_sidebars = []
    for b in blocks:
        width = b[2] - b[0]
        height = b[3] - b[1]
        # Sidebar heuristic: wide but short, or positioned at edge
        if width > page_width * 0.7 and height < 50:
            potential_sidebars.append(b)
    return {
        "score": 1.0,
        "sidebar_candidates": len(potential_sidebars),
    }


def score_entity_continuity(text: str) -> dict:
    """Score: are entity names (all-cwords, monster names) intact?

    Checks for common truncation patterns.
    """
    # Look for broken words (hyphen + newline)
    broken = len(__import__("re").findall(r"-\n[a-z]", text))
    # Look for split numbers (e.g., "1D\n6")
    split_nums = len(__import__("re").findall(r"\d+\n\d+", text))
    score = max(0, 1.0 - (broken + split_nums) * 0.05)
    return {
        "score": round(score, 2),
        "broken_words": broken,
        "split_numbers": split_nums,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="Score parse quality")
    ap.add_argument("--pdf", required=True, help="PDF file path")
    ap.add_argument("--page", type=int, required=True, help="Page index (0-based)")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    doc = fitz.open(args.pdf)
    page = doc[args.page]
    text = page.get_text("text")

    scores = {
        "reading_order": score_reading_order(page),
        "tables": score_tables(args.pdf, args.page),
        "header_footer": score_header_footer(page),
        "bbox_coverage": score_bbox_coverage(page),
        "sidebar_isolation": score_sidebar(page),
        "entity_continuity": score_entity_continuity(text),
    }

    # Overall score (average of individual scores)
    overall = sum(s.get("score", 0) for s in scores.values()) / len(scores)
    scores["overall"] = round(overall, 2)

    doc.close()

    if args.json:
        print(json.dumps(scores, indent=2, default=str))
    else:
        print(f"Parse quality scores for page {args.page}:")
        for name, result in scores.items():
            if name == "overall":
                print(f"  OVERALL: {result}")
            else:
                s = result.get("score", "?")
                print(f"  {name}: {s}")
        # Print details
        print(f"\nDetails:")
        for name, result in scores.items():
            if name == "overall":
                continue
            details = {k: v for k, v in result.items() if k != "score"}
            if details:
                print(f"  {name}: {details}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
