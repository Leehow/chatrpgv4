#!/usr/bin/env python3
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any


SCENE_REPLAY_EVENT_TYPES = {"scene", "clue", "damage", "sanity", "combat", "chase", "session_ending"}
CJK_BOUNDARY_SPACE = re.compile(r"(?<=[\u4e00-\u9fff·》」』”）]) (?=[\u4e00-\u9fff《「『“（])")
ZH_HANS_OUTCOME_LABELS = {
    "critical": "大成功",
    "extreme_success": "极难成功",
    "hard_success": "困难成功",
    "regular_success": "普通成功",
    "success": "成功",
    "failure": "失败",
    "fumble": "大失败",
}
ZH_HANS_DIFFICULTY_LABELS = {
    "regular": "普通",
    "hard": "困难",
    "extreme": "极难",
    "opposed": "对抗",
    "combined": "联合",
    "sanity": "理智",
}


def _read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    events: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            events.append(json.loads(line))
    return events


def _read_jsonl_files(paths: list[Path]) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for path in paths:
        events.extend(_read_jsonl(path))
    return events


def _campaign_log_paths(run_dir: Path, log_name: str) -> list[Path]:
    sandbox = run_dir / "sandbox" / ".coc" / "campaigns"
    if not sandbox.exists():
        return []
    return sorted(sandbox.glob(f"*/logs/{log_name}"))


def _campaign_memory_paths(run_dir: Path, memory_name: str) -> list[Path]:
    sandbox = run_dir / "sandbox" / ".coc" / "campaigns"
    if not sandbox.exists():
        return []
    return sorted(sandbox.glob(f"*/memory/{memory_name}"))


def _campaign_dirs(run_dir: Path) -> list[Path]:
    sandbox = run_dir / "sandbox" / ".coc" / "campaigns"
    if not sandbox.exists():
        return []
    return sorted(path for path in sandbox.iterdir() if path.is_dir())


def _select_campaign_dir(run_dir: Path, metadata: dict[str, Any]) -> Path | None:
    campaign_id = metadata.get("campaign_id") or metadata.get("run_id")
    if campaign_id:
        path = run_dir / "sandbox" / ".coc" / "campaigns" / str(campaign_id)
        if path.exists():
            return path
    dirs = _campaign_dirs(run_dir)
    return dirs[0] if dirs else None


def _artifacts_dir(run_dir: Path) -> Path:
    path = run_dir / "artifacts"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _format_roll(event: dict[str, Any]) -> str:
    payload = event.get("payload", {})
    skill = payload.get("skill", "check")
    actor = event.get("actor", "unknown")
    roll = payload.get("roll", "?")
    target = payload.get("effective_target", payload.get("target", "?"))
    outcome = payload.get("outcome", "unknown")
    lines = [f"- {skill}: {actor} rolled {roll} vs {target} -> {outcome}"]
    detail_fields = [
        ("goal", "Goal"),
        ("difficulty", "Difficulty"),
        ("difficulty_rationale", "Difficulty Rationale"),
        ("failure_consequence", "Failure Consequence"),
    ]
    for key, label in detail_fields:
        if payload.get(key) not in (None, "", [], {}):
            lines.append(f"  - {label}: {payload[key]}")
    if payload.get("pushed"):
        lines.append("  - Pushed Roll: yes")
    if payload.get("push_justification"):
        lines.append(f"  - Push Justification: {payload['push_justification']}")
    if payload.get("foreshadowed_failure"):
        lines.append(f"  - Foreshadowed Failure: {payload['foreshadowed_failure']}")
    if "skill_check_earned" in payload:
        earned = "yes" if payload.get("skill_check_earned") else "no"
        lines.append(f"  - Skill Check Earned: {earned}")
    if payload.get("san_loss") not in (None, "", [], {}):
        lines.append(f"  - SAN Loss: {payload['san_loss']}")
    return "\n".join(lines)


def _slug(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(value).lower()).strip("-")


def _localized_actor_names(characters: list[dict[str, Any]], localized_terms: dict[str, str]) -> dict[str, str]:
    names: dict[str, str] = {}
    for character in characters:
        investigator_id = character.get("investigator_id") or character.get("id")
        canonical_name = character.get("name")
        localized_name = _localize_text(canonical_name or investigator_id or "Unknown Investigator", localized_terms)
        for key in (investigator_id, canonical_name, _slug(canonical_name or "")):
            if key:
                names[str(key)] = localized_name
    for canonical, localized in sorted(localized_terms.items(), key=lambda item: len(item[0]), reverse=True):
        names.setdefault(_slug(canonical), localized)
    return names


