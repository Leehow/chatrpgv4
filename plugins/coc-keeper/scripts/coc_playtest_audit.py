#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


Finding = dict[str, Any]

HAUNTING_MODULE_COVERAGE = [
    "knott_hiring",
    "research_route",
    "chapel_of_contemplation",
    "old_corbitt_place",
    "bed_attack",
    "basement",
    "floating_knife",
    "corbitt_hiding_place",
    "corbitt_confrontation",
    "conclusion_rewards",
]

HAUNTING_MODULE_SUBSYSTEMS = [
    "investigation",
    "social",
    "pushed_roll",
    "sanity",
    "damage",
    "combat",
]

HAUNTING_REPORT_MOMENTS = [
    "Mr. Knott",
    "Arty Wilmot",
    "Chapel of Contemplation",
    "The Old Corbitt Place",
    "Bed Attack",
    "The Floating Knife",
    "Corbitt's Hiding Place",
    "Corbitt Attacks",
    "Rewards",
]

CHASE_REPORT_MOMENTS = [
    "speed roll",
    "MOV",
    "movement actions",
    "location chain",
    "DEX order",
    "hazard",
    "barrier",
    "conflict",
    "quarry escapes",
]

SCENE_REPLAY_EVENT_TYPES = {"scene", "clue", "damage", "sanity", "combat", "chase", "session_ending"}
ACTIVE_AUDIT_PROFILES = {"haunting_module", "chase_drill", "multi_profile_pressure"}
REQUIRED_BACKSTORY_FIELDS = [
    "description",
    "ideology_beliefs",
    "significant_people",
    "meaningful_locations",
    "treasured_possessions",
    "traits",
]


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


def _campaign_dirs(run_dir: Path) -> list[Path]:
    campaigns_dir = run_dir / "sandbox" / ".coc" / "campaigns"
    if not campaigns_dir.exists():
        return []
    return sorted(path for path in campaigns_dir.iterdir() if path.is_dir())


def _select_campaign_dir(run_dir: Path, metadata: dict[str, Any]) -> Path | None:
    campaign_id = metadata.get("campaign_id") or metadata.get("run_id")
    if campaign_id:
        path = run_dir / "sandbox" / ".coc" / "campaigns" / str(campaign_id)
        if path.exists():
            return path
    campaign_dirs = _campaign_dirs(run_dir)
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
        character = _read_json(sandbox_investigators / investigator_id / "character.json", {})
        if character:
            characters.append(character)

    if characters or not sandbox_investigators.exists():
        return characters

    for path in sorted(sandbox_investigators.glob("*/character.json")):
        character = _read_json(path, {})
        if character:
            characters.append(character)
    return characters


def _load_context(run_dir: Path) -> dict[str, Any]:
    metadata = _read_json(run_dir / "playtest.json", {})
    campaign_dir = _select_campaign_dir(run_dir, metadata)
    scenario_dir = campaign_dir / "scenario" if campaign_dir else None
    logs_dir = campaign_dir / "logs" if campaign_dir else None
    memory_dir = campaign_dir / "memory" if campaign_dir else None
    save_dir = campaign_dir / "save" if campaign_dir else None
    party = _read_json(campaign_dir / "party.json", {}) if campaign_dir else {}
    return {
        "metadata": metadata,
        "campaign_dir": campaign_dir,
        "party": party,
        "scenario": _read_json(scenario_dir / "scenario.json", {}) if scenario_dir else {},
        "clues": _read_json(scenario_dir / "clues.json", []) if scenario_dir else [],
        "locations": _read_json(scenario_dir / "locations.json", []) if scenario_dir else [],
        "npcs": _read_json(scenario_dir / "npcs.json", []) if scenario_dir else [],
        "timeline": _read_json(scenario_dir / "timeline.json", []) if scenario_dir else [],
        "characters": _load_characters(run_dir, party),
        "transcript": _read_jsonl(run_dir / "transcript.jsonl"),
        "rolls": _read_jsonl(logs_dir / "rolls.jsonl") if logs_dir else [],
        "events": _read_jsonl(logs_dir / "events.jsonl") if logs_dir else [],
        "memory": _read_jsonl(memory_dir / "session-summaries.jsonl") if memory_dir else [],
        "feedback": _read_jsonl(run_dir / "player-feedback.jsonl"),
        "chase_state": _read_json(save_dir / "chase.json", {}) if save_dir else {},
        "battle_report": _read_text(run_dir / "artifacts" / "battle-report.md"),
    }


