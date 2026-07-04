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

from coc_language import BASE_REPORT_LABELS
from coc_language import language_profile as build_language_profile


SCENE_REPLAY_EVENT_TYPES = {
    "scene",
    "clue",
    "damage",
    "sanity",
    "bout_of_madness",
    "combat",
    "chase",
    "item_transfer",
    "resource_change",
    "status",
    "session_ending",
}
CJK_BOUNDARY_SPACE = re.compile(r"(?<=[\u4e00-\u9fff·》」』”）]) (?=[\u4e00-\u9fff《「『“（])")
CJK_SENTENCE_PERIOD = re.compile(r"(?<=[\u4e00-\u9fff·》」』”）])\.(?=\s|$)")
DAMAGE_SUMMARY_RE = re.compile(r"^(?P<cause>.+?)造成伤害: (?P<amount>[^；。]+)(?P<tail>[；。].*)$")
TRANSCRIPT_PROTOCOL_WRAPPER_RE = re.compile(
    r"^\[(?P<tag>meta|spoiler_warning)\]\s*(?P<body>.*?)\s*\[/(?P=tag)\]$",
    re.DOTALL,
)


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


def _is_non_percentile_die_roll(event: dict[str, Any]) -> bool:
    payload = event.get("payload", {})
    if not isinstance(payload, dict) or not payload.get("die"):
        return False
    return (
        event.get("type") in {"damage", "reward"}
        or payload.get("damage_kind") not in (None, "", [], {})
        or payload.get("reward_kind") not in (None, "", [], {})
    )


def _die_roll_breakdown(payload: dict[str, Any], labels: dict[str, Any]) -> str:
    die_face = str(labels.get("die_face", "die roll"))
    die_rolls = payload.get("die_rolls")
    flat_modifier = payload.get("flat_modifier", 0)
    if isinstance(die_rolls, list) and die_rolls:
        parts = [str(roll) for roll in die_rolls]
        if isinstance(flat_modifier, int | float) and flat_modifier:
            parts.append(f"{flat_modifier:g}")
        return f"{die_face} {' + '.join(parts).replace('+ -', '- ')}"
    return f"{die_face} {payload.get('roll', '?')}"


def _format_die_roll_line(
    event: dict[str, Any],
    skill: str,
    actor: str,
    outcome: str,
    labels: dict[str, Any],
) -> str:
    payload = event.get("payload", {})
    template = labels.get(
        "die_roll_sentence",
        "- {skill}: {actor} rolled {die} = {roll} ({breakdown}) -> {outcome}",
    )
    return str(template).format(
        skill=skill,
        actor=actor,
        die=payload.get("die", "?"),
        roll=payload.get("roll", "?"),
        breakdown=_die_roll_breakdown(payload, labels),
        outcome=outcome,
    )


def _format_roll_source_line(event: dict[str, Any]) -> str:
    payload = event.get("payload", {})
    skill = payload.get("skill", "check")
    actor = event.get("actor", "unknown")
    roll = payload.get("roll", "?")
    target = payload.get("effective_target", payload.get("target", "?"))
    outcome = payload.get("outcome", "unknown")
    if _is_non_percentile_die_roll(event):
        return _format_die_roll_line(
            event,
            str(skill),
            str(actor),
            str(outcome),
            BASE_REPORT_LABELS,
        ).removeprefix("- ").strip()
    return f"{skill}: {actor} rolled {roll} vs {target} -> {outcome}"


def _format_roll(event: dict[str, Any]) -> str:
    payload = event.get("payload", {})
    lines = [f"- {_format_roll_source_line(event)}"]
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
    if payload.get("san_before") not in (None, "", [], {}) and payload.get("san_after") not in (None, "", [], {}):
        lines.append(f"  - SAN Change: {payload['san_before']} -> {payload['san_after']}")
    if isinstance(payload.get("rule_refs"), list) and payload["rule_refs"]:
        rule_refs = ", ".join(str(ref) for ref in payload["rule_refs"] if isinstance(ref, str))
        if rule_refs:
            lines.append(f"  - Rule Refs: {rule_refs}")
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


