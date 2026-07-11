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

Session ending (W1-6 / Keeper Rulebook p.212-213): when ``scene_action`` is
``PAYOFF`` and the active story-graph scene is terminal, append a structured
``session_ending`` event (playtest-compatible ``type`` + ``payload``). Terminal
evidence is structured only — never prose keywords:

- ``scene.is_final is True``, or
- ``scene.scene_type == "resolution"``, or
- the scene has no outgoing ``scene_edges`` (R-3 graph), or
- LEGACY: the scene is the last entry in ``story-graph.json`` ``scenes``
  when the graph never declares ``scene_edges``.

Spec: docs/superpowers/specs/2026-07-06-story-director-v2-blueprint.md
"""
from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent

_APPLY_LEDGER_FILENAME = "apply-ledger.json"
_APPLY_LEDGER_CAP = 200


def _load_sibling(name: str, filename: str):
    import importlib.util
    spec = importlib.util.spec_from_file_location(name, SCRIPT_DIR / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_fileio = _load_sibling("coc_fileio", "coc_fileio.py")
coc_exit_conditions = _load_sibling("coc_exit_conditions", "coc_exit_conditions.py")
coc_scene_graph = _load_sibling("coc_scene_graph", "coc_scene_graph.py")
coc_development = _load_sibling("coc_development", "coc_development.py")
coc_rule_signals = _load_sibling("coc_rule_signals", "coc_rule_signals.py")
coc_npc_state = _load_sibling("coc_npc_state", "coc_npc_state.py")
coc_subsystem_executor = _load_sibling(
    "coc_subsystem_executor_director_apply",
    "coc_subsystem_executor.py",
)

coc_memory = None
try:
    coc_memory = _load_sibling("coc_memory", "coc_memory.py")
except Exception:
    coc_memory = None

# Idea Roll signpost ladder (Keeper Rulebook ~p.199). Higher rank wins; never
# downgrade an already-stronger signpost.
_SIGNPOST_RANK = {
    "unmentioned": 0,
    "mentioned": 1,
    "obvious": 2,
}


def _normalize_signpost_level(raw: Any) -> str | None:
    key = str(raw or "").strip().lower()
    aliases = {
        "unmentioned": "unmentioned",
        "never": "unmentioned",
        "none": "unmentioned",
        "mentioned": "mentioned",
        "signposted": "mentioned",
        "regular": "mentioned",
        "obvious": "obvious",
        "obvious_missed": "obvious",
        "extreme": "obvious",
    }
    return aliases.get(key)


def _clue_id_from_choice_route(route: dict[str, Any]) -> str | None:
    """Extract a clue id from a choice_frame investigative lead route."""
    if not isinstance(route, dict):
        return None
    route_type = str(route.get("route_type") or "")
    source = str(route.get("source") or "")
    route_id = str(route.get("route_id") or "")
    if route_type == "investigative_lead" or source == "clue_policy.leads" or route_id.startswith("clue:"):
        if route_id.startswith("clue:"):
            clue_id = route_id.split(":", 1)[1].strip()
            return clue_id or None
        cue = str(route.get("cue") or "").strip()
        return cue or None
    return None


def _collect_signpost_updates(
    plan: dict[str, Any],
    resolution_events: list[dict[str, Any]],
) -> dict[str, str]:
    """Derive structured clue_signposts updates from this turn's plan/events.

    - CHOICE / clue leads offered to the player → mentioned
    - failed obscured perception (clue_withheld) → obvious
    """
    updates: dict[str, str] = {}

    def bump(clue_id: Any, level: str) -> None:
        cid = str(clue_id or "").strip()
        if not cid:
            return
        current = updates.get(cid)
        if current is None or _SIGNPOST_RANK.get(level, 0) > _SIGNPOST_RANK.get(current, 0):
            updates[cid] = level

    policy = plan.get("clue_policy") or {}
    for cid in policy.get("leads") or []:
        bump(cid, "mentioned")

    choice_frame = plan.get("choice_frame") or (plan.get("narrative_directives") or {}).get("choice_frame") or {}
    for route in choice_frame.get("routes") or []:
        if not isinstance(route, dict):
            continue
        clue_id = _clue_id_from_choice_route(route)
        if clue_id:
            bump(clue_id, "mentioned")

    for event in resolution_events:
        if not isinstance(event, dict):
            continue
        if event.get("event_type") == "clue_withheld":
            for cid in event.get("clue_ids") or []:
                bump(cid, "obvious")
    return updates


def _merge_clue_signposts(world: dict[str, Any], updates: dict[str, str]) -> dict[str, str]:
    """Merge signpost updates into world-state; never downgrade a stronger level."""
    existing = world.get("clue_signposts")
    merged: dict[str, str] = {}
    if isinstance(existing, dict):
        for clue_id, level in existing.items():
            normalized = _normalize_signpost_level(level)
            if normalized and normalized != "unmentioned":
                merged[str(clue_id)] = normalized
    for clue_id, level in updates.items():
        normalized = _normalize_signpost_level(level)
        if not normalized or normalized == "unmentioned":
            continue
        current = merged.get(clue_id)
        if current is None or _SIGNPOST_RANK.get(normalized, 0) > _SIGNPOST_RANK.get(current, 0):
            merged[clue_id] = normalized
    return merged

coc_time = None
try:
    coc_time = _load_sibling("coc_time", "coc_time.py")
except Exception:
    coc_time = None

coc_threat_state = None
try:
    coc_threat_state = _load_sibling("coc_threat_state", "coc_threat_state.py")
except Exception:
    coc_threat_state = None

coc_async_recorder = None
try:
    coc_async_recorder = _load_sibling("coc_async_recorder", "coc_async_recorder.py")
except Exception:
    coc_async_recorder = None

coc_scenario = None
try:
    coc_scenario = _load_sibling("coc_scenario", "coc_scenario.py")
except Exception:
    coc_scenario = None

_ACTIVE_JSONL_RECORDER = None


def _read_json(path: Path, fallback: Any) -> Any:
    if not path.exists():
        return fallback
    return json.loads(path.read_text(encoding="utf-8"))


def _write_json(path: Path, payload: Any) -> None:
    """Atomic JSON write via coc_fileio (fsync + os.replace)."""
    coc_fileio.write_json_atomic(
        path, payload, indent=2, ensure_ascii=False, trailing_newline=True
    )


def _resolve_scenario_id(campaign_dir: Path, world: dict[str, Any]) -> str | None:
    """Resolve scenario_id from structured campaign/world/module-meta fields."""
    for candidate in (
        world.get("scenario_id"),
        _read_json(campaign_dir / "campaign.json", {}).get("scenario_id"),
        _read_json(campaign_dir / "scenario" / "module-meta.json", {}).get("scenario_id"),
    ):
        if candidate not in (None, "", [], {}):
            return str(candidate)
    return None


def _is_terminal_scene(
    scene: dict[str, Any],
    scenes: list[dict[str, Any]] | None = None,
    story_graph: dict[str, Any] | None = None,
) -> bool:
    """True when structured scene evidence marks a scenario ending beat.

    Uses only structured fields (Semantic Matcher Constitution):
    ``is_final``, ``scene_type == "resolution"``, no outgoing scene_edges,
    or LEGACY last story-graph entry when edges are undeclared.
    """
    if story_graph is None and scenes is not None:
        story_graph = {"scenes": scenes}
    return coc_scene_graph.is_terminal_scene(scene, story_graph)


def _truthy_flag_ids(flags_doc: dict[str, Any] | None) -> set[str]:
    """Structured flag ids that are currently set (truthy values)."""
    if not isinstance(flags_doc, dict):
        return set()
    raw = flags_doc.get("flags")
    if not isinstance(raw, dict):
        return set()
    return {str(k) for k, v in raw.items() if v}


def _maybe_emit_session_ending(
    campaign_dir: Path,
    plan: dict[str, Any],
    *,
    world: dict[str, Any],
    investigator_id: str,
    decision_id: str,
    ts: str,
) -> dict[str, Any] | None:
    """Emit playtest-shaped ``session_ending`` when PAYOFF lands on a terminal scene.

    Trigger (structured only; see module docstring): ``scene_action == "PAYOFF"``
    and the active story-graph scene is terminal via ``is_final``,
    ``scene_type == "resolution"``, no outgoing edges, or legacy last-in-``scenes``.
    """
    if plan.get("scene_action") != "PAYOFF":
        return None
    story_graph_path = campaign_dir / "scenario" / "story-graph.json"
    if not story_graph_path.exists():
        return None
    story = _read_json(story_graph_path, {"scenes": []})
    scenes = [s for s in story.get("scenes", []) if isinstance(s, dict)]
    current_scene_id = world.get("active_scene_id")
    current_scene = next(
        (s for s in scenes if s.get("scene_id") == current_scene_id),
        None,
    )
    if current_scene is None or not _is_terminal_scene(
        current_scene, scenes, story_graph=story
    ):
        return None
    scenario_id = _resolve_scenario_id(campaign_dir, world)
    return {
        "type": "session_ending",
        "event_type": "session_ending",
        "actor": investigator_id,
        "decision_id": decision_id,
        "investigator_id": investigator_id,
        "payload": {
            "scenario_id": scenario_id,
            "scene_id": current_scene_id,
            "summary": f"scenario ending on scene {current_scene_id}",
        },
        "scenario_id": scenario_id,
        "scene_id": current_scene_id,
        "ts": ts,
        "rule_ref": "core.keeper.ending_a_story",
    }


def _lookup_clock_def(campaign_dir: Path, clock_id: str) -> dict[str, Any] | None:
    """Find a clock definition in scenario/threat-fronts.json by clock_id."""
    tf_path = campaign_dir / "scenario" / "threat-fronts.json"
    if not tf_path.is_file():
        return None
    tf = _read_json(tf_path, {"fronts": []})
    for front in tf.get("fronts", []):
        for clock in front.get("clocks", []):
            if clock.get("clock_id") == clock_id:
                return clock
    return None


def _find_clue_record(campaign_dir: Path, clue_id: str) -> dict[str, Any] | None:
    """Find a clue dict by id across all conclusions in scenario/clue-graph.json.

    Returns None when the file is missing or the clue is not registered. This
    is how clue_reveal resolves optional fields (e.g. handout_asset_id) that the
    director plan does not carry inline.
    """
    cg_path = campaign_dir / "scenario" / "clue-graph.json"
    if not cg_path.is_file():
        return None
    cg = _read_json(cg_path, {"conclusions": []})
    for concl in cg.get("conclusions", []):
        for clue in concl.get("clues", []):
            if clue.get("clue_id") == clue_id:
                return clue
    return None


def _resolve_handout_for_clue(
    campaign_dir: Path, clue: dict[str, Any] | None
) -> dict[str, Any]:
    """Resolve a clue's handout asset into clue_reveal payload fields.

    Reads the clue record's optional ``handout_asset_id`` and, when set, looks
    up the asset in index/handout-assets.json (via coc_scenario.load_handout_assets)
    to surface its title/summary and a player_visible rendering hint.

    Returns an empty dict when the clue has no handout_asset_id, when the asset
    is unregistered, or when the reader is unavailable — keeping clue_reveal
    backward compatible with all existing scenarios (none currently ship assets).
    """
    if not clue:
        return {}
    asset_id = clue.get("handout_asset_id")
    if not isinstance(asset_id, str) or not asset_id:
        return {}
    if coc_scenario is None or not hasattr(coc_scenario, "load_handout_assets"):
        return {"handout_asset_id": asset_id}
    assets = coc_scenario.load_handout_assets(campaign_dir)
    asset = assets.get(asset_id)
    if not asset:
        # id is set but asset not registered — surface the ref so the gap is
        # visible to consumers, without fabricated display info.
        return {"handout_asset_id": asset_id}
    fields: dict[str, Any] = {"handout_asset_id": asset_id}
    if isinstance(asset.get("title"), str):
        fields["handout_title"] = asset["title"]
    if isinstance(asset.get("summary"), str):
        fields["handout_summary"] = asset["summary"]
    if "player_visible" in asset:
        fields["player_visible"] = bool(asset["player_visible"])
    return fields


def _apply_scene_on_enter(
    campaign_dir: Path, scene: dict[str, Any],
    decision_id: str, investigator_id: str, ts: str,
    events: list[dict[str, Any]], logs: Path,
) -> None:
    """Fire a scene's on_enter hooks when it is entered.

    Currently handles ``on_enter.clock_ticks`` — ticking threat clocks and
    emitting clock_full when a clock fills.  SAN triggers are emitted by the
    director as rules_requests (see _build_rules_requests), not here, because
    the director owns the request layer and this layer owns persistence.
    """
    on_enter = scene.get("on_enter") or {}
    clock_ticks = on_enter.get("clock_ticks") or []
    save = campaign_dir / "save"

    # Emit a scene_enter event so downstream consumers know on_enter fired.
    enter_ev = {
        "event_type": "scene_enter", "decision_id": decision_id,
        "to_scene": scene.get("scene_id"),
        "investigator_id": investigator_id, "ts": ts,
    }
    events.append(enter_ev)
    _append_jsonl(logs / "events.jsonl", enter_ev)

    for tick_index, tick_spec in enumerate(clock_ticks):
        if not isinstance(tick_spec, dict):
            continue
        clock_id = tick_spec.get("clock_id")
        if not clock_id:
            continue
        clock_def = _lookup_clock_def(campaign_dir, clock_id)
        segments = int(clock_def.get("segments", 6)) if clock_def else 6
        symptom = ""
        if clock_def:
            ticks_visible = clock_def.get("on_tick_visible", [])
            current = coc_threat_state.get_clock_segments(save, clock_id) if coc_threat_state else 0
            if ticks_visible and isinstance(ticks_visible, list):
                symptom = ticks_visible[min(current, len(ticks_visible) - 1)]
        tick_ev = {
            "event_type": "pressure_tick", "decision_id": decision_id,
            "clock_id": clock_id, "visible_symptom": symptom,
            "reason": tick_spec.get("reason", "scene on_enter"),
            "investigator_id": investigator_id, "ts": ts,
        }
        events.append(tick_ev)
        _append_jsonl(logs / "events.jsonl", tick_ev)
        if coc_threat_state is not None:
            became_full = coc_threat_state.tick_clock(
                save, clock_id, segments,
                source_id=(
                    f"director:{decision_id}:scene-enter:{scene.get('scene_id')}:"
                    f"clock:{clock_id}:{tick_index}"
                ),
            )
            if became_full and clock_def:
                full_ev = {
                    "event_type": "clock_full", "decision_id": decision_id,
                    "clock_id": clock_id, "on_full": clock_def.get("on_full", ""),
                    "investigator_id": investigator_id, "ts": ts,
                }
                events.append(full_ev)
                _append_jsonl(logs / "events.jsonl", full_ev)


def _append_jsonl(path: Path, record: dict[str, Any]) -> None:
    if _ACTIVE_JSONL_RECORDER is not None:
        _ACTIVE_JSONL_RECORDER.append_jsonl(path, record)
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


def _apply_npc_state_and_agency(
    campaign_dir: Path,
    plan: dict[str, Any],
    investigator_id: str,
    ts: str,
) -> list[dict[str, Any]]:
    """Persist NPC persona cards and write one agency audit record per move."""
    save = campaign_dir / "save"
    logs = campaign_dir / "logs"
    events: list[dict[str, Any]] = []
    state_path = save / "npc-state.json"
    state = _read_json(state_path, {"schema_version": 1, "npcs": {}})
    if not isinstance(state.get("npcs"), dict):
        state["npcs"] = {}

    changed = False
    for card in plan.get("npc_state_writes", []) or []:
        if not isinstance(card, dict):
            continue
        npc_id = card.get("npc_id")
        if not npc_id:
            continue
        state["npcs"][str(npc_id)] = card
        changed = True
        generation_log = card.get("generation_log")
        if isinstance(generation_log, dict):
            record = {
                "schema_version": 1,
                "decision_id": plan.get("decision_id"),
                "turn_number": (plan.get("turn_input") or {}).get("turn_number"),
                "scene_id": (plan.get("turn_input") or {}).get("active_scene_id"),
                "investigator_id": investigator_id,
                "ts": ts,
                **generation_log,
            }
            events.append(record)
            _append_jsonl(logs / "npc-generation.jsonl", record)
            _append_jsonl(logs / "events.jsonl", record)

    for upgrade in plan.get("npc_stat_upgrades", []) or []:
        if not isinstance(upgrade, dict):
            continue
        card = upgrade.get("card")
        if not isinstance(card, dict):
            continue
        npc_id = upgrade.get("npc_id") or card.get("npc_id")
        if not npc_id:
            continue
        state["npcs"][str(npc_id)] = card
        changed = True
        raw_log = upgrade.get("log")
        if isinstance(raw_log, dict):
            record = {
                "schema_version": 1,
                "decision_id": plan.get("decision_id"),
                "turn_number": (plan.get("turn_input") or {}).get("turn_number"),
                "scene_id": (plan.get("turn_input") or {}).get("active_scene_id"),
                "investigator_id": investigator_id,
                "ts": ts,
                **raw_log,
            }
            events.append(record)
            _append_jsonl(logs / "npc-stat-upgrade.jsonl", record)
            _append_jsonl(logs / "events.jsonl", record)
    if changed:
        _write_json(state_path, state)

    for move in plan.get("npc_moves", []) or []:
        if not isinstance(move, dict):
            continue
        npc_id = move.get("npc_id")
        if npc_id:
            # Append-only engagement record so adherence / audits can see that
            # this NPC actually moved this turn (agency_moves may be empty).
            engagement = {
                "schema_version": 1,
                "event_type": "npc_engagement",
                "decision_id": plan.get("decision_id"),
                "turn_number": (plan.get("turn_input") or {}).get("turn_number"),
                "scene_id": (plan.get("turn_input") or {}).get("active_scene_id"),
                "npc_id": npc_id,
                "investigator_id": investigator_id,
                "ts": ts,
            }
            events.append(engagement)
            _append_jsonl(logs / "npc-engagement.jsonl", engagement)
            _append_jsonl(logs / "events.jsonl", engagement)
        for agency_move in move.get("agency_moves", []) or []:
            if not isinstance(agency_move, dict):
                continue
            record = {
                "schema_version": 1,
                "event_type": "npc_agency",
                "decision_id": plan.get("decision_id"),
                "turn_number": (plan.get("turn_input") or {}).get("turn_number"),
                "scene_id": (plan.get("turn_input") or {}).get("active_scene_id"),
                "npc_id": npc_id,
                "trigger": agency_move.get("reason"),
                "selected_move": agency_move,
                "investigator_id": investigator_id,
                "ts": ts,
            }
            events.append(record)
            _append_jsonl(logs / "npc-agency.jsonl", record)
            _append_jsonl(logs / "events.jsonl", record)
    return events


def _apply_npc_effects(
    campaign_dir: Path,
    plan: dict[str, Any],
    investigator_id: str,
    ts: str,
) -> list[dict[str, Any]]:
    """G3: land structured plan ``npc_effects`` on persistent NPC psych state.

    Effect shapes (structured only — Semantic Matcher Constitution):
    - {npc_id, field: trust|fear|suspicion, delta: int}       (numeric adjust)
    - {npc_id, kind: "record_fact", fact_id}
    - {npc_id, kind: "record_lie", lie_id, about?}
    - {npc_id, kind: "record_promise", promise_id, kept?}

    Idempotency comes from apply_plan's decision_id ledger (duplicate plans
    never reach this function).
    """
    logs = campaign_dir / "logs"
    events: list[dict[str, Any]] = []
    for effect in plan.get("npc_effects", []) or []:
        if not isinstance(effect, dict):
            continue
        npc_id = effect.get("npc_id")
        if not npc_id:
            continue
        kind = effect.get("kind") or "adjust"
        applied: dict[str, Any] | None = None
        if kind == "adjust" and effect.get("field") in coc_npc_state.NUMERIC_FIELDS:
            new_value = coc_npc_state.adjust(
                campaign_dir, str(npc_id), str(effect["field"]), int(effect.get("delta", 0) or 0)
            )
            applied = {"field": effect["field"], "delta": effect.get("delta"),
                       "new_value": new_value}
        elif kind == "record_fact" and effect.get("fact_id"):
            coc_npc_state.record_fact(campaign_dir, str(npc_id), str(effect["fact_id"]))
            applied = {"fact_id": effect["fact_id"]}
        elif kind == "record_lie" and effect.get("lie_id"):
            coc_npc_state.record_lie(
                campaign_dir, str(npc_id), str(effect["lie_id"]), about=effect.get("about")
            )
            applied = {"lie_id": effect["lie_id"], "about": effect.get("about")}
        elif kind == "record_promise" and effect.get("promise_id"):
            coc_npc_state.record_promise(
                campaign_dir, str(npc_id), str(effect["promise_id"]), kept=effect.get("kept")
            )
            applied = {"promise_id": effect["promise_id"], "kept": effect.get("kept")}
        if applied is None:
            continue
        record = {
            "schema_version": 1,
            "event_type": "npc_effect",
            "decision_id": plan.get("decision_id"),
            "npc_id": str(npc_id),
            "kind": kind,
            "effect": applied,
            "investigator_id": investigator_id,
            "ts": ts,
        }
        events.append(record)
        _append_jsonl(logs / "events.jsonl", record)
    return events


def _storylet_scheduler_debug_enabled(campaign_dir: Path | None = None) -> bool:
    """Return True when optional storylet-scheduler.jsonl writing is enabled.

    Default OFF: the log has no runtime readers. Enable via env
    ``COC_DEBUG_STORYLET_SCHEDULER=1`` (or true/yes/on), or campaign.json
    ``debug.storylet_scheduler_log: true``.
    """
    raw = str(os.environ.get("COC_DEBUG_STORYLET_SCHEDULER", "") or "").strip().lower()
    if raw in {"1", "true", "yes", "on"}:
        return True
    if raw in {"0", "false", "no", "off"}:
        return False
    if campaign_dir is not None:
        campaign = _read_json(Path(campaign_dir) / "campaign.json", {})
        debug = campaign.get("debug") if isinstance(campaign, dict) else None
        if isinstance(debug, dict) and debug.get("storylet_scheduler_log") is True:
            return True
    return False


def _storylet_scheduler_record(
    plan: dict[str, Any],
    investigator_id: str,
    ts: str,
) -> dict[str, Any] | None:
    """Build one audit record explaining storylet scheduler decisions."""
    moves = [m for m in plan.get("storylet_moves", []) if isinstance(m, dict)]
    first_trace = None
    for move in moves:
        trace = move.get("scheduler_trace")
        if isinstance(trace, dict):
            first_trace = trace
            break

    enrichment = plan.get("narrative_enrichment") or {}
    scheduler = enrichment.get("storylet_scheduler") or {}
    trigger = (
        (first_trace or {}).get("storylet_trigger")
        or enrichment.get("storylet_trigger")
        or (plan.get("narrative_directives") or {}).get("storylet_trigger")
    )
    story_need = (
        (first_trace or {}).get("story_need")
        or scheduler.get("story_need")
        or (moves[0].get("story_need") if moves else None)
    )
    if not first_trace and not trigger and not story_need and not moves:
        return None

    selected = (first_trace or {}).get("selected")
    if selected is None and moves:
        selected = {
            "storylet_id": moves[0].get("storylet_id"),
            "deck_id": moves[0].get("deck_id"),
            "family_id": moves[0].get("family_id"),
            "trope_id": moves[0].get("trope_id"),
        }

    return {
        "schema_version": 1,
        "event_type": "storylet_scheduler",
        "decision_id": plan.get("decision_id", "unknown"),
        "turn_number": (plan.get("turn_input") or {}).get("turn_number"),
        "scene_id": (plan.get("turn_input") or {}).get("active_scene_id"),
        "scene_action": plan.get("scene_action"),
        "investigator_id": investigator_id,
        "ts": ts,
        "storylet_trigger": trigger,
        "story_need": story_need,
        "candidate_decks": (first_trace or {}).get("candidate_decks") or scheduler.get("candidate_decks") or [],
        "candidate_counts": (first_trace or {}).get("candidate_counts", {}),
        "selected": selected,
        "rejected_examples": (first_trace or {}).get("rejected_examples", []),
        "ledger_update": (first_trace or {}).get("ledger_update") or (moves[0].get("ledger_update") if moves else {}),
    }


_TENSION_LADDER = ["low", "medium", "high", "climax"]
_SUCCESS_OUTCOMES = {"critical", "extreme", "hard", "regular", "success",
                     # legacy aliases (some callers may emit *_success forms)
                     "extreme_success", "hard_success", "regular_success"}
_FAILURE_OUTCOMES = {"failure", "fumble"}


def _bump_tension(current: str, delta: int) -> str:
    """Move tension level by delta steps, clamped to the ladder."""
    if current not in _TENSION_LADDER:
        current = "low"
    idx = _TENSION_LADDER.index(current) + delta
    idx = max(0, min(len(_TENSION_LADDER) - 1, idx))
    return _TENSION_LADDER[idx]


def _resolve_tension_steps(
    plan: dict[str, Any],
    pressure_moves: list[dict[str, Any]],
    action: str,
) -> int:
    """Resolve pacing tension steps for this apply.

    Primary signal is ``plan["tension_delta"]`` (director emits +/−). Ladder:
    low → medium → high → climax, clamped at both ends.

    - Negative plan delta cools and is never cancelled by pressure ticks.
    - Non-negative plan delta may gain extra escalation from pressure ticks.
    - Absent plan delta: legacy derive from pressure ticks / PRESSURE|SUBSYSTEM.
    """
    pressure_ticks = sum(int(m.get("tick", 0) or 0) for m in pressure_moves)
    if "tension_delta" in plan and plan.get("tension_delta") is not None:
        try:
            steps = int(plan["tension_delta"])
        except (TypeError, ValueError):
            steps = 0
        if steps < 0:
            return steps
        if pressure_ticks > 0:
            return steps + pressure_ticks
        if steps == 0 and action in ("PRESSURE", "SUBSYSTEM"):
            return 1
        return steps
    # Legacy path: no plan tension_delta — derive from pressure / action.
    if pressure_ticks or action in ("PRESSURE", "SUBSYSTEM"):
        return max(1, pressure_ticks)
    return 0


def _first_rule_result(rules_results: list[dict[str, Any]] | None) -> dict[str, Any] | None:
    if not rules_results:
        return None
    for result in rules_results:
        if isinstance(result, dict):
            return result
    return None


def _clue_gate_skill(plan: dict[str, Any]) -> str | None:
    policy = plan.get("clue_policy", {})
    if policy.get("skill"):
        return str(policy["skill"])
    for request in plan.get("rules_requests", []) or []:
        if not isinstance(request, dict):
            continue
        if request.get("reason") == "obscured clue in scene" and request.get("skill"):
            return str(request["skill"])
    return None


def _clue_gate_contract(plan: dict[str, Any]) -> dict[str, Any] | None:
    for request in plan.get("rules_requests", []) or []:
        if not isinstance(request, dict):
            continue
        contract = request.get("roll_contract")
        if not isinstance(contract, dict):
            continue
        if contract.get("failure_outcome_mode") == "clue_with_cost":
            return contract
        if request.get("reason") == "obscured clue in scene":
            return contract
    return None


def _contracts_match_clue_gate(expected: dict[str, Any], actual: dict[str, Any] | None) -> bool:
    if not isinstance(actual, dict):
        return False
    if actual.get("failure_outcome_mode") != "clue_with_cost":
        return False
    expected_group = expected.get("roll_density_group")
    actual_group = actual.get("roll_density_group")
    if expected_group or actual_group:
        return bool(expected_group and expected_group == actual_group)
    return True


def _rule_result_matches_clue_gate(plan: dict[str, Any], result: dict[str, Any]) -> bool:
    contract = _clue_gate_contract(plan)
    if contract is not None:
        return _contracts_match_clue_gate(contract, result.get("roll_contract"))
    skill = _clue_gate_skill(plan)
    if skill is None:
        return True
    return str(result.get("skill") or "") == skill


def _clue_gate_rule_result(
    plan: dict[str, Any],
    rules_results: list[dict[str, Any]] | None,
) -> dict[str, Any] | None:
    """Pick the roll result that should gate an obscured clue reveal.

    Narrative enrichment may add player action checks after the director's
    automatic obscured-clue check. If the player later succeeds with the same
    clue skill, that success should satisfy the clue gate instead of being
    masked by an earlier duplicate failure.
    """
    if not rules_results:
        return None
    candidates = [
        result for result in rules_results
        if isinstance(result, dict) and _rule_result_matches_clue_gate(plan, result)
    ]
    if not candidates:
        if _clue_gate_contract(plan) is not None:
            return None
        return _first_rule_result(rules_results)
    for result in candidates:
        if _rule_result_success(result) is True:
            return result
    for result in candidates:
        if _rule_result_success(result) is False:
            return result
    return candidates[0]


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


def _first_failed_contract_result(
    plan: dict[str, Any],
    rules_results: list[dict[str, Any]] | None,
) -> tuple[dict[str, Any], dict[str, Any]] | None:
    for result in rules_results or []:
        if not isinstance(result, dict):
            continue
        if _rule_result_success(result) is not False:
            continue
        contract = result.get("roll_contract")
        if not isinstance(contract, dict):
            for request in plan.get("rules_requests", []) or []:
                if not isinstance(request, dict):
                    continue
                if request.get("skill") == result.get("skill") and isinstance(request.get("roll_contract"), dict):
                    contract = request["roll_contract"]
                    break
        if not isinstance(contract, dict):
            continue
        # Clue-bonus failures are handled via clue_policy.bonus_cost; do not
        # treat them as generic goal failures that overshadow the core reveal.
        group = str(contract.get("roll_density_group") or "")
        if contract.get("failure_outcome_mode") == "bonus_with_cost" or group.startswith("clue-bonus:"):
            continue
        return result, contract
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


def _idea_roll_result(
    plan: dict[str, Any],
    rules_results: list[dict[str, Any]] | None,
) -> dict[str, Any] | None:
    """Return the Idea Roll result for a RECOVER plan, if any."""
    for result in rules_results or []:
        if not isinstance(result, dict):
            continue
        if result.get("kind") == "idea_roll":
            return result
    for request in plan.get("rules_requests", []) or []:
        if isinstance(request, dict) and request.get("kind") == "idea_roll":
            # Request present but no result yet.
            return None
    return None


def _clue_bonus_request(plan: dict[str, Any]) -> dict[str, Any] | None:
    for request in plan.get("rules_requests", []) or []:
        if not isinstance(request, dict):
            continue
        contract = request.get("roll_contract") or {}
        group = str(contract.get("roll_density_group") or "")
        if request.get("clue_bonus") or group.startswith("clue-bonus:"):
            return request
    return None


def _clue_bonus_rule_result(
    plan: dict[str, Any],
    rules_results: list[dict[str, Any]] | None,
) -> dict[str, Any] | None:
    request = _clue_bonus_request(plan)
    if request is None:
        return None
    expected_group = str((request.get("roll_contract") or {}).get("roll_density_group") or "")
    for result in rules_results or []:
        if not isinstance(result, dict):
            continue
        contract = result.get("roll_contract") or {}
        group = str(contract.get("roll_density_group") or "")
        if expected_group and group == expected_group:
            return result
        if result.get("clue_bonus") or (
            result.get("skill") == request.get("skill")
            and str(contract.get("failure_outcome_mode") or "") == "bonus_with_cost"
        ):
            return result
    return None


def _apply_clue_bonus_resolution(
    plan: dict[str, Any],
    rules_results: list[dict[str, Any]] | None,
    *,
    ts: str = "",
    investigator_id: str = "",
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Resolve non-gating clue bonus rolls into events + optional pressure.

    Returns (events, extra_pressure_moves). Never withholds the core clue.
    """
    events: list[dict[str, Any]] = []
    pressure: list[dict[str, Any]] = []
    request = _clue_bonus_request(plan)
    if request is None:
        return events, pressure
    bonus = (plan.get("clue_policy") or {}).get("bonus") or request.get("bonus") or {}
    if not isinstance(bonus, dict):
        bonus = {}
    result = _clue_bonus_rule_result(plan, rules_results)
    success = _rule_result_success(result)
    decision_id = plan.get("decision_id", "unknown")
    clue_id = request.get("clue_id") or ((plan.get("clue_policy") or {}).get("reveal") or [None])[0]
    if success is None:
        events.append({
            "event_type": "clue_bonus_pending",
            "decision_id": decision_id,
            "clue_id": clue_id,
            "investigator_id": investigator_id,
            "summary": "clue bonus roll held until rule result is backfilled",
            "ts": ts,
        })
        return events, pressure
    if success is True:
        extra = str(bonus.get("extra_summary") or "").strip()
        events.append({
            "event_type": "clue_bonus_reveal",
            "decision_id": decision_id,
            "clue_id": clue_id,
            "bonus_reveal": extra,
            "investigator_id": investigator_id,
            "summary": extra or "clue bonus detail revealed",
            "ts": ts,
        })
        return events, pressure

    cost = str(bonus.get("on_fail_cost") or "time")
    if cost not in {"time", "pressure"}:
        cost = "time"
    symptom = (
        "the extra detail slips away and the search costs time"
        if cost == "time"
        else "the failed probe raises the room's tension without hiding the core find"
    )
    pressure.append(_synthetic_pressure_move("clue_bonus_fail_cost", symptom))
    events.append({
        "event_type": "clue_bonus_cost",
        "decision_id": decision_id,
        "clue_id": clue_id,
        "bonus_cost": cost,
        "investigator_id": investigator_id,
        "summary": f"clue bonus failed; core clue kept; cost={cost}",
        "ts": ts,
    })
    return events, pressure


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
    idea_plan = (plan.get("narrative_directives") or {}).get("idea_roll_plan") or {}

    # The original ordinary failure has already settled its ordinary cost.
    # A confirmed pushed failure applies only the exact pre-announced
    # consequence emitted by _process_push_roll_gates; replaying the generic
    # clue-with-cost branch here would charge the initial failure twice.
    if isinstance(plan.get("push_continuation"), dict) and any(
        isinstance(result, dict)
        and result.get("pushed") is True
        and _rule_result_success(result) is False
        for result in (rules_results or [])
    ):
        return [], events, pressure

    # RECOVER is the Idea Roll recovery valve. Play always continues; the roll
    # (when required) decides cost/position, not whether the lead surfaces.
    if action == "RECOVER" and stalled >= 3 and fallback_ids:
        idea_result = _idea_roll_result(plan, rules_results)
        has_idea_request = any(
            isinstance(req, dict) and req.get("kind") == "idea_roll"
            for req in (plan.get("rules_requests") or [])
        )
        free_delivery = (
            idea_plan.get("difficulty") is None
            and str(idea_plan.get("signpost_level") or "unmentioned") == "unmentioned"
            and not has_idea_request
        )
        if has_idea_request and idea_result is None:
            events.append({
                "event_type": "clue_pending_rule_result",
                "decision_id": decision_id,
                "clue_ids": fallback_ids,
                "investigator_id": investigator_id,
                "summary": "Idea Roll recovery held until rule result is backfilled",
                "ts": ts,
            })
            return [], events, pressure

        success = True if free_delivery else _rule_result_success(idea_result)
        if success is True or free_delivery:
            events.append({
                "event_type": "idea_roll_recovery",
                "decision_id": decision_id,
                "clue_id": fallback_ids[0],
                "fallback_routes": fallback_ids,
                "investigator_id": investigator_id,
                "outcome": "free" if free_delivery else str((idea_result or {}).get("outcome", "success")),
                "summary": (
                    "never-signposted lead delivered free via Idea recovery"
                    if free_delivery
                    else "Idea Roll success surfaces the lead without increasing danger"
                ),
                "ts": ts,
            })
            bonus_events, bonus_pressure = _apply_clue_bonus_resolution(
                plan, rules_results, ts=ts, investigator_id=investigator_id
            )
            events.extend(bonus_events)
            pressure.extend(bonus_pressure)
            return [fallback_ids[0]], events, pressure

        # Failed Idea Roll: still surface the lead, but in a worse position.
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
            "outcome": str((idea_result or {}).get("outcome", "failure")),
            "summary": "Idea Roll failure surfaces the lead in the thick of it",
            "ts": ts,
        })
        bonus_events, bonus_pressure = _apply_clue_bonus_resolution(
            plan, rules_results, ts=ts, investigator_id=investigator_id
        )
        events.extend(bonus_events)
        pressure.extend(bonus_pressure)
        return [fallback_ids[0]], events, pressure

    # Obvious/direct clues remain immediate. Obscured clues with a rules_request
    # must wait for the actual roll result.
    if not _obscured_reveal_requires_result(plan):
        committed = reveal_ids
        bonus_events, bonus_pressure = _apply_clue_bonus_resolution(
            plan, rules_results, ts=ts, investigator_id=investigator_id
        )
        events.extend(bonus_events)
        pressure.extend(bonus_pressure)
        return committed, events, pressure

    result = _clue_gate_rule_result(plan, rules_results)
    success = _rule_result_success(result)
    if success is True:
        bonus_events, bonus_pressure = _apply_clue_bonus_resolution(
            plan, rules_results, ts=ts, investigator_id=investigator_id
        )
        events.extend(bonus_events)
        pressure.extend(bonus_pressure)
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
    clean_recovery_event: dict[str, Any] | None = None
    bonus_reveal: str | None = None
    bonus_cost: str | None = None
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
        elif etype == "idea_roll_recovery":
            clue_id = event.get("clue_id")
            recovered = [clue_id] if clue_id else []
            clean_recovery_event = event
        elif etype == "clue_bonus_reveal":
            bonus_reveal = str(event.get("bonus_reveal") or event.get("summary") or "")
        elif etype == "clue_bonus_cost":
            bonus_cost = str(event.get("bonus_cost") or "time")

    policy = resolved_plan.setdefault("clue_policy", {})
    if bonus_reveal:
        policy["bonus_reveal"] = bonus_reveal
        policy.pop("bonus_cost", None)
    if bonus_cost:
        policy["bonus_cost"] = bonus_cost
        policy.pop("bonus_reveal", None)

    resolved_plan["resolved_clue_policy"] = {
        "planned_reveals": planned_reveals,
        "committed_reveals": committed,
        "withheld_reveals": withheld,
        "fallback_recovered": recovered,
        "pending_rule_result": any(e.get("event_type") == "clue_pending_rule_result" for e in resolution_events),
        "extra_pressure_moves": extra_pressure,
        "bonus_reveal": bonus_reveal,
        "bonus_cost": bonus_cost,
    }

    directives = resolved_plan.setdefault("narrative_directives", {})
    if bonus_reveal:
        must_include = list(directives.get("must_include") or [])
        if bonus_reveal not in must_include:
            must_include.append(bonus_reveal)
        directives["must_include"] = must_include
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
    elif clean_recovery_event is not None:
        directives["failure_consequence"] = {
            "narration_mode": "recover_clean",
            "consequence_type": "fallback_route_surfaces",
            "severity": "regular",
            "fallback_routes": clean_recovery_event.get("fallback_routes", []),
            "costs": [],
            "must_not_claim": ["do not present this as a table-level hint"],
        }
    elif (failed_contract := _first_failed_contract_result(resolved_plan, resolved_results)) is not None:
        result, contract = failed_contract
        mode = contract.get("failure_outcome_mode", "goal_with_cost")
        directives["failure_consequence"] = {
            "narration_mode": mode,
            "goal": contract.get("goal"),
            "success_effect": contract.get("success_effect"),
            "failure_effect": contract.get("failure_effect"),
            "consequence_type": mode,
            "severity": "hard" if str(result.get("outcome")) == "fumble" else "regular",
            "costs": [mode],
            "roll_density_group": contract.get("roll_density_group"),
            "must_not_claim": list(contract.get("must_not") or ["do not narrate no progress on ordinary failure"]),
        }
    else:
        directives.pop("failure_consequence", None)

    return resolved_plan


