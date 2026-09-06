"""Byte-level verification of a host-produced PDF bundle (contract §14.2).

The repository never opens a PDF. An external skill writes `manifest.json`,
`pages/NNNN.md` (one per page, contiguous from 0, empty pages present) and
`assets/...`; this module checks what the manifest declares against the bytes
on disk and nothing else: sha256 per page, contiguity, `page_count`, asset
hashes and image signatures. A failing bundle is `invalid_params` with
`details.pages` naming every bad page, so the host fixes them all at once."""

from __future__ import annotations

import hashlib
import shutil
from pathlib import Path
from typing import Any

from ..errors import RpcError, invalid_params
from ..fileio import read_json
from ..text import kebab
from .contract import SHA256_RE

BUNDLE_CONTRACT_ID = "coc.pdf-bundle.v1"
MAX_ASSET_BYTES = 20 * 1024 * 1024

IMAGE_MEDIA_BY_SUFFIX = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
}


def _sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _image_signature_ok(media_type: str, payload: bytes) -> bool:
    if media_type == "image/png":
        return payload.startswith(b"\x89PNG\r\n\x1a\n")
    if media_type == "image/jpeg":
        return payload.startswith(b"\xff\xd8\xff")
    if media_type == "image/webp":
        return len(payload) >= 12 and payload.startswith(b"RIFF") and payload[8:12] == b"WEBP"
    return False


def _inside(root: Path, relative: Any) -> Path | None:
    if not isinstance(relative, str) or not relative or Path(relative).is_absolute():
        return None
    path = (root / relative).resolve()
    try:
        path.relative_to(root)
    except ValueError:
        return None
    return path


def slug_for(identity: dict[str, Any]) -> str:
    slug = identity.get("slug")
    if isinstance(slug, str) and slug.strip():
        return slug.strip()
    title = identity.get("title")
    return kebab(str(title or "")) if isinstance(title, str) else ""


class VerifiedBundle:
    def __init__(self, root: Path, manifest: dict[str, Any], pages: list[dict[str, Any]],
                 assets: list[dict[str, Any]]) -> None:
        self.root = root
        self.manifest = manifest
        self.pages = pages
        self.assets = assets

    @property
    def identity(self) -> dict[str, Any]:
        return dict(self.manifest.get("module_identity") or {})

    @property
    def page_count(self) -> int:
        return len(self.pages)

    @property
    def language(self) -> str:
        return str(self.identity.get("language") or "")

    @property
    def title(self) -> str:
        return str(self.identity.get("title") or self.slug)

    @property
    def slug(self) -> str:
        return slug_for(self.identity)

    @property
    def file_sha256(self) -> str:
        return str((self.manifest.get("source") or {}).get("file_sha256") or "")

    def bundle_sha256(self) -> str:
        """One digest over the page and asset digests in page order."""
        digest = hashlib.sha256()
        for page in self.pages:
            digest.update(f"{page['pdf_index']}:{page['sha256']}\n".encode("utf-8"))
        for asset in sorted(self.assets, key=lambda row: str(row["path"])):
            digest.update(f"asset:{asset['path']}:{asset['sha256']}\n".encode("utf-8"))
        return digest.hexdigest()


