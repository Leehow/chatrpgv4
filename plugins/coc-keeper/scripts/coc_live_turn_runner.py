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
import hashlib
import os
import random
import stat
import time
from pathlib import Path
from typing import Any, Callable

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
subsystem_executor = _load_sibling(
    "coc_subsystem_executor_live_turn",
    "coc_subsystem_executor.py",
)
coc_async_recorder = _load_sibling("coc_async_recorder", "coc_async_recorder.py")
coc_intent_router = _load_sibling("coc_intent_router", "coc_intent_router.py")
coc_fileio = _load_sibling("coc_fileio", "coc_fileio.py")
coc_toolbox_continuity = _load_sibling(
    "coc_toolbox_continuity_live_turn", "coc_toolbox.py"
)
coc_state = _load_sibling("coc_state_live_turn", "coc_state.py")
coc_scenario_hydration = _load_sibling(
    "coc_scenario_hydration_live_turn", "coc_scenario_hydration.py"
)
coc_chapter_switch = _load_sibling(
    "coc_chapter_switch_live_turn", "coc_chapter_switch.py"
)
coc_scene_graph = _load_sibling("coc_scene_graph_live_turn", "coc_scene_graph.py")
coc_action_resolver = _load_sibling(
    "coc_action_resolver_live_turn", "coc_action_resolver.py"
)
coc_investigator_guard = _load_sibling(
    "coc_investigator_guard_live_turn", "coc_investigator_guard.py"
)


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


_COMPOUND_CONTINUATION_LEDGER = "compound-action-continuations.json"
_CANONICAL_INTENTS = {
    "investigate", "social", "move", "combat", "flee", "meta", "stuck",
    "idle", "ambiguous", "montage", "cast",
}


def _canonical_sha256(value: Any) -> str:
    encoded = json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _compound_ledger_path(campaign: Path) -> Path:
    return campaign / "save" / _COMPOUND_CONTINUATION_LEDGER


def _load_compound_ledger(campaign: Path) -> dict[str, Any]:
    value = _read_json(
        _compound_ledger_path(campaign),
        {"schema_version": 1, "continuations": {}},
    )
    if (
        not isinstance(value, dict)
        or value.get("schema_version") != 1
        or not isinstance(value.get("continuations"), dict)
    ):
        raise RuntimeError("compound action continuation ledger is invalid")
    return value


def _write_compound_ledger(campaign: Path, ledger: dict[str, Any]) -> None:
    _write_json(_compound_ledger_path(campaign), ledger)


def _mint_compound_action_capsule(
    campaign: Path,
    character_path: Path,
    investigator_id: str,
    origin_decision_id: str,
    origin_scene_id: str,
    post_arrival_action: dict[str, Any],
    character_snapshot: dict[str, Any] | None = None,
) -> dict[str, Any]:
    action = _copy_jsonable(post_arrival_action)
    if (
        not isinstance(origin_decision_id, str)
        or not origin_decision_id.strip()
        or not isinstance(origin_scene_id, str)
        or not origin_scene_id.strip()
        or action.get("schema_version") != 1
        or action.get("kind") != "post_arrival_action"
        or not isinstance(action.get("destination_scene_id"), str)
        or not action["destination_scene_id"].strip()
        or action.get("route_owner_scene_id") != action.get("destination_scene_id")
        or not isinstance(action.get("route_id"), str)
        or not action["route_id"].strip()
        or not isinstance(action.get("action_atom"), dict)
        or action["action_atom"].get("route_id") != action.get("route_id")
        or action.get("primary_intent") not in _CANONICAL_INTENTS
    ):
        raise RuntimeError("post-arrival action authority is invalid")
    route = action.get("route_snapshot")
    if (
        not isinstance(route, dict)
        or route.get("affordance_id") != action.get("route_id")
        or route.get("route_owner_scene_id") != action.get("destination_scene_id")
        or route.get("execution_phase") != "post_arrival"
        or route.get("destination_scene_id") != action.get("destination_scene_id")
    ):
        raise RuntimeError("post-arrival route snapshot is invalid")
    character = (
        _copy_jsonable(character_snapshot)
        if isinstance(character_snapshot, dict)
        else coc_investigator_guard.read_reusable_character(
            coc_investigator_guard.coc_root_for_campaign(campaign),
            investigator_id,
            character_path,
        )
    )
    character_id = character.get("id")
    if not isinstance(character_id, str) or not character_id.strip():
        raise RuntimeError("compound action requires a bound character ID")
    capsule = {
        "schema_version": 1,
        "kind": "compound_action_continuation",
        "continuation_id": None,
        "campaign_binding": subsystem_executor._campaign_binding(campaign),
        "actor_binding": {
            "investigator_id": investigator_id,
            "character_id": character_id,
        },
        "authority_revision": 0,
        "source_evidence": {
            "origin_decision_id": origin_decision_id,
            "origin_scene_id": origin_scene_id,
            "destination_scene_id": action["destination_scene_id"],
        },
        "action_authority": action,
        "idempotency": {
            "key": None,
            "mode": "exact_once",
            "consumption_ledger": _COMPOUND_CONTINUATION_LEDGER,
        },
    }
    digest = _canonical_sha256(capsule)
    capsule["continuation_id"] = f"compound-cont:{digest}"
    capsule["idempotency"]["key"] = f"compound-once:{digest}"
    return capsule


def _validate_compound_action_capsule(
    capsule: Any,
    *,
    campaign: Path,
    character_path: Path,
    investigator_id: str,
    character_snapshot: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if not isinstance(capsule, dict) or set(capsule) != {
        "schema_version", "kind", "continuation_id", "campaign_binding",
        "actor_binding", "authority_revision", "source_evidence",
        "action_authority", "idempotency",
    }:
        raise RuntimeError("compound action capsule has an invalid field set")
    if (
        capsule.get("schema_version") != 1
        or capsule.get("kind") != "compound_action_continuation"
        or capsule.get("authority_revision") != 0
        or capsule.get("campaign_binding")
        != subsystem_executor._campaign_binding(campaign)
    ):
        raise RuntimeError("compound action capsule binding is invalid")
    character = (
        _copy_jsonable(character_snapshot)
        if isinstance(character_snapshot, dict)
        else coc_investigator_guard.read_reusable_character(
            coc_investigator_guard.coc_root_for_campaign(campaign),
            investigator_id,
            character_path,
        )
    )
    expected_actor = {
        "investigator_id": investigator_id,
        "character_id": character.get("id"),
    }
    if capsule.get("actor_binding") != expected_actor:
        raise RuntimeError("compound action capsule actor is invalid")
    source = capsule.get("source_evidence")
    if (
        not isinstance(source, dict)
        or set(source) != {
            "origin_decision_id", "origin_scene_id", "destination_scene_id",
        }
        or any(
            not isinstance(source.get(key), str) or not source[key].strip()
            for key in source
        )
    ):
        raise RuntimeError("compound action capsule source evidence is invalid")
    idem = capsule.get("idempotency")
    if not isinstance(idem, dict) or set(idem) != {
        "key", "mode", "consumption_ledger",
    } or idem.get("mode") != "exact_once" or idem.get(
        "consumption_ledger"
    ) != _COMPOUND_CONTINUATION_LEDGER:
        raise RuntimeError("compound action capsule idempotency is invalid")
    material = _copy_jsonable(capsule)
    material["continuation_id"] = None
    material["idempotency"]["key"] = None
    digest = _canonical_sha256(material)
    if (
        capsule.get("continuation_id") != f"compound-cont:{digest}"
        or idem.get("key") != f"compound-once:{digest}"
    ):
        raise RuntimeError("compound action capsule authority hash is invalid")
    expected = _mint_compound_action_capsule(
        campaign,
        character_path,
        investigator_id,
        source["origin_decision_id"],
        source["origin_scene_id"],
        capsule.get("action_authority"),
        character_snapshot=character_snapshot,
    )
    if expected != capsule:
        raise RuntimeError("compound action capsule authority is not canonical")
    return _copy_jsonable(capsule)


def _register_compound_action_capsule(
    campaign: Path, capsule: dict[str, Any]
) -> dict[str, Any]:
    ledger = _load_compound_ledger(campaign)
    continuation_id = capsule["continuation_id"]
    existing = ledger["continuations"].get(continuation_id)
    if existing is not None:
        if not isinstance(existing, dict) or existing.get("capsule") != capsule:
            raise RuntimeError("compound action continuation ID collision")
        return _copy_jsonable(existing)
    record = {
        "schema_version": 1,
        "status": "pending",
        "capsule": _copy_jsonable(capsule),
        "result_decision_id": None,
        "blocker": None,
    }
    ledger["continuations"][continuation_id] = record
    _write_compound_ledger(campaign, ledger)
    return _copy_jsonable(record)


def _update_compound_action_record(
    campaign: Path,
    continuation_id: str,
    *,
    status: str,
    result_decision_id: str | None = None,
    blocker: dict[str, Any] | None = None,
) -> dict[str, Any]:
    ledger = _load_compound_ledger(campaign)
    record = ledger["continuations"].get(continuation_id)
    if not isinstance(record, dict):
        raise RuntimeError("compound action continuation is not registered")
    record["status"] = status
    record["result_decision_id"] = result_decision_id
    record["blocker"] = _copy_jsonable(blocker) if blocker else None
    _write_compound_ledger(campaign, ledger)
    return _copy_jsonable(record)


def _compound_blocker(reason_code: str) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "kind": "compound_action_continuation_blocked",
        "reason_code": reason_code,
        "player_safe_message": (
            "The requested after-arrival action could not continue safely. "
            "No duplicate action was taken; choose the next action explicitly."
        ),
        "localized_messages": {
            "zh-Hans": (
                "抵达后的后续行动无法安全继续；系统没有重复执行。"
                "请明确选择下一步行动。"
            ),
        },
    }


