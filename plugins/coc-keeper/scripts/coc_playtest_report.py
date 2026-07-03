#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from coc_language import language_profile as build_language_profile


SCENE_REPLAY_EVENT_TYPES = {"scene", "clue", "damage", "sanity", "bout_of_madness", "combat", "chase", "session_ending"}
CJK_BOUNDARY_SPACE = re.compile(r"(?<=[\u4e00-\u9fff·》」』”）]) (?=[\u4e00-\u9fff《「『“（])")


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


def _localized_field(
    container: dict[str, Any],
    key: str,
    localized_terms: dict[str, str],
    play_language: str,
) -> str | None:
    localized_text = container.get("localized_text", {})
    if isinstance(localized_text, dict):
        language_text = localized_text.get(play_language, {})
        if isinstance(language_text, dict) and language_text.get(key) not in (None, "", [], {}):
            return _localize_text(language_text[key], localized_terms)
    return None


def _localized_event_text(event: dict[str, Any], localized_terms: dict[str, str], play_language: str) -> str:
    localized = _localized_field(event, "text", localized_terms, play_language)
    if localized is not None:
        return localized
    return _localize_text(event.get("text", ""), localized_terms)


def _localized_payload_text(
    payload: dict[str, Any],
    key: str,
    localized_terms: dict[str, str],
    play_language: str,
    allow_raw_fallback: bool = False,
) -> str | None:
    localized = _localized_field(payload, key, localized_terms, play_language)
    if localized is not None:
        return localized
    if not allow_raw_fallback:
        return None
    if payload.get(key) not in (None, "", [], {}):
        return _localize_text(payload[key], localized_terms)
    return None


def _format_roll_recap(
    event: dict[str, Any],
    actor_names: dict[str, str],
    localized_terms: dict[str, str],
    play_language: str,
    language_profile: dict[str, Any],
) -> str:
    has_language_specific_payload = bool(
        isinstance(event.get("payload", {}).get("localized_text"), dict)
        and event.get("payload", {}).get("localized_text", {}).get(play_language)
    )
    if play_language == "en-US" and not has_language_specific_payload:
        return _format_roll(event)

    payload = event.get("payload", {})
    report_labels = language_profile.get("report_labels", {})
    outcome_labels = language_profile.get("outcome_labels", {})
    difficulty_labels = language_profile.get("difficulty_labels", {})
    allow_raw_fallback = bool(language_profile.get("raw_payload_fallback"))
    skill = payload.get("skill", "check")
    actor = _display_roll_actor(event.get("actor", "unknown"), actor_names)
    roll = payload.get("roll", "?")
    target = payload.get("effective_target", payload.get("target", "?"))
    outcome = _localized_rule_value(payload.get("outcome", "unknown"), outcome_labels, localized_terms)
    roll_sentence = report_labels.get("roll_sentence", "- {skill}: {actor} rolled {roll} vs {target} -> {outcome}")
    lines = [
        roll_sentence.format(
            skill=skill,
            actor=actor,
            roll=roll,
            target=target,
            outcome=outcome,
        )
    ]
    for key, label, labels in [("difficulty", report_labels.get("difficulty", "Difficulty"), difficulty_labels)]:
        if payload.get(key) in (None, "", [], {}):
            continue
        value = _localized_rule_value(payload[key], labels, localized_terms)
        lines.append(f"  - {label}：{value}")
    for key, label in [
        ("goal", report_labels.get("goal", "Goal")),
        ("difficulty_rationale", report_labels.get("difficulty_rationale", "Difficulty Rationale")),
        ("failure_consequence", report_labels.get("failure_consequence", "Failure Consequence")),
    ]:
        value = _localized_payload_text(payload, key, localized_terms, play_language, allow_raw_fallback)
        if value is not None:
            lines.append(f"  - {label}：{value}")
    if payload.get("pushed"):
        lines.append(f"  - {report_labels.get('pushed_roll', 'Pushed Roll')}：{report_labels.get('yes', 'yes')}")
    push_justification = _localized_payload_text(
        payload,
        "push_justification",
        localized_terms,
        play_language,
        allow_raw_fallback,
    )
    if push_justification is not None:
        lines.append(f"  - {report_labels.get('push_justification', 'Push Justification')}：{push_justification}")
    foreshadowed_failure = _localized_payload_text(
        payload,
        "foreshadowed_failure",
        localized_terms,
        play_language,
        allow_raw_fallback,
    )
    if foreshadowed_failure is not None:
        lines.append(f"  - {report_labels.get('foreshadowed_failure', 'Foreshadowed Failure')}：{foreshadowed_failure}")
    if "skill_check_earned" in payload:
        earned = report_labels.get("yes", "yes") if payload.get("skill_check_earned") else report_labels.get("no", "no")
        lines.append(f"  - {report_labels.get('skill_check_earned', 'Skill Check Earned')}：{earned}")
    if payload.get("san_loss") not in (None, "", [], {}):
        lines.append(f"  - {report_labels.get('san_loss', 'SAN Loss')}：{payload['san_loss']}")
    return "\n".join(lines)


