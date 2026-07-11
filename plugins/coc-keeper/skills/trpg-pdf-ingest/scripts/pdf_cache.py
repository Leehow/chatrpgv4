#!/usr/bin/env python3
"""Unified markdown extraction entry point with content-aware page caching.

Callers use :func:`extract_markdown` and never invoke a backend directly.  Cache
metadata records source/text hashes and parser pipeline identity so an existing
real PDF cannot silently reuse stale extraction output.  Synthetic or remote
paths that do not exist locally retain the legacy cache-hit behavior used by
unit tests and external integrations.
"""
from __future__ import annotations

import datetime
import hashlib
import importlib.metadata
import json
import re
from pathlib import Path
from typing import Callable, Optional

_SCANNED_CHAR_THRESHOLD = 50
DEFAULT_CACHE_ROOT = Path(".coc/pdf-cache")
PIPELINE_VERSION = 2


def _slug(pdf_path: str | Path) -> str:
    name = Path(pdf_path).stem.lower()
    slug = re.sub(r"[^a-z0-9]+", "-", name).strip("-")
    return slug or "pdf"


def _pages_spec(pages: list[int]) -> str:
    ps = sorted(set(int(p) for p in pages))
    if len(ps) == 1:
        return f"pages-{ps[0]}"
    if all(ps[i] - ps[i - 1] == 1 for i in range(1, len(ps))):
        return f"pages-{ps[0]}-{ps[-1]}"
    return "pages-" + "_".join(str(p) for p in ps)


def _normalize(pages: list[int]) -> list[int]:
    return sorted(set(int(p) for p in pages))


def cache_key(pdf_path: str | Path, pages: list[int]) -> str:
    return f"{_slug(pdf_path)}/{_pages_spec(pages)}.md"


def cache_path(
    pdf_path: str | Path,
    pages: list[int],
    cache_root: Path | None = None,
) -> Path:
    root = Path(cache_root) if cache_root is not None else DEFAULT_CACHE_ROOT
    return root / cache_key(pdf_path, pages)


def is_cached(
    pdf_path: str | Path,
    pages: list[int],
    cache_root: Path | None = None,
) -> bool:
    return cache_path(pdf_path, pages, cache_root).is_file()


def sha256_file(path: str | Path) -> str | None:
    source = Path(path)
    if not source.is_file():
        return None
    digest = hashlib.sha256()
    with source.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _backend_version(backend: str, explicit: str | None = None) -> str | None:
    if explicit:
        return str(explicit)
    if backend == "external":
        return "external"
    try:
        return importlib.metadata.version(backend)
    except importlib.metadata.PackageNotFoundError:
        return None


def read_cache_meta(md_path: Path) -> dict:
    path = Path(md_path).with_suffix(".meta.json")
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def _write_meta(
    md_path: Path,
    pdf_path: str | Path,
    pages: list[int],
    backend: str,
    use_ocr: Optional[bool],
    char_count: int,
    *,
    markdown: str,
    pipeline_version: int,
    backend_version: str | None,
    external_src: str | Path | None = None,
) -> dict:
    meta = {
        "schema_version": 2,
        "pdf": str(pdf_path),
        "pages": _normalize(pages),
        "backend": backend,
        "backend_version": backend_version,
        "pipeline_version": int(pipeline_version),
        "use_ocr": use_ocr,
        "char_count": char_count,
        "file_sha256": sha256_file(pdf_path),
        "text_sha256": _sha256_text(markdown),
        "parsed_at": datetime.datetime.now().isoformat(timespec="seconds"),
    }
    if external_src is not None:
        meta["external_source_sha256"] = sha256_file(external_src)
    md_path.with_suffix(".meta.json").write_text(
        json.dumps(meta, indent=2), encoding="utf-8"
    )
    return meta


