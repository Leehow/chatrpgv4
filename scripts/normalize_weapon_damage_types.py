#!/usr/bin/env python3
"""Normalize weapon damage-type modeling.

Before: damage_die mixed dice + tags ('2D6+burn', '1D3+stun'), impales was a
bool, shotguns were wrongly flagged impale=True.

After: damage_die is a pure dice expression ('2D6', '1D3'). A new damage_type
field classifies the weapon: 'normal' | 'impale' | 'burn' | 'stun'. The legacy
impales bool is kept (True only for impale type) for backward compatibility.
burn/stun weapons keep a status_effect note.

Damage type is inferred from the weapon's tags + name, per rulebook p97/p406:
  - impale: marked (i) in Table XVII (firearms except shotguns, blades, spears)
  - burn:   fire weapons (molotov, flamethrower, burning torch, flare)
  - stun:   electrical/chemical (taser, mace spray, live wire)
  - normal: bludgeons, shotguns (cannot impale per p97)

Usage:
    python3 scripts/normalize_weapon_damage_types.py --apply
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

BASE = Path("plugins/coc-keeper/references/rules-json")


def infer_damage_type(key: str, entry: dict) -> str:
    """Infer the canonical damage type from tags + name."""
    dd = str(entry.get("damage_die", ""))
    sp = str(entry.get("special", ""))
    name = str(entry.get("display_name", key)).lower()
    blob = (dd + " " + sp + " " + name).lower()
    # burn takes precedence (fire weapons)
    if "burn" in blob:
        return "burn"
    if "stun" in blob:
        return "stun"
    # shotguns cannot impale (rulebook p97), unless slug
    if "shotgun" in name and "slug" not in name:
        return "normal"
    if entry.get("impales") is True:
        return "impale"
    # default
    return "normal"


def clean_damage_die(damage_die: str) -> tuple[str, str | None]:
    """Strip burn/stun tags from a damage_die, returning (clean_dice, status_note)."""
    dd = str(damage_die)
    status = None
    # '1D6+burn' / '2D6+Burn' -> '1D6', status 'burn'
    m = re.match(r"^(.+?)\s*\+\s*(burn|stun)\s*$", dd, re.I)
    if m:
        status = m.group(2).lower()
        return m.group(1).strip().rstrip("+").strip(), status
    # '1D10+1D3 burn' (space-separated)
    m = re.match(r"^(.+?)\s+(burn|stun)\s*$", dd, re.I)
    if m:
        status = m.group(2).lower()
        return m.group(1).strip(), status
    # pure 'Stun' (no dice)
    if dd.strip().lower() in ("stun", "burn"):
        return "", dd.strip().lower()
    return dd.strip(), status


def main() -> int:
    apply = "--apply" in sys.argv
    for plugin in ("plugins/coc-keeper", "plugins/coc-keeper-zcode"):
        path = Path(plugin) / "references" / "rules-json" / "weapons.json"
        data = json.loads(path.read_text())
        weapons = data["weapons"]
        changed = 0
        for key, entry in weapons.items():
            dtype = infer_damage_type(key, entry)
            clean_dd, status = clean_damage_die(entry.get("damage_die", ""))
            new_entry = dict(entry)
            new_entry["damage_type"] = dtype
            new_entry["damage_die"] = clean_dd if clean_dd else entry.get("damage_die", "")
            # keep impales bool in sync (impale type => True, else False)
            new_entry["impales"] = (dtype == "impale")
            if status:
                new_entry["status_effect"] = status
            elif "status_effect" in new_entry:
                del new_entry["status_effect"]
            if new_entry != entry:
                weapons[key] = new_entry
                changed += 1
        if apply:
            path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
        print(f"{plugin}: {changed}/{len(weapons)} weapons normalized")
    # stats
    if apply:
        data = json.loads((BASE / "weapons.json").read_text())
        from collections import Counter
        c = Counter(v.get("damage_type") for v in data["weapons"].values())
        print(f"\nDamage type distribution: {dict(c)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