def flush_pending_records(campaign_dir: Path, *, limit: int | None = None) -> dict[str, int]:
    """Flush queued fast-mode recorder batches into normal JSONL logs."""
    if coc_async_recorder is None:
        return {"flushed_files": 0, "flushed_entries": 0, "remaining_files": 0}
    return coc_async_recorder.flush_pending_records(campaign_dir, limit=limit)


def _director_exit_eval(
    condition,
    discovered,
    campaign_dir,
    save_dir,
    *,
    flags_set: set[str] | None = None,
):
    """Evaluate a scene exit_condition for apply-layer auto-advance.

    Delegates to ``coc_exit_conditions`` with the same semantics as
    ``coc_story_director._eval_exit``:

    - ``clue_discovered`` — clue id in the discovered set
    - ``clock_reaches`` — any (or named) threat clock's persisted
      ``current_segments`` >= threshold
    - ``flag_set`` — structured flag id present/truthy
    - ``always`` — unconditionally True
    - ``narrative`` — always False (wait for CUT / force_transition)

    Legacy string DSL forms are normalized inside coc_exit_conditions.
    """
    discovered_set = {str(c) for c in discovered}

    def clock_reached(clock_id: str | None, threshold: int) -> bool:
        if coc_threat_state is None or campaign_dir is None or save_dir is None:
            return False
        fronts_path = campaign_dir / "scenario" / "threat-fronts.json"
        fronts = _read_json(fronts_path, {}).get("fronts", [])
        for front in fronts:
            for clock in front.get("clocks", []):
                cid = str(clock.get("clock_id") or "")
                if not cid:
                    continue
                if clock_id and cid != str(clock_id):
                    continue
                if coc_threat_state.get_clock_segments(save_dir, cid) >= threshold:
                    return True
        return False

    return coc_exit_conditions.evaluate_exit_condition(
        condition,
        discovered_clue_ids=discovered_set,
        clock_reached=clock_reached,
        flags_set=flags_set,
    )