def _roll_recap_summary(recap: str) -> str:
    first_line = recap.splitlines()[0] if recap.splitlines() else ""
    return first_line.removeprefix("- ").strip()


def _join_roll_recap_summaries(recaps: list[str]) -> str:
    summaries = [_roll_recap_summary(recap) for recap in recaps if _roll_recap_summary(recap)]
    if not summaries:
        return ""
    if len(summaries) == 1:
        return summaries[0]
    return "；".join(summary.rstrip("。") for summary in summaries) + "。"


def _event_roll_count(event: dict[str, Any], remaining_rolls: int) -> int:
    raw_count = event.get("roll_count", 1)
    try:
        count = int(raw_count)
    except (TypeError, ValueError):
        count = 1
    count = max(1, count)
    if remaining_rolls <= 0:
        return 0
    return min(count, remaining_rolls)


def _format_roll_transcript_text(event: dict[str, Any], roll_recaps: list[str]) -> str | None:
    if event.get("mode") != "roll" or not roll_recaps:
        return None
    text = _join_roll_recap_summaries(roll_recaps)
    outcome_note = str(event.get("outcome_note", "")).strip()
    if outcome_note:
        text = f"{text}{outcome_note}" if text.endswith("。") else f"{text}。{outcome_note}"
    return text


def _display_actor(actor: str) -> str:
    if actor == "keeper_under_test":
        return "KP"
    if actor == "player_simulator":
        return "Player"
    return actor


def _format_state_event(
    event: dict[str, Any],
    localized_terms: dict[str, str] | None = None,
    play_language: str = "en-US",
) -> str:
    terms = localized_terms or {}
    event_type = event.get("type", "event")
    event_label = event_type.replace("_", " ")
    payload = event.get("payload", {})
    if event_type == "scene":
        scene_id = payload.get("scene_id", "unknown")
        summary = _payload_summary(event, terms, play_language)
        return f"- scene: {scene_id} - {summary}".rstrip()
    actor = _display_actor(event.get("actor", "unknown"))
    summary = _payload_summary(event, terms, play_language)
    if event_type == "clue":
        clue_id = payload.get("clue_id", "unknown")
        return f"- clue: {clue_id} - {summary or 'clue recorded'}"
    if summary:
        return f"- {event_label}: {actor} - {summary}"
    return f"- {event_label}: {actor}"


def _payload_summary(
    event: dict[str, Any],
    localized_terms: dict[str, str],
    play_language: str,
    fallback: str = "",
) -> str:
    payload = event.get("payload", {})
    localized = _localized_field(payload, "summary", localized_terms, play_language)
    if localized is not None:
        return localized.strip()
    localized = _localized_field(payload, "text", localized_terms, play_language)
    if localized is not None:
        return localized.strip()
    return _localize_text(payload.get("summary") or payload.get("text") or fallback, localized_terms).strip()


def _event_summary(
    event: dict[str, Any],
    fallback: str = "",
    localized_terms: dict[str, str] | None = None,
    play_language: str = "en-US",
) -> str:
    terms = localized_terms or {}
    localized = _localized_field(event, "summary", terms, play_language)
    if localized is not None:
        return localized.strip()
    localized = _localized_field(event, "text", terms, play_language)
    if localized is not None:
        return localized.strip()
    payload = event.get("payload", {})
    if payload:
        return _payload_summary(event, terms, play_language, fallback)
    return _localize_text(event.get("summary") or event.get("text") or fallback, terms).strip()


