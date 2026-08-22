#!/usr/bin/env python3
"""Bounded binary/manifest boundary for host-produced source media.

This module never opens or parses a PDF.  It receives an already validated
host bundle, preserves exact image bytes below one module root, and projects
only hash-current registered refs to source workers.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import stat
import tempfile
from pathlib import Path
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent
_HEX = frozenset("0123456789abcdef")
_MEDIA_TYPES = frozenset({"image/png", "image/jpeg", "image/webp"})
_REGISTERED_REF_FIELDS = frozenset({
    "image_ref", "media_type", "sha256", "size_bytes", "bundle_sha256",
})


class SourceMediaError(ValueError):
    """Source media bytes or their manifest violate the closed boundary."""


def _load_sibling(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPT_DIR / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_fileio = _load_sibling("coc_fileio_source_media", "coc_fileio.py")
coc_pdf_bundle = _load_sibling("coc_pdf_bundle_source_media", "coc_pdf_bundle.py")


def _require_sha256(value: Any, field: str) -> str:
    if (
        not isinstance(value, str)
        or len(value) != 64
        or any(character not in _HEX for character in value)
    ):
        raise SourceMediaError(f"{field} must be a lowercase SHA-256 digest")
    return value


def _portable_asset_ref(value: Any, field: str) -> str:
    if (
        not isinstance(value, str)
        or not value
        or "\\" in value
        or Path(value).is_absolute()
        or Path(value).parts[:1] != ("assets",)
        or any(part in {"", ".", ".."} for part in Path(value).parts)
    ):
        raise SourceMediaError(f"{field} must be a confined assets/... path")
    return value


def _assert_no_symlink_components(module_root: Path, asset_path: Path) -> None:
    """Reject every existing symlink component below ``module_root``."""
    root = module_root.absolute()
    candidate = asset_path.absolute()
    try:
        relative = candidate.relative_to(root)
    except ValueError as exc:
        raise SourceMediaError("asset path escapes the module asset root") from exc
    current = root
    for part in relative.parts:
        current = current / part
        try:
            mode = current.lstat().st_mode
        except FileNotFoundError:
            continue
        except OSError as exc:
            raise SourceMediaError("asset path components are unreadable") from exc
        if stat.S_ISLNK(mode):
            raise SourceMediaError(
                f"asset path uses symlink component: {current.relative_to(root)}"
            )


def _validated_registered_path(
    module_root: Path,
    image_ref: str,
    *,
    expected_sha256: str,
    expected_size: int,
    expected_media_type: str,
) -> bytes:
    """Re-lstat, realpath, read, and hash one registered asset consistently."""
    root = module_root.absolute()
    asset_path = root / _portable_asset_ref(image_ref, "image_ref")
    _assert_no_symlink_components(root, asset_path)
    try:
        resolved_root = root.resolve(strict=True)
        resolved_asset = asset_path.resolve(strict=True)
        resolved_asset.relative_to(resolved_root)
    except (OSError, ValueError) as exc:
        raise SourceMediaError(
            "registered source asset drift: image path is unavailable or escapes"
        ) from exc
    if resolved_asset != asset_path.absolute():
        raise SourceMediaError(
            "registered source asset drift: image path uses a symlink"
        )
    try:
        info = asset_path.lstat()
        payload = asset_path.read_bytes()
    except OSError as exc:
        raise SourceMediaError(
            "registered source asset drift: image bytes are unreadable"
        ) from exc
    if not stat.S_ISREG(info.st_mode):
        raise SourceMediaError(
            "registered source asset drift: image path is not a regular file"
        )
    actual_sha256 = hashlib.sha256(payload).hexdigest()
    if actual_sha256 != expected_sha256 or len(payload) != expected_size:
        raise SourceMediaError(
            "registered source asset drift: image hash or size changed"
        )
    try:
        media_type = coc_pdf_bundle._image_media_type(
            asset_path, payload, "registered source asset",
        )
    except coc_pdf_bundle.PdfSourceBundleError as exc:
        raise SourceMediaError(
            "registered source asset drift: image media is invalid"
        ) from exc
    if media_type != expected_media_type:
        raise SourceMediaError(
            "registered source asset drift: image media type changed"
        )
    return payload


def validate_registered_asset_ref_rows(value: Any) -> list[dict[str, Any]]:
    """Validate and canonicalize the closed worker-facing asset ref rows."""
    if not isinstance(value, list):
        raise SourceMediaError("allowed_registered_asset_refs must be an array")
    normalized: list[dict[str, Any]] = []
    for position, row in enumerate(value):
        field = f"allowed_registered_asset_refs[{position}]"
        if not isinstance(row, dict) or set(row) != _REGISTERED_REF_FIELDS:
            raise SourceMediaError(f"{field} has unsupported fields")
        media_type = row.get("media_type")
        if media_type not in _MEDIA_TYPES:
            raise SourceMediaError(f"{field}.media_type is unsupported")
        size_bytes = row.get("size_bytes")
        if (
            isinstance(size_bytes, bool)
            or not isinstance(size_bytes, int)
            or not 0 < size_bytes <= coc_pdf_bundle.MAX_IMAGE_ASSET_BYTES
        ):
            raise SourceMediaError(f"{field}.size_bytes is invalid")
        normalized.append({
            "image_ref": _portable_asset_ref(
                row.get("image_ref"), f"{field}.image_ref",
            ),
            "media_type": media_type,
            "sha256": _require_sha256(row.get("sha256"), f"{field}.sha256"),
            "size_bytes": size_bytes,
            "bundle_sha256": _require_sha256(
                row.get("bundle_sha256"), f"{field}.bundle_sha256",
            ),
        })
    unique = {
        (row["image_ref"], row["bundle_sha256"]): row for row in normalized
    }
    if len(unique) != len(normalized):
        raise SourceMediaError("allowed_registered_asset_refs repeats an asset")
    return sorted(
        normalized,
        key=lambda row: (row["image_ref"], row["bundle_sha256"]),
    )


def _read_manifest(path: Path) -> dict[str, Any]:
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise SourceMediaError("registered source asset manifest is unreadable") from exc
    if (
        not isinstance(manifest, dict)
        or manifest.get("schema_version") != 1
        or not isinstance(manifest.get("assets"), list)
    ):
        raise SourceMediaError("registered source asset manifest is invalid")
    return manifest


def prepare_bundle_assets(
    bundle: dict[str, Any], module_root: Path,
) -> list[dict[str, Any]]:
    """Validate every source and target before any asset/page mutation."""
    raw_assets = bundle.get("assets") or []
    if not raw_assets:
        return []
    source = bundle.get("source")
    source_root_value = (
        source.get("source_bundle_path") if isinstance(source, dict) else None
    )
    if not isinstance(source_root_value, str) or not source_root_value.strip():
        raise SourceMediaError(
            "source bundle assets require source.source_bundle_path"
        )
    source_root = Path(source_root_value).expanduser().resolve()
    if not source_root.is_dir():
        raise SourceMediaError("source bundle asset root is unavailable")
    target_root = module_root.absolute()
    manifest_path = target_root / "source-assets.json"
    _assert_no_symlink_components(target_root, manifest_path)
    existing_rows: dict[str, dict[str, Any]] = {}
    if manifest_path.exists():
        existing = _read_manifest(manifest_path)
        existing_rows = {
            str(row.get("source_bundle_path") or ""): row
            for row in existing["assets"]
            if isinstance(row, dict) and str(row.get("source_bundle_path") or "")
        }

    prepared: list[dict[str, Any]] = []
    seen_paths: set[str] = set()
    for position, raw in enumerate(raw_assets):
        field = f"source bundle assets[{position}]"
        if not isinstance(raw, dict):
            raise SourceMediaError(f"{field} must be an object")
        relative_text = _portable_asset_ref(raw.get("path"), f"{field}.path")
        if relative_text in seen_paths:
            raise SourceMediaError(f"{field}.path must be unique")
        seen_paths.add(relative_text)
        relative_path = Path(relative_text)
        try:
            source_path = (source_root / relative_path).resolve(strict=True)
            source_path.relative_to(source_root)
        except (OSError, ValueError) as exc:
            raise SourceMediaError(f"{field}.path escapes the source bundle") from exc
        if not source_path.is_file():
            raise SourceMediaError(f"{field}.path is not a readable file")
        payload = source_path.read_bytes()
        if not payload:
            raise SourceMediaError(f"{field} must not be empty")
        if len(payload) > coc_pdf_bundle.MAX_IMAGE_ASSET_BYTES:
            raise SourceMediaError(f"{field} exceeds 20 MiB")
        try:
            media_type = coc_pdf_bundle._image_media_type(
                source_path, payload, field,
            )
        except coc_pdf_bundle.PdfSourceBundleError as exc:
            raise SourceMediaError(str(exc)) from exc
        declared_hash = _require_sha256(raw.get("sha256"), f"{field}.sha256")
        actual_hash = hashlib.sha256(payload).hexdigest()
        if actual_hash != declared_hash:
            raise SourceMediaError(f"{field} SHA-256 does not match manifest")
        if raw.get("media_type") not in (None, media_type):
            raise SourceMediaError(f"{field}.media_type does not match image media")
        if raw.get("size_bytes") not in (None, len(payload)):
            raise SourceMediaError(f"{field}.size_bytes does not match asset bytes")
        destination = target_root / relative_path
        _assert_no_symlink_components(target_root, destination)
        try:
            destination.resolve().relative_to(target_root.resolve())
        except ValueError as exc:
            raise SourceMediaError(
                f"{field}.path escapes the module asset root"
            ) from exc
        if destination.exists():
            if not destination.is_file():
                raise SourceMediaError(f"{field}.path collides with a non-file")
            if hashlib.sha256(destination.read_bytes()).hexdigest() != actual_hash:
                raise SourceMediaError(
                    f"asset path collision for {relative_text}: existing hash differs"
                )
        previous = existing_rows.get(relative_text)
        if previous is not None and str(previous.get("sha256") or "") != actual_hash:
            raise SourceMediaError(
                f"asset path collision for {relative_text}: manifest hash differs"
            )
        bundle_hashes = sorted({
            *(
                str(value)
                for value in (previous or {}).get("bundle_sha256s") or []
                if isinstance(value, str) and value
            ),
            str(bundle["bundle_sha256"]),
        })
        prepared.append({
            "source_bundle_path": relative_text,
            "image_ref": relative_text,
            "media_type": media_type,
            "sha256": actual_hash,
            "size_bytes": len(payload),
            "bundle_sha256s": bundle_hashes,
            "_payload": payload,
            "_destination": destination,
        })
    return sorted(prepared, key=lambda row: row["source_bundle_path"])


def _write_bytes_atomic(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile("wb", dir=path.parent, delete=False) as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
            temporary = Path(handle.name)
        os.replace(temporary, path)
        temporary = None
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def publish_prepared_assets(
    module_root: Path, prepared: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Publish exact bytes, then reverify them before committing the manifest."""
    if not prepared:
        return []
    manifest_path = module_root / "source-assets.json"
    _assert_no_symlink_components(module_root, manifest_path)
    merged: dict[str, dict[str, Any]] = {}
    if manifest_path.is_file():
        existing = _read_manifest(manifest_path)
        merged = {
            str(row["source_bundle_path"]): json.loads(json.dumps(row))
            for row in existing["assets"]
            if isinstance(row, dict)
            and isinstance(row.get("source_bundle_path"), str)
        }
    public_rows: list[dict[str, Any]] = []
    for row in prepared:
        destination = row["_destination"]
        _assert_no_symlink_components(module_root, destination)
        if not destination.exists():
            _write_bytes_atomic(destination, row["_payload"])
        _validated_registered_path(
            module_root,
            str(row["image_ref"]),
            expected_sha256=str(row["sha256"]),
            expected_size=int(row["size_bytes"]),
            expected_media_type=str(row["media_type"]),
        )
        public = {
            key: json.loads(json.dumps(value))
            for key, value in row.items()
            if not key.startswith("_")
        }
        public_rows.append(public)
        merged[str(row["source_bundle_path"])] = public
    # A later row may take long enough to expose drift in an earlier target.
    # Re-prove every byte/ref immediately before the manifest makes it visible.
    for row in public_rows:
        _validated_registered_path(
            module_root,
            str(row["image_ref"]),
            expected_sha256=str(row["sha256"]),
            expected_size=int(row["size_bytes"]),
            expected_media_type=str(row["media_type"]),
        )
    coc_fileio.write_json_atomic(
        manifest_path,
        {"schema_version": 1, "assets": [merged[key] for key in sorted(merged)]},
        indent=2,
        ensure_ascii=True,
        trailing_newline=True,
    )
    return public_rows


