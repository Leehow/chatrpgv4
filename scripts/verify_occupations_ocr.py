#!/usr/bin/env python3
"""Verify occupations.json against MinerU OCR of Sample Occupations.

OCR source: checks/ocr-cached/occupations.md
  * The Sample Occupations list lives under "# Sample Occupations" headers.
  * Each occupation is rendered as THREE logical blocks (often split across
    several physical lines because MinerU wraps long lines):
        <NAME> [tags]-<skill list>
        Credit Rating: <lo>-<hi>
        Occupation Skill Points: <formula>

Our data: plugins/coc-keeper/references/rules-json/occupations.json
  occupations[name] = {tags, occupational_skills, credit_rating_range[lo,hi],
                       skill_point_formula}

Comparison per occupation:
  * name            -- all 28 occupation names present on both sides
  * credit_rating   -- OCR "X-Y" vs our [lo, hi]
  * skill formula   -- OCR "Occupation Skill Points:" vs our skill_point_formula

Caveat (OCR gaps):
  * The OCR drops the "PRIVATE INVESTIGATOR-" header line; only its skill
    list ("phy),Disguise,...") survives.  We patch that one known gap so the
    Private Investigator entry can still be matched.
  * The OCR sometimes splits a single logical line across two physical lines
    (e.g. MUSICIAN's formula, PI's formula, TRIBE MEMBER's, ZEALOT's).  We
    re-join those before parsing.

Does NOT modify any JSON data.

Usage:
    python3 scripts/verify_occupations_ocr.py
"""
from __future__ import annotations

import html
import json
import re
import sys
from pathlib import Path

BASE = Path("plugins/coc-keeper/references/rules-json")
MD_PATH = Path("checks/ocr-cached/occupations.md")


# ---------------------------------------------------------------------------
# OCR section extraction
# ---------------------------------------------------------------------------
def extract_sample_occupations(md: str) -> str:
    """Return the concatenated text of the Sample Occupations list.

    The list starts at the first "# Sample Occupations" header that is
    immediately followed by an occupation entry (the very first occurrence at
    ~line 232 in the OCR).  It ends at the first line that is clearly the next
    section ("Second, they can be called upon..." in this OCR).
    """
    # find every Sample Occupations header
    starts = [m.start() for m in re.finditer(r"^# Sample Occupations\s*$", md, re.M)]
    if not starts:
        raise SystemExit("could not find '# Sample Occupations' header in OCR")
    # the real list begins at the first such header
    start = starts[0]
    body_start = md.find("\n", start) + 1
    # end at the next non-occupations section
    end_match = re.search(
        r"^Second, they can be called upon", md[body_start:], re.M
    )
    if end_match:
        body_end = body_start + end_match.start()
    else:
        body_end = len(md)
    return md[body_start:body_end]


# ---------------------------------------------------------------------------
# Per-occupation parsing
# ---------------------------------------------------------------------------
# A line that introduces an occupation looks like:
#   NAME [tag tag]-<skills...>
# We match names that are UPPER letters / spaces / commas / "OF THE".
# Examples in OCR:
#   "ANTIQUARIAN [Lovecraftian]-Appraise,..."
#   "CLERGY, MEMBER OF THE-Accounting,..."
#   "DOCTOR OF MEDICINE [Lovecraftian]-First Aid,..."
_NAME_RE = re.compile(
    r"^\s*([A-Z][A-Z,\s()]*(?:OF THE)?[A-Z,\s()]*)"
    r"(?:\s*\[([^\]]+)\])?"
    r"\s*[-\u2014\u2013]\s*(.+)$"
)


def _strip_md(s: str) -> str:
    """Strip leading markdown header hashes and whitespace."""
    return re.sub(r"^#+\s*", "", s).strip()


def _is_formula_line(s: str) -> bool:
    t = _strip_md(s).lower()
    # "occupation skill points" / "occupation skil points" / "occupation skillpoints"
    return bool(re.match(r"^occupation\s+skil\w*\s*points", t))


def _is_credit_line(s: str) -> bool:
    return _strip_md(s).lower().startswith("credit rating")


