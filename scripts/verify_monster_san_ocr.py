#!/usr/bin/env python3
"""Verify monster SAN loss against MinerU OCR of monster chapter.

Extracts "Sanity Loss: X/Y" from OCR markdown (which preserves 2-column
reading order) and compares to monsters.json san_loss field.

Usage: python3 scripts/verify_monster_san_ocr.py
"""
from __future__ import annotations
import json, re, sys
from pathlib import Path

BASE = Path("plugins/coc-keeper/references/rules-json")
MD = Path("pdf/Call Of Cthulhu Keeper Rulebook 40th Anniversary (Sandy Petersen)_mineru/Call Of Cthulhu Keeper Rulebook 40th Anniversary (Sandy Petersen)/auto/Call Of Cthulhu Keeper Rulebook 40th Anniversary (Sandy Petersen).md")


def extract_san(md: str) -> dict[str, str]:
    """Extract {monster_name: 'san_loss_text'} from OCR.

    Pattern: heading '## NAME, epithet' ... 'Sanity Loss: X/Y ...'
    """
    results = {}
    chunks = re.split(r'(?=^#{1,3}\s+[A-Z][A-Z\-\'\. ]+,)', md, flags=re.M)
    for chunk in chunks:
        m = re.match(r'^#{1,3}\s+([A-Z][A-Z\-\'\. ]+),', chunk)
        if not m:
            continue
        name = m.group(1).strip()
        san = re.search(r'[Ss]anity\s+[Ll]oss:?\s*([0-9D/d ]+?)\s*(?:Sanity points|to see|$)', chunk[:1500])
        if san:
            results[name.upper()] = san.group(1).strip().rstrip(".")
        else:
            # 也试 deity 格式 "Sanity Loss: X/Y Sanity points"
            san2 = re.search(r'[Ss]anity\s+[Ll]oss:?\s*(\d+/\d+D\d+|\d+D\d+/\d+D\d+|\d+/\d+)', chunk[:1500])
            if san2:
                results[name.upper()] = san2.group(1)
    return results


def norm(s: str) -> str:
    return re.sub(r"[\s\-'\.,]", "", s.lower())


def main() -> int:
    if not MD.exists():
        print("OCR markdown not found. Run mineru on monster chapter first.")
        return 2
    md = MD.read_text(encoding="utf-8")
    monsters = json.loads((BASE / "monsters.json").read_text())["monsters"]
    ocr_san = extract_san(md)
    print(f"OCR 提取到 {len(ocr_san)} 个怪物的 Sanity Loss")

    matched = 0; correct = 0; wrong = []
    for name in monsters:
        target = norm(name)
        ocr_key = None
        for ok in ocr_san:
            if target == norm(ok) or target in norm(ok) or norm(ok) in target:
                ocr_key = ok; break
        if not ocr_key:
            continue
        matched += 1
        our_san = monsters[name].get("san_loss")
        if isinstance(our_san, dict):
            our_str = "%s/%s" % (our_san.get("success",""), our_san.get("failure",""))
        else:
            our_str = str(our_san or "")
        pdf_str = ocr_san[ocr_key]
        # 规范化比较
        on = our_str.replace(" ","").lower()
        pn = pdf_str.replace(" ","").lower()
        if on == pn or on.rstrip("/") == pn.rstrip("/"):
            correct += 1
        else:
            wrong.append(f"{name}: ours='{our_str}' OCR='{pdf_str}'")

    print(f"匹配: {matched} | 正确: {correct} | 不一致: {len(wrong)}")
    for w in wrong:
        print(f"  ❌ {w}")
    if not wrong:
        print("  全部 SAN 损失一致 ✅")
    return 1 if wrong else 0


if __name__ == "__main__":
    sys.exit(main())
