#!/usr/bin/env python3
"""Durable revision-keyed cache for bounded Keeper query projections.

The cache is rebuildable and never authoritative.  Domain revisions are
derived from exact filesystem identities of the canonical inputs, so separate
CLI processes share invalidation without relying on resident memory.
"""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
from pathlib import Path
import re
from typing import Any, Iterable

import coc_fileio


SCHEMA_VERSION = 1
REVISION_FILENAME = "working-set-revisions.json"
CACHE_DIRNAME = "working-set-cache"
REVISION_FIELDS = frozenset({"schema_version", "campaign_id", "domains"})
CACHE_FIELDS = frozenset({
    "schema_version", "campaign_id", "tool", "cache_key", "revision_token",
    "revision_vector", "args_digest", "data", "warnings", "hints",
    "result_digest",
})
_SAFE_COMPONENT = re.compile(r"[^A-Za-z0-9._-]+")


class WorkingSetCacheError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def _digest(value: Any) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    ).encode("utf-8")
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


def _file_identity(path: Path, campaign_dir: Path) -> dict[str, Any]:
    try:
        relative = path.relative_to(campaign_dir).as_posix()
    except ValueError:
        relative = path.as_posix()
    try:
        stat = path.stat()
    except FileNotFoundError:
        return {"path": relative, "exists": False}
    except OSError as exc:
        raise WorkingSetCacheError(
            "state_corrupt", f"cannot inspect working-set dependency: {relative}"
        ) from exc
    return {
        "path": relative,
        "exists": True,
        "mtime_ns": stat.st_mtime_ns,
        "size": stat.st_size,
        "inode": stat.st_ino,
    }


def _domain_signature(campaign_dir: Path, paths: Iterable[Path]) -> str:
    identities = [
        _file_identity(path, campaign_dir)
        for path in sorted({Path(value) for value in paths}, key=lambda row: row.as_posix())
    ]
    return _digest(identities)


def _revision_path(campaign_dir: Path) -> Path:
    return campaign_dir / "save" / REVISION_FILENAME


def _load_revisions(campaign_dir: Path) -> dict[str, Any]:
    path = _revision_path(campaign_dir)
    if not path.is_file():
        return {
            "schema_version": SCHEMA_VERSION,
            "campaign_id": campaign_dir.name,
            "domains": {},
        }
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise WorkingSetCacheError(
            "state_corrupt", "working-set revision state is unreadable"
        ) from exc
    if (
        not isinstance(payload, dict)
        or set(payload) != REVISION_FIELDS
        or payload.get("schema_version") != SCHEMA_VERSION
        or payload.get("campaign_id") != campaign_dir.name
        or not isinstance(payload.get("domains"), dict)
    ):
        raise WorkingSetCacheError(
            "fresh_campaign_required",
            "working-set revision state does not match schema-v1",
        )
    for domain, row in payload["domains"].items():
        if (
            not isinstance(domain, str)
            or not domain
            or not isinstance(row, dict)
            or set(row) != {"revision", "signature"}
            or isinstance(row.get("revision"), bool)
            or not isinstance(row.get("revision"), int)
            or row["revision"] < 1
            or not isinstance(row.get("signature"), str)
            or not row["signature"]
        ):
            raise WorkingSetCacheError(
                "state_corrupt", "working-set domain revision is invalid"
            )
    return payload


def revision_vector(
    campaign_dir: Path,
    domain_paths: dict[str, Iterable[Path]],
) -> tuple[dict[str, int], str]:
    """Refresh requested domain revisions and return vector + stable token."""
    campaign_dir = Path(campaign_dir)
    document = _load_revisions(campaign_dir)
    changed = False
    vector: dict[str, int] = {}
    for domain in sorted(domain_paths):
        if not isinstance(domain, str) or not domain:
            raise WorkingSetCacheError("invalid_request", "cache domain is invalid")
        signature = _domain_signature(campaign_dir, domain_paths[domain])
        prior = document["domains"].get(domain)
        if prior is None:
            revision = 1
            document["domains"][domain] = {
                "revision": revision,
                "signature": signature,
            }
            changed = True
        elif prior["signature"] != signature:
            revision = int(prior["revision"]) + 1
            document["domains"][domain] = {
                "revision": revision,
                "signature": signature,
            }
            changed = True
        else:
            revision = int(prior["revision"])
        vector[domain] = revision
    if changed:
        coc_fileio.write_json_atomic(_revision_path(campaign_dir), document)
    token = "ws-v1-" + _digest(vector).split(":", 1)[1][:24]
    return vector, token


