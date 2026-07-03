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


def generate_battle_report(run_dir: Path) -> Path:
    metadata = _read_json(run_dir / "playtest.json", {})
    transcript = _read_jsonl(run_dir / "transcript.jsonl")
    rolls = _read_jsonl_files(_campaign_log_paths(run_dir, "rolls.jsonl"))
    state_events = _read_jsonl_files(_campaign_log_paths(run_dir, "events.jsonl"))
    output = _artifacts_dir(run_dir) / "battle-report.md"

    timeline = [
        f"- Turn {event.get('turn', '?')} `{event.get('role', 'unknown')}`: {event.get('text', '')}"
        for event in transcript
    ]
    roll_lines = [_format_roll(event) for event in rolls]
    state_lines = [_format_state_event(event) for event in state_events]
    body = [
        "# Battle Report",
        "",
        "## Run Metadata",
        f"- Run ID: {metadata.get('run_id', 'unknown')}",
        f"- Scenario: {metadata.get('scenario', 'unknown')}",
        f"- Player Profile: {metadata.get('player_profile', 'unknown')}",
        "",
        "## Scenario Under Test",
        str(metadata.get("scenario", "unknown")),
        "",
        "## Simulated Player Profile",
        str(metadata.get("player_profile", "unknown")),
        "",
        "## Session Timeline",
        *(timeline or ["- No transcript events recorded."]),
        "",
        "## Major Player Decisions",
        "- No major decision extraction in V1 report.",
        "",
        "## Important Rolls",
        *_list_lines(roll_lines, "- No rolls recorded."),
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
        "## State Changes",
        *_list_lines(state_lines, "- No state changes recorded."),
        "",
        "## Session Ending",
        "- Session ending not recorded.",
        "",
        "## Player-Safe Recap",
        "- Recap generation not recorded.",
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
