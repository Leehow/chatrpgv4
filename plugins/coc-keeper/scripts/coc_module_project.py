#!/usr/bin/env python3
"""Project progressive module-assets into campaign Scenario IR.

Slice 2–3 of docs/active-plans/coc-on-demand-module-skeleton.md:
- skeleton → sparse story-graph topology
- deep location/NPC/clue packs → opening-playable seven-file projection

Does not run host PDF extraction. Does not claim full coc_scenario_compile green.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent

REQUIRED_FILES = (
    "module-meta.json",
    "story-graph.json",
    "clue-graph.json",
    "npc-agendas.json",
    "threat-fronts.json",
    "pacing-map.json",
    "improvisation-boundaries.json",
)


def _load_sibling(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPT_DIR / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_fileio = _load_sibling("coc_fileio_module_project", "coc_fileio.py")
coc_module_assets = _load_sibling("coc_module_assets_project", "coc_module_assets.py")
coc_state = _load_sibling("coc_state_module_project", "coc_state.py")


class ModuleProjectError(ValueError):
    """Progressive IR projection failed."""


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _write_json(path: Path, payload: Any) -> None:
    coc_fileio.write_json_atomic(
        path, payload, indent=2, ensure_ascii=False, trailing_newline=True,
    )


def _campaign_dir(workspace: Path, campaign_id: str) -> Path:
    root = coc_state.coc_root(Path(workspace).resolve())
    path = root / "campaigns" / campaign_id
    if not path.is_dir():
        raise ModuleProjectError(f"unknown campaign: {campaign_id}")
    return path


def skeleton_scene_from_location(loc: dict[str, Any], *, is_start: bool) -> dict[str, Any]:
    """Minimal story-graph scene from skeleton location (topology only)."""
    lid = str(loc.get("location_id") or "").strip()
    title = str(loc.get("title") or lid).strip()
    tags = list(loc.get("location_tags") or [])
    if not tags and title:
        tags = [title]
    parse_state = str(loc.get("parse_state") or "toc_only")
    scene_type = str(loc.get("scene_type") or "investigation")
    return {
        "scene_id": lid,
        "display_name": title,
        "location_tags": tags,
        "is_start": is_start,
        "is_final": bool(loc.get("is_final")),
        "scene_type": scene_type,
        "origin": "source",
        "dramatic_question": str(
            loc.get("dramatic_question")
            or f"What do the investigators find at {title}?"
        ),
        "entry_conditions": [],
        "exit_conditions": [],
        "available_clues": list(loc.get("available_clue_ids") or []),
        "npc_ids": list(loc.get("npc_ids") or loc.get("npc_ids_mentioned") or []),
        "pressure_moves": list(loc.get("pressure_moves") or []),
        "storylet_tags": list(loc.get("storylet_tags") or []),
        "affordances": list(loc.get("affordances") or []),
        "tone": list(loc.get("tone") or []),
        "allowed_improvisation": list(loc.get("allowed_improvisation") or []),
        "scene_edges": [],
        "parse_state": parse_state,
        "evidence_gap": bool(loc.get("evidence_gap")),
        "source_span": loc.get("source_span"),
    }


def edges_from_skeleton(skeleton: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    """Map location_id → list of story-graph scene_edges (provisional)."""
    by_from: dict[str, list[dict[str, Any]]] = {}
    for edge in skeleton.get("edges_provisional") or []:
        if not isinstance(edge, dict):
            continue
        src = str(edge.get("from") or "").strip()
        dst = str(edge.get("to") or "").strip()
        if not src or not dst:
            continue
        kind = str(edge.get("kind") or "travel")
        conf = str(edge.get("confidence") or "low")
        # unlock with high confidence becomes unlock edge; else soft travel
        edge_kind = "unlock" if kind == "unlock" and conf == "high" else "travel"
        payload = {
            "to": dst,
            "kind": edge_kind,
            "when": {"kind": "always"} if edge_kind == "travel" else {
                "kind": "flag_set",
                "flag": f"unlock:{src}:{dst}",
            },
            "provisional": True,
            "confidence": conf,
            "evidence": edge.get("evidence"),
        }
        if kind == "contains":
            payload["kind"] = "travel"
            payload["relation"] = "contains"
        by_from.setdefault(src, []).append(payload)
    return by_from


def project_skeleton_to_ir(skeleton: dict[str, Any]) -> dict[str, Any]:
    """Build sparse seven-file IR objects from Tier-1 skeleton."""
    errors = coc_module_assets.validate_skeleton(skeleton)
    if errors:
        raise ModuleProjectError("skeleton invalid: " + "; ".join(errors))

    starts = {str(x).strip() for x in (skeleton.get("start_candidates") or [])}
    finals = {
        str(b.get("id") or "").strip()
        for b in (skeleton.get("finale_buckets") or [])
        if isinstance(b, dict) and b.get("id")
    }
    edge_map = edges_from_skeleton(skeleton)
    scenes: list[dict[str, Any]] = []
    for loc in skeleton.get("locations") or []:
        if not isinstance(loc, dict):
            continue
        lid = str(loc.get("location_id") or "").strip()
        scene = skeleton_scene_from_location(loc, is_start=lid in starts)
        if lid in finals:
            scene["is_final"] = True
        scene["scene_edges"] = list(edge_map.get(lid) or [])
        scenes.append(scene)

    identity = skeleton.get("module_identity") or {}
    source = skeleton.get("source") or {}
    meta = {
        "schema_version": 1,
        "scenario_id": str(
            identity.get("canonical_module_id")
            or source.get("source_id")
            or "progressive-module"
        ).replace("pdf:", "").replace("/", "-"),
        "title": str(
            identity.get("canonical_title")
            or source.get("title")
            or identity.get("canonical_module_id")
            or "Progressive Module"
        ),
        "structure_type": skeleton.get("structure_type") or "branching_investigation",
        "era": (
            coc_state.normalize_era(str(identity.get("era")))
            if identity.get("era")
            else "unknown"
        ),
        "content_flags": list(skeleton.get("content_flags") or []),
        "module_identity": identity,
        "source": source,
        "progressive": True,
        "parse_tier": skeleton.get("parse_tier") or 1,
        "player_safe_summary": str(
            skeleton.get("player_safe_summary")
            or "Progressive import: skeleton topology; deep packs fill in on demand."
        ),
        "summary": "Skeleton-projected progressive scenario IR.",
        "win_condition": str(
            (skeleton.get("finale_buckets") or [{}])[0].get("title")
            if skeleton.get("finale_buckets")
            else "Resolve the investigation."
        ),
    }

    npc_rows = []
    for npc in skeleton.get("npc_roster") or []:
        if not isinstance(npc, dict):
            continue
        nid = str(npc.get("npc_id") or "").strip()
        if not nid:
            continue
        names = npc.get("names") if isinstance(npc.get("names"), list) else []
        display = str(names[0] if names else nid)
        npc_rows.append({
            "npc_id": nid,
            "name": display,
            "display_name": display,
            "agenda": str(npc.get("agenda") or f"{display} has not been deep-parsed yet."),
            "relationship_to_investigators": str(
                npc.get("relationship_to_investigators") or "unknown"
            ),
            "parse_state": npc.get("parse_state") or "named_only",
            "origin": "source",
        })

    threat_fronts = []
    for threat in skeleton.get("threats") or []:
        if not isinstance(threat, dict):
            continue
        tid = str(threat.get("threat_id") or "").strip()
        if not tid:
            continue
        threat_fronts.append({
            "front_id": tid,
            "clock_id": f"clock-{tid}",
            "label": str(threat.get("label") or tid),
            "segments": 4,
            "value": 0,
            "on_tick_visible": str(threat.get("label") or tid),
            "parse_state": threat.get("parse_state") or "stub",
            "scene_ids": [],
        })

    conclusions = []
    for bucket in skeleton.get("conclusion_buckets") or []:
        if not isinstance(bucket, dict):
            continue
        cid = str(bucket.get("id") or "").strip()
        if not cid:
            continue
        conclusions.append({
            "conclusion_id": cid,
            "importance": bucket.get("importance") or "supporting",
            "description": str(bucket.get("title") or cid),
            "minimum_routes": 1,
            "origin": "source",
            "clues": [],
            "parse_state": "stub",
        })

    pacing = []
    for scene in scenes:
        pacing.append({
            "scene_id": scene["scene_id"],
            "horror_stage": "wrongness",
            "tension_target": "low" if scene.get("is_start") else "medium",
        })

    return {
        "module-meta.json": meta,
        "story-graph.json": {"scenes": scenes},
        "clue-graph.json": {"conclusions": conclusions},
        "npc-agendas.json": {"npcs": npc_rows},
        "threat-fronts.json": {"fronts": threat_fronts},
        "pacing-map.json": {"curve": pacing},
        "improvisation-boundaries.json": {
            "invent_allowed": [
                "mundane sensory color at skeleton locations",
                "generic desk clerks when no deep NPC pack exists",
            ],
            "never_invent": [
                "handout text for packs not yet deep-parsed",
                "module secrets marked evidence_gap",
            ],
            "keeper_secrets": [],
        },
    }


def _load_json(path: Path, default: Any) -> Any:
    if not path.is_file():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def merge_deep_location_into_ir(
    ir: dict[str, Any],
    pack: dict[str, Any],
) -> dict[str, Any]:
    """Upsert one deep location pack into projected IR (mutates copy)."""
    out = {k: json.loads(json.dumps(v)) for k, v in ir.items()}  # deep copy via json
    lid = str(pack.get("location_id") or "").strip()
    if not lid:
        raise ModuleProjectError("deep location pack missing location_id")

    scenes = out["story-graph.json"].setdefault("scenes", [])
    scene = next((s for s in scenes if s.get("scene_id") == lid), None)
    if scene is None:
        scene = skeleton_scene_from_location(
            {"location_id": lid, "title": pack.get("title") or lid},
            is_start=False,
        )
        scenes.append(scene)

    scene["parse_state"] = pack.get("parse_state") or "deep"
    scene["evidence_gap"] = bool(pack.get("evidence_gap"))
    if pack.get("dramatic_question"):
        scene["dramatic_question"] = pack["dramatic_question"]
    if pack.get("scene_type"):
        scene["scene_type"] = pack["scene_type"]
    if pack.get("display_name") or pack.get("title"):
        scene["display_name"] = pack.get("display_name") or pack.get("title")
    for key in (
        "available_clues", "npc_ids", "pressure_moves", "affordances",
        "tone", "storylet_tags", "allowed_improvisation", "exit_conditions",
    ):
        pack_key = "available_clue_ids" if key == "available_clues" else key
        if pack.get(pack_key) is not None:
            scene[key] = list(pack.get(pack_key) or [])
    if pack.get("scene_edges") is not None:
        # deep edges replace provisional ones for this scene
        scene["scene_edges"] = list(pack.get("scene_edges") or [])
    scene["player_safe_summary"] = pack.get("player_safe_summary") or scene.get(
        "player_safe_summary"
    )

    # Clues: attach under a progressive conclusion bucket
    conclusions = out["clue-graph.json"].setdefault("conclusions", [])
    prog = next(
        (c for c in conclusions if c.get("conclusion_id") == "progressive-local"),
        None,
    )
    if prog is None:
        prog = {
            "conclusion_id": "progressive-local",
            "importance": "supporting",
            "description": "On-demand deep-parsed local clues",
            "minimum_routes": 1,
            "origin": "source",
            "clues": [],
        }
        conclusions.append(prog)
    clues_by_id = {
        c.get("clue_id"): c for c in prog.get("clues") or [] if isinstance(c, dict)
    }
    for clue in pack.get("clues") or []:
        if not isinstance(clue, dict) or not clue.get("clue_id"):
            continue
        row = {
            "clue_id": clue["clue_id"],
            "delivery_kind": clue.get("delivery_kind") or "obvious",
            "visibility": "player-safe",
            "origin": "source",
            "player_safe_summary": str(
                clue.get("player_safe_summary") or clue.get("summary") or ""
            ),
            "parse_state": "deep",
        }
        if clue.get("skill"):
            row["skill"] = clue["skill"]
            row["difficulty"] = clue.get("difficulty") or "regular"
        if clue.get("source_npc_ids"):
            row["source_npc_ids"] = list(clue["source_npc_ids"])
        if clue.get("localized_text"):
            row["localized_text"] = clue["localized_text"]
        # Structured follow-ups only (never free-prose keyword mentions).
        if clue.get("mentions"):
            row["mentions"] = [
                m for m in clue["mentions"]
                if isinstance(m, dict) and m.get("kind") and m.get("ref_id")
            ]
        clues_by_id[row["clue_id"]] = row
        if row["clue_id"] not in scene["available_clues"]:
            scene["available_clues"].append(row["clue_id"])
    prog["clues"] = list(clues_by_id.values())

    # NPCs from pack
    npcs = out["npc-agendas.json"].setdefault("npcs", [])
    npc_by_id = {n.get("npc_id"): n for n in npcs if isinstance(n, dict)}
    for npc in pack.get("npcs") or []:
        if not isinstance(npc, dict) or not npc.get("npc_id"):
            continue
        nid = npc["npc_id"]
        base = npc_by_id.get(nid) or {"npc_id": nid, "origin": "source"}
        base.update({
            "name": npc.get("name") or npc.get("display_name") or nid,
            "display_name": npc.get("display_name") or npc.get("name") or nid,
            "agenda": npc.get("agenda") or base.get("agenda") or f"{nid} agenda",
            "relationship_to_investigators": npc.get(
                "relationship_to_investigators"
            ) or base.get("relationship_to_investigators") or "unknown",
            "voice": npc.get("voice") or base.get("voice"),
            "parse_state": npc.get("parse_state") or "deep",
            "origin": "source",
        })
        if npc.get("social_role"):
            base["social_role"] = npc["social_role"]
        npc_by_id[nid] = base
        if nid not in scene["npc_ids"]:
            scene["npc_ids"].append(nid)
    out["npc-agendas.json"]["npcs"] = list(npc_by_id.values())

    # pacing row
    curve = out["pacing-map.json"].setdefault("curve", [])
    if not any(r.get("scene_id") == lid for r in curve if isinstance(r, dict)):
        curve.append({
            "scene_id": lid,
            "horror_stage": pack.get("horror_stage") or "wrongness",
            "tension_target": pack.get("tension_target") or "medium",
        })

    secrets = out["improvisation-boundaries.json"].setdefault("keeper_secrets", [])
    existing_ids = {s.get("id") for s in secrets if isinstance(s, dict)}
    for sec in pack.get("keeper_secret_refs") or []:
        if not isinstance(sec, dict) or not sec.get("id"):
            continue
        if sec["id"] in existing_ids:
            continue
        secrets.append({
            "id": sec["id"],
            "category": sec.get("category") or "keeper_secret",
            "prose": sec.get("prose") or "",
        })
        existing_ids.add(sec["id"])

    return out


def _sync_campaign_era_clock_from_meta(
    campaign_dir: Path,
    meta: dict[str, Any],
) -> None:
    """Align campaign era + pristine clock with progressive module meta.

    Freeform labels (e.g. ``1597 Spain``) are normalized via
    ``coc_state.normalize_era``. When the time clock is still at zero elapsed,
    reseed so player-visible dates match the module era instead of silently
    defaulting to 1925.
    """
    if not isinstance(meta, dict):
        return
    identity = meta.get("module_identity") if isinstance(meta.get("module_identity"), dict) else {}
    era_raw = meta.get("era") or identity.get("era")
    if not era_raw or str(era_raw).strip().lower() in {"unknown", "none", "null"}:
        return
    era_key = coc_state.normalize_era(str(era_raw))
    camp_path = campaign_dir / "campaign.json"
    if not camp_path.is_file():
        return
    try:
        camp = json.loads(camp_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return
    if not isinstance(camp, dict):
        return
    camp_id = str(camp.get("campaign_id") or campaign_dir.name)
    changed = camp.get("era") != era_key
    camp["era"] = era_key
    # Prefer module identity era field to stay canonical for later readers.
    if isinstance(identity, dict) and not identity.get("era"):
        identity = dict(identity)
        identity["era"] = era_key
        meta = dict(meta)
        meta["module_identity"] = identity
        meta["era"] = era_key
    if changed:
        _write_json(camp_path, camp)
    # Reseed clock only while still pristine (no travel time spent), or when
    # the displayed epoch is still the generic 1920s default under a non-1920s era.
    time_path = campaign_dir / "save" / "time-state.json"
    elapsed = 0
    local_dt = ""
    if time_path.is_file():
        try:
            ts = json.loads(time_path.read_text(encoding="utf-8"))
            clock = ts.get("clock") if isinstance(ts, dict) else {}
            if isinstance(clock, dict):
                elapsed = int(clock.get("elapsed_minutes") or 0)
                local_dt = str(clock.get("local_datetime") or "")
        except (OSError, json.JSONDecodeError, TypeError, ValueError):
            elapsed = 0
            local_dt = ""
    looks_like_1920s_default = local_dt.startswith("1925-") or local_dt.startswith("1920-")
    if elapsed == 0 or (era_key != "1920s" and looks_like_1920s_default):
        coc_state.reseed_campaign_clock_for_era(
            campaign_dir,
            camp_id,
            era_key,
            preserve_elapsed=True,
        )


def write_ir_to_campaign(
    campaign_dir: Path,
    ir: dict[str, Any],
    *,
    asset_root_id: str | None = None,
) -> list[str]:
    scenario_dir = campaign_dir / "scenario"
    scenario_dir.mkdir(parents=True, exist_ok=True)
    written = []
    for name in REQUIRED_FILES:
        if name not in ir:
            raise ModuleProjectError(f"IR missing {name}")
        path = scenario_dir / name
        _write_json(path, ir[name])
        written.append(str(path))
    # stamp progressive marker on scenario.json if present
    sc_path = scenario_dir / "scenario.json"
    meta = ir.get("module-meta.json") or {}
    sc = _load_json(sc_path, {}) if sc_path.is_file() else {
        "schema_version": 1,
        "scenario_id": meta.get("scenario_id") if isinstance(meta, dict) else None,
        "title": meta.get("title") if isinstance(meta, dict) else None,
    }
    if isinstance(sc, dict):
        sc["progressive"] = True
        sc["progressive_projected_at"] = _now_iso()
        if asset_root_id:
            sc["progressive_asset_root_id"] = asset_root_id
        if isinstance(meta, dict):
            if meta.get("title"):
                sc["title"] = meta["title"]
            if meta.get("scenario_id"):
                sc["scenario_id"] = meta["scenario_id"]
        _write_json(sc_path, sc)
    if isinstance(meta, dict):
        # Normalize era on the written module-meta for downstream readers.
        identity = meta.get("module_identity") if isinstance(meta.get("module_identity"), dict) else {}
        era_raw = meta.get("era") or identity.get("era")
        if era_raw and str(era_raw).strip().lower() not in {"unknown", "none", "null"}:
            era_key = coc_state.normalize_era(str(era_raw))
            meta = dict(meta)
            meta["era"] = era_key
            if isinstance(identity, dict):
                identity = dict(identity)
                identity["era"] = era_key
                meta["module_identity"] = identity
            _write_json(scenario_dir / "module-meta.json", meta)
            ir["module-meta.json"] = meta
        _sync_campaign_era_clock_from_meta(campaign_dir, meta if isinstance(meta, dict) else {})
    return written


def campaign_asset_root_id(campaign_dir: Path) -> str | None:
    sc = _load_json(campaign_dir / "scenario" / "scenario.json", {})
    if isinstance(sc, dict):
        value = str(sc.get("progressive_asset_root_id") or "").strip()
        if value:
            return value
    meta = _load_json(campaign_dir / "scenario" / "module-meta.json", {})
    if isinstance(meta, dict) and meta.get("progressive"):
        mid = str(
            (meta.get("module_identity") or {}).get("canonical_module_id")
            or meta.get("scenario_id")
            or ""
        ).strip()
        return mid or None
    return None


def load_campaign_ir(campaign_dir: Path) -> dict[str, Any]:
    scenario_dir = campaign_dir / "scenario"
    ir: dict[str, Any] = {}
    for name in REQUIRED_FILES:
        path = scenario_dir / name
        if not path.is_file():
            raise ModuleProjectError(f"campaign missing {name}")
        ir[name] = _load_json(path, {})
    return ir


def project_skeleton_to_campaign(
    workspace: Path,
    campaign_id: str,
    asset_root_id: str,
) -> dict[str, Any]:
    skeleton = coc_module_assets.get_skeleton(workspace, asset_root_id)
    if not skeleton:
        raise ModuleProjectError("skeleton.json missing; put_skeleton first")
    ir = project_skeleton_to_ir(skeleton)
    campaign_dir = _campaign_dir(workspace, campaign_id)
    paths = write_ir_to_campaign(campaign_dir, ir, asset_root_id=asset_root_id)
    return {
        "campaign_id": campaign_id,
        "asset_root_id": asset_root_id,
        "scene_count": len(ir["story-graph.json"]["scenes"]),
        "paths": paths,
        "parse_tier": skeleton.get("parse_tier") or 1,
    }


def project_opening_deep(
    workspace: Path,
    campaign_id: str,
    asset_root_id: str,
    *,
    deep_packs: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Project skeleton IR then merge deep packs for start locations.

    ``deep_packs`` may be provided by the host. If omitted, loads
    ``entities/location-<id>.json`` for each start candidate when present.
    """
    skeleton = coc_module_assets.get_skeleton(workspace, asset_root_id)
    if not skeleton:
        raise ModuleProjectError("skeleton.json missing; put_skeleton first")
    ir = project_skeleton_to_ir(skeleton)
    starts = [str(x).strip() for x in (skeleton.get("start_candidates") or [])]
    packs = list(deep_packs or [])
    if not packs:
        for sid in starts:
            pack = coc_module_assets.get_entity(
                workspace, asset_root_id, "location", sid,
            )
            if pack and str(pack.get("parse_state") or "") in {"deep", "body_parsed"}:
                packs.append(pack)
    if not packs:
        raise ModuleProjectError(
            "opening deep requires deep location packs for start_candidates "
            "(put_entity location with parse_state=deep, or pass deep_packs)"
        )

    merged_ids = []
    for pack in packs:
        ir = merge_deep_location_into_ir(ir, pack)
        merged_ids.append(pack.get("location_id"))

    # Opening gate: each start scene should have parse_state deep after merge
    scenes = ir["story-graph.json"]["scenes"]
    for sid in starts:
        scene = next((s for s in scenes if s.get("scene_id") == sid), None)
        if scene is None:
            raise ModuleProjectError(f"start scene missing after project: {sid}")
        if scene.get("parse_state") not in {"deep", "body_parsed"}:
            raise ModuleProjectError(
                f"start scene {sid!r} is not deep after projection"
            )
        # Ensure at least two affordances for social/investigation if empty
        if scene.get("scene_type") in {"social", "investigation"} and len(
            scene.get("affordances") or []
        ) < 2:
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

    campaign_dir = _campaign_dir(workspace, campaign_id)
    paths = write_ir_to_campaign(campaign_dir, ir, asset_root_id=asset_root_id)
    coc_module_assets.note_parse_tier(workspace, asset_root_id, 2)
    return {
        "campaign_id": campaign_id,
        "asset_root_id": asset_root_id,
        "merged_location_ids": merged_ids,
        "paths": paths,
        "parse_tier": 2,
    }


