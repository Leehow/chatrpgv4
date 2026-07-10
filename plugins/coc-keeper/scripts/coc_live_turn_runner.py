#!/usr/bin/env python3
"""Live Keeper turn runner.

This is the live-play entrypoint that keeps human table play on the same rails
as the tested director stack:

player input -> Story Director -> narrative enrichment -> rules -> backfill ->
apply/save/logs.

It also owns two live-only policies that should not depend on the main model's
memory during chat:

* default fast/background recording for JSONL audit logs;
* compressed auto-advance for low-agency continuation until a real interrupt.
"""
from __future__ import annotations

import json
import random
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


director = _load_sibling("coc_story_director", "coc_story_director.py")
apply_mod = _load_sibling("coc_director_apply", "coc_director_apply.py")
narrative_enrichment = _load_sibling("coc_narrative_enrichment", "coc_narrative_enrichment.py")
narration_contract = _load_sibling("coc_narration_contract", "coc_narration_contract.py")
playtest_driver = _load_sibling("coc_playtest_driver", "coc_playtest_driver.py")
subsystem_executor = _load_sibling(
    "coc_subsystem_executor_live_turn",
    "coc_subsystem_executor.py",
)
coc_async_recorder = _load_sibling("coc_async_recorder", "coc_async_recorder.py")
coc_intent_router = _load_sibling("coc_intent_router", "coc_intent_router.py")
coc_fileio = _load_sibling("coc_fileio", "coc_fileio.py")


_INTERRUPT_EVENT_TYPES = {
    "scene_transition",
    "pressure_tick",
    "clock_full",
    "clue_reveal",
    "fail_forward_recovery",
    "idea_roll_recovery",
    "clue_withheld",
    "failure_consequence",
    "san_trigger_fired",
    "storylet_move",
}

_NON_BLOCKING_RULE_REQUEST_KINDS = {
    "npc_assist",
}

_ACTIVE_SCENE_STATE_PATCH_KEYS = {
    "scene_id",
    "scene_type",
    "scene_tags",
    "dramatic_question",
    "summary",
    "visible_affordances",
    "pressure_moves",
    "npc_ids",
    "authority_demands",
    "responsibility_threats",
    "pending_choices",
    "source_event_type",
    "time_profile",
}

def _read_json(path: Path, fallback: Any) -> Any:
    if not path.exists():
        return fallback
    return json.loads(path.read_text(encoding="utf-8"))


def _write_json(path: Path, payload: Any) -> None:
    coc_fileio.write_json_atomic(
        path, payload, indent=2, ensure_ascii=False, trailing_newline=True
    )


def _append_jsonl_sync(path: Path, record: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False) + "\n")


def _pending_record_count(campaign_dir: Path) -> int:
    return coc_async_recorder.pending_record_count(campaign_dir)


def _resolve_turn_intent(
    campaign_dir: Path,
    player_text: str,
    intent_class: str | None,
    player_intent_rich: dict[str, Any] | None,
) -> tuple[str, dict[str, Any] | None, dict[str, Any]]:
    """Resolve the turn's semantic intent (Semantic Matcher Constitution).

    Priority:
    1. Caller-supplied ``intent_class`` / ``player_intent_rich`` (the host LLM
       is itself the semantic evaluator in ordinary live play).
    2. The intent router (``coc_intent_router.parse_intent``): machine
       carve-outs (empty → idle, leading ``[`` → meta) plus the installed
       semantic evaluator, with request/result artifacts scoped under the
       campaign's ``logs/intent-eval/``.
    3. If no semantic evidence is available (evaluator artifact missing), the
       intent degrades to ``"ambiguous"`` — an honest unknown. It must NEVER
       silently default to ``"investigate"``; that would be a hardcoded
       meaning judgment the runner has no evidence for.

    Returns ``(intent_class, player_intent_rich, intent_resolution)`` where
    ``intent_resolution`` is an audit record of how the intent was obtained.
    """
    if intent_class:
        return (
            str(intent_class),
            player_intent_rich,
            {"source": "caller_intent_class", "intent_class": str(intent_class)},
        )
    rich_primary = (player_intent_rich or {}).get("primary_intent")
    if rich_primary:
        return (
            str(rich_primary),
            player_intent_rich,
            {"source": "caller_intent_rich", "intent_class": str(rich_primary)},
        )

    active_scene = _read_json(campaign_dir / "save" / "active-scene.json", {})
    evaluator = None
    if getattr(coc_intent_router, "_DEFAULT_EVALUATOR", None) is None:
        evaluator = coc_intent_router.LLMIntentEvaluator(
            artifacts_dir=campaign_dir / "logs" / "intent-eval",
        )
    try:
        parsed = coc_intent_router.parse_intent(
            player_text,
            active_scene if isinstance(active_scene, dict) else None,
            evaluator=evaluator,
        )
    except coc_intent_router.IntentEvalError as exc:
        return (
            "ambiguous",
            player_intent_rich,
            {
                "source": "unresolved_default_ambiguous",
                "intent_class": "ambiguous",
                "error": str(exc),
                "note": (
                    "no semantic intent evidence; caller should pass "
                    "intent_class/player_intent_rich or provide an intent "
                    "evaluator result artifact"
                ),
            },
        )
    return (
        str(parsed.get("primary_intent") or "ambiguous"),
        parsed,
        {
            "source": "intent_router",
            "intent_class": str(parsed.get("primary_intent") or "ambiguous"),
        },
    )


def _next_live_decision_number(campaign_dir: Path) -> int:
    """Choose a turn number that remains monotonic even before fast logs flush."""
    from_logs = int(playtest_driver._next_decision_number(campaign_dir))
    pacing = _read_json(campaign_dir / "save" / "pacing-state.json", {})
    try:
        from_pacing = int(pacing.get("turn_number", 0)) + 1
    except (TypeError, ValueError):
        from_pacing = 1
    return max(from_logs, from_pacing, 1)


