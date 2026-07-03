#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from coc_language import language_profile as build_language_profile


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

TRANSCRIPT_DETAIL_ALLOWED_ASCII_TOKENS = {
    "APP",
    "Brawl",
    "CON",
    "Climb",
    "DEX",
    "Dodge",
    "EDU",
    "Fighting",
    "HP",
    "Hidden",
    "INT",
    "KP",
    "Library",
    "Luck",
    "MOV",
    "MP",
    "POW",
    "Persuade",
    "SAN",
    "SIZ",
    "STR",
    "Spot",
    "Use",
}

SCENE_REPLAY_EVENT_TYPES = {"scene", "clue", "damage", "sanity", "bout_of_madness", "combat", "chase", "session_ending"}
ACTIVE_AUDIT_PROFILES = {"haunting_module", "chase_drill", "multi_profile_pressure"}
REQUIRED_BACKSTORY_FIELDS = [
    "description",
    "ideology_beliefs",
    "significant_people",
    "meaningful_locations",
    "treasured_possessions",
    "traits",
]
PLAYER_READABLE_REPORT_SECTIONS = [
    "Scene-by-Scene Replay",
    "Actual Play Replay",
    "Major Player Decisions",
    "Combat Summary",
    "Chase Summary",
    "Sanity Summary",
    "Clues Found",
    "Session Ending",
    "Story Recap",
    "Player Feedback On KP",
]
LOCALIZABLE_EMPTY_PLACEHOLDERS = [
    "No combat summary recorded.",
    "No chase summary recorded.",
    "No chase tracker recorded.",
    "No sanity summary recorded.",
]
REPORT_SHELL_REQUIRED_HEADINGS = {
    "Battle Report": "#",
    "Run Setup": "##",
    "Actual Play Replay": "##",
    "Session Transcript": "##",
    "Player Feedback On KP": "##",
}
REPORT_SHELL_REQUIRED_FIELDS = [
    "Campaign",
    "Play Language",
    "Player Profile",
    "Scenario",
    "Opening Scene",
]
RUN_SETUP_VALUE_FIELDS = [
    "dice_mode",
    "spoiler_policy",
    "player_profile",
]
MODULE_METADATA_VALUE_FIELDS = [
    "campaign_title",
    "scenario",
]
CHARACTER_DOSSIER_REQUIRED_LABELS = [
    "Occupation",
    "Era",
    "Characteristics",
    "Derived",
    "Skills",
    "Backstory",
    "Description",
    "Ideology/Beliefs",
    "Significant People",
    "Meaningful Locations",
    "Treasured Possessions",
    "Traits",
]
CHARACTER_DOSSIER_FORBIDDEN_DERIVED_LABELS = [
    "damage_bonus",
    "build",
]
CHRONICLE_REQUIRED_LABELS = [
    "History",
    "Development",
    "Final HP",
    "Final SAN",
    "Notable Events",
    "Unresolved Threads",
    "Development Phase Summary",
    "Status",
    "Skill Checks Earned",
    "Rewards",
    "Permanent Changes",
    "Carryover Notes",
    "pending_player_rolls",
]
FEEDBACK_REQUIRED_LABELS = [
    "kp_clarity",
    "rules_helpfulness",
    "immersion",
    "pacing",
    "fairness",
    "agency",
    "meta_quality",
]
CHASE_TRACKER_REQUIRED_LABELS = [
    "Chase ID",
    "Status",
    "Round",
    "DEX order",
    "Participants",
    "Location Chain",
    "Rounds",
    "Outcome",
    "movement_actions",
    "position",
    "start",
    "hazard",
    "barrier",
    "escape",
    "quarry",
    "pursuer",
    "resolved",
]
TRANSCRIPT_LABEL_REQUIRED_KEYS = ["turn_format", "mode", "intent", "ruling"]


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
        path = sandbox_investigators / investigator_id / "character.json"
        character = _read_json(path, {})
        if character:
            character["_history"] = _read_jsonl(path.parent / "history.jsonl")
            character["_development"] = _read_jsonl(path.parent / "development.jsonl")
            character["_inventory_history"] = _read_jsonl(path.parent / "inventory-history.jsonl")
            characters.append(character)

    if characters or not sandbox_investigators.exists():
        return characters

    for path in sorted(sandbox_investigators.glob("*/character.json")):
        character = _read_json(path, {})
        if character:
            character["_history"] = _read_jsonl(path.parent / "history.jsonl")
            character["_development"] = _read_jsonl(path.parent / "development.jsonl")
            character["_inventory_history"] = _read_jsonl(path.parent / "inventory-history.jsonl")
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


def _character_chronicle_gaps(characters: list[dict[str, Any]], rolls: list[dict[str, Any]]) -> list[str]:
    if not characters:
        return ["no investigator character files loaded"]

    earned_skill_checks = {
        event.get("actor")
        for event in rolls
        if event.get("payload", {}).get("skill_check_earned")
    }
    gaps: list[str] = []
    for character in characters:
        investigator_id = str(character.get("id") or character.get("investigator_id") or "unknown")
        history = character.get("_history", [])
        development = character.get("_development", [])
        if not history:
            gaps.append(f"{investigator_id} missing history.jsonl scenario experience")
        if investigator_id in earned_skill_checks and not development:
            gaps.append(f"{investigator_id} earned skill checks but lacks development.jsonl")
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


