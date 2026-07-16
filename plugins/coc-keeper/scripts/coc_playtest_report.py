#!/usr/bin/env python3
from __future__ import annotations

from collections import Counter
import hashlib
import json
import os
import re
import secrets
import stat
import sys
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from coc_language import BASE_REPORT_LABELS
from coc_language import default_localized_terms
from coc_language import language_profile as build_language_profile
from coc_language import localize_terms
from coc_eval_contract import roll_visibility
from coc_playtest_evidence import read_evidence_receipt
from coc_playtest_runs import require_final_run_path
from coc_roll import format_percentile_result
import coc_epistemic_metrics


CLUE_EVENT_TYPES = frozenset({"clue", "clue_reveal", "clue_discovered"})
COMBAT_EVENT_TYPES = frozenset({
    "combat",
    "combat_started",
    "combat_turn_resolved",
    "combat_ended",
})
SANITY_EVENT_TYPES = frozenset({"sanity", "sanity_loss", "bout_of_madness"})

SCENE_REPLAY_EVENT_TYPES = {
    "scene",
    *CLUE_EVENT_TYPES,
    "storylet_move",
    "scene_transition",
    "damage",
    *SANITY_EVENT_TYPES,
    *COMBAT_EVENT_TYPES,
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


def _write_report_artifact_atomic(
    run_dir: Path,
    basename: str,
    sibling_basenames: list[str] | str,
    text: str,
) -> Path:
    """Write a fixed report artifact without following attacker-controlled links."""
    allowed = {"battle-report.md", "verification-sample.md", "diagnostic-play-report.md"}
    if basename not in allowed:
        raise ValueError("unsupported report artifact")
    siblings = (
        [sibling_basenames]
        if isinstance(sibling_basenames, str)
        else list(sibling_basenames)
    )
    for sibling in siblings:
        if sibling not in allowed:
            raise ValueError("unsupported report artifact sibling")
    root = run_dir if getattr(run_dir, "_coc_anchored_path", False) else Path(run_dir)
    artifacts = root / "artifacts"
    try:
        artifacts.mkdir(mode=0o755, exist_ok=True)
        named = (
            artifacts._lstat()
            if getattr(artifacts, "_coc_anchored_path", False)
            else os.stat(artifacts, follow_symlinks=False)
        )
    except OSError as exc:
        raise RuntimeError("unsafe playtest artifacts directory") from exc
    if not stat.S_ISDIR(named.st_mode):
        raise RuntimeError("unsafe playtest artifacts directory")
    directory_flag = getattr(os, "O_DIRECTORY", None)
    nofollow_flag = getattr(os, "O_NOFOLLOW", None)
    if directory_flag is None or nofollow_flag is None:
        raise RuntimeError("runtime lacks safe artifact write primitives")
    directory_fd = (
        artifacts._open_dir(artifacts.parts)
        if getattr(artifacts, "_coc_anchored_path", False)
        else os.open(
            artifacts,
            os.O_RDONLY | directory_flag | nofollow_flag | getattr(os, "O_CLOEXEC", 0),
        )
    )
    identity = (named.st_dev, named.st_ino)

    def verify_directory() -> None:
        opened = os.fstat(directory_fd)
        current = (
            artifacts._lstat()
            if getattr(artifacts, "_coc_anchored_path", False)
            else os.stat(artifacts, follow_symlinks=False)
        )
        if (
            not stat.S_ISDIR(opened.st_mode)
            or not stat.S_ISDIR(current.st_mode)
            or (opened.st_dev, opened.st_ino) != identity
            or (current.st_dev, current.st_ino) != identity
        ):
            raise RuntimeError("playtest artifacts directory changed during report write")

    temp_name: str | None = None
    temp_fd: int | None = None
    replaced = False
    try:
        verify_directory()
        for _ in range(16):
            candidate = f".{basename}.{secrets.token_hex(12)}.tmp"
            try:
                temp_fd = os.open(
                    candidate,
                    os.O_WRONLY | os.O_CREAT | os.O_EXCL | nofollow_flag | getattr(os, "O_CLOEXEC", 0),
                    0o600,
                    dir_fd=directory_fd,
                )
                temp_name = candidate
                break
            except FileExistsError:
                continue
        if temp_fd is None or temp_name is None:
            raise RuntimeError("could not allocate safe report temporary file")
        payload = text.encode("utf-8")
        view = memoryview(payload)
        while view:
            view = view[os.write(temp_fd, view):]
        os.fsync(temp_fd)
        os.close(temp_fd)
        temp_fd = None
        verify_directory()
        os.replace(temp_name, basename, src_dir_fd=directory_fd, dst_dir_fd=directory_fd)
        replaced = True
        verify_directory()
        for sibling_basename in siblings:
            if sibling_basename == basename:
                continue
            try:
                os.unlink(sibling_basename, dir_fd=directory_fd)
            except FileNotFoundError:
                pass
        os.fsync(directory_fd)
        verify_directory()
    finally:
        if temp_fd is not None:
            os.close(temp_fd)
        if temp_name is not None and not replaced:
            try:
                os.unlink(temp_name, dir_fd=directory_fd)
            except FileNotFoundError:
                pass
        os.close(directory_fd)
    return artifacts / basename


def _is_non_percentile_die_roll(event: dict[str, Any]) -> bool:
    payload = event.get("payload", {})
    if not isinstance(payload, dict):
        return False
    expression = _roll_dice_expression(payload)
    if expression:
        normalized = expression.upper().replace(" ", "")
        return normalized not in {"D100", "1D100"}
    return (
        event.get("type") in {"damage", "reward"}
        or payload.get("damage_kind") not in (None, "", [], {})
        or payload.get("reward_kind") not in (None, "", [], {})
    )


def _roll_dice_expression(payload: dict[str, Any]) -> str:
    dice = payload.get("dice")
    if isinstance(dice, dict) and dice.get("expression") not in (None, "", [], {}):
        return str(dice["expression"])
    for key in ("die", "die_expression", "expression"):
        if payload.get(key) not in (None, "", [], {}):
            return str(payload[key])
    return ""


def _roll_dice_faces(payload: dict[str, Any]) -> list[int | float]:
    dice = payload.get("dice")
    candidates = [
        dice.get("raw") if isinstance(dice, dict) else None,
        payload.get("die_rolls"),
        payload.get("individual_faces"),
        payload.get("rolls"),
    ]
    for candidate in candidates:
        if isinstance(candidate, list) and candidate and all(
            isinstance(value, int | float) and not isinstance(value, bool)
            for value in candidate
        ):
            return list(candidate)
    return []


def _roll_total(payload: dict[str, Any]) -> Any:
    dice = payload.get("dice")
    if isinstance(dice, dict) and dice.get("total") not in (None, "", [], {}):
        return dice["total"]
    for key in ("roll", "final_total", "total"):
        if payload.get(key) not in (None, "", [], {}):
            return payload[key]
    return "?"


def _roll_display_skill(event: dict[str, Any]) -> str:
    payload = event.get("payload", {})
    if isinstance(payload, dict) and payload.get("skill") not in (None, "", [], {}):
        return str(payload["skill"])
    kind = str(event.get("kind") or "")
    payload_type = str(payload.get("event_type") or "") if isinstance(payload, dict) else ""
    event_type = str(event.get("type") or event.get("event_type") or "")
    if kind == "hp_damage" or event_type == "damage":
        return "HP Damage"
    if kind in {"san_reward", "sanity_reward"}:
        return "SAN Reward"
    if event_type == "reward":
        return "Reward"
    if payload_type == "combat_healing_roll":
        return "HP Healing"
    if payload_type == "resource_change":
        reason = str(payload.get("reason") or "")
        return "Flesh Ward" if reason == "flesh_ward" else "Resource Roll"
    return "Dice"


def _roll_display_outcome(event: dict[str, Any]) -> str:
    payload = event.get("payload", {})
    if isinstance(payload, dict) and payload.get("outcome") not in (None, "", [], {}):
        return str(payload["outcome"])
    kind = str(event.get("kind") or "")
    event_type = str(event.get("type") or event.get("event_type") or "")
    payload_type = str(payload.get("event_type") or "") if isinstance(payload, dict) else ""
    if kind == "hp_damage" or event_type == "damage":
        return "damage_applied"
    if kind in {"san_reward", "sanity_reward"} or event_type == "reward":
        return "reward_applied"
    if payload_type == "combat_healing_roll":
        return "healing_applied"
    if payload_type == "resource_change":
        return "applied"
    return "unknown"


def _die_roll_breakdown(payload: dict[str, Any], labels: dict[str, Any]) -> str:
    die_face = str(labels.get("die_face", "die roll"))
    die_rolls = _roll_dice_faces(payload)
    if die_rolls:
        face_text = f"{die_face} {' + '.join(f'{roll:g}' for roll in die_rolls)}"
        flat_modifier = payload.get("flat_modifier")
        if not isinstance(flat_modifier, int | float) or isinstance(flat_modifier, bool):
            total = _roll_total(payload)
            if isinstance(total, int | float) and not isinstance(total, bool):
                flat_modifier = total - sum(die_rolls)
            else:
                flat_modifier = 0
        if flat_modifier:
            modifier_label = str(labels.get("fixed_modifier", "fixed modifier"))
            separator = str(labels.get("roll_breakdown_separator", "; "))
            return f"{face_text}{separator}{modifier_label} {flat_modifier:+g}"
        return face_text
    return f"{die_face} {_roll_total(payload)}"


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
        die=_roll_dice_expression(payload) or "?",
        roll=_roll_total(payload),
        breakdown=_die_roll_breakdown(payload, labels),
        outcome=outcome,
    )


def _format_roll_source_line(event: dict[str, Any]) -> str:
    payload = event.get("payload", {})
    skill = _roll_display_skill(event)
    actor = event.get("actor", "unknown")
    roll = _roll_total(payload)
    target = payload.get("effective_target", payload.get("target", "?"))
    outcome = _roll_display_outcome(event)
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
        announced = payload.get("announced_consequence")
        if isinstance(announced, dict) and announced.get("summary"):
            lines.append(
                f"  - Pushed Failure Consequence: {announced['summary']}"
            )
    if payload.get("outcome") == "fumble":
        consequence = payload.get("fumble_consequence")
        if isinstance(consequence, dict) and consequence.get("summary"):
            lines.append(f"  - Fumble Consequence: {consequence['summary']}")
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


