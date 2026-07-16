#!/usr/bin/env python3
"""Narrative adherence checklist — SENNA / Narrative Adherence in LLM-driven Games.

Derives required vs optional adherence statements from a compiled scenario and
evaluates them against structured play records (discovered clues, visited
scenes, threat clocks, bonus rolls, NPC engagements). No free-text scanning.
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent


def _load_sibling(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPT_DIR / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_event_contract = _load_sibling(
    "coc_event_contract_adherence", "coc_event_contract.py"
)
coc_npc_identity = _load_sibling(
    "coc_npc_identity_adherence", "coc_npc_identity.py"
)


def _read_json(path: Path, fallback: Any = None) -> Any:
    if not path.exists():
        return fallback
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return fallback


def _text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _clue_ids_for_conclusion(conclusion: dict[str, Any]) -> list[str]:
    ids: list[str] = []
    seen: set[str] = set()
    for clue in conclusion.get("clues") or []:
        if not isinstance(clue, dict):
            continue
        cid = _text(clue.get("clue_id"))
        if not cid or cid in seen:
            continue
        seen.add(cid)
        ids.append(cid)
    return ids


def _bonus_clue_ids(clue_graph: dict[str, Any]) -> list[str]:
    ids: list[str] = []
    seen: set[str] = set()
    for conclusion in clue_graph.get("conclusions") or []:
        if not isinstance(conclusion, dict):
            continue
        for clue in conclusion.get("clues") or []:
            if not isinstance(clue, dict):
                continue
            if not isinstance(clue.get("bonus"), dict):
                continue
            cid = _text(clue.get("clue_id"))
            if not cid or cid in seen:
                continue
            seen.add(cid)
            ids.append(cid)
    return ids


def _required_route_scene_ids(
    story_graph: dict[str, Any],
    clue_graph: dict[str, Any],
) -> set[str]:
    """Scenes on required conclusion routes (primary minimum_routes clues).

    A scene is required-route if it is start/final, or it hosts one of the first
    ``minimum_routes`` clues of any conclusion that produces a required
    adherence statement. Remaining scenes are optional side content.
    """
    primary_clues: set[str] = set()
    for conclusion in clue_graph.get("conclusions") or []:
        if not isinstance(conclusion, dict):
            continue
        if not _text(conclusion.get("conclusion_id")):
            continue
        clue_ids = _clue_ids_for_conclusion(conclusion)
        if not clue_ids:
            continue
        try:
            minimum_routes = int(conclusion.get("minimum_routes") or max(1, min(3, len(clue_ids))))
        except (TypeError, ValueError):
            minimum_routes = max(1, min(3, len(clue_ids)))
        minimum_routes = max(1, min(minimum_routes, len(clue_ids)))
        primary_clues.update(clue_ids[:minimum_routes])

    required: set[str] = set()
    for scene in story_graph.get("scenes") or []:
        if not isinstance(scene, dict):
            continue
        sid = _text(scene.get("scene_id"))
        if not sid:
            continue
        if scene.get("is_start") or scene.get("is_final"):
            required.add(sid)
            continue
        available = {str(c) for c in (scene.get("available_clues") or []) if c}
        if available & primary_clues:
            required.add(sid)
    return required


def generate_adherence_checklist(scenario_dir: Path | str) -> list[dict[str, Any]]:
    """Derive required/optional adherence statements from compiled scenario files."""
    root = Path(scenario_dir)
    story_graph = _read_json(root / "story-graph.json", {"scenes": []}) or {"scenes": []}
    clue_graph = _read_json(root / "clue-graph.json", {"conclusions": []}) or {"conclusions": []}
    threat_fronts = _read_json(root / "threat-fronts.json", {"fronts": []}) or {"fronts": []}
    npc_agendas = _read_json(root / "npc-agendas.json", {"npcs": []}) or {"npcs": []}

    statements: list[dict[str, Any]] = []

    for conclusion in clue_graph.get("conclusions") or []:
        if not isinstance(conclusion, dict):
            continue
        conclusion_id = _text(conclusion.get("conclusion_id"))
        if not conclusion_id:
            continue
        clue_ids = _clue_ids_for_conclusion(conclusion)
        if not clue_ids:
            continue
        try:
            minimum_routes = int(conclusion.get("minimum_routes") or max(1, min(3, len(clue_ids))))
        except (TypeError, ValueError):
            minimum_routes = max(1, min(3, len(clue_ids)))
        minimum_routes = max(1, min(minimum_routes, len(clue_ids)))
        statements.append({
            "statement_id": f"conclusion:{conclusion_id}",
            "kind": "required",
            "criterion": {
                "conclusion_id": conclusion_id,
                "clue_ids": clue_ids,
                "minimum_routes": minimum_routes,
            },
            "description": (
                f"Reach conclusion '{conclusion_id}' via at least "
                f"{minimum_routes} distinct clue route(s)"
            ),
        })

    for scene in story_graph.get("scenes") or []:
        if not isinstance(scene, dict):
            continue
        if not scene.get("is_final"):
            continue
        scene_id = _text(scene.get("scene_id"))
        if not scene_id:
            continue
        statements.append({
            "statement_id": f"terminal:{scene_id}",
            "kind": "required",
            "criterion": {"scene_id": scene_id},
            "description": f"Reach terminal/ending scene '{scene_id}'",
        })

    for front in threat_fronts.get("fronts") or []:
        if not isinstance(front, dict):
            continue
        front_id = _text(front.get("front_id"))
        if not front_id:
            continue
        clocks = front.get("clocks") or []
        if not clocks:
            statements.append({
                "statement_id": f"front:{front_id}",
                "kind": "required",
                "criterion": {"front_id": front_id, "clock_ids": []},
                "description": f"Threat front '{front_id}' remains structurally intact",
            })
            continue
        clock_ids: list[str] = []
        clock_segments: dict[str, int] = {}
        for clock in clocks:
            if not isinstance(clock, dict):
                continue
            clock_id = _text(clock.get("clock_id"))
            if not clock_id:
                continue
            clock_ids.append(clock_id)
            try:
                clock_segments[clock_id] = int(clock.get("segments") or 0)
            except (TypeError, ValueError):
                clock_segments[clock_id] = 0
        statements.append({
            "statement_id": f"front:{front_id}",
            "kind": "required",
            "criterion": {
                "front_id": front_id,
                "clock_ids": clock_ids,
                "clock_segments": clock_segments,
            },
            "description": (
                f"Threat-front '{front_id}' clock integrity "
                f"({', '.join(clock_ids) or 'no clocks'})"
            ),
        })

    required_scenes = _required_route_scene_ids(story_graph, clue_graph)
    for scene in story_graph.get("scenes") or []:
        if not isinstance(scene, dict):
            continue
        scene_id = _text(scene.get("scene_id"))
        if not scene_id or scene_id in required_scenes:
            continue
        statements.append({
            "statement_id": f"optional_scene:{scene_id}",
            "kind": "optional",
            "criterion": {"scene_id": scene_id},
            "description": f"Visit optional scene '{scene_id}'",
        })

    for clue_id in _bonus_clue_ids(clue_graph):
        statements.append({
            "statement_id": f"bonus:{clue_id}",
            "kind": "optional",
            "criterion": {"bonus_clue_id": clue_id},
            "description": f"Engage bonus roll for clue '{clue_id}'",
        })

    for npc in npc_agendas.get("npcs") or []:
        if not isinstance(npc, dict):
            continue
        npc_id = _text(npc.get("npc_id"))
        if not npc_id:
            continue
        name = _text(npc.get("name") or npc.get("display_name")) or npc_id
        statements.append({
            "statement_id": f"npc:{npc_id}",
            "kind": "optional",
            "criterion": {"npc_id": npc_id},
            "description": f"Engage NPC '{name}'",
        })

    return statements


def _as_str_set(values: Any) -> set[str]:
    if values is None:
        return set()
    if isinstance(values, (list, tuple, set)):
        return {str(v).strip() for v in values if str(v or "").strip()}
    if isinstance(values, dict):
        return {str(k).strip() for k, v in values.items() if v and str(k or "").strip()}
    text = str(values).strip()
    return {text} if text else set()


_CLUE_BONUS_EVENT_TYPES = frozenset(
    {"clue_bonus_reveal", "clue_bonus_cost", "clue_bonus_pending"}
)
_NPC_ENGAGEMENT_EVENT_TYPES = frozenset({"npc_engagement", "npc_agency"})


def _iter_play_events(raw: dict[str, Any]) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    top = raw.get("events")
    if isinstance(top, list):
        events.extend(e for e in top if isinstance(e, dict))
    for turn in raw.get("turns") or []:
        if not isinstance(turn, dict):
            continue
        turn_events = turn.get("events")
        if isinstance(turn_events, list):
            events.extend(e for e in turn_events if isinstance(e, dict))
    return events


def _engagement_coverage_eligible(event: dict[str, Any]) -> bool:
    """Accept only typed authored bindings for id-only engagement receipts.

    A psych-state update is not independent evidence that the authored persona
    was portrayed.  We do not inspect narration, summaries, names, or role
    prose.
    """
    npc_id = _text(coc_event_contract.value(event, "npc_id"))
    contract = coc_event_contract.value(event, "identity_contract")
    binding = coc_event_contract.value(event, "identity_binding")
    body = coc_event_contract.payload(event)
    scene_present = "scene_id" in event or "scene_id" in body
    event_scene = coc_event_contract.value(event, "scene_id")
    raw_schema = coc_event_contract.value(event, "schema_version")
    event_schema = (
        raw_schema
        if isinstance(raw_schema, int) and not isinstance(raw_schema, bool)
        else None
    )
    return bool(
        npc_id
        and coc_npc_identity.validate_authored_attestation(
            npc_id,
            contract if isinstance(contract, dict) else None,
            binding if isinstance(binding, dict) else None,
            event_scene_id=str(event_scene) if event_scene is not None else None,
            event_scene_present=scene_present,
            event_schema_version=event_schema,
        )
    )


def project_engaged_npc_ids(events: list[dict[str, Any]]) -> set[str]:
    """Project NPC engagement IDs from canonical structured events.

    Live-match logs are intentionally not copied wholesale into the public
    session result because they may contain keeper-only state.  This narrow
    projection lets the adherence consumer receive the semantic IDs it needs
    without losing the producer events or leaking their remaining payload.
    """
    evidence = project_npc_engagement_evidence(events)
    return set(evidence["authored_attested_npc_ids"])


def project_npc_engagement_evidence(
    events: list[dict[str, Any]],
) -> dict[str, Any]:
    """Project attested, legacy, and explicitly unverified NPC evidence.

    Legacy event existence is retained as ``NON_COMPARABLE`` evidence rather
    than silently promoted to coverage or silently erased.  Psych-state
    updates remain outside this projection.
    """
    attested: set[str] = set()
    legacy: set[str] = set()
    unverified: set[str] = set()
    for event in events:
        if not isinstance(event, dict):
            continue
        # Identity coverage deliberately consumes only raw canonical
        # engagement/agency records.  The broader semantic compatibility
        # layer aliases npc_update for other consumers, but a psych-state
        # mutation is never identity evidence in any bucket.
        if coc_event_contract.event_type(event) not in _NPC_ENGAGEMENT_EVENT_TYPES:
            continue
        npc_id = _text(coc_event_contract.value(event, "npc_id"))
        if not npc_id:
            continue
        binding = coc_event_contract.value(event, "identity_binding")
        contract = coc_event_contract.value(event, "identity_contract")
        if _engagement_coverage_eligible(event):
            attested.add(npc_id)
        elif not isinstance(binding, dict) and not isinstance(contract, dict):
            legacy.add(npc_id)
        else:
            unverified.add(npc_id)
    return {
        "schema_version": 1,
        "semantics": "authored_identity_attestation",
        "status": "NON_COMPARABLE" if legacy else "PASS",
        "authored_attested_npc_ids": sorted(attested),
        "legacy_unverifiable_npc_ids": sorted(legacy),
        "unverified_npc_ids": sorted(unverified),
    }


def _bonus_clue_id_from_request(request: dict[str, Any]) -> str | None:
    if request.get("clue_bonus"):
        return _text(request.get("clue_id"))
    contract = request.get("roll_contract") if isinstance(request.get("roll_contract"), dict) else {}
    group = str(contract.get("roll_density_group") or "")
    if group.startswith("clue-bonus:"):
        return _text(group.split(":", 1)[1]) or _text(request.get("clue_id"))
    return None


def _harvest_bonus_rolls_engaged(raw: dict[str, Any], final_state: dict[str, Any]) -> set[str]:
    """Collect clue ids that engaged a bonus roll from real live-match records.

    Preferred explicit fields first; then turns' clue_bonus rules_requests /
    event_types, then clue_bonus_* events. No free-text scanning.
    """
    explicit = (
        raw.get("bonus_rolls_engaged")
        or raw.get("engaged_bonus_clue_ids")
        or final_state.get("bonus_rolls_engaged")
        or []
    )
    found = _as_str_set(explicit)

    for turn in raw.get("turns") or []:
        if not isinstance(turn, dict):
            continue
        for request in turn.get("rules_requests") or []:
            if not isinstance(request, dict):
                continue
            cid = _bonus_clue_id_from_request(request)
            if cid:
                found.add(cid)
        event_types = {
            str(et).strip()
            for et in (turn.get("event_types") or [])
            if str(et or "").strip()
        }
        if event_types & _CLUE_BONUS_EVENT_TYPES:
            for request in turn.get("rules_requests") or []:
                if not isinstance(request, dict):
                    continue
                cid = _bonus_clue_id_from_request(request)
                if cid:
                    found.add(cid)
            policy = turn.get("resolved_clue_policy")
            if isinstance(policy, dict) and (
                policy.get("bonus_reveal") or policy.get("bonus_cost")
            ):
                for request in turn.get("rules_requests") or []:
                    if not isinstance(request, dict):
                        continue
                    cid = _bonus_clue_id_from_request(request)
                    if cid:
                        found.add(cid)

    for event in _iter_play_events(raw):
        etype = str(event.get("event_type") or "").strip()
        if etype not in _CLUE_BONUS_EVENT_TYPES:
            continue
        cid = _text(event.get("clue_id"))
        if cid:
            found.add(cid)

    return found


def _supported_npc_projection(evidence: Any) -> bool:
    if not isinstance(evidence, dict) or set(evidence) != {
        "schema_version",
        "semantics",
        "status",
        "authored_attested_npc_ids",
        "legacy_unverifiable_npc_ids",
        "unverified_npc_ids",
    }:
        return False
    if (
        evidence.get("schema_version") != 1
        or evidence.get("semantics") != "authored_identity_attestation"
    ):
        return False
    for key in (
        "authored_attested_npc_ids",
        "legacy_unverifiable_npc_ids",
        "unverified_npc_ids",
    ):
        values = evidence.get(key)
        if not isinstance(values, list) or any(
            not isinstance(value, str) or not value for value in values
        ) or values != sorted(set(values)):
            return False
    expected_status = (
        "NON_COMPARABLE"
        if evidence["legacy_unverifiable_npc_ids"]
        else "PASS"
    )
    return evidence.get("status") == expected_status


def _harvest_npc_engagement_evidence(
    raw: dict[str, Any], final_state: dict[str, Any]
) -> dict[str, Any]:
    """Collect coverage evidence without upgrading unversioned raw IDs."""
    event_rows = _iter_play_events(raw)
    for turn in raw.get("turns") or []:
        if not isinstance(turn, dict):
            continue
        for move in turn.get("npc_moves") or []:
            if not isinstance(move, dict):
                continue
            event_rows.append({"event_type": "npc_engagement", **move})

    projected = project_npc_engagement_evidence(event_rows)
    attested = set(projected["authored_attested_npc_ids"])
    legacy = set(projected["legacy_unverifiable_npc_ids"])
    unverified = set(projected["unverified_npc_ids"])

    explicit = (
        raw.get("engaged_npc_ids")
        or raw.get("npc_interactions")
        or final_state.get("engaged_npc_ids")
        or []
    )
    explicit_ids = _as_str_set(explicit)
    contract = raw.get("npc_engagement_coverage_contract")
    if not isinstance(contract, dict):
        contract = final_state.get("npc_engagement_coverage_contract")
    prior_projection = raw.get("npc_engagement_evidence")
    if not isinstance(prior_projection, dict):
        candidate_projection = final_state.get("npc_engagement_evidence")
        prior_projection = (
            candidate_projection if isinstance(candidate_projection, dict) else None
        )
    claimed_attested = _as_str_set(
        (prior_projection or {}).get("authored_attested_npc_ids")
    )
    evidence_digest = (
        coc_npc_identity.engagement_evidence_digest(prior_projection)
        if isinstance(prior_projection, dict)
        else None
    )
    supported_projection_contract = bool(
        isinstance(contract, dict)
        and contract.get("schema_version") == 3
        and contract.get("semantics") == "authored_identity_attestation"
        and contract.get("producer") == "coc_live_match"
        and contract.get("projection_schema_version") == 1
        and contract.get("legacy_raw_ids_included") is False
        and _supported_npc_projection(prior_projection)
        and contract.get("evidence_digest") == evidence_digest
        and contract.get("legacy_status") == prior_projection.get("status")
        and explicit_ids == claimed_attested
    )
    if supported_projection_contract:
        attested.update(explicit_ids)
    elif isinstance(contract, dict):
        unverified.update(explicit_ids)
    else:
        legacy.update(explicit_ids)

    if isinstance(prior_projection, dict):
        projection_supported = bool(
            prior_projection.get("schema_version") == 1
            and prior_projection.get("semantics")
            == "authored_identity_attestation"
            and supported_projection_contract
        )
        if projection_supported:
            attested.update(claimed_attested)
            legacy.update(
                _as_str_set(prior_projection.get("legacy_unverifiable_npc_ids"))
            )
            unverified.update(
                _as_str_set(prior_projection.get("unverified_npc_ids"))
            )
        else:
            unverified.update(claimed_attested)
            unverified.update(
                _as_str_set(prior_projection.get("legacy_unverifiable_npc_ids"))
            )
            unverified.update(
                _as_str_set(prior_projection.get("unverified_npc_ids"))
            )

    return {
        "schema_version": 1,
        "semantics": "authored_identity_attestation",
        "status": "NON_COMPARABLE" if legacy else "PASS",
        "authored_attested_npc_ids": sorted(attested),
        "legacy_unverifiable_npc_ids": sorted(legacy),
        "unverified_npc_ids": sorted(unverified),
    }


def _normalize_play_record(play: dict[str, Any] | None) -> dict[str, Any]:
    """Normalize session_result / campaign world-state shapes into one record."""
    raw = play if isinstance(play, dict) else {}
    final_state = raw.get("final_state") if isinstance(raw.get("final_state"), dict) else {}
    clue_coverage = raw.get("clue_coverage") if isinstance(raw.get("clue_coverage"), dict) else {}

    discovered = (
        raw.get("discovered_clue_ids")
        or raw.get("discovered_clues")
        or clue_coverage.get("discovered")
        or final_state.get("discovered_clues")
        or final_state.get("discovered_clue_ids")
        or []
    )
    visited = (
        raw.get("visited_scene_ids")
        or raw.get("scene_path")
        or final_state.get("visited_scene_ids")
        or []
    )
    clocks = raw.get("clocks")
    if not isinstance(clocks, dict):
        threat_state = raw.get("threat_state") if isinstance(raw.get("threat_state"), dict) else {}
        clocks = threat_state.get("clocks") if isinstance(threat_state.get("clocks"), dict) else {}
        if not clocks and isinstance(final_state.get("clocks"), dict):
            clocks = final_state["clocks"]

    npc_evidence = _harvest_npc_engagement_evidence(raw, final_state)
    return {
        "discovered_clue_ids": _as_str_set(discovered),
        "visited_scene_ids": _as_str_set(visited),
        "clocks": clocks if isinstance(clocks, dict) else {},
        "bonus_rolls_engaged": _harvest_bonus_rolls_engaged(raw, final_state),
        "engaged_npc_ids": set(npc_evidence["authored_attested_npc_ids"]),
        "npc_engagement_evidence": npc_evidence,
    }


def _clock_integrity_ok(
    criterion: dict[str, Any],
    clocks: dict[str, Any],
) -> bool:
    clock_ids = criterion.get("clock_ids") or []
    segments_map = criterion.get("clock_segments") or {}
    if not clock_ids:
        # Front with no clocks: integrity holds if play record is well-formed.
        return True
    for clock_id in clock_ids:
        entry = clocks.get(clock_id)
        if not isinstance(entry, dict):
            # Untouched clocks default to 0 — still valid integrity.
            continue
        try:
            current = int(entry.get("current_segments", 0) or 0)
        except (TypeError, ValueError):
            return False
        if current < 0:
            return False
        max_segments = segments_map.get(clock_id)
        if max_segments is not None:
            try:
                max_i = int(max_segments)
            except (TypeError, ValueError):
                max_i = None
            if max_i is not None and max_i > 0 and current > max_i:
                return False
    return True


def _statement_satisfied(statement: dict[str, Any], play: dict[str, Any]) -> bool:
    criterion = statement.get("criterion") if isinstance(statement.get("criterion"), dict) else {}
    discovered = play["discovered_clue_ids"]
    visited = play["visited_scene_ids"]

    if "conclusion_id" in criterion and "clue_ids" in criterion:
        clue_ids = [str(c) for c in (criterion.get("clue_ids") or []) if c]
        try:
            minimum = int(criterion.get("minimum_routes") or 1)
        except (TypeError, ValueError):
            minimum = 1
        hit = sum(1 for cid in clue_ids if cid in discovered)
        return hit >= minimum

    if statement.get("statement_id", "").startswith("terminal:") or (
        "scene_id" in criterion and statement.get("kind") == "required"
        and "front_id" not in criterion
        and "conclusion_id" not in criterion
        and statement.get("statement_id", "").startswith("terminal")
    ):
        scene_id = _text(criterion.get("scene_id"))
        return bool(scene_id and scene_id in visited)

    if "front_id" in criterion:
        return _clock_integrity_ok(criterion, play["clocks"])

    if "bonus_clue_id" in criterion:
        bonus_id = _text(criterion.get("bonus_clue_id"))
        return bool(bonus_id and bonus_id in play["bonus_rolls_engaged"])

    if "npc_id" in criterion:
        npc_id = _text(criterion.get("npc_id"))
        return bool(npc_id and npc_id in play["engaged_npc_ids"])

    if "scene_id" in criterion:
        scene_id = _text(criterion.get("scene_id"))
        return bool(scene_id and scene_id in visited)

    return False


def evaluate_adherence(
    checklist: list[dict[str, Any]] | None,
    playtest_result_or_campaign_state: dict[str, Any] | None,
) -> dict[str, Any]:
    """Mark each checklist statement satisfied/unsatisfied from structured play data."""
    statements_in = list(checklist or [])
    play = _normalize_play_record(playtest_result_or_campaign_state)
    evaluated: list[dict[str, Any]] = []
    required_total = 0
    required_hit = 0
    for stmt in statements_in:
        if not isinstance(stmt, dict):
            continue
        kind = str(stmt.get("kind") or "optional").strip().lower()
        if kind not in {"required", "optional"}:
            kind = "optional"
        satisfied = _statement_satisfied(stmt, play)
        row = {
            "statement_id": stmt.get("statement_id"),
            "kind": kind,
            "criterion": dict(stmt.get("criterion") or {}),
            "description": stmt.get("description") or "",
            "satisfied": bool(satisfied),
        }
        evaluated.append(row)
        if kind == "required":
            required_total += 1
            if satisfied:
                required_hit += 1
    coverage = (required_hit / required_total) if required_total else 1.0
    return {
        "statements": evaluated,
        "required_coverage": coverage,
        "required_satisfied": required_hit,
        "required_total": required_total,
        "npc_engagement_evidence": play["npc_engagement_evidence"],
    }


def compute_adherence_for_scenario(
    scenario_dir: Path | str,
    playtest_result_or_campaign_state: dict[str, Any] | None,
) -> dict[str, Any] | None:
    """Fail-open helper: return evaluated adherence or None on any error."""
    try:
        checklist = generate_adherence_checklist(scenario_dir)
        if not checklist:
            return None
        return evaluate_adherence(checklist, playtest_result_or_campaign_state)
    except Exception:
        return None
