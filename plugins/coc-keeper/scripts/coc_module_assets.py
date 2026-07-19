#!/usr/bin/env python3
"""Durable progressive module-asset store (skeleton + pages + entity packs).

Slice 1 of docs/active-plans/coc-on-demand-module-skeleton.md:
schema constants, store layout, registry, skeleton validation, page/entity
writes, parse-queue enqueue. No play/director integration yet.

Layout: workspace ``.coc/module-assets/`` (local only, not git).
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent

SCHEMA_VERSION = 1
REGISTRY_NAME = "registry.json"
LICENSE_NOTE = (
    "Local progressive parse cache for a user-supplied PDF. "
    "Do not commit Product Identity prose to git.\n"
)
PARSE_STATES = frozenset({
    "named_only", "toc_only", "partial", "body_parsed", "deep", "failed",
})
EDGE_KINDS = frozenset({
    "travel", "contains", "unlock", "mentioned", "chapter_handoff",
})
EDGE_CONFIDENCE = frozenset({"low", "med", "high"})
EDGE_EVIDENCE = frozenset({
    "toc_adjacency", "map", "body_mention", "clue", "handout", "npc_dialogue",
})
ENTITY_KINDS = frozenset({"location", "npc", "clue", "handout", "threat"})
JOB_KINDS = frozenset({
    "deepen_location", "deepen_npc", "deepen_clue", "deepen_handout",
    "partial_neighbor", "ensure_stub",
})
_ENTITY_ID_KEY = {
    "location": "location_id",
    "npc": "npc_id",
    "clue": "clue_id",
    "handout": "handout_id",
    "threat": "threat_id",
}
_SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_HEX = frozenset("0123456789abcdef")


class ModuleAssetsError(ValueError):
    """Module-assets store contract violation."""


def _load_sibling(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPT_DIR / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_fileio = _load_sibling("coc_fileio_module_assets", "coc_fileio.py")
coc_state = _load_sibling("coc_state_module_assets", "coc_state.py")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _coc_root(workspace: Path) -> Path:
    return coc_state.coc_root(Path(workspace).resolve())


def assets_root(workspace: Path) -> Path:
    return _coc_root(workspace) / "module-assets"


def registry_path(workspace: Path) -> Path:
    return assets_root(workspace) / REGISTRY_NAME


def resolve_asset_root_id(
    *,
    canonical_module_id: str | None = None,
    file_sha256: str | None = None,
) -> str:
    cid = (canonical_module_id or "").strip()
    if cid:
        return _require_id(cid, "canonical_module_id")
    return f"pdf-{_require_sha256(file_sha256, 'file_sha256')[:16]}"


def _require_sha256(value: Any, field: str) -> str:
    if not isinstance(value, str) or len(value) != 64 or any(c not in _HEX for c in value):
        raise ModuleAssetsError(f"{field} must be a lowercase SHA-256 digest")
    return value


def _require_id(value: Any, field: str) -> str:
    text = str(value or "").strip()
    if not _SAFE_ID.match(text) or "/" in text or ".." in text:
        raise ModuleAssetsError(f"{field} must be a safe id")
    return text


def _module_dir(workspace: Path, asset_root_id: str) -> Path:
    root = assets_root(workspace).resolve()
    path = (root / _require_id(asset_root_id, "asset_root_id")).resolve()
    try:
        path.relative_to(root)
    except ValueError as exc:
        raise ModuleAssetsError("asset_root_id escapes module-assets root") from exc
    return path


def _write_json(path: Path, payload: Any) -> None:
    coc_fileio.write_json_atomic(
        path, payload, indent=2, ensure_ascii=False, trailing_newline=True,
    )


def empty_registry() -> dict[str, Any]:
    return {"schema_version": SCHEMA_VERSION, "modules": {}, "by_file_sha256": {}}


def load_registry(workspace: Path) -> dict[str, Any]:
    path = registry_path(workspace)
    if not path.is_file():
        return empty_registry()
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or data.get("schema_version") != SCHEMA_VERSION:
        raise ModuleAssetsError("module-assets registry schema_version mismatch")
    data.setdefault("modules", {})
    data.setdefault("by_file_sha256", {})
    return data


def save_registry(workspace: Path, registry: dict[str, Any]) -> None:
    registry = dict(registry)
    registry["schema_version"] = SCHEMA_VERSION
    _write_json(registry_path(workspace), registry)


def init_module_root(
    workspace: Path,
    *,
    asset_root_id: str,
    identity: dict[str, Any],
    file_sha256: str,
) -> Path:
    """Create empty durable root and register it. Idempotent if same sha."""
    digest = _require_sha256(file_sha256, "file_sha256")
    root_id = _require_id(asset_root_id, "asset_root_id")
    mod = _module_dir(workspace, root_id)
    mod.mkdir(parents=True, exist_ok=True)
    for sub in ("pages", "entities", "handouts"):
        (mod / sub).mkdir(exist_ok=True)

    identity_doc = {
        "schema_version": SCHEMA_VERSION,
        "asset_root_id": root_id,
        "file_sha256": digest,
        "module_identity": dict(identity or {}),
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
    }
    existing = mod / "identity.json"
    if existing.is_file():
        prev = json.loads(existing.read_text(encoding="utf-8"))
        if prev.get("file_sha256") and prev["file_sha256"] != digest:
            raise ModuleAssetsError(
                f"asset_root_id {root_id!r} already bound to a different file_sha256"
            )
        identity_doc["created_at"] = prev.get("created_at") or identity_doc["created_at"]
        if isinstance(prev.get("module_identity"), dict) and not identity:
            identity_doc["module_identity"] = prev["module_identity"]
    _write_json(mod / "identity.json", identity_doc)

    for name, payload in (
        ("mentions-index.json", {"schema_version": SCHEMA_VERSION, "entities": {}}),
        ("parse-queue.json", {
            "schema_version": SCHEMA_VERSION,
            "pending": [], "in_flight": [], "done": [],
        }),
    ):
        path = mod / name
        if not path.is_file():
            _write_json(path, payload)
    license_path = mod / "LICENSE-note.md"
    if not license_path.is_file():
        coc_fileio.write_text_atomic(license_path, LICENSE_NOTE)

    registry = load_registry(workspace)
    modules = registry.setdefault("modules", {})
    by_sha = registry.setdefault("by_file_sha256", {})
    owner = by_sha.get(digest)
    if owner and owner != root_id:
        raise ModuleAssetsError(
            f"file_sha256 already registered under asset_root_id {owner!r}"
        )
    modules[root_id] = {
        "asset_root_id": root_id,
        "file_sha256": digest,
        "canonical_module_id": (identity or {}).get("canonical_module_id") or root_id,
        "updated_at": _now_iso(),
        "parse_tier_max": int(modules.get(root_id, {}).get("parse_tier_max") or 0),
    }
    by_sha[digest] = root_id
    save_registry(workspace, registry)
    return mod


def lookup_by_sha256(workspace: Path, file_sha256: str) -> dict[str, Any] | None:
    digest = _require_sha256(file_sha256, "file_sha256")
    registry = load_registry(workspace)
    root_id = (registry.get("by_file_sha256") or {}).get(digest)
    if not root_id:
        return None
    return (registry.get("modules") or {}).get(root_id)


def validate_skeleton(skeleton: dict[str, Any]) -> list[str]:
    """Return error strings; empty list means skeleton publish gate passes."""
    errors: list[str] = []
    if not isinstance(skeleton, dict):
        return ["skeleton must be an object"]
    if skeleton.get("schema_version") != SCHEMA_VERSION:
        errors.append("schema_version must be 1")
    if skeleton.get("parse_tier") not in (0, 1, 2, 3, 4, 5):
        errors.append("parse_tier must be an integer 0..5")
    source = skeleton.get("source")
    if not isinstance(source, dict):
        errors.append("source must be an object")
    else:
        try:
            _require_sha256(source.get("file_sha256"), "source.file_sha256")
        except ModuleAssetsError as exc:
            errors.append(str(exc))
        if not str(source.get("source_id") or "").strip():
            errors.append("source.source_id is required")
    starts = skeleton.get("start_candidates")
    if not isinstance(starts, list) or not starts or not all(
        isinstance(x, str) and x.strip() for x in starts
    ):
        errors.append("start_candidates must be a non-empty string list")
        start_set: set[str] = set()
    else:
        start_set = {x.strip() for x in starts}

    locations = skeleton.get("locations")
    loc_ids: set[str] = set()
    if not isinstance(locations, list) or not locations:
        errors.append("locations must be a non-empty list")
    else:
        for i, loc in enumerate(locations):
            prefix = f"locations[{i}]"
            if not isinstance(loc, dict):
                errors.append(f"{prefix} must be an object")
                continue
            try:
                lid = _require_id(loc.get("location_id"), f"{prefix}.location_id")
            except ModuleAssetsError as exc:
                errors.append(str(exc))
                continue
            if lid in loc_ids:
                errors.append(f"duplicate location_id {lid!r}")
            loc_ids.add(lid)
            if not str(loc.get("title") or "").strip():
                errors.append(f"{prefix}.title is required")
            if loc.get("parse_state") not in PARSE_STATES:
                errors.append(f"{prefix}.parse_state invalid")
    for sid in start_set:
        if loc_ids and sid not in loc_ids:
            errors.append(f"start_candidates entry {sid!r} missing from locations")

    for i, edge in enumerate(skeleton.get("edges_provisional") or []):
        prefix = f"edges_provisional[{i}]"
        if not isinstance(edge, dict):
            errors.append(f"{prefix} must be an object")
            continue
        if edge.get("kind") not in EDGE_KINDS:
            errors.append(f"{prefix}.kind invalid")
        if edge.get("confidence") not in EDGE_CONFIDENCE:
            errors.append(f"{prefix}.confidence invalid")
        if edge.get("evidence") not in EDGE_EVIDENCE:
            errors.append(f"{prefix}.evidence invalid")
        for end in ("from", "to"):
            node = str(edge.get(end) or "").strip()
            if not node:
                errors.append(f"{prefix}.{end} required")
            elif loc_ids and node not in loc_ids:
                errors.append(f"{prefix}.{end} unknown location {node!r}")

    seen_npc: set[str] = set()
    for i, npc in enumerate(skeleton.get("npc_roster") or []):
        prefix = f"npc_roster[{i}]"
        if not isinstance(npc, dict):
            errors.append(f"{prefix} must be an object")
            continue
        try:
            nid = _require_id(npc.get("npc_id"), f"{prefix}.npc_id")
        except ModuleAssetsError as exc:
            errors.append(str(exc))
            continue
        if nid in seen_npc:
            errors.append(f"duplicate npc_id {nid!r}")
        seen_npc.add(nid)
        if npc.get("parse_state") not in PARSE_STATES:
            errors.append(f"{prefix}.parse_state invalid")
    return errors


def put_skeleton(
    workspace: Path, asset_root_id: str, skeleton: dict[str, Any],
) -> dict[str, Any]:
    errors = validate_skeleton(skeleton)
    if errors:
        raise ModuleAssetsError("skeleton invalid: " + "; ".join(errors))
    mod = _module_dir(workspace, asset_root_id)
    if not (mod / "identity.json").is_file():
        raise ModuleAssetsError("init_module_root before put_skeleton")
    doc = dict(skeleton)
    doc["schema_version"] = SCHEMA_VERSION
    path = mod / "skeleton.json"
    _write_json(path, doc)
    _bump_parse_tier(workspace, asset_root_id, int(doc.get("parse_tier") or 1))
    return {"path": str(path), "location_count": len(doc.get("locations") or [])}


def get_skeleton(workspace: Path, asset_root_id: str) -> dict[str, Any] | None:
    path = _module_dir(workspace, asset_root_id) / "skeleton.json"
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def put_page(
    workspace: Path,
    asset_root_id: str,
    pdf_index: int,
    text: str,
    *,
    meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if not isinstance(pdf_index, int) or isinstance(pdf_index, bool) or pdf_index < 0:
        raise ModuleAssetsError("pdf_index must be a non-negative integer")
    if not isinstance(text, str) or not text.strip():
        raise ModuleAssetsError("page text must be non-empty")
    mod = _module_dir(workspace, asset_root_id)
    if not (mod / "identity.json").is_file():
        raise ModuleAssetsError("init_module_root before put_page")
    stem = f"{pdf_index:04d}"
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    if not normalized.endswith("\n"):
        normalized += "\n"
    digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
    md_path = mod / "pages" / f"{stem}.md"
    coc_fileio.write_text_atomic(md_path, normalized)
    meta_doc = {
        "schema_version": SCHEMA_VERSION,
        "pdf_index": pdf_index,
        "text_sha256": digest,
        "updated_at": _now_iso(),
        **(meta or {}),
    }
    _write_json(mod / "pages" / f"{stem}.meta.json", meta_doc)
    return {"pdf_index": pdf_index, "text_sha256": digest, "path": str(md_path)}


def get_page(
    workspace: Path, asset_root_id: str, pdf_index: int,
) -> dict[str, Any] | None:
    mod = _module_dir(workspace, asset_root_id)
    stem = f"{pdf_index:04d}"
    md_path = mod / "pages" / f"{stem}.md"
    if not md_path.is_file():
        return None
    meta_path = mod / "pages" / f"{stem}.meta.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.is_file() else {}
    return {"pdf_index": pdf_index, "text": md_path.read_text(encoding="utf-8"), "meta": meta}


def put_entity(
    workspace: Path,
    asset_root_id: str,
    kind: str,
    entity_id: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    if kind not in ENTITY_KINDS:
        raise ModuleAssetsError(f"unknown entity kind {kind!r}")
    eid = _require_id(entity_id, "entity_id")
    if not isinstance(payload, dict):
        raise ModuleAssetsError("entity payload must be an object")
    mod = _module_dir(workspace, asset_root_id)
    if not (mod / "identity.json").is_file():
        raise ModuleAssetsError("init_module_root before put_entity")
    doc = dict(payload)
    doc["schema_version"] = SCHEMA_VERSION
    doc.setdefault("parse_state", "named_only")
    if doc["parse_state"] not in PARSE_STATES:
        raise ModuleAssetsError("entity parse_state invalid")
    doc["updated_at"] = _now_iso()
    doc[_ENTITY_ID_KEY[kind]] = eid
    path = mod / "entities" / f"{kind}-{eid}.json"
    _write_json(path, doc)
    out: dict[str, Any] = {"path": str(path), "kind": kind, "entity_id": eid}
    # When a deep pack lands, re-enqueue high-priority merge and kick workers
    # so campaigns update without blocking the host put path.
    parse_state = str(doc.get("parse_state") or "")
    if parse_state == "deep" and not doc.get("evidence_gap"):
        try:
            worker = _load_sibling(
                "coc_module_queue_worker_put_entity", "coc_module_queue_worker.py",
            )
            out["worker"] = worker.reenqueue_merge_for_entity(
                workspace,
                asset_root_id,
                kind=kind,
                target_id=eid,
                reason="put_entity_deep",
            )
        except Exception:  # noqa: BLE001
            out["worker"] = {"error": "reenqueue_kick_failed"}
    return out


def get_entity(
    workspace: Path, asset_root_id: str, kind: str, entity_id: str,
) -> dict[str, Any] | None:
    if kind not in ENTITY_KINDS:
        raise ModuleAssetsError(f"unknown entity kind {kind!r}")
    path = _module_dir(workspace, asset_root_id) / "entities" / (
        f"{kind}-{_require_id(entity_id, 'entity_id')}.json"
    )
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def ensure_stub(
    workspace: Path,
    asset_root_id: str,
    kind: str,
    entity_id: str,
    *,
    title: str | None = None,
    reason: str | None = None,
) -> dict[str, Any]:
    """Create named_only entity if missing; never overwrite deeper packs."""
    existing = get_entity(workspace, asset_root_id, kind, entity_id)
    if existing is not None:
        return {"created": False, "entity": existing}
    payload: dict[str, Any] = {
        "parse_state": "named_only",
        "evidence_gap": False,
        "first_reason": reason or "ensure_stub",
    }
    if kind == "location" and title:
        payload["title"] = title
    elif kind == "npc":
        payload["names"] = [title] if title else [entity_id]
    elif title:
        payload["label"] = title
    put_entity(workspace, asset_root_id, kind, entity_id, payload)
    entity = get_entity(workspace, asset_root_id, kind, entity_id)
    _record_mention(workspace, asset_root_id, kind, entity_id, reason=reason)
    return {"created": True, "entity": entity}


def enqueue_job(
    workspace: Path,
    asset_root_id: str,
    *,
    kind: str,
    target_id: str,
    priority: int = 50,
    reason: str = "",
) -> dict[str, Any]:
    if kind not in JOB_KINDS:
        raise ModuleAssetsError(f"unknown job kind {kind!r}")
    tid = _require_id(target_id, "target_id")
    path = _module_dir(workspace, asset_root_id) / "parse-queue.json"
    if not path.is_file():
        raise ModuleAssetsError("init_module_root before enqueue_job")
    queue = json.loads(path.read_text(encoding="utf-8"))
    pending = list(queue.get("pending") or [])
    for job in pending:
        if job.get("kind") == kind and job.get("target_id") == tid:
            kick: dict[str, Any] | None = None
            try:
                worker = _load_sibling(
                    "coc_module_queue_worker_from_assets",
                    "coc_module_queue_worker.py",
                )
                kick = worker.kick_background_worker(workspace)
            except Exception:  # noqa: BLE001
                kick = {"started": False, "error": "kick_failed"}
            return {
                "enqueued": False,
                "job": job,
                "deduped": True,
                "worker_kick": kick,
            }
    job = {
        "job_id": (
            "job-"
            + hashlib.sha256(f"{kind}:{tid}:{_now_iso()}".encode()).hexdigest()[:12]
        ),
        "kind": kind,
        "target_id": tid,
        "priority": int(priority),
        "reason": str(reason or ""),
        "enqueued_at": _now_iso(),
    }
    pending.append(job)
    pending.sort(
        key=lambda item: (-int(item.get("priority") or 0), item.get("enqueued_at") or "")
    )
    queue["pending"] = pending
    queue["schema_version"] = SCHEMA_VERSION
    _write_json(path, queue)
    # Non-blocking: dig/enter must not wait on host PDF. Background worker
    # claims pending jobs in parallel and merges ready packs.
    kick: dict[str, Any] | None = None
    try:
        worker = _load_sibling(
            "coc_module_queue_worker_from_assets", "coc_module_queue_worker.py",
        )
        kick = worker.kick_background_worker(workspace)
    except Exception:  # noqa: BLE001 — enqueue must never fail because of kick
        kick = {"started": False, "error": "kick_failed"}
    return {"enqueued": True, "job": job, "deduped": False, "worker_kick": kick}


def list_queue(workspace: Path, asset_root_id: str) -> dict[str, Any]:
    path = _module_dir(workspace, asset_root_id) / "parse-queue.json"
    if not path.is_file():
        raise ModuleAssetsError("unknown module assets root")
    return json.loads(path.read_text(encoding="utf-8"))


def _record_mention(
    workspace: Path,
    asset_root_id: str,
    kind: str,
    entity_id: str,
    *,
    reason: str | None,
) -> None:
    path = _module_dir(workspace, asset_root_id) / "mentions-index.json"
    if not path.is_file():
        return
    index = json.loads(path.read_text(encoding="utf-8"))
    entities = index.setdefault("entities", {})
    key = f"{kind}:{entity_id}"
    if key not in entities:
        entities[key] = {
            "first_seen": reason or "ensure_stub",
            "first_reason": reason or "ensure_stub",
            "refs": [],
        }
        _write_json(path, index)


def note_parse_tier(workspace: Path, asset_root_id: str, tier: int) -> None:
    """Raise registry parse_tier_max for this asset root (monotonic)."""
    registry = load_registry(workspace)
    entry = (registry.get("modules") or {}).get(asset_root_id)
    if not entry:
        return
    entry["parse_tier_max"] = max(int(entry.get("parse_tier_max") or 0), int(tier))
    entry["updated_at"] = _now_iso()
    save_registry(workspace, registry)


def _bump_parse_tier(workspace: Path, asset_root_id: str, tier: int) -> None:
    note_parse_tier(workspace, asset_root_id, tier)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Progressive module-assets store")
    parser.add_argument("--workspace", default=".")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("init")
    p.add_argument("--asset-root-id", required=True)
    p.add_argument("--file-sha256", required=True)
    p.add_argument("--identity-json", default="{}")

    p = sub.add_parser("lookup")
    p.add_argument("--file-sha256", required=True)

    p = sub.add_parser("put-skeleton")
    p.add_argument("--asset-root-id", required=True)
    p.add_argument("--skeleton-json", required=True)

    p = sub.add_parser("get-skeleton")
    p.add_argument("--asset-root-id", required=True)

    p = sub.add_parser("put-page")
    p.add_argument("--asset-root-id", required=True)
    p.add_argument("--pdf-index", type=int, required=True)
    p.add_argument("--text-file", required=True)

    p = sub.add_parser("ensure-stub")
    p.add_argument("--asset-root-id", required=True)
    p.add_argument("--kind", required=True, choices=sorted(ENTITY_KINDS))
    p.add_argument("--entity-id", required=True)
    p.add_argument("--title", default="")
    p.add_argument("--reason", default="")

    p = sub.add_parser("enqueue")
    p.add_argument("--asset-root-id", required=True)
    p.add_argument("--kind", required=True, choices=sorted(JOB_KINDS))
    p.add_argument("--target-id", required=True)
    p.add_argument("--priority", type=int, default=50)
    p.add_argument("--reason", default="")

    p = sub.add_parser("queue")
    p.add_argument("--asset-root-id", required=True)

    args = parser.parse_args(argv)
    ws = Path(args.workspace).resolve()
    try:
        if args.cmd == "init":
            identity = json.loads(args.identity_json)
            path = init_module_root(
                ws,
                asset_root_id=args.asset_root_id,
                identity=identity if isinstance(identity, dict) else {},
                file_sha256=args.file_sha256,
            )
            print(json.dumps({"ok": True, "path": str(path)}, ensure_ascii=False))
        elif args.cmd == "lookup":
            print(json.dumps(
                {"ok": True, "entry": lookup_by_sha256(ws, args.file_sha256)},
                ensure_ascii=False,
            ))
        elif args.cmd == "put-skeleton":
            skeleton = json.loads(Path(args.skeleton_json).read_text(encoding="utf-8"))
            result = put_skeleton(ws, args.asset_root_id, skeleton)
            print(json.dumps({"ok": True, **result}, ensure_ascii=False))
        elif args.cmd == "get-skeleton":
            print(json.dumps(
                {"ok": True, "skeleton": get_skeleton(ws, args.asset_root_id)},
                ensure_ascii=False,
            ))
        elif args.cmd == "put-page":
            text = Path(args.text_file).read_text(encoding="utf-8")
            result = put_page(ws, args.asset_root_id, args.pdf_index, text)
            print(json.dumps({"ok": True, **result}, ensure_ascii=False))
        elif args.cmd == "ensure-stub":
            result = ensure_stub(
                ws, args.asset_root_id, args.kind, args.entity_id,
                title=args.title or None, reason=args.reason or None,
            )
            print(json.dumps({"ok": True, **result}, ensure_ascii=False))
        elif args.cmd == "enqueue":
            result = enqueue_job(
                ws, args.asset_root_id, kind=args.kind, target_id=args.target_id,
                priority=args.priority, reason=args.reason,
            )
            print(json.dumps({"ok": True, **result}, ensure_ascii=False))
        elif args.cmd == "queue":
            print(json.dumps(
                {"ok": True, "queue": list_queue(ws, args.asset_root_id)},
                ensure_ascii=False,
            ))
        else:
            return 1
        return 0
    except (ModuleAssetsError, OSError, json.JSONDecodeError, TypeError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
