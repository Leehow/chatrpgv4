#!/usr/bin/env python3
"""Fake OCR backend, for tests/play/test_ocr_tool.py only.

Stands in for `PI_COC_OCR_BACKEND`'s real command (the baiduocr skill script), whose
CLI shape it copies exactly: `<source> -o <outdir>`, writing `doc_<k>.md` for
`k in range(0, FAKE_OCR_PAGE_COUNT)` (a page in `FAKE_OCR_MISSING_ORDINALS` is skipped,
to simulate a job that came back with fewer pages than asked for) into `<outdir>`.
This never looks at `source`'s bytes -- how many pages a real backend would return
depends on what document it was actually handed, which is exactly what
`bin/coc-ocr`'s own tests are checking (a subset PDF vs. the whole file); this stub's
tests set the page count directly rather than parsing a PDF to get it, since it is a
harness, not a second OCR implementation.

Records the exact argv it was called with (json, one line) at `FAKE_OCR_ARGV_LOG`, so
a test can assert `BAIDUOCR_TOKEN`'s value never appeared on the command line, only in
the environment. Exits with `FAKE_OCR_EXIT_CODE` (default 0).
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path


def main() -> int:
    argv = sys.argv[1:]
    log_path = os.environ.get("FAKE_OCR_ARGV_LOG")
    if log_path:
        Path(log_path).write_text(json.dumps(argv), encoding="utf-8")

    if "-o" not in argv:
        print("fake_ocr_backend: no -o <outdir> given", file=sys.stderr)
        return 2
    out_dir = Path(argv[argv.index("-o") + 1])
    out_dir.mkdir(parents=True, exist_ok=True)

    count = int(os.environ.get("FAKE_OCR_PAGE_COUNT", "0"))
    missing = {
        int(part) for part in os.environ.get("FAKE_OCR_MISSING_ORDINALS", "").split(",") if part.strip()
    }
    for ordinal in range(count):
        if ordinal in missing:
            continue
        (out_dir / f"doc_{ordinal}.md").write_text(f"stub OCR text for ordinal {ordinal}\n", encoding="utf-8")

    return int(os.environ.get("FAKE_OCR_EXIT_CODE", "0"))


if __name__ == "__main__":
    raise SystemExit(main())
