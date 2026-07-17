#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import tomllib
from collections import Counter
from contextlib import ExitStack
from pathlib import Path
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from coc_playtest_report import (
    _display_transcript_speaker,
    _display_transcript_text,
    _event_roll_count,
    _format_feedback,
    _format_roll_recap,
    _format_roll_source_line,
    _format_roll_transcript_text,
    _localized_actor_names,
    _localized_report_value,
    _selected_language_profile,
)
from coc_language import localize_terms
from coc_playtest_runs import is_final_run_name, open_published_run
from coc_validate import validate_rules
from coc_rules import cash_and_assets, pushed_roll_rule, rule_ids
from coc_eval_packs import load_benchmark_pack_registry


REQUIRED_AUDIT_PROFILES = ["haunting_module", "chase_drill", "multi_profile_pressure"]
BLOCKING_EVALUATOR_NOTE_SEVERITIES = {"medium", "high", "critical", "error", "fail", "failed"}
REQUIRED_ARTIFACTS = [
    "battle-report.md",
    "evaluation-report.md",
    "rulebook-audit.md",
    "semantic-eval-request.json",
    "semantic-eval-result.json",
]
REQUIRED_RUN_SOURCE_FILES = [
    "playtest.json",
    "transcript.jsonl",
    "player-view.jsonl",
    "keeper-view.jsonl",
    "player-feedback.jsonl",
    "evaluator-notes.jsonl",
]
REQUIRED_CAMPAIGN_SOURCE_FILES = [
    "campaign.json",
    "party.json",
    "scenario/scenario.json",
    "scenario/handouts.json",
    "logs/rolls.jsonl",
    "logs/events.jsonl",
    "memory/session-summaries.jsonl",
]
REQUIRED_CAMPAIGN_SAVE_FILES = [
    "save/world-state.json",
    "save/active-scene.json",
    "save/flags.json",
]
REQUIRED_CAMPAIGN_INDEX_FILES = [
    "index/source-map.json",
    "index/scene-index.json",
    "index/npc-index.json",
    "index/clue-index.json",
    "index/rule-ref-index.json",
]
REQUIRED_WORKSPACE_INDEX_FILES = [
    "indexes/investigators.json",
    "indexes/campaigns.json",
]
PROFILE_REQUIRED_CAMPAIGN_SAVE_FILES = {
    "haunting_module": ["save/combat.json"],
    "chase_drill": ["save/chase.json"],
}
REQUIRED_INVESTIGATOR_SOURCE_FILES = [
    "creation.json",
    "character.json",
    "history.jsonl",
    "development.jsonl",
    "inventory-history.jsonl",
]
JSON_ARRAY_SOURCE_FILES = {
    "scenario/handouts.json",
}
REQUIRED_COVERAGE_DIMENSIONS = [
    "character_dossier",
    "kp_player_transcript",
    "mechanical_rolls",
    "combat",
    "chase",
    "sanity",
    "meta_game",
    "player_feedback",
]
REQUIRED_QUALITY_DIMENSIONS = [
    "module_fidelity",
    "rulebook_procedure",
    "immersion_and_pacing",
    "localized_visible_dialogue",
    "actual_play_replay",
    "state_continuity",
    "spoiler_safety",
    "player_agency",
    "virtual_player_pressure",
    "report_completeness",
]
PROFILE_EVENT_TYPE_REQUIREMENTS = {
    "haunting_module": ["combat", "resource_change", "sanity", "status", "session_ending"],
    "chase_drill": ["chase", "item_transfer", "status", "session_ending"],
    "multi_profile_pressure": ["decision", "status", "session_ending"],
}
PUSHED_ROLL_REQUIRED_PROFILES = {"haunting_module", "chase_drill", "multi_profile_pressure"}
MULTI_PROFILE_SOURCE_REQUIREMENTS = {
    "multi_profile_pressure": ["careful_investigator", "reckless_investigator", "skeptical_rules_lawyer"],
}
META_GAME_REQUIRED_PROFILES = {"haunting_module", "chase_drill", "multi_profile_pressure"}
SPOILER_REVEAL_REQUIRED_PROFILES = {"multi_profile_pressure"}
SPOILER_REVEAL_PROTOCOL_STAGES = [
    "warning_issued",
    "player_confirmed",
    "limited_reveal",
]
PLAYER_VISIBLE_PROTOCOL_WRAPPERS = (
    "[meta]",
    "[/meta]",
    "[spoiler_warning]",
    "[/spoiler_warning]",
)
TRANSCRIPT_SOURCE_LOCALIZED_TEXT_FIELDS = (
    "text",
)
TRANSCRIPT_SOURCE_LOCALIZED_VISIBLE_FIELDS = (
    "outcome_note",
)
REQUIRED_EVALUATION_REPORT_SECTIONS = [
    "# Evaluation Report",
    "## Overall Result",
    "## Scorecard",
    "## Passed Test Cases",
    "## Failed Test Cases",
    "## Rule Accuracy Findings",
    "## State Integrity Findings",
    "## Spoiler Safety Findings",
    "## Immersion Findings",
    "## Meta-Game Findings",
    "## Reproducible Bugs",
    "## Recommended Fixes",
    "## Regression Tests To Add",
]


def _pushed_roll_protocol_stages() -> list[str]:
    return pushed_roll_rule()["required_stages"]


def _pushed_roll_stage_role_is_valid(row: dict[str, Any], stage: Any) -> bool:
    protocol = row.get("pushed_roll_protocol")
    if not isinstance(protocol, dict) or not isinstance(stage, str):
        return False
    role = row.get("role")
    if stage.startswith("player_"):
        if role != "player_simulator":
            return False
        if stage == "player_confirms_risk":
            return protocol.get("risk_confirmed") is True
        return True
    if stage.startswith("keeper_"):
        if role != "keeper_under_test":
            return False
        if stage == "keeper_foreshadows_failure":
            return protocol.get("failure_consequence_source") == "keeper"
        return True
    if stage == "roll_resolved":
        return role == "system"
    return True


REQUIRED_BATTLE_REPORT_ANCHORS = [
    "Battle Report",
    "Run Setup",
    "Module",
    "Handouts",
    "Investigator Creation",
    "Character Dossier",
    "Investigator Chronicle",
    "Scene-by-Scene Replay",
    "Actual Play Replay",
    "Session Transcript",
    "Mechanical Log",
    "Chase Tracker",
    "Story Recap",
    "Player Feedback On KP",
]
REQUIRED_BATTLE_REPORT_FIELD_ANCHORS = {
    "Run Setup": [
        "Run ID",
        "Campaign ID",
        "Campaign",
        "Audit Profile",
        "Simulation Method",
        "Era",
        "Dice Mode",
        "Spoiler Policy",
        "Play Language",
        "Language Profile",
        "Localized Terms",
        "Player Profile",
    ],
    "Module": [
        "Scenario",
        "Scenario ID",
        "Source",
        "Opening Scene",
    ],
}
REQUIRED_SUITE_REPORT_SECTIONS = [
    "# COC Playtest Suite Report",
    "## Run Index",
    "## Non-Passing Evaluated Runs",
    "## Core Coverage Matrix",
    "## Coverage Evidence",
    "## Quality Matrix",
    "## Quality Evidence",
    "## Loop Decision",
    "## Remaining Gaps",
]
REQUIRED_RULEBOOK_AUDIT_SECTIONS = [
    "# Rulebook Alignment Audit",
    "## Overall Result",
    "## Positive Rulebook Evidence",
    "## Root Cause Classification",
    "## Blueprint Cross-Check",
    "## Next Loop Fix Target",
]
REQUIRED_SEMANTIC_REQUEST_FIELDS = [
    "schema_version",
    "run_id",
    "evaluator_id",
    "evaluation_provenance",
    "coverage",
    "quality",
    "root_cause_classification",
    "next_loop_fix_target",
]
REPORT_ANCHOR_PREFIX = "<!-- report-anchor: "
REPORT_ANCHOR_SUFFIX = " -->"
CJK_BOUNDARY_SPACE = re.compile(r"(?<=[\u4e00-\u9fff·》」』”）]) (?=[\u4e00-\u9fff《「『“（])")
HTML_COMMENT = re.compile(r"<!--.*?-->", re.DOTALL)
INVESTIGATOR_CHRONICLE_TEXT_FIELDS = {
    "history.jsonl": ["summary"],
    "development.jsonl": ["summary", "carryover_notes"],
    "inventory-history.jsonl": ["summary", "notes"],
}


def _read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return default


def _read_text(path: Path) -> str:
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8")


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    rows: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            return []
        if isinstance(row, dict):
            rows.append(row)
    return rows


def _metadata_localized_terms(metadata: dict[str, Any]) -> dict[str, str]:
    play_language = str(metadata.get("play_language") or "")
    localized_terms = metadata.get("localized_terms", {})
    if not isinstance(localized_terms, dict):
        return {}
    terms = localized_terms.get(play_language, {})
    if not isinstance(terms, dict):
        return {}
    return {
        str(key): str(value)
        for key, value in terms.items()
        if str(key) and str(value)
    }


def _metadata_player_profile_labels(metadata: dict[str, Any]) -> dict[str, str]:
    play_language = str(metadata.get("play_language") or "")
    labels_by_language = metadata.get("player_profile_labels", {})
    if not isinstance(labels_by_language, dict):
        return {}
    labels = labels_by_language.get(play_language, {})
    if not isinstance(labels, dict):
        return {}
    return {
        str(key): str(value)
        for key, value in labels.items()
        if str(key) and str(value)
    }


def _localize_text(text: str, localized_terms: dict[str, str]) -> str:
    localized = localize_terms(text, localized_terms)
    return CJK_BOUNDARY_SPACE.sub("", localized)


def _localize_json_value(value: Any, localized_terms: dict[str, str]) -> Any:
    if isinstance(value, str):
        return _localize_text(value, localized_terms)
    if isinstance(value, list):
        return [_localize_json_value(item, localized_terms) for item in value]
    if isinstance(value, dict):
        return {key: _localize_json_value(item, localized_terms) for key, item in value.items()}
    return value


def _localize_current_state_value(key: str, value: Any, localized_terms: dict[str, str]) -> Any:
    if key == "conditions" and isinstance(value, list):
        localized_conditions: list[Any] = []
        for condition in value:
            if not isinstance(condition, dict):
                localized_conditions.append(_localize_json_value(condition, localized_terms))
                continue
            localized_conditions.append({
                condition_key: _localize_json_value(condition_value, localized_terms)
                if condition_key in {"label", "player_visible_summary", "summary"}
                else condition_value
                for condition_key, condition_value in condition.items()
            })
        return localized_conditions
    if key == "last_status_summary":
        return _localize_json_value(value, localized_terms)
    return value


def _text_rendered_in_report(text: str, battle_report: str, localized_terms: dict[str, str]) -> bool:
    candidates = {text, _localize_text(text, localized_terms)}
    return any(candidate and candidate in battle_report for candidate in candidates)


def _visible_markdown_text(text: str) -> str:
    return HTML_COMMENT.sub("", text)


def _localized_source_field(
    row: dict[str, Any],
    key: str,
    metadata: dict[str, Any],
    localized_terms: dict[str, str],
) -> str | None:
    play_language = str(metadata.get("play_language") or "")
    localized_text = row.get("localized_text")
    if isinstance(localized_text, dict):
        language_text = localized_text.get(play_language)
        if isinstance(language_text, dict) and language_text.get(key) not in (None, "", [], {}):
            return _localize_text(str(language_text[key]), localized_terms)
    if row.get(key) in (None, "", [], {}):
        return None
    return _localize_text(str(row[key]), localized_terms)


def _source_field_candidates(
    row: dict[str, Any],
    key: str,
    metadata: dict[str, Any],
    localized_terms: dict[str, str],
    normalizer: Any | None = None,
) -> list[str]:
    candidates: list[str] = []
    if row.get(key) not in (None, "", [], {}):
        candidates.append(str(row[key]))
    localized = _localized_source_field(row, key, metadata, localized_terms)
    if localized:
        candidates.append(localized)
    normalized: list[str] = []
    for candidate in candidates:
        value = str(candidate).strip()
        if normalizer is not None:
            value = str(normalizer(value)).strip()
        if value and value not in normalized:
            normalized.append(value)
    return normalized


def _any_candidate_rendered(
    candidates: list[str],
    battle_report: str,
    localized_terms: dict[str, str],
) -> bool:
    return any(_text_rendered_in_report(candidate, battle_report, localized_terms) for candidate in candidates)


def _run_dir_from_campaign_dir(campaign_dir: Path) -> Path:
    if len(campaign_dir.parents) >= 4:
        return campaign_dir.parents[3]
    return campaign_dir


def _metadata_for_campaign_dir(campaign_dir: Path) -> dict[str, Any]:
    return _read_json(_run_dir_from_campaign_dir(campaign_dir) / "playtest.json", {})


def _profile_label(metadata: dict[str, Any], label_group: str, canonical: str) -> str:
    language_profile = metadata.get("language_profile", {})
    if not isinstance(language_profile, dict):
        return canonical
    labels = language_profile.get(label_group, {})
    if not isinstance(labels, dict):
        return canonical
    return str(labels.get(canonical) or canonical)


def _json_sha256(payload: Any) -> str:
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _entry_keys(value: Any) -> set[str]:
    if not isinstance(value, list):
        return set()
    return {
        str(entry.get("key"))
        for entry in value
        if isinstance(entry, dict) and entry.get("key")
    }


def _playtests_dir(root: Path) -> Path:
    return root / ".coc" / "playtests"


def _finding(code: str, cause: str, evidence: str, recommendation: str, **extra: Any) -> dict[str, Any]:
    finding = {
        "code": code,
        "cause": cause,
        "evidence": evidence,
        "recommendation": recommendation,
    }
    finding.update(extra)
    return finding


def _active_runs(
    root: Path,
    index: dict[str, Any],
    loop_decision: dict[str, Any],
) -> list[dict[str, Any]]:
    stack = ExitStack()
    active_ids = set(loop_decision.get("evaluated_runs", []))
    active: list[dict[str, Any]] = []
    try:
        for run in index.get("runs", []):
            run_id = run.get("run_id")
            path = run.get("path")
            if isinstance(path, str) and path:
                candidate = Path(path)
                if not candidate.is_absolute():
                    candidate = root / candidate
            else:
                candidate = _playtests_dir(root) / str(run_id)
            if run_id not in active_ids or not is_final_run_name(run_id):
                continue
            try:
                opened = stack.enter_context(open_published_run(
                    candidate,
                    purpose="completion audit active-run read",
                    require_metadata=True,
                    allow_missing=True,
                ))
            except ValueError:
                continue
            if opened is not None:
                retained = dict(run)
                retained["_opened_path"] = opened
                active.append(retained)
    except Exception:
        stack.close()
        raise
    # The caller closes this retained descriptor set after every active-run
    # consumer has finished.  A finalizer is a safety net for direct test use.
    return _RetainedActiveRuns(active, stack)


class _RetainedActiveRuns(list[dict[str, Any]]):
    def __init__(self, runs: list[dict[str, Any]], stack: ExitStack) -> None:
        super().__init__(runs)
        self._stack = stack

    def close(self) -> None:
        self._stack.close()

    def __del__(self) -> None:
        self.close()


def _opened_run_path(root: Path, run: dict[str, Any]) -> Path:
    opened = run.get("_opened_path")
    if opened is not None:
        return opened
    return _playtests_dir(root) / str(run.get("run_id") or "")


def _required_profiles(active_runs: list[dict[str, Any]]) -> dict[str, str | None]:
    profiles: dict[str, str | None] = {profile: None for profile in REQUIRED_AUDIT_PROFILES}
    for run in active_runs:
        audit_profile = run.get("audit_profile")
        if audit_profile in profiles and profiles[audit_profile] is None:
            profiles[audit_profile] = str(run.get("run_id"))
    return profiles


EVAL_SPEC_REL = Path("evaluation/spec/v1")
BENCHMARK_MANIFEST_REL = EVAL_SPEC_REL / "benchmark-manifest.json"
CASE_REGISTRY_REL = EVAL_SPEC_REL / "case-registry.json"
LONG_MEMORY_CASE_REL = EVAL_SPEC_REL / "cases" / "long-memory.json"
BENCHMARK_PACKS_REL = EVAL_SPEC_REL / "benchmark-packs.json"
UNBOUND_HOLDOUT_STATUSES = frozenset({"example_unbound", "not_bound", "NOT_RUN"})
EVAL_STATUS_RANK = {
    "FAIL": 5,
    "INELIGIBLE": 4,
    "NON_COMPARABLE": 3,
    "NOT_RUN": 2,
    "PASS": 1,
}
EXPECTED_EVAL_MODELS = {
    "player": {"provider": "coding-relay", "id": "gpt-5.6-luna"},
    "kp": {"provider": "zhipu-coding", "id": "glm-5.2"},
    "judge": {"provider": "coding-relay", "id": "gpt-5.6-sol"},
}


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    digest.update(path.read_bytes())
    return digest.hexdigest()


def _load_eval_json(root: Path, relative: Path) -> dict[str, Any]:
    path = Path(root) / relative
    payload = _read_json(path, {})
    if not isinstance(payload, dict):
        raise ValueError(f"expected JSON object at {path}")
    return payload


def build_eval_contract_requirements(
    root: Path | str,
    suite: str = "release",
) -> dict[str, Any]:
    """Derive required case/persona/seed cells from evaluation/spec/v1."""
    root_path = Path(root)
    manifest = _load_eval_json(root_path, BENCHMARK_MANIFEST_REL)
    registry = _load_eval_json(root_path, CASE_REGISTRY_REL)
    suite_def = (manifest.get("suites") or {}).get(suite)
    if not isinstance(suite_def, dict):
        raise ValueError(f"unknown suite in benchmark manifest: {suite}")

    cases = registry.get("cases") if isinstance(registry.get("cases"), list) else []
    direct_case_ids = [
        str(case["case_id"])
        for case in cases
        if isinstance(case, dict)
        and isinstance(case.get("case_id"), str)
        and suite in (case.get("suites") or [])
    ]
    if direct_case_ids:
        case_ids = sorted(set(direct_case_ids))
    else:
        # Nightly/release may not yet register suite-tagged cases. The
        # deterministic foundation remains the hard smoke/pr registry cells;
        # historical playtest profiles never substitute for these cells.
        case_ids = sorted(
            {
                str(case["case_id"])
                for case in cases
                if isinstance(case, dict)
                and isinstance(case.get("case_id"), str)
                and case.get("gate") == "hard"
                and set(case.get("suites") or []) & {"smoke", "pr"}
            }
        )

    matrix_suite = ((manifest.get("matrix") or {}).get("suites") or {}).get(suite) or {}
    persona_ids = [
        str(item)
        for item in (matrix_suite.get("persona_ids") or [])
        if isinstance(item, str) and item
    ]
    seeds = [
        int(item)
        for item in (matrix_suite.get("seeds") or [])
        if isinstance(item, int) or (isinstance(item, str) and str(item).isdigit())
    ]
    matrix_case_ids = [
        str(case.get("case_id"))
        for case in (matrix_suite.get("cases") or [])
        if isinstance(case, dict) and isinstance(case.get("case_id"), str)
    ]
    matrix_required_rubric_ids_by_case: dict[str, list[str]] = {}
    for case in matrix_suite.get("cases") or []:
        if not isinstance(case, dict) or not isinstance(case.get("case_id"), str):
            continue
        rubric_ids: list[str] = []
        profile_rel = case.get("evaluation_profile")
        if isinstance(profile_rel, str) and profile_rel:
            profile = _load_eval_json(root_path, Path(profile_rel))
            rubric_ids = [
                str(item)
                for item in (profile.get("required_rubric_ids") or [])
                if isinstance(item, str) and item
            ]
        if not rubric_ids:
            judge_cfg = case.get("judge") if isinstance(case.get("judge"), dict) else {}
            configured = judge_cfg.get("rubric_ids")
            if isinstance(configured, list):
                rubric_ids = [
                    str(item)
                    for item in configured
                    if isinstance(item, str) and item
                ]
            elif isinstance(judge_cfg.get("rubric_id"), str) and judge_cfg["rubric_id"]:
                rubric_ids = [str(judge_cfg["rubric_id"])]
        matrix_required_rubric_ids_by_case[str(case["case_id"])] = list(
            dict.fromkeys(rubric_ids or ["agency-and-fun"])
        )
    continuity_lane_ids: list[str] = []
    if suite in {"nightly", "release"}:
        long_memory = _load_eval_json(root_path, LONG_MEMORY_CASE_REL)
        continuity_lane_ids = [
            str(lane.get("lane_id"))
            for lane in (long_memory.get("lanes") or [])
            if isinstance(lane, dict)
            and isinstance(lane.get("lane_id"), str)
            and lane["lane_id"]
        ]
    benchmark_packs: list[dict[str, Any]] = []
    if (root_path / BENCHMARK_PACKS_REL).is_file():
        pack_registry = load_benchmark_pack_registry(root_path, manifest=manifest)
        benchmark_packs = [
            dict(pack)
            for pack in pack_registry["packs"]
            if suite in (pack.get("suites") or [])
        ]

    return {
        "schema_version": 1,
        "eval_spec": str(manifest.get("eval_spec") or "eval-spec-v1"),
        "benchmark_version": manifest.get("benchmark_version"),
        "suite": suite,
        "required_capabilities": list(suite_def.get("required_capabilities") or []),
        "implemented_capabilities": list(manifest.get("implemented_capabilities") or []),
        "case_ids": case_ids,
        "persona_ids": persona_ids,
        "seeds": seeds,
        "matrix_case_ids": matrix_case_ids,
        "matrix_required_rubric_ids_by_case": matrix_required_rubric_ids_by_case,
        "continuity_lane_ids": continuity_lane_ids,
        "benchmark_pack_ids": [pack["pack_id"] for pack in benchmark_packs],
        "benchmark_packs": benchmark_packs,
        "historical_audit_profiles": list(REQUIRED_AUDIT_PROFILES),
        "historical_profiles_satisfy_release": False,
    }


