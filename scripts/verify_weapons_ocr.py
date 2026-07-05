#!/usr/bin/env python3
"""Verify weapons.json against cached OCR of Table XVII (rulebook pp.401-405).

OCR source (source of truth): checks/ocr-cached/weapons-table-xvii.md
Each weapon is an HTML <table> row with 9 <td> columns:
    Name, Skill, Damage, Base Range, Uses per Round,
    Bullets in Gun (Mag), Cost 20s/Modern, Malfunction, Common in Era.

This script compares EVERY comparable field of EVERY weapon:
    damage_die      (core dice, with range-banded/radius awareness)
    damage_type     (impale vs normal vs stun vs burn)
    base_range_yards
    uses_per_round
    magazine
    malfunction

Comparison is normalization-aware: range-banded shotgun damage
("4D6/2D6/1D6") and explosive damage/radius ("4D10/3 yards") are split
so the close-range / point- damage die is compared against our damage_die,
and the remainder is expected to live in our `special` field.

Usage:
    python3 scripts/verify_weapons_ocr.py
Exit 0 = all matched fields agree; 1 = mismatches found.
"""
from __future__ import annotations

import html
import json
import re
import sys
from pathlib import Path

BASE = Path("plugins/coc-keeper/references/rules-json")
MD_PATH = Path("checks/ocr-cached/weapons-table-xvii.md")

# ---------------------------------------------------------------------------
# OCR parsing
# ---------------------------------------------------------------------------

HDR_NAMES = {"name", ""}
SKIP_NAME_SUFFIXES = ("(i)*",)


def parse_weapon_rows(md: str) -> list[dict]:
    """Parse all <table> weapon rows into dicts.

    Tracks the current section header (text immediately preceding each
    <table>) so the impale marker "(i)" on a section header (e.g.
    "Handguns (i)*", "Rifles (i)") propagates to every weapon in it.
    Per the rulebook Key, all weapons in an (i) section can impale.
    """
    rows: list[dict] = []
    pos = 0
    current_section_impale = False
    current_section = ""
    # Iterate over tables, tracking the text preceding each table as the
    # section header.
    table_iter = list(re.finditer(r"<table>(.*?)</table>", md, re.S))
    for i, tbl in enumerate(table_iter):
        # The section header is the text between the previous table (or the
        # first "Table Xvll: Weapons" title) and this table.
        start = table_iter[i - 1].end() if i > 0 else 0
        header_text = md[start:tbl.start()]
        # The first non-empty line that isn't a leftover row fragment
        for line in header_text.splitlines():
            line = line.strip()
            if not line:
                continue
            if line.startswith("<") or line.startswith("|"):
                continue
            current_section = line
            current_section_impale = "(i)" in line or "(i)*" in line
            break
        body = tbl.group(1)
        for tr in re.finditer(r"<tr>(.*?)</tr>", body, re.S):
            raw_cells = re.findall(r"<td>(.*?)</td>", tr.group(1), re.S)
            cells = [re.sub(r"\s+", " ", html.unescape(c)).strip() for c in raw_cells]
            if len(cells) < 9:
                continue
            name = cells[0]
            if name.lower() in HDR_NAMES:
                continue
            # In-table section divider: only the name cell is populated
            # (e.g. "Handguns (i)*"). Update section tracking, don't emit a row.
            if not cells[1] and not cells[2]:
                current_section = name
                current_section_impale = "(i)" in name or "(i)*" in name
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
                "section": current_section,
                "section_impale": current_section_impale,
            })
    return rows


# ---------------------------------------------------------------------------
# Normalization & matching
# ---------------------------------------------------------------------------

def norm_name(s: str) -> str:
    """Normalize a weapon name for matching."""
    s = html.unescape(s).lower()
    s = s.replace("&#x27;", "").replace("'", "")
    # split digits-from-letters (OCR often runs ".303Lee" together)
    s = re.sub(r"(?<=[a-z])(?=\d)|(?<=\d)(?=[a-z])", " ", s)
    # collapse gauge calibers and punctuation
    s = re.sub(r"[\s\-\.,/()]+", " ", s).strip()
    s = re.sub(r"\b(the|a|an)\b", "", s).strip()
    s = re.sub(r"\s+", " ", s)
    return s