def _display_roll_actor(actor: Any, actor_names: dict[str, str]) -> str:
    actor_text = str(actor or "unknown")
    if actor_text in {"keeper_under_test", "player_simulator"}:
        return _display_actor(actor_text)
    if actor_text in actor_names:
        return actor_names[actor_text]
    actor_slug = _slug(actor_text)
    if actor_slug in actor_names:
        return actor_names[actor_slug]
    for canonical_slug, localized_name in actor_names.items():
        if actor_slug.startswith(f"{canonical_slug}-") or canonical_slug.startswith(f"{actor_slug}-"):
            return localized_name
    return actor_text


def _localized_rule_value(value: Any, labels: dict[str, str], localized_terms: dict[str, str]) -> str:
    value_text = str(value)
    return labels.get(value_text, _localize_text(value_text, localized_terms))


def _localized_payload_text(
    payload: dict[str, Any],
    key: str,
    localized_terms: dict[str, str],
    play_language: str,
) -> str | None:
    localized_text = payload.get("localized_text", {})
    if isinstance(localized_text, dict):
        language_text = localized_text.get(play_language, {})
        if isinstance(language_text, dict) and language_text.get(key) not in (None, "", [], {}):
            return _localize_text(language_text[key], localized_terms)
    if play_language == "zh-Hans":
        return None
    if payload.get(key) not in (None, "", [], {}):
        return _localize_text(payload[key], localized_terms)
    return None


def _format_roll_recap(
    event: dict[str, Any],
    actor_names: dict[str, str],
    localized_terms: dict[str, str],
    play_language: str,
) -> str:
    if play_language != "zh-Hans":
        return _format_roll(event)

    payload = event.get("payload", {})
    skill = payload.get("skill", "check")
    actor = _display_roll_actor(event.get("actor", "unknown"), actor_names)
    roll = payload.get("roll", "?")
    target = payload.get("effective_target", payload.get("target", "?"))
    outcome = _localized_rule_value(payload.get("outcome", "unknown"), ZH_HANS_OUTCOME_LABELS, localized_terms)
    lines = [f"- {skill}：{actor}掷出 {roll} / {target}，结果{outcome}。"]
    for key, label, labels in [("difficulty", "难度", ZH_HANS_DIFFICULTY_LABELS)]:
        if payload.get(key) in (None, "", [], {}):
            continue
        value = _localized_rule_value(payload[key], labels, localized_terms)
        lines.append(f"  - {label}：{value}")
    for key, label in [
        ("goal", "目的"),
        ("difficulty_rationale", "难度说明"),
        ("failure_consequence", "失败后果"),
    ]:
        value = _localized_payload_text(payload, key, localized_terms, play_language)
        if value is not None:
            lines.append(f"  - {label}：{value}")
    if payload.get("pushed"):
        lines.append("  - 推骰：yes")
    push_justification = _localized_payload_text(payload, "push_justification", localized_terms, play_language)
    if push_justification is not None:
        lines.append(f"  - 推骰理由：{push_justification}")
    foreshadowed_failure = _localized_payload_text(payload, "foreshadowed_failure", localized_terms, play_language)
    if foreshadowed_failure is not None:
        lines.append(f"  - 预告失败后果：{foreshadowed_failure}")
    if "skill_check_earned" in payload:
        earned = "yes" if payload.get("skill_check_earned") else "no"
        lines.append(f"  - 成长标记：{earned}")
    if payload.get("san_loss") not in (None, "", [], {}):
        lines.append(f"  - SAN 损失：{payload['san_loss']}")
    return "\n".join(lines)


def _display_actor(actor: str) -> str:
    if actor == "keeper_under_test":
        return "KP"
    if actor == "player_simulator":
        return "Player"
    return actor


def _format_state_event(event: dict[str, Any]) -> str:
    event_type = event.get("type", "event")
    event_label = event_type.replace("_", " ")
    payload = event.get("payload", {})
    if event_type == "scene":
        scene_id = payload.get("scene_id", "unknown")
        summary = payload.get("summary", "")
        return f"- scene: {scene_id} - {summary}".rstrip()
    actor = _display_actor(event.get("actor", "unknown"))
    summary = payload.get("summary") or payload.get("text")
    if event_type == "clue":
        clue_id = payload.get("clue_id", "unknown")
        return f"- clue: {clue_id} - {summary or 'clue recorded'}"
    if summary:
        return f"- {event_label}: {actor} - {summary}"
    return f"- {event_label}: {actor}"