def assess_eval_contract_coverage(
    root: Path | str,
    *,
    suite: str = "release",
    case_results: dict[str, Any] | None = None,
    matrix_results: dict[str, Any] | None = None,
    continuity_results: dict[str, Any] | None = None,
    release_external_results: dict[str, Any] | None = None,
    historical_profiles: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Compare versioned required cells against provided structured evidence."""
    requirements = build_eval_contract_requirements(root, suite=suite)
    required_cases = set(requirements["case_ids"])
    required_personas = set(requirements["persona_ids"])
    required_seeds = set(requirements["seeds"])
    required_matrix_cases = set(requirements["matrix_case_ids"])
    required_rubrics_by_case = requirements[
        "matrix_required_rubric_ids_by_case"
    ]
    required_matrix_cells = {
        f"{persona}__seed-{seed}__{case_id}"
        for persona in required_personas
        for seed in required_seeds
        for case_id in required_matrix_cases
    }
    required_continuity = set(requirements["continuity_lane_ids"])
    required_packs = {
        str(pack["pack_id"]): pack for pack in requirements["benchmark_packs"]
    }

    def _sha256(value: Any) -> bool:
        return isinstance(value, str) and len(value) == 64 and all(
            character in "0123456789abcdef" for character in value.lower()
        )

    def _hashes_include(value: Any, required: set[str]) -> bool:
        return bool(
            isinstance(value, dict)
            and required <= set(value)
            and all(_sha256(value[name]) for name in required)
        )

    case_envelope_grade = bool(
        isinstance(case_results, dict)
        and case_results.get("schema_version") == 1
        and case_results.get("eval_spec") == requirements["eval_spec"]
        and case_results.get("suite") == suite
        and case_results.get("status") == "PASS"
    )
    observed_cases: list[str] = []
    eligible_cases: list[str] = []
    if isinstance(case_results, dict):
        for case in case_results.get("cases") or []:
            if not isinstance(case, dict):
                continue
            case_id = case.get("case_id")
            hashes = case.get("artifact_hashes")
            if isinstance(case_id, str) and case_id in required_cases:
                observed_cases.append(case_id)
            if (
                case_envelope_grade
                and isinstance(case_id, str)
                and case_id in required_cases
                and case.get("status") == "PASS"
                and isinstance(hashes, dict)
                and bool(hashes)
                and all(_sha256(value) for value in hashes.values())
            ):
                eligible_cases.append(case_id)
    observed_case_counts = Counter(observed_cases)
    eligible_case_counts = Counter(eligible_cases)
    satisfied_cases = {
        case_id
        for case_id in required_cases
        if observed_case_counts[case_id] == 1
        and eligible_case_counts[case_id] == 1
    }

    matrix_envelope_grade = bool(
        isinstance(matrix_results, dict)
        and matrix_results.get("schema_version") == 1
        and matrix_results.get("eval_spec") == requirements["eval_spec"]
        and matrix_results.get("suite") == suite
        and matrix_results.get("status") == "PASS"
        and _hashes_include(
            matrix_results.get("artifact_hashes"),
            {"matrix-plan.json", "aggregate-summary.json"},
        )
    )
    observed_personas: set[str] = set()
    observed_seeds: set[int] = set()
    observed_matrix_cells: set[str] = set()
    eligible_matrix_cells: list[str] = []
    if isinstance(matrix_results, dict):
        for cell in matrix_results.get("cells") or []:
            if not isinstance(cell, dict):
                continue
            persona_id = cell.get("persona_id")
            seed = cell.get("seed")
            if isinstance(persona_id, str):
                observed_personas.add(persona_id)
            if isinstance(seed, int):
                observed_seeds.add(seed)
            elif isinstance(seed, str) and seed.isdigit():
                observed_seeds.add(int(seed))
            status = cell.get("status")
            case_id = cell.get("case_id")
            cell_id = cell.get("cell_id")
            if isinstance(cell_id, str):
                observed_matrix_cells.add(cell_id)
            required_rubric_ids = required_rubrics_by_case.get(
                str(case_id), ["agency-and-fun"]
            )
            judge_results = cell.get("judge_results")
            if not isinstance(judge_results, dict) and len(required_rubric_ids) == 1:
                legacy_result = cell.get("judge_result")
                judge_results = (
                    {required_rubric_ids[0]: legacy_result}
                    if isinstance(legacy_result, dict)
                    else {}
                )
            judge_gates = cell.get("judge_gates")
            judge_gate_by_rubric = {
                str(gate.get("rubric_id")): gate
                for gate in judge_gates or []
                if isinstance(gate, dict) and isinstance(gate.get("rubric_id"), str)
            }
            required_judge_artifacts = {
                (
                    "judge-result.json"
                    if len(required_rubric_ids) == 1
                    else f"judge-result.{rubric_id}.json"
                )
                for rubric_id in required_rubric_ids
            }
            judge_grade = bool(
                isinstance(judge_results, dict)
                and set(judge_results) == set(required_rubric_ids)
                and all(
                    isinstance(judge_results.get(rubric_id), dict)
                    and judge_results[rubric_id].get("evaluator")
                    == EXPECTED_EVAL_MODELS["judge"]
                    for rubric_id in required_rubric_ids
                )
                and (
                    len(required_rubric_ids) == 1
                    or (
                        set(judge_gate_by_rubric) == set(required_rubric_ids)
                        and all(
                            judge_gate_by_rubric[rubric_id].get("status") == "PASS"
                            for rubric_id in required_rubric_ids
                        )
                    )
                )
            )
            grade = bool(
                matrix_envelope_grade
                and isinstance(cell_id, str)
                and cell_id
                == f"{persona_id}__seed-{seed}__{case_id}"
                and cell_id in required_matrix_cells
                and status == "PASS"
                and cell.get("player_model") == EXPECTED_EVAL_MODELS["player"]
                and cell.get("kp_model") == EXPECTED_EVAL_MODELS["kp"]
                and cell.get("judge_model") == EXPECTED_EVAL_MODELS["judge"]
                and isinstance(cell.get("runner_result"), dict)
                and cell["runner_result"].get("status") == "PASS"
                and judge_grade
                and _hashes_include(
                    cell.get("artifact_hashes"),
                    {
                        "run-manifest.json",
                        "player-request.json",
                        "kp-request.json",
                    }
                    | required_judge_artifacts,
                )
                and not cell.get("hard_findings")
                and not cell.get("not_run_reasons")
                and not cell.get("identity_mismatches")
            )
            if grade:
                eligible_matrix_cells.append(cell_id)

    eligible_counts = Counter(eligible_matrix_cells)
    satisfied_matrix_cells = {
        cell_id
        for cell_id in required_matrix_cells
        if eligible_counts[cell_id] == 1
    }
    satisfied_personas = {
        persona
        for persona in required_personas
        if all(
            f"{persona}__seed-{seed}__{case_id}" in satisfied_matrix_cells
            for seed in required_seeds
            for case_id in required_matrix_cases
        )
    }
    satisfied_seeds = {
        seed
        for seed in required_seeds
        if all(
            f"{persona}__seed-{seed}__{case_id}" in satisfied_matrix_cells
            for persona in required_personas
            for case_id in required_matrix_cases
        )
    }

    observed_continuity: set[str] = set()
    satisfied_continuity: set[str] = set()
    if isinstance(continuity_results, dict):
        for key, result in continuity_results.items():
            if not isinstance(result, dict):
                continue
            lane_id = result.get("lane_id")
            if not isinstance(lane_id, str) or not lane_id:
                lane_id = str(key)
            observed_continuity.add(lane_id)
            validation = result.get("validation")
            attestation = result.get("attestation")
            grade = bool(
                lane_id in required_continuity
                and result.get("schema_version") == 1
                and result.get("eval_spec") == requirements["eval_spec"]
                and result.get("status") == "PASS"
                and result.get("evidence_class") == "external"
                and result.get("eligible") is True
                and isinstance(validation, dict)
                and validation.get("status") == "PASS"
                and validation.get("evidence_class") == "external"
                and validation.get("gameplay_evidence") is True
                and isinstance(attestation, dict)
                and attestation.get("attested") is True
                and attestation.get("player_model") == EXPECTED_EVAL_MODELS["player"]
                and attestation.get("kp_model") == EXPECTED_EVAL_MODELS["kp"]
            )
            if grade:
                satisfied_continuity.add(lane_id)

    historical_visible = bool(historical_profiles)
    # Historical three-profile runs remain visible but never clear eval cells.
    if historical_profiles:
        historical_visible = True

    satisfied_packs: set[str] = set()
    for pack_id, pack in required_packs.items():
        route = pack.get("route") or {}
        route_kind = route.get("kind")
        if route_kind == "registered_case" and route.get("case_id") in satisfied_cases:
            satisfied_packs.add(pack_id)
        elif route_kind == "matrix_case":
            matrix_case_id = (route.get("case_ids_by_suite") or {}).get(suite)
            if isinstance(matrix_case_id, str) and all(
                f"{persona}__seed-{seed}__{matrix_case_id}" in satisfied_matrix_cells
                for persona in required_personas
                for seed in required_seeds
            ):
                satisfied_packs.add(pack_id)
        elif (
            route_kind == "continuity_lane"
            and route.get("lane_id") in satisfied_continuity
        ):
            satisfied_packs.add(pack_id)
        elif route_kind == "release_external_bundle" and isinstance(
            release_external_results, dict
        ):
            external_lanes = release_external_results.get("lanes") or {}
            chapter = external_lanes.get("chapter_transition") or {}
            holdout = external_lanes.get("holdout") or {}
            human = external_lanes.get("human_calibration") or {}
            agreement = human.get("agreement") or {}
            if (
                release_external_results.get("status") == "PASS"
                and chapter.get("status") == "PASS"
                and chapter.get("evidence_class") == "external"
                and chapter.get("gameplay_evidence") is True
                and holdout.get("status") == "PASS"
                and human.get("status") == "PASS"
                and int(agreement.get("reviewer_count") or 0) >= 2
            ):
                satisfied_packs.add(pack_id)

    gap_cases = sorted(required_cases - satisfied_cases)
    gap_personas = sorted(required_personas - satisfied_personas)
    gap_seeds = sorted(required_seeds - satisfied_seeds)
    gap_matrix_cells = sorted(required_matrix_cells - satisfied_matrix_cells)
    gap_continuity = sorted(required_continuity - satisfied_continuity)
    gap_packs = sorted(set(required_packs) - satisfied_packs)

    missing_caps = sorted(
        set(requirements["required_capabilities"])
        - set(requirements["implemented_capabilities"])
    )
    evidence_statuses = [
        str(payload.get("status"))
        for payload in (case_results, matrix_results)
        if isinstance(payload, dict) and payload.get("status") in EVAL_STATUS_RANK
    ]
    if isinstance(continuity_results, dict):
        evidence_statuses.extend(
            str(result.get("status"))
            for result in continuity_results.values()
            if isinstance(result, dict) and result.get("status") in EVAL_STATUS_RANK
        )
    gaps_present = bool(
        gap_cases
        or gap_personas
        or gap_seeds
        or gap_matrix_cells
        or gap_continuity
        or gap_packs
        or missing_caps
    )
    strongest = (
        max(evidence_statuses, key=EVAL_STATUS_RANK.__getitem__)
        if evidence_statuses
        else "NOT_RUN"
    )
    if gaps_present:
        status = strongest if EVAL_STATUS_RANK[strongest] > EVAL_STATUS_RANK["NOT_RUN"] else "NOT_RUN"
    else:
        status = strongest

    return {
        "schema_version": 1,
        "eval_spec": requirements["eval_spec"],
        "suite": suite,
        "status": status,
        "requirements": requirements,
        "satisfied_case_ids": sorted(satisfied_cases),
        "satisfied_persona_ids": sorted(satisfied_personas),
        "satisfied_seeds": sorted(satisfied_seeds),
        "satisfied_matrix_cell_ids": sorted(satisfied_matrix_cells),
        "satisfied_continuity_lane_ids": sorted(satisfied_continuity),
        "satisfied_benchmark_pack_ids": sorted(satisfied_packs),
        "observed_persona_ids": sorted(observed_personas),
        "observed_seeds": sorted(observed_seeds),
        "observed_matrix_cell_ids": sorted(observed_matrix_cells),
        "observed_continuity_lane_ids": sorted(observed_continuity),
        "gaps": {
            "case_ids": gap_cases,
            "persona_ids": gap_personas,
            "seeds": gap_seeds,
            "matrix_cells": gap_matrix_cells,
            "continuity_lane_ids": gap_continuity,
            "benchmark_pack_ids": gap_packs,
            "missing_capabilities": missing_caps,
        },
        "historical_profiles_visible": historical_visible,
        "historical_profiles_satisfy_release": False,
        "historical_profiles": dict(historical_profiles or {}),
    }


def bind_report_delivery_receipt(
    run_dir: Path | str,
    *,
    battle_report_path: Path | str,
    evaluation_report_path: Path | str,
    completeness_path: Path | str,
    expected_battle_report_sha256: str | None = None,
    expected_evaluation_report_sha256: str | None = None,
) -> dict[str, Any]:
    """Bind delivered report hashes to a completeness receipt (no prose rewrite)."""
    del run_dir  # Reserved for future run-dir relative checks; paths are explicit.
    findings: list[dict[str, Any]] = []
    battle_path = Path(battle_report_path)
    evaluation_path = Path(evaluation_report_path)
    receipt_path = Path(completeness_path)

    for label, path in (
        ("battle_report", battle_path),
        ("evaluation_report", evaluation_path),
        ("report_completeness", receipt_path),
    ):
        if not path.is_file():
            findings.append(
                _finding(
                    f"{label}_missing",
                    "report_gap",
                    f"missing {label}: {path}",
                    "Deliver generated artifacts with a verified completeness receipt.",
                )
            )

    if findings:
        return {
            "schema_version": 1,
            "status": "FAIL",
            "findings": findings,
        }

    battle_hash = _file_sha256(battle_path)
    evaluation_hash = _file_sha256(evaluation_path)
    receipt_hash = _file_sha256(receipt_path)
    receipt = _read_json(receipt_path, {})
    if not isinstance(receipt, dict) or receipt.get("passed") is not True:
        findings.append(
            _finding(
                "report_completeness_failed",
                "report_gap",
                f"completeness receipt not passed: {receipt_path}",
                "Regenerate reports from structured sources; do not rewrite facts by hand.",
            )
        )

    if (
        expected_battle_report_sha256 is not None
        and expected_battle_report_sha256 != battle_hash
    ):
        findings.append(
            _finding(
                "battle_report_hash_mismatch",
                "report_gap",
                (
                    f"battle report sha256 changed from {expected_battle_report_sha256} "
                    f"to {battle_hash}"
                ),
                "Deliver the generated battle report bound to its completeness receipt; "
                "do not apply handwritten factual rewrites.",
            )
        )
    if (
        expected_evaluation_report_sha256 is not None
        and expected_evaluation_report_sha256 != evaluation_hash
    ):
        findings.append(
            _finding(
                "evaluation_report_hash_mismatch",
                "report_gap",
                (
                    f"evaluation report sha256 changed from "
                    f"{expected_evaluation_report_sha256} to {evaluation_hash}"
                ),
                "Deliver the generated evaluation report bound to its completeness receipt.",
            )
        )

    return {
        "schema_version": 1,
        "status": "FAIL" if findings else "PASS",
        "battle_report_sha256": battle_hash,
        "evaluation_report_sha256": evaluation_hash,
        "report_completeness_sha256": receipt_hash,
        "findings": findings,
    }


def _rules_json_validation_findings(root: Path) -> list[dict[str, Any]]:
    plugin_root = root / "plugins" / "coc-keeper"
    if not plugin_root.exists():
        return []

    errors = validate_rules(plugin_root)
    if not errors:
        return []

    return [_finding(
        "rules_json_validation_failed",
        "system_gap",
        "rules-json validation errors: " + "; ".join(errors[:10]),
        "Repair plugins/coc-keeper/references/rules-json, then run uv run --frozen python plugins/coc-keeper/scripts/coc_validate.py rules plugins/coc-keeper.",
        incomplete_files=["plugins/coc-keeper/references/rules-json"],
        missing_evidence=errors,
    )]


def _monitor_status(automation_path: Path | None) -> tuple[str, str]:
    if automation_path is None:
        automation_path = Path.home() / ".codex" / "automations" / "coc-keeper" / "automation.toml"
    text = _read_text(automation_path)
    if not text:
        return "missing", str(automation_path)
    try:
        payload = tomllib.loads(text)
    except tomllib.TOMLDecodeError:
        return "invalid", str(automation_path)
    if str(payload.get("status", "")).upper() == "ACTIVE":
        return "ACTIVE", str(automation_path)
    return "inactive", str(automation_path)


def _format_note_evidence(evidence: Any) -> str:
    if not isinstance(evidence, dict):
        return ""
    parts: list[str] = []
    evidence_labels = [
        ("transcript_turns", "transcript turns"),
        ("transcript_event_ids", "transcript events"),
        ("log_paths", "logs"),
        ("state_files", "state"),
        ("artifact_paths", "artifacts"),
    ]
    for key, label in evidence_labels:
        value = evidence.get(key)
        if value in (None, "", [], {}):
            continue
        values = value if isinstance(value, list) else [value]
        parts.append(f"{label} {', '.join(str(item) for item in values)}")
    return "; ".join(parts)


def _evaluation_report_evidence_findings(run_id: str, run_dir: Path, evaluation_report: str) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    notes = _read_jsonl(run_dir / "evaluator-notes.jsonl")
    for index, note in enumerate(notes, start=1):
        evidence_text = _format_note_evidence(note.get("evidence"))
        if not evidence_text:
            findings.append(_finding(
                "evaluation_note_evidence_missing",
                "test_gap",
                f"{run_id} evaluator-notes.jsonl note {index} does not contain structured evidence.",
                "Record transcript_turns, log_paths, state_files, or artifact_paths on evaluator notes so evaluation reports can cite evidence.",
                run_id=run_id,
                note_index=index,
            ))
            continue
        if f"Evidence: {evidence_text}" not in evaluation_report:
            findings.append(_finding(
                "evaluation_report_evidence_missing",
                "report_gap",
                f"{run_id} evaluation-report.md does not cite evidence for evaluator note {index}.",
                "Regenerate evaluation-report.md so each evaluator finding cites transcript turns, log paths, state files, or artifact paths.",
                run_id=run_id,
                note_index=index,
            ))
    return findings


def _active_evaluator_note_findings(root: Path, active_runs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    for run in active_runs:
        run_id = str(run.get("run_id") or "")
        if not run_id:
            continue
        run_dir = _opened_run_path(root, run)
        for index, note in enumerate(_read_jsonl(run_dir / "evaluator-notes.jsonl"), start=1):
            severity = str(note.get("severity") or "").strip().lower()
            if severity not in BLOCKING_EVALUATOR_NOTE_SEVERITIES:
                continue
            category = str(note.get("category") or "uncategorized")
            text = str(note.get("text") or "No evaluator note text recorded.")
            findings.append(_finding(
                "active_evaluator_note_blocker",
                "test_gap",
                f"{run_id} evaluator-notes.jsonl note {index} has severity={severity}, category={category}: {text}",
                "Resolve the active evaluator note, downgrade it only with new evidence, regenerate the suite report, and rerun completion audit.",
                run_id=run_id,
                note_index=index,
                severity=severity,
                category=category,
            ))
    return findings


def _evaluation_report_section_findings(run_id: str, evaluation_report: str) -> list[dict[str, Any]]:
    headings = {
        line.strip()
        for line in evaluation_report.splitlines()
        if line.startswith("#")
    }
    missing_sections = [
        section
        for section in REQUIRED_EVALUATION_REPORT_SECTIONS
        if section not in headings
    ]
    if not missing_sections:
        return []
    return [_finding(
        "evaluation_report_sections_missing",
        "report_gap",
        f"{run_id} evaluation-report.md missing sections: {', '.join(missing_sections)}.",
        "Regenerate evaluation-report.md with all required engineering assessment sections from the blueprint.",
        run_id=run_id,
        missing_sections=missing_sections,
    )]


def _evaluation_report_result_findings(run_id: str, evaluation_report: str) -> list[dict[str, Any]]:
    overall_result = _markdown_section_first_value(evaluation_report, "## Overall Result")
    if overall_result == "PASS":
        return []
    return [_finding(
        "evaluation_report_result_not_pass",
        "report_gap",
        f"{run_id} evaluation-report.md Overall Result={overall_result or 'missing'}",
        "Regenerate evaluation-report.md after resolving evaluator findings before completion audit.",
        run_id=run_id,
        overall_result=overall_result or "missing",
    )]


def _battle_report_anchors(battle_report: str) -> set[str]:
    anchors: set[str] = set()
    for line in battle_report.splitlines():
        stripped = line.strip()
        if not stripped.startswith("#"):
            continue
        marker_start = stripped.find(REPORT_ANCHOR_PREFIX)
        if marker_start == -1:
            continue
        anchor_start = marker_start + len(REPORT_ANCHOR_PREFIX)
        anchor_end = stripped.find(REPORT_ANCHOR_SUFFIX, anchor_start)
        if anchor_end == -1:
            continue
        anchors.add(stripped[anchor_start:anchor_end])
    return anchors


def _battle_report_anchor_section(battle_report: str, anchor: str) -> str:
    marker = f"{REPORT_ANCHOR_PREFIX}{anchor}{REPORT_ANCHOR_SUFFIX}"
    lines = battle_report.splitlines()
    for index, line in enumerate(lines):
        stripped = line.strip()
        if marker not in stripped or not stripped.startswith("#"):
            continue
        level = len(stripped) - len(stripped.lstrip("#"))
        section = [line]
        for next_line in lines[index + 1:]:
            next_stripped = next_line.strip()
            if next_stripped.startswith("#"):
                next_level = len(next_stripped) - len(next_stripped.lstrip("#"))
                if next_level <= level:
                    break
            section.append(next_line)
        return "\n".join(section)
    return ""


def _battle_report_anchor_findings(run_id: str, battle_report: str) -> list[dict[str, Any]]:
    anchors = _battle_report_anchors(battle_report)
    missing_anchors = [
        anchor
        for anchor in REQUIRED_BATTLE_REPORT_ANCHORS
        if anchor not in anchors
    ]
    if not missing_anchors:
        return []
    return [_finding(
        "battle_report_anchors_missing",
        "report_gap",
        f"{run_id} battle-report.md missing report anchors: {', '.join(missing_anchors)}.",
        "Regenerate battle-report.md with the required actual-play report sections and stable ASCII report-anchor comments.",
        run_id=run_id,
        missing_anchors=missing_anchors,
    )]


def _field_anchors(section: str) -> set[str]:
    anchors: set[str] = set()
    for line in section.splitlines():
        marker_start = line.find("<!-- field-anchor: ")
        if marker_start == -1:
            continue
        anchor_start = marker_start + len("<!-- field-anchor: ")
        anchor_end = line.find(" -->", anchor_start)
        if anchor_end == -1:
            continue
        anchors.add(line[anchor_start:anchor_end])
    return anchors


def _field_anchor_values(section: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in section.splitlines():
        marker_start = line.find("<!-- field-anchor: ")
        if marker_start == -1:
            continue
        anchor_start = marker_start + len("<!-- field-anchor: ")
        anchor_end = line.find(" -->", anchor_start)
        if anchor_end == -1:
            continue
        field = line[anchor_start:anchor_end]
        visible = line[:marker_start].strip()
        if visible.startswith("- "):
            visible = visible[2:].strip()
        _, separator, value = visible.partition(":")
        if not separator:
            continue
        values[field] = value.strip()
    return values


def _battle_report_field_anchor_findings(run_id: str, battle_report: str) -> list[dict[str, Any]]:
    missing_by_section: dict[str, list[str]] = {}
    for section_name, required_fields in REQUIRED_BATTLE_REPORT_FIELD_ANCHORS.items():
        section = _battle_report_anchor_section(battle_report, section_name)
        present_fields = _field_anchors(section)
        missing_fields = [
            field
            for field in required_fields
            if field not in present_fields
        ]
        if missing_fields:
            missing_by_section[section_name] = missing_fields
    if not missing_by_section:
        return []
    return [_finding(
        "battle_report_field_anchors_missing",
        "report_gap",
        f"{run_id} battle-report.md missing required setup/module field anchors.",
        "Regenerate battle-report.md so Run Setup and Module expose stable ASCII field-anchor comments for campaign, audit, simulation, and scenario parameters.",
        run_id=run_id,
        missing_field_anchors=missing_by_section,
    )]


def _battle_report_field_value_findings(
    run_id: str,
    campaign_dir: Path,
    metadata: dict[str, Any],
    battle_report: str,
) -> list[dict[str, Any]]:
    campaign = _read_json(campaign_dir / "campaign.json", {})
    scenario = _read_json(campaign_dir / "scenario" / "scenario.json", {})
    expected_values = {
        ("Run Setup", "Run ID"): str(metadata.get("run_id") or run_id),
        ("Run Setup", "Campaign ID"): str(metadata.get("campaign_id") or run_id),
        ("Run Setup", "Audit Profile"): str(metadata.get("audit_profile") or "baseline"),
        ("Run Setup", "Simulation Method"): str(metadata.get("simulation_method") or "not recorded"),
        (
            "Module",
            "Scenario ID",
        ): str(scenario.get("scenario_id") or metadata.get("scenario_id") or "unknown"),
    }
    play_language = str(metadata.get("play_language") or "en-US")
    language_profile = _selected_language_profile(play_language, metadata, campaign)
    localized_terms = _metadata_localized_terms(metadata)
    localized_value_fields = {
        ("Run Setup", "Audit Profile"),
        ("Run Setup", "Simulation Method"),
    }
    mismatches: dict[str, dict[str, str]] = {}
    section_values: dict[str, dict[str, str]] = {}
    for section_name, field_name in expected_values:
        if section_name not in section_values:
            section_values[section_name] = _field_anchor_values(
                _battle_report_anchor_section(battle_report, section_name)
            )
        actual = section_values[section_name].get(field_name)
        expected = expected_values[(section_name, field_name)]
        allowed_values = {expected}
        if (section_name, field_name) in localized_value_fields:
            allowed_values.add(_localized_report_value(expected, language_profile, localized_terms))
        if actual is not None and actual not in allowed_values:
            mismatches[f"{section_name}.{field_name}"] = {
                "expected": expected,
                "actual": actual,
            }
    if not mismatches:
        return []
    return [_finding(
        "battle_report_field_values_mismatch",
        "report_gap",
        f"{run_id} battle-report.md setup/module field values do not match structured source values.",
        "Regenerate battle-report.md from playtest.json and scenario/scenario.json so stable machine-valued setup fields match source data.",
        run_id=run_id,
        mismatched_field_values=mismatches,
    )]


def _battle_report_source_dialogue_findings(run_id: str, run_dir: Path, battle_report: str) -> list[dict[str, Any]]:
    replay_section = _battle_report_anchor_section(battle_report, "Actual Play Replay")
    transcript = _read_jsonl(run_dir / "transcript.jsonl")
    metadata = _read_json(run_dir / "playtest.json", {})
    localized_terms = _metadata_localized_terms(metadata)
    required_dialogue = []
    for row in transcript:
        if (
            row.get("role") == "system"
            or not isinstance(row.get("text"), str)
            or not row["text"].strip()
        ):
            continue
        candidates = _source_field_candidates(
            row,
            "text",
            metadata,
            localized_terms,
            _display_transcript_text,
        )
        if candidates:
            required_dialogue.append(candidates)
    missing_dialogue = [
        candidates[0]
        for candidates in required_dialogue
        if not _any_candidate_rendered(candidates, replay_section, localized_terms)
    ]
    if not missing_dialogue:
        return []
    return [_finding(
        "battle_report_source_dialogue_missing",
        "report_gap",
        f"{run_id} battle-report.md omits {len(missing_dialogue)} of {len(required_dialogue)} source dialogue turns from transcript.jsonl.",
        "Regenerate battle-report.md so Actual Play Replay renders the visible non-system transcript source text; Session Transcript is only a compact source receipt.",
        run_id=run_id,
        missing_dialogue_count=len(missing_dialogue),
        required_dialogue_count=len(required_dialogue),
        missing_dialogue_samples=missing_dialogue[:5],
    )]


def _battle_report_source_dialogue_speaker_findings(
    run_id: str,
    run_dir: Path,
    metadata: dict[str, Any],
    battle_report: str,
) -> list[dict[str, Any]]:
    replay_lines = _battle_report_anchor_section(
        battle_report,
        "Actual Play Replay",
    ).splitlines()
    transcript = _read_jsonl(run_dir / "transcript.jsonl")
    language_profile = metadata.get("language_profile", {})
    if not isinstance(language_profile, dict):
        language_profile = {}
    localized_terms = _metadata_localized_terms(metadata)
    profile_labels = _metadata_player_profile_labels(metadata)
    missing: list[str] = []
    for row in transcript:
        if row.get("role") == "system":
            continue
        text_source = row.get("text_display") if isinstance(row.get("text_display"), str) else row.get("text")
        if not isinstance(text_source, str) or not text_source.strip():
            continue
        text = _display_transcript_text(text_source).strip()
        speaker = str(
            row.get("speaker_display")
            or _display_transcript_speaker(row, profile_labels, language_profile, localized_terms)
        ).strip()
        if not speaker:
            continue
        if any(speaker in line and text in line for line in replay_lines):
            continue
        missing.append(f"turn {row.get('turn')} {speaker}")
    if not missing:
        return []
    return [_finding(
        "battle_report_source_dialogue_speaker_missing",
        "report_gap",
        f"{run_id} battle-report.md omits speaker attribution for {len(missing)} source dialogue turns.",
        "Regenerate battle-report.md so Actual Play Replay renders each non-system transcript turn with the visible speaker and dialogue text on the same line; Session Transcript is only a compact source receipt.",
        run_id=run_id,
        missing_speaker_dialogue_count=len(missing),
        missing_speaker_dialogue_samples=missing[:5],
    )]


def _battle_report_source_dialogue_order_findings(
    run_id: str,
    run_dir: Path,
    metadata: dict[str, Any],
    battle_report: str,
) -> list[dict[str, Any]]:
    transcript = _read_jsonl(run_dir / "transcript.jsonl")
    language_profile = metadata.get("language_profile", {})
    if not isinstance(language_profile, dict):
        language_profile = {}
    localized_terms = _metadata_localized_terms(metadata)
    profile_labels = _metadata_player_profile_labels(metadata)
    entries: list[dict[str, Any]] = []
    for row in transcript:
        if row.get("role") == "system":
            continue
        text_source = row.get("text_display") if isinstance(row.get("text_display"), str) else row.get("text")
        if not isinstance(text_source, str) or not text_source.strip():
            continue
        text = _display_transcript_text(text_source).strip()
        speaker = str(
            row.get("speaker_display")
            or _display_transcript_speaker(row, profile_labels, language_profile, localized_terms)
        ).strip()
        if not speaker or not text:
            continue
        entries.append({
            "source_index": len(entries),
            "turn": row.get("turn"),
            "speaker": speaker,
            "text": text,
        })
    if len(entries) < 2:
        return []

    out_of_order_sections: list[str] = []
    samples: list[str] = []
    for section_name in ("Actual Play Replay",):
        lines = _battle_report_anchor_section(battle_report, section_name).splitlines()
        matched: list[dict[str, Any]] = []
        for line in lines:
            for entry in entries:
                if entry["speaker"] in line and entry["text"] in line:
                    matched.append(entry)
                    break
        previous: dict[str, Any] | None = None
        for current in matched:
            if previous is not None and current["source_index"] < previous["source_index"]:
                out_of_order_sections.append(section_name)
                sample = f"turn {previous.get('turn')} before turn {current.get('turn')}"
                if sample not in samples:
                    samples.append(sample)
                break
            previous = current
    if not out_of_order_sections:
        return []
    return [_finding(
        "battle_report_source_dialogue_order_mismatch",
        "report_gap",
        f"{run_id} battle-report.md renders source dialogue out of transcript order in {', '.join(out_of_order_sections)}.",
        "Regenerate battle-report.md so Actual Play Replay preserves non-system transcript turn order; Session Transcript is only a compact source receipt.",
        run_id=run_id,
        out_of_order_sections=out_of_order_sections,
        out_of_order_dialogue_samples=samples[:5],
    )]


def _mechanical_roll_line(row: dict[str, Any]) -> str | None:
    payload = row.get("payload")
    if not isinstance(payload, dict):
        return None
    roll = payload.get("roll")
    target = payload.get("effective_target", payload.get("target"))
    outcome = payload.get("outcome")
    if roll in (None, "") or target in (None, "") or not isinstance(outcome, str) or not outcome.strip():
        return None
    return _format_roll_source_line(row)


def _battle_report_mechanical_log_findings(
    run_id: str,
    run_dir: Path,
    campaign_dir: Path,
    metadata: dict[str, Any],
    battle_report: str,
) -> list[dict[str, Any]]:
    rules_and_dice = (
        _battle_report_anchor_section(battle_report, "rules-and-dice")
        or _battle_report_anchor_section(battle_report, "Rules & Dice")
    )
    visible_rules_and_dice = _visible_markdown_text(rules_and_dice)
    mechanical_evidence = _visible_markdown_text("\n".join([
        rules_and_dice,
        _battle_report_anchor_section(battle_report, "Mechanical Log"),
    ]))
    rolls = _read_jsonl(campaign_dir / "logs" / "rolls.jsonl")
    localized_terms = _metadata_localized_terms(metadata)
    language_profile = metadata.get("language_profile", {})
    if not isinstance(language_profile, dict):
        language_profile = {}
    play_language = str(metadata.get("play_language") or "en-US")
    actor_names = _localized_actor_names(_campaign_characters(run_dir, campaign_dir), localized_terms)
    required_roll_lines: list[str] = []
    missing_roll_lines: list[str] = []
    for row in rolls:
        canonical_line = _mechanical_roll_line(row)
        if not canonical_line:
            continue
        required_roll_lines.append(canonical_line)
        payload = row.get("payload") if isinstance(row.get("payload"), dict) else {}
        roll_id = payload.get("roll_id") or row.get("roll_id")
        if roll_id not in (None, "") and f"[roll-id: {roll_id}]" in visible_rules_and_dice:
            continue
        localized_roll = _format_roll_recap(row, actor_names, localized_terms, play_language, language_profile)
        localized_summary = localized_roll.splitlines()[0].removeprefix("- ").strip() if localized_roll.splitlines() else ""
        visible_candidates = [canonical_line, localized_summary]
        if not any(candidate and candidate in mechanical_evidence for candidate in visible_candidates):
            missing_roll_lines.append(canonical_line)
    if not missing_roll_lines:
        return []
    return [_finding(
        "battle_report_mechanical_log_missing",
        "report_gap",
        f"{run_id} battle-report.md omits {len(missing_roll_lines)} of {len(required_roll_lines)} source roll lines from logs/rolls.jsonl.",
        "Regenerate the report so the canonical Rules & Dice section (or legacy Mechanical Log) renders each structured source roll with skill, actor, roll, target, and outcome.",
        run_id=run_id,
        missing_roll_count=len(missing_roll_lines),
        required_roll_count=len(required_roll_lines),
        missing_roll_samples=missing_roll_lines[:5],
    )]


def _battle_report_rule_ref_findings(
    run_id: str,
    campaign_dir: Path,
    battle_report: str,
) -> list[dict[str, Any]]:
    rolls = _read_jsonl(campaign_dir / "logs" / "rolls.jsonl")
    rules_and_dice = (
        _battle_report_anchor_section(battle_report, "rules-and-dice")
        or _battle_report_anchor_section(battle_report, "Rules & Dice")
    )
    visible_rules_and_dice = _visible_markdown_text(rules_and_dice)
    report_sections = "\n".join([
        rules_and_dice,
        _battle_report_anchor_section(battle_report, "Rules & Rolls Recap"),
        _battle_report_anchor_section(battle_report, "Mechanical Log"),
    ])
    required_ref_lines = []
    for row in rolls:
        payload = row.get("payload")
        if not isinstance(payload, dict) or not isinstance(payload.get("rule_refs"), list):
            continue
        refs = [ref for ref in payload["rule_refs"] if isinstance(ref, str) and ref.strip()]
        if refs:
            roll_id = payload.get("roll_id") or row.get("roll_id")
            if (
                roll_id not in (None, "")
                and f"[roll-id: {roll_id}]" in visible_rules_and_dice
            ):
                continue
            required_ref_lines.append(", ".join(refs))
    missing_ref_lines = [
        refs
        for refs in dict.fromkeys(required_ref_lines)
        if refs not in report_sections
    ]
    if not missing_ref_lines:
        return []
    return [_finding(
        "battle_report_rule_refs_missing",
        "report_gap",
        f"{run_id} battle-report.md omits {len(missing_ref_lines)} of {len(set(required_ref_lines))} distinct rule_refs lines from logs/rolls.jsonl.",
        "Regenerate the report so Rules & Dice, Rules & Rolls Recap, or Mechanical Log renders each structured source roll's rule_refs.",
        run_id=run_id,
        missing_rule_ref_count=len(missing_ref_lines),
        required_rule_ref_count=len(set(required_ref_lines)),
        missing_rule_ref_samples=missing_ref_lines[:5],
    )]


def _battle_report_event_summary_findings(
    run_id: str,
    campaign_dir: Path,
    battle_report: str,
) -> list[dict[str, Any]]:
    event_sections = "\n".join([
        _battle_report_anchor_section(battle_report, "Scene-by-Scene Replay"),
        _battle_report_anchor_section(battle_report, "State Changes"),
    ])
    events = _read_jsonl(campaign_dir / "logs" / "events.jsonl")
    metadata = _metadata_for_campaign_dir(campaign_dir)
    localized_terms = _metadata_localized_terms(metadata)
    required_summaries = []
    for row in events:
        payload = row.get("payload")
        if (
            not isinstance(payload, dict)
            or not isinstance(payload.get("summary"), str)
            or not payload["summary"].strip()
        ):
            continue
        candidates = _source_field_candidates(payload, "summary", metadata, localized_terms)
        if candidates:
            required_summaries.append(candidates)
    missing_summaries = [
        candidates[0]
        for candidates in required_summaries
        if not _any_candidate_rendered(candidates, event_sections, localized_terms)
    ]
    if not missing_summaries:
        return []
    return [_finding(
        "battle_report_event_summaries_missing",
        "report_gap",
        f"{run_id} battle-report.md omits {len(missing_summaries)} of {len(required_summaries)} source event summaries from logs/events.jsonl.",
        "Regenerate battle-report.md so Scene-by-Scene Replay or State Changes renders each structured source event summary.",
        run_id=run_id,
        missing_event_count=len(missing_summaries),
        required_event_count=len(required_summaries),
        missing_event_samples=missing_summaries[:5],
    )]


def _battle_report_feedback_text_findings(
    run_id: str,
    run_dir: Path,
    battle_report: str,
) -> list[dict[str, Any]]:
    feedback_section = _visible_markdown_text(_battle_report_anchor_section(battle_report, "Player Feedback On KP"))
    feedback = _read_jsonl(run_dir / "player-feedback.jsonl")
    metadata = _read_json(run_dir / "playtest.json", {})
    localized_terms = _metadata_localized_terms(metadata)
    required_feedback = []
    for row in feedback:
        if not isinstance(row.get("text"), str) or not row["text"].strip():
            continue
        candidates = _source_field_candidates(row, "text", metadata, localized_terms)
        if candidates:
            required_feedback.append(candidates)
    missing_feedback = [
        candidates[0]
        for candidates in required_feedback
        if not _any_candidate_rendered(candidates, feedback_section, localized_terms)
    ]
    if not missing_feedback:
        return []
    return [_finding(
        "battle_report_feedback_text_missing",
        "report_gap",
        f"{run_id} battle-report.md omits {len(missing_feedback)} of {len(required_feedback)} source player feedback comments from player-feedback.jsonl.",
        "Regenerate battle-report.md so Player Feedback On KP renders each structured source feedback comment.",
        run_id=run_id,
        missing_feedback_count=len(missing_feedback),
        required_feedback_count=len(required_feedback),
        missing_feedback_samples=missing_feedback[:5],
    )]


def _feedback_score_rendered(feedback_section: str, text: str, score: int | float) -> bool:
    if isinstance(score, float) and score.is_integer():
        score_text = str(int(score))
    else:
        score_text = str(score)
    score_candidates = {f"{score_text}/5", f"{score_text} / 5"}
    return any(
        text in line and any(candidate in line for candidate in score_candidates)
        for line in feedback_section.splitlines()
    )


def _battle_report_feedback_score_findings(
    run_id: str,
    run_dir: Path,
    battle_report: str,
) -> list[dict[str, Any]]:
    feedback_section = _visible_markdown_text(_battle_report_anchor_section(battle_report, "Player Feedback On KP"))
    feedback = _read_jsonl(run_dir / "player-feedback.jsonl")
    metadata = _read_json(run_dir / "playtest.json", {})
    localized_terms = _metadata_localized_terms(metadata)
    required_scores = []
    for row in feedback:
        if (
            not isinstance(row.get("text"), str)
            or not row["text"].strip()
            or not isinstance(row.get("score"), (int, float))
            or isinstance(row.get("score"), bool)
        ):
            continue
        candidates = _source_field_candidates(row, "text", metadata, localized_terms)
        if candidates:
            required_scores.append((candidates, row["score"]))
    missing_scores = [
        candidates[0]
        for candidates, score in required_scores
        if not any(_feedback_score_rendered(feedback_section, text, score) for text in candidates)
    ]
    if not missing_scores:
        return []
    return [_finding(
        "battle_report_feedback_score_missing",
        "report_gap",
        f"{run_id} battle-report.md omits {len(missing_scores)} of {len(required_scores)} source player feedback ratings from player-feedback.jsonl.",
        "Regenerate battle-report.md so Player Feedback On KP renders each structured source feedback score beside its comment.",
        run_id=run_id,
        missing_feedback_score_count=len(missing_scores),
        required_feedback_score_count=len(required_scores),
        missing_feedback_score_samples=missing_scores[:5],
    )]


def _battle_report_feedback_binding_findings(
    run_id: str,
    run_dir: Path,
    metadata: dict[str, Any],
    battle_report: str,
) -> list[dict[str, Any]]:
    feedback_section = _visible_markdown_text(_battle_report_anchor_section(battle_report, "Player Feedback On KP"))
    feedback = _read_jsonl(run_dir / "player-feedback.jsonl")
    language_profile = metadata.get("language_profile", {})
    if not isinstance(language_profile, dict):
        language_profile = {}
    play_language = str(metadata.get("play_language") or "en-US")
    localized_terms = _metadata_localized_terms(metadata)
    profile_labels = _metadata_player_profile_labels(metadata)
    missing_bindings: list[str] = []
    for row in feedback:
        if not isinstance(row.get("text"), str) or not row["text"].strip():
            continue
        score = row.get("score")
        if not isinstance(score, (int, float)) or isinstance(score, bool):
            continue
        expected_line = _format_feedback(
            row,
            localized_terms,
            play_language,
            profile_labels,
            language_profile,
        )
        if expected_line not in feedback_section:
            category = str(row.get("category", "general"))
            profile = str(row.get("player_profile") or "player")
            missing_bindings.append(f"{category}:{profile}")
    missing_bindings = list(dict.fromkeys(missing_bindings))
    if not missing_bindings:
        return []
    return [_finding(
        "battle_report_feedback_binding_missing",
        "report_gap",
        f"{run_id} battle-report.md omits {len(missing_bindings)} structured feedback bindings from player-feedback.jsonl.",
        "Regenerate battle-report.md so each Player Feedback On KP line binds the source feedback category, score, profile voice, and comment together.",
        run_id=run_id,
        missing_feedback_binding_count=len(missing_bindings),
        missing_feedback_binding_samples=missing_bindings[:5],
    )]


def _battle_report_memory_summary_findings(
    run_id: str,
    campaign_dir: Path,
    battle_report: str,
) -> list[dict[str, Any]]:
    story_recap = _battle_report_anchor_section(battle_report, "Story Recap")
    memories = _read_jsonl(campaign_dir / "memory" / "session-summaries.jsonl")
    metadata = _metadata_for_campaign_dir(campaign_dir)
    localized_terms = _metadata_localized_terms(metadata)
    required_summaries = []
    for row in memories:
        if not isinstance(row.get("summary"), str) or not row["summary"].strip():
            continue
        candidates = _source_field_candidates(row, "summary", metadata, localized_terms)
        if candidates:
            required_summaries.append(candidates)
    missing_summaries = [
        candidates[0]
        for candidates in required_summaries
        if not _any_candidate_rendered(candidates, story_recap, localized_terms)
    ]
    if not missing_summaries:
        return []
    return [_finding(
        "battle_report_memory_summaries_missing",
        "report_gap",
        f"{run_id} battle-report.md omits {len(missing_summaries)} of {len(required_summaries)} source memory summaries from memory/session-summaries.jsonl.",
        "Regenerate battle-report.md so Story Recap renders each structured source memory summary.",
        run_id=run_id,
        missing_memory_count=len(missing_summaries),
        required_memory_count=len(required_summaries),
        missing_memory_samples=missing_summaries[:5],
    )]


def _creation_label(metadata: dict[str, Any], canonical: str) -> str:
    return _profile_label(metadata, "creation_labels", canonical)


def _format_creation_formula_points(formula: Any, points: Any) -> str:
    if formula in (None, "", [], {}):
        return str(points) if points not in (None, "", [], {}) else ""
    if points in (None, "", [], {}):
        return str(formula)
    return f"{formula} = {points}"


def _format_required_money_value(value: Any, play_language: str) -> str:
    if isinstance(value, dict):
        amount = value.get("amount")
        currency = value.get("currency", "USD")
    else:
        amount = value
        currency = "USD"
    if amount in (None, "", [], {}):
        if play_language == "zh-Hans":
            return "无"
        if play_language == "ja-JP":
            return "なし"
        return "None"
    amount_text = str(int(amount)) if isinstance(amount, float) and amount.is_integer() else str(amount)
    if currency == "USD":
        if play_language == "zh-Hans":
            return f"{amount_text} 美元"
        if play_language == "ja-JP":
            return f"{amount_text} ドル"
        return f"{amount_text} USD"
    return f"{amount_text} {currency}"


def _format_required_living_standard(value: Any, play_language: str) -> str:
    labels = {
        "zh-Hans": {
            "Penniless": "身无分文",
            "Poor": "贫穷",
            "Average": "普通",
            "Wealthy": "富裕",
            "Rich": "富豪",
            "Super Rich": "超级富豪",
        },
        "ja-JP": {
            "Penniless": "無一文",
            "Poor": "貧困",
            "Average": "平均",
            "Wealthy": "裕福",
            "Rich": "富豪",
            "Super Rich": "超富豪",
        },
    }
    text = str(value)
    return labels.get(play_language, {}).get(text, text)


def _format_characteristic_half_fifth_required_text(
    values: dict[str, Any],
    label: str,
) -> str | None:
    if not isinstance(values, dict):
        return None
    ordered = ["STR", "CON", "SIZ", "DEX", "APP", "INT", "POW", "EDU", "LUCK"]
    parts: list[str] = []
    for key in ordered:
        value = values.get(key)
        if not isinstance(value, dict):
            continue
        half = value.get("half")
        fifth = value.get("fifth")
        if half not in (None, "", [], {}) and fifth not in (None, "", [], {}):
            parts.append(f"{key} {half}/{fifth}")
    for key in sorted(values):
        if key in ordered:
            continue
        value = values[key]
        if not isinstance(value, dict):
            continue
        half = value.get("half")
        fifth = value.get("fifth")
        if half not in (None, "", [], {}) and fifth not in (None, "", [], {}):
            parts.append(f"{key} {half}/{fifth}")
    if not parts:
        return None
    return f"{label}: {', '.join(parts)}"


def _format_skill_half_fifth_required_text(
    values: dict[str, Any],
    label: str,
    localized_terms: dict[str, str],
) -> str | None:
    if not isinstance(values, dict):
        return None
    parts: list[str] = []
    for skill in sorted(values):
        value = values[skill]
        if not isinstance(value, dict):
            continue
        half = value.get("half")
        fifth = value.get("fifth")
        if half not in (None, "", [], {}) and fifth not in (None, "", [], {}):
            parts.append(f"{_localize_text(str(skill), localized_terms)} {half}/{fifth}")
    if not parts:
        return None
    return f"{label}: {', '.join(parts)}"


def _creation_age_required_texts(creation: dict[str, Any], metadata: dict[str, Any]) -> list[str]:
    age = creation.get("age", {})
    if not isinstance(age, dict) or not age:
        return []

    play_language = str(metadata.get("play_language") or "en-US")
    age_label = _creation_label(metadata, "Age")
    adjustment_label = _creation_label(metadata, "Age Adjustments")
    required_texts: list[str] = []

    years = age.get("years", age.get("value"))
    age_range = age.get("range")
    if years not in (None, "", [], {}):
        if age_range not in (None, "", [], {}):
            if play_language == "zh-Hans":
                required_texts.append(f"{age_label}: {years}（{age_range} 岁）")
            elif play_language == "ja-JP":
                required_texts.append(f"{age_label}: {years}（{age_range}歳）")
            else:
                required_texts.append(f"{age_label}: {years} ({age_range})")
        else:
            required_texts.append(f"{age_label}: {years}")

    required_checks = age.get("edu_improvement_checks_required", 0)
    checks = age.get("edu_improvement_checks", [])
    reductions = age.get("characteristic_reductions", [])
    if not isinstance(checks, list):
        checks = []
    if not isinstance(reductions, list):
        reductions = []
    if not (required_checks or checks or reductions):
        return required_texts

    if play_language == "zh-Hans":
        parts: list[str] = []
        if required_checks:
            parts.append(f"EDU 成长检定 {required_checks} 次")
        for check in checks:
            if not isinstance(check, dict):
                continue
            roll = check.get("roll", "?")
            target = check.get("target", check.get("edu_before", "?"))
            if check.get("improved") is True:
                improvement_roll = check.get("improvement_roll")
                edu_after = check.get("edu_after")
                if improvement_roll not in (None, "", [], {}) and edu_after not in (None, "", [], {}):
                    parts.append(f"本次 {roll} / {target}，提升 {improvement_roll} 点至 EDU {edu_after}")
                else:
                    parts.append(f"本次 {roll} / {target}，提升")
            else:
                parts.append(f"本次 {roll} / {target}，未提升")
        if reductions:
            reduction_text = ", ".join(
                f"{item.get('characteristic', '?')} {item.get('delta', '?')}"
                for item in reductions
                if isinstance(item, dict)
            )
            parts.append(f"属性降低：{reduction_text}" if reduction_text else "属性降低已记录")
        else:
            parts.append("属性无降低")
        required_texts.append(f"{adjustment_label}: {'；'.join(parts)}。")
    elif play_language == "ja-JP":
        parts = []
        if required_checks:
            parts.append(f"EDU成長判定 {required_checks} 回")
        for check in checks:
            if not isinstance(check, dict):
                continue
            roll = check.get("roll", "?")
            target = check.get("target", check.get("edu_before", "?"))
            if check.get("improved") is True:
                improvement_roll = check.get("improvement_roll")
                edu_after = check.get("edu_after")
                if improvement_roll not in (None, "", [], {}) and edu_after not in (None, "", [], {}):
                    parts.append(f"今回は {roll} / {target}、{improvement_roll} 点上昇して EDU {edu_after}")
                else:
                    parts.append(f"今回は {roll} / {target}、上昇")
            else:
                parts.append(f"今回は {roll} / {target}、上昇なし")
        if reductions:
            reduction_text = ", ".join(
                f"{item.get('characteristic', '?')} {item.get('delta', '?')}"
                for item in reductions
                if isinstance(item, dict)
            )
            parts.append(f"能力値低下：{reduction_text}" if reduction_text else "能力値低下を記録")
        else:
            parts.append("能力値低下なし")
        required_texts.append(f"{adjustment_label}: {'；'.join(parts)}。")
    else:
        parts = []
        if required_checks:
            plural = "time" if required_checks == 1 else "times"
            parts.append(f"EDU improvement check {required_checks} {plural}")
        for check in checks:
            if not isinstance(check, dict):
                continue
            roll = check.get("roll", "?")
            target = check.get("target", check.get("edu_before", "?"))
            if check.get("improved") is True:
                improvement_roll = check.get("improvement_roll")
                edu_after = check.get("edu_after")
                if improvement_roll not in (None, "", [], {}) and edu_after not in (None, "", [], {}):
                    parts.append(f"roll {roll} / {target}, improved by {improvement_roll} to EDU {edu_after}")
                else:
                    parts.append(f"roll {roll} / {target}, improved")
            else:
                parts.append(f"roll {roll} / {target}, no improvement")
        if reductions:
            reduction_text = ", ".join(
                f"{item.get('characteristic', '?')} {item.get('delta', '?')}"
                for item in reductions
                if isinstance(item, dict)
            )
            parts.append(f"characteristic reductions: {reduction_text}" if reduction_text else "characteristic reductions recorded")
        else:
            parts.append("no characteristic reductions")
        required_texts.append(f"{adjustment_label}: {'; '.join(parts)}.")

    return required_texts


def _creation_required_texts(creation: dict[str, Any], metadata: dict[str, Any]) -> list[str]:
    localized_terms = _metadata_localized_terms(metadata)
    required_texts: list[str] = []

    characteristics = creation.get("characteristics", {})
    if isinstance(characteristics, dict):
        preferred_characteristics = ["STR", "CON", "SIZ", "DEX", "APP", "INT", "POW", "EDU", "LUCK"]
        ordered_characteristics = [key for key in preferred_characteristics if key in characteristics]
        ordered_characteristics.extend(sorted(key for key in characteristics if key not in ordered_characteristics))
        for key in ordered_characteristics:
            value = characteristics.get(key)
            if isinstance(value, dict) and value.get("final") not in (None, "", [], {}):
                required_texts.append(f"{key} {value['final']}")
        thresholds_text = _format_characteristic_half_fifth_required_text(
            characteristics,
            _creation_label(metadata, "Characteristic Half/Fifth Values"),
        )
        if thresholds_text:
            required_texts.append(thresholds_text)

    required_texts.extend(_creation_age_required_texts(creation, metadata))

    occupation = creation.get("occupation", {})
    if isinstance(occupation, dict):
        if occupation.get("name") not in (None, "", [], {}):
            required_texts.append(str(occupation["name"]))
        occupation_points = _format_creation_formula_points(
            occupation.get("skill_point_formula"),
            occupation.get("skill_points_available"),
        )
        if occupation_points:
            required_texts.append(occupation_points)

    personal_interest = creation.get("personal_interest", {})
    if isinstance(personal_interest, dict):
        personal_points = _format_creation_formula_points(
            personal_interest.get("skill_point_formula"),
            personal_interest.get("skill_points_available"),
        )
        if personal_points:
            required_texts.append(personal_points)

    finances = creation.get("finances", {})
    if isinstance(finances, dict) and finances.get("credit_rating") not in (None, "", [], {}):
        credit_label = _creation_label(metadata, "Credit Rating")
        required_texts.append(f"{credit_label}: {finances['credit_rating']}")
        if isinstance(occupation, dict) and occupation.get("credit_rating_range") not in (None, "", [], {}):
            range_label = _creation_label(metadata, "Rulebook Occupation Range")
            required_texts.append(f"{range_label} {occupation['credit_rating_range']}")
        play_language = str(metadata.get("play_language") or "en-US")
        if finances.get("living_standard") not in (None, "", [], {}):
            living_label = _creation_label(metadata, "Living Standard")
            required_texts.append(
                f"{living_label}: {_format_required_living_standard(finances['living_standard'], play_language)}"
            )
        for key, label in [
            ("cash", "Cash"),
            ("assets", "Assets"),
            ("spending_level", "Spending Level"),
        ]:
            if finances.get(key) in (None, "", [], {}):
                continue
            required_texts.append(
                f"{_creation_label(metadata, label)}: {_format_required_money_value(finances[key], play_language)}"
            )

    allocation = creation.get("skill_allocation", {})
    if isinstance(allocation, dict) and allocation:
        occupation_label = _creation_label(metadata, "Occupation")
        base_label = _creation_label(metadata, "Base")
        personal_label = _creation_label(metadata, "Personal Interest")
        unallocated_label = _creation_label(metadata, "Unallocated")
        occupation_available = creation.get("occupation", {}).get("skill_points_available", "?")
        personal_available = creation.get("personal_interest", {}).get("skill_points_available", "?")
        if allocation.get("occupation_points_spent") not in (None, "", [], {}):
            required_texts.append(f"{occupation_label} {allocation['occupation_points_spent']}/{occupation_available}")
        if allocation.get("personal_interest_points_spent") not in (None, "", [], {}):
            required_texts.append(f"{personal_label} {allocation['personal_interest_points_spent']}/{personal_available}")
        if (
            allocation.get("unallocated_occupation_points") not in (None, "", [], {})
            and allocation.get("unallocated_personal_interest_points") not in (None, "", [], {})
        ):
            required_texts.append(
                f"{unallocated_label} {allocation['unallocated_occupation_points']}/"
                f"{allocation['unallocated_personal_interest_points']}"
            )

        skills = allocation.get("skills", {})
        if isinstance(skills, dict):
            skill_thresholds_text = _format_skill_half_fifth_required_text(
                skills,
                _creation_label(metadata, "Skill Half/Fifth Values"),
                localized_terms,
            )
            if skill_thresholds_text:
                required_texts.append(skill_thresholds_text)
            for skill, entry in skills.items():
                if not isinstance(entry, dict):
                    continue
                if entry.get("final") in (None, "", [], {}):
                    continue
                display_skill = _localize_text(str(skill), localized_terms)
                required_texts.append(
                    f"{display_skill}: {base_label} {entry.get('base', '?')} + "
                    f"{occupation_label} {entry.get('occupation_points', 0)} + "
                    f"{personal_label} {entry.get('personal_interest_points', 0)} = "
                    f"{entry['final']}"
                )

    equipment = creation.get("equipment")
    if isinstance(equipment, list):
        required_texts.extend(
            str(item)
            for item in equipment
            if item not in (None, "", [], {})
        )
    return required_texts


def _battle_report_investigator_creation_findings(
    run_id: str,
    run_dir: Path,
    campaign_dir: Path,
    metadata: dict[str, Any],
    battle_report: str,
) -> list[dict[str, Any]]:
    creation_section = _battle_report_anchor_section(battle_report, "Investigator Creation")
    party = _read_json(campaign_dir / "party.json", {})
    investigator_ids = _investigator_ids_from_party(party) if isinstance(party, dict) else []
    localized_terms = _metadata_localized_terms(metadata)

    required_texts: list[str] = []
    for investigator_id in investigator_ids:
        investigator_dir = run_dir / "sandbox" / ".coc" / "investigators" / investigator_id
        creation = _read_json(investigator_dir / "creation.json", {})
        if isinstance(creation, dict):
            required_texts.extend(_creation_required_texts(creation, metadata))

    missing_texts = [
        text
        for text in required_texts
        if not _text_rendered_in_report(text, creation_section, localized_terms)
    ]
    if not missing_texts:
        return []
    return [_finding(
        "battle_report_investigator_creation_missing",
        "report_gap",
        f"{run_id} battle-report.md omits {len(missing_texts)} of {len(required_texts)} investigator creation records from creation.json.",
        "Regenerate battle-report.md so Investigator Creation renders characteristics, occupation points, personal-interest points, credit rating, skill allocation, and equipment from creation.json.",
        run_id=run_id,
        missing_creation_count=len(missing_texts),
        required_creation_count=len(required_texts),
        missing_creation_samples=missing_texts[:30],
    )]


def _character_dossier_label(metadata: dict[str, Any], canonical: str) -> str:
    return _profile_label(metadata, "character_dossier_labels", canonical)


def _character_dossier_required_texts(character: dict[str, Any], metadata: dict[str, Any]) -> list[str]:
    localized_terms = _metadata_localized_terms(metadata)
    required_texts: list[str] = []

    for key in ("name", "investigator_id", "id", "occupation", "era"):
        value = character.get(key)
        if value not in (None, "", [], {}):
            required_texts.append(str(value))

    characteristics = character.get("characteristics", {})
    if isinstance(characteristics, dict):
        for key, value in characteristics.items():
            if value in (None, "", [], {}):
                continue
            label = _character_dossier_label(metadata, str(key))
            required_texts.append(f"{label}: {value}")
    thresholds_text = _format_characteristic_half_fifth_required_text(
        character.get("characteristic_thresholds", {}),
        _character_dossier_label(metadata, "Characteristic Half/Fifth Values"),
    )
    if thresholds_text:
        required_texts.append(thresholds_text)

    derived = character.get("derived", {})
    if isinstance(derived, dict):
        for key, value in derived.items():
            if value in (None, "", [], {}):
                continue
            label = _character_dossier_label(metadata, str(key))
            required_texts.append(f"{label}: {value}")

    skills = character.get("skills", {})
    if isinstance(skills, dict):
        for skill, value in skills.items():
            if value in (None, "", [], {}):
                continue
            display_skill = _localize_text(str(skill), localized_terms)
            required_texts.append(f"{display_skill}: {value}")
    skill_thresholds_text = _format_skill_half_fifth_required_text(
        character.get("skill_thresholds", {}),
        _character_dossier_label(metadata, "Skill Half/Fifth Values"),
        localized_terms,
    )
    if skill_thresholds_text:
        required_texts.append(skill_thresholds_text)

    backstory = character.get("backstory", {})
    if isinstance(backstory, dict):
        for value in backstory.values():
            if isinstance(value, str) and value.strip():
                required_texts.append(value.strip())
            elif isinstance(value, list):
                required_texts.extend(
                    str(item).strip()
                    for item in value
                    if str(item).strip()
                )

    return list(dict.fromkeys(text for text in required_texts if text))


def _battle_report_character_dossier_findings(
    run_id: str,
    run_dir: Path,
    campaign_dir: Path,
    metadata: dict[str, Any],
    battle_report: str,
) -> list[dict[str, Any]]:
    character_dossier = _battle_report_anchor_section(battle_report, "Character Dossier")
    party = _read_json(campaign_dir / "party.json", {})
    investigator_ids = _investigator_ids_from_party(party) if isinstance(party, dict) else []
    localized_terms = _metadata_localized_terms(metadata)

    required_texts: list[str] = []
    for investigator_id in investigator_ids:
        investigator_dir = run_dir / "sandbox" / ".coc" / "investigators" / investigator_id
        character = _read_json(investigator_dir / "character.json", {})
        if isinstance(character, dict):
            required_texts.extend(_character_dossier_required_texts(character, metadata))

    missing_texts = [
        text
        for text in required_texts
        if not _text_rendered_in_report(text, character_dossier, localized_terms)
    ]
    if not missing_texts:
        return []
    return [_finding(
        "battle_report_character_dossier_missing",
        "report_gap",
        f"{run_id} battle-report.md omits {len(missing_texts)} of {len(required_texts)} character dossier records from character.json.",
        "Regenerate battle-report.md so Character Dossier renders reusable investigator name/id, occupation, era, characteristics, derived values, skills, and backstory from character.json.",
        run_id=run_id,
        missing_character_count=len(missing_texts),
        required_character_count=len(required_texts),
        missing_character_samples=missing_texts[:30],
    )]


def _handout_required_texts(campaign_dir: Path, metadata: dict[str, Any]) -> list[str]:
    handouts = _read_json(campaign_dir / "scenario" / "handouts.json", [])
    if not isinstance(handouts, list):
        return []
    localized_terms = _metadata_localized_terms(metadata)
    required_texts: list[str] = []
    for handout in handouts:
        if not isinstance(handout, dict):
            continue
        for field in ("label", "title", "summary", "content", "route"):
            value = _localized_source_field(handout, field, metadata, localized_terms)
            if value:
                required_texts.append(value)
    return list(dict.fromkeys(text for text in required_texts if text))


def _battle_report_handout_findings(
    run_id: str,
    campaign_dir: Path,
    metadata: dict[str, Any],
    battle_report: str,
) -> list[dict[str, Any]]:
    handout_section = _battle_report_anchor_section(battle_report, "Handouts")
    localized_terms = _metadata_localized_terms(metadata)
    required_texts = _handout_required_texts(campaign_dir, metadata)
    if not required_texts:
        return []
    missing_texts = [
        text
        for text in required_texts
        if not _text_rendered_in_report(text, handout_section, localized_terms)
    ]
    if not missing_texts:
        return []
    return [_finding(
        "battle_report_handouts_missing",
        "report_gap",
        f"{run_id} battle-report.md omits {len(missing_texts)} of {len(required_texts)} player-visible handout records from scenario/handouts.json.",
        "Regenerate battle-report.md so the Handouts section renders scenario/handouts.json labels, titles, summaries, content, and routes using the active play language.",
        run_id=run_id,
        missing_handout_count=len(missing_texts),
        required_handout_count=len(required_texts),
        missing_handout_samples=missing_texts[:20],
    )]


def _chase_tracker_label(metadata: dict[str, Any], canonical: str) -> str:
    return _profile_label(metadata, "chase_tracker_labels", canonical)


def _chase_tracker_value(value: Any, metadata: dict[str, Any], localized_terms: dict[str, str]) -> str:
    value_text = str(value)
    localized = _chase_tracker_label(metadata, value_text)
    if localized != value_text:
        return localized
    return _localize_text(value_text, localized_terms)


def _chase_difficulty_value(value: Any, metadata: dict[str, Any], localized_terms: dict[str, str]) -> str:
    value_text = str(value)
    localized = _profile_label(metadata, "difficulty_labels", value_text)
    if localized != value_text:
        return localized
    return _localize_text(value_text, localized_terms)


def _display_chase_location_ref(location_id: Any, localized_terms: dict[str, str]) -> str:
    raw_id = str(location_id or "unknown")
    display = _localize_text(raw_id.replace("-", " "), localized_terms)
    if display == raw_id.replace("-", " "):
        return raw_id
    return f"{display} ({raw_id})"


def _chase_round_summary(chase_round: dict[str, Any], metadata: dict[str, Any], localized_terms: dict[str, str]) -> str:
    play_language = str(metadata.get("play_language") or "")
    localized = chase_round.get("localized_text")
    if isinstance(localized, dict):
        language_value = localized.get(play_language)
        if isinstance(language_value, dict) and isinstance(language_value.get("summary"), str):
            return _localize_text(language_value["summary"], localized_terms)
    if isinstance(chase_round.get("summary"), str):
        return _localize_text(chase_round["summary"], localized_terms)
    return ""


def _chase_tracker_required_texts(chase_state: dict[str, Any], metadata: dict[str, Any]) -> list[str]:
    localized_terms = _metadata_localized_terms(metadata)
    required_texts: list[str] = []
    for key in ("chase_id", "status", "outcome"):
        if chase_state.get(key) not in (None, "", [], {}):
            value = chase_state[key]
            required_texts.append(str(value))
            rendered_value = _chase_tracker_value(value, metadata, localized_terms)
            if rendered_value != str(value):
                required_texts.append(rendered_value)
    if chase_state.get("round") not in (None, "", [], {}):
        required_texts.append(f"{_chase_tracker_label(metadata, 'Round')}: {chase_state['round']}")

    participants = chase_state.get("participants", [])
    if isinstance(participants, list):
        for participant in participants:
            if not isinstance(participant, dict):
                continue
            for key in ("id", "name", "role", "position"):
                if participant.get(key) in (None, "", [], {}):
                    continue
                value = participant[key]
                if key == "role":
                    required_texts.append(_chase_tracker_value(value, metadata, localized_terms))
                elif key == "position":
                    required_texts.append(_display_chase_location_ref(value, localized_terms))
                else:
                    required_texts.append(str(value))
            if participant.get("base_mov") not in (None, "", [], {}) and participant.get("adjusted_mov") not in (None, "", [], {}):
                required_texts.append(f"MOV {participant['base_mov']} -> {participant['adjusted_mov']}")
            if participant.get("dex") not in (None, "", [], {}):
                required_texts.append(f"DEX {participant['dex']}")
            if participant.get("movement_actions") not in (None, "", [], {}):
                required_texts.append(f"{_chase_tracker_label(metadata, 'movement_actions')} {participant['movement_actions']}")

    dex_order = chase_state.get("dex_order", [])
    if isinstance(dex_order, list):
        required_texts.extend(str(participant_id) for participant_id in dex_order if participant_id not in (None, "", [], {}))

    location_chain = chase_state.get("location_chain", [])
    if isinstance(location_chain, list):
        for location in location_chain:
            if not isinstance(location, dict):
                continue
            if location.get("id") not in (None, "", [], {}):
                required_texts.append(str(location["id"]))
                required_texts.append(_display_chase_location_ref(location["id"], localized_terms))
            for key in ("label", "difficulty", "skill"):
                if location.get(key) in (None, "", [], {}):
                    continue
                value = location[key]
                if key == "label":
                    required_texts.append(_chase_tracker_value(value, metadata, localized_terms))
                elif key == "difficulty":
                    required_texts.append(_chase_difficulty_value(value, metadata, localized_terms))
                else:
                    required_texts.append(_localize_text(str(value), localized_terms))

    rounds = chase_state.get("rounds", [])
    if isinstance(rounds, list):
        for chase_round in rounds:
            if not isinstance(chase_round, dict):
                continue
            summary = _chase_round_summary(chase_round, metadata, localized_terms)
            if summary:
                required_texts.append(summary)
    return list(dict.fromkeys(text for text in required_texts if text))


def _chase_tracker_text_rendered(
    text: str,
    battle_report: str,
    metadata: dict[str, Any],
    localized_terms: dict[str, str],
) -> bool:
    candidates = {
        text,
        _localize_text(text, localized_terms),
        _chase_tracker_value(text, metadata, localized_terms),
        _chase_difficulty_value(text, metadata, localized_terms),
    }
    return any(candidate and candidate in battle_report for candidate in candidates)


def _chase_value_aliases(value: Any, metadata: dict[str, Any], localized_terms: dict[str, str]) -> set[str]:
    value_text = str(value or "")
    if not value_text:
        return set()
    aliases = {
        value_text,
        value_text.replace("-", " "),
        _localize_text(value_text, localized_terms),
        _localize_text(value_text.replace("-", " "), localized_terms),
        _chase_tracker_value(value_text, metadata, localized_terms),
        _chase_difficulty_value(value_text, metadata, localized_terms),
    }
    display_ref = _display_chase_location_ref(value_text, localized_terms)
    aliases.add(display_ref)
    if " (" in display_ref:
        aliases.add(display_ref.split(" (", 1)[0])
    return {alias for alias in aliases if alias}


def _chase_participant_aliases(participant: dict[str, Any], metadata: dict[str, Any]) -> set[str]:
    localized_terms = _metadata_localized_terms(metadata)
    aliases: set[str] = set()
    for key in ("id", "name"):
        value = participant.get(key)
        if value in (None, "", [], {}):
            continue
        aliases.update(_chase_value_aliases(value, metadata, localized_terms))
    return aliases


def _chase_outcome_texts(run_dir: Path, battle_report: str, chase_state: dict[str, Any], metadata: dict[str, Any]) -> list[str]:
    localized_terms = _metadata_localized_terms(metadata)
    outcome_aliases = _chase_value_aliases(chase_state.get("outcome"), metadata, localized_terms)
    texts: list[str] = []
    for row in _read_jsonl(run_dir / "transcript.jsonl"):
        for key in ("text_display", "text", "outcome_note"):
            value = row.get(key)
            if isinstance(value, str) and any(alias in value for alias in outcome_aliases):
                texts.append(value)
    for heading in ("Actual Play Replay", "Session Transcript", "Scene-by-Scene Replay", "Chase Summary", "Story Recap"):
        section = _battle_report_anchor_section(battle_report, heading)
        for line in section.splitlines():
            if any(alias in line for alias in outcome_aliases):
                texts.append(line)
    return list(dict.fromkeys(texts))


def _localized_text_clauses(text: str) -> list[str]:
    return [
        clause.strip()
        for clause in re.split(r"[。！？!?；;\n]+", text)
        if clause.strip()
    ]


def _has_actor_location_conflict_clause(
    text: str,
    actor_aliases: set[str],
    conflicting_aliases: set[str],
    expected_aliases: set[str],
) -> bool:
    for clause in _localized_text_clauses(text):
        if (
            any(actor_alias in clause for actor_alias in actor_aliases)
            and any(conflicting_alias in clause for conflicting_alias in conflicting_aliases)
            and not any(expected_alias in clause for expected_alias in expected_aliases)
        ):
            return True
    return False


def _chase_transcript_position_findings(
    run_id: str,
    run_dir: Path,
    campaign_dir: Path,
    metadata: dict[str, Any],
    battle_report: str,
) -> list[dict[str, Any]]:
    chase_state = _read_json(campaign_dir / "save" / "chase.json", {})
    if not isinstance(chase_state, dict) or not chase_state:
        return []
    participants = chase_state.get("participants", [])
    location_chain = chase_state.get("location_chain", [])
    if not isinstance(participants, list) or not isinstance(location_chain, list):
        return []

    localized_terms = _metadata_localized_terms(metadata)
    location_aliases: dict[str, set[str]] = {}
    for location in location_chain:
        if not isinstance(location, dict) or location.get("id") in (None, "", [], {}):
            continue
        location_id = str(location["id"])
        location_aliases[location_id] = _chase_value_aliases(location_id, metadata, localized_terms)

    outcome_texts = _chase_outcome_texts(run_dir, battle_report, chase_state, metadata)
    findings: list[dict[str, Any]] = []
    for participant in participants:
        if not isinstance(participant, dict) or participant.get("position") in (None, "", [], {}):
            continue
        participant_id = str(participant.get("id") or participant.get("name") or "unknown")
        expected_position = str(participant["position"])
        actor_aliases = _chase_participant_aliases(participant, metadata)
        if not actor_aliases:
            continue
        expected_aliases = location_aliases.get(expected_position, set())
        for conflicting_position, aliases in location_aliases.items():
            if conflicting_position == expected_position:
                continue
            conflicting_samples = [
                text
                for text in outcome_texts
                if _has_actor_location_conflict_clause(text, actor_aliases, aliases, expected_aliases)
            ]
            if conflicting_samples:
                findings.append(_finding(
                    "chase_transcript_position_conflict",
                    "state_gap",
                    (
                        f"{run_id} chase ending text places {participant_id} at {conflicting_position}, "
                        f"but save/chase.json records final position {expected_position}."
                    ),
                    "Regenerate the chase transcript/report or save/chase.json so the final chase narration and saved participant positions agree.",
                    run_id=run_id,
                    participant_id=participant_id,
                    expected_position=expected_position,
                    conflicting_position=conflicting_position,
                    conflicting_text_samples=conflicting_samples[:5],
                ))
                break
    return findings


def _battle_report_chase_tracker_findings(
    run_id: str,
    campaign_dir: Path,
    metadata: dict[str, Any],
    battle_report: str,
) -> list[dict[str, Any]]:
    chase_tracker = _battle_report_anchor_section(battle_report, "Chase Tracker")
    chase_state = _read_json(campaign_dir / "save" / "chase.json", {})
    if not isinstance(chase_state, dict) or not chase_state:
        return []
    localized_terms = _metadata_localized_terms(metadata)
    required_texts = _chase_tracker_required_texts(chase_state, metadata)
    missing_texts = [
        text
        for text in required_texts
        if not _chase_tracker_text_rendered(text, chase_tracker, metadata, localized_terms)
    ]
    if not missing_texts:
        return []
    return [_finding(
        "battle_report_chase_tracker_missing",
        "report_gap",
        f"{run_id} battle-report.md omits {len(missing_texts)} of {len(required_texts)} chase tracker records from save/chase.json.",
        "Regenerate battle-report.md so Chase Tracker renders save/chase.json participants, DEX order, location chain, rounds, and outcome.",
        run_id=run_id,
        missing_chase_count=len(missing_texts),
        required_chase_count=len(required_texts),
        missing_chase_samples=missing_texts[:30],
    )]


def _investigator_chronicle_required_texts(investigator_dir: Path) -> list[str]:
    required_texts: list[str] = []
    for filename, fields in INVESTIGATOR_CHRONICLE_TEXT_FIELDS.items():
        for row in _read_jsonl(investigator_dir / filename):
            for field in fields:
                value = row.get(field)
                if isinstance(value, str) and value.strip():
                    required_texts.append(value.strip())
    return required_texts


def _battle_report_investigator_chronicle_findings(
    run_id: str,
    run_dir: Path,
    campaign_dir: Path,
    metadata: dict[str, Any],
    battle_report: str,
) -> list[dict[str, Any]]:
    chronicle_section = _battle_report_anchor_section(battle_report, "Investigator Chronicle")
    party = _read_json(campaign_dir / "party.json", {})
    investigator_ids = _investigator_ids_from_party(party) if isinstance(party, dict) else []
    localized_terms = _metadata_localized_terms(metadata)

    required_texts: list[str] = []
    for investigator_id in investigator_ids:
        investigator_dir = run_dir / "sandbox" / ".coc" / "investigators" / investigator_id
        required_texts.extend(_investigator_chronicle_required_texts(investigator_dir))

    missing_texts = [
        text
        for text in required_texts
        if not _text_rendered_in_report(text, chronicle_section, localized_terms)
    ]
    if not missing_texts:
        return []
    return [_finding(
        "battle_report_investigator_chronicle_missing",
        "report_gap",
        f"{run_id} battle-report.md omits {len(missing_texts)} of {len(required_texts)} reusable investigator chronicle records from history/development/inventory source files.",
        "Regenerate battle-report.md so Investigator Chronicle renders reusable investigator history, development, and inventory carryover records.",
        run_id=run_id,
        missing_chronicle_count=len(missing_texts),
        required_chronicle_count=len(required_texts),
        missing_chronicle_samples=missing_texts[:5],
    )]


def _markdown_headings(markdown: str) -> set[str]:
    return {
        line.strip()
        for line in markdown.splitlines()
        if line.startswith("#")
    }


def _suite_report_section_findings(suite_report: str) -> list[dict[str, Any]]:
    headings = _markdown_headings(suite_report)
    missing_sections = [
        section
        for section in REQUIRED_SUITE_REPORT_SECTIONS
        if section not in headings
    ]
    if not missing_sections:
        return []
    return [_finding(
        "suite_report_sections_missing",
        "report_gap",
        f"suite-report.md missing sections: {', '.join(missing_sections)}.",
        "Regenerate suite-report.md with the required cross-run coverage and quality evidence sections.",
        missing_sections=missing_sections,
    )]


def _rulebook_audit_section_findings(run_id: str, rulebook_audit: str) -> list[dict[str, Any]]:
    headings = _markdown_headings(rulebook_audit)
    missing_sections = [
        section
        for section in REQUIRED_RULEBOOK_AUDIT_SECTIONS
        if section not in headings
    ]
    if not missing_sections:
        return []
    return [_finding(
        "rulebook_audit_sections_missing",
        "report_gap",
        f"{run_id} rulebook-audit.md missing sections: {', '.join(missing_sections)}.",
        "Regenerate rulebook-audit.md with the required rulebook evidence and loop-control sections.",
        run_id=run_id,
        missing_sections=missing_sections,
    )]


def _markdown_section_first_value(markdown: str, heading: str) -> str:
    lines = markdown.splitlines()
    for index, line in enumerate(lines):
        if line.strip() != heading:
            continue
        for value in lines[index + 1:]:
            stripped = value.strip()
            if not stripped:
                continue
            if stripped.startswith("#"):
                return ""
            return stripped
    return ""


def _rulebook_audit_result_findings(run_id: str, rulebook_audit: str) -> list[dict[str, Any]]:
    overall_result = _markdown_section_first_value(rulebook_audit, "## Overall Result")
    if overall_result == "PASS":
        return []
    return [_finding(
        "rulebook_audit_result_not_pass",
        "test_gap",
        f"{run_id} rulebook-audit.md Overall Result={overall_result or 'missing'}",
        "Regenerate the run and fix rulebook-audit findings before completion audit.",
        run_id=run_id,
        overall_result=overall_result or "missing",
    )]


def _protocol_ids_with_stages(
    transcript: list[dict[str, Any]],
    protocol_key: str,
    id_key: str,
    required_stages: list[str],
) -> list[str]:
    stages_by_id: dict[str, set[str]] = {}
    for row in transcript:
        protocol = row.get(protocol_key)
        if not isinstance(protocol, dict):
            continue
        protocol_id = protocol.get(id_key)
        stage = protocol.get("stage")
        if not isinstance(protocol_id, str) or not protocol_id.strip():
            continue
        if not isinstance(stage, str) or not stage.strip():
            continue
        stages_by_id.setdefault(protocol_id, set()).add(stage)
    return sorted(
        protocol_id
        for protocol_id, stages in stages_by_id.items()
        if all(stage in stages for stage in required_stages)
    )


def _rulebook_audit_positive_evidence_findings(
    run_id: str,
    run_dir: Path,
    campaign_dir: Path,
    metadata: dict[str, Any],
    rulebook_audit: str,
) -> list[dict[str, Any]]:
    audit_profile = str(metadata.get("audit_profile") or "")
    if audit_profile not in {"chase_drill", "multi_profile_pressure"}:
        return []

    missing_evidence: list[str] = []
    if audit_profile == "chase_drill":
        chase_state = _read_json(campaign_dir / "save" / "chase.json", {})
        if isinstance(chase_state, dict):
            for field in ("participants", "location_chain", "rounds", "outcome"):
                if chase_state.get(field) not in (None, "", [], {}) and field not in rulebook_audit:
                    missing_evidence.append(f"{audit_profile} rulebook-audit chase state field {field}")
        for profile_id in metadata.get("player_profiles_tested", []):
            if isinstance(profile_id, str) and profile_id.strip() and profile_id not in rulebook_audit:
                missing_evidence.append(f"{audit_profile} rulebook-audit player profile {profile_id}")

    transcript = _read_jsonl(run_dir / "transcript.jsonl")
    for profile_id in MULTI_PROFILE_SOURCE_REQUIREMENTS.get(audit_profile, []):
        if any(row.get("player_profile") == profile_id for row in transcript) and profile_id not in rulebook_audit:
            missing_evidence.append(f"{audit_profile} rulebook-audit profile {profile_id}")

    pushed_roll_stages = _pushed_roll_protocol_stages()
    for roll_id in _protocol_ids_with_stages(
        transcript,
        "pushed_roll_protocol",
        "roll_id",
        pushed_roll_stages,
    ):
        if roll_id not in rulebook_audit or any(stage not in rulebook_audit for stage in pushed_roll_stages):
            missing_evidence.append(f"{audit_profile} rulebook-audit pushed protocol {roll_id}")

    for spoiler_id in _protocol_ids_with_stages(
        transcript,
        "spoiler_protocol",
        "spoiler_id",
        SPOILER_REVEAL_PROTOCOL_STAGES,
    ):
        if spoiler_id not in rulebook_audit or any(stage not in rulebook_audit for stage in SPOILER_REVEAL_PROTOCOL_STAGES):
            missing_evidence.append(f"{audit_profile} rulebook-audit spoiler protocol {spoiler_id}")

    if not missing_evidence:
        return []
    return [_finding(
        "rulebook_audit_positive_evidence_missing",
        "report_gap",
        f"{run_id} rulebook-audit.md omits structured positive evidence: {', '.join(missing_evidence)}.",
        "Regenerate rulebook-audit.md so Positive Rulebook Evidence cites profile-specific source ids, chase state fields, and protocol ids/stages from structured source files.",
        run_id=run_id,
        missing_evidence=missing_evidence,
    )]


def _semantic_request_contract_findings(run_id: str, semantic_request: dict[str, Any]) -> list[dict[str, Any]]:
    if not semantic_request:
        return []

    missing_fields: list[str] = []
    invalid_fields: list[str] = []
    if semantic_request.get("schema_version") != 1:
        invalid_fields.append("schema_version")
    if semantic_request.get("kind") != "coc_semantic_coverage_request":
        invalid_fields.append("kind")
    if semantic_request.get("run_id") != run_id:
        invalid_fields.append("run_id")

    coverage_keys = _entry_keys(semantic_request.get("coverage_keys"))
    if not coverage_keys:
        missing_fields.append("coverage_keys")
    missing_coverage_keys = [
        key
        for key in REQUIRED_COVERAGE_DIMENSIONS
        if key not in coverage_keys
    ]

    quality_keys = _entry_keys(semantic_request.get("quality_dimensions"))
    if not quality_keys:
        missing_fields.append("quality_dimensions")
    missing_quality_keys = [
        key
        for key in REQUIRED_QUALITY_DIMENSIONS
        if key not in quality_keys
    ]

    expected_output = semantic_request.get("expected_output_schema")
    expected_required = expected_output.get("required") if isinstance(expected_output, dict) else None
    if not isinstance(expected_required, list):
        missing_fields.append("expected_output_schema.required")
        missing_expected_fields = REQUIRED_SEMANTIC_REQUEST_FIELDS
    else:
        missing_expected_fields = [
            field
            for field in REQUIRED_SEMANTIC_REQUEST_FIELDS
            if field not in expected_required
        ]
    inputs = semantic_request.get("inputs")
    if not isinstance(inputs, dict):
        missing_fields.append("inputs")
    elif not isinstance(inputs.get("scenario"), dict) or not inputs["scenario"]:
        missing_fields.append("inputs.scenario")

    if not any((missing_fields, invalid_fields, missing_coverage_keys, missing_quality_keys, missing_expected_fields)):
        return []
    return [_finding(
        "semantic_request_contract_invalid",
        "test_gap",
        f"{run_id} semantic-eval-request.json does not expose the full LLM evaluator contract.",
        "Regenerate semantic-eval-request.json with coverage_keys, quality_dimensions, inputs.scenario, and expected_output_schema.required before accepting semantic results.",
        run_id=run_id,
        missing_fields=missing_fields,
        invalid_fields=invalid_fields,
        missing_coverage_keys=missing_coverage_keys,
        missing_quality_keys=missing_quality_keys,
        missing_expected_fields=missing_expected_fields,
    )]


def _semantic_payloads(root: Path, active_runs: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    payloads: dict[str, dict[str, Any]] = {}
    for run in active_runs:
        run_id = str(run.get("run_id"))
        semantic = _read_json(_opened_run_path(root, run) / "artifacts" / "semantic-eval-result.json", {})
        if isinstance(semantic, dict) and semantic:
            payloads[run_id] = semantic
    return payloads


def _semantic_quality_passes(value: Any) -> bool:
    if not isinstance(value, dict) or value.get("passed") is not True:
        return False
    try:
        score = int(value.get("score", 0) or 0)
    except (TypeError, ValueError):
        return False
    return score >= 4


def _has_non_empty_reason(value: dict[str, Any]) -> bool:
    reason = value.get("reason")
    return isinstance(reason, str) and bool(reason.strip())


def _semantic_support_findings(
    root: Path,
    index: dict[str, Any],
    active_runs: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    payloads = _semantic_payloads(root, active_runs)
    active_ids = [str(run.get("run_id")) for run in active_runs]
    active_id_set = set(active_ids)

    for dimension in REQUIRED_COVERAGE_DIMENSIONS:
        coverage_entry = index.get("coverage", {}).get(dimension, {})
        if coverage_entry.get("status") != "covered":
            continue
        index_run_ids = [
            str(run_id)
            for run_id in coverage_entry.get("runs", [])
            if str(run_id) in active_id_set
        ]
        supporting_runs = [
            run_id
            for run_id in index_run_ids
            for semantic in [payloads.get(run_id, {})]
            if isinstance(semantic.get("coverage"), dict)
            and isinstance(semantic["coverage"].get(dimension), dict)
            and semantic["coverage"][dimension].get("covered") is True
        ]
        if supporting_runs:
            continue
        findings.append(_finding(
            "semantic_artifacts_do_not_support_coverage",
            "test_gap",
            f"{dimension} is covered in index but no index-listed active semantic artifact marks it covered.",
            "Regenerate semantic-eval-result.json and suite index from the same active runs.",
            key=dimension,
            active_runs=active_ids,
            index_runs=coverage_entry.get("runs", []),
        ))

    for dimension in REQUIRED_QUALITY_DIMENSIONS:
        quality_entry = index.get("quality", {}).get(dimension, {})
        if quality_entry.get("status") != "passed":
            continue
        index_run_ids = [
            str(run_id)
            for run_id in quality_entry.get("runs", [])
            if str(run_id) in active_id_set
        ]
        supporting_runs = [
            run_id
            for run_id in index_run_ids
            for semantic in [payloads.get(run_id, {})]
            if isinstance(semantic.get("quality"), dict)
            and _semantic_quality_passes(semantic["quality"].get(dimension))
        ]
        if supporting_runs:
            continue
        findings.append(_finding(
            "semantic_artifacts_do_not_support_quality",
            "test_gap",
            f"{dimension} is passed in index but no index-listed active semantic artifact has passed=true with score >= 4.",
            "Regenerate semantic-eval-result.json and suite index from the same active runs.",
            key=dimension,
            active_runs=active_ids,
            index_runs=quality_entry.get("runs", []),
        ))

    return findings


def _missing_relative_files(base: Path, relative_paths: list[str], display_prefix: str = "") -> list[str]:
    missing: list[str] = []
    for relative_path in relative_paths:
        if not (base / relative_path).exists():
            missing.append(f"{display_prefix}{relative_path}")
    return missing


def _empty_relative_files(base: Path, relative_paths: list[str], display_prefix: str = "") -> list[str]:
    empty: list[str] = []
    for relative_path in relative_paths:
        path = base / relative_path
        if path.exists() and path.is_file() and not path.read_text(encoding="utf-8").strip():
            empty.append(f"{display_prefix}{relative_path}")
    return empty


def _malformed_relative_files(base: Path, relative_paths: list[str], display_prefix: str = "") -> list[str]:
    malformed: list[str] = []
    for relative_path in relative_paths:
        path = base / relative_path
        if not path.exists() or not path.is_file():
            continue
        text = path.read_text(encoding="utf-8")
        if not text.strip():
            continue
        try:
            if relative_path.endswith(".jsonl"):
                for line in text.splitlines():
                    if not line.strip():
                        continue
                    row = json.loads(line)
                    if not isinstance(row, dict):
                        raise ValueError("JSONL rows must be objects")
            else:
                payload = json.loads(text)
                if relative_path in JSON_ARRAY_SOURCE_FILES:
                    if not isinstance(payload, list):
                        raise ValueError("JSON source file must be an array")
                elif not isinstance(payload, dict):
                    raise ValueError("JSON source files must be objects")
        except (json.JSONDecodeError, ValueError):
            malformed.append(f"{display_prefix}{relative_path}")
    return malformed


def _source_structure_findings(run_id: str, run_dir: Path) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    transcript = _read_jsonl(run_dir / "transcript.jsonl")
    player_view = _read_jsonl(run_dir / "player-view.jsonl")
    keeper_view = _read_jsonl(run_dir / "keeper-view.jsonl")
    feedback = _read_jsonl(run_dir / "player-feedback.jsonl")
    missing_evidence: list[str] = []
    incomplete_files: list[str] = []

    has_keeper_turn = any(
        row.get("role") == "keeper_under_test"
        and isinstance(row.get("text"), str)
        and bool(row["text"].strip())
        for row in transcript
    )
    has_player_turn = any(
        row.get("role") == "player_simulator"
        and isinstance(row.get("text"), str)
        and bool(row["text"].strip())
        for row in transcript
    )
    if not has_keeper_turn:
        missing_evidence.append("keeper_under_test turn")
    if not has_player_turn:
        missing_evidence.append("player_simulator turn")
    if not has_keeper_turn or not has_player_turn:
        incomplete_files.append("transcript.jsonl")

    has_player_public_state = any(
        row.get("view") == "player"
        and row.get("type") == "public_character_state"
        for row in player_view
    )
    has_player_view_turn = any(
        row.get("view") == "player"
        and row.get("type") == "transcript_turn"
        and isinstance(row.get("text"), str)
        and bool(row["text"].strip())
        for row in player_view
    )
    if not has_player_public_state:
        missing_evidence.append("player public character state")
    if not has_player_view_turn:
        missing_evidence.append("player view transcript turn")
    if not has_player_public_state or not has_player_view_turn:
        incomplete_files.append("player-view.jsonl")

    has_keeper_context = any(
        row.get("view") == "keeper"
        and row.get("type") == "keeper_context"
        for row in keeper_view
    )
    has_keeper_view_turn = any(
        row.get("view") == "keeper"
        and row.get("type") == "transcript_turn"
        and isinstance(row.get("text"), str)
        and bool(row["text"].strip())
        for row in keeper_view
    )
    has_keeper_secret_ids = any(
        row.get("view") == "keeper"
        and isinstance(row.get("keeper_secret_ids"), list)
        for row in keeper_view
    )
    if not has_keeper_context:
        missing_evidence.append("keeper context")
    if not has_keeper_view_turn:
        missing_evidence.append("keeper view transcript turn")
    if not has_keeper_secret_ids:
        missing_evidence.append("keeper secret id list")
    if not has_keeper_context or not has_keeper_view_turn or not has_keeper_secret_ids:
        incomplete_files.append("keeper-view.jsonl")

    has_feedback_score = any(
        isinstance(row.get("score"), (int, float))
        and not isinstance(row.get("score"), bool)
        for row in feedback
    )
    has_feedback_text = any(
        isinstance(row.get("text"), str)
        and bool(row["text"].strip())
        for row in feedback
    )
    if not has_feedback_score:
        missing_evidence.append("feedback score")
    if not has_feedback_text:
        missing_evidence.append("feedback text")
    if not has_feedback_score or not has_feedback_text:
        incomplete_files.append("player-feedback.jsonl")

    if missing_evidence:
        findings.append(_finding(
            "active_run_source_files_incomplete",
            "test_gap",
            f"{run_id} source files {', '.join(incomplete_files)} lack required evidence: {', '.join(missing_evidence)}.",
            "Regenerate the active run so transcript, view, and feedback source files contain structured Keeper, player, view-separation, rating, and feedback text evidence before completion audit.",
            run_id=run_id,
            incomplete_files=incomplete_files,
            missing_evidence=missing_evidence,
        ))
    return findings


def _campaign_characters(run_dir: Path, campaign_dir: Path) -> list[dict[str, Any]]:
    party = _read_json(campaign_dir / "party.json", {})
    investigator_ids = _investigator_ids_from_party(party) if isinstance(party, dict) else []
    characters: list[dict[str, Any]] = []
    for investigator_id in investigator_ids:
        character = _read_json(
            run_dir / "sandbox" / ".coc" / "investigators" / investigator_id / "character.json",
            {},
        )
        if isinstance(character, dict) and character:
            characters.append(character)
    return characters


def _expected_player_view_roll_texts(
    run_dir: Path,
    campaign_dir: Path,
    metadata: dict[str, Any],
) -> list[str]:
    transcript = _read_jsonl(run_dir / "transcript.jsonl")
    rolls = _read_jsonl(campaign_dir / "logs" / "rolls.jsonl")
    if not transcript or not rolls:
        return []

    localized_terms = _metadata_localized_terms(metadata)
    language_profile = metadata.get("language_profile", {})
    if not isinstance(language_profile, dict):
        language_profile = {}
    play_language = str(metadata.get("play_language") or "en-US")
    actor_names = _localized_actor_names(_campaign_characters(run_dir, campaign_dir), localized_terms)
    roll_recaps = [
        _format_roll_recap(event, actor_names, localized_terms, play_language, language_profile)
        for event in rolls
    ]

    expected_texts: list[str] = []
    roll_cursor = 0
    for event in transcript:
        if event.get("mode") != "roll":
            continue
        roll_count = _event_roll_count(event, len(roll_recaps) - roll_cursor)
        recaps = roll_recaps[roll_cursor: roll_cursor + roll_count]
        rendered_text = _format_roll_transcript_text(event, recaps, localized_terms, play_language)
        roll_cursor += roll_count
        if rendered_text:
            expected_texts.append(rendered_text)
    return expected_texts


def _player_view_roll_text_findings(
    run_id: str,
    run_dir: Path,
    campaign_dir: Path,
    metadata: dict[str, Any],
) -> list[dict[str, Any]]:
    expected_texts = _expected_player_view_roll_texts(run_dir, campaign_dir, metadata)
    if not expected_texts:
        return []

    player_view = _read_jsonl(run_dir / "player-view.jsonl")
    player_view_roll_texts = [
        row["text"].strip()
        for row in player_view
        if row.get("view") == "player"
        and row.get("type") == "transcript_turn"
        and row.get("role") == "system"
        and row.get("mode") == "roll"
        and isinstance(row.get("text"), str)
        and row["text"].strip()
    ]
    missing_texts = [
        text
        for text in expected_texts
        if text not in player_view_roll_texts
    ]
    if not missing_texts:
        return []
    return [_finding(
        "player_view_roll_text_not_localized",
        "report_gap",
        f"{run_id} player-view.jsonl omits {len(missing_texts)} of {len(expected_texts)} localized system roll transcript texts derived from logs/rolls.jsonl.",
        "Regenerate the active run so player-view.jsonl renders system roll transcript text from structured roll logs through play_language while preserving canonical payload fields.",
        run_id=run_id,
        missing_player_view_roll_count=len(missing_texts),
        required_player_view_roll_count=len(expected_texts),
        missing_player_view_roll_samples=missing_texts[:5],
        observed_player_view_roll_samples=player_view_roll_texts[:5],
    )]


def _transcript_display_findings(
    run_id: str,
    run_dir: Path,
    campaign_dir: Path,
    metadata: dict[str, Any],
) -> list[dict[str, Any]]:
    play_language = str(metadata.get("play_language") or "")
    if not play_language or play_language == "en-US":
        return []

    transcript = _read_jsonl(run_dir / "transcript.jsonl")
    if not transcript:
        return []

    localized_terms = _metadata_localized_terms(metadata)
    language_profile = metadata.get("language_profile", {})
    if not isinstance(language_profile, dict):
        language_profile = {}
    profile_labels = _metadata_player_profile_labels(metadata)

    missing_fields: list[str] = []
    for row in transcript:
        if not isinstance(row.get("speaker"), str) or not row["speaker"].strip():
            continue
        expected_speaker = _display_transcript_speaker(row, profile_labels, language_profile, localized_terms)
        if row.get("role") == "player_simulator" and row.get("player_profile") and not profile_labels:
            speaker_labels = language_profile.get("speaker_labels", {}) if isinstance(language_profile, dict) else {}
            expected_speaker = str(speaker_labels.get("player", "Player"))
        if expected_speaker != row.get("speaker") and row.get("speaker_display") != expected_speaker:
            missing_fields.append(f"turn {row.get('turn')} speaker_display")

    missing_roll_texts: list[str] = []
    expected_roll_texts = _expected_player_view_roll_texts(run_dir, campaign_dir, metadata)
    observed_roll_texts = [
        str(row.get("text_display", "")).strip()
        for row in transcript
        if row.get("role") == "system"
        and row.get("mode") == "roll"
        and isinstance(row.get("text_display"), str)
        and row["text_display"].strip()
    ]
    for expected_text in expected_roll_texts:
        if expected_text not in observed_roll_texts:
            missing_roll_texts.append(expected_text)
    if missing_roll_texts:
        missing_fields.extend(
            f"turn {row.get('turn')} text_display"
            for row in transcript
            if row.get("role") == "system" and row.get("mode") == "roll"
        )

    for row in transcript:
        text_display = row.get("text_display")
        if (
            isinstance(text_display, str)
            and text_display.strip()
            and _display_transcript_text(text_display).strip() != text_display.strip()
        ):
            missing_fields.append(f"turn {row.get('turn')} text_display protocol_wrapper")

    leaked_terms = sorted({
        canonical
        for canonical, display in localized_terms.items()
        if canonical
        and display != canonical
        and any(
            canonical in str(row.get(field, ""))
            for row in transcript
            for field in ("speaker_display", "text_display", "intent_display", "ruling_display", "player_profile_display")
        )
    })
    leaked_samples: list[str] = []
    if leaked_terms:
        for row in transcript:
            for field in ("speaker_display", "text_display", "intent_display", "ruling_display", "player_profile_display"):
                value = row.get(field)
                if not isinstance(value, str) or not value.strip():
                    continue
                if any(term in value for term in leaked_terms):
                    leaked_samples.append(f"turn {row.get('turn')} {field}: {value}")
                    if len(leaked_samples) >= 8:
                        break
            if len(leaked_samples) >= 8:
                break

    if not missing_fields and not missing_roll_texts and not leaked_terms:
        return []
    return [_finding(
        "transcript_display_not_localized",
        "system_gap",
        f"{run_id} transcript.jsonl lacks localized display fields for source transcript replay evidence.",
        "Regenerate the active run so transcript.jsonl preserves canonical source fields while adding display fields derived from play_language, localized_terms, player_profile_labels, and structured roll logs.",
        run_id=run_id,
        missing_transcript_display_fields=sorted(set(missing_fields)),
        missing_transcript_roll_samples=missing_roll_texts[:5],
        observed_transcript_roll_samples=observed_roll_texts[:5],
        leaked_transcript_display_terms=leaked_terms,
        leaked_transcript_display_samples=leaked_samples,
    )]


def _nested_string_values(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value] if value.strip() else []
    if isinstance(value, list):
        strings: list[str] = []
        for item in value:
            strings.extend(_nested_string_values(item))
        return strings
    if isinstance(value, dict):
        strings: list[str] = []
        for item in value.values():
            strings.extend(_nested_string_values(item))
        return strings
    return []


def _public_state_visible_strings(row: dict[str, Any]) -> list[str]:
    strings: list[str] = []
    scenario = row.get("scenario", {})
    if isinstance(scenario, dict):
        for field in ("title", "player_safe_summary", "opening_scene", "current_phase"):
            value = scenario.get(field)
            if isinstance(value, str) and value.strip():
                strings.append(value)

    investigators = row.get("investigators", [])
    if not isinstance(investigators, list):
        return strings
    for investigator in investigators:
        if not isinstance(investigator, dict):
            continue
        for field in ("name", "occupation", "era"):
            value = investigator.get(field)
            if isinstance(value, str) and value.strip():
                strings.append(value)
        skill_display = investigator.get("skill_display", [])
        if isinstance(skill_display, list) and skill_display:
            strings.extend(_display_entry_visible_strings(skill_display))
        else:
            skills = investigator.get("skills", {})
            if isinstance(skills, dict):
                strings.extend(str(skill) for skill in skills if str(skill).strip())
        derived = investigator.get("derived", {})
        derived_display = investigator.get("derived_display", [])
        if isinstance(derived_display, list) and derived_display:
            strings.extend(_display_entry_visible_strings(derived_display))
        elif isinstance(derived, dict):
            strings.extend(str(key) for key in derived if str(key).strip())
            strings.extend(_nested_string_values(derived))
        strings.extend(_nested_string_values(investigator.get("backstory", {})))
    return strings


def _display_entry_visible_strings(entries: Any) -> list[str]:
    if not isinstance(entries, list):
        return []
    strings: list[str] = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        for field in ("label", "value"):
            value = entry.get(field)
            if isinstance(value, str) and value.strip():
                strings.append(value)
            elif value not in (None, "", [], {}):
                strings.append(str(value))
    return strings


def _public_state_unstable_key_paths(value: Any, path: str = "") -> list[str]:
    if isinstance(value, dict):
        paths: list[str] = []
        for key, item in value.items():
            key_text = str(key)
            key_path = f"{path}/{key_text}" if path else key_text
            if re.search(r"[\u4e00-\u9fff]", key_text):
                paths.append(key_path)
            paths.extend(_public_state_unstable_key_paths(item, key_path))
        return paths
    if isinstance(value, list):
        paths: list[str] = []
        for index, item in enumerate(value):
            paths.extend(_public_state_unstable_key_paths(item, f"{path}[{index}]"))
        return paths
    return []


ZH_HANS_ALLOWED_PUBLIC_STATE_TOKENS = {
    "STR",
    "CON",
    "SIZ",
    "DEX",
    "APP",
    "INT",
    "POW",
    "EDU",
    "LUCK",
    "HP",
    "MP",
    "SAN",
    "MOV",
    "DB",
}
ZH_HANS_ALLOWED_PLAYER_VIEW_SPEAKER_TOKENS = ZH_HANS_ALLOWED_PUBLIC_STATE_TOKENS | {"KP"}


def _public_state_english_tokens(public_strings: list[str], play_language: str) -> list[str]:
    if play_language != "zh-Hans":
        return []
    return sorted({
        token
        for text in public_strings
        for token in re.findall(r"[A-Za-z_]{3,}", text)
        if token not in ZH_HANS_ALLOWED_PUBLIC_STATE_TOKENS
    })


def _player_view_public_state_findings(
    run_id: str,
    run_dir: Path,
    metadata: dict[str, Any],
) -> list[dict[str, Any]]:
    localized_terms = _metadata_localized_terms(metadata)
    play_language = str(metadata.get("play_language") or "")

    findings: list[dict[str, Any]] = []
    public_strings: list[str] = []
    unstable_keys: list[str] = []
    for row in _read_jsonl(run_dir / "player-view.jsonl"):
        if row.get("view") == "player" and row.get("type") == "public_character_state":
            public_strings.extend(_public_state_visible_strings(row))
            unstable_keys.extend(_public_state_unstable_key_paths(row))

    if unstable_keys:
        findings.append(_finding(
            "player_view_public_state_unstable_keys",
            "system_gap",
            f"{run_id} player-view.jsonl public_character_state uses localized or non-ASCII JSON keys.",
            "Keep public_character_state JSON keys and canonical skill/derived keys stable ASCII; put player-language labels in skill_display/derived_display values.",
            run_id=run_id,
            public_state_unstable_keys=unstable_keys[:20],
        ))

    leaked_terms = sorted({
        canonical
        for canonical, display in localized_terms.items()
        if canonical
        and display != canonical
        and any(canonical in text for text in public_strings)
    })
    english_tokens = _public_state_english_tokens(public_strings, play_language)
    if not leaked_terms and not english_tokens:
        return findings
    issue_parts = []
    if leaked_terms:
        issue_parts.append(f"canonical player-visible terms: {', '.join(leaked_terms[:8])}")
    if english_tokens:
        issue_parts.append(f"non-localized English tokens: {', '.join(english_tokens[:8])}")
    findings.append(_finding(
        "player_view_public_state_not_localized",
        "report_gap",
        f"{run_id} player-view.jsonl public_character_state leaks {'; '.join(issue_parts)}.",
        "Regenerate the active run so player-view.jsonl public_character_state renders scenario, investigator, occupation, skill, and backstory display values through localized_terms while preserving canonical source files.",
        run_id=run_id,
        leaked_public_state_terms=leaked_terms,
        english_public_state_tokens=english_tokens,
        public_state_samples=public_strings[:8],
    ))
    return findings


def _player_view_current_state_findings(
    run_id: str,
    run_dir: Path,
    campaign_dir: Path,
    campaign_prefix: str,
    investigator_ids: list[str],
    metadata: dict[str, Any],
) -> list[dict[str, Any]]:
    public_investigators: dict[str, dict[str, Any]] = {}
    for row in _read_jsonl(run_dir / "player-view.jsonl"):
        if row.get("view") != "player" or row.get("type") != "public_character_state":
            continue
        investigators = row.get("investigators", [])
        if not isinstance(investigators, list):
            continue
        for investigator in investigators:
            if not isinstance(investigator, dict) or not isinstance(investigator.get("investigator_id"), str):
                continue
            public_investigators[investigator["investigator_id"]] = investigator

    if not public_investigators and not investigator_ids:
        return []

    localized_terms = _metadata_localized_terms(metadata)
    missing_evidence: list[str] = []
    incomplete_files: list[str] = []
    for investigator_id in investigator_ids:
        state_ref = f"save/investigator-state/{investigator_id}.json"
        saved_state = _read_json(campaign_dir / state_ref, {})
        if not isinstance(saved_state, dict) or not saved_state:
            continue
        public_investigator = public_investigators.get(investigator_id)
        if not isinstance(public_investigator, dict):
            missing_evidence.append(f"player-view public_character_state missing investigator {investigator_id}")
            incomplete_files.append("player-view.jsonl")
            continue
        current_state = public_investigator.get("current_state")
        if not isinstance(current_state, dict):
            missing_evidence.append(f"player-view current_state missing for {investigator_id}")
            incomplete_files.append("player-view.jsonl")
            continue
        for key in ("current_hp", "current_san", "current_mp", "conditions", "last_status_summary"):
            if key not in saved_state:
                continue
            expected = _localize_current_state_value(key, saved_state[key], localized_terms)
            if current_state.get(key) != expected:
                missing_evidence.append(f"player-view {key} does not match campaign save {key}")
                incomplete_files.extend(["player-view.jsonl", f"{campaign_prefix}{state_ref}"])

    if not missing_evidence:
        return []
    return [_finding(
        "player_view_current_state_stale",
        "system_gap",
        f"{run_id} player-view.jsonl public_character_state current_state is missing or stale.",
        "Regenerate player-view.jsonl from campaign save investigator-state so the player-safe view shows current campaign HP, SAN, MP, conditions, and status summary without mutating reusable character cards.",
        run_id=run_id,
        incomplete_files=list(dict.fromkeys(incomplete_files)),
        missing_evidence=list(dict.fromkeys(missing_evidence)),
    )]


def _player_view_speaker_findings(
    run_id: str,
    run_dir: Path,
    metadata: dict[str, Any],
) -> list[dict[str, Any]]:
    localized_terms = _metadata_localized_terms(metadata)
    play_language = str(metadata.get("play_language") or "")
    speakers = [
        str(row["speaker"])
        for row in _read_jsonl(run_dir / "player-view.jsonl")
        if row.get("view") == "player"
        and row.get("type") == "transcript_turn"
        and isinstance(row.get("speaker"), str)
        and row["speaker"].strip()
    ]
    if not speakers:
        return []

    leaked_speakers = sorted({
        speaker
        for speaker in speakers
        for canonical, display in localized_terms.items()
        if canonical
        and display != canonical
        and canonical in speaker
    })
    english_tokens: list[str] = []
    if play_language == "zh-Hans":
        english_tokens = sorted({
            token
            for speaker in speakers
            for token in re.findall(r"[A-Za-z_]{3,}", speaker)
            if token not in ZH_HANS_ALLOWED_PLAYER_VIEW_SPEAKER_TOKENS
        })

    if not leaked_speakers and not english_tokens:
        return []
    issue_parts = []
    if leaked_speakers:
        issue_parts.append(f"canonical speaker display values: {', '.join(leaked_speakers[:8])}")
    if english_tokens:
        issue_parts.append(f"non-localized English speaker tokens: {', '.join(english_tokens[:8])}")
    return [_finding(
        "player_view_speaker_not_localized",
        "report_gap",
        f"{run_id} player-view.jsonl transcript speaker display leaks {'; '.join(issue_parts)}.",
        "Regenerate the active run so player-view.jsonl transcript_turn speaker values render through play_language, player_profile_labels, speaker_labels, and localized_terms while preserving canonical transcript source files.",
        run_id=run_id,
        leaked_player_view_speakers=leaked_speakers,
        english_player_view_speaker_tokens=english_tokens,
        player_view_speaker_samples=speakers[:12],
    )]


def _player_profile_display_findings(
    run_id: str,
    run_dir: Path,
    metadata: dict[str, Any],
) -> list[dict[str, Any]]:
    labels = _metadata_player_profile_labels(metadata)
    if not labels:
        return []

    unlocalized_profiles: set[str] = set()
    samples: list[dict[str, Any]] = []
    for source, rows in (
        ("player-view.jsonl", _read_jsonl(run_dir / "player-view.jsonl")),
        ("player-feedback.jsonl", _read_jsonl(run_dir / "player-feedback.jsonl")),
    ):
        for row in rows:
            if source == "player-view.jsonl" and (
                row.get("view") != "player" or row.get("type") != "transcript_turn"
            ):
                continue
            player_profile = row.get("player_profile")
            if not isinstance(player_profile, str) or player_profile not in labels:
                continue
            expected_display = labels[player_profile]
            observed_display = row.get("player_profile_display")
            if observed_display == expected_display and observed_display != player_profile:
                continue
            unlocalized_profiles.add(player_profile)
            samples.append({
                "source": source,
                "turn": row.get("turn"),
                "category": row.get("category"),
                "player_profile": player_profile,
                "player_profile_display": observed_display,
                "expected_player_profile_display": expected_display,
            })

    if not unlocalized_profiles:
        return []
    return [_finding(
        "player_profile_display_not_localized",
        "report_gap",
        f"{run_id} player-visible profile rows lack localized player_profile_display values for {', '.join(sorted(unlocalized_profiles)[:8])}.",
        "Regenerate the active run so player-view.jsonl and player-feedback.jsonl preserve canonical player_profile enum values while adding localized player_profile_display from player_profile_labels[play_language].",
        run_id=run_id,
        unlocalized_player_profile_displays=sorted(unlocalized_profiles),
        player_profile_display_samples=samples[:8],
    )]


def _player_view_localized_text_findings(
    run_id: str,
    run_dir: Path,
    metadata: dict[str, Any],
) -> list[dict[str, Any]]:
    localized_terms = _metadata_localized_terms(metadata)
    play_language = str(metadata.get("play_language") or "")
    if not play_language or not localized_terms:
        return []

    localized_strings: list[str] = []
    for row in _read_jsonl(run_dir / "player-view.jsonl"):
        if row.get("view") != "player" or row.get("type") != "transcript_turn":
            continue
        localized_text = row.get("localized_text", {})
        language_text = localized_text.get(play_language, {}) if isinstance(localized_text, dict) else {}
        localized_strings.extend(_nested_string_values(language_text))

    leaked_terms = sorted({
        canonical
        for canonical, display in localized_terms.items()
        if canonical
        and display != canonical
        and any(canonical in text for text in localized_strings)
    })
    if not leaked_terms:
        return []
    return [_finding(
        "player_view_localized_text_not_localized",
        "report_gap",
        f"{run_id} player-view.jsonl localized_text.{play_language} leaks canonical player-visible terms: {', '.join(leaked_terms[:8])}.",
        "Regenerate the active run so player-view.jsonl localized_text values render through localized_terms[play_language] while preserving canonical enum fields separately.",
        run_id=run_id,
        leaked_player_view_localized_text_terms=leaked_terms,
        player_view_localized_text_samples=localized_strings[:8],
    )]


def _transcript_localized_text_findings(
    run_id: str,
    run_dir: Path,
    metadata: dict[str, Any],
) -> list[dict[str, Any]]:
    localized_terms = _metadata_localized_terms(metadata)
    play_language = str(metadata.get("play_language") or "")
    if not play_language or not localized_terms:
        return []

    localized_samples: list[str] = []
    localized_strings: list[str] = []
    for row in _read_jsonl(run_dir / "transcript.jsonl"):
        localized_text = row.get("localized_text", {})
        language_text = localized_text.get(play_language, {}) if isinstance(localized_text, dict) else {}
        for text in _nested_string_values(language_text):
            localized_strings.append(text)
            if len(localized_samples) < 8:
                localized_samples.append(f"turn {row.get('turn')}: {text}")

    leaked_terms = sorted({
        canonical
        for canonical, display in localized_terms.items()
        if canonical
        and display != canonical
        and any(canonical in text for text in localized_strings)
    })
    if not leaked_terms:
        return []
    return [_finding(
        "transcript_localized_text_not_localized",
        "system_gap",
        f"{run_id} transcript.jsonl localized_text.{play_language} leaks canonical player-visible terms: {', '.join(leaked_terms[:8])}.",
        "Regenerate the active run so source transcript localized_text values render through localized_terms[play_language] before they can be used as evaluator or replay evidence.",
        run_id=run_id,
        leaked_transcript_localized_text_terms=leaked_terms,
        transcript_localized_text_samples=localized_samples,
    )]


def _transcript_source_text_findings(
    run_id: str,
    run_dir: Path,
    metadata: dict[str, Any],
) -> list[dict[str, Any]]:
    localized_terms = _metadata_localized_terms(metadata)
    play_language = str(metadata.get("play_language") or "")
    if not play_language or play_language in {"zh-Hans", "en-US"} or not localized_terms:
        return []

    mismatches: list[str] = []
    samples: list[str] = []
    for row in _read_jsonl(run_dir / "transcript.jsonl"):
        localized_text = row.get("localized_text", {})
        language_text = localized_text.get(play_language, {}) if isinstance(localized_text, dict) else {}
        fields = list(TRANSCRIPT_SOURCE_LOCALIZED_VISIBLE_FIELDS)
        if row.get("role") in {"keeper_under_test", "player_simulator"}:
            fields.extend(TRANSCRIPT_SOURCE_LOCALIZED_TEXT_FIELDS)
        for field in fields:
            expected = language_text.get(field)
            actual = row.get(field)
            if not isinstance(expected, str) or not expected.strip():
                continue
            expected = _localize_text(expected, localized_terms).strip()
            if not isinstance(actual, str) or actual.strip() != expected:
                mismatches.append(f"turn {row.get('turn')} {field}")
                if len(samples) < 8:
                    samples.append(f"turn {row.get('turn')} {field}: expected {expected}; actual {actual}")

    if not mismatches:
        return []
    return [_finding(
        "transcript_source_text_not_localized",
        "system_gap",
        f"{run_id} transcript.jsonl top-level player-visible text fields do not match localized_text.{play_language} for {len(mismatches)} source values.",
        "Regenerate the active run so transcript.jsonl top-level KP/player text and visible roll adjunct fields use the selected play_language; keep machine keys, enums, ids, and roll rows canonical separately.",
        run_id=run_id,
        source_transcript_text_mismatches=mismatches,
        source_transcript_text_samples=samples,
    )]


def _protocol_wrappers_in_text(text: str) -> list[str]:
    return [
        wrapper
        for wrapper in PLAYER_VISIBLE_PROTOCOL_WRAPPERS
        if wrapper in text
    ]


def _player_view_protocol_wrapper_findings(
    run_id: str,
    run_dir: Path,
    metadata: dict[str, Any],
) -> list[dict[str, Any]]:
    play_language = str(metadata.get("play_language") or "")
    if not play_language or play_language == "en-US":
        return []

    leaked_wrappers: list[str] = []
    samples: list[str] = []

    def record(row: dict[str, Any], field_path: str, value: Any) -> None:
        if not isinstance(value, str) or not value.strip():
            return
        wrappers = _protocol_wrappers_in_text(value)
        if not wrappers:
            return
        for wrapper in wrappers:
            if wrapper not in leaked_wrappers:
                leaked_wrappers.append(wrapper)
        if len(samples) < 8:
            samples.append(f"turn {row.get('turn')} {field_path}: {value}")

    def visit(row: dict[str, Any], field_path: str, value: Any) -> None:
        if isinstance(value, str):
            record(row, field_path, value)
        elif isinstance(value, dict):
            for key, nested in value.items():
                visit(row, f"{field_path}.{key}", nested)
        elif isinstance(value, list):
            for index, nested in enumerate(value):
                visit(row, f"{field_path}[{index}]", nested)

    for row in _read_jsonl(run_dir / "player-view.jsonl"):
        if row.get("view") != "player" or row.get("type") != "transcript_turn":
            continue
        for field in ("text", "localized_text", "intent_display", "ruling_display"):
            if field in row:
                visit(row, field, row[field])

    if not leaked_wrappers:
        return []
    return [_finding(
        "player_view_protocol_wrapper_leak",
        "system_gap",
        f"{run_id} player-view.jsonl leaks transcript protocol wrappers in player-visible fields: {', '.join(leaked_wrappers)}.",
        "Regenerate the active run so player-view.jsonl renders player-visible transcript text through display text normalization while preserving protocol wrappers only in source transcript fields.",
        run_id=run_id,
        leaked_player_view_protocol_wrappers=leaked_wrappers,
        player_view_protocol_wrapper_samples=samples,
    )]


def _player_view_spoiler_protocol_findings(
    run_id: str,
    run_dir: Path,
) -> list[dict[str, Any]]:
    leaked_fields: list[str] = []
    samples: list[dict[str, Any]] = []
    for row in _read_jsonl(run_dir / "player-view.jsonl"):
        if row.get("view") != "player" or row.get("type") != "transcript_turn":
            continue
        protocol = row.get("spoiler_protocol")
        if not isinstance(protocol, dict):
            continue
        for field in ("keeper_secret_id", "scope"):
            if protocol.get(field) in (None, "", [], {}):
                continue
            label = f"spoiler_protocol.{field} on turn {row.get('turn')}"
            if label not in leaked_fields:
                leaked_fields.append(label)
            if len(samples) < 8:
                samples.append({
                    "turn": row.get("turn"),
                    "field": field,
                    "value": protocol.get(field),
                })

    if not leaked_fields:
        return []
    return [_finding(
        "player_view_secret_leak",
        "system_gap",
        f"{run_id} player-view.jsonl exposes Keeper-only spoiler protocol fields: {', '.join(leaked_fields)}.",
        "Regenerate player-view.jsonl so spoiler_protocol in player view retains only public flow state and omits keeper_secret_id and scope; keep full protocol details in transcript.jsonl and keeper-view/audit logs.",
        run_id=run_id,
        missing_evidence=leaked_fields,
        player_view_spoiler_protocol_samples=samples,
    )]


def _player_view_transcript_detail_findings(
    run_id: str,
    run_dir: Path,
    metadata: dict[str, Any],
) -> list[dict[str, Any]]:
    localized_terms = _metadata_localized_terms(metadata)
    play_language = str(metadata.get("play_language") or "")
    if not play_language or play_language == "en-US":
        return []

    unlocalized_details: list[str] = []
    for row in _read_jsonl(run_dir / "player-view.jsonl"):
        if row.get("view") != "player" or row.get("type") != "transcript_turn":
            continue
        localized_text = row.get("localized_text", {})
        language_text = localized_text.get(play_language, {}) if isinstance(localized_text, dict) else {}
        if not isinstance(language_text, dict):
            continue
        for key in ("intent", "ruling"):
            canonical = row.get(key)
            expected = language_text.get(key)
            if not isinstance(canonical, str) or not canonical:
                continue
            if expected in (None, "", [], {}):
                continue
            expected_display = _localize_text(str(expected), localized_terms)
            observed_display = row.get(f"{key}_display")
            if observed_display != expected_display or observed_display == canonical:
                unlocalized_details.append(f"turn {row.get('turn')} {key}")

    if not unlocalized_details:
        return []
    return [_finding(
        "player_view_transcript_details_not_localized",
        "report_gap",
        f"{run_id} player-view.jsonl transcript detail display fields are missing or still canonical for {len(unlocalized_details)} localized intent/ruling values.",
        "Regenerate the active run so player-view.jsonl keeps canonical intent/ruling enum values but also writes intent_display/ruling_display from localized_text[play_language].",
        run_id=run_id,
        unlocalized_player_view_details=unlocalized_details[:20],
    )]


def _source_handout_summary_findings(
    run_id: str,
    campaign_dir: Path,
    campaign_prefix: str,
    metadata: dict[str, Any],
) -> list[dict[str, Any]]:
    handouts = _read_json(campaign_dir / "scenario" / "handouts.json", [])
    if not isinstance(handouts, list):
        return []
    localized_terms = _metadata_localized_terms(metadata)
    missing_ids: list[str] = []
    for index, handout in enumerate(handouts, start=1):
        if not isinstance(handout, dict):
            continue
        if _localized_source_field(handout, "summary", metadata, localized_terms):
            continue
        missing_ids.append(str(handout.get("id") or handout.get("title") or f"handout-{index}"))
    if not missing_ids:
        return []
    return [_finding(
        "source_handout_summary_missing",
        "system_gap",
        f"{run_id} scenario/handouts.json has {len(missing_ids)} handout rows without a player-visible summary.",
        "Regenerate the active run so every scenario handout records a player-visible summary for the report Handouts section.",
        run_id=run_id,
        incomplete_files=[f"{campaign_prefix}scenario/handouts.json"],
        handout_ids_missing_summary=missing_ids[:20],
    )]


def _campaign_structure_findings(
    run_id: str,
    campaign_dir: Path,
    campaign_prefix: str,
    audit_profile: str,
) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    missing_evidence: list[str] = []
    incomplete_files: list[str] = []

    rolls = _read_jsonl(campaign_dir / "logs" / "rolls.jsonl")
    events = _read_jsonl(campaign_dir / "logs" / "events.jsonl")
    memories = _read_jsonl(campaign_dir / "memory" / "session-summaries.jsonl")
    event_file = f"{campaign_prefix}logs/events.jsonl"

    has_roll_payload = any(
        isinstance(row.get("type"), str)
        and bool(row["type"].strip())
        and isinstance(row.get("payload"), dict)
        and bool(row["payload"])
        for row in rolls
    )
    has_roll_result = any(
        isinstance(row.get("payload"), dict)
        and isinstance(row["payload"].get("roll"), (int, float))
        and not isinstance(row["payload"].get("roll"), bool)
        and isinstance(row["payload"].get("target"), (int, float))
        and not isinstance(row["payload"].get("target"), bool)
        and isinstance(row["payload"].get("outcome"), str)
        and bool(row["payload"]["outcome"].strip())
        for row in rolls
    )
    has_event_payload = any(
        isinstance(row.get("type"), str)
        and bool(row["type"].strip())
        and isinstance(row.get("payload"), dict)
        and bool(row["payload"])
        for row in events
    )
    event_types = {
        row.get("type")
        for row in events
        if isinstance(row.get("type"), str) and row["type"].strip()
    }
    missing_event_types = [
        event_type
        for event_type in PROFILE_EVENT_TYPE_REQUIREMENTS.get(audit_profile, [])
        if event_type not in event_types
    ]
    has_memory_summary = any(
        isinstance(row.get("summary"), str)
        and bool(row["summary"].strip())
        for row in memories
    )

    if not has_roll_payload:
        missing_evidence.append("mechanical roll payload")
    if not has_roll_result:
        missing_evidence.append("mechanical roll result")
    if not has_roll_payload or not has_roll_result:
        incomplete_files.append(f"{campaign_prefix}logs/rolls.jsonl")
    if not has_event_payload:
        missing_evidence.append("durable event payload")
        incomplete_files.append(event_file)
    for event_type in missing_event_types:
        missing_evidence.append(f"{audit_profile} event type {event_type}")
    if missing_event_types and event_file not in incomplete_files:
        incomplete_files.append(event_file)
    if not has_memory_summary:
        missing_evidence.append("session memory summary")
        incomplete_files.append(f"{campaign_prefix}memory/session-summaries.jsonl")

    if missing_evidence:
        findings.append(_finding(
            "active_run_source_files_incomplete",
            "test_gap",
            f"{run_id} campaign source files lack required evidence: {', '.join(missing_evidence)}.",
            "Regenerate the active run so campaign roll logs, event logs, and memory summaries contain structured actual-play evidence before completion audit.",
            run_id=run_id,
            incomplete_files=incomplete_files,
            missing_evidence=missing_evidence,
        ))
    return findings


def _ids_from_index_rows(rows: Any) -> set[str]:
    if not isinstance(rows, list):
        return set()
    return {
        row["id"]
        for row in rows
        if isinstance(row, dict)
        and isinstance(row.get("id"), str)
        and row["id"].strip()
    }


def _payload_rule_refs(row: dict[str, Any]) -> list[str]:
    payload = row.get("payload")
    if not isinstance(payload, dict):
        return []
    refs = payload.get("rule_refs")
    if not isinstance(refs, list):
        return []
    return [
        ref.strip()
        for ref in refs
        if isinstance(ref, str) and ref.strip()
    ]


def _source_rule_refs_from_logs(campaign_dir: Path) -> set[str]:
    source_refs: set[str] = set()
    for log_name in ("logs/rolls.jsonl", "logs/events.jsonl"):
        for row in _read_jsonl(campaign_dir / log_name):
            source_refs.update(_payload_rule_refs(row))
    return source_refs


def _rule_ref_index_entry_points_to_source(
    ref: str,
    entry: Any,
    rows_by_log: dict[str, list[dict[str, Any]]],
) -> bool:
    if not isinstance(entry, dict):
        return False
    log_name = entry.get("log")
    row_number = entry.get("row")
    if not isinstance(log_name, str) or log_name not in rows_by_log:
        return False
    if not isinstance(row_number, int) or isinstance(row_number, bool):
        return False
    rows = rows_by_log[log_name]
    if row_number < 1 or row_number > len(rows):
        return False
    return ref in _payload_rule_refs(rows[row_number - 1])


def _campaign_relative_file_exists(campaign_dir: Path, value: Any) -> bool:
    if not isinstance(value, str) or not value.strip():
        return False
    relative_path = Path(value)
    if relative_path.is_absolute() or ".." in relative_path.parts:
        return False
    return (campaign_dir / relative_path).is_file()


def _run_relative_file_exists(run_dir: Path, value: Any) -> bool:
    if not isinstance(value, str) or not value.strip():
        return False
    relative_path = Path(value)
    if relative_path.is_absolute() or ".." in relative_path.parts:
        return False
    return (run_dir / relative_path).is_file()


def _sandbox_relative_path_exists(sandbox_root: Path, value: Any) -> bool:
    if not isinstance(value, str) or not value.strip():
        return False
    relative_path = Path(value)
    if relative_path.is_absolute() or ".." in relative_path.parts:
        return False
    return (sandbox_root / relative_path).exists()


def _string_set(values: Any) -> set[str]:
    if not isinstance(values, list):
        return set()
    return {
        value
        for value in values
        if isinstance(value, str) and value.strip()
    }


def _true_flag_keys(values: Any) -> set[str]:
    if not isinstance(values, dict):
        return set()
    return {
        key
        for key, value in values.items()
        if isinstance(key, str) and key.strip() and value is True
    }


def _workspace_index_integrity_findings(
    run_id: str,
    run_dir: Path,
    campaign_id: str,
    investigator_ids: list[str],
) -> list[dict[str, Any]]:
    sandbox_root = run_dir / "sandbox"
    workspace_root = sandbox_root / ".coc"
    campaign_index = _read_json(workspace_root / "indexes" / "campaigns.json", {})
    investigator_index = _read_json(workspace_root / "indexes" / "investigators.json", {})
    missing_evidence: list[str] = []
    incomplete_files: list[str] = []

    campaigns = campaign_index.get("campaigns") if isinstance(campaign_index, dict) else None
    campaign_entry = campaigns.get(campaign_id) if isinstance(campaigns, dict) else None
    if not isinstance(campaign_entry, dict):
        missing_evidence.append("campaign id not present in indexes/campaigns.json")
        incomplete_files.append("sandbox/.coc/indexes/campaigns.json")
    else:
        expected_campaign_paths = {
            "path": f".coc/campaigns/{campaign_id}/campaign.json",
            "party_path": f".coc/campaigns/{campaign_id}/party.json",
            "save_path": f".coc/campaigns/{campaign_id}/save",
            "memory_path": f".coc/campaigns/{campaign_id}/memory",
            "logs_path": f".coc/campaigns/{campaign_id}/logs",
        }
        if campaign_entry.get("campaign_id") != campaign_id:
            missing_evidence.append("campaign index entry campaign_id does not match active campaign")
            incomplete_files.append("sandbox/.coc/indexes/campaigns.json")
        if _string_set(campaign_entry.get("investigator_ids")) != set(investigator_ids):
            missing_evidence.append("campaign index investigator_ids do not match party.json")
            incomplete_files.append("sandbox/.coc/indexes/campaigns.json")
        for key, expected_path in expected_campaign_paths.items():
            if campaign_entry.get(key) != expected_path:
                missing_evidence.append(f"campaign index {key} does not match expected workspace path")
                incomplete_files.append("sandbox/.coc/indexes/campaigns.json")
            elif not _sandbox_relative_path_exists(sandbox_root, expected_path):
                missing_evidence.append(f"campaign index {key} does not resolve")
                incomplete_files.append("sandbox/.coc/indexes/campaigns.json")

    investigators = investigator_index.get("investigators") if isinstance(investigator_index, dict) else None
    if not isinstance(investigators, dict):
        missing_evidence.append("investigator collection missing in indexes/investigators.json")
        incomplete_files.append("sandbox/.coc/indexes/investigators.json")
    else:
        for investigator_id in investigator_ids:
            entry = investigators.get(investigator_id)
            if not isinstance(entry, dict):
                missing_evidence.append(f"investigator id {investigator_id} not present in indexes/investigators.json")
                incomplete_files.append("sandbox/.coc/indexes/investigators.json")
                continue
            expected_investigator_paths = {
                "creation_path": f".coc/investigators/{investigator_id}/creation.json",
                "path": f".coc/investigators/{investigator_id}/character.json",
                "history_path": f".coc/investigators/{investigator_id}/history.jsonl",
                "development_path": f".coc/investigators/{investigator_id}/development.jsonl",
                "inventory_history_path": f".coc/investigators/{investigator_id}/inventory-history.jsonl",
            }
            if entry.get("id") != investigator_id:
                missing_evidence.append(f"investigator index entry id does not match {investigator_id}")
                incomplete_files.append("sandbox/.coc/indexes/investigators.json")
            campaign_state_fields = sorted(
                set(entry)
                & {
                    "active_scene_id",
                    "conditions",
                    "current_hp",
                    "current_mp",
                    "current_san",
                    "scene_id",
                    "skill_checks_earned",
                    "temporary_insanity",
                }
            )
            if campaign_state_fields:
                missing_evidence.append(f"investigator index contains campaign state fields for {investigator_id}")
                incomplete_files.append("sandbox/.coc/indexes/investigators.json")
            for key, expected_path in expected_investigator_paths.items():
                if entry.get(key) != expected_path:
                    missing_evidence.append(
                        f"investigator index {key} does not match expected workspace path for {investigator_id}"
                    )
                    incomplete_files.append("sandbox/.coc/indexes/investigators.json")
                elif not _sandbox_relative_path_exists(sandbox_root, expected_path):
                    missing_evidence.append(f"investigator index {key} does not resolve for {investigator_id}")
                    incomplete_files.append("sandbox/.coc/indexes/investigators.json")

    if not missing_evidence:
        return []
    return [_finding(
        "active_run_workspace_index_missing",
        "system_gap",
        f"{run_id} workspace indexes do not resolve active campaign and reusable investigators: {', '.join(missing_evidence)}.",
        "Regenerate the active run so sandbox/.coc/indexes/campaigns.json and investigators.json point to the current campaign save, memory, logs, party, and reusable investigator records.",
        run_id=run_id,
        incomplete_files=list(dict.fromkeys(incomplete_files)),
        missing_evidence=list(dict.fromkeys(missing_evidence)),
    )]


def _latest_status_payload(events: list[dict[str, Any]], investigator_id: str) -> dict[str, Any]:
    for row in reversed(events):
        if row.get("type") != "status" or row.get("actor") != investigator_id:
            continue
        payload = row.get("payload")
        if isinstance(payload, dict):
            return payload
    return {}


def _numeric_payload_value(payload: dict[str, Any], key: str) -> int | float | None:
    value = payload.get(key)
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return value
    return None


def _development_skill_checks(rows: list[dict[str, Any]]) -> set[str]:
    skill_checks: set[str] = set()
    for row in rows:
        values = row.get("skill_checks_earned")
        if not isinstance(values, list):
            continue
        skill_checks.update(_string_set(values))
    return skill_checks


def _campaign_save_integrity_findings(
    run_id: str,
    run_dir: Path,
    campaign_dir: Path,
    campaign_prefix: str,
    investigator_ids: list[str],
) -> list[dict[str, Any]]:
    world_state = _read_json(campaign_dir / "save" / "world-state.json", {})
    active_scene = _read_json(campaign_dir / "save" / "active-scene.json", {})
    flags = _read_json(campaign_dir / "save" / "flags.json", {})
    events = _read_jsonl(campaign_dir / "logs" / "events.jsonl")
    missing_evidence: list[str] = []
    incomplete_files: list[str] = []

    world_active_scene_id = world_state.get("active_scene_id")
    saved_active_scene_id = active_scene.get("scene_id")
    if (
        isinstance(world_active_scene_id, str)
        and world_active_scene_id.strip()
        and saved_active_scene_id != world_active_scene_id
    ):
        missing_evidence.append("active-scene scene_id does not match world-state active_scene_id")
        incomplete_files.extend([
            f"{campaign_prefix}save/world-state.json",
            f"{campaign_prefix}save/active-scene.json",
        ])

    world_clue_ids = _string_set(world_state.get("discovered_clue_ids"))
    flag_clue_ids = _true_flag_keys(flags.get("clues_found"))
    if world_clue_ids and flag_clue_ids != world_clue_ids:
        missing_evidence.append("flags clues_found does not match world-state discovered_clue_ids")
        incomplete_files.extend([
            f"{campaign_prefix}save/world-state.json",
            f"{campaign_prefix}save/flags.json",
        ])

    for key, evidence_label in (
        ("log_refs", "world-state log_refs do not resolve"),
        ("memory_refs", "world-state memory_refs do not resolve"),
    ):
        refs = world_state.get(key)
        if not isinstance(refs, list) or not refs:
            missing_evidence.append(evidence_label)
            incomplete_files.append(f"{campaign_prefix}save/world-state.json")
            continue
        stale_refs = [
            ref
            for ref in refs
            if not _campaign_relative_file_exists(campaign_dir, ref)
        ]
        if stale_refs:
            missing_evidence.append(evidence_label)
            incomplete_files.append(f"{campaign_prefix}save/world-state.json")

    expected_investigator_state_refs = {
        f"save/investigator-state/{investigator_id}.json"
        for investigator_id in investigator_ids
    }
    world_investigator_state_refs = _string_set(world_state.get("investigator_state_refs"))
    if expected_investigator_state_refs and world_investigator_state_refs != expected_investigator_state_refs:
        missing_evidence.append("world-state investigator_state_refs do not match party investigator ids")
        incomplete_files.append(f"{campaign_prefix}save/world-state.json")
    if expected_investigator_state_refs and (
        not world_investigator_state_refs
        or any(
            not _campaign_relative_file_exists(campaign_dir, ref)
            for ref in world_investigator_state_refs
        )
    ):
        missing_evidence.append("world-state investigator_state_refs do not resolve")
        incomplete_files.append(f"{campaign_prefix}save/world-state.json")

    for investigator_id in investigator_ids:
        investigator_state_ref = f"save/investigator-state/{investigator_id}.json"
        state = _read_json(campaign_dir / investigator_state_ref, {})
        investigator_prefix = f"sandbox/.coc/investigators/{investigator_id}/"
        character = _read_json(run_dir / f"{investigator_prefix}character.json", {})
        development = _read_jsonl(run_dir / f"{investigator_prefix}development.jsonl")
        derived = character.get("derived") if isinstance(character.get("derived"), dict) else {}
        state_skill_checks = _string_set(state.get("skill_checks_earned"))
        development_skill_checks = _development_skill_checks(development)
        status_payload = _latest_status_payload(events, investigator_id)
        if state.get("campaign_id") != run_id:
            missing_evidence.append("investigator-state campaign_id does not match run campaign")
            incomplete_files.append(f"{campaign_prefix}{investigator_state_ref}")
        if state.get("investigator_id") != investigator_id:
            missing_evidence.append("investigator-state investigator_id does not match party investigator id")
            incomplete_files.append(f"{campaign_prefix}{investigator_state_ref}")
        if not _run_relative_file_exists(run_dir, state.get("character_ref")):
            missing_evidence.append("investigator-state character_ref does not resolve")
            incomplete_files.append(f"{campaign_prefix}{investigator_state_ref}")
        for state_key, status_key, derived_key in (
            ("current_hp", "final_hp", "HP"),
            ("current_san", "final_san", "SAN"),
            ("current_mp", "final_mp", "MP"),
        ):
            expected_value = _numeric_payload_value(status_payload, status_key)
            evidence_label = f"investigator-state {state_key} does not match latest status {status_key}"
            if expected_value is None:
                expected_value = _numeric_payload_value(derived, derived_key)
                evidence_label = f"investigator-state {state_key} does not match character derived {derived_key}"
            if expected_value is not None and state.get(state_key) != expected_value:
                missing_evidence.append(evidence_label)
                incomplete_files.append(f"{campaign_prefix}{investigator_state_ref}")
        if (state_skill_checks or development_skill_checks) and state_skill_checks != development_skill_checks:
            missing_evidence.append("investigator-state skill_checks_earned does not match development skill_checks_earned")
            incomplete_files.extend([
                f"{campaign_prefix}{investigator_state_ref}",
                f"{investigator_prefix}development.jsonl",
            ])

    if not missing_evidence:
        return []
    return [_finding(
        "campaign_save_integrity_missing",
        "system_gap",
        f"{run_id} recoverable campaign save files disagree: {', '.join(missing_evidence)}.",
        "Regenerate campaign save files so world-state, active-scene, flags, investigator-state refs, log refs, and memory refs agree before completion audit.",
        run_id=run_id,
        incomplete_files=list(dict.fromkeys(incomplete_files)),
        missing_evidence=list(dict.fromkeys(missing_evidence)),
    )]


def _source_map_integrity_findings(
    run_id: str,
    campaign_dir: Path,
    campaign_prefix: str,
) -> list[dict[str, Any]]:
    source_map = _read_json(campaign_dir / "index" / "source-map.json", {})
    required_ref_lists = [
        ("scenario_files", "scenario_files refs"),
        ("log_refs", "log_refs"),
        ("memory_refs", "memory_refs"),
    ]
    missing_evidence: list[str] = []
    unresolved_refs: dict[str, list[Any]] = {}
    for key, evidence_label in required_ref_lists:
        refs = source_map.get(key)
        if not isinstance(refs, list) or not refs:
            missing_evidence.append(f"{evidence_label} missing")
            unresolved_refs[key] = refs if isinstance(refs, list) else []
            continue
        stale_refs = [
            ref
            for ref in refs
            if not _campaign_relative_file_exists(campaign_dir, ref)
        ]
        if stale_refs:
            missing_evidence.append(f"{evidence_label} do not resolve")
            unresolved_refs[key] = stale_refs[:20]

    if not missing_evidence:
        return []
    return [_finding(
        "campaign_source_map_integrity_missing",
        "system_gap",
        f"{run_id} source-map.json contains stale or incomplete recoverability refs: {', '.join(missing_evidence)}.",
        "Regenerate index/source-map.json so scenario_files, log_refs, and memory_refs resolve to current campaign files.",
        run_id=run_id,
        incomplete_files=[f"{campaign_prefix}index/source-map.json"],
        missing_evidence=missing_evidence,
        unresolved_refs=unresolved_refs,
    )]


def _campaign_index_integrity_findings(
    run_id: str,
    campaign_dir: Path,
    campaign_prefix: str,
) -> list[dict[str, Any]]:
    world_state = _read_json(campaign_dir / "save" / "world-state.json", {})
    scene_index = _read_json(campaign_dir / "index" / "scene-index.json", {})
    clue_index = _read_json(campaign_dir / "index" / "clue-index.json", {})
    rule_ref_index = _read_json(campaign_dir / "index" / "rule-ref-index.json", {})
    missing_evidence: list[str] = []
    incomplete_files: list[str] = []

    active_scene_id = scene_index.get("active_scene_id") or world_state.get("active_scene_id")
    scene_ids = _ids_from_index_rows(scene_index.get("scenes"))
    if isinstance(active_scene_id, str) and active_scene_id.strip() and active_scene_id not in scene_ids:
        missing_evidence.append("active scene id not present in index/scene-index.json")
        incomplete_files.append(f"{campaign_prefix}index/scene-index.json")

    discovered_clue_ids = clue_index.get("discovered_clue_ids")
    if not isinstance(discovered_clue_ids, list):
        discovered_clue_ids = world_state.get("discovered_clue_ids", [])
    indexed_clue_ids = _ids_from_index_rows(clue_index.get("clues")) | _ids_from_index_rows(clue_index.get("handouts"))
    unresolved_clue_ids = [
        clue_id
        for clue_id in discovered_clue_ids
        if isinstance(clue_id, str)
        and clue_id.strip()
        and clue_id not in indexed_clue_ids
    ] if isinstance(discovered_clue_ids, list) else []
    if unresolved_clue_ids:
        missing_evidence.append("discovered clue ids not present in index/clue-index.json")
        incomplete_files.append(f"{campaign_prefix}index/clue-index.json")

    source_rule_refs = _source_rule_refs_from_logs(campaign_dir)
    indexed_rule_refs = {
        ref
        for ref in rule_ref_index.get("rule_refs", [])
        if isinstance(ref, str) and ref.strip()
    } if isinstance(rule_ref_index.get("rule_refs"), list) else set()
    by_ref = rule_ref_index.get("by_ref") if isinstance(rule_ref_index.get("by_ref"), dict) else {}
    indexed_trace_refs = {
        ref
        for ref, entries in by_ref.items()
        if isinstance(ref, str)
        and ref.strip()
        and isinstance(entries, list)
        and entries
    }
    missing_rule_refs = sorted(source_rule_refs - indexed_rule_refs)
    missing_rule_ref_traces = sorted(source_rule_refs - indexed_trace_refs)
    if missing_rule_refs:
        missing_evidence.append("source rule refs not present in index/rule-ref-index.json")
        incomplete_files.append(f"{campaign_prefix}index/rule-ref-index.json")
    if missing_rule_ref_traces:
        missing_evidence.append("source rule refs lack by_ref entries in index/rule-ref-index.json")
        incomplete_files.append(f"{campaign_prefix}index/rule-ref-index.json")

    rows_by_log = {
        "logs/rolls.jsonl": _read_jsonl(campaign_dir / "logs" / "rolls.jsonl"),
        "logs/events.jsonl": _read_jsonl(campaign_dir / "logs" / "events.jsonl"),
    }
    unresolved_rule_ref_traces = sorted(
        ref
        for ref in source_rule_refs.intersection(indexed_trace_refs)
        if not any(
            _rule_ref_index_entry_points_to_source(ref, entry, rows_by_log)
            for entry in by_ref.get(ref, [])
        )
    )
    if unresolved_rule_ref_traces:
        missing_evidence.append("rule-ref index entries do not resolve to source log rows")
        incomplete_files.append(f"{campaign_prefix}index/rule-ref-index.json")

    if not missing_evidence:
        return []
    return [_finding(
        "campaign_index_integrity_missing",
        "system_gap",
        f"{run_id} campaign indexes do not resolve active save state: {', '.join(missing_evidence)}.",
        "Regenerate campaign indexes so active scene ids, discovered clue ids, and source rule refs resolve to structured index rows.",
        run_id=run_id,
        incomplete_files=list(dict.fromkeys(incomplete_files)),
        missing_evidence=missing_evidence,
        unresolved_clue_ids=unresolved_clue_ids[:20],
        missing_rule_refs=missing_rule_refs[:20],
        missing_rule_ref_traces=missing_rule_ref_traces[:20],
        unresolved_rule_ref_traces=unresolved_rule_ref_traces[:20],
    )]


def _rule_ref_traceability_findings(
    run_id: str,
    campaign_dir: Path,
    campaign_prefix: str,
) -> list[dict[str, Any]]:
    known_rule_ids = rule_ids()
    rolls_file = f"{campaign_prefix}logs/rolls.jsonl"
    events_file = f"{campaign_prefix}logs/events.jsonl"
    rolls = _read_jsonl(campaign_dir / "logs" / "rolls.jsonl")
    events = _read_jsonl(campaign_dir / "logs" / "events.jsonl")
    missing_evidence: list[str] = []
    incomplete_files: list[str] = []
    invalid_refs: list[str] = []

    roll_payloads = [
        row.get("payload")
        for row in rolls
        if isinstance(row.get("payload"), dict)
        and isinstance(row["payload"].get("roll"), (int, float))
        and not isinstance(row["payload"].get("roll"), bool)
    ]
    roll_payloads_without_refs = [
        payload
        for payload in roll_payloads
        if not isinstance(payload.get("rule_refs"), list)
        or not any(isinstance(ref, str) and ref.strip() for ref in payload.get("rule_refs", []))
    ]
    if roll_payloads_without_refs:
        missing_evidence.append("roll payload rule_refs")
        incomplete_files.append(rolls_file)

    event_payloads_requiring_refs = [
        row.get("payload")
        for row in events
        if isinstance(row.get("payload"), dict)
        and isinstance(row["payload"].get("rulebook_ref"), str)
        and row["payload"]["rulebook_ref"].strip()
    ]
    event_payloads_without_refs = [
        payload
        for payload in event_payloads_requiring_refs
        if not isinstance(payload.get("rule_refs"), list)
        or not any(isinstance(ref, str) and ref.strip() for ref in payload.get("rule_refs", []))
    ]
    if event_payloads_without_refs:
        missing_evidence.append("rulebook_ref event rule_refs")
        incomplete_files.append(events_file)

    for payload in [*roll_payloads, *event_payloads_requiring_refs]:
        refs = payload.get("rule_refs")
        if not isinstance(refs, list):
            continue
        for ref in refs:
            if isinstance(ref, str) and ref not in known_rule_ids:
                invalid_refs.append(ref)

    if invalid_refs:
        missing_evidence.append("rule_refs resolving to rule-index.json")
        if rolls_file not in incomplete_files:
            incomplete_files.append(rolls_file)
        if events_file not in incomplete_files and event_payloads_requiring_refs:
            incomplete_files.append(events_file)

    if not missing_evidence:
        return []
    return [_finding(
        "active_run_rule_refs_missing",
        "system_gap",
        f"{run_id} rule source logs lack required structured rule_refs: {', '.join(missing_evidence)}.",
        "Regenerate the active run so roll and rulebook_ref event payloads include rule_refs that resolve to references/rules-json/rule-index.json.",
        run_id=run_id,
        incomplete_files=list(dict.fromkeys(incomplete_files)),
        missing_evidence=missing_evidence,
        invalid_rule_refs=sorted(set(invalid_refs)),
    )]


def _pushed_roll_structure_findings(
    run_id: str,
    run_dir: Path,
    campaign_dir: Path,
    campaign_prefix: str,
    audit_profile: str,
) -> list[dict[str, Any]]:
    if audit_profile not in PUSHED_ROLL_REQUIRED_PROFILES:
        return []

    findings: list[dict[str, Any]] = []
    missing_evidence: list[str] = []
    incomplete_files: list[str] = []
    transcript = _read_jsonl(run_dir / "transcript.jsonl")
    rolls = _read_jsonl(campaign_dir / "logs" / "rolls.jsonl")
    rolls_file = f"{campaign_prefix}logs/rolls.jsonl"

    pushed_payloads = [
        row["payload"]
        for row in rolls
        if isinstance(row.get("payload"), dict)
        and (
            row["payload"].get("pushed") is True
            or isinstance(row["payload"].get("pushed_roll_protocol"), dict)
        )
    ]

    complete_roll_ids: list[str] = []
    for payload in pushed_payloads:
        protocol = payload.get("pushed_roll_protocol")
        if not isinstance(protocol, dict):
            continue
        roll_id = protocol.get("roll_id")
        if (
            isinstance(roll_id, str)
            and roll_id.strip()
            and protocol.get("failure_consequence_source") == "keeper"
            and protocol.get("keeper_foreshadowed_failure") is True
            and protocol.get("player_confirmation_recorded") is True
        ):
            complete_roll_ids.append(roll_id)

    if not pushed_payloads:
        missing_evidence.append("required pushed roll payload")
    if not complete_roll_ids:
        missing_evidence.append("pushed roll payload protocol")

    transcript_roll_ids = set()
    invalid_stage_roles: list[str] = []
    pushed_roll_stages = _pushed_roll_protocol_stages()
    for roll_id in complete_roll_ids:
        stages = []
        for row in transcript:
            if (
                not isinstance(row.get("pushed_roll_protocol"), dict)
                or row["pushed_roll_protocol"].get("roll_id") != roll_id
            ):
                continue
            stage = row["pushed_roll_protocol"].get("stage")
            if _pushed_roll_stage_role_is_valid(row, stage):
                stages.append(stage)
            else:
                invalid_stage_roles.append(f"{roll_id}:{stage}:{row.get('role')}")
        stage_index = 0
        for stage in stages:
            if stage_index < len(pushed_roll_stages) and stage == pushed_roll_stages[stage_index]:
                stage_index += 1
        if stage_index == len(pushed_roll_stages):
            transcript_roll_ids.add(roll_id)

    if invalid_stage_roles:
        missing_evidence.append("pushed roll transcript stage roles")
    if not transcript_roll_ids:
        missing_evidence.append("pushed roll transcript protocol")

    if "required pushed roll payload" in missing_evidence or "pushed roll payload protocol" in missing_evidence:
        incomplete_files.append(rolls_file)
    if "pushed roll transcript protocol" in missing_evidence:
        incomplete_files.append("transcript.jsonl")

    if missing_evidence:
        findings.append(_finding(
            "active_run_source_files_incomplete",
            "test_gap",
            f"{run_id} pushed-roll source files lack required evidence: {', '.join(missing_evidence)}.",
            "Regenerate the active run so pushed rolls record Keeper-owned consequences, player confirmation, roll ids, and ordered transcript protocol stages.",
            run_id=run_id,
            incomplete_files=incomplete_files,
            missing_evidence=missing_evidence,
            invalid_pushed_roll_stage_roles=invalid_stage_roles[:20],
        ))
    return findings


def _multi_profile_structure_findings(run_id: str, run_dir: Path, audit_profile: str) -> list[dict[str, Any]]:
    required_profiles = MULTI_PROFILE_SOURCE_REQUIREMENTS.get(audit_profile, [])
    if not required_profiles:
        return []

    transcript = _read_jsonl(run_dir / "transcript.jsonl")
    feedback = _read_jsonl(run_dir / "player-feedback.jsonl")
    transcript_profiles = {
        row.get("player_profile")
        for row in transcript
        if row.get("role") == "player_simulator"
        and isinstance(row.get("text"), str)
        and row["text"].strip()
    }
    transcript_intent_profiles = {
        row.get("player_profile")
        for row in transcript
        if row.get("role") == "player_simulator"
        and isinstance(row.get("text"), str)
        and row["text"].strip()
        and isinstance(row.get("intent"), str)
        and row["intent"].strip()
        and isinstance(row.get("intent_display"), str)
        and row["intent_display"].strip()
    }
    feedback_profiles = {
        row.get("player_profile")
        for row in feedback
        if isinstance(row.get("score"), (int, float))
        and not isinstance(row.get("score"), bool)
        and isinstance(row.get("text"), str)
        and row["text"].strip()
    }

    missing_evidence: list[str] = []
    incomplete_files: list[str] = []
    missing_transcript_profiles = [
        profile for profile in required_profiles
        if profile not in transcript_profiles
    ]
    missing_feedback_profiles = [
        profile for profile in required_profiles
        if profile not in feedback_profiles
    ]
    missing_intent_profiles = [
        profile for profile in required_profiles
        if profile not in transcript_intent_profiles
    ]
    for profile in missing_transcript_profiles:
        missing_evidence.append(f"{audit_profile} transcript profile {profile}")
    for profile in missing_intent_profiles:
        missing_evidence.append(f"{audit_profile} transcript intent evidence {profile}")
    for profile in missing_feedback_profiles:
        missing_evidence.append(f"{audit_profile} feedback profile {profile}")
    if missing_transcript_profiles or missing_intent_profiles:
        incomplete_files.append("transcript.jsonl")
    if missing_feedback_profiles:
        incomplete_files.append("player-feedback.jsonl")

    if not missing_evidence:
        return []
    return [_finding(
        "active_run_source_files_incomplete",
        "test_gap",
        f"{run_id} single-player style-profile source files lack required style-profile evidence: {', '.join(missing_evidence)}.",
        "Regenerate the active run so single-player style-pressure transcripts and feedback include each required player_profile enum with visible text plus structured intent and localized intent_display evidence.",
        run_id=run_id,
        incomplete_files=incomplete_files,
        missing_evidence=missing_evidence,
    )]


def _meta_game_structure_findings(run_id: str, run_dir: Path, audit_profile: str) -> list[dict[str, Any]]:
    if audit_profile not in META_GAME_REQUIRED_PROFILES:
        return []

    transcript = _read_jsonl(run_dir / "transcript.jsonl")
    has_meta_player_question = any(
        row.get("mode") == "meta"
        and row.get("role") == "player_simulator"
        and isinstance(row.get("text"), str)
        and row["text"].strip()
        for row in transcript
    )
    has_meta_keeper_answer = any(
        row.get("mode") == "meta"
        and row.get("role") == "keeper_under_test"
        and isinstance(row.get("text"), str)
        and row["text"].strip()
        for row in transcript
    )

    missing_evidence: list[str] = []
    if not has_meta_player_question:
        missing_evidence.append("meta player question")
    if not has_meta_keeper_answer:
        missing_evidence.append("meta keeper answer")
    if not missing_evidence:
        return []

    return [_finding(
        "active_run_source_files_incomplete",
        "test_gap",
        f"{run_id} transcript.jsonl lacks required meta-game source evidence: {', '.join(missing_evidence)}.",
        "Regenerate the active run so transcript.jsonl includes separated meta-mode player questions and Keeper answers with visible text.",
        run_id=run_id,
        incomplete_files=["transcript.jsonl"],
        missing_evidence=missing_evidence,
    )]


def _spoiler_reveal_structure_findings(
    run_id: str,
    run_dir: Path,
    campaign_dir: Path,
    campaign_prefix: str,
    audit_profile: str,
) -> list[dict[str, Any]]:
    transcript = _read_jsonl(run_dir / "transcript.jsonl")
    audit_log = _read_jsonl(campaign_dir / "logs" / "audit.jsonl")
    protocol_rows = [
        row
        for row in transcript
        if isinstance(row.get("spoiler_protocol"), dict)
    ]
    required = audit_profile in SPOILER_REVEAL_REQUIRED_PROFILES or any(
        row.get("spoiler_protocol", {}).get("stage") == "limited_reveal"
        for row in protocol_rows
    )
    if not required:
        return []

    findings: list[dict[str, Any]] = []
    by_spoiler_id: dict[str, list[dict[str, Any]]] = {}
    for row in protocol_rows:
        protocol = row["spoiler_protocol"]
        spoiler_id = protocol.get("spoiler_id")
        if isinstance(spoiler_id, str) and spoiler_id.strip():
            by_spoiler_id.setdefault(spoiler_id, []).append(row)

    complete_spoiler_ids: list[str] = []
    observed_stages = {
        row["spoiler_protocol"].get("stage")
        for row in protocol_rows
        if isinstance(row.get("spoiler_protocol"), dict)
    }
    missing_protocol_evidence: list[str] = []
    stage_labels = {
        "warning_issued": "spoiler warning stage",
        "player_confirmed": "spoiler player confirmation stage",
        "limited_reveal": "spoiler limited reveal stage",
    }
    for stage in SPOILER_REVEAL_PROTOCOL_STAGES:
        if stage not in observed_stages:
            missing_protocol_evidence.append(stage_labels[stage])

    for spoiler_id, rows in by_spoiler_id.items():
        stage_index = 0
        warning_scope = None
        warning_secret_id = None
        player_confirmed = False
        reveal_confirmed = False
        reveal_scope = None
        reveal_secret_id = None
        for row in rows:
            protocol = row["spoiler_protocol"]
            stage = protocol.get("stage")
            if stage_index < len(SPOILER_REVEAL_PROTOCOL_STAGES) and stage == SPOILER_REVEAL_PROTOCOL_STAGES[stage_index]:
                stage_index += 1
            if stage == "warning_issued":
                warning_scope = protocol.get("scope")
                warning_secret_id = protocol.get("keeper_secret_id")
            elif stage == "player_confirmed":
                player_confirmed = protocol.get("confirmed") is True
            elif stage == "limited_reveal":
                reveal_confirmed = protocol.get("confirmed") is True
                reveal_scope = protocol.get("scope")
                reveal_secret_id = protocol.get("keeper_secret_id")
        if stage_index != len(SPOILER_REVEAL_PROTOCOL_STAGES):
            continue
        if not player_confirmed or not reveal_confirmed:
            continue
        if not warning_scope or warning_scope != reveal_scope:
            continue
        if not warning_secret_id or warning_secret_id != reveal_secret_id:
            continue
        complete_spoiler_ids.append(spoiler_id)

    if protocol_rows and not complete_spoiler_ids:
        missing_protocol_evidence.append("ordered spoiler reveal protocol")
    if missing_protocol_evidence:
        findings.append(_finding(
            "spoiler_reveal_protocol_missing",
            "test_gap",
            f"{run_id} transcript.jsonl lacks required warning-gated spoiler reveal protocol evidence: {', '.join(missing_protocol_evidence)}.",
            "Regenerate the active run so transcript.jsonl records spoiler_protocol stages warning_issued, player_confirmed, and limited_reveal with matching spoiler_id, scope, keeper_secret_id, and confirmation.",
            run_id=run_id,
            incomplete_files=["transcript.jsonl"],
            missing_evidence=missing_protocol_evidence,
        ))

    audit_reveal_ids = {
        row.get("spoiler_id")
        for row in audit_log
        if row.get("type") == "spoiler_reveal"
        and row.get("confirmed") is True
        and isinstance(row.get("spoiler_id"), str)
        and isinstance(row.get("keeper_secret_id"), str)
        and isinstance(row.get("scope"), str)
        and row["spoiler_id"].strip()
        and row["keeper_secret_id"].strip()
        and row["scope"].strip()
    }
    if not complete_spoiler_ids or not set(complete_spoiler_ids).intersection(audit_reveal_ids):
        findings.append(_finding(
            "spoiler_reveal_audit_missing",
            "system_gap",
            f"{run_id} logs/audit.jsonl lacks a confirmed spoiler_reveal event linked to the completed transcript protocol.",
            "Regenerate the active run so logs/audit.jsonl records each confirmed Keeper-only reveal with spoiler_id, keeper_secret_id, scope, and confirmed=true.",
            run_id=run_id,
            incomplete_files=[f"{campaign_prefix}logs/audit.jsonl"],
            missing_evidence=["spoiler audit log reveal"],
        ))
    return findings


def _investigator_structure_findings(run_id: str, investigator_dir: Path, investigator_prefix: str) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    missing_evidence: list[str] = []
    incomplete_files: list[str] = []

    creation = _read_json(investigator_dir / "creation.json", {})
    character = _read_json(investigator_dir / "character.json", {})
    history = _read_jsonl(investigator_dir / "history.jsonl")
    development = _read_jsonl(investigator_dir / "development.jsonl")
    inventory = _read_jsonl(investigator_dir / "inventory-history.jsonl")

    has_skill_allocation = (
        isinstance(creation, dict)
        and isinstance(creation.get("skill_allocation"), dict)
        and bool(creation["skill_allocation"])
    )
    finances = creation.get("finances") if isinstance(creation, dict) else {}
    missing_finance_evidence: list[str] = []
    if not isinstance(finances, dict):
        missing_finance_evidence.extend([
            "investigator finance living standard",
            "investigator finance cash",
            "investigator finance assets",
            "investigator finance spending level",
        ])
    else:
        for key, evidence in [
            ("period", "investigator finance period"),
            ("living_standard", "investigator finance living standard"),
            ("cash", "investigator finance cash"),
            ("assets", "investigator finance assets"),
            ("spending_level", "investigator finance spending level"),
        ]:
            if finances.get(key) in (None, "", [], {}):
                missing_finance_evidence.append(evidence)
        if not missing_finance_evidence and finances.get("credit_rating") not in (None, "", [], {}):
            try:
                expected_finances = cash_and_assets(int(finances["credit_rating"]), str(finances["period"]))
            except (TypeError, ValueError):
                missing_finance_evidence.append("investigator finance rulebook table lookup")
            else:
                for key in ("living_standard", "cash", "assets", "spending_level"):
                    if finances.get(key) != expected_finances.get(key):
                        missing_finance_evidence.append(f"investigator finance {key} rulebook value")
    has_character_skills = (
        isinstance(character, dict)
        and isinstance(character.get("skills"), dict)
        and bool(character["skills"])
    )
    has_history_summary = any(
        isinstance(row.get("summary"), str)
        and bool(row["summary"].strip())
        for row in history
    )
    has_development_record = any(
        any(key in row for key in ("summary", "status", "rewards", "carryover_notes", "skill_checks_earned"))
        for row in development
    )
    has_inventory_summary = any(
        isinstance(row.get("summary"), str)
        and bool(row["summary"].strip())
        for row in inventory
    )

    if not has_skill_allocation:
        missing_evidence.append("investigator skill allocation")
        incomplete_files.append(f"{investigator_prefix}creation.json")
    if missing_finance_evidence:
        missing_evidence.extend(missing_finance_evidence)
        incomplete_files.append(f"{investigator_prefix}creation.json")
    if not has_character_skills:
        missing_evidence.append("investigator character skills")
        incomplete_files.append(f"{investigator_prefix}character.json")
    if not has_history_summary:
        missing_evidence.append("investigator history summary")
        incomplete_files.append(f"{investigator_prefix}history.jsonl")
    if not has_development_record:
        missing_evidence.append("investigator development record")
        incomplete_files.append(f"{investigator_prefix}development.jsonl")
    if not has_inventory_summary:
        missing_evidence.append("investigator inventory summary")
        incomplete_files.append(f"{investigator_prefix}inventory-history.jsonl")

    if missing_evidence:
        findings.append(_finding(
            "active_run_source_files_incomplete",
            "test_gap",
            f"{run_id} investigator source files lack reusable character evidence: {', '.join(missing_evidence)}.",
            "Regenerate the active run so reusable investigator source files contain creation, character, history, development, and inventory evidence before completion audit.",
            run_id=run_id,
            incomplete_files=incomplete_files,
            missing_evidence=missing_evidence,
        ))
    return findings


def _investigator_ids_from_party(party: dict[str, Any]) -> list[str]:
    investigator_ids: list[str] = []
    for key in ("active_investigator_ids", "investigator_ids"):
        values = party.get(key)
        if not isinstance(values, list):
            continue
        for value in values:
            investigator_id = str(value)
            if investigator_id and investigator_id not in investigator_ids:
                investigator_ids.append(investigator_id)
    return investigator_ids


def _active_run_source_findings(run_id: str, run_dir: Path, metadata: dict[str, Any]) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    missing_files = _missing_relative_files(run_dir, REQUIRED_RUN_SOURCE_FILES)
    empty_files = _empty_relative_files(run_dir, REQUIRED_RUN_SOURCE_FILES)
    malformed_files = _malformed_relative_files(run_dir, REQUIRED_RUN_SOURCE_FILES)

    campaign_id = str(metadata.get("campaign_id") or run_id)
    audit_profile = str(metadata.get("audit_profile") or "")
    campaign_prefix = f"sandbox/.coc/campaigns/{campaign_id}/"
    campaign_dir = run_dir / campaign_prefix
    workspace_root = run_dir / "sandbox" / ".coc"
    missing_files.extend(_missing_relative_files(
        workspace_root,
        REQUIRED_WORKSPACE_INDEX_FILES,
        display_prefix="sandbox/.coc/",
    ))
    empty_files.extend(_empty_relative_files(
        workspace_root,
        REQUIRED_WORKSPACE_INDEX_FILES,
        display_prefix="sandbox/.coc/",
    ))
    malformed_files.extend(_malformed_relative_files(
        workspace_root,
        REQUIRED_WORKSPACE_INDEX_FILES,
        display_prefix="sandbox/.coc/",
    ))
    missing_files.extend(_missing_relative_files(
        campaign_dir,
        REQUIRED_CAMPAIGN_SOURCE_FILES,
        display_prefix=campaign_prefix,
    ))
    empty_files.extend(_empty_relative_files(
        campaign_dir,
        REQUIRED_CAMPAIGN_SOURCE_FILES,
        display_prefix=campaign_prefix,
    ))
    malformed_files.extend(_malformed_relative_files(
        campaign_dir,
        REQUIRED_CAMPAIGN_SOURCE_FILES,
        display_prefix=campaign_prefix,
    ))
    required_campaign_runtime_files = [
        *REQUIRED_CAMPAIGN_SAVE_FILES,
        *REQUIRED_CAMPAIGN_INDEX_FILES,
        *PROFILE_REQUIRED_CAMPAIGN_SAVE_FILES.get(audit_profile, []),
    ]
    missing_files.extend(_missing_relative_files(
        campaign_dir,
        required_campaign_runtime_files,
        display_prefix=campaign_prefix,
    ))
    empty_files.extend(_empty_relative_files(
        campaign_dir,
        required_campaign_runtime_files,
        display_prefix=campaign_prefix,
    ))
    malformed_files.extend(_malformed_relative_files(
        campaign_dir,
        required_campaign_runtime_files,
        display_prefix=campaign_prefix,
    ))

    party = _read_json(campaign_dir / "party.json", {})
    investigator_ids = _investigator_ids_from_party(party) if isinstance(party, dict) else []
    if (campaign_dir / "party.json").exists() and not investigator_ids:
        findings.append(_finding(
            "active_run_investigator_ids_missing",
            "system_gap",
            f"{run_id} party.json does not list active or reusable investigator ids.",
            "Regenerate the run so party.json links the campaign to reusable sandbox investigator records.",
            run_id=run_id,
        ))
    if len(investigator_ids) > 1:
        findings.append(_finding(
            "active_run_party_not_single_player",
            "system_gap",
            f"{run_id} party.json lists {len(investigator_ids)} investigators; current single-player playtests must use exactly one active investigator.",
            "Regenerate the run with exactly one active investigator. Group-table support is future scope and must not satisfy the current completion gate.",
            run_id=run_id,
            investigator_ids=investigator_ids,
        ))
    findings.extend(_workspace_index_integrity_findings(run_id, run_dir, campaign_id, investigator_ids))
    findings.extend(_campaign_structure_findings(run_id, campaign_dir, campaign_prefix, audit_profile))
    findings.extend(_campaign_save_integrity_findings(run_id, run_dir, campaign_dir, campaign_prefix, investigator_ids))
    findings.extend(_source_map_integrity_findings(run_id, campaign_dir, campaign_prefix))
    findings.extend(_campaign_index_integrity_findings(run_id, campaign_dir, campaign_prefix))
    findings.extend(_rule_ref_traceability_findings(run_id, campaign_dir, campaign_prefix))
    findings.extend(_source_handout_summary_findings(run_id, campaign_dir, campaign_prefix, metadata))

    for investigator_id in investigator_ids:
        investigator_state_file = f"save/investigator-state/{investigator_id}.json"
        missing_files.extend(_missing_relative_files(
            campaign_dir,
            [investigator_state_file],
            display_prefix=campaign_prefix,
        ))
        empty_files.extend(_empty_relative_files(
            campaign_dir,
            [investigator_state_file],
            display_prefix=campaign_prefix,
        ))
        malformed_files.extend(_malformed_relative_files(
            campaign_dir,
            [investigator_state_file],
            display_prefix=campaign_prefix,
        ))
        investigator_prefix = f"sandbox/.coc/investigators/{investigator_id}/"
        investigator_dir = run_dir / investigator_prefix
        missing_files.extend(_missing_relative_files(
            investigator_dir,
            REQUIRED_INVESTIGATOR_SOURCE_FILES,
            display_prefix=investigator_prefix,
        ))
        empty_files.extend(_empty_relative_files(
            investigator_dir,
            REQUIRED_INVESTIGATOR_SOURCE_FILES,
            display_prefix=investigator_prefix,
        ))
        malformed_files.extend(_malformed_relative_files(
            investigator_dir,
            REQUIRED_INVESTIGATOR_SOURCE_FILES,
            display_prefix=investigator_prefix,
        ))
        findings.extend(_investigator_structure_findings(run_id, investigator_dir, investigator_prefix))

    if missing_files:
        findings.append(_finding(
            "active_run_source_files_missing",
            "test_gap",
            f"{run_id} missing source files: {', '.join(missing_files)}",
            "Regenerate the active run before completion audit so battle reports, audits, and semantic results are backed by current transcript, view, log, memory, campaign, and investigator source files.",
            run_id=run_id,
            missing_files=missing_files,
        ))
    if empty_files:
        findings.append(_finding(
            "active_run_source_files_empty",
            "test_gap",
            f"{run_id} empty source files: {', '.join(empty_files)}",
            "Regenerate the active run before completion audit so required transcript, view, log, memory, campaign, and investigator source files contain structured actual-play evidence.",
            run_id=run_id,
            empty_files=empty_files,
        ))
    if malformed_files:
        findings.append(_finding(
            "active_run_source_files_malformed",
            "test_gap",
            f"{run_id} malformed source files: {', '.join(malformed_files)}",
            "Regenerate the active run before completion audit so required JSON and JSONL source files parse as structured objects.",
            run_id=run_id,
            malformed_files=malformed_files,
        ))
    findings.extend(_source_structure_findings(run_id, run_dir))
    findings.extend(_player_view_public_state_findings(run_id, run_dir, metadata))
    findings.extend(_player_view_current_state_findings(run_id, run_dir, campaign_dir, campaign_prefix, investigator_ids, metadata))
    findings.extend(_player_view_speaker_findings(run_id, run_dir, metadata))
    findings.extend(_player_profile_display_findings(run_id, run_dir, metadata))
    findings.extend(_player_view_localized_text_findings(run_id, run_dir, metadata))
    findings.extend(_transcript_localized_text_findings(run_id, run_dir, metadata))
    findings.extend(_transcript_source_text_findings(run_id, run_dir, metadata))
    findings.extend(_player_view_protocol_wrapper_findings(run_id, run_dir, metadata))
    findings.extend(_player_view_spoiler_protocol_findings(run_id, run_dir))
    findings.extend(_player_view_transcript_detail_findings(run_id, run_dir, metadata))
    findings.extend(_player_view_roll_text_findings(run_id, run_dir, campaign_dir, metadata))
    findings.extend(_transcript_display_findings(run_id, run_dir, campaign_dir, metadata))
    findings.extend(_pushed_roll_structure_findings(run_id, run_dir, campaign_dir, campaign_prefix, audit_profile))
    findings.extend(_multi_profile_structure_findings(run_id, run_dir, audit_profile))
    findings.extend(_meta_game_structure_findings(run_id, run_dir, audit_profile))
    findings.extend(_spoiler_reveal_structure_findings(run_id, run_dir, campaign_dir, campaign_prefix, audit_profile))
    return findings


def _run_artifact_findings(root: Path, run: dict[str, Any]) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    run_id = str(run.get("run_id"))
    run_dir = _opened_run_path(root, run)
    metadata = _read_json(run_dir / "playtest.json", {})
    artifacts_dir = run_dir / "artifacts"
    campaign_id = str(metadata.get("campaign_id") or run_id)
    campaign_dir = run_dir / f"sandbox/.coc/campaigns/{campaign_id}/"
    findings.extend(_active_run_source_findings(run_id, run_dir, metadata))

    if run.get("audit_result") != "PASS":
        findings.append(_finding(
            "active_run_audit_not_pass",
            "test_gap",
            f"{run_id} audit_result={run.get('audit_result')}",
            "Regenerate the run and fix rulebook-audit findings before completion audit.",
            run_id=run_id,
        ))

    missing_artifacts = [name for name in REQUIRED_ARTIFACTS if not (artifacts_dir / name).exists()]
    if missing_artifacts:
        findings.append(_finding(
            "active_run_artifacts_missing",
            "report_gap",
            f"{run_id} missing artifacts: {', '.join(missing_artifacts)}",
            "Regenerate battle, evaluation, rulebook audit, and semantic evaluation artifacts.",
            run_id=run_id,
            missing_artifacts=missing_artifacts,
        ))

    play_language = str(metadata.get("play_language") or "")
    if not play_language:
        findings.append(_finding(
            "play_language_missing",
            "system_gap",
            f"{run_id} does not contain play_language.",
            "Persist the selected play_language; default it to zh-Hans unless the player explicitly chose another language.",
            run_id=run_id,
        ))
    language_profile = metadata.get("language_profile")
    if not isinstance(language_profile, dict) or not language_profile:
        findings.append(_finding(
            "language_profile_missing",
            "system_gap",
            f"{run_id} does not contain language_profile.",
            "Persist language_profile with output instruction, name policy, term policy, and report labels for the selected play_language.",
            run_id=run_id,
        ))
    elif language_profile.get("language") != play_language:
        findings.append(_finding(
            "language_profile_mismatch",
            "system_gap",
            f"{run_id} language_profile.language={language_profile.get('language')} play_language={play_language}",
            "Regenerate the run so language_profile.language matches play_language.",
            run_id=run_id,
        ))
    elif f"localized_terms.{play_language}" not in str(language_profile.get("term_policy", "")):
        findings.append(_finding(
            "language_profile_term_policy_missing",
            "system_gap",
            f"{run_id} term_policy={language_profile.get('term_policy')}",
            "Record a term_policy that explicitly points to the selected language localized_terms map.",
            run_id=run_id,
        ))
    localized_terms = metadata.get("localized_terms", {})
    if not isinstance(localized_terms, dict) or not localized_terms.get(play_language):
        findings.append(_finding(
            "localized_terms_missing",
            "system_gap",
            f"{run_id} does not contain localized_terms.{play_language}.",
            "Persist localized_terms for the selected play language.",
            run_id=run_id,
        ))

    battle_report = _read_text(artifacts_dir / "battle-report.md")
    findings.extend(_battle_report_anchor_findings(run_id, battle_report))
    findings.extend(_battle_report_field_anchor_findings(run_id, battle_report))
    findings.extend(_battle_report_field_value_findings(run_id, campaign_dir, metadata, battle_report))
    findings.extend(_battle_report_source_dialogue_findings(run_id, run_dir, battle_report))
    findings.extend(_battle_report_source_dialogue_speaker_findings(run_id, run_dir, metadata, battle_report))
    findings.extend(_battle_report_source_dialogue_order_findings(run_id, run_dir, metadata, battle_report))
    findings.extend(_battle_report_mechanical_log_findings(run_id, run_dir, campaign_dir, metadata, battle_report))
    findings.extend(_battle_report_rule_ref_findings(run_id, campaign_dir, battle_report))
    findings.extend(_battle_report_event_summary_findings(run_id, campaign_dir, battle_report))
    findings.extend(_battle_report_feedback_text_findings(run_id, run_dir, battle_report))
    findings.extend(_battle_report_feedback_score_findings(run_id, run_dir, battle_report))
    findings.extend(_battle_report_feedback_binding_findings(run_id, run_dir, metadata, battle_report))
    findings.extend(_battle_report_memory_summary_findings(run_id, campaign_dir, battle_report))
    findings.extend(_battle_report_handout_findings(
        run_id,
        campaign_dir,
        metadata,
        battle_report,
    ))
    findings.extend(_battle_report_investigator_creation_findings(
        run_id,
        run_dir,
        campaign_dir,
        metadata,
        battle_report,
    ))
    findings.extend(_battle_report_character_dossier_findings(
        run_id,
        run_dir,
        campaign_dir,
        metadata,
        battle_report,
    ))
    findings.extend(_battle_report_chase_tracker_findings(
        run_id,
        campaign_dir,
        metadata,
        battle_report,
    ))
    findings.extend(_chase_transcript_position_findings(
        run_id,
        run_dir,
        campaign_dir,
        metadata,
        battle_report,
    ))
    findings.extend(_battle_report_investigator_chronicle_findings(
        run_id,
        run_dir,
        campaign_dir,
        metadata,
        battle_report,
    ))

    rulebook_audit = _read_text(artifacts_dir / "rulebook-audit.md")
    findings.extend(_rulebook_audit_section_findings(run_id, rulebook_audit))
    findings.extend(_rulebook_audit_result_findings(run_id, rulebook_audit))
    findings.extend(_rulebook_audit_positive_evidence_findings(run_id, run_dir, campaign_dir, metadata, rulebook_audit))

    evaluation_report = _read_text(artifacts_dir / "evaluation-report.md")
    findings.extend(_evaluation_report_section_findings(run_id, evaluation_report))
    findings.extend(_evaluation_report_result_findings(run_id, evaluation_report))
    findings.extend(_evaluation_report_evidence_findings(run_id, run_dir, evaluation_report))

    semantic_request = _read_json(artifacts_dir / "semantic-eval-request.json", {})
    semantic = _read_json(artifacts_dir / "semantic-eval-result.json", {})
    if semantic:
        findings.extend(_semantic_request_contract_findings(run_id, semantic_request))
        missing_required_fields = [
            field
            for field in ("root_cause_classification", "next_loop_fix_target")
            if field not in semantic
        ]
        if missing_required_fields:
            findings.append(_finding(
                "semantic_required_field_missing",
                "test_gap",
                f"{run_id} semantic-eval-result.json missing fields: {', '.join(missing_required_fields)}.",
                "Regenerate semantic-eval-result.json with all required loop fields.",
                run_id=run_id,
                missing_fields=missing_required_fields,
            ))
        if "root_cause_classification" in semantic and not isinstance(semantic.get("root_cause_classification"), list):
            findings.append(_finding(
                "semantic_required_field_invalid",
                "test_gap",
                f"{run_id} root_cause_classification is not a list.",
                "Regenerate semantic-eval-result.json so root_cause_classification is a list of root-cause labels.",
                run_id=run_id,
                key="root_cause_classification",
            ))
        if (
            "next_loop_fix_target" in semantic
            and (
                not isinstance(semantic.get("next_loop_fix_target"), str)
                or not semantic.get("next_loop_fix_target")
            )
        ):
            findings.append(_finding(
                "semantic_required_field_invalid",
                "test_gap",
                f"{run_id} next_loop_fix_target is not a non-empty string.",
                "Regenerate semantic-eval-result.json so next_loop_fix_target names the next loop action or none.",
                run_id=run_id,
                key="next_loop_fix_target",
            ))
        if semantic.get("evaluator_id") != "codex-llm-semantic-v1":
            findings.append(_finding(
                "semantic_evaluator_unexpected",
                "test_gap",
                f"{run_id} evaluator_id={semantic.get('evaluator_id')}",
                "Use the LLM semantic evaluator artifact for completion-oriented suites.",
                run_id=run_id,
            ))
        if not isinstance(semantic.get("coverage"), dict) or not semantic.get("coverage"):
            findings.append(_finding(
                "semantic_coverage_missing",
                "test_gap",
                f"{run_id} semantic-eval-result.json does not contain a coverage object.",
                "Regenerate semantic-eval-result.json with structured coverage dimensions.",
                run_id=run_id,
            ))
        else:
            for dimension in REQUIRED_COVERAGE_DIMENSIONS:
                coverage_value = semantic["coverage"].get(dimension)
                if not isinstance(coverage_value, dict):
                    findings.append(_finding(
                        "semantic_coverage_dimension_invalid",
                        "test_gap",
                        f"{run_id} coverage.{dimension} is missing or not an object.",
                        "Regenerate semantic-eval-result.json so each coverage dimension has covered and reason.",
                        run_id=run_id,
                        key=dimension,
                    ))
                    continue
                missing_fields = [
                    field
                    for field in ("covered", "reason")
                    if field not in coverage_value
                ]
                if missing_fields:
                    findings.append(_finding(
                        "semantic_coverage_dimension_invalid",
                        "test_gap",
                        f"{run_id} coverage.{dimension} missing fields: {', '.join(missing_fields)}.",
                        "Regenerate semantic-eval-result.json so each coverage dimension has covered and reason.",
                        run_id=run_id,
                        key=dimension,
                        missing_fields=missing_fields,
                    ))
                    continue
                if not isinstance(coverage_value.get("covered"), bool):
                    findings.append(_finding(
                        "semantic_coverage_dimension_invalid",
                        "test_gap",
                        f"{run_id} coverage.{dimension}.covered is not a boolean.",
                        "Regenerate semantic-eval-result.json so each coverage dimension has covered and reason.",
                        run_id=run_id,
                        key=dimension,
                    ))
                if not _has_non_empty_reason(coverage_value):
                    findings.append(_finding(
                        "semantic_coverage_dimension_invalid",
                        "test_gap",
                        f"{run_id} coverage.{dimension}.reason is not a non-empty string.",
                        "Regenerate semantic-eval-result.json so each coverage dimension has a non-empty reason.",
                        run_id=run_id,
                        key=dimension,
                    ))
        if not isinstance(semantic.get("quality"), dict) or not semantic.get("quality"):
            findings.append(_finding(
                "semantic_quality_missing",
                "test_gap",
                f"{run_id} semantic-eval-result.json does not contain a quality object.",
                "Regenerate semantic-eval-result.json with structured quality dimensions.",
                run_id=run_id,
            ))
        else:
            for dimension in REQUIRED_QUALITY_DIMENSIONS:
                quality_value = semantic["quality"].get(dimension)
                if not isinstance(quality_value, dict):
                    findings.append(_finding(
                        "semantic_quality_dimension_invalid",
                        "test_gap",
                        f"{run_id} quality.{dimension} is missing or not an object.",
                        "Regenerate semantic-eval-result.json so each quality dimension has score, passed, and reason.",
                        run_id=run_id,
                        key=dimension,
                    ))
                    continue
                missing_fields = [
                    field
                    for field in ("score", "passed", "reason")
                    if field not in quality_value
                ]
                if missing_fields:
                    findings.append(_finding(
                        "semantic_quality_dimension_invalid",
                        "test_gap",
                        f"{run_id} quality.{dimension} missing fields: {', '.join(missing_fields)}.",
                        "Regenerate semantic-eval-result.json so each quality dimension has score, passed, and reason.",
                        run_id=run_id,
                        key=dimension,
                        missing_fields=missing_fields,
                    ))
                    continue
                if not isinstance(quality_value.get("passed"), bool):
                    findings.append(_finding(
                        "semantic_quality_dimension_invalid",
                        "test_gap",
                        f"{run_id} quality.{dimension}.passed is not a boolean.",
                        "Regenerate semantic-eval-result.json so each quality dimension has score, passed, and reason.",
                        run_id=run_id,
                        key=dimension,
                    ))
                if not _has_non_empty_reason(quality_value):
                    findings.append(_finding(
                        "semantic_quality_dimension_invalid",
                        "test_gap",
                        f"{run_id} quality.{dimension}.reason is not a non-empty string.",
                        "Regenerate semantic-eval-result.json so each quality dimension has a non-empty reason.",
                        run_id=run_id,
                        key=dimension,
                    ))
        provenance = semantic.get("evaluation_provenance")
        if not isinstance(provenance, dict) or not provenance:
            findings.append(_finding(
                "semantic_provenance_missing",
                "test_gap",
                f"{run_id} semantic-eval-result.json does not contain evaluation_provenance.",
                "Have an LLM semantic evaluator fill semantic-eval-result.json from the matching semantic-eval-request.json and record provenance.",
                run_id=run_id,
            ))
        elif provenance.get("kind") != "llm":
            findings.append(_finding(
                "semantic_provenance_not_llm",
                "test_gap",
                f"{run_id} evaluation_provenance.kind={provenance.get('kind')}",
                "Completion-oriented semantic artifacts must be produced by an LLM semantic evaluator, not a deterministic harness fixture.",
                run_id=run_id,
            ))
        elif not semantic_request:
            findings.append(_finding(
                "semantic_request_missing",
                "test_gap",
                f"{run_id} semantic-eval-request.json is missing or empty.",
                "Write the semantic evaluation request before accepting a semantic result.",
                run_id=run_id,
            ))
        elif provenance.get("reviewed_artifact") != "artifacts/semantic-eval-request.json":
            findings.append(_finding(
                "semantic_reviewed_artifact_mismatch",
                "test_gap",
                f"{run_id} evaluation_provenance.reviewed_artifact={provenance.get('reviewed_artifact')}",
                "Regenerate semantic-eval-result.json so evaluation_provenance.reviewed_artifact points to artifacts/semantic-eval-request.json.",
                run_id=run_id,
                expected_reviewed_artifact="artifacts/semantic-eval-request.json",
                actual_reviewed_artifact=provenance.get("reviewed_artifact"),
            ))
        elif provenance.get("request_sha256") != _json_sha256(semantic_request):
            findings.append(_finding(
                "semantic_request_hash_mismatch",
                "test_gap",
                f"{run_id} request_sha256 does not match semantic-eval-request.json.",
                "Regenerate semantic-eval-request.json and have the LLM evaluator refill semantic-eval-result.json from that exact request.",
                run_id=run_id,
            ))

    return findings


def _suite_findings(
    index: dict[str, Any],
    loop_decision: dict[str, Any],
    active_runs: list[dict[str, Any]],
    suite_report: str,
) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    findings.extend(_suite_report_section_findings(suite_report))
    if loop_decision.get("status") != "ready_for_completion_audit":
        findings.append(_finding(
            "loop_not_ready_for_completion_audit",
            "test_gap",
            f"loop status={loop_decision.get('status')}",
            "Fix loop-decision blockers before running completion audit.",
        ))
    if loop_decision.get("blockers"):
        findings.append(_finding(
            "loop_blockers_present",
            "test_gap",
            f"blockers={loop_decision.get('blockers')}",
            "Resolve loop-decision blockers and rerun the suite.",
        ))
    if index.get("gaps"):
        findings.append(_finding(
            "coverage_gap",
            "test_gap",
            f"coverage gaps={index.get('gaps')}",
            "Add or repair active runs so the semantic coverage matrix has no gaps.",
        ))
    findings.extend(_suite_matrix_non_evaluated_run_findings(index, loop_decision))
    for dimension in REQUIRED_COVERAGE_DIMENSIONS:
        coverage_entry = index.get("coverage", {}).get(dimension)
        if not coverage_entry or coverage_entry.get("status") != "covered":
            findings.append(_finding(
                "required_coverage_not_covered",
                "test_gap",
                f"{dimension} status={coverage_entry.get('status') if coverage_entry else 'missing'}",
                "Use semantic artifacts to prove every required core coverage dimension is covered.",
                key=dimension,
            ))
    for gap in index.get("quality_gaps", []):
        findings.append(_finding(
            "quality_gap",
            "test_gap",
            f"quality gap={gap}",
            "Inspect semantic quality reasons and improve the playtest loop.",
            key=gap,
        ))

    required_profiles = _required_profiles(active_runs)
    for profile, run_id in required_profiles.items():
        if run_id is None:
            findings.append(_finding(
                "required_profile_missing",
                "test_gap",
                f"Missing active audit_profile={profile}",
                "Add an active passing run for each completion-required audit profile.",
                audit_profile=profile,
            ))

    for dimension in REQUIRED_QUALITY_DIMENSIONS:
        quality_entry = index.get("quality", {}).get(dimension)
        if not quality_entry or quality_entry.get("status") != "passed":
            findings.append(_finding(
                "required_quality_not_passed",
                "test_gap",
                f"{dimension} status={quality_entry.get('status') if quality_entry else 'missing'}",
                "Use semantic artifacts to prove every required quality dimension is table-ready.",
                key=dimension,
            ))
    return findings


def _suite_matrix_non_evaluated_run_findings(
    index: dict[str, Any],
    loop_decision: dict[str, Any],
) -> list[dict[str, Any]]:
    evaluated_ids = {
        str(run_id)
        for run_id in loop_decision.get("evaluated_runs", [])
    }
    findings: list[dict[str, Any]] = []
    for matrix_name, matrix in (("coverage", index.get("coverage", {})), ("quality", index.get("quality", {}))):
        if not isinstance(matrix, dict):
            continue
        for key, entry in matrix.items():
            runs = entry.get("runs") if isinstance(entry, dict) else []
            if not isinstance(runs, list):
                continue
            non_evaluated_runs = [
                str(run_id)
                for run_id in runs
                if str(run_id) not in evaluated_ids
            ]
            if not non_evaluated_runs:
                continue
            findings.append(_finding(
                "suite_matrix_references_non_evaluated_run",
                "test_gap",
                f"{matrix_name} matrix {key} references non-evaluated run(s): {', '.join(non_evaluated_runs)}.",
                "Regenerate suite-report.md and index.json so coverage and quality matrices use only loop_decision.evaluated_runs.",
                matrix=matrix_name,
                key=str(key),
                non_evaluated_runs=non_evaluated_runs,
                evaluated_runs=sorted(evaluated_ids),
            ))
    return findings


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


def _write_markdown(path: Path, audit: dict[str, Any]) -> None:
    result_label = "PASS" if audit["result"] == "pass" else "FAIL"
    lines = [
        "# COC Keeper Completion Audit",
        "",
        "## Overall Result",
        result_label,
        "",
        "## Active Runs",
        *[f"- {run_id}" for run_id in audit["active_runs"]],
        "",
        "## Optional Evidence Runs",
        *(
            [f"- {run_id}" for run_id in audit.get("optional_evidence_runs", [])]
            or ["- none"]
        ),
        "",
        "## Required Profiles",
    ]
    for profile, run_id in audit["required_profiles"].items():
        lines.append(f"- {profile}: {run_id or 'missing'}")
    lines.extend(["", "## Required Quality"])
    for key, status in audit["required_quality"].items():
        lines.append(f"- {key}: {status}")
    goal_gate = audit["goal_completion_gate"]
    lines.extend([
        "",
        "## Goal Completion Gate",
        f"- Thread goal: {goal_gate['status']}",
        f"- Completion signal: {goal_gate['completion_signal']}",
        f"- Reason: {goal_gate['reason']}",
        f"- Required next step: {goal_gate['required_next_step']}",
    ])
    lines.extend([
        "",
        "## Monitor",
        f"- Monitor: {audit['monitor']['status']}",
        f"- Path: {audit['monitor']['path']}",
        "",
        "## Findings",
    ])
    if audit["findings"]:
        for finding in audit["findings"]:
            lines.append(f"- {finding['code']} [{finding['cause']}]: {finding['evidence']}")
            lines.append(f"  - Recommendation: {finding['recommendation']}")
    else:
        lines.append("- No findings.")
    eval_contract = audit.get("eval_contract_coverage")
    if isinstance(eval_contract, dict):
        gaps = eval_contract.get("gaps") if isinstance(eval_contract.get("gaps"), dict) else {}
        lines.extend([
            "",
            "## Eval Contract Coverage",
            f"- Status: {eval_contract.get('status', 'NOT_RUN')}",
            f"- Historical profiles satisfy release: {eval_contract.get('historical_profiles_satisfy_release', False)}",
            f"- Case gaps: {', '.join(str(item) for item in gaps.get('case_ids', [])) or 'none'}",
            f"- Persona gaps: {', '.join(str(item) for item in gaps.get('persona_ids', [])) or 'none'}",
            f"- Seed gaps: {', '.join(str(item) for item in gaps.get('seeds', [])) or 'none'}",
            (
                "- Missing capabilities: "
                + (
                    ", ".join(str(item) for item in gaps.get("missing_capabilities", []))
                    or "none"
                )
            ),
        ])
    lines.extend([
        "",
        "## Next Action",
        audit["next_action"],
        "",
    ])
    path.write_text("\n".join(lines), encoding="utf-8")


def generate_completion_audit(root: Path, automation_path: Path | None = None) -> Path:
    base = _playtests_dir(root)
    index = _read_json(base / "index.json", {})
    loop_decision = _read_json(base / "loop-decision.json", {})
    active_runs = _active_runs(root, index, loop_decision)
    findings = _suite_findings(index, loop_decision, active_runs, _read_text(base / "suite-report.md"))
    findings.extend(_rules_json_validation_findings(root))
    findings.extend(_active_evaluator_note_findings(root, active_runs))
    findings.extend(_semantic_support_findings(root, index, active_runs))
    for run in active_runs:
        findings.extend(_run_artifact_findings(root, run))

    monitor_status, monitor_path = _monitor_status(automation_path)
    if monitor_status != "ACTIVE":
        findings.append(_finding(
            "monitor_not_active",
            "system_gap",
            f"monitor status={monitor_status}; path={monitor_path}",
            "Keep the COC Keeper watchdog automation active and aligned with current completion requirements.",
        ))

    required_quality = {
        key: index.get("quality", {}).get(key, {}).get("status", "missing")
        for key in REQUIRED_QUALITY_DIMENSIONS
    }
    goal_completion_gate = {
        "status": "not_complete",
        "completion_signal": "artifact_audit_only",
        "reason": (
            "A PASS result means the current playtest artifacts have no artifact-level blockers; "
            "it does not mark the Codex thread goal complete."
        ),
        "required_next_step": "Keep the watchdog goal active until full thread-level completion evidence is satisfied.",
    }
    audit = {
        "schema_version": 1,
        "result": "fail" if findings else "pass",
        "active_runs": [str(run.get("run_id")) for run in active_runs],
        "optional_evidence_runs": [
            str(run_id)
            for run_id in loop_decision.get("optional_evidence_runs", [])
        ],
        "required_profiles": _required_profiles(active_runs),
        "required_quality": required_quality,
        "goal_completion_gate": goal_completion_gate,
        "monitor": {"status": monitor_status, "path": monitor_path},
        "findings": findings,
        "next_action": (
            "Continue the playtest loop by fixing the first finding."
            if findings
            else "No artifact-level completion blockers found; retain goal active unless the full thread-level completion audit is also satisfied."
        ),
    }
    # Eval-contract coverage is additive: historical profile PASS remains
    # distinct from versioned release/nightly readiness.
    eval_root = root
    if (root / BENCHMARK_MANIFEST_REL).is_file():
        try:
            matrix_results = None
            matrix_path = _playtests_dir(root) / "matrix-results.json"
            if matrix_path.is_file():
                loaded = _read_json(matrix_path, None)
                if isinstance(loaded, dict):
                    matrix_results = loaded
            eval_contract = assess_eval_contract_coverage(
                eval_root,
                suite="release",
                matrix_results=matrix_results,
                historical_profiles=audit["required_profiles"],
            )
            audit["eval_contract_coverage"] = eval_contract
        except (OSError, ValueError, TypeError, KeyError) as exc:
            audit["eval_contract_coverage"] = {
                "schema_version": 1,
                "status": "NOT_RUN",
                "gaps": {
                    "case_ids": [],
                    "persona_ids": [],
                    "seeds": [],
                    "missing_capabilities": [],
                },
                "reason": f"eval contract assessment unavailable: {exc}",
                "historical_profiles_satisfy_release": False,
            }
    if isinstance(active_runs, _RetainedActiveRuns):
        active_runs.close()
    json_path = base / "completion-audit.json"
    markdown_path = base / "completion-audit.md"
    _write_json(json_path, audit)
    _write_markdown(markdown_path, audit)
    return markdown_path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=".")
    parser.add_argument("--automation-path")
    args = parser.parse_args()
    automation_path = Path(args.automation_path) if args.automation_path else None
    print(generate_completion_audit(Path(args.root), automation_path=automation_path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