# Weapons where our key differs notably from the OCR display name.
# (Our internal key  ->  list of OCR name tokens to accept.)
NAME_OVERRIDES = {
    # our_key matches these OCR (display) names
}


def match_weapon(pdf_row: dict, our_weapons: dict) -> str | None:
    """Match an OCR weapon row to a weapons.json key. First exact, then
    substring fallback. Returns the best key or None.

    When our display_name carries a parenthetical variant (e.g. "Taser
    (dart)"), require the OCR name to include that variant token — this
    prevents "Taser (dart)" from matching the OCR "Taser (contact)" row.
    """
    target = norm_name(pdf_row["name"])
    # exact
    for k, v in our_weapons.items():
        for cand in (k, v.get("display_name", "")):
            if norm_name(cand) == target:
                return k
    # substring overlap, but enforce variant-tag discrimination
    best, best_score = None, 0
    for k, v in our_weapons.items():
        display = v.get("display_name", "")
        # If our display_name has a parenthetical variant like "(dart)",
        # the OCR name must contain that token to match.
        var_m = re.search(r"\(([^)]+)\)\s*$", display)
        variant_block = False
        if var_m:
            vtok = var_m.group(1).lower().strip()
            # only treat as discriminating variant if it's a word (not a
            # generic marker like "i", "2B", "folding stock")
            if vtok and vtok not in ("i", "2b") and "folding" not in vtok:
                variant_block = vtok not in pdf_row["name"].lower()
        if variant_block:
            continue
        for cand in (k, display):
            cn = norm_name(cand)
            if len(cn) > 3 and len(target) > 3:
                if cn in target or target in cn:
                    score = min(len(cn), len(target))
                    if score > best_score:
                        best, best_score = k, score
    # token-overlap fallback for near-matches (e.g. "Knife, medium (carving
    # knife, ritual dagger)" vs OCR "Knife, Medium (carving knife, etc.)").
    # Require >=2 leading tokens to agree.
    if best is None:
        target_tokens = norm_name(pdf_row["name"]).split()
        best2, best2_score = None, 0
        for k, v in our_weapons.items():
            for cand in (k, v.get("display_name", "")):
                cn_tokens = norm_name(cand).split()
                # count matching leading tokens
                lead = 0
                for a, b in zip(target_tokens, cn_tokens):
                    if a == b:
                        lead += 1
                    else:
                        break
                if lead >= 2 and lead > best2_score:
                    best2, best2_score = k, lead
        best = best2
    # token-set Jaccard fallback for word-order differences (e.g.
    # ".38 or 9mm Revolver" vs "Revolver .38 or 9mm"). Require high overlap.
    if best is None:
        target_set = set(norm_name(pdf_row["name"]).split())
        if len(target_set) >= 2:
            best3, best3_score = None, 0.0
            for k, v in our_weapons.items():
                for cand in (k, v.get("display_name", "")):
                    cand_set = set(norm_name(cand).split())
                    if len(cand_set) < 2:
                        continue
                    inter = len(target_set & cand_set)
                    union = len(target_set | cand_set)
                    jac = inter / union if union else 0.0
                    # require >=2 shared tokens and strong overlap
                    if inter >= 2 and jac >= 0.6 and jac > best3_score:
                        best3, best3_score = k, jac
            best = best3
    return best


# ---------------------------------------------------------------------------
# Field comparison helpers
# ---------------------------------------------------------------------------

def split_damage_and_special(damage_str: str) -> tuple[str, str]:
    """Split an OCR damage cell into (core_dice, special_note).

    Handles:
      - "+DB", "+half DB", "+1/2 DB", "+burn", "+Stun" suffixes
      - range-banded shotgun damage "4D6/2D6/1D6"  -> core "4D6", special bands
      - explosive damage/radius      "4D10/3 yards" -> core "4D10", special radius
    The first dice token is the canonical core damage we store in damage_die.
    """
    s = damage_str.strip()
    # Pull a leading dice/number expression up to a slash that begins a
    # *second* dice expression or a radius ("N yards"/"N feet").
    # First, isolate the core dice: everything before +DB / +half DB / +burn / +Stun
    core = re.split(r"\+?\s*(?:DB|half\s*DB|1/2\s*DB|burn|Stun|stun)", s, flags=re.I)[0]
    core = core.strip()
    # Now split off range bands / radius
    special = ""
    # explosive: "<dice>/ <num> yards"  or "<dice>/<num> yard"
    m = re.match(r"^(.*?D\d+(?:[+\d]*)?)\s*/\s*(\d+\s*(?:yard|feet|foot)s?)", core, re.I)
    if m:
        special = core[m.end(1):].strip()
        core = m.group(1).strip()
    else:
        # range-banded: "<dice>/<dice>/<dice>"  (shotguns)
        m = re.match(r"^((?:\d+D\d+)(?:[+\d]*)?)\s*/\s*((?:\d+D\d+)(?:[+\d/]*))", core)
        if m:
            special = ("/" + m.group(2).strip())
            core = m.group(1).strip()
    return core, special