def _format_decision(
    event: dict[str, Any],
    localized_terms: dict[str, str] | None = None,
    play_language: str = "en-US",
) -> str:
    summary = _event_summary(event, "decision recorded", localized_terms, play_language)
    return f"- {summary}"


def _format_clue(
    event: dict[str, Any],
    localized_terms: dict[str, str] | None = None,
    play_language: str = "en-US",
) -> str:
    payload = event.get("payload", {})
    clue_id = payload.get("clue_id", "unknown")
    summary = _event_summary(event, "clue recorded", localized_terms, play_language)
    return f"- {clue_id}: {summary}"


def _format_subsystem_event(
    event: dict[str, Any],
    localized_terms: dict[str, str] | None = None,
    play_language: str = "en-US",
) -> str:
    actor = _display_actor(event.get("actor", "unknown"))
    summary = _event_summary(
        event,
        f"{event.get('type', 'event')} recorded",
        localized_terms,
        play_language,
    )
    return f"- {actor}: {summary}"


def _format_scene_replay_event(
    event: dict[str, Any],
    localized_terms: dict[str, str] | None = None,
    play_language: str = "en-US",
) -> str:
    terms = localized_terms or {}
    event_type = event.get("type", "event")
    payload = event.get("payload", {})
    if event_type == "scene":
        scene_id = payload.get("scene_id") or "scene"
        summary = _event_summary(event, "scene recorded", terms, play_language)
        return f"- {scene_id}: {summary}"
    if event_type == "clue":
        clue_id = payload.get("clue_id") or "clue"
        summary = _event_summary(event, "clue recorded", terms, play_language)
        return f"- clue:{clue_id}: {summary}"
    event_label = event_type.replace("_", " ")
    actor = _display_actor(event.get("actor", "unknown"))
    summary = _event_summary(event, f"{event_label} recorded", terms, play_language)
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


def _selected_language_profile(
    play_language: str,
    metadata: dict[str, Any],
    campaign: dict[str, Any],
) -> dict[str, Any]:
    profile = build_language_profile(play_language)
    profile = _merge_language_profile(profile, campaign.get("language_profile"), play_language)
    return _merge_language_profile(profile, metadata.get("language_profile"), play_language)


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


def _format_localized_terms_summary(terms: dict[str, str]) -> str:
    if not terms:
        return "none"
    return f"{len(terms)} entries (see Localization Appendix)"


def _format_localization_appendix(terms: dict[str, str]) -> list[str]:
    return [f"- {canonical} -> {localized}" for canonical, localized in sorted(terms.items())]


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


BACKSTORY_FIELDS = [
    ("description", "Description"),
    ("ideology_beliefs", "Ideology/Beliefs"),
    ("significant_people", "Significant People"),
    ("meaningful_locations", "Meaningful Locations"),
    ("treasured_possessions", "Treasured Possessions"),
    ("traits", "Traits"),
    ("injuries_scars", "Injuries & Scars"),
    ("phobias_manias", "Phobias & Manias"),
]


def _format_backstory_value(value: Any, localized_terms: dict[str, str]) -> str:
    if isinstance(value, list):
        return "; ".join(_format_backstory_value(item, localized_terms) for item in value)
    if isinstance(value, dict):
        parts = [
            f"{key}: {_format_backstory_value(child, localized_terms)}"
            for key, child in value.items()
            if child not in (None, "", [], {})
        ]
        return "; ".join(parts)
    return _localize_text(value, localized_terms)


def _format_backstory(backstory: Any, localized_terms: dict[str, str]) -> list[str]:
    if not isinstance(backstory, dict) or not backstory:
        return []

    lines = ["  - Backstory:"]
    rendered_keys: set[str] = set()
    for key, label in BACKSTORY_FIELDS:
        value = backstory.get(key)
        if value in (None, "", [], {}):
            continue
        rendered_keys.add(key)
        lines.append(f"    - {label}: {_format_backstory_value(value, localized_terms)}")

    for key in sorted(backstory):
        if key in rendered_keys or backstory.get(key) in (None, "", [], {}):
            continue
        label = key.replace("_", " ").title()
        lines.append(f"    - {label}: {_format_backstory_value(backstory[key], localized_terms)}")
    return lines if len(lines) > 1 else []


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
    lines.extend(_format_backstory(character.get("backstory"), terms))
    return lines