def _cache_valid(
    dest: Path,
    pdf_path: str | Path,
    *,
    backend: str,
    pipeline_version: int,
    backend_version: str | None,
    external_src: str | Path | None,
) -> bool:
    if not dest.is_file():
        return False
    meta = read_cache_meta(dest)
    source_hash = sha256_file(pdf_path)

    # Historical cache entries without metadata remain usable only when the
    # source is not locally available.  A real local file must be rehashed.
    if not meta:
        return source_hash is None
    if str(meta.get("backend") or backend) != backend:
        return False
    if meta.get("pipeline_version") != int(pipeline_version):
        return False
    if backend_version and meta.get("backend_version") not in (None, backend_version):
        return False
    if source_hash is not None and meta.get("file_sha256") != source_hash:
        return False
    try:
        markdown = dest.read_text(encoding="utf-8")
    except OSError:
        return False
    expected_text_hash = meta.get("text_sha256")
    if expected_text_hash and expected_text_hash != _sha256_text(markdown):
        return False
    if backend == "external" and external_src is not None:
        external_hash = sha256_file(external_src)
        if external_hash is not None and meta.get("external_source_sha256") != external_hash:
            return False
    return True


def ingest_external(
    pdf_path: str | Path,
    pages: list[int],
    md_path: str | Path,
    cache_root: Path | None = None,
    *,
    pipeline_version: int = PIPELINE_VERSION,
    backend_version: str | None = None,
) -> Path:
    dest = cache_path(pdf_path, pages, cache_root)
    dest.parent.mkdir(parents=True, exist_ok=True)
    md = Path(md_path).read_text(encoding="utf-8")
    dest.write_text(md, encoding="utf-8")
    _write_meta(
        dest,
        pdf_path,
        pages,
        backend="external",
        use_ocr=False,
        char_count=len(md),
        markdown=md,
        pipeline_version=pipeline_version,
        backend_version=_backend_version("external", backend_version),
        external_src=md_path,
    )
    return dest


def _parse_with_pymupdf4llm(
    pdf_path: str | Path,
    pages: list[int],
    use_ocr: bool,
) -> str:
    try:
        import pymupdf4llm
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError(
            "pymupdf4llm not installed: pip install pymupdf4llm"
        ) from exc
    return pymupdf4llm.to_markdown(str(pdf_path), pages=pages, use_ocr=use_ocr)


def _infer_ocr_need(
    pdf_path: str | Path,
    pages: list[int],
    _open_doc: Callable[[str, "object"], object] | None = None,
) -> bool:
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


def extract_markdown(
    pdf_path: str | Path,
    pages: list[int],
    use_ocr: bool | None = None,
    backend: str = "pymupdf4llm",
    external_src: str | Path | None = None,
    cache_root: Path | None = None,
    *,
    pipeline_version: int = PIPELINE_VERSION,
    backend_version: str | None = None,
) -> dict:
    """Extract pages and return markdown, cache state, path, and metadata."""
    norm_pages = _normalize(pages)
    dest = cache_path(pdf_path, norm_pages, cache_root)
    resolved_backend_version = _backend_version(backend, backend_version)

    if _cache_valid(
        dest,
        pdf_path,
        backend=backend,
        pipeline_version=pipeline_version,
        backend_version=resolved_backend_version,
        external_src=external_src,
    ):
        return {
            "markdown": dest.read_text(encoding="utf-8"),
            "cached": True,
            "pages": norm_pages,
            "cache_path": str(dest),
            "meta": read_cache_meta(dest),
        }

    if backend == "external":
        if external_src is None:
            raise ValueError("backend='external' requires external_src")
        dest = ingest_external(
            pdf_path,
            norm_pages,
            external_src,
            cache_root=cache_root,
            pipeline_version=pipeline_version,
            backend_version=resolved_backend_version,
        )
        md = dest.read_text(encoding="utf-8")
        meta = read_cache_meta(dest)
    elif backend == "pymupdf4llm":
        if use_ocr is None:
            use_ocr = _infer_ocr_need(pdf_path, norm_pages)
        md = _parse_with_pymupdf4llm(pdf_path, norm_pages, use_ocr)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(md, encoding="utf-8")
        meta = _write_meta(
            dest,
            pdf_path,
            norm_pages,
            backend="pymupdf4llm",
            use_ocr=use_ocr,
            char_count=len(md),
            markdown=md,
            pipeline_version=pipeline_version,
            backend_version=resolved_backend_version,
        )
    else:
        raise ValueError(
            f"unknown backend: {backend!r} (expected 'pymupdf4llm' or 'external')"
        )

    return {
        "markdown": md,
        "cached": False,
        "pages": norm_pages,
        "cache_path": str(dest),
        "meta": meta,
    }