def _attach_compound_blocker(turn: dict[str, Any], blocker: dict[str, Any]) -> None:
    turn["compound_action_continuation"] = {
        "status": "blocked", "blocker": _copy_jsonable(blocker),
    }
    directives = turn.setdefault("narrative_directives", {})
    directives["typed_player_safe_limitation"] = _copy_jsonable(blocker)
    envelope = turn.setdefault("narration_envelope", {})
    envelope["typed_player_safe_limitation"] = _copy_jsonable(blocker)


def _append_jsonl_sync(path: Path, record: dict[str, Any]) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = (json.dumps(record, ensure_ascii=False) + "\n").encode("utf-8")
    directory_flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
    directory_flags |= getattr(os, "O_NOFOLLOW", 0)
    directory_fd = os.open(path.parent, directory_flags)
    descriptor = -1
    try:
        flags = os.O_WRONLY | os.O_APPEND | os.O_CREAT
        flags |= getattr(os, "O_NOFOLLOW", 0)
        descriptor = os.open(path.name, flags, 0o600, dir_fd=directory_fd)
        if not stat.S_ISREG(os.fstat(descriptor).st_mode):
            raise ValueError("JSONL target is not a regular file")
        remaining = memoryview(payload)
        while remaining:
            written = os.write(descriptor, remaining)
            if written <= 0:
                raise OSError("short JSONL append")
            remaining = remaining[written:]
        os.fsync(descriptor)
        os.fsync(directory_fd)
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        os.close(directory_fd)
    return hashlib.sha256(
        json.dumps(
            record, ensure_ascii=False, sort_keys=True,
            separators=(",", ":"), allow_nan=False,
        ).encode("utf-8")
    ).hexdigest()


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


def _decision_turn_number(value: Any) -> int | None:
    text = str(value or "")
    if not text.startswith("turn-"):
        return None
    suffix = text[5:]
    if not suffix.isdigit():
        return None
    return int(suffix)


def _next_logged_decision_number(campaign_dir: Path) -> int:
    """Return the next turn number represented in authoritative logs."""
    max_seen = 0
    for path in (
        campaign_dir / "logs" / "events.jsonl",
        campaign_dir / "logs" / "rolls.jsonl",
    ):
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            candidates = [row.get("decision_id")]
            payload = row.get("payload")
            if isinstance(payload, dict):
                candidates.append(payload.get("decision_id"))
            for candidate in candidates:
                number = _decision_turn_number(candidate)
                if number is not None:
                    max_seen = max(max_seen, number)
    return max_seen + 1


def _next_live_decision_number(campaign_dir: Path) -> int:
    """Choose a turn number that remains monotonic even before fast logs flush."""
    from_logs = _next_logged_decision_number(campaign_dir)
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


def _bind_roll_resolution_context(plan: dict[str, Any]) -> None:
    """Persist the exact structured plan slice an ordinary push may resume."""
    context = {
        "scene_action": plan.get("scene_action"),
        "clue_policy": _copy_jsonable(plan.get("clue_policy") or {}),
        "narrative_directives": _copy_jsonable(
            plan.get("narrative_directives") or {}
        ),
        "rule_signals": _copy_jsonable(plan.get("rule_signals") or {}),
    }
    if isinstance(plan.get("turn_input"), dict):
        context["turn_input"] = _copy_jsonable(plan["turn_input"])
    advance = plan.get("time_advance")
    if isinstance(advance, dict) and all(
        key in advance for key in ("mode", "category", "delta_minutes")
    ):
        context["source_time_profile"] = {
            "mode": advance["mode"],
            "category": advance["category"],
            "delta_minutes": advance["delta_minutes"],
        }
    for request in plan.get("rules_requests") or []:
        if not isinstance(request, dict):
            continue
        if request.get("kind") not in {"skill_check", "characteristic_check"}:
            continue
        _bind_generated_clue_roll_provenance(plan, request)
        request_context = _copy_jsonable(context)
        if isinstance(request.get("route_resolution"), dict):
            request_context["route_resolution"] = _copy_jsonable(
                request["route_resolution"]
            )
        existing_context = request.get("resolution_context")
        if isinstance(existing_context, dict):
            # Generated clue provenance is a pre-roll authority.  An existing
            # context may omit it, but may never replace it with a divergent
            # route/clue/request receipt.
            generated_route = request_context.get("route_resolution")
            existing_route = existing_context.get("route_resolution")
            if isinstance(generated_route, dict):
                if isinstance(existing_route, dict) and existing_route != generated_route:
                    raise ValueError(
                        "generated clue roll has divergent resolution_context provenance"
                    )
                existing_context["route_resolution"] = _copy_jsonable(
                    generated_route
                )
            continue
        request["resolution_context"] = request_context