def _localized_actor_names(
    characters: list[dict[str, Any]],
    localized_terms: dict[str, str],
    npc_agendas: dict[str, Any] | None = None,
    play_language: str = "en-US",
) -> dict[str, str]:
    names: dict[str, str] = {}
    for character in characters:
        investigator_id = character.get("investigator_id") or character.get("id")
        canonical_name = character.get("name")
        localized_name = _localize_text(canonical_name or investigator_id or "Unknown Investigator", localized_terms)
        for key in (investigator_id, canonical_name, _slug(canonical_name or "")):
            if key:
                names[str(key)] = localized_name
    for npc in (npc_agendas or {}).get("npcs") or []:
        if not isinstance(npc, dict):
            continue
        npc_id = npc.get("npc_id")
        canonical_name = npc.get("name")
        localized_name = _localized_visible_field(
            npc,
            "name",
            localized_terms,
            play_language,
        ) or _localize_text(canonical_name or npc_id or "Unknown NPC", localized_terms)
        for key in (npc_id, canonical_name, _slug(canonical_name or "")):
            if key:
                names[str(key)] = localized_name
    for canonical, localized in sorted(localized_terms.items(), key=lambda item: len(item[0]), reverse=True):
        canonical_slug = _slug(canonical)
        names.setdefault(canonical_slug, localized)
        names.setdefault(f"npc-{canonical_slug}", localized)
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


def _merge_localized_text(base: Any, overlay: Any) -> dict[str, Any]:
    merged = dict(base) if isinstance(base, dict) else {}
    if not isinstance(overlay, dict):
        return merged
    for language, values in overlay.items():
        if isinstance(values, dict):
            existing = merged.get(language)
            language_values = dict(existing) if isinstance(existing, dict) else {}
            language_values.update(values)
            merged[str(language)] = language_values
        else:
            merged[str(language)] = values
    return merged


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
    skill = _display_skill_name(_roll_display_skill(event), localized_terms)
    actor = _display_roll_actor(event.get("actor", "unknown"), actor_names)
    roll = _roll_total(payload)
    target = payload.get("effective_target", payload.get("target", "?"))
    outcome = _localized_rule_value(_roll_display_outcome(event), outcome_labels, localized_terms)
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
        if (payload.get("bonus") or payload.get("penalty")) and payload.get("tens_values") and payload.get("units") is not None:
            lines.append(f"  - {format_percentile_result(payload, language=play_language)}")
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
        announced = payload.get("announced_consequence")
        if isinstance(announced, dict) and announced.get("summary"):
            label = report_labels.get(
                "pushed_failure_consequence",
                report_labels.get("failure_consequence", "Pushed Failure Consequence"),
            )
            lines.append(f"  - {label}：{announced['summary']}")
    if payload.get("outcome") == "fumble":
        consequence = payload.get("fumble_consequence")
        if isinstance(consequence, dict) and consequence.get("summary"):
            label = report_labels.get(
                "fumble_consequence",
                report_labels.get("failure_consequence", "Fumble Consequence"),
            )
            lines.append(f"  - {label}：{consequence['summary']}")
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


def _format_roll_overview(
    rolls: list[dict[str, Any]],
    localized_terms: dict[str, str],
    language_profile: dict[str, Any],
    play_language: str,
) -> list[str]:
    if not rolls:
        return []
    outcome_labels = language_profile.get("outcome_labels", {})
    skills = Counter(
        _display_skill_name(_roll_display_skill(event), localized_terms)
        for event in rolls
    )
    outcomes = Counter(
        _localized_rule_value(_roll_display_outcome(event), outcome_labels, localized_terms)
        for event in rolls
    )
    skill_blob = "；".join(f"{name}×{count}" for name, count in skills.most_common())
    outcome_blob = "；".join(f"{name}×{count}" for name, count in outcomes.most_common())
    if play_language == "zh-Hans":
        return [
            f"- 本次共记录 {len(rolls)} 次掷骰；逐骰证据见唯一的“规则与骰子”规范章节。",
            f"- 按项目：{skill_blob}",
            f"- 按结果：{outcome_blob}",
        ]
    return [
        f"- {len(rolls)} rolls recorded; per-roll evidence appears once in the canonical Rules & Dice section.",
        f"- By check: {skill_blob}",
        f"- By outcome: {outcome_blob}",
    ]


def _important_roll(event: dict[str, Any]) -> bool:
    payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
    outcome = _roll_display_outcome(event)
    kind = str(event.get("kind") or payload.get("kind") or "")
    return bool(
        outcome in {
            "critical",
            "critical_success",
            "extreme",
            "extreme_success",
            "hard",
            "hard_success",
            "fumble",
            "damage_applied",
            "healing_applied",
            "reward_applied",
        }
        or payload.get("pushed")
        or payload.get("san_loss") not in (None, "", 0, [], {})
        or kind in {"hp_damage", "san_reward", "sanity_reward"}
    )


def _format_transcript_receipt(
    transcript: list[dict[str, Any]],
    transcript_path: Path,
    play_language: str,
) -> list[str]:
    if not transcript:
        return []
    roles = Counter(str(event.get("role") or event.get("speaker") or "unknown") for event in transcript)
    role_blob = ", ".join(f"{role}={count}" for role, count in sorted(roles.items()))
    digest = hashlib.sha256(transcript_path.read_bytes()).hexdigest() if transcript_path.is_file() else "missing"
    if play_language == "zh-Hans":
        return [
            "- 完整的玩家可见逐轮内容已在上方回放中呈现；本节只保留来源收据，避免重复整份对话。",
            f"- 来源：transcript.jsonl；记录数：{len(transcript)}；角色计数：{role_blob}；SHA-256：`{digest}`",
        ]
    return [
        "- The complete player-visible turn-by-turn rendering appears above; this section keeps only a source receipt to avoid duplicating the dialogue.",
        f"- Source: transcript.jsonl; records: {len(transcript)}; roles: {role_blob}; SHA-256: `{digest}`",
    ]


def _format_tool_reliability(
    records: list[dict[str, Any]],
    play_language: str,
    language_profile: dict[str, Any],
) -> list[str]:
    heading = _report_heading(2, "Tool Reliability", language_profile)
    if not records:
        if play_language == "zh-Hans":
            return [heading, "- 未发现工具调用日志；这是可观察性缺口，不会阻断战报生成。", ""]
        return [heading, "- No tool-call log was found; this is an observability gap and does not block report generation.", ""]

    def failure_code(row: dict[str, Any]) -> str:
        error = row.get("error_code") or row.get("error")
        if isinstance(error, dict):
            error = error.get("code") or error.get("error_code") or error.get("type")
        return str(error or "unknown")

    failures = [row for row in records if row.get("ok") is not True]
    errors = Counter(failure_code(row) for row in failures)
    calls = Counter(str(row.get("tool") or "unknown") for row in records)
    grouped: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for index, row in enumerate(records):
        args = row.get("args") if isinstance(row.get("args"), dict) else {}
        decision_id = str(
            row.get("decision_id")
            or args.get("decision_id")
            or f"__receipt_{index}"
        )
        grouped.setdefault((str(row.get("tool") or "unknown"), decision_id), []).append(row)
    recovered = sum(
        1
        for rows in grouped.values()
        if any(row.get("ok") is not True for row in rows)
        and rows[-1].get("ok") is True
    )
    error_blob = "；".join(f"{code}×{count}" for code, count in errors.most_common()) or "无"
    director_count = calls.get("director.advise", 0)
    storylet_count = calls.get("storylets.suggest", 0)
    if play_language == "zh-Hans":
        lines = [
            heading,
            "- 本节仅用于诊断和改进重试策略，不是叙事合法性门控。",
            f"- 调用收据：{len(records)}；成功：{len(records) - len(failures)}；失败尝试：{len(failures)}；同一决策重试后恢复：{recovered}。",
            f"- 失败类别：{error_blob}",
            f"- 可选叙事工具观测：director.advise={director_count}；storylets.suggest={storylet_count}。未调用不计为失败。",
        ]
    else:
        lines = [
            heading,
            "- Diagnostic only: these observations tune recovery behavior and are not narrative-legality gates.",
            f"- Receipts: {len(records)}; successful: {len(records) - len(failures)}; failed attempts: {len(failures)}; recovered on same-decision retry: {recovered}.",
            f"- Failure classes: {error_blob}",
            f"- Optional narrative tools observed: director.advise={director_count}; storylets.suggest={storylet_count}. Absence is not a failure.",
        ]
    lines.append("")
    return lines


def _format_state_change_summary(
    events: list[dict[str, Any]],
    rendered_lines: list[str],
    play_language: str,
) -> list[str]:
    state_types = {
        "flag_set",
        "npc_update",
        "resource_change",
        "hp_change",
        "damage",
        "sanity_loss",
        "sanity_reward",
        "luck_spend",
        "item_transfer",
        "transient_condition_cleared",
        "first_aid",
        "medicine",
        "major_wound_recovery",
        "weekly_medical_care",
        "development",
        "development_settled",
        "time_advanced",
        "game_time",
        "scene_unlocked",
    }
    selected: list[str] = []
    omitted = Counter()
    for event, rendered in zip(events, rendered_lines):
        event_type = _event_type(event)
        if event_type in state_types:
            selected.append(rendered)
        else:
            omitted[event_type or "unknown"] += 1
    if omitted:
        omitted_count = sum(omitted.values())
        selected.append(
            (f"- 其余 {omitted_count} 条事件收据已在对应章节呈现，此处不再重复。")
            if play_language == "zh-Hans"
            else f"- {omitted_count} other event receipts are rendered in their dedicated sections and are not repeated here."
        )
    return selected


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
    lines = recap.splitlines()
    first_line = lines[0] if lines else ""
    summary = first_line.removeprefix("- ").strip()
    for line in lines[1:]:
        detail = line.strip().removeprefix("- ").strip()
        if detail.startswith(("奖励骰：", "惩罚骰：", "bonus die:", "penalty die:")):
            return f"{summary}（{detail}）"
    return summary


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


def _roll_decision_id(roll: dict[str, Any]) -> str:
    payload = roll.get("payload")
    if isinstance(payload, dict) and payload.get("decision_id"):
        return str(payload["decision_id"])
    return str(roll.get("decision_id") or "")


def _roll_id(roll: dict[str, Any]) -> str:
    payload = roll.get("payload")
    if isinstance(payload, dict) and payload.get("roll_id"):
        return str(payload["roll_id"])
    return str(roll.get("roll_id") or "")