def _localized_visible_field(
    container: dict[str, Any],
    key: str,
    localized_terms: dict[str, str],
    play_language: str,
) -> str | None:
    localized = _localized_field(container, key, localized_terms, play_language)
    if localized is not None:
        return localized
    value = container.get(key)
    if value in (None, "", [], {}):
        return None
    return _localize_text(str(value), localized_terms)


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
    if play_language in {"", "unknown", "en-US"} and not has_language_specific_payload:
        return _format_roll(event)

    payload = event.get("payload", {})
    report_labels = language_profile.get("report_labels", {})
    outcome_labels = language_profile.get("outcome_labels", {})
    difficulty_labels = language_profile.get("difficulty_labels", {})
    allow_raw_fallback = bool(language_profile.get("raw_payload_fallback"))
    skill = _display_skill_name(payload.get("skill", "check"), localized_terms)
    actor = _display_roll_actor(event.get("actor", "unknown"), actor_names)
    roll = payload.get("roll", "?")
    target = payload.get("effective_target", payload.get("target", "?"))
    outcome = _localized_rule_value(payload.get("outcome", "unknown"), outcome_labels, localized_terms)
    if _is_non_percentile_die_roll(event):
        lines = [
            _format_die_roll_line(
                event,
                skill,
                actor,
                outcome,
                report_labels,
            )
        ]
    else:
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
    if payload.get("san_before") not in (None, "", [], {}) and payload.get("san_after") not in (None, "", [], {}):
        lines.append(
            f"  - {report_labels.get('san_change', 'SAN Change')}："
            f"{payload['san_before']} -> {payload['san_after']}"
        )
    if isinstance(payload.get("rule_refs"), list) and payload["rule_refs"]:
        rule_refs = ", ".join(str(ref) for ref in payload["rule_refs"] if isinstance(ref, str))
        if rule_refs:
            lines.append(f"  <!-- rule-refs: {rule_refs} -->")
    return "\n".join(lines)


def _format_roll_mechanical(
    event: dict[str, Any],
    actor_names: dict[str, str],
    localized_terms: dict[str, str],
    play_language: str,
    language_profile: dict[str, Any],
) -> str:
    canonical = _format_roll(event)
    localized = _format_roll_recap(event, actor_names, localized_terms, play_language, language_profile)
    if localized == canonical:
        return canonical
    source_line = canonical.splitlines()[0].removeprefix("- ").strip() if canonical.splitlines() else ""
    if not source_line or source_line in localized:
        return localized
    lines = localized.splitlines()
    if not lines:
        return localized
    return "\n".join([lines[0], f"  <!-- roll-source: {source_line} -->", *lines[1:]])


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


def _format_roll_transcript_text(
    event: dict[str, Any],
    roll_recaps: list[str],
    localized_terms: dict[str, str] | None = None,
    play_language: str = "en-US",
) -> str | None:
    if event.get("mode") != "roll" or not roll_recaps:
        return None
    terms = localized_terms or {}
    text = _join_roll_recap_summaries(roll_recaps)
    outcome_note = _localized_field(event, "outcome_note", terms, play_language)
    if outcome_note is None:
        outcome_note = _localize_text(str(event.get("outcome_note", "")).strip(), terms)
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
    actor_names: dict[str, str] | None = None,
) -> str:
    terms = localized_terms or {}
    event_type = event.get("type", "event")
    event_label = event_type.replace("_", " ")
    payload = event.get("payload", {})
    if play_language not in {"", "unknown", "en-US"}:
        summary = _payload_summary(event, terms, play_language)
        if summary:
            return f"- {summary}"
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
    summary = _naturalize_player_event_summary(str(event.get("type", "event")), actor, summary)
    return f"- {summary}"


def _format_bout_of_madness_round_lines(
    event: dict[str, Any],
    localized_terms: dict[str, str] | None = None,
    play_language: str = "en-US",
) -> list[str]:
    terms = localized_terms or {}
    payload = event.get("payload", {})
    rounds = payload.get("rounds", [])
    if not isinstance(rounds, list):
        return []

    lines: list[str] = []
    for round_entry in rounds:
        if not isinstance(round_entry, dict):
            continue
        summary = _localized_visible_field(round_entry, "summary", terms, play_language)
        if summary:
            lines.append(f"- {summary}")
    return lines


def _format_subsystem_event_lines(
    event: dict[str, Any],
    localized_terms: dict[str, str] | None = None,
    play_language: str = "en-US",
    actor_names: dict[str, str] | None = None,
) -> list[str]:
    lines = [_format_subsystem_event(event, localized_terms, play_language, actor_names)]
    if event.get("type") == "bout_of_madness":
        lines.extend(_format_bout_of_madness_round_lines(event, localized_terms, play_language))
    return lines


