#!/usr/bin/env python3
"""Project progressive module-assets into campaign Scenario IR.

Slice 2–3 of docs/active-plans/coc-on-demand-module-skeleton.md:
- skeleton → sparse story-graph topology
- deep location/NPC/clue packs → opening-playable seven-file projection

Does not run host PDF extraction. Does not claim full coc_scenario_compile green.
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

REQUIRED_FILES = (
    "module-meta.json",
    "story-graph.json",
    "clue-graph.json",
    "npc-agendas.json",
    "threat-fronts.json",
    "pacing-map.json",
    "improvisation-boundaries.json",
)
# Scenario files written/projected when present but not required by every
# legacy loader. ``handouts.json`` is the campaign-side verbatim info card
# store consumed by state delivery and player projections; ``quests.json``
# is the eighth-file action-quest IR (absent = questless module is legal).
OPTIONAL_IR_FILES = (
    "handouts.json",
    "quests.json",
)
_QUEST_ID_RE = re.compile(r"^quest-[a-z0-9-]+$")
DEFAULT_NEIGHBOR_PREFETCH_BUDGET = 4
NO_PREFETCH_LOCATION_TAGS = frozenset({"sandbox-hub"})
ROLE_TAG_RELATIONSHIP_ALIASES = {
    "superior": "superior_officer",
    "commanding": "commanding_officer",
}
SCENE_CONTRACT_SCHEMA_VERSION = 1
SCENE_CONTRACT_ROLES = frozenset({
    "transit", "investigation", "main", "climax", "epilogue",
})
SCENE_CONTRACT_TRUTH_KEYS = frozenset({
    "max_tier", "max_bridge_clues", "allowed_domains", "forbidden_domains",
})
SCENE_CONTRACT_BUDGET_KEYS = frozenset({
    "named_npcs", "new_locations", "local_clues", "complications",
    "soft_turn_limit", "review_turn_limit",
})
SCENE_CONTRACT_KEYS = frozenset({
    "schema_version", "scene_contract_id", "scene_id", "role",
    "authored_purposes", "truth_scope", "improv_budget", "exit_affordances",
})


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
coc_rulesets = _load_sibling("coc_rulesets_module_project", "coc_rulesets.py")
coc_scenario = _load_sibling("coc_scenario_module_project", "coc_scenario.py")


class ModuleProjectError(ValueError):
    """Progressive IR projection failed."""


class OpeningPreparationError(ModuleProjectError):
    """Typed source/start/readiness failure for the opening bridge."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


class OpeningStructuredCollisionError(ModuleProjectError):
    """One structured row aliases multiple authored opening identities."""


def _scene_contract_string_list(
    value: Any, *, field: str,
) -> list[str]:
    if not isinstance(value, list):
        raise ModuleProjectError(f"scene_contract.{field} must be a string array")
    normalized: list[str] = []
    for raw in value:
        if not isinstance(raw, str) or not raw.strip():
            raise ModuleProjectError(
                f"scene_contract.{field} must contain non-empty strings"
            )
        item = raw.strip()
        if item in normalized:
            raise ModuleProjectError(
                f"scene_contract.{field} must not contain duplicates"
            )
        normalized.append(item)
    return normalized