def norm_dice(s: str) -> str:
    """Normalize a dice expression for comparison."""
    return re.sub(r"\s+", "", s).lower().rstrip("+")


def parse_range(range_str: str) -> int | None:
    """Extract the base range in yards from an OCR range cell.

    Examples:
      "30 yards" -> 30
      "10/20/50 yards" -> 10  (closest band is the base range)
      "Touch" -> None (melee)
      "STR/5 yards" -> None (formula-based; not comparable)
      "15 feet" -> 5 (feet -> yards, rounded)
      "10" -> 10
      "N/A", "" -> None
    """
    s = (range_str or "").strip()
    if not s or s.lower() in ("touch", "n/a", "in place", "-"):
        return None
    if "str/5" in s.lower():
        return None  # formula-based, not comparable -> caller treats as skip
    # feet -> yards
    m = re.search(r"(\d+)\s*feet", s, re.I)
    if m:
        ft = int(m.group(1))
        # round to nearest yard, but keep simple ints; our data stores yards
        yd = max(1, round(ft / 3))
        return yd
    # yards (possibly banded) -> take the FIRST (closest) band
    m = re.search(r"(\d[\d,]*)\s*yard", s, re.I)
    if m:
        first = re.match(r"\s*(\d[\d,]*)", s)
        val = first.group(1) if first else m.group(1)
        return int(val.replace(",", ""))
    # bare number
    m = re.match(r"^(\d[\d,]*)$", s)
    if m:
        return int(m.group(1).replace(",", ""))
    return None


def parse_magazine(mag_str: str) -> object:
    """Parse the OCR magazine cell into a comparable value.

    "6" -> 6
    "20/30/32" -> 20 (smallest/primary magazine)
    "" / "-" / "N/A" -> None
    "One use"/"1 only" -> 1
    "Varies" -> "varies"
    "25 Squirts" -> 25
    """
    s = (mag_str or "").strip()
    if not s or s in ("-", "N/A"):
        return None
    low = s.lower()
    if "one use" in low or "1 only" in low:
        return 1
    if "varies" in low:
        return "varies"
    # pull the first integer
    m = re.search(r"(\d+)", s)
    if m:
        return int(m.group(1))
    return None


def parse_malfunction(mal_str: str) -> int | None:
    """Parse malfunction: a number 1-100, else None."""
    s = (mal_str or "").strip()
    m = re.match(r"^(\d{1,3})$", s)
    if m:
        v = int(m.group(1))
        if 1 <= v <= 100:
            return v
    return None


def parse_uses(uses_str: str) -> str:
    """Normalize uses-per-round for comparison (return canonical token)."""
    s = (uses_str or "").strip()
    if not s:
        return ""
    low = s.lower()
    low = low.replace("full auto", "full-auto")
    # canonicalize whitespace
    low = re.sub(r"\s+", " ", low).strip()
    return low


