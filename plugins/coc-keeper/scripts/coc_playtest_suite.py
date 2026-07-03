#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Protocol


CORE_COVERAGE = {
    "character_dossier": "Character Dossier",
    "kp_player_transcript": "KP/player transcript",
    "mechanical_rolls": "Mechanical rolls",
    "combat": "Combat",
    "chase": "Chase",
    "sanity": "Sanity",
    "meta_game": "Meta-game rules discussion",
    "player_feedback": "Player feedback",
}

QUALITY_DIMENSIONS = {
    "module_fidelity": "Module fidelity",
    "rulebook_procedure": "Rulebook procedure",
    "immersion_and_pacing": "Immersion and pacing",
    "chinese_visible_dialogue": "Chinese visible dialogue",
    "actual_play_replay": "Actual-play replay",
    "state_continuity": "State continuity",
    "spoiler_safety": "Spoiler safety",
    "player_agency": "Player agency",
    "virtual_player_pressure": "Virtual player pressure",
    "report_completeness": "Report completeness",
}

SEMANTIC_EVAL_REQUEST = "semantic-eval-request.json"
SEMANTIC_EVAL_RESULT = "semantic-eval-result.json"


class CoverageContext:
    def __init__(
        self,
        run_id: str,
        run_dir: Path,
        metadata: dict[str, Any],
        battle_report: str,
        transcript: list[dict[str, Any]],
        player_feedback: list[dict[str, Any]],
        campaign: dict[str, Any],
        party: dict[str, Any],
        characters: list[dict[str, Any]],
        rolls: list[dict[str, Any]],
        state_events: list[dict[str, Any]],
        session_summaries: list[dict[str, Any]],
    ) -> None:
        self.run_id = run_id
        self.run_dir = run_dir
        self.metadata = metadata
        self.battle_report = battle_report
        self.transcript = transcript
        self.player_feedback = player_feedback
        self.campaign = campaign
        self.party = party
        self.characters = characters
        self.rolls = rolls
        self.state_events = state_events
        self.session_summaries = session_summaries


class CoverageEvaluator(Protocol):
    evaluator_id: str

    def evaluate_run(self, context: CoverageContext) -> dict[str, Any]:
        ...


class StructuredSourceCoverageEvaluator:
    evaluator_id = "structured-source-evaluator"

    def evaluate_run(self, context: CoverageContext) -> dict[str, Any]:
        subsystems = set(context.metadata.get("subsystems_covered", []))
        transcript_roles = {event.get("role") for event in context.transcript}
        transcript_speakers = {event.get("speaker") for event in context.transcript}
        meta_roles = {
            event.get("role")
            for event in context.transcript
            if event.get("mode") == "meta"
        }
        return {
            "character_dossier": self._result(
                bool(context.characters),
                f"Found {len(context.characters)} structured character sheet(s) in sandbox source data.",
                "No structured character sheet was found in sandbox source data.",
            ),
            "kp_player_transcript": self._result(
                (
                    "keeper_under_test" in transcript_roles
                    and "player_simulator" in transcript_roles
                )
                or ("KP" in transcript_speakers and len(transcript_speakers - {"KP", "system"}) > 0),
                "Found structured transcript events from both keeper_under_test and player_simulator.",
                "Structured transcript does not contain both Keeper and player simulator turns.",
            ),
            "mechanical_rolls": self._result(
                bool(context.rolls) or any(event.get("mode") == "roll" for event in context.transcript),
                "Found structured roll events in campaign logs or transcript events.",
                "No structured roll events were found.",
            ),
            "combat": self._subsystem_result("combat", subsystems),
            "chase": self._subsystem_result("chase", subsystems),
            "sanity": self._subsystem_result("sanity", subsystems),
            "meta_game": self._result(
                (
                    "keeper_under_test" in meta_roles
                    and "player_simulator" in meta_roles
                )
                or "meta_game" in subsystems,
                "Found structured meta-mode question and Keeper response.",
                "No structured meta-mode Keeper/player exchange was found.",
            ),
            "player_feedback": self._result(
                bool(context.player_feedback),
                f"Found {len(context.player_feedback)} structured player feedback entries.",
                "No structured player feedback entries were found.",
            ),
        }

    def _subsystem_result(self, subsystem: str, subsystems: set[str]) -> dict[str, Any]:
        return self._result(
            subsystem in subsystems,
            f"`{subsystem}` is declared in playtest.json subsystem coverage.",
            f"`{subsystem}` is not declared in playtest.json subsystem coverage.",
        )

    def _result(self, covered: bool, yes: str, no: str) -> dict[str, Any]:
        return {
            "covered": covered,
            "reason": yes if covered else no,
        }