def _copy_jsonable(value: Any) -> Any:
    return json.loads(json.dumps(value, ensure_ascii=False))


def _recording_defaults(plan: dict[str, Any], mode: str, flush_policy: str) -> None:
    directives = plan.setdefault("narrative_directives", {})
    directives["recording_mode"] = mode
    directives["recording_flush"] = flush_policy


def _new_rules_recorder(campaign_dir: Path, mode: str, decision_id: str):
    if mode == "sync":
        return None
    return coc_async_recorder.JsonlRecorder(
        campaign_dir,
        mode=mode,
        decision_id=f"{decision_id}-rules",
    )


def _commit_rules_recorder(recorder: Any | None) -> Path | None:
    if recorder is None:
        return None
    return recorder.commit()


def _blocking_rule_requests(turn: dict[str, Any]) -> list[dict[str, Any]]:
    requests = turn.get("rules_requests") or []
    if not isinstance(requests, list):
        return []
    blocking: list[dict[str, Any]] = []
    for request in requests:
        if not isinstance(request, dict):
            continue
        if str(request.get("kind") or "") in _NON_BLOCKING_RULE_REQUEST_KINDS:
            continue
        blocking.append(request)
    return blocking


def _apply_state_patch_sync(
    campaign_dir: Path,
    state_patch: dict[str, Any] | None,
    *,
    investigator_id: str,
    decision_ids: list[str],
) -> dict[str, Any]:
    """Synchronously persist only the next-turn visible scene contract."""
    if not isinstance(state_patch, dict) or not state_patch:
        return {"applied": False}

    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    active_path = campaign_dir / "save" / "active-scene.json"
    active_scene = _read_json(active_path, {})
    if not isinstance(active_scene, dict):
        active_scene = {}

    active_scene.setdefault("schema_version", 1)
    world = _read_json(campaign_dir / "save" / "world-state.json", {})
    if isinstance(world, dict):
        if world.get("campaign_id"):
            active_scene.setdefault("campaign_id", world.get("campaign_id"))
        if world.get("scenario_id"):
            active_scene.setdefault("scenario_id", world.get("scenario_id"))

    previous_scene_id = str(
        active_scene.get("scene_id")
        or (world.get("active_scene_id") if isinstance(world, dict) else "")
        or ""
    ).strip()
    incoming_scene_id = str(state_patch.get("scene_id") or "").strip()
    if incoming_scene_id and previous_scene_id and incoming_scene_id != previous_scene_id:
        active_scene.pop("time_profile", None)

    minimal_keys: list[str] = []
    validation_warnings: list[dict[str, str]] = []
    for key in sorted(_ACTIVE_SCENE_STATE_PATCH_KEYS):
        if key not in state_patch:
            continue
        value = state_patch[key]
        if key == "time_profile":
            if value is None:
                active_scene.pop("time_profile", None)
                minimal_keys.append(key)
                continue
            value, reason_code = director._validate_time_profile(value)
            if value is None:
                validation_warnings.append({
                    "field": "time_profile",
                    "reason_code": str(reason_code),
                })
                continue
        active_scene[key] = _copy_jsonable(value)
        minimal_keys.append(key)

    active_scene.setdefault("source_event_type", "live_turn_state_patch")
    active_scene["updated_at"] = now
    active_scene["updated_by"] = "coc_live_turn_runner.state_patch"
    active_scene["last_decision_ids"] = list(decision_ids)
    active_scene["investigator_id"] = investigator_id
    _write_json(active_path, active_scene)

    scene_id = state_patch.get("scene_id")
    world_updated = False
    if isinstance(world, dict) and isinstance(scene_id, str) and scene_id.strip():
        world["active_scene_id"] = scene_id.strip()
        world["updated_at"] = now
        _write_json(campaign_dir / "save" / "world-state.json", world)
        world_updated = True

    return {
        "applied": True,
        "active_scene_path": str(active_path),
        "world_active_scene_updated": world_updated,
        "minimal_keys": minimal_keys,
        "validation_warnings": validation_warnings,
        "detail_record_deferred": False,
        "detail_pending_batch": None,
    }


def _queue_state_patch_detail(
    campaign_dir: Path,
    state_patch: dict[str, Any] | None,
    *,
    investigator_id: str,
    decision_ids: list[str],
    recording_mode: str,
) -> dict[str, Any]:
    if not isinstance(state_patch, dict) or not state_patch:
        return {"queued": False, "deferred": False, "pending_batch": None}

    record = {
        "schema_version": 1,
        "event_type": "scene_state_patch",
        "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "investigator_id": investigator_id,
        "decision_ids": list(decision_ids),
        "scene_id": state_patch.get("scene_id"),
        "minimal_keys": [
            key for key in sorted(_ACTIVE_SCENE_STATE_PATCH_KEYS)
            if key in state_patch
        ],
        "state_patch": _copy_jsonable(state_patch),
    }
    if recording_mode == "sync":
        _append_jsonl_sync(campaign_dir / "logs" / "scene-state-patches.jsonl", record)
        return {"queued": True, "deferred": False, "pending_batch": None}

    recorder = coc_async_recorder.JsonlRecorder(
        campaign_dir,
        mode=recording_mode,
        decision_id=f"{decision_ids[-1] if decision_ids else 'turn'}-state-patch",
    )
    recorder.append_jsonl(campaign_dir / "logs" / "scene-state-patches.jsonl", record)
    pending = recorder.commit()
    return {
        "queued": pending is not None,
        "deferred": pending is not None,
        "pending_batch": str(pending) if pending is not None else None,
    }