def _apply_scene_unlock_pass(
    campaign_dir: Path,
    save: Path,
    world: dict[str, Any],
    story: dict[str, Any],
    *,
    discovered: list[str],
    decision_id: str,
    investigator_id: str,
    ts: str,
    events: list[dict[str, Any]],
    logs: Path,
) -> list[str]:
    """Evaluate scene_edges unlock conditions; emit ``scene_unlocked`` events."""
    flags_doc = _read_json(save / "flags.json", {})
    flags_set = _truthy_flag_ids(flags_doc)

    def clock_reached(clock_id: str | None, threshold: int) -> bool:
        if coc_threat_state is None:
            return False
        fronts_path = campaign_dir / "scenario" / "threat-fronts.json"
        fronts = _read_json(fronts_path, {}).get("fronts", [])
        for front in fronts:
            for clock in front.get("clocks", []):
                cid = str(clock.get("clock_id") or "")
                if not cid:
                    continue
                if clock_id and cid != str(clock_id):
                    continue
                if coc_threat_state.get_clock_segments(save, cid) >= threshold:
                    return True
        return False

    newly = coc_scene_graph.evaluate_unlocks(
        story,
        world,
        discovered_clue_ids={str(c) for c in discovered},
        clock_reached=clock_reached,
        flags_set=flags_set,
    )
    added = coc_scene_graph.apply_unlocks_to_world(world, newly)
    for sid in added:
        ev = {
            "event_type": "scene_unlocked",
            "decision_id": decision_id,
            "to_scene": sid,
            "investigator_id": investigator_id,
            "ts": ts,
        }
        events.append(ev)
        _append_jsonl(logs / "events.jsonl", ev)
    return added


