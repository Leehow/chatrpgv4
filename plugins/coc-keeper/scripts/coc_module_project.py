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
DEFAULT_NEIGHBOR_PREFETCH_BUDGET = 4
NO_PREFETCH_LOCATION_TAGS = frozenset({"sandbox-hub"})
ROLE_TAG_RELATIONSHIP_ALIASES = {
    "superior": "superior_officer",
    "commanding": "commanding_officer",
}


def _load_sibling(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPT_DIR / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_fileio = _load_sibling("coc_fileio_module_project", "coc_fileio.py")
coc_module_assets = _load_sibling("coc_module_assets_project", "coc_module_assets.py")
coc_state = _load_sibling("coc_state_module_project", "coc_state.py")
coc_character_creation_briefing = _load_sibling(
    "coc_character_creation_briefing_module_project",
    "coc_character_creation_briefing.py",
)
coc_compiled_archive = _load_sibling(
    "coc_compiled_archive_module_project", "coc_compiled_archive.py"
)
coc_npc_roles = _load_sibling("coc_npc_roles_module_project", "coc_npc_roles.py")


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
        "source_refs": json.loads(json.dumps(loc.get("source_refs") or [])),
        "source_page_indices": list(loc.get("source_page_indices") or []),
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
                "flag_id": f"unlock:{src}:{dst}",
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
        "start_clock": json.loads(json.dumps(skeleton.get("start_clock"))),
        "start_clock_status": skeleton.get("start_clock_status") or "unbound",
        "start_clock_source_refs": json.loads(
            json.dumps(skeleton.get("start_clock_source_refs") or [])
        ),
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


def _voice_from_notes(value: Any) -> str | None:
    """Normalize host-pack voice notes for the canonical NPC consumers."""
    if isinstance(value, str) and value.strip():
        return value.strip()
    if isinstance(value, list):
        notes = [str(note).strip() for note in value if str(note).strip()]
        if notes:
            return "；".join(notes)
    return None


def _relationship_from_role_tags(value: Any) -> str | None:
    """Bridge structured host role tags into the canonical relationship enum."""
    if not isinstance(value, list):
        return None
    for tag in value:
        relationship = ROLE_TAG_RELATIONSHIP_ALIASES.get(str(tag).strip())
        if relationship:
            return relationship
    return None


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
        # Deep edges replace Tier-1 provisional topology, but must not erase
        # campaign-local routes created when a player materially digs a named
        # place. Those routes are part of the growing live map, not PDF guesses.
        deep_edges = json.loads(json.dumps(pack.get("scene_edges") or []))
        deep_targets = {
            (str(edge.get("to") or ""), str(edge.get("kind") or ""))
            for edge in deep_edges
            if isinstance(edge, dict)
        }
        for edge in scene.get("scene_edges") or []:
            if not isinstance(edge, dict) or edge.get("origin") != (
                "campaign_progressive_dig"
            ):
                continue
            identity = (
                str(edge.get("to") or ""), str(edge.get("kind") or ""),
            )
            if identity not in deep_targets:
                deep_edges.append(json.loads(json.dumps(edge)))
                deep_targets.add(identity)
        scene["scene_edges"] = deep_edges
    if pack.get("san_triggers") is not None:
        # Authored horror beats must reach the same canonical scene contract
        # consumed by scene.context and rules.sanity_check.  Without this
        # projection, an evidence-bound PDF trigger is mislabeled improvised.
        on_enter = scene.setdefault("on_enter", {})
        on_enter["san_triggers"] = json.loads(
            json.dumps(pack.get("san_triggers") or [])
        )
    scene["player_safe_summary"] = pack.get("player_safe_summary") or scene.get(
        "player_safe_summary"
    )
    # Provenance and source-quality evidence are part of the canonical entity,
    # not disposable parser metadata.  Preserve them on the same scene object
    # consumed by the compiler/archive/runtime.
    for key in (
        "source_refs", "source_span", "source_page_indices",
        "page_text_sha256", "source_evidence", "source_discrepancies",
        "location_tags", "entry_conditions", "importance",
    ):
        if pack.get(key) is not None:
            scene[key] = json.loads(json.dumps(pack[key]))

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
        # Clue packs are already validated at the asset boundary.  Copy the
        # full structured row so new semantic/provenance fields cannot vanish
        # merely because this projector predates them.
        row = json.loads(json.dumps(clue))
        row["clue_id"] = clue["clue_id"]
        row.setdefault("delivery_kind", "obvious")
        row.setdefault("visibility", "player-safe")
        row.setdefault("origin", "source")
        row["player_safe_summary"] = str(
            clue.get("player_safe_summary") or clue.get("summary") or ""
        )
        row.setdefault("parse_state", "deep")
        if row.get("skill"):
            row.setdefault("difficulty", "regular")
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
        relationship = npc.get("relationship_to_investigators")
        if not relationship or str(relationship) == "unknown":
            relationship = (
                _relationship_from_role_tags(npc.get("role_tags"))
                or base.get("relationship_to_investigators")
            )
        for key, value in npc.items():
            if key not in {
                "schema_version", "updated_at", "host_timing", "ingest_timing",
                "host_work_job_id",
            }:
                base[key] = json.loads(json.dumps(value))
        base.update({
            "name": npc.get("name") or npc.get("display_name") or nid,
            "display_name": npc.get("display_name") or npc.get("name") or nid,
            "agenda": (
                npc.get("agenda")
                or npc.get("agenda_public")
                or base.get("agenda")
                or f"{nid} agenda"
            ),
            "relationship_to_investigators": npc.get(
                "relationship_to_investigators"
            ) or relationship or "unknown",
            "voice": (
                npc.get("voice")
                or _voice_from_notes(npc.get("voice_notes"))
                or base.get("voice")
            ),
            "parse_state": npc.get("parse_state") or "deep",
            "origin": npc.get("origin") or "source",
        })
        social_role = npc.get("social_role")
        if isinstance(social_role, dict):
            base["social_role"] = json.loads(json.dumps(social_role))
        elif isinstance(social_role, str) and social_role.strip():
            # A natural-language job/title is display context, not a semantic
            # authority contract.  Preserve it without feeding free prose into
            # the Director's structured social-role engine.
            base["role_label"] = social_role.strip()
            base.pop("social_role", None)
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
    scene_secret_refs = list(scene.get("keeper_secret_refs") or [])
    scene_secret_ids = {
        str(ref.get("id") if isinstance(ref, dict) else ref)
        for ref in scene_secret_refs
        if ref
    }
    for sec in pack.get("keeper_secret_refs") or []:
        if not isinstance(sec, dict) or not sec.get("id"):
            continue
        secret_id = str(sec["id"])
        existing = next(
            (row for row in secrets if isinstance(row, dict) and row.get("id") == secret_id),
            None,
        )
        secret_row = existing if existing is not None else json.loads(json.dumps(sec))
        for key, value in sec.items():
            secret_row[key] = json.loads(json.dumps(value))
        secret_row["id"] = secret_id
        secret_row.setdefault("category", "keeper_secret")
        secret_row.setdefault("prose", "")
        linked_scenes = {
            str(value) for value in (secret_row.get("scene_ids") or []) if value
        }
        linked_scenes.add(lid)
        secret_row["scene_ids"] = sorted(linked_scenes)
        if existing is None:
            secrets.append(secret_row)
            existing_ids.add(secret_id)
        if secret_id not in scene_secret_ids:
            scene_secret_refs.append({"id": secret_id, "category": secret_row["category"]})
            scene_secret_ids.add(secret_id)
    scene["keeper_secret_refs"] = scene_secret_refs

    return out


def merge_deep_npc_into_ir(
    ir: dict[str, Any],
    pack: dict[str, Any],
) -> dict[str, Any]:
    """Upsert a standalone deep NPC pack into canonical campaign agendas."""
    out = {k: json.loads(json.dumps(v)) for k, v in ir.items()}
    nid = str(pack.get("npc_id") or "").strip()
    if not nid:
        raise ModuleProjectError("deep NPC pack missing npc_id")
    npcs = out["npc-agendas.json"].setdefault("npcs", [])
    base = next((row for row in npcs if row.get("npc_id") == nid), None)
    if base is None:
        base = {"npc_id": nid, "origin": "source"}
        npcs.append(base)
    for key, value in pack.items():
        if key not in {
            "schema_version", "updated_at", "host_timing", "ingest_timing",
            "host_work_job_id",
        }:
            base[key] = json.loads(json.dumps(value))
    base.setdefault("name", pack.get("display_name") or nid)
    base.setdefault("display_name", pack.get("name") or nid)
    if not pack.get("agenda") and pack.get("agenda_public"):
        base["agenda"] = pack["agenda_public"]
    base.setdefault("agenda", f"{nid} agenda")
    if not pack.get("voice"):
        voice = _voice_from_notes(pack.get("voice_notes"))
        if voice:
            base["voice"] = voice
    relationship = base.get("relationship_to_investigators")
    if not relationship or str(relationship) == "unknown":
        relationship = _relationship_from_role_tags(pack.get("role_tags"))
    base["relationship_to_investigators"] = relationship or "unknown"
    social_role = pack.get("social_role")
    if isinstance(social_role, dict):
        base["social_role"] = json.loads(json.dumps(social_role))
    elif isinstance(social_role, str) and social_role.strip():
        base["role_label"] = social_role.strip()
        base.pop("social_role", None)
    base["parse_state"] = pack.get("parse_state") or "deep"
    base["origin"] = pack.get("origin") or "source"

    scene_ids = {
        str(scene_id)
        for scene_id in (pack.get("scene_ids") or [])
        if str(scene_id).strip()
    }
    for schedule_row in pack.get("schedule") or []:
        if not isinstance(schedule_row, dict):
            continue
        scene_ids.update(
            str(scene_id)
            for scene_id in (schedule_row.get("scene_ids") or [])
            if str(scene_id).strip()
        )
    for scene in out["story-graph.json"].setdefault("scenes", []):
        if scene.get("scene_id") in scene_ids:
            ids = scene.setdefault("npc_ids", [])
            if nid not in ids:
                ids.append(nid)
    return out


def merge_deep_clue_into_ir(
    ir: dict[str, Any],
    pack: dict[str, Any],
) -> dict[str, Any]:
    """Upsert a standalone deep clue while preserving its structured evidence."""
    out = {k: json.loads(json.dumps(v)) for k, v in ir.items()}
    clue_id = str(pack.get("clue_id") or "").strip()
    if not clue_id:
        raise ModuleProjectError("deep clue pack missing clue_id")
    conclusions = out["clue-graph.json"].setdefault("conclusions", [])
    conclusion_id = str(pack.get("conclusion_id") or "progressive-local")
    conclusion = next(
        (row for row in conclusions if row.get("conclusion_id") == conclusion_id),
        None,
    )
    if conclusion is None:
        conclusion = {
            "conclusion_id": conclusion_id,
            "importance": pack.get("importance") or "supporting",
            "description": pack.get("conclusion_description")
            or "On-demand deep-parsed local clues",
            "minimum_routes": 1,
            "origin": "source",
            "clues": [],
        }
        conclusions.append(conclusion)
    clues = conclusion.setdefault("clues", [])
    base = next((row for row in clues if row.get("clue_id") == clue_id), None)
    if base is None:
        base = {"clue_id": clue_id, "origin": "source"}
        clues.append(base)
    for key, value in pack.items():
        if key not in {
            "schema_version", "updated_at", "evidence_gap",
            "host_timing", "ingest_timing", "host_work_job_id",
        }:
            base[key] = json.loads(json.dumps(value))
    base.setdefault("delivery_kind", "obvious")
    base.setdefault("visibility", "player-safe")
    base["parse_state"] = pack.get("parse_state") or "deep"
    for scene_id in pack.get("scene_ids") or []:
        scene = next(
            (row for row in out["story-graph.json"].setdefault("scenes", [])
             if row.get("scene_id") == scene_id),
            None,
        )
        if scene is not None:
            available = scene.setdefault("available_clues", [])
            if clue_id not in available:
                available.append(clue_id)
    return out


def merge_deep_threat_into_ir(
    ir: dict[str, Any],
    pack: dict[str, Any],
) -> dict[str, Any]:
    """Upsert a standalone deep threat into the Director-consumed front list."""
    out = {k: json.loads(json.dumps(v)) for k, v in ir.items()}
    tid = str(pack.get("threat_id") or pack.get("front_id") or "").strip()
    if not tid:
        raise ModuleProjectError("deep threat pack missing threat_id")
    fronts = out["threat-fronts.json"].setdefault("fronts", [])
    base = next(
        (row for row in fronts if row.get("front_id") == tid),
        None,
    )
    if base is None:
        base = {
            "front_id": tid,
            "clock_id": f"clock-{tid}",
            "segments": 4,
            "value": 0,
            "scene_ids": [],
        }
        fronts.append(base)
    for key, value in pack.items():
        if key not in {
            "schema_version", "updated_at", "threat_id",
            "host_timing", "ingest_timing", "host_work_job_id",
        }:
            base[key] = json.loads(json.dumps(value))
    base["front_id"] = tid
    base.setdefault("label", tid)
    base.setdefault("on_tick_visible", base["label"])
    base["parse_state"] = pack.get("parse_state") or "deep"
    return out


def merge_deep_entity_into_ir(
    ir: dict[str, Any],
    entity_kind: str,
    pack: dict[str, Any],
) -> dict[str, Any]:
    """Dispatch a ready entity pack to its canonical campaign consumer."""
    mergers = {
        "location": merge_deep_location_into_ir,
        "npc": merge_deep_npc_into_ir,
        "clue": merge_deep_clue_into_ir,
        "threat": merge_deep_threat_into_ir,
    }
    try:
        merger = mergers[entity_kind]
    except KeyError as exc:
        raise ModuleProjectError(
            f"entity kind {entity_kind!r} has no campaign IR consumer"
        ) from exc
    return merger(ir, pack)


def _sync_campaign_era_clock_from_meta(
    campaign_dir: Path,
    meta: dict[str, Any],
) -> None:
    """Align campaign era + pristine clock with progressive module meta.

    Freeform labels (e.g. ``1597 Spain``) are normalized via
    ``coc_state.normalize_era``. The civil clock is seeded only before live
    play mutates it. Progressive IR projection owns authored setup, never a
    later time shift, loop reset, scene clock, or ordinary elapsed time.
    """
    if not isinstance(meta, dict):
        return
    identity = meta.get("module_identity") if isinstance(meta.get("module_identity"), dict) else {}
    era_raw = meta.get("era") or identity.get("era")
    start_clock = meta.get("start_clock")
    authored_era = bool(
        era_raw
        and str(era_raw).strip().lower() not in {"unknown", "none", "null"}
    )
    if not authored_era and not isinstance(start_clock, dict):
        return
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
    era_key = coc_state.normalize_era(
        str(era_raw) if authored_era else str(camp.get("era") or "1920s")
    )
    changed = authored_era and camp.get("era") != era_key
    if authored_era:
        camp["era"] = era_key
    # Prefer module identity era field to stay canonical for later readers.
    if authored_era and isinstance(identity, dict) and not identity.get("era"):
        identity = dict(identity)
        identity["era"] = era_key
        meta = dict(meta)
        meta["module_identity"] = identity
        meta["era"] = era_key
    if changed:
        _write_json(camp_path, camp)
    # Reseed only a genuinely pristine clock. ``elapsed == 0`` alone is not a
    # setup signal: an authored time jump can happen instantly, and later deep
    # pack projection must not overwrite that live civil-calendar anchor.
    time_path = campaign_dir / "save" / "time-state.json"
    elapsed = 0
    sequence = 0
    anchors: dict[str, Any] = {}
    civil_segment_id: Any = None
    time_state_missing = not time_path.is_file()
    if time_path.is_file():
        try:
            ts = json.loads(time_path.read_text(encoding="utf-8"))
            clock = ts.get("clock") if isinstance(ts, dict) else {}
            if isinstance(clock, dict):
                elapsed = int(clock.get("elapsed_minutes") or 0)
                civil_segment_id = clock.get("civil_segment_id")
            if isinstance(ts, dict):
                sequence = int(ts.get("sequence") or 0)
                if isinstance(ts.get("anchors"), dict):
                    anchors = ts["anchors"]
        except (OSError, json.JSONDecodeError, TypeError, ValueError):
            elapsed = 0
            sequence = 0
            anchors = {}
            civil_segment_id = None
    pristine = time_state_missing or (
        elapsed == 0
        and sequence == 0
        and not anchors.get("last_scene_change_decision_id")
        and not anchors.get("last_clock_discontinuity_decision_id")
        and civil_segment_id in {None, "", "civil-start"}
    )
    if pristine:
        coc_state.reseed_campaign_clock_for_era(
            campaign_dir,
            camp_id,
            era_key,
            preserve_elapsed=True,
            start_clock=start_clock if isinstance(start_clock, dict) else None,
        )


def _refresh_character_creation_briefing_if_stale(
    campaign_dir: Path,
) -> str | None:
    """Refresh the player setup derivative after public IR metadata changes."""
    campaign_path = campaign_dir / "campaign.json"
    if not campaign_path.is_file():
        return None
    campaign = _load_json(campaign_path, {})
    scenario = _load_json(campaign_dir / "scenario" / "scenario.json", {})
    module_meta = _load_json(
        campaign_dir / "scenario" / "module-meta.json", {},
    )
    source_map = _load_json(campaign_dir / "index" / "source-map.json", {})
    if not isinstance(campaign, dict):
        return None
    language = str(campaign.get("play_language") or "zh-Hans")
    expected_digest = coc_character_creation_briefing.public_setup_sha256(
        campaign,
        scenario if isinstance(scenario, dict) else {},
        module_meta if isinstance(module_meta, dict) else {},
        source_map if isinstance(source_map, dict) else {},
        language=language,
    )
    current = (
        campaign.get("character_creation")
        if isinstance(campaign.get("character_creation"), dict)
        else {}
    )
    workspace = campaign_dir.parents[2]
    current_path_raw = str(current.get("briefing_path") or "").strip()
    current_path = Path(current_path_raw) if current_path_raw else None
    if current_path is not None and not current_path.is_absolute():
        current_path = workspace / current_path
    if (
        current.get("public_setup_sha256") == expected_digest
        and current_path is not None
        and current_path.is_file()
    ):
        return None
    rendered = coc_character_creation_briefing.render_briefing_from_campaign(
        campaign_dir,
        repo_root=workspace,
        language=language,
        write_back=True,
    )
    rendered_path = Path(rendered["briefing_path"])
    if not rendered_path.is_absolute():
        rendered_path = workspace / rendered_path
    return str(rendered_path)


def write_ir_to_campaign(
    campaign_dir: Path,
    ir: dict[str, Any],
    *,
    asset_root_id: str | None = None,
    publish_compiled_archive: bool = True,
) -> list[str]:
    scenario_dir = campaign_dir / "scenario"
    scenario_dir.mkdir(parents=True, exist_ok=True)
    ir = dict(ir)
    npc_agendas = ir.get("npc-agendas.json")
    if isinstance(npc_agendas, dict):
        rules_dir = SCRIPT_DIR.parent / "references" / "rules-json"
        ir["npc-agendas.json"] = coc_npc_roles.expand_npc_social_roles(
            npc_agendas,
            coc_npc_roles.load_role_templates(rules_dir),
            keywords=coc_npc_roles.load_role_mappings(rules_dir),
        )
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
    briefing_path = _refresh_character_creation_briefing_if_stale(campaign_dir)
    if briefing_path is not None:
        written.append(briefing_path)
    # Materialized archive is rebuildable only; never block or roll back IR.
    if publish_compiled_archive:
        archive_result = coc_compiled_archive.publish_from_ir(campaign_dir, ir)
        if not archive_result.get("ok"):
            # Explicit status already recorded by publish_from_ir / record_error.
            pass
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
    # A host-supplied opening pack is reusable module truth, not a one-off IR
    # patch. Persist it through the canonical entity store before projection
    # so first scene entry and later campaigns do not request it again.
    for pack in packs:
        if not isinstance(pack, dict):
            raise ModuleProjectError("opening deep pack must be an object")
        location_id = str(pack.get("location_id") or "").strip()
        if not location_id:
            raise ModuleProjectError("opening deep pack requires location_id")
        try:
            coc_module_assets.put_entity(
                workspace, asset_root_id, "location", location_id, pack,
            )
        except coc_module_assets.ModuleAssetsError as exc:
            raise ModuleProjectError(str(exc)) from exc
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


def _is_usable_location_pack(pack: Any) -> bool:
    return (
        isinstance(pack, dict)
        and str(pack.get("parse_state") or "") in {
            "partial", "deep", "body_parsed",
        }
        and not pack.get("evidence_gap")
    )


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
    - Materialize structured mentions as source-scoped named-only stubs.
    - Enqueue a mention only after a player-visible clue follows it or the
      player materially pursues it through ``request_deepen``.
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

    pack = coc_module_assets.get_entity(workspace, root_id, "location", sid)
    merged = False
    if _is_usable_location_pack(pack):
        ir = load_campaign_ir(campaign_dir)
        ir = merge_deep_location_into_ir(ir, pack)
        write_ir_to_campaign(campaign_dir, ir, asset_root_id=root_id)
        merged = True
        actions.append({
            "merged_pack": sid,
            "parse_state": pack.get("parse_state"),
        })
        # Pack mentions are topology/index facts, not proof that the player is
        # pursuing every referenced entity.  Materialize narrow source-scoped
        # stubs now; explicit dig and discovered-clue paths own enqueueing.
        for mention in _scoped_mentions(pack):
            kind = str(mention.get("kind") or "").strip()
            ref = str(mention.get("ref_id") or "").strip()
            if kind not in coc_module_assets.ENTITY_KINDS or not ref:
                continue
            stub = coc_module_assets.ensure_stub(
                workspace, root_id, kind, ref,
                title=str(mention.get("raw_label") or ref),
                reason=f"mention_from:{sid}",
                source_scope=_source_scope(mention),
            )
            actions.append({"ensure_stub": stub})
    if not pack or not _is_deep_state(pack.get("parse_state")) or pack.get(
        "evidence_gap"
    ):
        q = coc_module_assets.enqueue_job(
            workspace, root_id,
            kind="deepen_location",
            target_id=sid,
            priority=100,
            reason=f"enter:{sid}",
        )
        actions.append({"enqueue": q})
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

    active_location = next(
        (
            row for row in (skeleton.get("locations") or [])
            if isinstance(row, dict) and str(row.get("location_id") or "") == sid
        ),
        {},
    )
    active_tags = {
        str(tag) for tag in (active_location.get("location_tags") or [])
    }
    if isinstance(pack, dict):
        active_tags.update(
            str(tag) for tag in (pack.get("location_tags") or [])
        )
    prefetch_budget = (
        0
        if active_tags & NO_PREFETCH_LOCATION_TAGS
        else DEFAULT_NEIGHBOR_PREFETCH_BUDGET
    )
    prefetched_neighbors: list[str] = []
    deferred_neighbors: list[str] = []
    for nid in unique_neighbors:
        stub = coc_module_assets.ensure_stub(
            workspace, root_id, "location", nid,
            reason=f"neighbor_of:{sid}",
        )
        actions.append({"ensure_stub": stub})
        n_pack = coc_module_assets.get_entity(workspace, root_id, "location", nid)
        if n_pack and _is_deep_state(n_pack.get("parse_state")):
            # A durable deep pack is already reusable.  Do not merge or queue
            # an unvisited neighbor merely because the active scene links it.
            deferred_neighbors.append(nid)
            continue
        if len(prefetched_neighbors) >= prefetch_budget:
            deferred_neighbors.append(nid)
            continue
        eq = coc_module_assets.enqueue_job(
            workspace, root_id,
            kind="partial_neighbor",
            target_id=nid,
            priority=40,
            reason=f"neighbor_of:{sid}",
        )
        prefetched_neighbors.append(nid)
        host_hints.append(
            f"host: optional partial prefetch for neighbor {nid!r}"
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
        "prefetched_neighbors": prefetched_neighbors,
        "deferred_neighbors": deferred_neighbors,
        "neighbor_prefetch_budget": prefetch_budget,
        "host_hints": host_hints,
        "actions": actions,
        "queue": _compact_queue_snapshot(
            coc_module_assets.list_queue(workspace, root_id)
        ),
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
    module_dir = coc_module_assets.assets_root(workspace) / root_id
    path = module_dir / "parse-queue.json"
    merged_ids: list[str] = []
    pending_count = 0
    with coc_fileio.advisory_file_lock(module_dir / "parse-queue.lock"):
        queue = coc_module_assets.list_queue(workspace, root_id)
        pending = list(queue.get("pending") or [])
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
        pending_count = len(still_pending) if ir is not None else len(pending)
        if ir is not None and merged_ids:
            write_ir_to_campaign(campaign_dir, ir, asset_root_id=root_id)
            _write_json(path, {
                "schema_version": coc_module_assets.SCHEMA_VERSION,
                "pending": still_pending,
                "in_flight": queue.get("in_flight") or [],
                "done": coc_module_assets.dedupe_done_jobs(done, limit=100),
            })
    return {
        "merged_location_ids": merged_ids,
        "pending_remaining": pending_count,
    }


_JOB_KIND_FOR_ENTITY = dict(coc_module_assets.JOB_KIND_FOR_ENTITY)
_SOURCE_SCOPE_FIELDS = (
    "source_refs", "source_span", "source_page_indices", "page_text_sha256",
)


def _source_scope(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    return {
        field: json.loads(json.dumps(value[field]))
        for field in _SOURCE_SCOPE_FIELDS
        if value.get(field) is not None
    }


def _scoped_mentions(container: Any) -> list[dict[str, Any]]:
    """Copy structured mentions and inherit their enclosing source scope.

    This is provenance propagation only; mention kind/ref_id remain authored
    structured data and no free prose is interpreted here.
    """
    if not isinstance(container, dict):
        return []
    inherited = _source_scope(container)
    out: list[dict[str, Any]] = []
    for raw in container.get("mentions") or []:
        if not isinstance(raw, dict):
            continue
        mention = json.loads(json.dumps(raw))
        if not _source_scope(mention) and inherited:
            mention.update(json.loads(json.dumps(inherited)))
        out.append(mention)
    return out


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
        existing = {
            "location_id": lid,
            "title": title or lid,
            "parse_state": "named_only",
            "scene_type": "investigation",
            "location_tags": [lid],
            "is_final": False,
        }
        locs.append(existing)
        skeleton["locations"] = locs
        created = True
    elif title and not existing.get("title"):
        existing["title"] = title
    source_scope_changed = False
    pack = coc_module_assets.get_entity(
        workspace, asset_root_id, "location", lid,
    )
    for field, value in _source_scope(pack).items():
        if existing.get(field) != value:
            existing[field] = value
            source_scope_changed = True
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
    if created or edge_added or source_scope_changed or (title and existing is not None):
        errors = coc_module_assets.validate_skeleton(skeleton)
        if errors:
            raise ModuleProjectError("skeleton invalid after dig attach: " + "; ".join(errors[:5]))
        coc_module_assets.put_skeleton(workspace, asset_root_id, skeleton)
    return {
        "location_id": lid,
        "created_on_skeleton": created,
        "edge_added": edge_added,
        "source_scope_changed": source_scope_changed,
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
    skeleton = coc_module_assets.get_skeleton(workspace, root_id) or {}
    skeleton_location = next(
        (
            row for row in skeleton.get("locations") or []
            if isinstance(row, dict) and str(row.get("location_id") or "") == lid
        ),
        None,
    )
    if scene is None:
        scene = skeleton_scene_from_location(
            skeleton_location or {
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
        for field, value in _source_scope(skeleton_location).items():
            scene[field] = value
    # Link edges on both ends in IR
    src = str(link_from or "").strip()
    if src and src != lid:
        def _ensure_edge(from_id: str, to_id: str) -> None:
            sc = next((s for s in scenes if str(s.get("scene_id")) == from_id), None)
            if sc is None:
                return
            edges = list(sc.get("scene_edges") or [])
            existing_edge = next(
                (e for e in edges if str(e.get("to")) == to_id), None,
            )
            if existing_edge is not None:
                # The route has now been established by live player dig even
                # if it originated as provisional skeleton topology.
                existing_edge["origin"] = "campaign_progressive_dig"
                sc["scene_edges"] = edges
                return
            edges.append({
                "to": to_id,
                "kind": "travel",
                "when": {"kind": "always"},
                "origin": "campaign_progressive_dig",
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
        "source_evidence": json.loads(json.dumps(pack.get("source_evidence"))),
        "ingest_timing": json.loads(json.dumps(pack.get("ingest_timing"))),
    }


def _compact_queue_snapshot(queue: dict[str, Any]) -> dict[str, Any]:
    """Bound queue evidence returned on the live dig path.

    The durable parse queue keeps its full capped history on disk.  Returning
    that entire history after every mention/deepen call makes normal Keeper
    context grow with the length of the campaign, even when no work is
    pending.  Live callers need the active work plus a small audit tail; the
    full durable queue remains available to repository diagnostics.
    """
    done = list(queue.get("done") or [])
    def median_ms(field: str) -> int | None:
        values = sorted(
            int(row[field])
            for row in done
            if isinstance(row, dict)
            and isinstance(row.get(field), int)
            and not isinstance(row.get(field), bool)
        )
        if not values:
            return None
        middle = len(values) // 2
        if len(values) % 2:
            return values[middle]
        return round((values[middle - 1] + values[middle]) / 2)

    total_values = [
        int(row["total_ms"])
        for row in done
        if isinstance(row, dict)
        and isinstance(row.get("total_ms"), int)
        and not isinstance(row.get("total_ms"), bool)
    ]
    tail_fields = (
        "job_id", "kind", "target_id", "result", "failed",
        "enqueued_at", "completed_at", "total_ms", "processing_ms",
        "requeue_count",
    )
    done_tail = [
        {key: row[key] for key in tail_fields if key in row}
        for row in done[-5:]
        if isinstance(row, dict)
    ]
    awaiting_host = [
        row for row in done
        if isinstance(row, dict) and row.get("result") == "awaiting_host_pack"
    ]
    return {
        "schema_version": queue.get("schema_version"),
        "pending": list(queue.get("pending") or []),
        "in_flight": list(queue.get("in_flight") or []),
        "done_count": len(done),
        "done_tail": done_tail,
        "awaiting_host_count": len(awaiting_host),
        "awaiting_host_tail": [
            {key: row[key] for key in tail_fields if key in row}
            for row in awaiting_host[-5:]
        ],
        "timing_ms": {
            "measured_count": len(total_values),
            "median_total": median_ms("total_ms"),
            "median_processing": median_ms("processing_ms"),
            "median_queue_worker_processing": median_ms("processing_ms"),
            "max_total": max(total_values) if total_values else None,
            "scope_note": (
                "queue timings cover scheduling/merge only; source_compile_ms "
                "is reported per entity under ingest_timing"
            ),
        },
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
        source_scope = _source_scope(mention)
        if not source_scope:
            source_scope = _campaign_entity_source_scope(
                campaign_dir, kind, ref,
            )
        stub = coc_module_assets.ensure_stub(
            workspace, root_id, kind, ref,
            title=label,
            reason=reason,
            source_scope=source_scope,
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
        status = _entity_status(workspace, root_id, kind, ref)
        if not status["deep_ready"]:
            # Mark stub dig targets as evidence_gap so KP never invents bodies.
            pack = coc_module_assets.get_entity(workspace, root_id, kind, ref)
            if (
                pack
                and not _is_deep_state(pack.get("parse_state"))
                and not (pack.get("evidence_gap") and pack.get("dig_pending"))
            ):
                pack = dict(pack)
                pack["evidence_gap"] = True
                pack["dig_pending"] = True
                pack.setdefault("dig_reason", reason)
                if kind == "location" and label:
                    pack["title"] = pack.get("title") or label
                coc_module_assets.put_entity(workspace, root_id, kind, ref, pack)
                status = _entity_status(workspace, root_id, kind, ref)
        job_kind = _JOB_KIND_FOR_ENTITY.get(kind)
        enqueue_result = None
        if job_kind and not status["deep_ready"]:
            enqueue_result = coc_module_assets.enqueue_job(
                workspace, root_id,
                kind=job_kind,
                target_id=ref,
                priority=priority,
                reason=reason,
            )
            actions.append({"enqueue": enqueue_result})
        if not status["deep_ready"]:
            if (enqueue_result or {}).get("dedupe_state") == "awaiting_host_pack":
                host_hints.append(
                    f"host: existing deep-extract request still covers {kind} {ref!r}; "
                    "reuse it unless the source scope changes"
                )
            else:
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
            "dedupe_state": (enqueue_result or {}).get("dedupe_state"),
            "canonical_scene_id": ref if kind == "location" else None,
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
        "queue": _compact_queue_snapshot(
            coc_module_assets.list_queue(workspace, root_id)
        ),
    }


def _campaign_entity_source_scope(
    campaign_dir: Path,
    kind: str,
    entity_id: str,
) -> dict[str, Any]:
    """Reuse exact source scope already projected into canonical campaign IR."""
    try:
        ir = load_campaign_ir(campaign_dir)
    except ModuleProjectError:
        return {}
    rows: list[dict[str, Any]] = []
    if kind == "location":
        rows = list((ir.get("story-graph.json") or {}).get("scenes") or [])
        keys = ("scene_id",)
    elif kind == "npc":
        rows = list((ir.get("npc-agendas.json") or {}).get("npcs") or [])
        keys = ("npc_id",)
    elif kind == "clue":
        rows = [
            clue
            for conclusion in (
                (ir.get("clue-graph.json") or {}).get("conclusions") or []
            )
            if isinstance(conclusion, dict)
            for clue in (conclusion.get("clues") or [])
            if isinstance(clue, dict)
        ]
        keys = ("clue_id",)
    elif kind == "handout":
        rows = [
            clue
            for conclusion in (
                (ir.get("clue-graph.json") or {}).get("conclusions") or []
            )
            if isinstance(conclusion, dict)
            for clue in (conclusion.get("clues") or [])
            if isinstance(clue, dict)
        ]
        keys = ("handout_id",)
    elif kind == "threat":
        rows = list((ir.get("threat-fronts.json") or {}).get("fronts") or [])
        keys = ("threat_id", "front_id")
    else:
        return {}
    for row in rows:
        if any(str(row.get(key) or "") == entity_id for key in keys):
            return _source_scope(row)
    return {}


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
                    mentions.extend(_scoped_mentions(clue))
    except ModuleProjectError:
        pass
    # Also check entity pack if present.
    pack = coc_module_assets.get_entity(workspace, root_id, "clue", clue_id)
    if pack and pack.get("mentions"):
        mentions.extend(_scoped_mentions(pack))
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
                        mentions.extend(_scoped_mentions(clue))

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
