#!/usr/bin/env python3
"""Merge missing tomes from MinerU OCR of the Mythos Tomes table into
tomes.json. Handles multi-version tomes by appending a version suffix.

Usage:
    python3 scripts/build_tomes_from_ocr.py --apply
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
        for r in re.findall(r"<tr>(.*?)</tr>", tbl.group(1), re.S):
            cells = [re.sub(r"\s+", " ", c).strip() for c in re.findall(r"<td>(.*?)</td>", r, re.S)]
            if len(cells) < 9 or cells[0].lower() == "title" or not cells[0]:
                continue
            title, lang, date, author = cells[0], cells[1], cells[2], cells[3]
            wks, san, cmi, cmf, mr = cells[4:9]
            # skip merged/dirty rows
            try:
                entry = {
                    "title": title, "language": lang, "date": date, "author": author,
                    "full_study_weeks": int(wks), "sanity_cost": san,
                    "cthulhu_mythos_initial": int(cmi.lstrip("+")),
                    "cthulhu_mythos_full": int(cmf.lstrip("+")),
                    "mythos_rating": int(mr),
                }
                rows.append(entry)
            except ValueError:
                continue
    return rows


def norm(s: str) -> str:
    return re.sub(r"[\s\-'\.,]", "", s.lower())


def to_key(title: str, language: str, date: str) -> str:
    """Build a snake_case key, suffixing with language for multi-version."""
    base = re.sub(r"[^a-z0-9 ]", "", title.lower()).strip()
    base = re.sub(r"\s+", "_", base)
    # short language hint for disambiguation
    lang_short = {
        "english": "en", "latin": "lat", "greek": "gr", "german": "de",
        "french": "fr", "italian": "it", "spanish": "es", "chinese": "zh",
        "arabic": "ar", "aklo": "aklo", "ancient tongue": "ancient",
        "muvian": "muv", "r'lyehian": "rlyeh",
    }.get(language.lower().strip(), "")
    return base if not lang_short else f"{base}_{lang_short}"


def main() -> int:
    apply = "--apply" in sys.argv
    md = MD_PATH.read_text(encoding="utf-8")
    ocr_rows = parse_ocr(md)
    existing = json.loads((BASE / "tomes.json").read_text())
    tomes = existing["tomes"]

    # index existing by normalized name
    existing_by_norm = {norm(k): k for k in tomes}

    added = 0
    skipped = 0
    for row in ocr_rows:
        target = norm(row["title"])
        # already present by name match?
        match_key = None
        for nk, ok in existing_by_norm.items():
            if target == nk or (len(target) > 4 and (target in nk or nk in target)):
                match_key = ok
                break
        if match_key:
            skipped += 1
            continue
        # new tome
        key = to_key(row["title"], row["language"], row["date"])
        base_key = key
        n = 2
        while key in tomes:
            key = f"{base_key}_{n}"
            n += 1
        tomes[key] = {
            "display_name": row["title"],
            "language": row["language"],
            "date": row["date"],
            "author": row["author"],
            "full_study_weeks": row["full_study_weeks"],
            "sanity_cost": row["sanity_cost"],
            "cthulhu_mythos_initial": row["cthulhu_mythos_initial"],
            "cthulhu_mythos_full": row["cthulhu_mythos_full"],
            "mythos_rating": row["mythos_rating"],
        }
        added += 1

    print(f"OCR tomes: {len(ocr_rows)}")
    print(f"Skipped (already present): {skipped}")
    print(f"Added new: {added}")
    print(f"Total now: {len(tomes)}")

    if apply:
        for plugin in ("plugins/coc-keeper", "plugins/coc-keeper-zcode"):
            path = Path(plugin) / "references" / "rules-json" / "tomes.json"
            data = json.loads(path.read_text())
            data["tomes"] = tomes
            path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
            print(f"Wrote {path} ({len(tomes)} tomes)")
    else:
        print("\n(dry-run; pass --apply)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
