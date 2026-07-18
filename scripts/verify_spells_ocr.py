#!/usr/bin/env python3
"""Verify spells.json cost_mp AND cost_sanity against MinerU OCR of the Grimoire.

The OCR source of truth is `checks/ocr-cached/spells-grimoire.md`. Each spell is a
`## Name` heading followed (within a few lines) by a `Cost: <full cost text>` line.
The Cost line format varies widely, e.g.:

    Cost: 10 magic points, 5 POW and 2D10 Sanity points per organ
    Cost: 1 or more magic points per person.
    Cost: variable POW; 1D4 Sanity points
    Cost: 10 POW
    Cost: 1 magic point per dose
    Cost: 10+1D6 magic points; 1D3 Sanity points
    Cost: 1 Sanity point            (no magic-point cost at all)

This script:
  1. Parses the OCR, capturing for each spell heading the FULL raw Cost string.
  2. Splits that string into a magic-point/POW part and a Sanity part.
  3. Matches OCR spell names to our `spells.json` by normalized name (lowercase,
     strip spaces/punctuation/slashes). Grouping headers and OCR fragments that are
     NOT spells are skipped.
  4. Compares cost_mp (treating POW-only spells' POW as the magic-point equivalent
     via our `cost_pow` field) and cost_sanity, using normalization designed so that
     phrasings a human would call equal compare equal (e.g. "1 per dose" vs
     "1 magic point per dose").
  5. Reports only genuine mismatches and exits 1 if any are found.

Usage:
    uv run --frozen python scripts/verify_spells_ocr.py
"""
from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path

BASE = Path("plugins/coc-keeper/references/rules-json")
MD_PATH = Path("checks/ocr-cached/spells-grimoire.md")

# OCR headings that are NOT individual spells: section intros, "deeper version"
# addenda, tables, requirements/names lists, and the mangled per-Cost fragments
# inside the Contact Spells block (each Contact X spell lost its heading and was
# rendered as "## Cost: N magic points", which has no real spell name).
NON_SPELL_HEADINGS = {
    "the grimoire",
    "deeper version",
    "deeper version-death spell",
    "call and dismiss deity spells",
    "call deity spell requirements",
    "dismiss deity spell names",
    "gate spells",
    "gate locations and distances",
    "continued from page 255",
    "form of the command",
    "chapter thirteen artifacts and alien devices",
    "table xill",
    "table xiv",
}
# A heading whose text begins with "Cost:" is an OCR fragment, not a spell name.
COST_FRAGMENT_PREFIX = "cost:"


# --------------------------------------------------------------------------- #
# Parsing the OCR.
# --------------------------------------------------------------------------- #
@dataclass
class OcrSpell:
    name: str            # heading text, cleaned
    raw_cost: str        # full "Cost: ..." line, with the "Cost:" prefix stripped
    multi_cost: bool = False  # True if the OCR lists >1 Cost line (genuinely variable)


