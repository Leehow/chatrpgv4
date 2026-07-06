#!/usr/bin/env python3
"""Parse PDF pages with pymupdf4llm — fast, reading-order-aware markdown.

Best for prose pages. Stat blocks become inline text (not HTML tables).

Usage:
    python3 parse_pymupdf4llm.py pdf/<book>.pdf --pages 294-296 [-o output.md]
    python3 parse_pymupdf4llm.py pdf/<book>.pdf --pages 294 --json
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import pymupdf4llm


def main() -> int:
    ap = argparse.ArgumentParser(description="Parse PDF with pymupdf4llm")
    ap.add_argument("pdf", help="PDF file path")
    ap.add_argument("--pages", required=True,
                    help="Page range: '294' or '294-296' (0-based)")
    ap.add_argument("-o", "--output", help="Output file (default: stdout)")
    ap.add_argument("--json", action="store_true",
                    help="Also output JSON with page-level data")
    args = ap.parse_args()

    # Parse page range
    if "-" in args.pages:
        start, end = args.pages.split("-", 1)
        pages = list(range(int(start), int(end) + 1))
    else:
        pages = [int(args.pages)]

    # Run pymupdf4llm
    md_text = pymupdf4llm.to_markdown(args.pdf, pages=pages)

    # Write output
    if args.output:
        Path(args.output).write_text(md_text, encoding="utf-8")
        print(f"Wrote {len(md_text)} chars to {args.output}", file=sys.stderr)
    else:
        print(md_text)

    # Optional JSON output
    if args.json:
        json_path = str(args.output or "stdout") + ".json"
        data = {
            "pdf": args.pdf,
            "pages": pages,
            "char_count": len(md_text),
            "parser": "pymupdf4llm",
        }
        if args.output:
            Path(json_path).write_text(
                json.dumps(data, indent=2), encoding="utf-8")
            print(f"Wrote JSON to {json_path}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    sys.exit(main())
