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
    summary = _event_summary(event, "clue recorded", localized_terms, play_language)
    return f"- {summary}"


def _format_subsystem_event(
    event: dict[str, Any],
    localized_terms: dict[str, str] | None = None,
    play_language: str = "en-US",
    actor_names: dict[str, str] | None = None,
) -> str:
    actor = _display_roll_actor(event.get("actor", "unknown"), actor_names or {})
    summary = _event_summary(
        event,
        f"{event.get('type', 'event')} recorded",
        localized_terms,
        play_language,
    )
    if actor and summary.startswith(actor):
        return f"- {summary}"
    return f"- {actor}: {summary}"


def _format_scene_replay_event(
    event: dict[str, Any],
    localized_terms: dict[str, str] | None = None,
    play_language: str = "en-US",
    actor_names: dict[str, str] | None = None,
) -> str:
    terms = localized_terms or {}
    names = actor_names or {}
    event_type = event.get("type", "event")
    if event_type == "scene":
        summary = _event_summary(event, "scene recorded", terms, play_language)
        return f"- {summary}"
    if event_type == "clue":
        summary = _event_summary(event, "clue recorded", terms, play_language)
        return f"- {summary}"
    event_label = event_type.replace("_", " ")
    actor = _display_roll_actor(event.get("actor", "unknown"), names)
    summary = _event_summary(event, f"{event_label} recorded", terms, play_language)
    if actor in {"", "KP", "unknown"} or summary.startswith(actor):
        return f"- {summary}"
    return f"- {actor} - {summary}"