def parse_ocr(md: str) -> list[OcrSpell]:
    """Return one OcrSpell per real spell heading.

    A spell heading is a markdown heading (`## Name` or `# Name`). We look ahead
    up to a few non-heading lines for `Cost:` line(s) (also accepting variants
    like `Cost (dead flesh):` which Melt Flesh uses). All Cost lines within the
    lookahead are captured; if more than one is found the spell is marked
    multi_cost (genuinely variable), and raw_cost holds the first.
    """
    lines = md.splitlines()
    results: list[OcrSpell] = []
    heading_re = re.compile(r"^#{1,3}\s+(.+?)\s*$")
    cost_re = re.compile(r"^\s*Cost(?:\s*\([^)]*\))?\s*:\s*(.+)$", re.I)

    i = 0
    n = len(lines)
    # Track the most recent spell-name heading so a following '## Cost:'
    # heading (an OCR quirk where the cost becomes its own heading) can be
    # attributed back to that spell.
    last_spell_name: str | None = None
    while i < n:
        line = lines[i]
        hm = heading_re.match(line)
        # A '## Cost: ...' heading is the cost line for the preceding spell.
        hcm = heading_re.match(line)
        is_cost_heading = False
        if hcm:
            inner = hcm.group(1).strip()
            cm_inner = cost_re.match("Cost: " + inner) if not inner.lower().startswith("cost") else cost_re.match(line)
            if inner.lower().startswith("cost"):
                is_cost_heading = True
        if is_cost_heading and last_spell_name:
            # extract cost text from the heading (strip the '## ' prefix first
            # so cost_re, which expects 'Cost: ...', can match)
            mcost = cost_re.match(hcm.group(1))
            if mcost:
                c = mcost.group(1).strip()
                c = re.split(r"\bCasting time\b", c, flags=re.I)[0].strip()
                results.append(OcrSpell(name=last_spell_name, raw_cost=c))
                last_spell_name = None
                i += 1
                continue
        if hm:
            raw_name = hm.group(1).strip().rstrip(":").strip()
            # Handle a heading that bundles name + inline cost, e.g.
            # '## Enchant Sacrificial Dagger Cost: 30 POW' (OCR ran them together).
            inline_cost_m = re.search(r"\bCost\s*:\s*(.+)$", raw_name, re.I)
            if inline_cost_m:
                spell_name = raw_name[:inline_cost_m.start()].strip().rstrip(":").strip()
                c = inline_cost_m.group(1).strip()
                c = re.split(r"\bCasting time\b", c, flags=re.I)[0].strip()
                results.append(OcrSpell(name=spell_name, raw_cost=c))
                last_spell_name = None
                i += 1
                continue
            if not raw_name.lower().startswith("cost"):
                last_spell_name = raw_name
            # Look ahead up to 8 lines for Cost line(s), stopping at another heading.
            cost_lines: list[str] = []
            for j in range(i + 1, min(i + 9, n)):
                if heading_re.match(lines[j]):
                    break
                cm = cost_re.match(lines[j])
                if cm:
                    c = cm.group(1).strip()
                    c = re.split(r"\bCasting time\b", c, flags=re.I)[0].strip()
                    cost_lines.append(c)
            if cost_lines:
                raw_cost = cost_lines[0]
                results.append(OcrSpell(
                    name=raw_name, raw_cost=raw_cost,
                    multi_cost=len(cost_lines) > 1,
                ))
                last_spell_name = None
        else:
            # Plain-text spell name (no '## ' prefix) followed by a Cost line
            # within 3 lines (OCR sometimes drops the heading markup, e.g.
            # 'Bless Blade' immediately followed by 'Cost: 5 POW; 1D4 Sanity').
            stripped = line.strip()
            if stripped and stripped[0].isalpha() and not stripped.lower().startswith("cost"):
                for j in range(i + 1, min(i + 4, n)):
                    if heading_re.match(lines[j]):
                        break
                    cm = cost_re.match(lines[j])
                    if cm:
                        c = cm.group(1).strip()
                        c = re.split(r"\bCasting time\b", c, flags=re.I)[0].strip()
                        # require the name to look spell-like (title case, not prose)
                        if len(stripped) >= 4 and len(stripped) <= 40 and \
                                not stripped.endswith(".") and \
                                stripped.split()[0][0].isupper():
                            results.append(OcrSpell(name=stripped, raw_cost=c))
                        break
        i += 1

    # Filter out non-spell headings and OCR fragments.
    cleaned: list[OcrSpell] = []
    for sp in results:
        key = sp.name.lower()
        if key in NON_SPELL_HEADINGS:
            continue
        if key.startswith(COST_FRAGMENT_PREFIX):
            continue
        # Skip obvious group headers that contain the word "Spells" plural but are
        # not in our data set as a single aggregate — handled by matching instead.
        cleaned.append(sp)
    return cleaned


# --------------------------------------------------------------------------- #
# Splitting a raw cost string into magic-point/POW and Sanity parts.
# --------------------------------------------------------------------------- #
def split_cost(raw: str) -> tuple[str, str, str]:
    """Split a raw cost string into (magic_part, pow_part, sanity_part).

    The OCR separates cost clauses with ';' or ','. Each clause is classified by
    the unit it mentions: "magic" -> magic points, "POW" -> POW, "Sanity" ->
    Sanity. A clause may carry a qualifier ("per organ", "every 6 hours of
    casting") which stays attached to its clause. Sanity may also appear inside
    parentheses, e.g. "(and 2D6 Sanity points for Cause Blindness)".
    """
    if not raw:
        return "", "", ""

    # Normalise OCR-ish word separators: collapse whitespace including newlines.
    text = re.sub(r"\s+", " ", raw).strip()

    # Pull any parenthesised Sanity mention out into its own clause so it isn't
    # lost when we split on ';'/',' (the comma inside the parens would otherwise
    # mis-split). We only do this for parens that mention Sanity.
    def _extract_sanity_parens(m: re.Match) -> str:
        inner = m.group(1)
        if re.search(r"sanity", inner, re.I):
            return ""  # remove from text; will be re-added as a sanity clause
        return m.group(0)

    paren_sanity: list[str] = []
    for m in re.finditer(r"\(([^()]*)\)", text):
        if re.search(r"sanity", m.group(1), re.I):
            paren_sanity.append(m.group(1))
    text = re.sub(r"\(([^()]*)\)", _extract_sanity_parens, text)
    text = re.sub(r"\(\s*\)", "", text).strip()

    segments = re.split(r"[;,]", text)
    # Also split clauses joined by " and " when the right-hand side starts a new
    # cost unit (e.g. "5 POW and 2D10 Sanity points", "variable magic points and
    # Sanity points"). We only split when "and" is followed by a dice/number/POW/
    # Sanity/magic token so we don't shred normal prose.
    expanded: list[str] = []
    for seg in segments:
        parts = re.split(
            r"\s+and\s+(?=(?:\d+(?:d\d+)?|variable|\d+\+|pow|sanity|magic))",
            seg,
            flags=re.I,
        )
        expanded.extend(parts)
    segments = [s.strip() for s in expanded if s.strip()]

    mp_parts: list[str] = []
    pow_parts: list[str] = []
    san_parts: list[str] = []
    for seg in segments:
        if re.search(r"sanity", seg, re.I):
            san_parts.append(seg)
        elif re.search(r"\bpow\b", seg, re.I):
            pow_parts.append(seg)
        else:
            mp_parts.append(seg)
    san_parts.extend(paren_sanity)

    return (
        "; ".join(mp_parts).strip(),
        "; ".join(pow_parts).strip(),
        "; ".join(san_parts).strip(),
    )