def _finding(code: str, cause: str, severity: str, evidence: str, recommendation: str) -> Finding:
    return {
        "code": code,
        "cause": cause,
        "severity": severity,
        "evidence": evidence,
        "blueprint_status": "designed_not_implemented",
        "recommendation": recommendation,
    }


def _nonempty_text(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _nonempty_list(value: Any) -> bool:
    return isinstance(value, list) and len(value) > 0


def _backstory_field_present(value: Any) -> bool:
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, list):
        return bool(value)
    if isinstance(value, dict):
        return any(_backstory_field_present(child) for child in value.values())
    return value not in (None, "", [], {})


def _character_backstory_gaps(characters: list[dict[str, Any]]) -> list[str]:
    if not characters:
        return ["no investigator character files loaded"]

    gaps: list[str] = []
    for character in characters:
        investigator_id = str(character.get("id") or character.get("investigator_id") or "unknown")
        backstory = character.get("backstory")
        if not isinstance(backstory, dict):
            gaps.append(f"{investigator_id} missing backstory")
            continue
        missing = [
            field
            for field in REQUIRED_BACKSTORY_FIELDS
            if not _backstory_field_present(backstory.get(field))
        ]
        if missing:
            gaps.append(f"{investigator_id} missing {', '.join(missing)}")
    return gaps


def _player_intent_count(transcript: list[dict[str, Any]]) -> int:
    return sum(1 for event in transcript if event.get("role") == "player_simulator" and event.get("intent"))


def _keeper_ruling_count(transcript: list[dict[str, Any]]) -> int:
    return sum(1 for event in transcript if event.get("role") == "keeper_under_test" and event.get("ruling"))


def _visible_dialogue_events(transcript: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        event
        for event in transcript
        if event.get("role") in {"keeper_under_test", "player_simulator"}
        and _nonempty_text(event.get("text"))
    ]


def _has_cjk(text: str) -> bool:
    return any("\u4e00" <= char <= "\u9fff" for char in text)


def _non_chinese_dialogue_turns(transcript: list[dict[str, Any]]) -> list[str]:
    turns: list[str] = []
    for event in _visible_dialogue_events(transcript):
        if not _has_cjk(str(event.get("text", ""))):
            turns.append(str(event.get("turn", "?")))
    return turns


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


def _unlocalized_terms_in_text(text: str, terms: dict[str, str]) -> list[str]:
    return [canonical for canonical in terms if canonical in text]


def _visible_unlocalized_glossary_terms(transcript: list[dict[str, Any]], terms: dict[str, str]) -> list[str]:
    leaked: list[str] = []
    for event in _visible_dialogue_events(transcript):
        leaked.extend(_unlocalized_terms_in_text(str(event.get("text", "")), terms))
    return sorted(set(leaked))


def _report_narrative_text(section: str) -> str:
    lines: list[str] = []
    for line in section.splitlines():
        if not line.startswith("- "):
            lines.append(line)
            continue
        text = line[2:]
        if ": " in text:
            text = text.split(": ", 1)[1]
        if " - " in text:
            text = text.split(" - ", 1)[1]
        lines.append(text)
    return "\n".join(lines)


def _report_unlocalized_glossary_terms(battle_report: str, terms: dict[str, str]) -> list[str]:
    visible_sections = [
        "Scene-by-Scene Replay",
        "Major Player Decisions",
        "Story Recap",
        "Player Feedback On KP",
    ]
    leaked: list[str] = []
    for heading in visible_sections:
        leaked.extend(_unlocalized_terms_in_text(_report_narrative_text(_section_text(battle_report, heading)), terms))
    actual_play_lines = [
        line
        for line in _section_text(battle_report, "Actual Play Replay").splitlines()
        if line.startswith("- Turn") and (" KP:" in line or " Player:" in line)
    ]
    leaked.extend(_unlocalized_terms_in_text("\n".join(actual_play_lines), terms))
    return sorted(set(leaked))


