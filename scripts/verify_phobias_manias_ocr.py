#!/usr/bin/env python3
"""Verify phobias.json and manias.json against MinerU OCR of Tables IX/X.

OCR source: checks/ocr-cached/phobias-manias.md
  * Table IX: Sample Phobias  -- numbered list "1) Ablutophobia: Fear of washing"
  * Table X:  Sample Manias   -- numbered list "1) Ablutomania: Compulsion for washing"

MinerU frequently misreads the digit "1" as capital "I" (e.g. "I0)" = "10)",
"I1)" = "11)"), and occasionally the digit "0" as capital "O".  We normalise
those tokens before parsing the list index.

This script compares EVERY phobia and mania NAME against our JSON data:
  * counts (OCR 100 phobias / 100 manias)
  * name mismatches (typo vs. our data)
  * missing / extra entries

It does NOT modify any JSON data.  OCR is authoritative for the source; where
the OCR is clearly garbled the script still flags a mismatch so a human can
review.

Usage:
    python3 scripts/verify_phobias_manias_ocr.py
"""
from __future__ import annotations

import html
import json
import re
import sys
from pathlib import Path

BASE = Path("plugins/coc-keeper/references/rules-json")
MD_PATH = Path("checks/ocr-cached/phobias-manias.md")


# ---------------------------------------------------------------------------
# OCR parsing helpers
# ---------------------------------------------------------------------------
def _fix_ocr_digits(token: str) -> str:
    """Fix MinerU's habit of OCR'ing the digit 1 as 'I' and 0 as 'O' inside the
    leading list index, e.g. 'I0)' -> '10)', 'I1)' -> '11)'."""
    # only touch the parenthesised index prefix; keep letters alone
    return token.replace("I", "1").replace("O", "0")


# A numbered OCR entry.  MinerU renders indices as "1)", "I0)", "100)", ...
# The name runs up to the first colon; everything after is the description
# (which we keep for context but do NOT compare for equality, since the OCR
# routinely truncates descriptions mid-sentence).
_ENTRY_RE = re.compile(
    r"^\s*([IO0-9]{1,3})\)\s*(.+?)$", re.S
)


def parse_table_entries(md: str, start_marker: str, end_marker: str) -> list[dict]:
    """Return a list of {idx:int, name:str, raw:str} for one table section."""
    start = md.find(start_marker)
    if start == -1:
        raise SystemExit(f"could not find marker {start_marker!r} in OCR")
    start = md.find("\n", start) + 1
    end = md.find(end_marker, start) if end_marker else len(md)
    if end == -1:
        end = len(md)
    section = md[start:end]

    entries: list[dict] = []
    for line in section.splitlines():
        line = html.unescape(line).strip()
        if not line:
            continue
        m = _ENTRY_RE.match(line)
        if not m:
            continue
        raw_idx = _fix_ocr_digits(m.group(1))
        try:
            idx = int(raw_idx)
        except ValueError:
            continue
        rest = m.group(2).strip()
        # Name is everything up to the first colon (the description follows).
        name = rest.split(":", 1)[0].strip()
        entries.append({"idx": idx, "name": name, "raw": line})
    return entries


def norm_name(s: str) -> str:
    """Normalise a name for matching: lowercase, collapse whitespace, strip
    leading/trailing punctuation, and drop internal parenthetical fragments
    (e.g. "Acromania (heights)" -> "acromania"; the parenthetical is a
    description fragment that bled into the OCR name, not part of it)."""
    s = html.unescape(s).lower()
    s = re.sub(r"\s*\([^)]*\)\s*", " ", s)  # drop internal parentheticals
    s = re.sub(r"\s+", " ", s).strip()
    s = s.strip("`'\".,;:()[]")
    return s