def _apply_ledger_path(save_dir: Path) -> Path:
    return save_dir / _APPLY_LEDGER_FILENAME


def _decision_already_applied(save_dir: Path, decision_id: str) -> bool:
    ledger = _read_json(_apply_ledger_path(save_dir), {"applied_decision_ids": []})
    ids = ledger.get("applied_decision_ids") or []
    return isinstance(ids, list) and decision_id in ids


def _record_applied_decision(save_dir: Path, decision_id: str) -> None:
    path = _apply_ledger_path(save_dir)
    ledger = _read_json(path, {"applied_decision_ids": []})
    ids = list(ledger.get("applied_decision_ids") or [])
    if decision_id not in ids:
        ids.append(decision_id)
    if len(ids) > _APPLY_LEDGER_CAP:
        ids = ids[-_APPLY_LEDGER_CAP:]
    _write_json(path, {"applied_decision_ids": ids})


# Keeper Rulebook p.83-85: a pushed roll may settle only when all three gate
# fields are explicitly True (changed method → foreshadowed consequence → confirm).
_PUSH_GATE_REQUIRED_FIELDS = (
    "method_changed",
    "consequence_announced",
    "player_confirmed",
)


def _push_gate_missing_fields(result: dict[str, Any]) -> list[str]:
    gate = result.get("push_gate")
    if not isinstance(gate, dict):
        return list(_PUSH_GATE_REQUIRED_FIELDS)
    return [field for field in _PUSH_GATE_REQUIRED_FIELDS if gate.get(field) is not True]