def _semantic_low_agency_choice(choice: dict[str, Any]) -> dict[str, Any]:
    """Build the next automatic continuation from structured intent tags.

    This does not classify prose. It preserves the semantic posture already
    supplied by the caller/intent router and marks the next internal turn as an
    automatic continuation of that posture.
    """
    next_choice = _copy_jsonable(choice)
    next_choice["player_text"] = (
        "继续执行玩家刚才的低主动姿态，直到出现新的威胁、信息、检定或选择点。"
    )
    next_choice["auto_advanced"] = True
    rich = next_choice.get("player_intent_rich")
    if not isinstance(rich, dict):
        rich = {}
        next_choice["player_intent_rich"] = rich
    rich.setdefault("primary_intent", next_choice.get("intent_class") or "continue")
    secondary = list(rich.get("secondary_intents") or [])
    for tag in ("low_agency_continue", "continue_existing_strategy", "yield_initiative"):
        if tag not in secondary:
            secondary.append(tag)
    rich["secondary_intents"] = secondary
    rich.setdefault("action_atoms", [])
    rich["explicit_roll_request"] = bool(rich.get("explicit_roll_request", False))
    return next_choice


def _action_atom_signatures(rich: dict[str, Any] | None) -> list[tuple[str, str]]:
    """P1-3: extract ``(skill, kind)`` signatures from a turn's action_atoms.

    Used to track which PLAYER actions repeat across turns within a single
    auto-advance loop. The signature mirrors ``build_action_chain_requests``:
    only rollable atoms (those that would become a rule request) seed a
    signature, so narration-only atoms never pollute the cross-turn window.

    Cross-invocation persistence is intentionally out of scope: callers reset
    the window per player input.
    """
    if not isinstance(rich, dict):
        return []
    signatures: list[tuple[str, str]] = []
    helper = getattr(narrative_enrichment, "_atom_signature", None)
    infer_kind = getattr(narrative_enrichment, "_infer_request_kind", None)
    if helper is None or infer_kind is None:
        return signatures
    for atom in (rich.get("action_atoms") or []):
        if not isinstance(atom, dict):
            continue
        if atom.get("requires_roll") is False:
            continue
        skill = atom.get("skill") or atom.get("roll_skill")
        skill_text = narrative_enrichment._non_empty_str(skill) if skill else None
        if not skill_text and not atom.get("kind"):
            continue
        kind = infer_kind(atom, skill_text)
        sig = helper(skill_text, kind)
        if sig is not None:
            signatures.append(sig)
    return signatures


def _npc_move_requires_player_decision(npc_moves: list[dict[str, Any]] | None) -> bool:
    """P0-2c: only an NPC move explicitly marked requires_player_decision
    interrupts. npc_assist/react and other non-decisional moves do not."""
    for move in (npc_moves or []):
        if not isinstance(move, dict):
            continue
        if move.get("requires_player_decision"):
            return True
        for sub in (move.get("agency_moves") or []):
            if isinstance(sub, dict) and sub.get("requires_player_decision"):
                return True
    return False


def _turn_interrupt_reason(turn: dict[str, Any]) -> str | None:
    if isinstance(turn.get("pending_choice"), dict):
        return "pending_subsystem_choice"
    if turn.get("scene_transition"):
        return "scene_arrival_or_transition"
    event_types = set(turn.get("event_types") or [])
    if event_types & _INTERRUPT_EVENT_TYPES:
        if "pressure_tick" in event_types or "clock_full" in event_types:
            return "threat_approaches"
        if "scene_transition" in event_types:
            return "scene_arrival_or_transition"
        return "meaningful_interrupt"
    if _blocking_rule_requests(turn):
        return "risk_requires_roll"
    if turn.get("clue_revealed"):
        return "new_clue_or_obvious_information"
    choice_frame = turn.get("choice_frame") or {}
    # P0-2c: 只在真分叉（director 基于 route.status 结构化判定）时停交选择，
    # 不再用 route_count>=2 的结构数量硬判停——那与玩家是否真面临抉择无关。
    if bool(choice_frame.get("is_real_fork")):
        return "meaningful_choice"
    # P0-2c: npc_moves 只对带 requires_player_decision 标记的 move 判停；
    # npc_assist/react 等非决策性 move 不应让"跟着班长"类低主动输入停。
    if _npc_move_requires_player_decision(turn.get("npc_moves")):
        return "npc_requests_specialist_judgment"

    progress = (turn.get("narrative_directives") or {}).get("dramatic_progress") or {}
    current_interrupts = progress.get("current_interrupts") or []
    if current_interrupts:
        if "threat_approaches" in current_interrupts:
            return "threat_approaches"
        if "scene_arrival_or_transition" in current_interrupts:
            return "scene_arrival_or_transition"
        return "meaningful_interrupt"
    return None


def _turn_has_actionable_content(turn: dict[str, Any]) -> bool:
    """P1-2: conservative check for whether a turn gives the player anything to act on.

    True when the turn carries any structured handle the player could respond to:
    a real fork, an exposed clue, at least one route in the choice frame, or an
    NPC move that requires the player's decision. This mirrors the structured
    fields already consulted by ``_turn_interrupt_reason`` (it does NOT re-scan
    prose or rebuild ``stop_actionability``, which is assembled post-loop).

    Conservative by design: when the structured fields are ambiguous or missing
    it returns True (treat as content → stop) so the runner never over-advances
    past a turn the player actually needed to act on. Only a turn that is
    *demonstrably* empty (no fork, no routes, no clue, no npc decision) returns
    False, signalling the loop to keep advancing and give the director another
    chance to surface a handle.
    """
    if turn.get("clue_revealed"):
        return True
    choice_frame = turn.get("choice_frame")
    if not isinstance(choice_frame, dict):
        # No structured choice frame at all → ambiguous, treat as content.
        return True
    if bool(choice_frame.get("is_real_fork")):
        return True
    routes = choice_frame.get("routes")
    # ``routes`` must be a real list to be trusted as "definitively empty". A
    # missing/malformed routes key is ambiguous → treat as content (stop) so we
    # never over-advance past a turn whose frame we could not parse.
    if not isinstance(routes, list):
        return True
    if routes:
        return True
    if _npc_move_requires_player_decision(turn.get("npc_moves")):
        return True
    return False