def _character_actor_ids(characters: list[dict[str, Any]]) -> list[str]:
    ids: list[str] = []
    for character in characters:
        for key in ("id", "investigator_id"):
            value = character.get(key)
            if value not in (None, "", [], {}):
                ids.append(str(value))
    return sorted(set(ids), key=len, reverse=True)


def _report_actor_id_leaks(battle_report: str, characters: list[dict[str, Any]]) -> list[str]:
    actor_ids = _character_actor_ids(characters)
    leaks: list[str] = []
    for heading in PLAYER_READABLE_REPORT_SECTIONS:
        section = _section_text(battle_report, heading)
        if not section:
            continue
        for actor_id in actor_ids:
            if f"{actor_id}:" in section or f"{actor_id} -" in section:
                leaks.append(f"{heading}:{actor_id}")
    return sorted(set(leaks))


def _event_state_ids(events: list[dict[str, Any]]) -> list[str]:
    ids: list[str] = []
    for event in events:
        payload = event.get("payload", {})
        if not isinstance(payload, dict):
            continue
        for key in ("scene_id", "clue_id"):
            value = payload.get(key)
            if value not in (None, "", [], {}):
                ids.append(str(value))
    return sorted(set(ids), key=len, reverse=True)


def _state_id_prefix_leaked(section: str, state_id: str) -> bool:
    prefixes = [
        f"- {state_id}:",
        f"- {state_id} -",
        f"- clue:{state_id}:",
        f"- clue: {state_id}:",
        f"- clue: {state_id} -",
    ]
    return any(prefix in section for prefix in prefixes)


def _report_state_id_leaks(battle_report: str, events: list[dict[str, Any]]) -> list[str]:
    state_ids = _event_state_ids(events)
    leaks: list[str] = []
    for heading in PLAYER_READABLE_REPORT_SECTIONS:
        section = _section_text(battle_report, heading)
        if not section:
            continue
        for state_id in state_ids:
            if _state_id_prefix_leaked(section, state_id):
                leaks.append(f"{heading}:{state_id}")
    return sorted(set(leaks))


def _memory_ids(memory: list[dict[str, Any]]) -> list[str]:
    ids: list[str] = []
    for entry in memory:
        if not isinstance(entry, dict):
            continue
        for key in ("session_id", "id"):
            value = entry.get(key)
            if value not in (None, "", [], {}):
                ids.append(str(value))
    return sorted(set(ids), key=len, reverse=True)


def _report_memory_id_leaks(battle_report: str, memory: list[dict[str, Any]]) -> list[str]:
    story_recap = _section_text(battle_report, "Story Recap")
    if not story_recap:
        return []
    leaks: list[str] = []
    for memory_id in _memory_ids(memory):
        if _state_id_prefix_leaked(story_recap, memory_id):
            leaks.append(f"Story Recap:{memory_id}")
    return sorted(set(leaks))


def _scene_replay_event_type_labels(events: list[dict[str, Any]]) -> list[str]:
    labels: list[str] = []
    for event in events:
        event_type = event.get("type")
        if event_type in SCENE_REPLAY_EVENT_TYPES:
            labels.append(str(event_type).replace("_", " "))
    return sorted(set(labels), key=len, reverse=True)


def _scene_replay_event_type_label_leaks(battle_report: str, events: list[dict[str, Any]]) -> list[str]:
    section = _section_text(battle_report, "Scene-by-Scene Replay")
    if not section:
        return []
    leaks: list[str] = []
    for label in _scene_replay_event_type_labels(events):
        if f"- {label}:" in section:
            leaks.append(label)
    return sorted(set(leaks))


def _character_display_names(characters: list[dict[str, Any]], terms: dict[str, str]) -> list[str]:
    names: list[str] = []
    for character in characters:
        canonical_name = character.get("name")
        investigator_id = character.get("id") or character.get("investigator_id")
        display_name = terms.get(str(canonical_name), canonical_name) if canonical_name else investigator_id
        if display_name not in (None, "", [], {}):
            names.append(str(display_name))
    return sorted(set(names), key=len, reverse=True)


def _report_repeated_actor_labels(
    battle_report: str,
    characters: list[dict[str, Any]],
    terms: dict[str, str],
) -> list[str]:
    names = _character_display_names(characters, terms)
    repeated: list[str] = []
    for heading in PLAYER_READABLE_REPORT_SECTIONS:
        section = _section_text(battle_report, heading)
        if not section:
            continue
        for name in names:
            if f"{name}: {name}" in section or f"{name} - {name}" in section:
                repeated.append(f"{heading}:{name}")
    return sorted(set(repeated))


def _unlocalized_empty_placeholders(battle_report: str, play_language: str) -> list[str]:
    if play_language in {"", "en-US"}:
        return []
    return [marker for marker in LOCALIZABLE_EMPTY_PLACEHOLDERS if marker in battle_report]


