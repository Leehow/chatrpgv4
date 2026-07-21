#!/usr/bin/env python3
"""Verify poisons.json against MinerU OCR of the Sample Poisons table.

OCR source: checks/ocr-cached/poisons.md
  * "Sample Poisons" rendered as a single HTML <table>.
  * Columns: Poison, Speed, Effect (1 dose), Notes.  11 poisons.

Our data: plugins/coc-keeper/rulesets/coc7/rules-json/poisons.json
  * poisons[name] = {delivery, damage_or_effect, onset, note}

For each poison we compare four fields:
  * name   -- normalised match
  * speed  -- OCR "Speed" vs our "onset"
  * damage -- the Nd10/NdN dice expression extracted from the OCR Effect text
              vs our "damage_or_effect" (normalised to "<dice> HP" or
              "no damage")
  * notes  -- OCR "Notes" vs our "note" (compared loosely: our note should be
              a subset/derivative of the OCR notes, since our data is a
              shortened form).  We flag mismatches where the OCR notes content
              disagrees materially with ours.

Does NOT modify any JSON data.

Usage:
    uv run --frozen python scripts/verify_poisons_ocr.py
"""
from __future__ import annotations

import html
import json
import re
import sys
from pathlib import Path

BASE = Path("plugins/coc-keeper/rulesets/coc7/rules-json")
MD_PATH = Path("checks/ocr-cached/poisons.md")


# ---------------------------------------------------------------------------
# OCR parsing
# ---------------------------------------------------------------------------
def parse_poison_rows(md: str) -> list[dict]:
    """Parse the Sample Poisons HTML table.

    Each <tr> has 4 <td>: Poison, Speed, Effect (1 dose), Notes.
    The first row is the header (Poison/Speed/Effect/Notes) and is skipped.
    """
    rows: list[dict] = []
    m = re.search(r"<table>(.*?)</table>", md, re.S)
    if not m:
        raise SystemExit("no <table> found in poisons OCR")
    table_html = m.group(1)
    for tr in re.finditer(r"<tr>(.*?)</tr>", table_html, re.S):
        cells = re.findall(r"<td>(.*?)</td>", tr.group(1), re.S)
        cells = [html.unescape(re.sub(r"\s+", " ", c).strip()) for c in cells]
        if len(cells) < 4:
            continue
        name = cells[0]
        # skip header row
        if name.strip().lower() in ("poison", ""):
            continue
        rows.append({
            "name": name,
            "speed": cells[1],
            "effect": cells[2],
            "notes": cells[3],
        })
    return rows


# ---------------------------------------------------------------------------
# Normalisation
# ---------------------------------------------------------------------------
def norm_name(s: str) -> str:
    """Normalise a poison name for matching: lowercase, collapse whitespace,
    strip leading/trailing punctuation, drop parenthesised aliases."""
    s = html.unescape(s).lower()
    s = re.sub(r"\s+", " ", s).strip()
    s = re.sub(r"\([^)]*\)", "", s).strip()  # drop "(agaric mushrooms)" etc.
    s = s.strip("`'\".,;:- ")
    return s


def norm_speed(s: str) -> str:
    """Normalise a speed/onset string for comparison."""
    s = html.unescape(s).lower()
    s = re.sub(r"\s+", " ", s).strip()
    s = s.strip("`'\".,;:- ")
    return s


_DICE_RE = re.compile(r"(\d+\s*d\s*\d+)", re.I)
_NODAMAGE_RE = re.compile(r"\bno\s+damage\b", re.I)


def extract_damage(effect_text: str) -> str:
    """Extract a canonical damage token from the OCR effect text.

    Returns either "<N>D<M>" (e.g. "4D10") or "no damage" or "" if no signal.
    """
    if _NODAMAGE_RE.search(effect_text):
        return "no damage"
    m = _DICE_RE.search(effect_text)
    if m:
        return re.sub(r"\s+", "", m.group(1).upper())  # e.g. "4D10"
    return ""


def our_damage_canonical(damage_or_effect: str) -> str:
    """Canonicalise our damage_or_effect to the same form as extract_damage."""
    s = html.unescape(damage_or_effect).lower()
    m = _DICE_RE.search(s)
    if m:
        return re.sub(r"\s+", "", m.group(1).upper())
    if _NODAMAGE_RE.search(s):
        return "no damage"
    return s.strip()


def _edit_distance_within(a: str, b: str, k: int) -> bool:
    """True if Levenshtein edit distance between a and b is <= k."""
    if abs(len(a) - len(b)) > k:
        return False
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1,
                           prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1] <= k