def _ordered_transcript_for_report(
    transcript: list[dict[str, Any]],
    rolls: list[dict[str, Any]],
    match_result: dict[str, Any],
) -> list[dict[str, Any]]:
    """Place structurally linked public rolls before their KP consequence.

    Older transcript rows did not carry decision ids, so the only safe legacy
    bridge is the ordered match-turn contract: one KP row per structured turn.
    If that cardinality is not exact, preserve the source transcript unchanged
    instead of guessing from prose.
    """
    events = [dict(event) for event in transcript]
    match_turns = [
        turn
        for turn in match_result.get("turns", [])
        if isinstance(turn, dict) and turn.get("decision_id")
    ] if isinstance(match_result, dict) else []
    if not match_turns:
        return events

    keeper_indices = [
        index
        for index, event in enumerate(events)
        if event.get("role") == "keeper_under_test"
    ]
    if len(keeper_indices) != len(match_turns):
        return events

    decision_ids = [str(turn["decision_id"]) for turn in match_turns]
    if len(set(decision_ids)) != len(decision_ids):
        return events
    expected_roll_ids = {
        str(turn["decision_id"]): {
            str(result["roll_id"])
            for result in turn.get("rule_results", [])
            if isinstance(result, dict) and result.get("roll_id")
        }
        for turn in match_turns
    }
    for index, decision_id in zip(keeper_indices, decision_ids):
        explicit = str(events[index].get("decision_id") or "")
        if explicit and explicit != decision_id:
            return [dict(event) for event in transcript]
        events[index]["_report_decision_id"] = decision_id

    roll_cursor = 0
    for event in events:
        if event.get("mode") != "roll":
            continue
        count = _event_roll_count(event, len(rolls) - roll_cursor)
        linked_rolls = rolls[roll_cursor: roll_cursor + count]
        roll_cursor += count
        if not linked_rolls:
            continue
        linked_decisions = {
            decision_id
            for roll in linked_rolls
            for decision_id in [_roll_decision_id(roll)]
            if decision_id
        }
        explicit = str(event.get("decision_id") or "")
        if explicit:
            linked_decisions.add(explicit)
        if len(linked_decisions) == 1:
            decision_id = linked_decisions.pop()
            linked_roll_ids = {_roll_id(roll) for roll in linked_rolls}
            allowed_roll_ids = expected_roll_ids.get(decision_id, set())
            if (
                linked_roll_ids
                and "" not in linked_roll_ids
                and allowed_roll_ids
                and linked_roll_ids <= allowed_roll_ids
            ):
                event["_report_decision_id"] = decision_id

    source_order = [id(event) for event in events]
    for decision_id in decision_ids:
        keeper_index = next(
            (
                index
                for index, event in enumerate(events)
                if event.get("role") == "keeper_under_test"
                and event.get("_report_decision_id") == decision_id
            ),
            None,
        )
        if keeper_index is None:
            continue
        linked_rolls = [
            event
            for event in events
            if event.get("mode") == "roll"
            and event.get("_report_decision_id") == decision_id
        ]
        if not linked_rolls:
            continue
        linked_event_ids = {id(event) for event in linked_rolls}
        events = [event for event in events if id(event) not in linked_event_ids]
        keeper_index = events.index(next(
            event
            for event in events
            if event.get("role") == "keeper_under_test"
            and event.get("_report_decision_id") == decision_id
        ))
        events[keeper_index:keeper_index] = linked_rolls

    if [id(event) for event in events] != source_order:
        for display_turn, event in enumerate(events, start=1):
            event["turn"] = display_turn
    return events


def _display_actor(actor: str) -> str:
    if actor == "keeper_under_test":
        return "KP"
    if actor == "player_simulator":
        return "Player"
    return actor


def _event_type(event: dict[str, Any]) -> str:
    return str(event.get("type") or event.get("event_type") or "event")


def _event_value(event: dict[str, Any], key: str, default: Any = None) -> Any:
    payload = event.get("payload")
    if isinstance(payload, dict) and payload.get(key) not in (None, "", [], {}):
        return payload[key]
    return event.get(key, default)


def _storylet_event_value(event: dict[str, Any], key: str, default: Any = None) -> Any:
    return _event_value(event, key, default)


def _sentence(text: Any, play_language: str = "en-US") -> str:
    value = str(text or "").strip()
    if not value:
        return ""
    if value.endswith(("。", "！", "？", ".", "!", "?")):
        return value
    return f"{value}。" if play_language == "zh-Hans" else f"{value}."


def _inline_anchors(*pairs: tuple[str, Any]) -> str:
    anchors = [
        _html_anchor(key, value)
        for key, value in pairs
        if value not in (None, "", [], {})
    ]
    return (" " + " ".join(anchors)) if anchors else ""


def _format_storylet_event(event: dict[str, Any], play_language: str = "en-US") -> str:
    storylet_id = _storylet_event_value(event, "storylet_id", "unknown-storylet")
    bound = _storylet_event_value(event, "bound_entities", {})
    if not isinstance(bound, dict):
        bound = {}
    variants = _storylet_event_value(event, "rolled_variants", {})
    if not isinstance(variants, dict):
        variants = {}
    presentation_mode = _storylet_event_value(event, "presentation_mode")
    grounding = _storylet_event_value(event, "grounding_contract", {})
    grounding = grounding if isinstance(grounding, dict) else {}

    cue = _storylet_event_value(event, "cue") or _storylet_event_value(event, "title") or "一个轻微异常被推到台前"
    details = [
        value
        for key in ("sensory_detail_1d6", "complication_1d6")
        for value in [variants.get(key)]
        if value and str(value) not in str(cue)
    ]
    anchors = _inline_anchors(
        ("storylet-id", storylet_id),
        ("scene-id", bound.get("scene_id") or bound.get("location_id")),
        ("clue-id", bound.get("clue_id")),
        ("front-id", bound.get("front_id")),
        ("clock-id", bound.get("clock_id")),
    )

    if (
        presentation_mode == "suppressed_unverified_fact"
        or grounding.get("allow_new_actionable_fact") is False
        and presentation_mode != "existing_route_only"
    ):
        if play_language == "zh-Hans":
            return f"- 剧情片段：未向玩家呈现（缺少来源授权）。{anchors}"
        return f"- Story beat: not presented to the player (source authorization missing).{anchors}"

    if play_language == "zh-Hans":
        prose = "".join(_sentence(part, play_language) for part in [cue, *details] if part)
        return f"- 剧情片段：{prose}{anchors}"

    prose = " ".join(_sentence(part, play_language) for part in [cue, *details] if part)
    return f"- Story beat: {prose}{anchors}"


def _load_clue_lookup(
    campaign_dir: Path | None,
    localized_terms: dict[str, str],
    play_language: str,
) -> dict[str, str]:
    records = _load_clue_records(campaign_dir)
    return _clue_lookup_from_records(records, localized_terms, play_language)


def _clue_lookup_from_records(
    records: dict[str, dict[str, Any]],
    localized_terms: dict[str, str],
    play_language: str,
) -> dict[str, str]:
    lookup: dict[str, str] = {}
    for clue_id, clue in records.items():
        localized = next(
            (
                value
                for key in ("player_safe_summary", "summary", "delivery", "title")
                for value in [_localized_field(clue, key, localized_terms, play_language)]
                if value
            ),
            None,
        )
        if localized:
            lookup[clue_id] = localized
            continue
        raw = next(
            (
                _localize_text(str(clue[key]), localized_terms)
                for key in ("player_safe_summary", "summary", "delivery", "title")
                if clue.get(key) not in (None, "", [], {})
            ),
            clue_id,
        )
        if (
            play_language == "zh-Hans"
            and raw != clue_id
            and re.search(r"[A-Za-z]", raw)
            and not re.search(r"[\u4e00-\u9fff]", raw)
        ):
            raw = f"［源数据未提供中文，显示原文］{raw}"
        lookup[clue_id] = raw
    return lookup


def _load_clue_records(campaign_dir: Path | None) -> dict[str, dict[str, Any]]:
    if campaign_dir is None:
        return {}
    graph = _read_json(campaign_dir / "scenario" / "clue-graph.json", {"conclusions": []})
    records: dict[str, dict[str, Any]] = {}
    for conclusion in graph.get("conclusions", []):
        if not isinstance(conclusion, dict):
            continue
        for clue in conclusion.get("clues", []):
            if not isinstance(clue, dict):
                continue
            clue_id = clue.get("clue_id") or clue.get("id")
            if not clue_id:
                continue
            records[str(clue_id)] = clue
    return records


def _player_safe_handout_from_clue(
    clue_id: str,
    clue: dict[str, Any],
) -> dict[str, Any] | None:
    # ``delivery_kind`` owns the rules gate (for example, a Library Use
    # ``skill_check``), while ``presentation_kind`` owns the artifact shown
    # after discovery.  Keep legacy handout clues working, but do not force a
    # source-authored rolled handout to masquerade as an automatic clue.
    if (
        clue.get("delivery_kind") != "handout"
        and clue.get("presentation_kind") != "handout"
    ):
        return None
    if clue.get("visibility") not in {"player-safe", "public"}:
        return None

    embedded = clue.get("handout")
    handout = dict(embedded) if isinstance(embedded, dict) else {}
    handout.setdefault("id", clue_id)
    handout.setdefault("clue_id", clue_id)
    handout_number = clue.get("handout_number")
    if isinstance(handout_number, int) and not isinstance(handout_number, bool):
        handout.setdefault("label", f"Handout {handout_number}")
    if clue.get("title") not in (None, "", [], {}):
        handout.setdefault("title", clue["title"])
    if clue.get("player_safe_summary") not in (None, "", [], {}):
        handout.setdefault("summary", clue["player_safe_summary"])

    clue_localized = clue.get("localized_text")
    handout_localized = handout.get("localized_text")
    localized_text = dict(handout_localized) if isinstance(handout_localized, dict) else {}
    if isinstance(clue_localized, dict):
        for language, localized in clue_localized.items():
            if not isinstance(localized, dict):
                continue
            existing = localized_text.get(language)
            localized_handout = dict(existing) if isinstance(existing, dict) else {}
            if localized.get("title") not in (None, "", [], {}):
                localized_handout.setdefault("title", localized["title"])
            if localized.get("player_safe_summary") not in (None, "", [], {}):
                localized_handout.setdefault("summary", localized["player_safe_summary"])
            if localized_handout:
                localized_text[str(language)] = localized_handout
    if localized_text:
        handout["localized_text"] = localized_text

    if not any(handout.get(key) not in (None, "", [], {}) for key in ("label", "title", "summary", "content", "route")):
        return None
    return handout