def _should_auto_advance(turn: dict[str, Any], *, enabled: bool) -> bool:
    if not enabled:
        return False
    directives = turn.get("narrative_directives") or {}
    progress = directives.get("dramatic_progress") or {}
    if progress.get("mode") == "compressed_progress" and progress.get("must_change_state"):
        return _turn_interrupt_reason(turn) is None
    exit_pressure = directives.get("scene_exit_pressure") or {}
    if exit_pressure.get("must_change_state"):
        return _turn_interrupt_reason(turn) is None
    return False


def _run_one_turn(
    *,
    campaign_dir: Path,
    character_path: Path,
    investigator_id: str,
    choice: dict[str, Any],
    decision_id: str,
    rng: random.Random,
    recording_mode: str,
    recording_flush: str,
) -> dict[str, Any]:
    ctx = director.build_director_context(
        campaign_dir=campaign_dir,
        character_path=character_path,
        investigator_id=investigator_id,
        player_intent=str(choice.get("player_text") or ""),
        player_intent_class=str(choice.get("intent_class") or "investigate"),
        player_intent_rich=choice.get("player_intent_rich"),
        rng=rng,
    )
    ctx["storylet_ledger"] = apply_mod._read_json(
        campaign_dir / "save" / "storylet-ledger.json",
        {},
    )
    # P1-3: forward prior turns' player-action signatures so enrichment can mark
    # cross-turn roll density. Only populated within a run_live_turn auto-advance
    # loop; absent on single-turn calls (backward-compat → no marker).
    recent_signatures = choice.get("recent_atom_signatures")
    if isinstance(recent_signatures, list):
        ctx["recent_atom_signatures"] = recent_signatures
    for key in ("storylet_policy", "storylet_library", "incident_deck"):
        if isinstance(choice.get(key), dict):
            ctx[key] = choice[key]
    for key, value in (choice.get("signal_overrides") or {}).items():
        ctx["rule_signals"][key] = value

    plan = director.generate_director_plan(ctx, decision_id=decision_id)
    plan = narrative_enrichment.enrich_director_plan(plan, ctx)
    _recording_defaults(plan, recording_mode, recording_flush)

    rules_recorder = _new_rules_recorder(campaign_dir, recording_mode, decision_id)
    append_jsonl = rules_recorder.append_jsonl if rules_recorder is not None else None
    commands = subsystem_executor.commands_from_rules_requests(plan)
    subsystem_results = subsystem_executor.execute_commands(
        campaign_dir,
        character_path,
        investigator_id,
        commands,
        rng=rng,
        append_jsonl=append_jsonl,
    )
    rule_results = subsystem_executor.flatten_result_events(subsystem_results)
    pending_choice = subsystem_executor.get_current_pending_choice(campaign_dir)
    rules_pending = _commit_rules_recorder(rules_recorder)

    resolved_plan = apply_mod.backfill_rule_results(plan, rule_results)
    if hasattr(narrative_enrichment, "enrich_storylets_after_rules"):
        resolved_plan = narrative_enrichment.enrich_storylets_after_rules(resolved_plan, ctx)
    _recording_defaults(resolved_plan, recording_mode, recording_flush)

    before_pending = _pending_record_count(campaign_dir)
    events = apply_mod.apply_plan(
        campaign_dir,
        resolved_plan,
        investigator_id,
        rules_results=subsystem_results,
        recording_mode=recording_mode,
        recording_flush="manual" if recording_flush == "background" else recording_flush,
    )
    after_pending = _pending_record_count(campaign_dir)

    world = apply_mod._read_json(campaign_dir / "save" / "world-state.json", {})
    pacing = apply_mod._read_json(campaign_dir / "save" / "pacing-state.json", {})
    directives = resolved_plan.get("narrative_directives") or {}
    character = apply_mod._read_json(character_path, {})
    investigator_display_name = ""
    if isinstance(character, dict):
        investigator_display_name = str(
            character.get("name") or character.get("display_name") or investigator_id or ""
        ).strip()
    # R-2 / envelope grounding: player-safe clue bodies, settled rule results,
    # scene sensory anchors, and NPC dialogue seeds — never keeper secret prose.
    narration_envelope = narration_contract.build_narration_envelope(
        resolved_plan,
        clue_graph=ctx.get("clue_graph"),
        active_scene=ctx.get("active_scene"),
        investigator_display_name=investigator_display_name,
    )
    event_types = [event.get("event_type") for event in events if isinstance(event, dict)]
    tension = pacing.get("tension_level")
    turn_record = {
        "decision_id": decision_id,
        "turn_number": (resolved_plan.get("turn_input") or {}).get("turn_number"),
        "scene_id": ctx.get("active_scene_id"),
        "action": resolved_plan.get("scene_action"),
        "validation_warnings": list(
            resolved_plan.get("validation_warnings")
            or ctx.get("validation_warnings")
            or []
        ),
        "auto_advanced": bool(choice.get("auto_advanced")),
        "apply_path": "coc_director_apply.apply_plan",
        "pipeline": "run_live_turn",
        "recording_mode": recording_mode,
        "recording_flush": recording_flush,
        "rules_pending_batch": str(rules_pending) if rules_pending is not None else None,
        "pending_batches_before_apply": before_pending,
        "pending_batches_after_apply": after_pending,
        "clue_revealed": [event.get("clue_id") for event in events if event.get("event_type") == "clue_reveal"],
        "event_types": event_types,
        "events_count": len(events),
        "rule_results": rule_results,
        "subsystem_results": subsystem_results,
        "pending_choice": pending_choice,
        "rules_requests": resolved_plan.get("rules_requests", []),
        "resolved_clue_policy": resolved_plan.get("resolved_clue_policy", {}),
        "failure_consequence": directives.get("failure_consequence"),
        "choice_frame": resolved_plan.get("choice_frame", {}),
        "proposal_transform": (
            resolved_plan.get("proposal_transform") or directives.get("proposal_transform")
        ),
        "scene_exit_pressure": directives.get("scene_exit_pressure"),
        "idea_roll_plan": directives.get("idea_roll_plan"),
        "roll_density_decisions": (
            resolved_plan.get("roll_density_decisions")
            or directives.get("roll_density_decisions")
            or []
        ),
        "npc_moves": resolved_plan.get("npc_moves", []),
        "storylet_moves": resolved_plan.get("storylet_moves", []),
        "incident_moves": resolved_plan.get("incident_moves", []),
        "narrative_enrichment": resolved_plan.get("narrative_enrichment", {}),
        "narrative_directives": directives,
        "narration_envelope": narration_envelope,
        "dramatic_question": resolved_plan.get("dramatic_question", ""),
        "horror_stage": directives.get("horror_escalation_stage"),
        "scene_transition": any(event_type == "scene_transition" for event_type in event_types),
        "active_scene_after": world.get("active_scene_id"),
        "tension": tension,
        "tension_after": tension,
    }
    # N3: prose-style audit trail over player-visible envelope fields.
    # Findings with severity "rewrite" never gate the turn; only "block" would.
    audit = narration_contract.audit_player_visible_fields(
        narration_envelope,
        turn=turn_record,
        decision_id=decision_id,
    )
    for record in audit.get("records") or []:
        _append_jsonl_sync(campaign_dir / "logs" / "narration-audit.jsonl", record)
    turn_record["narration_audit"] = {"findings": int(audit.get("findings_count") or 0)}
    # Slot for player-visible final prose (filled by live_match narrator /
    # template path). Mapper reads narration.final_text first.
    turn_record["narration"] = dict(turn_record.get("narration") or {})
    if audit.get("blocking"):
        raise narration_contract.NarrationGuardBlockedError(
            f"player-visible narration guard blocked decision_id={decision_id} "
            f"with {audit.get('findings_count')} finding(s)"
        )
    return turn_record