def _naturalize_player_event_summary(event_type: str, actor: str, summary: str) -> str:
    if event_type == "damage" and actor not in {"", "KP", "unknown"} and actor not in summary:
        match = DAMAGE_SUMMARY_RE.match(summary)
        if match:
            return (
                f"{match.group('cause')}造成{actor} {match.group('amount').strip()} 伤害"
                f"{match.group('tail')}"
            )
    if event_type == "chase" and actor not in {"", "KP", "unknown"}:
        _label, separator, detail = summary.partition("：")
        if separator and detail.startswith(actor):
            return detail
    return summary


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
    summary = _naturalize_player_event_summary(str(event_type), actor, summary)
    return f"- {summary}"


def _format_scene_replay_event_lines(
    event: dict[str, Any],
    localized_terms: dict[str, str] | None = None,
    play_language: str = "en-US",
    actor_names: dict[str, str] | None = None,
) -> list[str]:
    lines = [_format_scene_replay_event(event, localized_terms, play_language, actor_names)]
    if event.get("type") != "bout_of_madness":
        return lines

    lines.extend(_format_bout_of_madness_round_lines(event, localized_terms, play_language))
    return lines


def _format_handout(
    handout: dict[str, Any],
    localized_terms: dict[str, str],
    play_language: str,
) -> str:
    label = _localized_visible_field(handout, "label", localized_terms, play_language)
    title = _localized_visible_field(handout, "title", localized_terms, play_language)
    summary = _localized_visible_field(handout, "summary", localized_terms, play_language)
    content = _localized_visible_field(handout, "content", localized_terms, play_language)
    route = _localized_visible_field(handout, "route", localized_terms, play_language)

    if label and title:
        separator = "：" if play_language == "zh-Hans" else ": "
        line = f"- {label}{separator}{title}"
    else:
        line = f"- {title or label or summary or route or 'handout recorded'}"

    details = [detail for detail in (summary, route) if detail and detail not in line]
    if details:
        detail_separator = "；" if play_language == "zh-Hans" else "; "
        line = f"{line} — {detail_separator.join(details)}"
    if content and content not in line:
        line = f"{line}\n  - {content}"
    return line


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
    if localized != canonical:
        return f"{'#' * level} {localized} <!-- report-anchor: {canonical} -->"
    return f"{'#' * level} {canonical}"


def _report_field(label: str, value: Any, language_profile: dict[str, Any]) -> str:
    localized = _localized_report_label(language_profile, "report_field_labels", label)
    if localized != label:
        return f"- {localized}: {value} <!-- field-anchor: {label} -->"
    return f"- {label}: {value}"


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
        else "{count} entries (recorded in playtest.json)"
    )
    return template.format(count=len(terms))


def _localize_text(text: Any, terms: dict[str, str]) -> str:
    localized = str(text)
    for canonical, replacement in sorted(terms.items(), key=lambda item: len(item[0]), reverse=True):
        localized = localized.replace(canonical, replacement)
    localized = CJK_BOUNDARY_SPACE.sub("", localized)
    return CJK_SENTENCE_PERIOD.sub("。", localized)


def _html_anchor(key: str, value: Any) -> str:
    value_text = str(value).replace("--", "-")
    return f"<!-- {key}: {value_text} -->"


def _display_skill_name(skill: Any, localized_terms: dict[str, str]) -> str:
    return _localize_text(skill, localized_terms)


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
            character["_history"] = _read_jsonl(path.parent / "history.jsonl")
            character["_development"] = _read_jsonl(path.parent / "development.jsonl")
            character["_inventory_history"] = _read_jsonl(path.parent / "inventory-history.jsonl")
            characters.append(character)

    if characters or not sandbox_investigators.exists():
        return characters

    for path in sorted(sandbox_investigators.glob("*/character.json")):
        character = _read_json(path, {})
        if character:
            character["_creation"] = _read_json(path.parent / "creation.json", {})
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
    lines = [f"- {name} {_html_anchor('investigator-id', investigator_id)}"]
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
    thresholds = character.get("characteristic_thresholds", {})
    if isinstance(thresholds, dict) and thresholds:
        lines.append(
            f"  - {_character_dossier_label(profile, 'Characteristic Half/Fifth Values')}: "
            f"{_format_characteristic_half_fifth_values(thresholds)}"
        )
    lines.append(
        f"  - {_character_dossier_label(profile, 'Derived')}: "
        + _format_key_values(
            character.get("derived", {}),
            ["HP", "MP", "SAN", "MOV", "damage_bonus", "build"],
            lambda key: _character_dossier_label(profile, key),
        )
    )
    lines.append(
        f"  - {_character_dossier_label(profile, 'Skills')}: "
        + _format_key_values(
            character.get("skills", {}),
            label_for_key=lambda key: _display_skill_name(key, terms),
        )
    )
    skill_thresholds = character.get("skill_thresholds", {})
    if isinstance(skill_thresholds, dict) and skill_thresholds:
        lines.append(
            f"  - {_character_dossier_label(profile, 'Skill Half/Fifth Values')}: "
            f"{_format_skill_half_fifth_values(skill_thresholds, terms)}"
        )
    lines.extend(_format_backstory(character.get("backstory"), terms, profile))
    return lines


