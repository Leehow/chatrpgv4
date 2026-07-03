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


def _artifacts_dir(run_dir: Path) -> Path:
    path = run_dir / "artifacts"
    path.mkdir(parents=True, exist_ok=True)
    return path


def generate_battle_report(run_dir: Path) -> Path:
    metadata = _read_json(run_dir / "playtest.json", {})
    transcript = _read_jsonl(run_dir / "transcript.jsonl")
    output = _artifacts_dir(run_dir) / "battle-report.md"

    timeline = [
        f"- Turn {event.get('turn', '?')} `{event.get('role', 'unknown')}`: {event.get('text', '')}"
        for event in transcript
    ]
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
        "- No roll extraction in V1 report.",
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
        "- No state diff extraction in V1 report.",
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
    note_lines = [
        f"- [{note.get('severity', 'unknown')}] {note.get('category', 'general')}: {note.get('text', '')}"
        for note in notes
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
        "- No pass list recorded.",
        "",
        "## Failed Test Cases",
        "- No fail list recorded.",
        "",
        "## Rule Accuracy Findings",
        *(note_lines or ["- No evaluator notes recorded."]),
        "",
        "## State Integrity Findings",
        "- No state integrity findings recorded.",
        "",
        "## Spoiler Safety Findings",
        "- No spoiler safety findings recorded.",
        "",
        "## Immersion Findings",
        *(note_lines or ["- No immersion findings recorded."]),
        "",
        "## Meta-Game Findings",
        "- No meta-game findings recorded.",
        "",
        "## Reproducible Bugs",
        "- No reproducible bugs recorded.",
        "",
        "## Recommended Fixes",
        "- No fixes recorded.",
        "",
        "## Regression Tests To Add",
        "- No regression tests recorded.",
        "",
    ]
    output.write_text("\n".join(body), encoding="utf-8")
    return output