def _rules_result_is_failure(result: dict[str, Any]) -> bool:
    if result.get("success") is False:
        return True
    outcome = str(result.get("outcome") or "").strip().lower()
    return outcome in {"failure", "fumble"}


def _read_investigator_state(campaign_dir: Path, investigator_id: str) -> dict[str, Any]:
    path = Path(campaign_dir) / "save" / "investigator-state" / f"{investigator_id}.json"
    return _read_json(path, {})


def _process_push_roll_gates(
    campaign_dir: Path,
    rules_results: list[dict[str, Any]] | None,
    *,
    investigator_id: str,
    decision_id: str,
    ts: str,
) -> tuple[list[dict[str, Any]], bool]:
    """Enforce push-roll gate on rules_results; return (events, pushed_fail_pending).

    Incomplete gates are demoted to ordinary failures (``pushed`` cleared) and
    emit ``push_gate_violation``. Valid pushed failures set
    ``pushed_fail_pending`` for pacing and may flag ``delusion_consequence_allowed``
    during underlying insanity without an active bout (p.163).
    """
    events: list[dict[str, Any]] = []
    pushed_fail_pending = False
    inv_state: dict[str, Any] | None = None

    for result in rules_results or []:
        if not isinstance(result, dict) or result.get("pushed") is not True:
            continue
        missing = _push_gate_missing_fields(result)
        if missing:
            result["pushed"] = False
            result["push_gate_rejected"] = True
            events.append({
                "event_type": "push_gate_violation",
                "decision_id": decision_id,
                "investigator_id": investigator_id,
                "skill": result.get("skill"),
                "missing_gate_fields": missing,
                "summary": "pushed roll rejected: incomplete push_gate",
                "ts": ts,
            })
            continue
        outcome = "failure" if _rules_result_is_failure(result) else str(
            result.get("outcome") or "success"
        )
        if not coc_rule_signals.read_pushed_fail_pending(
            is_pushed=True, outcome=outcome,
        ):
            continue
        pushed_fail_pending = True
        fail_ev: dict[str, Any] = {
            "event_type": "pushed_roll_failure",
            "decision_id": decision_id,
            "investigator_id": investigator_id,
            "skill": result.get("skill"),
            "outcome": result.get("outcome"),
            "pushed_fail": True,
            "push_gate": dict(result.get("push_gate") or {}),
            "original_command_id": result.get("original_command_id"),
            "original_roll_id": result.get("original_roll_id"),
            "announced_consequence": _copy_jsonable(
                result.get("announced_consequence") or {}
            ),
            "source_command_id": result.get("source_command_id"),
            "ts": ts,
        }
        if inv_state is None:
            inv_state = _read_investigator_state(campaign_dir, investigator_id)
        underlying = bool(
            inv_state.get("temporary_insane") or inv_state.get("indefinite_insane")
        )
        bout_active = bool(inv_state.get("bout_active"))
        if underlying and not bout_active:
            fail_ev["delusion_consequence_allowed"] = True
        events.append(fail_ev)

    return events, pushed_fail_pending


