#!/usr/bin/env python3
"""Compare two parser outputs (pymupdf4llm vs MinerU) on the same pages.

Reports: text agreement %, table row counts, key number discrepancies.

Usage:
    python3 compare_parsers.py \
        --pymupdf4llm output.md \
        --mineru checks/ocr-cached/monsters-ch14.md
"""
from __future__ import annotations

import argparse
import difflib
import json
import re
import sys
from pathlib import Path


def normalize_lines(text: str) -> list[str]:
    """Normalize text into comparable lines."""
    lines = []
    for line in text.splitlines():
        # Strip whitespace, skip empty lines
        s = line.strip()
        if not s:
            continue
        # Normalize whitespace within line
        s = re.sub(r"\s+", " ", s)
        lines.append(s)
    return lines


def extract_numbers(text: str) -> set[str]:
    """Extract all standalone numbers from text for cross-checking."""
    return set(re.findall(r"\b\d+\b", text))


def count_tables(text: str) -> int:
    """Count HTML tables or markdown table rows."""
    html_tables = len(re.findall(r"<table>", text, re.I))
    md_rows = len(re.findall(r"^\|.*\|$", text, re.M))
    return html_tables + md_rows


def compare(pymupdf_text: str, mineru_text: str) -> dict:
    """Compare two parser outputs."""
    py_lines = normalize_lines(pymupdf_text)
    mn_lines = normalize_lines(mineru_text)

    # Line-level similarity (difflib ratio)
    matcher = difflib.SequenceMatcher(None, py_lines, mn_lines)
    ratio = matcher.ratio()

    # Number cross-check
    py_nums = extract_numbers(pymupdf_text)
    mn_nums = extract_numbers(mineru_text)
    common_nums = py_nums & mn_nums
    py_only = py_nums - mn_nums
    mn_only = mn_nums - py_nums

    # Table count
    py_tables = count_tables(pymupdf_text)
    mn_tables = count_tables(mineru_text)

    # Stat block keywords (STR/CON/SIZ/HP)
    stat_keywords = ["STR", "CON", "SIZ", "DEX", "INT", "POW", "HP"]
    py_stats = sum(1 for k in stat_keywords if k in pymupdf_text)
    mn_stats = sum(1 for k in stat_keywords if k in mineru_text)

    # Find lines that differ significantly
    diff_lines = []
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            continue
        if tag in ("replace", "delete"):
            for line in py_lines[i1:i2]:
                if len(line) > 20:  # Skip short fragments
                    diff_lines.append(("pymupdf4llm", line[:80]))
        if tag in ("replace", "insert"):
            for line in mn_lines[j1:j2]:
                if len(line) > 20:
                    diff_lines.append(("mineru", line[:80]))

    return {
        "line_agreement": round(ratio, 3),
        "py_lines": len(py_lines),
        "mn_lines": len(mn_lines),
        "py_tables": py_tables,
        "mn_tables": mn_tables,
        "py_stat_keywords_found": py_stats,
        "mn_stat_keywords_found": mn_stats,
        "common_numbers": len(common_nums),
        "py_only_numbers": sorted(py_only)[:20],
        "mn_only_numbers": sorted(mn_only)[:20],
        "diff_sample": diff_lines[:10],
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="Compare parser outputs")
    ap.add_argument("--pymupdf4llm", required=True, help="pymupdf4llm markdown file")
    ap.add_argument("--mineru", required=True, help="MinerU markdown file")
    ap.add_argument("--json", action="store_true", help="Output JSON")
    args = ap.parse_args()

    py_text = Path(args.pymupdf4llm).read_text(encoding="utf-8")
    mn_text = Path(args.mineru).read_text(encoding="utf-8")

    result = compare(py_text, mn_text)

    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print(f"Parser comparison: pymupdf4llm vs MinerU")
        print(f"  Line agreement: {result['line_agreement']:.1%}")
        print(f"  pymupdf4llm: {result['py_lines']} lines, "
              f"{result['py_tables']} tables, "
              f"{result['py_stat_keywords_found']}/7 stat keywords")
        print(f"  MinerU:       {result['mn_lines']} lines, "
              f"{result['mn_tables']} tables, "
              f"{result['mn_stat_keywords_found']}/7 stat keywords")
        print(f"  Common numbers: {result['common_numbers']}")
        if result["py_only_numbers"]:
            print(f"  pymupdf4llm-only numbers: {result['py_only_numbers']}")
        if result["mn_only_numbers"]:
            print(f"  MinerU-only numbers: {result['mn_only_numbers']}")
        if result["diff_sample"]:
            print(f"\n  Key differences (first 10):")
            for source, line in result["diff_sample"]:
                print(f"    [{source}] {line}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