def _cache_path(campaign_dir: Path, tool: str, cache_key: str) -> Path:
    safe_tool = _SAFE_COMPONENT.sub("-", tool).strip("-") or "tool"
    return campaign_dir / "save" / CACHE_DIRNAME / safe_tool / f"{cache_key}.json"


def cache_ref(campaign_dir: Path, *, tool: str, cache_key: str) -> str:
    """Return the canonical campaign-relative reference for one cache entry."""
    campaign_dir = Path(campaign_dir)
    return _cache_path(campaign_dir, tool, cache_key).relative_to(
        campaign_dir
    ).as_posix()


def cache_identity(
    *,
    campaign_id: str,
    tool: str,
    args: dict[str, Any],
    revision_vector: dict[str, int],
    contract_identity: dict[str, Any],
) -> tuple[str, str]:
    normalized_args = {
        key: deepcopy(value)
        for key, value in args.items()
        if key != "since_revision"
    }
    args_digest = _digest(normalized_args)
    key_digest = _digest({
        "schema_version": SCHEMA_VERSION,
        "campaign_id": campaign_id,
        "tool": tool,
        "args_digest": args_digest,
        "revision_vector": revision_vector,
        "contract_identity": contract_identity,
    })
    return key_digest.split(":", 1)[1], args_digest


def load(
    campaign_dir: Path,
    *,
    tool: str,
    cache_key: str,
    revision_token: str,
    revision_vector: dict[str, int],
    args_digest: str,
) -> tuple[Any, list[str], list[str]] | None:
    path = _cache_path(Path(campaign_dir), tool, cache_key)
    if not path.is_file():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        path.unlink(missing_ok=True)
        return None
    expected = (
        isinstance(payload, dict)
        and set(payload) == CACHE_FIELDS
        and payload.get("schema_version") == SCHEMA_VERSION
        and payload.get("campaign_id") == Path(campaign_dir).name
        and payload.get("tool") == tool
        and payload.get("cache_key") == cache_key
        and payload.get("revision_token") == revision_token
        and payload.get("revision_vector") == revision_vector
        and payload.get("args_digest") == args_digest
        and isinstance(payload.get("warnings"), list)
        and isinstance(payload.get("hints"), list)
        and payload.get("result_digest")
        == _digest({
            "data": payload.get("data"),
            "warnings": payload.get("warnings"),
            "hints": payload.get("hints"),
        })
    )
    if not expected:
        path.unlink(missing_ok=True)
        return None
    return (
        deepcopy(payload["data"]),
        list(payload["warnings"]),
        list(payload["hints"]),
    )


def store(
    campaign_dir: Path,
    *,
    tool: str,
    cache_key: str,
    revision_token: str,
    revision_vector: dict[str, int],
    args_digest: str,
    data: Any,
    warnings: list[str],
    hints: list[str],
) -> str:
    result = {
        "data": deepcopy(data),
        "warnings": list(warnings),
        "hints": list(hints),
    }
    payload = {
        "schema_version": SCHEMA_VERSION,
        "campaign_id": Path(campaign_dir).name,
        "tool": tool,
        "cache_key": cache_key,
        "revision_token": revision_token,
        "revision_vector": dict(revision_vector),
        "args_digest": args_digest,
        **result,
        "result_digest": _digest(result),
    }
    path = _cache_path(Path(campaign_dir), tool, cache_key)
    coc_fileio.write_json_atomic(path, payload)
    return cache_ref(Path(campaign_dir), tool=tool, cache_key=cache_key)
