#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path
from typing import Any


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
    return f"- {skill}: {actor} rolled {roll} vs {target} -> {outcome}"


def _format_state_event(event: dict[str, Any]) -> str:
    event_type = event.get("type", "event")
    payload = event.get("payload", {})
    if event_type == "scene":
        scene_id = payload.get("scene_id", "unknown")
        summary = payload.get("summary", "")
        return f"- scene: {scene_id} - {summary}".rstrip()
    actor = event.get("actor", "unknown")
    return f"- {event_type}: {actor} - {payload}"


def _list_lines(items: list[str], empty: str) -> list[str]:
    return items if items else [empty]


def _first_value(default: Any, *values: Any) -> Any:
    for value in values:
        if value not in (None, "", [], {}):
            return value
    return default


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


def _format_character(character: dict[str, Any]) -> list[str]:
    investigator_id = character.get("investigator_id") or character.get("id") or "unknown"
    name = character.get("name") or investigator_id or "Unknown Investigator"
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


def _format_session_summary(event: dict[str, Any]) -> str:
    session_id = event.get("session_id") or event.get("id") or "session"
    summary = event.get("summary") or event.get("text") or ""
    return f"- {session_id}: {summary}".rstrip()


def _format_feedback(event: dict[str, Any]) -> str:
    category = event.get("category", "general")
    score = event.get("score", "unscored")
    text = event.get("text", "")
    return f"- {category}: {score} - {text}".rstrip()


def generate_battle_report(run_dir: Path) -> Path:
    metadata = _read_json(run_dir / "playtest.json", {})
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

    transcript_lines: list[str] = []
    for event in transcript:
        transcript_lines.extend(_format_transcript_event(event))
    roll_lines = [_format_roll(event) for event in rolls]
    state_lines = [_format_state_event(event) for event in state_events]
    character_lines: list[str] = []
    for character in characters:
        character_lines.extend(_format_character(character))
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
        f"- Player Profile: {metadata.get('player_profile', 'unknown')}",
        "",
        "## Module",
        f"- Scenario: {scenario_title}",
        f"- Scenario ID: {scenario_id}",
        f"- Source: {module_source}",
        f"- Opening Scene: {scenario.get('opening_scene', 'not recorded')}",
        "",
        "## Character Dossier",
        *_list_lines(character_lines, "- No character sheets recorded."),
        "",
        "## Session Transcript",
        *_list_lines(transcript_lines, "- No transcript events recorded."),
        "",
        "## Major Player Decisions",
        "- No major decision extraction in V1 report.",
        "",
        "## Mechanical Log",
        "### Important Rolls",
        *_list_lines(roll_lines, "- No rolls recorded."),
        "",
        "### State Changes",
        *_list_lines(state_lines, "- No state changes recorded."),
        "",
        "## Combat Summary",
        "- No combat summary recorded.",
        "",
        "## Chase Summary",
        "- No chase summary recorded.",
        "",
        "## Sanity Summary",
        "- No sanity summary recorded.",
        "",
        "## Clues Found",
        "- No clue extraction in V1 report.",
        "",
        "## Session Ending",
        "- Session ending not recorded.",
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

    def notes_for(category: str) -> list[str]:
        return [
            f"- [{note.get('severity', 'unknown')}] {note.get('category', 'general')}: {note.get('text', '')}"
            for note in notes
            if note.get("category") == category
        ]

    body = [
        "# Evaluation Report",
        "",
        "## Overall Result",
        "V1 report generated from available transcript and evaluator notes.",
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
        *_list_lines(notes_for("meta"), "- No meta-game findings recorded."),
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
