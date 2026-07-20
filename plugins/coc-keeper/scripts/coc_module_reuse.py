#!/usr/bin/env python3
"""Progressive module-assets reuse + queue processing (slices 6–7).

- Link a durable asset_root to a module-library entry
- Reuse by file_sha256 / asset_root into a new campaign (skip re-extract)
- Process ready deepen jobs on the parse queue (inline worker)

See docs/active-plans/coc-on-demand-module-skeleton.md.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
PROGRESSIVE_LINK_NAME = "progressive-link.json"


def _load_sibling(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPT_DIR / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_fileio = _load_sibling("coc_fileio_module_reuse", "coc_fileio.py")
coc_module_assets = _load_sibling("coc_module_assets_reuse", "coc_module_assets.py")
coc_module_project = _load_sibling("coc_module_project_reuse", "coc_module_project.py")
coc_module_registry = _load_sibling("coc_module_registry_reuse", "coc_module_registry.py")
coc_state = _load_sibling("coc_state_module_reuse", "coc_state.py")


class ModuleReuseError(ValueError):
    """Progressive reuse / queue processing failed."""


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _write_json(path: Path, payload: Any) -> None:
    coc_fileio.write_json_atomic(
        path, payload, indent=2, ensure_ascii=False, trailing_newline=True,
    )


def _workspace_from_coc_root(coc_root: Path) -> Path:
    root = Path(coc_root).resolve()
    return root.parent if root.name == ".coc" else root


def link_library_to_assets(
    workspace: Path,
    *,
    canonical_module_id: str,
    asset_root_id: str,
    file_sha256: str | None = None,
) -> dict[str, Any]:
    """Write progressive-link.json under module-library entry."""
    ws = Path(workspace).resolve()
    cid = str(canonical_module_id or "").strip()
    root_id = str(asset_root_id or "").strip()
    if not cid or not root_id:
        raise ModuleReuseError("canonical_module_id and asset_root_id required")

    # Ensure assets root exists
    sk = coc_module_assets.get_skeleton(ws, root_id)
    identity_path = (
        coc_module_assets.assets_root(ws) / root_id / "identity.json"
    )
    if not identity_path.is_file():
        raise ModuleReuseError(f"unknown module-assets root: {root_id}")

    entry = coc_module_registry._load_entry(ws, cid)
    if entry is None:
        raise ModuleReuseError(f"unknown module-library entry: {cid}")

    digest = file_sha256
    if not digest:
        ident = json.loads(identity_path.read_text(encoding="utf-8"))
        digest = str(ident.get("file_sha256") or "")
    if digest:
        coc_module_assets._require_sha256(digest, "file_sha256")

    link = {
        "schema_version": 1,
        "canonical_module_id": cid,
        "asset_root_id": root_id,
        "file_sha256": digest or None,
        "has_skeleton": sk is not None,
        "linked_at": _now_iso(),
    }
    path = Path(entry["path"]) / PROGRESSIVE_LINK_NAME
    _write_json(path, link)

    # Mirror on registry summary when possible
    registry = coc_module_registry.load_registry(ws)
    modules = registry.setdefault("modules", {})
    if cid in modules and isinstance(modules[cid], dict):
        modules[cid]["progressive_asset_root_id"] = root_id
        if digest:
            modules[cid]["progressive_file_sha256"] = digest
        coc_module_registry._write_registry(ws, registry)

    return {"path": str(path), **link}


def resolve_asset_root(
    workspace: Path,
    *,
    asset_root_id: str | None = None,
    file_sha256: str | None = None,
    canonical_module_id: str | None = None,
) -> dict[str, Any]:
    """Resolve progressive asset root from id, sha, or library link."""
    ws = Path(workspace).resolve()
    if asset_root_id:
        root_id = asset_root_id
        entry = (coc_module_assets.load_registry(ws).get("modules") or {}).get(root_id)
        return {"asset_root_id": root_id, "registry_entry": entry, "via": "asset_root_id"}

    if file_sha256:
        hit = coc_module_assets.lookup_by_sha256(ws, file_sha256)
        if hit:
            return {
                "asset_root_id": hit["asset_root_id"],
                "registry_entry": hit,
                "via": "file_sha256",
            }

    if canonical_module_id:
        entry = coc_module_registry._load_entry(ws, canonical_module_id)
        if entry is None:
            raise ModuleReuseError(f"unknown module-library entry: {canonical_module_id}")
        link_path = Path(entry["path"]) / PROGRESSIVE_LINK_NAME
        if link_path.is_file():
            link = json.loads(link_path.read_text(encoding="utf-8"))
            root_id = str(link.get("asset_root_id") or "").strip()
            if root_id:
                return {
                    "asset_root_id": root_id,
                    "registry_entry": link,
                    "via": "library_link",
                }
        summary = (coc_module_registry.load_registry(ws).get("modules") or {}).get(
            canonical_module_id
        ) or {}
        root_id = str(summary.get("progressive_asset_root_id") or "").strip()
        if root_id:
            return {
                "asset_root_id": root_id,
                "registry_entry": summary,
                "via": "registry_summary",
            }

    raise ModuleReuseError(
        "could not resolve progressive asset root "
        "(need asset_root_id, file_sha256 hit, or library progressive-link)"
    )


def list_deep_location_packs(
    workspace: Path, asset_root_id: str,
) -> list[dict[str, Any]]:
    mod = coc_module_assets.assets_root(workspace) / asset_root_id / "entities"
    if not mod.is_dir():
        return []
    packs: list[dict[str, Any]] = []
    for path in sorted(mod.glob("location-*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if not isinstance(data, dict):
            continue
        if str(data.get("parse_state") or "") in {"deep", "body_parsed"}:
            if not data.get("evidence_gap"):
                packs.append(data)
    return packs


def reuse_into_campaign(
    workspace: Path,
    campaign_id: str,
    *,
    asset_root_id: str | None = None,
    file_sha256: str | None = None,
    canonical_module_id: str | None = None,
    merge_all_deep: bool = True,
) -> dict[str, Any]:
    """Install progressive assets into a campaign without re-extracting PDF.

    Requires existing skeleton in module-assets. Projects skeleton IR, then
    merges every deep location pack (or only start packs if merge_all_deep
    is false — then uses project_opening_deep).
    """
    ws = Path(workspace).resolve()
    resolved = resolve_asset_root(
        ws,
        asset_root_id=asset_root_id,
        file_sha256=file_sha256,
        canonical_module_id=canonical_module_id,
    )
    root_id = resolved["asset_root_id"]
    skeleton = coc_module_assets.get_skeleton(ws, root_id)
    if not skeleton:
        raise ModuleReuseError(
            f"asset root {root_id!r} has no skeleton.json; cannot reuse yet"
        )

    # Ensure campaign exists
    camp = coc_state.coc_root(ws) / "campaigns" / campaign_id
    if not camp.is_dir():
        raise ModuleReuseError(f"unknown campaign: {campaign_id}")

    skeleton_result = coc_module_project.project_skeleton_to_campaign(
        ws, campaign_id, root_id,
    )
    deep_packs = list_deep_location_packs(ws, root_id)
    starts = {str(x) for x in (skeleton.get("start_candidates") or [])}
    start_packs = [
        p for p in deep_packs if str(p.get("location_id") or "") in starts
    ]

    merged: list[str] = []
    if merge_all_deep and deep_packs:
        ir = coc_module_project.load_campaign_ir(camp)
        for pack in deep_packs:
            ir = coc_module_project.merge_deep_location_into_ir(ir, pack)
            merged.append(str(pack.get("location_id")))
        # ensure start affordances like opening-deep
        for sid in starts:
            scene = next(
                (
                    s
                    for s in ir["story-graph.json"]["scenes"]
                    if s.get("scene_id") == sid
                ),
                None,
            )
            if scene and scene.get("scene_type") in {"social", "investigation"}:
                if len(scene.get("affordances") or []) < 2:
                    scene["affordances"] = list(scene.get("affordances") or []) + [
                        {
                            "id": f"{sid}-look",
                            "cue": "Survey the immediate surroundings.",
                            "route_type": "investigative_lead",
                            "status": "open",
                        },
                        {
                            "id": f"{sid}-ask",
                            "cue": "Ask who is present what they know.",
                            "route_type": "npc_question",
                            "status": "open",
                        },
                    ]
        coc_module_project.write_ir_to_campaign(
            camp, ir, asset_root_id=root_id,
        )
        tier = 3 if merged else 1
        coc_module_assets.note_parse_tier(ws, root_id, tier)
        opening = {"merged_location_ids": merged, "parse_tier": tier}
    elif start_packs:
        opening = coc_module_project.project_opening_deep(
            ws, campaign_id, root_id, deep_packs=start_packs,
        )
        merged = list(opening.get("merged_location_ids") or [])
    else:
        opening = {
            "merged_location_ids": [],
            "parse_tier": 1,
            "warning": "no deep packs yet; skeleton topology only",
        }

    return {
        "campaign_id": campaign_id,
        "asset_root_id": root_id,
        "resolved_via": resolved.get("via"),
        "skeleton_scenes": skeleton_result.get("scene_count"),
        "merged_location_ids": merged,
        "deep_pack_count": len(deep_packs),
        "parse_tier": opening.get("parse_tier"),
        "warning": opening.get("warning"),
    }


def process_queue(
    workspace: Path,
    campaign_id: str,
    *,
    asset_root_id: str | None = None,
    max_jobs: int = 32,
    parallel: int = 4,
    background: bool = False,
) -> dict[str, Any]:
    """Process progressive parse-queue jobs for a campaign.

    - Default: kick background parallel workers (non-blocking) **and** do one
      inline merge pass for already-ready packs so the caller sees immediate
      merge results when packs exist.
    - ``background=True``: only kick workers and return (play/dig path).
    """
    ws = Path(workspace).resolve()
    camp = coc_state.coc_root(ws) / "campaigns" / campaign_id
    if not camp.is_dir():
        raise ModuleReuseError(f"unknown campaign: {campaign_id}")
    root_id = asset_root_id or coc_module_project.campaign_asset_root_id(camp)
    if not root_id:
        return {
            "progressive": False,
            "skipped": True,
            "reason": "no progressive asset_root_id on campaign",
        }

    worker = _load_sibling("coc_module_queue_worker_reuse", "coc_module_queue_worker.py")
    kick = worker.kick_background_worker(ws, parallel=max(1, int(parallel)))
    if background:
        return {
            "progressive": True,
            "asset_root_id": root_id,
            "background": True,
            "worker_kick": kick,
            "merged_location_ids": [],
            "pending_remaining": len(
                (coc_module_assets.list_queue(ws, root_id).get("pending") or [])
            ),
            "host_hints": [],
        }

    # Parallel drain once (claim/in_flight).
    once = worker.run_worker_once(ws, parallel=max(1, int(parallel)))
    # Campaign-scoped merge of any deep packs still pending in the queue view,
    # then force-merge every ready deep location pack into this campaign so a
    # just-claimed job cannot be missed (in_flight is not pending).
    applied = coc_module_project.process_ready_deepens(
        ws, campaign_id, asset_root_id=root_id, only_scene_ids=None,
    )
    force_merged: list[str] = []
    try:
        camp_dir = camp
        ir = coc_module_project.load_campaign_ir(camp_dir)
        ent_dir = coc_module_assets.assets_root(ws) / root_id / "entities"
        dirty = False
        if ent_dir.is_dir():
            for path in sorted(ent_dir.glob("location-*.json")):
                try:
                    pack = json.loads(path.read_text(encoding="utf-8"))
                except (OSError, json.JSONDecodeError):
                    continue
                if str(pack.get("parse_state") or "") != "deep" or pack.get("evidence_gap"):
                    continue
                lid = str(pack.get("location_id") or "")
                if not lid:
                    continue
                ir = coc_module_project.merge_deep_location_into_ir(ir, pack)
                force_merged.append(lid)
                dirty = True
        if dirty:
            coc_module_project.write_ir_to_campaign(
                camp_dir, ir, asset_root_id=root_id,
            )
    except Exception:  # noqa: BLE001
        force_merged = []

    # process_ready_deepens may have rewritten the queue. Re-read it once and
    # clear ready neighbor jobs without folding an earlier snapshot back into
    # done: doing so duplicated the full completion history on every play turn.
    queue2 = coc_module_assets.list_queue(ws, root_id)
    pending2 = list(queue2.get("pending") or [])
    done2 = list(queue2.get("done") or [])
    cleared = 0
    # rebuild: drop partial_neighbor that are ready
    still2: list[dict[str, Any]] = []
    for job in pending2:
        kind = job.get("kind")
        tid = str(job.get("target_id") or "")
        if kind == "partial_neighbor" and tid:
            pack = coc_module_assets.get_entity(ws, root_id, "location", tid)
            if pack and str(pack.get("parse_state") or "") in {
                "partial", "deep", "body_parsed",
            }:
                done2.append({**job, "completed_at": _now_iso(), "result": "neighbor_ready"})
                cleared += 1
                continue
        still2.append(job)
    # cap done list
    path = coc_module_assets.assets_root(ws) / root_id / "parse-queue.json"
    _write_json(path, {
        "schema_version": coc_module_assets.SCHEMA_VERSION,
        "pending": still2[: max(0, int(max_jobs) * 4)],
        "in_flight": queue2.get("in_flight") or [],
        "done": coc_module_assets.dedupe_done_jobs(done2, limit=200),
    })

    merged_ids = list(applied.get("merged_location_ids") or [])
    for lid in force_merged:
        if lid not in merged_ids:
            merged_ids.append(lid)
    for row in once.get("results") or []:
        tid = str(row.get("target_id") or "")
        if not tid:
            continue
        if row.get("result") == "merged" and tid not in merged_ids:
            merged_ids.append(tid)
        for camp_name in (row.get("merged_campaigns") or []):
            if camp_name == campaign_id and tid not in merged_ids:
                merged_ids.append(tid)

    return {
        "progressive": True,
        "asset_root_id": root_id,
        "merged_location_ids": merged_ids,
        "neighbor_jobs_cleared": cleared,
        "pending_remaining": len(still2),
        "host_hints": _pending_host_hints(ws, root_id, still2),
        "worker_kick": kick,
        "worker_once": {
            "claimed": once.get("claimed"),
            "results": once.get("results"),
            "worker_id": once.get("worker_id"),
        },
        "background": False,
    }


def _pending_host_hints(
    workspace: Path, asset_root_id: str, pending: list[dict[str, Any]],
) -> list[str]:
    hints: list[str] = []
    for job in pending[:12]:
        if job.get("kind") != "deepen_location":
            continue
        tid = job.get("target_id")
        pack = coc_module_assets.get_entity(workspace, asset_root_id, "location", str(tid))
        if not pack or str(pack.get("parse_state") or "") not in {"deep", "body_parsed"}:
            hints.append(
                f"host: deep-extract location {tid!r} → put_entity parse_state=deep, "
                f"then process-queue"
            )
    return hints


def stamp_install_progressive(
    campaign_dir: Path, library_entry_path: Path,
) -> dict[str, Any] | None:
    """Called after library install: stamp progressive_asset_root_id if linked."""
    link_path = Path(library_entry_path) / PROGRESSIVE_LINK_NAME
    if not link_path.is_file():
        return None
    try:
        link = json.loads(link_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    root_id = str(link.get("asset_root_id") or "").strip()
    if not root_id:
        return None
    sc_path = Path(campaign_dir) / "scenario" / "scenario.json"
    sc = {}
    if sc_path.is_file():
        try:
            sc = json.loads(sc_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            sc = {}
    if not isinstance(sc, dict):
        sc = {}
    sc["progressive"] = True
    sc["progressive_asset_root_id"] = root_id
    sc["progressive_linked_at"] = _now_iso()
    _write_json(sc_path, sc)
    return {"progressive_asset_root_id": root_id}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Progressive asset reuse + queue worker")
    parser.add_argument("--workspace", default=".")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("link-library", help="link module-library entry to asset root")
    p.add_argument("--canonical-module-id", required=True)
    p.add_argument("--asset-root-id", required=True)
    p.add_argument("--file-sha256", default="")

    p = sub.add_parser("resolve", help="resolve asset root from sha/id/library")
    p.add_argument("--asset-root-id", default="")
    p.add_argument("--file-sha256", default="")
    p.add_argument("--canonical-module-id", default="")

    p = sub.add_parser("reuse", help="project assets into campaign (no PDF re-extract)")
    p.add_argument("--campaign", required=True)
    p.add_argument("--asset-root-id", default="")
    p.add_argument("--file-sha256", default="")
    p.add_argument("--canonical-module-id", default="")
    p.add_argument("--start-only", action="store_true", help="merge only start deep packs")

    p = sub.add_parser(
        "process-queue",
        help="kick background parallel workers + merge ready packs for a campaign",
    )
    p.add_argument("--campaign", required=True)
    p.add_argument("--asset-root-id", default="")
    p.add_argument("--max-jobs", type=int, default=32)
    p.add_argument("--parallel", type=int, default=4)
    p.add_argument(
        "--background-only",
        action="store_true",
        help="only kick detached workers; do not wait for an inline drain",
    )

    p = sub.add_parser("worker-status", help="background queue worker status")
    p = sub.add_parser("worker-kick", help="non-blocking start of parallel queue worker")
    p.add_argument("--parallel", type=int, default=4)

    args = parser.parse_args(argv)
    ws = Path(args.workspace).resolve()
    try:
        if args.cmd == "link-library":
            result = link_library_to_assets(
                ws,
                canonical_module_id=args.canonical_module_id,
                asset_root_id=args.asset_root_id,
                file_sha256=args.file_sha256 or None,
            )
        elif args.cmd == "resolve":
            result = resolve_asset_root(
                ws,
                asset_root_id=args.asset_root_id or None,
                file_sha256=args.file_sha256 or None,
                canonical_module_id=args.canonical_module_id or None,
            )
        elif args.cmd == "reuse":
            result = reuse_into_campaign(
                ws,
                args.campaign,
                asset_root_id=args.asset_root_id or None,
                file_sha256=args.file_sha256 or None,
                canonical_module_id=args.canonical_module_id or None,
                merge_all_deep=not args.start_only,
            )
        elif args.cmd == "process-queue":
            result = process_queue(
                ws,
                args.campaign,
                asset_root_id=args.asset_root_id or None,
                max_jobs=args.max_jobs,
                parallel=args.parallel,
                background=bool(args.background_only),
            )
        elif args.cmd == "worker-status":
            worker = _load_sibling(
                "coc_module_queue_worker_cli", "coc_module_queue_worker.py",
            )
            result = worker.worker_status(ws)
        elif args.cmd == "worker-kick":
            worker = _load_sibling(
                "coc_module_queue_worker_cli", "coc_module_queue_worker.py",
            )
            result = worker.kick_background_worker(ws, parallel=args.parallel)
        else:
            return 1
        print(json.dumps({"ok": True, **result}, ensure_ascii=False, default=str))
        return 0
    except (
        ModuleReuseError,
        coc_module_assets.ModuleAssetsError,
        coc_module_project.ModuleProjectError,
        OSError,
        json.JSONDecodeError,
        FileNotFoundError,
        ValueError,
    ) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
