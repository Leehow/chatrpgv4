#!/usr/bin/env python3
"""Gap auditor for coc-keeper rule tables.

Quantifies how complete each structured rule table is vs the rulebook, and
checks for structural gaps (missing rule-ids, parity, unresolved PARTIAL
items). Emits a machine-readable report the zralph detect->fix->verify loop
consumes to decide what to work on next.

Exit code 0 = no gaps; non-zero = gaps remain (used by the loop to know
whether to keep iterating).

Run:
    python3 scripts/gap_audit.py [--plugin-root plugins/coc-keeper]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Expected minimum row counts per table (from the rulebook).
# A table is "complete" when it has >= the expected count. These are floor
# values derived from the coverage audit; the rulebook often has a few more.
# ---------------------------------------------------------------------------
EXPECTED_MIN_COUNTS = {
    "weapons": (25, "weapons"),
    "skills": (78, "skills"),          # ~80 incl specializations
    "characteristic-dice": (9, "characteristics"),
    "occupations": (28, "occupations"),
    "spells": (80, "spells"),          # Grimoire ~85
    "tomes": (15, "tomes"),
    "monsters": (25, "monsters"),
    "phobias": (28, "phobias"),        # p160
    "manias": (22, "manias"),          # p161
    "poisons": (7, "poisons"),
    "artifacts": (6, "artifacts"),
}

# bout-tables and equipment have nested structure; check separately.
EXPECTED_BOUT = {"realtime": 15, "summary": 15}   # Tables VII/VIII
EXPECTED_EQUIP = {"1920s": 15, "modern": 15}      # p396-399

# Missing rule-ids the coverage audit flagged as still-unresolved PARTIAL.
# These should exist in rule-index.json for the audit to pass.
EXPECTED_RULE_IDS = {
    "core.development.tick",
    "core.development.improvement_roll",
    "core.luck.spend",
    "core.luck.recovery",
    "core.luck.roll",
    "core.sanity.max_formula",
}


def _load_table(root: Path, name: str) -> dict | list:
    path = root / "references" / "rules-json" / f"{name}.json"
    return json.loads(path.read_text(encoding="utf-8"))


def _count(d, key):
    """Return len of dict-or-list at d[key], or 0."""
    v = d.get(key, []) if isinstance(d, dict) else []
    return len(v)


def audit_data_counts(root: Path) -> list[str]:
    """Section A: tables with fewer rows than expected."""
    gaps = []
    for table, (expected, key) in EXPECTED_MIN_COUNTS.items():
        try:
            d = _load_table(root, table)
        except (FileNotFoundError, json.JSONDecodeError) as e:
            gaps.append(f"[A] {table}.json: UNREADABLE ({e})")
            continue
        actual = _count(d, key)
        if actual < expected:
            gaps.append(
                f"[A] {table}.json [{key}]: {actual}/{expected} rows "
                f"({actual * 100 // expected}% — need {expected - actual} more)"
            )
    # bout-tables
    try:
        bout = _load_table(root, "bout-tables")
        for sub, exp in EXPECTED_BOUT.items():
            actual = _count(bout, sub)
            if actual < exp:
                gaps.append(f"[A] bout-tables.json [{sub}]: {actual}/{exp}")
    except (FileNotFoundError, json.JSONDecodeError) as e:
        gaps.append(f"[A] bout-tables.json: UNREADABLE ({e})")
    # equipment
    try:
        equip = _load_table(root, "equipment")
        periods = equip.get("periods", {}) if isinstance(equip, dict) else {}
        for period, exp in EXPECTED_EQUIP.items():
            actual = len(periods.get(period, []))
            if actual < exp:
                gaps.append(f"[A] equipment.json [{period}]: {actual}/{exp}")
    except (FileNotFoundError, json.JSONDecodeError) as e:
        gaps.append(f"[A] equipment.json: UNREADABLE ({e})")
    return gaps


def audit_rule_ids(root: Path) -> list[str]:
    """Section B: expected rule-ids missing from rule-index.json."""
    try:
        idx = _load_table(root, "rule-index")
        ids = {r["id"] for r in idx.get("rules", [])}
    except (FileNotFoundError, json.JSONDecodeError) as e:
        return [f"[B] rule-index.json: UNREADABLE ({e})"]
    return [f"[B] missing rule-id: {rid}" for rid in EXPECTED_RULE_IDS if rid not in ids]


def audit_db_extrapolation(root: Path) -> list[str]:
    """Section B: DB/Build table must have a >524 extrapolation rule."""
    try:
        rows = _load_table(root, "damage-bonus-build")
        # rows is a list of {min,max,damage_bonus,build}
        if isinstance(rows, list) and rows:
            last = rows[-1]
            max_total = last.get("max", 0)
            if max_total < 600:
                return [f"[B] damage-bonus-build: caps at {max_total}, no >524 extrapolation"]
    except (FileNotFoundError, json.JSONDecodeError):
        return ["[B] damage-bonus-build.json: UNREADABLE"]
    blob = json.dumps(_load_table(root, "damage-bonus-build"))
    if "extrapolat" not in blob.lower() and "per_80" not in blob.lower():
        return ["[B] damage-bonus-build: no extrapolation field for >524"]
    return []


def audit_teamwork(root: Path) -> list[str]:
    """Section B: combined_roll should have a teamwork field."""
    try:
        combat = _load_table(root, "combat")
        cr = combat.get("combined_roll", {}) if isinstance(combat, dict) else {}
        blob = json.dumps(cr).lower()
        if "teamwork" not in blob:
            return ["[B] combat.json combined_roll: no teamwork field"]
    except (FileNotFoundError, json.JSONDecodeError):
        return ["[B] combat.json: UNREADABLE"]
    return []


def audit_parity(keeper: Path, zcode: Path) -> list[str]:
    """Both plugins must have identical rule-id sets and shared JSON content."""
    gaps = []
    try:
        k_ids = {r["id"] for r in _load_table(keeper, "rule-index").get("rules", [])}
        z_ids = {r["id"] for r in _load_table(zcode, "rule-index").get("rules", [])}
        if k_ids != z_ids:
            gaps.append(f"[C] rule-id set mismatch: only-keeper={k_ids - z_ids} only-zcode={z_ids - k_ids}")
    except (FileNotFoundError, json.JSONDecodeError) as e:
        gaps.append(f"[C] rule-index parity: UNREADABLE ({e})")
    # spot-check a few shared JSON files for byte-content parity
    for name in ("spells", "monsters", "weapons", "skills", "tomes"):
        kf = keeper / "references" / "rules-json" / f"{name}.json"
        zf = zcode / "references" / "rules-json" / f"{name}.json"
        if kf.exists() and zf.exists() and kf.read_text() != zf.read_text():
            gaps.append(f"[C] {name}.json content differs between plugins")
    return gaps


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--plugin-root", default="plugins/coc-keeper")
    ap.add_argument("--zcode-root", default="plugins/coc-keeper-zcode")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()
    root = Path(args.plugin_root)
    zroot = Path(args.zcode_root)

    all_gaps = []
    all_gaps += audit_data_counts(root)
    all_gaps += audit_rule_ids(root)
    all_gaps += audit_db_extrapolation(root)
    all_gaps += audit_teamwork(root)
    all_gaps += audit_parity(root, zroot)

    if all_gaps:
        if not args.quiet:
            print(f"GAP AUDIT: {len(all_gaps)} gap(s) found:")
            for g in all_gaps:
                print(f"  - {g}")
        else:
            print(f"{len(all_gaps)} gaps")
    else:
        print("GAP AUDIT: clean — no gaps detected.")
    # non-zero exit so the loop knows gaps remain
    return 1 if all_gaps else 0


if __name__ == "__main__":
    sys.exit(main())
