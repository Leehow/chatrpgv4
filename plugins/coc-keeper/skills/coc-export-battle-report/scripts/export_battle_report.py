#!/usr/bin/env python3
"""Build the final player-readable battle report from one real playtest run."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import tempfile
from collections import Counter
from pathlib import Path
from typing import Any


SCHEMA_VERSION = 2
JSON_OUTPUT = "battle-report-evidence.json"
MARKDOWN_OUTPUT = "battle-report.md"
METADATA_CANDIDATES = ("run.json", "playtest.json")
KEEPER_ROLES = {"keeper", "keeper_under_test", "kp", "narrator"}
PLAYER_ROLES = {"player", "player_simulator"}
DIALOGUE_ROLES = KEEPER_ROLES | PLAYER_ROLES
PUBLIC_VISIBILITIES = {"public", "consequence_public"}
MARKDOWN_HIDDEN_KEYS = {
    "clue_graph",
    "keeper_notes",
    "keeper_secret",
    "module_truth",
    "npc_agendas",
    "notes",
    "private_notes",
    "scenario_id",
    "scenario_truth",
    "secret",
}


class ExportError(RuntimeError):
    """Raised when source or destination safety prevents an honest export."""


def _canonical_bytes(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def _pretty_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2)


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _safe_source_path(run_dir: Path, relative: str) -> Path:
    relative_path = Path(relative)
    if relative_path.is_absolute() or ".." in relative_path.parts:
        raise ExportError(f"source path escapes run directory: {relative}")
    candidate = run_dir / relative_path
    try:
        candidate.resolve(strict=False).relative_to(run_dir.resolve())
    except ValueError as exc:
        raise ExportError(f"source path escapes run directory: {relative}") from exc
    return candidate


def _read_source(
    run_dir: Path,
    relative: str,
    kind: str,
    manifest: dict[str, dict[str, Any]],
    *,
    required: bool = False,
) -> Any:
    path = _safe_source_path(run_dir, relative)
    entry: dict[str, Any] = {
        "kind": kind,
        "path": relative,
        "present": False,
        "required": required,
    }
    manifest[relative] = entry
    if not path.exists():
        entry["status"] = "MISSING"
        return None
    if path.is_symlink() or not path.is_file():
        entry["status"] = "UNSAFE"
        entry["error"] = "source must be a regular non-symlink file"
        if required:
            raise ExportError(f"unsafe required source: {relative}")
        return None

    raw = path.read_bytes()
    entry.update(
        {
            "byte_count": len(raw),
            "present": True,
            "sha256": _sha256(raw),
            "status": "READ",
        }
    )
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ExportError(f"source is not UTF-8: {relative}") from exc

    try:
        if kind == "jsonl":
            rows = [json.loads(line) for line in text.splitlines() if line.strip()]
            entry["record_count"] = len(rows)
            return rows
        value = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ExportError(
            f"invalid {kind} source {relative}: line {exc.lineno}, column {exc.colno}"
        ) from exc
    entry["record_count"] = len(value) if isinstance(value, list) else 1
    return value


def _party_ids(party: Any) -> list[str]:
    if not isinstance(party, dict):
        return []
    result: list[str] = []
    for key in ("investigator_ids", "active_investigator_ids", "investigators", "members"):
        values = party.get(key)
        if not isinstance(values, list):
            continue
        for value in values:
            if isinstance(value, str):
                investigator_id = value
            elif isinstance(value, dict):
                investigator_id = value.get("investigator_id") or value.get("id")
            else:
                investigator_id = None
            normalized = str(investigator_id) if investigator_id is not None else None
            if normalized and normalized not in result:
                result.append(normalized)
    return result


def _campaign_relative(run_dir: Path, metadata: Any) -> str | None:
    campaigns = run_dir / "sandbox" / ".coc" / "campaigns"
    campaign_id = metadata.get("campaign_id") if isinstance(metadata, dict) else None
    if campaign_id:
        relative = f"sandbox/.coc/campaigns/{campaign_id}"
        candidate = _safe_source_path(run_dir, relative)
        if candidate.is_dir() and not candidate.is_symlink():
            return relative
    if not campaigns.is_dir() or campaigns.is_symlink():
        return None
    choices = sorted(
        path for path in campaigns.iterdir() if path.is_dir() and not path.is_symlink()
    )
    return choices[0].relative_to(run_dir).as_posix() if len(choices) == 1 else None


def _is_dialogue_row(row: Any) -> bool:
    return (
        isinstance(row, dict)
        and isinstance(row.get("role"), str)
        and row["role"].casefold() in DIALOGUE_ROLES
        and isinstance(row.get("text"), str)
    )


def _dialogue_side(row: Any) -> str | None:
    if not _is_dialogue_row(row) or not row["text"].strip():
        return None
    return "keeper" if row["role"].casefold() in KEEPER_ROLES else "player"


def _card_status(value: Any) -> str:
    if value is None:
        return "MISSING"
    if not isinstance(value, dict) or not value:
        return "INVALID"
    return "PRESENT"


def _roll_visibility(row: Any) -> str:
    if not isinstance(row, dict):
        return "unknown"
    payload = row.get("payload")
    for source in (row, payload if isinstance(payload, dict) else {}):
        value = source.get("visibility")
        if isinstance(value, str):
            return value
    return "public" if row.get("secret") is not True else "keeper_only"


def _roll_id(row: Any) -> str | None:
    if not isinstance(row, dict):
        return None
    payload = row.get("payload")
    for source in (row, payload if isinstance(payload, dict) else {}):
        value = source.get("roll_id")
        if isinstance(value, str) and value.strip():
            return value
    return None


def _has_numeric_roll(row: Any) -> bool:
    if not isinstance(row, dict):
        return False
    payload = row.get("payload")
    for source in (row, payload if isinstance(payload, dict) else {}):
        for key in ("roll", "rolls", "total", "result", "value"):
            value = source.get(key)
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                return True
            if isinstance(value, list) and value and all(
                isinstance(item, (int, float)) and not isinstance(item, bool)
                for item in value
            ):
                return True
    return False


def _hidden_key(key: Any) -> bool:
    normalized = str(key).casefold()
    return (
        normalized in MARKDOWN_HIDDEN_KEYS
        or normalized.startswith(("keeper_", "private_", "hidden_", "secret_"))
        or normalized.endswith("_secret")
    )


def _player_safe(value: Any) -> Any:
    if isinstance(value, dict):
        if value.get("secret") is True or value.get("visibility") == "keeper_only":
            return {"redacted": True}
        return {
            str(key): _player_safe(child)
            for key, child in value.items()
            if not _hidden_key(key)
        }
    if isinstance(value, list):
        return [_player_safe(item) for item in value]
    return value


def _source_payload(run_dir: Path, *, allow_partial: bool) -> dict[str, Any]:
    manifest: dict[str, dict[str, Any]] = {}
    metadata_source = METADATA_CANDIDATES[0]
    raw_metadata = None
    for relative in METADATA_CANDIDATES:
        if _safe_source_path(run_dir, relative).exists():
            metadata_source = relative
            raw_metadata = _read_source(run_dir, relative, "json", manifest, required=True)
            break
    if raw_metadata is None:
        raw_metadata = _read_source(run_dir, metadata_source, "json", manifest)
    metadata = _safe_metadata(raw_metadata)

    final_path = run_dir / "transcript.jsonl"
    partial_path = run_dir / "partial-transcript.jsonl"
    if final_path.exists():
        transcript_relative = "transcript.jsonl"
        transcript_complete = True
    elif partial_path.exists():
        if not allow_partial:
            raise ExportError(
                "only partial-transcript.jsonl exists; rerun with --allow-partial to export it as INCOMPLETE"
            )
        transcript_relative = "partial-transcript.jsonl"
        transcript_complete = False
    else:
        transcript_relative = "transcript.jsonl"
        transcript_complete = False
    transcript = _read_source(
        run_dir, transcript_relative, "jsonl", manifest,
        required=final_path.exists() or partial_path.exists(),
    ) or []
    dialogue = []
    for source_line, row in enumerate(transcript, start=1):
        if not _is_dialogue_row(row):
            continue
        projected = {"source_line": source_line, "role": row["role"], "text": row["text"]}
        for key in ("turn", "speaker", "speaker_display", "text_display"):
            if isinstance(row.get(key), (str, int, float)):
                projected[key] = row[key]
        dialogue.append(projected)

    campaign_relative = _campaign_relative(run_dir, raw_metadata)
    party = _read_source(run_dir, f"{campaign_relative}/party.json", "json", manifest) if campaign_relative else None
    investigator_ids = _party_ids(party)
    roots = [run_dir / "sandbox" / ".coc" / "investigators"]
    if campaign_relative:
        roots.insert(0, run_dir / campaign_relative / "save" / "investigator-state")
    for root in roots:
        if not root.is_dir() or root.is_symlink():
            continue
        for path in sorted(root.iterdir()):
            candidate = path.stem if path.is_file() and path.suffix == ".json" else path.name
            if (path.is_file() or path.is_dir()) and not path.is_symlink() and candidate not in investigator_ids:
                investigator_ids.append(candidate)

    investigators: list[dict[str, Any]] = []
    for investigator_id in investigator_ids:
        base = f"sandbox/.coc/investigators/{investigator_id}"
        character = _read_source(run_dir, f"{base}/character.json", "json", manifest)
        creation = _read_source(run_dir, f"{base}/creation.json", "json", manifest)
        state = _read_source(
            run_dir, f"{campaign_relative}/save/investigator-state/{investigator_id}.json",
            "json", manifest,
        ) if campaign_relative else None
        investigators.append(
            {
                "investigator_id": investigator_id,
                "character": _player_safe(character) if isinstance(character, dict) else None,
                "creation": _player_safe(creation) if isinstance(creation, dict) else None,
                "state": _player_safe(state) if isinstance(state, dict) else None,
                "source_status": {
                    "character": _card_status(character),
                    "creation": _card_status(creation),
                    "state": _card_status(state),
                },
            }
        )

    public_rolls: list[dict[str, Any]] = []
    all_rolls = None
    rolls_relative = None
    malformed_lines: list[int] = []
    if campaign_relative:
        rolls_relative = f"{campaign_relative}/logs/rolls.jsonl"
        all_rolls = _read_source(run_dir, rolls_relative, "jsonl", manifest)
        for source_line, row in enumerate(all_rolls or [], start=1):
            if _roll_visibility(row).casefold() not in PUBLIC_VISIBILITIES:
                continue
            if not isinstance(row, dict):
                malformed_lines.append(source_line)
                continue
            if _roll_id(row) is None or not _has_numeric_roll(row):
                malformed_lines.append(source_line)
            projected = _player_safe(row)
            assert isinstance(projected, dict)
            projected.update(
                source_line=source_line,
                source_path=rolls_relative,
                source_ref=row.get("source_ref") or f"{rolls_relative}#{source_line}",
            )
            public_rolls.append(projected)
        manifest[rolls_relative]["included_record_count"] = len(public_rolls)
        manifest[rolls_relative]["projection"] = "public_and_consequence_public_only"

    roll_ids = [_roll_id(row) for row in public_rolls]
    duplicate_roll_ids = sorted(
        roll_id for roll_id, count in Counter(roll_ids).items() if roll_id and count > 1
    )

    role_counts = {
        "keeper": sum(_dialogue_side(row) == "keeper" for row in transcript),
        "player": sum(_dialogue_side(row) == "player" for row in transcript),
    }
    reasons: list[str] = []
    if not metadata:
        reasons.append("run.json or playtest.json metadata is missing or empty")
    if not transcript_complete:
        reasons.append(
            "final transcript.jsonl is missing"
            if transcript_relative == "transcript.jsonl"
            else "partial transcript exported by explicit request"
        )
    if role_counts["keeper"] == 0:
        reasons.append("no non-empty Keeper/KP dialogue rows were found")
    if role_counts["player"] == 0:
        reasons.append("no non-empty player dialogue rows were found")
    if campaign_relative is None:
        reasons.append("campaign directory could not be resolved")
    if not investigator_ids:
        reasons.append("no investigator state or character source was discovered")
    for investigator in investigators:
        if investigator["source_status"]["state"] != "PRESENT" and investigator["source_status"]["character"] != "PRESENT":
            reasons.append(f"investigator {investigator['investigator_id']} has neither state nor character data")
    if all_rolls is None:
        reasons.append("structured rolls.jsonl is missing; public roll count cannot be proven")
    if malformed_lines:
        reasons.append("public roll rows lack roll_id or numerical evidence at source lines: " + ", ".join(map(str, malformed_lines)))
    if duplicate_roll_ids:
        reasons.append("duplicate public roll IDs: " + ", ".join(duplicate_roll_ids))

    return {
        "completeness": {
            "classification": "COMPLETE" if not reasons else "INCOMPLETE",
            "dialogue_role_counts": role_counts,
            "final_transcript_present": transcript_complete,
            "reasons": reasons,
        },
        "investigators": investigators,
        "public_rolls": {
            "source_path": rolls_relative,
            "source_present": all_rolls is not None,
            "required_count": len(public_rolls),
            "rendered_count": len(public_rolls),
            "duplicate_roll_ids": duplicate_roll_ids,
            "malformed_source_lines": malformed_lines,
            "records": public_rolls,
            "status": "PASS" if all_rolls is not None and not duplicate_roll_ids and not malformed_lines else "FAIL",
        },
        "run_metadata": metadata,
        "source_identity": {
            "metadata_source": metadata_source,
            "campaign_id": metadata.get("campaign_id"),
            "campaign_source_directory": campaign_relative,
            "run_id": metadata.get("run_id"),
            "transcript_sha256": manifest[transcript_relative].get("sha256"),
            "transcript_source": transcript_relative,
        },
        "source_manifest": sorted(manifest.values(), key=lambda item: item["path"]),
        "transcript": {
            "source_record_count": len(transcript),
            "dialogue_record_count": len(dialogue),
            "records": dialogue,
        },
    }


def _safe_metadata(metadata: Any) -> dict[str, Any]:
    if not isinstance(metadata, dict):
        return {}
    allowed = (
        "run_id",
        "campaign_id",
        "seed",
        "play_language",
        "run_kind",
        "play_kind",
        "simulation_method",
        "started_at",
        "finished_at",
        "status",
    )
    return {key: metadata[key] for key in allowed if key in metadata}


def _first(mapping: Any, keys: tuple[str, ...]) -> Any:
    if not isinstance(mapping, dict):
        return None
    for key in keys:
        if mapping.get(key) not in (None, ""):
            return mapping[key]
    return None


def _first_not_none(*values: Any) -> Any:
    for value in values:
        if value is not None:
            return value
    return None


def _display(value: Any) -> str:
    if isinstance(value, bool):
        return "yes" if value else "no"
    if isinstance(value, (str, int, float)):
        return str(value)
    if isinstance(value, list) and all(isinstance(item, (str, int, float)) for item in value):
        return ", ".join(map(str, value))
    return _pretty_json(value).replace("\n", " ")


def _markdown(report: dict[str, Any]) -> str:
    metadata = report["run_metadata"]
    completeness = report["completeness"]
    lines = [
        "# COC Actual-Play Battle Report", "",
        "This is the final player-readable report produced directly from a real playtest run.", "",
        f"- Report ID: `{report['report_id']}`",
        f"- Run: `{metadata.get('run_id', 'MISSING')}`",
        f"- Campaign: `{metadata.get('campaign_id', 'MISSING')}`",
        f"- Completeness: **{completeness['classification']}**", "",
        "## Investigators", "",
    ]
    if not report["investigators"]:
        lines.extend(["No investigator evidence was found.", ""])
    for investigator in report["investigators"]:
        character = investigator.get("character") or {}
        state = investigator.get("state") or {}
        name = _first(character, ("name", "display_name")) or _first(state, ("name", "display_name")) or investigator["investigator_id"]
        lines.extend([f"### {name}", ""])
        fields = (
            ("ID", investigator["investigator_id"]),
            ("Occupation", _first(character, ("occupation", "profession"))),
            ("Age", _first(character, ("age",))),
            (
                "HP",
                _first_not_none(
                    _first(state, ("hp", "hit_points")),
                    _first(character, ("hp", "hit_points")),
                ),
            ),
            (
                "SAN",
                _first_not_none(
                    _first(state, ("san", "sanity")),
                    _first(character, ("san", "sanity")),
                ),
            ),
            (
                "MP",
                _first_not_none(
                    _first(state, ("mp", "magic_points")),
                    _first(character, ("mp", "magic_points")),
                ),
            ),
            ("Conditions", _first(state, ("conditions",))),
        )
        lines.extend(f"- {label}: {_display(value)}" for label, value in fields if value not in (None, "", []))
        lines.append("")

    lines.extend(["## Actual Play", ""])
    for index, row in enumerate(report["transcript"]["records"], start=1):
        side = "Keeper" if row["role"].casefold() in KEEPER_ROLES else "Player"
        speaker = row.get("speaker_display") or row.get("speaker") or side
        lines.extend([f"### Turn {row.get('turn', index)} · {speaker}", "", row["text"].strip(), ""])
    if not report["transcript"]["records"]:
        lines.extend(["No player/Keeper dialogue was recorded.", ""])

    rolls = report["public_rolls"]
    lines.extend(["## Public Rules and Dice", "", f"Public roll count: **{rolls['required_count']}**.", f"Dice completeness: **{rolls['status']}**.", ""])
    for roll in rolls["records"]:
        payload = roll.get("payload") if isinstance(roll.get("payload"), dict) else {}
        lines.extend([f"### `{_roll_id(roll) or 'MISSING'}`", ""])
        fields = (
            (
                "Actor",
                _first_not_none(
                    _first(roll, ("actor", "investigator_id")),
                    _first(payload, ("actor", "investigator_id")),
                ),
            ),
            (
                "Check",
                _first_not_none(
                    _first(payload, ("skill", "attribute", "reason", "expression")),
                    _first(roll, ("skill", "reason", "expression")),
                ),
            ),
            (
                "Roll",
                _first_not_none(
                    _first(payload, ("roll", "rolls", "total", "result", "value")),
                    _first(roll, ("roll", "rolls", "total", "result", "value")),
                ),
            ),
            (
                "Target",
                _first_not_none(
                    _first(payload, ("effective_target", "target")),
                    _first(roll, ("effective_target", "target")),
                ),
            ),
            (
                "Difficulty",
                _first_not_none(
                    _first(payload, ("difficulty",)),
                    _first(roll, ("difficulty",)),
                ),
            ),
            (
                "Outcome",
                _first_not_none(
                    _first(payload, ("outcome", "success_level")),
                    _first(roll, ("outcome", "success_level")),
                ),
            ),
            ("Visibility", _roll_visibility(roll)),
            ("Source", roll.get("source_ref")),
        )
        lines.extend(f"- {label}: {_display(value)}" for label, value in fields if value not in (None, "", []))
        lines.append("")
    if not rolls["records"]:
        lines.extend(["No public or consequence-public rolls occurred.", ""])

    lines.extend(["## Completeness and Provenance", ""])
    lines.extend([f"- {reason}" for reason in completeness["reasons"]] or ["- All required final-report sources passed validation."])
    lines.extend([
        f"- Dialogue rows rendered: {report['transcript']['dialogue_record_count']}.",
        f"- Public rolls rendered exactly once: {rolls['rendered_count']}.",
        "- Keeper-only rolls, scenario truth, hidden logs, runner prompts, and secret fields are excluded.", "",
    ])
    return "\n".join(lines)


def _safe_artifacts_dir(run_dir: Path) -> Path:
    artifacts = run_dir / "artifacts"
    if artifacts.exists():
        if artifacts.is_symlink() or not artifacts.is_dir():
            raise ExportError("artifacts must be a real directory, not a symlink or file")
    else:
        artifacts.mkdir(mode=0o755)
    for name in (JSON_OUTPUT, MARKDOWN_OUTPUT):
        output = artifacts / name
        if output.is_symlink():
            raise ExportError(f"refusing to overwrite output symlink: artifacts/{name}")
        if output.exists() and not output.is_file():
            raise ExportError(f"output is not a regular file: artifacts/{name}")
    return artifacts


def _atomic_pair(artifacts: Path, outputs: dict[str, bytes]) -> None:
    staged: dict[str, Path] = {}
    try:
        for name, content in outputs.items():
            descriptor, temporary = tempfile.mkstemp(prefix=f".{name}.", dir=artifacts)
            path = Path(temporary)
            staged[name] = path
            with os.fdopen(descriptor, "wb") as handle:
                handle.write(content)
                handle.flush()
                os.fsync(handle.fileno())
        for name in (JSON_OUTPUT, MARKDOWN_OUTPUT):
            os.replace(staged.pop(name), artifacts / name)
        directory_fd = os.open(artifacts, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        for path in staged.values():
            path.unlink(missing_ok=True)


def export_battle_report(run_dir: Path | str, *, allow_partial: bool = False) -> dict[str, Any]:
    lexical = Path(run_dir).absolute()
    if lexical.is_symlink() or not lexical.is_dir():
        raise ExportError("run directory must be an existing real directory")
    resolved = lexical.resolve()
    source = _source_payload(resolved, allow_partial=allow_partial)
    identity_material = {
        "schema_version": SCHEMA_VERSION,
        "source_manifest": source["source_manifest"],
        "source_payload": source,
    }
    report_id = "coc-battle-report-" + _sha256(_canonical_bytes(identity_material))[:24]
    report = {
        "schema_version": SCHEMA_VERSION,
        "report_id": report_id,
        "report_type": "coc_actual_play_battle_report_evidence",
        "markdown_audience": "player_safe",
        **source,
    }
    json_bytes = (_pretty_json(report) + "\n").encode("utf-8")
    markdown_bytes = (_markdown(report).rstrip() + "\n").encode("utf-8")
    artifacts = _safe_artifacts_dir(resolved)
    _atomic_pair(artifacts, {JSON_OUTPUT: json_bytes, MARKDOWN_OUTPUT: markdown_bytes})
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run_dir", type=Path, help="real COC playtest run directory")
    parser.add_argument(
        "--allow-partial",
        action="store_true",
        help="render partial-transcript.jsonl as an explicitly INCOMPLETE report",
    )
    args = parser.parse_args(argv)
    try:
        report = export_battle_report(args.run_dir, allow_partial=args.allow_partial)
    except (ExportError, OSError) as exc:
        parser.exit(2, f"error: {exc}\n")
    print(
        json.dumps(
            {
                "classification": report["completeness"]["classification"],
                "outputs": [
                    f"artifacts/{JSON_OUTPUT}",
                    f"artifacts/{MARKDOWN_OUTPUT}",
                ],
                "report_id": report["report_id"],
            },
            ensure_ascii=False,
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