def _format_record_value(value: Any, localized_terms: dict[str, str]) -> str:
    if isinstance(value, list):
        return "; ".join(_format_record_value(item, localized_terms) for item in value)
    if isinstance(value, dict):
        parts = [
            f"{key}: {_format_record_value(child, localized_terms)}"
            for key, child in value.items()
            if child not in (None, "", [], {})
        ]
        return "; ".join(parts)
    return _localize_text(value, localized_terms)


def _localized_record_field(
    record: dict[str, Any],
    key: str,
    localized_terms: dict[str, str],
    play_language: str,
) -> str | None:
    localized = _localized_field(record, key, localized_terms, play_language)
    if localized is not None:
        return localized
    if record.get(key) not in (None, "", [], {}):
        return _format_record_value(record[key], localized_terms)
    return None


def _format_record_type(value: Any, fallback: str) -> str:
    if value in (None, "", [], {}):
        return fallback
    return str(value).replace("_", " ").title()


def _format_history_entry(
    record: dict[str, Any],
    localized_terms: dict[str, str],
    play_language: str,
) -> list[str]:
    summary = _localized_record_field(record, "summary", localized_terms, play_language)
    lines = [f"    - {summary or record.get('type', 'history entry')}"]
    for key, label in [
        ("final_hp", "Final HP"),
        ("final_san", "Final SAN"),
        ("notable_events", "Notable Events"),
        ("unresolved_threads", "Unresolved Threads"),
    ]:
        value = _localized_record_field(record, key, localized_terms, play_language)
        if value is not None:
            lines.append(f"      - {label}: {value}")
    return lines


def _format_development_entry(
    record: dict[str, Any],
    localized_terms: dict[str, str],
    play_language: str,
) -> list[str]:
    title = _format_record_type(record.get("type"), "Development Entry")
    lines = [f"    - {title}"]
    for key, label in [
        ("status", "Status"),
        ("skill_checks_earned", "Skill Checks Earned"),
        ("rewards", "Rewards"),
        ("permanent_changes", "Permanent Changes"),
        ("carryover_notes", "Carryover Notes"),
    ]:
        value = _localized_record_field(record, key, localized_terms, play_language)
        if value is not None:
            lines.append(f"      - {label}: {value}")
    return lines


def _format_inventory_entry(
    record: dict[str, Any],
    localized_terms: dict[str, str],
    play_language: str,
) -> list[str]:
    summary = _localized_record_field(record, "summary", localized_terms, play_language)
    lines = [f"    - {summary or record.get('type', 'inventory entry')}"]
    for key, label in [("items", "Items"), ("cash", "Cash"), ("notes", "Notes")]:
        value = _localized_record_field(record, key, localized_terms, play_language)
        if value is not None:
            lines.append(f"      - {label}: {value}")
    return lines


def _format_investigator_chronicle(
    character: dict[str, Any],
    localized_terms: dict[str, str] | None = None,
    play_language: str = "en-US",
) -> list[str]:
    terms = localized_terms or {}
    history = character.get("_history", [])
    development = character.get("_development", [])
    inventory = character.get("_inventory_history", [])
    if not history and not development and not inventory:
        return []

    investigator_id = character.get("investigator_id") or character.get("id") or "unknown"
    name = _localize_text(character.get("name") or investigator_id or "Unknown Investigator", terms)
    lines = [f"- {name} ({investigator_id})"]
    if history:
        lines.append("  - History:")
        for record in history:
            lines.extend(_format_history_entry(record, terms, play_language))
    if development:
        lines.append("  - Development:")
        for record in development:
            lines.extend(_format_development_entry(record, terms, play_language))
    if inventory:
        lines.append("  - Inventory History:")
        for record in inventory:
            lines.extend(_format_inventory_entry(record, terms, play_language))
    return lines


def _display_transcript_speaker(event: dict[str, Any]) -> str:
    role = event.get("role", "unknown")
    if role == "keeper_under_test":
        return "KP"
    if role == "player_simulator":
        player_profile = event.get("player_profile")
        if player_profile:
            return f"Player[{player_profile}]"
        return "Player"
    return event.get("speaker") or role


