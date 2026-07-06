#!/usr/bin/env python3
"""Unified markdown extraction entry point with page-level caching.

This is the single entry point for turning PDF pages into markdown in the
trpg-pdf-ingest skill. Callers use :func:`extract_markdown` and never invoke
pymupdf4llm (or any backend) directly.

Design goals
------------
* **Cache reuse** -- extraction results are keyed by ``<pdf-slug>/pages-<spec>``
  so repeated requests for the same page range skip re-parsing (pymupdf4llm is
  ~0.4s/page). Cache lives under ``.coc/pdf-cache`` by default.
* **Decoupled backend** -- pymupdf4llm is the default backend, but externally
  pre-parsed markdown (MinerU / cloud / manual) can be ingested via
  :func:`ingest_external` or ``backend="external"``.
* **Smart OCR** -- ``use_ocr`` defaults to ``None`` meaning "infer": a page is
  treated as scanned only when the probe finds very little extractable text
  (char_count < 50). This replaces the old ``use_ocr=True`` default that ran
  Tesseract on every page and polluted prose with OCR noise from decorative
  images.

Cache layout::

    <cache_root>/<pdf-slug>/pages-<spec>.md          # the markdown
    <cache_root>/<pdf-slug>/pages-<spec>.meta.json   # provenance metadata

``<spec>`` is ``294`` for a single page, ``294-296`` for a contiguous range
(start-end inclusive), or ``294_296_301`` (underscore-joined) for a
non-contiguous set. Contiguous ranges are by far the common case.
"""
from __future__ import annotations

import datetime
import json
import re
from pathlib import Path
from typing import Callable, Optional

# Scanned-page heuristic: a page with fewer than this many extractable text
# characters is treated as a scanned image requiring OCR. Mirrors the threshold
# used in probe_pdf.py::probe_page (kept inline to avoid coupling).
_SCANNED_CHAR_THRESHOLD = 50

DEFAULT_CACHE_ROOT = Path(".coc/pdf-cache")


# ---------------------------------------------------------------------------
# Key / path construction
# ---------------------------------------------------------------------------

def _slug(pdf_path: str | Path) -> str:
    """Filesystem-safe slug derived from the PDF basename.

    Lowercase the stem (filename without extension), replace every run of
    non-``[a-z0-9]`` characters with a single ``-``, and strip leading/trailing
    dashes. Falls back to ``"pdf"`` for an empty result so the resulting cache
    key is always a *relative* path (avoids ``root / "/pages-..."`` discarding
    the cache root).
    """
    name = Path(pdf_path).stem.lower()
    slug = re.sub(r"[^a-z0-9]+", "-", name).strip("-")
    return slug or "pdf"


def _pages_spec(pages: list[int]) -> str:
    """Build the page-range spec for a cache key.

    Sorts + dedupes first. Single page -> ``294``; contiguous range (each
    consecutive page differs by exactly 1) -> ``294-296`` (start-end
    inclusive); otherwise the pages are underscore-joined -> ``294_296_301``.
    """
    ps = sorted(set(int(p) for p in pages))
    if len(ps) == 1:
        return f"pages-{ps[0]}"
    if all(ps[i] - ps[i - 1] == 1 for i in range(1, len(ps))):
        return f"pages-{ps[0]}-{ps[-1]}"
    return "pages-" + "_".join(str(p) for p in ps)


def _normalize(pages: list[int]) -> list[int]:
    """Sort + dedupe page indices into the canonical form used by the cache."""
    return sorted(set(int(p) for p in pages))


def cache_key(pdf_path: str | Path, pages: list[int]) -> str:
    """Return ``'<pdf-slug>/pages-<spec>.md'`` (relative cache key)."""
    return f"{_slug(pdf_path)}/{_pages_spec(pages)}.md"


def cache_path(pdf_path: str | Path, pages: list[int],
               cache_root: Path | None = None) -> Path:
    """Full filesystem path of the cached markdown under ``cache_root``.

    ``cache_root`` defaults to :data:`DEFAULT_CACHE_ROOT` (``.coc/pdf-cache``).
    """
    root = Path(cache_root) if cache_root is not None else DEFAULT_CACHE_ROOT
    return root / cache_key(pdf_path, pages)


def is_cached(pdf_path: str | Path, pages: list[int],
              cache_root: Path | None = None) -> bool:
    """True if a cached ``.md`` exists for this pdf + pages. Does NOT parse."""
    return cache_path(pdf_path, pages, cache_root).is_file()


# ---------------------------------------------------------------------------
# Metadata sidecar
# ---------------------------------------------------------------------------

def _write_meta(md_path: Path, pdf_path: str | Path, pages: list[int],
                backend: str, use_ocr: Optional[bool],
                char_count: int) -> None:
    """Write the ``.meta.json`` provenance sidecar next to a cached ``.md``."""
    meta = {
        "schema_version": 1,
        "pdf": str(pdf_path),
        "pages": _normalize(pages),
        "backend": backend,
        "use_ocr": use_ocr,
        "char_count": char_count,
        "parsed_at": datetime.datetime.now().isoformat(timespec="seconds"),
    }
    md_path.with_suffix(".meta.json").write_text(
        json.dumps(meta, indent=2), encoding="utf-8")