def notes_disagree(ocr_notes: str, our_note: str) -> bool:
    """Loose notes comparison.  Our notes are an abbreviated form of the OCR
    notes, so we only flag a mismatch when a *distinctive* word in our note is
    absent from the OCR text (i.e. our data asserts something the source does
    not).  We ignore very short words and common words.  OCR typos (e.g.
    'finting' for 'fainting', 'ifingested' for 'ingested') are tolerated via
    small edit-distance matching."""
    stop = {
        "the", "a", "an", "of", "or", "and", "to", "in", "for", "with",
        "is", "are", "be", "by", "if", "it", "this", "that", "from", "as",
        "may", "will", "can", "not", "no", "on", "at", "its", "their",
    }
    ocr_low = html.unescape(ocr_notes).lower()
    our_low = html.unescape(our_note).lower()
    # tokenise on non-alphanumerics
    our_tokens = {t for t in re.split(r"[^a-z0-9]+", our_low) if len(t) > 4}
    ocr_tokens = set(re.split(r"[^a-z0-9]+", ocr_low))
    missing = []
    for t in our_tokens:
        if t in stop or t in ocr_tokens:
            continue
        # tolerate OCR typos: a near-match (edit distance <=2 for words >=6
        # chars, or a substring containment either way) counts as present.
        near = any(_edit_distance_within(t, o, 2) or t in o or o in t
                   for o in ocr_tokens if len(o) > 3)
        if not near:
            missing.append(t)
    return bool(missing), sorted(missing)


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
def main() -> int:
    md = MD_PATH.read_text(encoding="utf-8")
    our_poisons = json.loads((BASE / "poisons.json").read_text())["poisons"]
    ocr_rows = parse_poison_rows(md)

    print(f"OCR Sample Poisons rows: {len(ocr_rows)}")
    print(f"Our poisons.json count: {len(our_poisons)}")

    # name -> our record
    our_norm = {norm_name(k): k for k in our_poisons}

    matched = 0
    correct_name = 0
    mismatches: list[str] = []
    matched_ours: set[str] = set()

    for row in ocr_rows:
        nk = norm_name(row["name"])
        if nk not in our_norm:
            mismatches.append(
                f"UNMATCHED OCR poison name='{row['name']}' "
                f"(normalised '{nk}')"
            )
            continue
        our_key = our_norm[nk]
        matched += 1
        matched_ours.add(our_key)
        ours = our_poisons[our_key]

        # 1. name (exact-case display). The OCR poison name sometimes carries
        # a parenthetical alias (e.g. "Amanita (agaric mushrooms)"); our
        # canonical short name (without the alias) is an acceptable match.
        ocr_name_core = re.sub(r"\s*\([^)]*\)\s*$", "", row["name"]).strip()
        if our_key.strip().lower() == row["name"].strip().lower() \
                or our_key.strip().lower() == ocr_name_core.lower():
            correct_name += 1
        else:
            mismatches.append(
                f"{our_key}: name ours='{our_key}' OCR='{row['name']}'"
            )

        # 2. speed / onset
        ocr_speed = norm_speed(row["speed"])
        our_speed = norm_speed(ours.get("onset", ""))
        if ocr_speed != our_speed:
            mismatches.append(
                f"{our_key}: speed ours='{ours.get('onset')}' "
                f"OCR='{row['speed']}'"
            )

        # 3. damage dice (from effect text vs our damage_or_effect)
        ocr_dmg = extract_damage(row["effect"])
        our_dmg = our_damage_canonical(ours.get("damage_or_effect", ""))
        if ocr_dmg != our_dmg:
            mismatches.append(
                f"{our_key}: damage ours='{our_dmg}' OCR='{ocr_dmg}' "
                f"(OCR effect='{row['effect']}')"
            )

        # 4. notes: our `note` is a human-readable condensation drawn from
        # across the OCR row (Effect symptoms + the poison's parenthetical
        # alias from the Name + background detail from the Notes column). Every
        # distinctive word in our note should appear somewhere in the OCR row;
        # compare against the union of all three OCR columns.
        effect_symptoms = re.sub(r"\d+D\d+\s*(?:HP\s*)?(?:damage|damage\.)?\s*\.?\s*$",
                                 "", row["effect"], flags=re.I).strip().rstrip(".")
        combined_ocr = row["name"] + " " + effect_symptoms + " " + row["notes"]
        disagree, missing_words = notes_disagree(
            combined_ocr, ours.get("note", "")
        )
        if disagree:
            mismatches.append(
                f"{our_key}: note ours='{ours.get('note')}' "
                f"OCR(row) missing tokens: {missing_words}"
            )

    unmatched_ours = [k for k in our_poisons if k not in matched_ours]

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
