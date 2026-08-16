"""Workspace-level campaign lifecycle for the web surface.

Rename edits the campaign identity document's ``title``; delete moves the
whole campaign directory into ``.coc/trash/`` where it stays byte-identical
and recoverable for a fixed retention window (24h) before an explicit purge
removes it. No rules, dice, or save-state semantics live here — the kernel
owns those. The trash indirection is deliberate: a web-side delete is never
an immediate ``rm -rf`` of run evidence (AGENTS.md playtest-evidence law).
"""
from __future__ import annotations

import json
import os
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

TRASH_RETENTION_SECONDS = 24 * 3600
MAX_TITLE_LENGTH = 120


class CampaignAdminError(Exception):
    def __init__(self, message: str, kind: str) -> None:
        super().__init__(message)
        self.kind = kind


def _segment(value: Any, field: str) -> str:
    text = str(value or "").strip()
    if (
        not text
        or text in {".", ".."}
        or "/" in text
        or "\\" in text
        or Path(text).name != text
    ):
        raise CampaignAdminError(f"{field} must be a single path segment", "invalid")
    return text


def _campaigns_root(workspace: Path) -> Path:
    return workspace / ".coc" / "campaigns"


def _trash_campaigns(workspace: Path) -> Path:
    return workspace / ".coc" / "trash" / "campaigns"


