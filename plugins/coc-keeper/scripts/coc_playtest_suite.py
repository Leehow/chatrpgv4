#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


CORE_COVERAGE = {
    "character_dossier": "Character Dossier",
    "kp_player_transcript": "KP/player transcript",
    "mechanical_rolls": "Mechanical rolls",
    "combat": "Combat",
    "chase": "Chase",
    "sanity": "Sanity",
    "player_feedback": "Player feedback",
}


def _read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def _read_text(path: Path) -> str:
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8")


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def _playtests_dir(root: Path) -> Path:
    return root / ".coc" / "playtests"


def _audit_result(run_dir: Path) -> str:
    text = _read_text(run_dir / "artifacts" / "rulebook-audit.md")
    if "\nPASS\n" in text or "## Overall Result\nPASS" in text:
        return "PASS"
    if "\nFAIL\n" in text or "## Overall Result\nFAIL" in text:
        return "FAIL"
    return "MISSING"


def _has_nonempty_section(text: str, heading: str, placeholder: str) -> bool:
    return heading in text and placeholder not in text


def _run_coverage(run_dir: Path, metadata: dict[str, Any], battle_text: str) -> dict[str, bool]:
    subsystems = set(metadata.get("subsystems_covered", []))
    feedback = _read_jsonl(run_dir / "player-feedback.jsonl")
    real_chase = (
        "chase" in subsystems
        or (
            "speed roll" in battle_text
            and "movement actions" in battle_text
            and ("quarry escapes" in battle_text or "quarry is caught" in battle_text)
        )
    )
    return {
        "character_dossier": _has_nonempty_section(battle_text, "## Character Dossier", "No character sheets recorded."),
        "kp_player_transcript": (
            _has_nonempty_section(battle_text, "## Session Transcript", "No transcript events recorded.")
            and "KP:" in battle_text
            and "Player:" in battle_text
        ),
        "mechanical_rolls": (
            _has_nonempty_section(battle_text, "## Mechanical Log", "No rolls recorded.")
            and "Goal:" in battle_text
            and "Difficulty:" in battle_text
        ),
        "combat": "combat" in subsystems or _has_nonempty_section(battle_text, "## Combat Summary", "No combat summary recorded."),
        "chase": real_chase,
        "sanity": "sanity" in subsystems or _has_nonempty_section(battle_text, "## Sanity Summary", "No sanity summary recorded."),
        "player_feedback": bool(feedback) or _has_nonempty_section(battle_text, "## Player Feedback On KP", "No player feedback recorded."),
    }


def _discover_runs(root: Path) -> list[dict[str, Any]]:
    base = _playtests_dir(root)
    runs: list[dict[str, Any]] = []
    for playtest_path in sorted(base.glob("*/playtest.json")):
        run_dir = playtest_path.parent
        metadata = _read_json(playtest_path, {})
        battle_text = _read_text(run_dir / "artifacts" / "battle-report.md")
        run_id = str(metadata.get("run_id") or run_dir.name)
        coverage = _run_coverage(run_dir, metadata, battle_text)
        runs.append({
            "run_id": run_id,
            "path": str(run_dir),
            "campaign_title": metadata.get("campaign_title", "unknown"),
            "scenario": metadata.get("scenario", "unknown"),
            "audit_profile": metadata.get("audit_profile", "baseline"),
            "audit_result": _audit_result(run_dir),
            "player_profile": metadata.get("player_profile", "unknown"),
            "subsystems_covered": metadata.get("subsystems_covered", []),
            "coverage": coverage,
        })
    return runs


def _coverage_matrix(runs: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    matrix: dict[str, dict[str, Any]] = {}
    for key, label in CORE_COVERAGE.items():
        covering_runs = [run["run_id"] for run in runs if run["coverage"].get(key)]
        matrix[key] = {
            "label": label,
            "status": "covered" if covering_runs else "missing",
            "runs": covering_runs,
        }
    return matrix


def _gaps(matrix: dict[str, dict[str, Any]]) -> list[str]:
    return [key for key, value in matrix.items() if value["status"] != "covered"]


def _non_passing_runs(runs: list[dict[str, Any]]) -> list[dict[str, str]]:
    return [
        {
            "run_id": run["run_id"],
            "audit_result": run["audit_result"],
            "audit_profile": run["audit_profile"],
        }
        for run in runs
        if run["audit_result"] != "PASS"
    ]


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def _write_report(path: Path, index: dict[str, Any]) -> None:
    lines = [
        "# COC Playtest Suite Report",
        "",
        "## Run Index",
    ]
    for run in index["runs"]:
        lines.append(
            f"- {run['run_id']}: {run['campaign_title']} | {run['audit_profile']} {run['audit_result']} | "
            f"scenario: {run['scenario']} | player: {run['player_profile']}"
        )

    lines.extend(["", "## Non-Passing Runs"])
    if index["non_passing_runs"]:
        for run in index["non_passing_runs"]:
            lines.append(f"- {run['run_id']}: {run['audit_profile']} {run['audit_result']}")
    else:
        lines.append("- No non-passing runs in this suite.")

    lines.extend(["", "## Core Coverage Matrix"])
    for key, value in index["coverage"].items():
        runs = ", ".join(value["runs"]) if value["runs"] else "none"
        lines.append(f"- {key}: {value['status']} ({runs})")

    lines.extend(["", "## Remaining Gaps"])
    if index["gaps"]:
        for gap in index["gaps"]:
            lines.append(f"- {gap}")
    else:
        lines.append("- No gaps detected across indexed playtest runs.")

    lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")


def generate_suite_report(root: Path) -> Path:
    base = _playtests_dir(root)
    runs = _discover_runs(root)
    matrix = _coverage_matrix(runs)
    index = {
        "schema_version": 1,
        "runs": runs,
        "coverage": matrix,
        "gaps": _gaps(matrix),
        "non_passing_runs": _non_passing_runs(runs),
    }
    index_path = base / "index.json"
    report_path = base / "suite-report.md"
    _write_json(index_path, index)
    _write_report(report_path, index)
    return report_path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=".")
    args = parser.parse_args()
    print(generate_suite_report(Path(args.root)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