def _format_transcript_event(event: dict[str, Any], rendered_text: str | None = None) -> list[str]:
    speaker = _display_transcript_speaker(event)

    turn = event.get("turn", "?")
    text = rendered_text if rendered_text is not None else event.get("text", "")
    lines = [f"- Turn {turn} {speaker}: {text}"]
    if event.get("mode"):
        lines.append(f"  - Mode: {event['mode']}")
    if event.get("intent"):
        lines.append(f"  - Intent: {event['intent']}")
    return lines


def _format_actual_play_event(event: dict[str, Any], rendered_text: str | None = None) -> list[str]:
    role = event.get("role", "unknown")
    speaker = _display_transcript_speaker(event)

    turn = event.get("turn", "?")
    text = rendered_text if rendered_text is not None else event.get("text", "")
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


def _format_session_summary(
    event: dict[str, Any],
    localized_terms: dict[str, str] | None = None,
    play_language: str = "en-US",
) -> str:
    session_id = event.get("session_id") or event.get("id") or "session"
    summary = _event_summary(event, "", localized_terms, play_language)
    return f"- {session_id}: {summary}".rstrip()


def _format_feedback(
    event: dict[str, Any],
    localized_terms: dict[str, str] | None = None,
    play_language: str = "en-US",
) -> str:
    category = event.get("category", "general")
    score = event.get("score", "unscored")
    profile = event.get("player_profile")
    prefix = f"{profile}: " if profile else ""
    text = _event_summary(event, "", localized_terms, play_language)
    return f"- {category}: {score} - {prefix}{text}".rstrip()


def _format_csv(values: Any) -> str:
    if isinstance(values, list) and values:
        return ", ".join(str(value) for value in values)
    return "none recorded"


def _format_chase_location(location: dict[str, Any]) -> str:
    location_id = location.get("id", "unknown")
    tags = [
        str(location[field])
        for field in ["label", "difficulty", "skill"]
        if location.get(field) not in (None, "", [], {})
    ]
    return f"  - {location_id} [{', '.join(tags)}]" if tags else f"  - {location_id}"