def _apply_typed_push_consequences(
    campaign_dir: Path,
    investigator_id: str,
    push_events: list[dict[str, Any]],
    *,
    world: dict[str, Any],
    decision_id: str,
    ts: str,
) -> list[dict[str, Any]]:
    """Materialize closed-schema pushed-failure effects exactly once."""
    applied: list[dict[str, Any]] = []
    records = world.setdefault("pushed_consequences", [])
    if not isinstance(records, list):
        raise ValueError("world-state pushed_consequences must be a list")
    known = {
        str(row.get("source_command_id")) for row in records if isinstance(row, dict)
    }
    for failure in push_events:
        if failure.get("event_type") != "pushed_roll_failure":
            continue
        source_id = str(failure.get("source_command_id") or "")
        consequence = failure.get("announced_consequence")
        effect = consequence.get("effect") if isinstance(consequence, dict) else None
        summary = str(consequence.get("summary") or "") if isinstance(consequence, dict) else ""
        if not isinstance(effect, dict):
            continue
        kind = effect.get("kind")
        already_recorded = source_id in known
        if already_recorded and kind != "pressure_tick":
            continue
        record: dict[str, Any] = {
            "source_command_id": source_id,
            "decision_id": decision_id,
            "kind": kind,
            "summary": summary,
        }
        evidence: dict[str, Any] = {
            "event_type": "pushed_consequence_applied",
            "decision_id": decision_id,
            "investigator_id": investigator_id,
            "source_command_id": source_id,
            "effect_kind": kind,
            "consequence_summary": summary,
            "ts": ts,
        }
        if kind == "fictional_position":
            record["severity"] = effect.get("severity", "serious")
        elif kind == "condition":
            condition_id = str(effect["condition_id"])
            inv_path = campaign_dir / "save" / "investigator-state" / f"{investigator_id}.json"
            investigator = _read_investigator_state(campaign_dir, investigator_id)
            conditions = investigator.setdefault("conditions", [])
            if not isinstance(conditions, list):
                raise ValueError("investigator conditions must be a list")
            if condition_id not in conditions:
                conditions.append(condition_id)
            _write_json(inv_path, investigator)
            record["condition_id"] = condition_id
            evidence["condition_id"] = condition_id
        elif kind == "pressure_tick":
            clock_id = str(effect["clock_id"])
            ticks = int(effect["ticks"])
            clock_def = _lookup_clock_def(campaign_dir, clock_id)
            if coc_threat_state is None or clock_def is None:
                raise ValueError(f"unknown pushed-consequence threat clock: {clock_id}")
            total_segments = int(clock_def.get("segments", 0) or 0)
            if total_segments < 1:
                raise ValueError(f"invalid pushed-consequence threat clock: {clock_id}")
            coc_threat_state.apply_clock_effect_once(
                campaign_dir / "save",
                clock_id,
                total_segments,
                ticks=ticks,
                effect_id=f"pushed-consequence:{source_id}",
            )
            transition_receipt = coc_threat_state.get_clock_effect_receipt(
                campaign_dir / "save", f"pushed-consequence:{source_id}"
            )
            record.update({"clock_id": clock_id, "ticks": ticks})
            record["clock_transition"] = transition_receipt
            evidence.update({"clock_id": clock_id, "ticks": ticks})
            evidence["clock_transition"] = transition_receipt
        else:
            raise ValueError(f"unsupported pushed consequence effect kind: {kind!r}")
        if already_recorded:
            existing_record = next(
                row for row in records
                if isinstance(row, dict) and str(row.get("source_command_id")) == source_id
            )
            if existing_record.get("clock_transition") != record.get("clock_transition"):
                raise ValueError("world pushed-consequence receipt diverges from threat transition")
            continue
        records.append(record)
        known.add(source_id)
        applied.append(evidence)
    return applied


def _record_development_ticks(
    campaign_dir: Path,
    rules_results: list[dict[str, Any]] | None,
    *,
    investigator_id: str,
    decision_id: str,
    ts: str,
) -> list[dict[str, Any]]:
    """W2-2: land qualifying skill successes as development ticks (p.94).

    Aligns with playtest ``skill_check_earned`` payload shape so report/audit
    consumers see the same structured flag on apply-layer events.
    """
    events: list[dict[str, Any]] = []
    for result in rules_results or []:
        if not isinstance(result, dict):
            continue
        skill = str(result.get("skill") or "").strip()
        if not skill:
            continue
        tick = coc_development.record_skill_tick(
            campaign_dir, investigator_id, skill, result
        )
        if tick is None:
            continue
        # Mirror playtest roll payload: skill_check_earned boolean + skill/roll.
        result["skill_check_earned"] = True
        events.append({
            "event_type": "skill_check_earned",
            "skill_check_earned": True,
            "skill": skill,
            "roll": tick.get("roll", result.get("roll")),
            "decision_id": decision_id,
            "investigator_id": investigator_id,
            "summary": f"skill check earned: {skill}",
            "ts": ts,
        })
    return events


def apply_plan(
    campaign_dir: Path,
    plan: dict[str, Any],
    investigator_id: str,
    rules_results: list[dict[str, Any]] | None = None,
    recording_mode: str | None = None,
    recording_flush: str | None = None,
    rules_results_mode: str = "legacy",
) -> list[dict[str, Any]]:
    """Apply a DirectorPlan with sync or fast queued JSONL recording.

    Default sync mode preserves legacy behavior. Fast/minimal mode keeps save
    state updates synchronous but queues verbose JSONL records under
    logs/pending-turns for a recorder worker or later flush.

    Re-applying the same ``plan["decision_id"]`` is a structured no-op: the
    return stays a list of event dicts (uniform with every other path) whose
    single ``apply_skipped`` event carries the duplicate marker, so callers
    like run_live_turn can iterate it without a shape guard. No state is
    touched and nothing is appended to JSONL logs.
    """
    global _ACTIVE_JSONL_RECORDER

    decision_id = str(plan.get("decision_id", "unknown"))
    save_dir = Path(campaign_dir) / "save"
    if _decision_already_applied(save_dir, decision_id):
        return [{
            "event_type": "apply_skipped",
            "skipped": "duplicate_decision_id",
            "decision_id": decision_id,
        }]

    expected_commands = coc_subsystem_executor.commands_from_rules_requests(plan)
    settled_rule_results = coc_subsystem_executor.normalize_rule_results(
        rules_results,
        campaign_dir=campaign_dir,
        expected_commands=expected_commands,
        investigator_id=investigator_id,
        decision_id=decision_id,
        results_mode=rules_results_mode,
    )

    mode = "sync"
    flush_policy = "manual"
    recorder = None
    if coc_async_recorder is not None:
        mode = coc_async_recorder.resolve_recording_mode(plan, explicit=recording_mode)
        flush_policy = coc_async_recorder.resolve_recording_flush(plan, explicit=recording_flush)
        if mode != "sync":
            recorder = coc_async_recorder.JsonlRecorder(
                campaign_dir,
                mode=mode,
                decision_id=decision_id,
            )

    previous_recorder = _ACTIVE_JSONL_RECORDER
    _ACTIVE_JSONL_RECORDER = recorder
    try:
        events = _apply_plan_impl(
            campaign_dir,
            plan,
            investigator_id,
            settled_rule_results,
        )
        if recorder is not None:
            pending_batch = recorder.commit()
            if pending_batch is not None and flush_policy == "background":
                coc_async_recorder.spawn_background_flush(campaign_dir)
        return events
    finally:
        _ACTIVE_JSONL_RECORDER = previous_recorder


