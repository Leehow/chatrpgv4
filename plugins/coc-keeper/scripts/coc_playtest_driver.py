#!/usr/bin/env python3
"""Multi-turn playtest driver — scripted wrapper around run_live_turn.

Each player choice is fed into the canonical live-turn pipeline
(``coc_live_turn_runner.run_live_turn``): intent → director → enrich → rules →
apply → narration envelope. This driver owns only scripted-choice feed, shared
RNG seeding, session aggregation, and battle-report packaging. It does NOT call
an LLM for narration and must not reimplement pipeline stages.

Usage:
    python3 coc_playtest_driver.py <campaign_dir> <character_path> <investigator_id> --choices <choices.json>
"""
from __future__ import annotations

import argparse
import ctypes
import importlib.util
import json
import os
import random
import shutil
import stat
import sys
import time
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent


def _load_sibling(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPT_DIR / filename)
    m = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(m)
    return m


apply_mod = _load_sibling("coc_director_apply", "coc_director_apply.py")
coc_scene_graph = _load_sibling("coc_scene_graph", "coc_scene_graph.py")
playtest_report = _load_sibling("coc_playtest_report", "coc_playtest_report.py")
coc_run_identity = _load_sibling("coc_run_identity", "coc_run_identity.py")
subsystem_executor = _load_sibling(
    "coc_subsystem_executor_driver",
    "coc_subsystem_executor.py",
)
coc_investigator_guard = _load_sibling(
    "coc_investigator_guard_playtest_driver", "coc_investigator_guard.py"
)