def _is_deep_state(state: Any) -> bool:
    return str(state or "") in {"deep", "body_parsed"}


def _neighbor_ids_from_skeleton(
    skeleton: dict[str, Any], location_id: str,
) -> list[str]:
    neighbors: list[str] = []
    for loc in skeleton.get("locations") or []:
        if not isinstance(loc, dict):
            continue
        if str(loc.get("location_id") or "") != location_id:
            continue
        for n in loc.get("neighbors_provisional") or []:
            if isinstance(n, str) and n.strip():
                neighbors.append(n.strip())
    for edge in skeleton.get("edges_provisional") or []:
        if not isinstance(edge, dict):
            continue
        src = str(edge.get("from") or "").strip()
        dst = str(edge.get("to") or "").strip()
        if src == location_id and dst:
            neighbors.append(dst)
        if dst == location_id and src:
            neighbors.append(src)
    # unique preserve order
    seen: set[str] = set()
    out: list[str] = []
    for n in neighbors:
        if n not in seen and n != location_id:
            seen.add(n)
            out.append(n)
    return out


def on_enter_scene(
    workspace: Path,
    campaign_id: str,
    scene_id: str,
    *,
    asset_root_id: str | None = None,
) -> dict[str, Any]:
    """Event-driven hot ring after the party enters ``scene_id``.

    - If a deep location pack exists, merge it into campaign IR.
    - Always enqueue deepen for the active scene (deduped).
    - Stub + enqueue depth-1 neighbors and structured mentions from the pack.
    - Never fabricates handout bodies; returns ``host_hints`` for missing deep.
    """
    campaign_dir = _campaign_dir(workspace, campaign_id)
    root_id = asset_root_id or campaign_asset_root_id(campaign_dir)
    if not root_id:
        return {
            "progressive": False,
            "scene_id": scene_id,
            "skipped": True,
            "reason": "campaign is not progressive / no asset_root_id",
        }

    sid = str(scene_id or "").strip()
    if not sid:
        raise ModuleProjectError("scene_id required")

    skeleton = coc_module_assets.get_skeleton(workspace, root_id) or {}
    host_hints: list[str] = []
    actions: list[dict[str, Any]] = []

    # Always request deep for active scene
    q = coc_module_assets.enqueue_job(
        workspace, root_id,
        kind="deepen_location",
        target_id=sid,
        priority=100,
        reason=f"enter:{sid}",
    )
    actions.append({"enqueue": q})

    pack = coc_module_assets.get_entity(workspace, root_id, "location", sid)
    merged = False
    if pack and _is_deep_state(pack.get("parse_state")) and not pack.get("evidence_gap"):
        ir = load_campaign_ir(campaign_dir)
        ir = merge_deep_location_into_ir(ir, pack)
        write_ir_to_campaign(campaign_dir, ir, asset_root_id=root_id)
        merged = True
        actions.append({"merged_deep": sid})
        # Mentions from deep pack → stubs + enqueue
        for mention in pack.get("mentions") or []:
            if not isinstance(mention, dict):
                continue
            kind = str(mention.get("kind") or "").strip()
            ref = str(mention.get("ref_id") or "").strip()
            if kind not in coc_module_assets.ENTITY_KINDS or not ref:
                continue
            stub = coc_module_assets.ensure_stub(
                workspace, root_id, kind, ref,
                title=str(mention.get("raw_label") or ref),
                reason=f"mention_from:{sid}",
            )
            actions.append({"ensure_stub": stub})
            job_kind = {
                "location": "deepen_location",
                "npc": "deepen_npc",
                "clue": "deepen_clue",
                "handout": "deepen_handout",
                "threat": "ensure_stub",
            }.get(kind, "ensure_stub")
            if job_kind != "ensure_stub":
                eq = coc_module_assets.enqueue_job(
                    workspace, root_id,
                    kind=job_kind,
                    target_id=ref,
                    priority=50,
                    reason=f"mention_from:{sid}",
                )
                actions.append({"enqueue": eq})
    else:
        host_hints.append(
            f"host: deep-extract location {sid!r} and put_entity "
            f"(parse_state=deep), then re-enter or call process-enter"
        )
        if not pack:
            coc_module_assets.ensure_stub(
                workspace, root_id, "location", sid,
                reason=f"enter:{sid}",
            )

    # Neighbor hot ring (depth 1)
    neighbors = _neighbor_ids_from_skeleton(skeleton, sid)
    # also from current IR scene edges if present
    try:
        ir_now = load_campaign_ir(campaign_dir)
        for scene in ir_now.get("story-graph.json", {}).get("scenes") or []:
            if str(scene.get("scene_id")) != sid:
                continue
            for edge in scene.get("scene_edges") or []:
                if isinstance(edge, dict) and edge.get("to"):
                    neighbors.append(str(edge["to"]))
    except ModuleProjectError:
        pass
    seen_n: set[str] = set()
    unique_neighbors: list[str] = []
    for n in neighbors:
        if n and n not in seen_n and n != sid:
            seen_n.add(n)
            unique_neighbors.append(n)

    for nid in unique_neighbors:
        stub = coc_module_assets.ensure_stub(
            workspace, root_id, "location", nid,
            reason=f"neighbor_of:{sid}",
        )
        actions.append({"ensure_stub": stub})
        n_pack = coc_module_assets.get_entity(workspace, root_id, "location", nid)
        if n_pack and _is_deep_state(n_pack.get("parse_state")):
            # optional: leave deep packs; do not auto-merge neighbors (only active)
            eq = coc_module_assets.enqueue_job(
                workspace, root_id,
                kind="partial_neighbor",
                target_id=nid,
                priority=40,
                reason=f"neighbor_of:{sid}",
            )
        else:
            eq = coc_module_assets.enqueue_job(
                workspace, root_id,
                kind="deepen_location",
                target_id=nid,
                priority=50,
                reason=f"neighbor_of:{sid}",
            )
            host_hints.append(
                f"host: optional prefetch partial/deep for neighbor {nid!r}"
            )
        actions.append({"enqueue": eq})

    # Apply any pending deepen jobs that already have deep packs (active only auto-merge)
    applied = process_ready_deepens(
        workspace, campaign_id, asset_root_id=root_id, only_scene_ids={sid},
    )
    if applied.get("merged_location_ids"):
        merged = True
        actions.append({"process_ready": applied})

    coc_module_assets.note_parse_tier(workspace, root_id, 3)
    return {
        "progressive": True,
        "scene_id": sid,
        "asset_root_id": root_id,
        "merged_active": merged,
        "neighbors": unique_neighbors,
        "host_hints": host_hints,
        "actions": actions,
        "queue": coc_module_assets.list_queue(workspace, root_id),
    }


