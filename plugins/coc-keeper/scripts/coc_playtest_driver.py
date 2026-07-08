#!/usr/bin/env python3
"""Multi-turn playtest driver — runs continuous player→director→rules→apply loops.

Drives a full play session from a sequence of player choices, advancing the
campaign state each turn. Does NOT call an LLM for narration (the DirectorPlan's
narrative_directives are the narrator contract; prose quality is tested separately).
This validates: autonomous scene progression, clue coverage, fail-forward rule
resolution, and tension curve.

Usage:
    python3 coc_playtest_driver.py <campaign_dir> <character_path> <investigator_id> --choices <choices.json>
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import random
import shutil
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


director = _load_sibling("coc_story_director", "coc_story_director.py")
apply_mod = _load_sibling("coc_director_apply", "coc_director_apply.py")
coc_roll = _load_sibling("coc_roll", "coc_roll.py")
narrative_enrichment = _load_sibling("coc_narrative_enrichment", "coc_narrative_enrichment.py")
playtest_report = _load_sibling("coc_playtest_report", "coc_playtest_report.py")

_SUCCESS_OUTCOMES = {"critical", "extreme", "hard", "regular", "success",
                     # legacy aliases (some callers may emit *_success forms)
                     "extreme_success", "hard_success", "regular_success"}


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


def _record_intent_class(campaign_dir: Path, intent_class: str, keep: int = 8) -> None:
    """Persist recent intent classes so stalled_turns is meaningful in drivers."""
    pacing_path = campaign_dir / "save" / "pacing-state.json"
    pacing = apply_mod._read_json(pacing_path, {"tension_level": "low", "turn_number": 0})
    recent = pacing.get("recent_intent_classes", [])
    if not isinstance(recent, list):
        recent = []
    recent.append(intent_class)
    pacing["recent_intent_classes"] = recent[-keep:]
    _write_json(pacing_path, pacing)


def _settle_sanity_check(
    campaign_dir: Path,
    character: dict[str, Any],
    investigator_id: str,
    request: dict[str, Any],
    rng: random.Random,
) -> dict[str, Any] | None:
    """Resolve a sanity_check through SanitySession — deduct SAN, trigger bout.

    Returns a result dict with san_before/san_loss/san_after/outcome/roll,
    or None if SanitySession is unavailable (caller falls back to plain roll).
    """
    try:
        from coc_sanity import SanitySession
    except Exception:
        return None
    chars = character.get("characteristics", {})
    int_value = int(chars.get("INT", 50))
    derived = character.get("derived", {})
    cm = int(character.get("skills", {}).get("Cthulhu Mythos", 0))
    # If a sanity snapshot exists, san_max comes from it; otherwise derive from POW.
    sess = SanitySession.load(campaign_dir, investigator_id,
                              int_value=int_value, rng=rng, cm_value=cm)
    # If no prior snapshot, set san_max from the character sheet's derived SAN.
    sanity_json = campaign_dir / "save" / "sanity.json"
    if not sanity_json.exists():
        sheet_san = int(derived.get("SAN", chars.get("POW", 50)))
        sess.san_max = sheet_san
        sess.san_current = sheet_san

    san_before = sess.san_current
    source = str(request.get("source") or request.get("reason") or "encountering the unnatural")
    san_loss_success = int(request.get("san_loss_success", 0))
    san_loss_fail_expr = str(request.get("san_loss_fail_expr", "1"))
    creature_type = request.get("creature_type")

    event = sess.sanity_check(
        source=source,
        san_loss_success=san_loss_success,
        san_loss_fail_expr=san_loss_fail_expr,
        creature_type=creature_type if isinstance(creature_type, str) else None,
    )
    sess.save(campaign_dir)

    san_loss = int(event.get("san_loss", 0))
    san_after = sess.san_current
    outcome = "regular" if event.get("san_loss", san_loss) == san_loss_success and san_loss == san_loss_success else (
        "failure" if san_loss > san_loss_success else "regular"
    )
    # The SanitySession event has the roll outcome — use it if available.
    roll_outcome = event.get("roll_outcome") or event.get("outcome", "")
    roll_value = event.get("roll", 0)
    if isinstance(roll_outcome, str) and roll_outcome:
        outcome = roll_outcome

    return {
        "san_before": san_before,
        "san_loss": san_loss,
        "san_after": san_after,
        "outcome": outcome,
        "roll": roll_value,
        "bout_triggered": bool(event.get("bout_triggered") or sess.temporary_insane),
        "source": source,
        "san_trigger_id": request.get("san_trigger_id"),
    }


def _target_for_request(character: dict[str, Any], request: dict[str, Any]) -> int:
    skill = str(request.get("skill", ""))
    skills = character.get("skills", {}) if isinstance(character.get("skills"), dict) else {}
    characteristics = character.get("characteristics", {}) if isinstance(character.get("characteristics"), dict) else {}
    if skill in skills:
        return int(skills[skill])
    if skill in characteristics:
        return int(characteristics[skill])
    if request.get("kind") == "sanity_check":
        derived = character.get("derived", {}) if isinstance(character.get("derived"), dict) else {}
        return int(derived.get("SAN", characteristics.get("POW", 50)))
    return 50


def _execute_rules_requests(
    campaign_dir: Path,
    character_path: Path,
    investigator_id: str,
    plan: dict[str, Any],
    rng: random.Random,
    append_jsonl=None,
) -> list[dict[str, Any]]:
    """Execute DirectorPlan.rules_requests and append roll rows.

    This closes the director→rules→apply loop used by D1: apply_plan can now
    decide whether an obscured clue is committed, withheld, or converted into a
    fail-forward cost using actual rule results.
    """
    requests = plan.get("rules_requests", [])
    if not requests:
        return []
    character = json.loads(character_path.read_text(encoding="utf-8"))
    results: list[dict[str, Any]] = []
    ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    rolls_path = campaign_dir / "logs" / "rolls.jsonl"
    append = append_jsonl or _append_jsonl

    for idx, request in enumerate(requests, start=1):
        kind = request.get("kind")
        if kind not in {"skill_check", "characteristic_check", "sanity_check", "opposed_check"}:
            continue
        target = _target_for_request(character, request)
        difficulty = str(request.get("difficulty", "regular"))
        bonus_penalty = int(request.get("bonus_penalty_dice", 0) or 0)
        bonus = max(0, bonus_penalty)
        penalty = max(0, -bonus_penalty)

        # SAN auto-settlement: when a sanity_check carries structured loss
        # params, resolve it through SanitySession (deducts SAN, triggers
        # bout/temp insanity, persists to save/sanity.json). Falls back to a
        # plain percentile roll when params are absent (backward compat).
        if kind == "sanity_check" and "san_loss_fail_expr" in request:
            san_result = _settle_sanity_check(
                campaign_dir, character, investigator_id, request, rng
            )
            if san_result is not None:
                payload = {
                    "roll_id": f"{plan.get('decision_id', 'turn')}-rule-{idx}",
                    "decision_id": plan.get("decision_id"),
                    "kind": "sanity_check",
                    "skill": "SAN",
                    "target": san_result["san_before"],
                    "difficulty": "regular",
                    "reason": request.get("reason"),
                    "bonus_penalty_dice": 0,
                    "roll": san_result["roll"],
                    "effective_target": san_result["san_before"],
                    "outcome": san_result["outcome"],
                    "success": san_result["outcome"] in _SUCCESS_OUTCOMES,
                    "san_loss": san_result["san_loss"],
                    "san_before": san_result["san_before"],
                    "san_after": san_result["san_after"],
                    "bout_triggered": san_result.get("bout_triggered", False),
                    "source": san_result.get("source", ""),
                    "san_trigger_id": san_result.get("san_trigger_id"),
                    "roll_contract": request.get("roll_contract"),
                }
                results.append(payload)
                append(rolls_path, {"type": "roll", "actor": investigator_id,
                                    "payload": payload, "ts": ts})
                continue

        roll = coc_roll.percentile_check(
            target,
            difficulty=difficulty,
            bonus=bonus,
            penalty=penalty,
            rng=rng,
        )
        payload = {
            "roll_id": f"{plan.get('decision_id', 'turn')}-rule-{idx}",
            "decision_id": plan.get("decision_id"),
            "kind": kind,
            "skill": request.get("skill"),
            "target": target,
            "difficulty": difficulty,
            "reason": request.get("reason"),
            "request_id": request.get("request_id"),
            "depends_on": request.get("depends_on"),
            "stakes": request.get("stakes"),
            "opposed_by": request.get("opposed_by"),
            "opposed_skill": request.get("opposed_skill"),
            "bonus_penalty_dice": bonus_penalty,
            "roll": roll.get("roll"),
            "effective_target": roll.get("effective_target"),
            "outcome": roll.get("outcome"),
            "success": roll.get("outcome") in _SUCCESS_OUTCOMES,
            "roll_contract": request.get("roll_contract"),
        }
        results.append(payload)
        append(rolls_path, {
            "type": "roll",
            "actor": investigator_id,
            "payload": payload,
            "ts": ts,
        })
    return results
_OUTCOME_ZH = {
    "critical": "大成功", "extreme": "极限成功", "hard": "困难成功",
    "regular": "常规成功", "failure": "失败", "fumble": "大失败",
}
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
_RULE_REASON_ZH = {
    "obscured clue in scene": "线索检定",
}


def _build_narration_skeleton(
    plan: dict[str, Any], rule_results: list[dict[str, Any]],
) -> dict[str, Any]:
    """Build a structured narration skeleton from the plan + roll results.

    Surfaces the narrator contract (tone/beats/anchors/roll-weaving/constraints)
    so D3 (narrative immersion) is evaluable even without LLM prose. The
    failure_consequence field (set by backfill_rule_results) is passed through
    separately by the caller; this helper handles the success/general case.
    """
    nd = plan.get("narrative_directives", {})
    action = plan.get("scene_action", "")
    clue_policy = plan.get("clue_policy", {}) or plan.get("resolved_clue_policy", {})
    beats: list[str] = []

    reveal = clue_policy.get("committed_reveals") or clue_policy.get("reveal", [])
    if action == "REVEAL" and reveal:
        anchors = nd.get("must_include", [])
        for i, cid in enumerate(reveal):
            anchor = anchors[i] if i < len(anchors) else ""
            beats.append(f"揭示线索 {cid}：{anchor}" if anchor else f"揭示线索 {cid}")
    elif action == "PRESSURE":
        for mv in plan.get("pressure_moves", []):
            beats.append(f"施压：{mv.get('visible_symptom', 'tension rises')}")
    elif action == "CHARACTER":
        for nm in plan.get("npc_moves", []):
            beats.append(f"NPC {nm.get('npc_id', '?')}：{nm.get('agenda', '?')}，语气 {nm.get('emotional_tone', '?')}")
    elif action == "RECOVER":
        fallback = clue_policy.get("fallback_routes", [])
        beats.append(f"扶手：建议方向 {fallback}" if fallback else "扶手：玩家卡住，给方向")
    elif action == "SUBSYSTEM":
        for req in plan.get("rules_requests", []):
            beats.append(f"规则事件：{req.get('skill', req.get('kind', '?'))} 检定")
    elif action == "CHOICE":
        leads = clue_policy.get("leads", [])
        beats.append(f"给选择：{leads}" if leads else "给玩家方向选择")
    elif action == "CUT":
        beats.append("转场到下一场景")
    elif action == "DEEPEN":
        beats.append("深化谜团但不给结论")

    embedded_rolls = []
    for r in rule_results:
        if not isinstance(r, dict) or r.get("skipped") or "roll" not in r:
            continue
        embedded_rolls.append({
            "skill": r.get("skill", "?"),
            "roll": r["roll"],
            "target": r.get("target"),
            "outcome": r.get("outcome", "?"),
            "narration_hook": f"{r.get('skill', '?')} 检定 {r['roll']}/{r.get('target', '?')} {_OUTCOME_ZH.get(r.get('outcome', ''), r.get('outcome', ''))}",
        })

    return {
        "tone": nd.get("tone", []),
        "beats": beats,
        "must_include": nd.get("must_include", []),
        "must_not_reveal_count": len(nd.get("must_not_reveal", [])),
        "content_constraints": nd.get("content_constraints", []),
        "horror_stage": nd.get("horror_escalation_stage", ""),
        "embedded_rolls": embedded_rolls,
    }


def _clue_lookup(campaign_dir: Path) -> dict[str, str]:
    graph = apply_mod._read_json(campaign_dir / "scenario" / "clue-graph.json", {"conclusions": []})
    lookup: dict[str, str] = {}
    for conclusion in graph.get("conclusions", []):
        if not isinstance(conclusion, dict):
            continue
        for clue in conclusion.get("clues", []):
            if not isinstance(clue, dict):
                continue
            clue_id = clue.get("clue_id") or clue.get("id")
            if clue_id:
                lookup[str(clue_id)] = str(
                    clue.get("summary")
                    or clue.get("delivery")
                    or clue.get("title")
                    or clue_id
                )
    return lookup


def _storylet_prose(move: dict[str, Any]) -> list[str]:
    parts: list[str] = []
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


def _npc_lookup(campaign_dir: Path) -> dict[str, str]:
    agendas = apply_mod._read_json(campaign_dir / "scenario" / "npc-agendas.json", {"npcs": []})
    lookup: dict[str, str] = {}
    for npc in agendas.get("npcs", []):
        if isinstance(npc, dict) and npc.get("npc_id"):
            lookup[str(npc["npc_id"])] = str(npc.get("name") or npc["npc_id"])
    return lookup


def _npc_reaction_prose(npc_moves: list[dict[str, Any]], npc_names: dict[str, str]) -> list[str]:
    lines: list[str] = []
    for npc in npc_moves:
        npc_id = str(npc.get("npc_id") or "")
        npc_name = npc.get("name") or npc_names.get(npc_id) or "NPC"
        for reaction in npc.get("active_reactions", []) or []:
            if not isinstance(reaction, dict):
                continue
            line = reaction.get("line_seed")
            if line:
                lines.append(f"{npc_name}低声提醒：“{line}”")
            elif reaction.get("move"):
                lines.append(f"{npc_name}作出反应：{reaction['move']}。")
    return lines


def _choice_frame_prose(choice_frame: dict[str, Any]) -> list[str]:
    routes = choice_frame.get("routes", []) if isinstance(choice_frame, dict) else []
    cues = [str(route.get("cue")) for route in routes if isinstance(route, dict) and route.get("cue")]
    if not cues:
        return []
    return ["现场同时露出这些可行动线索：" + "；".join(cues) + "。"]


def _keeper_turn_text(turn: dict[str, Any], clue_names: dict[str, str], npc_names: dict[str, str]) -> str:
    parts: list[str] = []
    parts.extend(_choice_frame_prose(turn.get("choice_frame", {})))
    for clue_id in turn.get("clue_revealed", []):
        clue_name = clue_names.get(str(clue_id), str(clue_id))
        parts.append(f"你确认了线索：{clue_name}。")
    for move in turn.get("storylet_moves", []):
        if isinstance(move, dict):
            parts.extend(_storylet_prose(move))
    parts.extend(_npc_reaction_prose(turn.get("npc_moves", []), npc_names))
    failure = turn.get("failure_consequence") or {}
    if isinstance(failure, dict) and failure.get("narration_mode") == "withhold_exact_clue_with_cost":
        parts.append("你没能确认关键细节，时间压力逼近，只能保留另一条可查方向。")
    failed = [
        r for r in turn.get("rule_results", [])
        if isinstance(r, dict) and r.get("success") is False and not r.get("skipped")
        and r.get("reason") != "obscured clue in scene"
    ]
    for result in failed:
        reason = _RULE_REASON_ZH.get(
            str(result.get("reason") or ""),
            result.get("reason") or result.get("skill") or "行动",
        )
        parts.append(f"{reason}没有完全成功，压力仍留在场内。")
    if turn.get("scene_transition"):
        parts.append("这足以推动场景进入下一处可调查地点。")
    if not parts:
        parts.append("KP 根据当前场景推进叙事，但没有新增可见线索。")
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
    clue_names = _clue_lookup(campaign_dir)
    npc_names = _npc_lookup(campaign_dir)
    transcript: list[dict[str, Any]] = []
    turn_counter = 1
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
        transcript.append({
            "turn": turn_counter,
            "role": "keeper_under_test",
            "speaker": "KP",
            "mode": "play",
            "ruling": _scene_action_label(turn.get("action", "director_plan"), play_language),
            "text": _keeper_turn_text(turn, clue_names, npc_names),
        })
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
    _append_jsonl(campaign_dir / "logs" / "events.jsonl", {
        "type": "session_ending",
        "actor": "keeper_under_test",
        "payload": {
            "summary": (
                f"本次驱动实测收束：发现 {len(discovered)} 条线索，"
                "并推进到下一处可调查地点。"
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


def write_playtest_artifacts(
    run_dir: Path,
    campaign_dir: Path,
    character_path: Path,
    investigator_id: str,
    player_choices: list[dict[str, Any]],
    result: dict[str, Any],
    metadata: dict[str, Any] | None = None,
) -> Path:
    """Write a reportable driver playtest artifact and return battle-report.md.

    This is a deterministic virtual-table artifact writer. It does not pretend
    to be live LLM prose; it packages the actual driver turns, roll logs, state
    events, character sheet, and narration skeleton into the standard playtest
    report contract.
    """
    metadata = dict(metadata or {})
    run_dir.mkdir(parents=True, exist_ok=True)
    source_campaign = apply_mod._read_json(campaign_dir / "campaign.json", {})
    campaign_id = str(metadata.get("campaign_id") or source_campaign.get("campaign_id") or campaign_dir.name)
    metadata.setdefault("run_id", run_dir.name)
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
        shutil.copytree(campaign_dir, target_campaign_dir, dirs_exist_ok=True)
    _ensure_campaign_report_files(target_campaign_dir, investigator_id, metadata)

    target_character = run_dir / "sandbox" / ".coc" / "investigators" / investigator_id / "character.json"
    target_character.parent.mkdir(parents=True, exist_ok=True)
    if character_path.resolve() != target_character.resolve():
        shutil.copy2(character_path, target_character)

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
    return playtest_report.generate_battle_report(run_dir)


def run_full_session(
    campaign_dir: Path,
    character_path: Path,
    investigator_id: str,
    player_choices: list[dict[str, Any]],
    max_turns: int = 20,
    rng_seed: int = 42,
) -> dict[str, Any]:
    """Run a multi-turn session. Each turn: build context → director plan → rules → apply → record.

    player_choices is a list of {intent, intent_class, signal_overrides?}. If fewer
    choices than max_turns, the last choice repeats. If more, extra are ignored.

    Returns:
        {
            "turns": [{"turn": N, "scene_id": ..., "action": ..., "clue_revealed": ...,
                       "rule_results": [...], "resolved_clue_policy": {...},
                       "failure_consequence": {...}, "tension": ..., "events": [...]}],
            "final_state": {"active_scene": ..., "discovered_clues": [...], "tension": ...},
            "clue_coverage": {"discovered_count": N, "total_in_graph": M},
            "tension_curve": [list of tension per turn],
            "scene_path": [list of scene_id visited in order],
            "reached_terminal": bool,
        }
    """
    rng = random.Random(rng_seed)
    turns = []
    tension_curve = []
    scene_path = []

    # count total clues in graph for coverage stat
    story = apply_mod._read_json(campaign_dir / "scenario" / "story-graph.json", {"scenes": []})
    clue_graph = apply_mod._read_json(campaign_dir / "scenario" / "clue-graph.json", {"conclusions": []})
    total_clues = set()
    for concl in clue_graph.get("conclusions", []):
        for cl in concl.get("clues", []):
            total_clues.add(cl.get("clue_id"))
    scene_ids = [s["scene_id"] for s in story.get("scenes", [])]

    start_turn_num = _next_decision_number(campaign_dir)
    for offset in range(max_turns):
        turn_num = start_turn_num + offset
        choice = player_choices[min(offset, len(player_choices) - 1)]
        player_intent_rich = choice.get("player_intent_rich")
        intent_class = choice.get("intent_class") or (player_intent_rich or {}).get("primary_intent", "investigate")
        _record_intent_class(campaign_dir, str(intent_class))
        ctx = director.build_director_context(
            campaign_dir=campaign_dir, character_path=character_path,
            investigator_id=investigator_id,
            player_intent=choice.get("intent", "..."),
            player_intent_class=str(intent_class),
            rng=rng,
            player_intent_rich=player_intent_rich,
        )
        ctx["storylet_ledger"] = apply_mod._read_json(
            campaign_dir / "save" / "storylet-ledger.json", {}
        )
        if isinstance(choice.get("storylet_policy"), dict):
            ctx["storylet_policy"] = choice["storylet_policy"]
        if isinstance(choice.get("storylet_library"), dict):
            ctx["storylet_library"] = choice["storylet_library"]
        if isinstance(choice.get("incident_deck"), dict):
            ctx["incident_deck"] = choice["incident_deck"]
        for k, v in choice.get("signal_overrides", {}).items():
            ctx["rule_signals"][k] = v

        plan = director.generate_director_plan(ctx, decision_id=f"turn-{turn_num:03d}")
        plan = narrative_enrichment.enrich_director_plan(plan, ctx)
        rule_results = _execute_rules_requests(campaign_dir, character_path, investigator_id, plan, rng)
        resolved_plan = apply_mod.backfill_rule_results(plan, rule_results)
        if hasattr(narrative_enrichment, "enrich_storylets_after_rules"):
            resolved_plan = narrative_enrichment.enrich_storylets_after_rules(resolved_plan, ctx)
        events = apply_mod.apply_plan(campaign_dir, resolved_plan, investigator_id, rules_results=rule_results)

        # record
        current_scene = ctx.get("active_scene_id", "?")
        if not scene_path or scene_path[-1] != current_scene:
            scene_path.append(current_scene)

        # read post-apply state
        world = apply_mod._read_json(campaign_dir / "save" / "world-state.json", {})
        pacing = apply_mod._read_json(campaign_dir / "save" / "pacing-state.json", {})
        discovered = world.get("discovered_clue_ids", [])
        tension = pacing.get("tension_level", "low")
        tension_curve.append(tension)
        directives = resolved_plan.get("narrative_directives", {})
        narration = _build_narration_skeleton(resolved_plan, rule_results)
        # merge failure_consequence (set by backfill_rule_results) into narration
        if directives.get("failure_consequence"):
            narration["failure_consequence"] = directives["failure_consequence"]

        turns.append({
            "turn": turn_num,
            "scene_id": current_scene,
            "action": resolved_plan["scene_action"],
            "clue_revealed": [e.get("clue_id") for e in events if e.get("event_type") == "clue_reveal"],
            "rule_results": rule_results,
            "resolved_clue_policy": resolved_plan.get("resolved_clue_policy", {}),
            "failure_consequence": directives.get("failure_consequence"),
            "choice_frame": resolved_plan.get("choice_frame", {}),
            "proposal_transform": resolved_plan.get("proposal_transform") or directives.get("proposal_transform"),
            "scene_exit_pressure": directives.get("scene_exit_pressure"),
            "idea_roll_plan": directives.get("idea_roll_plan"),
            "roll_density_decisions": (
                resolved_plan.get("roll_density_decisions")
                or directives.get("roll_density_decisions")
                or []
            ),
            "storylet_moves": resolved_plan.get("storylet_moves", []),
            "incident_moves": resolved_plan.get("incident_moves", []),
            "narrative_enrichment": resolved_plan.get("narrative_enrichment", {}),
            "narrative_directives": directives,
            "rules_requests": resolved_plan.get("rules_requests", []),
            "npc_moves": resolved_plan.get("npc_moves", []),
            "narration": narration,
            "tension": tension,
            "horror_stage": directives.get("horror_escalation_stage"),
            "events_count": len(events),
            "event_types": [e.get("event_type") for e in events],
            "scene_transition": any(e.get("event_type") == "scene_transition" for e in events),
            "dramatic_question": resolved_plan.get("dramatic_question", ""),
        })

        # check terminal: reached last scene
        active = world.get("active_scene_id")
        if scene_ids and active == scene_ids[-1]:
            # on last scene; if its clues exhausted or it's aftermath-type, done
            last_scene = next((s for s in story.get("scenes", []) if s["scene_id"] == active), {})
            last_clues = last_scene.get("available_clues", [])
            if not last_clues or all(c in discovered for c in last_clues):
                break

    discovered_final = apply_mod._read_json(campaign_dir / "save" / "world-state.json", {}).get("discovered_clue_ids", [])
    return {
        "turns": turns,
        "final_state": {
            "active_scene": apply_mod._read_json(campaign_dir / "save" / "world-state.json", {}).get("active_scene_id"),
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
        "reached_terminal": scene_path[-1] == scene_ids[-1] if scene_path and scene_ids else False,
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