def _apply_plan_impl(
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
    decision_id = str(plan.get("decision_id", "unknown"))
    action = plan.get("scene_action", "")

    # 0. push-roll gate (Keeper Rulebook p.83-85) — demote incomplete pushed
    # results before clue/pressure consumers see them as settled pushes.
    push_events, pushed_fail_pending = _process_push_roll_gates(
        campaign_dir,
        rules_results,
        investigator_id=investigator_id,
        decision_id=decision_id,
        ts=ts,
    )
    for ev in push_events:
        events.append(ev)
        _append_jsonl(logs / "events.jsonl", ev)

    # 0b. development ticks (Keeper Rulebook p.94) — after push demotion so
    # luck/push bookkeeping on the result is settled before tick eligibility.
    for ev in _record_development_ticks(
        campaign_dir,
        rules_results,
        investigator_id=investigator_id,
        decision_id=decision_id,
        ts=ts,
    ):
        events.append(ev)
        _append_jsonl(logs / "events.jsonl", ev)

    # 1. clue reveal / fail-forward resolution
    world_path = save / "world-state.json"
    world = _read_json(world_path, {"discovered_clue_ids": []})
    for ev in _apply_typed_push_consequences(
        campaign_dir,
        investigator_id,
        push_events,
        world=world,
        decision_id=decision_id,
        ts=ts,
    ):
        events.append(ev)
        _append_jsonl(logs / "events.jsonl", ev)
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
            # P2-5: when the clue record carries a handout_asset_id, attach it
            # plus the resolved title/summary and a player_visible rendering
            # hint from index/handout-assets.json. No-op when the field is
            # absent (all current scenarios), keeping the event backward
            # compatible.
            handout_fields = _resolve_handout_for_clue(
                campaign_dir, _find_clue_record(campaign_dir, clue_id)
            )
            if handout_fields:
                ev.update(handout_fields)
            events.append(ev)
            _append_jsonl(logs / "events.jsonl", ev)
    world["discovered_clue_ids"] = discovered
    # Mark scene-level SAN triggers as fired (dedup: director won't re-request).
    fired = list(world.get("san_triggers_fired", []))
    for rr in (rules_results or []):
        tid = rr.get("san_trigger_id") if isinstance(rr, dict) else None
        if tid and tid not in fired:
            fired.append(tid)
            ev = {"event_type": "san_trigger_fired", "decision_id": decision_id,
                  "trigger_id": tid, "san_loss": rr.get("san_loss"),
                  "investigator_id": investigator_id, "ts": ts}
            events.append(ev)
            _append_jsonl(logs / "events.jsonl", ev)
    if fired:
        world["san_triggers_fired"] = fired
    # Idea Roll signpost bookkeeping: record which clues were offered as leads
    # (mentioned) or missed on an obscured check (obvious). Never downgrade.
    signpost_updates = _collect_signpost_updates(plan, resolution_events)
    if signpost_updates or isinstance(world.get("clue_signposts"), dict):
        world["clue_signposts"] = _merge_clue_signposts(world, signpost_updates)

    # R-3: ensure unlock/visit/history fields; evaluate scene_edges unlocks
    # after clue/flag-affecting events land (idempotent via unlocked set).
    story_graph_path_early = campaign_dir / "scenario" / "story-graph.json"
    story_early = (
        _read_json(story_graph_path_early, {"scenes": []})
        if story_graph_path_early.exists()
        else {"scenes": []}
    )
    coc_scene_graph.ensure_world_scene_fields(world, story_early)
    _apply_scene_unlock_pass(
        campaign_dir,
        save,
        world,
        story_early,
        discovered=discovered,
        decision_id=decision_id,
        investigator_id=investigator_id,
        ts=ts,
        events=events,
        logs=logs,
    )
    _write_json(world_path, world)

    # 1b. spoiler reveals — warning-gated Keeper-only disclosures.
    # The director's clue_policy.withhold keeps keeper_secrets private; a
    # spoiler_reveal is the rare opposite: a secret the player explicitly
    # requested and confirmed after a warning. We mirror the playtest harness
    # record shape (coc_playtest_harness.py:4075) into logs/audit.jsonl so the
    # live path records the same Keeper-only reveal evidence the harness does,
    # and populate save/flags.json's spoiler_reveals list (previously a dead
    # field initialized by coc_state but never written).
    for spec in plan.get("spoiler_reveals", []) or []:
        if not isinstance(spec, dict):
            continue
        spoiler_id = spec.get("spoiler_id") or spec.get("secret_id") or "spoiler"
        audit_record = {
            "type": "spoiler_reveal",
            "spoiler_id": spoiler_id,
            "keeper_secret_id": spec.get("keeper_secret_id"),
            "scope": spec.get("scope"),
            "confirmed": bool(spec.get("confirmed", True)),
            "payload": spec.get("payload", {}) or {},
            "decision_id": decision_id,
            "investigator_id": investigator_id,
            "ts": ts,
        }
        _append_jsonl(logs / "audit.jsonl", audit_record)
        # surface a parallel event so consumers reading events.jsonl see the
        # reveal alongside clue_reveal / scene events.
        ev = {
            "event_type": "spoiler_reveal", "decision_id": decision_id,
            "spoiler_id": spoiler_id,
            "keeper_secret_id": spec.get("keeper_secret_id"),
            "scope": spec.get("scope"), "confirmed": audit_record["confirmed"],
            "summary": (spec.get("payload") or {}).get("summary", ""),
            "investigator_id": investigator_id, "ts": ts,
        }
        events.append(ev)
        _append_jsonl(logs / "events.jsonl", ev)
        # record in flags.json so resume/UI can see prior spoiler disclosures.
        flags_path = save / "flags.json"
        flags = _read_json(flags_path, {
            "schema_version": 1, "campaign_id": campaign_dir.name,
            "clues_found": {}, "decisions": [], "spoiler_reveals": [],
        })
        reveals = list(flags.get("spoiler_reveals", []))
        reveals.append({
            "spoiler_id": spoiler_id,
            "keeper_secret_id": spec.get("keeper_secret_id"),
            "scope": spec.get("scope"),
            "confirmed": audit_record["confirmed"],
            "decision_id": decision_id, "ts": ts,
        })
        flags["spoiler_reveals"] = reveals
        _write_json(flags_path, flags)

    # 2. NPC state writes + agency audit
    npc_events = _apply_npc_state_and_agency(campaign_dir, plan, investigator_id, ts)
    events.extend(npc_events)

    # 2b. G3: structured npc_effects -> persistent NPC psychological state
    events.extend(_apply_npc_effects(campaign_dir, plan, investigator_id, ts))

    # 3. pressure moves -> pacing state + events
    pacing_path = save / "pacing-state.json"
    pacing = _read_json(pacing_path, {"tension_level": "low", "turn_number": 0})
    pressure_moves = [*plan.get("pressure_moves", []), *extra_pressure]
    tension_steps = _resolve_tension_steps(plan, pressure_moves, action)
    if tension_steps:
        pacing["tension_level"] = _bump_tension(
            pacing.get("tension_level", "low"), tension_steps
        )
    pacing["turn_number"] = int(pacing.get("turn_number", 0)) + 1
    # track recent intent classes for stall detection (capped at last 5)
    recent = list(pacing.get("recent_intent_classes", []))
    recent_tags = list(pacing.get("recent_intent_tags", []))
    turn_input = plan.get("turn_input", {}) or {}
    intent_class = str(turn_input.get("player_intent_class", "") or "")
    rich = turn_input.get("player_intent_rich") or {}
    turn_tags = list(rich.get("secondary_intents") or []) if isinstance(rich, dict) else []
    if intent_class:
        recent.append(intent_class)
        recent_tags.append([str(t) for t in turn_tags])
        if len(recent) > 5:
            recent = recent[-5:]
            recent_tags = recent_tags[-5:]
    pacing["recent_intent_classes"] = recent
    pacing["recent_intent_tags"] = recent_tags
    # carry horror stage from plan into pacing for next-turn director read
    horror = plan.get("narrative_directives", {}).get("horror_escalation_stage")
    if horror:
        pacing["horror_stage"] = horror
    # W2-3: one-shot pushed-fail flag. Clear when this plan's context already
    # consumed it (rule_signals.pushed_fail_pending), then re-set if *this*
    # apply also produced a new legal pushed failure. Duplicate decision_ids
    # never reach here (apply ledger), so the clear is idempotent per decision.
    if (plan.get("rule_signals") or {}).get("pushed_fail_pending"):
        pacing["pushed_fail_pending"] = False
    if pushed_fail_pending:
        pacing["pushed_fail_pending"] = True

    # W2-7 Fair Warning (p.209): landing a fair_warning directive increments
    # lethal_chances_used. Idempotent per decision_id via the apply ledger
    # (duplicate plans never reach this write path).
    fair_warning = (plan.get("narrative_directives") or {}).get("fair_warning")
    if isinstance(fair_warning, dict):
        used = int(pacing.get("lethal_chances_used", 0) or 0)
        pacing["lethal_chances_used"] = used + 1
        fw_ev = {
            "event_type": "fair_warning",
            "decision_id": decision_id,
            "warning_number": fair_warning.get("warning_number", used + 1),
            "remaining": fair_warning.get("remaining", max(0, 3 - used - 1)),
            "lethal_chances_used": pacing["lethal_chances_used"],
            "investigator_id": investigator_id,
            "rule_ref": "core.pacing.fair_warning",
            "ts": ts,
        }
        events.append(fw_ev)
        _append_jsonl(logs / "events.jsonl", fw_ev)

    _write_json(pacing_path, pacing)
    for pressure_index, move in enumerate(pressure_moves):
        ev = {"event_type": "pressure_tick", "decision_id": decision_id,
              "clock_id": move.get("clock_id"), "visible_symptom": move.get("visible_symptom"),
              "reason": move.get("reason"),
              "investigator_id": investigator_id, "ts": ts}
        events.append(ev)
        _append_jsonl(logs / "events.jsonl", ev)
        # Persist clock progress + detect on_full (closes the gap where
        # current_segments was read but never written).
        clock_id = move.get("clock_id")
        if clock_id and int(move.get("tick", 0) or 0) > 0 and coc_threat_state is not None:
            clock_def = _lookup_clock_def(campaign_dir, clock_id)
            segments = int(clock_def.get("segments", 6)) if clock_def else 6
            became_full = coc_threat_state.tick_clock(
                save, clock_id, segments,
                source_id=f"director:{decision_id}:pressure:{pressure_index}:{clock_id}",
            )
            if became_full and clock_def:
                full_ev = {
                    "event_type": "clock_full", "decision_id": decision_id,
                    "clock_id": clock_id,
                    "on_full": clock_def.get("on_full", ""),
                    "investigator_id": investigator_id, "ts": ts,
                }
                events.append(full_ev)
                _append_jsonl(logs / "events.jsonl", full_ev)

    # 4. storylet ledger/events -> anti-repeat state for future enrichment.
    storylet_moves = [m for m in plan.get("storylet_moves", []) if isinstance(m, dict)]
    if storylet_moves:
        ledger_path = save / "storylet-ledger.json"
        ledger = _read_json(ledger_path, {})
        for move in storylet_moves:
            update = move.get("ledger_update")
            if isinstance(update, dict):
                ledger = update
            ev = {
                "event_type": "storylet_move",
                "decision_id": decision_id,
                "storylet_id": move.get("storylet_id"),
                "family_id": move.get("family_id"),
                "trope_id": move.get("trope_id"),
                "title": move.get("title"),
                "cue": move.get("cue"),
                "beat": move.get("beat"),
                "conflict_level": move.get("conflict_level"),
                "target_conflict_level": move.get("target_conflict_level"),
                "bound_entities": move.get("bound_entities", {}),
                "rolled_variants": move.get("rolled_variants", {}),
                "serves": move.get("serves", []),
                "investigator_id": investigator_id,
                "ts": ts,
            }
            events.append(ev)
            _append_jsonl(logs / "events.jsonl", ev)
        _write_json(ledger_path, ledger)

    scheduler_record = _storylet_scheduler_record(plan, investigator_id, ts)
    if scheduler_record is not None and _storylet_scheduler_debug_enabled(campaign_dir):
        _append_jsonl(logs / "storylet-scheduler.jsonl", scheduler_record)

    scene_progress = (plan.get("narrative_directives") or {}).get("scene_progress")
    if isinstance(scene_progress, dict):
        progress_record = {
            "schema_version": 1,
            "event_type": "scene_progress_directive",
            "decision_id": decision_id,
            "turn_number": (plan.get("turn_input") or {}).get("turn_number"),
            "scene_id": (plan.get("turn_input") or {}).get("active_scene_id"),
            "scene_action": action,
            "investigator_id": investigator_id,
            "ts": ts,
            **scene_progress,
        }
        events.append(progress_record)
        _append_jsonl(logs / "scene-progress.jsonl", progress_record)
        _append_jsonl(logs / "events.jsonl", progress_record)

    # 5. time advance -> world clock + triggers (coc_time layer)
    if coc_time is not None:
        time_events = coc_time.apply_time_advance_from_plan(
            campaign_dir, plan, investigator_id
        )
        events.extend(time_events)
        for ev in time_events:
            _append_jsonl(logs / "events.jsonl", ev)

    # 6. memory writes -> cards
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

    # 7. scene transition — advance when current scene is exhausted, plan CUTs,
    # or scene-progress governance explicitly forces a transition/montage.
    # "Exhausted" means all available_clues are discovered AND the scene's
    # exit_conditions are satisfiable: machine-checkable exit_conditions
    # must hold; narrative exit_conditions block clue-reveal auto-advance
    # until an explicit CUT / force_transition. Targets come from the scene
    # graph (R-3): only unlocked, non-exhausted edge destinations. CUT is
    # cinematic travel among already-unlocked targets — never an unlock.
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
            elif isinstance(scene_progress, dict) and scene_progress.get("action") == "force_transition":
                should_advance = True
            elif available and all(c in discovered for c in available):
                # Clue exhaustion alone is not a scene goal met: a scene with a
                # *narrative* exit_condition that _director_exit_eval can't
                # machine-check must NOT auto-advance on clue reveal — it waits
                # for an explicit CUT / force_transition. Only scenes whose
                # exit_conditions are empty or machine-checkable & satisfied
                # advance.
                flags_set = _truthy_flag_ids(_read_json(save / "flags.json", {}))
                exit_conditions = current_scene.get("exit_conditions", [])
                exit_met = (
                    not exit_conditions
                    or any(
                        _director_exit_eval(
                            e, discovered, campaign_dir, save, flags_set=flags_set
                        )
                        for e in exit_conditions
                    )
                )
                should_advance = exit_met
            if should_advance:
                requested = plan.get("transition_to")
                if not requested and isinstance(scene_progress, dict):
                    requested = scene_progress.get("to_scene")
                next_id = coc_scene_graph.pick_transition_target(
                    current_scene_id,
                    story,
                    world,
                    requested=str(requested) if requested else None,
                    discovered_clue_ids={str(c) for c in discovered},
                )
                if next_id:
                    next_scene = next(
                        (s for s in scenes if s.get("scene_id") == next_id),
                        None,
                    )
                    if next_scene is not None:
                        coc_scene_graph.record_scene_enter(
                            world,
                            next_id,
                            decision_id=decision_id,
                            ts=ts,
                            mark_previous_exhausted=str(current_scene_id)
                            if current_scene_id
                            else None,
                        )
                        world["active_scene_id"] = next_id
                        _write_json(world_path, world)
                        ev = {
                            "event_type": "scene_transition",
                            "decision_id": decision_id,
                            "from_scene": current_scene_id,
                            "to_scene": next_id,
                            "investigator_id": investigator_id,
                            "ts": ts,
                        }
                        events.append(ev)
                        _append_jsonl(logs / "events.jsonl", ev)
                        _apply_scene_on_enter(
                            campaign_dir,
                            next_scene,
                            decision_id,
                            investigator_id,
                            ts,
                            events,
                            logs,
                        )

    # 7b. session ending — PAYOFF on a terminal story-graph scene (W1-6 / p.212-213).
    # Re-read world in case a prior step advanced active_scene_id; terminal
    # detection uses only structured scene fields (see module docstring).
    world = _read_json(world_path, world)
    ending_ev = _maybe_emit_session_ending(
        campaign_dir,
        plan,
        world=world,
        investigator_id=investigator_id,
        decision_id=decision_id,
        ts=ts,
    )
    if ending_ev is not None:
        events.append(ending_ev)
        _append_jsonl(logs / "events.jsonl", ending_ev)
        # R1-Z E5: bump storylet ledger session_number so max_per_session resets.
        try:
            coc_storylets = _load_sibling("coc_storylets", "coc_storylets.py")
            coc_storylets.start_new_session(campaign_dir)
        except Exception:
            pass

    # 8. always emit a turn event if nothing else did
    if not events:
        ev = {"event_type": "turn", "decision_id": decision_id, "action": action,
              "investigator_id": investigator_id, "ts": ts}
        events.append(ev)
        _append_jsonl(logs / "events.jsonl", ev)

    # 9. idempotency ledger — record after a successful apply so retries no-op.
    _record_applied_decision(save, decision_id)

    return events