def process_ready_deepens(
    workspace: Path,
    campaign_id: str,
    *,
    asset_root_id: str | None = None,
    only_scene_ids: set[str] | None = None,
) -> dict[str, Any]:
    """Merge deep packs for pending deepen_location jobs when packs exist."""
    campaign_dir = _campaign_dir(workspace, campaign_id)
    root_id = asset_root_id or campaign_asset_root_id(campaign_dir)
    if not root_id:
        return {"merged_location_ids": [], "skipped": True}
    queue = coc_module_assets.list_queue(workspace, root_id)
    pending = list(queue.get("pending") or [])
    merged_ids: list[str] = []
    still_pending: list[dict[str, Any]] = []
    done = list(queue.get("done") or [])
    ir = None
    for job in pending:
        if job.get("kind") != "deepen_location":
            still_pending.append(job)
            continue
        tid = str(job.get("target_id") or "")
        if only_scene_ids is not None and tid not in only_scene_ids:
            still_pending.append(job)
            continue
        pack = coc_module_assets.get_entity(workspace, root_id, "location", tid)
        if not pack or not _is_deep_state(pack.get("parse_state")) or pack.get(
            "evidence_gap"
        ):
            still_pending.append(job)
            continue
        if ir is None:
            ir = load_campaign_ir(campaign_dir)
        ir = merge_deep_location_into_ir(ir, pack)
        merged_ids.append(tid)
        done.append({**job, "completed_at": _now_iso(), "result": "merged"})
    if ir is not None and merged_ids:
        write_ir_to_campaign(campaign_dir, ir, asset_root_id=root_id)
        # rewrite queue
        path = coc_module_assets.assets_root(workspace) / root_id / "parse-queue.json"
        _write_json(path, {
            "schema_version": coc_module_assets.SCHEMA_VERSION,
            "pending": still_pending,
            "in_flight": queue.get("in_flight") or [],
            "done": done[-100:],
        })
    return {
        "merged_location_ids": merged_ids,
        "pending_remaining": len(still_pending) if ir is not None else len(pending),
    }