def registered_asset_refs(
    module_root: Path,
    *,
    requested_pdf_indices: list[int],
) -> list[dict[str, Any]]:
    """Project hash-current assets from bundles covering the page request."""
    if not requested_pdf_indices:
        return []
    manifest_path = module_root / "source-assets.json"
    identity_path = module_root / "identity.json"
    _assert_no_symlink_components(module_root, manifest_path)
    if not manifest_path.is_file() or not identity_path.is_file():
        return []
    manifest = _read_manifest(manifest_path)
    try:
        identity = json.loads(identity_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise SourceMediaError("registered source asset index is unreadable") from exc
    requested = set(requested_pdf_indices)
    eligible_bundles = {
        str(row.get("bundle_sha256") or "")
        for row in identity.get("source_bundles") or []
        if isinstance(row, dict)
        and requested <= {
            value
            for value in row.get("pdf_indices") or []
            if isinstance(value, int) and not isinstance(value, bool)
        }
        and str(row.get("bundle_sha256") or "")
    }
    refs: list[dict[str, Any]] = []
    for row in manifest["assets"]:
        if not isinstance(row, dict):
            raise SourceMediaError("registered source asset row is invalid")
        matching_bundles = sorted(
            eligible_bundles.intersection(row.get("bundle_sha256s") or [])
        )
        if not matching_bundles:
            continue
        image_ref = _portable_asset_ref(row.get("image_ref"), "image_ref")
        expected_sha256 = _require_sha256(
            row.get("sha256"), "registered source asset sha256",
        )
        expected_size = row.get("size_bytes")
        if isinstance(expected_size, bool) or not isinstance(expected_size, int):
            raise SourceMediaError("registered source asset size is invalid")
        expected_media_type = row.get("media_type")
        if expected_media_type not in _MEDIA_TYPES:
            raise SourceMediaError("registered source asset media type is invalid")
        payload = _validated_registered_path(
            module_root,
            image_ref,
            expected_sha256=expected_sha256,
            expected_size=expected_size,
            expected_media_type=expected_media_type,
        )
        for bundle_sha256 in matching_bundles:
            refs.append({
                "image_ref": image_ref,
                "media_type": expected_media_type,
                "sha256": expected_sha256,
                "size_bytes": len(payload),
                "bundle_sha256": bundle_sha256,
            })
    return sorted(
        refs,
        key=lambda row: (row["image_ref"], row["bundle_sha256"]),
    )