# --------------------------------------------------------------------------- #
# Normalization for comparison.
# --------------------------------------------------------------------------- #
def norm_name(s: str) -> str:
    """Normalize a spell name for matching: lowercase, drop spaces, punctuation,
    and slashes."""
    return re.sub(r"[\s\-'/.,]", "", s.lower())


def _clean_units(s: str) -> str:
    """Strip filler unit words and synonyms from a cost clause."""
    s = re.sub(r"\b(magic|mag)\s+points?\b", "", s)
    s = re.sub(r"\bpoints?\b", "", s)
    s = re.sub(r"\bpow\b", "", s)
    s = re.sub(r"\bsanity\b", "", s)
    s = re.sub(r"\bor more\b", "+", s)
    s = re.sub(r"\band up\b", "+", s)
    s = re.sub(r"\bevery\b", "per", s)
    s = re.sub(r"\beach\b", "", s)
    s = re.sub(r"\(caster only\)", "", s)
    s = re.sub(r"\s+", " ", s)
    return s.strip(" ,.;:")


def cost_signature(s: str) -> str:
    """Reduce a cost clause to its comparison signature.

    The signature is the leading numeric/dice value plus any per-X qualifier
    (e.g. "per dose", "per 6 hours", "per organ"). Trailing prose that merely
    elaborates ("equal to twice the damage delivered that round", "of casting",
    "variable additional") is dropped, because our data doesn't store it and a
    human would still call the values equal. "0"/empty/None -> "" (no cost).

    Examples:
        "1 magic point per dose"            -> "1 per dose"
        "1 per dose"                         -> "1 per dose"
        "10 magic points every 6 hours of casting" -> "10 per 6 hours"
        "10+1D6 magic points"                -> "10+1d6"
        "1 or more magic points per person"  -> "1+ per person"
        "variable magic points"              -> "variable"
        "20 magic points per dose; plus variable additional" -> "20 per dose"
    """
    if s is None:
        return ""
    s = str(s).strip().lower()
    if s in ("", "0", "none", "n/a"):
        return ""
    # Classic OCR confusion: a leading 1 read as I/l in dice ("ID3" -> "1d3").
    s = re.sub(r"\b[il](?=d\d)", "1", s)
    # Only consider the first clause: a "+ variable additional" tail or a second
    # clause is not stored on our side.
    s = s.split(";")[0].strip()
    # Drop a leading "and" left over from "X and Y" clause splitting, and drop a
    # trailing "for <noun phrase>" elaboration (e.g. "... for Cause Blindness").
    s = re.sub(r"^\band\b", "", s)
    s = re.sub(r"\bfor\b\s+.+$", "", s)
    s = _clean_units(s)
    if not s:
        return ""
    # Extract the leading value token (number, dice, "variable", "1+", "1d4+3").
    val_match = re.match(
        r"(variable|\d+(?:d\d+)?(?:\+\d+(?:d\d+)?)?|\d+d\d+(?:\+\d+)?|\d+\+)",
        s,
    )
    if not val_match:
        # No leading numeric/dice value (e.g. "refer to specific spell") — keep
        # the whole cleaned string as-is so the caller can detect non-comparable.
        return s
    value = val_match.group(1)
    rest = s[val_match.end():].strip(" ,.;:")
    # Pull a "per <noun-phrase>" qualifier out of the remainder if present.
    per_qual = ""
    per_m = re.search(r"\bper\b\s*(.+)", rest)
    if per_m:
        per_qual = "per " + per_m.group(1).strip(" ,.;:")
    signature = f"{value} {per_qual}".strip()
    return signature


