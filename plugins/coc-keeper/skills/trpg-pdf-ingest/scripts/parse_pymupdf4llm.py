#!/usr/bin/env python3
"""Parse PDF pages into markdown via the unified pdf_cache entry point.

This CLI is a thin wrapper around :func:`pdf_cache.extract_markdown`. All
parsing now goes through the cache (keyed by ``<pdf-slug>/pages-<spec>``)
so repeated requests for the same page range are free, and OCR is enabled
only on scanned pages (smart inference) unless forced with ``--ocr``.

Backends
--------
* ``pymupdf4llm`` (default) -- fast, reading-order-aware markdown.
* ``external`` -- ingest a pre-parsed markdown file (MinerU / cloud /
  manual) into the cache via ``--src``.

Usage
-----
    # default (pymupdf4llm, cached, smart OCR)
    python3 parse_pymupdf4llm.py pdf/<book>.pdf --pages 294-296 [-o out.md]
    # force OCR on / off
    python3 parse_pymupdf4llm.py pdf/<book>.pdf --pages 294 --ocr
    python3 parse_pymupdf4llm.py pdf/<book>.pdf --pages 294 --no-ocr
    # ingest externally-parsed markdown into the cache
    python3 parse_pymupdf4llm.py pdf/<book>.pdf --pages 294 \
        --backend external --src path/to/parsed.md
    # ignore cache, re-parse and overwrite
    python3 parse_pymupdf4llm.py pdf/<book>.pdf --pages 294 --no-cache
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent


def _load_sibling(name, filename):
    """Import a sibling module by absolute path (no package required)."""
    spec = importlib.util.spec_from_file_location(name, SCRIPT_DIR / filename)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


pdf_cache = _load_sibling("pdf_cache", "pdf_cache.py")


def _parse_pages(pages_arg: str) -> list[int]:
    """Parse the ``--pages`` arg into a list of ints.

    Accepts ``'294'`` or ``'294-296'`` (inclusive range). Mirrors the
    original CLI range logic for backward compatibility.
    """
    if "-" in pages_arg:
        start, end = pages_arg.split("-", 1)
        return list(range(int(start), int(end) + 1))
    return [int(pages_arg)]


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Parse PDF to markdown via pdf_cache (cached, OCR-aware)")
    ap.add_argument("pdf", help="PDF file path")
    ap.add_argument("--pages", required=True,
                    help="Page range: '294' or '294-296' (0-based)")
    ap.add_argument("-o", "--output", help="Output file (default: stdout)")
    ap.add_argument("--json", action="store_true",
                    help="Also output JSON sidecar with page-level data")
    ap.add_argument("--ocr", dest="ocr", action="store_true", default=None,
                    help="Force OCR on (Tesseract)")
    ap.add_argument("--no-ocr", dest="ocr", action="store_false",
                    help="Force OCR off (text extraction only)")
    ap.add_argument("--backend", default="pymupdf4llm",
                    choices=("pymupdf4llm", "external"),
                    help="Backend (default: pymupdf4llm)")
    ap.add_argument("--src",
                    help="Source markdown for --backend external "
                         "(path to pre-parsed .md)")
    ap.add_argument("--no-cache", action="store_true",
                    help="Bypass cache (force re-parse and overwrite)")
    ap.add_argument("--cache-root", default=str(pdf_cache.DEFAULT_CACHE_ROOT),
                    help=f"Cache root (default: {pdf_cache.DEFAULT_CACHE_ROOT})")
    args = ap.parse_args()

    pages = _parse_pages(args.pages)
    cache_root = Path(args.cache_root)
    ocr_flag = args.ocr  # None = smart inference, True/False = forced

    # --no-cache: remove any existing cache entry so the backend re-parses.
    if args.no_cache:
        dest = pdf_cache.cache_path(args.pdf, pages, cache_root)
        if dest.is_file():
            dest.unlink()
        # also drop the meta sidecar so provenance is refreshed
        meta = dest.with_suffix(".meta.json")
        if meta.is_file():
            meta.unlink()

    result = pdf_cache.extract_markdown(
        args.pdf, pages,
        use_ocr=ocr_flag,
        backend=args.backend,
        external_src=args.src,
        cache_root=cache_root,
    )
    md_text = result["markdown"]
    cached = result["cached"]
    cache_path = result["cache_path"]

    # One-line status to stderr. Use the cache key (relative form) when the
    # cache root is the default relative dir, otherwise the absolute path.
    try:
        rel = str(Path(cache_path).relative_to(Path.cwd()))
    except ValueError:
        rel = cache_path
    if cached:
        print(f"[cache HIT] {rel}", file=sys.stderr)
    else:
        if args.backend == "external":
            print(f"[cache MISS, ingested external -> {rel}]", file=sys.stderr)
        else:
            ocr_used = ocr_flag if ocr_flag is not None else "(inferred)"
            print(f"[cache MISS, parsed with {args.backend} ocr={ocr_used}]",
                  file=sys.stderr)

    # Write output.
    if args.output:
        Path(args.output).write_text(md_text, encoding="utf-8")
        print(f"Wrote {len(md_text)} chars to {args.output}", file=sys.stderr)
    else:
        print(md_text)

    # Optional JSON sidecar (now includes cache provenance).
    if args.json:
        json_path = str(args.output or "stdout") + ".json"
        data = {
            "pdf": args.pdf,
            "pages": result["pages"],
            "char_count": len(md_text),
            "parser": args.backend,
            "backend": args.backend,
            "cached": cached,
            "cache_path": cache_path,
            "use_ocr": ocr_flag,
        }
        if args.output:
            Path(json_path).write_text(
                json.dumps(data, indent=2), encoding="utf-8")
            print(f"Wrote JSON to {json_path}", file=sys.stderr)
        else:
            # echo JSON to stdout after the markdown (backward-compat shape)
            print(json.dumps(data, indent=2))

    return 0


if __name__ == "__main__":
    sys.exit(main())