def _append_jsonl(path: Path, record: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _write_jsonl(path: Path, records: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "".join(json.dumps(record, ensure_ascii=False) + "\n" for record in records),
        encoding="utf-8",
    )


def _live_turn_runner():
    """Lazy-load the canonical live-turn pipeline (avoids import cycle at module load)."""
    existing = sys.modules.get("coc_live_turn_runner")
    if existing is not None:
        return existing
    return _load_sibling("coc_live_turn_runner", "coc_live_turn_runner.py")


def _decision_turn_number(value: Any) -> int | None:
    text = str(value or "")
    if not text.startswith("turn-"):
        return None
    suffix = text[5:]
    if not suffix.isdigit():
        return None
    return int(suffix)


def _next_decision_number(campaign_dir: Path) -> int:
    """Return the next live decision number from existing event/roll logs."""
    max_seen = 0
    for path in (campaign_dir / "logs" / "events.jsonl", campaign_dir / "logs" / "rolls.jsonl"):
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


def _execute_rules_requests(
    campaign_dir: Path,
    character_path: Path,
    investigator_id: str,
    plan: dict[str, Any],
    rng: random.Random,
    append_jsonl=None,
) -> list[dict[str, Any]]:
    """Compatibility adapter over the sole canonical mutable executor path."""
    commands = subsystem_executor.commands_from_rules_requests(plan)
    if not commands:
        return []
    normalized = subsystem_executor.execute_commands(
        campaign_dir,
        character_path,
        investigator_id,
        commands,
        rng=rng,
        append_jsonl=append_jsonl,
    )
    return subsystem_executor.flatten_result_events(normalized)
_SCENE_ACTION_ZH = {
    "REVEAL": "揭示线索",
    "PRESSURE": "施加压力",
    "CHARACTER": "角色互动",
    "CHOICE": "呈现选择",
    "RECOVER": "回流扶手",
    "SUBSYSTEM": "规则处理",
    "CUT": "场景切换",
    "DEEPEN": "深化谜团",
}
def _clue_lookup(
    campaign_dir: Path, play_language: str = "zh-Hans"
) -> dict[str, str]:
    graph = apply_mod._read_json(campaign_dir / "scenario" / "clue-graph.json", {"conclusions": []})
    lookup: dict[str, str] = {}
    for conclusion in graph.get("conclusions", []):
        if not isinstance(conclusion, dict):
            continue
        for clue in conclusion.get("clues", []):
            if not isinstance(clue, dict):
                continue
            clue_id = clue.get("clue_id") or clue.get("id")
            if not clue_id:
                continue
            # Prefer player-safe prose; never fall back to the raw id here —
            # callers treat a missing/empty lookup as a generic reveal line.
            localized = clue.get("localized_text")
            localized_row = (
                localized.get(play_language)
                if isinstance(localized, dict)
                and isinstance(localized.get(play_language), (dict, str))
                else None
            )
            if isinstance(localized_row, dict):
                localized_label = next(
                    (
                        localized_row.get(key)
                        for key in ("player_safe_summary", "summary", "text")
                        if isinstance(localized_row.get(key), str)
                        and localized_row[key].strip()
                    ),
                    None,
                )
            else:
                localized_label = localized_row
            label = (
                localized_label
                or clue.get("player_safe_summary")
                or clue.get("summary")
                or clue.get("delivery")
                or clue.get("title")
                or ""
            )
            label = str(label).strip()
            if label and label != str(clue_id):
                lookup[str(clue_id)] = label
    return lookup


_SCENE_TRANSITION_LINES = (
    "这足以推动场景进入下一处可调查地点。",
    "眼前的路通向另一处可查的地方。",
    "调查的重心移向下一处现场。",
)

_NO_NEW_CLUE_LINES = (
    "眼前暂时没有新的发现，气氛却并未放松。",
    "周围仍有可查之处，只是关键细节尚未浮现。",
    "线索暂时沉在表面之下，现场的压力并没有消失。",
)


def _rotated_line(lines: tuple[str, ...] | list[str], turn_number: Any) -> str:
    """Deterministic filler rotation by turn number (stable across reruns)."""
    if not lines:
        return ""
    try:
        idx = int(turn_number or 0)
    except (TypeError, ValueError):
        idx = 0
    return lines[idx % len(lines)]


def _clue_reveal_prose(clue_id: Any, clue_names: dict[str, str]) -> str:
    """Player-facing clue reveal without raw ids or bookkeeping phrasing."""
    cid = str(clue_id or "").strip()
    label = clue_names.get(cid, "").strip() if cid else ""
    if not label or label == cid:
        return "你注意到一条新的线索。"
    return f"你注意到：{label.rstrip('。！？.!?')}。"


def _storylet_prose(
    move: dict[str, Any],
    *,
    surfaced_route_ids: set[str] | None = None,
    authorized_route_cues: dict[str, str] | None = None,
) -> list[str]:
    parts: list[str] = []
    grounding = move.get("grounding_contract")
    grounding = grounding if isinstance(grounding, dict) else {}
    fact_authorization = grounding.get("fact_authorization")
    fact_authorized = (
        grounding.get("allow_new_actionable_fact") is True
        and isinstance(fact_authorization, dict)
        and fact_authorization.get("status") == "authorized"
    )
    if not fact_authorized:
        bound = move.get("bound_entities") or {}
        route_id = str(bound.get("route_id") or "") if isinstance(bound, dict) else ""
        route_cue = (authorized_route_cues or {}).get(route_id)
        if not route_id or not route_cue:
            return []
        if route_id in (surfaced_route_ids or set()):
            return []
        return [f"若要换一条路，还可以考虑：{route_cue.strip()}"]

    cue = move.get("cue") or move.get("title")
    if cue:
        parts.append(str(cue))
    variants = move.get("rolled_variants", {})
    if isinstance(variants, dict):
        for key in ("sensory_detail_1d6", "complication_1d6"):
            value = variants.get(key)
            if value and str(value) not in parts:
                parts.append(str(value))
    return parts


def _npc_lookup(
    campaign_dir: Path, play_language: str = "zh-Hans"
) -> dict[str, str]:
    agendas = apply_mod._read_json(campaign_dir / "scenario" / "npc-agendas.json", {"npcs": []})
    lookup: dict[str, str] = {}
    for npc in agendas.get("npcs", []):
        if isinstance(npc, dict) and npc.get("npc_id"):
            localized_name = None
            for container_key in ("localized_text", "localized_names"):
                container = npc.get(container_key)
                localized = (
                    container.get(play_language)
                    if isinstance(container, dict) else None
                )
                if isinstance(localized, dict):
                    localized_name = next((
                        localized.get(key)
                        for key in ("display_name", "name")
                        if isinstance(localized.get(key), str)
                        and localized[key].strip()
                    ), None)
                elif isinstance(localized, str) and localized.strip():
                    localized_name = localized
                if localized_name:
                    break
            lookup[str(npc["npc_id"])] = str(
                localized_name or npc.get("display_name") or npc.get("name") or "NPC"
            )
    return lookup


def _npc_reaction_prose(npc_moves: list[dict[str, Any]], npc_names: dict[str, str]) -> list[str]:
    lines: list[str] = []
    for npc in npc_moves:
        npc_id = str(npc.get("npc_id") or "")
        npc_name = npc_names.get(npc_id) or npc.get("display_name") or npc.get("name") or "NPC"
        for reaction in npc.get("active_reactions", []) or []:
            if not isinstance(reaction, dict):
                continue
            line = reaction.get("line_seed")
            if line:
                lines.append(f"{npc_name}低声提醒：“{line}”")
            elif reaction.get("move"):
                lines.append(f"{npc_name}作出反应：{reaction['move']}。")
    return lines


def _choice_frame_route_ids(choice_frame: dict[str, Any]) -> list[str]:
    routes = _actionable_choice_routes(choice_frame)
    ids: list[str] = []
    for route in routes:
        if not isinstance(route, dict):
            continue
        rid = route.get("id") or route.get("route_id") or route.get("route") or route.get("cue")
        if rid:
            ids.append(str(rid))
    return ids


def _actionable_choice_routes(choice_frame: dict[str, Any]) -> list[dict[str, Any]]:
    routes = choice_frame.get("routes", []) if isinstance(choice_frame, dict) else []
    return [
        route
        for route in routes
        if isinstance(route, dict)
        and route.get("cue")
        and str(route.get("route_type") or "") != "live_resume_affordance"
        and str(route.get("status") or "open") == "open"
        and route.get("fork_eligible") is not False
    ]


def _choice_frame_prose(
    choice_frame: dict[str, Any],
    *,
    previous_affordance_ids: list[str] | None = None,
) -> list[str]:
    routes = _actionable_choice_routes(choice_frame)
    current_ids = _choice_frame_route_ids(choice_frame)
    if previous_affordance_ids is not None and current_ids and current_ids == list(previous_affordance_ids):
        return []
    previous = set(previous_affordance_ids or [])
    visible_routes = [
        route for route in routes
        if isinstance(route, dict)
        and route.get("cue")
        and (
            previous_affordance_ids is None
            or str(route.get("id") or route.get("route_id") or "") not in previous
        )
    ]
    if not visible_routes:
        return []
    # These are future affordances, not observations or completed actions.  The
    # explicit modal wording is important on the deterministic fallback path:
    # an AI player must never infer that a key, payment, clue, or agreement has
    # already changed hands merely because the route is currently available.
    woven = [
        str(route["cue"]).strip().rstrip("。！？.!?")
        for route in visible_routes[:2]
    ]
    if len(woven) == 1:
        return [f"眼下若你愿意，可以{woven[0]}。"]
    return [f"眼下若你愿意，可以{woven[0]}；也可以{woven[1]}。"]


def _successful_action_prose(
    turn: dict[str, Any], play_language: str
) -> list[str]:
    envelope = turn.get("narration_envelope")
    outcomes = (
        envelope.get("action_outcomes")
        if isinstance(envelope, dict)
        else []
    )
    visible_outcomes: list[str] = []
    completed_success = False
    for outcome in outcomes or []:
        if not isinstance(outcome, dict):
            continue
        if outcome.get("success") is not True or outcome.get("status") != "completed":
            continue
        completed_success = True
        raw_goal = str(outcome.get("player_visible_goal") or "").strip()
        raw_visible_outcome = str(
            outcome.get("player_visible_outcome") or ""
        ).strip()
        goal = raw_goal.rstrip("。！？.!?")
        visible_outcome = raw_visible_outcome.rstrip("。！？.!?")
        # Some completed routes have no authored public outcome.  The apply
        # layer then records this exact protocol fallback from the structured
        # goal.  Recover that known shape by equality, rather than classifying
        # free prose by keywords, so an internal English label cannot leak
        # when the LLM narrator falls back to this deterministic renderer.
        generated_default = f"Completed public action: {raw_goal}".rstrip(
            "。！？.!?"
        )
        if goal and visible_outcome == generated_default:
            visible_outcome = (
                f"你已经{goal}"
                if play_language.startswith("zh")
                else f"You completed this step: {goal}"
            )
        if visible_outcome and visible_outcome not in visible_outcomes:
            visible_outcomes.append(visible_outcome)
    if visible_outcomes:
        return visible_outcomes
    if completed_success:
        return ["这一步已经顺利完成，眼前的局面也随之有了进展。"]
    projected_rules = (
        envelope.get("rule_results") if isinstance(envelope, dict) else []
    )
    if any(
        isinstance(result, dict)
        and result.get("success") is True
        and result.get("matched_route_ids")
        and result.get("state_change_committed") is False
        for result in projected_rules or []
    ):
        return ["检定本身通过了，但这次还没有确认新的线索、权限或其他状态变化。"]
    # A settled successful self-contained roll is still progress. Route-bound
    # success reaches this branch only after its apply receipt is projected.
    if any(
        isinstance(result, dict) and result.get("success") is True
        for result in projected_rules or []
    ):
        return ["这次行动成功了，你达成了当前这一步的目标。"]
    return []


def _pending_choice_prose(turn: dict[str, Any]) -> list[str]:
    pending = turn.get("pending_choice")
    if not isinstance(pending, dict) or pending.get("responder") != "player":
        return []
    if pending.get("kind") != "push_confirm":
        return []
    prompt = pending.get("prompt")
    options = pending.get("options")
    if not isinstance(prompt, str) or not prompt.strip():
        return []
    labels = [
        str(option.get("label") or "").strip()
        for option in (options or [])
        if isinstance(option, dict) and str(option.get("label") or "").strip()
    ]
    if labels:
        return [prompt.strip(), f"可选回应：{'；'.join(labels)}"]
    return [prompt.strip()]


def _typed_limitation_prose(turn: dict[str, Any], play_language: str) -> list[str]:
    directives = turn.get("narrative_directives")
    limitation = (
        directives.get("typed_player_safe_limitation")
        if isinstance(directives, dict) else None
    )
    if not isinstance(limitation, dict):
        return []
    localized = limitation.get("localized_messages")
    message = (
        localized.get(play_language)
        if isinstance(localized, dict) else None
    ) or limitation.get("message")
    return [message.strip()] if isinstance(message, str) and message.strip() else []


def _ordinary_failure_prose(
    result: dict[str, Any], play_language: str
) -> str | None:
    consequence = (
        result.get("fumble_consequence")
        if result.get("outcome") == "fumble"
        else result.get("announced_consequence")
        if result.get("pushed") is True
        else None
    )
    if isinstance(consequence, dict):
        localized_consequence = consequence.get("localized_summaries")
        summary = (
            localized_consequence.get(play_language)
            if isinstance(localized_consequence, dict)
            else None
        ) or consequence.get("summary")
        if isinstance(summary, str) and summary.strip():
            return summary.strip()
    contract = result.get("roll_contract")
    if not isinstance(contract, dict):
        return None
    localized = contract.get("localized_failure_effects")
    summary = (
        localized.get(play_language)
        if isinstance(localized, dict)
        else None
    ) or contract.get("failure_effect")
    if (
        contract.get("authored_roll_gate") is True
        and result.get("outcome") != "fumble"
        and result.get("pushed") is not True
        and contract.get("failure_outcome_mode") == "no_progress"
        and isinstance(summary, str)
        and summary.strip()
    ):
        return summary.strip()
    return None


def _clue_reveals_prose(
    clue_ids: list[Any], clue_names: dict[str, str]
) -> list[str]:
    """Aggregate structured clue reveals without repetitive template beats."""
    labels: list[str] = []
    unknown_count = 0
    seen_ids: set[str] = set()
    for raw_id in clue_ids:
        clue_id = str(raw_id or "").strip()
        if not clue_id or clue_id in seen_ids:
            continue
        seen_ids.add(clue_id)
        label = str(clue_names.get(clue_id) or "").strip().rstrip("。！？.!?")
        if label and label != clue_id:
            if label not in labels:
                labels.append(label)
        else:
            unknown_count += 1
    if labels:
        items = list(labels)
        if unknown_count:
            items.append(f"你还注意到{unknown_count}条尚待整理的新线索")
        return items
    if unknown_count == 1:
        return ["你注意到一条新的线索。"]
    if unknown_count > 1:
        return [f"你注意到{unknown_count}条新的线索。"]
    return []


def _keeper_turn_text(
    turn: dict[str, Any],
    clue_names: dict[str, str],
    npc_names: dict[str, str],
    *,
    previous_affordance_ids: list[str] | None = None,
) -> str:
    narration = turn.get("narration")
    if isinstance(narration, dict):
        final = narration.get("final_text")
        if isinstance(final, str) and final.strip():
            return final.strip()

    failed = [
        result
        for result in turn.get("rule_results", [])
        if isinstance(result, dict)
        and result.get("success") is False
        and not result.get("skipped")
    ]
    style = (turn.get("narrative_directives") or {}).get("player_facing_style") or {}
    play_language = (
        str(style.get("language") or "zh-Hans")
        if isinstance(style, dict) else "zh-Hans"
    )
    failure_progress = bool(failed and (turn.get("clue_revealed") or []))
    parts: list[str] = []
    parts.extend(_typed_limitation_prose(turn, play_language))
    parts.extend(_pending_choice_prose(turn))
    if not failure_progress:
        parts.extend(_successful_action_prose(turn, play_language))
    visible_choice_routes = _actionable_choice_routes(turn.get("choice_frame", {}))
    previous = set(previous_affordance_ids or [])
    surfaced_route_ids = set(
        route_id
        for route_id in [
            str(route.get("id") or route.get("route_id") or "")
            for route in visible_choice_routes
            if (
                previous_affordance_ids is None
                or str(route.get("id") or route.get("route_id") or "") not in previous
            )
        ][:2]
        if route_id
    )
    authorized_route_cues = {
        str(route.get("id") or route.get("route_id")): str(route.get("cue")).strip()
        for route in visible_choice_routes
        if str(route.get("id") or route.get("route_id") or "")
        and isinstance(route.get("cue"), str)
        and route.get("cue").strip()
    }
    if not failure_progress:
        parts.extend(
            _choice_frame_prose(
                turn.get("choice_frame", {}),
                previous_affordance_ids=previous_affordance_ids,
            )
        )
    parts.extend(_clue_reveals_prose(turn.get("clue_revealed", []), clue_names))
    if not failure_progress:
        for move in turn.get("storylet_moves", []):
            if isinstance(move, dict):
                parts.extend(
                    _storylet_prose(
                        move,
                        surfaced_route_ids=surfaced_route_ids,
                        authorized_route_cues=authorized_route_cues,
                    )
                )
        parts.extend(_npc_reaction_prose(turn.get("npc_moves", []), npc_names))
    failure = turn.get("failure_consequence") or {}
    if isinstance(failure, dict) and failure.get("narration_mode") == "withhold_exact_clue_with_cost":
        parts.append("你没能确认关键细节，时间压力逼近，只能保留另一条可查方向。")
    if failure_progress:
        resolved_policy = turn.get("resolved_clue_policy") or {}
        bonus_cost = (
            str(resolved_policy.get("bonus_cost") or "")
            if isinstance(resolved_policy, dict)
            else ""
        )
        if bonus_cost == "time":
            parts.append("关键材料虽然找到了，检索过程却出了岔子，额外时间也耗了进去。")
        elif bonus_cost == "pressure":
            parts.append("关键材料虽然找到了，检索过程却并不顺利，局势的压力随之加重。")
        else:
            parts.append("关键材料虽然找到了，这次尝试却没有完全成功，代价也随之落下。")
        parts.extend(_npc_reaction_prose(turn.get("npc_moves", []), npc_names))
    else:
        for result in failed:
            parts.append(
                _ordinary_failure_prose(result, play_language)
                or "这次尝试没有完全成功，压力仍留在场内。"
            )
    turn_number = turn.get("turn") or turn.get("turn_number") or 0
    if turn.get("scene_transition"):
        parts.append(_rotated_line(_SCENE_TRANSITION_LINES, turn_number))
    if not parts:
        parts.append(_rotated_line(_NO_NEW_CLUE_LINES, turn_number))
    return "".join(_ensure_sentence(part) for part in parts)


def _ensure_sentence(text: Any) -> str:
    value = str(text or "").strip()
    if not value:
        return ""
    if value.endswith(("。", "！", "？", ".", "!", "?", "。”", "！”", "？”", ".”", "!”", "?”")):
        return value
    return f"{value}。"


def _roll_turn_text(rule_results: list[dict[str, Any]]) -> str:
    parts = []
    for result in rule_results:
        if not isinstance(result, dict) or result.get("skipped") or "roll" not in result:
            continue
        parts.append(
            f"{result.get('skill', result.get('kind', 'check'))} "
            f"{result.get('roll', '?')} vs {result.get('target', '?')} -> {result.get('outcome', '?')}"
        )
    return "; ".join(parts) or "No roll required."


def _scene_action_label(action: Any, play_language: str = "zh-Hans") -> str:
    action_text = str(action or "director_plan")
    if play_language == "zh-Hans":
        return _SCENE_ACTION_ZH.get(action_text, action_text)
    return action_text


def _transcript_from_driver_result(
    result: dict[str, Any],
    player_choices: list[dict[str, Any]],
    campaign_dir: Path,
    play_language: str = "zh-Hans",
) -> list[dict[str, Any]]:
    clue_names = _clue_lookup(campaign_dir, play_language)
    npc_names = _npc_lookup(campaign_dir, play_language)
    transcript: list[dict[str, Any]] = []
    turn_counter = 1
    previous_affordance_ids: list[str] | None = None
    for index, turn in enumerate(result.get("turns", []), start=1):
        choice = player_choices[min(index - 1, len(player_choices) - 1)] if player_choices else {}
        player_text = str(choice.get("intent") or choice.get("text") or "继续调查。")
        transcript.append({
            "turn": turn_counter,
            "role": "player_simulator",
            "speaker": "Investigator",
            "mode": "play",
            "intent": player_text,
            "text": player_text,
        })
        turn_counter += 1
        choice_frame = turn.get("choice_frame", {}) or {}
        current_ids = _choice_frame_route_ids(choice_frame)
        transcript.append({
            "turn": turn_counter,
            "role": "keeper_under_test",
            "speaker": "KP",
            "mode": "play",
            "ruling": _scene_action_label(turn.get("action", "director_plan"), play_language),
            "text": _keeper_turn_text(
                turn,
                clue_names,
                npc_names,
                previous_affordance_ids=previous_affordance_ids,
            ),
        })
        if current_ids:
            previous_affordance_ids = current_ids
        turn_counter += 1
        roll_count = len([
            r for r in turn.get("rule_results", [])
            if isinstance(r, dict) and not r.get("skipped") and "roll" in r
        ])
        if roll_count:
            transcript.append({
                "turn": turn_counter,
                "role": "system",
                "speaker": "system",
                "mode": "roll",
                "roll_count": roll_count,
                "text": _roll_turn_text(turn.get("rule_results", [])),
            })
            turn_counter += 1
    return transcript


def _append_report_summary_events(
    campaign_dir: Path,
    result: dict[str, Any],
    player_choices: list[dict[str, Any]],
    investigator_id: str,
) -> None:
    ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    for index, turn in enumerate(result.get("turns", []), start=1):
        choice = player_choices[min(index - 1, len(player_choices) - 1)] if player_choices else {}
        intent = str(choice.get("intent") or choice.get("text") or "继续调查。")
        _append_jsonl(campaign_dir / "logs" / "events.jsonl", {
            "type": "decision",
            "actor": investigator_id,
            "payload": {"summary": intent},
            "ts": ts,
        })
    discovered = result.get("clue_coverage", {}).get("discovered", [])
    terminal_evidence = result.get("terminal_evidence") or {}
    events_path = campaign_dir / "logs" / "events.jsonl"
    persisted_ending = False
    if events_path.is_file():
        persisted_events: list[dict[str, Any]] = []
        for line in events_path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(row, dict):
                persisted_events.append(row)
        persisted_ending = bool(
            coc_scene_graph.terminal_evidence({}, {}, persisted_events).get(
                "session_ending"
            )
        )
    if bool(terminal_evidence.get("session_ending")) or persisted_ending:
        # A schema-rich ending was already emitted by the live turn.  Keep the
        # summary below as a fallback only; appending it as a second ending
        # makes reports look as though the session concluded twice.
        return
    active_scene_id = str(
        (result.get("final_state") or {}).get("active_scene") or "unknown"
    )
    story = apply_mod._read_json(
        campaign_dir / "scenario" / "story-graph.json", {"scenes": []}
    )
    active_scene = next((
        scene for scene in story.get("scenes", []) or []
        if isinstance(scene, dict) and scene.get("scene_id") == active_scene_id
    ), {})
    active_scene_display = next((
        str(active_scene.get(key)).strip()
        for key in ("display_name", "title", "player_safe_summary")
        if isinstance(active_scene.get(key), str) and active_scene[key].strip()
    ), "当前地点")
    _append_jsonl(campaign_dir / "logs" / "events.jsonl", {
        "type": "session_ending",
        "actor": "keeper_under_test",
        "payload": {
            "summary": (
                f"本次驱动实测收束：发现 {len(discovered)} 条线索；"
                f"当前停留在{active_scene_display}。"
            )
        },
        "ts": ts,
    })


def _ensure_campaign_report_files(
    campaign_dir: Path,
    investigator_id: str,
    metadata: dict[str, Any],
) -> None:
    campaign = apply_mod._read_json(campaign_dir / "campaign.json", {})
    campaign.setdefault("campaign_id", metadata.get("campaign_id", campaign_dir.name))
    campaign.setdefault("title", metadata.get("campaign_title", campaign_dir.name))
    campaign.setdefault("scenario_id", metadata.get("scenario_id", campaign.get("campaign_id", campaign_dir.name)))
    campaign.setdefault("era", metadata.get("era", "1920s"))
    campaign.setdefault("dice_mode", metadata.get("dice_mode", "codex"))
    campaign.setdefault("spoiler_policy", metadata.get("spoiler_policy", "warn_before_reveal"))
    campaign.setdefault("play_language", metadata.get("play_language", "zh-Hans"))
    _write_json(campaign_dir / "campaign.json", campaign)

    party = apply_mod._read_json(campaign_dir / "party.json", {})
    ids = list(party.get("investigator_ids", [])) if isinstance(party.get("investigator_ids"), list) else []
    if investigator_id not in ids:
        ids.append(investigator_id)
    party["investigator_ids"] = ids
    _write_json(campaign_dir / "party.json", party)

    scenario = apply_mod._read_json(campaign_dir / "scenario" / "scenario.json", {})
    scenario.setdefault("scenario_id", campaign.get("scenario_id"))
    scenario.setdefault("title", metadata.get("scenario", campaign.get("title", campaign_dir.name)))
    scenario.setdefault("module_source", metadata.get("module_source", "driver-generated scenario fixture"))
    story = apply_mod._read_json(campaign_dir / "scenario" / "story-graph.json", {"scenes": []})
    opening = ""
    if story.get("scenes"):
        opening = story["scenes"][0].get("dramatic_question") or story["scenes"][0].get("scene_id", "")
    scenario.setdefault("opening_scene", opening or "Driver playtest opening scene.")
    _write_json(campaign_dir / "scenario" / "scenario.json", scenario)


def preflight_artifact_investigator_target(
    run_dir: Path,
    investigator_id: str,
    *,
    creation_present: bool,
) -> Path:
    """Validate the selected sandbox destination without creating it."""
    if not coc_investigator_guard.is_safe_investigator_id(investigator_id):
        raise ValueError("investigator id must be a stable safe id")
    if coc_run_identity.is_anchored_path(run_dir):
        artifact_root = run_dir
    else:
        artifact_root = Path(run_dir).absolute()
    target_investigator = (
        artifact_root / "sandbox" / ".coc" / "investigators" / investigator_id
    )
    target_character = target_investigator / "character.json"
    target_creation = target_investigator / "creation.json"
    for target in (target_character, target_creation):
        if not coc_run_identity.is_anchored_path(artifact_root):
            coc_investigator_guard.validate_contained_path_parents(
                artifact_root, target
            )
        if target.is_symlink() or (target.exists() and not target.is_file()):
            raise ValueError(f"artifact target is unsafe: {target}")
    if not creation_present and target_creation.exists():
        raise ValueError(
            "artifact target contains creation evidence absent from reusable investigator"
        )
    return target_investigator


def read_artifact_investigator_snapshot(
    run_dir: Path,
    investigator_id: str,
) -> dict[str, Any]:
    """Read one historical packaged snapshot without following artifact links."""
    if not coc_investigator_guard.is_safe_investigator_id(investigator_id):
        raise ValueError("investigator ids must be stable safe ids")
    if coc_run_identity.is_anchored_path(run_dir):
        root_fd = run_dir._open_dir(run_dir.parts)
    else:
        artifact_root = Path(run_dir).absolute()
        root_fd = os.open(
            artifact_root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
        )
    try:
        investigator_fd = coc_investigator_guard._open_directory_chain(
            root_fd,
            ("sandbox", ".coc", "investigators", investigator_id),
        )
        try:
            character = coc_investigator_guard._read_json_object_at(
                investigator_fd,
                "character.json",
                "historical character sheet",
            )
            creation = coc_investigator_guard._read_json_object_at(
                investigator_fd,
                "creation.json",
                "historical creation record",
                optional=True,
            )
        finally:
            os.close(investigator_fd)
    finally:
        os.close(root_fd)
    return coc_investigator_guard.validate_investigator_snapshot(
        investigator_id, character, creation
    )


def _open_directory_at(parent_fd: int, name: str) -> int:
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    try:
        return os.open(name, flags, dir_fd=parent_fd)
    except FileNotFoundError:
        os.mkdir(name, mode=0o700, dir_fd=parent_fd)
        return os.open(name, flags, dir_fd=parent_fd)


def _stage_json_at(directory_fd: int, name: str, payload: Any) -> str:
    try:
        info = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
    except FileNotFoundError:
        info = None
    if info is not None and not stat.S_ISREG(info.st_mode):
        raise ValueError(f"artifact investigator file is unsafe: {name}")
    temporary = f".{name}.{os.getpid()}.{time.time_ns()}.tmp"
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW
    file_fd = os.open(temporary, flags, 0o600, dir_fd=directory_fd)
    try:
        content = (
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
        ).encode("utf-8")
        offset = 0
        while offset < len(content):
            offset += os.write(file_fd, content[offset:])
        os.fsync(file_fd)
    finally:
        os.close(file_fd)
    return temporary


def _publish_investigator_snapshot_no_follow(
    run_dir: Path,
    investigator_id: str,
    character: dict[str, Any],
    creation: dict[str, Any] | None,
    *,
    artifact_root_fd: int | None = None,
) -> None:
    """Publish through trusted directory handles after the narrative copy phase."""
    root_fd = (
        os.dup(artifact_root_fd)
        if artifact_root_fd is not None
        else os.open(
            Path(run_dir).absolute(),
            os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
        )
    )
    opened = [root_fd]
    stage_name = f".snapshot-stage-{investigator_id}-{os.getpid()}-{time.time_ns()}"
    parent_fd: int | None = None
    published = False
    try:
        current_fd = root_fd
        for component in ("sandbox", ".coc", "investigators"):
            current_fd = _open_directory_at(current_fd, component)
            opened.append(current_fd)
        parent_fd = current_fd
        os.mkdir(stage_name, mode=0o700, dir_fd=parent_fd)
        stage_fd = os.open(
            stage_name,
            os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
            dir_fd=parent_fd,
        )
        opened.append(stage_fd)
        payloads = [("character.json", character)]
        if creation is not None:
            payloads.append(("creation.json", creation))
        for name, payload in payloads:
            temporary = _stage_json_at(stage_fd, name, payload)
            os.replace(
                temporary,
                name,
                src_dir_fd=stage_fd,
                dst_dir_fd=stage_fd,
            )
        os.fsync(stage_fd)
        try:
            target_info = os.stat(
                investigator_id, dir_fd=parent_fd, follow_symlinks=False
            )
        except FileNotFoundError:
            target_info = None
        if target_info is None:
            os.rename(
                stage_name,
                investigator_id,
                src_dir_fd=parent_fd,
                dst_dir_fd=parent_fd,
            )
            published = True
        elif not stat.S_ISDIR(target_info.st_mode):
            raise OSError("artifact investigator target is unsafe")
        else:
            _atomic_exchange_directories(
                parent_fd, stage_name, investigator_id
            )
            published = True
            _remove_tree_at(parent_fd, stage_name)
        os.fsync(parent_fd)
    finally:
        if parent_fd is not None and not published:
            try:
                _remove_tree_at(parent_fd, stage_name)
            except FileNotFoundError:
                pass
        for directory_fd in reversed(opened):
            os.close(directory_fd)


def _atomic_exchange_directories(
    parent_fd: int, left: str, right: str
) -> None:
    libc = ctypes.CDLL(None, use_errno=True)
    if sys.platform == "darwin" and hasattr(libc, "renameatx_np"):
        rename_exchange = libc.renameatx_np
    elif hasattr(libc, "renameat2"):
        rename_exchange = libc.renameat2
    else:
        raise OSError("atomic directory exchange is unavailable")
    rename_exchange.argtypes = [
        ctypes.c_int,
        ctypes.c_char_p,
        ctypes.c_int,
        ctypes.c_char_p,
        ctypes.c_uint,
    ]
    rename_exchange.restype = ctypes.c_int
    result = rename_exchange(
        parent_fd,
        os.fsencode(left),
        parent_fd,
        os.fsencode(right),
        0x00000002,
    )
    if result != 0:
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error))