def _event_summary(event: dict[str, Any], fallback: str = "") -> str:
    payload = event.get("payload", {})
    return str(payload.get("summary") or payload.get("text") or fallback).strip()


def _format_decision(event: dict[str, Any]) -> str:
    summary = _event_summary(event, "decision recorded")
    return f"- {summary}"


def _format_clue(event: dict[str, Any]) -> str:
    payload = event.get("payload", {})
    clue_id = payload.get("clue_id", "unknown")
    summary = _event_summary(event, "clue recorded")
    return f"- {clue_id}: {summary}"


def _format_subsystem_event(event: dict[str, Any]) -> str:
    actor = _display_actor(event.get("actor", "unknown"))
    summary = _event_summary(event, f"{event.get('type', 'event')} recorded")
    return f"- {actor}: {summary}"


def _format_scene_replay_event(event: dict[str, Any]) -> str:
    event_type = event.get("type", "event")
    payload = event.get("payload", {})
    if event_type == "scene":
        scene_id = payload.get("scene_id") or "scene"
        summary = _event_summary(event, "scene recorded")
        return f"- {scene_id}: {summary}"
    if event_type == "clue":
        clue_id = payload.get("clue_id") or "clue"
        summary = _event_summary(event, "clue recorded")
        return f"- clue:{clue_id}: {summary}"
    event_label = event_type.replace("_", " ")
    actor = _display_actor(event.get("actor", "unknown"))
    summary = _event_summary(event, f"{event_label} recorded")
    return f"- {event_label}: {actor} - {summary}"


