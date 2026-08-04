#!/usr/bin/env python3
"""Bind deterministic outline production to one module asset root.

The repository opens no PDF, here or anywhere: that boundary is enforced by
contract, so an outline is built from artifacts a host or worker already
produced.  Producer choice is by availability: a host-measured line list when
one has been supplied for these exact bytes, otherwise the recognized-geometry
corpus that whole-book OCR leaves behind.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import coc_fileio  # noqa: E402
import coc_module_assets  # noqa: E402
import coc_source_outline  # noqa: E402
from coc_source_outline_producers import SourceOutlineError  # noqa: E402

OUTLINE_NAME = "outline.json"
# A host PDF skill may drop an exact line list here; it is preferred over
# recognized geometry because declared font sizes do not jitter.
HOST_OUTLINE_NAME = "host-outline.json"


def outline_path(workspace: Path, asset_root_id: str) -> Path:
    return coc_module_assets._module_dir(workspace, asset_root_id) / OUTLINE_NAME


def read_outline(workspace: Path, asset_root_id: str) -> dict[str, Any] | None:
    path = outline_path(workspace, asset_root_id)
    if not path.is_file():
        return None
    try:
        loaded = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return loaded if isinstance(loaded, dict) else None


def resolve_producer(
    workspace: Path, asset_root_id: str,
) -> tuple[str, Path]:
    """Return the producer and source location for this asset root.

    Fails closed: an outline built from the wrong bytes would hand every later
    request page numbers that point at different content, which is worse than
    having no outline at all.
    """
    module_dir = coc_module_assets._module_dir(workspace, asset_root_id)
    identity_path = module_dir / "identity.json"
    if not identity_path.is_file():
        raise SourceOutlineError("unknown module assets root")
    try:
        identity = json.loads(identity_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SourceOutlineError("module asset identity is unreadable") from exc
    file_sha256 = str(identity.get("file_sha256") or "")
    host_lines = module_dir / HOST_OUTLINE_NAME
    if host_lines.is_file():
        return "host_outline", host_lines
    # The registered page cache is what a normal ingest actually leaves behind:
    # the host PDF skill writes Markdown, the repository stores it verbatim, so
    # the heading levels it already recovered are available with no extra pass.
    pages = module_dir / "pages"
    if pages.is_dir() and any(
        path.stem.isdigit() for path in pages.glob("*.md")
    ):
        return "cached_pages", pages
    corpus = coc_module_assets.ocr_corpus_dir(workspace, file_sha256)
    if (corpus / "pages").is_dir():
        return "ocr_boxes", corpus
    raise SourceOutlineError(
        "no outline source: this module has no host-produced line list, no "
        "cached pages, and no OCR corpus for its digest"
    )


def ensure_outline(
    workspace: Path,
    asset_root_id: str,
    *,
    refresh: bool = False,
) -> dict[str, Any]:
    """Build the outline once per source and reuse it thereafter."""
    module_dir = coc_module_assets._module_dir(workspace, asset_root_id)
    identity_path = module_dir / "identity.json"
    if not identity_path.is_file():
        raise SourceOutlineError("unknown module assets root")
    identity = json.loads(identity_path.read_text(encoding="utf-8"))
    file_sha256 = str(identity.get("file_sha256") or "")
    existing = read_outline(workspace, asset_root_id)
    if (
        not refresh
        and isinstance(existing, dict)
        and existing.get("file_sha256") == file_sha256
        and existing.get("rows")
    ):
        return existing
    producer, source = resolve_producer(workspace, asset_root_id)
    identity_source = (
        identity.get("source") if isinstance(identity.get("source"), dict) else {}
    )
    payload = coc_source_outline.build_outline(
        producer=producer,
        source=source,
        file_sha256=file_sha256,
        source_id=str(identity_source.get("source_id") or f"pdf:{file_sha256[:24]}"),
    )
    coc_fileio.write_json_atomic(
        outline_path(workspace, asset_root_id), payload,
        indent=2, ensure_ascii=False, trailing_newline=True,
    )
    return payload


def cached_page_previews(
    workspace: Path,
    asset_root_id: str,
    *,
    pdf_indices: list[int],
) -> dict[int, str]:
    """Accepted cached page bodies, for classification previews only.

    Only accepted pages contribute: an unreviewed or drifted page must not
    influence how the book is indexed.
    """
    previews: dict[int, str] = {}
    for pdf_index in pdf_indices:
        page = coc_module_assets.get_page(workspace, asset_root_id, int(pdf_index))
        if not isinstance(page, dict):
            continue
        text = page.get("text")
        if not isinstance(text, str) or not text.strip():
            continue
        # Cached pages are Markdown and real ingests carry layout HTML in them.
        # A preview budgeted in bytes must spend those bytes on words: an
        # unstripped `<div style="text-align: center">` can consume a short
        # preview entirely and tell the classifier nothing.
        collapsed = " ".join(
            coc_module_assets._HTML_TAG_RE.sub(" ", text).split()
        )
        if collapsed:
            previews[int(pdf_index)] = collapsed
    return previews
