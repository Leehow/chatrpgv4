#!/usr/bin/env python3
"""Validate and normalize host-produced PDF source bundles.

The repository never opens a PDF for extraction.  A host (normally Codex's
``pdf`` skill) produces UTF-8 Markdown plus a manifest.  This module verifies
the declared source/file hashes and performs only deterministic formatting.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any


SCHEMA_VERSION = 1
PRODUCER = "codex-pdf-skill"
MANIFEST_NAME = "manifest.json"
MAX_PAGES = 32
MAX_CHARACTERS = 300_000
ACCEPTED_REVIEW_STATES = frozenset({"auto_accepted", "manual_accepted"})
_HEX = frozenset("0123456789abcdef")
_SOURCE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")


class PdfSourceBundleError(ValueError):
    """The host-produced source bundle does not satisfy the contract."""


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _require_sha256(value: Any, field: str) -> str:
    if not isinstance(value, str) or len(value) != 64 or any(c not in _HEX for c in value):
        raise PdfSourceBundleError(f"{field} must be a lowercase SHA-256 digest")
    return value


def _manifest_path(bundle: Path | str) -> tuple[Path, Path]:
    candidate = Path(bundle).expanduser().resolve()
    manifest = candidate / MANIFEST_NAME
    if not candidate.is_dir() or not manifest.is_file():
        raise PdfSourceBundleError(
            "host source bundle must be a directory containing manifest.json"
        )
    return manifest.parent.resolve(), manifest


def _bundle_file(root: Path, relative: Any, field: str) -> Path:
    if not isinstance(relative, str) or not relative or Path(relative).is_absolute():
        raise PdfSourceBundleError(f"{field} must be a non-empty relative path")
    path = (root / relative).resolve()
    try:
        path.relative_to(root)
    except ValueError as exc:
        raise PdfSourceBundleError(f"{field} escapes the source bundle") from exc
    if not path.is_file():
        raise PdfSourceBundleError(f"{field} is not a readable file: {relative}")
    return path


def _normalize_markdown(text: str) -> str:
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    normalized = "\n".join(line.rstrip() for line in lines).strip()
    return normalized + "\n" if normalized else ""


def _canonical_digest(
    source: dict[str, Any],
    pages: list[dict[str, Any]],
    assets: list[dict[str, Any]],
) -> str:
    """Hash semantic bundle identity independently of manifest formatting."""
    digest_pages = []
    for page in sorted(pages, key=lambda item: item["pdf_index"]):
        item = {
            "pdf_index": page["pdf_index"],
            "producer_text_sha256": page["producer_text_sha256"],
            "review_state": page["review_state"],
            "parse_confidence": page["parse_confidence"],
            "grep_anchors": sorted(page["grep_anchors"]),
        }
        for key in ("printed_page", "printed_label"):
            if key in page:
                item[key] = page[key]
        digest_pages.append(item)
    payload = {
        "schema_version": SCHEMA_VERSION,
        "producer": PRODUCER,
        "source": {
            key: source[key]
            for key in ("source_id", "title", "file_sha256", "page_count")
        },
        "pages": digest_pages,
        "assets": sorted(
            ({"path": item["path"], "sha256": item["sha256"]} for item in assets),
            key=lambda item: item["path"],
        ),
    }
    encoded = json.dumps(
        payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def load_host_bundle(bundle: Path | str) -> dict[str, Any]:
    """Validate a host bundle and return normalized source/pages/assets."""
    root, manifest_path = _manifest_path(bundle)
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise PdfSourceBundleError(f"invalid UTF-8 JSON manifest: {exc}") from exc
    if not isinstance(manifest, dict):
        raise PdfSourceBundleError("manifest must be a JSON object")
    if manifest.get("schema_version") != SCHEMA_VERSION:
        raise PdfSourceBundleError(f"manifest.schema_version must equal {SCHEMA_VERSION}")
    if manifest.get("producer") != PRODUCER:
        raise PdfSourceBundleError(f"manifest.producer must equal {PRODUCER!r}")

    raw_source = manifest.get("source")
    if not isinstance(raw_source, dict):
        raise PdfSourceBundleError("manifest.source must be an object")
    source_path_text = raw_source.get("path")
    if not isinstance(source_path_text, str) or not source_path_text.strip():
        raise PdfSourceBundleError("manifest.source.path must name the original PDF")
    source_path = Path(source_path_text).expanduser()
    if not source_path.is_absolute():
        source_path = root / source_path
    source_path = source_path.resolve()
    if not source_path.is_file() or source_path.suffix.lower() != ".pdf":
        raise PdfSourceBundleError("manifest.source.path must be an existing PDF")
    declared_source_hash = _require_sha256(
        raw_source.get("file_sha256"), "manifest.source.file_sha256"
    )
    if sha256_file(source_path) != declared_source_hash:
        raise PdfSourceBundleError("original PDF SHA-256 does not match manifest")
    page_count = raw_source.get("page_count")
    if isinstance(page_count, bool) or not isinstance(page_count, int) or page_count <= 0:
        raise PdfSourceBundleError("manifest.source.page_count must be a positive integer")

    raw_pages = manifest.get("pages")
    if not isinstance(raw_pages, list) or not raw_pages:
        raise PdfSourceBundleError("manifest.pages must be a non-empty list")
    if len(raw_pages) > MAX_PAGES:
        raise PdfSourceBundleError(f"manifest.pages exceeds the {MAX_PAGES}-page boundary")
    pages: list[dict[str, Any]] = []
    seen_indices: set[int] = set()
    seen_markdown_paths: set[str] = set()
    total = 0
    for position, raw_page in enumerate(raw_pages):
        field = f"manifest.pages[{position}]"
        if not isinstance(raw_page, dict):
            raise PdfSourceBundleError(f"{field} must be an object")
        pdf_index = raw_page.get("pdf_index")
        if isinstance(pdf_index, bool) or not isinstance(pdf_index, int) or not 0 <= pdf_index < page_count:
            raise PdfSourceBundleError(f"{field}.pdf_index is outside source.page_count")
        if pdf_index in seen_indices:
            raise PdfSourceBundleError(f"duplicate pdf_index: {pdf_index}")
        seen_indices.add(pdf_index)
        markdown_path = _bundle_file(root, raw_page.get("markdown_path"), f"{field}.markdown_path")
        relative_markdown_path = str(markdown_path.relative_to(root))
        if relative_markdown_path in seen_markdown_paths:
            raise PdfSourceBundleError(f"duplicate Markdown path: {relative_markdown_path}")
        seen_markdown_paths.add(relative_markdown_path)
        raw_bytes = markdown_path.read_bytes()
        declared_text_hash = _require_sha256(raw_page.get("text_sha256"), f"{field}.text_sha256")
        if hashlib.sha256(raw_bytes).hexdigest() != declared_text_hash:
            raise PdfSourceBundleError(f"{field} Markdown SHA-256 does not match manifest")
        try:
            text = _normalize_markdown(raw_bytes.decode("utf-8"))
        except UnicodeDecodeError as exc:
            raise PdfSourceBundleError(f"{field} Markdown must be UTF-8") from exc
        if not text:
            raise PdfSourceBundleError(f"{field} Markdown is empty")
        total += len(text)
        if total > MAX_CHARACTERS:
            raise PdfSourceBundleError(
                f"normalized Markdown exceeds {MAX_CHARACTERS} characters"
            )
        page = {
            "pdf_index": pdf_index,
            "text": text,
            "text_sha256": _sha256_text(text),
            "producer_text_sha256": declared_text_hash,
            "markdown_path": relative_markdown_path,
        }
        review_state = raw_page.get("review_state")
        if review_state not in ACCEPTED_REVIEW_STATES:
            raise PdfSourceBundleError(
                f"{field}.review_state must be an accepted host review state"
            )
        parse_confidence = raw_page.get("parse_confidence")
        if (
            isinstance(parse_confidence, bool)
            or not isinstance(parse_confidence, (int, float))
            or not 0 <= parse_confidence <= 1
        ):
            raise PdfSourceBundleError(
                f"{field}.parse_confidence must be a number from 0 to 1"
            )
        grep_anchors = raw_page.get("grep_anchors")
        if not isinstance(grep_anchors, list) or any(
            not isinstance(anchor, str) or not anchor.strip()
            for anchor in grep_anchors
        ):
            raise PdfSourceBundleError(
                f"{field}.grep_anchors must be a list of non-empty strings"
            )
        for anchor_position, anchor in enumerate(grep_anchors):
            if anchor not in text:
                raise PdfSourceBundleError(
                    f"{field}.grep_anchors[{anchor_position}] is not present in "
                    "the normalized Markdown"
                )
        page.update({
            "review_state": review_state,
            "parse_confidence": parse_confidence,
            "grep_anchors": list(grep_anchors),
        })
        if "printed_page" in raw_page:
            printed_page = raw_page["printed_page"]
            if isinstance(printed_page, bool) or not isinstance(printed_page, int):
                raise PdfSourceBundleError(f"{field}.printed_page must be an integer")
            page["printed_page"] = printed_page
        if "printed_label" in raw_page:
            printed_label = raw_page["printed_label"]
            if not isinstance(printed_label, str) or not printed_label.strip():
                raise PdfSourceBundleError(f"{field}.printed_label must be non-empty")
            page["printed_label"] = printed_label.strip()
        pages.append(page)
    pages.sort(key=lambda item: item["pdf_index"])

    assets: list[dict[str, Any]] = []
    raw_assets = manifest.get("assets", [])
    if not isinstance(raw_assets, list):
        raise PdfSourceBundleError("manifest.assets must be a list when present")
    seen_assets: set[str] = set()
    for position, raw_asset in enumerate(raw_assets):
        field = f"manifest.assets[{position}]"
        if not isinstance(raw_asset, dict):
            raise PdfSourceBundleError(f"{field} must be an object")
        asset_path = _bundle_file(root, raw_asset.get("path"), f"{field}.path")
        relative = str(asset_path.relative_to(root))
        if relative in seen_assets:
            raise PdfSourceBundleError(f"duplicate asset path: {relative}")
        seen_assets.add(relative)
        declared_hash = _require_sha256(raw_asset.get("sha256"), f"{field}.sha256")
        if sha256_file(asset_path) != declared_hash:
            raise PdfSourceBundleError(f"{field} SHA-256 does not match manifest")
        assets.append({"path": relative, "sha256": declared_hash})
    assets.sort(key=lambda item: item["path"])

    source_id = raw_source.get("source_id")
    if not isinstance(source_id, str) or not _SOURCE_ID.fullmatch(source_id.strip()):
        raise PdfSourceBundleError("manifest.source.source_id has an invalid identifier")
    title = raw_source.get("title")
    if not isinstance(title, str) or not title.strip():
        raise PdfSourceBundleError("manifest.source.title must be non-empty")
    source = {
        "source_id": source_id.strip(),
        "path": str(source_path),
        "title": title.strip(),
        "file_sha256": declared_source_hash,
        "page_count": page_count,
        "producer": PRODUCER,
        "source_bundle_path": str(root),
    }
    bundle_sha256 = _canonical_digest(source, pages, assets)
    source["bundle_sha256"] = bundle_sha256
    return {
        "schema_version": SCHEMA_VERSION,
        "producer": PRODUCER,
        "source": source,
        "pages": pages,
        "assets": assets,
        "bundle_sha256": bundle_sha256,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate and deterministically format a Codex pdf-skill source bundle"
    )
    parser.add_argument("bundle", help="directory containing manifest.json")
    parser.add_argument("--output", required=True, help="normalized JSON output path")
    args = parser.parse_args()
    result = load_host_bundle(args.bundle)
    destination = Path(args.output)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(
        json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