def _merge_discovered_clue_handouts(
    explicit_handouts: list[Any],
    state_events: list[dict[str, Any]],
    clue_records: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    merged = [handout for handout in explicit_handouts if isinstance(handout, dict)]
    known_ids = {
        str(handout.get("id") or handout.get("handout_id") or handout.get("clue_id"))
        for handout in merged
        if handout.get("id") or handout.get("handout_id") or handout.get("clue_id")
    }
    for event in state_events:
        if _event_type(event) not in CLUE_EVENT_TYPES:
            continue
        clue_id = _clue_event_id(event)
        if not clue_id or clue_id in known_ids:
            continue
        clue = clue_records.get(clue_id)
        if not isinstance(clue, dict):
            continue
        handout = _player_safe_handout_from_clue(clue_id, clue)
        if handout is None:
            continue
        merged.append(handout)
        known_ids.add(clue_id)
    return merged


def _clue_event_id(event: dict[str, Any]) -> str:
    return str(_event_value(event, "clue_id", "") or "")


def _machine_clue_summary(summary: str, clue_id: str) -> bool:
    normalized = summary.strip().lower()
    return bool(clue_id) and normalized in {
        f"clue revealed: {clue_id}".lower(),
        f"clue recorded: {clue_id}".lower(),
        clue_id.lower(),
    }


def _clue_event_text(
    event: dict[str, Any],
    localized_terms: dict[str, str],
    play_language: str,
    clue_lookup: dict[str, str] | None = None,
) -> str:
    clue_id = _clue_event_id(event)
    lookup = clue_lookup or {}
    if clue_id and clue_id in lookup:
        return lookup[clue_id]
    summary = _event_summary(event, "", localized_terms, play_language)
    if summary and not _machine_clue_summary(summary, clue_id):
        return summary
    return "一个线索" if play_language == "zh-Hans" else "a clue"


def _format_clue_reveal_event(
    event: dict[str, Any],
    localized_terms: dict[str, str],
    play_language: str,
    clue_lookup: dict[str, str] | None,
    *,
    label: str,
) -> str:
    clue_id = _clue_event_id(event)
    text = _sentence(_clue_event_text(event, localized_terms, play_language, clue_lookup), play_language)
    if play_language == "zh-Hans":
        return f"- {label}：{text}{_inline_anchors(('clue-id', clue_id))}"
    return f"- {label}: {text}{_inline_anchors(('clue-id', clue_id))}"


def _format_scene_transition_event(event: dict[str, Any], play_language: str = "en-US") -> str:
    label = "场景推进" if play_language == "zh-Hans" else "Scene advanced"
    from_scene = _event_value(event, "from_scene") or _event_value(event, "from_scene_id")
    to_scene = _event_value(event, "to_scene") or _event_value(event, "to_scene_id")
    return f"- {_sentence(label, play_language)}{_inline_anchors(('from-scene', from_scene), ('to-scene', to_scene))}"


def _format_scene_unlocked_event(event: dict[str, Any], play_language: str = "en-US") -> str:
    to_scene = _event_value(event, "to_scene") or _event_value(event, "scene_id") or "unknown"
    if play_language == "zh-Hans":
        return f"- scene unlocked: {to_scene}"
    return f"- scene unlocked: {to_scene}"


def _format_game_time_event(event: dict[str, Any], play_language: str = "en-US") -> str:
    delta = _event_value(event, "delta_minutes")
    to_elapsed = _event_value(event, "to_elapsed")
    from_elapsed = _event_value(event, "from_elapsed")
    player_visible = str(_event_value(event, "player_visible") or "").strip()
    if delta is None and to_elapsed is None and not player_visible:
        return "- game time recorded"
    parts: list[str] = []
    if delta is not None:
        try:
            parts.append(f"+{int(delta)}m")
        except (TypeError, ValueError):
            parts.append(f"+{delta}m")
    if player_visible:
        parts.append(f"→ {player_visible}")
    elif to_elapsed is not None:
        try:
            parts.append(f"→ elapsed {int(to_elapsed)}m")
        except (TypeError, ValueError):
            parts.append(f"→ elapsed {to_elapsed}m")
    elif from_elapsed is not None:
        parts.append(f"(from {from_elapsed})")
    detail = " ".join(parts) if parts else "updated"
    if play_language == "zh-Hans":
        return f"- game time {detail}"
    return f"- game time {detail}"


def _format_state_event(
    event: dict[str, Any],
    localized_terms: dict[str, str] | None = None,
    play_language: str = "en-US",
    actor_names: dict[str, str] | None = None,
    clue_lookup: dict[str, str] | None = None,
) -> str:
    terms = localized_terms or {}
    event_type = _event_type(event)
    if event_type == "storylet_move":
        return _format_storylet_event(event, play_language)
    if event_type in CLUE_EVENT_TYPES:
        label = "线索已记录" if play_language == "zh-Hans" else "Clue recorded"
        return _format_clue_reveal_event(event, terms, play_language, clue_lookup, label=label)
    if event_type == "scene_transition":
        return _format_scene_transition_event(event, play_language)
    if event_type == "scene_unlocked":
        return _format_scene_unlocked_event(event, play_language)
    if event_type == "game_time":
        return _format_game_time_event(event, play_language)
    if event_type == "sanity_loss":
        return _format_sanity_loss_event(event, terms, play_language, actor_names)
    if event_type in COMBAT_EVENT_TYPES - {"combat"}:
        return _format_combat_event(event, terms, play_language, actor_names)
    if event_type == "session_ending":
        return _format_session_ending_event(event, terms, play_language)
    event_type = event.get("type") or event_type
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
    if event.get("event_type") and not event.get("type"):
        return f"- {event_label} recorded"
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
    clue_lookup: dict[str, str] | None = None,
) -> str:
    if _event_type(event) in CLUE_EVENT_TYPES:
        label = "线索" if play_language == "zh-Hans" else "Clue"
        return _format_clue_reveal_event(event, localized_terms or {}, play_language, clue_lookup, label=label)
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


def _format_sanity_loss_event(
    event: dict[str, Any],
    localized_terms: dict[str, str] | None = None,
    play_language: str = "en-US",
    actor_names: dict[str, str] | None = None,
) -> str:
    terms = localized_terms or {}
    investigator_id = _event_value(event, "investigator_id") or event.get("actor") or "unknown"
    actor = _display_roll_actor(investigator_id, actor_names or {})
    loss = _event_value(event, "loss", "?")
    source = _localize_text(_event_value(event, "source", "an unsettling event"), terms)
    anchors = _inline_anchors(("san-trigger-id", _event_value(event, "trigger_id")))
    if play_language == "zh-Hans":
        return f"- {actor}因{source}失去 {loss} SAN。{anchors}"
    return f"- {actor} lost {loss} SAN because of {source}.{anchors}"


_COMBAT_ACTION_LABELS_ZH = {
    "opposed_melee": "近战对抗",
    "attack": "攻击",
    "dodge": "闪避",
    "fight_back": "反击",
    "maneuver": "战技",
}
_COMBAT_OUTCOME_LABELS_ZH = {
    "hit": "命中",
    "miss": "未命中",
    "no_damage": "未造成伤害",
    "damage": "造成伤害",
    "fled": "调查员撤退",
    "monsters_win": "怪物获胜",
    "investigators_win": "调查员获胜",
    "stalemate": "僵持",
}
_OPPOSED_OUTCOME_LABELS_ZH = {
    "attacker_higher": "攻击方成功级别更高",
    "defender_higher": "防守方成功级别更高",
    "tie_defender_wins": "同级时防守方获胜",
    "both_fail": "双方失败",
}


def _format_combat_event(
    event: dict[str, Any],
    localized_terms: dict[str, str] | None = None,
    play_language: str = "en-US",
    actor_names: dict[str, str] | None = None,
) -> str:
    """Project canonical toolbox combat events into a player-readable summary."""
    terms = localized_terms or {}
    names = actor_names or {}
    event_type = _event_type(event)
    combat_id = _event_value(event, "combat_id")
    anchors = _inline_anchors(("combat-id", combat_id))
    if event_type == "combat_started":
        initiative = _event_value(event, "initiative_order", [])
        order: list[str] = []
        if isinstance(initiative, list):
            for row in initiative:
                if not isinstance(row, dict):
                    continue
                actor = _display_roll_actor(row.get("actor_id"), names)
                dex = row.get("dex")
                order.append(f"{actor}（DEX {dex}）" if play_language == "zh-Hans" else f"{actor} (DEX {dex})")
        rendered = "、".join(order) if play_language == "zh-Hans" else ", ".join(order)
        if play_language == "zh-Hans":
            return f"- 战斗开始：行动顺序为 {rendered or '未记录'}。{anchors}"
        return f"- Combat began; initiative: {rendered or 'not recorded'}.{anchors}"
    if event_type == "combat_turn_resolved":
        turn = _event_value(event, "turn", {})
        turn = turn if isinstance(turn, dict) else {}
        actor = _display_roll_actor(turn.get("actor_id"), names)
        target = _display_roll_actor(turn.get("target_actor_id"), names)
        action = str(turn.get("action") or "action")
        outcome = str(turn.get("outcome") or "unknown")
        opposed = str(turn.get("opposed_outcome") or "")
        if play_language == "zh-Hans":
            action_label = _COMBAT_ACTION_LABELS_ZH.get(action, _localize_text(action.replace("_", " "), terms))
            outcome_label = _COMBAT_OUTCOME_LABELS_ZH.get(outcome, _localize_text(outcome.replace("_", " "), terms))
            opposed_label = _OPPOSED_OUTCOME_LABELS_ZH.get(opposed, _localize_text(opposed.replace("_", " "), terms))
            suffix = f"（{opposed_label}）" if opposed else ""
            return f"- {actor}对{target}的{action_label}：{outcome_label}{suffix}。{anchors}"
        opposed_suffix = f" ({opposed.replace('_', ' ')})" if opposed else ""
        return f"- {actor} used {action.replace('_', ' ')} against {target}: {outcome.replace('_', ' ')}{opposed_suffix}.{anchors}"
    if event_type == "combat_ended":
        outcome = str(_event_value(event, "outcome", "unknown"))
        if play_language == "zh-Hans":
            label = _COMBAT_OUTCOME_LABELS_ZH.get(outcome, _localize_text(outcome.replace("_", " "), terms))
            return f"- 战斗结束：{label}。{anchors}"
        return f"- Combat ended: {outcome.replace('_', ' ')}.{anchors}"
    return _format_subsystem_event(event, terms, play_language, names)