def _creation_label(language_profile: dict[str, Any] | None, canonical: str) -> str:
    return _localized_report_label(language_profile or {}, "creation_labels", canonical)


def _format_characteristic_creation_values(creation: dict[str, Any]) -> str:
    values = creation.get("characteristics", {})
    if not isinstance(values, dict):
        return "none recorded"
    ordered = ["STR", "CON", "SIZ", "DEX", "APP", "INT", "POW", "EDU", "LUCK"]
    parts: list[str] = []
    for key in ordered:
        value = values.get(key)
        if isinstance(value, dict) and value.get("final") not in (None, "", [], {}):
            parts.append(f"{key} {value['final']}")
    for key in sorted(values):
        if key in ordered:
            continue
        value = values[key]
        if isinstance(value, dict) and value.get("final") not in (None, "", [], {}):
            parts.append(f"{key} {value['final']}")
    return ", ".join(parts) if parts else "none recorded"


def _format_characteristic_half_fifth_values(values: dict[str, Any]) -> str:
    if not isinstance(values, dict):
        return "none recorded"
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
    return ", ".join(parts) if parts else "none recorded"


def _format_skill_half_fifth_values(values: dict[str, Any], localized_terms: dict[str, str]) -> str:
    if not isinstance(values, dict):
        return "none recorded"
    parts: list[str] = []
    for skill in sorted(values):
        value = values[skill]
        if not isinstance(value, dict):
            continue
        half = value.get("half")
        fifth = value.get("fifth")
        if half not in (None, "", [], {}) and fifth not in (None, "", [], {}):
            parts.append(f"{_display_skill_name(skill, localized_terms)} {half}/{fifth}")
    return ", ".join(parts) if parts else "none recorded"


def _format_formula_points(formula: Any, points: Any) -> str:
    if formula in (None, "", [], {}):
        return str(points) if points not in (None, "", [], {}) else "none recorded"
    if points in (None, "", [], {}):
        return str(formula)
    return f"{formula} = {points}"


def _format_creation_age(
    creation: dict[str, Any],
    language_profile: dict[str, Any] | None,
    play_language: str,
) -> list[str]:
    age = creation.get("age", {})
    if not isinstance(age, dict) or not age:
        return []

    years = age.get("years", age.get("value"))
    age_range = age.get("range")
    lines: list[str] = []
    age_label = _creation_label(language_profile, "Age")
    if years not in (None, "", [], {}):
        if age_range not in (None, "", [], {}):
            if play_language == "zh-Hans":
                lines.append(f"  - {age_label}: {years}（{age_range} 岁）")
            elif play_language == "ja-JP":
                lines.append(f"  - {age_label}: {years}（{age_range}歳）")
            else:
                lines.append(f"  - {age_label}: {years} ({age_range})")
        else:
            lines.append(f"  - {age_label}: {years}")

    adjustment_label = _creation_label(language_profile, "Age Adjustments")
    required_checks = age.get("edu_improvement_checks_required", 0)
    checks = age.get("edu_improvement_checks", [])
    reductions = age.get("characteristic_reductions", [])
    if not isinstance(checks, list):
        checks = []
    if not isinstance(reductions, list):
        reductions = []

    if required_checks or checks or reductions:
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
            lines.append(f"  - {adjustment_label}: {'；'.join(parts)}。")
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
            lines.append(f"  - {adjustment_label}: {'；'.join(parts)}。")
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
            lines.append(f"  - {adjustment_label}: {'; '.join(parts)}.")

    return lines


