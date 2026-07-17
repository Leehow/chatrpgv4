#!/usr/bin/env python3
"""Verify skills.json base_chance values against cached OCR of the Skill List
(rulebook p56, Chapter Four).

OCR source (source of truth): checks/ocr-cached/skills-ch4.md
The OCR is a two-column skill list that MinerU linearized. Each skill appears
as ``Name (NN%)`` (the base chance in parens), sometimes followed by a
cross-reference like "-see Science" (specializations whose base chance is
defined under another skill). Modern-only skills carry a trailing marker.

This script extracts each ``Name (NN%)`` entry, matches it to our skills.json
key, and compares the base_chance integer.

Usage:
    uv run --frozen python scripts/verify_skills_ocr.py
Exit 0 = all matched skills agree; 1 = mismatches found.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

BASE = Path("plugins/coc-keeper/references/rules-json")
MD_PATH = Path("checks/ocr-cached/skills-ch4.md")


def parse_skill_entries(md: str) -> dict[str, int]:
    """Extract {skill_name: base_chance} from the OCR skill list.

    Matches lines like ``Accounting (05%)`` or ``Firearms (varies)``. Skills
    whose base chance is ``varies`` or a non-numeric token are skipped (they
    are group/specialization headers, not single-value skills). Cross-reference
    suffixes like ``-see Science`` are stripped from the name.
    """
    results: dict[str, int] = {}
    # Pattern: a skill name followed by (NN%) — the name may contain letters,
    # spaces, hyphens, apostrophes, slashes, ampersands. The chance is 1-2
    # digits in parens with a % sign.
    pat = re.compile(r"([A-Z][A-Za-z][A-Za-z0-9 \-/'&]+?)\s*\((\d{1,2})%\)")
    for line in md.splitlines():
        # Strip cross-reference and marker suffixes for cleaner matching, but
        # keep the original line for the regex (the (NN%) must precede them).
        for m in pat.finditer(line):
            name = m.group(1).strip()
            # drop a trailing "-see ..." cross-reference if the regex captured it
            name = re.sub(r"\s*-?\s*see\s+.*$", "", name, flags=re.I).strip()
            # drop trailing modern/uncommon markers (☆, Ω, ×, etc.) and hyphens
            name = name.rstrip(" -☆Ω×").strip()
            if len(name) < 3:
                continue
            chance = int(m.group(2))
            # keep first occurrence (the skill list may repeat group headers)
            if name not in results:
                results[name] = chance
    return results


def norm_name(s: str) -> str:
    """Normalize a skill name for matching."""
    s = s.lower()
    s = re.sub(r"[\s\-/'&]+", " ", s).strip()
    return s


def match_skill(ocr_name: str, our_skills: dict) -> str | None:
    """Match an OCR skill name to a skills.json key.

    The OCR skill list has two forms:
      - top-level skills: ``Accounting (05%)`` -> key 'Accounting'
      - specializations: ``Brawl (25%)-see Fighting`` -> key 'Fighting (Brawl)'
        (the OCR lists the specialization name with a -see <Group> cross-ref).
    """
    target = norm_name(ocr_name)
    # exact
    for k in our_skills:
        if norm_name(k) == target:
            return k
    # specialization: our keys are "<Group> (<Spec>)"; the OCR lists "<Spec>".
    # Match if our key's parenthetical equals the OCR name.
    for k in our_skills:
        m = re.match(r"^(.+?)\s*\(([^)]+)\)$", k)
        if m and norm_name(m.group(2)) == target:
            return k
    # leading-token overlap (e.g. "Art and Craft" vs "Art/Craft")
    best, best_score = None, 0
    target_toks = target.split()
    for k in our_skills:
        ktoks = norm_name(k).split()
        if len(target_toks) >= 2 and len(ktoks) >= 1:
            if ktoks[0] == target_toks[0]:
                score = len(ktoks)
                if score > best_score:
                    best, best_score = k, score
    return best


def main() -> int:
    md = MD_PATH.read_text(encoding="utf-8")
    data = json.loads((BASE / "skills.json").read_text(encoding="utf-8"))
    skills = data["skills"]
    ocr_entries = parse_skill_entries(md)
    print(f"OCR Skill List entries: {len(ocr_entries)}")
    print(f"Our skills.json: {len(skills)} skills\n")

    matched = 0
    correct = 0
    mismatches: list[str] = []
    matched_ours: set[str] = set()

    for ocr_name, ocr_chance in ocr_entries.items():
        key = match_skill(ocr_name, skills)
        if not key:
            continue
        matched += 1
        matched_ours.add(key)
        our_chance = skills[key].get("base_chance")
        if our_chance is None:
            continue
        if int(our_chance) == int(ocr_chance):
            correct += 1
        else:
            mismatches.append(
                f"{key}: base_chance ours={our_chance} OCR={ocr_chance} "
                f"(OCR name '{ocr_name}')"
            )

    unmatched_ours = sorted(set(skills) - matched_ours)

    print(f"Matched: {matched}")
    print(f"Correct: {correct}")
    print(f"Mismatches: {len(mismatches)}")
    for m in mismatches:
        print(f"  X {m}")
    if unmatched_ours:
        print(f"\nOur skills with no OCR entry ({len(unmatched_ours)}):")
        for k in unmatched_ours:
            print(f"  ? {k} (base={skills[k].get('base_chance')})")
    print(f"\nResult: {len(mismatches)} mismatch(es).")
    return 1 if mismatches else 0


if __name__ == "__main__":
    sys.exit(main())
