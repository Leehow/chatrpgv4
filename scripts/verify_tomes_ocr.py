#!/usr/bin/env python3
"""Verify tomes.json against MinerU OCR of Table XI: Mythos Tomes.

The OCR file `checks/ocr-cached/tomes-table.md` contains the Mythos Tomes
table as HTML <tr><td>...</td></tr> rows with 9 columns:
    Title, Language, Date, Author, Wks., SAN, CMI, CMF, MR

This script parses every data row, matches it to an entry in tomes.json by
normalized name, and compares the four numeric/dice fields that exist in both
sources:

    OCR Wks. <-> full_study_weeks   (int)
    OCR SAN  <-> sanity_cost        (string, e.g. "2D10")
    OCR CMI  <-> cthulhu_mythos_initial (int, OCR is "+N")
    OCR CMF  <-> cthulhu_mythos_full    (int, OCR is "+N")
    OCR MR   <-> mythos_rating      (int)

It prints a per-field correct/wrong tally, every mismatch, unmatched OCR
titles, unmatched our-tomes, and exits 1 if anything is wrong.

Usage:
    uv run --frozen python scripts/verify_tomes_ocr.py
"""
from __future__ import annotations

import html
import json
import re
import sys
import unicodedata
from pathlib import Path

BASE = Path("plugins/coc-keeper/rulesets/coc7/rules-json")
OCR_PATH = Path("checks/ocr-cached/tomes-table.md")

# Our JSON field names <-> OCR column roles.
FIELD_INITIAL = "cthulhu_mythos_initial"   # OCR CMI
FIELD_FULL = "cthulhu_mythos_full"         # OCR CMF


def _strip_accents(s: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c)
    )


def norm_name(s: str) -> str:
    """Aggressive normalization for matching titles: lowercase, strip
    accents, drop spaces and all punctuation."""
    s = _strip_accents(s)
    s = s.lower()
    return re.sub(r"[^a-z0-9]", "", s)


def norm_dice(s: str) -> str:
    """Normalize a dice/SAN string for comparison: uppercase, no spaces."""
    return re.sub(r"\s+", "", (s or "")).upper()


# ---------------------------------------------------------------------------
# OCR parsing
# ---------------------------------------------------------------------------

def parse_ocr_rows(md: str) -> list[dict]:
    """Parse all <tr> rows with exactly 9 <td> cells. Skip header rows.
    Returns a list of dicts with keys:
        title, language, date, author, wks, san, cmi, cmf, mr  (all raw strings)
    plus a flag `clean` indicating whether wks/san/cmi/cmf/mr each contain a
    single whitespace-free token (i.e. not a merged multi-tome cell).
    """
    rows: list[dict] = []
    for tr in re.findall(r"<tr>(.*?)</tr>", md, re.S):
        cells = re.findall(r"<td>(.*?)</td>", tr, re.S)
        if len(cells) != 9:
            continue
        c = [html.unescape(x).strip() for x in cells]
        title = c[0]
        # header rows: first cell is "Title" (possibly with leading space)
        if norm_name(title) == "title":
            continue
        rows.append(
            {
                "title": title,
                "language": c[1],
                "date": c[2],
                "author": c[3],
                "wks": c[4],
                "san": c[5],
                "cmi": c[6],
                "cmf": c[7],
                "mr": c[8],
            }
        )
    return rows


def parse_int(s: str):
    """Parse an int field. Returns int or None if not parseable (empty /
    multi-value / non-numeric)."""
    s = (s or "").strip()
    if not s:
        return None
    if re.fullmatch(r"-?\d+", s):
        return int(s)
    return None


def parse_signed(s: str):
    """Parse an OCR '+N' / '0' gain field to int. Returns int or None."""
    s = (s or "").strip()
    if not s:
        return None
    m = re.fullmatch(r"([+-]?\d+)", s)
    if m:
        return int(m.group(1))
    return None


# ---------------------------------------------------------------------------
# Matching
# ---------------------------------------------------------------------------

def build_index(tomes: dict) -> list[tuple[str, str, str, dict]]:
    """Return list of (norm_key, norm_display, key, entry) for every tome, so
    we can match OCR titles against both the key and the display_name."""
    index = []
    for key, entry in tomes.items():
        disp = entry.get("display_name", "")
        index.append((norm_name(key), norm_name(disp), key, entry))
    return index