def _remove_tree_at(parent_fd: int, name: str) -> None:
    directory_fd = os.open(
        name,
        os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
        dir_fd=parent_fd,
    )
    try:
        for child in os.listdir(directory_fd):
            info = os.stat(child, dir_fd=directory_fd, follow_symlinks=False)
            if stat.S_ISDIR(info.st_mode):
                _remove_tree_at(directory_fd, child)
            else:
                os.unlink(child, dir_fd=directory_fd)
    finally:
        os.close(directory_fd)
    os.rmdir(name, dir_fd=parent_fd)


def _copy_tree_to_anchored(source: Path, target: Any) -> None:
    """Copy regular files into one descriptor-anchored run tree."""
    target.mkdir(parents=True, exist_ok=True)
    for child in source.iterdir():
        destination = target / child.name
        if child.is_symlink():
            raise ValueError(f"campaign copy source contains a symlink: {child}")
        if child.is_dir():
            _copy_tree_to_anchored(child, destination)
            continue
        if not child.is_file():
            raise ValueError(f"campaign copy source is not a regular file: {child}")
        with child.open("rb") as source_handle, destination.open("wb") as output:
            shutil.copyfileobj(source_handle, output)
            output.flush()
            os.fsync(output.fileno())


def write_playtest_artifacts(
    run_dir: Path,
    campaign_dir: Path,
    character_path: Path,
    investigator_id: str,
    player_choices: list[dict[str, Any]],
    result: dict[str, Any],
    metadata: dict[str, Any] | None = None,
    *,
    generate_report: bool = True,
    character_snapshot: dict[str, Any] | None = None,
    investigator_snapshot: dict[str, Any] | None = None,
    artifact_location_path: Path | None = None,
    artifact_root_fd: int | None = None,
) -> Path:
    """Write a reportable driver playtest artifact and return battle-report.md.

    This is a deterministic virtual-table artifact writer. It does not pretend
    to be live LLM prose; it packages the actual driver turns, roll logs, state
    events, character sheet, and narration skeleton into the standard playtest
    report contract.
    """
    metadata = dict(metadata or {})
    result = dict(result)
    if not coc_investigator_guard.is_safe_investigator_id(investigator_id):
        raise ValueError("investigator ids must be stable safe ids")
    reusable_coc_root = coc_investigator_guard.coc_root_for_campaign(
        campaign_dir
    )
    canonical_character_path = (
        Path(reusable_coc_root)
        / "investigators"
        / investigator_id
        / "character.json"
    ).absolute()
    if Path(character_path).absolute() != canonical_character_path:
        raise ValueError(
            "character_path must name the selected canonical investigator"
        )
    if investigator_snapshot is None:
        canonical_snapshot = coc_investigator_guard.read_reusable_investigator_snapshot(
            reusable_coc_root,
            investigator_id,
            character_path,
        )
        if character_snapshot is None:
            character_snapshot = canonical_snapshot["character"]
        elif character_snapshot != canonical_snapshot["character"]:
            raise ValueError(
                "supplied character snapshot disagrees with canonical investigator"
            )
        creation_snapshot = canonical_snapshot["creation"]
    else:
        if set(investigator_snapshot) != {"character", "creation"}:
            raise ValueError("investigator snapshot has an invalid shape")
        character_snapshot = investigator_snapshot["character"]
        creation_snapshot = investigator_snapshot["creation"]
    bound_snapshot = coc_investigator_guard.validate_investigator_snapshot(
        investigator_id,
        character_snapshot,
        creation_snapshot,
    )
    character_snapshot = bound_snapshot["character"]
    creation_snapshot = bound_snapshot["creation"]
    target_investigator_dir = preflight_artifact_investigator_target(
        run_dir,
        investigator_id,
        creation_present=creation_snapshot is not None,
    )
    run_dir.mkdir(parents=True, exist_ok=True)
    source_campaign = apply_mod._read_json(campaign_dir / "campaign.json", {})
    campaign_id = str(metadata.get("campaign_id") or source_campaign.get("campaign_id") or campaign_dir.name)
    result_campaign_id = result.get("campaign_id")
    if result_campaign_id is not None and result_campaign_id != campaign_id:
        raise coc_run_identity.RunIdentityError(
            "driver result and artifact metadata disagree on campaign_id"
        )
    result_run_id = result.get("run_id")
    metadata_run_id = metadata.get("run_id")
    if (
        result_run_id is not None
        and metadata_run_id is not None
        and result_run_id != metadata_run_id
    ):
        raise coc_run_identity.RunIdentityError(
            "driver result and artifact metadata disagree on run_id"
        )
    requested_run_id = result_run_id or metadata_run_id
    artifact_run_id = coc_run_identity.ensure_artifact_run_identity(
        run_dir,
        campaign_id,
        requested_run_id=(
            coc_run_identity.normalize_run_id(requested_run_id)
            if requested_run_id is not None
            else None
        ),
        artifact_location_path=artifact_location_path,
    )
    metadata["run_id"] = artifact_run_id
    result_cumulative = result.get("cumulative_run_ids")
    metadata_cumulative = metadata.get("cumulative_run_ids")
    if (
        result_cumulative is not None
        and metadata_cumulative is not None
        and result_cumulative != metadata_cumulative
    ):
        raise coc_run_identity.RunIdentityError(
            "driver result and artifact metadata disagree on cumulative_run_ids"
        )
    cumulative = (
        metadata_cumulative
        if metadata_cumulative is not None
        else result_cumulative
        if result_cumulative is not None
        else [artifact_run_id]
    )
    if (
        not isinstance(cumulative, list)
        or not cumulative
        or any(
            not isinstance(value, str)
            or not value.strip()
            or value != value.strip()
            for value in cumulative
        )
        or len(set(cumulative)) != len(cumulative)
        or cumulative[-1] != artifact_run_id
    ):
        raise coc_run_identity.RunIdentityError(
            "artifact cumulative_run_ids has an invalid run chain"
        )
    metadata["cumulative_run_ids"] = list(cumulative)
    result["campaign_id"] = campaign_id
    result["run_id"] = artifact_run_id
    result["cumulative_run_ids"] = list(cumulative)
    metadata.setdefault("campaign_id", campaign_id)
    metadata.setdefault("campaign_title", source_campaign.get("title", campaign_id))
    metadata.setdefault("scenario", source_campaign.get("title", campaign_id))
    metadata.setdefault("scenario_id", source_campaign.get("scenario_id", campaign_id))
    metadata.setdefault("module_source", "driver-generated scenario fixture")
    metadata.setdefault("era", "1920s")
    metadata.setdefault("dice_mode", "codex")
    metadata.setdefault("spoiler_policy", "warn_before_reveal")
    metadata.setdefault("play_language", "zh-Hans")
    metadata.setdefault("audit_profile", "narrative_storylet_driver")
    metadata.setdefault("player_profile", "driver_virtual_player")
    metadata.setdefault("simulation_method", "driver_executed_virtual_table_not_live_llm")
    metadata.setdefault("module_coverage", result.get("scene_path", []))
    metadata.setdefault("subsystems_covered", ["investigation", "rules", "narrative_enrichment", "storylet_engine"])
    metadata.setdefault("passed_test_cases", ["driver_turns", "actual_play_transcript", "rules_rolls", "storylet_events"])
    metadata.setdefault("failed_test_cases", [])
    metadata.setdefault("future_enhancements", ["Replace deterministic driver prose with live LLM-vs-KP turns when an LLM runner is available."])

    target_campaign_dir = run_dir / "sandbox" / ".coc" / "campaigns" / campaign_id
    if campaign_dir.resolve() != target_campaign_dir.resolve():
        if coc_run_identity.is_anchored_path(target_campaign_dir):
            _copy_tree_to_anchored(campaign_dir, target_campaign_dir)
        else:
            shutil.copytree(campaign_dir, target_campaign_dir, dirs_exist_ok=True)
    _ensure_campaign_report_files(target_campaign_dir, investigator_id, metadata)

    _publish_investigator_snapshot_no_follow(
        run_dir,
        investigator_id,
        character_snapshot,
        creation_snapshot,
        artifact_root_fd=artifact_root_fd,
    )

    transcript = _transcript_from_driver_result(
        result,
        player_choices,
        target_campaign_dir,
        str(metadata.get("play_language", "zh-Hans")),
    )
    _write_jsonl(run_dir / "transcript.jsonl", transcript)
    _append_report_summary_events(target_campaign_dir, result, player_choices, investigator_id)
    _write_jsonl(run_dir / "player-feedback.jsonl", [])
    _write_jsonl(target_campaign_dir / "memory" / "session-summaries.jsonl", [{
        "session_id": "driver-session-1",
        "summary": (
            "本次驱动实测记录了玩家选择、KP回应、规则掷骰、线索发现、NPC反应和剧情片段调度。"
        ),
    }])
    _write_json(run_dir / "playtest.json", metadata)
    _write_json(run_dir / "driver-result.json", result)
    if generate_report:
        return playtest_report.generate_battle_report(run_dir)
    return run_dir / "artifacts" / "battle-report.md"


