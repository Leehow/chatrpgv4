#!/usr/bin/env python3
"""Probe a PDF to detect column layout, scanned pages, and table density.

Outputs JSON with per-page metadata and a parser recommendation.

Usage:
    python3 probe_pdf.py pdf/<book>.pdf [--start S] [--end E]
"""
from __future__ import annotations

import argparse
import json
import sys

import fitz  # PyMuPDF


def detect_columns(page: fitz.Page) -> int:
    """Detect column count by analyzing text block x-coordinates.

    If blocks cluster into two distinct x-ranges (left half / right half),
    it's a 2-column page.
    """
    blocks = page.get_text("blocks")
    if len(blocks) < 4:
        return 1
    page_width = page.rect.width
    mid = page_width / 2
    # Count blocks clearly in left vs right half (with margin)
    margin = page_width * 0.1
    left = sum(1 for b in blocks if b[0] < mid - margin and b[2] > margin)
    right = sum(1 for b in blocks if b[0] > mid + margin)
    # If both sides have meaningful content, it's 2-column
    if left >= 2 and right >= 2:
        return 2
    return 1


def detect_tables(page: fitz.Page) -> bool:
    """Heuristic: if a page has many short text fragments arranged in a grid,
    it likely contains a table."""
    blocks = page.get_text("blocks")
    if len(blocks) < 8:
        return False
    # Tables tend to have many small blocks with similar y-spacing
    # Check for grid-like patterns (many blocks on same y-line)
    y_lines: dict[float, int] = {}
    for b in blocks:
        y = round(b[1], 0)
        # Group by ~5px tolerance
        found = False
        for ky in y_lines:
            if abs(y - ky) < 5:
                y_lines[ky] += 1
                found = True
                break
        if not found:
            y_lines[y] = 1
    # If any y-line has 3+ blocks, likely tabular
    return any(count >= 3 for count in y_lines.values())


def probe_page(doc: fitz.Document, idx: int) -> dict:
    """Probe a single page."""
    page = doc[idx]
    text = page.get_text("text")
    char_count = len(text.strip())
    is_scanned = char_count < 50  # Very little extractable text = scanned

    return {
        "page_idx": idx,
        "printed_page": idx + 1,  # Approximate; CoC rulebook has ~12 offset
        "char_count": char_count,
        "columns": detect_columns(page),
        "has_tables": detect_tables(page),
        "is_scanned": is_scanned,
    }


def recommend(info: dict) -> str:
    """Recommend a parser for a page based on its characteristics."""
    if info["is_scanned"]:
        return "pymupdf4llm+ocr"  # Needs OCR (pymupdf4llm uses Tesseract)
    if info["has_tables"]:
        return "pymupdf4llm"  # Outputs Markdown tables
    if info["columns"] == 2:
        return "pymupdf4llm"  # Handles 2-column reading order
    return "pymupdf4llm"  # Simple prose


def main() -> int:
    ap = argparse.ArgumentParser(description="Probe PDF layout")
    ap.add_argument("pdf", help="PDF file path")
    ap.add_argument("--start", type=int, default=0, help="Start page (0-based)")
    ap.add_argument("--end", type=int, default=0, help="End page (0-based, 0=all)")
    args = ap.parse_args()

    doc = fitz.open(args.pdf)
    total = len(doc)
    end = args.end if args.end > 0 else total
    start = max(0, args.start)
    end = min(end, total)

    pages = []
    col_counts = {1: 0, 2: 0}
    table_pages = []
    scanned_pages = []

    for idx in range(start, end):
        info = probe_page(doc, idx)
        info["recommended_parser"] = recommend(info)
        pages.append(info)
        col_counts[info["columns"]] = col_counts.get(info["columns"], 0) + 1
        if info["has_tables"]:
            table_pages.append(idx)
        if info["is_scanned"]:
            scanned_pages.append(idx)

    doc.close()

    dominant_col = 2 if col_counts.get(2, 0) > col_counts.get(1, 0) else 1
    result = {
        "pdf": args.pdf,
        "total_pages": total,
        "probed_range": [start, end],
        "dominant_columns": dominant_col,
        "column_distribution": col_counts,
        "table_page_count": len(table_pages),
        "table_pages_sample": table_pages[:10],
        "scanned_page_count": len(scanned_pages),
        "scanned_pages_sample": scanned_pages[:10],
        "pages": pages[:20],  # First 20 for preview
    }

    print(json.dumps(result, indent=2))
    print(f"\nRecommendation: dominant={dominant_col}col, "
          f"{len(table_pages)} table pages, "
          f"{len(scanned_pages)} scanned pages", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
