#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any


REQUIRED_AUDIT_PROFILES = ["haunting_module", "chase_drill", "multi_profile_pressure"]
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
    "logs/rolls.jsonl",
    "logs/events.jsonl",
    "memory/session-summaries.jsonl",
]
REQUIRED_INVESTIGATOR_SOURCE_FILES = [
    "creation.json",
    "character.json",
    "history.jsonl",
    "development.jsonl",
    "inventory-history.jsonl",
]
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
    "chinese_visible_dialogue",
    "actual_play_replay",
    "state_continuity",
    "spoiler_safety",
    "player_agency",
    "virtual_player_pressure",
    "report_completeness",
]
PROFILE_EVENT_TYPE_REQUIREMENTS = {
    "haunting_module": ["combat", "sanity", "status", "session_ending"],
    "chase_drill": ["chase", "status", "session_ending"],
    "multi_profile_pressure": ["decision", "status", "session_ending"],
}
PUSHED_ROLL_REQUIRED_PROFILES = {"haunting_module", "chase_drill", "multi_profile_pressure"}
PUSHED_ROLL_PROTOCOL_STAGES = [
    "player_reframes_action",
    "keeper_foreshadows_failure",
    "player_confirms_risk",
    "roll_resolved",
]
MULTI_PROFILE_SOURCE_REQUIREMENTS = {
    "multi_profile_pressure": ["careful_investigator", "reckless_investigator", "skeptical_rules_lawyer"],
}
META_GAME_REQUIRED_PROFILES = {"haunting_module", "chase_drill", "multi_profile_pressure"}
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
REQUIRED_BATTLE_REPORT_ANCHORS = [
    "Battle Report",
    "Run Setup",
    "Module",
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
REQUIRED_SUITE_REPORT_SECTIONS = [
    "# COC Playtest Suite Report",
    "## Run Index",
    "## Non-Passing Runs",
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


def _localize_text(text: str, localized_terms: dict[str, str]) -> str:
    localized = text
    for canonical, display in sorted(localized_terms.items(), key=lambda item: len(item[0]), reverse=True):
        localized = localized.replace(canonical, display)
    return CJK_BOUNDARY_SPACE.sub("", localized)


def _text_rendered_in_report(text: str, battle_report: str, localized_terms: dict[str, str]) -> bool:
    candidates = {text, _localize_text(text, localized_terms)}
    return any(candidate and candidate in battle_report for candidate in candidates)


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


def _active_runs(index: dict[str, Any], loop_decision: dict[str, Any]) -> list[dict[str, Any]]:
    active_ids = set(loop_decision.get("evaluated_runs", []))
    return [run for run in index.get("runs", []) if run.get("run_id") in active_ids]


def _required_profiles(active_runs: list[dict[str, Any]]) -> dict[str, str | None]:
    profiles: dict[str, str | None] = {profile: None for profile in REQUIRED_AUDIT_PROFILES}
    for run in active_runs:
        audit_profile = run.get("audit_profile")
        if audit_profile in profiles and profiles[audit_profile] is None:
            profiles[audit_profile] = str(run.get("run_id"))
    return profiles


def _monitor_status(automation_path: Path | None) -> tuple[str, str]:
    if automation_path is None:
        automation_path = Path.home() / ".codex" / "automations" / "coc-keeper" / "automation.toml"
    text = _read_text(automation_path)
    if not text:
        return "missing", str(automation_path)
    if 'status = "ACTIVE"' in text and "multi-profile virtual player pressure" in text:
        return "ACTIVE", str(automation_path)
    if 'status = "ACTIVE"' in text:
        return "active_without_latest_prompt", str(automation_path)
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


def _battle_report_source_dialogue_findings(run_id: str, run_dir: Path, battle_report: str) -> list[dict[str, Any]]:
    replay_sections = "\n".join([
        _battle_report_anchor_section(battle_report, "Actual Play Replay"),
        _battle_report_anchor_section(battle_report, "Session Transcript"),
    ])
    transcript = _read_jsonl(run_dir / "transcript.jsonl")
    required_dialogue = [
        row["text"].strip()
        for row in transcript
        if row.get("role") != "system"
        and isinstance(row.get("text"), str)
        and row["text"].strip()
    ]
    missing_dialogue = [
        text
        for text in required_dialogue
        if text not in replay_sections
    ]
    if not missing_dialogue:
        return []
    return [_finding(
        "battle_report_source_dialogue_missing",
        "report_gap",
        f"{run_id} battle-report.md omits {len(missing_dialogue)} of {len(required_dialogue)} source dialogue turns from transcript.jsonl.",
        "Regenerate battle-report.md so Actual Play Replay or Session Transcript renders the visible non-system transcript source text.",
        run_id=run_id,
        missing_dialogue_count=len(missing_dialogue),
        required_dialogue_count=len(required_dialogue),
        missing_dialogue_samples=missing_dialogue[:5],
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
    skill = payload.get("skill", "check")
    actor = row.get("actor", "unknown")
    return f"{skill}: {actor} rolled {roll} vs {target} -> {outcome}"


def _battle_report_mechanical_log_findings(
    run_id: str,
    campaign_dir: Path,
    battle_report: str,
) -> list[dict[str, Any]]:
    rolls = _read_jsonl(campaign_dir / "logs" / "rolls.jsonl")
    required_roll_lines = [
        line
        for row in rolls
        for line in [_mechanical_roll_line(row)]
        if line
    ]
    missing_roll_lines = [
        line
        for line in required_roll_lines
        if line not in battle_report
    ]
    if not missing_roll_lines:
        return []
    return [_finding(
        "battle_report_mechanical_log_missing",
        "report_gap",
        f"{run_id} battle-report.md omits {len(missing_roll_lines)} of {len(required_roll_lines)} source mechanical roll lines from logs/rolls.jsonl.",
        "Regenerate battle-report.md so Mechanical Log renders each structured source roll with skill, actor, roll, target, and outcome.",
        run_id=run_id,
        missing_roll_count=len(missing_roll_lines),
        required_roll_count=len(required_roll_lines),
        missing_roll_samples=missing_roll_lines[:5],
    )]


def _battle_report_event_summary_findings(
    run_id: str,
    campaign_dir: Path,
    battle_report: str,
) -> list[dict[str, Any]]:
    events = _read_jsonl(campaign_dir / "logs" / "events.jsonl")
    required_summaries = [
        row["payload"]["summary"].strip()
        for row in events
        if isinstance(row.get("payload"), dict)
        and isinstance(row["payload"].get("summary"), str)
        and row["payload"]["summary"].strip()
    ]
    missing_summaries = [
        summary
        for summary in required_summaries
        if summary not in battle_report
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
    feedback = _read_jsonl(run_dir / "player-feedback.jsonl")
    required_feedback = [
        row["text"].strip()
        for row in feedback
        if isinstance(row.get("text"), str)
        and row["text"].strip()
    ]
    missing_feedback = [
        text
        for text in required_feedback
        if text not in battle_report
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


def _battle_report_memory_summary_findings(
    run_id: str,
    campaign_dir: Path,
    battle_report: str,
) -> list[dict[str, Any]]:
    memories = _read_jsonl(campaign_dir / "memory" / "session-summaries.jsonl")
    required_summaries = [
        row["summary"].strip()
        for row in memories
        if isinstance(row.get("summary"), str)
        and row["summary"].strip()
    ]
    missing_summaries = [
        summary
        for summary in required_summaries
        if summary not in battle_report
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

    allocation = creation.get("skill_allocation", {})
    if isinstance(allocation, dict) and allocation:
        occupation_label = _creation_label(metadata, "Occupation")
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
            for skill, entry in skills.items():
                if not isinstance(entry, dict):
                    continue
                if entry.get("final") in (None, "", [], {}):
                    continue
                display_skill = _localize_text(str(skill), localized_terms)
                required_texts.append(
                    f"{display_skill}: base {entry.get('base', '?')} + "
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
        if not _text_rendered_in_report(text, battle_report, localized_terms)
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
        missing_creation_samples=missing_texts[:15],
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


def _chase_tracker_label(metadata: dict[str, Any], canonical: str) -> str:
    return _profile_label(metadata, "chase_tracker_labels", canonical)


def _chase_tracker_value(value: Any, metadata: dict[str, Any], localized_terms: dict[str, str]) -> str:
    value_text = str(value)
    localized = _chase_tracker_label(metadata, value_text)
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
    candidates = {text, _localize_text(text, localized_terms), _chase_tracker_value(text, metadata, localized_terms)}
    return any(candidate and candidate in battle_report for candidate in candidates)


def _battle_report_chase_tracker_findings(
    run_id: str,
    campaign_dir: Path,
    metadata: dict[str, Any],
    battle_report: str,
) -> list[dict[str, Any]]:
    chase_state = _read_json(campaign_dir / "save" / "chase.json", {})
    if not isinstance(chase_state, dict) or not chase_state:
        return []
    localized_terms = _metadata_localized_terms(metadata)
    required_texts = _chase_tracker_required_texts(chase_state, metadata)
    missing_texts = [
        text
        for text in required_texts
        if not _chase_tracker_text_rendered(text, battle_report, metadata, localized_terms)
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
        if not _text_rendered_in_report(text, battle_report, localized_terms)
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

    if not any((missing_fields, invalid_fields, missing_coverage_keys, missing_quality_keys, missing_expected_fields)):
        return []
    return [_finding(
        "semantic_request_contract_invalid",
        "test_gap",
        f"{run_id} semantic-eval-request.json does not expose the full LLM evaluator contract.",
        "Regenerate semantic-eval-request.json with coverage_keys, quality_dimensions, and expected_output_schema.required before accepting semantic results.",
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
        semantic = _read_json(_playtests_dir(root) / run_id / "artifacts" / "semantic-eval-result.json", {})
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
                if not isinstance(payload, dict):
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
    for roll_id in complete_roll_ids:
        stages = [
            row["pushed_roll_protocol"].get("stage")
            for row in transcript
            if isinstance(row.get("pushed_roll_protocol"), dict)
            and row["pushed_roll_protocol"].get("roll_id") == roll_id
        ]
        stage_index = 0
        for stage in stages:
            if stage_index < len(PUSHED_ROLL_PROTOCOL_STAGES) and stage == PUSHED_ROLL_PROTOCOL_STAGES[stage_index]:
                stage_index += 1
        if stage_index == len(PUSHED_ROLL_PROTOCOL_STAGES):
            transcript_roll_ids.add(roll_id)

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
    for profile in missing_transcript_profiles:
        missing_evidence.append(f"{audit_profile} transcript profile {profile}")
    for profile in missing_feedback_profiles:
        missing_evidence.append(f"{audit_profile} feedback profile {profile}")
    if missing_transcript_profiles:
        incomplete_files.append("transcript.jsonl")
    if missing_feedback_profiles:
        incomplete_files.append("player-feedback.jsonl")

    if not missing_evidence:
        return []
    return [_finding(
        "active_run_source_files_incomplete",
        "test_gap",
        f"{run_id} multi-profile source files lack required player profiles: {', '.join(missing_evidence)}.",
        "Regenerate the active run so multi-profile pressure transcripts and feedback include each required player_profile enum with visible text.",
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
    findings.extend(_campaign_structure_findings(run_id, campaign_dir, campaign_prefix, audit_profile))

    for investigator_id in investigator_ids:
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
    findings.extend(_pushed_roll_structure_findings(run_id, run_dir, campaign_dir, campaign_prefix, audit_profile))
    findings.extend(_multi_profile_structure_findings(run_id, run_dir, audit_profile))
    findings.extend(_meta_game_structure_findings(run_id, run_dir, audit_profile))
    return findings


def _run_artifact_findings(root: Path, run: dict[str, Any]) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    run_id = str(run.get("run_id"))
    run_dir = _playtests_dir(root) / run_id
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
    findings.extend(_battle_report_source_dialogue_findings(run_id, run_dir, battle_report))
    findings.extend(_battle_report_mechanical_log_findings(run_id, campaign_dir, battle_report))
    findings.extend(_battle_report_event_summary_findings(run_id, campaign_dir, battle_report))
    findings.extend(_battle_report_feedback_text_findings(run_id, run_dir, battle_report))
    findings.extend(_battle_report_memory_summary_findings(run_id, campaign_dir, battle_report))
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
        "## Required Profiles",
    ]
    for profile, run_id in audit["required_profiles"].items():
        lines.append(f"- {profile}: {run_id or 'missing'}")
    lines.extend(["", "## Required Quality"])
    for key, status in audit["required_quality"].items():
        lines.append(f"- {key}: {status}")
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
    active_runs = _active_runs(index, loop_decision)
    findings = _suite_findings(index, loop_decision, active_runs, _read_text(base / "suite-report.md"))
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
    audit = {
        "schema_version": 1,
        "result": "fail" if findings else "pass",
        "active_runs": [str(run.get("run_id")) for run in active_runs],
        "required_profiles": _required_profiles(active_runs),
        "required_quality": required_quality,
        "monitor": {"status": monitor_status, "path": monitor_path},
        "findings": findings,
        "next_action": (
            "Continue the playtest loop by fixing the first finding."
            if findings
            else "No artifact-level completion blockers found; retain goal active unless the full thread-level completion audit is also satisfied."
        ),
    }
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