def _format_chase_tracker(chase_state: dict[str, Any]) -> list[str]:
    if not chase_state:
        return []

    lines = [
        f"- Chase ID: {chase_state.get('chase_id', 'unknown')}",
        f"- Status: {chase_state.get('status', 'unknown')}",
        f"- Round: {chase_state.get('round', 'unknown')}",
    ]
    dex_order = chase_state.get("dex_order", [])
    if isinstance(dex_order, list) and dex_order:
        lines.append(f"- DEX order: {' -> '.join(str(participant_id) for participant_id in dex_order)}")

    participants = chase_state.get("participants", [])
    if isinstance(participants, list) and participants:
        lines.append("- Participants:")
        for participant in participants:
            if not isinstance(participant, dict):
                continue
            participant_id = participant.get("id", "unknown")
            role = participant.get("role", "unknown")
            base_mov = participant.get("base_mov", "?")
            adjusted_mov = participant.get("adjusted_mov", "?")
            dex = participant.get("dex", "?")
            actions = participant.get("movement_actions", "?")
            position = participant.get("position", "unknown")
            lines.append(
                f"  - {participant_id} | {role} | MOV {base_mov} -> {adjusted_mov} | "
                f"DEX {dex} | actions {actions} | position {position}"
            )

    location_chain = chase_state.get("location_chain", [])
    if isinstance(location_chain, list) and location_chain:
        lines.append("- Location Chain:")
        lines.extend(
            _format_chase_location(location)
            for location in location_chain
            if isinstance(location, dict)
        )

    rounds = chase_state.get("rounds", [])
    if isinstance(rounds, list) and rounds:
        lines.append("- Rounds:")
        for chase_round in rounds:
            if not isinstance(chase_round, dict):
                continue
            round_number = chase_round.get("round", "?")
            summary = chase_round.get("summary", "no summary")
            lines.append(f"  - Round {round_number}: {summary}")

    if chase_state.get("outcome") not in (None, "", [], {}):
        lines.append(f"- Outcome: {chase_state['outcome']}")
    return lines


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
    chase_state = (
        _read_json(context["campaign_dir"] / "save" / "chase.json", {})
        if context["campaign_dir"]
        else {}
    )
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
    language_profile = _selected_language_profile(str(play_language), metadata, campaign)

    actor_names = _localized_actor_names(characters, localized_terms)
    roll_recap_lines = [
        _format_roll_recap(event, actor_names, localized_terms, str(play_language), language_profile)
        for event in rolls
    ]
    transcript_lines: list[str] = []
    actual_play_lines: list[str] = []
    roll_cursor = 0
    for event in transcript:
        rendered_text = _localized_event_text(event, localized_terms, str(play_language))
        if event.get("mode") == "roll":
            roll_count = _event_roll_count(event, len(roll_recap_lines) - roll_cursor)
            recaps = roll_recap_lines[roll_cursor: roll_cursor + roll_count]
            rendered_text = _format_roll_transcript_text(event, recaps)
            roll_cursor += roll_count
        transcript_lines.extend(_format_transcript_event(event, rendered_text))
        actual_play_lines.extend(_format_actual_play_event(event, rendered_text))
    roll_lines = [_format_roll(event) for event in rolls]
    state_lines = [
        _format_state_event(event, localized_terms, str(play_language))
        for event in state_events
    ]
    decision_lines = [
        _format_decision(event, localized_terms, str(play_language))
        for event in state_events
        if event.get("type") == "decision"
    ]
    clue_lines = [
        _format_clue(event, localized_terms, str(play_language))
        for event in state_events
        if event.get("type") == "clue"
    ]
    scene_replay_lines = [
        _format_scene_replay_event(event, localized_terms, str(play_language))
        for event in _scene_replay_events(state_events)
    ]
    combat_lines = [
        _format_subsystem_event(event, localized_terms, str(play_language))
        for event in state_events
        if event.get("type") == "combat"
    ]
    chase_lines = [
        _format_subsystem_event(event, localized_terms, str(play_language))
        for event in state_events
        if event.get("type") == "chase"
    ]
    sanity_lines = [
        _format_subsystem_event(event, localized_terms, str(play_language))
        for event in state_events
        if event.get("type") in {"sanity", "bout_of_madness"}
    ]
    ending_lines = [
        _format_subsystem_event(event, localized_terms, str(play_language))
        for event in state_events
        if event.get("type") == "session_ending"
    ]
    character_lines: list[str] = []
    for character in characters:
        character_lines.extend(_format_character(character, localized_terms))
    chronicle_lines: list[str] = []
    for character in characters:
        chronicle_lines.extend(_format_investigator_chronicle(character, localized_terms, str(play_language)))
    recap_lines = [
        _format_session_summary(event, localized_terms, str(play_language))
        for event in session_summaries
    ]
    feedback_lines = [
        _format_feedback(event, localized_terms, str(play_language))
        for event in player_feedback
    ]
    chase_tracker_lines = _format_chase_tracker(chase_state)

    body = [
        "# Battle Report",
        "",
        "## Run Setup",
        f"- Run ID: {metadata.get('run_id', 'unknown')}",
        f"- Campaign: {_localize_text(campaign_title, localized_terms)}",
        f"- Era: {era}",
        f"- Dice Mode: {dice_mode}",
        f"- Spoiler Policy: {spoiler_policy}",
        f"- Play Language: {play_language}",
        f"- Language Profile: {language_profile.get('display_name', play_language)}",
        f"- Localized Terms: {_format_localized_terms_summary(localized_terms)}",
        f"- Player Profile: {metadata.get('player_profile', 'unknown')}",
        "",
        "## Module",
        f"- Scenario: {_localize_text(scenario_title, localized_terms)}",
        f"- Scenario ID: {scenario_id}",
        f"- Source: {module_source}",
        f"- Opening Scene: {_localize_text(scenario.get('opening_scene', 'not recorded'), localized_terms)}",
        "",
        "## Character Dossier",
        *_list_lines(character_lines, "- No character sheets recorded."),
        "",
        "## Investigator Chronicle",
        *_list_lines(chronicle_lines, "- No investigator chronicle recorded."),
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
        "## Chase Tracker",
        *_list_lines(chase_tracker_lines, "- No chase tracker recorded."),
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
        "## Localization Appendix",
        *_list_lines(_format_localization_appendix(localized_terms), "- No localized terms recorded."),
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