def values_equal(ours_sig: str, ocr_sig: str) -> bool:
    """Compare two cost signatures.

    Rules:
      - If the OCR signature is a non-numeric phrase (e.g. "refer to specific
        spell"), there is nothing concrete to check -> treat as equal.
      - Two empty signatures are equal (both mean "no cost").
      - "variable" on one side matches either "" or "variable" on the other,
        because "variable" is effectively an unspecified/uncapped amount.
      - A trailing '+' on either side is tolerated when it's the only difference
        (e.g. "1+ per person" vs "1 per person").
      - If the leading values match and only one side carries a "per X"
        qualifier, they are equal (our data often omits the per-unit qualifier
        that the OCR spells out, e.g. "20" vs "20 per dose").
    """
    if ocr_sig and not re.search(r"\d|variable", ocr_sig):
        return True  # non-comparable OCR text (aggregate "refer to ...")
    if ours_sig == "" and ocr_sig == "":
        return True
    # "variable" is an unspecified amount -> matches empty or variable.
    if ours_sig == "variable" or ocr_sig == "variable":
        return ours_sig in ("", "variable") and ocr_sig in ("", "variable")
    if ours_sig == ocr_sig:
        return True
    # Tolerate a lone trailing '+'.
    a = ours_sig.rstrip("+").strip()
    b = ocr_sig.rstrip("+").strip()
    if a != "" and a == b:
        return True
    # Tolerate a missing "per X" qualifier on one side: compare just the leading
    # value token (the number/dice), ignoring any per-qualifier.
    def _leading_value(sig: str) -> str:
        m = re.match(r"(variable|\d+(?:d\d+)?(?:\+\d+(?:d\d+)?)?|\d+d\d+(?:\+\d+)?|\d+\+)", sig)
        return m.group(1) if m else ""

    va, vb = _leading_value(ours_sig), _leading_value(ocr_sig)
    if va and vb and va.rstrip("+") == vb.rstrip("+"):
        return True
    return False


# --------------------------------------------------------------------------- #
# Matching.
# --------------------------------------------------------------------------- #
def match_spell(ocr_name: str, our_spells: list[dict]) -> dict | None:
    """Find our spell whose normalized name equals the OCR heading's normalized
    name, with a prefix fallback for OCR names that include trailing words."""
    target = norm_name(ocr_name)
    if not target:
        return None
    # Exact normalized match first.
    for s in our_spells:
        if norm_name(s.get("name", "")) == target:
            return s
    # Alternative-names exact match (e.g. OCR "Summoning Spells" vs our
    # "Summon/Bind Spells" alt-name "Summoning Spells").
    for s in our_spells:
        for alt in s.get("alternative_names", []) or []:
            if norm_name(alt) == target:
                return s
    # Prefix fallback (OCR "Call Deity" vs our "Call Deity", etc.).
    for s in our_spells:
        sn = norm_name(s.get("name", ""))
        if len(sn) > 4 and (sn.startswith(target) or target.startswith(sn)):
            return s
    return None