def _scene_replay_events(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [event for event in events if event.get("type") in SCENE_REPLAY_EVENT_TYPES]


def _list_lines(items: list[str], empty: str) -> list[str]:
    return items if items else [empty]


def _empty_report_line(language_profile: dict[str, Any], key: str, fallback: str) -> str:
    empty_lines = language_profile.get("empty_report_lines", {})
    if isinstance(empty_lines, dict) and empty_lines.get(key):
        return str(empty_lines[key])
    return fallback


def _localized_report_label(language_profile: dict[str, Any], group: str, canonical: str) -> str:
    labels = language_profile.get(group, {})
    if isinstance(labels, dict) and labels.get(canonical):
        return str(labels[canonical])
    return canonical


def _report_heading(level: int, canonical: str, language_profile: dict[str, Any]) -> str:
    localized = _localized_report_label(language_profile, "report_heading_labels", canonical)
    suffix = f" / {localized}" if localized != canonical else ""
    return f"{'#' * level} {canonical}{suffix}"


def _report_field(label: str, value: Any, language_profile: dict[str, Any]) -> str:
    localized = _localized_report_label(language_profile, "report_field_labels", label)
    suffix = f"（{localized}）" if localized != label else ""
    return f"- {label}: {value}{suffix}"


def _localized_report_value(value: Any, language_profile: dict[str, Any], localized_terms: dict[str, str]) -> str:
    value_text = str(value)
    labels = language_profile.get("report_value_labels", {})
    if isinstance(labels, dict) and labels.get(value_text):
        return str(labels[value_text])
    return _localize_text(value_text, localized_terms)


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


def _localized_profile_labels(metadata: dict[str, Any]) -> dict[str, str]:
    play_language = metadata.get("play_language")
    labels = metadata.get("player_profile_labels", {})
    language_labels = labels.get(play_language, {}) if isinstance(labels, dict) else {}
    if not isinstance(language_labels, dict):
        return {}
    return {
        str(profile_id): str(label)
        for profile_id, label in language_labels.items()
        if profile_id and label
    }


def _format_localized_terms_summary(terms: dict[str, str], language_profile: dict[str, Any] | None = None) -> str:
    if not terms:
        return "none"
    profile = language_profile or {}
    report_labels = profile.get("report_labels", {})
    template = (
        str(report_labels.get("localized_terms_summary"))
        if isinstance(report_labels, dict) and report_labels.get("localized_terms_summary")
        else "{count} entries (see Localization Appendix)"
    )
    return template.format(count=len(terms))


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


def _format_key_values(
    values: dict[str, Any],
    preferred_order: list[str] | None = None,
    label_for_key: Any | None = None,
) -> str:
    if not values:
        return "none recorded"
    ordered_keys = preferred_order or []
    keys = [key for key in ordered_keys if key in values]
    keys.extend(sorted(key for key in values if key not in keys))
    return ", ".join(f"{label_for_key(key) if label_for_key else key}: {values[key]}" for key in keys)


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


def _character_dossier_label(language_profile: dict[str, Any], canonical: str) -> str:
    return _localized_report_label(language_profile, "character_dossier_labels", canonical)


def _format_backstory(
    backstory: Any,
    localized_terms: dict[str, str],
    language_profile: dict[str, Any],
) -> list[str]:
    if not isinstance(backstory, dict) or not backstory:
        return []

    lines = [f"  - {_character_dossier_label(language_profile, 'Backstory')}:"]
    rendered_keys: set[str] = set()
    for key, label in BACKSTORY_FIELDS:
        value = backstory.get(key)
        if value in (None, "", [], {}):
            continue
        rendered_keys.add(key)
        display_label = _character_dossier_label(language_profile, label)
        lines.append(f"    - {display_label}: {_format_backstory_value(value, localized_terms)}")

    for key in sorted(backstory):
        if key in rendered_keys or backstory.get(key) in (None, "", [], {}):
            continue
        label = key.replace("_", " ").title()
        display_label = _character_dossier_label(language_profile, label)
        lines.append(f"    - {display_label}: {_format_backstory_value(backstory[key], localized_terms)}")
    return lines if len(lines) > 1 else []


def _format_character(
    character: dict[str, Any],
    localized_terms: dict[str, str] | None = None,
    language_profile: dict[str, Any] | None = None,
) -> list[str]:
    terms = localized_terms or {}
    profile = language_profile or {}
    investigator_id = character.get("investigator_id") or character.get("id") or "unknown"
    name = _localize_text(character.get("name") or investigator_id or "Unknown Investigator", terms)
    lines = [f"- {name} ({investigator_id})"]
    if character.get("player_name"):
        lines.append(f"  - {_character_dossier_label(profile, 'Player')}: {character['player_name']}")
    if character.get("occupation"):
        occupation = _localize_text(character["occupation"], terms)
        lines.append(f"  - {_character_dossier_label(profile, 'Occupation')}: {occupation}")
    if character.get("era"):
        lines.append(f"  - {_character_dossier_label(profile, 'Era')}: {character['era']}")
    lines.append(
        f"  - {_character_dossier_label(profile, 'Characteristics')}: "
        + _format_key_values(
            character.get("characteristics", {}),
            ["STR", "CON", "SIZ", "DEX", "APP", "INT", "POW", "EDU"],
        )
    )
    lines.append(
        f"  - {_character_dossier_label(profile, 'Derived')}: "
        + _format_key_values(
            character.get("derived", {}),
            ["HP", "MP", "SAN", "MOV", "damage_bonus", "build"],
            lambda key: _character_dossier_label(profile, key),
        )
    )
    lines.append(f"  - {_character_dossier_label(profile, 'Skills')}: " + _format_key_values(character.get("skills", {})))
    lines.extend(_format_backstory(character.get("backstory"), terms, profile))
    return lines


def _chronicle_label(language_profile: dict[str, Any] | None, canonical: str) -> str:
    return _localized_report_label(language_profile or {}, "chronicle_labels", canonical)


def _chronicle_value(
    value: Any,
    localized_terms: dict[str, str],
    language_profile: dict[str, Any] | None,
) -> str:
    value_text = str(value)
    localized = _chronicle_label(language_profile, value_text)
    if localized != value_text:
        return localized
    return _localize_text(value_text, localized_terms)


def _format_record_value(
    value: Any,
    localized_terms: dict[str, str],
    language_profile: dict[str, Any] | None = None,
) -> str:
    if isinstance(value, list):
        return "; ".join(_format_record_value(item, localized_terms, language_profile) for item in value)
    if isinstance(value, dict):
        parts = [
            f"{_chronicle_label(language_profile, str(key))}: {_format_record_value(child, localized_terms, language_profile)}"
            for key, child in value.items()
            if child not in (None, "", [], {})
        ]
        return "; ".join(parts)
    return _chronicle_value(value, localized_terms, language_profile)


def _localized_record_field(
    record: dict[str, Any],
    key: str,
    localized_terms: dict[str, str],
    play_language: str,
    language_profile: dict[str, Any] | None = None,
) -> str | None:
    localized = _localized_field(record, key, localized_terms, play_language)
    if localized is not None:
        return localized
    if record.get(key) not in (None, "", [], {}):
        return _format_record_value(record[key], localized_terms, language_profile)
    return None


def _format_record_type(value: Any, fallback: str, language_profile: dict[str, Any] | None = None) -> str:
    if value in (None, "", [], {}):
        return _chronicle_label(language_profile, fallback)
    canonical = str(value).replace("_", " ").title()
    return _chronicle_label(language_profile, canonical)


def _format_history_entry(
    record: dict[str, Any],
    localized_terms: dict[str, str],
    play_language: str,
    language_profile: dict[str, Any] | None = None,
) -> list[str]:
    summary = _localized_record_field(record, "summary", localized_terms, play_language, language_profile)
    lines = [f"    - {summary or record.get('type', 'history entry')}"]
    for key, label in [
        ("final_hp", "Final HP"),
        ("final_san", "Final SAN"),
        ("notable_events", "Notable Events"),
        ("unresolved_threads", "Unresolved Threads"),
    ]:
        value = _localized_record_field(record, key, localized_terms, play_language, language_profile)
        if value is not None:
            lines.append(f"      - {_chronicle_label(language_profile, label)}: {value}")
    return lines


def _format_development_entry(
    record: dict[str, Any],
    localized_terms: dict[str, str],
    play_language: str,
    language_profile: dict[str, Any] | None = None,
) -> list[str]:
    title = _format_record_type(record.get("type"), "Development Entry", language_profile)
    lines = [f"    - {title}"]
    for key, label in [
        ("status", "Status"),
        ("skill_checks_earned", "Skill Checks Earned"),
        ("rewards", "Rewards"),
        ("permanent_changes", "Permanent Changes"),
        ("carryover_notes", "Carryover Notes"),
    ]:
        value = _localized_record_field(record, key, localized_terms, play_language, language_profile)
        if value is not None:
            lines.append(f"      - {_chronicle_label(language_profile, label)}: {value}")
    return lines


def _format_inventory_entry(
    record: dict[str, Any],
    localized_terms: dict[str, str],
    play_language: str,
    language_profile: dict[str, Any] | None = None,
) -> list[str]:
    summary = _localized_record_field(record, "summary", localized_terms, play_language, language_profile)
    lines = [f"    - {summary or record.get('type', 'inventory entry')}"]
    for key, label in [("items", "Items"), ("cash", "Cash"), ("notes", "Notes")]:
        value = _localized_record_field(record, key, localized_terms, play_language, language_profile)
        if value is not None:
            lines.append(f"      - {_chronicle_label(language_profile, label)}: {value}")
    return lines


def _format_investigator_chronicle(
    character: dict[str, Any],
    localized_terms: dict[str, str] | None = None,
    play_language: str = "en-US",
    language_profile: dict[str, Any] | None = None,
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
        lines.append(f"  - {_chronicle_label(language_profile, 'History')}:")
        for record in history:
            lines.extend(_format_history_entry(record, terms, play_language, language_profile))
    if development:
        lines.append(f"  - {_chronicle_label(language_profile, 'Development')}:")
        for record in development:
            lines.extend(_format_development_entry(record, terms, play_language, language_profile))
    if inventory:
        lines.append(f"  - {_chronicle_label(language_profile, 'Inventory History')}:")
        for record in inventory:
            lines.extend(_format_inventory_entry(record, terms, play_language, language_profile))
    return lines


def _display_transcript_speaker(
    event: dict[str, Any],
    profile_labels: dict[str, str] | None = None,
    language_profile: dict[str, Any] | None = None,
) -> str:
    role = event.get("role", "unknown")
    speaker_labels = (language_profile or {}).get("speaker_labels", {})
    if role == "keeper_under_test":
        return str(speaker_labels.get("keeper", "KP"))
    if role == "player_simulator":
        player_profile = event.get("player_profile")
        player_label = str(speaker_labels.get("player", "Player"))
        if player_profile:
            display_profile = (profile_labels or {}).get(str(player_profile), str(player_profile))
            return f"{player_label}[{display_profile}]"
        return player_label
    if role == "system":
        return str(speaker_labels.get("system", event.get("speaker") or "system"))
    return event.get("speaker") or role


def _transcript_label(language_profile: dict[str, Any] | None, key: str, fallback: str) -> str:
    labels = (language_profile or {}).get("transcript_labels", {})
    if isinstance(labels, dict) and labels.get(key):
        return str(labels[key])
    return fallback


def _transcript_turn_label(language_profile: dict[str, Any] | None, turn: Any) -> str:
    template = _transcript_label(language_profile, "turn_format", "Turn {turn}")
    return template.format(turn=turn)


def _format_transcript_event(
    event: dict[str, Any],
    rendered_text: str | None = None,
    profile_labels: dict[str, str] | None = None,
    language_profile: dict[str, Any] | None = None,
    localized_terms: dict[str, str] | None = None,
    play_language: str = "en-US",
) -> list[str]:
    speaker = _display_transcript_speaker(event, profile_labels, language_profile)
    terms = localized_terms or {}

    turn = event.get("turn", "?")
    text = rendered_text if rendered_text is not None else event.get("text", "")
    lines = [f"- {_transcript_turn_label(language_profile, turn)} {speaker}: {text}"]
    if event.get("mode"):
        lines.append(f"  - {_transcript_label(language_profile, 'mode', 'Mode')}: {event['mode']}")
    if event.get("intent"):
        intent = _localized_field(event, "intent", terms, play_language) or str(event["intent"])
        lines.append(f"  - {_transcript_label(language_profile, 'intent', 'Intent')}: {intent}")
    if event.get("ruling"):
        ruling = _localized_field(event, "ruling", terms, play_language) or str(event["ruling"])
        lines.append(f"  - {_transcript_label(language_profile, 'ruling', 'Ruling')}: {ruling}")
    return lines


def _format_actual_play_event(
    event: dict[str, Any],
    rendered_text: str | None = None,
    profile_labels: dict[str, str] | None = None,
    language_profile: dict[str, Any] | None = None,
    localized_terms: dict[str, str] | None = None,
    play_language: str = "en-US",
) -> list[str]:
    role = event.get("role", "unknown")
    speaker = _display_transcript_speaker(event, profile_labels, language_profile)
    terms = localized_terms or {}

    turn = event.get("turn", "?")
    text = rendered_text if rendered_text is not None else event.get("text", "")
    if role in {"keeper_under_test", "player_simulator"}:
        lines = [f"- {_transcript_turn_label(language_profile, turn)} {speaker}: \"{text}\""]
    else:
        lines = [f"- {_transcript_turn_label(language_profile, turn)} {speaker}: {text}"]
    if event.get("intent"):
        intent = _localized_field(event, "intent", terms, play_language) or str(event["intent"])
        lines.append(f"  - {_transcript_label(language_profile, 'intent', 'Intent')}: {intent}")
    if event.get("ruling"):
        ruling = _localized_field(event, "ruling", terms, play_language) or str(event["ruling"])
        lines.append(f"  - {_transcript_label(language_profile, 'ruling', 'Ruling')}: {ruling}")
    if event.get("mode") == "roll":
        lines.append(f"  - {_transcript_label(language_profile, 'mode', 'Mode')}: roll")
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
    profile_labels: dict[str, str] | None = None,
    language_profile: dict[str, Any] | None = None,
) -> str:
    category = event.get("category", "general")
    category_label = _localized_report_label(language_profile or {}, "feedback_labels", str(category))
    score = event.get("score", "unscored")
    profile = event.get("player_profile")
    display_profile = (profile_labels or {}).get(str(profile), str(profile)) if profile else ""
    prefix = f"{display_profile}: " if display_profile else ""
    text = _event_summary(event, "", localized_terms, play_language)
    return f"- {category_label}: {score} - {prefix}{text}".rstrip()


def _format_csv(values: Any) -> str:
    if isinstance(values, list) and values:
        return ", ".join(str(value) for value in values)
    return "none recorded"


def _chase_tracker_label(language_profile: dict[str, Any] | None, canonical: str) -> str:
    return _localized_report_label(language_profile or {}, "chase_tracker_labels", canonical)


def _chase_tracker_value(
    value: Any,
    localized_terms: dict[str, str],
    language_profile: dict[str, Any] | None,
) -> str:
    value_text = str(value)
    localized = _chase_tracker_label(language_profile, value_text)
    if localized != value_text:
        return localized
    return _localize_text(value_text, localized_terms)


def _display_chase_location_ref(location_id: Any, localized_terms: dict[str, str]) -> str:
    raw_id = str(location_id or "unknown")
    display = _localize_text(raw_id.replace("-", " "), localized_terms)
    if display == raw_id.replace("-", " "):
        return raw_id
    return f"{display} ({raw_id})"


def _display_chase_participant_ref(
    participant_id: Any,
    participant_names: dict[str, str],
) -> str:
    raw_id = str(participant_id or "unknown")
    display = participant_names.get(raw_id, raw_id)
    if display == raw_id:
        return raw_id
    return f"{display} ({raw_id})"


def _format_chase_location(
    location: dict[str, Any],
    localized_terms: dict[str, str],
    language_profile: dict[str, Any],
) -> str:
    location_id = location.get("id", "unknown")
    difficulty_labels = language_profile.get("difficulty_labels", {})
    tags = [
        (
            _localized_rule_value(location[field], difficulty_labels, localized_terms)
            if field == "difficulty"
            else _chase_tracker_value(location[field], localized_terms, language_profile)
        )
        for field in ["label", "difficulty", "skill"]
        if location.get(field) not in (None, "", [], {})
    ]
    display_location = _display_chase_location_ref(location_id, localized_terms)
    return f"  - {display_location} [{', '.join(tags)}]" if tags else f"  - {display_location}"


def _format_chase_round_summary(
    chase_round: dict[str, Any],
    localized_terms: dict[str, str],
    play_language: str,
) -> str:
    localized = _localized_field(chase_round, "summary", localized_terms, play_language)
    if localized is not None:
        return localized
    return _localize_text(chase_round.get("summary", "no summary"), localized_terms)


def _format_chase_tracker(
    chase_state: dict[str, Any],
    localized_terms: dict[str, str] | None = None,
    play_language: str = "en-US",
    actor_names: dict[str, str] | None = None,
    language_profile: dict[str, Any] | None = None,
) -> list[str]:
    if not chase_state:
        return []

    terms = localized_terms or {}
    profile = language_profile or {}
    participant_names = {
        str(participant.get("id")): _localize_text(participant.get("name") or participant.get("id"), terms)
        for participant in chase_state.get("participants", [])
        if isinstance(participant, dict) and participant.get("id") not in (None, "", [], {})
    }
    participant_names.update(actor_names or {})

    lines = [
        f"- {_chase_tracker_label(profile, 'Chase ID')}: {chase_state.get('chase_id', 'unknown')}",
        f"- {_chase_tracker_label(profile, 'Status')}: {_chase_tracker_value(chase_state.get('status', 'unknown'), terms, profile)}",
        f"- {_chase_tracker_label(profile, 'Round')}: {chase_state.get('round', 'unknown')}",
    ]
    dex_order = chase_state.get("dex_order", [])
    if isinstance(dex_order, list) and dex_order:
        order = " -> ".join(_display_chase_participant_ref(participant_id, participant_names) for participant_id in dex_order)
        lines.append(f"- {_chase_tracker_label(profile, 'DEX order')}: {order}")

    participants = chase_state.get("participants", [])
    if isinstance(participants, list) and participants:
        lines.append(f"- {_chase_tracker_label(profile, 'Participants')}:")
        for participant in participants:
            if not isinstance(participant, dict):
                continue
            participant_id = participant.get("id", "unknown")
            participant_display = _display_chase_participant_ref(participant_id, participant_names)
            role = _chase_tracker_value(participant.get("role", "unknown"), terms, profile)
            base_mov = participant.get("base_mov", "?")
            adjusted_mov = participant.get("adjusted_mov", "?")
            dex = participant.get("dex", "?")
            actions = participant.get("movement_actions", "?")
            position = _display_chase_location_ref(participant.get("position", "unknown"), terms)
            lines.append(
                f"  - {participant_display} | {role} | MOV {base_mov} -> {adjusted_mov} | "
                f"DEX {dex} | {_chase_tracker_label(profile, 'movement_actions')} {actions} | "
                f"{_chase_tracker_label(profile, 'position')} {position}"
            )

    location_chain = chase_state.get("location_chain", [])
    if isinstance(location_chain, list) and location_chain:
        lines.append(f"- {_chase_tracker_label(profile, 'Location Chain')}:")
        lines.extend(
            _format_chase_location(location, terms, profile)
            for location in location_chain
            if isinstance(location, dict)
        )

    rounds = chase_state.get("rounds", [])
    if isinstance(rounds, list) and rounds:
        lines.append(f"- {_chase_tracker_label(profile, 'Rounds')}:")
        round_template = _chase_tracker_label(profile, "round_format")
        for chase_round in rounds:
            if not isinstance(chase_round, dict):
                continue
            round_number = chase_round.get("round", "?")
            summary = _format_chase_round_summary(chase_round, terms, play_language)
            round_label = round_template.format(round=round_number)
            lines.append(f"  - {round_label}: {summary}")

    if chase_state.get("outcome") not in (None, "", [], {}):
        outcome = _chase_tracker_value(chase_state["outcome"], terms, profile)
        lines.append(f"- {_chase_tracker_label(profile, 'Outcome')}: {outcome}")
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
    profile_labels = _localized_profile_labels(metadata)

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
        transcript_lines.extend(_format_transcript_event(
            event,
            rendered_text,
            profile_labels,
            language_profile,
            localized_terms,
            str(play_language),
        ))
        actual_play_lines.extend(_format_actual_play_event(
            event,
            rendered_text,
            profile_labels,
            language_profile,
            localized_terms,
            str(play_language),
        ))
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
        _format_scene_replay_event(event, localized_terms, str(play_language), actor_names)
        for event in _scene_replay_events(state_events)
    ]
    combat_lines = [
        _format_subsystem_event(event, localized_terms, str(play_language), actor_names)
        for event in state_events
        if event.get("type") == "combat"
    ]
    chase_lines = [
        _format_subsystem_event(event, localized_terms, str(play_language), actor_names)
        for event in state_events
        if event.get("type") == "chase"
    ]
    sanity_lines = [
        _format_subsystem_event(event, localized_terms, str(play_language), actor_names)
        for event in state_events
        if event.get("type") in {"sanity", "bout_of_madness"}
    ]
    ending_lines = [
        _format_subsystem_event(event, localized_terms, str(play_language), actor_names)
        for event in state_events
        if event.get("type") == "session_ending"
    ]
    character_lines: list[str] = []
    for character in characters:
        character_lines.extend(_format_character(character, localized_terms, language_profile))
    chronicle_lines: list[str] = []
    for character in characters:
        chronicle_lines.extend(_format_investigator_chronicle(
            character,
            localized_terms,
            str(play_language),
            language_profile,
        ))
    recap_lines = [
        _format_session_summary(event, localized_terms, str(play_language))
        for event in session_summaries
    ]
    feedback_lines = [
        _format_feedback(event, localized_terms, str(play_language), profile_labels, language_profile)
        for event in player_feedback
    ]
    chase_tracker_lines = _format_chase_tracker(
        chase_state,
        localized_terms,
        str(play_language),
        actor_names,
        language_profile,
    )

    body = [
        _report_heading(1, "Battle Report", language_profile),
        "",
        _report_heading(2, "Run Setup", language_profile),
        _report_field("Run ID", metadata.get("run_id", "unknown"), language_profile),
        _report_field("Campaign", _localize_text(campaign_title, localized_terms), language_profile),
        _report_field("Era", era, language_profile),
        _report_field("Dice Mode", _localized_report_value(dice_mode, language_profile, localized_terms), language_profile),
        _report_field("Spoiler Policy", _localized_report_value(spoiler_policy, language_profile, localized_terms), language_profile),
        _report_field("Play Language", play_language, language_profile),
        _report_field(
            "Language Profile",
            _localized_report_value(language_profile.get("display_name", play_language), language_profile, localized_terms),
            language_profile,
        ),
        _report_field("Localized Terms", _format_localized_terms_summary(localized_terms, language_profile), language_profile),
        _report_field(
            "Player Profile",
            _localized_report_value(metadata.get("player_profile", "unknown"), language_profile, localized_terms),
            language_profile,
        ),
        "",
        _report_heading(2, "Module", language_profile),
        _report_field("Scenario", _localize_text(scenario_title, localized_terms), language_profile),
        _report_field("Scenario ID", scenario_id, language_profile),
        _report_field("Source", _localize_text(module_source, localized_terms), language_profile),
        _report_field("Opening Scene", _localize_text(scenario.get("opening_scene", "not recorded"), localized_terms), language_profile),
        "",
        _report_heading(2, "Character Dossier", language_profile),
        *_list_lines(character_lines, "- No character sheets recorded."),
        "",
        _report_heading(2, "Investigator Chronicle", language_profile),
        *_list_lines(chronicle_lines, "- No investigator chronicle recorded."),
        "",
        _report_heading(2, "Scene-by-Scene Replay", language_profile),
        *_list_lines(scene_replay_lines, "- No scene replay recorded."),
        "",
        _report_heading(2, "Actual Play Replay", language_profile),
        *_list_lines(actual_play_lines, "- No actual play events recorded."),
        "",
        _report_heading(2, "Session Transcript", language_profile),
        *_list_lines(transcript_lines, "- No transcript events recorded."),
        "",
        _report_heading(2, "Major Player Decisions", language_profile),
        *_list_lines(decision_lines, "- No major decisions recorded."),
        "",
        _report_heading(2, "Rules & Rolls Recap", language_profile),
        *_list_lines(roll_recap_lines, "- No roll recap recorded."),
        "",
        _report_heading(2, "Mechanical Log", language_profile),
        _report_heading(3, "Important Rolls", language_profile),
        *_list_lines(roll_lines, "- No rolls recorded."),
        "",
        _report_heading(3, "State Changes", language_profile),
        *_list_lines(state_lines, "- No state changes recorded."),
        "",
        _report_heading(2, "Combat Summary", language_profile),
        *_list_lines(
            combat_lines,
            _empty_report_line(language_profile, "combat_summary", "- No combat summary recorded."),
        ),
        "",
        _report_heading(2, "Chase Summary", language_profile),
        *_list_lines(
            chase_lines,
            _empty_report_line(language_profile, "chase_summary", "- No chase summary recorded."),
        ),
        "",
        _report_heading(2, "Chase Tracker", language_profile),
        *_list_lines(
            chase_tracker_lines,
            _empty_report_line(language_profile, "chase_tracker", "- No chase tracker recorded."),
        ),
        "",
        _report_heading(2, "Sanity Summary", language_profile),
        *_list_lines(
            sanity_lines,
            _empty_report_line(language_profile, "sanity_summary", "- No sanity summary recorded."),
        ),
        "",
        _report_heading(2, "Clues Found", language_profile),
        *_list_lines(clue_lines, "- No clues recorded."),
        "",
        _report_heading(2, "Session Ending", language_profile),
        *_list_lines(ending_lines, "- Session ending not recorded."),
        "",
        _report_heading(2, "Story Recap", language_profile),
        *_list_lines(recap_lines, "- No story recap recorded."),
        "",
        _report_heading(2, "Player Feedback On KP", language_profile),
        *_list_lines(feedback_lines, "- No player feedback recorded."),
        "",
        _report_heading(2, "Localization Appendix", language_profile),
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