def _event_type_count(events: list[dict[str, Any]], event_type: str) -> int:
    return sum(1 for event in events if event.get("type") == event_type)


def _roll_protocol_gaps(rolls: list[dict[str, Any]]) -> list[str]:
    missing: list[str] = []
    required_payload_fields = [
        "goal",
        "target",
        "effective_target",
        "difficulty",
        "difficulty_rationale",
        "outcome",
        "failure_consequence",
    ]
    if not rolls:
        return ["no rolls recorded"]
    for index, event in enumerate(rolls, start=1):
        payload = event.get("payload", {})
        for field in required_payload_fields:
            if payload.get(field) in (None, "", [], {}):
                missing.append(f"roll {index} missing {field}")
    return missing


def _has_pushed_roll(rolls: list[dict[str, Any]]) -> bool:
    return any(bool(event.get("payload", {}).get("pushed")) for event in rolls)


def _has_skill_check(rolls: list[dict[str, Any]]) -> bool:
    return any(bool(event.get("payload", {}).get("skill_check_earned")) for event in rolls)


def _report_contains_all(text: str, markers: list[str]) -> list[str]:
    return [marker for marker in markers if marker not in text]


def _contains_marker_or_localized(text: str, marker: str, terms: dict[str, str]) -> bool:
    localized = terms.get(marker)
    return marker in text or bool(localized and localized in text)


def _report_contains_required_moments(text: str, markers: list[str], terms: dict[str, str]) -> list[str]:
    missing: list[str] = []
    for marker in markers:
        if not _contains_marker_or_localized(text, marker, terms):
            missing.append(marker)
    return missing


def _section_text(markdown: str, heading: str) -> str:
    marker = f"## {heading}"
    start = markdown.find(marker)
    if start == -1:
        return ""
    rest = markdown[start + len(marker):]
    next_heading = rest.find("\n## ")
    return rest if next_heading == -1 else rest[:next_heading]


def _player_report_sections_without_chinese(battle_report: str) -> list[str]:
    headings = ["Major Player Decisions", "Story Recap", "Player Feedback On KP"]
    return [
        heading
        for heading in headings
        if not _has_cjk(_section_text(battle_report, heading))
    ]


def _scene_replay_bullet_count(section: str) -> int:
    return sum(1 for line in section.splitlines() if line.startswith("- "))


def _significant_scene_replay_event_count(events: list[dict[str, Any]]) -> int:
    return sum(1 for event in events if event.get("type") in SCENE_REPLAY_EVENT_TYPES)


def _haunting_module_required(metadata: dict[str, Any]) -> bool:
    return metadata.get("audit_profile") == "haunting_module"


def _chase_drill_required(metadata: dict[str, Any]) -> bool:
    return metadata.get("audit_profile") == "chase_drill"


def _payload_summaries(events: list[dict[str, Any]], event_type: str) -> list[str]:
    summaries: list[str] = []
    for event in events:
        if event.get("type") != event_type:
            continue
        payload = event.get("payload", {})
        summary = payload.get("summary") or payload.get("text") or ""
        summaries.append(str(summary))
    return summaries