def _scene_replay_events(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [event for event in events if event.get("type") in SCENE_REPLAY_EVENT_TYPES]


def _list_lines(items: list[str], empty: str) -> list[str]:
    return items if items else [empty]


def _first_value(default: Any, *values: Any) -> Any:
    for value in values:
        if value not in (None, "", [], {}):
            return value
    return default


def _localized_terms(metadata: dict[str, Any]) -> dict[str, str]:
    play_language = metadata.get("play_language")
    localized_terms = metadata.get("localized_terms", {})
    terms = localized_terms.get(play_language, {}) if isinstance(localized_terms, dict) else {}
    if not isinstance(terms, dict):
        return {}
    return {
        str(canonical): str(localized)
        for canonical, localized in terms.items()
        if canonical and localized and str(canonical) != str(localized)
    }


def _format_localized_terms(terms: dict[str, str]) -> str:
    if not terms:
        return "none"
    return ", ".join(f"{canonical} -> {localized}" for canonical, localized in sorted(terms.items()))


def _localize_text(text: Any, terms: dict[str, str]) -> str:
    localized = str(text)
    for canonical, replacement in sorted(terms.items(), key=lambda item: len(item[0]), reverse=True):
        localized = localized.replace(canonical, replacement)
    return CJK_BOUNDARY_SPACE.sub("", localized)


def _party_investigator_ids(party: dict[str, Any]) -> list[str]:
    ids: list[str] = []
    for key in ("investigator_ids", "active_investigator_ids", "investigators", "members"):
        for item in party.get(key, []):
            if isinstance(item, str):
                ids.append(item)
            elif isinstance(item, dict):
                investigator_id = item.get("investigator_id") or item.get("id")
                if investigator_id:
                    ids.append(str(investigator_id))
    return list(dict.fromkeys(ids))


def _load_characters(run_dir: Path, party: dict[str, Any]) -> list[dict[str, Any]]:
    sandbox_investigators = run_dir / "sandbox" / ".coc" / "investigators"
    investigator_ids = _party_investigator_ids(party)
    characters: list[dict[str, Any]] = []

    for investigator_id in investigator_ids:
        path = sandbox_investigators / investigator_id / "character.json"
        character = _read_json(path, {})
        if character:
            characters.append(character)

    if characters or not sandbox_investigators.exists():
        return characters

    for path in sorted(sandbox_investigators.glob("*/character.json")):
        character = _read_json(path, {})
        if character:
            characters.append(character)
    return characters


def _load_campaign_context(run_dir: Path, metadata: dict[str, Any]) -> dict[str, Any]:
    campaign_dir = _select_campaign_dir(run_dir, metadata)
    campaign = _read_json(campaign_dir / "campaign.json", {}) if campaign_dir else {}
    party = _read_json(campaign_dir / "party.json", {}) if campaign_dir else {}
    scenario = _read_json(campaign_dir / "scenario" / "scenario.json", {}) if campaign_dir else {}
    return {
        "campaign_dir": campaign_dir,
        "campaign": campaign,
        "party": party,
        "scenario": scenario,
        "characters": _load_characters(run_dir, party),
    }


def _format_key_values(values: dict[str, Any], preferred_order: list[str] | None = None) -> str:
    if not values:
        return "none recorded"
    ordered_keys = preferred_order or []
    keys = [key for key in ordered_keys if key in values]
    keys.extend(sorted(key for key in values if key not in keys))
    return ", ".join(f"{key}: {values[key]}" for key in keys)


def _format_character(character: dict[str, Any], localized_terms: dict[str, str] | None = None) -> list[str]:
    terms = localized_terms or {}
    investigator_id = character.get("investigator_id") or character.get("id") or "unknown"
    name = _localize_text(character.get("name") or investigator_id or "Unknown Investigator", terms)
    lines = [f"- {name} ({investigator_id})"]
    if character.get("player_name"):
        lines.append(f"  - Player: {character['player_name']}")
    if character.get("occupation"):
        lines.append(f"  - Occupation: {character['occupation']}")
    if character.get("era"):
        lines.append(f"  - Era: {character['era']}")
    lines.append(
        "  - Characteristics: "
        + _format_key_values(
            character.get("characteristics", {}),
            ["STR", "CON", "SIZ", "DEX", "APP", "INT", "POW", "EDU"],
        )
    )
    lines.append(
        "  - Derived: "
        + _format_key_values(
            character.get("derived", {}),
            ["HP", "MP", "SAN", "MOV", "damage_bonus", "build"],
        )
    )
    lines.append("  - Skills: " + _format_key_values(character.get("skills", {})))
    return lines


def _format_transcript_event(event: dict[str, Any]) -> list[str]:
    role = event.get("role", "unknown")
    if role == "keeper_under_test":
        speaker = "KP"
    elif role == "player_simulator":
        speaker = "Player"
    else:
        speaker = event.get("speaker") or role

    turn = event.get("turn", "?")
    text = event.get("text", "")
    lines = [f"- Turn {turn} {speaker}: {text}"]
    if event.get("mode"):
        lines.append(f"  - Mode: {event['mode']}")
    if event.get("intent"):
        lines.append(f"  - Intent: {event['intent']}")
    return lines


def _format_actual_play_event(event: dict[str, Any]) -> list[str]:
    role = event.get("role", "unknown")
    if role == "keeper_under_test":
        speaker = "KP"
    elif role == "player_simulator":
        speaker = "Player"
    else:
        speaker = event.get("speaker") or role

    turn = event.get("turn", "?")
    text = event.get("text", "")
    if role in {"keeper_under_test", "player_simulator"}:
        lines = [f"- Turn {turn} {speaker}: \"{text}\""]
    else:
        lines = [f"- Turn {turn} {speaker}: {text}"]
    if event.get("intent"):
        lines.append(f"  - Intent: {event['intent']}")
    if event.get("ruling"):
        lines.append(f"  - Ruling: {event['ruling']}")
    if event.get("mode") == "roll":
        lines.append("  - Mode: roll")
    return lines


def _format_session_summary(event: dict[str, Any]) -> str:
    session_id = event.get("session_id") or event.get("id") or "session"
    summary = event.get("summary") or event.get("text") or ""
    return f"- {session_id}: {summary}".rstrip()


def _format_feedback(event: dict[str, Any]) -> str:
    category = event.get("category", "general")
    score = event.get("score", "unscored")
    text = event.get("text", "")
    return f"- {category}: {score} - {text}".rstrip()


def _format_csv(values: Any) -> str:
    if isinstance(values, list) and values:
        return ", ".join(str(value) for value in values)
    return "none recorded"


def generate_battle_report(run_dir: Path) -> Path:
    metadata = _read_json(run_dir / "playtest.json", {})
    localized_terms = _localized_terms(metadata)
    context = _load_campaign_context(run_dir, metadata)
    campaign = context["campaign"]
    scenario = context["scenario"]
    characters = context["characters"]
    transcript = _read_jsonl(run_dir / "transcript.jsonl")
    rolls = _read_jsonl_files(_campaign_log_paths(run_dir, "rolls.jsonl"))
    state_events = _read_jsonl_files(_campaign_log_paths(run_dir, "events.jsonl"))
    session_summaries = _read_jsonl_files(_campaign_memory_paths(run_dir, "session-summaries.jsonl"))
    player_feedback = _read_jsonl(run_dir / "player-feedback.jsonl")
    output = _artifacts_dir(run_dir) / "battle-report.md"

    campaign_title = _first_value(
        "unknown",
        campaign.get("title"),
        metadata.get("campaign_title"),
        metadata.get("campaign_id"),
    )
    scenario_title = _first_value(
        "unknown",
        scenario.get("title"),
        metadata.get("scenario"),
    )
    scenario_id = _first_value(
        "unknown",
        scenario.get("scenario_id"),
        campaign.get("scenario_id"),
        metadata.get("scenario_id"),
    )
    module_source = _first_value(
        "unknown",
        scenario.get("module_source"),
        scenario.get("source_pdf"),
        metadata.get("module_source"),
    )
    era = _first_value("unknown", campaign.get("era"), metadata.get("era"))
    dice_mode = _first_value("unknown", campaign.get("dice_mode"), metadata.get("dice_mode"))
    spoiler_policy = _first_value(
        "unknown",
        campaign.get("spoiler_policy"),
        metadata.get("spoiler_policy"),
    )
    play_language = _first_value(
        "unknown",
        metadata.get("play_language"),
        campaign.get("play_language"),
    )

    transcript_lines: list[str] = []
    actual_play_lines: list[str] = []
    for event in transcript:
        transcript_lines.extend(_format_transcript_event(event))
        actual_play_lines.extend(_format_actual_play_event(event))
    actor_names = _localized_actor_names(characters, localized_terms)
    roll_recap_lines = [
        _format_roll_recap(event, actor_names, localized_terms, str(play_language))
        for event in rolls
    ]
    roll_lines = [_format_roll(event) for event in rolls]
    state_lines = [_format_state_event(event) for event in state_events]
    decision_lines = [
        _format_decision(event)
        for event in state_events
        if event.get("type") == "decision"
    ]
    clue_lines = [_format_clue(event) for event in state_events if event.get("type") == "clue"]
    scene_replay_lines = [_format_scene_replay_event(event) for event in _scene_replay_events(state_events)]
    combat_lines = [_format_subsystem_event(event) for event in state_events if event.get("type") == "combat"]
    chase_lines = [_format_subsystem_event(event) for event in state_events if event.get("type") == "chase"]
    sanity_lines = [_format_subsystem_event(event) for event in state_events if event.get("type") == "sanity"]
    ending_lines = [_format_subsystem_event(event) for event in state_events if event.get("type") == "session_ending"]
    character_lines: list[str] = []
    for character in characters:
        character_lines.extend(_format_character(character, localized_terms))
    recap_lines = [_format_session_summary(event) for event in session_summaries]
    feedback_lines = [_format_feedback(event) for event in player_feedback]

    body = [
        "# Battle Report",
        "",
        "## Run Setup",
        f"- Run ID: {metadata.get('run_id', 'unknown')}",
        f"- Campaign: {campaign_title}",
        f"- Era: {era}",
        f"- Dice Mode: {dice_mode}",
        f"- Spoiler Policy: {spoiler_policy}",
        f"- Play Language: {play_language}",
        f"- Localized Terms: {_format_localized_terms(localized_terms)}",
        f"- Player Profile: {metadata.get('player_profile', 'unknown')}",
        "",
        "## Module",
        f"- Scenario: {scenario_title}",
        f"- Scenario ID: {scenario_id}",
        f"- Source: {module_source}",
        f"- Opening Scene: {_localize_text(scenario.get('opening_scene', 'not recorded'), localized_terms)}",
        "",
        "## Character Dossier",
        *_list_lines(character_lines, "- No character sheets recorded."),
        "",
        "## Scene-by-Scene Replay",
        *_list_lines(scene_replay_lines, "- No scene replay recorded."),
        "",
        "## Actual Play Replay",
        *_list_lines(actual_play_lines, "- No actual play events recorded."),
        "",
        "## Session Transcript",
        *_list_lines(transcript_lines, "- No transcript events recorded."),
        "",
        "## Major Player Decisions",
        *_list_lines(decision_lines, "- No major decisions recorded."),
        "",
        "## Rules & Rolls Recap",
        *_list_lines(roll_recap_lines, "- No roll recap recorded."),
        "",
        "## Mechanical Log",
        "### Important Rolls",
        *_list_lines(roll_lines, "- No rolls recorded."),
        "",
        "### State Changes",
        *_list_lines(state_lines, "- No state changes recorded."),
        "",
        "## Combat Summary",
        *_list_lines(combat_lines, "- No combat summary recorded."),
        "",
        "## Chase Summary",
        *_list_lines(chase_lines, "- No chase summary recorded."),
        "",
        "## Sanity Summary",
        *_list_lines(sanity_lines, "- No sanity summary recorded."),
        "",
        "## Clues Found",
        *_list_lines(clue_lines, "- No clues recorded."),
        "",
        "## Session Ending",
        *_list_lines(ending_lines, "- Session ending not recorded."),
        "",
        "## Story Recap",
        *_list_lines(recap_lines, "- No story recap recorded."),
        "",
        "## Player Feedback On KP",
        *_list_lines(feedback_lines, "- No player feedback recorded."),
        "",
    ]
    output.write_text("\n".join(body), encoding="utf-8")
    return output


def generate_evaluation_report(run_dir: Path) -> Path:
    metadata = _read_json(run_dir / "playtest.json", {})
    notes = _read_jsonl(run_dir / "evaluator-notes.jsonl")
    output = _artifacts_dir(run_dir) / "evaluation-report.md"

    scores = metadata.get("scores", {})
    score_lines = [f"- {key}: {value}" for key, value in scores.items()]
    passed_lines = [f"- {case}" for case in metadata.get("passed_test_cases", [])]
    failed_lines = [f"- {case}" for case in metadata.get("failed_test_cases", [])]
    fix_lines = [f"- {fix}" for fix in metadata.get("recommended_fixes", [])]
    regression_lines = [f"- {item}" for item in metadata.get("regression_tests", [])]

    def notes_for(*categories: str) -> list[str]:
        accepted = set(categories)
        return [
            f"- [{note.get('severity', 'unknown')}] {note.get('category', 'general')}: {note.get('text', '')}"
            for note in notes
            if note.get("category") in accepted
        ]

    body = [
        "# Evaluation Report",
        "",
        "## Overall Result",
        "Report generated from available transcript and evaluator notes.",
        "",
        "## Playtest Profile",
        f"- Run ID: {metadata.get('run_id', 'unknown')}",
        f"- Audit Profile: {metadata.get('audit_profile', 'baseline')}",
        f"- Player Profile: {metadata.get('player_profile', 'unknown')}",
        f"- Module Coverage: {_format_csv(metadata.get('module_coverage', []))}",
        f"- Subsystems Covered: {_format_csv(metadata.get('subsystems_covered', []))}",
        "",
        "## Scorecard",
        *(score_lines or ["- No scores recorded."]),
        "",
        "## Passed Test Cases",
        *_list_lines(passed_lines, "- No pass list recorded."),
        "",
        "## Failed Test Cases",
        *_list_lines(failed_lines, "- No fail list recorded."),
        "",
        "## Rule Accuracy Findings",
        *_list_lines(notes_for("rules_accuracy"), "- No rule accuracy findings recorded."),
        "",
        "## State Integrity Findings",
        *_list_lines(notes_for("state_integrity"), "- No state integrity findings recorded."),
        "",
        "## Spoiler Safety Findings",
        *_list_lines(notes_for("spoiler_safety"), "- No spoiler safety findings recorded."),
        "",
        "## Immersion Findings",
        *_list_lines(notes_for("immersion"), "- No immersion findings recorded."),
        "",
        "## Meta-Game Findings",
        *_list_lines(notes_for("meta", "meta_quality"), "- No meta-game findings recorded."),
        "",
        "## Reproducible Bugs",
        *_list_lines(notes_for("bug"), "- No reproducible bugs recorded."),
        "",
        "## Recommended Fixes",
        *_list_lines(fix_lines, "- No fixes recorded."),
        "",
        "## Regression Tests To Add",
        *_list_lines(regression_lines, "- No regression tests recorded."),
        "",
    ]
    output.write_text("\n".join(body), encoding="utf-8")
    return output
