#!/usr/bin/env python3
"""Verify monster stats in monsters.json against MinerU OCR markdown.

Compares ALL 37 monsters in monsters.json against the cached OCR at
checks/ocr-cached/monsters-ch14.md, checking:
  * characteristics: STR/CON/SIZ/DEX/INT/POW/HP
  * SAN loss (success / failure)
  * attack damage dice

Handles three OCR stat-block layouts:
  1. HTML <table> with one <td> per cell:
        <tr><td> STR</td><td>90</td><td>(5D6 x5)</td></tr>
  2. HTML <table> with the label+value fused into a single <td>:
        <tr><td>STR 105</td><td>(3D6 x10)</td></tr>
  3. Deity flat text (big numbers don't trigger table layout):
        STR 700 CON 550 SIZ 1050 DEX105 INT210
        POW 210 HP160

The matcher prefers EXACT normalized equality, then singular/plural
variants, then a distinctive-token fallback -- so 'VAMPIRES' matches
'Vampire' rather than 'STAR VAMPIRES'.

Monsters with no OCR stat block (Mi-Go, Gnorri, Zoog, Ghost, Walter
Corbitt) are listed as "cannot verify" and do NOT count as mismatches.

Exit 0 = everything comparable matches; non-zero = mismatches found.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ATTRS = ["STR", "CON", "SIZ", "DEX", "INT", "POW", "HP"]

# Our 37 monster keys that are expected to be uncomparable (no OCR stat
# block in monsters-ch14.md). These are reported separately and never
# counted as mismatches.
EXPECTED_NO_OCR = {"Mi-Go", "Gnorri", "Zoog", "Ghost", "Walter Corbitt"}

# Leading title words to strip when mapping an OCR deity heading to our
# key, e.g. "GREAT CTHULHU" -> "CTHULHU".
TITLE_PREFIXES = ("GREAT ", "THE ", "MIGHTY ", "ELDER ")


def normalize(s: str) -> str:
    """Aggressive normalization: uppercase, drop spaces/hyphens/apostrophes/dots."""
    return re.sub(r"[\s\-\u2019'\.]", "", s.upper())


# Curated plural->singular map for the OCR rulebook naming. This is far
# more reliable than algorithmic singularization (which mangles
# WEREWOLVES->WEREWOLVE and ZOMBIES->ZOMBY). Covers every plural heading
# in monsters-ch14.md that maps to one of our keys.
PLURAL_MAP = {
    "ONES": "ONE",
    "VAMPIRES": "VAMPIRE",
    "WEREWOLVES": "WEREWOLF",
    "ZOMBIES": "ZOMBIE",
    "SHOGGOTHS": "SHOGGOTH",
    "SHANTAKS": "SHANTAK",
    "GHOULS": "GHOUL",
    "GHASTS": "GHAST",
    "DHOLES": "DHOLE",
    "HOUNDS": "HOUND",
    "HORRORS": "HORROR",
    "POLYPS": "POLYP",
    "SHAMBLERS": "SHAMBLER",
    "SPAWN": "SPAWN",
    "ADULTS": "ADULT",
    "MUMMIES": "MUMMY",
    "SKELETONS": "SKELETON",
    "COLOURS": "COLOUR",
    "CRAWLING": "CRAWLING",
}


def singularize_words(phrase: str) -> str:
    """Map known plural words to singular; leave others untouched.

    Uses a curated map plus a conservative IES->Y / S->strip fallback for
    any word not in the map.
    """
    out = []
    for w in phrase.upper().split():
        if w in PLURAL_MAP:
            out.append(PLURAL_MAP[w])
        elif w.endswith("IES") and len(w) > 5:
            out.append(w[:-3] + "Y")        # LADIES -> LADY
        elif w.endswith("S") and not w.endswith("SS") and w not in PLURAL_MAP:
            out.append(w[:-1])              # HOUNDS -> HOUND
        else:
            out.append(w)
    return " ".join(out)


def parse_flat_stats(text: str) -> dict[str, int]:
    """Parse deity-style flat text: 'STR 700 CON 550 ... DEX105 INT210'.

    Handles run-together tokens like 'SIZ300INT100POW150' by scanning for
    each ATTR keyword followed by optional spaces and an integer.
    """
    stats: dict[str, int] = {}
    for attr in ATTRS:
        # ATTR optionally followed by spaces, then digits. We use a
        # leading word boundary and a trailing non-digit lookahead (NOT
        # \b) so run-together tokens like 'SIZ300INT100' still parse:
        # 'SIZ300' matches because '0'->'I' is not a \b, so a \b anchor
        # would fail here.
        m = re.search(rf"(?<![A-Z]){attr}\s*(\d+)(?!\d)", text)
        if m:
            stats[attr] = int(m.group(1))
    return stats


def parse_table_stats(table_html: str) -> dict[str, int]:
    """Parse a stat <table> ... </table>.

    Row shapes that occur:
      A. split:  <tr><td> STR</td><td>90</td><td>(5D6 x5)</td></tr>
      B. fused:  <tr><td>STR 105</td><td>(3D6 x10)</td></tr>
      C. prefixed (Colour Out of Space's uniquely mangled OCR table):
            <tr><td>char. STR</td><td>averages 15</td>...</tr>
            <tr><td> DEX</td><td>95</td>...</tr>
            <tr><td>INT</td><td>70 50*</td>...</tr>
         where the value cell may have a text prefix ('averages ') or a
         trailing second number ('70 50*'); we take the first integer.
    """
    stats: dict[str, int] = {}
    for attr in ATTRS:
        # Shape A: label in its own td, value in the next td (pure int).
        m = re.search(
            rf"<td>\s*{attr}\s*</td>\s*<td>\s*(\d+)\s*</td>",
            table_html,
        )
        if m:
            stats[attr] = int(m.group(1))
            continue
        # Shape B: 'STR 105' inside a single td.
        m = re.search(rf"<td>\s*{attr}\s+(\d+)\s*</td>", table_html)
        if m:
            stats[attr] = int(m.group(1))
            continue
        # Shape C: label td contains the attr anywhere (e.g. 'char. STR'),
        # and the NEXT td's first integer is the value (e.g. 'averages 15'
        # or '70 50*'). Skip 'N/A' values.
        m = re.search(
            rf"<td>[^<]*\b{attr}\b[^<]*</td>\s*<td>[^<]*?(\d+)",
            table_html,
        )
        if m:
            stats[attr] = int(m.group(1))
            continue
        # Shape B/C variant: 'HP: 13' inside a td.
        if attr == "HP":
            m = re.search(r"<td>\s*HP:?\s*(\d+)\s*</td>", table_html)
            if m:
                stats["HP"] = int(m.group(1))
    return stats


def parse_hp_loose(chunk: str) -> int | None:
    """Find an HP value that lives outside the table, e.g. 'HP: 13' on its
    own line, or '## HP: 9' heading. Returns the first plausible value.
    """
    for m in re.finditer(r"HP:?\s*(\d{1,4})\b", chunk):
        val = int(m.group(1))
        # Sanity bound: HP for these monsters ranges 4..400ish.
        if 1 <= val <= 9999:
            return val
    return None


def parse_san(chunk: str) -> dict[str, str] | None:
    """Parse a Sanity Loss line.

    Matches 'Sanity Loss: X/Y ...', 'Sanity Los: X/Y ...' (OCR typo),
    or 'Sanity Loss X/Y ...'. Returns {'success': X, 'failure': Y} or
    None.
    """
    # Allow 'Loss' or 'Los' (OCR truncation), then optional colon/space.
    m = re.search(
        r"Sanity\s+Los[s]?:?\s*([0-9Dd]+)\s*/\s*([0-9Dd]+)",
        chunk,
    )
    if not m:
        return None
    return {"success": m.group(1).upper(), "failure": m.group(2).upper()}


def parse_attacks(chunk: str) -> list[str]:
    """Extract damage dice from ATTACKS-section attack *entries*.

    An attack entry is a line containing a weapon/skill name followed by
    a percentage chance and 'damage <dice>', e.g.:
        'Fighting 85% (42/17), damage 1D10'
        'Bite 50% (25/10), damage 1D4 + special (see above)'
        'Fighting 75% (37/15), damage 2D6 (thrashing tentacles)'
    We deliberately IGNORE 'Average Damage Bonus: +5D6' and 'Wind blast
    70%, damage bonus' (no dice after 'damage') lines.
    Returns a list of normalized core-dice tokens like '1D6', '1D4'.
    """
    dice: list[str] = []
    for line in chunk.splitlines():
        # Must look like an attack entry: contains a '%' chance.
        if "%" not in line:
            continue
        # Must mention 'damage' on the same line.
        low = line.lower()
        if "damage" not in low:
            continue
        # Reject 'Average Damage Bonus' / 'Damage Bonus:' description lines.
        if "damage bonus" in low and "damage " in low:
            # Keep only if there's an actual dice token AFTER 'damage'
            # that is NOT just 'bonus'.
            pass
        # Find the dice token(s) following 'damage'.
        m = re.search(
            r"damage\s+(?:equals\s+)?([0-9]+D[0-9]+)",
            line,
            re.IGNORECASE,
        )
        if m:
            dice.append(m.group(1).upper())
    return dice


def core_dice(token: str) -> str:
    """Normalize a damage string to its leading dice token.

    '1D6+DB'        -> '1D6'
    '1D4+DB'        -> '1D4'
    '1D10+DB'       -> '1D10'
    '1D4 per round' -> '1D4'
    'varies'        -> ''  (uncomparable)
    'special: ...'  -> ''  (uncomparable)
    """
    t = token.strip().upper()
    m = re.match(r"([0-9]+D[0-9]+)", t)
    return m.group(1) if m else ""


def split_chunks(md: str) -> list[tuple[str, str]]:
    """Split the markdown into (heading_line, chunk_text) pairs.

    A chunk is everything from one '#'-heading line up to (but not
    including) the next '#'-heading line. Additionally, a PLAIN-TEXT line
    matching the stat-block-heading shape (ALL-CAPS name + comma + epithet)
    that is immediately followed by a '<table>' is treated as a chunk
    boundary — the OCR occasionally drops the '## ' prefix from a stat-block
    heading (e.g. 'MI-GO, Enigmatic scientists from Yuggoth').
    """
    lines = md.splitlines(keepends=True)
    # Pre-scan: detect plain-text stat-block headings (no '#' prefix) that
    # precede a stat table, so we can promote them to chunk boundaries.
    plain_stat_headings: set[int] = set()
    bare_lines = md.splitlines()
    for i, ln in enumerate(bare_lines):
        stripped = ln.strip()
        if not stripped or stripped.startswith("#"):
            continue
        # shape: 'NAME, epithet' with an ALL-CAPS name run
        if re.match(r"^[A-Z][A-Z\u2019'\.\- ]+,\s", stripped) and \
                re.search(r"[A-Z]{2,}", stripped) and \
                stripped.upper() not in NON_STAT_ALLCAPS:
            # must be followed (within 4 lines) by a '<table>' containing STR
            window = "\n".join(bare_lines[i + 1:i + 5])
            if "<table>" in window and "STR" in window.upper():
                plain_stat_headings.add(i)

    chunks: list[tuple[str, str]] = []
    cur_heading: str | None = None
    cur: list[str] = []
    for idx, line in enumerate(lines):
        is_hash_heading = line.lstrip().startswith("#")
        is_plain_stat = idx in plain_stat_headings
        if is_hash_heading or is_plain_stat:
            if cur_heading is not None:
                chunks.append((cur_heading, "".join(cur)))
            # normalize a plain-text stat heading to look like a '## ' heading
            cur_heading = line if is_hash_heading else ("## " + line.lstrip())
            cur = []
        else:
            if cur_heading is None:
                # preamble before any heading -- skip
                continue
            cur.append(line)
    if cur_heading is not None:
        chunks.append((cur_heading, "".join(cur)))
    return chunks


# All-caps headings that are NOT monster stat blocks (section labels).
NON_STAT_ALLCAPS = {
    "ATTACKS",
    "SPECIAL POWERS",
    "OTHER CHARACTERISTICS",
    "CULT",
    "HUMAN FORM",
    "SHOGGOTH FORM",
}


def stat_block_heading(heading: str) -> str | None:
    """Return the monster name if this heading is a stat-block heading,
    else None.

    Recognized shapes:
      '## BYAKHEE, The star-steeds'              ALL-CAPS name, comma, epithet
      '## GREAT CTHULHU, Master of R\\'lyeh'      ALL-CAPS (may have GREAT prefix)
      '## DARK YOUNG of Shub-Niggurath'           2+ ALL-CAPS words then mixed case, no comma
    The name is the leading run of ALL-CAPS words. Returns None for
    section labels like ATTACKS / SPECIAL POWERS even though they are
    all-caps.
    """
    bare = heading.strip().lstrip("#").strip().upper()
    if bare in NON_STAT_ALLCAPS:
        return None

    # Form 1: name up to a comma. The name may contain ALL-CAPS words
    # plus lowercase connectors ('and', 'of', 'the') as in
    # '## DAGON and HYDRA, Rulers of the deep ones'. We require the name
    # to start with an uppercase letter and contain at least one run of
    # 2+ uppercase letters (to reject prose headings).
    m = re.match(r"^#{1,6}\s+([A-Za-z][A-Za-z\u2019'\.\- ]+?),\s", heading)
    if m:
        candidate = m.group(1).strip()
        if re.search(r"[A-Z]{2,}", candidate):
            return candidate
    # Form 2: bare ALL-CAPS name, no epithet.
    m = re.match(r"^#{1,6}\s+([A-Z][A-Z\u2019'\.\- ]+?)\s*$", heading)
    if m:
        return m.group(1).strip()
    # Form 3: leading ALL-CAPS words followed by mixed-case epithet
    # (no comma), e.g. 'DARK YOUNG of Shub-Niggurath'. Capture two or
    # more ALL-CAPS words so single-word noise like 'Cult' is rejected.
    m = re.match(
        r"^#{1,6}\s+([A-Z][A-Z]+(?:\s+[A-Z][A-Z]+)+)(?:\s+[a-z].*)?\s*$",
        heading,
    )
    if m:
        return m.group(1).strip()
    return None


def parse_ocr(md: str) -> dict[str, dict]:
    """Parse the OCR markdown into a dict of stat blocks keyed by raw
    OCR heading name (UPPERCASE). Each value has keys: str/con/siz/dex/
    int/pow/hp (ints where available), san {success,failure}, attacks
    [list of dice], raw_heading.
    """
    chunks = split_chunks(md)

    blocks: dict[str, dict] = {}
    for idx, (heading, body) in enumerate(chunks):
        name = stat_block_heading(heading)
        if not name:
            continue  # not a stat block (prose, ATTACKS, SPECIAL POWERS, ...)
        key = name.upper()

        stats: dict[str, int] = {}

        # Build the list of bodies to scan for THIS monster's stat table,
        # being careful NOT to steal a table that belongs to a later stat
        # block. We scan: this chunk, the previous chunk (Colour Out of
        # Space's table is misplaced there), and ahead chunks ONLY while
        # they are non-stat-block interstitials (ATTACKS, SPECIAL POWERS,
        # etc.) -- stop at the first chunk that is itself a stat block.
        interstitial_skip = {
            "ATTACKS",
            "SPECIAL POWERS",
            "OTHER CHARACTERISTICS",
            "CULT",
            "HUMAN FORM",
            "SHOGGOTH FORM",
        }

        def scan_table_for_str(text: str) -> dict[str, int]:
            tbl = re.search(r"<table>(.*?)</table>", text, re.S)
            if not tbl:
                return {}
            got = parse_table_stats(tbl.group(1))
            # Accept if we found STR, or at least 2 characteristics (the
            # Colour Out of Space table yields STR/DEX/INT via Shape C).
            return got if (got.get("STR") or len(got) >= 2) else {}

        # 1a) This chunk's own table.
        stats.update(scan_table_for_str(body))
        # 1b) Ahead through interstitial non-stat-block chunks (Nightgaunt
        #     has its table under the following '## ATTACKS' heading).
        if "STR" not in stats:
            j = idx + 1
            while j < len(chunks):
                nh = chunks[j][0].strip().lstrip("#").strip().upper()
                if nh in interstitial_skip:
                    stats.update(scan_table_for_str(chunks[j][1]))
                    if stats.get("STR"):
                        break
                    j += 1
                    continue
                # Stop at any real heading (stat block or otherwise) --
                # don't cross into another monster's territory.
                break
        # 1c) Previous chunks (Colour Out of Space's table is misplaced
        #    several chunks back -- it sits in the tail of the Chthonian
        #    descriptive section). Scan back up to 6 chunks, but only
        #    while the intervening chunk is NOT itself a stat block.
        if "STR" not in stats:
            back = idx - 1
            steps = 0
            while back >= 0 and steps < 6:
                bh = chunks[back][0].strip().lstrip("#").strip().upper()
                if bh in interstitial_skip or stat_block_heading(chunks[back][0]) is None:
                    stats.update(scan_table_for_str(chunks[back][1]))
                    if stats.get("STR"):
                        break
                    back -= 1
                    steps += 1
                    continue
                break

        # 2) If still no STR from a table, try deity flat-text in this
        #    chunk and the immediately-next chunk.
        if "STR" not in stats:
            stats.update(parse_flat_stats(body))
        if "STR" not in stats and idx + 1 < len(chunks):
            stats.update(parse_flat_stats(chunks[idx + 1][1]))

        # 4) HP is often outside the table ('HP: 13', '## HP: 9').
        if "HP" not in stats:
            # Search a window: this chunk + the next chunk (HP sometimes
            # lands just after the next heading, e.g. Zombies 'HP: 5' or
            # Star-Spawn where OCR dropped HP entirely).
            window = body
            if idx + 1 < len(chunks):
                window = body + "\n" + chunks[idx + 1][1]
            hp = parse_hp_loose(window)
            if hp is not None:
                stats["HP"] = hp

        # We need enough stats to consider this a real stat block.
        # Normally STR is present, but deities with 'STR N/A' (Azathoth,
        # Yog-Sothoth) legitimately lack STR -- accept if we have at
        # least 3 of the 7 characteristics.
        found_attrs = sum(1 for a in ATTRS if a in stats)
        if found_attrs < 3:
            continue

        san = parse_san(body)
        # SAN sometimes lands in a later chunk (interstitial or
        # descriptive). Walk ahead through chunks that are NOT a new stat
        # block, up to a small distance cap, to find this monster's SAN.
        if san is None:
            j = idx + 1
            steps = 0
            while j < len(chunks) and steps < 5:
                if stat_block_heading(chunks[j][0]) is not None:
                    break  # next monster's territory
                san = parse_san(chunks[j][1])
                if san:
                    break
                j += 1
                steps += 1

        # Attacks: scan this chunk + following INTERSTITIAL chunks (ATTACKS,
        # SPECIAL POWERS, etc.) only. Stop at any chunk that is a stat block
        # OR a prose heading for a different monster (e.g. '## Nightgaunt') --
        # we must not cross into another monster's attack entries.
        atk_parts = [body]
        j = idx + 1
        steps = 0
        while j < len(chunks) and steps < 5:
            nh = chunks[j][0].strip().lstrip("#").strip().upper()
            if stat_block_heading(chunks[j][0]) is not None:
                break  # next monster's stat block
            if nh not in interstitial_skip:
                break  # prose/other heading -- another monster's territory
            atk_parts.append(chunks[j][1])
            j += 1
            steps += 1
        attacks = parse_attacks("\n".join(atk_parts))

        blocks[key] = {
            "str": stats.get("STR"),
            "con": stats.get("CON"),
            "siz": stats.get("SIZ"),
            "dex": stats.get("DEX"),
            "int": stats.get("INT"),
            "pow": stats.get("POW"),
            "hp": stats.get("HP"),
            "san": san,
            "attacks": attacks,
            "raw_heading": name,
        }
    return blocks


def strip_title_prefix(name: str) -> str:
    """Strip leading honorifics: 'GREAT CTHULHU' -> 'CTHULHU'."""
    upper = name.upper()
    for pref in TITLE_PREFIXES:
        if upper.startswith(pref):
            return name[len(pref):].strip()
    return name


def name_tokens(name: str) -> list[str]:
    """Split a name into normalized word tokens (no spaces/hyphens)."""
    return [t for t in re.split(r"[\s\-\u2019'\.]", name.upper()) if t]


def score_match(ocr_name: str, our_key: str) -> int:
    """Score how well an OCR name matches one of our keys. Higher = better.

    Returns 0 for no match. The tiers (highest first):
      100  exact normalized equality (after singularization + title strip)
       90  our-key normalized is a CONTIGUOUS leading segment of the OCR
           name's token list, or vice versa, AND the OCR name has no
           extra distinctive word beyond our key (excludes 'SHOGGOTH
           LORD' matching 'Shoggoth' while 'SHOGGOTHS' is available)
       50  distinctive-token containment (fallback)
    """
    ocr_stripped = strip_title_prefix(ocr_name)
    ocr_toks = name_tokens(ocr_stripped)
    ocr_sing_toks = name_tokens(singularize_words(ocr_stripped))
    our_toks = name_tokens(our_key)
    our_sing_toks = name_tokens(singularize_words(our_key))

    ocr_norm = normalize(ocr_stripped)
    ocr_sing_norm = normalize(singularize_words(ocr_stripped))
    our_norm = normalize(our_key)
    our_sing_norm = normalize(singularize_words(our_key))

    # Tier 100: exact (with singularization + PEOPLE<->PERSON).
    variants_ocr = {ocr_norm, ocr_sing_norm,
                    ocr_norm.replace("PEOPLE", "PERSON"),
                    ocr_sing_norm.replace("PEOPLE", "PERSON")}
    variants_ours = {our_norm, our_sing_norm,
                     our_norm.replace("PERSON", "PEOPLE"),
                     our_sing_norm.replace("PERSON", "PEOPLE")}
    if variants_ocr & variants_ours:
        return 100

    # Tier 90: our-key tokens form a leading contiguous run of the OCR
    # tokens (singularized on both sides). E.g. OCR 'HOUNDS OF TINDALOS'
    # -> sing ['HOUND','OF','TINDALOS']; our 'Hound of Tindalos' ->
    # ['HOUND','OF','TINDALOS'] -> equal -> tier 100 actually. But OCR
    # 'DAGON AND HYDRA' -> ['DAGON','AND','HYDRA']; our 'Dagon' ->
    # ['DAGON'] is a leading run -> tier 90. Crucially 'SHOGGOTH LORD'
    # vs 'Shoggoth': our ['SHOGGOTH'] is a leading run of OCR
    # ['SHOGGOTH','LORD'] -> tier 90. But 'SHOGGOTHS' vs 'Shoggoth':
    # sing OCR ['SHOGGOTH'] == our ['SHOGGOTH'] -> tier 100. So the
    # SHOGGOTHS block wins (100 > 90). Good.
    def is_leading_run(short: list[str], long: list[str]) -> bool:
        if not short or len(short) > len(long):
            return False
        return long[: len(short)] == short

    for ocr_t, our_t in ((ocr_sing_toks, our_sing_toks), (ocr_toks, our_toks)):
        if is_leading_run(our_t, ocr_t):
            # Penalize if OCR has extra DISTINCTIVE tokens beyond our
            # key (means a different monster). 'LORD' is distinctive.
            extra = ocr_t[len(our_t):]
            distinctive_extra = [w for w in extra if w not in GENERIC_WORDS]
            if not distinctive_extra:
                return 90
            return 60

    # Tier 50: distinctive-token containment.
    ocr_dist = distinctive_token(ocr_stripped)
    if len(ocr_dist) >= 4:
        if ocr_dist in our_norm or ocr_dist in our_sing_norm:
            return 50

    return 0


GENERIC_WORDS = {
    "OF", "THE", "AND", "GREAT", "YOUN", "A", "AN",
    "FULL", "ADULT", "ADULTS", "FORM", "HUMANOID",
}


def distinctive_token(name: str) -> str:
    """Pick the most distinctive token from a name for token-matching.

    Drops generic words (OF, THE, GREAT, etc.) and returns the longest
    remaining token (e.g. 'TINDALOS' from 'HOUNDS OF TINDALOS').
    """
    tokens = [t for t in name_tokens(name) if t and t not in GENERIC_WORDS]
    if not tokens:
        return ""
    tokens.sort(key=len, reverse=True)
    return tokens[0]


def best_match_ocr_to_keys(
    ocr_blocks: dict[str, dict], our_keys: list[str]
) -> tuple[dict[str, str], list[str], list[str]]:
    """Globally assign each of our keys to at most one OCR block, using a
    score-based greedy that processes the highest-scoring (pair) first.

    Returns (matches, unmatched_ocr_keys, unmatched_our_keys) where
    matches maps our_key -> ocr_block_key.
    """
    # Score every (ocr_block, our_key) pair with a non-zero score.
    pairs: list[tuple[int, str, str]] = []
    for obk in ocr_blocks:
        for k in our_keys:
            s = score_match(obk, k)
            if s > 0:
                pairs.append((s, obk, k))

    # Greedy: highest score first; tiebreak by shorter OCR name then
    # shorter our-key (prefers 'VAMPIRES' over 'STAR VAMPIRES' when both
    # could match 'Vampire').
    pairs.sort(key=lambda p: (-p[0], len(p[1]), p[1], len(p[2]), p[2]))

    matches: dict[str, str] = {}     # our_key -> ocr_block_key
    used_ocr: set[str] = set()
    for score, obk, k in pairs:
        if k in matches or obk in used_ocr:
            continue
        matches[k] = obk
        used_ocr.add(obk)

    unmatched_ocr = [b for b in ocr_blocks if b not in used_ocr]
    unmatched_ours = [k for k in our_keys if k not in matches]
    return matches, unmatched_ocr, unmatched_ours


def cmp_stat(our_val, ocr_val: int | None, monster_key: str = "", attr: str = "") -> tuple[bool, str]:
    """Compare one characteristic. Returns (ok, message). Skips when our
    value is non-numeric ('N/A', 'varies') or OCR is missing."""
    if ocr_val is None:
        return True, ""
    if our_val is None:
        return True, ""
    if isinstance(our_val, str) and not re.fullmatch(r"-?\d+", str(our_val)):
        return True, ""  # 'N/A' / 'varies' -- not comparable
    try:
        if int(our_val) == int(ocr_val):
            return True, ""
        # Documented OCR misreads: the OCR value is implausible (violates the
        # derived-attributes formula) and our value is the sensible one. Per
        # the task rule, keep the sensible value and do not flag a mismatch.
        if (monster_key, attr) in KNOWN_OCR_ARTIFACTS:
            return True, ""
        return False, ""
    except (ValueError, TypeError):
        return True, ""


# (monster_key, attribute) pairs where the OCR value is a known misread
# (implausible / violates derived-attributes formula). Our value is kept.
#   Zombie: OCR "HP: 5" is impossible for CON 80 / SIZ 65 (derived HP = 14).
KNOWN_OCR_ARTIFACTS = {("Zombie", "HP")}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--md", default="checks/ocr-cached/monsters-ch14.md")
    ap.add_argument(
        "--monsters",
        default="plugins/coc-keeper/rulesets/coc7/rules-json/monsters.json",
    )
    args = ap.parse_args()

    md = Path(args.md).read_text(encoding="utf-8")
    data = json.loads(Path(args.monsters).read_text(encoding="utf-8"))
    monsters = data["monsters"]

    ocr_blocks = parse_ocr(md)
    our_keys = list(monsters.keys())

    print(f"OCR stat blocks parsed: {len(ocr_blocks)}")
    print(f"Our monsters: {len(our_keys)}")
    print()

    # Globally match OCR blocks to our keys (score-based, highest first).
    matches, unmatched_ocr, _ = best_match_ocr_to_keys(ocr_blocks, our_keys)

    print(f"Matched: {len(matches)}/{len(our_keys)} of our monsters")
    print("Matched monsters (our_key  <-  OCR heading):")
    for k in our_keys:
        if k in matches:
            print(f"  {k}  <-  {ocr_blocks[matches[k]]['raw_heading']}")
    print()
    if unmatched_ocr:
        print(f"OCR blocks with no our-key match ({len(unmatched_ocr)}):")
        for b in unmatched_ocr:
            print(f"  - {ocr_blocks[b]['raw_heading']}")
    print()

    # Compare.
    mismatches: list[str] = []
    stats_ok = 0
    san_ok = 0
    san_cmp = 0
    atk_checked = 0

    for our_key in our_keys:
        if our_key not in matches:
            continue
        obk = matches[our_key]
        ocr = ocr_blocks[obk]
        ours = monsters[our_key]

        # Characteristics.
        stat_mismatch = False
        for attr in ATTRS:
            ok, _ = cmp_stat(ours.get(attr.lower()), ocr.get(attr.lower()),
                             our_key, attr)
            if not ok:
                stat_mismatch = True
                mismatches.append(
                    f"❌ {our_key}.{attr}: ours={ours.get(attr.lower())} "
                    f"OCR={ocr.get(attr.lower())}"
                )
        if not stat_mismatch:
            stats_ok += 1

        # SAN.
        if ocr.get("san"):
            san_cmp += 1
            our_san = ours.get("san_loss", {})
            s_ok = str(our_san.get("success", "")).upper() == ocr["san"]["success"]
            f_ok = str(our_san.get("failure", "")).upper() == ocr["san"]["failure"]
            if s_ok and f_ok:
                san_ok += 1
            else:
                if not s_ok:
                    mismatches.append(
                        f"❌ {our_key}.san.success: ours={our_san.get('success')} "
                        f"OCR={ocr['san']['success']}"
                    )
                if not f_ok:
                    mismatches.append(
                        f"❌ {our_key}.san.failure: ours={our_san.get('failure')} "
                        f"OCR={ocr['san']['failure']}"
                    )

        # Attacks: compare the set of core dice tokens. We only flag if
        # OCR has dice AND none of our attacks' core dice appear in OCR
        # (i.e. our listed damage is entirely absent from OCR). This is
        # conservative -- OCR attack lines are noisy.
        ocr_dice = {d for d in ocr.get("attacks", []) if d}
        our_dice = {core_dice(a.get("damage", "")) for a in ours.get("attacks", [])}
        our_dice.discard("")
        if ocr_dice and our_dice:
            atk_checked += 1
            if not (our_dice & ocr_dice):
                mismatches.append(
                    f"❌ {our_key}.attacks.damage: ours={sorted(our_dice)} "
                    f"OCR={sorted(ocr_dice)}"
                )

    print(f"Characteristics all-match: {stats_ok}/{len(matches)}")
    print(f"SAN all-match:             {san_ok}/{san_cmp}")
    print(f"Attack damage checked:     {atk_checked}")
    print()

    if mismatches:
        print(f"MISMATCHES ({len(mismatches)}):")
        for m in mismatches:
            print(f"  {m}")
    else:
        print("No mismatches among comparable monsters.")
    print()

    # No-OCR-stat-block monsters (NOT mismatches).
    no_ocr = [k for k in our_keys if k not in matches]
    expected_missing = [k for k in no_ocr if k in EXPECTED_NO_OCR]
    unexpected_missing = [k for k in no_ocr if k not in EXPECTED_NO_OCR]
    print("No OCR stat block (cannot verify) -- NOT mismatches:")
    for k in expected_missing:
        print(f"  - {k}")
    if unexpected_missing:
        print("UNEXPECTEDLY missing OCR stat block (investigate):")
        for k in unexpected_missing:
            print(f"  - {k}")

    print()
    print(f"Result: {len(mismatches)} mismatch(es).")
    return 1 if mismatches else 0


if __name__ == "__main__":
    sys.exit(main())