def audit_run(run_dir: Path) -> dict[str, Any]:
    context = _load_context(run_dir)
    findings: list[Finding] = []

    scenario = context["scenario"]
    scenario_has_text = all(
        _nonempty_text(scenario.get(field))
        for field in ["summary", "player_safe_summary", "opening_scene"]
    )
    scenario_has_support = all(
        _nonempty_list(context[field])
        for field in ["clues", "locations", "npcs", "timeline"]
    )
    if not scenario_has_text or not scenario_has_support:
        findings.append(_finding(
            "scenario_context_missing",
            "test_gap",
            "high",
            "Scenario sandbox lacks summary/player-safe summary/opening scene or clue/location/NPC/timeline data.",
            "Upgrade the playtest setup to import enough module structure before judging KP behavior.",
        ))

    transcript = context["transcript"]
    if len(transcript) < 8 or _player_intent_count(transcript) < 2 or _keeper_ruling_count(transcript) < 1:
        findings.append(_finding(
            "conversation_loop_too_thin",
            "test_gap",
            "high",
            f"Transcript has {len(transcript)} turns, {_player_intent_count(transcript)} player intents, "
            f"and {_keeper_ruling_count(transcript)} Keeper rulings.",
            "Run enough turns to cover scene framing, player intent, Keeper ruling, result, and consequence.",
        ))

    metadata = context["metadata"]
    active_profile = metadata.get("audit_profile") in ACTIVE_AUDIT_PROFILES
    backstory_gaps = _character_backstory_gaps(context["characters"]) if active_profile else []
    if backstory_gaps:
        findings.append(_finding(
            "character_backstory_missing",
            "system_gap",
            "medium",
            "; ".join(backstory_gaps),
            "Record the core Call of Cthulhu investigator backstory fields: description, ideology/beliefs, significant people, meaningful locations, treasured possessions, and traits.",
        ))

    non_chinese_turns = _non_chinese_dialogue_turns(transcript)
    if active_profile and non_chinese_turns:
        findings.append(_finding(
            "visible_dialogue_not_chinese",
            "system_gap",
            "high",
            "Visible KP/player dialogue lacks Chinese text on turns: " + ", ".join(non_chinese_turns),
            "Generate KP and virtual player visible dialogue in Chinese while preserving machine-readable markers, JSON keys, skills, and enum values.",
        ))
    locale_terms = _localized_terms(metadata)
    unlocalized_visible_terms = _visible_unlocalized_glossary_terms(transcript, locale_terms)
    if active_profile and locale_terms and unlocalized_visible_terms:
        findings.append(_finding(
            "visible_glossary_terms_not_localized",
            "system_gap",
            "high",
            "Visible KP/player dialogue still contains canonical glossary terms: " + ", ".join(unlocalized_visible_terms),
            "Render player-visible names and setting terms through play_language localized_terms while preserving canonical ids, JSON keys, skills, and enum values.",
        ))

    roll_gaps = _roll_protocol_gaps(context["rolls"])
    if roll_gaps:
        findings.append(_finding(
            "roll_protocol_incomplete",
            "system_gap",
            "high",
            "; ".join(roll_gaps),
            "Record each roll goal, difficulty rationale, target, outcome, and failure consequence in rolls.jsonl.",
        ))

    if not context["clues"] or _event_type_count(context["events"], "clue") < 1:
        findings.append(_finding(
            "clue_flow_missing",
            "system_gap",
            "high",
            "No scenario clue inventory or clue event proves that investigation advanced.",
            "Log clue discovery, missed clues, and alternate clue routes as durable campaign events.",
        ))

    if not _has_pushed_roll(context["rolls"]):
        findings.append(_finding(
            "pushed_roll_missing",
            "test_gap",
            "high",
            "No roll payload is marked as a pushed roll.",
            "Exercise a failed skill roll, the player's push justification, foreshadowed failure, and the pushed result.",
        ))

    if _event_type_count(context["events"], "session_ending") < 1:
        findings.append(_finding(
            "session_ending_missing",
            "system_gap",
            "high",
            "No session_ending event records how the session closed or what remains unresolved.",
            "Record a session ending event with recap, cliffhanger or next-step state, and unresolved questions.",
        ))

    if not context["memory"] or not context["feedback"]:
        findings.append(_finding(
            "memory_or_feedback_missing",
            "test_gap",
            "medium",
            f"Memory summaries: {len(context['memory'])}; player feedback entries: {len(context['feedback'])}.",
            "Have the playtest harness write session-summaries.jsonl and player-feedback.jsonl before report generation.",
        ))

    battle_report = context["battle_report"]
    placeholder_markers = [
        "No story recap recorded.",
        "No player feedback recorded.",
        "No clue extraction in V1 report.",
        "No major decision extraction in V1 report.",
        "Session ending not recorded.",
    ]
    present_placeholders = [marker for marker in placeholder_markers if marker in battle_report]
    if not battle_report or present_placeholders:
        findings.append(_finding(
            "report_missing_recorded_play",
            "report_gap",
            "medium",
            "Battle report is missing or still contains placeholders: " + ", ".join(present_placeholders or ["missing file"]),
            "Render recorded story memory, decisions, clues, and player feedback instead of placeholder text.",
        ))

    if active_profile and "## Actual Play Replay" not in battle_report:
        findings.append(_finding(
            "actual_play_replay_missing",
            "report_gap",
            "high",
            "Battle report does not include the Actual Play Replay section for visible table dialogue.",
            "Render the KP/player/system transcript as an actual-play replay before the structured transcript appendix.",
        ))

    scene_replay = _section_text(battle_report, "Scene-by-Scene Replay") if active_profile else ""
    if active_profile and not _has_cjk(scene_replay):
        findings.append(_finding(
            "scene_replay_missing",
            "report_gap",
            "medium",
            "Battle report does not include a Chinese Scene-by-Scene Replay section.",
            "Render scene events as a Chinese scene-by-scene replay so evaluators can read the session as table scenes before the turn transcript.",
        ))
    significant_scene_events = _significant_scene_replay_event_count(context["events"])
    scene_replay_bullets = _scene_replay_bullet_count(scene_replay)
    if active_profile and _has_cjk(scene_replay) and scene_replay_bullets < significant_scene_events:
        findings.append(_finding(
            "scene_replay_too_thin",
            "report_gap",
            "medium",
            f"Scene-by-Scene Replay renders {scene_replay_bullets} bullets for {significant_scene_events} significant play events.",
            "Render each significant scene, clue, damage, sanity, combat, chase, and session-ending event in the scene replay before the transcript appendix.",
        ))

    non_chinese_report_sections = _player_report_sections_without_chinese(battle_report) if active_profile else []
    if non_chinese_report_sections:
        findings.append(_finding(
            "player_report_sections_not_chinese",
            "report_gap",
            "medium",
            "Player-facing battle report sections lack Chinese text: " + ", ".join(non_chinese_report_sections),
            "Render major decisions, story recap, and virtual player feedback in Chinese while preserving stable machine-readable headings and markers.",
        ))
    unlocalized_report_terms = _report_unlocalized_glossary_terms(battle_report, locale_terms)
    if active_profile and locale_terms and unlocalized_report_terms:
        findings.append(_finding(
            "report_glossary_terms_not_localized",
            "report_gap",
            "medium",
            "Player-readable report sections still contain canonical glossary terms: " + ", ".join(unlocalized_report_terms),
            "Render scene replay, actual-play replay, major decisions, recap, and feedback through the run glossary for the selected play_language.",
        ))

    if "{'" in battle_report or "'}" in battle_report:
        findings.append(_finding(
            "raw_payload_rendered",
            "report_gap",
            "medium",
            "Battle report contains raw Python/JSON-style payload text.",
            "Format state changes as player-readable summaries rather than dumping payload dictionaries.",
        ))

    missing_mechanical_markers = _report_contains_all(
        battle_report,
        ["Goal:", "Difficulty:", "Difficulty Rationale:", "Failure Consequence:"],
    )
    if missing_mechanical_markers:
        findings.append(_finding(
            "mechanical_detail_not_rendered",
            "report_gap",
            "high",
            "Battle report mechanical log misses: " + ", ".join(missing_mechanical_markers),
            "Render roll goals, difficulty levels, difficulty rationale, and failure consequences for important rolls.",
        ))

    if _has_skill_check(context["rolls"]) and "Skill Check Earned: yes" not in battle_report:
        findings.append(_finding(
            "skill_development_not_rendered",
            "report_gap",
            "medium",
            "At least one roll earned a skill check, but the battle report does not show it.",
            "Render skill check marks and later development-phase outcomes when available.",
        ))

    if _has_pushed_roll(context["rolls"]) and "Pushed Roll: yes" not in battle_report:
        findings.append(_finding(
            "pushed_roll_not_rendered",
            "report_gap",
            "high",
            "A pushed roll exists in rolls.jsonl, but the battle report does not show the push.",
            "Render push justification, foreshadowed failure, and pushed-roll result in the mechanical log.",
        ))

    covered_subsystems = set(context["metadata"].get("subsystems_covered", []))
    if "investigation" not in covered_subsystems:
        findings.append(_finding(
            "subsystem_coverage_missing",
            "test_gap",
            "medium",
            f"subsystems_covered={sorted(covered_subsystems)}.",
            "Declare and exercise at least investigation in every rulebook-alignment playtest; add sanity/combat/chase per scenario.",
        ))

    if _haunting_module_required(metadata):
        module_coverage = set(metadata.get("module_coverage", []))
        missing_coverage = [
            item for item in HAUNTING_MODULE_COVERAGE
            if item not in module_coverage
        ]
        if missing_coverage:
            findings.append(_finding(
                "module_coverage_incomplete",
                "test_gap",
                "high",
                "Missing The Haunting coverage: " + ", ".join(missing_coverage),
                "Run a module-level harness that reaches the research routes, Chapel, Corbitt House, bed attack, basement knife, Corbitt confrontation, and conclusion.",
            ))

        missing_subsystems = [
            item for item in HAUNTING_MODULE_SUBSYSTEMS
            if item not in covered_subsystems
        ]
        if missing_subsystems:
            findings.append(_finding(
                "subsystem_coverage_incomplete",
                "test_gap",
                "high",
                "Missing subsystem coverage: " + ", ".join(missing_subsystems),
                "Exercise the social, pushed-roll, sanity, damage, and combat procedures that The Haunting introduces.",
            ))

        if len(transcript) < 30 or _player_intent_count(transcript) < 8 or _keeper_ruling_count(transcript) < 6:
            findings.append(_finding(
                "module_transcript_too_thin",
                "test_gap",
                "high",
                f"Transcript has {len(transcript)} turns, {_player_intent_count(transcript)} player intents, "
                f"and {_keeper_ruling_count(transcript)} Keeper rulings.",
                "Simulate enough KP/player exchange to show setup, investigation, exploration, hazards, combat, and aftermath.",
            ))

        decision_count = _event_type_count(context["events"], "decision")
        if decision_count < 5:
            findings.append(_finding(
                "module_decisions_too_thin",
                "report_gap",
                "medium",
                f"Only {decision_count} major player decision events were recorded.",
                "Record the player's major route choices, pushed-roll choices, risk acceptances, and final tactical decisions.",
            ))

        combat_summaries = _payload_summaries(context["events"], "combat")
        combat_text = " ".join(combat_summaries)
        corbitt_markers = [
            "Corbitt",
            locale_terms.get("Corbitt", ""),
            locale_terms.get("Walter Corbitt", ""),
        ]
        has_corbitt_resolution = any(marker and marker in combat_text for marker in corbitt_markers)
        if (
            len(combat_summaries) < 2
            or not _contains_marker_or_localized(combat_text, "combat round", locale_terms)
            or not has_corbitt_resolution
        ):
            findings.append(_finding(
                "combat_resolution_missing",
                "system_gap",
                "high",
                "Combat summaries do not show a combat round and Corbitt resolution.",
                "Record floating-knife and Corbitt combat rounds, including action order, opposed rolls, damage, and outcome.",
            ))

        status_text = " ".join(_payload_summaries(context["events"], "status"))
        if (
            not _contains_marker_or_localized(status_text, "Final HP", locale_terms)
            or not _contains_marker_or_localized(status_text, "Final SAN", locale_terms)
        ):
            findings.append(_finding(
                "final_state_missing",
                "system_gap",
                "high",
                "No status event records final HP and SAN.",
                "Record final investigator HP, SAN, rewards, and unresolved conditions at the end of a module playthrough.",
            ))

        chase_summaries = _payload_summaries(context["events"], "chase")
        if "chase" not in covered_subsystems and not chase_summaries:
            findings.append(_finding(
                "chase_context_missing",
                "report_gap",
                "medium",
                "No chase event explains whether chase rules were covered or not applicable.",
                "For modules without chase scenes, record an explicit non-applicable chase summary instead of leaving the report empty.",
            ))

        missing_report_moments = _report_contains_required_moments(
            battle_report,
            HAUNTING_REPORT_MOMENTS,
            locale_terms,
        )
        if missing_report_moments:
            findings.append(_finding(
                "module_report_missing_key_moments",
                "report_gap",
                "high",
                "Battle report misses key module moments: " + ", ".join(missing_report_moments),
                "Render the named module beats in the transcript, state changes, combat summary, and ending sections.",
            ))

    if _chase_drill_required(metadata):
        if "chase" not in covered_subsystems:
            findings.append(_finding(
                "chase_subsystem_missing",
                "test_gap",
                "high",
                f"subsystems_covered={sorted(covered_subsystems)}.",
                "Exercise and declare the chase subsystem in a dedicated chase drill playtest.",
            ))

        chase_state = context["chase_state"]
        required_state_fields = ["participants", "location_chain", "rounds", "outcome"]
        missing_state_fields = [
            field for field in required_state_fields
            if chase_state.get(field) in (None, "", [], {})
        ]
        if missing_state_fields:
            findings.append(_finding(
                "chase_state_missing",
                "system_gap",
                "high",
                "save/chase.json is missing or incomplete: " + ", ".join(missing_state_fields),
                "Persist chase participants, location chain, round log, and outcome under save/chase.json.",
            ))

        chase_text = " ".join(_payload_summaries(context["events"], "chase"))
        if (
            not _contains_marker_or_localized(chase_text, "speed roll", locale_terms)
            or not _contains_marker_or_localized(chase_text, "movement actions", locale_terms)
            or not _contains_marker_or_localized(chase_text, "quarry escapes", locale_terms)
        ):
            findings.append(_finding(
                "chase_resolution_missing",
                "system_gap",
                "high",
                "Chase events do not show speed rolls, movement actions, and escape/capture resolution.",
                "Record the chase setup, DEX order, movement action economy, hazards/barriers, conflict, and final outcome.",
            ))

        missing_chase_moments = _report_contains_required_moments(
            battle_report,
            CHASE_REPORT_MOMENTS,
            locale_terms,
        )
        if missing_chase_moments:
            findings.append(_finding(
                "chase_report_missing_key_moments",
                "report_gap",
                "high",
                "Battle report misses chase moments: " + ", ".join(missing_chase_moments),
                "Render speed rolls, MOV, location chain, movement actions, hazards, barriers, conflict, and escape/capture in Chase Summary.",
            ))

    return {
        "run_dir": str(run_dir),
        "result": "fail" if findings else "pass",
        "findings": findings,
    }


