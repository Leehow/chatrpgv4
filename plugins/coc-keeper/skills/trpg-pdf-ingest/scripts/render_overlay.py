#!/usr/bin/env python3
"""Render a PDF page with bbox overlay for visual layout inspection.

Uses pdfplumber to draw colored boxes around detected elements:
  Red  = tables
  Blue = text blocks
  Green = images/rects

Usage:
    python3 render_overlay.py --pdf pdf/<book>.pdf --page 294 [-o overlay.png]
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import pdfplumber


def render(pdf_path: str, page_idx: int, output: str | None) -> None:
    """Render a page with bbox overlay."""
    with pdfplumber.open(pdf_path) as pdf:
        if page_idx >= len(pdf.pages):
            print(f"Error: page {page_idx} out of range (total {len(pdf.pages)})",
                  file=sys.stderr)
            sys.exit(1)

        page = pdf.pages[page_idx]
        img = page.to_image(resolution=150)

        # Draw text word bounding boxes (blue)
        words = page.extract_words()
        if words:
            bboxes = [(w["x0"], w["top"], w["x1"], w["bottom"]) for w in words]
            img.draw_rects(bboxes, stroke="blue", stroke_width=1, fill=None)

        # Draw table bounding boxes (red)
        tables = page.find_tables()
        if tables:
            table_bboxes = [t.bbox for t in tables]
            img.draw_rects(table_bboxes, stroke="red", stroke_width=2, fill=None)

        # Draw image rects (green)
        rects = page.rects
        if rects:
            img_bboxes = [(r["x0"], r["y0"], r["x1"], r["y1"]) for r in rects]
            img.draw_rects(img_bboxes, stroke="green", stroke_width=1, fill=None)

        # Save
        if output:
            img.save(output)
            print(f"Saved overlay to {output}", file=sys.stderr)
            print(f"  Page {page_idx}: {len(words)} words, "
                  f"{len(tables)} tables, {len(rects)} rects", file=sys.stderr)
        else:
            img.save(f"overlay_page_{page_idx}.png")
            print(f"Saved to overlay_page_{page_idx}.png", file=sys.stderr)


def main() -> int:
    ap = argparse.ArgumentParser(description="Render PDF page with bbox overlay")
    ap.add_argument("--pdf", required=True, help="PDF file path")
    ap.add_argument("--page", type=int, required=True, help="Page index (0-based)")
    ap.add_argument("-o", "--output", help="Output PNG path")
    args = ap.parse_args()

    render(args.pdf, args.page, args.output)
    return 0


if __name__ == "__main__":
    sys.exit(main())