def _scene_contract_nonnegative_int(value: Any, *, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ModuleProjectError(
            f"scene_contract.{field} must be a non-negative integer"
        )
    return value


def _scene_contract_digest(scene_id: str, payload: dict[str, Any]) -> str:
    encoded = json.dumps(
        {"scene_id": scene_id, "contract": payload},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return f"scene-contract-v1:{hashlib.sha256(encoded).hexdigest()}"


def normalize_scene_contract(scene_id: str, raw: Any) -> dict[str, Any]:
    """Validate and bind one explicitly supplied authored scene contract.

    Absence is handled by callers and remains legal.  This function never
    invents a truth scope, purpose, budget, or exit for an absent contract.
    """
    stable_scene_id = str(scene_id or "").strip()
    if not stable_scene_id:
        raise ModuleProjectError("scene_contract requires a non-empty scene_id")
    if not isinstance(raw, dict):
        raise ModuleProjectError("scene_contract must be an object when supplied")
    unknown = sorted(set(raw) - SCENE_CONTRACT_KEYS)
    if unknown:
        raise ModuleProjectError(
            "scene_contract has unsupported field(s): " + ", ".join(unknown)
        )
    supplied_scene_id = raw.get("scene_id")
    if supplied_scene_id is not None and str(supplied_scene_id).strip() != stable_scene_id:
        raise ModuleProjectError("scene_contract.scene_id does not match the scene")
    schema_version = raw.get("schema_version", SCENE_CONTRACT_SCHEMA_VERSION)
    if schema_version != SCENE_CONTRACT_SCHEMA_VERSION:
        raise ModuleProjectError("scene_contract.schema_version must equal 1")
    role = str(raw.get("role") or "").strip()
    if role not in SCENE_CONTRACT_ROLES:
        raise ModuleProjectError(
            "scene_contract.role must be transit|investigation|main|climax|epilogue"
        )

    normalized: dict[str, Any] = {
        "schema_version": SCENE_CONTRACT_SCHEMA_VERSION,
        "scene_id": stable_scene_id,
        "role": role,
    }
    if "authored_purposes" in raw:
        normalized["authored_purposes"] = _scene_contract_string_list(
            raw["authored_purposes"], field="authored_purposes"
        )
    if "truth_scope" in raw:
        scope = raw["truth_scope"]
        if not isinstance(scope, dict):
            raise ModuleProjectError("scene_contract.truth_scope must be an object")
        unknown_scope = sorted(set(scope) - SCENE_CONTRACT_TRUTH_KEYS)
        if unknown_scope:
            raise ModuleProjectError(
                "scene_contract.truth_scope has unsupported field(s): "
                + ", ".join(unknown_scope)
            )
        if "max_tier" not in scope:
            raise ModuleProjectError("scene_contract.truth_scope.max_tier is required")
        max_tier = scope["max_tier"]
        if (
            isinstance(max_tier, bool)
            or not isinstance(max_tier, int)
            or not 0 <= max_tier <= 4
        ):
            raise ModuleProjectError(
                "scene_contract.truth_scope.max_tier must be an integer from 0 to 4"
            )
        normalized_scope: dict[str, Any] = {"max_tier": max_tier}
        if "max_bridge_clues" in scope:
            normalized_scope["max_bridge_clues"] = _scene_contract_nonnegative_int(
                scope["max_bridge_clues"], field="truth_scope.max_bridge_clues"
            )
        for field in ("allowed_domains", "forbidden_domains"):
            if field in scope:
                normalized_scope[field] = _scene_contract_string_list(
                    scope[field], field=f"truth_scope.{field}"
                )
        normalized["truth_scope"] = normalized_scope
    if "improv_budget" in raw:
        budget = raw["improv_budget"]
        if not isinstance(budget, dict):
            raise ModuleProjectError("scene_contract.improv_budget must be an object")
        unknown_budget = sorted(set(budget) - SCENE_CONTRACT_BUDGET_KEYS)
        if unknown_budget:
            raise ModuleProjectError(
                "scene_contract.improv_budget has unsupported field(s): "
                + ", ".join(unknown_budget)
            )
        normalized["improv_budget"] = {
            key: _scene_contract_nonnegative_int(
                value, field=f"improv_budget.{key}"
            )
            for key, value in budget.items()
        }
    if "exit_affordances" in raw:
        normalized["exit_affordances"] = _scene_contract_string_list(
            raw["exit_affordances"], field="exit_affordances"
        )

    payload = json.loads(json.dumps(normalized))
    expected_id = _scene_contract_digest(stable_scene_id, payload)
    supplied_id = raw.get("scene_contract_id")
    if supplied_id is not None and str(supplied_id).strip() != expected_id:
        raise ModuleProjectError(
            "scene_contract.scene_contract_id does not bind this scene and payload"
        )
    normalized["scene_contract_id"] = expected_id
    return normalized


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
        # A named_only/toc_only/partial skeleton scene has no parsed source
        # body: it is evidence-gap by definition until a deep pack lands.  Only
        # deep/body_parsed rows (or an explicit skeleton claim) may mark the
        # scene closed, so scene.context never presents stub refs as complete.
        "evidence_gap": (
            bool(loc.get("evidence_gap"))
            if _is_deep_state(parse_state)
            else True
        ),
        "source_span": loc.get("source_span"),
        "source_refs": json.loads(json.dumps(loc.get("source_refs") or [])),
        "source_page_indices": list(loc.get("source_page_indices") or []),
        "scene_contract": (
            normalize_scene_contract(lid, loc["scene_contract"])
            if "scene_contract" in loc
            else None
        ),
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


def _project_locator_mechanics(locator: dict[str, Any]) -> dict[str, Any]:
    """Project a skeleton mechanics_index row without dropping locator proof."""
    status = str(locator.get("status") or "unresolved")
    if status not in {"located", "not_authored", "unresolved"}:
        status = "unresolved"
    mechanics: dict[str, Any] = {"status": status}
    for key in (
        "locator_pass_status",
        "locator_scope",
        "source_page_indices",
        "source_refs",
        "absence_receipt",
        "provenance",
    ):
        if locator.get(key) is not None:
            mechanics[key] = json.loads(json.dumps(locator[key]))
    return mechanics


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
    mechanics_locators = json.loads(
        json.dumps(skeleton.get("mechanics_index") or [])
    )
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
        "module_mechanics": {
            "schema_version": 1,
            "locators": mechanics_locators,
            "locator_pass_status": skeleton.get("mechanics_locator_pass_status"),
            "locator_scope": json.loads(
                json.dumps(skeleton.get("mechanics_locator_scope"))
            ) if skeleton.get("mechanics_locator_scope") is not None else None,
            "items": {},
        },
        "player_safe_summary": str(skeleton.get("player_safe_summary") or ""),
        # The Keeper-facing summary is the module's own account of what is
        # happening; it comes from the keeper-truth section, not from a
        # sentence describing the parser.  "Resolve the investigation." was
        # likewise a placeholder that read as an authored win condition.
        "summary": None,
        "summary_state": "unresolved",
        "win_condition": (
            str((skeleton.get("finale_buckets") or [{}])[0].get("title"))
            if skeleton.get("finale_buckets")
            else None
        ),
        "win_condition_state": (
            "source" if skeleton.get("finale_buckets") else "unresolved"
        ),
    }

    locator_by_subject = {
        (str(row.get("subject_kind") or ""), str(row.get("subject_id") or "")): row
        for row in mechanics_locators
        if isinstance(row, dict)
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
        npc_row = {
            "npc_id": nid,
            "name": display,
            "display_name": display,
            "agenda": str(npc.get("agenda") or f"{display} has not been deep-parsed yet."),
            "relationship_to_investigators": str(
                npc.get("relationship_to_investigators") or "unknown"
            ),
            "parse_state": npc.get("parse_state") or "named_only",
            "origin": "source",
        }
        locator = locator_by_subject.get(("npc", nid))
        if isinstance(locator, dict):
            npc_row["mechanics"] = _project_locator_mechanics(locator)
        npc_rows.append(npc_row)

    for item in skeleton.get("item_roster") or []:
        if not isinstance(item, dict):
            continue
        item_id = str(item.get("item_id") or "").strip()
        if not item_id:
            continue
        locator = locator_by_subject.get(("item", item_id))
        row = {
            "item_id": item_id,
            "label": str(item.get("label") or item.get("title") or item_id),
            "parse_state": item.get("parse_state") or "named_only",
            "origin": "source",
            "source_page_indices": list(item.get("source_page_indices") or []),
            "mechanics": (
                _project_locator_mechanics(locator)
                if isinstance(locator, dict)
                else {"status": "unresolved"}
            ),
        }
        meta["module_mechanics"]["items"][item_id] = row

    threat_fronts = []
    for threat in skeleton.get("threats") or []:
        if not isinstance(threat, dict):
            continue
        tid = str(threat.get("threat_id") or "").strip()
        if not tid:
            continue
        # A skeleton knows a threat exists; it does not know how fast it
        # advances or what the table sees when it does.  Those come from the
        # module's own progression and resolution sections, so they stay
        # unresolved here rather than being invented as a four-segment clock
        # that reads to the Keeper like authored pacing.
        threat_fronts.append({
            "front_id": tid,
            "clock_id": f"clock-{tid}",
            "label": str(threat.get("label") or tid),
            "segments": None,
            "value": 0,
            "on_tick_visible": None,
            "parse_state": threat.get("parse_state") or "stub",
            "clock_state": "unresolved",
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

    # A location skeleton carries no pacing information whatsoever.  Stamping
    # every scene with one stage and a start/not-start tension split produced a
    # curve that looked authored and was not: the Keeper reads pacing-map as
    # module intent, so a fabricated default there is worse than an empty one.
    # Real values arrive from the module's progression sections.
    pacing = [
        {
            "scene_id": scene["scene_id"],
            "horror_stage": None,
            "tension_target": None,
            "parse_state": "unresolved",
        }
        for scene in scenes
    ]

    return {
        "module-meta.json": meta,
        "story-graph.json": {"scenes": scenes},
        "clue-graph.json": {"conclusions": conclusions},
        "npc-agendas.json": {"npcs": npc_rows},
        "threat-fronts.json": {"fronts": threat_fronts},
        "pacing-map.json": {"curve": pacing},
        # Improvisation boundaries are a per-module judgement about what this
        # scenario tolerates being made up.  The previous fixed English list
        # applied the same answer to every book regardless of content.  Empty
        # plus an explicit unresolved state tells the truth: nothing has been
        # established yet, so the Keeper's existing evidence discipline
        # governs until the keeper-truth and content-warning sections are read.
        "improvisation-boundaries.json": {
            "invent_allowed": [],
            "never_invent": [],
            "keeper_secrets": [],
            "parse_state": "unresolved",
        },
        # Verbatim info cards start empty: cards come from deep handout
        # packs (module-assets entities), never from Tier-1 topology.
        "handouts.json": {"schema_version": 1, "handouts": []},
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


def _read_aloud_card_source_refs(refs: Any) -> list[str]:
    """Project exact location-pack page evidence into card source labels."""
    out: list[str] = []
    for ref in refs or []:
        if isinstance(ref, str) and ref.strip():
            label = ref.strip()
        elif (
            isinstance(ref, dict)
            and isinstance(ref.get("pdf_index"), int)
            and not isinstance(ref.get("pdf_index"), bool)
            and ref["pdf_index"] >= 0
        ):
            label = f"pdf_index-{ref['pdf_index']}"
        else:
            raise ModuleProjectError(
                "read_aloud source_refs must contain exact page refs"
            )
        if label not in out:
            out.append(label)
    if not out:
        raise ModuleProjectError("read_aloud card requires exact source refs")
    return out


def _project_location_read_aloud_cards(
    out: dict[str, Any],
    *,
    scene_id: str,
    scene_title: str,
    rows: Any,
) -> None:
    """Upsert source-backed location passages into the unified card store."""
    doc = out.setdefault("handouts.json", {"schema_version": 1, "handouts": []})
    if not isinstance(doc, dict):
        raise ModuleProjectError("handouts.json IR entry must be an object")
    cards = doc.setdefault("handouts", [])
    if not isinstance(cards, list):
        raise ModuleProjectError("handouts.json.handouts must be a list")
    for row in rows or []:
        row_id = str(row.get("id") or "").strip()
        asset_id = f"read-aloud:{scene_id}:{row_id}"
        title = str(row.get("title") or scene_title or row_id).strip()
        card: dict[str, Any] = {
            "asset_id": asset_id,
            "kind": "read_aloud",
            "title": title,
            "text": str(row["text"]),
            "when_to_deliver": str(row["trigger"]),
            "source_refs": _read_aloud_card_source_refs(row.get("source_refs")),
            "scene_refs": [scene_id],
            "player_visible": True,
            "parse_state": "deep",
            "origin": "source",
        }
        for field in ("localized_title", "localized_text", "localized_language"):
            if row.get(field) is not None:
                card[field] = json.loads(json.dumps(row[field]))
        existing = next(
            (
                candidate for candidate in cards
                if isinstance(candidate, dict)
                and candidate.get("asset_id") == asset_id
            ),
            None,
        )
        if existing is None:
            cards.append(card)
        else:
            existing.clear()
            existing.update(card)


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
        "available_clues", "npc_ids", "pressure_moves",
        "tone", "storylet_tags", "allowed_improvisation", "exit_conditions",
    ):
        pack_key = "available_clue_ids" if key == "available_clues" else key
        if pack.get(pack_key) is not None:
            scene[key] = list(pack.get(pack_key) or [])
    if pack.get("affordances") is not None:
        scene["affordances"] = _opening_reconcile_structured_rows(
            pack.get("affordances") or [],
            scene.get("affordances") or [],
            kind="affordance",
        )
    if pack.get("scene_edges") is not None:
        # Deep edges replace Tier-1 provisional topology, but must not erase
        # campaign-local routes created when a player materially digs a named
        # place. Those routes are part of the growing live map, not PDF guesses.
        scene["scene_edges"] = _opening_reconcile_structured_rows(
            pack.get("scene_edges") or [],
            scene.get("scene_edges") or [],
            kind="edge",
        )
    if pack.get("read_aloud") is not None:
        # Boxed passages the Keeper reads out as written.  They are authored
        # player-facing text, so they travel with the scene rather than into
        # the Keeper-only channel below.
        scene["read_aloud"] = json.loads(json.dumps(pack.get("read_aloud") or []))
        _project_location_read_aloud_cards(
            out,
            scene_id=lid,
            scene_title=str(
                scene.get("display_name") or pack.get("title") or lid
            ),
            rows=pack.get("read_aloud") or [],
        )
    if pack.get("keeper_only") is not None:
        # Keeper notes ride under one clearly named key so every player-facing
        # projection has a single thing to exclude.  Scattering them among
        # ordinary scene fields is how this kind of material leaks.
        scene["keeper_only"] = json.loads(json.dumps(pack.get("keeper_only") or []))
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
    # Top-level source mentions do not establish presence, discovery, or a
    # player dig.  They may still carry source-authored context the live Keeper
    # needs to answer a natural request for the current briefing or
    # explanation.  Preserve that context on the scene under a deliberately
    # separate keeper-facing field instead of promoting mentions into NPCs,
    # clues, routes, or player knowledge.
    if pack.get("mentions") is not None:
        scene["source_context_mentions"] = json.loads(
            json.dumps(pack.get("mentions") or [])
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
    if "scene_contract" in pack:
        scene["scene_contract"] = normalize_scene_contract(
            str(scene.get("scene_id") or pack.get("location_id") or ""),
            pack["scene_contract"],
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
        # Clue packs are already validated at the asset boundary.  Copy the
        # full structured row so new semantic/provenance fields cannot vanish
        # merely because this projector predates them.
        row = json.loads(json.dumps(clue))
        row["clue_id"] = clue["clue_id"]
        row.setdefault("delivery_kind", "obvious")
        row.setdefault("visibility", "player-safe")
        row.setdefault("origin", "source")
        # Canonical player text only. Bare summary is rejected at put_entity;
        # never invent difficulty from skill presence.
        if clue.get("player_safe_summary") is not None:
            row["player_safe_summary"] = str(clue.get("player_safe_summary") or "")
        elif "player_safe_summary" not in row:
            row["player_safe_summary"] = ""
        row.pop("summary", None)
        row.setdefault("parse_state", "deep")
        if isinstance(clue.get("discovery"), dict):
            # Pass structured discovery through untouched — no inference.
            row["discovery"] = json.loads(json.dumps(clue["discovery"]))
        # Structured follow-ups only (never free-prose keyword mentions).
        if clue.get("mentions"):
            row["mentions"] = [
                m for m in clue["mentions"]
                if isinstance(m, dict) and m.get("kind") and m.get("ref_id")
            ]
        if clue.get("provenance") is not None:
            row["provenance"] = json.loads(json.dumps(clue["provenance"]))
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
    scene_secret_refs = list(scene.get("keeper_secret_refs") or [])
    canonical_secret_links: list[dict[str, Any]] = []
    for sec in pack.get("keeper_secret_refs") or []:
        if not isinstance(sec, dict):
            continue
        secret_id = str(sec.get("id") or sec.get("secret_id") or "").strip()
        if not secret_id:
            continue
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
        canonical_secret_links.append({
            "id": secret_id,
            "category": secret_row["category"],
        })
    if pack.get("keeper_secret_refs") is not None:
        scene["keeper_secret_refs"] = _opening_reconcile_structured_rows(
            canonical_secret_links,
            scene_secret_refs,
            kind="secret_link",
        )

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


def merge_deep_item_into_ir(
    ir: dict[str, Any],
    pack: dict[str, Any],
) -> dict[str, Any]:
    """Upsert one source item and its mechanics into canonical module metadata."""
    out = {k: json.loads(json.dumps(v)) for k, v in ir.items()}
    item_id = str(pack.get("item_id") or "").strip()
    if not item_id:
        raise ModuleProjectError("deep item pack missing item_id")
    meta = out["module-meta.json"]
    mechanics_root = meta.setdefault(
        "module_mechanics", {"schema_version": 1, "locators": [], "items": {}}
    )
    items = mechanics_root.setdefault("items", {})
    row = items.setdefault(item_id, {"item_id": item_id, "origin": "source"})
    for key, value in pack.items():
        if key not in {
            "schema_version", "updated_at", "host_timing", "ingest_timing",
            "host_work_job_id",
        }:
            row[key] = json.loads(json.dumps(value))
    row["item_id"] = item_id
    row.setdefault("label", item_id)
    row["parse_state"] = pack.get("parse_state") or "deep"
    row["origin"] = pack.get("origin") or "source"
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
            "segments": None,
            "value": 0,
            "clock_state": "unresolved",
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


HANDOUT_CARD_PROJECTION_FIELDS = (
    "asset_id", "kind", "content_origin", "title", "summary",
    "localized_title", "localized_summary", "localized_language",
    "player_visible", "when_to_deliver", "opening_card", "text",
    "authored_text", "localized_text", "image_ref",
    "source_refs", "scene_refs", "clue_refs",
)


def handout_card_from_pack(pack: dict[str, Any]) -> dict[str, Any]:
    """Project one deep handout pack into a campaign card record.

    The card record keeps the verbatim card body and its string
    ``source_refs``; delivery state is NOT card state — the authoritative
    delivered set lives in campaign world state (``delivered_handout_ids``).
    Machinery-only fields (ingest timing, revision bookkeeping) stay in the
    module-assets store.
    """
    errors = coc_scenario.validate_handout_card(pack, prefix="deep handout pack")
    if errors:
        raise ModuleProjectError("; ".join(errors))
    raw_asset_id = (
        pack.get("asset_id")
        if pack.get("asset_id") is not None
        else pack.get("handout_id")
    )
    if not isinstance(raw_asset_id, str) or not raw_asset_id.strip():
        raise ModuleProjectError("deep handout pack missing handout_id/asset_id")
    asset_id = raw_asset_id.strip()
    card: dict[str, Any] = {"asset_id": asset_id}
    for field in HANDOUT_CARD_PROJECTION_FIELDS:
        if field == "asset_id":
            continue
        if pack.get(field) is not None:
            card[field] = json.loads(json.dumps(pack[field]))
    card.setdefault("player_visible", True)
    card["parse_state"] = pack.get("parse_state") or "deep"
    card["origin"] = pack.get("origin") or "source"
    return card


def merge_deep_handout_into_ir(
    ir: dict[str, Any],
    pack: dict[str, Any],
) -> dict[str, Any]:
    """Upsert a deep handout card into the campaign card store.

    ``scenario/handouts.json`` is the campaign IR consumer for verbatim info
    cards, keyed by ``asset_id``. Undelivered card bodies live here as module
    truth; player-facing projections filter on ``delivered_handout_ids``.
    """
    out = {k: json.loads(json.dumps(v)) for k, v in ir.items()}
    card = handout_card_from_pack(pack)
    doc = out.setdefault("handouts.json", {"schema_version": 1, "handouts": []})
    if not isinstance(doc, dict):
        raise ModuleProjectError("handouts.json IR entry must be an object")
    handouts = doc.setdefault("handouts", [])
    base = next(
        (row for row in handouts if row.get("asset_id") == card["asset_id"]),
        None,
    )
    if base is None:
        handouts.append(card)
    else:
        base.clear()
        base.update(card)
    return out


def merge_deep_quest_into_ir(
    ir: dict[str, Any],
    pack: dict[str, Any],
) -> dict[str, Any]:
    """Upsert a deep action quest into the campaign quest store.

    ``scenario/quests.json`` is the eighth-file quest IR, keyed by
    ``quest_id``. Only the quest-schema machine-relevant card fields ride
    the projection; keeper-only ``brief`` stays for the KP, and runtime
    state lives in ``save/quest-state.json`` (coc_quest_state), not here.
    """
    out = {k: json.loads(json.dumps(v)) for k, v in ir.items()}
    quest_id = str(pack.get("quest_id") or "").strip()
    if not _QUEST_ID_RE.fullmatch(quest_id):
        raise ModuleProjectError(
            f"quest pack quest_id {quest_id!r} is not a semantic quest id",
        )
    row = {
        key: json.loads(json.dumps(pack[key]))
        for key in (
            "quest_id", "title", "localized_title", "player_safe_summary",
            "localized_text", "quest_kinds", "importance", "giver",
            "brief", "target_refs", "destination_scene_id", "deadline",
            "completion", "failure", "mainline_links", "secret",
            "source_refs",
        )
        if pack.get(key) is not None
    }
    row.setdefault("schema_version", 1)
    doc = out.setdefault("quests.json", {"schema_version": 1, "quests": []})
    if not isinstance(doc, dict):
        raise ModuleProjectError("quests.json IR entry must be an object")
    quests = doc.setdefault("quests", [])
    base = next(
        (row_ for row_ in quests if row_.get("quest_id") == quest_id),
        None,
    )
    if base is None:
        quests.append(row)
    else:
        base.clear()
        base.update(row)
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
        "item": merge_deep_item_into_ir,
        "clue": merge_deep_clue_into_ir,
        "threat": merge_deep_threat_into_ir,
        "handout": merge_deep_handout_into_ir,
        "quest": merge_deep_quest_into_ir,
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
        str(era_raw) if authored_era else str(camp.get("era") or "")
    )
    changed = authored_era and (
        camp.get("era") != era_key
        or camp.get("era_source") != coc_state.ERA_SOURCE_AUTHORED
    )
    if authored_era:
        camp["era"] = era_key
        # Source-projected era is the only evidence character creation accepts.
        camp["era_source"] = coc_state.ERA_SOURCE_AUTHORED
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


def _validate_changed_opening_sources_before_write(
    campaign_dir: Path,
    ir: dict[str, Any],
    asset_root_id: str | None,
    *,
    opening_start_location_id: str | None = None,
    opening_source_scope: dict[str, Any] | None = None,
) -> None:
    """Keep every IR writer behind the selected-opening source boundary.

    Deep packs are also merged by the detached progressive queue worker.  That
    path does not call ``project_selected_opening``, so its final common write
    boundary must reject a changed start scene whose pack does not cover the
    source-authored opening window.  Unchanged start scenes and Tier-1 skeleton
    projection remain outside this guard.
    """
    if not asset_root_id:
        return
    scenario = _load_json(campaign_dir / "scenario" / "scenario.json", {})
    if not isinstance(scenario, dict) or not str(
        scenario.get("source_cache_asset_root_id") or ""
    ).strip():
        return
    candidate_graph = ir.get("story-graph.json")
    if not isinstance(candidate_graph, dict):
        return
    candidate_scenes = {
        str(row.get("scene_id") or ""): row
        for row in (candidate_graph.get("scenes") or [])
        if isinstance(row, dict) and str(row.get("scene_id") or "")
    }
    current_graph = _load_json(
        campaign_dir / "scenario" / "story-graph.json", {},
    )
    current_scenes = {
        str(row.get("scene_id") or ""): row
        for row in (
            (current_graph.get("scenes") or [])
            if isinstance(current_graph, dict)
            else []
        )
        if isinstance(row, dict) and str(row.get("scene_id") or "")
    }
    workspace = campaign_dir.parents[2]
    root_info = resolve_opening_preparation_root(workspace, campaign_dir.name)
    if str(root_info["asset_root_id"]) != str(asset_root_id):
        raise OpeningPreparationError(
            "opening_source_identity_mismatch",
            "IR projection root does not match the campaign-bound source root",
        )
    skeleton = coc_module_assets.get_skeleton(workspace, str(asset_root_id))
    if not isinstance(skeleton, dict):
        return
    # After the selected opening has been projected, every later IR writer
    # (scene entry, detached deep-pack merge, NPC/clue enrichment) must reuse
    # that exact durable source window.  Falling back to the broader skeleton
    # locator can reject a perfectly valid selected one-page opening when the
    # locator itself spans more than three pages.
    durable_binding = (
        scenario.get("opening_projection_source_binding")
        if isinstance(scenario.get("opening_projection_source_binding"), dict)
        else {}
    )
    durable_start_id = str(
        durable_binding.get("start_location_id") or ""
    ).strip()
    durable_scope = (
        durable_binding.get("source_scope")
        if isinstance(durable_binding.get("source_scope"), dict)
        else None
    )
    for candidate in opening_start_candidates(skeleton):
        start_id = candidate["location_id"]
        scene = candidate_scenes.get(start_id)
        if not isinstance(scene, dict) or str(scene.get("parse_state") or "") not in {
            "body_parsed", "deep",
        }:
            continue
        if scene == current_scenes.get(start_id):
            continue
        if (
            opening_source_scope is not None
            and start_id == opening_start_location_id
        ):
            scope = coc_module_assets.validate_opening_source_scope(
                workspace, str(asset_root_id), opening_source_scope,
            )
        elif durable_scope is not None and start_id == durable_start_id:
            scope = coc_module_assets.validate_opening_source_scope(
                workspace, str(asset_root_id), durable_scope,
            )
        else:
            scope = resolve_opening_source_window(
                workspace, root_info, skeleton, start_id, None,
            )["scope"]
        readiness = opening_pack_readiness(
            workspace,
            str(asset_root_id),
            start_id,
            required_source_scope=scope,
        )
        source_blocker = next(
            (
                row for row in (readiness.get("blocking") or [])
                if str(row.get("code") or "").startswith("opening_pack_source_")
                or str(row.get("code") or "") in {
                    "opening_source_scope_required",
                    "opening_source_scope_invalid",
                    "opening_pack_evidence_stale",
                }
            ),
            None,
        )
        if source_blocker is not None:
            raise OpeningPreparationError(
                str(source_blocker["code"]),
                "changed opening projection is not qualified for its source scope",
            )


def write_ir_to_campaign(
    campaign_dir: Path,
    ir: dict[str, Any],
    *,
    asset_root_id: str | None = None,
    publish_compiled_archive: bool = True,
    opening_start_location_id: str | None = None,
    opening_source_scope: dict[str, Any] | None = None,
) -> list[str]:
    _validate_changed_opening_sources_before_write(
        campaign_dir,
        ir,
        asset_root_id,
        opening_start_location_id=opening_start_location_id,
        opening_source_scope=opening_source_scope,
    )
    scenario_dir = campaign_dir / "scenario"
    scenario_dir.mkdir(parents=True, exist_ok=True)
    ir = dict(ir)
    npc_agendas = ir.get("npc-agendas.json")
    if isinstance(npc_agendas, dict):
        rules_dir = coc_rulesets.ruleset_data_dir(coc_rulesets.DEFAULT_RULESET_ID)
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
    for name in OPTIONAL_IR_FILES:
        if name not in ir:
            continue
        path = scenario_dir / name
        _write_json(path, ir[name])
        written.append(str(path))
    # stamp progressive marker on scenario.json if present
    sc_path = scenario_dir / "scenario.json"
    meta = ir.get("module-meta.json") or {}
    with coc_fileio.advisory_file_lock(
        scenario_dir / "opening-projection.lock"
    ):
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
                if meta.get("title") and not str(sc.get("title") or "").strip():
                    sc["title"] = meta["title"]
                if (
                    meta.get("scenario_id")
                    and not str(sc.get("scenario_id") or "").strip()
                ):
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


def campaign_handout_asset_root_ids(campaign_dir: Path) -> list[str]:
    """Resolve card roots, preferring the module graph's asset authority.

    New graph-backed modules bind cards, maps, and source assets through
    ``module_graph_asset_root_id``. ``handout_asset_root_id`` remains a
    read-only compatibility pointer only for historical campaigns that do not
    carry the graph field. The ordinary progressive root remains first.
    """
    meta = _load_json(campaign_dir / "scenario" / "module-meta.json", {})
    graph_root = (
        str(meta.get("module_graph_asset_root_id") or "").strip()
        if isinstance(meta, dict) else ""
    )
    legacy_overlay = (
        str(meta.get("handout_asset_root_id") or "").strip()
        if isinstance(meta, dict) and not graph_root else ""
    )
    candidates = [
        campaign_asset_root_id(campaign_dir),
        graph_root or legacy_overlay,
    ]
    roots: list[str] = []
    for candidate in candidates:
        if not candidate:
            continue
        try:
            normalized = coc_module_assets.resolve_asset_root_id(
                canonical_module_id=candidate,
            )
        except coc_module_assets.ModuleAssetsError:
            continue
        if normalized not in roots:
            roots.append(normalized)
    return roots


def campaign_source_asset_root_id(campaign_dir: Path) -> str | None:
    """Resolve the module root a campaign has source work bound to.

    Wider than :func:`campaign_asset_root_id` on purpose.  That one answers
    "is this campaign running the progressive skeleton pipeline", and its
    callers act on the answer, so it must stay narrow.  This one answers "does
    this campaign have host work sitting in a module root", which is also true
    for a campaign bound through the opening/review path -- it carries only
    ``source_cache_asset_root_id``.

    The host-work lifecycle already accepts either pointer when it validates
    consumer refs.  Reporting had to agree, or a campaign's ready background
    work stayed invisible: the request was owned and runnable, and nothing
    would ever advertise it.
    """
    scenario = _load_json(campaign_dir / "scenario" / "scenario.json", {})
    if isinstance(scenario, dict):
        for key in ("progressive_asset_root_id", "source_cache_asset_root_id"):
            value = str(scenario.get(key) or "").strip()
            if value:
                return value
    return campaign_asset_root_id(campaign_dir)


def _campaign_consumer_refs(
    workspace: Path,
    campaign_id: str,
    asset_root_id: str,
    *,
    intent_kind: str,
) -> list[dict[str, Any]]:
    return [coc_module_assets.campaign_consumer_ref(
        workspace,
        campaign_id,
        asset_root_id,
        intent_kind=intent_kind,
    )]


def resolve_opening_preparation_root(
    workspace: Path,
    campaign_id: str,
) -> dict[str, Any]:
    """Resolve and prove the source-bound root used only by opening setup."""
    campaign_dir = _campaign_dir(workspace, campaign_id)
    scenario = _load_json(campaign_dir / "scenario" / "scenario.json", {})
    if not isinstance(scenario, dict):
        raise OpeningPreparationError(
            "opening_source_missing", "campaign scenario metadata is missing"
        )
    source_root = str(scenario.get("source_cache_asset_root_id") or "").strip()
    projected_root = str(scenario.get("progressive_asset_root_id") or "").strip()
    if source_root and projected_root and source_root != projected_root:
        raise OpeningPreparationError(
            "opening_root_mismatch",
            "source-cache and progressive projection pointers disagree",
        )
    root_id = projected_root or source_root
    if not root_id:
        raise OpeningPreparationError(
            "opening_source_missing",
            "campaign has no source-bound module asset root",
        )
    try:
        root_id = coc_module_assets._require_id(root_id, "asset_root_id")
        module_root = coc_module_assets._module_dir(workspace, root_id)
    except coc_module_assets.ModuleAssetsError as exc:
        raise OpeningPreparationError("opening_root_unsafe", str(exc)) from exc
    identity_path = module_root / "identity.json"
    if not identity_path.is_file():
        raise OpeningPreparationError(
            "opening_identity_missing", "module asset identity.json is missing"
        )
    try:
        registry = coc_module_assets.load_registry(workspace)
        identity = _load_json(identity_path, {})
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        raise OpeningPreparationError(
            "opening_identity_invalid", str(exc)
        ) from exc
    if not isinstance(identity, dict):
        raise OpeningPreparationError(
            "opening_identity_invalid", "module asset identity must be an object"
        )
    try:
        file_sha256 = coc_module_assets._require_sha256(
            identity.get("file_sha256"), "identity.file_sha256",
        )
    except coc_module_assets.ModuleAssetsError as exc:
        raise OpeningPreparationError("opening_identity_invalid", str(exc)) from exc
    module_owner = (registry.get("modules") or {}).get(root_id)
    sha_owner = (registry.get("by_file_sha256") or {}).get(file_sha256)
    if (
        not isinstance(module_owner, dict)
        or str(module_owner.get("asset_root_id") or "") != root_id
        or str(module_owner.get("file_sha256") or "") != file_sha256
        or sha_owner != root_id
    ):
        raise OpeningPreparationError(
            "opening_registry_mismatch",
            "module registry ownership does not match the selected root",
        )
    if str(identity.get("asset_root_id") or "") != root_id:
        raise OpeningPreparationError(
            "opening_identity_mismatch", "identity asset_root_id differs from registry"
        )
    identity_source = (
        identity.get("source") if isinstance(identity.get("source"), dict) else {}
    )
    scenario_source = (
        scenario.get("source") if isinstance(scenario.get("source"), dict) else {}
    )
    for field in ("source_id", "file_sha256", "page_count", "producer"):
        if scenario_source.get(field) != identity_source.get(field):
            raise OpeningPreparationError(
                "opening_source_identity_mismatch",
                f"campaign source.{field} differs from the registered identity",
            )
    if identity_source.get("file_sha256") != file_sha256:
        raise OpeningPreparationError(
            "opening_source_identity_mismatch",
            "registered source file digest differs from identity",
        )
    try:
        bundle_sha256 = coc_module_assets._require_sha256(
            scenario_source.get("bundle_sha256"), "campaign source.bundle_sha256",
        )
    except coc_module_assets.ModuleAssetsError as exc:
        raise OpeningPreparationError("opening_bundle_mismatch", str(exc)) from exc
    bundle_row = next(
        (
            row
            for row in (identity.get("source_bundles") or [])
            if isinstance(row, dict)
            and str(row.get("bundle_sha256") or "") == bundle_sha256
        ),
        None,
    )
    if bundle_row is None:
        raise OpeningPreparationError(
            "opening_bundle_mismatch",
            "campaign-bound source bundle is not registered on the asset root",
        )
    return {
        "campaign_dir": campaign_dir,
        "asset_root_id": root_id,
        "link_state": (
            "progressive_projected" if projected_root else "source_bound"
        ),
        "source_id": str(identity_source.get("source_id") or ""),
        "file_sha256": file_sha256,
        "bundle_sha256": bundle_sha256,
        "page_count": identity_source.get("page_count"),
        "producer": identity_source.get("producer"),
        "bundle_pdf_indices": sorted(bundle_row.get("pdf_indices") or []),
        "module_identity": json.loads(json.dumps(
            identity.get("module_identity")
            if isinstance(identity.get("module_identity"), dict)
            else {}
        )),
    }


def opening_start_candidates(skeleton: dict[str, Any]) -> list[dict[str, Any]]:
    locations = {
        str(row.get("location_id") or ""): row
        for row in (skeleton.get("locations") or [])
        if isinstance(row, dict) and str(row.get("location_id") or "")
    }
    return [
        {
            "location_id": start_id,
            "title": str((locations.get(start_id) or {}).get("title") or start_id),
        }
        for start_id in (
            str(value).strip() for value in (skeleton.get("start_candidates") or [])
        )
        if start_id
    ]


def parse_opening_start_selector(
    raw_value: Any,
    *,
    required: bool,
) -> str | None:
    """Validate a raw JSON opening selector without coercing its type."""
    if raw_value is None:
        if required:
            raise OpeningPreparationError(
                "invalid_opening_start",
                "start_location_id must be a nonempty string",
            )
        return None
    if not isinstance(raw_value, str):
        raise OpeningPreparationError(
            "invalid_opening_start",
            "start_location_id must be a string when provided",
        )
    selected = raw_value.strip()
    if not selected:
        if required:
            raise OpeningPreparationError(
                "invalid_opening_start",
                "start_location_id must be a nonempty string",
            )
        return None
    try:
        coc_module_assets._require_id(selected, "start_location_id")
    except coc_module_assets.ModuleAssetsError as exc:
        raise OpeningPreparationError("invalid_opening_start", str(exc)) from exc
    return selected


def select_opening_start(
    campaign_dir: Path,
    skeleton: dict[str, Any],
    explicit_start_location_id: Any,
) -> str:
    candidates = opening_start_candidates(skeleton)
    candidate_ids = {row["location_id"] for row in candidates}
    explicit = parse_opening_start_selector(
        explicit_start_location_id,
        required=False,
    )
    if explicit:
        if explicit not in candidate_ids:
            raise OpeningPreparationError(
                "invalid_opening_start",
                "start_location_id is not a structured start candidate",
            )
        return explicit
    if len(candidates) == 1:
        return candidates[0]["location_id"]
    world = _load_json(campaign_dir / "save" / "world-state.json", {})
    active = str((world or {}).get("active_scene_id") or "")
    if active and active in candidate_ids:
        graph = _load_json(campaign_dir / "scenario" / "story-graph.json", {})
        scene = next(
            (
                row
                for row in ((graph or {}).get("scenes") or [])
                if isinstance(row, dict) and str(row.get("scene_id") or "") == active
            ),
            None,
        )
        if (
            isinstance(scene, dict)
            and scene.get("is_start") is True
            and str(scene.get("origin") or "") == "source"
        ):
            return active
    raise OpeningPreparationError(
        "opening_start_selection_required",
        "multiple structured start candidates require an explicit selection",
    )


def resolve_opening_source_window(
    workspace: Path,
    root_info: dict[str, Any],
    skeleton: dict[str, Any],
    start_location_id: str,
    supplied_pdf_indices: list[int] | None,
) -> dict[str, Any]:
    location = next(
        (
            row
            for row in (skeleton.get("locations") or [])
            if isinstance(row, dict)
            and str(row.get("location_id") or "") == start_location_id
        ),
        None,
    )
    if location is None:
        raise OpeningPreparationError(
            "invalid_opening_start", "selected start has no structured location row"
        )
    try:
        locator_indices = coc_module_assets._source_indices(
            location, field="opening_start_locator",
        )
    except coc_module_assets.ModuleAssetsError as exc:
        raise OpeningPreparationError("opening_locator_invalid", str(exc)) from exc
    locator_contiguous = bool(locator_indices) and locator_indices == list(
        range(locator_indices[0], locator_indices[-1] + 1)
    )
    if supplied_pdf_indices is None:
        if not locator_contiguous or not 1 <= len(locator_indices) <= 3:
            raise OpeningPreparationError(
                "opening_source_window_required",
                "selected start locator is not an exact contiguous 1..3-page window",
            )
        selected_indices = locator_indices
        origin = "structured_locator"
    else:
        selected_indices = supplied_pdf_indices
        origin = "host_selected"
    try:
        scope = coc_module_assets.validate_opening_source_window(
            workspace,
            str(root_info["asset_root_id"]),
            bundle_sha256=str(root_info["bundle_sha256"]),
            pdf_indices=selected_indices,
        )
    except coc_module_assets.ModuleAssetsError as exc:
        raise OpeningPreparationError("opening_source_window_invalid", str(exc)) from exc
    if locator_indices and not set(scope["pdf_indices"]) <= set(locator_indices):
        raise OpeningPreparationError(
            "opening_source_window_outside_locator",
            "opening_pdf_indices must be contained in the selected start locator",
        )
    return {"window_origin": origin, "scope": scope}


def campaign_is_pristine_for_opening(campaign_dir: Path) -> bool:
    world = _load_json(campaign_dir / "save" / "world-state.json", {})
    pacing = _load_json(campaign_dir / "save" / "pacing-state.json", {})
    active_pointer = _load_json(campaign_dir / "save" / "active-scene.json", {})
    if not isinstance(world, dict) or not isinstance(pacing, dict):
        return False
    if world.get("active_scene_id") is not None:
        return False
    if world.get("visited_scene_ids") or world.get("scene_history"):
        return False
    if int(pacing.get("turn_number") or 0) != 0:
        return False
    if isinstance(active_pointer, dict) and active_pointer.get("scene_id") is not None:
        return False
    events_path = campaign_dir / "logs" / "events.jsonl"
    if events_path.is_file():
        try:
            for line in events_path.read_text(encoding="utf-8").splitlines():
                if not line.strip():
                    continue
                row = json.loads(line)
                if isinstance(row, dict) and row.get("event_type") == "scene_transition":
                    return False
        except (OSError, json.JSONDecodeError):
            return False
    return True


def load_campaign_ir(campaign_dir: Path) -> dict[str, Any]:
    scenario_dir = campaign_dir / "scenario"
    ir: dict[str, Any] = {}
    for name in REQUIRED_FILES:
        path = scenario_dir / name
        if not path.is_file():
            raise ModuleProjectError(f"campaign missing {name}")
        ir[name] = _load_json(path, {})
    for name in OPTIONAL_IR_FILES:
        path = scenario_dir / name
        if path.is_file():
            ir[name] = _load_json(path, {})
    return ir


_OPENING_CAMPAIGN_AUTHORITIES = frozenset({
    "campaign_improvised",
    "campaign_generated",
})


def _opening_campaign_local_row(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    provenance = (
        value.get("provenance")
        if isinstance(value.get("provenance"), dict)
        else {}
    )
    authority = str(provenance.get("authority") or "")
    origin = str(value.get("origin") or "")
    return (
        authority in _OPENING_CAMPAIGN_AUTHORITIES
        or origin in _OPENING_CAMPAIGN_AUTHORITIES
        or origin.startswith("campaign_")
    )


def _opening_scope_page_ref(value: dict[str, Any]) -> dict[str, Any]:
    result = {
        "source_id": str(value.get("source_id") or ""),
        "pdf_index": value.get("pdf_index"),
        "text_sha256": str(value.get("text_sha256") or ""),
        "review_state": value.get("review_state"),
        "parse_confidence": value.get("parse_confidence"),
    }
    if isinstance(value.get("ocr_revision"), dict):
        result["ocr_revision"] = json.loads(json.dumps(value["ocr_revision"]))
    if isinstance(value.get("structured_data"), dict):
        result["structured_data_sha256"] = value["structured_data"].get("sha256")
    return result


def _opening_pack_claims_match_revalidation(
    stored: dict[str, Any],
    revalidated: dict[str, Any],
) -> bool:
    """Reject stale/tampered durable evidence instead of silently blessing it."""
    evidence_fields = (
        "source_refs",
        "source_page_indices",
        "source_span",
        "page_text_sha256",
        "source_evidence",
    )
    return all(stored.get(field) == revalidated.get(field) for field in evidence_fields)


def _l0_direct_pack_marker(pack: dict[str, Any]) -> bool:
    """True when a partial opening pack was repository-authored from L0.

    opening_bootstrap writes the L0 opening slice directly through put_entity;
    such a pack is the exact selected-window scope by construction and never
    carries a host-work ingest receipt, so the partial binding check must not
    demand one.  The marker is validated here so a spoofed marker still needs
    the full source-evidence and scope-coverage proof below.
    """
    marker = pack.get("l0_direct_opening")
    return (
        isinstance(marker, dict)
        and marker.get("schema_version") == 1
        and str(marker.get("source") or "") == "module-init.json"
    )


def _opening_pack_has_accepted_source_evidence(pack: dict[str, Any]) -> bool:
    evidence = (
        pack.get("source_evidence")
        if isinstance(pack.get("source_evidence"), dict)
        else {}
    )
    refs = pack.get("source_refs") if isinstance(pack.get("source_refs"), list) else []
    indices = evidence.get("pdf_indices")
    digests = evidence.get("page_text_sha256")
    bundles = evidence.get("bundle_sha256s")
    return bool(
        evidence.get("schema_version") == 1
        and str(evidence.get("source_id") or "")
        and str(evidence.get("file_sha256") or "")
        and isinstance(indices, list)
        and indices
        and isinstance(digests, list)
        and len(digests) == len(indices)
        and isinstance(bundles, list)
        and bundles
        and refs
    )


def _opening_pack_covers_source_scope(
    pack: dict[str, Any],
    scope: dict[str, Any],
) -> bool:
    refs = [
        row for row in (pack.get("source_refs") or [])
        if isinstance(row, dict) and isinstance(row.get("pdf_index"), int)
        and not isinstance(row.get("pdf_index"), bool)
    ]
    refs_by_index = {int(row["pdf_index"]): row for row in refs}
    required_bundle = str(scope.get("bundle_sha256") or "")
    for required_ref in scope.get("page_refs") or []:
        if not isinstance(required_ref, dict):
            return False
        pdf_index = required_ref.get("pdf_index")
        actual_ref = refs_by_index.get(pdf_index)
        if actual_ref is None:
            return False
        if _opening_scope_page_ref(actual_ref) != required_ref:
            return False
        if required_bundle not in set(actual_ref.get("bundle_sha256s") or []):
            return False
    evidence = (
        pack.get("source_evidence")
        if isinstance(pack.get("source_evidence"), dict)
        else {}
    )
    return bool(
        evidence.get("source_id") == scope.get("source_id")
        and evidence.get("file_sha256") == scope.get("file_sha256")
        and required_bundle in set(evidence.get("bundle_sha256s") or [])
        and set(scope.get("pdf_indices") or []).issubset(
            set(evidence.get("pdf_indices") or [])
        )
    )


def opening_pack_readiness(
    workspace: Path,
    asset_root_id: str,
    start_location_id: str,
    *,
    required_npc_ids: list[str] | None = None,
    required_secret_ids: list[str] | None = None,
    required_source_scope: dict[str, Any] | None = None,
    host_work_mode: str = "mutating",
) -> dict[str, Any]:
    """Return deterministic structural readiness for one selected start pack."""
    blockers: list[dict[str, Any]] = []
    advisories: list[dict[str, Any]] = []
    try:
        stored_pack = coc_module_assets.get_entity(
            workspace, asset_root_id, "location", start_location_id,
        )
        pack = coc_module_assets.revalidate_entity_pack(
            workspace, asset_root_id, "location", start_location_id,
        )
    except coc_module_assets.ModuleAssetsError as exc:
        return {
            "ready": False,
            "pack": None,
            "blocking": [{"code": "opening_pack_evidence_invalid", "entity_id": start_location_id}],
            "advisories": [],
            "validation_error": str(exc),
            "present_npc_ids": [],
            "required_secret_status": [],
        }
    if pack is None:
        return {
            "ready": False,
            "pack": None,
            "blocking": [{"code": "opening_pack_missing", "entity_id": start_location_id}],
            "advisories": [],
            "present_npc_ids": [],
            "required_secret_status": [],
        }
    canonical_scope: dict[str, Any] | None = None
    scope_validation_error: str | None = None
    if required_source_scope is None:
        blockers.append({
            "code": "opening_source_scope_required",
            "entity_id": start_location_id,
        })
    else:
        try:
            canonical_scope = coc_module_assets.validate_opening_source_scope(
                workspace, asset_root_id, required_source_scope,
            )
            if canonical_scope != required_source_scope:
                raise coc_module_assets.ModuleAssetsError(
                    "required opening source scope is not canonical"
                )
        except coc_module_assets.ModuleAssetsError as exc:
            blockers.append({
                "code": "opening_source_scope_invalid",
                "entity_id": start_location_id,
            })
            canonical_scope = None
            scope_validation_error = str(exc)
    if _opening_campaign_local_row(pack):
        blockers.append({
            "code": "opening_pack_source_authority_invalid",
            "entity_id": start_location_id,
        })
    if not _opening_pack_has_accepted_source_evidence(pack):
        blockers.append({
            "code": "opening_pack_source_evidence_missing",
            "entity_id": start_location_id,
        })
    if not isinstance(stored_pack, dict) or not _opening_pack_claims_match_revalidation(
        stored_pack, pack,
    ):
        blockers.append({
            "code": "opening_pack_evidence_stale",
            "entity_id": start_location_id,
        })
    state = str(pack.get("parse_state") or "")
    if pack.get("evidence_gap"):
        blockers.append({"code": "opening_pack_evidence_gap", "entity_id": start_location_id})
    if state not in {"deep", "body_parsed", "partial"}:
        blockers.append({"code": "opening_pack_depth_missing", "entity_id": start_location_id})
    if state == "partial":
        # A repository-authored L0 opening slice is a partial opening without
        # any host-work claim/fulfill spine: opening_bootstrap wrote it from
        # the source-reviewed module-init L0 and it is already the exact
        # selected-window scope.  It needs the same source-scope coverage
        # proof the deep/body_parsed lane uses, never a host-work receipt.
        if _l0_direct_pack_marker(pack):
            if (
                canonical_scope is not None
                and not _opening_pack_covers_source_scope(pack, canonical_scope)
            ):
                blockers.append({
                    "code": "opening_pack_source_scope_mismatch",
                    "entity_id": start_location_id,
                })
        else:
            ingest_receipt = coc_module_assets.current_ingest_fulfillment_receipt(
                pack
            )
            job_id = str((ingest_receipt or {}).get("job_id") or "").strip()
            host_work_facts_complete = True
            if host_work_mode == "pure_read":
                requests = coc_module_assets.inspect_host_work_requests_pure(
                    workspace, asset_root_id, include_closed=True, limit=None,
                )
                if requests is None:
                    # Never repair or reinterpret incomplete lifecycle input on
                    # a parallel read.  The caller must retain its existing
                    # opening gate until a serial materialization observes it.
                    host_work_facts_complete = False
                    requests = []
                    blockers.append({
                        "code": "opening_host_work_snapshot_unknown",
                        "entity_id": start_location_id,
                    })
            else:
                requests = coc_module_assets.list_host_work_requests(
                    workspace, asset_root_id, include_closed=True, limit=None,
                )
            request = next(
                (
                    row for row in requests
                    if str(row.get("job_id") or "") == job_id
                ),
                None,
            )
            exact_partial = False
            if (
                job_id
                and isinstance(request, dict)
                and request.get("status") == "fulfilled"
                and request.get("kind") == "partial_opening"
                and request.get("request_purpose")
                == coc_module_assets.FOREGROUND_OPENING_PURPOSE
                and str(request.get("target_id") or "") == start_location_id
                and coc_module_assets.fulfilled_request_matches_current_pack(
                    request,
                    pack,
                    kind="location",
                    entity_id=start_location_id,
                )
            ):
                try:
                    exact_scope = coc_module_assets.validate_opening_source_scope(
                        workspace,
                        asset_root_id,
                        request.get("requested_source_scope"),
                    )
                    expected_signature = coc_module_assets.opening_source_scope_signature(
                        exact_scope
                    )
                    canonical_pack_refs = [
                        _opening_scope_page_ref(row)
                        for row in (pack.get("source_refs") or [])
                        if isinstance(row, dict) and isinstance(row.get("pdf_index"), int)
                    ]
                    exact_partial = (
                        str(request.get("source_scope_signature") or "")
                        == expected_signature
                        and canonical_pack_refs == exact_scope["page_refs"]
                        and coc_module_assets._source_indices(
                            pack, field="opening_partial_pack",
                        )
                        == exact_scope["pdf_indices"]
                        and canonical_scope is not None
                        and exact_scope == canonical_scope
                    )
                except coc_module_assets.ModuleAssetsError:
                    exact_partial = False
            if not exact_partial and host_work_facts_complete:
                blockers.append({
                    "code": "opening_partial_binding_invalid",
                    "entity_id": start_location_id,
                    "job_id": job_id or None,
                })
    elif state in {"body_parsed", "deep"} and canonical_scope is not None:
        if not _opening_pack_covers_source_scope(pack, canonical_scope):
            blockers.append({
                "code": "opening_pack_source_scope_mismatch",
                "entity_id": start_location_id,
            })
    summary = pack.get("player_safe_summary")
    if not isinstance(summary, str) or not summary.strip():
        blockers.append({"code": "opening_summary_missing", "entity_id": start_location_id})

    embedded_clues = {
        str(row.get("clue_id") or ""): row
        for row in (pack.get("clues") or [])
        if isinstance(row, dict) and str(row.get("clue_id") or "")
    }
    for clue_id in (
        str(value).strip() for value in (pack.get("available_clue_ids") or [])
    ):
        clue = embedded_clues.get(clue_id)
        if clue is None:
            try:
                clue = coc_module_assets.revalidate_entity_pack(
                    workspace, asset_root_id, "clue", clue_id,
                )
            except coc_module_assets.ModuleAssetsError:
                clue = None
        if not isinstance(clue, dict):
            blockers.append({"code": "opening_clue_missing", "entity_id": clue_id})
            continue
        if not isinstance(clue.get("discovery"), dict) or not isinstance(
            clue.get("provenance"), dict
        ):
            blockers.append({"code": "opening_clue_structure_missing", "entity_id": clue_id})

    present_ids: list[str] = []
    for value in pack.get("npc_ids") or []:
        text = str(value).strip()
        if text and text not in present_ids:
            present_ids.append(text)
    embedded_npcs = {
        str(row.get("npc_id") or ""): row
        for row in (pack.get("npcs") or [])
        if isinstance(row, dict) and str(row.get("npc_id") or "")
    }
    for npc_id in embedded_npcs:
        if npc_id not in present_ids:
            present_ids.append(npc_id)
    for value in required_npc_ids or []:
        text = str(value).strip()
        if text and text not in present_ids:
            blockers.append({
                "code": "opening_required_npc_not_present",
                "entity_id": text,
            })
    for npc_id in present_ids:
        npc = embedded_npcs.get(npc_id)
        if npc is None:
            try:
                npc = coc_module_assets.revalidate_entity_pack(
                    workspace, asset_root_id, "npc", npc_id,
                )
            except coc_module_assets.ModuleAssetsError:
                npc = None
        if not isinstance(npc, dict):
            blockers.append({"code": "opening_npc_missing", "entity_id": npc_id})
            continue
        if not isinstance(npc.get("agenda"), str) or not str(
            npc.get("agenda") or ""
        ).strip():
            advisories.append({
                "code": "opening_npc_agenda_missing",
                "entity_id": npc_id,
            })

    secrets = {
        str(row.get("id") or row.get("secret_id") or ""): row
        for row in (pack.get("keeper_secret_refs") or [])
        if isinstance(row, dict)
        and str(row.get("id") or row.get("secret_id") or "")
    }
    secret_status: list[dict[str, Any]] = []
    for secret_id in required_secret_ids or []:
        row = secrets.get(str(secret_id))
        body = None
        if isinstance(row, dict):
            body = row.get("prose") or row.get("body") or row.get("text")
        ready = (
            isinstance(row, dict)
            and isinstance(body, str)
            and bool(body.strip())
            and bool(row.get("source_refs"))
            and isinstance(row.get("provenance"), dict)
            and row["provenance"].get("authority") == "source_authored"
        )
        secret_status.append({"secret_id": str(secret_id), "ready": ready})
        if not ready:
            blockers.append({"code": "opening_secret_missing", "entity_id": str(secret_id)})
    source_binding = None
    if not blockers and canonical_scope is not None:
        source_binding = {
            "schema_version": 1,
            "authority": "source_authored",
            "asset_root_id": asset_root_id,
            "start_location_id": start_location_id,
            "source_scope": json.loads(json.dumps(canonical_scope)),
            "source_scope_signature": (
                coc_module_assets.opening_source_scope_signature(canonical_scope)
            ),
        }
    result = {
        "ready": not blockers,
        "pack": pack,
        "blocking": blockers,
        "advisories": advisories,
        "present_npc_ids": present_ids,
        "required_secret_status": secret_status,
        "source_binding": source_binding,
    }
    if scope_validation_error:
        result["validation_error"] = scope_validation_error
    return result


def _fulfilled_foreground_opening_scope_for_pack(
    workspace: Path,
    asset_root_id: str,
    start_location_id: str,
) -> dict[str, Any] | None:
    """Recover an exact host-selected scope from durable canonical job state."""
    try:
        pack = coc_module_assets.revalidate_entity_pack(
            workspace, asset_root_id, "location", start_location_id,
        )
    except coc_module_assets.ModuleAssetsError:
        return None
    if not isinstance(pack, dict):
        return None
    ingest_receipt = coc_module_assets.current_ingest_fulfillment_receipt(pack)
    job_id = str((ingest_receipt or {}).get("job_id") or "").strip()
    if not job_id:
        return None
    request = next(
        (
            row for row in coc_module_assets.list_host_work_requests(
                workspace, asset_root_id, include_closed=True, limit=None,
            )
            if str(row.get("job_id") or "") == job_id
        ),
        None,
    )
    if not (
        isinstance(request, dict)
        and request.get("status") == "fulfilled"
        and request.get("kind") == "partial_opening"
        and request.get("request_purpose")
        == coc_module_assets.FOREGROUND_OPENING_PURPOSE
        and str(request.get("target_id") or "") == start_location_id
        and coc_module_assets.fulfilled_request_matches_current_pack(
            request,
            pack,
            kind="location",
            entity_id=start_location_id,
        )
    ):
        return None
    try:
        scope = coc_module_assets.validate_opening_source_scope(
            workspace, asset_root_id, request.get("requested_source_scope"),
        )
    except coc_module_assets.ModuleAssetsError:
        return None
    if str(request.get("source_scope_signature") or "") != (
        coc_module_assets.opening_source_scope_signature(scope)
    ):
        return None
    return scope


def resolve_selected_opening_binding(
    workspace: Path,
    root_info: dict[str, Any],
    skeleton: dict[str, Any],
    start_location_id: str,
    supplied_pdf_indices: list[int] | None,
    *,
    required_npc_ids: list[str] | None = None,
    required_secret_ids: list[str] | None = None,
) -> dict[str, Any]:
    """Derive one exact scope and qualify its selected source pack."""
    durable_scope = None
    if supplied_pdf_indices is None:
        durable_scope = _fulfilled_foreground_opening_scope_for_pack(
            workspace,
            str(root_info["asset_root_id"]),
            start_location_id,
        )
    if durable_scope is not None:
        window = {
            "window_origin": "fulfilled_foreground_request",
            "scope": durable_scope,
        }
    else:
        window = resolve_opening_source_window(
            workspace,
            root_info,
            skeleton,
            start_location_id,
            supplied_pdf_indices,
        )
    readiness = opening_pack_readiness(
        workspace,
        str(root_info["asset_root_id"]),
        start_location_id,
        required_npc_ids=required_npc_ids,
        required_secret_ids=required_secret_ids,
        required_source_scope=window["scope"],
    )
    return {**window, "readiness": readiness}


_OPENING_LOCATION_PROJECTION_FIELDS = frozenset({
    "location_id", "title", "display_name", "parse_state", "evidence_gap",
    "dramatic_question", "scene_type", "player_safe_summary",
    "available_clue_ids", "npc_ids", "pressure_moves", "affordances", "tone",
    "storylet_tags", "allowed_improvisation", "exit_conditions", "scene_edges",
    "san_triggers", "source_refs", "source_span", "source_page_indices",
    "page_text_sha256", "source_evidence", "source_discrepancies",
    "location_tags", "entry_conditions", "importance", "clues", "npcs",
    "keeper_secret_refs", "mentions", "origin",
})
_OPENING_CLUE_PROJECTION_FIELDS = frozenset({
    "clue_id", "conclusion_id", "importance", "conclusion_description",
    "delivery_kind", "visibility", "player_safe_summary", "localized_text",
    "discovery", "provenance", "source_refs", "source_span",
    "source_page_indices", "page_text_sha256", "source_evidence", "parse_state",
    "origin", "mentions", "handout_id",
})
_OPENING_NPC_PROJECTION_FIELDS = frozenset({
    "npc_id", "name", "display_name", "agenda", "agenda_public",
    "relationship_to_investigators", "role_tags", "social_role", "voice",
    "voice_notes", "parse_state", "origin", "source_refs", "source_span",
    "source_page_indices", "page_text_sha256", "source_evidence", "scene_ids",
    "schedule",
})
_OPENING_SECRET_PROJECTION_FIELDS = frozenset({
    "id", "secret_id", "category", "prose", "body", "text", "scene_ids",
    "provenance", "source_refs", "source_span", "source_page_indices",
    "page_text_sha256", "source_evidence", "origin",
})


def _opening_projection_record(
    value: dict[str, Any], fields: frozenset[str],
) -> dict[str, Any]:
    return {
        key: json.loads(json.dumps(item))
        for key, item in value.items()
        if key in fields
    }


def _opening_location_projection_record(pack: dict[str, Any]) -> dict[str, Any]:
    location = _opening_projection_record(pack, _OPENING_LOCATION_PROJECTION_FIELDS)
    location["clues"] = [
        _opening_projection_record(row, _OPENING_CLUE_PROJECTION_FIELDS)
        for row in (pack.get("clues") or []) if isinstance(row, dict)
    ]
    location["npcs"] = [
        _opening_projection_record(row, _OPENING_NPC_PROJECTION_FIELDS)
        for row in (pack.get("npcs") or []) if isinstance(row, dict)
    ]
    location["keeper_secret_refs"] = [
        _opening_projection_record(row, _OPENING_SECRET_PROJECTION_FIELDS)
        for row in (pack.get("keeper_secret_refs") or []) if isinstance(row, dict)
    ]
    return location


def _repository_qualified_opening_inputs(
    workspace: Path,
    asset_root_id: str,
    start_location_id: str,
    required_source_scope: dict[str, Any],
    *,
    host_work_mode: str = "mutating",
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    """Load and authenticate the current opening pack from durable state."""
    try:
        root_id = coc_module_assets._require_id(
            asset_root_id, "asset_root_id",
        )
        start_id = coc_module_assets._require_id(
            start_location_id, "start_location_id",
        )
        canonical_scope = coc_module_assets.validate_opening_source_scope(
            workspace, root_id, required_source_scope,
        )
    except coc_module_assets.ModuleAssetsError as exc:
        raise ModuleProjectError(
            f"opening projection source qualification failed: {exc}"
        ) from exc
    if canonical_scope != required_source_scope:
        raise ModuleProjectError(
            "opening projection source scope must be canonical"
        )
    skeleton = coc_module_assets.get_skeleton(workspace, root_id)
    if not isinstance(skeleton, dict):
        raise ModuleProjectError("opening projection requires a durable skeleton")
    if start_id not in {
        str(value).strip() for value in (skeleton.get("start_candidates") or [])
        if isinstance(value, str) and value.strip()
    }:
        raise ModuleProjectError(
            "opening projection start is not a durable structured candidate"
        )
    location = next(
        (
            row for row in (skeleton.get("locations") or [])
            if isinstance(row, dict)
            and str(row.get("location_id") or "") == start_id
        ),
        None,
    )
    if not isinstance(location, dict):
        raise ModuleProjectError(
            "opening projection start has no durable skeleton locator"
        )
    try:
        locator_indices = coc_module_assets._source_indices(
            location, field="opening_projection_locator",
        )
    except coc_module_assets.ModuleAssetsError as exc:
        raise ModuleProjectError(str(exc)) from exc
    if locator_indices and not set(canonical_scope["pdf_indices"]) <= set(
        locator_indices
    ):
        raise ModuleProjectError(
            "opening projection source scope lies outside the durable locator"
        )
    readiness = opening_pack_readiness(
        workspace,
        root_id,
        start_id,
        required_source_scope=canonical_scope,
        host_work_mode=host_work_mode,
    )
    if not readiness.get("ready"):
        blockers = [
            str(row.get("code") or "opening_pack_not_ready")
            for row in (readiness.get("blocking") or [])
            if isinstance(row, dict)
        ]
        raise ModuleProjectError(
            "opening projection requires a repository-qualified current pack: "
            + ",".join(blockers[:8])
        )
    pack = readiness.get("pack")
    binding = readiness.get("source_binding")
    if not isinstance(pack, dict) or not isinstance(binding, dict):
        raise ModuleProjectError(
            "opening projection qualification returned no durable pack binding"
        )
    return pack, binding, canonical_scope


def build_opening_projection_payload(
    workspace: Path,
    asset_root_id: str,
    start_location_id: str,
    required_source_scope: dict[str, Any],
    *,
    host_work_mode: str = "mutating",
) -> dict[str, Any]:
    pack, source_binding, _canonical_scope = (
        _repository_qualified_opening_inputs(
            workspace,
            asset_root_id,
            start_location_id,
            required_source_scope,
            host_work_mode=host_work_mode,
        )
    )
    location = _opening_location_projection_record(pack)
    binding = json.loads(json.dumps(source_binding))
    if not (
        binding.get("schema_version") == 1
        and binding.get("authority") == "source_authored"
        and binding.get("asset_root_id") == asset_root_id
        and binding.get("start_location_id") == location.get("location_id")
        and isinstance(binding.get("source_scope"), dict)
        and binding.get("source_scope_signature")
        == coc_module_assets.opening_source_scope_signature(
            binding["source_scope"]
        )
    ):
        raise ModuleProjectError(
            "opening projection payload requires a qualified source binding"
        )
    if _opening_campaign_local_row(location) or not _opening_pack_has_accepted_source_evidence(
        location
    ):
        raise ModuleProjectError(
            "campaign-local or unproven content cannot become a source opening"
        )
    embedded_clue_ids = {
        str(row.get("clue_id") or "")
        for row in (pack.get("clues") or []) if isinstance(row, dict)
    }
    clues: list[dict[str, Any]] = []
    for clue_id in pack.get("available_clue_ids") or []:
        cid = str(clue_id or "")
        if not cid or cid in embedded_clue_ids:
            continue
        clue = coc_module_assets.revalidate_entity_pack(
            workspace, asset_root_id, "clue", cid,
        )
        if isinstance(clue, dict):
            clues.append(_opening_projection_record(
                clue, _OPENING_CLUE_PROJECTION_FIELDS,
            ))
    embedded_npc_ids = {
        str(row.get("npc_id") or "")
        for row in (pack.get("npcs") or []) if isinstance(row, dict)
    }
    npcs: list[dict[str, Any]] = []
    for npc_id in pack.get("npc_ids") or []:
        nid = str(npc_id or "")
        if not nid or nid in embedded_npc_ids:
            continue
        npc = coc_module_assets.revalidate_entity_pack(
            workspace, asset_root_id, "npc", nid,
        )
        if isinstance(npc, dict):
            npcs.append(_opening_projection_record(
                npc, _OPENING_NPC_PROJECTION_FIELDS,
            ))
    return {
        "source_binding": binding,
        "location": location,
        "clues": clues,
        "npcs": npcs,
    }


def _canonical_sha256(value: Any) -> str:
    encoded = json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def opening_projection_receipt(
    asset_root_id: str,
    start_location_id: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    location = payload.get("location") if isinstance(payload.get("location"), dict) else {}
    return {
        "schema_version": 1,
        "asset_root_id": asset_root_id,
        "start_location_id": start_location_id,
        "source_evidence_sha256": _canonical_sha256(
            location.get("source_evidence") or {}
        ),
        "projection_input_sha256": _canonical_sha256(payload),
    }


def current_opening_projection_receipt(campaign_dir: Path) -> dict[str, Any] | None:
    scenario = _load_json(campaign_dir / "scenario" / "scenario.json", {})
    receipt = scenario.get("opening_projection_receipt") if isinstance(scenario, dict) else None
    return json.loads(json.dumps(receipt)) if isinstance(receipt, dict) else None


def adopt_source_era(campaign_dir: Path, era: str) -> dict[str, Any]:
    """Bind a source-established era onto the campaign and seed its clock.

    This is the fast source-parse lane's only write. It reuses the same authored
    era/clock owner the later skeleton projection uses, so both lanes agree on
    one canonical era key and one pristine civil clock, and it refreshes the
    player-facing setup briefing that was rendered while the period was unknown.
    """
    campaign_dir = Path(campaign_dir)
    # Fast source facts establish the campaign era, not a scenario-specific
    # civil date.  Keep a raw-PDF campaign unanchored until the progressive
    # skeleton supplies source-backed start_clock evidence; borrowing the
    # generic 1920s epoch here produces visible contradictions such as a
    # January 1925 clock beside an authored April 1926/1927 opening.
    _sync_campaign_era_clock_from_meta(campaign_dir, {
        "era": era,
        "start_clock": {
            "calendar_mode": "relative",
            "local_datetime": None,
            "local_date": None,
            "timezone": None,
            "display": "",
            "time_precision": "unknown",
            "day_phase_hint": None,
        },
    })
    camp = _load_json(campaign_dir / "campaign.json", {})
    return {
        "era": str(camp.get("era") or "") if isinstance(camp, dict) else "",
        "briefing_path": _refresh_character_creation_briefing_if_stale(
            campaign_dir
        ),
    }


OPENING_SOURCE_NOT_GATED = "not_source_gated"
OPENING_SOURCE_READY = "ready"
OPENING_SOURCE_PENDING = "pending"
OPENING_SOURCE_FAILED = "failed"
OPENING_SOURCE_NOT_PREPARED = "not_prepared"


def opening_source_readiness(campaign_dir: Path) -> dict[str, Any]:
    """Report whether the source-bound opening is parsed, verified, and projected.

    This is the authority the table-opening boundary consumes so a Keeper cannot
    narrate an opening while the background source lane is still running or has
    already failed. Campaigns with no PDF/progressive binding — built-in
    starters and cold-compiled scenarios — are not gated by this lane at all.
    """
    campaign_dir = Path(campaign_dir)
    scenario = _load_json(campaign_dir / "scenario" / "scenario.json", {})
    if not isinstance(scenario, dict):
        scenario = {}
    source_bound = bool(
        str(scenario.get("source_cache_asset_root_id") or "").strip()
        or str(scenario.get("progressive_asset_root_id") or "").strip()
    )
    if not source_bound:
        return {"state": OPENING_SOURCE_NOT_GATED, "reason": "no_source_binding"}
    if (campaign_dir / "scenario" / "resolution-receipt.json").is_file():
        # Cold compilation already published the whole scenario IR.
        return {"state": OPENING_SOURCE_NOT_GATED, "reason": "cold_compiled"}
    if isinstance(scenario.get("opening_projection_receipt"), dict):
        return {"state": OPENING_SOURCE_READY, "reason": "opening_projected"}
    watch = scenario.get("opening_projection_watch")
    if not isinstance(watch, dict):
        return {
            "state": OPENING_SOURCE_NOT_PREPARED,
            "reason": "no_opening_projection_watch",
        }
    status = str(watch.get("status") or "")
    if status == "complete":
        return {"state": OPENING_SOURCE_READY, "reason": "watch_complete"}
    if status == "refused_terminal":
        last_error = watch.get("last_error")
        return {
            "state": OPENING_SOURCE_FAILED,
            "reason": "watch_refused_terminal",
            "last_error": (
                json.loads(json.dumps(last_error))
                if isinstance(last_error, dict) else None
            ),
        }
    return {
        "state": OPENING_SOURCE_PENDING,
        "reason": "watch_status:" + (status or "unknown"),
    }


def current_opening_projection_source_binding(
    campaign_dir: Path,
) -> dict[str, Any] | None:
    scenario = _load_json(campaign_dir / "scenario" / "scenario.json", {})
    binding = (
        scenario.get("opening_projection_source_binding")
        if isinstance(scenario, dict)
        else None
    )
    return (
        json.loads(json.dumps(binding))
        if isinstance(binding, dict)
        else None
    )


def _opening_value_contains(actual: Any, expected: Any) -> bool:
    """Compare source-owned values while permitting unrelated dict keys."""
    if isinstance(expected, dict):
        return isinstance(actual, dict) and all(
            key in actual and _opening_value_contains(actual[key], value)
            for key, value in expected.items()
        )
    return actual == expected


def _opening_without_authority_metadata(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: _opening_without_authority_metadata(item)
            for key, item in value.items()
            if key not in {"origin", "provenance"}
        }
    if isinstance(value, list):
        return [_opening_without_authority_metadata(item) for item in value]
    return value


def _opening_structured_collision_keys(
    value: dict[str, Any],
    kind: str,
) -> frozenset[str]:
    id_fields = {
        "affordance": ("id", "affordance_id"),
        "edge": ("id", "edge_id"),
        "secret_link": ("id", "secret_id"),
    }[kind]
    aliases = {
        str(value.get(field) or "").strip()
        for field in id_fields
        if str(value.get(field) or "").strip()
    }
    if aliases:
        return frozenset(f"alias:{alias}" for alias in aliases)
    semantic = _opening_without_authority_metadata(value)
    if kind == "edge":
        destination = str(value.get("to") or "").strip()
        edge_kind = str(value.get("kind") or "").strip()
        if destination:
            return frozenset({f"semantic:to:{destination}|kind:{edge_kind}"})
    return frozenset({"semantic:sha256:" + _canonical_sha256(semantic)})


def _opening_structured_row_id(value: dict[str, Any], kind: str) -> str:
    """Compatibility display identity; collision logic uses the full key set."""
    keys = sorted(_opening_structured_collision_keys(value, kind))
    return keys[0]


def _opening_overlay_expected_row(
    current: dict[str, Any],
    expected: dict[str, Any],
) -> dict[str, Any]:
    """Overlay frozen canonical fields while retaining unrelated current keys."""
    out = json.loads(json.dumps(current))
    for key, expected_value in expected.items():
        current_value = out.get(key)
        if isinstance(current_value, dict) and isinstance(expected_value, dict):
            out[key] = _opening_overlay_expected_row(
                current_value, expected_value,
            )
        else:
            out[key] = json.loads(json.dumps(expected_value))
    return out


def _opening_fill_missing_values(target: dict[str, Any], source: dict[str, Any]) -> None:
    for key, value in source.items():
        if key not in target:
            target[key] = json.loads(json.dumps(value))
        elif isinstance(target.get(key), dict) and isinstance(value, dict):
            _opening_fill_missing_values(target[key], value)


def _opening_merge_duplicate_roots(rows: list[dict[str, Any]]) -> dict[str, Any]:
    preferred = next(
        (row for row in rows if not _opening_campaign_local_row(row)),
        rows[0] if rows else {},
    )
    merged = json.loads(json.dumps(preferred))
    for row in rows:
        _opening_fill_missing_values(merged, row)
    return merged


def _opening_expected_structured_groups(
    rows: Any,
    *,
    kind: str,
) -> list[dict[str, Any]]:
    """Build authored identity groups while rejecting cross-group aliases."""
    groups: list[dict[str, Any]] = []
    owner_by_key: dict[str, int] = {}
    for raw_row in rows or []:
        if not isinstance(raw_row, dict) or _opening_campaign_local_row(raw_row):
            continue
        row = json.loads(json.dumps(raw_row))
        keys = set(_opening_structured_collision_keys(row, kind))
        owners = {owner_by_key[key] for key in keys if key in owner_by_key}
        if len(owners) > 1:
            raise OpeningStructuredCollisionError(
                f"{kind} row aliases multiple authored opening identities"
            )
        if owners:
            group_index = next(iter(owners))
            group = groups[group_index]
            merged = _opening_overlay_expected_row(group["row"], row)
            combined_keys = set(group["keys"]) | keys | set(
                _opening_structured_collision_keys(merged, kind)
            )
            conflicting = {
                owner_by_key[key]
                for key in combined_keys
                if key in owner_by_key and owner_by_key[key] != group_index
            }
            if conflicting:
                raise OpeningStructuredCollisionError(
                    f"{kind} row aliases multiple authored opening identities"
                )
            group["row"] = merged
            group["keys"] = frozenset(combined_keys)
        else:
            group_index = len(groups)
            group = {"row": row, "keys": frozenset(keys)}
            groups.append(group)
        for key in group["keys"]:
            owner_by_key[key] = group_index
    return groups


def _opening_expected_structured_rows(
    rows: Any,
    *,
    kind: str,
) -> list[dict[str, Any]]:
    """Freeze exactly one source row for each collision-key group."""
    return [
        json.loads(json.dumps(group["row"]))
        for group in _opening_expected_structured_groups(rows, kind=kind)
    ]


def _opening_reconcile_structured_rows(
    expected_rows: Any,
    current_rows: Any,
    *,
    kind: str,
) -> list[dict[str, Any]]:
    """Upsert source rows by all aliases; keep noncolliding local extras."""
    groups = _opening_expected_structured_groups(expected_rows, kind=kind)
    current = [
        json.loads(json.dumps(row))
        for row in (current_rows or [])
        if isinstance(row, dict)
    ]
    owner_by_key = {
        key: index
        for index, group in enumerate(groups)
        for key in group["keys"]
    }
    matches_by_group: dict[int, list[dict[str, Any]]] = {
        index: [] for index in range(len(groups))
    }
    local_extras: list[dict[str, Any]] = []
    for row in current:
        owners = {
            owner_by_key[key]
            for key in _opening_structured_collision_keys(row, kind)
            if key in owner_by_key
        }
        if len(owners) > 1:
            raise OpeningStructuredCollisionError(
                f"{kind} row aliases multiple authored opening identities"
            )
        if owners:
            matches_by_group[next(iter(owners))].append(row)
        elif _opening_campaign_local_row(row):
            local_extras.append(row)
    result: list[dict[str, Any]] = []
    for group_index, group in enumerate(groups):
        expected_row = group["row"]
        matches = matches_by_group[group_index]
        source_matches = [
            row for row in matches if not _opening_campaign_local_row(row)
        ]
        preferred = source_matches[0] if source_matches else {}
        base = json.loads(json.dumps(preferred))
        for row in source_matches:
            for key, value in row.items():
                if key not in base:
                    base[key] = json.loads(json.dumps(value))
        repaired = _opening_overlay_expected_row(base, expected_row)
        for alias_field in {
            "affordance": ("id", "affordance_id"),
            "edge": ("id", "edge_id"),
            "secret_link": ("id", "secret_id"),
        }[kind]:
            if alias_field not in expected_row:
                repaired.pop(alias_field, None)
        if "origin" not in expected_row and str(
            repaired.get("origin") or ""
        ).startswith("campaign_"):
            repaired.pop("origin", None)
        provenance = (
            repaired.get("provenance")
            if isinstance(repaired.get("provenance"), dict)
            else {}
        )
        if (
            "provenance" not in expected_row
            and provenance.get("authority")
            in _OPENING_CAMPAIGN_AUTHORITIES
        ):
            repaired.pop("provenance", None)
        result.append(repaired)
    result.extend(local_extras)
    return result


def _opening_structured_rows_are_fresh(
    expected_rows: Any,
    actual_rows: Any,
    *,
    kind: str,
) -> bool:
    """Match source rows by every alias and allow explicit local extras."""
    if not isinstance(expected_rows, list) or not isinstance(actual_rows, list):
        return False
    actual = [row for row in actual_rows if isinstance(row, dict)]
    if len(actual) != len(actual_rows):
        return False
    try:
        groups = _opening_expected_structured_groups(expected_rows, kind=kind)
    except OpeningStructuredCollisionError:
        return False
    owner_by_key = {
        key: index
        for index, group in enumerate(groups)
        for key in group["keys"]
    }
    matches_by_group: dict[int, list[dict[str, Any]]] = {
        index: [] for index in range(len(groups))
    }
    for actual_row in actual:
        owners = {
            owner_by_key[key]
            for key in _opening_structured_collision_keys(actual_row, kind)
            if key in owner_by_key
        }
        if len(owners) > 1:
            return False
        if owners:
            if _opening_campaign_local_row(actual_row):
                return False
            matches_by_group[next(iter(owners))].append(actual_row)
        elif not _opening_campaign_local_row(actual_row):
            return False
    for group_index, group in enumerate(groups):
        matches = matches_by_group[group_index]
        if len(matches) != 1 or not _opening_value_contains(
            matches[0], group["row"],
        ):
            return False
    return True


def _opening_entity_row_id(
    row: dict[str, Any],
    id_fields: tuple[str, ...],
) -> str:
    for field in id_fields:
        entity_id = str(row.get(field) or "").strip()
        if entity_id:
            return entity_id
    return ""


def _opening_expected_entity_rows(
    rows: Any,
    *,
    id_fields: tuple[str, ...],
) -> list[dict[str, Any]]:
    order: list[str] = []
    by_id: dict[str, dict[str, Any]] = {}
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        entity_id = _opening_entity_row_id(row, id_fields)
        if not entity_id:
            continue
        if entity_id not in by_id:
            order.append(entity_id)
        by_id[entity_id] = json.loads(json.dumps(row))
    return [by_id[entity_id] for entity_id in order]


def _opening_repair_expected_entity_row(
    expected_row: dict[str, Any],
    matches: list[dict[str, Any]],
    *,
    union_list_fields: tuple[str, ...] = (),
) -> dict[str, Any]:
    preferred = next(
        (row for row in matches if not _opening_campaign_local_row(row)),
        matches[0] if matches else {},
    )
    base = json.loads(json.dumps(preferred))
    for row in matches:
        for key, value in row.items():
            if key not in base:
                base[key] = json.loads(json.dumps(value))
    repaired = _opening_overlay_expected_row(base, expected_row)
    for field in union_list_fields:
        values = {
            str(value)
            for row in [*matches, expected_row]
            for value in (row.get(field) or [])
            if str(value).strip()
        }
        repaired[field] = sorted(values)
    if "origin" not in expected_row and str(
        repaired.get("origin") or ""
    ).startswith("campaign_"):
        repaired.pop("origin", None)
    provenance = (
        repaired.get("provenance")
        if isinstance(repaired.get("provenance"), dict)
        else {}
    )
    if (
        "provenance" not in expected_row
        and provenance.get("authority")
        in {"campaign_improvised", "campaign_generated"}
    ):
        repaired.pop("provenance", None)
    return repaired


def _opening_reconcile_entity_rows(
    expected_rows: Any,
    current_rows: Any,
    *,
    id_fields: tuple[str, ...],
    union_list_fields: tuple[str, ...] = (),
) -> list[dict[str, Any]]:
    expected = _opening_expected_entity_rows(
        expected_rows, id_fields=id_fields,
    )
    expected_by_id = {
        _opening_entity_row_id(row, id_fields): row for row in expected
    }
    current = [
        json.loads(json.dumps(row))
        for row in (current_rows or [])
        if isinstance(row, dict)
    ]
    matches_by_id = {
        entity_id: [
            row for row in current
            if _opening_entity_row_id(row, id_fields) == entity_id
        ]
        for entity_id in expected_by_id
    }
    emitted: set[str] = set()
    result: list[dict[str, Any]] = []
    for row in current:
        entity_id = _opening_entity_row_id(row, id_fields)
        expected_row = expected_by_id.get(entity_id)
        if expected_row is None:
            result.append(row)
            continue
        if entity_id in emitted:
            continue
        result.append(_opening_repair_expected_entity_row(
            expected_row,
            matches_by_id[entity_id],
            union_list_fields=union_list_fields,
        ))
        emitted.add(entity_id)
    for expected_row in expected:
        entity_id = _opening_entity_row_id(expected_row, id_fields)
        if entity_id in emitted:
            continue
        result.append(_opening_repair_expected_entity_row(
            expected_row,
            [],
            union_list_fields=union_list_fields,
        ))
        emitted.add(entity_id)
    return result


def _opening_expected_seed_ir(start_location_id: str) -> dict[str, Any]:
    """Return the minimal current-independent IR needed by canonical mergers."""
    return {
        "story-graph.json": {
            "scenes": [{
                "scene_id": start_location_id,
                "is_start": True,
                "origin": "source",
                "available_clues": [],
                "npc_ids": [],
                "affordances": [],
                "scene_edges": [],
                "keeper_secret_refs": [],
            }],
        },
        "clue-graph.json": {"conclusions": []},
        "npc-agendas.json": {"npcs": []},
        "pacing-map.json": {"curve": []},
        "improvisation-boundaries.json": {"keeper_secrets": []},
    }


def _l0_hook_locale_languages(hook: dict[str, Any], field: str) -> set[str]:
    """Languages already covered by one L0 hook locale field.

    Mirrors ``coc_module_assets._validate_location_read_aloud_locales``:
    a locale map covers its non-empty keys; a tagged string covers only
    ``localized_language``.  Source ``text`` / ``title`` never count.
    """
    value = hook.get(field)
    if isinstance(value, dict) and value:
        return {
            language
            for language, localized_value in value.items()
            if isinstance(language, str)
            and language.strip()
            and isinstance(localized_value, str)
            and localized_value.strip()
        }
    if isinstance(value, str) and value.strip():
        tagged = str(hook.get("localized_language") or "").strip()
        if tagged:
            return {tagged}
    return set()


def _l0_player_hook_ready_for_read_aloud(hook: dict[str, Any]) -> bool:
    """True when the hook already satisfies the player-language read_aloud contract.

    A boxed passage is legal only when ``localized_title`` and
    ``localized_text`` share at least one play language.  Thin source-only
    L0 hooks stay on ``player_safe_summary``; they are not promoted and
    never receive fabricated locale maps.
    """
    title_languages = _l0_hook_locale_languages(hook, "localized_title")
    text_languages = _l0_hook_locale_languages(hook, "localized_text")
    return bool(title_languages & text_languages)


def build_l0_direct_opening_pack(
    l0: dict[str, Any],
    *,
    location_id: str,
    title: str,
    source_refs: list[dict[str, Any]],
    scope_pdf_indices: list[int],
) -> dict[str, Any]:
    """Build the minimal source-bound opening location pack from module-init L0.

    The source-reviewed module-init L0 carries the authored opening text as
    ``opening_hooks``: player hooks become boxed ``read_aloud`` only when
    their locale maps already satisfy the player-language contract, and
    keeper hooks are Keeper-only notes.  Thin source-only player hooks stay
    on ``player_safe_summary`` so a partial pack can bootstrap without an
    invalid boxed passage.  This pack is the direct-write equivalent of a
    foreground ``partial_opening`` slice without any host-work claim/fulfill
    spine: same entity contract, same source-evidence discipline, zero
    coordinator dependency.  Opening handout cards no longer stay on the L0
    document: the opening bootstrap lifts them into canonical handout
    entities (``coc_runtime_ops.l0_opening_handout_cards``) that flow through
    the same card store + delivery path as every other handout; this pack
    lifts only the scene text and provenance the projection needs.
    """
    hooks = [
        row for row in (l0.get("opening_hooks") or []) if isinstance(row, dict)
    ]
    player_hooks = [
        row for row in hooks
        if row.get("audience") == "player"
        and isinstance(row.get("text"), str)
        and str(row["text"]).strip()
    ]
    keeper_hooks = [
        row for row in hooks
        if row.get("audience") == "keeper"
        and isinstance(row.get("text"), str)
        and str(row["text"]).strip()
    ]
    refs = json.loads(json.dumps(source_refs))
    read_aloud: list[dict[str, Any]] = []
    seen_read_ids: set[str] = set()
    for hook in player_hooks:
        hook_id = str(hook.get("id") or "").strip()
        if not hook_id or hook_id in seen_read_ids:
            continue
        seen_read_ids.add(hook_id)
        if not _l0_player_hook_ready_for_read_aloud(hook):
            continue
        read_row = {
            "id": hook_id,
            "trigger": "on_enter",
            "text": str(hook["text"]).strip(),
            "source_refs": json.loads(json.dumps(refs)),
        }
        for field in ("title", "localized_title", "localized_text", "localized_language"):
            if hook.get(field) is not None:
                read_row[field] = json.loads(json.dumps(hook[field]))
        read_aloud.append(read_row)
    keeper_only: list[dict[str, Any]] = []
    seen_keeper_ids: set[str] = set()
    for hook in keeper_hooks:
        hook_id = str(hook.get("id") or "").strip()
        if not hook_id or hook_id in seen_keeper_ids:
            continue
        seen_keeper_ids.add(hook_id)
        keeper_only.append({
            "id": hook_id,
            "note": str(hook["text"]).strip(),
            "source_refs": json.loads(json.dumps(refs)),
        })
    indices = [int(value) for value in scope_pdf_indices]
    return {
        "location_id": location_id,
        "title": title,
        "display_name": title,
        "parse_state": "partial",
        "evidence_gap": False,
        "player_safe_summary": _l0_direct_player_safe_summary(
            l0, player_hooks, title,
        ),
        "read_aloud": read_aloud,
        "keeper_only": keeper_only,
        "source_page_indices": indices,
        "source_refs": json.loads(json.dumps(refs)),
        "origin": "source",
        "provenance": {
            "authority": "source_authored",
            "source_refs": json.loads(json.dumps(refs)),
            "basis": "module_init_l0",
        },
        "l0_direct_opening": {
            "schema_version": 1,
            "source": "module-init.json",
            "hook_count": len(read_aloud) + len(keeper_only),
        },
    }


def _l0_direct_player_safe_summary(
    l0: dict[str, Any],
    player_hooks: list[dict[str, Any]],
    title: str,
) -> str:
    """One source-grounded player-safe scene summary for the L0 direct pack.

    Preferred order: the first player hook text (the authored opening premise)
    before the module campaign hook before the location title.  Nothing is
    invented: every candidate is source-derived text from the reviewed L0.
    """
    for hook in player_hooks:
        text = str(hook.get("text") or "").strip()
        if text:
            return text
    meta = l0.get("module_meta")
    if isinstance(meta, dict):
        campaign_hooks = meta.get("campaign_hooks")
        if isinstance(campaign_hooks, list):
            for hook in campaign_hooks:
                if isinstance(hook, str) and hook.strip():
                    return hook.strip()
    return title


def _build_canonical_opening_slice(
    payload: dict[str, Any],
    start_location_id: str,
) -> dict[str, Any]:
    """Pure helper behind repository-qualified public opening builders."""
    source_binding = payload.get("source_binding")
    if not (
        isinstance(source_binding, dict)
        and source_binding.get("schema_version") == 1
        and source_binding.get("authority") == "source_authored"
        and source_binding.get("start_location_id") == start_location_id
        and isinstance(source_binding.get("source_scope"), dict)
        and source_binding.get("source_scope_signature")
        == coc_module_assets.opening_source_scope_signature(
            source_binding["source_scope"]
        )
    ):
        raise ModuleProjectError(
            "canonical opening slice requires a qualified source binding"
        )
    location = payload.get("location")
    if not isinstance(location, dict):
        raise ModuleProjectError("opening payload missing location")
    location_id = str(location.get("location_id") or "").strip()
    if not location_id or location_id != start_location_id:
        raise ModuleProjectError(
            "opening payload location does not match selected start"
        )
    if _opening_campaign_local_row(location) or not _opening_pack_has_accepted_source_evidence(
        location
    ):
        raise ModuleProjectError(
            "campaign-local or unproven content cannot become a source opening"
        )
    expected_ir = merge_deep_location_into_ir(
        _opening_expected_seed_ir(start_location_id),
        location,
    )
    for clue in payload.get("clues") or []:
        if isinstance(clue, dict):
            expected_ir = merge_deep_entity_into_ir(
                expected_ir, "clue", clue,
            )
    for npc in payload.get("npcs") or []:
        if isinstance(npc, dict):
            expected_ir = merge_deep_entity_into_ir(
                expected_ir, "npc", npc,
            )
    scene = next(
        (
            row for row in expected_ir["story-graph.json"]["scenes"]
            if isinstance(row, dict)
            and str(row.get("scene_id") or "") == start_location_id
        ),
        None,
    )
    if not isinstance(scene, dict):
        raise ModuleProjectError("canonical opening scene was not produced")
    scene = json.loads(json.dumps(scene))
    scene["is_start"] = True
    scene["origin"] = "source"
    scene["affordances"] = _opening_expected_structured_rows(
        scene.get("affordances") or [], kind="affordance",
    )
    scene["scene_edges"] = _opening_expected_structured_rows(
        scene.get("scene_edges") or [], kind="edge",
    )
    scene["keeper_secret_refs"] = _opening_expected_structured_rows(
        scene.get("keeper_secret_refs") or [], kind="secret_link",
    )

    clue_groups: list[dict[str, Any]] = []
    seen_clues: set[str] = set()
    for conclusion in expected_ir["clue-graph.json"].get("conclusions") or []:
        if not isinstance(conclusion, dict):
            continue
        rows: list[dict[str, Any]] = []
        for clue in conclusion.get("clues") or []:
            if not isinstance(clue, dict):
                continue
            clue_id = _opening_entity_row_id(clue, ("clue_id",))
            if not clue_id or clue_id in seen_clues:
                continue
            seen_clues.add(clue_id)
            rows.append(json.loads(json.dumps(clue)))
        if not rows:
            continue
        clue_groups.append({
            "conclusion": {
                key: json.loads(json.dumps(value))
                for key, value in conclusion.items()
                if key != "clues"
            },
            "clues": rows,
        })
    npcs = _opening_expected_entity_rows(
        expected_ir["npc-agendas.json"].get("npcs") or [],
        id_fields=("npc_id",),
    )
    secrets = _opening_expected_entity_rows(
        expected_ir["improvisation-boundaries.json"].get(
            "keeper_secrets"
        ) or [],
        id_fields=("id", "secret_id"),
    )
    return {
        "start_location_id": start_location_id,
        "scene": scene,
        "clue_groups": clue_groups,
        "npcs": npcs,
        "keeper_secrets": secrets,
    }


def _opening_apply_expected_clues(
    ir: dict[str, Any],
    clue_groups: list[dict[str, Any]],
) -> None:
    conclusions = ir["clue-graph.json"].setdefault("conclusions", [])
    grouped: list[dict[str, Any]] = []
    grouped_by_id: dict[str, dict[str, Any]] = {}
    for group in clue_groups:
        expected_conclusion = group.get("conclusion")
        if not isinstance(expected_conclusion, dict):
            continue
        conclusion_id = str(expected_conclusion.get("conclusion_id") or "")
        target = grouped_by_id.get(conclusion_id)
        if target is None:
            target = {
                "conclusion": json.loads(json.dumps(expected_conclusion)),
                "clues": [],
            }
            grouped_by_id[conclusion_id] = target
            grouped.append(target)
        else:
            target["conclusion"] = _opening_overlay_expected_row(
                target["conclusion"], expected_conclusion,
            )
        target["clues"].extend(
            json.loads(json.dumps(row))
            for row in (group.get("clues") or [])
            if isinstance(row, dict)
        )
    expected_ids = {
        _opening_entity_row_id(row, ("clue_id",))
        for group in grouped
        for row in (group.get("clues") or [])
        if isinstance(row, dict)
    }
    matches_by_id = {
        clue_id: [
            row
            for conclusion in conclusions
            if isinstance(conclusion, dict)
            for row in (conclusion.get("clues") or [])
            if isinstance(row, dict)
            and _opening_entity_row_id(row, ("clue_id",)) == clue_id
        ]
        for clue_id in expected_ids
    }
    for conclusion in conclusions:
        if not isinstance(conclusion, dict):
            continue
        conclusion["clues"] = [
            row for row in (conclusion.get("clues") or [])
            if not isinstance(row, dict)
            or _opening_entity_row_id(row, ("clue_id",)) not in expected_ids
        ]
    for group in grouped:
        expected_conclusion = group.get("conclusion")
        if not isinstance(expected_conclusion, dict):
            continue
        conclusion_id = str(
            expected_conclusion.get("conclusion_id") or ""
        )
        match_indices = [
            index for index, row in enumerate(conclusions)
            if isinstance(row, dict)
            and str(row.get("conclusion_id") or "") == conclusion_id
        ]
        matches = [conclusions[index] for index in match_indices]
        current = _opening_merge_duplicate_roots(matches)
        if not current:
            current = {"conclusion_id": conclusion_id, "clues": []}
        preserved_clues = [
            json.loads(json.dumps(clue))
            for row in matches
            for clue in (row.get("clues") or [])
        ]
        repaired_conclusion = _opening_overlay_expected_row(
            current, expected_conclusion,
        )
        repaired_conclusion["clues"] = preserved_clues
        if match_indices:
            first_index = match_indices[0]
            conclusions[:] = [
                row for index, row in enumerate(conclusions)
                if index not in set(match_indices)
            ]
            conclusions.insert(first_index, repaired_conclusion)
        else:
            conclusions.append(repaired_conclusion)
        current = repaired_conclusion
        for expected_clue in group.get("clues") or []:
            if not isinstance(expected_clue, dict):
                continue
            clue_id = _opening_entity_row_id(expected_clue, ("clue_id",))
            current["clues"].append(_opening_repair_expected_entity_row(
                expected_clue,
                matches_by_id.get(clue_id, []),
            ))


def merge_canonical_opening_slice_into_ir(
    ir: dict[str, Any],
    expected_slice: dict[str, Any],
) -> dict[str, Any]:
    """Overlay one frozen opening slice after ordinary merge side effects."""
    out = {key: json.loads(json.dumps(value)) for key, value in ir.items()}
    start_location_id = str(expected_slice.get("start_location_id") or "")
    expected_scene = expected_slice.get("scene")
    if not start_location_id or not isinstance(expected_scene, dict):
        raise ModuleProjectError("canonical opening slice is incomplete")
    scenes = out["story-graph.json"].setdefault("scenes", [])
    scene_indices = [
        index for index, row in enumerate(scenes)
        if isinstance(row, dict)
        and str(row.get("scene_id") or "") == start_location_id
    ]
    scene_matches = [scenes[index] for index in scene_indices]
    scene = _opening_merge_duplicate_roots(scene_matches)
    if not scene:
        scene = {"scene_id": start_location_id}
    scalar_expected = {
        key: value for key, value in expected_scene.items()
        if key not in {"affordances", "scene_edges", "keeper_secret_refs"}
    }
    repaired_scene = _opening_overlay_expected_row(scene, scalar_expected)
    repaired_scene["affordances"] = _opening_reconcile_structured_rows(
        expected_scene.get("affordances") or [],
        [
            row
            for match in scene_matches or [scene]
            for row in (match.get("affordances") or [])
        ],
        kind="affordance",
    )
    repaired_scene["scene_edges"] = _opening_reconcile_structured_rows(
        expected_scene.get("scene_edges") or [],
        [
            row
            for match in scene_matches or [scene]
            for row in (match.get("scene_edges") or [])
        ],
        kind="edge",
    )
    repaired_scene["keeper_secret_refs"] = _opening_reconcile_structured_rows(
        expected_scene.get("keeper_secret_refs") or [],
        [
            row
            for match in scene_matches or [scene]
            for row in (match.get("keeper_secret_refs") or [])
        ],
        kind="secret_link",
    )
    if scene_indices:
        first_index = scene_indices[0]
        remove_indices = set(scene_indices)
        scenes[:] = [
            row for index, row in enumerate(scenes)
            if index not in remove_indices
        ]
        scenes.insert(first_index, repaired_scene)
    else:
        scenes.append(repaired_scene)

    _opening_apply_expected_clues(
        out, list(expected_slice.get("clue_groups") or []),
    )
    out["npc-agendas.json"]["npcs"] = _opening_reconcile_entity_rows(
        expected_slice.get("npcs") or [],
        out["npc-agendas.json"].get("npcs") or [],
        id_fields=("npc_id",),
    )
    out["improvisation-boundaries.json"]["keeper_secrets"] = (
        _opening_reconcile_entity_rows(
            expected_slice.get("keeper_secrets") or [],
            out["improvisation-boundaries.json"].get("keeper_secrets") or [],
            id_fields=("id", "secret_id"),
            union_list_fields=("scene_ids",),
        )
    )
    return out


def _selected_opening_projection_is_fresh_for_payload(
    campaign_dir: Path,
    start_location_id: str,
    payload: dict[str, Any],
    *,
    candidate_ir: dict[str, Any] | None = None,
) -> bool:
    """Prove the selected source slice still exists in canonical campaign IR.

    This is deliberately a slice comparison, not a whole-file digest.  It uses
    the same filtered payload and merge functions as projection, ignores
    mechanics/operational fields that never enter that payload, and permits
    unrelated entities plus explicitly provenance-marked campaign-local rows.
    """
    try:
        expected_slice = _build_canonical_opening_slice(
            payload, start_location_id,
        )
        ir = candidate_ir if candidate_ir is not None else load_campaign_ir(
            campaign_dir
        )
    except (ModuleProjectError, KeyError, TypeError, ValueError, OSError):
        return False

    scenes = (ir.get("story-graph.json") or {}).get("scenes") or []
    scene_matches = [
        row for row in scenes
        if isinstance(row, dict)
        and str(row.get("scene_id") or "") == start_location_id
    ]
    if len(scene_matches) != 1:
        return False
    scene = scene_matches[0]
    expected_scene = expected_slice.get("scene")
    if not isinstance(expected_scene, dict):
        return False
    scalar_expected = {
        key: value for key, value in expected_scene.items()
        if key not in {"affordances", "scene_edges", "keeper_secret_refs"}
    }
    if not _opening_value_contains(scene, scalar_expected):
        return False
    if not _opening_structured_rows_are_fresh(
        expected_scene.get("affordances") or [],
        scene.get("affordances"),
        kind="affordance",
    ):
        return False
    if not _opening_structured_rows_are_fresh(
        expected_scene.get("scene_edges") or [],
        scene.get("scene_edges"),
        kind="edge",
    ):
        return False
    if not _opening_structured_rows_are_fresh(
        expected_scene.get("keeper_secret_refs") or [],
        scene.get("keeper_secret_refs"),
        kind="secret_link",
    ):
        return False

    actual_conclusions = (
        ir.get("clue-graph.json") or {}
    ).get("conclusions") or []
    for group in expected_slice.get("clue_groups") or []:
        expected_conclusion = group.get("conclusion")
        if not isinstance(expected_conclusion, dict):
            return False
        conclusion_id = str(
            expected_conclusion.get("conclusion_id") or ""
        )
        conclusion_matches = [
            row for row in actual_conclusions
            if isinstance(row, dict)
            and str(row.get("conclusion_id") or "") == conclusion_id
        ]
        if len(conclusion_matches) != 1:
            return False
        actual_conclusion = conclusion_matches[0]
        conclusion_expected_values = {
            key: value for key, value in expected_conclusion.items()
            if key != "clues"
        }
        if not _opening_value_contains(
            actual_conclusion, conclusion_expected_values,
        ):
            return False
        for expected_clue in group.get("clues") or []:
            if not isinstance(expected_clue, dict):
                return False
            clue_id = _opening_entity_row_id(expected_clue, ("clue_id",))
            matches = [
                (row, conclusion)
                for conclusion in actual_conclusions
                if isinstance(conclusion, dict)
                for row in (conclusion.get("clues") or [])
                if isinstance(row, dict)
                and _opening_entity_row_id(row, ("clue_id",)) == clue_id
            ]
            if (
                len(matches) != 1
                or matches[0][1] is not actual_conclusion
                or _opening_campaign_local_row(matches[0][0])
                or not _opening_value_contains(matches[0][0], expected_clue)
            ):
                return False

    actual_npcs = [
        row for row in (ir.get("npc-agendas.json") or {}).get("npcs") or []
        if isinstance(row, dict)
    ]
    for expected_npc in expected_slice.get("npcs") or []:
        if not isinstance(expected_npc, dict):
            return False
        npc_id = _opening_entity_row_id(expected_npc, ("npc_id",))
        matches = [
            row for row in actual_npcs
            if _opening_entity_row_id(row, ("npc_id",)) == npc_id
        ]
        if (
            len(matches) != 1
            or _opening_campaign_local_row(matches[0])
            or not _opening_value_contains(matches[0], expected_npc)
        ):
            return False

    actual_secrets = [
        row
        for row in (ir.get("improvisation-boundaries.json") or {}).get(
            "keeper_secrets"
        ) or []
        if isinstance(row, dict)
    ]
    for expected_secret in expected_slice.get("keeper_secrets") or []:
        if not isinstance(expected_secret, dict):
            return False
        secret_id = _opening_entity_row_id(
            expected_secret, ("id", "secret_id"),
        )
        actual_matches = [
            row for row in actual_secrets
            if _opening_entity_row_id(row, ("id", "secret_id")) == secret_id
        ]
        if len(actual_matches) != 1 or _opening_campaign_local_row(
            actual_matches[0]
        ):
            return False
        expected_secret_values = {
            key: value for key, value in expected_secret.items()
            if key != "scene_ids"
        }
        if not _opening_value_contains(actual_matches[0], expected_secret_values):
            return False
        expected_scene_ids = set(expected_secret.get("scene_ids") or [])
        if not expected_scene_ids.issubset(set(actual_matches[0].get("scene_ids") or [])):
            return False
    return True


def opening_projection_state_is_fresh(
    workspace: Path,
    campaign_dir: Path,
    asset_root_id: str,
    start_location_id: str,
    required_source_scope: dict[str, Any],
    *,
    host_work_mode: str = "mutating",
) -> bool:
    """Require durable binding, five-field receipt, and source slice agreement.

    Pristine campaigns (pre-delivery) keep the strict whole-payload receipt
    match so no play starts against a drifting projection. Once the opening has
    been delivered into play (campaign no longer pristine), re-projection is
    forbidden, so the delivered receipt is pinned: freshness anchors on the
    content slice (``source_evidence_sha256`` plus its presence in campaign
    IR), never on the whole-payload input hash that background deepen legally
    rewrites. A genuine content change still fails closed.
    """
    try:
        payload = build_opening_projection_payload(
            workspace,
            asset_root_id,
            start_location_id,
            required_source_scope,
            host_work_mode=host_work_mode,
        )
        receipt = opening_projection_receipt(
            asset_root_id, start_location_id, payload,
        )
    except (ModuleProjectError, KeyError, TypeError, ValueError, OSError):
        return False
    current_binding = current_opening_projection_source_binding(campaign_dir)
    stored_receipt = current_opening_projection_receipt(campaign_dir)
    if (
        current_binding == payload.get("source_binding")
        and stored_receipt == receipt
        and _selected_opening_projection_is_fresh_for_payload(
            campaign_dir,
            start_location_id,
            payload,
        )
    ):
        return True
    if campaign_is_pristine_for_opening(campaign_dir):
        return False
    if not isinstance(stored_receipt, dict) or not isinstance(
        current_binding, dict
    ):
        return False
    return bool(
        stored_receipt.get("schema_version") == 1
        and stored_receipt.get("asset_root_id") == receipt["asset_root_id"]
        and stored_receipt.get("start_location_id")
        == receipt["start_location_id"]
        and stored_receipt.get("source_evidence_sha256")
        == receipt["source_evidence_sha256"]
        and current_binding == payload.get("source_binding")
        and _opening_delivered_slice_anchor_present(
            campaign_dir,
            start_location_id,
            stored_receipt.get("source_evidence_sha256"),
        )
    )


def _opening_delivered_slice_anchor_present(
    campaign_dir: Path,
    start_location_id: str,
    source_evidence_sha256: str,
) -> bool:
    """Prove the delivered opening scene still carries its content evidence."""
    try:
        ir = load_campaign_ir(campaign_dir)
    except (ModuleProjectError, KeyError, TypeError, ValueError, OSError):
        return False
    scenes = (ir.get("story-graph.json") or {}).get("scenes") or []
    matches = [
        row for row in scenes
        if isinstance(row, dict)
        and str(row.get("scene_id") or "") == start_location_id
    ]
    if len(matches) != 1:
        return False
    return _canonical_sha256(
        matches[0].get("source_evidence") or {}
    ) == source_evidence_sha256


def register_opening_projection_watch(
    workspace: Path,
    campaign_id: str,
    *,
    asset_root_id: str,
    source_file_sha256: str,
    bundle_sha256: str,
    start_location_id: str,
    source_scope: dict[str, Any],
) -> dict[str, Any]:
    """Persist one campaign-owned exact projection intent.

    The reusable source job remains campaign-agnostic.  This watch is the only
    authority that permits later fulfillment to mutate a campaign.
    """
    root_info = resolve_opening_preparation_root(workspace, campaign_id)
    if (
        root_info["asset_root_id"] != asset_root_id
        or root_info["file_sha256"] != source_file_sha256
        or root_info["bundle_sha256"] != bundle_sha256
    ):
        raise OpeningPreparationError(
            "opening_source_identity_mismatch",
            "projection watch does not match the campaign-bound source",
        )
    canonical_scope = coc_module_assets.validate_opening_source_scope(
        workspace, asset_root_id, source_scope,
    )
    signature = coc_module_assets.opening_source_scope_signature(canonical_scope)
    campaign_dir = root_info["campaign_dir"]
    scenario_path = campaign_dir / "scenario" / "scenario.json"
    watch = {
        "schema_version": 1,
        "campaign_id": campaign_id,
        "asset_root_id": asset_root_id,
        "source_file_sha256": source_file_sha256,
        "bundle_sha256": bundle_sha256,
        "start_location_id": parse_opening_start_selector(
            start_location_id, required=True,
        ),
        "source_scope": canonical_scope,
        "source_scope_signature": signature,
        "created_at": _now_iso(),
        "status": "pending",
    }
    with coc_fileio.advisory_file_lock(
        campaign_dir / "scenario" / "opening-projection.lock"
    ):
        scenario = _load_json(scenario_path, {})
        existing = scenario.get("opening_projection_watch")
        if isinstance(existing, dict):
            comparable = {
                key: existing.get(key) for key in (
                    "schema_version", "campaign_id", "asset_root_id",
                    "source_file_sha256", "bundle_sha256",
                    "start_location_id", "source_scope",
                    "source_scope_signature",
                )
            }
            expected = {
                key: watch[key] for key in comparable
            }
            if comparable != expected:
                raise OpeningPreparationError(
                    "opening_projection_watch_conflict",
                    "campaign already owns a different opening projection watch",
                )
            return json.loads(json.dumps(existing))
        scenario["opening_projection_watch"] = watch
        _write_json(scenario_path, scenario)
    return watch


_OPENING_WATCH_IDENTITY_FIELDS = (
    "schema_version", "campaign_id", "asset_root_id", "source_file_sha256",
    "bundle_sha256", "start_location_id", "source_scope",
    "source_scope_signature",
)


def _opening_watch_identity(watch: Any) -> dict[str, Any] | None:
    if not isinstance(watch, dict):
        return None
    return {
        key: json.loads(json.dumps(watch.get(key)))
        for key in _OPENING_WATCH_IDENTITY_FIELDS
    }


def _merge_opening_projection_watch_status(
    campaign_dir: Path,
    expected_identity: dict[str, Any],
    updates: dict[str, Any],
    *,
    remove_fields: tuple[str, ...] = (),
) -> dict[str, Any] | None:
    """CAS-merge only watch lifecycle fields into the latest scenario bytes."""
    scenario_path = campaign_dir / "scenario" / "scenario.json"
    lock_path = campaign_dir / "scenario" / "opening-projection.lock"
    with coc_fileio.advisory_file_lock(lock_path):
        scenario = _load_json(scenario_path, {})
        current = scenario.get("opening_projection_watch")
        if _opening_watch_identity(current) != expected_identity:
            return None
        assert isinstance(current, dict)
        # A concurrent successful/terminal attempt wins over a stale retry.
        if str(current.get("status") or "") in {"complete", "refused_terminal"}:
            return json.loads(json.dumps(current))
        merged = json.loads(json.dumps(current))
        merged.update(json.loads(json.dumps(updates)))
        for field in remove_fields:
            merged.pop(field, None)
        scenario["opening_projection_watch"] = merged
        _write_json(scenario_path, scenario)
        return merged


def drain_opening_projection_watches(
    workspace: Path,
    asset_root_id: str,
    *,
    start_location_id: str,
    source_scope_signature: str,
) -> list[dict[str, Any]]:
    """Project only exact campaign-owned watches after pack fulfillment."""
    outcomes: list[dict[str, Any]] = []
    for campaign_id in coc_module_assets._campaigns_referencing_asset_root(
        workspace, asset_root_id,
    ):
        campaign_dir = _campaign_dir(workspace, campaign_id)
        scenario_path = campaign_dir / "scenario" / "scenario.json"
        lock_path = campaign_dir / "scenario" / "opening-projection.lock"
        with coc_fileio.advisory_file_lock(lock_path):
            scenario = _load_json(scenario_path, {})
            watch = scenario.get("opening_projection_watch")
            if not isinstance(watch, dict):
                continue
            if (
                watch.get("schema_version") != 1
                or watch.get("campaign_id") != campaign_id
                or watch.get("asset_root_id") != asset_root_id
                or watch.get("start_location_id") != start_location_id
                or watch.get("source_scope_signature") != source_scope_signature
                or watch.get("status") in {"complete", "refused_terminal"}
            ):
                continue
            watch = json.loads(json.dumps(watch))
            expected_identity = _opening_watch_identity(watch)
        assert expected_identity is not None
        try:
            root_info = resolve_opening_preparation_root(
                workspace, campaign_id,
            )
            canonical_scope = coc_module_assets.validate_opening_source_scope(
                workspace, asset_root_id, watch.get("source_scope"),
            )
            if (
                root_info["asset_root_id"] != asset_root_id
                or root_info["file_sha256"] != watch.get("source_file_sha256")
                or root_info["bundle_sha256"] != watch.get("bundle_sha256")
                or coc_module_assets.opening_source_scope_signature(
                    canonical_scope
                ) != source_scope_signature
            ):
                raise OpeningPreparationError(
                    "opening_projection_watch_stale",
                    "campaign/source binding no longer matches the watch",
                )
            if not campaign_is_pristine_for_opening(campaign_dir):
                raise OpeningPreparationError(
                    "opening_projection_non_pristine",
                    "automatic opening projection cannot overwrite played state",
                )
            # Projection writers use the same canonical scenario lock. The
            # watch attempt itself never writes a pre-attempt scenario copy.
            project_skeleton_to_campaign(
                workspace,
                campaign_id,
                asset_root_id,
                opening_start_location_id=start_location_id,
                opening_source_scope=canonical_scope,
            )
            projection = project_selected_opening(
                workspace,
                campaign_id,
                asset_root_id,
                str(watch["source_file_sha256"]),
                start_location_id,
                list(canonical_scope["pdf_indices"]),
            )
        except Exception as exc:  # durable pack remains reusable
            error_code = str(getattr(exc, "code", "") or "")
            terminal = error_code in {
                "opening_projection_watch_stale",
                "opening_projection_non_pristine",
                "opening_source_identity_mismatch",
                "opening_root_mismatch",
            }
            last_error = {
                "code": error_code or None,
                "type": type(exc).__name__[:80],
                "message": str(exc)[:320],
            }
            merged = _merge_opening_projection_watch_status(
                campaign_dir,
                expected_identity,
                {
                    "status": (
                        "refused_terminal" if terminal else "retryable_error"
                    ),
                    "last_error": last_error,
                    "last_attempt_at": _now_iso(),
                },
            )
            outcomes.append({
                "campaign_id": campaign_id,
                "status": (
                    str(merged.get("status"))
                    if isinstance(merged, dict) else "watch_changed"
                ),
                "error": json.loads(json.dumps(last_error)),
            })
            continue
        merged = _merge_opening_projection_watch_status(
            campaign_dir,
            expected_identity,
            {
                "status": "complete",
                "completed_at": _now_iso(),
                "projection_receipt": json.loads(json.dumps(
                    projection.get("opening_projection_receipt")
                )),
            },
            remove_fields=("last_error",),
        )
        outcomes.append({
            "campaign_id": campaign_id,
            "status": (
                str(merged.get("status"))
                if isinstance(merged, dict) else "watch_changed"
            ),
            "projection": projection,
        })
    return outcomes


def project_selected_opening(
    workspace: Path,
    campaign_id: str,
    asset_root_id: str,
    source_file_sha256: str,
    start_location_id: str,
    opening_pdf_indices: list[int] | None = None,
) -> dict[str, Any]:
    """Atomically project one opening against canonical IR merge writers."""
    campaign_dir = _campaign_dir(workspace, campaign_id)
    # Keep the queue worker's canonical writer order: progressive IR first,
    # then write_ir_to_campaign's opening-projection lock.
    with coc_fileio.advisory_file_lock(
        campaign_dir / ".progressive-ir.lock", wait_seconds=15.0,
    ):
        return _project_selected_opening_unlocked(
            workspace,
            campaign_id,
            asset_root_id,
            source_file_sha256,
            start_location_id,
            opening_pdf_indices,
        )


def _project_selected_opening_unlocked(
    workspace: Path,
    campaign_id: str,
    asset_root_id: str,
    source_file_sha256: str,
    start_location_id: str,
    opening_pdf_indices: list[int] | None = None,
) -> dict[str, Any]:
    selected_argument = parse_opening_start_selector(
        start_location_id,
        required=True,
    )
    assert selected_argument is not None
    root_info = resolve_opening_preparation_root(workspace, campaign_id)
    if (
        root_info["asset_root_id"] != asset_root_id
        or root_info["file_sha256"] != source_file_sha256
    ):
        raise OpeningPreparationError(
            "opening_source_identity_mismatch",
            "project arguments do not match the campaign-bound source root",
        )
    skeleton = coc_module_assets.get_skeleton(workspace, asset_root_id)
    if not isinstance(skeleton, dict):
        raise OpeningPreparationError("opening_skeleton_missing", "skeleton is not published")
    selected = select_opening_start(
        root_info["campaign_dir"], skeleton, selected_argument,
    )
    binding_result = resolve_selected_opening_binding(
        workspace,
        root_info,
        skeleton,
        selected,
        opening_pdf_indices,
    )
    readiness = binding_result["readiness"]
    if not readiness["ready"]:
        first_blocker = next(iter(readiness.get("blocking") or []), {})
        blocker_code = str(first_blocker.get("code") or "")
        if blocker_code.startswith("opening_pack_source_") or blocker_code in {
            "opening_source_scope_required",
            "opening_source_scope_invalid",
            "opening_partial_binding_invalid",
            "opening_pack_evidence_stale",
        }:
            raise OpeningPreparationError(
                blocker_code,
                "selected opening pack is not qualified for source-authored projection",
            )
        raise OpeningPreparationError(
            "opening_pack_not_ready", "selected opening pack is not structurally ready"
        )
    payload = build_opening_projection_payload(
        workspace,
        asset_root_id,
        selected,
        binding_result["scope"],
    )
    try:
        expected_slice = _build_canonical_opening_slice(payload, selected)
    except OpeningStructuredCollisionError as exc:
        raise OpeningPreparationError(
            "opening_projection_identity_ambiguous", str(exc),
        ) from exc
    receipt = opening_projection_receipt(asset_root_id, selected, payload)
    campaign_dir = root_info["campaign_dir"]
    current = current_opening_projection_receipt(campaign_dir)
    current_binding = current_opening_projection_source_binding(campaign_dir)
    projection_fresh = _selected_opening_projection_is_fresh_for_payload(
        campaign_dir, selected, payload,
    )
    if (
        current == receipt
        and current_binding == payload["source_binding"]
        and projection_fresh
    ):
        return {
            "status": "current",
            "projected": True,
            "idempotent": True,
            "opening_projection_receipt": receipt,
        }
    if not campaign_is_pristine_for_opening(campaign_dir):
        raise OpeningPreparationError(
            "opening_projection_non_pristine",
            "a stale or missing opening projection cannot overwrite played state",
        )
    ir = load_campaign_ir(campaign_dir)
    try:
        ir = merge_deep_location_into_ir(ir, payload["location"])
        for clue in payload["clues"]:
            ir = merge_deep_entity_into_ir(ir, "clue", clue)
        for npc in payload["npcs"]:
            ir = merge_deep_entity_into_ir(ir, "npc", npc)
        ir, handout_reapplied = _reapply_stored_handout_packs(
            workspace, asset_root_id, ir,
        )
        ir = merge_canonical_opening_slice_into_ir(ir, expected_slice)
    except OpeningStructuredCollisionError as exc:
        raise OpeningPreparationError(
            "opening_projection_identity_ambiguous", str(exc),
        ) from exc
    if not _selected_opening_projection_is_fresh_for_payload(
        campaign_dir,
        selected,
        payload,
        candidate_ir=ir,
    ):
        raise OpeningPreparationError(
            "opening_projection_incomplete",
            "canonical selected opening candidate did not pass its slice check",
        )
    paths = write_ir_to_campaign(
        campaign_dir,
        ir,
        asset_root_id=asset_root_id,
        opening_start_location_id=selected,
        opening_source_scope=binding_result["scope"],
    )
    if not _selected_opening_projection_is_fresh_for_payload(
        campaign_dir, selected, payload,
    ):
        raise OpeningPreparationError(
            "opening_projection_incomplete",
            "canonical selected opening projection did not pass its slice check",
        )
    scenario_path = campaign_dir / "scenario" / "scenario.json"
    with coc_fileio.advisory_file_lock(
        campaign_dir / "scenario" / "opening-projection.lock"
    ):
        scenario = _load_json(scenario_path, {})
        scenario["opening_projection_receipt"] = receipt
        scenario["opening_projection_source_binding"] = json.loads(json.dumps(
            payload["source_binding"]
        ))
        _write_json(scenario_path, scenario)
    if not opening_projection_state_is_fresh(
        workspace,
        campaign_dir,
        asset_root_id,
        selected,
        binding_result["scope"],
    ):
        raise OpeningPreparationError(
            "opening_projection_incomplete",
            "durable opening projection binding did not pass revalidation",
        )
    return {
        "status": "complete",
        "projected": True,
        "idempotent": False,
        "asset_root_id": asset_root_id,
        "start_location_id": selected,
        "opening_projection_receipt": receipt,
        "reapplied_handouts": handout_reapplied,
        "paths": paths,
    }


def _reapply_stored_handout_packs(
    workspace: Path,
    asset_root_id: str,
    ir: dict[str, Any],
) -> tuple[dict[str, Any], list[str]]:
    """Re-merge deep handout card packs from the module-assets store.

    Handout cards are scene-independent deliverables: unlike location packs a
    reusable deep card never conflicts with a selected opening window, so any
    projection path (skeleton refresh or selected-opening write) reprojects
    all deep, non-evidence-gap cards.
    """
    entities_dir = (
        coc_module_assets.assets_root(workspace) / asset_root_id / "entities"
    )
    reapplied: list[str] = []
    if not entities_dir.is_dir():
        return ir, reapplied
    for path in sorted(entities_dir.glob("handout-*.json")):
        entity_id = path.stem[len("handout-"):]
        if not entity_id:
            continue
        pack = coc_module_assets.get_entity(
            workspace, asset_root_id, "handout", entity_id,
        )
        if not isinstance(pack, dict) or not _is_deep_state(pack.get("parse_state")):
            continue
        if pack.get("evidence_gap"):
            continue
        ir = merge_deep_handout_into_ir(ir, pack)
        reapplied.append(f"handout:{entity_id}")
    return ir, reapplied


def _reapply_stored_deep_packs(
    workspace: Path,
    asset_root_id: str,
    ir: dict[str, Any],
    *,
    opening_start_location_id: str | None = None,
    opening_source_scope: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], list[str]]:
    """Re-merge deep entity packs from the store after a skeleton re-projection.

    Skeleton refresh rebuilds campaign IR from topology only. Without this
    pass the already-merged deep truth (clues, NPC agendas, threats, items,
    handout cards) would be silently dropped even though the reusable packs
    still exist in the module-assets store. Stub/partial or evidence-gap
    packs are left to the normal queue.
    """
    entities_dir = (
        coc_module_assets.assets_root(workspace) / asset_root_id / "entities"
    )
    reapplied: list[str] = []
    if not entities_dir.is_dir():
        return ir, reapplied
    for path in sorted(entities_dir.glob("*.json")):
        kind, sep, entity_id = path.stem.partition("-")
        if not sep or kind not in {"location", "npc", "item", "clue", "threat", "handout"}:
            continue
        pack = coc_module_assets.get_entity(
            workspace, asset_root_id, kind, entity_id,
        )
        if not isinstance(pack, dict) or not _is_deep_state(pack.get("parse_state")):
            continue
        if pack.get("evidence_gap"):
            continue
        # A reusable deep opening may have been compiled for a different page
        # window than the one selected for this campaign.  Do not temporarily
        # project that incompatible slice while bootstrap is preparing the
        # exact selected L0/source pack; the normal selected-opening write will
        # replace it immediately after this sparse projection.
        if (
            kind == "location"
            and entity_id == opening_start_location_id
            and opening_source_scope is not None
            and not opening_pack_readiness(
                workspace,
                asset_root_id,
                entity_id,
                required_source_scope=opening_source_scope,
            ).get("ready")
        ):
            continue
        ir = merge_deep_entity_into_ir(ir, kind, pack)
        reapplied.append(f"{kind}:{entity_id}")
    return ir, reapplied


def project_skeleton_to_campaign(
    workspace: Path,
    campaign_id: str,
    asset_root_id: str,
    *,
    opening_start_location_id: str | None = None,
    opening_source_scope: dict[str, Any] | None = None,
) -> dict[str, Any]:
    skeleton = coc_module_assets.get_skeleton(workspace, asset_root_id)
    if not skeleton:
        raise ModuleProjectError("skeleton.json missing; put_skeleton first")
    ir = project_skeleton_to_ir(skeleton)
    ir, reapplied = _reapply_stored_deep_packs(
        workspace,
        asset_root_id,
        ir,
        opening_start_location_id=opening_start_location_id,
        opening_source_scope=opening_source_scope,
    )
    campaign_dir = _campaign_dir(workspace, campaign_id)
    paths = write_ir_to_campaign(
        campaign_dir,
        ir,
        asset_root_id=asset_root_id,
        opening_start_location_id=opening_start_location_id,
        opening_source_scope=opening_source_scope,
    )
    return {
        "campaign_id": campaign_id,
        "asset_root_id": asset_root_id,
        "scene_count": len(ir["story-graph.json"]["scenes"]),
        "reapplied_deep_entities": reapplied,
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


def _location_has_shared_source_authority(
    workspace: Path,
    asset_root_id: str,
    skeleton: dict[str, Any],
    location_id: str,
    *,
    pack: Any = None,
) -> bool:
    """Require positive structured source authority before shared enqueue."""
    if any(
        isinstance(row, dict)
        and str(row.get("location_id") or "") == location_id
        for row in skeleton.get("locations") or []
    ):
        return True
    if (
        not isinstance(pack, dict)
        or str(pack.get("location_id") or "") != location_id
        or _opening_campaign_local_row(pack)
    ):
        return False
    provenance = (
        pack.get("provenance")
        if isinstance(pack.get("provenance"), dict) else {}
    )
    authority_claim = (
        str(provenance.get("authority") or "") == "source_authored"
        or str(pack.get("origin") or "") == "source"
    )
    scope = _source_scope(pack) or _source_scope(provenance)
    if not authority_claim or not scope:
        return False
    try:
        return bool(coc_module_assets._cached_source_refs(
            workspace,
            asset_root_id,
            scope,
            field=f"location:{location_id}",
        ))
    except coc_module_assets.ModuleAssetsError:
        return False


def _matching_validated_source_pack_edge(
    workspace: Path,
    asset_root_id: str,
    active_location_pack: Any,
    active_scene_id: str,
    ir_edge: Any,
    target_id: str,
) -> dict[str, Any] | None:
    """Resolve an IR edge back to one immutable, cache-backed source-pack row."""
    if (
        not isinstance(active_location_pack, dict)
        or str(active_location_pack.get("location_id") or "") != active_scene_id
        or _opening_campaign_local_row(active_location_pack)
        or not isinstance(ir_edge, dict)
        or str(ir_edge.get("to") or "").strip() != target_id
        or _opening_campaign_local_row(ir_edge)
    ):
        return None
    try:
        canonical_target = coc_module_assets._require_id(
            target_id, "scene_edge.to",
        )
    except coc_module_assets.ModuleAssetsError:
        return None
    ir_identity = coc_module_assets._canonical_scene_edge_identity(ir_edge)
    matches: list[dict[str, Any]] = []
    for position, candidate in enumerate(
        active_location_pack.get("scene_edges") or []
    ):
        if (
            not isinstance(candidate, dict)
            or str(candidate.get("to") or "").strip() != canonical_target
            or _opening_campaign_local_row(candidate)
            or coc_module_assets._canonical_scene_edge_identity(candidate)
            != ir_identity
        ):
            continue
        provenance = (
            candidate.get("provenance")
            if isinstance(candidate.get("provenance"), dict)
            else {}
        )
        if (
            str(candidate.get("origin") or "") != "source"
            or str(provenance.get("authority") or "") != "source_authored"
        ):
            continue
        try:
            refs = coc_module_assets._cached_source_refs(
                workspace,
                asset_root_id,
                candidate,
                field=(
                    f"location:{active_scene_id}.scene_edges[{position}]"
                ),
            )
        except coc_module_assets.ModuleAssetsError:
            continue
        if refs:
            matches.append(candidate)
    # Canonical pack validation rejects duplicate rows, but stay fail-closed if
    # durable state was externally corrupted after commit.
    if len(matches) != 1:
        return None
    return matches[0]


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
      player materially pursues it through the steward-delivered source path.
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
    # The global section index is the only semantic authority for non-map
    # material.  Select current-location rows structurally (never by title or
    # prose) and the small Keeper opening/pre-session lane, then reuse the
    # existing extract_section queue/worker lifecycle.
    section_index = coc_module_assets.read_section_index(workspace, root_id) or {}
    section_actions: list[dict[str, Any]] = []
    for section in section_index.get("sections") or []:
        if not isinstance(section, dict):
            continue
        binding = section.get("binding") if isinstance(section.get("binding"), dict) else {}
        is_current_location = (
            binding.get("kind") == "entity"
            and binding.get("entity_kind") == "location"
            and sid in {str(value) for value in (binding.get("entity_ids") or [])}
        )
        is_keeper_opening = (
            binding.get("kind") == "global"
            and section.get("audience") == "keeper_only"
            and section.get("timing") in {"pre_session", "opening"}
        )
        if not (is_current_location or is_keeper_opening):
            continue
        section_id = str(section.get("section_id") or "").strip()
        if not section_id:
            continue
        stored = coc_module_assets.get_section_pack(workspace, root_id, section_id)
        if stored and stored.get("body_present") and section.get("parse_state") == "resolved":
            section_actions.append({"section_id": section_id, "status": "resolved"})
            continue
        queued = coc_module_assets.enqueue_job(
            workspace, root_id,
            kind=coc_module_assets.EXTRACT_SECTION_KIND,
            target_id=section_id,
            priority=100 if is_current_location else 90,
            reason=("scene_materialize:" if is_current_location else "opening_materialize:") + sid,
            consumer_refs=_campaign_consumer_refs(
                workspace, campaign_id, root_id, intent_kind="scene_enter",
            ),
        )
        section_actions.append({
            "section_id": section_id,
            "binding": "active_location" if is_current_location else "keeper_opening",
            "enqueue": queued,
        })
    if section_actions:
        actions.extend({"section_materialization": row} for row in section_actions)
    campaign_local_scene = False
    campaign_scene: dict[str, Any] | None = None
    try:
        current_ir = load_campaign_ir(campaign_dir)
        campaign_scene = next(
            (
                row for row in (
                    (current_ir.get("story-graph.json") or {}).get("scenes") or []
                )
                if isinstance(row, dict) and row.get("scene_id") == sid
            ),
            None,
        )
        campaign_local_scene = bool(
            isinstance(campaign_scene, dict)
            and _opening_campaign_local_row(campaign_scene)
        )
    except ModuleProjectError:
        campaign_local_scene = False

    pack = coc_module_assets.get_entity(workspace, root_id, "location", sid)
    shared_source_authority = _location_has_shared_source_authority(
        workspace, root_id, skeleton, sid, pack=pack,
    )
    merged = False
    if shared_source_authority and _is_usable_location_pack(pack):
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
    if (
        shared_source_authority
        and not campaign_local_scene
        and (
            not pack
            or not _is_deep_state(pack.get("parse_state"))
            or pack.get("evidence_gap")
        )
    ):
        q = coc_module_assets.enqueue_job(
            workspace, root_id,
            kind="deepen_location",
            target_id=sid,
            priority=100,
            reason=f"enter:{sid}",
            consumer_refs=_campaign_consumer_refs(
                workspace, campaign_id, root_id, intent_kind="scene_enter",
            ),
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
    elif campaign_local_scene or not shared_source_authority:
        actions.append({
            "shared_source_enqueue_skipped": sid,
            "reason": (
                "campaign_local_authority"
                if campaign_local_scene else "no_structured_source_authority"
            ),
        })

    # Neighbor hot ring (depth 1)
    neighbors = _neighbor_ids_from_skeleton(skeleton, sid)
    neighbor_source_scopes: dict[str, dict[str, Any]] = {}
    # Campaign IR may contain later campaign-canon edges. Admit an IR neighbor
    # only when the target independently carries source authority, or the edge
    # itself has an exact validated source identity for that target. Never
    # spread an active source scene's authority to a new target.
    try:
        ir_now = load_campaign_ir(campaign_dir)
        ir_scenes = [
            row for row in (
                ir_now.get("story-graph.json", {}).get("scenes") or []
            )
            if isinstance(row, dict)
        ]
        current_scene = next(
            (
                row for row in ir_scenes
                if str(row.get("scene_id") or "") == sid
            ),
            None,
        )
        if isinstance(current_scene, dict):
            for edge in current_scene.get("scene_edges") or []:
                if not isinstance(edge, dict):
                    continue
                target_id = str(edge.get("to") or "").strip()
                if not target_id or target_id == sid:
                    continue
                target_pack = coc_module_assets.get_entity(
                    workspace, root_id, "location", target_id,
                )
                target_authorized = _location_has_shared_source_authority(
                    workspace,
                    root_id,
                    skeleton,
                    target_id,
                    pack=target_pack,
                )
                source_pack_edge = _matching_validated_source_pack_edge(
                    workspace,
                    root_id,
                    pack,
                    sid,
                    edge,
                    target_id,
                )
                if (
                    not campaign_local_scene
                    and (target_authorized or source_pack_edge is not None)
                ):
                    neighbors.append(target_id)
                    inherited_scope = (
                        _source_scope(target_pack)
                        or _source_scope(source_pack_edge)
                    )
                    if inherited_scope:
                        neighbor_source_scopes[target_id] = inherited_scope
                else:
                    actions.append({
                        "shared_source_neighbor_skipped": target_id,
                        "from_scene_id": sid,
                        "reason": (
                            "campaign_local_scene_edge"
                            if campaign_local_scene
                            else "no_independent_source_authority"
                        ),
                    })
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
            source_scope=neighbor_source_scopes.get(nid),
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
            consumer_refs=_campaign_consumer_refs(
                workspace, campaign_id, root_id, intent_kind="neighbor_prefetch",
            ),
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
            coc_module_assets.list_queue(workspace, root_id),
            open_host_work=coc_module_assets.list_host_work_requests(
                workspace, root_id, limit=None,
            ),
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
        skeleton = coc_module_assets.get_skeleton(workspace, asset_root_id) or {}
        roster_key = {"npc": "npc_roster", "item": "item_roster"}.get(kind)
        id_key = {"npc": "npc_id", "item": "item_id"}.get(kind)
        roster_row = next(
            (
                row
                for row in (skeleton.get(roster_key) or [])
                if isinstance(row, dict)
                and str(row.get(id_key) or "") == entity_id
            ),
            None,
        ) if roster_key and id_key else None
        if roster_row is not None:
            parse_state = str(roster_row.get("parse_state") or "named_only")
            return {
                "kind": kind,
                "entity_id": entity_id,
                "exists": True,
                "parse_state": parse_state,
                "evidence_gap": True,
                "deep_ready": False,
                "title": roster_row.get("title")
                or roster_row.get("display_name")
                or roster_row.get("name")
                or (roster_row.get("names") or [None])[0],
                "source_evidence": None,
                "ingest_timing": None,
            }
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


def _compact_queue_snapshot(
    queue: dict[str, Any],
    *,
    open_host_work: list[dict[str, Any]],
) -> dict[str, Any]:
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
    historical_host_handoffs = [
        row for row in done
        if isinstance(row, dict) and row.get("result") == "awaiting_host_pack"
    ]
    host_tail_fields = (
        "job_id", "kind", "target_id", "status", "created_at",
        "requested_pdf_indices", "cached_scope_complete",
    )
    return {
        "schema_version": queue.get("schema_version"),
        "pending": list(queue.get("pending") or []),
        "in_flight": list(queue.get("in_flight") or []),
        "done_count": len(done),
        "done_tail": done_tail,
        "awaiting_host_count": len(open_host_work),
        "awaiting_host_tail": [
            {key: row[key] for key in host_tail_fields if key in row}
            for row in open_host_work[-5:]
        ],
        "historical_host_handoff_count": len(historical_host_handoffs),
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
    work_level: str | None = None,
    dependency_ref: dict[str, Any] | None = None,
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
    skeleton = coc_module_assets.get_skeleton(workspace, root_id) or {}

    def source_authorized(kind: str, ref: str, scope: dict[str, Any]) -> bool:
        if scope:
            return True
        collections = {
            "location": ("locations", "location_id"),
            "npc": ("npc_roster", "npc_id"),
            "item": ("items", "item_id"),
            "clue": ("clues", "clue_id"),
            "handout": ("handouts", "handout_id"),
            "threat": ("threats", "threat_id"),
        }
        collection, id_field = collections[kind]
        if any(
            isinstance(row, dict)
            and str(row.get(id_field) or "") == ref
            for row in skeleton.get(collection) or []
        ):
            return True
        pack = coc_module_assets.get_entity(workspace, root_id, kind, ref)
        if not isinstance(pack, dict):
            return False
        provenance = (
            pack.get("provenance")
            if isinstance(pack.get("provenance"), dict) else {}
        )
        return bool(
            _source_scope(pack)
            or (
                str(provenance.get("authority") or "") == "source_authored"
                and _source_scope(provenance)
            )
        )

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
        if kind == "location" and not source_scope:
            source_scope = _campaign_location_edge_source_scope(
                workspace,
                campaign_dir,
                root_id,
                ref,
            )
        if not source_authorized(kind, ref, source_scope):
            actions.append({
                "shared_source_enqueue_skipped": ref,
                "kind": kind,
                "reason": "no_structured_source_authority",
            })
            followed.append({
                "kind": kind,
                "ref_id": ref,
                "raw_label": label,
                "status": None,
                "enqueued": False,
                "deduped": False,
                "dedupe_state": None,
                "canonical_scene_id": None,
                "shared_source_enqueue_skipped": True,
            })
            continue
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
                work_level=work_level,
                dependency_ref=dependency_ref,
                consumer_refs=_campaign_consumer_refs(
                    workspace, campaign_id, root_id, intent_kind="player_dig",
                ),
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
            coc_module_assets.list_queue(workspace, root_id),
            open_host_work=coc_module_assets.list_host_work_requests(
                workspace, root_id, limit=None,
            ),
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
    elif kind == "item":
        rows = list(
            (((ir.get("module-meta.json") or {}).get("module_mechanics") or {}).get("items") or {}).values()
        )
        keys = ("item_id",)
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


def _campaign_location_edge_source_scope(
    workspace: Path,
    campaign_dir: Path,
    asset_root_id: str,
    target_id: str,
) -> dict[str, Any]:
    """Resolve a location target through exact projected source-pack edges.

    A source-authored edge is structured authority that its destination exists
    in the module even when Tier 1 did not list that destination as a standalone
    location. Campaign IR alone is not trusted: every matching edge must resolve
    back to the immutable location pack row and accepted cached page evidence.
    """
    try:
        ir = load_campaign_ir(campaign_dir)
    except ModuleProjectError:
        return {}
    refs_by_index: dict[int, dict[str, Any]] = {}
    for scene in (ir.get("story-graph.json") or {}).get("scenes") or []:
        if not isinstance(scene, dict) or _opening_campaign_local_row(scene):
            continue
        source_scene_id = str(scene.get("scene_id") or "").strip()
        if not source_scene_id:
            continue
        source_pack = coc_module_assets.get_entity(
            workspace,
            asset_root_id,
            "location",
            source_scene_id,
        )
        for edge in scene.get("scene_edges") or []:
            if (
                not isinstance(edge, dict)
                or str(edge.get("to") or "").strip() != target_id
            ):
                continue
            validated_edge = _matching_validated_source_pack_edge(
                workspace,
                asset_root_id,
                source_pack,
                source_scene_id,
                edge,
                target_id,
            )
            if validated_edge is None:
                continue
            try:
                refs = coc_module_assets._cached_source_refs(
                    workspace,
                    asset_root_id,
                    validated_edge,
                    field=(
                        f"location:{source_scene_id}.scene_edge_destination:"
                        f"{target_id}"
                    ),
                )
            except coc_module_assets.ModuleAssetsError:
                continue
            for ref in refs:
                copied = json.loads(json.dumps(ref))
                pdf_index = int(copied["pdf_index"])
                previous = refs_by_index.get(pdf_index)
                if previous is not None and previous != copied:
                    # Multiple validated routes may identify the same target,
                    # but conflicting evidence identities must not be widened.
                    return {}
                refs_by_index[pdf_index] = copied
    if not refs_by_index:
        return {}
    return {
        "source_page_indices": sorted(refs_by_index),
        "source_refs": [
            refs_by_index[pdf_index] for pdf_index in sorted(refs_by_index)
        ],
    }


def request_mechanics(
    workspace: Path,
    campaign_id: str,
    *,
    kind: str,
    target_id: str,
    title: str | None = None,
    reason: str = "mechanics_required",
    asset_root_id: str | None = None,
    priority: int = 95,
) -> dict[str, Any]:
    """Request source-first mechanics without forcing another body parse."""
    kind = str(kind or "").strip()
    target_id = str(target_id or "").strip()
    if kind not in coc_module_assets.MECHANICS_SUBJECT_KINDS:
        raise ModuleProjectError(
            "mechanics kind must be one of "
            f"{sorted(coc_module_assets.MECHANICS_SUBJECT_KINDS)}"
        )
    if not target_id:
        raise ModuleProjectError("target_id required")
    campaign_dir = _campaign_dir(workspace, campaign_id)
    root_id = asset_root_id or campaign_asset_root_id(campaign_dir)
    if not root_id:
        return {
            "progressive": False,
            "skipped": True,
            "reason": "campaign is not progressive / no asset_root_id",
        }
    source_scope = _campaign_entity_source_scope(campaign_dir, kind, target_id)
    stub = coc_module_assets.ensure_stub(
        workspace,
        root_id,
        kind,
        target_id,
        title=title or target_id,
        reason=reason,
        source_scope=source_scope,
    )
    pack = coc_module_assets.get_entity(workspace, root_id, kind, target_id) or {}
    mechanics = pack.get("mechanics") if isinstance(pack.get("mechanics"), dict) else {}
    status = str(mechanics.get("status") or "unresolved")
    enqueue = None
    if status not in {"authored", "not_authored"}:
        enqueue = coc_module_assets.enqueue_job(
            workspace,
            root_id,
            kind=(
                coc_module_assets.MECHANICS_JOB_FOR_SUBJECT[kind]
            ),
            target_id=target_id,
            priority=priority,
            reason=reason,
            consumer_refs=_campaign_consumer_refs(
                workspace, campaign_id, root_id, intent_kind="mechanics",
            ),
        )
    return {
        "progressive": True,
        "asset_root_id": root_id,
        "kind": kind,
        "target_id": target_id,
        "mechanics_status": status,
        "ready": status in {"authored", "not_authored"},
        "stub": stub,
        "enqueue": enqueue,
        "host_hints": (
            [] if status in {"authored", "not_authored"}
            else [
                "resolve the source-bound mechanics host work once; later uses "
                "must reuse the resulting authored profile or absence receipt"
            ]
        ),
    }


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