_JOB_KIND_FOR_ENTITY = {
    "location": "deepen_location",
    "npc": "deepen_npc",
    "clue": "deepen_clue",
    "handout": "deepen_handout",
}


def ensure_location_on_skeleton(
    workspace: Path,
    asset_root_id: str,
    location_id: str,
    *,
    title: str | None = None,
    link_from: str | None = None,
) -> dict[str, Any]:
    """Ensure a dig target location exists on the progressive skeleton + edges.

    Without this, dig stubs never appear on ``scene.map`` / story-graph and
    moves become improvised empty scenes.
    """
    lid = str(location_id or "").strip()
    if not lid:
        raise ModuleProjectError("location_id required")
    skeleton = coc_module_assets.get_skeleton(workspace, asset_root_id)
    if not skeleton:
        raise ModuleProjectError("skeleton.json missing; cannot attach dig location")
    locs = list(skeleton.get("locations") or [])
    existing = next((l for l in locs if str(l.get("location_id")) == lid), None)
    created = False
    if existing is None:
        locs.append({
            "location_id": lid,
            "title": title or lid,
            "parse_state": "named_only",
            "scene_type": "investigation",
            "location_tags": [lid],
            "is_final": False,
        })
        skeleton["locations"] = locs
        created = True
    elif title and not existing.get("title"):
        existing["title"] = title
    edges = list(skeleton.get("edges_provisional") or [])
    edge_added = False
    src = str(link_from or "").strip()
    if src and src != lid:
        have = any(
            str(e.get("from")) == src and str(e.get("to")) == lid for e in edges
        )
        if not have:
            edges.append({
                "from": src,
                "to": lid,
                "kind": "travel",
                "confidence": "med",
                "evidence": "body_mention",
            })
            skeleton["edges_provisional"] = edges
            edge_added = True
        # also reverse for return travel (low confidence)
        have_back = any(
            str(e.get("from")) == lid and str(e.get("to")) == src for e in edges
        )
        if not have_back:
            edges.append({
                "from": lid,
                "to": src,
                "kind": "travel",
                "confidence": "med",
                "evidence": "map",
            })
            skeleton["edges_provisional"] = edges
            edge_added = True
    if created or edge_added or (title and existing is not None):
        errors = coc_module_assets.validate_skeleton(skeleton)
        if errors:
            raise ModuleProjectError("skeleton invalid after dig attach: " + "; ".join(errors[:5]))
        coc_module_assets.put_skeleton(workspace, asset_root_id, skeleton)
    return {
        "location_id": lid,
        "created_on_skeleton": created,
        "edge_added": edge_added,
        "link_from": src or None,
    }