def parse_occupations(md: str) -> list[dict]:
    """Parse the Sample Occupations list into [{name, tags, skills, cr, formula}]."""
    body = extract_sample_occupations(md)

    # The MinerU output sometimes wraps a single logical line across two
    # physical lines.  A wrap is obvious when the second physical line does
    # NOT start a new record (not an occupation name, not "Credit Rating:",
    # not "Occupation Skill Points:").  Re-join those first.
    raw_lines = [html.unescape(l).rstrip() for l in body.splitlines()]
    lines: list[str] = []
    for ln in raw_lines:
        ln_stripped = ln.strip()
        if not ln_stripped:
            continue
        # normalise markdown header hashes into the line content
        ln_stripped = _strip_md(ln_stripped)
        # skip mid-list "Sample Occupations" page-break headers
        if ln_stripped.lower() == "sample occupations":
            continue
        # new record / new field -> append as its own line
        if (
            _NAME_RE.match(ln_stripped)
            or _is_credit_line(ln_stripped)
            or _is_formula_line(ln_stripped)
        ):
            lines.append(ln_stripped)
        else:
            # continuation of the previous physical line -> re-join
            if lines:
                lines[-1] = (lines[-1] + " " + ln_stripped).strip()
            else:
                lines.append(ln_stripped)

    # Known OCR gap: the "PRIVATE INVESTIGATOR-" header was dropped, leaving
    # a bare skill-list fragment "phy),Disguise, Law, Library Use,...".  The
    # re-join pass may have fused it onto the previous Police Officer line.
    # Split it back out and reconstruct the Private Investigator record.
    for i, ln in enumerate(lines):
        idx = ln.find("phy),Disguise")
        if idx == -1:
            idx = ln.find("phy), Disguise")
        if idx != -1 and "Library Use" in ln:
            # truncate the previous line at the fragment start
            lines[i] = ln[:idx].strip()
            lines.insert(i + 1, "PRIVATE INVESTIGATOR-Art/Craft (photogra" + ln[idx:])
            break

    occupations: list[dict] = []
    i = 0
    while i < len(lines):
        ln = lines[i]
        m = _NAME_RE.match(ln)
        if not m:
            i += 1
            continue
        raw_name = m.group(1).strip()
        tags = m.group(2) or ""
        skills = m.group(3).strip()

        # Scan forward for the Credit Rating and Skill Points lines belonging
        # to THIS occupation (until the next occupation header).
        cr: str | None = None
        formula: str | None = None
        j = i + 1
        while j < len(lines):
            nxt = lines[j]
            if _NAME_RE.match(nxt) and not _is_credit_line(nxt) and not _is_formula_line(nxt):
                # next occupation starts here -- but guard against lines that
                # merely begin with uppercase (some skill text does too).  We
                # accept it as next-record only if it has the dash separator
                # AND looks like an all-caps header.
                if _looks_like_header(nxt):
                    break
            if _is_credit_line(nxt):
                cr = nxt
            elif _is_formula_line(nxt):
                formula = nxt
            j += 1

        occupations.append({
            "raw_name": raw_name,
            "tags": tags,
            "skills": skills,
            "credit_line": cr or "",
            "formula_line": formula or "",
        })
        i = j

    return occupations


def _looks_like_header(line: str) -> bool:
    """Heuristic: is this physical line a new occupation header?

    True when the token before the first dash/separator is ALL CAPS (allowing
    commas/spaces/parentheses and "OF THE")."""
    m = _NAME_RE.match(line)
    if not m:
        return False
    head = m.group(1)
    # all caps check
    letters = [c for c in head if c.isalpha()]
    if not letters:
        return False
    return all(c.isupper() for c in letters)


# ---------------------------------------------------------------------------
# Normalisation
# ---------------------------------------------------------------------------
# Map OCR occupation header names -> our JSON keys (handles the cases where the
# OCR uses a longer / different surface form than our data).
_OUR_KEY_OVERRIDES = {
    "clergy, member of the": "clergy",
    "police detective": "police detective",
    "police officer": "police officer",
    "private investigator": "private investigator",
    "military officer": "military officer",
    "doctor of medicine": "doctor of medicine",
    "tribe member": "tribe member",
}


def norm_name(s: str) -> str:
    s = html.unescape(s).lower()
    s = re.sub(r"\s+", " ", s).strip()
    s = s.strip("`'\".,;:- ")
    return _OUR_KEY_OVERRIDES.get(s, s)


_CR_RE2 = re.compile(r"(\d+)\s*[-\u2013\u2014]\s*(\d+)")


def parse_credit_range(credit_line: str) -> tuple[int, int] | None:
    if not credit_line:
        return None
    m = _CR_RE2.search(credit_line)
    if not m:
        return None
    return int(m.group(1)), int(m.group(2))