def _group_findings(findings: list[Finding]) -> dict[str, list[Finding]]:
    grouped: dict[str, list[Finding]] = {}
    for finding in findings:
        grouped.setdefault(finding["cause"], []).append(finding)
    return grouped


def _next_fix_target(findings: list[Finding]) -> str:
    priority = ["test_gap", "system_gap", "report_gap", "design_gap"]
    grouped = _group_findings(findings)
    for cause in priority:
        if cause in grouped:
            finding = grouped[cause][0]
            return f"{cause}: {finding['recommendation']}"
    return "No fix target. The run passed the current rulebook audit."


def generate_rulebook_audit(run_dir: Path) -> Path:
    audit = audit_run(run_dir)
    output = run_dir / "artifacts" / "rulebook-audit.md"
    output.parent.mkdir(parents=True, exist_ok=True)
    findings = audit["findings"]
    grouped = _group_findings(findings)

    body = [
        "# Rulebook Alignment Audit",
        "",
        "## Overall Result",
        audit["result"].upper(),
        "",
        "## Root Cause Classification",
    ]
    if findings:
        for cause in sorted(grouped):
            body.append(f"### {cause}")
            for finding in grouped[cause]:
                body.extend([
                    f"- [{finding['cause']}] {finding['code']} ({finding['severity']})",
                    f"  - Evidence: {finding['evidence']}",
                    f"  - Recommendation: {finding['recommendation']}",
                ])
    else:
        body.append("- No findings.")

    body.extend([
        "",
        "## Blueprint Cross-Check",
    ])
    if findings:
        for finding in findings:
            body.append(f"- {finding['code']}: {finding['blueprint_status']}")
    else:
        body.append("- Current run satisfies the implemented rulebook-audit contract.")

    body.extend([
        "",
        "## Next Loop Fix Target",
        f"- {_next_fix_target(findings)}",
        "",
    ])
    output.write_text("\n".join(body), encoding="utf-8")
    return output


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("run_dir")
    args = parser.parse_args()
    output = generate_rulebook_audit(Path(args.run_dir))
    audit = audit_run(Path(args.run_dir))
    print(output)
    return 1 if audit["result"] == "fail" else 0


if __name__ == "__main__":
    raise SystemExit(main())