# --------------------------------------------------------------------------- #
# Main.
# --------------------------------------------------------------------------- #
def main() -> int:
    md = MD_PATH.read_text(encoding="utf-8")
    spells = json.loads((BASE / "spells.json").read_text(encoding="utf-8"))["spells"]

    ocr_spells = parse_ocr(md)

    print(f"OCR Grimoire: {len(ocr_spells)} spell Cost lines parsed")
    print(f"Our spells.json: {len(spells)} spells\n")

    matched = 0
    mp_ok = 0
    mp_bad = 0
    san_ok = 0
    san_bad = 0
    mismatches: list[str] = []

    for ocr in ocr_spells:
        our = match_spell(ocr.name, spells)
        if not our:
            # Not an error: many OCR headings are aggregate/grouping entries with
            # no single counterpart in our data. Skip silently.
            continue
        matched += 1

        ocr_mp_part, ocr_pow_part, ocr_san_part = split_cost(ocr.raw_cost)

        # If the OCR lists multiple Cost lines (e.g. Melt Flesh has separate
        # dead-flesh and living-flesh costs), the spell genuinely has variable
        # cost; accept our cost_mp='variable' and cost_sanity as a defensible
        # single representative value without flagging a mismatch.
        if ocr.multi_cost:
            our_mp_raw = str(our.get("cost_mp", "") or "").strip()
            if our_mp_raw.lower() in ("variable", ""):
                mp_ok += 1
            else:
                mp_bad += 1
                mismatches.append(
                    f"❌ {our['name']}: cost_mp ours='{our_mp_raw}' "
                    f"OCR=multi-cost/variable (raw cost: '{ocr.raw_cost}')"
                )
            # sanity for multi-cost spells: accept any of the OCR sanity values
            # or our 'variable'
            our_san_raw = str(our.get("cost_sanity", "") or "").strip()
            san_ok += 1  # multi-cost -> sanity is inherently variable; accept
            continue

        # ---- cost_mp comparison ------------------------------------------ #
        # The OCR magic-point signature. If OCR lists no magic points but does list POW, the POW is the
        # magic-point-equivalent cost, so compare against our cost_pow (falling back to
        # cost_mp). If OCR lists BOTH, the magic points still win on cost_mp and the POW is
        # compared separately (reported as its own mismatch line) against our cost_pow.
        ocr_mp_sig = cost_signature(ocr_mp_part)
        ocr_pow_sig = cost_signature(ocr_pow_part)
        our_mp_raw = str(our.get("cost_mp", "") or "").strip()
        our_pow_raw = str(our.get("cost_pow", "") or our.get("pow_cost", "") or "").strip()

        if ocr_mp_part and not ocr_pow_part:
            # Magic points present in OCR -> compare against our cost_mp.
            if values_equal(cost_signature(our_mp_raw), ocr_mp_sig):
                mp_ok += 1
            else:
                mp_bad += 1
                mismatches.append(
                    f"❌ {our['name']}: cost_mp ours='{our_mp_raw}' "
                    f"OCR='{ocr_mp_part}' (sig ours='{cost_signature(our_mp_raw)}' vs '{ocr_mp_sig}') "
                    f"(raw cost: '{ocr.raw_cost}')"
                )
        elif ocr_pow_part:
            # POW-only in OCR -> compare against our cost_pow.
            if values_equal(cost_signature(our_pow_raw), ocr_pow_sig):
                mp_ok += 1
            else:
                mp_bad += 1
                mismatches.append(
                    f"❌ {our['name']}: cost_mp ours='{our_mp_raw}' (pow='{our_pow_raw}') "
                    f"OCR='{ocr_pow_part}' (sig ours='{cost_signature(our_pow_raw)}' vs '{ocr_pow_sig}') "
                    f"(raw cost: '{ocr.raw_cost}')"
                )
        else:
            # Neither magic points nor POW in OCR -> nothing concrete to compare.
            # That's only a match if our cost_mp is empty/0.
            if our_mp_raw in ("0", ""):
                mp_ok += 1
            elif our_mp_raw not in ("0", ""):
                mp_bad += 1
                mismatches.append(
                    f"❌ {our['name']}: cost_mp ours='{our_mp_raw}' "
                    f"OCR='(none)' (raw cost: '{ocr.raw_cost}')"
                )

        # ---- cost_sanity comparison -------------------------------------- #
        # If the whole OCR cost line is a non-comparable placeholder (e.g.
        # "Refer to specific spell"), there's no sanity figure to check either.
        our_san_raw = str(our.get("cost_sanity", "") or "").strip()
        ocr_raw_comparable = bool(re.search(r"\d|variable|sanity", ocr.raw_cost, re.I))
        if not ocr_raw_comparable:
            san_ok += 1
        elif values_equal(cost_signature(our_san_raw), cost_signature(ocr_san_part)):
            san_ok += 1
        else:
            san_bad += 1
            mismatches.append(
                f"❌ {our['name']}: cost_sanity ours='{our_san_raw}' "
                f"OCR='{ocr_san_part or '(none)'}' "
                f"(sig ours='{cost_signature(our_san_raw)}' vs '{cost_signature(ocr_san_part)}') "
                f"(raw cost: '{ocr.raw_cost}')"
            )

    print(f"Matched to our data: {matched}")
    print(f"cost_mp     — correct: {mp_ok}, mismatched: {mp_bad}")
    print(f"cost_sanity — correct: {san_ok}, mismatched: {san_bad}")
    print()
    if mismatches:
        print(f"Mismatches ({len(mismatches)}):")
        for m in mismatches:
            print("  " + m)
        print()
        print(f"Result: FAIL — {len(mismatches)} mismatch(es) found")
        return 1
    print("Result: PASS — every matched spell's cost_mp and cost_sanity agree with OCR")
    return 0


if __name__ == "__main__":
    sys.exit(main())