def _format_session_ending_event(
    event: dict[str, Any],
    localized_terms: dict[str, str] | None = None,
    play_language: str = "en-US",
) -> str:
    terms = localized_terms or {}
    kind = str(_event_value(event, "kind", "session_ending"))
    summary = _event_summary(event, "session ending recorded", terms, play_language)
    anchors = _inline_anchors(("ending-kind", kind), ("scene-id", _event_value(event, "scene_id")))
    kind_labels_zh = {
        "conclusion": "结案",
        "tpk": "全员覆没",
        "retreat": "退场",
        "cliffhanger": "悬念收束",
    }
    if play_language == "zh-Hans":
        label = kind_labels_zh.get(kind, "会话结束")
        return f"- {label}：{_sentence(summary, play_language)}{anchors}"
    return f"- {kind.replace('_', ' ').title()}: {_sentence(summary, play_language)}{anchors}"


def _session_ending_events(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Prefer schema-rich ending receipts over legacy report-only placeholders."""
    ending_events = [event for event in events if _event_type(event) == "session_ending"]
    structured = [event for event in ending_events if _event_value(event, "kind") not in (None, "", [], {})]
    return structured or ending_events


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
    clue_lookup: dict[str, str] | None = None,
) -> str:
    terms = localized_terms or {}
    names = actor_names or {}
    event_type = _event_type(event)
    if event_type == "scene":
        summary = _event_summary(event, "scene recorded", terms, play_language)
        return f"- {summary}"
    if event_type in CLUE_EVENT_TYPES:
        label = "调查员确认了线索" if play_language == "zh-Hans" else "Investigators confirmed a clue"
        return _format_clue_reveal_event(event, terms, play_language, clue_lookup, label=label)
    if event_type == "storylet_move":
        return _format_storylet_event(event, play_language)
    if event_type == "scene_transition":
        return _format_scene_transition_event(event, play_language)
    if event_type == "sanity_loss":
        return _format_sanity_loss_event(event, terms, play_language, names)
    if event_type in COMBAT_EVENT_TYPES - {"combat"}:
        return _format_combat_event(event, terms, play_language, names)
    if event_type == "session_ending":
        return _format_session_ending_event(event, terms, play_language)
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
    clue_lookup: dict[str, str] | None = None,
) -> list[str]:
    lines = [_format_scene_replay_event(event, localized_terms, play_language, actor_names, clue_lookup)]
    if _event_type(event) != "bout_of_madness":
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
    selected_endings = {id(event) for event in _session_ending_events(events)}
    return [
        event
        for event in events
        if _event_type(event) in SCENE_REPLAY_EVENT_TYPES
        and (
            _event_type(event) != "session_ending"
            or id(event) in selected_endings
        )
    ]


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
    merged = default_localized_terms(str(play_language)) if play_language else {}
    if isinstance(terms, dict):
        merged.update(terms)
    return {
        str(canonical): str(localized)
        for canonical, localized in merged.items()
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


def _format_single_player_profile_label(single_player_label: str, style_label: str, play_language: Any) -> str:
    if play_language in {"zh-Hans", "zh-Hant", "ja-JP", "ko-KR"}:
        return f"{single_player_label}（{style_label}）"
    return f"{single_player_label} ({style_label})"


def _localized_player_profile_display(
    metadata: dict[str, Any],
    language_profile: dict[str, Any],
    localized_terms: dict[str, str],
) -> str:
    profile_id = str(metadata.get("player_profile", "unknown"))
    style_label = _localized_profile_labels(metadata).get(profile_id)
    if style_label:
        speaker_labels = language_profile.get("speaker_labels", {})
        single_player_label = speaker_labels.get("single_player") if isinstance(speaker_labels, dict) else None
        if isinstance(single_player_label, str) and single_player_label:
            return _format_single_player_profile_label(single_player_label, style_label, metadata.get("play_language"))
        return style_label
    return _localized_report_value(profile_id, language_profile, localized_terms)


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
    localized = localize_terms(text, terms)
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
        if path.parent.name.startswith("."):
            continue
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
    scenario_file = (
        _read_json(campaign_dir / "scenario" / "scenario.json", {}) if campaign_dir else {}
    )
    module_meta = (
        _read_json(campaign_dir / "scenario" / "module-meta.json", {}) if campaign_dir else {}
    )
    # Compiled packages ship module-meta.json; optional scenario.json may be absent.
    # Prefer explicit scenario.json fields when present, else fall back to module-meta.
    scenario: dict[str, Any] = {}
    if isinstance(module_meta, dict):
        scenario.update(module_meta)
    if isinstance(scenario_file, dict):
        for key, value in scenario_file.items():
            if value not in (None, "", [], {}):
                if key == "localized_text":
                    scenario[key] = _merge_localized_text(scenario.get(key), value)
                    continue
                scenario[key] = value
    if (
        scenario.get("module_source") == "driver-generated scenario fixture"
        and isinstance(module_meta, dict)
        and module_meta.get("scenario_id")
    ):
        scenario["module_source"] = (
            f"compiled scenario package: {module_meta['scenario_id']}"
        )
    return {
        "campaign_dir": campaign_dir,
        "campaign": campaign,
        "party": party,
        "scenario": scenario,
        "npc_agendas": (
            _read_json(campaign_dir / "scenario" / "npc-agendas.json", {})
            if campaign_dir else {}
        ),
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
    campaign_scenario_id: str | None = None,
    investigator_id: str | None = None,
) -> list[str]:
    if not isinstance(backstory, dict) or not backstory:
        return []

    # Structured provenance: scenario-bound prose is omitted when the character's
    # backstory.scenario_id differs from the campaign/module scenario_id.
    # Comparison is ID equality only — never free-text matching.
    # Known starter pregens missing scenario_id fall back to the starter registry
    # (structured id lookup) so legacy installs still omit foreign bound prose.
    view = {
        key: value
        for key, value in backstory.items()
        if key not in {"scenario_id", "scenario_bound"} and value not in (None, "", [], {})
    }
    bound_block = backstory.get("scenario_bound")
    bound_id = backstory.get("scenario_id")
    registry_bound_keys: set[str] = set()
    if not (isinstance(bound_id, str) and bound_id.strip()):
        try:
            import coc_starter

            registry = coc_starter.lookup_known_starter_pregen(str(investigator_id or ""))
        except Exception:
            registry = None
        if isinstance(registry, dict):
            rid = registry.get("scenario_id")
            if isinstance(rid, str) and rid.strip():
                bound_id = rid.strip()
            registry_bound_keys = {
                str(k) for k in (registry.get("scenario_bound_keys") or []) if str(k).strip()
            }
    include_bound = True
    if isinstance(bound_id, str) and bound_id.strip():
        campaign_id = str(campaign_scenario_id or "").strip()
        if campaign_id and campaign_id != bound_id.strip():
            include_bound = False
    if include_bound and isinstance(bound_block, dict):
        for key, value in bound_block.items():
            if value not in (None, "", [], {}) and key not in view:
                view[key] = value
    elif not include_bound:
        # Legacy flat sheets: drop keys that the canonical pregen nests under
        # scenario_bound, even when scenario_id was never stamped on disk.
        for key in registry_bound_keys:
            view.pop(key, None)

    if not view:
        return []

    lines = [f"  - {_character_dossier_label(language_profile, 'Backstory')}:"]
    rendered_keys: set[str] = set()
    for key, label in BACKSTORY_FIELDS:
        value = view.get(key)
        if value in (None, "", [], {}):
            continue
        rendered_keys.add(key)
        display_label = _character_dossier_label(language_profile, label)
        lines.append(f"    - {display_label}: {_format_backstory_value(value, localized_terms)}")

    for key in sorted(view):
        if key in rendered_keys or view.get(key) in (None, "", [], {}):
            continue
        label = key.replace("_", " ").title()
        display_label = _character_dossier_label(language_profile, label)
        lines.append(f"    - {display_label}: {_format_backstory_value(view[key], localized_terms)}")
    return lines if len(lines) > 1 else []


def _format_character(
    character: dict[str, Any],
    localized_terms: dict[str, str] | None = None,
    language_profile: dict[str, Any] | None = None,
    campaign_scenario_id: str | None = None,
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
    lines.extend(
        _format_backstory(
            character.get("backstory"),
            terms,
            profile,
            campaign_scenario_id=campaign_scenario_id,
            investigator_id=str(investigator_id) if investigator_id else None,
        )
    )
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
        player_label = str(speaker_labels.get("single_player", player_label))
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
    text = _strip_inline_player_notes(text)
    lines = [f"- {_transcript_turn_label(language_profile, turn)} {speaker}: {text}"]
    notes = event.get("player_notes")
    if notes:
        note_label = "玩家笔记" if play_language == "zh-Hans" else "Player notes"
        lines.append(f"  - {note_label}: {notes}")
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


def _strip_inline_player_notes(text: str) -> str:
    marker = "\n[player_notes] "
    if marker in text:
        return text.split(marker, 1)[0]
    if text.startswith("[player_notes] "):
        return ""
    return text


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
    text = _strip_inline_player_notes(text)
    if role in {"keeper_under_test", "player_simulator"}:
        lines = [f"- {_transcript_turn_label(language_profile, turn)} {speaker}: \"{text}\""]
    else:
        lines = [f"- {_transcript_turn_label(language_profile, turn)} {speaker}: {text}"]
    notes = event.get("player_notes")
    if notes:
        note_label = "玩家笔记" if play_language == "zh-Hans" else "Player notes"
        lines.append(f"  - {note_label}: {notes}")
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


def _format_combat_tracker(
    combat_state: dict[str, Any],
    localized_terms: dict[str, str] | None = None,
    play_language: str = "en-US",
    actor_names: dict[str, str] | None = None,
    language_profile: dict[str, Any] | None = None,
) -> list[str]:
    """Render save/combat.json as a ## Combat Tracker section.

    Mirrors _format_chase_tracker: reads structured state, never trust prose.
    Shows participants (with DEX, skills, HP, armor, ready-firearm), each
    round's initiative order, the turns with their opposed pairings, and the
    damage chain. Localizes actor display names via localized_terms; keeps
    canonical actor ids in HTML anchors for audit.
    """
    if not combat_state or not combat_state.get("participants"):
        return []

    terms = localized_terms or {}
    profile = language_profile or {}
    name_map = dict(actor_names or {})
    for p in combat_state.get("participants", []):
        aid = p.get("actor_id")
        if aid:
            name_map.setdefault(aid, _localize_text(aid, terms))

    def _name(aid: str | None) -> str:
        return name_map.get(aid, aid or "?")

    lines = [
        _html_anchor("combat-id", combat_state.get("combat_id", "unknown")),
        _html_anchor("combat-state-file", "save/combat.json"),
        f"- Status: {combat_state.get('status', 'unknown')}",
        f"- Outcome: {combat_state.get('outcome', 'unknown')}",
    ]

    # Participants
    lines.append("")
    lines.append("Participants:")
    for p in combat_state.get("participants", []):
        aid = p.get("actor_id", "?")
        ready = " [ready firearm]" if p.get("has_ready_firearm") else ""
        lines.append(
            f"  - {_name(aid)} ({p.get('side', '?')}): "
            f"DEX {p.get('dex','?')}, Fight {p.get('combat_skill','?')}, "
            f"HP {p.get('hp_current','?')}/{p.get('hp_max','?')}, "
            f"Armor {p.get('armor',0)}{ready}"
        )

    # Rounds
    for rnd in combat_state.get("rounds", []) or []:
        lines.append("")
        lines.append(f"Round {rnd.get('round','?')}:")
        init = ", ".join(
            f"{_name(p.get('actor_id'))}@{p.get('dex','?')}"
            + (f" ({p.get('dex_reason')})" if p.get("dex_reason") else "")
            for p in rnd.get("initiative_order", []) or []
        )
        if init:
            lines.append(f"  Initiative: {init}")
        for t in rnd.get("turns", []) or []:
            opp = ""
            if t.get("opposed_outcome"):
                opp = f" [opposed: {t.get('opposed_outcome')}]"
            dmg = f" dmg={t.get('damage_roll_id')}" if t.get("damage_roll_id") else ""
            am = t.get("attack_modifiers") or {}
            mods = ""
            if am.get("bonus") or am.get("penalty"):
                mods = f" (mods: +{am.get('bonus',0)}/-{am.get('penalty',0)})"
            lines.append(
                f"  - {_name(t.get('actor_id'))}: {t.get('action','?')} → "
                f"{t.get('outcome','?')}{opp}{dmg}{mods}"
            )

    # Damage chain
    damage_chain = combat_state.get("damage_chain", []) or []
    if damage_chain:
        lines.append("")
        lines.append("Damage chain:")
        for d in damage_chain:
            bypass = " [bypass armor]" if d.get("bypass_armor") else ""
            exc = f" ({d.get('rulebook_exception')})" if d.get("rulebook_exception") else ""
            lines.append(
                f"  - {_name(d.get('source_actor_id'))} → {_name(d.get('target_actor_id'))}: "
                f"{d.get('die','?')} = {d.get('raw_damage','?')} "
                f"(HP {d.get('hp_before','?')}→{d.get('hp_after','?')}, "
                f"armor absorbed {d.get('armor_absorbed',0)}){bypass}{exc}"
            )
    return lines


def _combat_id_from_event(event: dict[str, Any]) -> str:
    combat_id = _event_value(event, "combat_id")
    if combat_id not in (None, ""):
        return str(combat_id)
    roll_id = str(_event_value(event, "roll_id", "") or "")
    if ":cr" in roll_id:
        return roll_id.rsplit(":cr", 1)[0]
    return ""


def _format_combat_history_trackers(
    events: list[dict[str, Any]],
    current_state: dict[str, Any],
    localized_terms: dict[str, str],
    play_language: str,
    actor_names: dict[str, str],
    language_profile: dict[str, Any],
) -> list[str]:
    """Render every structured encounter; save/combat.json remains the latest snapshot."""
    histories: dict[str, dict[str, Any]] = {}
    for event in events:
        event_type = _event_type(event)
        if event_type not in {*COMBAT_EVENT_TYPES, "combat_roll"}:
            continue
        combat_id = _combat_id_from_event(event)
        if not combat_id:
            continue
        history = histories.setdefault(
            combat_id,
            {
                "combat_id": combat_id,
                "status": "active",
                "outcome": None,
                "initiative_order": [],
                "turns": [],
                "damage_chain": [],
            },
        )
        if event_type == "combat_started":
            history["initiative_order"] = list(_event_value(event, "initiative_order", []) or [])
        elif event_type == "combat_turn_resolved" and isinstance(_event_value(event, "turn"), dict):
            history["turns"].append(dict(_event_value(event, "turn")))
        elif event_type == "combat_roll" and isinstance(_event_value(event, "combat_damage_receipt"), dict):
            history["damage_chain"].append(dict(_event_value(event, "combat_damage_receipt")))
        elif event_type == "combat_ended":
            history["status"] = "concluded"
            history["outcome"] = _event_value(event, "outcome")

    current_id = str(current_state.get("combat_id") or "")
    if current_id and current_state.get("participants") and current_id not in histories:
        histories[current_id] = {
            "combat_id": current_id,
            "status": current_state.get("status") or "active",
            "outcome": current_state.get("outcome"),
            "initiative_order": [],
            "turns": [],
            "damage_chain": [],
            "snapshot_only": True,
        }

    if not histories:
        return _format_combat_tracker(
            current_state,
            localized_terms,
            play_language,
            actor_names,
            language_profile,
        )

    zh = play_language == "zh-Hans"
    lines: list[str] = []
    for index, history in enumerate(histories.values(), start=1):
        combat_id = str(history["combat_id"])
        status = str(history["status"] or "unknown")
        outcome = str(history.get("outcome") or "unknown")
        status_display = {
            "active": "进行中",
            "concluded": "已结束",
            "ended": "已结束",
        }.get(status, _localize_text(status.replace("_", " "), localized_terms)) if zh else status.replace("_", " ")
        outcome_display = (
            _COMBAT_OUTCOME_LABELS_ZH.get(
                outcome,
                _localize_text(outcome.replace("_", " "), localized_terms),
            )
            if zh else outcome.replace("_", " ")
        )
        if zh:
            evidence_source = (
                "证据来源：最新战斗快照（事件收据缺失）"
                if history.get("snapshot_only")
                else "证据来源：结构化事件回放"
            )
        else:
            evidence_source = (
                "Evidence source: latest combat snapshot (event receipt unavailable)"
                if history.get("snapshot_only")
                else "Evidence source: structured event replay"
            )
        lines.extend([
            f"### {'遭遇' if zh else 'Encounter'} {index}",
            _html_anchor("combat-id", combat_id),
            f"- {'状态' if zh else 'Status'}: {status_display}",
            f"- {'结果' if zh else 'Outcome'}: {outcome_display}",
            f"- {evidence_source}",
        ])
        initiative = history.get("initiative_order") or []
        if initiative:
            order = " → ".join(
                f"{_display_roll_actor(row.get('actor_id'), actor_names)}@{row.get('dex', '?')}"
                for row in initiative
                if isinstance(row, dict)
            )
            lines.append(f"- {'先攻顺序' if zh else 'Initiative'}: {order}")
        turns_by_round: dict[str, list[dict[str, Any]]] = {}
        for turn in history.get("turns") or []:
            turn_id = str(turn.get("turn_id") or "?")
            match = re.match(r"t(\d+)-", turn_id)
            round_id = match.group(1) if match else "?"
            turns_by_round.setdefault(round_id, []).append(turn)
        for round_id, turns in turns_by_round.items():
            lines.append(f"- {'第' + round_id + '轮' if zh else 'Round ' + round_id}:")
            for turn in turns:
                actor = _display_roll_actor(turn.get("actor_id"), actor_names)
                target = _display_roll_actor(turn.get("target_actor_id"), actor_names)
                action = str(turn.get("action") or "unknown")
                outcome = str(turn.get("outcome") or "unknown")
                action_display = (
                    _COMBAT_ACTION_LABELS_ZH.get(
                        action,
                        _localize_text(action.replace("_", " "), localized_terms),
                    )
                    if zh else action.replace("_", " ")
                )
                outcome_display = (
                    _COMBAT_OUTCOME_LABELS_ZH.get(
                        outcome,
                        _localize_text(outcome.replace("_", " "), localized_terms),
                    )
                    if zh else outcome.replace("_", " ")
                )
                damage_roll_id = turn.get("damage_roll_id")
                damage_note = (
                    " / 已记录伤害" if zh else " / damage recorded"
                ) if damage_roll_id else ""
                lines.append(
                    f"  - {actor} → {target}: {action_display} / {outcome_display}{damage_note}"
                    + (_html_anchor("damage-roll-id", damage_roll_id) if damage_roll_id else "")
                )
        damage_chain = history.get("damage_chain") or []
        if damage_chain:
            lines.append(f"- {'伤害链' if zh else 'Damage chain'}:")
            for damage in damage_chain:
                source = _display_roll_actor(damage.get("source_actor_id"), actor_names)
                target = _display_roll_actor(damage.get("target_actor_id"), actor_names)
                lines.append(
                    f"  - {source} → {target}: {damage.get('die', '?')}={damage.get('raw_damage', damage.get('total', '?'))}; "
                    f"HP {damage.get('hp_before', '?')}→{damage.get('hp_after', '?')}"
                )
        if combat_id == current_id and current_state.get("participants"):
            lines.append(f"- {'最终快照参与者' if zh else 'Final snapshot participants'}:")
            for participant in current_state.get("participants") or []:
                if not isinstance(participant, dict):
                    continue
                actor = _display_roll_actor(participant.get("actor_id"), actor_names)
                separator = "；" if zh else "; "
                lines.append(
                    f"  - {actor}: HP {participant.get('hp_current', '?')}/{participant.get('hp_max', '?')}{separator}"
                    f"{'敏捷' if zh else 'DEX'} {participant.get('dex', '?')}{separator}"
                    f"{'护甲' if zh else 'armor'} {participant.get('armor', 0)}"
                )
            lines.append(_html_anchor("combat-state-file", "save/combat.json"))
        lines.append("")
    return lines


def _render_epistemic_experience_section(
    metrics: dict[str, Any],
    language_profile: dict[str, Any],
    *,
    observed: bool,
) -> list[str]:
    """Render deterministic belief/question diagnostics without prose inference."""
    keys = (
        "belief_gain",
        "curiosity_load",
        "explanation_compression",
        "reframe_fairness",
        "confirmation_saturation",
        "unexplained_surprise",
        "parse_risk_exposure",
        "epistemic_health",
    )
    lines = [_report_heading(2, "Epistemic Experience", language_profile)]
    language = str(language_profile.get("language") or "en-US")
    if not observed:
        lines.append(
            "- 观测状态：本次没有产生认知状态事件；以下默认值仅表示功能未被测到，不计为失败。"
            if language == "zh-Hans"
            else "- Observation status: no epistemic-state events were produced; defaults mean not exercised, not failed."
        )
    for key in keys:
        payload = metrics.get(key, {}) if isinstance(metrics, dict) else {}
        lines.append(
            f"- {key}: "
            + json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        )
    lines.append("")
    return lines


def _render_narrative_adherence_section(
    adherence: Any,
    language_profile: dict[str, Any],
) -> list[str]:
    """Optional 叙事贴合 / Narrative Adherence section (SENNA checklist).

    Emitted only when metadata carries structured adherence data. Fail-open:
    malformed payloads yield no section.
    """
    if not isinstance(adherence, dict) or not adherence:
        return []
    statements = adherence.get("statements")
    if not isinstance(statements, list) or not statements:
        return []
    try:
        coverage = float(adherence.get("required_coverage", 0.0) or 0.0)
    except (TypeError, ValueError):
        coverage = 0.0
    pct = int(round(coverage * 100))
    language = str(language_profile.get("language") or "en-US")
    lines = [
        _report_heading(2, "Narrative Adherence", language_profile),
        (
            "- 这是结构化知识/路径观测，不是胜利、结局质量或叙事合法性的判定。"
            if language == "zh-Hans"
            else "- Structured knowledge/route observation only; this is not a victory, ending-quality, or narrative-legality verdict."
        ),
        (
            f"- 已观测结构化路径：{pct}%（{coverage:.2f}）"
            if language == "zh-Hans"
            else f"- Structured routes observed: {pct}% ({coverage:.2f})"
        ),
        "",
    ]
    for stmt in statements:
        if not isinstance(stmt, dict):
            continue
        mark = "✓" if stmt.get("satisfied") else "✗"
        kind = str(stmt.get("kind") or "optional").strip() or "optional"
        desc = str(stmt.get("description") or stmt.get("statement_id") or "").strip()
        if not desc:
            continue
        kind_label = {
            "conclusion": "知识结论",
            "scene": "场景路径",
            "required": "必经路径",
            "optional": "可选路径",
        }.get(kind, kind) if language == "zh-Hans" else kind
        lines.append(f"- {mark} [{kind_label}] {desc}")
    if len(lines) <= 4:
        return []
    lines.append("")
    return lines


def _evidence_report_lines(receipt: dict[str, Any], play_language: str) -> list[str]:
    eligible = receipt.get("eligible_as_gameplay_evidence") is True
    reasons = receipt.get("evidence_reasons")
    reason_codes = [str(code) for code in reasons] if isinstance(reasons, list) else []
    status_anchor = "eligible" if eligible else "ineligible"
    if play_language == "zh-Hans":
        heading = "## 实玩证据 <!-- report-anchor: Gameplay Evidence -->"
        status = "符合" if eligible else "不符合"
        labels = ("资格", "外部模型回合", "降级回合")
    elif play_language == "ja-JP":
        heading = "## 実プレイ証拠 <!-- report-anchor: Gameplay Evidence -->"
        status = "適格" if eligible else "不適格"
        labels = ("適格性", "外部モデルターン", "フォールバックターン")
    else:
        heading = "## Gameplay Evidence"
        status = "eligible" if eligible else "not eligible"
        labels = ("Eligibility", "External Model Turns", "Fallback Turns")
    return [
        heading,
        f"<!-- evidence-eligibility: {status_anchor} -->",
        f"<!-- evidence-reasons: {','.join(reason_codes) or 'none'} -->",
        f"- {labels[0]}: {status}",
        f"- {labels[1]}: {receipt.get('external_model_turns', 0)}",
        f"- {labels[2]}: {receipt.get('fallback_turns', 'unknown')}",
    ]


def _evidence_sensitive_metadata(
    receipt: dict[str, Any], metadata: dict[str, Any]
) -> dict[str, str]:
    if receipt.get("play_kind") == "operator_reviewed_actual_play":
        return {
            "audit_profile": str(metadata.get("audit_profile") or "full_module"),
            "simulation_method": "operator_reviewed_actual_play",
            "player_profile": "operator_player",
        }
    if receipt.get("eligible_as_gameplay_evidence") is True:
        return {
            "audit_profile": "evidence_grade_player_bridge_match",
            "simulation_method": "attested_external_model_playtest",
            "player_profile": "attested_external_model_bridge",
        }
    values = {
        "audit_profile": str(metadata.get("audit_profile") or "baseline"),
        "simulation_method": str(metadata.get("simulation_method") or "not recorded"),
        "player_profile": str(metadata.get("player_profile") or "unknown"),
    }
    if values["audit_profile"] in {
        "evidence_grade_player_bridge_match",
        "live_llm_player_match",
    }:
        values["audit_profile"] = "player_bridge_match"
    if values["simulation_method"] in {
        "attested_external_model_playtest",
        "live_llm_player_vs_kp",
    }:
        values["simulation_method"] = "unattested_runner_match_not_gameplay_evidence"
    if values["player_profile"] in {
        "attested_external_model_bridge",
        "external_llm_bridge",
    }:
        values["player_profile"] = "unattested_runner"
    return values


def generate_battle_report(run_dir: Path) -> Path:
    require_final_run_path(run_dir, purpose="battle-report generation")
    metadata = _read_json(run_dir / "playtest.json", {})
    evidence_receipt = read_evidence_receipt(run_dir)
    # Classification is derived only from the recomputed receipt. Metadata is
    # descriptive and cannot self-attest an unknown/scripted runner as actual play.
    run_kind = evidence_receipt.get("run_kind") or evidence_receipt.get("play_kind")
    eligible = evidence_receipt.get("eligible_as_gameplay_evidence") is True
    if run_kind == "diagnostic_spoiler_run":
        report_basename = "diagnostic-play-report.md"
        non_gameplay_sample = True
        diagnostic_spoiler = True
    elif run_kind == "blind_actual_play" and eligible:
        report_basename = "battle-report.md"
        non_gameplay_sample = False
        diagnostic_spoiler = False
    elif run_kind == "blind_actual_play":
        report_basename = "verification-sample.md"
        non_gameplay_sample = True
        diagnostic_spoiler = False
    else:
        report_basename = (
            "verification-sample.md" if not eligible else "battle-report.md"
        )
        non_gameplay_sample = not eligible
        diagnostic_spoiler = False
    display_metadata = {
        **metadata,
        **_evidence_sensitive_metadata(evidence_receipt, metadata),
    }
    operator_review = _read_json(run_dir / "operator-review.json", {})
    operator_review_lines: list[str] = []
    if metadata.get("operator_long_play") is True:
        operator_protocol = str(
            metadata.get("operator_review_protocol")
            or operator_review.get("protocol")
            or "operator_long_play_v1"
        )
        operator_contract = metadata.get("operator_contract") or {}
        model_boundary = (
            operator_contract.get("model_call_boundary")
            if isinstance(operator_contract, dict)
            else {}
        )
        if isinstance(operator_review, dict) and operator_review.get("status") in {
            "approved", "changes_required",
        }:
            reviewer = operator_review.get("reviewer") or {}
            operator_review_lines = [
                _report_heading(2, "Operator Review", _selected_language_profile(
                    str(metadata.get("play_language") or "zh-Hans"), metadata, {}
                )),
                f"- Protocol: {operator_protocol}",
                f"- Status: {operator_review['status']}",
                f"- Reviewer: {reviewer.get('kind', 'unknown')} / {reviewer.get('id', 'unknown')}",
                "- Automated fact-fidelity PASS: false",
                "- Player/reviewer: main Codex black-box operator / self-review",
                "- Additional player or judge model: NOT_CONFIGURED",
                f"- Model call boundary: {json.dumps(model_boundary, ensure_ascii=False, sort_keys=True)}",
                "- Official suite status: NOT_RUN; this review cannot establish nightly or release PASS.",
            ]
            for dimension in ("rules", "facts", "progression", "style"):
                row = (operator_review.get("dimensions") or {}).get(dimension) or {}
                operator_review_lines.append(
                    f"- {dimension}: {row.get('decision', 'missing')} — {row.get('notes', '')}"
                )
        else:
            operator_review_lines = [
                "## Operator Review",
                f"- Protocol: {operator_protocol}",
                "- Status: pending",
                "- Player/reviewer: main Codex black-box operator / self-review",
                "- Additional player or judge model: NOT_CONFIGURED",
                f"- Model call boundary: {json.dumps(model_boundary, ensure_ascii=False, sort_keys=True)}",
                "- Operator review is required for rules, facts, progression, and style.",
                "- Automated fact-fidelity PASS: false (independent model verification NOT_RUN).",
                "- This run cannot establish nightly or release PASS.",
            ]
    localized_terms = _localized_terms(metadata)
    context = _load_campaign_context(run_dir, metadata)
    campaign = context["campaign"]
    scenario = context["scenario"]
    characters = context["characters"]
    campaign_dir = context["campaign_dir"]
    belief_events = (
        _read_jsonl(campaign_dir / "logs" / "belief-events.jsonl")
        if campaign_dir
        else []
    )
    belief_state = (
        _read_json(campaign_dir / "save" / "belief-state.json", {})
        if campaign_dir
        else {}
    )
    compile_confidence = (
        _read_json(campaign_dir / "scenario" / "compile-confidence.json", {})
        if campaign_dir
        else {}
    )
    parse_manifest = (
        _read_json(campaign_dir / "index" / "parse-manifest.json", {})
        if campaign_dir
        else {}
    )
    epistemic_metrics = coc_epistemic_metrics.compute_epistemic_metrics(
        belief_events,
        belief_state=belief_state,
        compile_confidence=compile_confidence,
        parse_manifest=parse_manifest,
    )
    metadata["epistemic_metrics"] = epistemic_metrics
    (run_dir / "playtest.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    explicit_handouts = (
        _read_json(context["campaign_dir"] / "scenario" / "handouts.json", [])
        if context["campaign_dir"]
        else []
    )
    transcript = _read_jsonl(run_dir / "transcript.jsonl")
    rolls = _read_jsonl_files(_campaign_log_paths(run_dir, "rolls.jsonl"))
    state_events = _read_jsonl_files(_campaign_log_paths(run_dir, "events.jsonl"))
    toolbox_records = _read_jsonl_files(
        _campaign_log_paths(run_dir, "toolbox-calls.jsonl")
    )
    match_result = _read_json(run_dir / "match-result.json", {})
    transcript = _ordered_transcript_for_report(transcript, rolls, match_result)
    session_summaries = _read_jsonl_files(_campaign_memory_paths(run_dir, "session-summaries.jsonl"))
    player_feedback = _read_jsonl(run_dir / "player-feedback.jsonl")
    chase_state = (
        _read_json(context["campaign_dir"] / "save" / "chase.json", {})
        if context["campaign_dir"]
        else {}
    )
    combat_state = (
        _read_json(context["campaign_dir"] / "save" / "combat.json", {})
        if context["campaign_dir"]
        else {}
    )
    output = _artifacts_dir(run_dir) / report_basename

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
    if module_source not in (None, "unknown"):
        raw_source = str(module_source)
        normalized_source = raw_source.replace("\\", "/")
        source_path = Path(normalized_source)
        if (
            source_path.is_absolute()
            or ".." in source_path.parts
            or re.match(r"^[A-Za-z]:/", normalized_source)
        ):
            module_source = source_path.name or "source withheld"
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

    actor_names = _localized_actor_names(
        characters,
        localized_terms,
        context.get("npc_agendas"),
        str(play_language),
    )
    clue_records = _load_clue_records(context["campaign_dir"])
    clue_lookup = _clue_lookup_from_records(
        clue_records,
        localized_terms,
        str(play_language),
    )
    handouts = _merge_discovered_clue_handouts(
        explicit_handouts if isinstance(explicit_handouts, list) else [],
        state_events,
        clue_records,
    )
    handout_lines = [
        _format_handout(handout, localized_terms, str(play_language))
        for handout in handouts
        if isinstance(handout, dict)
    ]
    public_rolls = [
        event
        for event in rolls
        if roll_visibility(event) in {"public", "consequence_public"}
    ]
    roll_recaps_by_source = [
        (
            _format_roll_recap(
                event,
                actor_names,
                localized_terms,
                str(play_language),
                language_profile,
            )
            if roll_visibility(event) in {"public", "consequence_public"}
            else None
        )
        for event in rolls
    ]
    roll_overview_lines = _format_roll_overview(
        public_rolls,
        localized_terms,
        language_profile,
        str(play_language),
    )
    transcript_receipt_lines = _format_transcript_receipt(
        transcript,
        run_dir / "transcript.jsonl",
        str(play_language),
    )
    actual_play_lines: list[str] = []
    roll_cursor = 0
    for event in transcript:
        rendered_text = _localized_event_text(event, localized_terms, str(play_language))
        if event.get("mode") == "roll":
            roll_count = _event_roll_count(event, len(roll_recaps_by_source) - roll_cursor)
            recaps = [
                recap
                for recap in roll_recaps_by_source[roll_cursor: roll_cursor + roll_count]
                if recap is not None
            ]
            roll_cursor += roll_count
            if not recaps:
                continue
            rendered_text = _format_roll_transcript_text(event, recaps, localized_terms, str(play_language))
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
        for event in public_rolls
    ]
    rendered_state_lines = [
        _format_state_event(event, localized_terms, str(play_language), actor_names, clue_lookup)
        for event in state_events
    ]
    state_lines = _format_state_change_summary(
        state_events,
        rendered_state_lines,
        str(play_language),
    )
    decision_lines = [
        _format_decision(event, localized_terms, str(play_language))
        for event in state_events
        if event.get("type") == "decision"
    ]
    clue_lines = [
        _format_clue(event, localized_terms, str(play_language), clue_lookup)
        for event in state_events
        if _event_type(event) in CLUE_EVENT_TYPES
    ]
    scene_replay_lines = [
        line
        for event in _scene_replay_events(state_events)
        for line in _format_scene_replay_event_lines(
            event,
            localized_terms,
            str(play_language),
            actor_names,
            clue_lookup,
        )
    ]
    combat_lines = [
        (
            _format_combat_event(event, localized_terms, str(play_language), actor_names)
            if _event_type(event) != "combat"
            else _format_subsystem_event(event, localized_terms, str(play_language), actor_names)
        )
        for event in state_events
        if _event_type(event) in COMBAT_EVENT_TYPES
    ]
    chase_lines = [
        _format_subsystem_event(event, localized_terms, str(play_language), actor_names)
        for event in state_events
        if event.get("type") == "chase"
    ]
    sanity_lines: list[str] = []
    for event in state_events:
        event_type = _event_type(event)
        if event_type not in SANITY_EVENT_TYPES:
            continue
        if event_type == "sanity_loss":
            sanity_lines.append(
                _format_sanity_loss_event(
                    event,
                    localized_terms,
                    str(play_language),
                    actor_names,
                )
            )
        else:
            sanity_lines.extend(
                _format_subsystem_event_lines(
                    event,
                    localized_terms,
                    str(play_language),
                    actor_names,
                )
            )
    ending_events = _session_ending_events(state_events)
    ending_lines = [
        _format_session_ending_event(event, localized_terms, str(play_language))
        for event in ending_events[-1:]
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
        character_lines.extend(
            _format_character(
                character,
                localized_terms,
                language_profile,
                campaign_scenario_id=str(scenario_id) if scenario_id not in (None, "unknown") else None,
            )
        )
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
    if ending_events:
        final_ending_summary = _event_summary(
            ending_events[-1],
            "",
            localized_terms,
            str(play_language),
        )
        if final_ending_summary and not any(
            _event_summary(event, "", localized_terms, str(play_language))
            == final_ending_summary
            for event in session_summaries
        ):
            recap_lines.append(
                _format_session_ending_event(
                    ending_events[-1],
                    localized_terms,
                    str(play_language),
                )
            )
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
    combat_tracker_lines = _format_combat_history_trackers(
        state_events,
        combat_state,
        localized_terms,
        str(play_language),
        actor_names,
        language_profile,
    )
    tool_reliability_lines = _format_tool_reliability(
        toolbox_records,
        str(play_language),
        language_profile,
    )

    body = [
        (
            "# DIAGNOSTIC SPOILER-AWARE Play Report"
            if diagnostic_spoiler
            else (
                "# NON-GAMEPLAY Verification Sample"
                if non_gameplay_sample
                else _report_heading(1, "Battle Report", language_profile)
            )
        ),
        "",
        *(
            [
                "**DIAGNOSTIC spoiler-aware evidence. This is not a spoiler-blind actual-play battle report.**",
                "",
            ]
            if diagnostic_spoiler
            else (
                [
                    "**NON-GAMEPLAY verification evidence. This scripted sample is not an actual-play battle report.**",
                    "",
                ]
                if non_gameplay_sample
                else []
            )
        ),
        _report_heading(2, "Run Setup", language_profile),
        _report_field("Run ID", metadata.get("run_id", "unknown"), language_profile),
        _report_field("Campaign ID", metadata.get("campaign_id", "unknown"), language_profile),
        _report_field("Campaign", _localize_text(campaign_title, localized_terms), language_profile),
        _report_field(
            "Audit Profile",
            _localized_report_value(display_metadata["audit_profile"], language_profile, localized_terms),
            language_profile,
        ),
        _report_field(
            "Simulation Method",
            _localized_report_value(display_metadata["simulation_method"], language_profile, localized_terms),
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
            _localized_player_profile_display(display_metadata, language_profile, localized_terms),
            language_profile,
        ),
        "",
        *_evidence_report_lines(evidence_receipt, str(play_language)),
        "",
        *operator_review_lines,
        *( [""] if operator_review_lines else [] ),
        _report_heading(2, "Module", language_profile),
        _report_field(
            "Scenario",
            _localized_visible_field(scenario, "title", localized_terms, str(play_language))
            or _localize_text(scenario_title, localized_terms),
            language_profile,
        ),
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
        ("## Verification Replay" if non_gameplay_sample
         else _report_heading(2, "Actual Play Replay", language_profile)),
        *_list_lines(actual_play_lines, "- No actual play events recorded."),
        "",
        _report_heading(2, "Session Transcript", language_profile),
        *_list_lines(transcript_receipt_lines, "- No transcript events recorded."),
        "",
        *tool_reliability_lines,
        _report_heading(2, "Major Player Decisions", language_profile),
        *_list_lines(decision_lines, "- No major decisions recorded."),
        "",
        _report_heading(2, "Rules & Rolls Recap", language_profile),
        *_list_lines(roll_overview_lines, "- No roll recap recorded."),
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
        _report_heading(2, "Combat Tracker", language_profile),
        *_list_lines(
            combat_tracker_lines,
            _empty_report_line(language_profile, "combat_tracker", "- No combat tracker recorded."),
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
        *_render_epistemic_experience_section(
            epistemic_metrics,
            language_profile,
            observed=bool(belief_events or belief_state),
        ),
        *_render_narrative_adherence_section(
            metadata.get("narrative_adherence"),
            language_profile,
        ),
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
    # Drop empty strings left by optional sections that emitted nothing.
    body = [line for line in body if line is not None]
    siblings = [
        name
        for name in (
            "battle-report.md",
            "verification-sample.md",
            "diagnostic-play-report.md",
        )
        if name != output.name
    ]
    return _write_report_artifact_atomic(
        run_dir,
        output.name,
        siblings,
        "\n".join(body),
    )


def generate_evaluation_report(run_dir: Path) -> Path:
    require_final_run_path(run_dir, purpose="evaluation-report generation")
    metadata = _read_json(run_dir / "playtest.json", {})
    evidence_receipt = read_evidence_receipt(run_dir)
    display_metadata = {
        **metadata,
        **_evidence_sensitive_metadata(evidence_receipt, metadata),
    }
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
        f"- Audit Profile: {display_metadata['audit_profile']}",
        f"- Player Profile: {display_metadata['player_profile']}",
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
