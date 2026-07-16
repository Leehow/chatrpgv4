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
    binding = coc_event_contract.value(event, "identity_binding")
    return bool(
        isinstance(binding, dict)
        and binding.get("status") == "authored_bound"
        and binding.get("authored_identity_attested") is True
        and binding.get("coverage_eligible") is True
    )


def project_engaged_npc_ids(events: list[dict[str, Any]]) -> set[str]:
    """Project NPC engagement IDs from canonical structured events.

    Live-match logs are intentionally not copied wholesale into the public
    session result because they may contain keeper-only state.  This narrow
    projection lets the adherence consumer receive the semantic IDs it needs
    without losing the producer events or leaking their remaining payload.
    """
    found: set[str] = set()
    for event in events:
        if not isinstance(event, dict) or not any(
            coc_event_contract.matches(event, event_type)
            for event_type in _NPC_ENGAGEMENT_EVENT_TYPES
        ):
            continue
        if not _engagement_coverage_eligible(event):
            continue
        npc_id = _text(coc_event_contract.value(event, "npc_id"))
        if npc_id:
            found.add(npc_id)
    return found


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


def _harvest_engaged_npc_ids(raw: dict[str, Any], final_state: dict[str, Any]) -> set[str]:
    """Collect NPC ids engaged during play from turns / engagement events."""
    explicit = (
        raw.get("engaged_npc_ids")
        or raw.get("npc_interactions")
        or final_state.get("engaged_npc_ids")
        or []
    )
    found = _as_str_set(explicit)

    for turn in raw.get("turns") or []:
        if not isinstance(turn, dict):
            continue
        for move in turn.get("npc_moves") or []:
            if not isinstance(move, dict):
                continue
            if not _engagement_coverage_eligible(
                {"event_type": "npc_engagement", **move}
            ):
                continue
            npc_id = _text(move.get("npc_id"))
            if npc_id:
                found.add(npc_id)

    found.update(project_engaged_npc_ids(_iter_play_events(raw)))

    return found


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

    return {
        "discovered_clue_ids": _as_str_set(discovered),
        "visited_scene_ids": _as_str_set(visited),
        "clocks": clocks if isinstance(clocks, dict) else {},
        "bonus_rolls_engaged": _harvest_bonus_rolls_engaged(raw, final_state),
        "engaged_npc_ids": _harvest_engaged_npc_ids(raw, final_state),
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