def _project_driver_turn(live_turn: dict[str, Any], turn_num: int) -> dict[str, Any]:
    """Project a run_live_turn internal turn into the driver session record shape."""
    directives = live_turn.get("narrative_directives") or {}
    envelope = live_turn.get("narration_envelope") or {}
    return {
        "turn": turn_num,
        "decision_id": live_turn.get("decision_id"),
        "scene_id": live_turn.get("scene_id"),
        "action": live_turn.get("action"),
        "pipeline": live_turn.get("pipeline") or "run_live_turn",
        "apply_path": live_turn.get("apply_path"),
        "clue_revealed": list(live_turn.get("clue_revealed") or []),
        "rule_results": live_turn.get("rule_results") or [],
        "public_roll_block": live_turn.get("public_roll_block") or {},
        "subsystem_results": live_turn.get("subsystem_results") or [],
        "pending_choice": live_turn.get("pending_choice"),
        "blocked_by_pending_choice": bool(live_turn.get("blocked_by_pending_choice")),
        "resolved_clue_policy": live_turn.get("resolved_clue_policy") or {},
        "failure_consequence": live_turn.get("failure_consequence"),
        "choice_frame": live_turn.get("choice_frame") or {},
        "proposal_transform": live_turn.get("proposal_transform"),
        "scene_exit_pressure": live_turn.get("scene_exit_pressure"),
        "idea_roll_plan": live_turn.get("idea_roll_plan"),
        "roll_density_decisions": live_turn.get("roll_density_decisions") or [],
        "storylet_moves": live_turn.get("storylet_moves") or [],
        "incident_moves": live_turn.get("incident_moves") or [],
        "narrative_enrichment": live_turn.get("narrative_enrichment") or {},
        "narrative_directives": directives,
        "rules_requests": live_turn.get("rules_requests") or [],
        "npc_moves": live_turn.get("npc_moves") or [],
        "narration_envelope": envelope,
        # Player-visible final prose lives under narration.final_text (filled by
        # live_match / callers). Do not alias the envelope here.
        "narration": dict(live_turn.get("narration") or {}),
        "tension": live_turn.get("tension") or live_turn.get("tension_after"),
        "horror_stage": live_turn.get("horror_stage") or directives.get("horror_escalation_stage"),
        "events_count": live_turn.get("events_count", 0),
        "event_types": list(live_turn.get("event_types") or []),
        "scene_transition": bool(live_turn.get("scene_transition")),
        "dramatic_question": live_turn.get("dramatic_question", ""),
    }