def _overlap(a: str, b: str) -> int:
    """Longest common substring length between a and b (a cheap, robust
    similarity measure for OCR-mangled names)."""
    if not a or not b:
        return 0
    la, lb = len(a), len(b)
    best = 0
    for i in range(la):
        for j in range(lb):
            k = 0
            while i + k < la and j + k < lb and a[i + k] == b[j + k]:
                k += 1
            if k > best:
                best = k
    return best


# ---------------------------------------------------------------------------
# Comparison
# ---------------------------------------------------------------------------

def split_multi(s: str) -> list[str]:
    """Split an OCR cell that may contain multiple space-separated values
    (e.g. '11 2' or '2D10 2D10'). Returns list of tokens."""
    return [t for t in re.split(r"\s+", (s or "").strip()) if t]


def _all_ints(cell: str) -> list[int]:
    """Parse ALL integers in a (possibly merged) cell, e.g. '4 16' -> [4, 16]."""
    return [int(m) for m in re.findall(r"\d+", cell or "")]


def _all_signed(cell: str) -> list[int]:
    """Parse ALL signed integers in a cell, e.g. '0 +1' -> [0, 1], '+4 +8' -> [4, 8]."""
    return [int(m.replace("+", "")) for m in re.findall(r"\+?\d+", cell or "")]


def compare_fields(ocr_row: dict, our_entry: dict):
    """Compare the five comparable fields. Yields tuples
    (field_label, our_value, ocr_value) for each MISMATCH. Uses None for
    'uncomparable' (e.g. empty OCR cell) which is skipped, not counted.

    For merged multi-edition cells (e.g. SAN '1D3 1D6', Wks '4 16'), the
    OCR lists two editions of the same tome in one row. Our single entry
    may match EITHER edition, so a mismatch is only flagged when our value
    agrees with NONE of the OCR tokens.
    """
    mismatches = []

    # --- study weeks (int) ; merged cells like '4 16' ---
    our_wks = our_entry.get("full_study_weeks")
    ocr_wks_all = _all_ints(ocr_row["wks"])
    if ocr_wks_all and our_wks is not None:
        if int(our_wks) not in ocr_wks_all:
            mismatches.append(("full_study_weeks", str(our_wks),
                               " ".join(str(x) for x in ocr_wks_all)))

    # --- sanity_cost (string) ; merged cells like '1D3 1D6' ---
    our_san = our_entry.get("sanity_cost", "")
    ocr_san_toks = split_multi(ocr_row["san"])
    if ocr_san_toks:
        if norm_dice(our_san) not in {norm_dice(t) for t in ocr_san_toks}:
            mismatches.append(("sanity_cost", str(our_san),
                               " ".join(ocr_san_toks)))

    # --- CMI / cthulhu_mythos_initial (int) ; merged '0 +1' ---
    our_cmi = our_entry.get(FIELD_INITIAL)
    ocr_cmi_all = _all_signed(ocr_row["cmi"])
    if ocr_cmi_all and our_cmi is not None:
        if int(our_cmi) not in ocr_cmi_all:
            mismatches.append((FIELD_INITIAL, str(our_cmi),
                               " ".join(str(x) for x in ocr_cmi_all)))

    # --- CMF / cthulhu_mythos_full (int) ; merged '+1 +4' ---
    our_cmf = our_entry.get(FIELD_FULL)
    ocr_cmf_all = _all_signed(ocr_row["cmf"])
    if ocr_cmf_all and our_cmf is not None:
        if int(our_cmf) not in ocr_cmf_all:
            mismatches.append((FIELD_FULL, str(our_cmf),
                               " ".join(str(x) for x in ocr_cmf_all)))

    # --- mythos_rating (int) ; merged '3 15' ---
    our_mr = our_entry.get("mythos_rating")
    ocr_mr_all = _all_ints(ocr_row["mr"])
    if ocr_mr_all and our_mr is not None:
        if int(our_mr) not in ocr_mr_all:
            mismatches.append(("mythos_rating", str(our_mr),
                               " ".join(str(x) for x in ocr_mr_all)))

    return mismatches


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

FIELD_LABELS = {
    "full_study_weeks": "Wks.",
    "sanity_cost": "SAN",
    FIELD_INITIAL: "CMI",
    FIELD_FULL: "CMF",
    "mythos_rating": "MR",
}