def project_location_stub_into_campaign(
    workspace: Path,
    campaign_id: str,
    location_id: str,
    *,
    title: str | None = None,
    link_from: str | None = None,
    asset_root_id: str | None = None,
) -> dict[str, Any]:
    """Project a named_only dig location into campaign story-graph (not deep)."""
    campaign_dir = _campaign_dir(workspace, campaign_id)
    root_id = asset_root_id or campaign_asset_root_id(campaign_dir)
    if not root_id:
        return {"projected": False, "reason": "not progressive"}
    lid = str(location_id or "").strip()
    sk_info = ensure_location_on_skeleton(
        workspace, root_id, lid, title=title, link_from=link_from,
    )
    ir = load_campaign_ir(campaign_dir)
    scenes = ir["story-graph.json"].setdefault("scenes", [])
    scene = next((s for s in scenes if str(s.get("scene_id")) == lid), None)
    if scene is None:
        scene = skeleton_scene_from_location(
            {
                "location_id": lid,
                "title": title or lid,
                "parse_state": "named_only",
                "scene_type": "investigation",
                "location_tags": [lid],
            },
            is_start=False,
        )
        scene["evidence_gap"] = True
        scenes.append(scene)
    else:
        scene["parse_state"] = scene.get("parse_state") or "named_only"
        scene["evidence_gap"] = True if not _is_deep_state(scene.get("parse_state")) else bool(
            scene.get("evidence_gap")
        )
        if title:
            scene["display_name"] = title
    # Link edges on both ends in IR
    src = str(link_from or "").strip()
    if src and src != lid:
        def _ensure_edge(from_id: str, to_id: str) -> None:
            sc = next((s for s in scenes if str(s.get("scene_id")) == from_id), None)
            if sc is None:
                return
            edges = list(sc.get("scene_edges") or [])
            if any(str(e.get("to")) == to_id for e in edges):
                return
            edges.append({
                "to": to_id,
                "kind": "travel",
                "when": {"kind": "always"},
            })
            sc["scene_edges"] = edges
        _ensure_edge(src, lid)
        _ensure_edge(lid, src)
    write_ir_to_campaign(campaign_dir, ir, asset_root_id=root_id)
    # Unlock dig target if link_from already visited/unlocked
    try:
        world_path = campaign_dir / "save" / "world-state.json"
        if world_path.is_file():
            world = json.loads(world_path.read_text(encoding="utf-8"))
            unlocked = [str(x) for x in (world.get("unlocked_scene_ids") or [])]
            if src and src in unlocked and lid not in unlocked:
                unlocked.append(lid)
                world["unlocked_scene_ids"] = unlocked
                coc_state.write_json_atomic(world_path, world)
    except (OSError, json.JSONDecodeError, TypeError, ValueError, AttributeError):
        pass
    return {"projected": True, "location_id": lid, **sk_info}


