#!/usr/bin/env python3
"""Export one COC playtest as a deterministic report source-bundle pair."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import tempfile
from pathlib import Path
from typing import Any


SCHEMA_VERSION = 1
JSON_OUTPUT = "battle-report-source-bundle.json"
MARKDOWN_OUTPUT = "battle-report-source-bundle.md"
CANONICAL_REPORTS = (
    "battle-report.md",
    "verification-sample.md",
    "diagnostic-play-report.md",
)
KEEPER_ROLES = {"keeper", "keeper_under_test", "kp", "narrator"}
PLAYER_ROLES = {"player", "player_simulator"}
DIALOGUE_ROLES = KEEPER_ROLES | PLAYER_ROLES
RUN_JSON = (
    "playtest.json",
    "match-result.json",
    "run-manifest.json",
    "run-identity.json",
    "artifacts/report-completeness.json",
)
PLAYER_SAFE_RUN_JSONL = (
    "player-view.jsonl",
    "player-feedback.jsonl",
)
INVESTIGATOR_JSONL = (
    "history.jsonl",
    "development.jsonl",
    "inventory-history.jsonl",
)
CAMPAIGN_JSON = (
    "campaign.json",
    "party.json",
    "save/active-scene.json",
    "save/combat.json",
    "save/chase.json",
    "save/flags.json",
    "save/world-state.json",
)
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


def _investigator_ids(run_dir: Path, party: Any) -> tuple[list[str], bool]:
    party_ids = _party_ids(party)
    if party_ids:
        return party_ids, True
    root = run_dir / "sandbox" / ".coc" / "investigators"
    if not root.is_dir() or root.is_symlink():
        return [], False
    return (
        sorted(
            path.name
            for path in root.iterdir()
            if path.is_dir() and not path.is_symlink() and not path.name.startswith(".")
        ),
        False,
    )


def _receipt_status(receipt: Any) -> str:
    if not isinstance(receipt, dict):
        return "MISSING"
    if receipt.get("passed") is True:
        return "PASS"
    if receipt.get("passed") is False:
        return "FAIL"
    if receipt.get("valid") is True:
        return "PASS"
    if receipt.get("valid") is False:
        return "FAIL"
    status = receipt.get("status")
    if isinstance(status, str):
        return status
    return "UNKNOWN"


def _canonical_report_binding(run_dir: Path, receipt: Any) -> dict[str, Any]:
    artifacts = run_dir / "artifacts"
    report_path = None
    for name in CANONICAL_REPORTS:
        candidate = artifacts / name
        if candidate.is_symlink():
            return {
                "binding_status": "CANONICAL_REPORT_UNSAFE",
                "path": f"artifacts/{name}",
                "sha256": None,
            }
        if candidate.exists() and not candidate.is_file():
            return {
                "binding_status": "CANONICAL_REPORT_UNSAFE",
                "path": f"artifacts/{name}",
                "sha256": None,
            }
        if candidate.is_file():
            report_path = candidate
            break
    if report_path is None:
        return {
            "binding_status": "CANONICAL_REPORT_MISSING",
            "path": None,
            "sha256": None,
        }
    report_hash = _sha256(report_path.read_bytes())
    expected = None
    if isinstance(receipt, dict):
        for key in ("battle_report_sha256", "report_sha256"):
            if isinstance(receipt.get(key), str):
                expected = receipt[key]
                break
    if not isinstance(receipt, dict):
        binding_status = "RECEIPT_MISSING"
    elif expected is None:
        binding_status = "RECEIPT_PRESENT_NO_REPORT_HASH"
    elif expected == report_hash:
        binding_status = "MATCH"
    else:
        binding_status = "MISMATCH"
    return {
        "binding_status": binding_status,
        "path": f"artifacts/{report_path.name}",
        "sha256": report_hash,
        "receipt_expected_sha256": expected,
    }


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


def _speaker_label(row: dict[str, Any]) -> tuple[str, str]:
    for field in ("speaker_display", "speaker"):
        value = row.get(field)
        if isinstance(value, str) and value.strip():
            return field, value
    return "role", str(row["role"])


def _roll_visibility(row: Any) -> str:
    if not isinstance(row, dict):
        return "unknown"
    payload = row.get("payload")
    for source in (row, payload if isinstance(payload, dict) else {}):
        value = source.get("visibility")
        if isinstance(value, str):
            return value
    return "public" if row.get("secret") is not True else "keeper_only"


def _source_payload(run_dir: Path, *, allow_partial: bool) -> dict[str, Any]:
    manifest: dict[str, dict[str, Any]] = {}
    run_inputs: dict[str, Any] = {}
    for relative in RUN_JSON:
        value = _read_source(
            run_dir,
            relative,
            "json",
            manifest,
            required=relative == "playtest.json",
        )
        if value is not None:
            run_inputs[relative] = value
    metadata = run_inputs.get("playtest.json")
    if not isinstance(metadata, dict):
        metadata = {}

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
    transcript = _read_source(run_dir, transcript_relative, "jsonl", manifest) or []
    run_inputs[transcript_relative] = transcript

    for relative in PLAYER_SAFE_RUN_JSONL:
        value = _read_source(run_dir, relative, "jsonl", manifest)
        if value is not None:
            run_inputs[relative] = value

    campaign_relative = _campaign_relative(run_dir, metadata)
    campaign_inputs: dict[str, Any] = {}
    if campaign_relative is not None:
        for suffix in CAMPAIGN_JSON:
            value = _read_source(
                run_dir, f"{campaign_relative}/{suffix}", "json", manifest
            )
            if value is not None:
                campaign_inputs[suffix] = value

    party = campaign_inputs.get("party.json")
    investigator_ids, party_resolved = _investigator_ids(run_dir, party)
    if campaign_relative is not None:
        for investigator_id in investigator_ids:
            suffix = f"save/investigator-state/{investigator_id}.json"
            value = _read_source(
                run_dir, f"{campaign_relative}/{suffix}", "json", manifest
            )
            if value is not None:
                campaign_inputs[suffix] = value
    investigators: list[dict[str, Any]] = []
    missing_character_ids: list[str] = []
    missing_creation_ids: list[str] = []
    invalid_character_ids: list[str] = []
    invalid_creation_ids: list[str] = []
    for investigator_id in investigator_ids:
        base = f"sandbox/.coc/investigators/{investigator_id}"
        character = _read_source(run_dir, f"{base}/character.json", "json", manifest)
        creation = _read_source(run_dir, f"{base}/creation.json", "json", manifest)
        supporting: dict[str, Any] = {}
        for filename in INVESTIGATOR_JSONL:
            value = _read_source(run_dir, f"{base}/{filename}", "jsonl", manifest)
            if value is not None:
                supporting[filename] = value
        character_status = _card_status(character)
        creation_status = _card_status(creation)
        if character_status == "MISSING":
            missing_character_ids.append(investigator_id)
        elif character_status == "INVALID":
            invalid_character_ids.append(investigator_id)
        if creation_status == "MISSING":
            missing_creation_ids.append(investigator_id)
        elif creation_status == "INVALID":
            invalid_creation_ids.append(investigator_id)
        investigators.append(
            {
                "character": character,
                "character_status": character_status,
                "creation": creation,
                "creation_status": creation_status,
                "investigator_id": investigator_id,
                "party_member": investigator_id in _party_ids(party),
                "source_directory": base,
                "supporting_records": supporting,
            }
        )

    public_rolls: list[Any] = []
    if campaign_relative is not None:
        rolls_relative = f"{campaign_relative}/logs/rolls.jsonl"
        all_rolls = _read_source(run_dir, rolls_relative, "jsonl", manifest) or []
        public_rolls = [
            row
            for row in all_rolls
            if _roll_visibility(row) in {"public", "consequence_public"}
        ]
        manifest[rolls_relative]["included_record_count"] = len(public_rolls)
        manifest[rolls_relative]["projection"] = "public_and_consequence_public_only"

    role_counts = {
        "keeper": sum(_dialogue_side(row) == "keeper" for row in transcript),
        "player": sum(_dialogue_side(row) == "player" for row in transcript),
    }
    aliases = sorted(
        row["role"].casefold()
        for row in transcript
        if _is_dialogue_row(row) and row["text"].strip()
    )
    alias_counts = {alias: aliases.count(alias) for alias in sorted(set(aliases))}
    receipt = run_inputs.get("artifacts/report-completeness.json")
    receipt_status = _receipt_status(receipt)
    report_binding = _canonical_report_binding(run_dir, receipt)
    reasons: list[str] = []
    if not metadata:
        reasons.append("playtest.json metadata is missing or empty")
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
    if not investigator_ids:
        reasons.append("no investigators discovered through canonical party/run paths")
    if missing_character_ids:
        reasons.append("missing character.json for: " + ", ".join(missing_character_ids))
    if missing_creation_ids:
        reasons.append("missing creation.json for: " + ", ".join(missing_creation_ids))
    if invalid_character_ids:
        reasons.append("empty or non-object character.json for: " + ", ".join(invalid_character_ids))
    if invalid_creation_ids:
        reasons.append("empty or non-object creation.json for: " + ", ".join(invalid_creation_ids))
    if receipt_status != "PASS":
        reasons.append(f"report-completeness receipt status is {receipt_status}")
    if report_binding["binding_status"] in {
        "CANONICAL_REPORT_MISSING",
        "CANONICAL_REPORT_UNSAFE",
        "MISMATCH",
    }:
        reasons.append(
            "canonical report binding status is " + report_binding["binding_status"]
        )

    receipt_manifest = manifest.get("artifacts/report-completeness.json", {})
    return {
        "campaign": {
            "resolved_source_directory": campaign_relative,
            "structured_inputs": campaign_inputs,
        },
        "completeness": {
            "classification": "COMPLETE" if not reasons else "INCOMPLETE",
            "dialogue_alias_counts": alias_counts,
            "dialogue_role_counts": role_counts,
            "dialogue_role_coverage": {
                "keeper": role_counts["keeper"] > 0,
                "player": role_counts["player"] > 0,
                "roles_present": list(alias_counts),
            },
            "discovered_investigator_count": len(investigators),
            "final_transcript_present": transcript_complete,
            "invalid_character_ids": invalid_character_ids,
            "invalid_creation_ids": invalid_creation_ids,
            "missing_character_ids": missing_character_ids,
            "missing_creation_ids": missing_creation_ids,
            "party_membership_resolved": party_resolved,
            "reasons": reasons,
            "receipt_binding": {
                "path": "artifacts/report-completeness.json",
                "sha256": receipt_manifest.get("sha256"),
                "status": receipt_status,
                "verification": "SOURCE_STATUS_ONLY_NOT_RECOMPUTED_BY_EXPORTER",
            },
            "report_binding": report_binding,
            "transcript_record_count": len(transcript),
            "transcript_source": transcript_relative,
        },
        "investigators": investigators,
        "public_rolls": {
            "record_count": len(public_rolls),
            "records": public_rolls,
        },
        "run_metadata": metadata,
        "source_identity": {
            "campaign_id": metadata.get("campaign_id"),
            "campaign_source_directory": campaign_relative,
            "run_id": metadata.get("run_id"),
            "transcript_sha256": manifest[transcript_relative].get("sha256"),
            "transcript_source": transcript_relative,
        },
        "source_manifest": sorted(manifest.values(), key=lambda item: item["path"]),
        "structured_run_inputs": run_inputs,
        "transcript": {"record_count": len(transcript), "records": transcript},
    }


def _fence(value: str, language: str = "") -> str:
    longest = max((len(match.group(0)) for match in re.finditer(r"`+", value)), default=0)
    marker = "`" * max(3, longest + 1)
    return f"{marker}{language}\n{value}\n{marker}"


def _manifest_markdown(entries: list[dict[str, Any]]) -> list[str]:
    lines = [
        "| Source | Status | Records | Included | Bytes | SHA-256 |",
        "| --- | --- | ---: | ---: | ---: | --- |",
    ]
    for entry in entries:
        path = str(entry["path"]).replace("|", "\\|")
        lines.append(
            f"| `{path}` | {entry['status']} | {entry.get('record_count', '—')} | "
            f"{entry.get('included_record_count', entry.get('record_count', '—'))} | "
            f"{entry.get('byte_count', '—')} | `{entry.get('sha256', '—')}` |"
        )
    return lines


def _safe_metadata(metadata: Any) -> dict[str, Any]:
    if not isinstance(metadata, dict):
        return {}
    allowed = (
        "run_id",
        "campaign_id",
        "play_language",
        "run_kind",
        "play_kind",
        "simulation_method",
    )
    return {key: metadata[key] for key in allowed if key in metadata}


def _player_safe_markdown_value(value: Any) -> Any:
    """Remove structured hidden fields before rendering player-visible Markdown."""
    if isinstance(value, dict):
        if value.get("secret") is True:
            return {"redacted": True}
        result: dict[str, Any] = {}
        for key, child in value.items():
            normalized = str(key).casefold()
            if (
                normalized in MARKDOWN_HIDDEN_KEYS
                or normalized.startswith("keeper_")
                or normalized.startswith("private_")
            ):
                continue
            result[str(key)] = _player_safe_markdown_value(child)
        return result
    if isinstance(value, list):
        return [_player_safe_markdown_value(item) for item in value]
    return value


def _markdown(report: dict[str, Any]) -> str:
    completeness = report["completeness"]
    lines = [
        "# COC Battle Report Source Bundle",
        "",
        "**Supplementary player-safe evidence. This file is not the canonical battle report and makes no official evaluation claim.**",
        "",
        f"- Report ID: `{report['report_id']}`",
        f"- Completeness: **{completeness['classification']}**",
        f"- Existing completeness receipt: **{completeness['receipt_binding']['status']}**",
        f"- Receipt verification: `{completeness['receipt_binding']['verification']}`",
        f"- Canonical report: `{completeness['report_binding']['path'] or 'MISSING'}`",
        f"- Canonical report binding: **{completeness['report_binding']['binding_status']}**",
        "- Official evaluation claim: **none**.",
        "",
        "## Run Identity",
        "",
        _fence(_pretty_json(_safe_metadata(report["run_metadata"])), "json"),
        "",
        "## Completeness Findings",
        "",
    ]
    lines.extend(
        [f"- {reason}" for reason in completeness["reasons"]]
        or ["- No required export-source gaps detected."]
    )
    lines.extend(["", "## Source Manifest", ""])
    lines.extend(_manifest_markdown(report["source_manifest"]))
    lines.extend(["", "## Investigator Character Sources", ""])
    if not report["investigators"]:
        lines.extend(["**MISSING:** No investigator payloads were discovered.", ""])
    for index, investigator in enumerate(report["investigators"], start=1):
        lines.extend([f"### {index}. `{investigator['investigator_id']}`", ""])
        for label, key, filename in (
            ("Character payload", "character", "character.json"),
            ("Creation payload", "creation", "creation.json"),
        ):
            lines.extend([f"#### {label} (`{filename}`)", ""])
            status = investigator[f"{key}_status"]
            if status == "MISSING":
                lines.extend(["**MISSING**", ""])
            else:
                if status == "INVALID":
                    lines.extend(["**INVALID:** expected a non-empty JSON object.", ""])
                lines.extend(
                    [
                        _fence(
                            _pretty_json(_player_safe_markdown_value(investigator[key])),
                            "json",
                        ),
                        "",
                    ]
                )

    lines.extend(["## Complete Ordered Player/KP Dialogue", ""])
    dialogue_index = 0
    for source_index, row in enumerate(report["transcript"]["records"], start=1):
        if not _is_dialogue_row(row):
            continue
        dialogue_index += 1
        speaker_source, speaker = _speaker_label(row)
        lines.extend(
            [
                f"### Dialogue {dialogue_index} — source row {source_index}",
                "",
                f"- Speaker label source: `{speaker_source}`",
                f"- Original role: `{row.get('role')}`",
                f"- Turn: `{row.get('turn', 'MISSING')}`",
                "",
                "#### Speaker label",
                "",
                _fence(speaker, "text"),
                "",
                f"#### Canonical source text ({len(row['text'])} characters)",
                "",
                _fence(row["text"], "text"),
                "",
            ]
        )
        display = row.get("text_display")
        if isinstance(display, str) and display.strip() and display != row["text"]:
            lines.extend(
                [
                    f"#### Display text ({len(display)} characters)",
                    "",
                    _fence(display, "text"),
                    "",
                ]
            )
    if dialogue_index == 0:
        lines.extend(["**MISSING:** No structured player/KP dialogue rows were found.", ""])

    lines.extend(["## Public Roll Evidence", ""])
    lines.extend(
        [
            _fence(
                _pretty_json(
                    _player_safe_markdown_value(report["public_rolls"]["records"])
                ),
                "json",
            ),
            "",
        ]
    )
    lines.extend(
        [
            "## Excluded Hidden Sources",
            "",
            "Keeper-view logs, Keeper-only rolls, scenario/module truth, flags/world state, runner prompts, and hidden event logs are deliberately not included in either bundle artifact.",
            "",
        ]
    )
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
    report_id = "coc-br-source-" + _sha256(_canonical_bytes(identity_material))[:24]
    report = {
        "schema_version": SCHEMA_VERSION,
        "report_id": report_id,
        "report_type": "coc_battle_report_source_bundle",
        "official_evaluation_claim": False,
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
    parser.add_argument("run_dir", type=Path, help="canonical COC playtest run directory")
    parser.add_argument(
        "--allow-partial",
        action="store_true",
        help="export partial-transcript.jsonl as an explicitly INCOMPLETE source bundle",
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
