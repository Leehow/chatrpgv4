#!/usr/bin/env python3
"""Versioned evaluation and report contract for COC Keeper.

Structured playtest evidence is authoritative. This module renders the
player-facing rules-and-dice section from roll logs, verifies that every
required public result is present exactly once, injects report schema v2
identity metadata, and rejects baselines that are not bound to a verified
completeness receipt.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import re
import secrets
import sys
from collections import Counter
from pathlib import Path
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from coc_language import default_localized_terms, localize_terms
from coc_playtest_runs import require_final_run_path

REPO_ROOT = SCRIPT_DIR.parents[2]
EVAL_SPEC_DIR = Path("evaluation/spec/v1")
EVAL_SPEC = "eval-spec-v1"
REPORT_SCHEMA_VERSION = 2
REPORT_SCHEMA_MARKER = "<!-- report-schema-version: 2 -->"
RUN_IDENTITY_ANCHOR = "run-identity-and-evidence"
EVALUATION_CONTRACT_ANCHOR = "evaluation-contract"
RULES_AND_DICE_ANCHOR = "rules-and-dice"
ROLL_VISIBILITIES = {"public", "consequence_public", "keeper_only"}
ROLL_MARKER_RE = re.compile(r"\[roll-id:\s*([A-Za-z0-9_.:-]+)\]")
ROLL_SOURCE_RE = re.compile(r"<!--\s*roll-source:\s*([^#\s]+)#(\d+)\s*-->")
SAFE_ROLL_ID_RE = re.compile(r"^[A-Za-z0-9_.:-]+$")
SCHEMA_MARKER_RE = re.compile(r"^\s*<!--\s*report-schema-version:\s*\d+\s*-->\s*$")
ZERO_PUBLIC_ROLL_ZH = "本场没有发生需要记录的公开检定（公开骰数：0）。"
ZERO_PUBLIC_ROLL_DEFAULT = (
    "No public rolls required recording in this session (public roll count: 0)."
)
REPORT_BASENAMES = (
    "battle-report.md",
    "diagnostic-play-report.md",
    "verification-sample.md",
)
IDENTITY_KEYS = (
    "eval_spec",
    "benchmark_version",
    "report_schema_version",
    "case_id",
    "seed",
    "initial_state_sha256",
    "kp_model",
    "player_model",
    "prompt_hashes",
)


def file_sha256(path: Path | str) -> str:
    """Return the SHA-256 digest of a file without loading it all into memory."""
    digest = hashlib.sha256()
    candidate = path if getattr(path, "_coc_anchored_path", False) else Path(path)
    with candidate.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _read_json(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default


def _write_text_atomic(path: Path, text: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    parent_fd = (
        path.parent._open_dir(path.parent.parts)
        if getattr(path, "_coc_anchored_path", False)
        else os.open(
            path.parent,
            os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
        )
    )
    temp_name: str | None = None
    temp_fd: int | None = None
    try:
        temp_name = f".{path.name}.{secrets.token_hex(12)}.tmp"
        temp_fd = os.open(
            temp_name,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
            0o600,
            dir_fd=parent_fd,
        )
        payload = text.encode("utf-8")
        view = memoryview(payload)
        while view:
            view = view[os.write(temp_fd, view):]
        os.fsync(temp_fd)
        os.close(temp_fd)
        temp_fd = None
        os.replace(
            temp_name,
            path.name,
            src_dir_fd=parent_fd,
            dst_dir_fd=parent_fd,
        )
        temp_name = None
        os.fsync(parent_fd)
    finally:
        if temp_fd is not None:
            os.close(temp_fd)
        if temp_name is not None:
            try:
                os.unlink(temp_name, dir_fd=parent_fd)
            except FileNotFoundError:
                pass
        os.close(parent_fd)
    return path


def _write_json_atomic(path: Path, payload: Any) -> Path:
    return _write_text_atomic(
        path,
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
    )


def load_benchmark_manifest(root: Path | str = REPO_ROOT) -> dict[str, Any]:
    path = Path(root) / EVAL_SPEC_DIR / "benchmark-manifest.json"
    payload = _read_json(path, None)
    if not isinstance(payload, dict):
        raise ValueError(f"benchmark manifest missing or malformed: {path}")
    if payload.get("schema_version") != 1 or payload.get("eval_spec") != EVAL_SPEC:
        raise ValueError("invalid eval-spec-v1 benchmark manifest")
    if not isinstance(payload.get("suites"), dict):
        raise ValueError("benchmark manifest missing suites")
    capabilities = payload.get("implemented_capabilities")
    if not isinstance(capabilities, list) or not all(
        isinstance(value, str) and value for value in capabilities
    ):
        raise ValueError("benchmark manifest has invalid implemented_capabilities")
    pack_registry_path = Path(root) / EVAL_SPEC_DIR / "benchmark-packs.json"
    if pack_registry_path.is_file():
        packs = _load_sibling("coc_eval_packs_contract", "coc_eval_packs.py")
        packs.load_benchmark_pack_registry(root, manifest=payload)
    return payload


def resolve_suite(manifest: dict[str, Any], suite: str) -> dict[str, Any]:
    suites = manifest.get("suites") or {}
    if suite not in suites:
        raise ValueError(f"unknown evaluation suite: {suite}")
    value = suites[suite]
    if not isinstance(value, dict):
        raise ValueError(f"invalid suite definition: {suite}")
    required = value.get("required_capabilities")
    commands = value.get("commands")
    if not isinstance(required, list) or not all(
        isinstance(item, str) and item for item in required
    ):
        raise ValueError(f"invalid required_capabilities for suite: {suite}")
    if not isinstance(commands, list) or not all(
        isinstance(command, list)
        and command
        and all(isinstance(part, str) and part for part in command)
        for command in commands
    ):
        raise ValueError(f"invalid commands for suite: {suite}")
    return value


def _load_sibling(module_name: str, filename: str) -> Any:
    path = SCRIPT_DIR / filename
    spec = importlib.util.spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"could not load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def _metadata(run_dir: Path) -> dict[str, Any]:
    value = _read_json(run_dir / "playtest.json", {})
    return value if isinstance(value, dict) else {}


def _run_manifest(run_dir: Path) -> dict[str, Any]:
    value = _read_json(run_dir / "run-manifest.json", {})
    return value if isinstance(value, dict) else {}


def _campaign_dirs(run_dir: Path, metadata: dict[str, Any]) -> list[Path]:
    root = run_dir / "sandbox" / ".coc" / "campaigns"
    campaign_id = metadata.get("campaign_id")
    if campaign_id not in (None, ""):
        selected = root / str(campaign_id)
        if selected.is_dir():
            return [selected]
    if not root.is_dir():
        return []
    return sorted(path for path in root.iterdir() if path.is_dir())


def _relative_to_run(run_dir: Path, path: Path) -> str:
    try:
        return path.resolve().relative_to(run_dir.resolve()).as_posix()
    except (OSError, ValueError):
        return path.name


def load_roll_records(run_dir: Path | str) -> dict[str, Any]:
    """Read all campaign roll logs while preserving parse errors and provenance."""
    require_final_run_path(
        run_dir, purpose="evaluation roll loading", require_metadata=True
    )
    root = run_dir if getattr(run_dir, "_coc_anchored_path", False) else Path(run_dir)
    metadata = _metadata(root)
    candidate_paths = [
        campaign_dir / "logs" / "rolls.jsonl"
        for campaign_dir in _campaign_dirs(root, metadata)
    ]
    existing_paths = [path for path in candidate_paths if path.is_file()]
    records: list[dict[str, Any]] = []
    parse_errors: list[dict[str, Any]] = []
    ordinal = 0

    for path in existing_paths:
        relative = _relative_to_run(root, path)
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except OSError as exc:
            parse_errors.append(
                {
                    "path": relative,
                    "line": None,
                    "error": f"read_error:{type(exc).__name__}",
                }
            )
            continue
        for line_number, line in enumerate(lines, start=1):
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError as exc:
                parse_errors.append(
                    {
                        "path": relative,
                        "line": line_number,
                        "error": f"json_decode:{exc.msg}",
                    }
                )
                continue
            if not isinstance(row, dict):
                parse_errors.append(
                    {
                        "path": relative,
                        "line": line_number,
                        "error": "row_not_object",
                    }
                )
                continue
            ordinal += 1
            record = dict(row)
            record["_eval_source_path"] = relative
            record["_eval_source_line"] = line_number
            record["_eval_source_ordinal"] = ordinal
            records.append(record)

    return {
        "records": records,
        "source_paths": [_relative_to_run(root, path) for path in existing_paths],
        "source_logs_present": bool(existing_paths),
        "parse_errors": parse_errors,
    }


def _payload(event: dict[str, Any]) -> dict[str, Any]:
    value = event.get("payload")
    return value if isinstance(value, dict) else {}


def _safe_marker_id(value: str) -> str:
    if SAFE_ROLL_ID_RE.fullmatch(value):
        return value
    return f"roll-{hashlib.sha256(value.encode('utf-8')).hexdigest()[:16]}"


def _roll_identity(event: dict[str, Any]) -> tuple[str, bool, str | None]:
    payload = _payload(event)
    raw = (
        event.get("roll_id")
        or payload.get("roll_id")
        or event.get("event_id")
        or payload.get("event_id")
        or event.get("id")
        or payload.get("id")
    )
    if raw not in (None, ""):
        source_id = str(raw)
        return _safe_marker_id(source_id), False, source_id
    ordinal = int(event.get("_eval_source_ordinal") or 0)
    return f"legacy-roll-{ordinal:04d}", True, None


def roll_visibility(event: dict[str, Any]) -> str:
    payload = _payload(event)
    explicit = event.get("visibility") or payload.get("visibility")
    if explicit in ROLL_VISIBILITIES:
        return str(explicit)
    if event.get("hidden") is True or payload.get("hidden") is True:
        return "keeper_only"
    if any(
        payload.get(key) is not None
        for key in (
            "hp_before",
            "hp_after",
            "san_before",
            "san_after",
            "mp_before",
            "mp_after",
        )
    ):
        return "consequence_public"
    actor = str(event.get("actor") or event.get("actor_role") or "")
    if actor in {"keeper_under_test", "KP", "system"}:
        return "keeper_only"
    return "public"


def _is_non_percentile(event: dict[str, Any]) -> bool:
    payload = _payload(event)
    dice = payload.get("dice")
    if isinstance(dice, dict) and dice.get("expression") not in (None, ""):
        return True
    if payload.get("die") not in (None, "") or payload.get("die_expression") not in (
        None,
        "",
    ):
        return True
    return str(event.get("type") or "") in {
        "damage",
        "healing",
        "reward",
        "san_loss",
        "sanity_loss",
        "random_table",
    }


def _numeric_count(value: Any) -> int:
    if isinstance(value, bool):
        return 0
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _missing_fields(event: dict[str, Any], missing_id: bool) -> list[str]:
    payload = _payload(event)
    missing: list[str] = []
    if missing_id:
        missing.append("roll_id")
    if event.get("actor") in (None, "") and event.get("actor_id") in (None, ""):
        missing.append("actor_id")

    if _is_non_percentile(event):
        dice = payload.get("dice") if isinstance(payload.get("dice"), dict) else {}
        if (
            payload.get("die") in (None, "")
            and payload.get("die_expression") in (None, "")
            and dice.get("expression") in (None, "")
        ):
            missing.append("die_expression")
        faces = payload.get(
            "die_rolls", payload.get("individual_faces", dice.get("raw"))
        )
        if not isinstance(faces, list) or not faces:
            missing.append("individual_faces")
        if payload.get(
            "roll", payload.get("final_total", dice.get("total"))
        ) is None:
            missing.append("final_total")
    else:
        if payload.get("skill", payload.get("characteristic")) in (None, ""):
            missing.append("skill_or_characteristic")
        if payload.get("roll", payload.get("selected_roll")) is None:
            missing.append("selected_roll")
        if payload.get("effective_target", payload.get("target")) is None:
            missing.append("effective_target")
        if payload.get("outcome") in (None, ""):
            missing.append("outcome")
        if _numeric_count(payload.get("bonus")) or _numeric_count(payload.get("penalty")):
            if not isinstance(payload.get("tens_values"), list) or not payload.get(
                "tens_values"
            ):
                missing.append("tens_values")
            if payload.get("units") is None:
                missing.append("units")
        if payload.get("pushed") is True and not (
            payload.get("failure_consequence")
            or payload.get("foreshadowed_failure")
            or payload.get("announced_consequence")
        ):
            missing.append("pushed_failure_consequence")
        if (
            payload.get("outcome") == "fumble"
            and not payload.get("fumble_consequence")
            and not (
                payload.get("skill") == "SAN"
                and payload.get("san_loss") is not None
                and payload.get("san_before") is not None
                and payload.get("san_after") is not None
            )
        ):
            missing.append("fumble_consequence")
    return list(dict.fromkeys(missing))


def _localized_terms(metadata: dict[str, Any], language: str) -> dict[str, str]:
    outer = metadata.get("localized_terms")
    selected = outer.get(language) if isinstance(outer, dict) else None
    merged = default_localized_terms(language)
    if isinstance(selected, dict):
        merged.update(selected)
    return {
        str(key): str(value)
        for key, value in merged.items()
        if key not in (None, "") and value not in (None, "")
    }


def _localize(value: Any, terms: dict[str, str]) -> str:
    return localize_terms(value, terms)


def _actor_names(run_dir: Path, terms: dict[str, str]) -> dict[str, str]:
    result: dict[str, str] = {}
    investigator_root = run_dir / "sandbox" / ".coc" / "investigators"
    if not investigator_root.is_dir():
        return result
    for path in sorted(investigator_root.glob("*/character.json")):
        if path.parent.name.startswith("."):
            continue
        character = _read_json(path, {})
        if not isinstance(character, dict):
            continue
        investigator_id = (
            character.get("investigator_id") or character.get("id") or path.parent.name
        )
        name = character.get("name") or investigator_id
        display = _localize(name, terms)
        result[str(investigator_id)] = display
        if character.get("name"):
            result[str(character["name"])] = display
    return result


def _display_actor(
    event: dict[str, Any], actor_names: dict[str, str], terms: dict[str, str]
) -> str:
    actor = event.get("actor_id") or event.get("actor") or "unknown"
    return actor_names.get(str(actor), _localize(actor, terms))


def _source_comment(event: dict[str, Any]) -> str:
    path = str(event.get("_eval_source_path") or "unknown")
    line = event.get("_eval_source_line")
    return f"<!-- roll-source: {path}#{line if line is not None else '?'} -->"


def _format_modifier(value: Any) -> str:
    try:
        number = float(value or 0)
    except (TypeError, ValueError):
        return f" + {value}" if value not in (None, "", 0) else ""
    if number == 0:
        return ""
    shown: int | float = int(number) if number.is_integer() else number
    return f" + {shown}" if number > 0 else f" - {abs(shown)}"


def _state_delta_details(payload: dict[str, Any], language: str) -> list[str]:
    details: list[str] = []
    if payload.get("san_loss") not in (None, ""):
        details.append(
            f"SAN 损失：{payload['san_loss']}"
            if language == "zh-Hans"
            else f"SAN loss: {payload['san_loss']}"
        )
    for label, before_key, after_key in (
        ("HP", "hp_before", "hp_after"),
        ("SAN", "san_before", "san_after"),
        ("MP", "mp_before", "mp_after"),
    ):
        before = payload.get(before_key)
        after = payload.get(after_key)
        if before is not None and after is not None:
            details.append(f"{label} {before} → {after}")
    return details


def _render_non_percentile(
    event: dict[str, Any],
    roll_id: str,
    *,
    language: str,
    actor_names: dict[str, str],
    terms: dict[str, str],
) -> str:
    payload = _payload(event)
    dice = payload.get("dice") if isinstance(payload.get("dice"), dict) else {}
    actor = _display_actor(event, actor_names, terms)
    purpose = _localize(
        payload.get("purpose")
        or payload.get("skill")
        or event.get("type")
        or "die roll",
        terms,
    )
    die = (
        payload.get("die")
        or payload.get("die_expression")
        or dice.get("expression")
        or "?"
    )
    faces = payload.get(
        "die_rolls", payload.get("individual_faces", dice.get("raw"))
    )
    face_text = (
        " + ".join(str(value) for value in faces)
        if isinstance(faces, list) and faces
        else "?"
    )
    modifier = _format_modifier(payload.get("flat_modifier", 0))
    total = payload.get(
        "roll", payload.get("final_total", dice.get("total", "?"))
    )
    details = _state_delta_details(payload, language)
    if language == "zh-Hans":
        tail = f"；{'；'.join(details)}" if details else ""
        return (
            f"- [roll-id: {roll_id}] {purpose}（{actor}） {die}："
            f"{face_text}{modifier} = {total}{tail}。 {_source_comment(event)}"
        )
    tail = f"; {'; '.join(details)}" if details else ""
    return (
        f"- [roll-id: {roll_id}] {purpose} ({actor}) {die}: "
        f"{face_text}{modifier} = {total}{tail}. {_source_comment(event)}"
    )


def _render_percentile(
    event: dict[str, Any],
    roll_id: str,
    *,
    language: str,
    actor_names: dict[str, str],
    terms: dict[str, str],
) -> str:
    payload = _payload(event)
    actor = _display_actor(event, actor_names, terms)
    skill = _localize(
        payload.get("skill") or payload.get("characteristic") or "check", terms
    )
    roll = payload.get("roll", payload.get("selected_roll", "?"))
    target = payload.get("effective_target", payload.get("target", "?"))
    outcome = _localize(payload.get("outcome", "unknown"), terms)
    difficulty = _localize(payload.get("difficulty", "regular"), terms)
    details: list[str] = []

    bonus = _numeric_count(payload.get("bonus"))
    penalty = _numeric_count(payload.get("penalty"))
    if bonus or penalty:
        label = "奖励骰" if bonus else "惩罚骰"
        if language != "zh-Hans":
            label = "bonus die" if bonus else "penalty die"
        units = payload.get("units", "?")
        tens_values = payload.get("tens_values")
        tens = (
            "/".join(str(value) for value in tens_values)
            if isinstance(tens_values, list)
            else "?"
        )
        details.append(
            f"{label}：个位 {units}，十位 {tens}，取 {roll}"
            if language == "zh-Hans"
            else f"{label}: units {units}, tens {tens}, selected {roll}"
        )
    if payload.get("pushed") is True:
        consequence = payload.get("failure_consequence") or payload.get(
            "foreshadowed_failure"
        )
        details.append(
            f"推骰：是，失败后果：{consequence or '?'}"
            if language == "zh-Hans"
            else f"pushed: yes, failure consequence: {consequence or '?'}"
        )
    fumble_consequence = payload.get("fumble_consequence")
    if payload.get("outcome") == "fumble" and isinstance(fumble_consequence, dict):
        summary = fumble_consequence.get("summary")
        if isinstance(summary, str) and summary.strip():
            details.append(
                f"大失败后果：{summary.strip()}"
                if language == "zh-Hans"
                else f"fumble consequence: {summary.strip()}"
            )
    if payload.get("luck_spent") not in (None, 0, ""):
        details.append(
            f"消耗幸运：{payload['luck_spent']}"
            if language == "zh-Hans"
            else f"Luck spent: {payload['luck_spent']}"
        )
    details.extend(_state_delta_details(payload, language))

    if language == "zh-Hans":
        tail = f"；{'；'.join(details)}" if details else ""
        return (
            f"- [roll-id: {roll_id}] {skill}（{actor}）：掷骰 {roll} / 目标 {target}"
            f"（{difficulty}）→ {outcome}{tail}。 {_source_comment(event)}"
        )
    tail = f"; {'; '.join(details)}" if details else ""
    return (
        f"- [roll-id: {roll_id}] {skill} ({actor}): rolled {roll} / target {target} "
        f"({difficulty}) -> {outcome}{tail}. {_source_comment(event)}"
    )


def render_rules_and_dice(
    records: list[dict[str, Any]],
    *,
    play_language: str,
    actor_names: dict[str, str] | None = None,
    localized_terms: dict[str, str] | None = None,
) -> dict[str, Any]:
    names = actor_names or {}
    terms = localized_terms or {}
    source_ids: list[str] = []
    public_ids: list[str] = []
    keeper_ids: list[str] = []
    incomplete_ids: list[str] = []
    missing_by_id: dict[str, list[str]] = {}
    source_refs_by_id: dict[str, str] = {}
    public_lines: list[str] = []

    for event in records:
        roll_id, missing_id, source_id = _roll_identity(event)
        source_ids.append(roll_id)
        source_refs_by_id[roll_id] = (
            f"{event.get('_eval_source_path', 'unknown')}#"
            f"{event.get('_eval_source_line', '?')}"
        )
        visibility = roll_visibility(event)
        missing = _missing_fields(event, missing_id)
        if source_id is not None and source_id != roll_id:
            missing.append("marker_safe_roll_id")
        if missing:
            incomplete_ids.append(roll_id)
            existing = missing_by_id.setdefault(roll_id, [])
            existing.extend(value for value in missing if value not in existing)
        if visibility == "keeper_only":
            keeper_ids.append(roll_id)
            continue
        public_ids.append(roll_id)
        renderer = (
            _render_non_percentile if _is_non_percentile(event) else _render_percentile
        )
        public_lines.append(
            renderer(
                event,
                roll_id,
                language=play_language,
                actor_names=names,
                terms=terms,
            )
        )

    if play_language == "zh-Hans":
        heading = "## 规则与骰子 <!-- report-anchor: rules-and-dice -->"
        count_line = f"- 公开骰数：{len(public_ids)}"
        zero_line = ZERO_PUBLIC_ROLL_ZH
    else:
        heading = "## Rules & Dice <!-- report-anchor: rules-and-dice -->"
        count_line = f"- Public roll count: {len(public_ids)}"
        zero_line = ZERO_PUBLIC_ROLL_DEFAULT
    lines = [heading, "", count_line, ""]
    lines.extend(public_lines if public_lines else [zero_line])
    lines.append("")
    return {
        "markdown": "\n".join(lines),
        "source_roll_ids": source_ids,
        "required_public_roll_ids": public_ids,
        "keeper_only_roll_ids": keeper_ids,
        "incomplete_roll_ids": incomplete_ids,
        "missing_fields_by_roll_id": missing_by_id,
        "source_refs_by_roll_id": source_refs_by_id,
    }


def _heading_level(line: str) -> int | None:
    stripped = line.lstrip()
    if not stripped.startswith("#"):
        return None
    level = len(stripped) - len(stripped.lstrip("#"))
    return level if stripped[level : level + 1] == " " else None


def remove_anchored_section(report_text: str, anchor: str) -> str:
    lines = report_text.splitlines()
    marker = f"report-anchor: {anchor}"
    start = next((index for index, line in enumerate(lines) if marker in line), None)
    if start is None:
        return report_text
    level = _heading_level(lines[start]) or 2
    end = len(lines)
    for index in range(start + 1, len(lines)):
        next_level = _heading_level(lines[index])
        if next_level is not None and next_level <= level:
            end = index
            break
    kept = lines[:start] + lines[end:]
    while kept and not kept[-1].strip():
        kept.pop()
    return "\n".join(kept) + ("\n" if kept else "")


def inject_rules_and_dice(report_text: str, section: str) -> str:
    clean = remove_anchored_section(report_text, RULES_AND_DICE_ANCHOR)
    lines = clean.splitlines()
    mechanical_marker = "report-anchor: Mechanical Log"
    insertion = next(
        (index for index, line in enumerate(lines) if mechanical_marker in line), None
    )
    if insertion is None:
        while lines and not lines[-1].strip():
            lines.pop()
        prefix = "\n".join(lines)
        return (prefix + "\n\n" if prefix else "") + section.rstrip() + "\n"
    prefix = lines[:insertion]
    suffix = lines[insertion:]
    while prefix and not prefix[-1].strip():
        prefix.pop()
    while suffix and not suffix[0].strip():
        suffix.pop(0)
    return (
        "\n".join(prefix)
        + "\n\n"
        + section.rstrip()
        + "\n\n"
        + "\n".join(suffix)
        + "\n"
    )


def _public_identity_value(value: Any) -> str:
    if value in (None, "", [], {}):
        return "unknown"
    if isinstance(value, dict):
        provider = value.get("provider")
        model_id = value.get("id", value.get("model"))
        if provider and model_id:
            return f"{provider}/{model_id}"
        return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    if isinstance(value, list):
        return ", ".join(str(item) for item in value) or "none"
    return str(value)


def render_run_identity_section(
    metadata: dict[str, Any],
    run_manifest: dict[str, Any],
    evidence: dict[str, Any],
    *,
    language: str,
) -> str:
    run_id = run_manifest.get("run_id") or metadata.get("run_id") or "unknown"
    scenario = (
        run_manifest.get("scenario_id")
        or metadata.get("scenario")
        or metadata.get("scenario_id")
        or "unknown"
    )
    eligible = evidence.get("eligible") is True
    reasons = evidence.get("reasons")
    reason_text = ", ".join(str(value) for value in reasons) if reasons else "none"
    receipt = evidence.get("receipt") if isinstance(evidence.get("receipt"), dict) else {}
    runners = receipt.get("runners") if isinstance(receipt.get("runners"), dict) else {}

    def evidenced_model(role: str) -> Any:
        runner = runners.get(role) if isinstance(runners.get(role), dict) else {}
        identities = runner.get("model_identities")
        if not isinstance(identities, list) or not identities:
            return None
        return identities[0] if len(identities) == 1 else identities

    kp_model = _public_identity_value(
        run_manifest.get("kp_model")
        or metadata.get("kp_model")
        or evidenced_model("narrator")
    )
    player_model = _public_identity_value(
        run_manifest.get("player_model")
        or metadata.get("player_model")
        or evidenced_model("player")
    )
    host_id = _public_identity_value(run_manifest.get("host_id"))
    benchmark = _public_identity_value(run_manifest.get("benchmark_version"))

    if language == "zh-Hans":
        heading = "## 运行身份与证据 <!-- report-anchor: run-identity-and-evidence -->"
    else:
        heading = "## Run Identity & Evidence <!-- report-anchor: run-identity-and-evidence -->"
    return "\n".join(
        [
            heading,
            "",
            f"- Run ID: {run_id}",
            f"- Scenario: {scenario}",
            f"- Eval spec: {run_manifest.get('eval_spec') or EVAL_SPEC}",
            f"- Benchmark version: {benchmark}",
            f"- Report schema version: {REPORT_SCHEMA_VERSION}",
            f"- Host: {host_id}",
            f"- KP model: {kp_model}",
            f"- Player model: {player_model}",
            f"- Evidence eligibility: {'eligible' if eligible else 'ineligible'}",
            f"- Evidence reasons: {reason_text}",
            "",
        ]
    )


def inject_report_schema_v2(report_text: str, section: str) -> str:
    """Ensure one schema marker and one identity section, deterministically."""
    clean = remove_anchored_section(report_text, RUN_IDENTITY_ANCHOR)
    lines = [line for line in clean.splitlines() if not SCHEMA_MARKER_RE.match(line)]
    while lines and not lines[-1].strip():
        lines.pop()

    first_heading = next(
        (index for index, line in enumerate(lines) if _heading_level(line) == 1), None
    )
    if first_heading is None:
        prefix: list[str] = [REPORT_SCHEMA_MARKER, "", section.rstrip()]
        if lines:
            prefix.extend(["", *lines])
        return "\n".join(prefix).rstrip() + "\n"

    insertion = first_heading + 1
    before = lines[:insertion]
    after = lines[insertion:]
    while after and not after[0].strip():
        after.pop(0)
    combined = before + ["", REPORT_SCHEMA_MARKER, "", section.rstrip()]
    if after:
        combined.extend(["", *after])
    return "\n".join(combined).rstrip() + "\n"


def _zero_statement(language: str) -> str:
    return ZERO_PUBLIC_ROLL_ZH if language == "zh-Hans" else ZERO_PUBLIC_ROLL_DEFAULT


def _marker_source_comments(report_text: str) -> dict[str, bool]:
    result: dict[str, bool] = {}
    for line in report_text.splitlines():
        marker = ROLL_MARKER_RE.search(line)
        if marker:
            result[marker.group(1)] = bool(ROLL_SOURCE_RE.search(line))
    return result


def build_report_completeness(
    report_text: str,
    roll_source: dict[str, Any],
    rendered: dict[str, Any],
    *,
    play_language: str,
    linked_required_roll_ids: list[str] | None = None,
    linked_keeper_only_roll_ids: list[str] | None = None,
    linked_missing_source_roll_ids: list[str] | None = None,
) -> dict[str, Any]:
    marker_counts = Counter(ROLL_MARKER_RE.findall(report_text))
    source_ids = list(rendered["source_roll_ids"])
    source_counts = Counter(source_ids)
    source_id_set = set(source_ids)
    linked_ids = list(dict.fromkeys(linked_required_roll_ids or []))
    required_ids = list(
        dict.fromkeys([*rendered["required_public_roll_ids"], *linked_ids])
    )
    required_set = set(required_ids)
    incomplete_set = set(rendered["incomplete_roll_ids"])
    source_comment_presence = _marker_source_comments(report_text)

    missing = sorted(roll_id for roll_id in required_set if marker_counts[roll_id] == 0)
    duplicate = sorted(roll_id for roll_id, count in marker_counts.items() if count > 1)
    duplicate_source = sorted(
        roll_id for roll_id, count in source_counts.items() if count > 1
    )
    untraced = sorted(roll_id for roll_id in marker_counts if roll_id not in source_id_set)
    incomplete_required = sorted(required_set & incomplete_set)
    missing_source_comment = sorted(
        roll_id
        for roll_id in required_set
        if marker_counts[roll_id] == 1 and not source_comment_presence.get(roll_id, False)
    )
    rendered_public_count = sum(
        1 for roll_id in required_set if marker_counts[roll_id] == 1
    )
    rules_anchor_count = report_text.count(f"report-anchor: {RULES_AND_DICE_ANCHOR}")
    schema_marker_count = report_text.count(REPORT_SCHEMA_MARKER)
    identity_anchor_count = report_text.count(f"report-anchor: {RUN_IDENTITY_ANCHOR}")
    zero_statement_present = (
        _zero_statement(play_language) in report_text if not required_ids else True
    )
    parse_errors = list(roll_source.get("parse_errors") or [])
    source_logs_present = roll_source.get("source_logs_present") is True
    passed = (
        not any(
            (
                missing,
                duplicate,
                duplicate_source,
                untraced,
                incomplete_required,
                missing_source_comment,
                parse_errors,
            )
        )
        and source_logs_present
        and zero_statement_present
        and rules_anchor_count == 1
        and schema_marker_count == 1
        and identity_anchor_count == 1
    )
    return {
        "schema_version": 1,
        "eval_spec": EVAL_SPEC,
        "report_schema_version": REPORT_SCHEMA_VERSION,
        "source_roll_count": len(source_ids),
        "required_public_roll_count": len(required_ids),
        "linked_required_roll_ids": linked_ids,
        "linked_keeper_only_roll_ids": list(
            dict.fromkeys(linked_keeper_only_roll_ids or [])
        ),
        "linked_missing_source_roll_ids": list(
            dict.fromkeys(linked_missing_source_roll_ids or [])
        ),
        "rendered_public_roll_count": rendered_public_count,
        "keeper_only_roll_count": len(rendered["keeper_only_roll_ids"]),
        "missing_roll_ids": missing,
        "duplicate_roll_ids": duplicate,
        "duplicate_source_roll_ids": duplicate_source,
        "untraced_roll_ids": untraced,
        "incomplete_roll_ids": sorted(incomplete_set),
        "incomplete_required_public_roll_ids": incomplete_required,
        "missing_source_comment_roll_ids": missing_source_comment,
        "missing_fields_by_roll_id": rendered["missing_fields_by_roll_id"],
        "source_refs_by_roll_id": rendered["source_refs_by_roll_id"],
        "source_logs_present": source_logs_present,
        "source_log_paths": list(roll_source.get("source_paths") or []),
        "parse_errors": parse_errors,
        "rules_and_dice_anchor_count": rules_anchor_count,
        "report_schema_marker_present": schema_marker_count == 1,
        "report_schema_marker_count": schema_marker_count,
        "run_identity_anchor_count": identity_anchor_count,
        "zero_public_roll_statement_present": zero_statement_present,
        "passed": passed,
    }


def _creation_linked_roll_requirements(
    run_dir: Path,
    records: list[dict[str, Any]],
) -> dict[str, list[str]]:
    investigator_root = run_dir / "sandbox" / ".coc" / "investigators"
    linked: list[str] = []

    def visit(value: Any) -> None:
        if isinstance(value, dict):
            roll_id = value.get("roll_id")
            if isinstance(roll_id, str) and roll_id:
                linked.append(_safe_marker_id(roll_id))
            for child in value.values():
                visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)

    if investigator_root.is_dir():
        for path in sorted(investigator_root.glob("*/creation.json")):
            if path.parent.name.startswith("."):
                continue
            creation = _read_json(path, None)
            if isinstance(creation, dict):
                visit(creation)
    linked = list(dict.fromkeys(linked))
    rows_by_id: dict[str, list[dict[str, Any]]] = {}
    for record in records:
        roll_id, _legacy, _source_id = _roll_identity(record)
        rows_by_id.setdefault(roll_id, []).append(record)
    required: list[str] = []
    keeper_only: list[str] = []
    missing: list[str] = []
    for roll_id in linked:
        rows = rows_by_id.get(roll_id, [])
        if not rows:
            required.append(roll_id)
            missing.append(roll_id)
        elif any(
            roll_visibility(row) in {"public", "consequence_public"}
            for row in rows
        ):
            required.append(roll_id)
        else:
            keeper_only.append(roll_id)
    return {
        "required": required,
        "keeper_only": keeper_only,
        "missing": missing,
    }


def _find_report_path(run_dir: Path) -> Path | None:
    artifacts = run_dir / "artifacts"
    for basename in REPORT_BASENAMES:
        path = artifacts / basename
        if path.is_file():
            return path
    return None


def _generate_base_reports(run_dir: Path) -> tuple[Path, Path | None]:
    module = _load_sibling(
        "coc_playtest_report_eval_contract", "coc_playtest_report.py"
    )
    generated = module.generate_battle_report(run_dir)
    battle_report = (
        generated if getattr(generated, "_coc_anchored_path", False) else Path(generated)
    )
    evaluation_report: Path | None = None
    generator = getattr(module, "generate_evaluation_report", None)
    if callable(generator):
        generated_evaluation = generator(run_dir)
        evaluation_report = (
            generated_evaluation
            if getattr(generated_evaluation, "_coc_anchored_path", False)
            else Path(generated_evaluation)
        )
    return battle_report, evaluation_report


def _evidence_status(run_dir: Path) -> dict[str, Any]:
    try:
        module = _load_sibling(
            "coc_playtest_evidence_eval_contract", "coc_playtest_evidence.py"
        )
        receipt = module.read_evidence_receipt(run_dir)
    except Exception as exc:
        return {
            "eligible": False,
            "reasons": [f"evidence_validation_error:{type(exc).__name__}"],
            "receipt": {},
        }
    reasons = receipt.get("evidence_reasons")
    return {
        "eligible": receipt.get("eligible_as_gameplay_evidence") is True,
        "reasons": [str(value) for value in reasons]
        if isinstance(reasons, list)
        else [],
        "receipt": receipt,
    }


def contract_status(*, completeness_passed: bool, eligible: bool) -> str:
    if not completeness_passed:
        return "FAIL"
    return "PASS" if eligible else "INELIGIBLE"


def _render_context(
    run_dir: Path,
) -> tuple[dict[str, Any], dict[str, Any], str, dict[str, str], dict[str, str]]:
    metadata = _metadata(run_dir)
    manifest = _run_manifest(run_dir)
    language = str(metadata.get("play_language") or "zh-Hans")
    terms = _localized_terms(metadata, language)
    names = _actor_names(run_dir, terms)
    return metadata, manifest, language, terms, names


def _evaluation_contract_section(
    *,
    status: str,
    completeness: dict[str, Any],
    evidence: dict[str, Any],
) -> str:
    missing_ids = completeness.get("missing_roll_ids") or []
    return "\n".join(
        [
            "## Evaluation Contract <!-- report-anchor: evaluation-contract -->",
            "",
            f"- Contract status: {status}",
            f"- Report schema version: {REPORT_SCHEMA_VERSION}",
            f"- Required public rolls: {completeness.get('required_public_roll_count', 0)}",
            f"- Rendered public rolls: {completeness.get('rendered_public_roll_count', 0)}",
            f"- Keeper-only rolls: {completeness.get('keeper_only_roll_count', 0)}",
            f"- Missing roll IDs: {', '.join(str(value) for value in missing_ids) if missing_ids else 'none'}",
            f"- Evidence eligibility: {'eligible' if evidence.get('eligible') is True else 'ineligible'}",
            "",
        ]
    )


def _synchronize_overall_result(report: str, status: str) -> str:
    """Keep the human summary heading aligned with the strict contract.

    The evaluation report is generated before dice/evidence completeness can
    be finalized.  This controlled heading update makes the final contract the
    sole authority instead of leaving an earlier optimistic PASS at the top.
    """
    lines = report.splitlines()
    try:
        heading = lines.index("## Overall Result")
    except ValueError:
        return report
    for index in range(heading + 1, len(lines)):
        if lines[index].startswith("## "):
            break
        if lines[index].strip():
            lines[index] = status
            suffix = "\n" if report.endswith("\n") else ""
            return "\n".join(lines) + suffix
    lines.insert(heading + 1, status)
    suffix = "\n" if report.endswith("\n") else ""
    return "\n".join(lines) + suffix


def update_evaluation_contract_section(
    path: Path,
    *,
    status: str,
    completeness: dict[str, Any],
    evidence: dict[str, Any],
) -> Path:
    if not path.is_file():
        return path
    current = path.read_text(encoding="utf-8")
    clean = _synchronize_overall_result(
        remove_anchored_section(current, EVALUATION_CONTRACT_ANCHOR),
        status,
    )
    while clean.endswith("\n\n"):
        clean = clean[:-1]
    section = _evaluation_contract_section(
        status=status,
        completeness=completeness,
        evidence=evidence,
    )
    final = clean.rstrip() + "\n\n" + section.rstrip() + "\n"
    return _write_text_atomic(path, final)


def _missing_report_result(root: Path) -> dict[str, Any]:
    completeness = {
        "schema_version": 1,
        "eval_spec": EVAL_SPEC,
        "report_schema_version": REPORT_SCHEMA_VERSION,
        "passed": False,
        "failure": "report_missing",
        "missing_roll_ids": [],
        "duplicate_roll_ids": [],
        "untraced_roll_ids": [],
        "report_schema_marker_present": False,
        "report_schema_marker_count": 0,
        "run_identity_anchor_count": 0,
    }
    receipt_path = _write_json_atomic(
        root / "artifacts" / "report-completeness.json", completeness
    )
    return {
        "schema_version": 1,
        "eval_spec": EVAL_SPEC,
        "report_schema_version": REPORT_SCHEMA_VERSION,
        "status": "FAIL",
        "report_path": None,
        "evaluation_report_path": None,
        "report_completeness_path": str(receipt_path),
        "evidence_eligibility": {"eligible": False, "reasons": ["report_missing"]},
        "report_completeness": completeness,
    }


def _finalize_report_result(
    *,
    root: Path,
    report_path: Path,
    evaluation_report_path: Path | None,
    completeness: dict[str, Any],
    evidence: dict[str, Any],
) -> dict[str, Any]:
    receipt_path = _write_json_atomic(
        root / "artifacts" / "report-completeness.json", completeness
    )
    status = contract_status(
        completeness_passed=completeness["passed"], eligible=evidence["eligible"]
    )
    if evaluation_report_path is not None and evaluation_report_path.is_file():
        update_evaluation_contract_section(
            evaluation_report_path,
            status=status,
            completeness=completeness,
            evidence=evidence,
        )
    return {
        "schema_version": 1,
        "eval_spec": EVAL_SPEC,
        "report_schema_version": REPORT_SCHEMA_VERSION,
        "status": status,
        "report_path": str(report_path),
        "evaluation_report_path": str(evaluation_report_path)
        if evaluation_report_path is not None and evaluation_report_path.is_file()
        else None,
        "report_completeness_path": str(receipt_path),
        "evidence_eligibility": {
            "eligible": evidence["eligible"],
            "reasons": evidence["reasons"],
        },
        "report_completeness": completeness,
    }


def compile_report_contract(
    run_dir: Path | str,
    *,
    generate_base_report: bool = True,
) -> dict[str, Any]:
    require_final_run_path(
        run_dir, purpose="report contract compilation", require_metadata=True
    )
    root = run_dir if getattr(run_dir, "_coc_anchored_path", False) else Path(run_dir)
    evaluation_report_path: Path | None = None
    if generate_base_report:
        report_path, evaluation_report_path = _generate_base_reports(root)
    else:
        report_path = _find_report_path(root)
        candidate = root / "artifacts" / "evaluation-report.md"
        evaluation_report_path = candidate if candidate.is_file() else None
    if report_path is None or not report_path.is_file():
        return _missing_report_result(root)

    metadata, manifest, language, terms, names = _render_context(root)
    evidence = _evidence_status(root)
    identity = render_run_identity_section(
        metadata,
        manifest,
        evidence,
        language=language,
    )
    roll_source = load_roll_records(root)
    rendered = render_rules_and_dice(
        roll_source["records"],
        play_language=language,
        actor_names=names,
        localized_terms=terms,
    )
    creation_links = _creation_linked_roll_requirements(
        root, roll_source["records"]
    )
    final_text = inject_report_schema_v2(
        report_path.read_text(encoding="utf-8"), identity
    )
    final_text = inject_rules_and_dice(final_text, rendered["markdown"])
    _write_text_atomic(report_path, final_text)
    completeness = build_report_completeness(
        final_text,
        roll_source,
        rendered,
        play_language=language,
        linked_required_roll_ids=creation_links["required"],
        linked_keeper_only_roll_ids=creation_links["keeper_only"],
        linked_missing_source_roll_ids=creation_links["missing"],
    )
    return _finalize_report_result(
        root=root,
        report_path=report_path,
        evaluation_report_path=evaluation_report_path,
        completeness=completeness,
        evidence=evidence,
    )


def verify_report_contract(run_dir: Path | str) -> dict[str, Any]:
    require_final_run_path(
        run_dir, purpose="report contract verification", require_metadata=True
    )
    root = run_dir if getattr(run_dir, "_coc_anchored_path", False) else Path(run_dir)
    report_path = _find_report_path(root)
    if report_path is None:
        return _missing_report_result(root)

    _metadata_value, _manifest_value, language, terms, names = _render_context(root)
    roll_source = load_roll_records(root)
    rendered = render_rules_and_dice(
        roll_source["records"],
        play_language=language,
        actor_names=names,
        localized_terms=terms,
    )
    creation_links = _creation_linked_roll_requirements(
        root, roll_source["records"]
    )
    report_text = report_path.read_text(encoding="utf-8")
    completeness = build_report_completeness(
        report_text,
        roll_source,
        rendered,
        play_language=language,
        linked_required_roll_ids=creation_links["required"],
        linked_keeper_only_roll_ids=creation_links["keeper_only"],
        linked_missing_source_roll_ids=creation_links["missing"],
    )
    evidence = _evidence_status(root)
    evaluation_report = root / "artifacts" / "evaluation-report.md"
    return _finalize_report_result(
        root=root,
        report_path=report_path,
        evaluation_report_path=evaluation_report if evaluation_report.is_file() else None,
        completeness=completeness,
        evidence=evidence,
    )


def _manifest_path(value: Path | str) -> Path:
    path = Path(value)
    return path / "run-manifest.json" if path.is_dir() else path


def _completeness_for_manifest(manifest_path: Path) -> dict[str, Any] | None:
    value = _read_json(
        manifest_path.parent / "artifacts" / "report-completeness.json", None
    )
    return value if isinstance(value, dict) else None


def compare_run_manifests(
    baseline: Path | str,
    candidate: Path | str,
) -> dict[str, Any]:
    baseline_path = _manifest_path(baseline)
    candidate_path = _manifest_path(candidate)
    baseline_manifest = _read_json(baseline_path, None)
    candidate_manifest = _read_json(candidate_path, None)
    if not isinstance(baseline_manifest, dict) or not isinstance(
        candidate_manifest, dict
    ):
        return {
            "schema_version": 1,
            "eval_spec": EVAL_SPEC,
            "status": "NON_COMPARABLE",
            "identity_mismatches": ["run_manifest_missing_or_malformed"],
            "regressions": [],
        }

    mismatches = [
        key
        for key in IDENTITY_KEYS
        if baseline_manifest.get(key) != candidate_manifest.get(key)
    ]
    if mismatches:
        return {
            "schema_version": 1,
            "eval_spec": EVAL_SPEC,
            "status": "NON_COMPARABLE",
            "identity_mismatches": mismatches,
            "regressions": [],
        }

    baseline_completeness = _completeness_for_manifest(baseline_path)
    candidate_completeness = _completeness_for_manifest(candidate_path)
    if not isinstance(baseline_completeness, dict) or baseline_completeness.get(
        "passed"
    ) is not True:
        return {
            "schema_version": 1,
            "eval_spec": EVAL_SPEC,
            "status": "NON_COMPARABLE",
            "identity_mismatches": [
                "baseline_report_completeness_missing_or_failed"
            ],
            "regressions": [],
            "baseline_report_completeness": baseline_completeness or {},
            "candidate_report_completeness": candidate_completeness or {},
        }

    regressions: list[dict[str, Any]] = []
    if not isinstance(candidate_completeness, dict):
        regressions.append(
            {
                "key": "report_completeness_missing",
                "baseline": True,
                "candidate": None,
            }
        )
    elif candidate_completeness.get("passed") is not True:
        regressions.append(
            {
                "key": "report_completeness",
                "baseline": True,
                "candidate": candidate_completeness.get("passed"),
                "candidate_missing_roll_ids": candidate_completeness.get(
                    "missing_roll_ids", []
                ),
            }
        )
    return {
        "schema_version": 1,
        "eval_spec": EVAL_SPEC,
        "status": "FAIL" if regressions else "PASS",
        "identity_mismatches": [],
        "regressions": regressions,
        "baseline_report_completeness": baseline_completeness,
        "candidate_report_completeness": candidate_completeness or {},
    }


def write_baseline_manifest(source: Path | str, output: Path | str) -> dict[str, Any]:
    source_path = _manifest_path(source)
    payload = _read_json(source_path, None)
    if not isinstance(payload, dict):
        raise ValueError(f"run manifest missing or malformed: {source_path}")
    receipt_path = source_path.parent / "artifacts" / "report-completeness.json"
    receipt = _read_json(receipt_path, None)
    if not isinstance(receipt, dict) or receipt.get("passed") is not True:
        raise ValueError(
            "baseline source requires a verified report-completeness receipt"
        )
    normalized = {
        key: payload.get(key)
        for key in (
            "schema_version",
            *IDENTITY_KEYS,
            "run_id",
            "suite",
            "candidate_commit",
            "artifact_hashes",
        )
        if key in payload
    }
    normalized["baseline_source"] = str(source_path)
    normalized["report_completeness_sha256"] = file_sha256(receipt_path)
    report_path = _find_report_path(source_path.parent)
    if report_path is not None:
        normalized["battle_report_sha256"] = file_sha256(report_path)
    target = Path(output)
    _write_json_atomic(target, normalized)
    return {
        "status": "PASS",
        "baseline_manifest": str(target),
        "payload": normalized,
    }
