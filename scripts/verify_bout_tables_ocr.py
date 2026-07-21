#!/usr/bin/env python3
"""Verify bout-tables.json against MinerU OCR of Tables VII & VIII.

OCR source: checks/ocr-cached/bout-tables.md
  * Table VII:  Bouts of Madness - Real Time  (10 entries, roll 1D10)
  * Table VIII: Bouts of Madness - Summary    (10 entries, roll 1D10)

Each OCR entry is a numbered list item: "<idx>) <Name>: <description>".
MinerU OCR'ed the digit "1" as capital "I", so "I)" = "1)" and "I0)" = "10)".
We fix that before parsing the index.

Our data: plugins/coc-keeper/rulesets/coc7/rules-json/bout-tables.json
  {
    "realtime": [{d10_roll, result, kind}, ... 10],
    "summary":  [{d10_roll, result, kind}, ... 10],
  }

We compare EVERY entry (10 + 10 = 20) on:
  * d10_roll  -- OCR list index vs our d10_roll
  * result    -- OCR entry name (text before the colon) vs our result

Does NOT modify any JSON data.

Usage:
    uv run --frozen python scripts/verify_bout_tables_ocr.py
"""
from __future__ import annotations

import html
import json
import re
import sys
from pathlib import Path

BASE = Path("plugins/coc-keeper/rulesets/coc7/rules-json")
MD_PATH = Path("checks/ocr-cached/bout-tables.md")


# ---------------------------------------------------------------------------
# OCR parsing
# ---------------------------------------------------------------------------
# Match a numbered list item: optional capital-I-as-one digit(s) then ')'.
# Capture the index token and the rest of the line.
_ENTRY_RE = re.compile(r"^\s*([IO0-9]{1,2})\)\s*(.+)$", re.S)


def _fix_ocr_idx(token: str) -> int:
    """Fix MinerU's 'I' for '1' / 'O' for '0' in the list index, return int."""
    fixed = token.replace("I", "1").replace("O", "0")
    return int(fixed)


def parse_table_entries(md: str, start_marker: str) -> list[dict]:
    """Parse one bout table's numbered entries.

    `start_marker` is the heading line that introduces the list, e.g.
        "# Table VIl: Bouts of Madness-Real Time (roll ID10):"
    Entries are read from the line AFTER that heading until the next blank
    block / section heading.
    """
    start = md.find(start_marker)
    if start == -1:
        raise SystemExit(f"could not find marker {start_marker!r} in OCR")
    body_start = md.find("\n", start) + 1
    # Entries end at the first line that is empty AND followed by a different
    # section, or at the next '# '-style heading.  We stop reading list items
    # as soon as we hit a non-item paragraph; but keep scanning a few lines
    # because MinerU inserts blank lines between items.
    entries: list[dict] = []
    seen_non_item = 0
    for line in md[body_start:].splitlines():
        line = html.unescape(line).strip()
        m = _ENTRY_RE.match(line)
        if m:
            try:
                idx = _fix_ocr_idx(m.group(1))
            except ValueError:
                continue
            rest = m.group(2).strip()
            # Name is everything up to the first colon.
            name = rest.split(":", 1)[0].strip()
            entries.append({"idx": idx, "name": name, "raw": line})
            seen_non_item = 0
            if len(entries) >= 10:
                # both tables are exactly 10 entries; stop after the 10th
                break
        else:
            if line:
                seen_non_item += 1
                # if we already have some entries and hit two consecutive
                # non-item lines, we've left the list
                if entries and seen_non_item >= 2:
                    break
    return entries


def norm_name(s: str) -> str:
    """Normalise a bout result name: lowercase, collapse whitespace, strip
    leading/trailing punctuation (including slashes so 'Ideology/Beliefs'
    compares consistently)."""
    s = html.unescape(s).lower()
    s = re.sub(r"\s+", " ", s).strip()
    s = s.strip("`'\".,;:- ")
    return s


# ---------------------------------------------------------------------------
# Comparison
# ---------------------------------------------------------------------------
def compare_table(ocr_entries: list[dict], our_entries: list[dict], label: str) -> int:
    """Return number of mismatches across d10_roll and result name."""
    print(f"\n{'=' * 70}")
    print(f"  {label}")
    print(f"{'=' * 70}")
    print(f"OCR entries: {len(ocr_entries)}")
    print(f"Our entries: {len(our_entries)}")

    # index our entries by d10_roll
    our_by_roll = {int(e["d10_roll"]): e for e in our_entries}
    ocr_by_roll = {e["idx"]: e for e in ocr_entries}

    matched = 0
    correct = 0
    mismatches: list[str] = []

    all_rolls = sorted(set(ocr_by_roll) | set(our_by_roll))
    for r in all_rolls:
        ocr_e = ocr_by_roll.get(r)
        our_e = our_by_roll.get(r)
        if ocr_e is None:
            mismatches.append(
                f"roll {r}: MISSING in OCR (ours result='{our_e['result']}')"
            )
            continue
        if our_e is None:
            mismatches.append(
                f"roll {r}: MISSING in ours (OCR name='{ocr_e['name']}')"
            )
            continue
        matched += 1
        # compare result names (normalised)
        if norm_name(our_e["result"]) == norm_name(ocr_e["name"]):
            correct += 1
        else:
            mismatches.append(
                f"roll {r}: result ours='{our_e['result']}' OCR='{ocr_e['name']}'"
            )

    print(f"matched (by roll): {matched}")
    print(f"correct (exact result name): {correct}")
    print(f"mismatch count: {len(mismatches)}")
    print()
    for m in mismatches:
        print(f"  X {m}")
    return len(mismatches)


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
def main() -> int:
    md = MD_PATH.read_text(encoding="utf-8")
    data = json.loads((BASE / "bout-tables.json").read_text())

    # The OCR headings (note MinerU OCR'ed "VII" as "VIl" and "VIII" as "VIll"):
    rt_marker = "Table VIl: Bouts of Madness-Real Time"
    sum_marker = "Table VIll : Bouts of Madness-Summary"
    if rt_marker not in md:
        # fall back to a looser match
        m = re.search(r"Table\s+VIl{1,2}\s*:?\s*Bouts of Madness[- ]Real Time", md)
        if not m:
            raise SystemExit("could not locate Table VII (Real Time) heading")
        rt_marker = m.group(0)
    if sum_marker not in md:
        m = re.search(r"Table\s+VIl{1,2}l?\s*:?\s*Bouts of Madness[- ]Summary", md)
        if not m:
            raise SystemExit("could not locate Table VIII (Summary) heading")
        sum_marker = m.group(0)

    rt_ocr = parse_table_entries(md, rt_marker)
    sum_ocr = parse_table_entries(md, sum_marker)

    n1 = compare_table(rt_ocr, data["realtime"], "Table VII: Bouts of Madness - Real Time")
    n2 = compare_table(sum_ocr, data["summary"], "Table VIII: Bouts of Madness - Summary")

    total = n1 + n2
    print(f"\n{'=' * 70}")
    print(f"TOTAL mismatches across both bout tables: {total}")
    print(f"{'=' * 70}")
    return 1 if total else 0


if __name__ == "__main__":
    sys.exit(main())