class SemanticArtifactCoverageEvaluator:
    evaluator_id = "semantic-artifact-evaluator"

    def evaluate_run(self, context: CoverageContext) -> dict[str, Any]:
        relative_result = f"artifacts/{SEMANTIC_EVAL_RESULT}"
        result_path = context.run_dir / relative_result
        if not result_path.exists():
            return {
                "coverage_evaluator": self.evaluator_id,
                "semantic_eval_result": relative_result,
                "coverage": {
                    key: {
                        "covered": False,
                        "reason": f"Missing {relative_result}; write a semantic eval request and have an LLM semantic evaluator fill the result.",
                    }
                    for key in CORE_COVERAGE
                },
                "root_cause_classification": ["test_gap"],
                "next_loop_fix_target": f"Fill {relative_result} from artifacts/{SEMANTIC_EVAL_REQUEST}.",
            }

        payload = _read_json(result_path, {})
        if payload.get("schema_version") != 1:
            raise ValueError(f"{result_path} must use schema_version 1")
        if payload.get("run_id") != context.run_id:
            raise ValueError(f"{result_path} run_id must be {context.run_id}")
        return {
            "coverage_evaluator": payload.get("evaluator_id", self.evaluator_id),
            "semantic_eval_result": relative_result,
            "coverage": payload.get("coverage", {}),
            "quality": payload.get("quality", {}),
            "root_cause_classification": payload.get("root_cause_classification", []),
            "next_loop_fix_target": payload.get("next_loop_fix_target", "none"),
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


def _select_campaign_dir(run_dir: Path, metadata: dict[str, Any]) -> Path | None:
    campaign_root = run_dir / "sandbox" / ".coc" / "campaigns"
    campaign_id = metadata.get("campaign_id")
    if campaign_id:
        campaign_dir = campaign_root / str(campaign_id)
        if campaign_dir.exists():
            return campaign_dir
    if not campaign_root.exists():
        return None
    campaign_dirs = sorted(path for path in campaign_root.iterdir() if path.is_dir())
    return campaign_dirs[0] if campaign_dirs else None


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
            character["_creation"] = _read_json(path.parent / "creation.json", {})
            characters.append(character)

    if characters or not sandbox_investigators.exists():
        return characters

    for path in sorted(sandbox_investigators.glob("*/character.json")):
        character = _read_json(path, {})
        if character:
            character["_creation"] = _read_json(path.parent / "creation.json", {})
            characters.append(character)
    return characters


def _coverage_context(run_dir: Path, metadata: dict[str, Any], battle_text: str, run_id: str) -> CoverageContext:
    campaign_dir = _select_campaign_dir(run_dir, metadata)
    campaign = _read_json(campaign_dir / "campaign.json", {}) if campaign_dir else {}
    party = _read_json(campaign_dir / "party.json", {}) if campaign_dir else {}
    return CoverageContext(
        run_id=run_id,
        run_dir=run_dir,
        metadata=metadata,
        battle_report=battle_text,
        transcript=_read_jsonl(run_dir / "transcript.jsonl"),
        player_feedback=_read_jsonl(run_dir / "player-feedback.jsonl"),
        campaign=campaign,
        party=party,
        characters=_load_characters(run_dir, party),
        rolls=_read_jsonl(campaign_dir / "logs" / "rolls.jsonl") if campaign_dir else [],
        state_events=_read_jsonl(campaign_dir / "logs" / "events.jsonl") if campaign_dir else [],
        session_summaries=_read_jsonl(campaign_dir / "memory" / "session-summaries.jsonl") if campaign_dir else [],
    )


def _normalize_evaluation(raw: dict[str, Any], default_evaluator_id: str) -> tuple[str, dict[str, bool], dict[str, str]]:
    evaluator_id = str(raw.get("coverage_evaluator") or raw.get("evaluator_id") or default_evaluator_id)
    raw_coverage = raw.get("coverage", raw)
    coverage: dict[str, bool] = {}
    reasons: dict[str, str] = {}
    for key in CORE_COVERAGE:
        value = raw_coverage.get(key, False)
        if isinstance(value, dict) and all(field in value for field in ("covered", "reason")):
            coverage[key] = bool(value.get("covered", False))
            reasons[key] = str(value.get("reason", "No reason recorded."))
        elif isinstance(value, dict):
            missing = [
                field
                for field in ("covered", "reason")
                if field not in value
            ]
            coverage[key] = False
            reasons[key] = f"Evaluator coverage result missing required field(s): {', '.join(missing)}."
        else:
            coverage[key] = False
            reasons[key] = "Evaluator did not return a structured coverage result with covered and reason."
    return evaluator_id, coverage, reasons


def _normalize_quality(raw: dict[str, Any]) -> tuple[dict[str, int], dict[str, bool], dict[str, str]]:
    raw_quality = raw.get("quality", {})
    scores: dict[str, int] = {}
    passes: dict[str, bool] = {}
    reasons: dict[str, str] = {}
    for key in QUALITY_DIMENSIONS:
        value = raw_quality.get(key, {})
        if isinstance(value, dict) and all(field in value for field in ("score", "passed", "reason")):
            score = int(value.get("score", 0) or 0)
            passed = bool(value.get("passed")) and score >= 4
            reason = str(value.get("reason", "No quality reason recorded."))
        elif isinstance(value, dict):
            score = int(value.get("score", 0) or 0)
            missing = [
                field
                for field in ("score", "passed", "reason")
                if field not in value
            ]
            passed = False
            reason = f"Evaluator quality result missing required field(s): {', '.join(missing)}."
        else:
            score = 0
            passed = False
            reason = "Evaluator did not return a structured quality result."
        scores[key] = score
        passes[key] = passed
        reasons[key] = reason
    return scores, passes, reasons


def _discover_runs(root: Path, evaluator: CoverageEvaluator) -> list[dict[str, Any]]:
    base = _playtests_dir(root)
    runs: list[dict[str, Any]] = []
    for playtest_path in sorted(base.glob("*/playtest.json")):
        run_dir = playtest_path.parent
        metadata = _read_json(playtest_path, {})
        battle_text = _read_text(run_dir / "artifacts" / "battle-report.md")
        run_id = str(metadata.get("run_id") or run_dir.name)
        context = _coverage_context(run_dir, metadata, battle_text, run_id)
        raw_evaluation = evaluator.evaluate_run(context)
        coverage_evaluator, coverage, coverage_reasons = _normalize_evaluation(raw_evaluation, evaluator.evaluator_id)
        quality_scores, quality_passes, quality_reasons = _normalize_quality(raw_evaluation)
        run = {
            "run_id": run_id,
            "path": str(run_dir),
            "campaign_title": metadata.get("campaign_title", "unknown"),
            "scenario": metadata.get("scenario", "unknown"),
            "audit_profile": metadata.get("audit_profile", "baseline"),
            "audit_result": _audit_result(run_dir),
            "player_profile": metadata.get("player_profile", "unknown"),
            "subsystems_covered": metadata.get("subsystems_covered", []),
            "coverage_evaluator": coverage_evaluator,
            "coverage": coverage,
            "coverage_reasons": coverage_reasons,
            "quality_scores": quality_scores,
            "quality_passes": quality_passes,
            "quality_reasons": quality_reasons,
        }
        for optional_key in ("semantic_eval_result", "root_cause_classification", "next_loop_fix_target"):
            if optional_key in raw_evaluation:
                run[optional_key] = raw_evaluation[optional_key]
        runs.append(run)
    return runs


def _coverage_matrix(runs: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    matrix: dict[str, dict[str, Any]] = {}
    for key, label in CORE_COVERAGE.items():
        covering_runs = [run["run_id"] for run in runs if run["coverage"].get(key)]
        matrix[key] = {
            "label": label,
            "status": "covered" if covering_runs else "missing",
            "runs": covering_runs,
            "reasons": {
                run["run_id"]: run["coverage_reasons"].get(key, "No reason recorded.")
                for run in runs
                if run["coverage"].get(key)
            },
        }
    return matrix


def _quality_matrix(runs: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    matrix: dict[str, dict[str, Any]] = {}
    for key, label in QUALITY_DIMENSIONS.items():
        passed_runs = [run["run_id"] for run in runs if run["quality_passes"].get(key)]
        run_scores = {
            run["run_id"]: run["quality_scores"].get(key, 0)
            for run in runs
            if run["quality_scores"].get(key, 0) > 0
        }
        matrix[key] = {
            "label": label,
            "status": "passed" if passed_runs else "needs_fix",
            "runs": passed_runs,
            "scores": run_scores,
            "reasons": {
                run["run_id"]: run["quality_reasons"].get(key, "No quality reason recorded.")
                for run in runs
                if run["quality_passes"].get(key)
            },
        }
    return matrix


def _gaps(matrix: dict[str, dict[str, Any]]) -> list[str]:
    return [key for key, value in matrix.items() if value["status"] not in {"covered", "passed"}]


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


def _active_evaluation_runs(runs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    active_runs = [run for run in runs if run.get("audit_profile") != "baseline"]
    return active_runs or runs


def _run_needs_semantic_result(run: dict[str, Any]) -> bool:
    return (
        run.get("coverage_evaluator") == SemanticArtifactCoverageEvaluator.evaluator_id
        and run.get("semantic_eval_result") == f"artifacts/{SEMANTIC_EVAL_RESULT}"
        and str(run.get("next_loop_fix_target", "")).startswith("Fill ")
    )


def _loop_decision(index: dict[str, Any]) -> dict[str, Any]:
    runs = index["runs"]
    active_runs = _active_evaluation_runs(runs)
    active_run_ids = [run["run_id"] for run in active_runs]
    blockers: list[dict[str, Any]] = []

    for run in active_runs:
        if run["audit_result"] != "PASS":
            blockers.append({
                "type": "audit_failure",
                "run_id": run["run_id"],
                "root_cause_classification": run.get("root_cause_classification", ["test_gap"]),
                "next_loop_fix_target": run.get("next_loop_fix_target", f"Fix audit failure for {run['run_id']}."),
            })
        elif _run_needs_semantic_result(run):
            blockers.append({
                "type": "missing_semantic_result",
                "run_id": run["run_id"],
                "root_cause_classification": run.get("root_cause_classification", ["test_gap"]),
                "next_loop_fix_target": run.get("next_loop_fix_target", f"Fill artifacts/{SEMANTIC_EVAL_RESULT}."),
            })

    for gap in index["gaps"]:
        blockers.append({
            "type": "coverage_gap",
            "key": gap,
            "root_cause_classification": ["test_gap"],
            "next_loop_fix_target": f"Add or fix a current playtest run that semantically covers {gap}.",
        })

    for gap in index["quality_gaps"]:
        blockers.append({
            "type": "quality_gap",
            "key": gap,
            "root_cause_classification": ["system_gap", "report_gap", "design_gap"],
            "next_loop_fix_target": f"Inspect semantic quality reasons and improve the current playtest loop for {gap}.",
        })

    ignored = [run["run_id"] for run in runs if run["run_id"] not in set(active_run_ids)]
    return {
        "schema_version": 1,
        "status": "needs_repair" if blockers else "ready_for_completion_audit",
        "evaluated_runs": active_run_ids,
        "ignored_historical_runs": ignored,
        "blockers": blockers,
        "next_action": blockers[0]["next_loop_fix_target"] if blockers else (
            "Run the full completion audit against suite-report.md, latest battle reports, rulebook audits, and semantic evaluation results."
        ),
    }


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def _coverage_key_contracts() -> list[dict[str, str]]:
    questions = {
        "character_dossier": "Does the evidence let a reader understand the investigator identity, reusable character sheet, core parameters, skills, and derived values used in play?",
        "kp_player_transcript": "Does the evidence show actual Keeper/player exchange, player intent, Keeper rulings, and enough dialogue to replay the session?",
        "mechanical_rolls": "Does the evidence show rule calls, roll goals, difficulties, outcomes, consequences, and durable state changes?",
        "combat": "Does the evidence semantically include a Call of Cthulhu combat exchange with order, opposed or attack rolls, damage or resolution, and state impact?",
        "chase": "Does the evidence semantically include a Call of Cthulhu chase with speed setup, locations, movement actions, obstacles or conflict, and an ending?",
        "sanity": "Does the evidence semantically include sanity checks or sanity loss with rule consequence such as temporary insanity or recovery?",
        "meta_game": "Does the evidence include an out-of-character player rules/system question and a Keeper answer that pauses or separates ordinary in-character narration?",
        "player_feedback": "Does the evidence include a player-facing assessment of Keeper clarity, immersion, rules readability, or pacing?",
    }
    return [
        {
            "key": key,
            "label": label,
            "question": questions[key],
        }
        for key, label in CORE_COVERAGE.items()
    ]


def _quality_dimension_contracts() -> list[dict[str, str]]:
    questions = {
        "module_fidelity": "Does the playtest preserve the module premise, required beats, clues, scenes, threat logic, and resolution without flattening the scenario into unrelated events?",
        "rulebook_procedure": "Do Keeper rulings follow Call of Cthulhu procedure for checks, pushed rolls, combat, chase, sanity, consequences, rewards, and when no roll is needed?",
        "immersion_and_pacing": "Does the transcript read like playable table conversation with scene texture, tension, and pacing rather than a dry checklist?",
        "chinese_visible_dialogue": "Are the visible Keeper and virtual player dialogue turns written in Chinese for zh-Hans runs, using localized_terms for names, setting terms, and player-visible skill display names while machine-readable markers, JSON keys, canonical skill keys, Mechanical Log roll text, and enum values remain stable?",
        "actual_play_replay": "Does the report include an actual-play style replay that lets a reader follow what the Keeper said, what the player declared, what rules were invoked, and how outcomes changed the fiction?",
        "state_continuity": "Do HP, SAN, clues, items, injuries, decisions, memories, and final state remain coherent across the run?",
        "spoiler_safety": "Does the player-facing material avoid Keeper-only secrets unless the report is evaluator-only or explicitly warning-gated?",
        "player_agency": "Does the virtual player make meaningful choices, ask questions, push rolls, accept stakes, and affect outcomes?",
        "virtual_player_pressure": "Does the test use multiple player profiles or clearly distinct simulated player styles to pressure-test Keeper rulings, pacing, and rule explanations?",
        "report_completeness": "Can an evaluator reconstruct campaign setup, module, character parameters, KP/player dialogue, rolls, subsystems, state changes, memory, and feedback from the report?",
    }
    return [
        {
            "key": key,
            "label": label,
            "question": questions[key],
            "pass_threshold": "score >= 4 and passed is true",
        }
        for key, label in QUALITY_DIMENSIONS.items()
    ]


def _semantic_eval_request(context: CoverageContext) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "kind": "coc_semantic_coverage_request",
        "run_id": context.run_id,
        "instructions": (
            "Act as an LLM semantic evaluator for a Call of Cthulhu Keeper playtest. "
            "Judge meaning from the provided evidence. Do not award coverage from headings, keyword hits, or fixed prose fragments alone. "
            "Return only JSON matching expected_output_schema."
        ),
        "constitution": {
            "title": "Semantic Matcher Constitution",
            "forbidden_methods": [
                "literal headings",
                "keyword hits",
                "fixed prose fragments",
                "section-name presence as coverage proof",
            ],
            "allowed_exact_matching": [
                "machine-controlled schema fields",
                "enum values",
                "JSON keys",
                "file paths",
                "system markers",
            ],
        },
        "coverage_keys": _coverage_key_contracts(),
        "quality_dimensions": _quality_dimension_contracts(),
        "root_cause_labels": ["test_gap", "system_gap", "report_gap", "design_gap"],
        "inputs": {
            "playtest": context.metadata,
            "campaign": context.campaign,
            "party": context.party,
            "characters": context.characters,
            "battle_report": context.battle_report,
            "transcript": context.transcript,
            "player_feedback": context.player_feedback,
            "rolls": context.rolls,
            "state_events": context.state_events,
            "session_summaries": context.session_summaries,
        },
        "expected_output_schema": {
            "required": [
                "schema_version",
                "run_id",
                "evaluator_id",
                "coverage",
                "quality",
                "root_cause_classification",
                "next_loop_fix_target",
            ],
            "coverage_value": {
                "covered": "boolean",
                "reason": "short semantic justification based on evidence, not keyword matching",
            },
            "quality_value": {
                "score": "integer from 1 to 5",
                "passed": "boolean; true only when score is at least 4 and the dimension is table-ready",
                "reason": "short semantic quality justification",
            },
        },
    }


def write_semantic_eval_requests(root: Path) -> list[Path]:
    request_paths: list[Path] = []
    for playtest_path in sorted(_playtests_dir(root).glob("*/playtest.json")):
        run_dir = playtest_path.parent
        metadata = _read_json(playtest_path, {})
        run_id = str(metadata.get("run_id") or run_dir.name)
        battle_text = _read_text(run_dir / "artifacts" / "battle-report.md")
        context = _coverage_context(run_dir, metadata, battle_text, run_id)
        request_path = run_dir / "artifacts" / SEMANTIC_EVAL_REQUEST
        _write_json(request_path, _semantic_eval_request(context))
        request_paths.append(request_path)
    return request_paths


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

    lines.extend(["", "## Coverage Evidence"])
    for key, value in index["coverage"].items():
        lines.append(f"- {key}")
        if value["reasons"]:
            for run_id, reason in value["reasons"].items():
                run = next(run for run in index["runs"] if run["run_id"] == run_id)
                lines.append(f"  - {run_id} [{run['coverage_evaluator']}]: {reason}")
        else:
            lines.append("  - none")

    lines.extend(["", "## Quality Matrix"])
    for key, value in index["quality"].items():
        runs = ", ".join(value["runs"]) if value["runs"] else "none"
        score_bits = [f"{run_id}: {score}" for run_id, score in value["scores"].items()]
        scores = "; ".join(score_bits) if score_bits else "none"
        lines.append(f"- {key}: {value['status']} ({runs}) scores: {scores}")

    lines.extend(["", "## Quality Evidence"])
    for key, value in index["quality"].items():
        lines.append(f"- {key}")
        if value["reasons"]:
            for run_id, reason in value["reasons"].items():
                run = next(run for run in index["runs"] if run["run_id"] == run_id)
                lines.append(f"  - {run_id} [{run['coverage_evaluator']}]: {reason}")
        else:
            lines.append("  - none")

    decision = index["loop_decision"]
    lines.extend(["", "## Loop Decision"])
    lines.append(f"- Status: {decision['status']}")
    lines.append(f"- Next Action: {decision['next_action']}")
    lines.append(f"- Evaluated Runs: {', '.join(decision['evaluated_runs']) if decision['evaluated_runs'] else 'none'}")
    ignored = ", ".join(decision["ignored_historical_runs"]) if decision["ignored_historical_runs"] else "none"
    lines.append(f"- Ignored Historical Runs: {ignored}")
    if decision["blockers"]:
        lines.append("- Blockers:")
        for blocker in decision["blockers"]:
            label = blocker.get("run_id") or blocker.get("key", "suite")
            lines.append(f"  - {blocker['type']} {label}: {blocker['next_loop_fix_target']}")
    else:
        lines.append("- Blockers: none")

    lines.extend(["", "## Repair Targets"])
    active_run_ids = set(decision["evaluated_runs"])
    for run in index["runs"]:
        if run["run_id"] not in active_run_ids:
            continue
        classifications = run.get("root_cause_classification", [])
        classification_text = ", ".join(classifications) if classifications else "none"
        lines.append(f"- {run['run_id']}: {run.get('next_loop_fix_target', 'none')} (root causes: {classification_text})")

    lines.extend(["", "## Remaining Gaps"])
    if index["gaps"]:
        for gap in index["gaps"]:
            lines.append(f"- {gap}")
    else:
        lines.append("- No gaps detected across indexed playtest runs.")

    lines.extend(["", "## Remaining Quality Gaps"])
    if index["quality_gaps"]:
        for gap in index["quality_gaps"]:
            lines.append(f"- {gap}")
    else:
        lines.append("- No quality gaps detected across indexed playtest runs.")

    lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")


def generate_suite_report(root: Path, evaluator: CoverageEvaluator | None = None) -> Path:
    evaluator = evaluator or StructuredSourceCoverageEvaluator()
    base = _playtests_dir(root)
    runs = _discover_runs(root, evaluator)
    matrix = _coverage_matrix(runs)
    quality = _quality_matrix(runs)
    index = {
        "schema_version": 1,
        "runs": runs,
        "coverage": matrix,
        "quality": quality,
        "gaps": _gaps(matrix),
        "quality_gaps": _gaps(quality),
        "non_passing_runs": _non_passing_runs(runs),
    }
    index["loop_decision"] = _loop_decision(index)
    index_path = base / "index.json"
    loop_decision_path = base / "loop-decision.json"
    report_path = base / "suite-report.md"
    _write_json(index_path, index)
    _write_json(loop_decision_path, index["loop_decision"])
    _write_report(report_path, index)
    return report_path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=".")
    parser.add_argument("--write-semantic-requests", action="store_true")
    parser.add_argument("--evaluator", choices=["structured-source", "semantic-artifact"], default="structured-source")
    args = parser.parse_args()
    root = Path(args.root)
    if args.write_semantic_requests:
        for request_path in write_semantic_eval_requests(root):
            print(request_path)
    evaluator: CoverageEvaluator
    if args.evaluator == "semantic-artifact":
        evaluator = SemanticArtifactCoverageEvaluator()
    else:
        evaluator = StructuredSourceCoverageEvaluator()
    print(generate_suite_report(root, evaluator=evaluator))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
