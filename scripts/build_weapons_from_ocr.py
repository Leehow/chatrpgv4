#!/usr/bin/env python3
"""Build a complete weapons.json from MinerU OCR of Table XVII.

Merges OCR-extracted weapon rows (90 weapons) into the existing
weapons.json (26 verified weapons). Existing entries are preserved;
new weapons are added with snake_case keys derived from their display
name. Field mapping converts OCR columns to our schema.

Usage:
    python3 scripts/build_weapons_from_ocr.py    # dry-run, prints stats
    python3 scripts/build_weapons_from_ocr.py --apply  # writes both plugins
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

BASE = Path("plugins/coc-keeper/references/rules-json")
MD_PATH = Path("pdf/Call Of Cthulhu Keeper Rulebook 40th Anniversary (Sandy Petersen)_mineru/Call Of Cthulhu Keeper Rulebook 40th Anniversary (Sandy Petersen)/auto/Call Of Cthulhu Keeper Rulebook 40th Anniversary (Sandy Petersen).md")


def parse_ocr(md: str) -> list[dict]:
    rows = []
    for tbl in re.finditer(r"<table>(.*?)</table>", md, re.S):
        html = tbl.group(1)
        for tr in re.finditer(r"<tr>(.*?)</tr>", html, re.S):
            cells = [re.sub(r"\s+", " ", c).strip() for c in re.findall(r"<td>(.*?)</td>", tr.group(1), re.S)]
            if len(cells) < 9:
                continue
            name = cells[0]
            if name.lower() == "name" or not name or not name[0].isalnum():
                continue
            rows.append({
                "name": name, "skill": cells[1], "damage": cells[2],
                "range": cells[3], "uses": cells[4], "mag": cells[5],
                "cost": cells[6], "malfunction": cells[7], "era": cells[8],
            })
    return rows


def to_snake(name: str) -> str:
    """Convert a display name to a stable snake_case key."""
    s = name.lower()
    # strip parenthetical descriptors and asterisks
    s = re.sub(r"\*.*$", "", s)
    s = re.sub(r"\(.*?\)", "", s)
    # remove non-alphanumerics (keep spaces, digits, dots, hyphens)
    s = re.sub(r"[^a-z0-9. \-]", "", s)
    s = s.strip()
    # collapse spaces/dots/hyphens to underscores
    s = re.sub(r"[.\-\s]+", "_", s)
    s = re.sub(r"_+", "_", s).strip("_")
    return s


def parse_damage(damage: str) -> tuple[str, bool, str | None]:
    """Split a damage string into (damage_die, adds_db, special).

    OCR damage forms:
      '1D4+2+DB'           -> die='1D4+2', adds_db=True
      '1D6+half DB'        -> die='1D6', adds_db=True, special='+half DB'
      '1D10+2'             -> die='1D10+2', adds_db=False
      '4D6/2D6/1D6'        -> die='4D6', adds_db=False, special=range-banded
      'Stun' / 'No damage' -> die='', adds_db=False
    """
    special = None
    adds_db = False
    die = damage.strip()
    # detect DB variants
    if "DB" in die:
        adds_db = True
        if "half DB" in die or "1/2 DB" in die:
            special = "+half DB"
            die = re.sub(r"\+?\s*half DB", "", die).strip().rstrip("+").strip()
        else:
            die = re.sub(r"\+?\s*DB", "", die).strip().rstrip("+").strip()
    # shotgun range bands (4D6/2D6/1D6)
    if "/" in die and "D" in die:
        parts = [p.strip() for p in die.split("/") if p.strip()]
        if len(parts) >= 2:
            special = "range-banded: " + "/".join(parts)
            die = parts[0]
    return die, adds_db, special


def parse_range(range_str: str) -> int | None:
    """Extract yards as int, or None for Touch/N/A."""
    r = range_str.strip()
    if not r or r.lower() in ("touch", "n/a", "in place"):
        return None
    m = re.search(r"(\d+)\s*yards?", r, re.I)
    if m:
        return int(m.group(1))
    m = re.search(r"(\d+)\s*feet?", r, re.I)
    if m:
        return int(m.group(1)) // 3 or 1  # rough feet->yards
    m = re.match(r"(\d+)", r)
    if m:
        return int(m.group(1))
    return None


def parse_mag(mag: str) -> int | None:
    m = re.search(r"\d+", mag)
    return int(m.group()) if m else None


def parse_malf(malf: str) -> int | None:
    m = re.search(r"\d+", malf)
    return int(m.group()) if m else None


def parse_eras(era: str) -> list[str]:
    e = era.lower()
    out = []
    if "1920" in e:
        out.append("1920s")
    if "modern" in e:
        out.append("modern")
    if not out:
        out = ["modern"]  # default
    return out


def is_firearm(skill: str) -> bool:
    return skill.lower().startswith("firearms")


def build_entry(row: dict) -> tuple[str, dict]:
    key = to_snake(row["name"])
    damage_die, adds_db, special = parse_damage(row["damage"])
    entry = {
        "display_name": row["name"],
        "skill": row["skill"],
        "damage_die": damage_die,
        "base_range_yards": parse_range(row["range"]),
        "uses_per_round": row["uses"] or "1",
        "magazine": parse_mag(row["mag"]),
        "malfunction": parse_malf(row["malfunction"]),
        "impales": "(i)" in row["name"] or is_firearm(row["skill"]),
        "adds_damage_bonus": adds_db,
        "special": special,
        "eras": parse_eras(row["era"]),
    }
    return key, entry


def main() -> int:
    apply = "--apply" in sys.argv
    md = MD_PATH.read_text(encoding="utf-8")
    ocr_rows = parse_ocr(md)
    existing = json.loads((BASE / "weapons.json").read_text())
    existing_weapons = existing["weapons"]

    # Build a reverse index of existing weapons by normalized display_name
    # so we don't add duplicates when keys differ but names match.
    def norm_name(s: str) -> str:
        s = s.lower()
        s = re.sub(r"[\s\-\.,'\(\)/]", "", s)
        return s
    existing_by_name = {}
    for k, v in existing_weapons.items():
        for cand in (v.get("display_name", ""), k):
            existing_by_name[norm_name(cand)] = k
        # also index the snake_case of display_name
        if v.get("display_name"):
            existing_by_name[norm_name(to_snake(v["display_name"]))] = k

    new_count = 0
    skip_count = 0
    dup_skip = 0
    for row in ocr_rows:
        key, entry = build_entry(row)
        # check existing by key
        if key in existing_weapons:
            skip_count += 1
            continue
        # check existing by normalized display_name (avoid duplicates)
        norm_dn = norm_name(row["name"])
        norm_sk = norm_name(to_snake(row["name"]))
        if norm_dn in existing_by_name or norm_sk in existing_by_name:
            dup_skip += 1
            continue
        # avoid key collisions
        base_key = key
        n = 2
        while key in existing_weapons:
            key = f"{base_key}_{n}"
            n += 1
        existing_weapons[key] = entry
        new_count += 1

    print(f"OCR weapons: {len(ocr_rows)}")
    print(f"Preserved (key match): {skip_count}")
    print(f"Skipped (name dup, different key): {dup_skip}")
    print(f"Added new: {new_count}")
    print(f"Total now: {len(existing_weapons)}")

    if apply:
        for plugin in ("plugins/coc-keeper", "plugins/coc-keeper-zcode"):
            path = Path(plugin) / "references" / "rules-json" / "weapons.json"
            data = json.loads(path.read_text())
            data["weapons"] = existing_weapons
            path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
            print(f"Wrote {path} ({len(existing_weapons)} weapons)")
    else:
        print("\n(dry-run; pass --apply to write)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