def _format_creation_credit_rating(
    creation: dict[str, Any],
    language_profile: dict[str, Any] | None,
    play_language: str,
) -> str | None:
    occupation = creation.get("occupation", {})
    finances = creation.get("finances", {})
    if not isinstance(occupation, dict) or not isinstance(finances, dict):
        return None
    credit_rating = finances.get("credit_rating")
    if credit_rating in (None, "", [], {}):
        return None
    rating_range = occupation.get("credit_rating_range")
    label = _creation_label(language_profile, "Credit Rating")
    if rating_range in (None, "", [], {}):
        return f"  - {label}: {credit_rating}"
    range_label = _creation_label(language_profile, "Rulebook Occupation Range")
    if play_language == "zh-Hans":
        return f"  - {label}: {credit_rating}（{range_label} {rating_range}）"
    return f"  - {label}: {credit_rating} ({range_label} {rating_range})"


def _format_money_value(value: Any, play_language: str) -> str | None:
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


def _format_living_standard(value: Any, play_language: str) -> str:
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


def _format_creation_finances(
    creation: dict[str, Any],
    language_profile: dict[str, Any] | None,
    play_language: str,
) -> list[str]:
    finances = creation.get("finances", {})
    if not isinstance(finances, dict):
        return []
    lines: list[str] = []
    if finances.get("living_standard") not in (None, "", [], {}):
        lines.append(
            f"  - {_creation_label(language_profile, 'Living Standard')}: "
            f"{_format_living_standard(finances['living_standard'], play_language)}"
        )
    for key, label in [
        ("cash", "Cash"),
        ("assets", "Assets"),
        ("spending_level", "Spending Level"),
    ]:
        if finances.get(key) in (None, "", [], {}):
            continue
        value = _format_money_value(finances[key], play_language)
        if value is not None:
            lines.append(f"  - {_creation_label(language_profile, label)}: {value}")
    return lines


def _format_skill_allocation(
    creation: dict[str, Any],
    localized_terms: dict[str, str],
    language_profile: dict[str, Any] | None,
    play_language: str,
) -> list[str]:
    allocation = creation.get("skill_allocation", {})
    if not isinstance(allocation, dict) or not allocation:
        return []
    occupation_available = creation.get("occupation", {}).get("skill_points_available", "?")
    personal_available = creation.get("personal_interest", {}).get("skill_points_available", "?")
    occupation_spent = allocation.get("occupation_points_spent", "?")
    personal_spent = allocation.get("personal_interest_points_spent", "?")
    unallocated_occupation = allocation.get("unallocated_occupation_points", "?")
    unallocated_personal = allocation.get("unallocated_personal_interest_points", "?")
    skill_allocation_label = _creation_label(language_profile, "Skill Allocation")
    occupation_label = _creation_label(language_profile, "Occupation")
    base_label = _creation_label(language_profile, "Base")
    personal_label = _creation_label(language_profile, "Personal Interest")
    unallocated_label = _creation_label(language_profile, "Unallocated")
    if play_language == "zh-Hans":
        lines = [
            (
                f"  - {skill_allocation_label}: {occupation_label} {occupation_spent}/{occupation_available}，"
                f"{personal_label} {personal_spent}/{personal_available}，"
                f"{unallocated_label} {unallocated_occupation}/{unallocated_personal}"
            )
        ]
    else:
        lines = [
            (
                f"  - {skill_allocation_label}: {occupation_label} {occupation_spent}/{occupation_available}; "
                f"{personal_label} {personal_spent}/{personal_available}; "
                f"{unallocated_label} {unallocated_occupation}/{unallocated_personal}"
            )
        ]
    skills = allocation.get("skills", {})
    if not isinstance(skills, dict):
        return lines
    lines.append(
        f"  - {_creation_label(language_profile, 'Skill Half/Fifth Values')}: "
        f"{_format_skill_half_fifth_values(skills, localized_terms)}"
    )
    preferred = [
        "Credit Rating",
        "Appraise",
        "Art/Craft (Antiques)",
        "History",
        "Library Use",
        "Other Language (Latin)",
        "Persuade",
        "Spot Hidden",
        "Psychology",
        "Charm",
        "Climb",
        "Dodge",
        "Fighting (Brawl)",
        "Firearms (Handgun)",
        "First Aid",
        "Listen",
        "Stealth",
        "Occult",
    ]
    ordered_skills = [skill for skill in preferred if skill in skills]
    ordered_skills.extend(sorted(skill for skill in skills if skill not in ordered_skills))
    for skill in ordered_skills:
        entry = skills.get(skill)
        if not isinstance(entry, dict):
            continue
        display_skill = _display_skill_name(skill, localized_terms)
        lines.append(
            f"    - {display_skill}: {base_label} {entry.get('base', '?')} + "
            f"{occupation_label} {entry.get('occupation_points', 0)} + "
            f"{personal_label} {entry.get('personal_interest_points', 0)} = "
            f"{entry.get('final', '?')}"
        )
    return lines


