#!/usr/bin/env python3
"""Verify spells.json cost_mp against MinerU OCR of the Grimoire.

Each spell in the OCR has a "Cost: <X> magic points" line. This script
extracts those and compares to our cost_mp field.

Usage:
    python3 scripts/verify_spells_ocr.py
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

BASE = Path("plugins/coc-keeper/references/rules-json")
MD_PATH = Path("pdf/Call Of Cthulhu Keeper Rulebook 40th Anniversary (Sandy Petersen)_mineru/Call Of Cthulhu Keeper Rulebook 40th Anniversary (Sandy Petersen)/auto/Call Of Cthulhu Keeper Rulebook 40th Anniversary (Sandy Petersen).md")


def parse_spell_costs(md: str) -> dict[str, str]:
    """Extract {spell_name: cost_text} from OCR. Spell names appear as
    Markdown headings (## Name or # Name) followed by a 'Cost:' line."""
    results = {}
    # Pattern: heading line, optional blank/alias lines, then Cost: line
    for m in re.finditer(
        r'^#{1,3}\s+([A-Z][A-Za-z][A-Za-z\-\'/ ,]{2,60}?)\s*\n'
        r'(?:[^\n]*\n){0,4}?'
        r'\s*Cost:\s*(.+?)(?:\n|$)',
        md,
        re.M,
    ):
        name = m.group(1).strip().rstrip(":")
        cost = m.group(2).strip()
        if len(name) < 3 or name.lower().startswith("cost"):
            continue
        # keep first occurrence (primary entry)
        if name not in results:
            results[name] = cost
    return results


def extract_mp_number(cost_str: str) -> str:
    """Extract the leading magic-point number/expression from a cost string
    like '10 magic points, 5 POW and 2D10 Sanity' -> '10'."""
    m = re.match(r'\s*(\d+(?:D\d+)?(?:\+\d+)?|\d+D\d+\+\d+|variable|\d+\+)', cost_str, re.I)
    if m:
        return m.group(1)
    return cost_str[:20]


def norm(s: str) -> str:
    return re.sub(r"[\s\-\'/]", "", s.lower())


def match_spell(pdf_name: str, our_spells: list) -> dict | None:
    target = norm(pdf_name)
    for s in our_spells:
        sn = norm(s.get("name", ""))
        if sn == target:
            return s
        if len(sn) > 4 and (sn.startswith(target) or target.startswith(sn)):
            return s
    return None


def main() -> int:
    md = MD_PATH.read_text(encoding="utf-8")
    spells = json.loads((BASE / "spells.json").read_text())["spells"]
    pdf_costs = parse_spell_costs(md)
    print(f"OCR Grimoire: {len(pdf_costs)} 法术 Cost 行")
    print(f"我们 spells.json: {len(spells)} 法术\n")

    matched = 0
    correct = 0
    wrong = []
    for pdf_name, pdf_cost in pdf_costs.items():
        s = match_spell(pdf_name, spells)
        if not s:
            continue
        matched += 1
        our_mp = str(s.get("cost_mp", "")).strip()
        pdf_mp = extract_mp_number(pdf_cost)
        # normalize
        on = our_mp.replace(" ", "")
        pn = pdf_mp.replace(" ", "")
        if on == pn or on.rstrip("+") == pn.rstrip("+"):
            correct += 1
        else:
            wrong.append(f"{s['name']}: cost_mp ours='{our_mp}' OCR='{pdf_mp}' (raw: {pdf_cost[:50]})")

    print(f"匹配: {matched}")
    print(f"MP 消耗正确: {correct}")
    print(f"MP 消耗不一致: {len(wrong)}")
    for w in wrong[:20]:
        print(f"  ❌ {w}")
    print(f"\n结论: {correct} 法术 MP 消耗 OCR 一致")
    return 1 if wrong else 0


if __name__ == "__main__":
    sys.exit(main())