def _bind_generated_clue_roll_provenance(
    plan: dict[str, Any], request: dict[str, Any]
) -> None:
    """Bind runtime clue dice to one source route, clue, and request pre-roll.

    Director-generated clue gates and authored clue-bonus dice do not always
    originate in a semantic action atom, so they cannot rely on the atom
    request ID/route binder.  This function consumes only the already selected
    structured clue policy.  It neither scans player prose nor repairs a
    missing binding when a Push is later confirmed.
    """
    contract = request.get("roll_contract")
    if not isinstance(contract, dict) or not (
        contract.get("generated_clue_gate") is True
        or contract.get("authored_clue_bonus") is True
    ):
        return
    policy = plan.get("clue_policy")
    turn_input = plan.get("turn_input")
    if not isinstance(policy, dict) or not isinstance(turn_input, dict):
        raise ValueError("generated clue roll lacks structured source policy")
    clue_id = str(request.get("clue_id") or "").strip()
    policy_clue_ids = list(dict.fromkeys(
        str(value).strip()
        for value in policy.get("reveal") or []
        if str(value or "").strip()
    ))
    route_ids = list(dict.fromkeys(
        str(value).strip()
        for value in policy.get("matched_route_ids") or []
        if str(value or "").strip()
    ))
    scene_id = str(turn_input.get("active_scene_id") or "").strip()
    if not clue_id or policy_clue_ids != [clue_id] or not scene_id:
        raise ValueError(
            "generated clue roll cannot bind exactly one source scene/clue"
        )
    if len(route_ids) > 1:
        # There is no safe pushed continuation when one generated roll could
        # settle several authored routes.  Disable Push at the source
        # instead of emitting an offer which can only fail at confirmation.
        push_policy = contract.get("push_policy")
        if isinstance(push_policy, dict):
            push_policy.update({
                "eligible": False,
                "requires_changed_method": False,
                "keeper_must_foreshadow_failure": False,
            })
        return
    route_id = route_ids[0] if route_ids else None
    request_id = request.get("request_id")
    if not isinstance(request_id, str) or not request_id.strip():
        material = json.dumps({
            "schema_version": 1,
            "source": "director.clue_policy",
            "scene_id": scene_id,
            "route_id": route_id,
            "clue_id": clue_id,
            "roll_role": (
                "gate"
                if contract.get("generated_clue_gate") is True
                else "bonus"
            ),
        }, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        request_id = "generated-clue:" + hashlib.sha256(
            material.encode("utf-8")
        ).hexdigest()[:32]
        request["request_id"] = request_id
    if route_id is None:
        # A generated clue check with no authored route is a stable check-only
        # origin.  It may use its request ID on Push, but it cannot consume a
        # route and therefore receives no route_resolution receipt.
        return
    route_resolution = request.get("route_resolution")
    if isinstance(route_resolution, dict):
        bound_routes = list(dict.fromkeys(
            str(value).strip()
            for value in route_resolution.get("matched_route_ids") or []
            if str(value or "").strip()
        ))
        bound_request = route_resolution.get("request_id")
        if bound_routes != [route_id] or bound_request not in {None, request_id}:
            raise ValueError(
                "generated clue roll conflicts with semantic route provenance"
            )
        upstream_binding = route_resolution.get("binding")
        atom_ids = _copy_jsonable(route_resolution.get("atom_ids") or [])
    else:
        upstream_binding = None
        atom_ids = []
    receipt = {
        "schema_version": 1,
        "matched_route_ids": [route_id],
        "clue_ids": [clue_id],
        "request_id": request_id,
        "binding": "generated_clue_policy",
        "source": "director.clue_policy",
    }
    if upstream_binding and upstream_binding != receipt["binding"]:
        receipt["upstream_binding"] = upstream_binding
    if atom_ids:
        receipt["atom_ids"] = atom_ids
    request["route_resolution"] = receipt


def _source_resolution_request(plan: dict[str, Any]) -> tuple[dict[str, Any] | None, int]:
    """Return the first structured HOLD repair request and the total count.

    Requests are generated by the epistemic policy from IDs, confidence records,
    and source refs. This helper deliberately does not inspect narration or any
    other free text.
    """
    contract = plan.get("epistemic_contract")
    if not isinstance(contract, dict):
        return None, 0
    candidates: list[dict[str, Any]] = []
    effects = contract.get("effects")
    if not isinstance(effects, list):
        effects = []
    for effect in [contract, *effects]:
        if not isinstance(effect, dict) or effect.get("mode") != "HOLD":
            continue
        request = effect.get("source_resolution_request")
        if isinstance(request, dict):
            candidates.append(request)
    unique: list[dict[str, Any]] = []
    seen: set[str] = set()
    for request in candidates:
        encoded = json.dumps(
            request, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        )
        if encoded not in seen:
            seen.add(encoded)
            unique.append(request)
    return (unique[0] if unique else None), len(unique)


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
    character_snapshot: dict[str, Any] | None = None,
) -> dict[str, Any]:
    director_started = time.perf_counter()
    def build_context() -> dict[str, Any]:
        built = director.build_director_context(
            campaign_dir=campaign_dir,
            character_path=character_path,
            investigator_id=investigator_id,
            player_intent=str(choice.get("player_text") or ""),
            player_intent_class=str(choice.get("intent_class") or "investigate"),
            player_intent_rich=choice.get("player_intent_rich"),
            rng=rng,
            character_snapshot=character_snapshot,
        )
        built["storylet_ledger"] = apply_mod._read_json(
            campaign_dir / "save" / "storylet-ledger.json", {}
        )
        recent_signatures = choice.get("recent_atom_signatures")
        if isinstance(recent_signatures, list):
            built["recent_atom_signatures"] = recent_signatures
        for key in ("storylet_policy", "storylet_library", "incident_deck"):
            if isinstance(choice.get(key), dict):
                built[key] = choice[key]
        if "incident_deck" not in built:
            authored_incidents = _read_json(
                campaign_dir / "scenario" / "incident-deck.json", {}
            )
            if isinstance(authored_incidents, dict) and isinstance(
                authored_incidents.get("incidents"), list
            ):
                built["incident_deck"] = authored_incidents
        for key, value in (choice.get("signal_overrides") or {}).items():
            built["rule_signals"][key] = value
        return built

    rng_state = rng.getstate()
    ctx = build_context()
    plan = director.generate_director_plan(ctx, decision_id=decision_id)
    repair_request, repair_count = _source_resolution_request(plan)
    if repair_request is not None:
        repair_receipt = coc_scenario_hydration.ensure_scenario_ready(
            campaign_dir,
            force_recompile=True,
            resolution_request=repair_request,
        )
        # Re-run the same decision against repaired IR with the same RNG state;
        # only the newly compiled structured evidence may change the plan.
        rng.setstate(rng_state)
        ctx = build_context()
        plan = director.generate_director_plan(ctx, decision_id=decision_id)
        plan["source_resolution"] = {
            "status": repair_receipt.get("status"),
            "request": _copy_jsonable(repair_request),
            "receipt": repair_receipt,
            "requests_detected": repair_count,
            "requests_deferred": max(0, repair_count - 1),
            "attempts_this_turn": 1,
        }
    run_id = choice.get("run_id")
    if isinstance(run_id, str) and run_id.strip():
        plan["run_id"] = run_id.strip()
    plan = narrative_enrichment.enrich_director_plan(plan, ctx)
    _bind_roll_resolution_context(plan)
    _recording_defaults(plan, recording_mode, recording_flush)
    director_ms = (time.perf_counter() - director_started) * 1000.0

    rules_started = time.perf_counter()
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
        character_snapshot=character_snapshot,
    )
    rule_results = subsystem_executor.flatten_result_events(subsystem_results)
    pending_choice = subsystem_executor.get_current_pending_choice(campaign_dir)
    rules_pending = _commit_rules_recorder(rules_recorder)
    rules_ms = (time.perf_counter() - rules_started) * 1000.0

    resolved_plan = apply_mod.backfill_rule_results(plan, rule_results)
    # A20/A21 ordering is deliberate: social tactic outcomes and disclosure
    # gates are compiled only after rule settlement, but before clue backfill
    # is committed by apply_plan.
    resolved_plan = director.coc_npc_state.enrich_plan_after_rules(
        resolved_plan, ctx, rule_results
    )
    if hasattr(narrative_enrichment, "enrich_storylets_after_rules"):
        resolved_plan = narrative_enrichment.enrich_storylets_after_rules(resolved_plan, ctx)
    _recording_defaults(resolved_plan, recording_mode, recording_flush)

    before_pending = _pending_record_count(campaign_dir)
    persistence_started = time.perf_counter()
    events = apply_mod.apply_plan(
        campaign_dir,
        resolved_plan,
        investigator_id,
        rules_results=subsystem_results,
        rules_results_mode="normalized",
        recording_mode=recording_mode,
        recording_flush="manual" if recording_flush == "background" else recording_flush,
        _campaign_lock_held=True,
    )
    after_pending = _pending_record_count(campaign_dir)
    persistence_ms = (time.perf_counter() - persistence_started) * 1000.0

    world = apply_mod._read_json(campaign_dir / "save" / "world-state.json", {})
    pacing = apply_mod._read_json(campaign_dir / "save" / "pacing-state.json", {})
    # Choice frames are initially compiled before rules/apply so the director
    # can reason about the current fork.  The player-visible frame must instead
    # reflect the settled world: successful one-shot clue routes disappear in
    # the same response, failed gated routes remain, and a committed scene cut
    # projects the destination scene rather than stale choices from the origin.
    settled_scene = ctx.get("active_scene") or {}
    settled_scene_id = str(world.get("active_scene_id") or "")
    if settled_scene_id and settled_scene_id != str(ctx.get("active_scene_id") or ""):
        settled_scene = next(
            (
                item for item in (ctx.get("story_graph") or {}).get("scenes", [])
                if isinstance(item, dict) and str(item.get("scene_id") or "") == settled_scene_id
            ),
            {},
        )
    settled_choice_frame = narrative_enrichment.build_choice_frame(
        settled_scene,
        resolved_plan.get("resolved_clue_policy") or resolved_plan.get("clue_policy"),
        discovered_clue_ids=world.get("discovered_clue_ids"),
        route_completion_receipts=world.get("route_completion_receipts"),
    )
    settled_directives = resolved_plan.get("narrative_directives") or {}
    settled_style = settled_directives.get("player_facing_style")
    play_language = (
        str(settled_style.get("language") or "zh-Hans")
        if isinstance(settled_style, dict)
        else "zh-Hans"
    )
    # Reaching a structured exit condition unlocks destinations but does not
    # authorize same-action travel. Surface those exact graph destinations as
    # future action handles so control returns to the player with a real fork.
    transition_routes: list[dict[str, Any]] = []
    scene_rows = {
        str(item.get("scene_id")): item
        for item in (ctx.get("story_graph") or {}).get("scenes", [])
        if isinstance(item, dict) and item.get("scene_id")
    }
    ready_to_leave = str(settled_scene_id) in {
        str(value) for value in (world.get("exit_ready_scene_ids") or [])
    }
    for destination_id in (
        coc_scene_graph.transition_candidates(
            settled_scene_id,
            ctx.get("story_graph") or {},
            world,
        )
        if ready_to_leave
        else []
    ):
        destination = scene_rows.get(str(destination_id), {})
        display_name = narration_contract._scene_display_name(
            destination,
            play_language,
        )
        localized_travel_cues = destination.get("localized_travel_cues")
        localized_travel_cue = (
            localized_travel_cues.get(play_language)
            if isinstance(localized_travel_cues, dict)
            else None
        )
        authored_travel_cue = (
            localized_travel_cue
            if isinstance(localized_travel_cue, str) and localized_travel_cue.strip()
            else destination.get("player_visible_travel_cue")
        )
        transition_routes.append({
            "route_id": f"move:{destination_id}",
            "route_type": "scene_transition",
            "destination_scene_id": str(destination_id),
            "cue": str(
                authored_travel_cue
                or (
                    f"前往{display_name}继续调查。"
                    if play_language == "zh-Hans"
                    else f"Continue the investigation at {display_name}."
                )
            ),
            "cue_scope": "action_only",
            "visible_benefit": display_name,
            "visible_cost": None,
            "visible_risk": None,
            "status": "open",
            "fork_eligible": True,
            "source": "story_graph.transition_candidates",
        })
    if transition_routes:
        existing_routes = list(settled_choice_frame.get("routes") or [])
        existing_ids = {
            str(route.get("route_id") or "")
            for route in existing_routes
            if isinstance(route, dict)
        }
        for route in transition_routes:
            if route["route_id"] not in existing_ids:
                existing_routes.append(route)
        settled_choice_frame["routes"] = existing_routes
        settled_choice_frame["route_count"] = len(existing_routes)
        open_routes = [
            route for route in existing_routes
            if isinstance(route, dict)
            and str(route.get("status") or "open") == "open"
            and route.get("fork_eligible", True) is not False
        ]
        settled_choice_frame["open_route_ids"] = [
            str(route.get("route_id")) for route in open_routes if route.get("route_id")
        ]
        settled_choice_frame["open_route_count"] = len(open_routes)
        settled_choice_frame["is_real_fork"] = len(open_routes) >= 2
        settled_choice_frame["must_surface_tradeoffs"] = bool(
            settled_choice_frame.get("must_surface_tradeoffs")
            or any(
                route.get("visible_benefit")
                or route.get("visible_cost")
                or route.get("visible_risk")
                for route in transition_routes
            )
        )
    resolved_plan["choice_frame"] = settled_choice_frame
    settled_directives = resolved_plan.setdefault("narrative_directives", {})
    settled_directives["choice_frame"] = settled_choice_frame
    settled_directives["consequence_cues"] = narrative_enrichment.build_consequence_cues(
        settled_choice_frame
    )
    directives = resolved_plan.get("narrative_directives") or {}
    character = (
        _copy_jsonable(character_snapshot)
        if isinstance(character_snapshot, dict)
        else coc_investigator_guard.read_reusable_character(
            coc_investigator_guard.coc_root_for_campaign(campaign_dir),
            investigator_id,
            character_path,
        )
    )
    investigator_display_name = ""
    if isinstance(character, dict):
        investigator_display_name = str(
            character.get("name") or character.get("display_name") or investigator_id or ""
        ).strip()
    style = directives.get("player_facing_style")
    play_language = (
        str(style.get("language") or "zh-Hans")
        if isinstance(style, dict)
        else "zh-Hans"
    )
    public_roll_block = narration_contract.build_rules_owned_public_roll_block(
        rule_results,
        decision_id=decision_id,
        play_language=play_language,
    )
    # R-2 / envelope grounding: player-safe clue bodies, settled rule results,
    # scene sensory anchors, and NPC dialogue seeds — never keeper secret prose.
    narration_envelope = narration_contract.build_narration_envelope(
        resolved_plan,
        clue_graph=ctx.get("clue_graph"),
        active_scene=settled_scene,
        investigator_display_name=investigator_display_name,
        applied_events=events,
        route_completion_receipts=world.get("route_completion_receipts"),
    )
    narration_envelope["rules_owned_roll_rendering"] = {
        "schema_version": 1,
        "owner": "deterministic_rules_renderer",
        "public_roll_count": public_roll_block["public_roll_count"],
        "narrator_must_not_render_numeric_rolls": True,
    }
    projected_pending_choice = narration_contract.project_pending_choice(pending_choice)
    if projected_pending_choice is not None:
        narration_envelope["pending_choice"] = projected_pending_choice
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
        "capability_findings": list(resolved_plan.get("capability_findings") or []),
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
        "public_roll_block": public_roll_block,
        "subsystem_results": subsystem_results,
        "pending_choice": pending_choice,
        "rules_requests": resolved_plan.get("rules_requests", []),
        "keeper_ruling_receipt": resolved_plan.get("keeper_ruling_receipt"),
        "resolved_clue_policy": resolved_plan.get("resolved_clue_policy", {}),
        "source_resolution": resolved_plan.get("source_resolution"),
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
        "npc_interactions": resolved_plan.get("npc_interactions", []),
        "disclosure_decisions": resolved_plan.get("disclosure_decisions", []),
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
    turn_record["runtime_phase_ms"] = {
        "director_ms": max(0.0, director_ms),
        "rules_ms": max(0.0, rules_ms),
        "persistence_ms": max(0.0, persistence_ms),
    }
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
    run_id: str | None = None,
    intent_class: str | None = None,
    player_intent_rich: dict[str, Any] | None = None,
    pending_choice_response: dict[str, Any] | None = None,
    subsystem_request: dict[str, Any] | None = None,
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
    resolve_player_action: bool = False,
    action_evaluator: Callable[[dict[str, Any]], dict[str, Any]] | None = None,
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
    * ``run_id`` — exact play/report segment identity propagated into every
      Director-owned NPC source receipt produced by this turn.
    * ``intent_class`` / ``player_intent_rich`` — pre-routed semantic intent
      (skips the intent router).
    * ``rng`` — shared ``random.Random`` across multi-turn sessions; preferred
      over ``rng_seed`` when the caller must advance one RNG across turns.
    * ``storylet_policy`` / ``storylet_library`` / ``incident_deck`` /
      ``signal_overrides`` — fixture overrides forwarded into director context.
    """
    started = time.perf_counter()
    campaign = Path(campaign_dir)
    if run_id is not None and (not isinstance(run_id, str) or not run_id.strip()):
        raise ValueError("run_id must be a non-empty string when supplied")
    with coc_fileio.campaign_lock(campaign):
        coc_toolbox_continuity.reconcile_campaign_continuity(campaign)
        character = Path(character_path)
        character_snapshot = coc_investigator_guard.read_reusable_character(
            coc_investigator_guard.coc_root_for_campaign(campaign),
            investigator_id,
            character,
        )
        # Production resolution boundary: the Keeper-only resolver reuses or
        # compiles validated IR before any director code reads the scenario.
        # Raw module text never crosses into the player/narrator requests.
        scenario_resolution = coc_scenario_hydration.ensure_scenario_ready(campaign)
        result = _run_live_turn_impl(
            campaign,
            character_path,
            investigator_id,
            player_text,
            run_id=run_id,
            intent_class=intent_class,
            player_intent_rich=player_intent_rich,
            pending_choice_response=pending_choice_response,
            subsystem_request=subsystem_request,
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
            resolve_player_action=resolve_player_action,
            action_evaluator=action_evaluator,
            character_snapshot=character_snapshot,
        )
        chapter_transition = _automatic_chapter_handoff(campaign, result)
        if chapter_transition is not None:
            result["chapter_transition"] = chapter_transition
            result["final_state"]["active_scene"] = chapter_transition.get(
                "entry_scene_id"
            )
            result["final_state"]["scenario_id"] = chapter_transition.get(
                "scenario_id"
            )
        result["scenario_resolution"] = scenario_resolution
    phase = result.get("runtime_phase_ms") if isinstance(result, dict) else None
    if not isinstance(phase, dict):
        phase = {}
    result["runtime_phase_ms"] = {
        "intent_ms": float(phase.get("intent_ms") or 0.0),
        "director_ms": float(phase.get("director_ms") or 0.0),
        "rules_ms": float(phase.get("rules_ms") or 0.0),
        "persistence_ms": float(phase.get("persistence_ms") or 0.0),
        "total_ms": max(0.0, (time.perf_counter() - started) * 1000.0),
    }
    return result


def _automatic_chapter_handoff(
    campaign_dir: Path,
    result: dict[str, Any],
) -> dict[str, Any] | None:
    """Switch an authored sibling chapter after structured terminal evidence.

    The target is never guessed from titles, chapter order, or narration. An
    automatic handoff exists only when module-meta declares the exact target.
    """
    scenario_dir = campaign_dir / "scenario"
    meta = _read_json(scenario_dir / "module-meta.json", {})
    handoff = meta.get("chapter_handoff") if isinstance(meta, dict) else None
    if handoff is None:
        return None
    if not isinstance(handoff, dict) or set(handoff) != {"mode", "target_module_id"}:
        raise ValueError(
            "module-meta.chapter_handoff must contain exactly mode and target_module_id"
        )
    if handoff.get("mode") != "auto_on_terminal":
        raise ValueError("module-meta.chapter_handoff.mode must be auto_on_terminal")
    target = handoff.get("target_module_id")
    if not isinstance(target, str) or not target.strip():
        raise ValueError("module-meta.chapter_handoff.target_module_id is required")
    story = _read_json(scenario_dir / "story-graph.json", {})
    world = _read_json(campaign_dir / "save" / "world-state.json", {})
    evidence = coc_scene_graph.terminal_evidence(story, world, result.get("turns"))
    if evidence["reached_terminal"] is not True:
        return {
            "status": "NOT_RUN",
            "reason": "terminal_not_reached",
            "target_module_id": target.strip(),
            "terminal_evidence": evidence,
        }
    resolved = campaign_dir.resolve()
    coc_root = next((parent for parent in (resolved, *resolved.parents) if parent.name == ".coc"), None)
    if coc_root is None:
        raise ValueError("automatic chapter handoff requires campaign under workspace .coc")
    switched = coc_chapter_switch.switch_chapter(
        coc_root.parent,
        campaign_dir.name,
        target.strip(),
        evidence,
    )
    return {"status": "PASS", "terminal_evidence": evidence, **switched}


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
        "capability_findings": [],
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


def _plan_from_typed_subsystem_request(
    investigator_id: str,
    request: dict[str, Any],
) -> dict[str, Any]:
    push_keys = {
        "kind",
        "continuation_id",
        "changed_method_evidence",
        "announced_consequence",
    }
    if not isinstance(request, dict):
        raise ValueError("subsystem_request must be an object")
    limitation_keys = {
        "kind", "original_command_id", "route_id", "reason_code",
        "player_safe_message", "localized_messages",
    }
    destination_limitation_keys = {
        "kind", "reason_code", "player_safe_message", "localized_messages",
        "public_prerequisite_cues",
    }
    if (
        set(request) == destination_limitation_keys
        and request.get("kind") == "destination_limitation"
    ):
        material = json.dumps(
            {"investigator_id": investigator_id, "request": request},
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        ).encode("utf-8")
        digest = hashlib.sha256(material).hexdigest()
        return {
            "decision_id": f"destination-limitation-{digest[:32]}",
            "scene_action": "SUBSYSTEM",
            "rules_requests": [],
            "clue_policy": {},
            "narrative_directives": {
                "typed_player_safe_limitation": {
                    "schema_version": 1,
                    "kind": "destination_not_known_and_reachable",
                    "reason_code": request["reason_code"],
                    "message": request["player_safe_message"],
                    "localized_messages": _copy_jsonable(
                        request["localized_messages"]
                    ),
                    "public_prerequisite_cues": _copy_jsonable(
                        request["public_prerequisite_cues"]
                    ),
                    "must_render_exactly_once": True,
                },
            },
            "rule_signals": {},
            "pressure_moves": [],
            "memory_writes": [],
            "time_advance": {
                "mode": "none",
                "reason": "destination limitation consumes no game time",
            },
        }
    if set(request) == limitation_keys and request.get("kind") == "push_limitation":
        material = json.dumps(
            {"investigator_id": investigator_id, "request": request},
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        ).encode("utf-8")
        digest = hashlib.sha256(material).hexdigest()
        return {
            "decision_id": f"push-limitation-{digest[:32]}",
            "scene_action": "SUBSYSTEM",
            "rules_requests": [],
            "clue_policy": {},
            "narrative_directives": {
                "typed_player_safe_limitation": {
                    "schema_version": 1,
                    "kind": "push_resolution_required",
                    "original_command_id": request["original_command_id"],
                    "route_id": request["route_id"],
                    "reason_code": request["reason_code"],
                    "message": request["player_safe_message"],
                    "localized_messages": _copy_jsonable(
                        request["localized_messages"]
                    ),
                    "must_render_exactly_once": True,
                },
            },
            "rule_signals": {},
            "pressure_moves": [],
            "memory_writes": [],
            "time_advance": {
                "mode": "none",
                "reason": "push limitation consumes no game time",
            },
        }
    if set(request) == {"kind", "payload"}:
        kind = request.get("kind")
        supported = {
            "combat_start", "combat_attack", "combat_defend", "dying_tick",
            "stabilize", "combat_end",
            "chase_start", "chase_move", "chase_hazard", "chase_barrier",
            "chase_conflict", "chase_end",
        }
        if kind not in supported or not isinstance(request.get("payload"), dict):
            raise ValueError("subsystem_request kind/payload is not supported")
        payload = _copy_jsonable(request["payload"])
        material = json.dumps(
            {"investigator_id": investigator_id, "request": request},
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        ).encode("utf-8")
        digest = hashlib.sha256(material).hexdigest()
        decision_id = payload.get("decision_id") or f"subsystem-{digest[:32]}"
        return {
            "decision_id": decision_id,
            "scene_action": "SUBSYSTEM",
            "rules_requests": [{
                "command_id": f"{kind}:{digest}",
                "kind": kind,
                **payload,
            }],
            "clue_policy": {},
            "narrative_directives": {},
            "rule_signals": {},
            "pressure_moves": [],
            "memory_writes": [],
        }
    if not push_keys <= set(request) or set(request) - push_keys - {"source_time_profile"}:
        raise ValueError(
            "subsystem_request must be a typed push offer or exact kind/payload request"
        )
    if request.get("kind") != "push_offer":
        raise ValueError("subsystem_request currently supports only push_offer")
    material = json.dumps(
        {"investigator_id": investigator_id, "request": request},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")
    digest = hashlib.sha256(material).hexdigest()
    decision_id = f"subsystem-{digest[:32]}"
    return {
        "decision_id": decision_id,
        "scene_action": "SUBSYSTEM",
        "rules_requests": [{
            "command_id": f"push-offer:{digest}",
            "kind": "push_offer",
            "continuation_id": request["continuation_id"],
            "changed_method_evidence": _copy_jsonable(
                request["changed_method_evidence"]
            ),
            "announced_consequence": _copy_jsonable(
                request["announced_consequence"]
            ),
            "source_time_profile": _copy_jsonable(
                request.get("source_time_profile")
            ),
        }],
        "clue_policy": {},
        "narrative_directives": {},
        "rule_signals": {},
        "pressure_moves": [],
        "memory_writes": [],
    }


def _run_pending_choice_response(
    campaign: Path,
    character_path: Path,
    investigator_id: str,
    player_text: str,
    response: dict[str, Any],
    *,
    run_id: str | None = None,
    recording_mode: str,
    recording_flush: str,
    rng: random.Random | None,
    rng_seed: int | str | None,
    max_auto_advance: int,
    auto_advance_low_agency: bool,
    state_patch: dict[str, Any] | None,
    plan_override: dict[str, Any] | None = None,
    intent_source: str = "pending_choice_response",
    action_resolution_receipt: dict[str, Any] | None = None,
    character_snapshot: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Resolve one canonical subsystem choice without intent/Director routing."""
    mode = coc_async_recorder.normalize_recording_mode(recording_mode)
    flush_policy = coc_async_recorder.normalize_flush_policy(recording_flush)
    turn_rng = rng if rng is not None else random.Random(
        rng_seed if rng_seed is not None else f"{campaign}|pending|{time.time_ns()}"
    )
    plan = (
        _copy_jsonable(plan_override)
        if isinstance(plan_override, dict)
        else subsystem_executor.plan_from_pending_choice_response(
            campaign, investigator_id, response
        )
    )
    if isinstance(run_id, str) and run_id.strip():
        plan["run_id"] = run_id.strip()
    _recording_defaults(plan, mode, flush_policy)
    decision_id = str(plan["decision_id"])
    rules_started = time.perf_counter()
    rules_recorder = _new_rules_recorder(campaign, mode, decision_id)
    append_jsonl = rules_recorder.append_jsonl if rules_recorder is not None else None
    commands = subsystem_executor.commands_from_rules_requests(plan)
    subsystem_results = subsystem_executor.execute_commands(
        campaign,
        character_path,
        investigator_id,
        commands,
        rng=turn_rng,
        append_jsonl=append_jsonl,
        character_snapshot=character_snapshot,
    )
    rule_results = subsystem_executor.flatten_result_events(subsystem_results)
    rules_pending = _commit_rules_recorder(rules_recorder)
    rules_ms = (time.perf_counter() - rules_started) * 1000.0
    resolved_plan = apply_mod.backfill_rule_results(plan, rule_results)
    _recording_defaults(resolved_plan, mode, flush_policy)
    before_pending = _pending_record_count(campaign)
    persistence_started = time.perf_counter()
    events = apply_mod.apply_plan(
        campaign,
        resolved_plan,
        investigator_id,
        rules_results=subsystem_results,
        rules_results_mode="normalized",
        recording_mode=mode,
        recording_flush="manual" if flush_policy == "background" else flush_policy,
        _campaign_lock_held=True,
    )
    after_pending = _pending_record_count(campaign)
    persistence_ms = (time.perf_counter() - persistence_started) * 1000.0
    pending_choice = subsystem_executor.get_current_pending_choice(campaign)
    if pending_choice is None:
        pending_choice = subsystem_executor.project_player_combat_defense(
            campaign, investigator_id
        )
    world = apply_mod._read_json(campaign / "save" / "world-state.json", {})
    pacing = apply_mod._read_json(campaign / "save" / "pacing-state.json", {})
    story_graph = apply_mod._read_json(campaign / "scenario" / "story-graph.json", {})
    settled_scene_id = str(world.get("active_scene_id") or "")
    active_scene = next(
        (
            item for item in story_graph.get("scenes", []) or []
            if isinstance(item, dict)
            and str(item.get("scene_id") or "") == settled_scene_id
        ),
        apply_mod._read_json(campaign / "save" / "active-scene.json", {}),
    )
    clue_graph = apply_mod._read_json(campaign / "scenario" / "clue-graph.json", {})
    settled_choice_frame = narrative_enrichment.build_choice_frame(
        active_scene,
        resolved_plan.get("resolved_clue_policy") or resolved_plan.get("clue_policy"),
        discovered_clue_ids=world.get("discovered_clue_ids"),
        route_completion_receipts=world.get("route_completion_receipts"),
    )
    resolved_plan["choice_frame"] = settled_choice_frame
    settled_directives = resolved_plan.setdefault("narrative_directives", {})
    settled_directives["choice_frame"] = settled_choice_frame
    settled_directives["consequence_cues"] = narrative_enrichment.build_consequence_cues(
        settled_choice_frame
    )
    character = (
        _copy_jsonable(character_snapshot)
        if isinstance(character_snapshot, dict)
        else coc_investigator_guard.read_reusable_character(
            coc_investigator_guard.coc_root_for_campaign(campaign),
            investigator_id,
            character_path,
        )
    )
    display_name = str(
        character.get("name") or character.get("display_name") or investigator_id
    ).strip() if isinstance(character, dict) else investigator_id
    directives = resolved_plan.get("narrative_directives") or {}
    style = directives.get("player_facing_style")
    play_language = (
        str(style.get("language") or "zh-Hans")
        if isinstance(style, dict)
        else "zh-Hans"
    )
    public_roll_block = narration_contract.build_rules_owned_public_roll_block(
        rule_results,
        decision_id=decision_id,
        play_language=play_language,
    )
    narration_envelope = narration_contract.build_narration_envelope(
        resolved_plan,
        clue_graph=clue_graph,
        active_scene=active_scene,
        investigator_display_name=display_name,
        applied_events=events,
        route_completion_receipts=world.get("route_completion_receipts"),
    )
    narration_envelope["rules_owned_roll_rendering"] = {
        "schema_version": 1,
        "owner": "deterministic_rules_renderer",
        "public_roll_count": public_roll_block["public_roll_count"],
        "narrator_must_not_render_numeric_rolls": True,
    }
    projected_pending_choice = narration_contract.project_pending_choice(pending_choice)
    if projected_pending_choice is not None:
        narration_envelope["pending_choice"] = projected_pending_choice
    event_types = [
        event.get("event_type") for event in events if isinstance(event, dict)
    ]
    scene_id = world.get("active_scene_id") or active_scene.get("scene_id")
    turn = {
        "decision_id": decision_id,
        "turn_number": (resolved_plan.get("turn_input") or {}).get("turn_number"),
        "scene_id": scene_id,
        "action": resolved_plan.get("scene_action") or "SUBSYSTEM",
        "validation_warnings": [],
        "auto_advanced": False,
        "apply_path": "coc_director_apply.apply_plan",
        "pipeline": "run_live_turn.pending_choice_response",
        "recording_mode": mode,
        "recording_flush": flush_policy,
        "rules_pending_batch": str(rules_pending) if rules_pending is not None else None,
        "pending_batches_before_apply": before_pending,
        "pending_batches_after_apply": after_pending,
        "clue_revealed": [
            event.get("clue_id") for event in events
            if isinstance(event, dict) and event.get("event_type") == "clue_reveal"
        ],
        "event_types": event_types,
        "events_count": len(events),
        "rule_results": rule_results,
        "public_roll_block": public_roll_block,
        "subsystem_results": subsystem_results,
        "pending_choice": pending_choice,
        "blocked_by_pending_choice": False,
        "rules_requests": resolved_plan.get("rules_requests", []),
        "resolved_clue_policy": resolved_plan.get("resolved_clue_policy", {}),
        "failure_consequence": (resolved_plan.get("narrative_directives") or {}).get("failure_consequence"),
        "choice_frame": resolved_plan.get("choice_frame", {}),
        "proposal_transform": None,
        "scene_exit_pressure": None,
        "idea_roll_plan": None,
        "roll_density_decisions": [],
        "npc_moves": [],
        "storylet_moves": [],
        "incident_moves": [],
        "narrative_enrichment": {},
        "narrative_directives": resolved_plan.get("narrative_directives", {}),
        "narration_envelope": narration_envelope,
        "dramatic_question": active_scene.get("dramatic_question", ""),
        "horror_stage": None,
        "scene_transition": "scene_transition" in event_types,
        "active_scene_after": world.get("active_scene_id"),
        "tension": pacing.get("tension_level"),
        "tension_after": pacing.get("tension_level"),
        "narration_audit": {"findings": 0},
        "narration": {},
    }
    stop_reason = "pending_subsystem_choice" if pending_choice else "awaiting_player_input"
    pending_batches = _pending_record_count(campaign)
    result = {
        "schema_version": 1,
        "campaign_dir": str(campaign),
        "investigator_id": investigator_id,
        "player_text": player_text,
        "intent_resolution": {
            "source": intent_source,
            "intent_class": None,
            **({"action_resolution": _copy_jsonable(action_resolution_receipt)}
               if isinstance(action_resolution_receipt, dict) else {}),
        },
        "turns": [turn],
        "subsystem_results": subsystem_results,
        "pending_choice": pending_choice,
        "auto_advance": {
            "enabled": bool(auto_advance_low_agency),
            "turns_run": 1,
            "stop_reason": stop_reason,
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
                "status": "not_needed",
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
        "stop_actionability": {
            "schema_version": 1,
            "immediate_handles": ([{
                "kind": "pending_subsystem_choice",
                "choice_id": pending_choice.get("choice_id"),
                "choice_kind": pending_choice.get("kind"),
            }] if pending_choice else []),
            "must_surface_handles": bool(pending_choice),
        },
        "narration_audit": {"findings": 0},
        "final_state": {
            "active_scene": world.get("active_scene_id"),
            "tension": pacing.get("tension_level"),
            "turn_number": pacing.get("turn_number"),
        },
        "runtime_phase_ms": {
            "intent_ms": 0.0,
            "director_ms": 0.0,
            "rules_ms": max(0.0, rules_ms),
            "persistence_ms": max(0.0, persistence_ms),
        },
    }
    runtime_row = {
        "schema_version": 1,
        "event_type": "live_turn_runtime",
        "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "investigator_id": investigator_id,
        "player_text": player_text,
        "intent_resolution": result["intent_resolution"],
        "rng_seed": rng_seed,
        "turn_count": 1,
        "decision_ids": [decision_id],
        "auto_advance": result["auto_advance"],
        "recording_mode": mode,
        "recording_flush": flush_policy,
        "pending_choice": pending_choice,
        "final_state": result["final_state"],
    }
    result["runtime_receipt_sha256"] = _append_jsonl_sync(
        campaign / "logs" / "live-turn-runtime.jsonl", runtime_row
    )
    return result


def _consume_compound_action_capsule(
    campaign: Path,
    character_path: Path,
    investigator_id: str,
    capsule: dict[str, Any],
    *,
    run_id: str | None = None,
    rng: random.Random,
    recording_mode: str,
    recording_flush: str,
    character_snapshot: dict[str, Any] | None = None,
) -> dict[str, Any]:
    sealed = _validate_compound_action_capsule(
        capsule,
        campaign=campaign,
        character_path=character_path,
        investigator_id=investigator_id,
        character_snapshot=character_snapshot,
    )
    continuation_id = sealed["continuation_id"]
    ledger = _load_compound_ledger(campaign)
    record = ledger["continuations"].get(continuation_id)
    if not isinstance(record, dict) or record.get("capsule") != sealed:
        raise RuntimeError("compound action continuation is not registered exactly")
    if record.get("status") == "consumed":
        return {
            "schema_version": 1,
            "status": "already_consumed",
            "continuation_id": continuation_id,
            "decision_id": record.get("result_decision_id"),
            "turn": None,
        }
    if record.get("status") in {"consuming", "blocked"}:
        blocker = record.get("blocker") or _compound_blocker(
            "continuation_consumption_indeterminate"
        )
        if record.get("status") == "consuming":
            _update_compound_action_record(
                campaign, continuation_id, status="blocked", blocker=blocker
            )
        return {
            "schema_version": 1,
            "status": "blocked",
            "continuation_id": continuation_id,
            "blocker": _copy_jsonable(blocker),
            "turn": None,
        }
    if record.get("status") != "pending":
        raise RuntimeError("compound action continuation status is invalid")
    action = sealed["action_authority"]
    world = _read_json(campaign / "save" / "world-state.json", {})
    if world.get("active_scene_id") != action["destination_scene_id"]:
        blocker = _compound_blocker("destination_arrival_not_committed")
        _update_compound_action_record(
            campaign, continuation_id, status="blocked", blocker=blocker
        )
        return {
            "schema_version": 1, "status": "blocked",
            "continuation_id": continuation_id, "blocker": blocker, "turn": None,
        }
    _request, affordance_index, _destinations = (
        coc_action_resolver.build_action_request(
            campaign,
            "sealed compound-action continuation",
            {"primary_intent": action["primary_intent"], "action_atoms": []},
            character_path=character_path,
            investigator_id=investigator_id,
            character_snapshot=character_snapshot,
        )
    )
    current_route = affordance_index.get(action["route_id"])
    expected_route = _copy_jsonable(action["route_snapshot"])
    expected_route.pop("execution_phase", None)
    expected_route.pop("destination_scene_id", None)
    if current_route != expected_route:
        blocker = _compound_blocker("sealed_route_no_longer_open")
        _update_compound_action_record(
            campaign, continuation_id, status="blocked", blocker=blocker
        )
        return {
            "schema_version": 1, "status": "blocked",
            "continuation_id": continuation_id, "blocker": blocker, "turn": None,
        }
    _update_compound_action_record(
        campaign, continuation_id, status="consuming"
    )
    decision_id = "compound-" + continuation_id.rsplit(":", 1)[-1][:32]
    receipt = {
        "schema_version": 1,
        "evaluator_id": str(
            (action.get("semantic_evidence") or {}).get("evaluator_id") or
            "sealed-compound-action"
        ),
        "matched_affordance_ids": [action["route_id"]],
        "matched_destination_scene_id": None,
        "primary_intent": action["primary_intent"],
        "confidence": (action.get("semantic_evidence") or {}).get("confidence"),
        "reason": (action.get("semantic_evidence") or {}).get("reason"),
        "no_match": False,
        "status": "resolved",
        "source": "sealed_compound_action_continuation",
        "continuation_id": continuation_id,
    }
    rich: dict[str, Any] = {
        "primary_intent": action["primary_intent"],
        "target_entities": _copy_jsonable(action.get("target_entities") or []),
        "action_atoms": [_copy_jsonable(action["action_atom"])],
        "action_resolution": receipt,
    }
    interaction = action.get("npc_interaction")
    if isinstance(interaction, dict):
        row = {
            key: value for key, value in interaction.items()
            if key in {
                "npc_id", "tactic", "fact_id", "leverage_id", "skill",
                "difficulty",
            }
        }
        row["request_id"] = f"{decision_id}-{action['route_id']}"
        rich["npc_interactions"] = [row]
    choice = {
        "player_text": "",
        "intent_class": action["primary_intent"],
        "player_intent_rich": rich,
    }
    if isinstance(run_id, str) and run_id.strip():
        choice["run_id"] = run_id.strip()
    try:
        turn = _run_one_turn(
            campaign_dir=campaign,
            character_path=character_path,
            investigator_id=investigator_id,
            choice=choice,
            decision_id=decision_id,
            rng=rng,
            recording_mode=recording_mode,
            recording_flush=recording_flush,
            character_snapshot=character_snapshot,
        )
    except Exception as exc:
        blocker = _compound_blocker("continuation_consumption_indeterminate")
        _update_compound_action_record(
            campaign, continuation_id, status="blocked", blocker=blocker
        )
        return {
            "schema_version": 1,
            "status": "blocked",
            "continuation_id": continuation_id,
            "blocker": blocker,
            "error_type": type(exc).__name__,
            "turn": None,
        }
    _update_compound_action_record(
        campaign,
        continuation_id,
        status="consumed",
        result_decision_id=decision_id,
    )
    turn["compound_action_continuation"] = {
        "schema_version": 1,
        "status": "consumed",
        "continuation_id": continuation_id,
        "source_decision_id": sealed["source_evidence"]["origin_decision_id"],
    }
    return {
        "schema_version": 1,
        "status": "consumed",
        "continuation_id": continuation_id,
        "decision_id": decision_id,
        "turn": turn,
    }


def _run_live_turn_impl(
    campaign_dir: Path | str,
    character_path: Path | str,
    investigator_id: str,
    player_text: str,
    *,
    run_id: str | None = None,
    intent_class: str | None = None,
    player_intent_rich: dict[str, Any] | None = None,
    pending_choice_response: dict[str, Any] | None = None,
    subsystem_request: dict[str, Any] | None = None,
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
    resolve_player_action: bool = False,
    action_evaluator: Callable[[dict[str, Any]], dict[str, Any]] | None = None,
    character_snapshot: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Inner live-turn body; caller must already hold ``campaign_lock``."""
    campaign = Path(campaign_dir)
    character_path = Path(character_path)
    if character_snapshot is None:
        character_snapshot = coc_investigator_guard.read_reusable_character(
            coc_investigator_guard.coc_root_for_campaign(campaign),
            investigator_id,
            character_path,
        )
    if pending_choice_response is not None:
        coc_state.load_world_state(campaign)
        combat_choice = subsystem_executor.project_player_combat_defense(
            campaign, investigator_id
        )
        if isinstance(combat_choice, dict):
            allowed = {
                option.get("action") for option in combat_choice.get("options", [])
                if isinstance(option, dict)
            }
            if (
                pending_choice_response.get("choice_id") != combat_choice["choice_id"]
                or pending_choice_response.get("responder") != "player"
                or pending_choice_response.get("revision") != combat_choice["revision"]
                or pending_choice_response.get("action") not in allowed
            ):
                raise ValueError("combat pending_choice_response is stale or invalid")
            request = {
                "kind": "combat_defend",
                "payload": {
                    "decision_id": f"combat-defense-{combat_choice['attack_id']}-{combat_choice['revision']}",
                    "revision": combat_choice["revision"],
                    "actor_id": investigator_id,
                    "attack_command_id": combat_choice["attack_id"],
                    "defense_kind": pending_choice_response["action"],
                },
            }
            return _run_pending_choice_response(
                campaign, Path(character_path), investigator_id, player_text, {},
                run_id=run_id,
                recording_mode=recording_mode, recording_flush=recording_flush,
                rng=rng, rng_seed=rng_seed, max_auto_advance=max_auto_advance,
                auto_advance_low_agency=auto_advance_low_agency,
                state_patch=state_patch,
                plan_override=_plan_from_typed_subsystem_request(investigator_id, request),
                intent_source="combat_pending_choice_response",
                character_snapshot=character_snapshot,
            )
        return _run_pending_choice_response(
            campaign,
            Path(character_path),
            investigator_id,
            player_text,
            pending_choice_response,
            run_id=run_id,
            recording_mode=recording_mode,
            recording_flush=recording_flush,
            rng=rng,
            rng_seed=rng_seed,
            max_auto_advance=max_auto_advance,
            auto_advance_low_agency=auto_advance_low_agency,
            state_patch=state_patch,
            character_snapshot=character_snapshot,
        )
    if subsystem_request is not None:
        coc_state.load_world_state(campaign)
        plan = _plan_from_typed_subsystem_request(investigator_id, subsystem_request)
        return _run_pending_choice_response(
            campaign,
            Path(character_path),
            investigator_id,
            player_text,
            {},
            run_id=run_id,
            recording_mode=recording_mode,
            recording_flush=recording_flush,
            rng=rng,
            rng_seed=rng_seed,
            max_auto_advance=max_auto_advance,
            auto_advance_low_agency=auto_advance_low_agency,
            state_patch=state_patch,
            plan_override=plan,
            intent_source="subsystem_request",
            character_snapshot=character_snapshot,
        )
    pending_choice = subsystem_executor.get_current_pending_choice(campaign)
    if pending_choice is None:
        pending_choice = subsystem_executor.project_player_combat_defense(
            campaign, investigator_id
        )
    if (
        isinstance(pending_choice, dict)
        and pending_choice.get("kind") == "combat_defense"
        and isinstance(player_intent_rich, dict)
        and isinstance(player_intent_rich.get("combat_defense"), dict)
    ):
        legacy = player_intent_rich["combat_defense"]
        return _run_live_turn_impl(
            campaign, character_path, investigator_id, player_text,
            pending_choice_response={
                "choice_id": pending_choice["choice_id"], "responder": "player",
                "revision": pending_choice["revision"], "action": legacy.get("kind"),
            },
            run_id=run_id,
            max_auto_advance=max_auto_advance,
            auto_advance_low_agency=auto_advance_low_agency,
            recording_mode=recording_mode, recording_flush=recording_flush,
            rng=rng, rng_seed=rng_seed, state_patch=state_patch,
            character_snapshot=character_snapshot,
        )
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
    # The live production entry owns the write-side migration boundary before
    # any director/apply code reads and potentially rewrites world. A turn
    # blocked exclusively by an existing subsystem choice remains read-only.
    coc_state.load_world_state(campaign)
    character = character_path
    mode = coc_async_recorder.normalize_recording_mode(recording_mode)
    flush_policy = coc_async_recorder.normalize_flush_policy(recording_flush)
    turn_rng = rng if rng is not None else random.Random(
        rng_seed if rng_seed is not None else f"{campaign}|{time.time_ns()}"
    )

    intent_started = time.perf_counter()
    action_resolution = None
    if resolve_player_action:
        player_intent_rich, action_resolution = (
            coc_action_resolver.resolve_player_action(
                campaign,
                player_text,
                player_intent_rich,
                character_path=character,
                investigator_id=investigator_id,
                evaluator=action_evaluator,
                character_snapshot=character_snapshot,
            )
        )
        if action_resolution.get("status") == "blocked":
            blocker_code = str(
                action_resolution.get("blocker_code")
                or "AUTHORED_OPERATION_BLOCKED"
            )
            operations = ", ".join(
                str(item)
                for item in action_resolution.get("required_typed_operations", [])
            )
            raise RuntimeError(
                f"{blocker_code}: cannot narrate selected authored route "
                f"before typed operations are implemented ({operations})"
            )
        resolved_primary = player_intent_rich.get("primary_intent")
        if isinstance(resolved_primary, str) and resolved_primary:
            intent_class = resolved_primary
        semantic_subsystem_request = player_intent_rich.get(
            "semantic_subsystem_request"
        )
        if isinstance(semantic_subsystem_request, dict):
            intent_ms = (time.perf_counter() - intent_started) * 1000.0
            result = _run_pending_choice_response(
                campaign,
                character,
                investigator_id,
                player_text,
                {},
                run_id=run_id,
                recording_mode=mode,
                recording_flush=flush_policy,
                rng=turn_rng,
                rng_seed=rng_seed,
                max_auto_advance=max_auto_advance,
                auto_advance_low_agency=auto_advance_low_agency,
                state_patch=state_patch,
                plan_override=_plan_from_typed_subsystem_request(
                    investigator_id, semantic_subsystem_request
                ),
                intent_source=(
                    "semantic_destination_limitation"
                    if semantic_subsystem_request.get("kind")
                    == "destination_limitation"
                    else "semantic_push_request"
                ),
                action_resolution_receipt=action_resolution,
                character_snapshot=character_snapshot,
            )
            result["runtime_phase_ms"]["intent_ms"] = max(0.0, intent_ms)
            return result
    resolved_intent_class, resolved_intent_rich, intent_resolution = _resolve_turn_intent(
        campaign,
        player_text,
        intent_class,
        player_intent_rich,
    )
    if action_resolution is not None:
        intent_resolution = {
            **intent_resolution,
            "action_resolution": _copy_jsonable(action_resolution),
        }
    intent_ms = (time.perf_counter() - intent_started) * 1000.0
    choice: dict[str, Any] = {
        "player_text": player_text,
        "intent_class": resolved_intent_class,
        "player_intent_rich": _copy_jsonable(resolved_intent_rich) if resolved_intent_rich else None,
    }
    if isinstance(run_id, str) and run_id.strip():
        choice["run_id"] = run_id.strip()
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
    compound_capsule: dict[str, Any] | None = None
    compound_outcome: dict[str, Any] | None = None
    post_arrival_action = (
        resolved_intent_rich.get("post_arrival_action")
        if isinstance(resolved_intent_rich, dict)
        else None
    )
    if isinstance(post_arrival_action, dict):
        world_before_move = _read_json(campaign / "save" / "world-state.json", {})
        compound_capsule = _mint_compound_action_capsule(
            campaign,
            character,
            investigator_id,
            f"turn-{start_number:03d}",
            str(world_before_move.get("active_scene_id") or ""),
            post_arrival_action,
            character_snapshot=character_snapshot,
        )
        _register_compound_action_capsule(campaign, compound_capsule)
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
            character_snapshot=character_snapshot,
        )
        # P1-3: append this turn's player-action signatures BEFORE deciding
        # whether to advance, so the next loop iteration sees the cumulative
        # window. Only real (non-synthesized) atoms contribute; low-agency
        # continuations carry empty action_atoms, so they add nothing.
        recent_atom_signatures.extend(_action_atom_signatures(choice.get("player_intent_rich")))
        turns.append(turn)
        if compound_capsule is not None and index == 0:
            compound_outcome = _consume_compound_action_capsule(
                campaign,
                character,
                investigator_id,
                compound_capsule,
                run_id=run_id,
                rng=turn_rng,
                recording_mode=mode,
                recording_flush=flush_policy,
                character_snapshot=character_snapshot,
            )
            continuation_turn = compound_outcome.get("turn")
            turn["compound_action_continuation"] = {
                key: _copy_jsonable(value)
                for key, value in compound_outcome.items()
                if key != "turn"
            }
            if isinstance(continuation_turn, dict):
                turns.append(continuation_turn)
                turn = continuation_turn
                interrupt = _turn_interrupt_reason(continuation_turn)
                stop_reason = interrupt or "awaiting_player_input"
            elif compound_outcome.get("status") == "blocked":
                blocker = compound_outcome.get("blocker")
                if isinstance(blocker, dict):
                    _attach_compound_blocker(turns[-1], blocker)
                stop_reason = "compound_action_continuation_blocked"
            else:
                stop_reason = "awaiting_player_input"
            break
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
    world = apply_mod._read_json(campaign / "save" / "world-state.json", {})
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
            durable_clue_ids=world.get("discovered_clue_ids")
            if isinstance(world, dict)
            else [],
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
        "compound_action_continuation": (
            {
                key: _copy_jsonable(value)
                for key, value in compound_outcome.items()
                if key != "turn"
            }
            if isinstance(compound_outcome, dict)
            else None
        ),
        "stop_actionability": stop_actionability,
        "narration_audit": {"findings": narration_findings},
        "final_state": {
            "active_scene": world.get("active_scene_id"),
            "tension": pacing.get("tension_level"),
            "turn_number": pacing.get("turn_number"),
        },
        "runtime_phase_ms": {
            "intent_ms": max(0.0, intent_ms),
            "director_ms": sum(
                float((turn.get("runtime_phase_ms") or {}).get("director_ms") or 0.0)
                for turn in turns if isinstance(turn, dict)
            ),
            "rules_ms": sum(
                float((turn.get("runtime_phase_ms") or {}).get("rules_ms") or 0.0)
                for turn in turns if isinstance(turn, dict)
            ),
            "persistence_ms": sum(
                float((turn.get("runtime_phase_ms") or {}).get("persistence_ms") or 0.0)
                for turn in turns if isinstance(turn, dict)
            ),
        },
    }

    runtime_row = {
        "schema_version": 1,
        "event_type": "live_turn_runtime",
        "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "investigator_id": investigator_id,
        "player_text": player_text,
        "intent_resolution": intent_resolution,
        "rng_seed": rng_seed,
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
        "compound_action_continuation": result[
            "compound_action_continuation"
        ],
        "stop_actionability": stop_actionability,
        "pending_choice": result["pending_choice"],
        "narration_audit": result["narration_audit"],
        "final_state": result["final_state"],
    }
    result["runtime_receipt_sha256"] = _append_jsonl_sync(
        campaign / "logs" / "live-turn-runtime.jsonl", runtime_row
    )
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