# ---------------------------------------------------------------------------
# External markdown ingestion
# ---------------------------------------------------------------------------

def ingest_external(pdf_path: str | Path, pages: list[int],
                    md_path: str | Path,
                    cache_root: Path | None = None) -> Path:
    """Copy an externally-parsed markdown file into the cache.

    For markdown produced outside this module (MinerU / cloud OCR / manual
    cleanup). Writes the ``.md`` plus a ``.meta.json`` recording
    ``backend='external'`` and returns the cache path.
    """
    dest = cache_path(pdf_path, pages, cache_root)
    dest.parent.mkdir(parents=True, exist_ok=True)
    md = Path(md_path).read_text(encoding="utf-8")
    dest.write_text(md, encoding="utf-8")
    # use_ocr is not meaningful for externally-sourced markdown; record False.
    _write_meta(dest, pdf_path, pages, backend="external",
                use_ocr=False, char_count=len(md))
    return dest


# ---------------------------------------------------------------------------
# Backends
# ---------------------------------------------------------------------------

def _parse_with_pymupdf4llm(pdf_path: str | Path, pages: list[int],
                            use_ocr: bool) -> str:
    """Parse ``pages`` of ``pdf_path`` with pymupdf4llm -> markdown string.

    pymupdf4llm's ``pages`` param accepts a list of 0-based page indices, which
    we pass through directly.
    """
    try:
        import pymupdf4llm
    except ImportError as exc:  # pragma: no cover - exercised only without dep
        raise RuntimeError(
            "pymupdf4llm not installed: pip install pymupdf4llm") from exc
    return pymupdf4llm.to_markdown(str(pdf_path), pages=pages, use_ocr=use_ocr)


def _infer_ocr_need(pdf_path: str | Path, pages: list[int],
                    _open_doc: Callable[[str, "object"], object] | None = None
                    ) -> bool:
    """Return True if ANY page in ``pages`` looks scanned (char_count < 50).

    Reuses the scan-detection heuristic from ``probe_pdf.py`` (very little
    extractable text => scanned image) without importing it, to avoid coupling.

    ``_open_doc`` is an injection seam: it defaults to ``fitz.open`` in
    production but tests may pass a fake callable returning a fake document
    (supporting ``__len__``, ``__getitem__`` -> page with ``get_text``, and
    ``close``). This keeps the module free of a top-level ``import fitz`` and
    lets unit tests run without a real PDF or the PyMuPDF dependency.
    """
    if _open_doc is None:
        import fitz
        _open_doc = fitz.open
    doc = _open_doc(str(pdf_path))
    try:
        for idx in pages:
            if idx >= len(doc):
                continue
            text = doc[idx].get_text("text").strip()
            if len(text) < _SCANNED_CHAR_THRESHOLD:
                return True
        return False
    finally:
        doc.close()


# ---------------------------------------------------------------------------
# Unified entry point
# ---------------------------------------------------------------------------

def extract_markdown(pdf_path: str | Path, pages: list[int],
                     use_ocr: bool | None = None,
                     backend: str = "pymupdf4llm",
                     external_src: str | Path | None = None,
                     cache_root: Path | None = None) -> dict:
    """Unified markdown extraction with caching.

    Returns a dict::

        {
            "markdown":   str,   # extracted markdown
            "cached":     bool,  # True if served from cache, False if parsed
            "pages":      list,  # pages actually parsed (sorted, deduped)
            "cache_path": str,   # filesystem path of the cache entry
        }

    Flow
    ----
    1. **Cache hit** -> return cached markdown, ``cached=True``.
    2. **Miss** -> dispatch to ``backend``:
       * ``backend="external"``: ``external_src`` is required; the file is
         ingested via :func:`ingest_external`.
       * ``backend="pymupdf4llm"``: infer ``use_ocr`` when ``None`` (probe =>
         scanned pages only), call :func:`_parse_with_pymupdf4llm`, then write
         the ``.md`` + ``.meta.json``.
    3. Return the markdown, ``cached=False`` and the normalized pages list.
    """
    norm_pages = _normalize(pages)

    # 1. Cache hit
    dest = cache_path(pdf_path, norm_pages, cache_root)
    if dest.is_file():
        return {
            "markdown": dest.read_text(encoding="utf-8"),
            "cached": True,
            "pages": norm_pages,
            "cache_path": str(dest),
        }

    # 2. Miss -> dispatch to backend
    if backend == "external":
        if external_src is None:
            raise ValueError("backend='external' requires external_src")
        dest = ingest_external(pdf_path, norm_pages, external_src,
                               cache_root=cache_root)
        md = dest.read_text(encoding="utf-8")
    elif backend == "pymupdf4llm":
        if use_ocr is None:
            use_ocr = _infer_ocr_need(pdf_path, norm_pages)
        md = _parse_with_pymupdf4llm(pdf_path, norm_pages, use_ocr)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(md, encoding="utf-8")
        _write_meta(dest, pdf_path, norm_pages, backend="pymupdf4llm",
                    use_ocr=use_ocr, char_count=len(md))
    else:
        raise ValueError(f"unknown backend: {backend!r} "
                         f"(expected 'pymupdf4llm' or 'external')")

    return {
        "markdown": md,
        "cached": False,
        "pages": norm_pages,
        "cache_path": str(dest),
    }
