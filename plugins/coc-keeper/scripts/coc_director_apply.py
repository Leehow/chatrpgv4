#!/usr/bin/env python3
"""DirectorPlan apply layer — persists director decisions to save/logs/memory.

The director is read-only wrt rule state; this module is the write side that
turns a DirectorPlan's reveal/pressure/memory_write intents into file changes.
Called by coc-keeper-play after rules are resolved and the turn is narrated.

Clue reveal is intentionally *fail-forward*, not a hard gate:
- obvious / already-resolved clues may be committed immediately;
- obscured clues with rules_requests commit only on a successful rule result;
- failed obscured checks withhold the exact clue, log an immersive cost, and
  keep fallback/recovery routes alive instead of deadlocking the story;
- RECOVER after multiple stalled turns may commit one fallback route with a
  pressure/time cost, modeling an Idea Roll-style recovery valve.

Spec: docs/superpowers/specs/2026-07-06-story-director-v2-blueprint.md
"""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent


def _load_sibling(name: str, filename: str):
    import importlib.util
    spec = importlib.util.spec_from_file_location(name, SCRIPT_DIR / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_memory = None
try:
    coc_memory = _load_sibling("coc_memory", "coc_memory.py")
except Exception:
    coc_memory = None

coc_time = None
try:
    coc_time = _load_sibling("coc_time", "coc_time.py")
except Exception:
    coc_time = None


def _read_json(path: Path, fallback: Any) -> Any:
    if not path.exists():
        return fallback
    return json.loads(path.read_text(encoding="utf-8"))


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _append_jsonl(path: Path, record: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


_TENSION_LADDER = ["low", "medium", "high", "climax"]
_SUCCESS_OUTCOMES = {"critical", "extreme_success", "hard_success", "regular_success", "success"}
_FAILURE_OUTCOMES = {"failure", "fumble"}


def _bump_tension(current: str, delta: int) -> str:
    """Move tension level by delta steps, clamped to the ladder."""
    if current not in _TENSION_LADDER:
        current = "low"
    idx = _TENSION_LADDER.index(current) + delta
    idx = max(0, min(len(_TENSION_LADDER) - 1, idx))
    return _TENSION_LADDER[idx]


def _first_rule_result(rules_results: list[dict[str, Any]] | None) -> dict[str, Any] | None:
    if not rules_results:
        return None
    for result in rules_results:
        if isinstance(result, dict):
            return result
    return None


def _rule_result_success(result: dict[str, Any] | None) -> bool | None:
    """Return True/False for resolved rolls; None when no usable result exists."""
    if result is None:
        return None
    if isinstance(result.get("success"), bool):
        return bool(result["success"])
    outcome = str(result.get("outcome", ""))
    if outcome in _SUCCESS_OUTCOMES:
        return True
    if outcome in _FAILURE_OUTCOMES:
        return False
    return None


def _obscured_reveal_requires_result(plan: dict[str, Any]) -> bool:
    policy = plan.get("clue_policy", {})
    return (
        bool(plan.get("rules_requests"))
        and plan.get("scene_action") == "REVEAL"
        and policy.get("clue_type") == "obscured"
        and bool(policy.get("reveal"))
    )


def _synthetic_pressure_move(reason: str, visible_symptom: str = "time passes and the opposition gains ground") -> dict[str, Any]:
    return {
        "clock_id": "fail-forward-cost",
        "tick": 1,
        "visible_symptom": visible_symptom,
        "reason": reason,
    }


def _resolve_committed_clues(
    plan: dict[str, Any],
    rules_results: list[dict[str, Any]] | None,
    ts: str,
    investigator_id: str,
) -> tuple[list[str], list[dict[str, Any]], list[dict[str, Any]]]:
    """Resolve which clues are actually committed this turn.

    Returns (committed_clue_ids, extra_events, extra_pressure_moves).
    The exact clue is never committed on a failed obscured roll. Instead, the
    function records a cost and preserves any fallback routes for the next beat.
    """
    decision_id = plan.get("decision_id", "unknown")
    action = plan.get("scene_action", "")
    policy = plan.get("clue_policy", {})
    events: list[dict[str, Any]] = []
    pressure: list[dict[str, Any]] = []

    reveal_ids = [cid for cid in policy.get("reveal", []) if cid]
    fallback_ids = [cid for cid in policy.get("fallback_routes", []) if cid]
    stalled = int(plan.get("rule_signals", {}).get("stalled_turns", 0) or 0)

    # RECOVER is a recovery valve, not another suggestion loop. After repeated
    # stalls, commit the fallback clue/lead with a cost so play keeps moving.
    if action == "RECOVER" and stalled >= 3 and fallback_ids:
        pressure.append(_synthetic_pressure_move(
            "recover_fail_forward_cost",
            "the recovery lead appears, but time has clearly been lost",
        ))
        events.append({
            "event_type": "fail_forward_recovery",
            "decision_id": decision_id,
            "clue_id": fallback_ids[0],
            "fallback_routes": fallback_ids,
            "investigator_id": investigator_id,
            "summary": "stalled investigation recovered by surfacing a fallback route with a cost",
            "ts": ts,
        })
        return [fallback_ids[0]], events, pressure

    # Obvious/direct clues remain immediate. Obscured clues with a rules_request
    # must wait for the actual roll result.
    if not _obscured_reveal_requires_result(plan):
        return reveal_ids, events, pressure

    result = _first_rule_result(rules_results)
    success = _rule_result_success(result)
    if success is True:
        return reveal_ids, events, pressure

    if success is None:
        events.append({
            "event_type": "clue_pending_rule_result",
            "decision_id": decision_id,
            "clue_ids": reveal_ids,
            "investigator_id": investigator_id,
            "summary": "obscured clue reveal held until rule result is backfilled",
            "ts": ts,
        })
        return [], events, pressure

    outcome = str((result or {}).get("outcome", "failure"))
    pressure.append(_synthetic_pressure_move(
        "failed_obscured_clue_check",
        "the failed attempt costs time and narrows the safe routes forward",
    ))
    events.append({
        "event_type": "clue_withheld",
        "decision_id": decision_id,
        "clue_ids": reveal_ids,
        "rule_outcome": outcome,
        "fallback_routes": fallback_ids,
        "investigator_id": investigator_id,
        "summary": "failed obscured clue check withheld the exact clue; fallback routes remain available",
        "ts": ts,
    })
    events.append({
        "event_type": "failure_consequence",
        "decision_id": decision_id,
        "consequence_type": "time_pressure_and_alternate_route_hint",
        "severity": "hard" if outcome == "fumble" else "regular",
        "fallback_routes": fallback_ids,
        "investigator_id": investigator_id,
        "summary": "failure advances pressure instead of ending the investigation",
        "ts": ts,
    })
    return [], events, pressure


def _copy_jsonable(payload: dict[str, Any]) -> dict[str, Any]:
    """Deep-copy a JSON-shaped DirectorPlan without importing copy for stable output."""
    return json.loads(json.dumps(payload, ensure_ascii=False))


def backfill_rule_results(plan: dict[str, Any], rules_results: list[dict[str, Any]] | None) -> dict[str, Any]:
    """Return a narration-ready plan with rule outcomes reconciled.

    This is the bridge between rules and prose: narrator-facing directives no
    longer contain an exact clue anchor when the obscured check failed. Instead,
    the plan carries a player-safe failure_consequence telling the narrator to
    show cost, pressure, and an alternate route without claiming the clue was
    found.
    """
    resolved_plan = _copy_jsonable(plan)
    resolved_results = list(rules_results or [])
    resolved_plan["rules_results"] = resolved_results

    committed, resolution_events, extra_pressure = _resolve_committed_clues(
        resolved_plan, resolved_results, ts="", investigator_id=""
    )
    planned_reveals = [cid for cid in resolved_plan.get("clue_policy", {}).get("reveal", []) if cid]
    withheld: list[str] = []
    recovered: list[str] = []
    failure_event: dict[str, Any] | None = None
    recovery_event: dict[str, Any] | None = None
    for event in resolution_events:
        etype = event.get("event_type")
        if etype == "clue_withheld":
            withheld = [cid for cid in event.get("clue_ids", []) if cid]
        elif etype == "failure_consequence":
            failure_event = event
        elif etype == "fail_forward_recovery":
            clue_id = event.get("clue_id")
            recovered = [clue_id] if clue_id else []
            recovery_event = event

    resolved_plan["resolved_clue_policy"] = {
        "planned_reveals": planned_reveals,
        "committed_reveals": committed,
        "withheld_reveals": withheld,
        "fallback_recovered": recovered,
        "pending_rule_result": any(e.get("event_type") == "clue_pending_rule_result" for e in resolution_events),
        "extra_pressure_moves": extra_pressure,
    }

    directives = resolved_plan.setdefault("narrative_directives", {})
    if failure_event is not None:
        # Prevent the narrator from including the exact clue anchor that was only
        # valid on success. The next beat may still surface a fallback route.
        directives["must_include"] = []
        directives["failure_consequence"] = {
            "narration_mode": "withhold_exact_clue_with_cost",
            "consequence_type": failure_event.get("consequence_type"),
            "severity": failure_event.get("severity", "regular"),
            "fallback_routes": failure_event.get("fallback_routes", []),
            "costs": ["time_pressure", "alternate_route_hint"],
            "must_not_claim": [
                "do not say the exact planned clue was found",
                "do not end the scene with no possible next action",
            ],
        }
    elif recovery_event is not None:
        directives["failure_consequence"] = {
            "narration_mode": "recover_with_cost",
            "consequence_type": "fallback_route_surfaces",
            "severity": "regular",
            "fallback_routes": recovery_event.get("fallback_routes", []),
            "costs": ["time_pressure"],
            "must_not_claim": ["do not present this as a table-level hint"],
        }
    else:
        directives.pop("failure_consequence", None)

    return resolved_plan


def apply_plan(
    campaign_dir: Path,
    plan: dict[str, Any],
    investigator_id: str,
    rules_results: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Apply a DirectorPlan's effects. Returns the events written to logs/events.jsonl.

    - clue reveal -> add to world-state.discovered_clue_ids + event only when
      the clue has been resolved as committed
    - failed obscured checks -> no exact clue reveal; log cost/fallback events
    - pressure_moves -> bump pacing tension + turn + event per move
    - memory_writes -> create memory cards via coc_memory
    """
    events: list[dict[str, Any]] = []
    save = campaign_dir / "save"
    logs = campaign_dir / "logs"
    ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    decision_id = plan.get("decision_id", "unknown")
    action = plan.get("scene_action", "")

    # 1. clue reveal / fail-forward resolution
    world_path = save / "world-state.json"
    world = _read_json(world_path, {"discovered_clue_ids": []})
    discovered = list(world.get("discovered_clue_ids", []))
    committed_clues, resolution_events, extra_pressure = _resolve_committed_clues(
        plan, rules_results, ts, investigator_id
    )
    for ev in resolution_events:
        events.append(ev)
        _append_jsonl(logs / "events.jsonl", ev)
    for clue_id in committed_clues:
        if clue_id and clue_id not in discovered:
            discovered.append(clue_id)
            ev = {"event_type": "clue_reveal", "decision_id": decision_id,
                  "clue_id": clue_id, "investigator_id": investigator_id,
                  "summary": f"clue revealed: {clue_id}", "ts": ts}
            events.append(ev)
            _append_jsonl(logs / "events.jsonl", ev)
    world["discovered_clue_ids"] = discovered
    _write_json(world_path, world)

    # 2. pressure moves -> pacing state + events
    pacing_path = save / "pacing-state.json"
    pacing = _read_json(pacing_path, {"tension_level": "low", "turn_number": 0})
    pressure_moves = [*plan.get("pressure_moves", []), *extra_pressure]
    tension_delta = sum(int(m.get("tick", 0)) for m in pressure_moves)
    if tension_delta or action in ("PRESSURE", "SUBSYSTEM"):
        pacing["tension_level"] = _bump_tension(pacing.get("tension_level", "low"), max(1, tension_delta))
    pacing["turn_number"] = int(pacing.get("turn_number", 0)) + 1
    # carry horror stage from plan into pacing for next-turn director read
    horror = plan.get("narrative_directives", {}).get("horror_escalation_stage")
    if horror:
        pacing["horror_stage"] = horror
    _write_json(pacing_path, pacing)
    for move in pressure_moves:
        ev = {"event_type": "pressure_tick", "decision_id": decision_id,
              "clock_id": move.get("clock_id"), "visible_symptom": move.get("visible_symptom"),
              "reason": move.get("reason"),
              "investigator_id": investigator_id, "ts": ts}
        events.append(ev)
        _append_jsonl(logs / "events.jsonl", ev)

    # 3. time advance -> world clock + triggers (coc_time layer)
    if coc_time is not None:
        time_events = coc_time.apply_time_advance_from_plan(
            campaign_dir, plan, investigator_id
        )
        events.extend(time_events)
        for ev in time_events:
            _append_jsonl(logs / "events.jsonl", ev)

    # 4. memory writes -> cards
    if coc_memory is not None:
        for i, mw in enumerate(plan.get("memory_writes", [])):
            mid = f"mem-{decision_id}-{i}"
            coc_memory.create_memory_card(
                campaign_dir=campaign_dir, memory_id=mid,
                privacy=mw.get("privacy", "player_safe"),
                salience=float(mw.get("salience", 0.5)),
                summary=mw.get("summary", ""),
                entities=mw.get("entities", []),
                tags=mw.get("tags", []),
                reactivation_cues=mw.get("reactivation_cues", []),
                source_events=[decision_id],
            )

    # 5. scene transition — advance when current scene is exhausted or plan CUTs.
    # The Haunting's exit_conditions are natural-language sentences that can't be
    # machine-evaluated, so we use a structural proxy: a scene is "exhausted"
    # when all its available_clues are in discovered_clue_ids. A CUT action forces
    # the advance regardless (the director decided the dramatic_question is answered).
    story_graph_path = campaign_dir / "scenario" / "story-graph.json"
    if story_graph_path.exists():
        story = _read_json(story_graph_path, {"scenes": []})
        scenes = story.get("scenes", [])
        current_scene_id = world.get("active_scene_id")
        current_scene = next((s for s in scenes if s.get("scene_id") == current_scene_id), None)
        if current_scene:
            available = current_scene.get("available_clues", [])
            should_advance = False
            if action == "CUT":
                should_advance = True
            elif available and all(c in discovered for c in available):
                should_advance = True
            if should_advance:
                # find current scene's position; fall back to -1 if missing
                try:
                    idx = scenes.index(current_scene)
                except ValueError:
                    idx = -1
                # advance to the first following scene that has undiscovered
                # clues, or has no clues at all (e.g. a terminal aftermath scene)
                for next_scene in scenes[idx + 1:]:
                    next_clues = next_scene.get("available_clues", [])
                    if not next_clues or any(c not in discovered for c in next_clues):
                        world["active_scene_id"] = next_scene["scene_id"]
                        _write_json(world_path, world)
                        ev = {"event_type": "scene_transition", "decision_id": decision_id,
                              "from_scene": current_scene_id, "to_scene": next_scene["scene_id"],
                              "investigator_id": investigator_id, "ts": ts}
                        events.append(ev)
                        _append_jsonl(logs / "events.jsonl", ev)
                        break

    # 6. always emit a turn event if nothing else did
    if not events:
        ev = {"event_type": "turn", "decision_id": decision_id, "action": action,
              "investigator_id": investigator_id, "ts": ts}
        events.append(ev)
        _append_jsonl(logs / "events.jsonl", ev)

    return events