def _entity_status(
    workspace: Path,
    asset_root_id: str,
    kind: str,
    entity_id: str,
) -> dict[str, Any]:
    pack = coc_module_assets.get_entity(workspace, asset_root_id, kind, entity_id)
    if pack is None:
        return {
            "kind": kind,
            "entity_id": entity_id,
            "exists": False,
            "parse_state": None,
            "evidence_gap": True,
            "deep_ready": False,
        }
    parse_state = str(pack.get("parse_state") or "named_only")
    gap = bool(pack.get("evidence_gap"))
    deep_ready = _is_deep_state(parse_state) and not gap
    return {
        "kind": kind,
        "entity_id": entity_id,
        "exists": True,
        "parse_state": parse_state,
        "evidence_gap": gap,
        "deep_ready": deep_ready,
        "title": pack.get("title")
        or pack.get("display_name")
        or pack.get("name")
        or (pack.get("names") or [None])[0],
    }


def follow_structured_mentions(
    workspace: Path,
    campaign_id: str,
    mentions: list[Any],
    *,
    asset_root_id: str | None = None,
    reason: str = "structured_mention",
    priority: int = 60,
) -> dict[str, Any]:
    """Stub + enqueue deepen jobs for structured mention rows only.

    Each mention must be ``{kind, ref_id, raw_label?}``. Free prose is never
    scanned. Play continues with ``evidence_gap`` / host_hints when packs are
    missing — this never fabricates deep content.
    """
    campaign_dir = _campaign_dir(workspace, campaign_id)
    root_id = asset_root_id or campaign_asset_root_id(campaign_dir)
    if not root_id:
        return {
            "progressive": False,
            "skipped": True,
            "reason": "campaign is not progressive / no asset_root_id",
            "followed": [],
            "host_hints": [],
        }

    followed: list[dict[str, Any]] = []
    host_hints: list[str] = []
    actions: list[dict[str, Any]] = []

    # Prefer linking dig targets from the party's current scene when present.
    link_from: str | None = None
    try:
        world_path = campaign_dir / "save" / "world-state.json"
        if world_path.is_file():
            world = json.loads(world_path.read_text(encoding="utf-8"))
            link_from = str(world.get("active_scene_id") or "").strip() or None
    except (OSError, json.JSONDecodeError, TypeError, ValueError):
        link_from = None

    for mention in mentions or []:
        if not isinstance(mention, dict):
            continue
        kind = str(mention.get("kind") or "").strip()
        ref = str(mention.get("ref_id") or "").strip()
        if kind not in coc_module_assets.ENTITY_KINDS or not ref:
            continue
        label = str(mention.get("raw_label") or ref)
        stub = coc_module_assets.ensure_stub(
            workspace, root_id, kind, ref,
            title=label,
            reason=reason,
        )
        actions.append({"ensure_stub": stub})
        if kind == "location":
            try:
                proj = project_location_stub_into_campaign(
                    workspace,
                    campaign_id,
                    ref,
                    title=label,
                    link_from=link_from,
                    asset_root_id=root_id,
                )
                actions.append({"project_stub": proj})
            except ModuleProjectError as exc:
                host_hints.append(f"stub project failed for {ref!r}: {exc}")
        job_kind = _JOB_KIND_FOR_ENTITY.get(kind)
        enqueue_result = None
        if job_kind:
            enqueue_result = coc_module_assets.enqueue_job(
                workspace, root_id,
                kind=job_kind,
                target_id=ref,
                priority=priority,
                reason=reason,
            )
            actions.append({"enqueue": enqueue_result})
        status = _entity_status(workspace, root_id, kind, ref)
        if not status["deep_ready"]:
            # Mark stub dig targets as evidence_gap so KP never invents bodies.
            pack = coc_module_assets.get_entity(workspace, root_id, kind, ref)
            if pack and not _is_deep_state(pack.get("parse_state")):
                pack = dict(pack)
                pack["evidence_gap"] = True
                pack["dig_pending"] = True
                pack["dig_reason"] = reason
                if kind == "location" and label:
                    pack["title"] = pack.get("title") or label
                coc_module_assets.put_entity(workspace, root_id, kind, ref, pack)
                status = _entity_status(workspace, root_id, kind, ref)
            host_hints.append(
                f"host: deep-extract {kind} {ref!r} ({label}) for player dig "
                f"({reason}); put_entity parse_state=deep, then progressive.process_queue "
                f"or state.move_scene to merge"
            )
        followed.append({
            "kind": kind,
            "ref_id": ref,
            "raw_label": label,
            "status": status,
            "enqueued": bool((enqueue_result or {}).get("enqueued"))
            if enqueue_result
            else False,
            "deduped": bool((enqueue_result or {}).get("deduped"))
            if enqueue_result
            else False,
        })

    applied = process_ready_deepens(
        workspace, campaign_id, asset_root_id=root_id,
    )
    coc_module_assets.note_parse_tier(workspace, root_id, 3)
    return {
        "progressive": True,
        "asset_root_id": root_id,
        "reason": reason,
        "followed": followed,
        "host_hints": host_hints,
        "actions": actions,
        "merged_location_ids": applied.get("merged_location_ids") or [],
        "queue": coc_module_assets.list_queue(workspace, root_id),
    }