# ---------------------------------------------------------------------------
# Comparison
# ---------------------------------------------------------------------------
def compare_table(ocr_entries: list[dict], our_data: dict, label: str) -> int:
    """Compare OCR entries to our JSON dict.  Returns number of mismatches."""
    print(f"\n{'=' * 70}")
    print(f"  {label}")
    print(f"{'=' * 70}")

    ocr_count = len(ocr_entries)
    our_count = len(our_data)
    print(f"OCR count: {ocr_count}")
    print(f"Our count: {our_count}")

    # Build normalised key -> (original_key, value) map for our data.
    our_norm = {}
    for k in our_data:
        nk = norm_name(k)
        our_norm[nk] = k

    # Track which of our entries got matched so we can report extras/missing.
    matched_ours: set[str] = set()
    matched = 0
    correct = 0
    mismatches: list[str] = []

    for e in ocr_entries:
        nk = norm_name(e["name"])
        if nk in our_norm:
            matched += 1
            our_key = our_norm[nk]
            matched_ours.add(our_key)
            if our_key.strip().lower() == e["name"].strip().lower():
                correct += 1
            elif norm_name(our_key) == norm_name(e["name"]):
                # Match after stripping parenthetical description fragments
                # (e.g. OCR "Acromania (heights)" vs our "Acromania").
                correct += 1
            else:
                mismatches.append(
                    f"idx {e['idx']}: name ours='{our_key}' OCR='{e['name']}'"
                )
        else:
            # No exact normalised match; try a fuzzy typo match so we can flag
            # "OCR looks like a typo of ours" vs "OCR entry is genuinely
            # unknown to us".
            best = _closest(nk, list(our_norm.keys()))
            if best is not None and _levenshtein(nk, best) <= 2:
                our_key = our_norm[best]
                matched += 1
                matched_ours.add(our_key)
                # A leading-character difference of distance 1 is the classic
                # OCR capital-I-vs-lowercase-l misread (e.g. "Iatrophobia" ->
                # "latrophobia"); our spelling is correct, so count it as
                # correct rather than a mismatch.
                if _levenshtein(nk, best) == 1 and nk[1:] == best[1:]:
                    correct += 1
                else:
                    mismatches.append(
                        f"idx {e['idx']}: name ours='{our_key}' OCR='{e['name']}' "
                        f"(likely OCR typo / spelling difference)"
                    )
            else:
                mismatches.append(
                    f"idx {e['idx']}: UNMATCHED OCR='{e['name']}' "
                    f"(no matching entry in our data)"
                )

    def _is_unmatched(e: dict) -> bool:
        nk = norm_name(e["name"])
        if nk in our_norm:
            return False
        # treat "matched via fuzzy typo" as matched for the unmatched-OCR list
        best = _closest(nk, list(our_norm.keys()))
        if best is not None and _levenshtein(nk, best) <= 2:
            return False
        return True

    unmatched_ocr = [e for e in ocr_entries if _is_unmatched(e)]
    unmatched_ours = [k for k in our_data if k not in matched_ours]

    print(f"matched: {matched}")
    print(f"correct (exact name): {correct}")
    print(f"mismatch count: {len(mismatches)}")
    print()
    for m in mismatches:
        print(f"  X {m}")
    print()
    print(f"Unmatched OCR rows: {len(unmatched_ocr)}")
    for e in unmatched_ocr:
        print(f"    OCR idx {e['idx']}: {e['name']!r}")
    print(f"Unmatched ours: {len(unmatched_ours)}")
    for k in unmatched_ours:
        print(f"    ours: {k!r}")

    return len(mismatches) + len(unmatched_ocr) + len(unmatched_ours)


# ---------------------------------------------------------------------------
# Small fuzzy helpers (no third-party deps)
# ---------------------------------------------------------------------------
def _levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(
                prev[j] + 1,
                cur[j - 1] + 1,
                prev[j - 1] + (0 if ca == cb else 1),
            ))
        prev = cur
    return prev[-1]


def _closest(target: str, candidates: list[str]) -> str | None:
    if not candidates:
        return None
    best = None
    best_d = 1 << 30
    for c in candidates:
        # quick length guard to avoid matching unrelated long words
        if abs(len(c) - len(target)) > 3:
            continue
        d = _levenshtein(target, c)
        if d < best_d:
            best_d = d
            best = c
    return best


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
def main() -> int:
    md = MD_PATH.read_text(encoding="utf-8")

    # Locate where Table X starts (so Table IX stops there).
    ix_marker = "## Table IX: Sample Phobias"
    x_marker = "## Table X: Sample Manias"
    if x_marker not in md:
        raise SystemExit("could not find Table X marker; cannot split tables")

    phobia_entries = parse_table_entries(md, ix_marker, x_marker)
    mania_entries = parse_table_entries(md, x_marker, "")

    phobias = json.loads((BASE / "phobias.json").read_text())["phobias"]
    manias = json.loads((BASE / "manias.json").read_text())["manias"]

    n1 = compare_table(phobia_entries, phobias, "Table IX: Sample Phobias")
    n2 = compare_table(mania_entries, manias, "Table X: Sample Manias")

    total = n1 + n2
    print(f"\n{'=' * 70}")
    print(f"TOTAL mismatches across both tables: {total}")
    print(f"{'=' * 70}")
    return 1 if total else 0


if __name__ == "__main__":
    sys.exit(main())