def run_live_turn(
    campaign_dir: Path | str,
    character_path: Path | str,
    investigator_id: str,
    player_text: str,
    *,
    intent_class: str | None = None,
    player_intent_rich: dict[str, Any] | None = None,
    max_auto_advance: int = 3,
    auto_advance_low_agency: bool = True,
    recording_mode: str = "fast",
    recording_flush: str = "background",
    rng: random.Random | None = None,
    rng_seed: int | str | None = None,
    storylet_policy: dict[str, Any] | None = None,
    storylet_library: dict[str, Any] | None = None,
    incident_deck: dict[str, Any] | None = None,
    signal_overrides: dict[str, Any] | None = None,
    state_patch: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Run one live player input through the full Keeper stack.

    Holds an advisory ``campaign_lock`` for the whole turn so two concurrent
    sessions cannot corrupt one campaign directory. Raises
    ``coc_fileio.CampaignLockError`` when the lock is already held by a live
    process (hard error for callers). Stale locks from dead pids are reclaimed.

    ``max_auto_advance`` is the maximum total number of internal director turns
    consumed by this one player input. The first turn always represents the
    player's text; later turns only occur when the director emitted a compressed
    low-agency progress directive and no interrupt has appeared yet.

    Injection points for deterministic / scripted callers (playtest driver):
    * ``intent_class`` / ``player_intent_rich`` — pre-routed semantic intent
      (skips the intent router).
    * ``rng`` — shared ``random.Random`` across multi-turn sessions; preferred
      over ``rng_seed`` when the caller must advance one RNG across turns.
    * ``storylet_policy`` / ``storylet_library`` / ``incident_deck`` /
      ``signal_overrides`` — fixture overrides forwarded into director context.
    """
    campaign = Path(campaign_dir)
    with coc_fileio.campaign_lock(campaign):
        return _run_live_turn_impl(
            campaign,
            character_path,
            investigator_id,
            player_text,
            intent_class=intent_class,
            player_intent_rich=player_intent_rich,
            max_auto_advance=max_auto_advance,
            auto_advance_low_agency=auto_advance_low_agency,
            recording_mode=recording_mode,
            recording_flush=recording_flush,
            rng=rng,
            rng_seed=rng_seed,
            storylet_policy=storylet_policy,
            storylet_library=storylet_library,
            incident_deck=incident_deck,
            signal_overrides=signal_overrides,
            state_patch=state_patch,
        )


def _pending_choice_blocked_result(
    campaign: Path,
    investigator_id: str,
    player_text: str,
    pending_choice: dict[str, Any],
    *,
    max_auto_advance: int,
    auto_advance_low_agency: bool,
    recording_mode: str,
    recording_flush: str,
    state_patch: dict[str, Any] | None,
) -> dict[str, Any]:
    """Build a no-side-effect turn while canonical subsystem input is owed."""
    mode = coc_async_recorder.normalize_recording_mode(recording_mode)
    flush_policy = coc_async_recorder.normalize_flush_policy(recording_flush)
    world = _read_json(campaign / "save" / "world-state.json", {})
    pacing = _read_json(campaign / "save" / "pacing-state.json", {})
    active_scene = _read_json(campaign / "save" / "active-scene.json", {})
    decision_id = f"turn-{_next_live_decision_number(campaign):03d}"
    pending = _copy_jsonable(pending_choice)
    scene_id = (
        world.get("active_scene_id") if isinstance(world, dict) else None
    ) or (
        active_scene.get("scene_id") if isinstance(active_scene, dict) else None
    )
    tension = pacing.get("tension_level") if isinstance(pacing, dict) else None
    turn = {
        "decision_id": decision_id,
        "turn_number": pacing.get("turn_number") if isinstance(pacing, dict) else None,
        "scene_id": scene_id,
        "action": "PENDING_SUBSYSTEM_CHOICE",
        "validation_warnings": [],
        "auto_advanced": False,
        "apply_path": None,
        "pipeline": "run_live_turn",
        "recording_mode": mode,
        "recording_flush": flush_policy,
        "rules_pending_batch": None,
        "pending_batches_before_apply": _pending_record_count(campaign),
        "pending_batches_after_apply": _pending_record_count(campaign),
        "clue_revealed": [],
        "event_types": [],
        "events_count": 0,
        "rule_results": [],
        "subsystem_results": [],
        "pending_choice": pending,
        "blocked_by_pending_choice": True,
        "rules_requests": [],
        "resolved_clue_policy": {},
        "failure_consequence": None,
        "choice_frame": {},
        "proposal_transform": None,
        "scene_exit_pressure": None,
        "idea_roll_plan": None,
        "roll_density_decisions": [],
        "npc_moves": [],
        "storylet_moves": [],
        "incident_moves": [],
        "narrative_enrichment": {},
        "narrative_directives": {},
        "narration_envelope": {},
        "dramatic_question": (
            active_scene.get("dramatic_question", "")
            if isinstance(active_scene, dict)
            else ""
        ),
        "horror_stage": None,
        "scene_transition": False,
        "active_scene_after": scene_id,
        "tension": tension,
        "tension_after": tension,
        "narration_audit": {"findings": 0},
        "narration": {},
    }
    pending_batches = _pending_record_count(campaign)
    stop_actionability = {
        "schema_version": 1,
        "immediate_handles": [{
            "kind": "pending_subsystem_choice",
            "choice_id": pending.get("choice_id"),
            "choice_kind": pending.get("kind"),
        }],
        "must_surface_handles": True,
    }
    return {
        "schema_version": 1,
        "campaign_dir": str(campaign),
        "investigator_id": investigator_id,
        "player_text": player_text,
        "intent_resolution": {
            "source": "blocked_by_pending_choice",
            "intent_class": None,
        },
        "turns": [turn],
        "subsystem_results": [],
        "pending_choice": pending,
        "auto_advance": {
            "enabled": bool(auto_advance_low_agency),
            "turns_run": 1,
            "stop_reason": "pending_subsystem_choice",
            "max_turns": max(1, int(max_auto_advance or 1)),
        },
        "recording": {
            "mode": mode,
            "flush_policy": flush_policy,
            "pending_batches_before_flush": pending_batches,
            "background_flush_started": False,
            "background_flush_result": None,
            "completion_required_before_narration": False,
            "background_work": {
                "status": "blocked_by_pending_choice",
                "worker": "local_recorder_process",
                "pending_batches": pending_batches,
                "completion_required_before_narration": False,
            },
        },
        "foreground": {
            "narration_can_return_before_flush": True,
            "waited_for_background_flush": False,
            "sync_state_writes_completed": True,
            "deferred_pending_batches": pending_batches if mode != "sync" else 0,
        },
        "state_patch": {
            "applied": False,
            "blocked_by_pending_choice": True,
            "requested": bool(state_patch),
        },
        "stop_actionability": stop_actionability,
        "narration_audit": {"findings": 0},
        "final_state": {
            "active_scene": scene_id,
            "tension": tension,
            "turn_number": pacing.get("turn_number") if isinstance(pacing, dict) else None,
        },
    }


def _run_live_turn_impl(
    campaign_dir: Path | str,
    character_path: Path | str,
    investigator_id: str,
    player_text: str,
    *,
    intent_class: str | None = None,
    player_intent_rich: dict[str, Any] | None = None,
    max_auto_advance: int = 3,
    auto_advance_low_agency: bool = True,
    recording_mode: str = "fast",
    recording_flush: str = "background",
    rng: random.Random | None = None,
    rng_seed: int | str | None = None,
    storylet_policy: dict[str, Any] | None = None,
    storylet_library: dict[str, Any] | None = None,
    incident_deck: dict[str, Any] | None = None,
    signal_overrides: dict[str, Any] | None = None,
    state_patch: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Inner live-turn body; caller must already hold ``campaign_lock``."""
    campaign = Path(campaign_dir)
    pending_choice = subsystem_executor.get_current_pending_choice(campaign)
    if pending_choice is not None:
        return _pending_choice_blocked_result(
            campaign,
            investigator_id,
            player_text,
            pending_choice,
            max_auto_advance=max_auto_advance,
            auto_advance_low_agency=auto_advance_low_agency,
            recording_mode=recording_mode,
            recording_flush=recording_flush,
            state_patch=state_patch,
        )
    character = Path(character_path)
    mode = coc_async_recorder.normalize_recording_mode(recording_mode)
    flush_policy = coc_async_recorder.normalize_flush_policy(recording_flush)
    turn_rng = rng if rng is not None else random.Random(
        rng_seed if rng_seed is not None else f"{campaign}|{time.time_ns()}"
    )

    resolved_intent_class, resolved_intent_rich, intent_resolution = _resolve_turn_intent(
        campaign,
        player_text,
        intent_class,
        player_intent_rich,
    )
    choice: dict[str, Any] = {
        "player_text": player_text,
        "intent_class": resolved_intent_class,
        "player_intent_rich": _copy_jsonable(resolved_intent_rich) if resolved_intent_rich else None,
    }
    # P0-4b: 在 auto-advance 循环替换 choice 之前，先捕获玩家本轮原始的结构化意图。
    # 循环内 _semantic_low_agency_choice 会把 player_intent_rich 换成合成版
    # (action_atoms:[])，而 turn_focus 依赖 action_atoms[].topic；用原始 rich 才能让
    # focus 在多步低主动路径上也能触发，而不只在单步路径生效。
    original_player_intent_rich = choice.get("player_intent_rich")
    if storylet_policy is not None:
        choice["storylet_policy"] = storylet_policy
    if storylet_library is not None:
        choice["storylet_library"] = storylet_library
    if incident_deck is not None:
        choice["incident_deck"] = incident_deck
    if signal_overrides is not None:
        choice["signal_overrides"] = signal_overrides

    start_number = _next_live_decision_number(campaign)
    max_turns = max(1, int(max_auto_advance or 1))
    turns: list[dict[str, Any]] = []
    stop_reason = "max_auto_advance_reached"
    # P1-3: collect player action_atom (skill, kind) signatures from prior turns
    # WITHIN this one auto-advance loop so enrichment can mark cross-turn roll
    # density. Cross-invocation persistence (across separate player inputs) is
    # intentionally out of scope — the window resets per run_live_turn call.
    recent_atom_signatures: list[tuple[str, str]] = []

    for index in range(max_turns):
        decision_id = f"turn-{start_number + index:03d}"
        # P1-3: hand the accumulating window to this turn's enrichment. Copied
        # defensively so _semantic_low_agency_choice's deepcopy cannot mutate it.
        if recent_atom_signatures:
            choice["recent_atom_signatures"] = list(recent_atom_signatures)
        elif "recent_atom_signatures" in choice:
            choice.pop("recent_atom_signatures", None)
        turn = _run_one_turn(
            campaign_dir=campaign,
            character_path=character,
            investigator_id=investigator_id,
            choice=choice,
            decision_id=decision_id,
            rng=turn_rng,
            recording_mode=mode,
            recording_flush=flush_policy,
        )
        # P1-3: append this turn's player-action signatures BEFORE deciding
        # whether to advance, so the next loop iteration sees the cumulative
        # window. Only real (non-synthesized) atoms contribute; low-agency
        # continuations carry empty action_atoms, so they add nothing.
        recent_atom_signatures.extend(_action_atom_signatures(choice.get("player_intent_rich")))
        turns.append(turn)
        interrupt = _turn_interrupt_reason(turn)
        if interrupt is not None:
            stop_reason = interrupt
            break
        if not _should_auto_advance(turn, enabled=auto_advance_low_agency):
            # P1-2: if this turn surfaced nothing the player can act on (no real
            # fork, no clue, no route, no npc decision) and we still have budget,
            # do not strand the player on an empty "awaiting_player_input" stop —
            # keep advancing as a low-agency beat so the director gets another
            # chance to surface a handle/threat/NPC question. max_turns still caps
            # the loop, so there is no infinite-loop risk. When the turn DOES have
            # content (or fields are ambiguous → conservative True), stop normally.
            if (
                index < max_turns - 1
                and not _turn_has_actionable_content(turn)
            ):
                choice = _semantic_low_agency_choice(choice)
                continue
            stop_reason = "awaiting_player_input"
            break
        choice = _semantic_low_agency_choice(choice)

    decision_ids = [turn["decision_id"] for turn in turns]
    state_patch_status = _apply_state_patch_sync(
        campaign,
        state_patch,
        investigator_id=investigator_id,
        decision_ids=decision_ids,
    )
    state_patch_detail = _queue_state_patch_detail(
        campaign,
        state_patch,
        investigator_id=investigator_id,
        decision_ids=decision_ids,
        recording_mode=mode,
    )
    if state_patch_status.get("applied"):
        state_patch_status["detail_record_deferred"] = bool(state_patch_detail.get("deferred"))
        state_patch_status["detail_pending_batch"] = state_patch_detail.get("pending_batch")
        state_patch_status["detail_record_queued"] = bool(state_patch_detail.get("queued"))

    active_scene_state = _read_json(campaign / "save" / "active-scene.json", {})
    final_turn = turns[-1] if turns else {}
    # P0-4b: 用玩家本轮原始结构化意图（循环替换前的版本）算 turn_focus，
    # 让 stop_actionability 的首条 handle 反映当前轮的 focus
    # （而非过时的开场 visible_affordances）。用 original_player_intent_rich 是因为
    # 多步低主动推进时 choice 已被合成版替换（action_atoms:[]）。
    turn_focus = None
    if hasattr(narrative_enrichment, "build_turn_focus_contract"):
        focus_ctx = {
            "player_intent_rich": original_player_intent_rich,
            "active_scene": active_scene_state if isinstance(active_scene_state, dict) else {},
        }
        try:
            turn_focus = narrative_enrichment.build_turn_focus_contract(focus_ctx)
        except Exception:
            turn_focus = None
    if hasattr(narrative_enrichment, "build_stop_actionability_contract"):
        stop_actionability = narrative_enrichment.build_stop_actionability_contract(
            final_turn,
            active_scene_state if isinstance(active_scene_state, dict) else {},
            stop_reason=stop_reason,
            turn_focus=turn_focus,
        )
    else:
        stop_actionability = {"schema_version": 1, "immediate_handles": [], "must_surface_handles": False}

    pending_before_flush = _pending_record_count(campaign)
    background_result = None
    background_started = False
    background_work = {
        "status": "not_needed",
        "worker": "local_recorder_process",
        "pending_batches": pending_before_flush,
        "completion_required_before_narration": False,
    }
    if mode != "sync" and flush_policy == "background" and pending_before_flush:
        background_result = coc_async_recorder.spawn_background_flush(campaign)
        background_started = bool(background_result.get("started"))
        background_work = {
            "status": "scheduled" if background_started else "schedule_failed",
            "worker": "local_recorder_process",
            "pending_batches": pending_before_flush,
            "completion_required_before_narration": False,
            "result": background_result,
        }

    world = apply_mod._read_json(campaign / "save" / "world-state.json", {})
    pacing = apply_mod._read_json(campaign / "save" / "pacing-state.json", {})
    foreground = {
        "narration_can_return_before_flush": True,
        "waited_for_background_flush": False,
        "sync_state_writes_completed": True,
        "deferred_pending_batches": pending_before_flush if mode != "sync" else 0,
    }
    narration_findings = sum(
        int((turn.get("narration_audit") or {}).get("findings") or 0)
        for turn in turns
        if isinstance(turn, dict)
    )
    result = {
        "schema_version": 1,
        "campaign_dir": str(campaign),
        "investigator_id": investigator_id,
        "player_text": player_text,
        "intent_resolution": intent_resolution,
        "turns": turns,
        "subsystem_results": [
            subsystem_result
            for turn in turns
            if isinstance(turn, dict)
            for subsystem_result in (turn.get("subsystem_results") or [])
            if isinstance(subsystem_result, dict)
        ],
        "pending_choice": subsystem_executor.get_current_pending_choice(campaign),
        "auto_advance": {
            "enabled": bool(auto_advance_low_agency),
            "turns_run": len(turns),
            "stop_reason": stop_reason,
            "max_turns": max_turns,
        },
        "recording": {
            "mode": mode,
            "flush_policy": flush_policy,
            "pending_batches_before_flush": pending_before_flush,
            "background_flush_started": background_started,
            "background_flush_result": background_result,
            "completion_required_before_narration": False,
            "background_work": background_work,
        },
        "foreground": foreground,
        "state_patch": state_patch_status,
        "stop_actionability": stop_actionability,
        "narration_audit": {"findings": narration_findings},
        "final_state": {
            "active_scene": world.get("active_scene_id"),
            "tension": pacing.get("tension_level"),
            "turn_number": pacing.get("turn_number"),
        },
    }

    _append_jsonl_sync(campaign / "logs" / "live-turn-runtime.jsonl", {
        "schema_version": 1,
        "event_type": "live_turn_runtime",
        "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "investigator_id": investigator_id,
        "player_text": player_text,
        "intent_resolution": intent_resolution,
        "turn_count": len(turns),
        "decision_ids": decision_ids,
        "auto_advance": result["auto_advance"],
        "recording_mode": mode,
        "recording_flush": flush_policy,
        "pending_batches_before_flush": pending_before_flush,
        "background_flush_requested": mode != "sync" and flush_policy == "background",
        "background_flush_started": background_started,
        "foreground": foreground,
        "background_work": background_work,
        "state_patch": state_patch_status,
        "stop_actionability": stop_actionability,
        "pending_choice": result["pending_choice"],
        "narration_audit": result["narration_audit"],
        "final_state": result["final_state"],
    })
    return result


# P2-6 (conservative): the per-turn narration path NEVER blocks on a flush.
# This constant is the single, explicit declaration of that contract. The
# maintenance path below may force a synchronous flush, but it runs OUT OF BAND
# (idle/cron/manual), not on the narration path.
NARRATION_FLUSH_BLOCKING: bool = False


def run_pending_flush_maintenance(
    campaign_dir: Path | str,
    *,
    max_age_seconds: int = 30,
    max_count: int = 50,
) -> dict[str, Any]:
    """Maintenance-path pending-flush health check + forced flush (P2-6).

    Runs OUT OF BAND relative to ``run_live_turn``: this is the one place where
    a stuck pending queue (batches older than ``max_age_seconds`` or more
    numerous than ``max_count``) is force-flushed synchronously. It MUST NOT be
    called from the per-turn narration path; ``completion_required_before_
    narration`` on the live path stays False (see ``NARRATION_FLUSH_BLOCKING``).

    Returns a dict with: ``checked`` (bool), ``stuck`` (bool), ``reasons``
    (list[str]), ``pending_count`` (int), ``oldest_age_seconds`` (float|None),
    ``flushed`` (bool), ``flush_result`` (dict|None).
    """
    campaign = Path(campaign_dir)
    stuck = coc_async_recorder.pending_stuck_check(
        campaign,
        max_age_seconds=max_age_seconds,
        max_count=max_count,
    )
    result: dict[str, Any] = {
        "checked": True,
        "stuck": stuck["stuck"],
        "reasons": list(stuck.get("reasons") or []),
        "pending_count": stuck["pending_count"],
        "oldest_age_seconds": stuck["oldest_age_seconds"],
        "max_age_seconds": stuck["max_age_seconds"],
        "max_count": stuck["max_count"],
        "flushed": False,
        "flush_result": None,
        "narration_blocking": NARRATION_FLUSH_BLOCKING,
    }
    if stuck["stuck"] and stuck["pending_count"] > 0:
        flush_result = coc_async_recorder.flush_pending_records(campaign)
        result["flushed"] = True
        result["flush_result"] = flush_result
        _append_jsonl_sync(campaign / "logs" / "maintenance-flush.jsonl", {
            "schema_version": 1,
            "event_type": "pending_flush_maintenance",
            "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "campaign_dir": str(campaign),
            "stuck_reasons": result["reasons"],
            "pending_before": stuck["pending_count"],
            "flush_result": flush_result,
        })
    return result


__all__ = ["run_live_turn", "run_pending_flush_maintenance", "NARRATION_FLUSH_BLOCKING"]