def request_deepen(
    workspace: Path,
    campaign_id: str,
    *,
    kind: str,
    target_id: str,
    title: str | None = None,
    reason: str = "player_dig",
    asset_root_id: str | None = None,
    priority: int = 80,
) -> dict[str, Any]:
    """Player-dig path: deepen one structured entity without requiring scene enter.

    KP calls this when the investigator materially pursues a place/person/clue
    that is only named or stubbed. Does not move the party. Does not invent
    deep pack bodies.
    """
    kind = str(kind or "").strip()
    target_id = str(target_id or "").strip()
    if kind not in coc_module_assets.ENTITY_KINDS:
        raise ModuleProjectError(
            f"kind must be one of {sorted(coc_module_assets.ENTITY_KINDS)}"
        )
    if not target_id:
        raise ModuleProjectError("target_id required")
    result = follow_structured_mentions(
        workspace,
        campaign_id,
        [{"kind": kind, "ref_id": target_id, "raw_label": title or target_id}],
        asset_root_id=asset_root_id,
        reason=reason,
        priority=priority,
    )
    result["kind"] = kind
    result["target_id"] = target_id
    if result.get("followed"):
        result["status"] = result["followed"][0].get("status")
    return result


def on_clue_discovered(
    workspace: Path,
    campaign_id: str,
    clue_id: str,
    *,
    asset_root_id: str | None = None,
) -> dict[str, Any]:
    """After a clue is recorded, follow its structured ``mentions`` if any.

    Mentions must already live on the clue graph row or the deep pack clue
    object — never extracted by scanning free prose.
    """
    campaign_dir = _campaign_dir(workspace, campaign_id)
    root_id = asset_root_id or campaign_asset_root_id(campaign_dir)
    if not root_id:
        return {"progressive": False, "skipped": True, "followed": [], "host_hints": []}

    mentions: list[Any] = []
    # Prefer campaign IR clue graph (already projected).
    try:
        ir = load_campaign_ir(campaign_dir)
        for conc in (ir.get("clue-graph.json") or {}).get("conclusions") or []:
            for clue in conc.get("clues") or []:
                if str(clue.get("clue_id")) == str(clue_id):
                    mentions.extend(list(clue.get("mentions") or []))
    except ModuleProjectError:
        pass
    # Also check entity pack if present.
    pack = coc_module_assets.get_entity(workspace, root_id, "clue", clue_id)
    if pack and pack.get("mentions"):
        mentions.extend(list(pack.get("mentions") or []))
    # Location packs may embed the clue with mentions.
    if not mentions:
        ent_dir = coc_module_assets.assets_root(workspace) / root_id / "entities"
        if ent_dir.is_dir():
            for path in ent_dir.glob("location-*.json"):
                try:
                    loc = json.loads(path.read_text(encoding="utf-8"))
                except (OSError, json.JSONDecodeError):
                    continue
                for clue in loc.get("clues") or []:
                    if str(clue.get("clue_id")) == str(clue_id) and clue.get("mentions"):
                        mentions.extend(list(clue.get("mentions") or []))

    # Dedup by kind:ref
    seen: set[str] = set()
    unique: list[dict[str, Any]] = []
    for m in mentions:
        if not isinstance(m, dict):
            continue
        key = f"{m.get('kind')}:{m.get('ref_id')}"
        if key in seen:
            continue
        seen.add(key)
        unique.append(m)

    if not unique:
        return {
            "progressive": True,
            "asset_root_id": root_id,
            "clue_id": clue_id,
            "followed": [],
            "host_hints": [],
            "reason": "no_structured_mentions_on_clue",
        }
    out = follow_structured_mentions(
        workspace,
        campaign_id,
        unique,
        asset_root_id=root_id,
        reason=f"clue_discovered:{clue_id}",
        priority=70,
    )
    out["clue_id"] = clue_id
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Project module-assets into campaign IR")
    parser.add_argument("--workspace", default=".")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("skeleton")
    p.add_argument("--campaign", required=True)
    p.add_argument("--asset-root-id", required=True)

    p = sub.add_parser("opening-deep")
    p.add_argument("--campaign", required=True)
    p.add_argument("--asset-root-id", required=True)
    p.add_argument(
        "--pack-json",
        action="append",
        default=[],
        help="path to deep location pack JSON (repeatable)",
    )

    p = sub.add_parser("on-enter")
    p.add_argument("--campaign", required=True)
    p.add_argument("--scene-id", required=True)
    p.add_argument("--asset-root-id", default="")

    p = sub.add_parser("process-ready")
    p.add_argument("--campaign", required=True)
    p.add_argument("--asset-root-id", default="")

    p = sub.add_parser(
        "request-deepen",
        help="player-dig path: stub+enqueue one structured entity (no scene move)",
    )
    p.add_argument("--campaign", required=True)
    p.add_argument("--kind", required=True, choices=sorted(coc_module_assets.ENTITY_KINDS))
    p.add_argument("--target-id", required=True)
    p.add_argument("--title", default="")
    p.add_argument("--reason", default="player_dig")
    p.add_argument("--asset-root-id", default="")

    p = sub.add_parser(
        "follow-mentions",
        help="stub+enqueue from structured mention JSON array (no free-prose scan)",
    )
    p.add_argument("--campaign", required=True)
    p.add_argument("--mentions-json", required=True, help='JSON list of {kind,ref_id,raw_label?}')
    p.add_argument("--reason", default="structured_mention")
    p.add_argument("--asset-root-id", default="")

    args = parser.parse_args(argv)
    ws = Path(args.workspace).resolve()
    try:
        if args.cmd == "skeleton":
            result = project_skeleton_to_campaign(
                ws, args.campaign, args.asset_root_id,
            )
        elif args.cmd == "opening-deep":
            packs = []
            for path in args.pack_json or []:
                packs.append(json.loads(Path(path).read_text(encoding="utf-8")))
            result = project_opening_deep(
                ws, args.campaign, args.asset_root_id,
                deep_packs=packs or None,
            )
        elif args.cmd == "on-enter":
            result = on_enter_scene(
                ws, args.campaign, args.scene_id,
                asset_root_id=args.asset_root_id or None,
            )
        elif args.cmd == "process-ready":
            result = process_ready_deepens(
                ws, args.campaign,
                asset_root_id=args.asset_root_id or None,
            )
        elif args.cmd == "request-deepen":
            result = request_deepen(
                ws, args.campaign,
                kind=args.kind,
                target_id=args.target_id,
                title=args.title or None,
                reason=args.reason,
                asset_root_id=args.asset_root_id or None,
            )
        elif args.cmd == "follow-mentions":
            mentions = json.loads(args.mentions_json)
            if not isinstance(mentions, list):
                raise ModuleProjectError("mentions-json must be a JSON array")
            result = follow_structured_mentions(
                ws, args.campaign, mentions,
                asset_root_id=args.asset_root_id or None,
                reason=args.reason,
            )
        else:
            return 1
        print(json.dumps({"ok": True, **result}, ensure_ascii=False))
        return 0
    except (ModuleProjectError, coc_module_assets.ModuleAssetsError, OSError, json.JSONDecodeError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
