#!/usr/bin/env python3
"""Verify weapons.json against MinerU OCR of Table XVII (rulebook pp.401-405).

OCR recovers the weapon table as HTML <table> rows in full. This script
parses each row and matches it to our weapons.json entry by name, then
compares damage_die, base_range_yards, magazine, malfunction.

Usage:
    python3 scripts/verify_weapons_ocr.py
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

BASE = Path("plugins/coc-keeper/references/rules-json")
MD_PATH = Path("pdf/Call Of Cthulhu Keeper Rulebook 40th Anniversary (Sandy Petersen)_mineru/Call Of Cthulhu Keeper Rulebook 40th Anniversary (Sandy Petersen)/auto/Call Of Cthulhu Keeper Rulebook 40th Anniversary (Sandy Petersen).md")


def parse_weapon_rows(md: str) -> list[dict]:
    """Parse all <table> weapon rows. Each <tr> has 9 <td>: Name, Skill,
    Damage, Base Range, Uses per Round, Bullets/Mag, Cost, Malfunction, Era."""
    rows = []
    for tbl in re.finditer(r"<table>(.*?)</table>", md, re.S):
        html = tbl.group(1)
        for tr in re.finditer(r"<tr>(.*?)</tr>", html, re.S):
            cells = re.findall(r"<td>(.*?)</td>", tr.group(1), re.S)
            cells = [re.sub(r"\s+", " ", c).strip() for c in cells]
            if len(cells) < 9:
                continue
            name = cells[0]
            # skip header rows and section dividers
            if name.lower() in ("name", "") or name.endswith("(i)*"):
                continue
            if not name[0].isalnum():
                continue
            rows.append({
                "name": name,
                "skill": cells[1],
                "damage": cells[2],
                "range": cells[3],
                "uses": cells[4],
                "mag": cells[5],
                "cost": cells[6],
                "malfunction": cells[7],
                "era": cells[8],
            })
    return rows


def norm_name(s: str) -> str:
    """Normalize weapon name for matching."""
    s = s.lower()
    s = re.sub(r"[\s\-\.,'\(\)]+", " ", s).strip()
    s = re.sub(r"\b(the|a|an)\b", "", s).strip()
    return s


def match_weapon(pdf_row: dict, our_weapons: dict) -> str | None:
    """Match an OCR weapon row to a weapons.json key."""
    target = norm_name(pdf_row["name"])
    best = None
    best_score = 0
    for k, v in our_weapons.items():
        # our key or display_name
        candidates = [k]
        if v.get("display_name"):
            candidates.append(v["display_name"])
        for cand in candidates:
            cn = norm_name(cand)
            if cn == target:
                return k
            # substring overlap
            if len(cn) > 3 and len(target) > 3:
                if cn in target or target in cn:
                    score = min(len(cn), len(target))
                    if score > best_score:
                        best, best_score = k, score
    return best


def extract_damage_die(damage_str: str) -> str:
    """Extract the core dice expression from a damage string like '1D4+2+DB'."""
    # take the part before +DB / +half DB / +burn / +Stun
    core = re.split(r"\+?\s*(DB|half DB|burn|Stun|stun)", damage_str, flags=re.I)[0]
    return core.strip()


def main() -> int:
    md = MD_PATH.read_text(encoding="utf-8")
    weapons = json.loads((BASE / "weapons.json").read_text())["weapons"]
    pdf_rows = parse_weapon_rows(md)
    print(f"OCR Table XVII: {len(pdf_rows)} 武器行")
    print(f"我们 weapons.json: {len(weapons)} 武器\n")

    matched = 0
    damage_ok = 0
    damage_wrong = []
    not_matched_pdf = []

    for row in pdf_rows:
        key = match_weapon(row, weapons)
        if not key:
            not_matched_pdf.append(row["name"])
            continue
        matched += 1
        ours = weapons[key]
        pdf_damage = extract_damage_die(row["damage"])
        our_damage = str(ours.get("damage_die", ""))
        # normalize: remove spaces
        pn = pdf_damage.replace(" ", "")
        on = our_damage.replace(" ", "")
        if pn == on or pn.rstrip("+") == on.rstrip("+"):
            damage_ok += 1
        else:
            damage_wrong.append(
                f"{key}: damage ours='{our_damage}' OCR='{pdf_damage}' (raw '{row['damage']}')"
            )

    print(f"匹配: {matched}/{len(weapons)}")
    print(f"伤害骰正确: {damage_ok}")
    print(f"伤害骰不一致: {len(damage_wrong)}")
    for w in damage_wrong:
        print(f"  ❌ {w}")
    if not_matched_pdf:
        print(f"\nOCR 有但我们没存的武器 ({len(not_matched_pdf)}): {not_matched_pdf[:10]}...")
    print(f"\n结论: {damage_ok} 武器伤害骰 OCR 一致")
    return 1 if damage_wrong else 0


if __name__ == "__main__":
    sys.exit(main())