def _format_equipment(values: Any, localized_terms: dict[str, str]) -> str:
    if not isinstance(values, list) or not values:
        return "none recorded"
    return "; ".join(_localize_text(value, localized_terms) for value in values)


def _format_investigator_creation(
    character: dict[str, Any],
    localized_terms: dict[str, str] | None = None,
    play_language: str = "en-US",
    language_profile: dict[str, Any] | None = None,
) -> list[str]:
    creation = character.get("_creation", {})
    if not isinstance(creation, dict) or not creation:
        return []

    terms = localized_terms or {}
    profile = language_profile or {}
    investigator_id = character.get("investigator_id") or character.get("id") or "unknown"
    name = _localize_text(character.get("name") or investigator_id or "Unknown Investigator", terms)
    lines = [f"- {name} {_html_anchor('investigator-id', investigator_id)}"]
    lines.append(
        f"  - {_creation_label(profile, 'Characteristics')}: "
        f"{_format_characteristic_creation_values(creation)}"
    )
    lines.append(
        f"  - {_creation_label(profile, 'Characteristic Half/Fifth Values')}: "
        f"{_format_characteristic_half_fifth_values(creation.get('characteristics', {}))}"
    )
    lines.extend(_format_creation_age(creation, profile, play_language))
    occupation = creation.get("occupation", {})
    if isinstance(occupation, dict):
        if occupation.get("name") not in (None, "", [], {}):
            lines.append(
                f"  - {_creation_label(profile, 'Occupation')}: "
                f"{_localize_text(occupation['name'], terms)}"
            )
        if occupation.get("skill_point_formula") not in (None, "", [], {}) or occupation.get("skill_points_available") not in (None, "", [], {}):
            lines.append(
                f"  - {_creation_label(profile, 'Occupation Skill Points')}: "
                f"{_format_formula_points(occupation.get('skill_point_formula'), occupation.get('skill_points_available'))}"
            )
    personal_interest = creation.get("personal_interest", {})
    if isinstance(personal_interest, dict) and (
        personal_interest.get("skill_point_formula") not in (None, "", [], {})
        or personal_interest.get("skill_points_available") not in (None, "", [], {})
    ):
        lines.append(
            f"  - {_creation_label(profile, 'Personal Interest Skill Points')}: "
            f"{_format_formula_points(personal_interest.get('skill_point_formula'), personal_interest.get('skill_points_available'))}"
        )
    credit_line = _format_creation_credit_rating(creation, profile, play_language)
    if credit_line:
        lines.append(credit_line)
    lines.extend(_format_creation_finances(creation, profile, play_language))
    lines.extend(_format_skill_allocation(creation, terms, profile, play_language))
    if creation.get("equipment") not in (None, "", [], {}):
        lines.append(
            f"  - {_creation_label(profile, 'Equipment')}: "
            f"{_format_equipment(creation.get('equipment'), terms)}"
        )
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
    lines = [f"- {name} {_html_anchor('investigator-id', investigator_id)}"]
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
    localized_terms: dict[str, str] | None = None,
) -> str:
    role = event.get("role", "unknown")
    speaker_labels = (language_profile or {}).get("speaker_labels", {})
    if role == "keeper_under_test":
        keeper_label = str(speaker_labels.get("keeper", "KP"))
        if event.get("speaker_role") == "npc" and event.get("speaker"):
            npc_name = _localize_text(str(event["speaker"]), localized_terms or {})
            return f"{keeper_label}[{npc_name}]"
        return keeper_label
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


def _transcript_mode_label(language_profile: dict[str, Any] | None, mode: Any) -> str:
    mode_text = str(mode)
    labels = (language_profile or {}).get("transcript_mode_labels", {})
    if isinstance(labels, dict) and labels.get(mode_text):
        return str(labels[mode_text])
    return mode_text


def _display_transcript_text(value: Any) -> str:
    text = str(value or "")
    while True:
        match = TRANSCRIPT_PROTOCOL_WRAPPER_RE.match(text)
        if not match:
            return text
        text = match.group("body").strip()