def _merge_language_profile(base: dict[str, Any], override: Any, play_language: str) -> dict[str, Any]:
    if not isinstance(override, dict) or override.get("language") != play_language:
        return base
    merged = dict(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            nested = dict(merged[key])
            nested.update(value)
            merged[key] = nested
        else:
            merged[key] = value
    return merged


def _selected_language_profile(metadata: dict[str, Any]) -> dict[str, Any]:
    play_language = str(metadata.get("play_language") or "en-US")
    profile = build_language_profile(play_language)
    return _merge_language_profile(profile, metadata.get("language_profile"), play_language)


def _localized_report_shell_gaps(battle_report: str, metadata: dict[str, Any]) -> list[str]:
    play_language = str(metadata.get("play_language") or "")
    if play_language in {"", "en-US"}:
        return []
    profile = _selected_language_profile(metadata)
    heading_labels = profile.get("report_heading_labels", {})
    field_labels = profile.get("report_field_labels", {})
    gaps: list[str] = []
    for heading, prefix in REPORT_SHELL_REQUIRED_HEADINGS.items():
        label = heading_labels.get(heading) if isinstance(heading_labels, dict) else None
        if label and label != heading and f"{prefix} {heading} / {label}" not in battle_report:
            gaps.append(f"heading:{heading}")
    for field in REPORT_SHELL_REQUIRED_FIELDS:
        label = field_labels.get(field) if isinstance(field_labels, dict) else None
        if label and label != field and f"（{label}）" not in battle_report:
            gaps.append(f"field:{field}")
    return gaps


def _run_setup_value_leaks(battle_report: str, metadata: dict[str, Any]) -> list[str]:
    play_language = str(metadata.get("play_language") or "")
    if play_language in {"", "en-US"}:
        return []
    section = _section_text(battle_report, "Run Setup")
    if not section:
        return []
    profile = _selected_language_profile(metadata)
    labels = profile.get("report_value_labels", {})
    if not isinstance(labels, dict):
        labels = {}
    candidates = [
        str(metadata.get(field))
        for field in RUN_SETUP_VALUE_FIELDS
        if metadata.get(field) not in (None, "", [], {})
    ]
    display_name = profile.get("display_name")
    if display_name not in (None, "", [], {}):
        candidates.append(str(display_name))
    leaks: list[str] = []
    for canonical in candidates:
        label = labels.get(canonical)
        if label and label != canonical and canonical in section:
            leaks.append(canonical)
    if "entries (see Localization Appendix)" in section:
        leaks.append("localized_terms_summary")
    return sorted(set(leaks))


def _module_metadata_value_leaks(battle_report: str, metadata: dict[str, Any], scenario: dict[str, Any]) -> list[str]:
    play_language = str(metadata.get("play_language") or "")
    if play_language in {"", "en-US"}:
        return []
    section = "\n".join([
        _section_text(battle_report, "Run Setup"),
        _section_text(battle_report, "Module"),
    ])
    if not section:
        return []
    terms = _localized_terms(metadata)
    candidates = [
        str(metadata.get(field))
        for field in MODULE_METADATA_VALUE_FIELDS
        if metadata.get(field) not in (None, "", [], {})
    ]
    for field in ("title", "module_source", "source"):
        value = scenario.get(field)
        if value not in (None, "", [], {}):
            candidates.append(str(value))
    leaks: list[str] = []
    for canonical in candidates:
        localized = terms.get(canonical)
        if canonical in section and localized != canonical:
            leaks.append(canonical)
    return sorted(set(leaks))


def _character_dossier_label_gaps(battle_report: str, metadata: dict[str, Any]) -> list[str]:
    play_language = str(metadata.get("play_language") or "")
    if play_language in {"", "en-US"}:
        return []
    section = _section_text(battle_report, "Character Dossier")
    if not section:
        return []
    profile = _selected_language_profile(metadata)
    labels = profile.get("character_dossier_labels", {})
    gaps: list[str] = []
    for canonical in CHARACTER_DOSSIER_REQUIRED_LABELS:
        label = labels.get(canonical) if isinstance(labels, dict) else None
        if not label or label == canonical:
            continue
        if f"{label}:" not in section:
            gaps.append(f"missing:{canonical}")
        if f"{canonical}:" in section:
            gaps.append(f"leaked:{canonical}")
    return sorted(set(gaps))


def _character_dossier_derived_label_leaks(battle_report: str, metadata: dict[str, Any]) -> list[str]:
    play_language = str(metadata.get("play_language") or "")
    if play_language in {"", "en-US"}:
        return []
    section = _section_text(battle_report, "Character Dossier")
    if not section:
        return []
    return [
        label
        for label in CHARACTER_DOSSIER_FORBIDDEN_DERIVED_LABELS
        if f"{label}:" in section
    ]


def _chronicle_label_leaks(battle_report: str, metadata: dict[str, Any]) -> list[str]:
    play_language = str(metadata.get("play_language") or "")
    if play_language in {"", "en-US"}:
        return []
    section = _section_text(battle_report, "Investigator Chronicle")
    if not section:
        return []
    profile = _selected_language_profile(metadata)
    labels = profile.get("chronicle_labels", {})
    if not isinstance(labels, dict):
        return []
    leaks: list[str] = []
    for canonical in CHRONICLE_REQUIRED_LABELS:
        label = labels.get(canonical)
        if not label or label == canonical:
            continue
        if canonical in section:
            leaks.append(canonical)
    return sorted(set(leaks))


def _feedback_label_leaks(
    battle_report: str,
    metadata: dict[str, Any],
    feedback_entries: list[dict[str, Any]],
) -> list[str]:
    play_language = str(metadata.get("play_language") or "")
    if play_language in {"", "en-US"}:
        return []
    section = _section_text(battle_report, "Player Feedback On KP")
    if not section:
        return []
    profile = _selected_language_profile(metadata)
    labels = profile.get("feedback_labels", {})
    if not isinstance(labels, dict):
        return []
    categories = set(FEEDBACK_REQUIRED_LABELS)
    for entry in feedback_entries:
        category = entry.get("category") if isinstance(entry, dict) else None
        if category not in (None, "", [], {}):
            categories.add(str(category))
    leaks: list[str] = []
    for canonical in categories:
        if f"- {canonical}:" in section:
            leaks.append(canonical)
    return sorted(set(leaks))


def _chase_tracker_label_leaks(battle_report: str, metadata: dict[str, Any]) -> list[str]:
    play_language = str(metadata.get("play_language") or "")
    if play_language in {"", "en-US"}:
        return []
    section = _section_text(battle_report, "Chase Tracker")
    if not section:
        return []
    profile = _selected_language_profile(metadata)
    labels = profile.get("chase_tracker_labels", {})
    difficulty_labels = profile.get("difficulty_labels", {})
    if not isinstance(labels, dict):
        labels = {}
    if not isinstance(difficulty_labels, dict):
        difficulty_labels = {}
    leaks: list[str] = []
    label_sources = [
        (canonical, labels.get(canonical))
        for canonical in CHASE_TRACKER_REQUIRED_LABELS
    ]
    label_sources.extend(
        (canonical, difficulty_labels.get(canonical))
        for canonical in ["regular", "hard", "extreme"]
    )
    for canonical, label in label_sources:
        if not label or label == canonical:
            continue
        if canonical in section:
            leaks.append(canonical)
    return sorted(set(leaks))


def _transcript_label_gaps(battle_report: str, metadata: dict[str, Any]) -> list[str]:
    play_language = str(metadata.get("play_language") or "")
    if play_language in {"", "en-US"}:
        return []
    profile = _selected_language_profile(metadata)
    labels = profile.get("transcript_labels", {})
    if not isinstance(labels, dict):
        return TRANSCRIPT_LABEL_REQUIRED_KEYS
    gaps = [key for key in TRANSCRIPT_LABEL_REQUIRED_KEYS if not labels.get(key)]
    actual_play = _section_text(battle_report, "Actual Play Replay")
    transcript = _section_text(battle_report, "Session Transcript")
    combined = f"{actual_play}\n{transcript}"
    if labels.get("turn_format") != "Turn {turn}" and "- Turn " in combined:
        gaps.append("turn_format")
    canonical_detail_labels = {
        "mode": "Mode",
        "intent": "Intent",
        "ruling": "Ruling",
    }
    for key, canonical in canonical_detail_labels.items():
        if labels.get(key) != canonical and f"\n  - {canonical}:" in combined:
            gaps.append(key)
    return sorted(set(gaps))


def _transcript_detail_value_gaps(battle_report: str, metadata: dict[str, Any]) -> list[str]:
    play_language = str(metadata.get("play_language") or "")
    if play_language in {"", "en-US"}:
        return []
    profile = _selected_language_profile(metadata)
    labels = profile.get("transcript_labels", {})
    if not isinstance(labels, dict):
        return []
    actual_play = _section_text(battle_report, "Actual Play Replay")
    transcript = _section_text(battle_report, "Session Transcript")
    gaps: list[str] = []
    for key, fallback in {"intent": "Intent", "ruling": "Ruling"}.items():
        label = str(labels.get(key) or fallback)
        prefix = f"- {label}: "
        for line in f"{actual_play}\n{transcript}".splitlines():
            stripped = line.strip()
            if not stripped.startswith(prefix):
                continue
            value = stripped[len(prefix):].strip()
            untranslated_tokens = [
                token
                for token in re.findall(r"[A-Za-z][A-Za-z0-9_-]*", value)
                if token not in TRANSCRIPT_DETAIL_ALLOWED_ASCII_TOKENS
            ]
            if value and (not _has_cjk(value) or untranslated_tokens):
                gaps.append(key)
    return sorted(set(gaps))


def _report_boolean_value_leaks(battle_report: str, metadata: dict[str, Any]) -> list[str]:
    play_language = str(metadata.get("play_language") or "")
    if play_language in {"", "en-US"}:
        return []
    section = _section_text(battle_report, "Rules & Rolls Recap")
    if not section:
        return []
    profile = _selected_language_profile(metadata)
    labels = profile.get("report_labels", {})
    if not isinstance(labels, dict):
        return []
    yes_label = str(labels.get("yes", "yes"))
    no_label = str(labels.get("no", "no"))
    if yes_label == "yes" and no_label == "no":
        return []
    monitored_labels = [
        str(labels.get("pushed_roll", "Pushed Roll")),
        str(labels.get("skill_check_earned", "Skill Check Earned")),
    ]
    leaks: list[str] = []
    for label in monitored_labels:
        for raw_value in ("yes", "no"):
            if f"- {label}：{raw_value}" in section or f"- {label}: {raw_value}" in section:
                leaks.append(f"{label}:{raw_value}")
    return sorted(set(leaks))


def _character_dossier_term_leaks(battle_report: str, metadata: dict[str, Any]) -> list[str]:
    play_language = str(metadata.get("play_language") or "")
    if play_language in {"", "en-US"}:
        return []
    section = _section_text(battle_report, "Character Dossier")
    if not section:
        return []
    profile = _selected_language_profile(metadata)
    labels = profile.get("character_dossier_labels", {})
    if not isinstance(labels, dict):
        labels = {}
    narrative_labels = {
        str(labels.get("Player", "Player")),
        str(labels.get("Occupation", "Occupation")),
        str(labels.get("Backstory", "Backstory")),
        str(labels.get("Description", "Description")),
        str(labels.get("Ideology/Beliefs", "Ideology/Beliefs")),
        str(labels.get("Significant People", "Significant People")),
        str(labels.get("Meaningful Locations", "Meaningful Locations")),
        str(labels.get("Treasured Possessions", "Treasured Possessions")),
        str(labels.get("Traits", "Traits")),
        str(labels.get("Injuries & Scars", "Injuries & Scars")),
        str(labels.get("Phobias & Manias", "Phobias & Manias")),
    }
    narrative_lines: list[str] = []
    for line in section.splitlines():
        stripped = line.strip()
        if not stripped.startswith("- ") or ": " not in stripped:
            continue
        label, value = stripped[2:].split(": ", 1)
        if label in narrative_labels:
            narrative_lines.append(value)
    return _unlocalized_terms_in_text("\n".join(narrative_lines), _localized_terms(metadata))


def _profile_ids(metadata: dict[str, Any]) -> list[str]:
    ids: list[str] = []
    for profile_id in metadata.get("player_profiles_tested", []):
        if profile_id not in (None, "", [], {}):
            ids.append(str(profile_id))
    return sorted(set(ids), key=len, reverse=True)


def _profile_label_leaks(battle_report: str, metadata: dict[str, Any]) -> list[str]:
    play_language = str(metadata.get("play_language") or "")
    if play_language in {"", "en-US"}:
        return []
    labels = metadata.get("player_profile_labels", {})
    language_labels = labels.get(play_language, {}) if isinstance(labels, dict) else {}
    if not isinstance(language_labels, dict):
        language_labels = {}
    leaks: list[str] = []
    for profile_id in _profile_ids(metadata):
        if profile_id not in language_labels:
            leaks.append(f"missing_label:{profile_id}")
            continue
        if f"Player[{profile_id}]" in battle_report or f"{profile_id}:" in battle_report:
            leaks.append(profile_id)
    return sorted(set(leaks))


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


def _temporary_insanity_triggered(rolls: list[dict[str, Any]]) -> bool:
    return any(
        event.get("payload", {}).get("temporary_insanity_triggered") is True
        for event in rolls
    )


def _has_bout_of_madness_event(events: list[dict[str, Any]]) -> bool:
    return any(event.get("type") == "bout_of_madness" for event in events)


def _bout_duration_roll_gaps(events: list[dict[str, Any]]) -> list[str]:
    gaps: list[str] = []
    for index, event in enumerate(
        [event for event in events if event.get("type") == "bout_of_madness"],
        start=1,
    ):
        payload = event.get("payload", {})
        missing = [
            field for field in ["duration_die", "duration_roll", "duration_rounds"]
            if payload.get(field) in (None, "", [], {})
        ]
        if missing:
            gaps.append(f"bout_of_madness {index} missing {', '.join(missing)}")
            continue
        if payload.get("duration_die") != "1D10":
            gaps.append(f"bout_of_madness {index} duration_die is {payload.get('duration_die')}, expected 1D10")
        try:
            duration_roll = int(payload.get("duration_roll"))
            duration_rounds = int(payload.get("duration_rounds"))
        except (TypeError, ValueError):
            gaps.append(f"bout_of_madness {index} duration_roll and duration_rounds must be integers")
            continue
        if not 1 <= duration_roll <= 10:
            gaps.append(f"bout_of_madness {index} duration_roll {duration_roll} outside 1D10 range")
        if duration_rounds != duration_roll:
            gaps.append(f"bout_of_madness {index} duration_rounds {duration_rounds} does not match duration_roll {duration_roll}")
    return gaps


def _bout_duration_roll_count(events: list[dict[str, Any]]) -> int:
    return sum(
        1 for event in events
        if event.get("type") == "bout_of_madness"
        and event.get("payload", {}).get("duration_die") == "1D10"
        and event.get("payload", {}).get("duration_roll") not in (None, "", [], {})
        and event.get("payload", {}).get("duration_rounds") not in (None, "", [], {})
    )


def _bout_of_madness_rendered(battle_report: str, metadata: dict[str, Any]) -> bool:
    terms = _localized_terms(metadata)
    label = terms.get("Bout of Madness", "Bout of Madness")
    sections = "\n".join(
        _section_text(battle_report, heading)
        for heading in ("Scene-by-Scene Replay", "Actual Play Replay", "Session Transcript", "Sanity Summary")
    )
    return label in sections


def _positive_rulebook_evidence(context: dict[str, Any]) -> list[str]:
    metadata = context["metadata"]
    transcript = context["transcript"]
    rolls = context["rolls"]
    events = context["events"]
    covered_subsystems = sorted(set(metadata.get("subsystems_covered", [])))
    pushed_rolls = [
        event for event in rolls
        if event.get("payload", {}).get("pushed") is True
    ]
    skill_checks = [
        event for event in rolls
        if event.get("payload", {}).get("skill_check_earned") is True
    ]
    sanity_rolls = [event for event in rolls if event.get("type") == "sanity"]
    temporary_insanity_markers = [
        event for event in rolls
        if event.get("payload", {}).get("temporary_insanity_triggered") is True
    ]
    lines = [
        (
            f"Transcript turns: {len(transcript)}; player intents: {_player_intent_count(transcript)}; "
            f"Keeper rulings: {_keeper_ruling_count(transcript)}."
        ),
        f"Roll protocol: {len(rolls)} roll log entries; protocol gaps: {len(_roll_protocol_gaps(rolls))}.",
        f"Pushed rolls: {len(pushed_rolls)}; skill checks earned: {len(skill_checks)}.",
        (
            f"Sanity procedure: {len(sanity_rolls)} SAN roll entries; "
            f"temporary_insanity_triggered markers: {len(temporary_insanity_markers)}; "
            f"Bout of Madness events: {_event_type_count(events, 'bout_of_madness')}; "
            f"Bout duration rolls: {_bout_duration_roll_count(events)}."
        ),
        f"Subsystems covered: {', '.join(covered_subsystems) if covered_subsystems else 'none'}.",
    ]
    if metadata.get("audit_profile") == "haunting_module":
        module_coverage = set(metadata.get("module_coverage", []))
        covered_count = sum(1 for item in HAUNTING_MODULE_COVERAGE if item in module_coverage)
        lines.append(f"Module coverage: {covered_count}/{len(HAUNTING_MODULE_COVERAGE)} required The Haunting beats recorded.")
        lines.append(
            f"Combat evidence: {_event_type_count(events, 'combat')} combat events; "
            f"{sum(1 for event in rolls if event.get('type') == 'combat')} combat roll entries."
        )
    if metadata.get("audit_profile") == "chase_drill":
        chase_state = context["chase_state"]
        state_fields = [
            field for field in ["participants", "location_chain", "rounds", "outcome"]
            if chase_state.get(field) not in (None, "", [], {})
        ]
        tracker_rendered = "yes" if "## Chase Tracker" in context["battle_report"] else "no"
        lines.append(
            f"Chase evidence: {_event_type_count(events, 'chase')} chase events; "
            f"save/chase.json fields present: {', '.join(state_fields) if state_fields else 'none'}; "
            f"Chase Tracker rendered: {tracker_rendered}."
        )
    return lines


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

    chronicle_gaps = _character_chronicle_gaps(context["characters"], context["rolls"]) if active_profile else []
    if chronicle_gaps:
        findings.append(_finding(
            "investigator_chronicle_missing",
            "system_gap",
            "medium",
            "; ".join(chronicle_gaps),
            "Write sandbox investigator history.jsonl and development.jsonl records so the playtest proves cross-campaign carryover without mutating the real investigator library.",
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
    report_shell_gaps = _localized_report_shell_gaps(battle_report, metadata)
    if active_profile and report_shell_gaps:
        findings.append(_finding(
            "report_shell_not_localized",
            "report_gap",
            "medium",
            "Active localized battle report lacks localized report chrome: " + ", ".join(report_shell_gaps),
            "Render canonical report headings with localized aliases and append localized field labels from language_profile.",
        ))
    run_setup_value_leaks = _run_setup_value_leaks(battle_report, metadata)
    if active_profile and run_setup_value_leaks:
        findings.append(_finding(
            "run_setup_values_not_localized",
            "report_gap",
            "medium",
            "Active localized Run Setup exposes raw configuration values: " + ", ".join(run_setup_value_leaks),
            "Render Run Setup display values from language_profile.report_value_labels while preserving canonical values in JSON.",
        ))
    module_metadata_value_leaks = _module_metadata_value_leaks(battle_report, metadata, context["scenario"])
    if active_profile and module_metadata_value_leaks:
        findings.append(_finding(
            "module_metadata_values_not_localized",
            "report_gap",
            "medium",
            "Active localized report exposes raw module metadata values: " + ", ".join(module_metadata_value_leaks),
            "Render Campaign, Scenario, and Source display values through localized_terms while preserving canonical values in JSON.",
        ))
    if active_profile and (
        "## Investigator Chronicle" not in battle_report
        or "No investigator chronicle recorded." in battle_report
    ):
        findings.append(_finding(
            "investigator_chronicle_not_rendered",
            "report_gap",
            "medium",
            "Battle report does not render reusable investigator history and development records.",
            "Render sandbox investigator history.jsonl and development.jsonl in an Investigator Chronicle section.",
        ))
    chronicle_label_leaks = _chronicle_label_leaks(battle_report, metadata)
    if active_profile and chronicle_label_leaks:
        findings.append(_finding(
            "investigator_chronicle_labels_not_localized",
            "report_gap",
            "medium",
            "Active localized Investigator Chronicle exposes unlocalized labels or status values: "
            + ", ".join(chronicle_label_leaks),
            "Render investigator chronicle labels and player-visible status values from language_profile.chronicle_labels.",
        ))
    character_label_gaps = _character_dossier_label_gaps(battle_report, metadata)
    if active_profile and character_label_gaps:
        findings.append(_finding(
            "character_dossier_labels_not_localized",
            "report_gap",
            "medium",
            "Active localized Character Dossier lacks localized field labels: " + ", ".join(character_label_gaps),
            "Render Character Dossier field labels from language_profile.character_dossier_labels.",
        ))
    character_derived_label_leaks = _character_dossier_derived_label_leaks(battle_report, metadata)
    if active_profile and character_derived_label_leaks:
        findings.append(_finding(
            "character_dossier_derived_labels_not_localized",
            "report_gap",
            "medium",
            "Active localized Character Dossier exposes raw derived value labels: "
            + ", ".join(character_derived_label_leaks),
            "Render derived value labels such as damage bonus and build through language_profile.character_dossier_labels.",
        ))
    character_term_leaks = _character_dossier_term_leaks(battle_report, metadata)
    if active_profile and character_term_leaks:
        findings.append(_finding(
            "character_dossier_terms_not_localized",
            "report_gap",
            "medium",
            "Active localized Character Dossier leaks canonical glossary terms: " + ", ".join(character_term_leaks),
            "Render Character Dossier values through localized_terms for the selected play_language.",
        ))
    transcript_label_gaps = _transcript_label_gaps(battle_report, metadata)
    if active_profile and transcript_label_gaps:
        findings.append(_finding(
            "transcript_labels_not_localized",
            "report_gap",
            "medium",
            "Active localized transcript sections lack localized labels: " + ", ".join(transcript_label_gaps),
            "Render Actual Play Replay and Session Transcript turn/detail labels from language_profile.transcript_labels.",
        ))
    transcript_detail_gaps = _transcript_detail_value_gaps(battle_report, metadata)
    if active_profile and transcript_detail_gaps:
        findings.append(_finding(
            "transcript_detail_values_not_localized",
            "report_gap",
            "medium",
            "Active localized transcript sections expose unlocalized detail values: " + ", ".join(transcript_detail_gaps),
            "Render intent/ruling display values from localized_text while preserving canonical values in JSON.",
        ))
    boolean_value_leaks = _report_boolean_value_leaks(battle_report, metadata)
    if active_profile and boolean_value_leaks:
        findings.append(_finding(
            "report_boolean_values_not_localized",
            "report_gap",
            "medium",
            "Active localized Rules & Rolls Recap exposes raw boolean display values: "
            + ", ".join(boolean_value_leaks),
            "Render player-readable report boolean values from language_profile.report_labels while preserving machine values in JSON and Mechanical Log.",
        ))
    feedback_label_leaks = _feedback_label_leaks(battle_report, metadata, context["feedback"])
    if active_profile and feedback_label_leaks:
        findings.append(_finding(
            "player_feedback_labels_not_localized",
            "report_gap",
            "medium",
            "Active localized Player Feedback On KP exposes internal feedback category ids: "
            + ", ".join(feedback_label_leaks),
            "Render feedback metric labels from language_profile.feedback_labels while preserving category ids in JSON.",
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
    actor_id_leaks = _report_actor_id_leaks(battle_report, context["characters"])
    if active_profile and actor_id_leaks:
        findings.append(_finding(
            "report_actor_ids_not_localized",
            "report_gap",
            "medium",
            "Player-readable report sections expose internal actor ids: " + ", ".join(actor_id_leaks),
            "Render localized actor display names in player-readable report sections; reserve canonical ids for Character Dossier, Mechanical Log, Chase Tracker, and stored JSON.",
        ))
    state_id_leaks = _report_state_id_leaks(battle_report, context["events"])
    if active_profile and state_id_leaks:
        findings.append(_finding(
            "report_state_ids_not_localized",
            "report_gap",
            "medium",
            "Player-readable report sections expose internal state ids: " + ", ".join(state_id_leaks),
            "Render scene and clue summaries without machine ids in player-readable report sections; reserve canonical ids for Mechanical Log, Chase Tracker, and stored JSON.",
        ))
    memory_id_leaks = _report_memory_id_leaks(battle_report, context["memory"])
    if active_profile and memory_id_leaks:
        findings.append(_finding(
            "report_memory_ids_not_localized",
            "report_gap",
            "medium",
            "Player-readable Story Recap exposes internal memory ids: " + ", ".join(memory_id_leaks),
            "Render story memory summaries without session_id or memory ids; reserve canonical ids for stored JSON.",
        ))
    scene_event_label_leaks = _scene_replay_event_type_label_leaks(battle_report, context["events"])
    if active_profile and scene_event_label_leaks:
        findings.append(_finding(
            "report_event_type_labels_not_localized",
            "report_gap",
            "medium",
            "Scene-by-Scene Replay exposes raw event type labels: " + ", ".join(scene_event_label_leaks),
            "Render scene replay entries as player-readable summaries without raw event type prefixes; reserve event type enums for logs and Mechanical Log.",
        ))
    repeated_actor_labels = _report_repeated_actor_labels(battle_report, context["characters"], locale_terms)
    if active_profile and repeated_actor_labels:
        findings.append(_finding(
            "report_actor_label_repeated",
            "report_gap",
            "low",
            "Player-readable report sections repeat actor labels: " + ", ".join(repeated_actor_labels),
            "If a player-readable summary already begins with the localized actor name, omit the separate actor label prefix.",
        ))
    empty_placeholder_leaks = _unlocalized_empty_placeholders(
        battle_report,
        str(metadata.get("play_language") or ""),
    )
    if active_profile and empty_placeholder_leaks:
        findings.append(_finding(
            "localized_empty_placeholders_not_rendered",
            "report_gap",
            "medium",
            "Active localized battle report still contains English empty subsystem placeholders: "
            + ", ".join(empty_placeholder_leaks),
            "Render empty subsystem summaries through language_profile.empty_report_lines for the selected play_language.",
        ))
    profile_label_leaks = _profile_label_leaks(battle_report, metadata)
    if active_profile and profile_label_leaks:
        findings.append(_finding(
            "player_profile_labels_not_localized",
            "report_gap",
            "medium",
            "Active localized battle report exposes player profile ids or lacks labels: " + ", ".join(profile_label_leaks),
            "Persist player_profile_labels for the selected play_language and render those labels in transcript, actual-play, and feedback sections.",
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

    if active_profile and _temporary_insanity_triggered(context["rolls"]):
        if not _has_bout_of_madness_event(context["events"]):
            findings.append(_finding(
                "temporary_insanity_bout_missing",
                "system_gap",
                "high",
                "A structured roll payload sets temporary_insanity_triggered=true, but events.jsonl has no bout_of_madness event.",
                "Record a bout_of_madness event with the episode, duration, Keeper control boundary, player-facing behavior, and recovery note.",
            ))
        duration_gaps = _bout_duration_roll_gaps(context["events"])
        if duration_gaps:
            findings.append(_finding(
                "temporary_insanity_bout_duration_missing",
                "system_gap",
                "high",
                "; ".join(duration_gaps),
                "Record the actual Bout of Madness duration_roll and duration_rounds from the 1D10 duration roll.",
            ))
        if not _bout_of_madness_rendered(battle_report, metadata):
            findings.append(_finding(
                "temporary_insanity_bout_not_rendered",
                "report_gap",
                "high",
                "Temporary insanity was triggered, but the battle report does not render a localized Bout of Madness entry.",
                "Render bout_of_madness events in the Scene-by-Scene Replay and Sanity Summary.",
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
        elif (
            "## Chase Tracker" not in battle_report
            or "No chase tracker recorded." in _section_text(battle_report, "Chase Tracker")
        ):
            findings.append(_finding(
                "chase_tracker_not_rendered",
                "report_gap",
                "high",
                "save/chase.json has participants, location chain, round log, and outcome, but the battle report does not render a populated ## Chase Tracker section.",
                "Render save/chase.json participants, DEX order, location chain, rounds, and outcome in ## Chase Tracker.",
            ))
        else:
            chase_tracker_label_leaks = _chase_tracker_label_leaks(battle_report, metadata)
            if chase_tracker_label_leaks:
                findings.append(_finding(
                    "chase_tracker_labels_not_localized",
                    "report_gap",
                    "medium",
                    "Active localized Chase Tracker exposes unlocalized labels, roles, status, or difficulty values: "
                    + ", ".join(chase_tracker_label_leaks),
                    "Render Chase Tracker labels and display values from language_profile.chase_tracker_labels, localized_terms, and localized_text while preserving canonical ids as audit anchors.",
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
        "positive_rulebook_evidence": _positive_rulebook_evidence(context),
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
        "## Positive Rulebook Evidence",
        *[f"- {line}" for line in audit.get("positive_rulebook_evidence", [])],
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