def run_full_session(
    campaign_dir: Path,
    character_path: Path,
    investigator_id: str,
    player_choices: list[dict[str, Any]],
    max_turns: int = 20,
    rng_seed: int = 42,
    run_id: str | None = None,
) -> dict[str, Any]:
    """Run a multi-turn session by wrapping ``run_live_turn`` once per choice.

    player_choices is a list of {intent, intent_class, signal_overrides?}. If fewer
    choices than max_turns, the last choice repeats. If more, extra are ignored.

    Driver-only concerns (scripted choice feed, shared RNG, report aggregation)
    stay here. Pipeline stages live exclusively in ``run_live_turn``.
    """
    live_runner = _live_turn_runner()
    session_run_id = (
        coc_run_identity.normalize_run_id(run_id)
        if run_id is not None
        else coc_run_identity.mint_run_id()
    )
    rng = random.Random(rng_seed)
    turns: list[dict[str, Any]] = []
    tension_curve: list[Any] = []
    scene_path: list[str] = []

    campaign_meta = apply_mod._read_json(campaign_dir / "campaign.json", {})
    campaign_id = str(
        campaign_meta.get("campaign_id")
        if isinstance(campaign_meta, dict) and campaign_meta.get("campaign_id")
        else campaign_dir.name
    )

    story = apply_mod._read_json(campaign_dir / "scenario" / "story-graph.json", {"scenes": []})
    clue_graph = apply_mod._read_json(campaign_dir / "scenario" / "clue-graph.json", {"conclusions": []})
    total_clues = set()
    for concl in clue_graph.get("conclusions", []):
        for cl in concl.get("clues", []):
            total_clues.add(cl.get("clue_id"))
    for offset in range(max_turns):
        choice = player_choices[min(offset, len(player_choices) - 1)]
        player_intent_rich = choice.get("player_intent_rich")
        intent_class = choice.get("intent_class") or (player_intent_rich or {}).get("primary_intent")
        player_text = str(choice.get("intent") or choice.get("text") or choice.get("player_text") or "...")

        live_result = live_runner.run_live_turn(
            campaign_dir,
            character_path,
            investigator_id,
            player_text,
            run_id=session_run_id,
            intent_class=str(intent_class) if intent_class else None,
            player_intent_rich=player_intent_rich,
            pending_choice_response=(
                choice.get("pending_choice_response")
                if isinstance(choice.get("pending_choice_response"), dict)
                else None
            ),
            subsystem_request=(
                choice.get("subsystem_request")
                if isinstance(choice.get("subsystem_request"), dict)
                else None
            ),
            max_auto_advance=1,
            auto_advance_low_agency=False,
            recording_mode="sync",
            recording_flush="manual",
            rng=rng,
            storylet_policy=choice.get("storylet_policy") if isinstance(choice.get("storylet_policy"), dict) else None,
            storylet_library=choice.get("storylet_library") if isinstance(choice.get("storylet_library"), dict) else None,
            incident_deck=choice.get("incident_deck") if isinstance(choice.get("incident_deck"), dict) else None,
            signal_overrides=choice.get("signal_overrides") if isinstance(choice.get("signal_overrides"), dict) else None,
        )

        for live_turn in live_result.get("turns") or []:
            decision_id = str(live_turn.get("decision_id") or "")
            turn_num = _decision_turn_number(decision_id) or (len(turns) + 1)
            projected = _project_driver_turn(live_turn, turn_num)
            turns.append(projected)

            current_scene = projected.get("scene_id") or "?"
            if not scene_path or scene_path[-1] != current_scene:
                scene_path.append(str(current_scene))

            tension = projected.get("tension") or "low"
            tension_curve.append(tension)

        if subsystem_executor.get_current_pending_choice(campaign_dir) is not None:
            next_offset = offset + 1
            has_typed_continuation = (
                next_offset < max_turns
                and next_offset < len(player_choices)
                and isinstance(
                    player_choices[next_offset].get("pending_choice_response"),
                    dict,
                )
            )
            if not has_typed_continuation:
                break

        world = apply_mod._read_json(campaign_dir / "save" / "world-state.json", {})
        turn_terminal = coc_scene_graph.terminal_evidence(story, world, live_result)
        if turn_terminal["session_ending"]:
            break

    world_final = apply_mod._read_json(
        campaign_dir / "save" / "world-state.json", {}
    )
    discovered_final = world_final.get("discovered_clue_ids", [])
    ending_evidence = coc_scene_graph.terminal_evidence(story, world_final, turns)
    return {
        "campaign_id": campaign_id,
        "run_id": session_run_id,
        "cumulative_run_ids": [session_run_id],
        "turns": turns,
        "subsystem_results": [
            subsystem_result
            for turn in turns
            for subsystem_result in (turn.get("subsystem_results") or [])
            if isinstance(subsystem_result, dict)
        ],
        "pending_choice": subsystem_executor.get_current_pending_choice(campaign_dir),
        "final_state": {
            "active_scene": world_final.get("active_scene_id"),
            "discovered_clues": discovered_final,
            "tension": apply_mod._read_json(campaign_dir / "save" / "pacing-state.json", {}).get("tension_level"),
        },
        "clue_coverage": {
            "discovered_count": len(discovered_final),
            "total_in_graph": len(total_clues),
            "discovered": discovered_final,
        },
        "tension_curve": tension_curve,
        "scene_path": scene_path,
        # Driver navigation coverage historically reports reaching a graph
        # leaf even before a PAYOFF emits session_ending. Keep that convenience
        # separate from terminal_evidence.reached_terminal, whose public
        # completion semantics remain structured-session-ending only.
        "reached_terminal": bool(
            ending_evidence["graph_terminal"]
            or ending_evidence["session_ending"]
        ),
        "terminal_evidence": ending_evidence,
        "pipeline": "run_live_turn",
        "simulation_method": "driver_executed_virtual_table_not_live_llm",
    }