def _agreement(row: dict, entry: dict) -> int:
    """How many comparable fields AGREE between this OCR row and our entry.
    Used to pick the best our-entry when a duplicated OCR title has only one
    matching our-entry (e.g. two 'Book of Iod' OCR rows, one our-entry)."""
    agree = 0
    if parse_int(row["wks"]) is not None and entry.get("full_study_weeks") is not None:
        agree += int(parse_int(row["wks"]) == int(entry["full_study_weeks"]))
    toks = split_multi(row["san"])
    if toks and entry.get("sanity_cost"):
        agree += int(norm_dice(toks[0]) == norm_dice(entry["sanity_cost"]))
    if parse_signed(row["cmi"]) is not None and entry.get(FIELD_INITIAL) is not None:
        agree += int(parse_signed(row["cmi"]) == int(entry[FIELD_INITIAL]))
    if parse_signed(row["cmf"]) is not None and entry.get(FIELD_FULL) is not None:
        agree += int(parse_signed(row["cmf"]) == int(entry[FIELD_FULL]))
    if parse_int(row["mr"]) is not None and entry.get("mythos_rating") is not None:
        agree += int(parse_int(row["mr"]) == int(entry["mythos_rating"]))
    return agree


def _candidate_keys(ocr_row: dict, index) -> list[str]:
    """All our-keys whose normalized key or display_name matches the OCR row's
    title (exact, then fallback to longest-overlap substring)."""
    title = ocr_row["title"]
    target = norm_name(title)
    if not target:
        return []
    exact = [key for nk, nd, key, _e in index
             if target == nk or (nd and target == nd)]
    if exact:
        return exact
    # fallback: best overlap
    scored = []
    for nk, nd, key, _e in index:
        best = 0
        for cand in (nk, nd):
            if cand:
                best = max(best, _overlap(target, cand))
        if best >= max(4, len(target) // 2):
            scored.append((best, key))
    scored.sort(reverse=True)
    return [k for _, k in scored]


def _spaced_norm(s: str) -> str:
    """Normalize but PRESERVE spaces between tokens (for token-based edition
    cue matching). Lowercase, collapse whitespace, strip punctuation."""
    s = html.unescape(s or "").lower()
    s = re.sub(r"[\.,;:()\[\]/'`\"\u2019]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _edition_candidate_keys(ocr_row: dict, index) -> list[str]:
    """Match our edition-style descriptive keys (e.g. "English 1647 Janus
    Aquaticus") to an OCR row by its language/date/author columns.

    These keys encode "<Language> <Date> <Author>" cues that correspond to the
    OCR row's non-title columns, letting us verify edition entries whose key
    bears no resemblance to the OCR title. A key qualifies only if it shares
    distinctive author/date tokens with the OCR row.
    """
    ocr_lang = _spaced_norm(ocr_row.get("language", ""))
    ocr_date = _spaced_norm(ocr_row.get("date", ""))
    ocr_author = _spaced_norm(ocr_row.get("author", ""))
    ocr_cue_tokens = set()
    for c in (ocr_lang, ocr_date, ocr_author):
        ocr_cue_tokens.update(c.split())
    lang_words = {"english", "latin", "german", "french", "greek",
                  "chinese", "italian", "arabic", "ancient", "egyptian",
                  "spanish", "trans", "hyperborean", "burmese", "aklo",
                  "muvian"}
    matches = []
    for _nk, _nd, key, _e in index:
        spaced = _spaced_norm(key)
        key_toks = set(spaced.split())
        if not key_toks:
            continue
        # require a year/digit token OR a language word in the key
        has_year = any(re.fullmatch(r"\d{1,4}", t) and len(t) >= 3 for t in key_toks)
        has_lang = bool(key_toks & lang_words)
        if not (has_year or has_lang):
            continue
        # Distinctive cue overlap: the key must share a meaningful token
        # (author surname or date) with the OCR row beyond a bare language word.
        shared = key_toks & ocr_cue_tokens
        distinctive = shared - lang_words - {"unknown", "c", "th", "repr"}
        if distinctive:
            matches.append(key)
    return matches


def main() -> int:
    md = OCR_PATH.read_text(encoding="utf-8")
    data = json.loads((BASE / "tomes.json").read_text(encoding="utf-8"))
    tomes = data["tomes"]
    index = build_index(tomes)

    ocr_rows = parse_ocr_rows(md)
    print(f"OCR 数据行: {len(ocr_rows)}")
    print(f"我们 tomes.json: {len(tomes)} 条\n")

    # OCR rows known to be corrupt merged rows (two tomes' name cells fused,
    # stats belonging to only one of them). Verified against the printed
    # Table XI pages (pp.237-239). Excluded from assignment and comparison.
    CORRUPT_OCR_ROW_SEGMENTS = (
        "Necrolatry Necronomicon",   # stats are Necrolatry's (p.238)
        "Mum-Rath Papyri",           # stats are Monstres and their Kynde's
    )

    # ---- Best-fit assignment of OCR rows to our-tomes ----
    # Each OCR row may match several our-keys (by name) and each our-key may
    # match several OCR rows. Score every (ocr_idx, our_key) pair by field
    # agreement, then greedily assign highest-scoring pairs first so that
    # duplicate OCR titles resolve to the version whose values actually fit.
    candidates: list[tuple[int, str]] = []  # (ocr_idx, our_key) name-compatible
    for i, row in enumerate(ocr_rows):
        if not row["title"]:
            continue
        if any(seg in row["title"] for seg in CORRUPT_OCR_ROW_SEGMENTS):
            continue
        for key in _candidate_keys(row, index):
            candidates.append((i, key))
        # Edition-style descriptive keys: match by language/date/author cues.
        for key in _edition_candidate_keys(row, index):
            if (i, key) not in candidates:
                candidates.append((i, key))

    scored = []
    for i, key in candidates:
        agree = _agreement(ocr_rows[i], tomes[key])
        scored.append((agree, i, key))
    # highest agreement first; deterministic tie-break by (ocr_idx, key)
    scored.sort(key=lambda t: (-t[0], t[1], t[2]))

    assignment: dict[int, str] = {}   # ocr_idx -> our_key
    used_keys: set[str] = set()
    for _agree, i, key in scored:
        if i in assignment or key in used_keys:
            continue
        assignment[i] = key
        used_keys.add(key)

    matched = len(assignment)
    field_correct = {k: 0 for k in FIELD_LABELS}
    field_wrong = {k: 0 for k in FIELD_LABELS}
    field_compared = {k: 0 for k in FIELD_LABELS}
    wrong_lines = []

    for i in sorted(assignment):
        row = ocr_rows[i]
        key = assignment[i]
        entry = tomes[key]
        mismatches = {f: (ov, ev) for f, ov, ev in compare_fields(row, entry)}
        for field, _label in FIELD_LABELS.items():
            if not _was_compared(row, entry, field):
                continue
            field_compared[field] += 1
            if field in mismatches:
                our_v, ocr_v = mismatches[field]
                field_wrong[field] += 1
                wrong_lines.append(
                    f"❌ {key}: {field} ours='{our_v}' OCR='{ocr_v}' "
                    f"(raw row: {row['title']!r})"
                )
            else:
                field_correct[field] += 1

    print(f"匹配 (OCR row -> our tome): {matched}")
    print()
    print("各字段对比 (correct / wrong / compared):")
    for field, label in FIELD_LABELS.items():
        print(
            f"  {label:6} ({field}): "
            f"correct={field_correct[field]} wrong={field_wrong[field]} "
            f"compared={field_compared[field]}"
        )

    # Our-tomes whose only OCR attestation is a CORRUPTED/MERGED table row
    # (two tomes merged into one row; the row's stats belong to the other
    # tome). The OCR provides no reliable stats for these, so they are excluded
    # from comparison per the task's OCR-corruption rule. Stats kept as-is.
    UNCOMPARABLE_CORRUPT_OCR = {
        "Mum-Rath Papyri",  # OCR row "Monstres and their Kynde Mum-Rath
                            # Papyri" merged; stats (36/1D8/+2/+6/24) belong to
                            # Monstres and their Kynde. Not in prose chapter.
        "Necrolatry Necronomicon",  # Name cells merged across two rows; the
                            # stats (20/2D6/+4/+8/36) belong to Necrolatry
                            # (verified against printed Table XI p.238).
    }

    # --- Secondary pass: verify each still-unmatched our-tome against every
    # OCR row using edition cues (language/date/author). An OCR row may be the
    # source for several edition entries of the same tome (e.g. our
    # "Von denen Verdammten" key AND the "1907 Edith Brendall" edition key both
    # derive from the same OCR row). This pass catches field mismatches in
    # those edition entries without consuming the OCR row.
    edition_verified = 0
    edition_wrong = 0
    for key in sorted(tomes):
        if key in used_keys:
            continue
        if key in UNCOMPARABLE_CORRUPT_OCR:
            continue  # OCR row corrupted/merged; no reliable stats to compare
        entry = tomes[key]
        disp = entry.get("display_name", "")
        disp_norm = norm_name(disp)
        key_norm = norm_name(key)
        # Find OCR rows matching this entry: either via edition cues
        # (language/date/author), via the entry's display_name matching the
        # OCR title, or via the OCR title being a MERGED row that contains our
        # tome's name as a segment (e.g. OCR "Livre D'Ivon Magic and the Black
        # Arts" is two tomes merged; "Necrolatry Necronomicon" likewise).
        candidate_rows = []
        for i, row in enumerate(ocr_rows):
            if not row["title"]:
                continue
            matched = False
            cand_keys = _edition_candidate_keys(row, index)
            if key in cand_keys:
                matched = True
            row_title_norm = norm_name(row["title"])
            if disp_norm and row_title_norm == disp_norm:
                matched = True
            # Merged-title containment: our name (or display_name) is a
            # contiguous segment of the OCR title, and long enough to be
            # distinctive (>=8 chars) to avoid spurious partial matches.
            for cand in (key_norm, disp_norm):
                if cand and len(cand) >= 8 and cand in row_title_norm:
                    matched = True
                    break
            if matched:
                candidate_rows.append((i, row))
        if not candidate_rows:
            continue
        # Verify against the best-fitting candidate row (highest field agreement).
        best_i, best_row, best_agree = None, None, -1
        for i, row in candidate_rows:
            agree = _agreement(row, entry)
            if agree > best_agree:
                best_i, best_row, best_agree = i, row, agree
        if best_row is None:
            continue
        mm = {f: (ov, ev) for f, ov, ev in compare_fields(best_row, entry)}
        any_compared = False
        bad = False
        for field, _label in FIELD_LABELS.items():
            if not _was_compared(best_row, entry, field):
                continue
            any_compared = True
            if field in mm:
                our_v, ocr_v = mm[field]
                wrong_lines.append(
                    f"❌ {key}: {field} ours='{our_v}' OCR='{ocr_v}' "
                    f"(edition row: {best_row['title']!r})"
                )
                bad = True
        if any_compared:
            if bad:
                edition_wrong += 1
            else:
                edition_verified += 1
                used_keys.add(key)  # now verified; don't list as unmatched

    if edition_verified or edition_wrong:
        print(f"\n版本次校验 (edition secondary pass): "
              f"verified={edition_verified} wrong={edition_wrong}")

    # Re-sort wrong lines so the new edition mismatches appear too
    print(f"\n不一致总条目: {len(wrong_lines)}")
    for line in wrong_lines:
        print("  " + line)

    # --- unmatched OCR titles ---
    matched_ocr_indices = set(assignment)
    unmatched_ocr = [row["title"] for i, row in enumerate(ocr_rows)
                     if i not in matched_ocr_indices and row["title"]]
    print(f"\n未能匹配到 our-tome 的 OCR 标题: {len(unmatched_ocr)}")
    for t in unmatched_ocr:
        print(f"  OCR: {t!r}")

    # --- unmatched our-tomes ---
    unmatched_ours = sorted(k for k in tomes if k not in used_keys
                            and k not in UNCOMPARABLE_CORRUPT_OCR)
    print(f"\n未能匹配到 OCR 的 our-tome: {len(unmatched_ours)}")
    for k in unmatched_ours:
        disp = tomes[k].get("display_name", "")
        extra = f"  (display_name={disp!r})" if disp else ""
        print(f"  OUR: {k!r}{extra}")
    if UNCOMPARABLE_CORRUPT_OCR & set(tomes):
        print(f"\nOCR 行损坏/合并，无可比对数据 (NOT mismatches):")
        for k in sorted(UNCOMPARABLE_CORRUPT_OCR & set(tomes)):
            print(f"  - {k!r} (OCR row merged; stats unrecoverable)")

    print(
        f"\n结论: 匹配 {matched}, 不一致 {len(wrong_lines)}, "
        f"未匹配 OCR {len(unmatched_ocr)}, 未匹配 OUR {len(unmatched_ours)}"
    )
    return 1 if wrong_lines else 0


def _was_compared(row: dict, entry: dict, field: str) -> bool:
    """True if the given field had comparable values on both sides."""
    if field == "full_study_weeks":
        return parse_int(row["wks"]) is not None and entry.get(field) is not None
    if field == "sanity_cost":
        return bool(split_multi(row["san"])) and bool(entry.get(field))
    if field == FIELD_INITIAL:
        return parse_signed(row["cmi"]) is not None and entry.get(field) is not None
    if field == FIELD_FULL:
        return parse_signed(row["cmf"]) is not None and entry.get(field) is not None
    if field == "mythos_rating":
        return parse_int(row["mr"]) is not None and entry.get(field) is not None
    return False


if __name__ == "__main__":
    sys.exit(main())