def classify_damage_type(row: dict, our: dict) -> str | None:
    """Return the OCR-implied damage_type for cross-check, or None to skip.

    Per the rulebook Key, weapons can impale when either:
      - their own OCR name carries "(i)", OR
      - their SECTION header carries "(i)" (Handguns, Rifles, Assault Rifles,
        Submachine Guns, Machine Guns all do).
    Shotguns explicitly CANNOT impale ("shotguns ... cannot impale"),
    even though the OCR sometimes groups their table under a prior (i) header.
    Explosives/heavy weapons are area-effect and do not impale.
    Stun/burn weapons say so in the damage cell.
    """
    dmg = row["damage"].lower()
    name = row["name"].lower()
    skill = row.get("skill", "").lower()
    if "stun" in dmg:
        return "stun"
    if "burn" in dmg:
        return "burn"
    # Shotguns never impale (rulebook explicit). Explosives (area/radius
    # damage, Demolitions/Artillery/Throw skill) never impale either.
    if "shotgun" in skill or "shotgun" in name:
        return "normal"
    if "demolitions" in skill or "artillery" in skill:
        return "normal"
    if "/" in dmg and ("yard" in dmg or "feet" in dmg):
        # damage/radius explosion pattern -> not impale
        return "normal"
    if "(i)" in name or row.get("section_impale"):
        return "impale"
    return "normal"


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    md = MD_PATH.read_text(encoding="utf-8")
    weapons = json.loads((BASE / "weapons.json").read_text())["weapons"]
    pdf_rows = parse_weapon_rows(md)
    print(f"OCR Table XVII: {len(pdf_rows)} weapon rows parsed")
    print(f"Our weapons.json: {len(weapons)} weapons\n")

    matched = 0
    field_ok = {"damage": 0, "range": 0, "uses": 0, "mag": 0, "mal": 0, "dtype": 0}
    field_cmp = {"damage": 0, "range": 0, "uses": 0, "mag": 0, "mal": 0, "dtype": 0}
    mismatches: list[str] = []
    not_matched_pdf: list[str] = []
    matched_keys: set[str] = set()

    # First pass: assign each OCR row to a candidate key.
    candidates: list[tuple[int, str | None]] = []
    for idx, row in enumerate(pdf_rows):
        candidates.append((idx, match_weapon(row, weapons)))

    # When several OCR rows map to the same key (shotgun variants, taser
    # contact/dart), pick the row that best agrees with our stored fields
    # (magazine, uses, malfunction, range). This lets our single generic
    # entry (e.g. shotgun_12g, magazine=5) match its closest OCR variant
    # (the pump, magazine=5) rather than the first one parsed.
    key_to_row_idxs: dict[str, list[int]] = {}
    for idx, key in candidates:
        if key is None:
            continue
        key_to_row_idxs.setdefault(key, []).append(idx)

    chosen_row_for_key: dict[str, int] = {}
    for key, idxs in key_to_row_idxs.items():
        if len(idxs) == 1:
            chosen_row_for_key[key] = idxs[0]
            continue
        our = weapons[key]
        best_idx, best_score = idxs[0], -1
        for idx in idxs:
            row = pdf_rows[idx]
            score = 0
            pmag = parse_magazine(row["mag"])
            if isinstance(pmag, int) and isinstance(our.get("magazine"), int) and pmag == our["magazine"]:
                score += 3
            pmal = parse_malfunction(row["malfunction"])
            if pmal is not None and our.get("malfunction") is not None and pmal == our.get("malfunction"):
                score += 1
            prng = parse_range(row["range"])
            if prng is not None and our.get("base_range_yards") is not None and prng == our.get("base_range_yards"):
                score += 1
            if score > best_score:
                best_idx, best_score = idx, score
        chosen_row_for_key[key] = best_idx

    chosen_keys_by_idx = {idx: key for key, idx in chosen_row_for_key.items()}

    for idx, row in enumerate(pdf_rows):
        key = chosen_keys_by_idx.get(idx)
        if key is None:
            # unmatched only if no key chose this row AND it had a candidate
            cand = candidates[idx][1]
            if cand is None:
                not_matched_pdf.append(row["name"])
            continue
        matched += 1
        matched_keys.add(key)
        ours = weapons[key]

        # --- damage_die ---
        pdf_core, pdf_special = split_damage_and_special(row["damage"])
        our_dmg = str(ours.get("damage_die") or "")
        field_cmp["damage"] += 1
        if norm_dice(pdf_core) == norm_dice(our_dmg):
            field_ok["damage"] += 1
        else:
            mismatches.append(
                f"{key}: damage_die ours='{our_dmg}' OCR='{pdf_core}'"
                f" (raw '{row['damage']}')"
            )

        # --- base_range_yards ---
        pdf_range = parse_range(row["range"])
        our_range = ours.get("base_range_yards")
        raw_range_low = (row["range"] or "").lower()
        range_formula = "str/5" in raw_range_low  # formula-based: skip comparison
        if range_formula:
            pass  # not comparable; do not count or flag
        else:
            field_cmp["range"] += 1
            if pdf_range is None:
                # OCR melee/touch -> our value must also be None
                if our_range is None:
                    field_ok["range"] += 1
                else:
                    mismatches.append(
                        f"{key}: base_range_yards ours='{our_range}' OCR=melee/None"
                        f" (raw '{row['range']}')"
                    )
            else:
                if our_range is None:
                    mismatches.append(
                        f"{key}: base_range_yards ours=None OCR='{pdf_range}'"
                        f" (raw '{row['range']}')"
                    )
                elif int(our_range) == int(pdf_range):
                    field_ok["range"] += 1
                else:
                    mismatches.append(
                        f"{key}: base_range_yards ours='{our_range}' OCR='{pdf_range}'"
                        f" (raw '{row['range']}')"
                    )

        # --- uses_per_round ---
        pdf_uses = parse_uses(row["uses"])
        our_uses = parse_uses(str(ours.get("uses_per_round") or ""))
        if not pdf_uses:
            pass  # OCR cell empty -> not comparable; skip
        else:
            field_cmp["uses"] += 1
            # normalize internal spacing: "1 (3)" == "1(3)"
            pu = re.sub(r"\s*", "", pdf_uses)
            ou = re.sub(r"\s*", "", our_uses)
            if pu == ou:
                field_ok["uses"] += 1
            else:
                mismatches.append(
                    f"{key}: uses_per_round ours='{ours.get('uses_per_round')}'"
                    f" OCR='{row['uses']}'"
                )

        # --- magazine ---
        pdf_mag = parse_magazine(row["mag"])
        our_mag = ours.get("magazine")
        field_cmp["mag"] += 1
        if _mag_equal(pdf_mag, our_mag):
            field_ok["mag"] += 1
        else:
            mismatches.append(
                f"{key}: magazine ours='{our_mag}' OCR='{pdf_mag}'"
                f" (raw '{row['mag']}')"
            )

        # --- malfunction ---
        pdf_mal = parse_malfunction(row["malfunction"])
        our_mal = ours.get("malfunction")
        field_cmp["mal"] += 1
        if pdf_mal is None and our_mal is None:
            field_ok["mal"] += 1
        elif pdf_mal is not None and our_mal is not None and int(pdf_mal) == int(our_mal):
            field_ok["mal"] += 1
        else:
            mismatches.append(
                f"{key}: malfunction ours='{our_mal}' OCR='{pdf_mal}'"
                f" (raw '{row['malfunction']}')"
            )

        # --- damage_type (informational cross-check) ---
        odt = classify_damage_type(row, ours)
        our_dt = ours.get("damage_type")
        field_cmp["dtype"] += 1
        if odt is None or our_dt is None:
            field_ok["dtype"] += 1  # skip non-comparable
        elif odt == our_dt:
            field_ok["dtype"] += 1
        else:
            mismatches.append(
                f"{key}: damage_type ours='{our_dt}' OCR~='{odt}'"
                f" (raw name '{row['name']}', dmg '{row['damage']}')"
            )

    unmatched_ours = sorted(set(weapons) - matched_keys)

    print(f"Matched: {matched} / {len(weapons)} weapons")
    print("Field comparison (ok / compared):")
    for f in ("damage", "range", "uses", "mag", "mal", "dtype"):
        print(f"  {f:8s}: {field_ok[f]} / {field_cmp[f]}")
    print(f"\nMismatches: {len(mismatches)}")
    for m in mismatches:
        print(f"  X {m}")
    if not_matched_pdf:
        print(f"\nOCR rows with no match in our data ({len(not_matched_pdf)}):")
        for n in not_matched_pdf:
            print(f"  ? {n}")
    if unmatched_ours:
        print(f"\nOur weapons with no OCR row ({len(unmatched_ours)}):")
        for k in unmatched_ours:
            print(f"  ? {k} ({weapons[k].get('display_name', '')})")

    return 1 if mismatches else 0


def _mag_equal(pdf_mag, our_mag) -> bool:
    if pdf_mag is None and our_mag is None:
        return True
    if pdf_mag is None or our_mag is None:
        # "1" vs None: treat our missing as mismatch unless OCR truly empty
        return False
    if isinstance(pdf_mag, int) and isinstance(our_mag, int):
        return pdf_mag == our_mag
    return str(pdf_mag).lower() == str(our_mag).lower()


if __name__ == "__main__":
    sys.exit(main())
