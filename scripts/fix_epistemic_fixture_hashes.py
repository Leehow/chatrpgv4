#!/usr/bin/env python3
"""Refresh synthetic evidence-segment hashes from their local fixture text."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path


PATH = Path("tests/fixtures/epistemic/large-chapter-page-offset.json")


def main() -> None:
    payload = json.loads(PATH.read_text(encoding="utf-8"))
    changed = False
    for segment in payload["source_bundle"]["evidence_segments"]:
        text = segment.get("text")
        if not isinstance(text, str):
            continue
        digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
        if segment.get("text_sha256") != digest:
            segment["text_sha256"] = digest
            changed = True
    if changed:
        PATH.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )


if __name__ == "__main__":
    main()