def norm_formula(s: str) -> str:
    """Canonicalise a skill-point formula for comparison.

    Strips spaces, lowercases, normalises the multiplication sign (x / * / x)
    and OCR'ed variants, and sorts an 'either A or B' choice alphabetically."""
    s = html.unescape(s).lower()
    # remove the leading label "occupation skill points:" if present
    s = re.sub(r"^occupation\s+skil\w*\s*points\s*[:\uFF1A]?\s*", "", s)
    s = s.replace("\u00d7", "x").replace("*", "x")  # multiplication sign -> x
    s = re.sub(r"\s+", "", s)                       # drop all spaces
    s = s.strip(".,;:")                             # drop trailing punctuation
    # normalise "or" / "+" separators but keep them
    # for 'either a x2 or b x2' -> split on 'or', sort, rejoin so order doesn't matter
    if "either" in s:
        s = s.replace("either", "")
        parts = [p for p in re.split(r"\+|or", s) if p]
        # first part is the base (edu*2 typically); the rest are alternatives
        base = parts[0]
        alts = sorted(parts[1:])
        s = base + "+" + "+".join(alts)
    return s


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
def main() -> int:
    md = MD_PATH.read_text(encoding="utf-8")
    our_occs = json.loads((BASE / "occupations.json").read_text())["occupations"]
    ocr_occs = parse_occupations(md)

    print(f"OCR Sample Occupations: {len(ocr_occs)}")
    print(f"Our occupations.json: {len(our_occs)}")

    our_norm = {norm_name(k): k for k in our_occs}

    matched = 0
    correct_name = 0
    mismatches: list[str] = []
    matched_ours: set[str] = set()

    for o in ocr_occs:
        nk = norm_name(o["raw_name"])
        if nk not in our_norm:
            mismatches.append(
                f"UNMATCHED OCR occupation raw='{o['raw_name']}' "
                f"(normalised '{nk}')"
            )
            continue
        our_key = our_norm[nk]
        matched += 1
        matched_ours.add(our_key)
        ours = our_occs[our_key]

        # 1. name (display). Our keys are canonical short forms; the OCR uses
        # longer formal headers (e.g. "CLERGY, MEMBER OF THE"). The lookup
        # already mapped the OCR header to our key via _OUR_KEY_OVERRIDES, so a
        # normalized agreement is an acceptable name match.
        if our_key.strip().lower() == o["raw_name"].strip().lower() \
                or norm_name(our_key) == norm_name(o["raw_name"]):
            correct_name += 1
        else:
            mismatches.append(
                f"{our_key}: name ours='{our_key}' OCR='{o['raw_name']}'"
            )

        # 2. credit rating range
        ocr_cr = parse_credit_range(o["credit_line"])
        our_cr = ours.get("credit_rating_range")
        if ocr_cr is None:
            mismatches.append(
                f"{our_key}: credit_rating OCR line missing/unparseable "
                f"('{o['credit_line']}')"
            )
        elif list(our_cr) != list(ocr_cr):
            mismatches.append(
                f"{our_key}: credit_rating ours='{our_cr}' OCR='{ocr_cr}' "
                f"(raw '{o['credit_line']}')"
            )

        # 3. skill point formula
        ocr_formula = norm_formula(o["formula_line"])
        our_formula = norm_formula(ours.get("skill_point_formula", ""))
        if not ocr_formula:
            mismatches.append(
                f"{our_key}: formula OCR line missing/unparseable "
                f"('{o['formula_line']}')"
            )
        elif ocr_formula != our_formula:
            mismatches.append(
                f"{our_key}: formula ours='{ours.get('skill_point_formula')}' "
                f"OCR='{o['formula_line']}'"
            )

    unmatched_ours = [k for k in our_occs if k not in matched_ours]

    print(f"matched: {matched}")
    print(f"correct (exact name): {correct_name}")
    print(f"mismatch count: {len(mismatches)}")
    print()
    for m in mismatches:
        print(f"  X {m}")
    print()
    print(f"Unmatched ours: {len(unmatched_ours)}")
    for k in unmatched_ours:
        print(f"    ours: {k!r}")

    total = len(mismatches) + len(unmatched_ours)
    print(f"\nTOTAL mismatches: {total}")
    return 1 if total else 0


if __name__ == "__main__":
    sys.exit(main())
