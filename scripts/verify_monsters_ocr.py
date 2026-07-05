#!/usr/bin/env python3
"""Verify monster stats in monsters.json against MinerU OCR markdown.

MinerU recovers stat blocks as HTML <table> rows in correct reading order,
which is far more reliable than pypdf/PyMuPDF on the 2-column rulebook PDF.

Usage:
    python3 scripts/verify_monsters_ocr.py [--md PATH] [--monsters PATH]

Exit 0 = all verified; non-zero = mismatches found.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ATTRS = ["STR", "CON", "SIZ", "DEX", "INT", "POW", "HP"]


def parse_stat_tables(md: str) -> dict[str, dict]:
    """Extract stat blocks from mineru markdown.

    Two formats occur:
    1. Regular monsters: HTML <table> with rows
        <tr><td> STR</td><td>90</td><td>(5D6 x5)</td></tr>
    2. Deities: flat text (big numbers don't trigger table layout)
        STR 700 CON 550 SIZ 1050 DEX105 INT210
        POW 210 HP160

    The monster name is in a preceding heading:
        ## BYAKHEE, The star-steeds   (regular)
        ## HASTUR, He Who Is Not...    (deity)
    """
    results = {}
    # Split on headings: "## UPPERCASE NAME," (with comma epithet)
    chunks = re.split(r'(?=^#{1,3}\s+[A-Z][A-Z\-\'\. ]+,)', md, flags=re.M)
    for chunk in chunks:
        m = re.match(r'^#{1,3}\s+([A-Z][A-Z\-\'\. ]+),', chunk)
        if not m:
            continue
        raw_name = m.group(1).strip()
        stats = {}
        # Format 1: HTML table
        tbl = re.search(r'<table>(.*?)</table>', chunk, re.S)
        if tbl:
            table_html = tbl.group(1)
            for attr in ATTRS:
                row = re.search(
                    rf'<td>\s*{attr}\s*</td>\s*<td>\s*(\d+)\s*</td>',
                    table_html,
                )
                if row:
                    stats[attr] = int(row.group(1))
            if "HP" not in stats:
                hp_m = re.search(r'HP:?\s*(\d+)', chunk[:600])
                if hp_m:
                    stats["HP"] = int(hp_m.group(1))
        # Format 2: flat text (deity) — parse from the chunk text
        if not stats.get("STR"):
            # Take first 500 chars after heading for deity stat line
            head_end = chunk.find("\n", chunk.find(",") if "," in chunk else 0)
            text_block = chunk[head_end:head_end + 500] if head_end > 0 else chunk[:500]
            for attr in ATTRS:
                # "STR 700" or "STR700" or "DEX150" (粘连)
                # match attr followed by optional space then digits
                pm = re.search(rf'{attr}\s*(\d+)', text_block)
                if pm:
                    stats[attr] = int(pm.group(1))
        if stats.get("STR") and len(stats) >= 4:
            results[raw_name.upper()] = stats
    return results


def match_name(pdf_name: str, monsters: dict) -> str | None:
    """Match an OCR'd all-caps name to a monsters.json key.

    Handles rulebook plural/variant naming (word-level singularization):
      HOUNDS OF TINDALOS -> Hound of Tindalos
      SERPENT PEOPLE     -> Serpent Person
      DEEP ONES          -> Deep One
      STAR VAMPIRES      -> Star Vampire
      MUMMIES            -> Mummy
    """
    def norm(s: str) -> str:
        return re.sub(r"[\s\-\']", "", s.upper())

    def singularize_words(phrase: str) -> str:
        """Word-level plural -> singular on a space-separated phrase."""
        out = []
        for w in phrase.upper().split():
            if w.endswith("IES") and len(w) > 4:
                out.append(w[:-3] + "Y")     # MUMMIES -> MUMMY
            elif w.endswith("S") and not w.endswith("SS"):
                out.append(w[:-1])           # HOUNDS -> HOUND, ONES -> ONE
            else:
                out.append(w)
        return " ".join(out)

    pdf_variants = set()
    for variant in (pdf_name, singularize_words(pdf_name)):
        v = norm(variant)
        pdf_variants.add(v)
        pdf_variants.add(v.replace("PEOPLE", "PERSON"))
        pdf_variants.add(v.replace("PERSON", "PEOPLE"))

    # exact match first
    for k in monsters:
        if norm(k) in pdf_variants:
            return k
    # prefix match (longest overlap wins)
    best = None
    best_len = 0
    for k in monsters:
        nk = norm(k)
        for v in pdf_variants:
            if len(nk) > 4 and len(v) > 4:
                if v.startswith(nk) or nk.startswith(v):
                    overlap = min(len(v), len(nk))
                    if overlap > best_len:
                        best, best_len = k, overlap
    return best


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--md",
        default="pdf/Call Of Cthulhu Keeper Rulebook 40th Anniversary (Sandy Petersen)_mineru/Call Of Cthulhu Keeper Rulebook 40th Anniversary (Sandy Petersen)/auto/Call Of Cthulhu Keeper Rulebook 40th Anniversary (Sandy Petersen).md",
    )
    ap.add_argument(
        "--monsters",
        default="plugins/coc-keeper/references/rules-json/monsters.json",
    )
    args = ap.parse_args()
    md = Path(args.md).read_text(encoding="utf-8")
    monsters = json.loads(Path(args.monsters).read_text())["monsters"]

    pdf_blocks = parse_stat_tables(md)
    print(f"MinerU OCR 解析到 {len(pdf_blocks)} 个 stat block")

    matched = 0
    correct = 0
    wrong = []
    unmatched_pdf = []
    unmatched_ours = list(monsters.keys())
    seen_ours = set()  # first-match-wins: don't let a variant overwrite

    for pdf_name, pdf_stats in pdf_blocks.items():
        our_name = match_name(pdf_name, monsters)
        if not our_name:
            unmatched_pdf.append(pdf_name)
            continue
        if our_name in seen_ours:
            continue  # already verified from an earlier (primary) stat block
        seen_ours.add(our_name)
        matched += 1
        if our_name in unmatched_ours:
            unmatched_ours.remove(our_name)
        ours = monsters[our_name]
        mismatch = False
        for attr in ATTRS:
            if attr in pdf_stats:
                o = ours.get(attr.lower())
                if o is not None and str(o) != "N/A":
                    try:
                        if int(o) != int(pdf_stats[attr]):
                            wrong.append(
                                f"{our_name}.{attr}: ours={o} OCR={pdf_stats[attr]}"
                            )
                            mismatch = True
                    except (ValueError, TypeError):
                        pass
        if not mismatch:
            correct += 1

    print(f"\n匹配: {matched}/{len(monsters)} 怪物")
    print(f"OCR 正确: {correct}")
    print(f"OCR 不一致: {len(wrong)}")
    for w in wrong:
        print(f"  ❌ {w}")
    if unmatched_pdf:
        print(f"\nOCR 有但我们没匹配的标题: {unmatched_pdf}")
    if unmatched_ours:
        print(f"我们有但 OCR 没找到 stat block 的: {unmatched_ours}")

    print(f"\n结论: {correct} 怪物 OCR 全参数一致")
    return 1 if wrong else 0


if __name__ == "__main__":
    sys.exit(main())