def _format_transcript_event(
    event: dict[str, Any],
    rendered_text: str | None = None,
    profile_labels: dict[str, str] | None = None,
    language_profile: dict[str, Any] | None = None,
    localized_terms: dict[str, str] | None = None,
    play_language: str = "en-US",
) -> list[str]:
    terms = localized_terms or {}
    speaker = _display_transcript_speaker(event, profile_labels, language_profile, terms)

    turn = event.get("turn", "?")
    text = _display_transcript_text(rendered_text if rendered_text is not None else event.get("text", ""))
    lines = [f"- {_transcript_turn_label(language_profile, turn)} {speaker}: {text}"]
    if event.get("mode"):
        mode = _transcript_mode_label(language_profile, event["mode"])
        lines.append(f"  - {_transcript_label(language_profile, 'mode', 'Mode')}: {mode}")
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
    terms = localized_terms or {}
    speaker = _display_transcript_speaker(event, profile_labels, language_profile, terms)

    turn = event.get("turn", "?")
    text = _display_transcript_text(rendered_text if rendered_text is not None else event.get("text", ""))
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
    if event.get("mode") and event.get("mode") != "play":
        mode = _transcript_mode_label(language_profile, event["mode"])
        lines.append(f"  - {_transcript_label(language_profile, 'mode', 'Mode')}: {mode}")
    return lines


def _format_session_summary(
    event: dict[str, Any],
    localized_terms: dict[str, str] | None = None,
    play_language: str = "en-US",
) -> str:
    summary = _event_summary(event, "", localized_terms, play_language)
    return f"- {summary}".rstrip()


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
    report_labels = (language_profile or {}).get("report_labels", {})
    default_voice = str(report_labels.get("feedback_voice_default", "Player feedback"))
    profile_template = str(report_labels.get("feedback_voice_profile", "{profile} feedback"))
    voice = profile_template.format(profile=display_profile) if display_profile else default_voice
    text = _event_summary(event, "", localized_terms, play_language)
    template = str(report_labels.get("feedback_line", '- {category} {score}/5: {voice}: "{text}"'))
    return template.format(
        category=category_label,
        score=score,
        voice=voice,
        text=text,
    ).rstrip()


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
    return display if display != raw_id.replace("-", " ") else raw_id


def _display_chase_location_audit_ref(location_id: Any, localized_terms: dict[str, str]) -> str:
    raw_id = str(location_id or "unknown")
    display = _display_chase_location_ref(raw_id, localized_terms)
    if display == raw_id:
        return raw_id
    return f"{display} ({raw_id})"