def verify(bundle_dir: Path | str) -> VerifiedBundle:
    root = Path(bundle_dir).expanduser().resolve()
    manifest_path = root / "manifest.json"
    if not root.is_dir() or not manifest_path.is_file():
        raise invalid_params("bundle must be a directory containing manifest.json",
                             fix="pass the bundle directory, not manifest.json",
                             details={"bundle": str(root)})
    try:
        manifest = read_json(manifest_path)
    except (OSError, UnicodeError, ValueError) as exc:
        raise invalid_params(f"manifest.json is not UTF-8 JSON: {exc}")
    if not isinstance(manifest, dict):
        raise invalid_params("manifest.json must be a JSON object")
    problems: list[str] = []
    if manifest.get("contract") != BUNDLE_CONTRACT_ID:
        problems.append(f"manifest.contract must be {BUNDLE_CONTRACT_ID!r}")
    identity = manifest.get("module_identity")
    if not isinstance(identity, dict) or not isinstance(identity.get("title"), str) \
            or not identity["title"].strip():
        problems.append("manifest.module_identity.title is required")
    elif not isinstance(identity.get("language"), str) or not identity["language"].strip():
        problems.append("manifest.module_identity.language is required (BCP 47)")
    source = manifest.get("source")
    if not isinstance(source, dict):
        problems.append("manifest.source is required")
        source = {}
    declared_count = source.get("page_count")
    if isinstance(declared_count, bool) or not isinstance(declared_count, int) or declared_count < 1:
        problems.append("manifest.source.page_count must be a positive integer")
        declared_count = None
    file_sha = source.get("file_sha256")
    if not isinstance(file_sha, str) or not SHA256_RE.fullmatch(file_sha):
        problems.append("manifest.source.file_sha256 must be a lowercase sha256")
    raw_pages = manifest.get("pages")
    if not isinstance(raw_pages, list) or not raw_pages:
        problems.append("manifest.pages must be a non-empty list")
        raw_pages = []
    if problems:
        raise invalid_params("bundle manifest is malformed: " + "; ".join(problems),
                             fix="regenerate the bundle with the host PDF skill",
                             details={"bundle": str(root), "problems": problems})

    bad_pages: list[dict[str, Any]] = []
    pages: list[dict[str, Any]] = []
    seen: dict[int, int] = {}
    for position, row in enumerate(raw_pages):
        if not isinstance(row, dict):
            bad_pages.append({"position": position, "code": "not_an_object"})
            continue
        index = row.get("pdf_index")
        if isinstance(index, bool) or not isinstance(index, int) or index < 0:
            bad_pages.append({"position": position, "code": "bad_pdf_index", "pdf_index": index})
            continue
        if index in seen:
            bad_pages.append({"pdf_index": index, "code": "duplicate_page"})
            continue
        seen[index] = position
        path = _inside(root, row.get("path"))
        if path is None or not path.is_file():
            bad_pages.append({"pdf_index": index, "code": "missing_page_file", "path": row.get("path")})
            continue
        payload = path.read_bytes()
        try:
            text = payload.decode("utf-8")
        except UnicodeDecodeError:
            bad_pages.append({"pdf_index": index, "code": "page_not_utf8", "path": row.get("path")})
            continue
        declared = row.get("sha256")
        actual = _sha256_bytes(payload)
        if not isinstance(declared, str) or declared != actual:
            bad_pages.append({"pdf_index": index, "code": "sha256_mismatch", "path": row.get("path"),
                              "declared": declared, "actual": actual})
            continue
        chars = row.get("chars")
        if chars is not None and (isinstance(chars, bool) or not isinstance(chars, int)
                                  or chars != len(text)):
            bad_pages.append({"pdf_index": index, "code": "chars_mismatch", "path": row.get("path"),
                              "declared": chars, "actual": len(text)})
            continue
        pages.append({"pdf_index": index, "path": str(path.relative_to(root)), "sha256": actual,
                      "chars": len(text), "text": text})
    pages.sort(key=lambda row: row["pdf_index"])
    expected = list(range(len(raw_pages)))
    present = sorted(seen)
    if present != expected:
        for index in expected:
            if index not in seen:
                bad_pages.append({"pdf_index": index, "code": "page_missing_from_manifest"})
        for index in present:
            if index >= len(raw_pages):
                bad_pages.append({"pdf_index": index, "code": "page_out_of_sequence"})
    if declared_count is not None and declared_count != len(raw_pages):
        bad_pages.append({"code": "page_count_mismatch", "declared": declared_count,
                          "actual": len(raw_pages)})

    assets: list[dict[str, Any]] = []
    bad_assets: list[dict[str, Any]] = []
    raw_assets = manifest.get("assets") or []
    if not isinstance(raw_assets, list):
        bad_assets.append({"code": "assets_not_a_list"})
        raw_assets = []
    asset_ids: set[str] = set()
    for position, row in enumerate(raw_assets):
        if not isinstance(row, dict):
            bad_assets.append({"position": position, "code": "not_an_object"})
            continue
        asset_id = row.get("id")
        if not isinstance(asset_id, str) or not asset_id.strip():
            bad_assets.append({"position": position, "code": "missing_id"})
            continue
        if asset_id in asset_ids:
            bad_assets.append({"id": asset_id, "code": "duplicate_id"})
            continue
        asset_ids.add(asset_id)
        path = _inside(root, row.get("path"))
        if path is None or not path.is_file():
            bad_assets.append({"id": asset_id, "code": "missing_asset_file", "path": row.get("path")})
            continue
        payload = path.read_bytes()
        if not payload or len(payload) > MAX_ASSET_BYTES:
            bad_assets.append({"id": asset_id, "code": "asset_size", "bytes": len(payload)})
            continue
        media_type = row.get("media_type") or IMAGE_MEDIA_BY_SUFFIX.get(path.suffix.lower())
        if media_type not in IMAGE_MEDIA_BY_SUFFIX.values() or not _image_signature_ok(media_type, payload):
            bad_assets.append({"id": asset_id, "code": "asset_not_an_image", "path": row.get("path"),
                               "media_type": media_type})
            continue
        declared = row.get("sha256")
        actual = _sha256_bytes(payload)
        if declared != actual:
            bad_assets.append({"id": asset_id, "code": "sha256_mismatch", "path": row.get("path"),
                               "declared": declared, "actual": actual})
            continue
        asset_pages = [p for p in (row.get("pages") or []) if isinstance(p, int) and not isinstance(p, bool)]
        outside = [p for p in asset_pages if p not in seen]
        if outside:
            bad_assets.append({"id": asset_id, "code": "asset_page_not_in_bundle", "pages": outside})
            continue
        assets.append({"id": asset_id, "kind": str(row.get("kind") or "illustration"),
                       "name": str(row.get("name") or asset_id), "pages": asset_pages,
                       "path": str(path.relative_to(root)), "sha256": actual,
                       "media_type": media_type, "bytes": len(payload)})

    if bad_pages or bad_assets:
        raise RpcError("invalid_params",
                       f"bundle failed byte verification: {len(bad_pages)} page problem(s), "
                       f"{len(bad_assets)} asset problem(s)",
                       fix="fix the listed pages/assets in the bundle and call module.bind again",
                       details={"bundle": str(root), "pages": bad_pages, "assets": bad_assets})
    return VerifiedBundle(root, manifest, pages, assets)


def copy_into(bundle: VerifiedBundle, destination: Path) -> None:
    """Copy manifest, pages and assets into the store; pages and assets are never removed."""
    destination.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(bundle.root / "manifest.json", destination / "manifest.json")
    for page in bundle.pages:
        target = destination / page["path"]
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(bundle.root / page["path"], target)
    for asset in bundle.assets:
        target = destination / asset["path"]
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(bundle.root / asset["path"], target)


def load_pages(bundle_dir: Path) -> list[dict[str, Any]]:
    """Pages of a bundle already verified and copied into the store, text included."""
    manifest = read_json(bundle_dir / "manifest.json")
    pages: list[dict[str, Any]] = []
    for row in manifest.get("pages") or []:
        path = bundle_dir / str(row.get("path") or "")
        if not path.is_file():
            continue
        text = path.read_text(encoding="utf-8")
        pages.append({"pdf_index": int(row["pdf_index"]), "path": str(row.get("path")),
                      "sha256": str(row.get("sha256") or ""), "chars": len(text), "text": text})
    pages.sort(key=lambda row: row["pdf_index"])
    return pages