def _trash_meta(workspace: Path) -> Path:
    return workspace / ".coc" / "trash" / "meta"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_iso(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.strip())
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _read_campaign_doc(path: Path) -> dict[str, Any]:
    try:
        raw = json.loads(path.read_text("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise CampaignAdminError(
            f"campaign.json is unreadable: {path}", "invalid"
        ) from exc
    if not isinstance(raw, dict):
        raise CampaignAdminError(f"campaign.json is not a JSON object: {path}", "invalid")
    return raw


def _write_json_atomic(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", "utf-8"
    )
    os.replace(tmp, path)


def rename_campaign(
    workspace: Path | str, campaign_id: Any, title: Any
) -> dict[str, Any]:
    """Set ``title`` in the campaign identity document (atomic rewrite)."""
    workspace = Path(workspace)
    campaign_id = _segment(campaign_id, "campaign_id")
    new_title = str(title if title is not None else "").strip()
    if not new_title:
        raise CampaignAdminError("title is required", "invalid")
    if len(new_title) > MAX_TITLE_LENGTH:
        raise CampaignAdminError(
            f"title is too long (max {MAX_TITLE_LENGTH} chars)", "invalid"
        )
    path = _campaigns_root(workspace) / campaign_id / "campaign.json"
    if not path.is_file():
        raise CampaignAdminError(f"未知战役：{campaign_id}", "not_found")
    doc = _read_campaign_doc(path)
    doc["title"] = new_title
    doc["updated_at"] = _now().isoformat()
    _write_json_atomic(path, doc)
    return {"campaign_id": campaign_id, "title": new_title}


def _unique_trash_key(workspace: Path, campaign_id: str, now: datetime) -> str:
    stamp = now.strftime("%Y%m%dT%H%M%S")
    key = campaign_id
    if (_trash_campaigns(workspace) / key).exists() or (
        _trash_meta(workspace) / f"{key}.json"
    ).is_file():
        key = f"{campaign_id}--{stamp}"
        counter = 1
        while (_trash_campaigns(workspace) / key).exists() or (
            _trash_meta(workspace) / f"{key}.json"
        ).is_file():
            key = f"{campaign_id}--{stamp}-{counter}"
            counter += 1
    return key


def trash_campaign(workspace: Path | str, campaign_id: Any) -> dict[str, Any]:
    """Move one campaign directory into ``.coc/trash/`` (recoverable)."""
    workspace = Path(workspace)
    campaign_id = _segment(campaign_id, "campaign_id")
    source = _campaigns_root(workspace) / campaign_id
    if not source.is_dir():
        raise CampaignAdminError(f"未知战役：{campaign_id}", "not_found")
    title: Any = None
    doc_path = source / "campaign.json"
    if doc_path.is_file():
        try:
            title = _read_campaign_doc(doc_path).get("title")
        except CampaignAdminError:
            title = None

    now = _now()
    purge_at = now + timedelta(seconds=TRASH_RETENTION_SECONDS)
    key = _unique_trash_key(workspace, campaign_id, now)
    target = _trash_campaigns(workspace) / key
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.rename(source, target)
    except OSError:
        shutil.move(str(source), str(target))

    _write_json_atomic(
        _trash_meta(workspace) / f"{key}.json",
        {
            "schema_version": 1,
            "trash_key": key,
            "campaign_id": campaign_id,
            "title": title,
            "deleted_at": now.isoformat(),
            "purge_at": purge_at.isoformat(),
        },
    )
    return {
        "trash_key": key,
        "campaign_id": campaign_id,
        "title": title,
        "deleted_at": now.isoformat(),
        "purge_at": purge_at.isoformat(),
    }


def purge_expired(
    workspace: Path | str, now: datetime | None = None
) -> dict[str, Any]:
    """Remove trash entries past their retention window. Idempotent."""
    workspace = Path(workspace)
    now = now or _now()
    purged: list[str] = []
    for meta_file in sorted(_trash_meta(workspace).glob("*.json")):
        try:
            doc = json.loads(meta_file.read_text("utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            continue
        if not isinstance(doc, dict):
            continue
        purge_at = _parse_iso(doc.get("purge_at"))
        if purge_at is None or purge_at > now:
            continue
        key = str(doc.get("trash_key") or meta_file.stem)
        try:
            key = _segment(key, "trash_key")
        except CampaignAdminError:
            continue
        target = _trash_campaigns(workspace) / key
        if target.is_dir():
            shutil.rmtree(target, ignore_errors=True)
        meta_file.unlink(missing_ok=True)
        purged.append(key)
    return {"purged": len(purged), "trash_keys": purged}


def list_trash(workspace: Path | str) -> list[dict[str, Any]]:
    """Purge expired entries lazily, then list the recoverable ones."""
    workspace = Path(workspace)
    purge_expired(workspace)
    entries: list[dict[str, Any]] = []
    for meta_file in sorted(_trash_meta(workspace).glob("*.json")):
        try:
            doc = json.loads(meta_file.read_text("utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            continue
        if not isinstance(doc, dict):
            continue
        key = str(doc.get("trash_key") or meta_file.stem)
        entries.append(
            {
                "trash_key": key,
                "campaign_id": str(doc.get("campaign_id") or key),
                "title": doc.get("title"),
                "deleted_at": doc.get("deleted_at"),
                "purge_at": doc.get("purge_at"),
            }
        )
    entries.sort(key=lambda item: str(item.get("deleted_at") or ""), reverse=True)
    return entries


def restore_campaign(workspace: Path | str, trash_key: Any) -> dict[str, Any]:
    """Move one trashed campaign back under ``.coc/campaigns/``."""
    workspace = Path(workspace)
    key = _segment(trash_key, "trash_key")
    meta_path = _trash_meta(workspace) / f"{key}.json"
    if not meta_path.is_file():
        raise CampaignAdminError("回收站中没有这个战役", "not_found")
    try:
        doc = json.loads(meta_path.read_text("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise CampaignAdminError(
            "回收站记录损坏，无法恢复", "invalid"
        ) from exc
    if not isinstance(doc, dict):
        raise CampaignAdminError("回收站记录损坏，无法恢复", "invalid")
    purge_at = _parse_iso(doc.get("purge_at"))
    if purge_at is not None and purge_at <= _now():
        purge_expired(workspace)
        raise CampaignAdminError(
            "该战役已超过 24 小时保留期，已被自动清除", "expired"
        )
    campaign_id = _segment(doc.get("campaign_id"), "campaign_id")
    source = _trash_campaigns(workspace) / key
    target = _campaigns_root(workspace) / campaign_id
    if not source.is_dir():
        meta_path.unlink(missing_ok=True)
        raise CampaignAdminError("回收站中没有这个战役", "not_found")
    if target.exists():
        raise CampaignAdminError(
            f"已存在同名战役 {campaign_id}，无法恢复；请先处理现有战役", "conflict"
        )
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.rename(source, target)
    except OSError:
        shutil.move(str(source), str(target))
    meta_path.unlink(missing_ok=True)
    return {"campaign_id": campaign_id, "title": doc.get("title")}
