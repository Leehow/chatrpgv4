#!/usr/bin/env python3
"""Background parallel worker for progressive parse-queue jobs.

Design (product):
- Dig / enter / clue-follow only **enqueue** and return immediately.
- Deep pack extraction is host-owned; this worker never invents secret/handout
  bodies and does not OCR/parse PDF bytes.
- Worker runs **out of band**: claim jobs into ``in_flight``, process in a
  thread pool, merge ready packs into campaigns, write host-work requests for
  still-missing packs, then exit after idle.

See docs/active-plans/coc-on-demand-module-skeleton.md slice 7–8.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
WORKER_PID_NAME = "queue-worker.pid"
WORKER_LOG_NAME = "queue-worker.log"
HOST_WORK_DIR = "host-work"
DEFAULT_PARALLEL = 4
DEFAULT_IDLE_EXIT_S = 45.0
DEFAULT_STALE_IN_FLIGHT_S = 30.0
DEFAULT_POLL_S = 0.4


def _load_sibling(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPT_DIR / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_fileio = _load_sibling("coc_fileio_queue_worker", "coc_fileio.py")
coc_module_assets = _load_sibling("coc_module_assets_queue_worker", "coc_module_assets.py")
coc_module_project = _load_sibling("coc_module_project_queue_worker", "coc_module_project.py")
coc_compiled_archive = _load_sibling(
    "coc_compiled_archive_queue_worker", "coc_compiled_archive.py"
)
coc_state = _load_sibling("coc_state_queue_worker", "coc_state.py")


class QueueWorkerError(ValueError):
    """Background queue worker failed."""


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _now_ts() -> float:
    return time.time()


def _write_json(path: Path, payload: Any) -> None:
    coc_fileio.write_json_atomic(
        path, payload, indent=2, ensure_ascii=False, trailing_newline=True,
    )


def _queue_path(workspace: Path, asset_root_id: str) -> Path:
    return coc_module_assets.assets_root(workspace) / asset_root_id / "parse-queue.json"


def _lock_path(workspace: Path, asset_root_id: str) -> Path:
    return coc_module_assets.assets_root(workspace) / asset_root_id / "parse-queue.lock"


def _worker_dir(workspace: Path) -> Path:
    d = coc_module_assets.assets_root(workspace) / "_worker"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _read_queue(workspace: Path, asset_root_id: str) -> dict[str, Any]:
    path = _queue_path(workspace, asset_root_id)
    if not path.is_file():
        return {
            "schema_version": coc_module_assets.SCHEMA_VERSION,
            "pending": [],
            "in_flight": [],
            "done": [],
        }
    return json.loads(path.read_text(encoding="utf-8"))


def _write_queue(workspace: Path, asset_root_id: str, queue: dict[str, Any]) -> None:
    queue = dict(queue)
    queue["schema_version"] = coc_module_assets.SCHEMA_VERSION
    queue.setdefault("pending", [])
    queue.setdefault("in_flight", [])
    queue.setdefault("done", [])
    _write_json(_queue_path(workspace, asset_root_id), queue)


def list_asset_roots_with_work(workspace: Path) -> list[str]:
    root = coc_module_assets.assets_root(workspace)
    if not root.is_dir():
        return []
    out: list[str] = []
    for child in sorted(root.iterdir()):
        if not child.is_dir() or child.name.startswith("_"):
            continue
        qpath = child / "parse-queue.json"
        if not qpath.is_file():
            continue
        try:
            q = json.loads(qpath.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        pending = q.get("pending") or []
        inflight = q.get("in_flight") or []
        if pending or inflight:
            out.append(child.name)
    return out


def campaigns_using_asset(workspace: Path, asset_root_id: str) -> list[str]:
    """Find campaigns whose progressive projection is bound to this asset root."""
    camps_root = coc_state.coc_root(Path(workspace).resolve()) / "campaigns"
    if not camps_root.is_dir():
        return []
    found: list[str] = []
    for camp in sorted(camps_root.iterdir()):
        if not camp.is_dir():
            continue
        sc = camp / "scenario" / "scenario.json"
        if not sc.is_file():
            continue
        try:
            data = json.loads(sc.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if str(data.get("progressive_asset_root_id") or "") == asset_root_id:
            found.append(camp.name)
    return found


def requeue_stale_in_flight(
    workspace: Path,
    asset_root_id: str,
    *,
    stale_after_s: float = DEFAULT_STALE_IN_FLIGHT_S,
) -> int:
    """Return timed-out in_flight jobs to pending (crash recovery)."""
    lock = _lock_path(workspace, asset_root_id)
    lock.parent.mkdir(parents=True, exist_ok=True)
    moved = 0
    with coc_fileio.advisory_file_lock(lock):
        queue = _read_queue(workspace, asset_root_id)
        pending = list(queue.get("pending") or [])
        inflight = list(queue.get("in_flight") or [])
        keep: list[dict[str, Any]] = []
        now = _now_ts()
        for job in inflight:
            claimed = float(job.get("claimed_at_ts") or 0)
            if claimed and (now - claimed) > float(stale_after_s):
                job = dict(job)
                job.pop("worker_id", None)
                job.pop("claimed_at", None)
                job.pop("claimed_at_ts", None)
                job["requeued_at"] = _now_iso()
                job["requeue_reason"] = "stale_in_flight"
                job["requeue_count"] = int(job.get("requeue_count") or 0) + 1
                pending.append(job)
                moved += 1
            else:
                keep.append(job)
        if moved:
            pending.sort(
                key=lambda item: (
                    -int(item.get("priority") or 0),
                    item.get("enqueued_at") or "",
                )
            )
            queue["pending"] = pending
            queue["in_flight"] = keep
            _write_queue(workspace, asset_root_id, queue)
    return moved


def claim_jobs(
    workspace: Path,
    asset_root_id: str,
    *,
    limit: int = 1,
    worker_id: str,
) -> list[dict[str, Any]]:
    """Atomically move up to ``limit`` pending jobs into in_flight."""
    if limit <= 0:
        return []
    lock = _lock_path(workspace, asset_root_id)
    lock.parent.mkdir(parents=True, exist_ok=True)
    claimed: list[dict[str, Any]] = []
    with coc_fileio.advisory_file_lock(lock):
        queue = _read_queue(workspace, asset_root_id)
        pending = list(queue.get("pending") or [])
        inflight = list(queue.get("in_flight") or [])
        # highest priority first (enqueue already sorts; re-sort defensively)
        pending.sort(
            key=lambda item: (
                -int(item.get("priority") or 0),
                item.get("enqueued_at") or "",
            )
        )
        take = pending[: int(limit)]
        rest = pending[int(limit) :]
        now_iso = _now_iso()
        now_ts = _now_ts()
        for job in take:
            j = dict(job)
            j["worker_id"] = worker_id
            j["claimed_at"] = now_iso
            j["claimed_at_ts"] = now_ts
            inflight.append(j)
            claimed.append(j)
        queue["pending"] = rest
        queue["in_flight"] = inflight
        _write_queue(workspace, asset_root_id, queue)
    return claimed


def _finish_job(
    workspace: Path,
    asset_root_id: str,
    job: dict[str, Any],
    *,
    result: str,
    detail: dict[str, Any] | None = None,
    failed: bool = False,
) -> None:
    lock = _lock_path(workspace, asset_root_id)
    with coc_fileio.advisory_file_lock(lock):
        queue = _read_queue(workspace, asset_root_id)
        jid = str(job.get("job_id") or "")
        inflight = [
            j for j in (queue.get("in_flight") or [])
            if str(j.get("job_id") or "") != jid
        ]
        done = [
            row for row in (queue.get("done") or [])
            if str(row.get("job_id") or "") != jid
        ]
        completed_at = _now_iso()
        row = {
            **{k: v for k, v in job.items() if k not in {"worker_id", "claimed_at_ts"}},
            "completed_at": completed_at,
            "result": result,
            "failed": bool(failed),
        }
        try:
            enqueued_at = datetime.fromisoformat(str(job.get("enqueued_at")))
            completed_dt = datetime.fromisoformat(completed_at)
            row["total_ms"] = max(
                0, round((completed_dt - enqueued_at).total_seconds() * 1000)
            )
            if job.get("claimed_at"):
                claimed_at = datetime.fromisoformat(str(job["claimed_at"]))
                row["queue_wait_ms"] = max(
                    0, round((claimed_at - enqueued_at).total_seconds() * 1000)
                )
                row["processing_ms"] = max(
                    0, round((completed_dt - claimed_at).total_seconds() * 1000)
                )
        except (TypeError, ValueError):
            # Legacy/manual jobs may not carry valid timestamps.  Completion
            # still succeeds; unavailable timing stays explicitly absent.
            pass
        if detail:
            row["detail"] = detail
        done.append(row)
        queue["in_flight"] = inflight
        queue["done"] = coc_module_assets.dedupe_done_jobs(done, limit=200)
        _write_queue(workspace, asset_root_id, queue)


def _is_pack_ready(pack: dict[str, Any] | None, *, allow_partial: bool = False) -> bool:
    if not pack:
        return False
    state = str(pack.get("parse_state") or "")
    if pack.get("evidence_gap"):
        return False
    if state == "deep":
        return True
    if allow_partial and state in {"partial", "body_parsed"}:
        return True
    return False


def _target_source_scope(
    workspace: Path,
    asset_root_id: str,
    skeleton: dict[str, Any],
    entity_kind: str | None,
    target_id: str,
) -> dict[str, Any]:
    collection_and_key = {
        "location": ("locations", "location_id"),
        "npc": ("npc_roster", "npc_id"),
        "handout": ("handouts", "handout_id"),
        "threat": ("threats", "threat_id"),
    }.get(entity_kind or "")
    scopes: list[dict[str, Any]] = []
    if collection_and_key is not None:
        collection, key = collection_and_key
        for row in skeleton.get(collection) or []:
            if isinstance(row, dict) and str(row.get(key) or "") == target_id:
                scopes.append(row)
                break

    # The named-only entity is the canonical accumulation point for later
    # structured mentions.  A skeleton profile page and scene-context pages
    # are complementary evidence, so the host handoff must consume their
    # exact union instead of stopping at the first skeleton match.
    if entity_kind:
        target_pack = coc_module_assets.get_entity(
            workspace, asset_root_id, entity_kind, target_id,
        )
        if isinstance(target_pack, dict):
            scopes.append(target_pack)

    requested_indices: set[int] = set()
    for position, scope in enumerate(scopes):
        requested_indices.update(
            coc_module_assets._source_indices(
                scope,
                field=f"host_work.{entity_kind or 'entity'}.scope[{position}]",
            )
        )
    if not requested_indices:
        return {}
    # Keep disjoint evidence exact.  Reconstructing a min/max span here would
    # silently request unrelated intervening PDF pages.
    return {"source_page_indices": sorted(requested_indices)}


def _cached_page_refs(
    workspace: Path,
    asset_root_id: str,
    *,
    requested_indices: list[int],
) -> list[dict[str, Any]]:
    module_root = coc_module_assets.assets_root(workspace) / asset_root_id
    if requested_indices:
        candidate_indices = requested_indices
    else:
        candidate_indices = sorted(
            int(path.stem)
            for path in (module_root / "pages").glob("*.md")
            if path.stem.isdigit()
        )[:64]
    refs: list[dict[str, Any]] = []
    for pdf_index in candidate_indices:
        page = coc_module_assets.get_page(workspace, asset_root_id, pdf_index)
        if page is None:
            continue
        meta = page.get("meta") if isinstance(page.get("meta"), dict) else {}
        refs.append({
            "source_id": meta.get("source_id"),
            "pdf_index": pdf_index,
            "path": str(module_root / "pages" / f"{pdf_index:04d}.md"),
            "text_sha256": meta.get("text_sha256"),
            "bundle_sha256s": list(meta.get("bundle_sha256s") or []),
            "review_state": meta.get("review_state"),
            "parse_confidence": meta.get("parse_confidence"),
            "grep_anchors": list(meta.get("grep_anchors") or []),
        })
    return refs


def _write_host_work_request(
    workspace: Path,
    asset_root_id: str,
    job: dict[str, Any],
) -> Path:
    """Durable handoff for host PDF skill / external fulfillers (not free prose scan)."""
    root = coc_module_assets.assets_root(workspace) / asset_root_id
    work_dir = root / HOST_WORK_DIR
    work_dir.mkdir(parents=True, exist_ok=True)
    jid = str(job.get("job_id") or f"job-{int(_now_ts())}")
    path = work_dir / f"{jid}.json"
    identity = {}
    id_path = root / "identity.json"
    if id_path.is_file():
        try:
            identity = json.loads(id_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            identity = {}
    skeleton = coc_module_assets.get_skeleton(workspace, asset_root_id) or {}
    source = (skeleton.get("source") or {}) if isinstance(skeleton, dict) else {}
    entity_kind = coc_module_assets._job_entity_kind(str(job.get("kind") or ""))
    target_id = str(job.get("target_id") or "")
    requested_scope = _target_source_scope(
        workspace, asset_root_id, skeleton, entity_kind, target_id,
    )
    requested_indices = (
        coc_module_assets._source_indices(
            requested_scope,
            field=f"host_work.{entity_kind or 'entity'}",
        )
        if requested_scope
        else []
    )
    cached_page_refs = _cached_page_refs(
        workspace,
        asset_root_id,
        requested_indices=requested_indices,
    )
    pages = sorted((root / "pages").glob("*.md")) if (root / "pages").is_dir() else []
    cached_indices = {int(row["pdf_index"]) for row in cached_page_refs}
    scope_complete = (
        set(requested_indices) <= cached_indices if requested_indices else None
    )
    payload = {
        "schema_version": 1,
        "job_id": jid,
        "asset_root_id": asset_root_id,
        "kind": job.get("kind"),
        "target_id": job.get("target_id"),
        "priority": job.get("priority"),
        "reason": job.get("reason"),
        "created_at": _now_iso(),
        "source_pdf": source.get("path") or (identity.get("source") or {}).get("path"),
        "source_id": source.get("source_id") or (identity.get("source") or {}).get("source_id"),
        "file_sha256": source.get("file_sha256") or identity.get("file_sha256"),
        "pages_cached": [p.name for p in pages[:64]],
        "requested_source_scope": requested_scope,
        "requested_pdf_indices": requested_indices,
        "cached_page_refs": cached_page_refs,
        "cached_scope_complete": scope_complete,
        "instruction": (
            "Host PDF skill: read cached_page_refs first. If cached_scope_complete "
            "is true, do not reopen the PDF for this scope. Extract only a "
            "reusable partial neighbor pack; register a new validated source "
            "bundle window only for missing pdf_indices. Submit the semantic "
            "pack through progressive.fulfill_host_work with parse_state=partial and "
            "evidence_gap=false, source_page_indices, host_work_job_id equal "
            "to this request's job_id, and host_timing."
            if str(job.get("kind") or "") == "partial_neighbor"
            else
            "Host PDF skill: read cached_page_refs first. If cached_scope_complete "
            "is true, do not reopen the PDF for this scope. Register a new "
            "validated source bundle window only for missing pdf_indices, then "
            "deep-extract this entity once into a reusable entity pack. Submit it "
            "through progressive.fulfill_host_work with parse_state=deep and "
            "evidence_gap=false, source_page_indices, host_work_job_id equal "
            "to this request's job_id, and host_timing; later "
            "questions must query that pack rather than reopen the same PDF "
            "scope. Do not invent handout/secret bodies without page evidence."
        ),
    }
    _write_json(path, payload)
    return path


def process_claimed_job(
    workspace: Path,
    asset_root_id: str,
    job: dict[str, Any],
) -> dict[str, Any]:
    """Process one in_flight job (merge if ready, else host-work request)."""
    kind = str(job.get("kind") or "")
    tid = str(job.get("target_id") or "")
    detail: dict[str, Any] = {"kind": kind, "target_id": tid}
    try:
        if kind in {"deepen_location", "partial_neighbor"}:
            pack = coc_module_assets.get_entity(
                workspace, asset_root_id, "location", tid,
            )
            allow_partial = kind == "partial_neighbor"
            if _is_pack_ready(pack, allow_partial=allow_partial):
                # Merge directly — job is in_flight, not pending, so
                # process_ready_deepens (pending-only) would miss it.
                camps = campaigns_using_asset(workspace, asset_root_id)
                merged_for: list[str] = []
                for camp_id in camps:
                    try:
                        camp_dir = coc_state.coc_root(Path(workspace).resolve()) / "campaigns" / camp_id
                        with coc_fileio.advisory_file_lock(
                            camp_dir / ".progressive-ir.lock", wait_seconds=15.0,
                        ):
                            ir = coc_module_project.load_campaign_ir(camp_dir)
                            ir = coc_module_project.merge_deep_location_into_ir(ir, pack)
                            # IR write + archive publish; archive failure never
                            # rolls back canonical IR (status recorded instead).
                            coc_module_project.write_ir_to_campaign(
                                camp_dir, ir, asset_root_id=asset_root_id,
                            )
                            archive = coc_compiled_archive.load_status(camp_dir) or {}
                            detail.setdefault("archive_status", {})[camp_id] = {
                                "status": archive.get("status"),
                                "archive_revision": archive.get("archive_revision"),
                                "error": archive.get("error"),
                            }
                        merged_for.append(camp_id)
                    except Exception as exc:  # noqa: BLE001
                        detail.setdefault("campaign_errors", {})[camp_id] = str(exc)
                detail["merged_campaigns"] = merged_for
                detail["parse_state"] = (pack or {}).get("parse_state")
                result_name = "merged" if merged_for else "pack_ready_no_campaign"
                detail["result"] = result_name
                _finish_job(
                    workspace, asset_root_id, job,
                    result=result_name,
                    detail=detail,
                )
                return {"ok": True, "result": result_name, **detail}

            req = _write_host_work_request(workspace, asset_root_id, job)
            detail["host_work_request"] = str(req)
            # Not failed: host must fulfill; leave a done marker so pending does
            # not spin. put_entity kick re-enqueues merge when pack lands.
            _finish_job(
                workspace, asset_root_id, job,
                result="awaiting_host_pack",
                detail=detail,
            )
            return {"ok": True, "result": "awaiting_host_pack", **detail}

        if kind in {
            "deepen_npc", "deepen_clue", "deepen_handout", "deepen_threat",
        }:
            entity_kind = {
                "deepen_npc": "npc",
                "deepen_clue": "clue",
                "deepen_handout": "handout",
                "deepen_threat": "threat",
            }[kind]
            pack = coc_module_assets.get_entity(
                workspace, asset_root_id, entity_kind, tid,
            )
            if _is_pack_ready(pack):
                # Handouts are delivered from the asset store by their normal
                # consumer. NPCs, clues, and threats must enter the campaign
                # IR used by live scene/NPC/Director queries.
                if entity_kind == "handout":
                    _finish_job(
                        workspace, asset_root_id, job,
                        result="entity_ready",
                        detail={"entity_kind": entity_kind, "target_id": tid},
                    )
                    return {
                        "ok": True,
                        "result": "entity_ready",
                        "target_id": tid,
                    }
                camps = campaigns_using_asset(workspace, asset_root_id)
                merged_for: list[str] = []
                for camp_id in camps:
                    try:
                        camp_dir = (
                            coc_state.coc_root(Path(workspace).resolve())
                            / "campaigns" / camp_id
                        )
                        with coc_fileio.advisory_file_lock(
                            camp_dir / ".progressive-ir.lock", wait_seconds=15.0,
                        ):
                            ir = coc_module_project.load_campaign_ir(camp_dir)
                            ir = coc_module_project.merge_deep_entity_into_ir(
                                ir, entity_kind, pack,
                            )
                            coc_module_project.write_ir_to_campaign(
                                camp_dir, ir, asset_root_id=asset_root_id,
                            )
                            archive = coc_compiled_archive.load_status(camp_dir) or {}
                            detail.setdefault("archive_status", {})[camp_id] = {
                                "status": archive.get("status"),
                                "archive_revision": archive.get("archive_revision"),
                                "error": archive.get("error"),
                            }
                        merged_for.append(camp_id)
                    except Exception as exc:  # noqa: BLE001
                        detail.setdefault("campaign_errors", {})[camp_id] = str(exc)
                detail.update({
                    "entity_kind": entity_kind,
                    "merged_campaigns": merged_for,
                    "parse_state": (pack or {}).get("parse_state"),
                })
                result_name = "merged" if merged_for else "pack_ready_no_campaign"
                _finish_job(
                    workspace, asset_root_id, job,
                    result=result_name,
                    detail=detail,
                )
                return {"ok": True, "result": result_name, **detail}
            req = _write_host_work_request(workspace, asset_root_id, job)
            detail["entity_kind"] = entity_kind
            detail["host_work_request"] = str(req)
            _finish_job(
                workspace, asset_root_id, job,
                result="awaiting_host_pack",
                detail=detail,
            )
            return {"ok": True, "result": "awaiting_host_pack", **detail}

        # Unknown kinds: complete without blocking the queue forever.
        _finish_job(
            workspace, asset_root_id, job,
            result="skipped_unknown_kind",
            detail=detail,
        )
        return {"ok": True, "result": "skipped_unknown_kind", **detail}
    except Exception as exc:  # noqa: BLE001 — worker must isolate per-job failures
        _finish_job(
            workspace, asset_root_id, job,
            result="error",
            detail={"error": str(exc)},
            failed=True,
        )
        return {"ok": False, "error": str(exc), **detail}


def reenqueue_merge_for_entity(
    workspace: Path,
    asset_root_id: str,
    *,
    kind: str,
    target_id: str,
    reason: str = "pack_ready",
) -> dict[str, Any]:
    """After host put_entity deep, enqueue a high-priority merge job and kick worker."""
    job_kind = coc_module_assets.deepen_job_kind(kind)
    enq = coc_module_assets.enqueue_job(
        workspace,
        asset_root_id,
        kind=job_kind,
        target_id=target_id,
        priority=100,
        reason=reason,
    )
    kick = kick_background_worker(workspace)
    return {"enqueue": enq, "kick": kick}


def run_worker_once(
    workspace: Path,
    *,
    parallel: int = DEFAULT_PARALLEL,
    stale_after_s: float = DEFAULT_STALE_IN_FLIGHT_S,
) -> dict[str, Any]:
    """Single drain pass over all asset roots (parallel per batch)."""
    ws = Path(workspace).resolve()
    roots = list_asset_roots_with_work(ws)
    # Also requeue stale on every known module root with a queue file
    assets_root = coc_module_assets.assets_root(ws)
    if assets_root.is_dir():
        for child in assets_root.iterdir():
            if child.is_dir() and (child / "parse-queue.json").is_file():
                if child.name not in roots:
                    # still requeue stale
                    pass
                requeue_stale_in_flight(
                    ws, child.name, stale_after_s=stale_after_s,
                )
                if child.name not in roots:
                    q = _read_queue(ws, child.name)
                    if q.get("pending") or q.get("in_flight"):
                        roots.append(child.name)

    worker_id = f"worker-{os.getpid()}-{int(_now_ts() * 1000) % 100000}"
    claimed_all: list[tuple[str, dict[str, Any]]] = []
    per_root = max(1, int(parallel))
    for root_id in roots:
        requeue_stale_in_flight(ws, root_id, stale_after_s=stale_after_s)
        batch = claim_jobs(
            ws, root_id, limit=per_root, worker_id=worker_id,
        )
        for job in batch:
            claimed_all.append((root_id, job))

    results: list[dict[str, Any]] = []
    if not claimed_all:
        return {
            "claimed": 0,
            "results": [],
            "roots": roots,
            "worker_id": worker_id,
        }

    with ThreadPoolExecutor(max_workers=max(1, int(parallel))) as pool:
        futs = {
            pool.submit(process_claimed_job, ws, root_id, job): (root_id, job)
            for root_id, job in claimed_all
        }
        for fut in as_completed(futs):
            root_id, job = futs[fut]
            try:
                res = fut.result()
            except Exception as exc:  # noqa: BLE001
                res = {"ok": False, "error": str(exc)}
            results.append({
                "asset_root_id": root_id,
                "job_id": job.get("job_id"),
                "target_id": job.get("target_id"),
                "kind": job.get("kind"),
                **res,
            })

    return {
        "claimed": len(claimed_all),
        "results": results,
        "roots": roots,
        "worker_id": worker_id,
    }


def run_worker_loop(
    workspace: Path,
    *,
    parallel: int = DEFAULT_PARALLEL,
    poll_s: float = DEFAULT_POLL_S,
    idle_exit_s: float = DEFAULT_IDLE_EXIT_S,
    stale_after_s: float = DEFAULT_STALE_IN_FLIGHT_S,
) -> dict[str, Any]:
    """Poll until idle for ``idle_exit_s`` then exit (daemon-friendly)."""
    ws = Path(workspace).resolve()
    idle_started: float | None = None
    passes = 0
    total_claimed = 0
    while True:
        passes += 1
        out = run_worker_once(
            ws, parallel=parallel, stale_after_s=stale_after_s,
        )
        claimed = int(out.get("claimed") or 0)
        total_claimed += claimed
        if claimed == 0:
            if idle_started is None:
                idle_started = _now_ts()
            elif (_now_ts() - idle_started) >= float(idle_exit_s):
                return {
                    "stopped": "idle",
                    "passes": passes,
                    "total_claimed": total_claimed,
                }
        else:
            idle_started = None
        time.sleep(max(0.05, float(poll_s)))


def _pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def worker_status(workspace: Path) -> dict[str, Any]:
    ws = Path(workspace).resolve()
    pid_path = _worker_dir(ws) / WORKER_PID_NAME
    if not pid_path.is_file():
        return {"running": False, "pid": None}
    try:
        pid = int(pid_path.read_text(encoding="utf-8").strip().splitlines()[0])
    except (OSError, ValueError):
        return {"running": False, "pid": None, "pid_file_corrupt": True}
    alive = _pid_alive(pid)
    if not alive:
        try:
            pid_path.unlink()
        except OSError:
            pass
        return {"running": False, "pid": pid, "stale_pid_file_removed": True}
    return {"running": True, "pid": pid, "pid_file": str(pid_path)}


def kick_background_worker(
    workspace: Path,
    *,
    parallel: int = DEFAULT_PARALLEL,
    idle_exit_s: float = DEFAULT_IDLE_EXIT_S,
    poll_s: float = DEFAULT_POLL_S,
) -> dict[str, Any]:
    """Non-blocking: start a detached worker process if none is alive.

    Play/dig paths must only call this and return — never wait on host PDF.
    """
    if os.environ.get("COC_DISABLE_QUEUE_WORKER", "").strip().lower() in {
        "1", "true", "yes", "on",
    }:
        return {
            "started": False,
            "already_running": False,
            "disabled": True,
            "reason": "COC_DISABLE_QUEUE_WORKER",
        }
    ws = Path(workspace).resolve()
    status = worker_status(ws)
    if status.get("running"):
        return {"started": False, "already_running": True, **status}

    wdir = _worker_dir(ws)
    pid_path = wdir / WORKER_PID_NAME
    log_path = wdir / WORKER_LOG_NAME
    script = SCRIPT_DIR / "coc_module_queue_worker.py"
    cmd = [
        sys.executable,
        str(script),
        "--workspace",
        str(ws),
        "run",
        "--parallel",
        str(max(1, int(parallel))),
        "--poll",
        str(float(poll_s)),
        "--idle-exit",
        str(float(idle_exit_s)),
        "--write-pid",
        str(pid_path),
    ]
    log_f = open(log_path, "a", encoding="utf-8")  # noqa: SIM115 — detached child owns lifetime
    try:
        proc = subprocess.Popen(
            cmd,
            stdin=subprocess.DEVNULL,
            stdout=log_f,
            stderr=subprocess.STDOUT,
            start_new_session=True,
            cwd=str(ws),
        )
    finally:
        # Parent closes its fd; child keeps the dup.
        try:
            log_f.close()
        except OSError:
            pass
    # Best-effort pid file if child has not written yet
    try:
        if not pid_path.is_file():
            pid_path.write_text(f"{proc.pid}\n", encoding="utf-8")
    except OSError:
        pass
    return {
        "started": True,
        "already_running": False,
        "pid": proc.pid,
        "log_file": str(log_path),
        "cmd": cmd,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Background parallel progressive parse-queue worker",
    )
    parser.add_argument("--workspace", default=".")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("run", help="run worker loop until idle")
    p.add_argument("--parallel", type=int, default=DEFAULT_PARALLEL)
    p.add_argument("--poll", type=float, default=DEFAULT_POLL_S)
    p.add_argument("--idle-exit", type=float, default=DEFAULT_IDLE_EXIT_S)
    p.add_argument("--stale-after", type=float, default=DEFAULT_STALE_IN_FLIGHT_S)
    p.add_argument("--write-pid", default="", help="path to pid file")

    p = sub.add_parser("once", help="single parallel drain pass")
    p.add_argument("--parallel", type=int, default=DEFAULT_PARALLEL)
    p.add_argument("--stale-after", type=float, default=DEFAULT_STALE_IN_FLIGHT_S)

    p = sub.add_parser("kick", help="non-blocking start detached worker")
    p.add_argument("--parallel", type=int, default=DEFAULT_PARALLEL)
    p.add_argument("--idle-exit", type=float, default=DEFAULT_IDLE_EXIT_S)

    p = sub.add_parser("status", help="is detached worker running?")

    args = parser.parse_args(argv)
    ws = Path(args.workspace).resolve()
    try:
        if args.cmd == "run":
            if args.write_pid:
                Path(args.write_pid).write_text(f"{os.getpid()}\n", encoding="utf-8")
            result = run_worker_loop(
                ws,
                parallel=args.parallel,
                poll_s=args.poll,
                idle_exit_s=args.idle_exit,
                stale_after_s=args.stale_after,
            )
            if args.write_pid:
                try:
                    Path(args.write_pid).unlink()
                except OSError:
                    pass
        elif args.cmd == "once":
            result = run_worker_once(
                ws, parallel=args.parallel, stale_after_s=args.stale_after,
            )
        elif args.cmd == "kick":
            result = kick_background_worker(
                ws, parallel=args.parallel, idle_exit_s=args.idle_exit,
            )
        elif args.cmd == "status":
            result = worker_status(ws)
        else:
            return 1
        print(json.dumps({"ok": True, **result}, ensure_ascii=False, default=str))
        return 0
    except (QueueWorkerError, OSError, json.JSONDecodeError, ValueError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