def _main() -> int:
    ap = argparse.ArgumentParser(description="Multi-turn playtest driver")
    ap.add_argument("campaign_dir", help="path to campaign directory")
    ap.add_argument("character_path", help="path to character.json")
    ap.add_argument("investigator_id", help="investigator id")
    ap.add_argument("--choices", required=True, help="JSON file with player choices list")
    ap.add_argument("--max-turns", type=int, default=20)
    ap.add_argument("--rng-seed", type=int, default=42)
    ap.add_argument("-o", "--output", help="write session report JSON to this path")
    args = ap.parse_args()

    choices = json.loads(Path(args.choices).read_text(encoding="utf-8"))
    result = run_full_session(
        Path(args.campaign_dir), Path(args.character_path), args.investigator_id,
        choices, max_turns=args.max_turns, rng_seed=args.rng_seed,
    )

    if args.output:
        Path(args.output).write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"Wrote session report to {args.output}", file=sys.stderr)

    # print summary
    print(f"Turns: {len(result['turns'])}")
    print(f"Scene path: {' → '.join(result['scene_path'])}")
    print(f"Clue coverage: {result['clue_coverage']['discovered_count']}/{result['clue_coverage']['total_in_graph']}")
    print(f"Tension curve: {result['tension_curve']}")
    print(f"Reached terminal: {result['reached_terminal']}")
    return 0


if __name__ == "__main__":
    sys.exit(_main())