def _display_chase_participant_ref(
    participant_id: Any,
    participant_names: dict[str, str],
) -> str:
    raw_id = str(participant_id or "unknown")
    display = participant_names.get(raw_id, raw_id)
    return display


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
            else (
                _display_skill_name(location[field], localized_terms)
                if field == "skill"
                else _chase_tracker_value(location[field], localized_terms, language_profile)
            )
        )
        for field in ["label", "difficulty", "skill"]
        if location.get(field) not in (None, "", [], {})
    ]
    display_location = _display_chase_location_ref(location_id, localized_terms)
    anchors = " ".join([
        _html_anchor("location-id", location_id),
        _html_anchor("location-ref", _display_chase_location_audit_ref(location_id, localized_terms)),
    ])
    return f"  - {display_location} [{', '.join(tags)}] {anchors}" if tags else f"  - {display_location} {anchors}"


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
        _html_anchor("chase-id", chase_state.get("chase_id", "unknown")),
        _html_anchor("chase-state-file", "save/chase.json"),
        f"- {_chase_tracker_label(profile, 'Status')}: {_chase_tracker_value(chase_state.get('status', 'unknown'), terms, profile)}",
        f"- {_chase_tracker_label(profile, 'Round')}: {chase_state.get('round', 'unknown')}",
    ]
    dex_order = chase_state.get("dex_order", [])
    if isinstance(dex_order, list) and dex_order:
        order = " -> ".join(_display_chase_participant_ref(participant_id, participant_names) for participant_id in dex_order)
        anchors = " ".join(_html_anchor("dex-order-id", participant_id) for participant_id in dex_order)
        lines.append(f"- {_chase_tracker_label(profile, 'DEX order')}: {order} {anchors}")

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
            anchors = " ".join([
                _html_anchor("participant-id", participant_id),
                _html_anchor("position-id", participant.get("position", "unknown")),
                _html_anchor("position-ref", _display_chase_location_audit_ref(participant.get("position", "unknown"), terms)),
            ])
            lines.append(
                f"  - {participant_display} | {role} | MOV {base_mov} -> {adjusted_mov} | "
                f"DEX {dex} | {_chase_tracker_label(profile, 'movement_actions')} {actions} | "
                f"{_chase_tracker_label(profile, 'position')} {position} {anchors}"
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
    handouts = (
        _read_json(context["campaign_dir"] / "scenario" / "handouts.json", [])
        if context["campaign_dir"]
        else []
    )
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
    handout_lines = [
        _format_handout(handout, localized_terms, str(play_language))
        for handout in handouts
        if isinstance(handout, dict)
    ]
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
            rendered_text = _format_roll_transcript_text(event, recaps, localized_terms, str(play_language))
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
    roll_lines = [
        _format_roll_mechanical(event, actor_names, localized_terms, str(play_language), language_profile)
        for event in rolls
    ]
    state_lines = [
        _format_state_event(event, localized_terms, str(play_language), actor_names)
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
        line
        for event in _scene_replay_events(state_events)
        for line in _format_scene_replay_event_lines(
            event,
            localized_terms,
            str(play_language),
            actor_names,
        )
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
        line
        for event in state_events
        if event.get("type") in {"sanity", "bout_of_madness"}
        for line in _format_subsystem_event_lines(
            event,
            localized_terms,
            str(play_language),
            actor_names,
        )
    ]
    ending_lines = [
        _format_subsystem_event(event, localized_terms, str(play_language), actor_names)
        for event in state_events
        if event.get("type") == "session_ending"
    ]
    creation_lines: list[str] = []
    for character in characters:
        creation_lines.extend(_format_investigator_creation(
            character,
            localized_terms,
            str(play_language),
            language_profile,
        ))
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
        _report_field("Campaign ID", metadata.get("campaign_id", "unknown"), language_profile),
        _report_field("Campaign", _localize_text(campaign_title, localized_terms), language_profile),
        _report_field(
            "Audit Profile",
            _localized_report_value(metadata.get("audit_profile", "baseline"), language_profile, localized_terms),
            language_profile,
        ),
        _report_field(
            "Simulation Method",
            _localized_report_value(metadata.get("simulation_method", "not recorded"), language_profile, localized_terms),
            language_profile,
        ),
        _report_field("Era", era, language_profile),
        _report_field("Dice Mode", _localized_report_value(dice_mode, language_profile, localized_terms), language_profile),
        _report_field("Spoiler Policy", _localized_report_value(spoiler_policy, language_profile, localized_terms), language_profile),
        _report_field(
            "Play Language",
            _localized_report_value(language_profile.get("display_name", play_language), language_profile, localized_terms),
            language_profile,
        ),
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
        _html_anchor("scenario-id", scenario_id),
        _report_field("Source", _localize_text(module_source, localized_terms), language_profile),
        _report_field("Opening Scene", _localized_visible_field(scenario, "opening_scene", localized_terms, str(play_language)) or "not recorded", language_profile),
        "",
        _report_heading(2, "Handouts", language_profile),
        *_list_lines(handout_lines, "- No handouts recorded."),
        "",
        _report_heading(2, "Investigator Creation", language_profile),
        *_list_lines(creation_lines, "- No investigator creation recorded."),
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
    recommended_fixes = [
        *metadata.get("recommended_fixes", []),
        *metadata.get("recommendations", []),
    ]
    fix_lines = [f"- {fix}" for fix in recommended_fixes]
    future_lines = [f"- {item}" for item in metadata.get("future_enhancements", [])]
    regression_lines = [f"- {item}" for item in metadata.get("regression_tests", [])]
    failing_note_severities = {"critical", "high", "error", "fail", "failed"}
    overall_result = "FAIL" if failed_lines else "PASS"
    for note in notes:
        severity = str(note.get("severity", "")).lower()
        category = str(note.get("category", "")).lower()
        if severity in failing_note_severities or category == "bug":
            overall_result = "FAIL"
            break

    def format_evidence(note: dict[str, Any]) -> str:
        evidence = note.get("evidence")
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

    def notes_for(*categories: str) -> list[str]:
        accepted = set(categories)
        lines: list[str] = []
        for note in notes:
            if note.get("category") not in accepted:
                continue
            lines.append(f"- [{note.get('severity', 'unknown')}] {note.get('category', 'general')}: {note.get('text', '')}")
            evidence = format_evidence(note)
            if evidence:
                lines.append(f"  - Evidence: {evidence}")
        return lines

    body = [
        "# Evaluation Report",
        "",
        "## Overall Result",
        overall_result,
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
        "## Future Enhancements",
        *_list_lines(future_lines, "- No future enhancements recorded."),
        "",
        "## Regression Tests To Add",
        *_list_lines(regression_lines, "- No regression tests recorded."),
        "",
    ]
    output.write_text("\n".join(body), encoding="utf-8")
    return output
