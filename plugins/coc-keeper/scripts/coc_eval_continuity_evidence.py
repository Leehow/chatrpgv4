#!/usr/bin/env python3
"""Fail-closed continuity checkpoint, ledger, anchor, and audit validation."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import re
import tempfile
import uuid
from collections import Counter
from pathlib import Path
from typing import Any


EVAL_SPEC = "eval-spec-v1"
SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[2]
CONTINUITY_EVIDENCE_FILE = "continuity-evidence.json"
CHAPTER_EVIDENCE_FILE = "chapter-transition-evidence.json"
STATUSES = frozenset({"PASS", "FAIL", "INELIGIBLE", "NOT_RUN"})
EVIDENCE_CLASSES = frozenset({"fixture", "external"})
EXPECTED_MODEL_ROLES = {
    "player": {"provider": "coding-relay", "id": "gpt-5.6-luna"},
    "kp": {"provider": "zhipu-coding", "id": "glm-5.2"},
}
TOP_CONTINUITY_RUNNER = "coc_live_match.segmented"
SEGMENT_CONTINUITY_RUNNER = "coc_live_match"
SEGMENT_RUNNER_IDENTITY = "coc-eval-live-segment@1"
SEGMENT_RUNNER_PATH = "plugins/coc-keeper/scripts/coc_eval_live_cell.py"
TRUSTED_RUNNERS_PATH = (
    REPO_ROOT
    / "plugins"
    / "coc-keeper"
    / "references"
    / "trusted-playtest-runners.json"
)
_RUNNER_INVOCATION_ID = re.compile(r"^[0-9a-f]{32}$")


def _positive_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def _runner_invocation_id_valid(value: Any) -> bool:
    if not isinstance(value, str) or not _RUNNER_INVOCATION_ID.fullmatch(value):
        return False
    try:
        parsed = uuid.UUID(hex=value)
    except (AttributeError, ValueError):
        return False
    return bool(
        parsed.hex == value
        and parsed.version == 4
        and parsed.variant == uuid.RFC_4122
    )


def _object(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    return value


def _read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"unreadable JSON: {path}: {exc}") from exc


def _write_text_atomic(path: Path, text: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            temporary = Path(handle.name)
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        temporary = None
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return path


def _write_json_atomic(path: Path, payload: Any) -> Path:
    return _write_text_atomic(
        path,
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
    )


def _write_jsonl_atomic(path: Path, rows: list[dict[str, Any]]) -> Path:
    return _write_text_atomic(
        path,
        "".join(
            json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n"
            for row in rows
        ),
    )


def _canonical_json_bytes(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def _sha256_json(value: Any) -> str:
    return hashlib.sha256(_canonical_json_bytes(value)).hexdigest()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _artifact_descriptor(base: Path, path: Path) -> dict[str, Any]:
    return {
        "artifact": path.relative_to(base).as_posix(),
        "sha256": _sha256_file(path) if path.is_file() and not path.is_symlink() else None,
    }


def _load_secret_audit():
    path = SCRIPT_DIR / "coc_secret_audit.py"
    spec = importlib.util.spec_from_file_location(
        "coc_eval_continuity_evidence_secret_audit", path
    )
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _trusted_continuity_runners() -> dict[str, dict[str, str]]:
    registry = _object(_read_json(TRUSTED_RUNNERS_PATH), "trusted runner registry")
    runners = _object(registry.get("runners"), "trusted runner registry.runners")
    trusted: dict[str, dict[str, str]] = {}
    for role in ("player", "narrator"):
        entry = _object(runners.get(role), f"trusted runner {role}")
        relative = entry.get("path")
        if not isinstance(relative, str) or not relative:
            raise ValueError(f"trusted runner path missing: {role}")
        path = REPO_ROOT / relative
        if path.is_symlink() or not path.is_file():
            raise ValueError(f"trusted runner missing or unsafe: {role}")
        actual_hash = _sha256_file(path)
        if entry.get("sha256") != actual_hash:
            raise ValueError(f"trusted runner hash drifted: {role}")
        trusted[role] = {
            "kind": str(entry.get("kind") or ""),
            "identity": str(entry.get("identity") or ""),
            "path": relative,
            "absolute_path": str(path.resolve()),
            "sha256": actual_hash,
        }
        if not trusted[role]["kind"] or not trusted[role]["identity"]:
            raise ValueError(f"trusted runner identity malformed: {role}")
    return trusted


def _expected_runner_attestation() -> dict[str, dict[str, str]]:
    trusted = _trusted_continuity_runners()
    return {
        "segment": {
            "kind": "python_function",
            "identity": SEGMENT_RUNNER_IDENTITY,
            "path": SEGMENT_RUNNER_PATH,
            "sha256": _sha256_file(REPO_ROOT / SEGMENT_RUNNER_PATH),
        },
        **{
            role: {
                key: trusted[role][key]
                for key in ("kind", "identity", "path", "sha256")
            }
            for role in ("player", "narrator")
        },
    }


def _json_pointer_value(payload: Any, pointer: str) -> Any:
    if not isinstance(pointer, str) or not pointer.startswith("/"):
        raise ValueError("recall anchor JSON pointer must start with /")
    current = payload
    for raw_part in pointer[1:].split("/"):
        part = raw_part.replace("~1", "/").replace("~0", "~")
        if isinstance(current, dict) and part in current:
            current = current[part]
        elif isinstance(current, list) and part.isdigit() and int(part) < len(current):
            current = current[int(part)]
        else:
            raise ValueError(f"recall anchor JSON pointer does not resolve: {pointer}")
    return current


def _finding(
    *,
    code: str,
    severity: str,
    message: str,
    **extra: Any,
) -> dict[str, Any]:
    payload = {
        "code": code,
        "severity": severity,
        "message": message,
    }
    payload.update(extra)
    return payload


def _base_result(
    *,
    status: str,
    findings: list[dict[str, Any]],
    evidence_class: str | None = None,
    gameplay_evidence: bool | None = None,
    metrics: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if status not in STATUSES:
        raise ValueError(f"invalid status: {status}")
    result: dict[str, Any] = {
        "schema_version": 1,
        "eval_spec": EVAL_SPEC,
        "status": status,
        "findings": findings,
        "metrics": metrics or {},
    }
    if evidence_class is not None:
        result["evidence_class"] = evidence_class
    if gameplay_evidence is not None:
        result["gameplay_evidence"] = gameplay_evidence
    return result


def _resolve_evidence_path(run_dir: Path, filename: str) -> Path | None:
    candidates = [
        run_dir / filename,
        run_dir / "artifacts" / filename,
    ]
    for path in candidates:
        if path.is_file():
            return path
    return None


def _is_sha256(value: Any) -> bool:
    return isinstance(value, str) and len(value) == 64 and all(
        ch in "0123456789abcdef" for ch in value.lower()
    )


def _bound_artifact_path(
    run_dir: Path,
    descriptor: Any,
    label: str,
    findings: list[dict[str, Any]],
) -> Path | None:
    if not isinstance(descriptor, dict):
        findings.append(
            _finding(
                code=f"{label}_reference_invalid",
                severity="contradictory_evidence",
                message=f"{label} must be a hash-bound artifact descriptor",
            )
        )
        return None
    artifact = descriptor.get("artifact")
    expected_hash = descriptor.get("sha256")
    relative = Path(artifact) if isinstance(artifact, str) and artifact else None
    if (
        relative is None
        or relative.is_absolute()
        or ".." in relative.parts
        or not _is_sha256(expected_hash)
    ):
        findings.append(
            _finding(
                code=f"{label}_reference_invalid",
                severity="contradictory_evidence",
                message=f"{label} requires a safe relative path and sha256",
            )
        )
        return None
    candidate = run_dir / relative
    current = run_dir
    for part in relative.parts:
        current = current / part
        if current.is_symlink():
            findings.append(
                _finding(
                    code=f"{label}_reference_invalid",
                    severity="contradictory_evidence",
                    message=f"{label} must not traverse symlinks",
                )
            )
            return None
    if not candidate.is_file():
        findings.append(
            _finding(
                code=f"{label}_missing",
                severity="missing_evidence",
                message=f"bound {label} artifact is missing: {artifact}",
            )
        )
        return None
    try:
        candidate.resolve().relative_to(run_dir.resolve())
    except ValueError:
        findings.append(
            _finding(
                code=f"{label}_reference_invalid",
                severity="contradictory_evidence",
                message=f"{label} escaped the run directory",
            )
        )
        return None
    observed_hash = _sha256_file(candidate)
    if observed_hash != expected_hash:
        findings.append(
            _finding(
                code=f"{label}_hash_mismatch",
                severity="contradictory_evidence",
                message=f"bound {label} artifact hash does not match",
                expected=expected_hash,
                actual=observed_hash,
            )
        )
    return candidate


def _rebase_receipt_descriptor(
    run_dir: Path, receipt_path: Path, descriptor: Any
) -> dict[str, Any] | None:
    if not isinstance(descriptor, dict):
        return None
    artifact = descriptor.get("artifact")
    if not isinstance(artifact, str) or not artifact:
        return None
    relative = Path(artifact)
    if relative.is_absolute() or ".." in relative.parts:
        return None
    target = receipt_path.parent / relative
    try:
        lane_relative = target.relative_to(run_dir)
    except ValueError:
        return None
    return {
        "artifact": lane_relative.as_posix(),
        "sha256": descriptor.get("sha256"),
    }


def _checkpoint_manifest_file_hashes(
    payload: Any,
    *,
    segment_id: int,
    findings: list[dict[str, Any]],
) -> dict[str, str] | None:
    reasons: list[str] = []
    if not isinstance(payload, dict):
        reasons.append("manifest_not_object")
        payload = {}
    campaign_id = payload.get("campaign_id")
    investigator_id = payload.get("investigator_id")
    if (
        payload.get("schema_version") != 2
        or payload.get("eval_spec") != EVAL_SPEC
        or payload.get("kind") != "continuity-consumed-inputs"
    ):
        reasons.append("version_or_kind")
    if not isinstance(campaign_id, str) or not campaign_id:
        reasons.append("campaign_id")
        campaign_id = ""
    if not isinstance(investigator_id, str) or not investigator_id:
        reasons.append("investigator_id")
        investigator_id = ""
    campaign_root = f".coc/campaigns/{campaign_id}"
    expected_roots = {
        f"{campaign_root}/{name}": role
        for role, names in (
            ("mutable_campaign_state", ("save", "memory", "logs")),
            ("campaign_input", ("source", "scenario", "index")),
        )
        for name in names
    }
    roots = payload.get("roots")
    roots_by_path: dict[str, dict[str, Any]] = {}
    if not isinstance(roots, list):
        reasons.append("roots_not_list")
        roots = []
    for root in roots:
        if not isinstance(root, dict) or not isinstance(root.get("path"), str):
            reasons.append("root_record")
            continue
        root_path = root["path"]
        if root_path in roots_by_path:
            reasons.append("duplicate_root")
        roots_by_path[root_path] = root
        if (
            root_path not in expected_roots
            or root.get("role") != expected_roots.get(root_path)
            or not isinstance(root.get("present"), bool)
        ):
            reasons.append("root_contract")
        root_reasons: list[str] = []
        if set(root) != {
            "path",
            "role",
            "present",
            "entries",
            "entry_count",
            "entry_list_sha256",
        }:
            root_reasons.append("root_fields")
        entries = root.get("entries")
        if not isinstance(entries, list):
            root_reasons.append("entries_not_list")
            entries = []
        elif any(
            not isinstance(entry, str)
            or not entry
            or Path(entry).is_absolute()
            or ".." in Path(entry).parts
            for entry in entries
        ):
            root_reasons.append("unsafe_entry")
        if entries != sorted(set(entries)):
            root_reasons.append("entries_not_sorted_unique")
        entry_count = root.get("entry_count")
        if (
            isinstance(entry_count, bool)
            or not isinstance(entry_count, int)
            or entry_count != len(entries)
        ):
            root_reasons.append("entry_count")
        if root.get("entry_list_sha256") != _sha256_json(entries):
            root_reasons.append("entry_list_sha256")
        name = Path(root_path).name
        if name in {"save", "memory", "logs", "scenario"} and root.get(
            "present"
        ) is not True:
            root_reasons.append("required_root_absent")
        if (
            name in {"source", "scenario", "index"}
            and root.get("present") is True
            and not entries
        ):
            root_reasons.append("present_input_root_empty")
        if root.get("present") is False and entries:
            root_reasons.append("absent_root_has_entries")
        if root_reasons:
            reasons.extend(f"{reason}:{root_path}" for reason in root_reasons)
            findings.append(
                _finding(
                    code="checkpoint_manifest_root_inventory_invalid",
                    severity="contradictory_evidence",
                    message=f"segment {segment_id} checkpoint root inventory is invalid",
                    segment_id=segment_id,
                    root=root_path,
                    reasons=sorted(set(root_reasons)),
                )
            )
    if set(roots_by_path) != set(expected_roots):
        reasons.append("root_coverage")
    if roots != sorted(
        roots,
        key=lambda item: str(item.get("path")) if isinstance(item, dict) else str(item),
    ):
        reasons.append("root_order")

    required_file_records = {
        f"{campaign_root}/campaign.json": ("campaign_config", True),
        f"{campaign_root}/party.json": ("campaign_config", None),
        ".coc/runtime.json": ("runtime_config", True),
        **{
            f".coc/investigators/{investigator_id}/{name}": (
                "investigator_state",
                True,
            )
            for name in (
                "creation.json",
                "character.json",
                "history.jsonl",
                "development.jsonl",
                "inventory-history.jsonl",
            )
        },
    }
    minimum_present = {
        f"{campaign_root}/campaign.json",
        ".coc/runtime.json",
        *{
            f".coc/investigators/{investigator_id}/{name}"
            for name in (
                "creation.json",
                "character.json",
                "history.jsonl",
                "development.jsonl",
                "inventory-history.jsonl",
            )
        },
        *{
            f"{campaign_root}/save/{name}"
            for name in (
                "world-state.json",
                "pacing-state.json",
                "flags.json",
                f"investigator-state/{investigator_id}.json",
                "npc-state.json",
                "threat-state.json",
                "subsystem-state.json",
            )
        },
        *{
            f"{campaign_root}/logs/{name}"
            for name in (
                "events.jsonl",
                "rolls.jsonl",
                "subsystem-results.jsonl",
            )
        },
        *{
            f"{campaign_root}/scenario/{name}"
            for name in (
                "story-graph.json",
                "clue-graph.json",
                "npc-agendas.json",
                "threat-fronts.json",
                "pacing-map.json",
                "improvisation-boundaries.json",
                "module-meta.json",
            )
        },
    }
    files = payload.get("files")
    files_by_path: dict[str, dict[str, Any]] = {}
    if not isinstance(files, list):
        reasons.append("files_not_list")
        files = []
    for record in files:
        if not isinstance(record, dict) or not isinstance(record.get("path"), str):
            reasons.append("file_record")
            continue
        file_path = record["path"]
        relative = Path(file_path)
        if relative.is_absolute() or ".." in relative.parts or file_path in files_by_path:
            reasons.append("file_path")
            continue
        files_by_path[file_path] = record
        expected_role = None
        required_presence: bool | None = None
        if file_path in required_file_records:
            expected_role, required_presence = required_file_records[file_path]
        else:
            for root_path, role in expected_roots.items():
                if file_path.startswith(f"{root_path}/"):
                    expected_role = role
                    if roots_by_path.get(root_path, {}).get("present") is not True:
                        reasons.append("file_under_absent_root")
                    break
        present = record.get("present")
        if expected_role is None or record.get("role") != expected_role:
            reasons.append("file_role_or_scope")
        if not isinstance(present, bool):
            reasons.append("file_presence")
        elif required_presence is True and present is not True:
            reasons.append("required_file_absent")
        if present is True and (
            not _is_sha256(record.get("sha256"))
            or isinstance(record.get("size"), bool)
            or not isinstance(record.get("size"), int)
            or record["size"] < 0
        ):
            reasons.append("present_file_receipt")
        if present is False and (
            "sha256" in record or "size" in record
        ):
            reasons.append("absent_file_receipt")
    if not set(required_file_records).issubset(files_by_path):
        reasons.append("required_file_records")
    if files != sorted(
        files,
        key=lambda item: str(item.get("path")) if isinstance(item, dict) else str(item),
    ):
        reasons.append("file_order")
    if payload.get("excluded_path_classes") != ["lock"]:
        reasons.append("excluded_path_classes")
    for required_path in sorted(minimum_present):
        record = files_by_path.get(required_path)
        if not isinstance(record, dict) or record.get("present") is not True:
            reason = f"minimum_file_missing:{required_path}"
            reasons.append(reason)
            findings.append(
                _finding(
                    code="checkpoint_manifest_required_file_missing",
                    severity="contradictory_evidence",
                    message=f"segment {segment_id} checkpoint omitted a canonical input",
                    segment_id=segment_id,
                    path=required_path,
                )
            )
    for root_path, root in roots_by_path.items():
        entries = root.get("entries")
        if not isinstance(entries, list):
            continue
        observed_entries = sorted(
            path.removeprefix(f"{root_path}/")
            for path, record in files_by_path.items()
            if record.get("present") is True
            and path.startswith(f"{root_path}/")
        )
        if entries != observed_entries:
            reasons.append(f"root_file_inventory_mismatch:{root_path}")
            findings.append(
                _finding(
                    code="checkpoint_manifest_root_inventory_invalid",
                    severity="contradictory_evidence",
                    message=f"segment {segment_id} checkpoint root/file inventory differs",
                    segment_id=segment_id,
                    root=root_path,
                    reasons=["root_file_inventory_mismatch"],
                )
            )
    if reasons:
        findings.append(
            _finding(
                code="checkpoint_manifest_contract_invalid",
                severity="contradictory_evidence",
                message=f"segment {segment_id} checkpoint manifest violates the consumed-input contract",
                segment_id=segment_id,
                reasons=sorted(set(reasons)),
            )
        )
        return None
    return {
        path: record["sha256"]
        for path, record in files_by_path.items()
        if record.get("present") is True
    }


def _invocation_ledger_contract_ok(
    path: Path,
    *,
    segment_id: int,
    invocation_id: Any,
    accepted_turns: Any,
    turn_bindings: Any,
    attestation: Any,
    findings: list[dict[str, Any]],
) -> None:
    reasons: list[str] = []
    rows: list[dict[str, Any]] = []
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            reasons.append(f"malformed_row:{number}")
            continue
        if not isinstance(row, dict):
            reasons.append(f"non_object_row:{number}")
            continue
        rows.append(row)
    if not isinstance(attestation, dict):
        attestation = {}
    valid_bindings = bool(
        isinstance(accepted_turns, list)
        and isinstance(turn_bindings, list)
        and len(turn_bindings) == len(accepted_turns)
        and all(
            _positive_int(turn)
            and isinstance(binding, dict)
            and _positive_int(binding.get("turn_number"))
            and binding["turn_number"] == turn
            and isinstance(binding.get("decision_id"), str)
            and binding["decision_id"].strip()
            for turn, binding in zip(accepted_turns, turn_bindings, strict=True)
        )
    )
    expected_coverage = Counter(
        (
            binding["turn_number"],
            binding["decision_id"],
            segment_turn,
        )
        for segment_turn, binding in enumerate(turn_bindings, 1)
    ) if valid_bindings else Counter()
    trusted = _trusted_continuity_runners()
    models = {
        "player": attestation.get("player_model"),
        "narrator": attestation.get("kp_model"),
    }
    coverage_by_role: dict[str, Counter] = {
        "player": Counter(),
        "narrator": Counter(),
    }
    audit_validator = _load_secret_audit().validate_audit_receipt
    for row in rows:
        role = row.get("role")
        if role not in trusted:
            reasons.append("unknown_role")
            continue
        runner = trusted[role]
        transcript_turn = row.get("transcript_turn")
        segment_turn = row.get("segment_turn")
        decision_id = row.get("decision_id")
        turn_fields_valid = _positive_int(transcript_turn) and _positive_int(
            segment_turn
        )
        if turn_fields_valid:
            coverage_by_role[role][
                (transcript_turn, decision_id, segment_turn)
            ] += 1
        else:
            reasons.append(f"turn_field_type:{role}")
        attempt = row.get("attempt")
        if (
            row.get("schema_version") != 1
            or row.get("segment_invocation_id") != invocation_id
            or row.get("runner_kind") != runner["kind"]
            or row.get("runner_path") != runner["absolute_path"]
            or row.get("runner_sha256") != runner["sha256"]
            or row.get("model_identity") != models[role]
            or row.get("outcome") != "external_success"
            or not _positive_int(attempt)
            or not turn_fields_valid
            or not isinstance(decision_id, str)
            or not decision_id.strip()
        ):
            reasons.append(f"row_contract:{role}")
        if row.get("runner_identity") != runner["identity"]:
            reasons.append(f"runner_identity:{role}")
        if role == "narrator":
            audit = audit_validator(row.get("secret_audit"))
            if not audit.get("valid") or not audit.get("passed"):
                reasons.append("narrator_secret_audit")
    coverage_reasons = []
    if not valid_bindings:
        coverage_reasons.append("turn_bindings_invalid")
    for role in ("player", "narrator"):
        if coverage_by_role[role] != expected_coverage:
            coverage_reasons.append(f"exact_role_turn_coverage:{role}")
    if coverage_reasons:
        findings.append(
            _finding(
                code="invocation_ledger_turn_coverage_invalid",
                severity="contradictory_evidence",
                message=f"segment {segment_id} ledger must contain exactly one successful role invocation per accepted turn",
                segment_id=segment_id,
                reasons=sorted(set(coverage_reasons)),
            )
        )
    if not rows:
        reasons.append("empty")
    if reasons:
        findings.append(
            _finding(
                code="invocation_ledger_contract_invalid",
                severity="contradictory_evidence",
                message=f"segment {segment_id} invocation ledger lacks canonical external provenance",
                segment_id=segment_id,
                reasons=sorted(set(reasons)),
            )
        )


def _continuity_recall_receipt_ok(
    run_dir: Path,
    evidence: dict[str, Any],
    evidence_class: str | None,
    checkpoint_files: list[dict[str, str]] | None,
    findings: list[dict[str, Any]],
) -> None:
    anchors = evidence.get("recall_anchors")
    path = _bound_artifact_path(
        run_dir,
        evidence.get("recall_anchor_receipt"),
        "recall_anchor_receipt",
        findings,
    )
    if path is not None:
        try:
            receipt = _object(_read_json(path), "recall anchor receipt")
        except ValueError as exc:
            findings.append(
                _finding(
                    code="recall_anchor_receipt_invalid",
                    severity="contradictory_evidence",
                    message=str(exc),
                )
            )
        else:
            if (
                receipt.get("schema_version") != 1
                or receipt.get("eval_spec") != EVAL_SPEC
                or receipt.get("anchors") != anchors
            ):
                findings.append(
                    _finding(
                        code="recall_anchor_receipt_mismatch",
                        severity="contradictory_evidence",
                        message="recall anchor receipt must exactly bind top-level anchors",
                    )
                )
    if evidence_class != "external" or not isinstance(anchors, dict):
        return
    for name, anchor in anchors.items():
        if not isinstance(anchor, dict):
            continue
        state_id = anchor.get("anchor_id")
        before = anchor.get("before_value_sha256")
        after = anchor.get("after_value_sha256")
        source_path = anchor.get("source_path")
        pointer = anchor.get("json_pointer")
        source_format = anchor.get("source_format")
        concrete = bool(
            isinstance(state_id, str)
            and state_id.startswith("state:")
            and _is_sha256(state_id.removeprefix("state:"))
            and _is_sha256(before)
            and _is_sha256(after)
            and before == after
            and isinstance(source_path, str)
            and source_path
            and not Path(source_path).is_absolute()
            and ".." not in Path(source_path).parts
            and isinstance(pointer, str)
            and pointer.startswith("/")
            and source_format in {"json", "jsonl"}
            and anchor.get("observation_kind") == "structured_state"
            and "model_observed" not in anchor
        )
        if not concrete:
            findings.append(
                _finding(
                    code="external_recall_anchor_not_concrete",
                    severity="contradictory_evidence",
                    message=f"external recall anchor {name} lacks concrete structured-state evidence",
                    anchor=name,
                )
            )
            continue
        source_bound = bool(
            isinstance(checkpoint_files, list) and len(checkpoint_files) == 2
        )
        for phase_index, phase in enumerate(("before", "after")):
            descriptor = anchor.get(f"{phase}_source_artifact")
            source_artifact = _bound_artifact_path(
                run_dir,
                descriptor,
                "recall_anchor_source",
                findings,
            )
            checkpoint_hash = (
                checkpoint_files[phase_index].get(source_path)
                if source_bound and checkpoint_files is not None
                else None
            )
            descriptor_hash = (
                descriptor.get("sha256") if isinstance(descriptor, dict) else None
            )
            if (
                source_artifact is None
                or not _is_sha256(checkpoint_hash)
                or descriptor_hash != checkpoint_hash
            ):
                source_bound = False
                continue
            try:
                if source_format == "json":
                    source_payload = _read_json(source_artifact)
                else:
                    source_payload = [
                        json.loads(line)
                        for line in source_artifact.read_text(
                            encoding="utf-8"
                        ).splitlines()
                        if line.strip()
                    ]
                observed_value = _json_pointer_value(source_payload, pointer)
            except (ValueError, json.JSONDecodeError):
                source_bound = False
                continue
            expected_value_hash = anchor.get(f"{phase}_value_sha256")
            if _sha256_json(observed_value) != expected_value_hash:
                source_bound = False
        expected_identity = {
            "source_path": source_path,
            "json_pointer": pointer,
            "value_sha256": before,
        }
        if anchor.get("anchor_id") != f"state:{_sha256_json(expected_identity)}":
            source_bound = False
        if not source_bound:
            findings.append(
                _finding(
                    code="external_recall_anchor_source_unbound",
                    severity="contradictory_evidence",
                    message=f"external recall anchor {name} is not bound to both checkpoint source files",
                    anchor=name,
                )
            )


def _continuity_external_segments_ok(
    run_dir: Path,
    evidence: dict[str, Any],
    findings: list[dict[str, Any]],
) -> tuple[set[str], list[dict[str, str]]]:
    segments = evidence.get("segments")
    if not isinstance(segments, list) or len(segments) != 2:
        findings.append(
            _finding(
                code="external_segments_invalid",
                severity="contradictory_evidence",
                message="external continuity evidence requires exactly two segment receipts",
            )
        )
        return set(), [{}, {}]
    session_id = evidence.get("session_id")
    restart = evidence.get("restart") if isinstance(evidence.get("restart"), dict) else {}
    restart_at = restart.get("at_turn")
    turn_count = evidence.get("turn_count")
    expected_segment_turns = (
        (
            list(range(1, restart_at + 1)),
            list(range(restart_at + 1, turn_count + 1)),
        )
        if isinstance(restart_at, int)
        and not isinstance(restart_at, bool)
        and isinstance(turn_count, int)
        and not isinstance(turn_count, bool)
        else ([], [])
    )
    top_attestation = evidence.get("attestation")
    invocation_ids: list[str] = []
    ledger_hashes: set[str] = set()
    checkpoint_files: list[dict[str, str]] = [{}, {}]
    observed_turns: list[int] = []
    observed_decision_ids: list[str] = []
    for index, segment in enumerate(segments, 1):
        if not isinstance(segment, dict):
            findings.append(
                _finding(
                    code="external_segment_invalid",
                    severity="contradictory_evidence",
                    message=f"segments[{index - 1}] must be an object",
                )
            )
            continue
        invocation_id = segment.get("runner_invocation_id")
        if not isinstance(invocation_id, str) or not invocation_id.strip():
            findings.append(
                _finding(
                    code="external_runner_invocation_id_missing",
                    severity="contradictory_evidence",
                    message=f"external segment {index} requires a source invocation id",
                    segment_id=index,
                )
            )
        else:
            invocation_ids.append(invocation_id)
            if not _runner_invocation_id_valid(invocation_id):
                findings.append(
                    _finding(
                        code="external_runner_invocation_id_invalid",
                        severity="contradictory_evidence",
                        message=f"external segment {index} invocation id must be a runner-issued UUID hex value",
                        segment_id=index,
                    )
                )
        if segment.get("segment_id") != index:
            findings.append(
                _finding(
                    code="external_segment_order_invalid",
                    severity="contradictory_evidence",
                    message="external segment ids must be 1 then 2",
                )
            )
        if segment.get("logical_session_id") != session_id:
            findings.append(
                _finding(
                    code="external_segment_session_mismatch",
                    severity="contradictory_evidence",
                    message=f"external segment {index} does not bind the logical evaluation session",
                )
            )
        accepted_turns = segment.get("accepted_turns")
        if isinstance(accepted_turns, list) and all(
            _positive_int(turn) for turn in accepted_turns
        ):
            observed_turns.extend(accepted_turns)
            if accepted_turns != expected_segment_turns[index - 1]:
                findings.append(
                    _finding(
                        code="accepted_turn_range_mismatch",
                        severity="contradictory_evidence",
                        message=f"external segment {index} does not cover its exact required turn range",
                        segment_id=index,
                    )
                )
        else:
            findings.append(
                _finding(
                    code="external_segment_turns_invalid",
                    severity="contradictory_evidence",
                    message=f"external segment {index} accepted_turns are invalid",
                )
            )
        turn_bindings = segment.get("turn_bindings")
        bindings_valid = bool(
            isinstance(turn_bindings, list)
            and isinstance(accepted_turns, list)
            and len(turn_bindings) == len(accepted_turns)
            and all(
                isinstance(binding, dict)
                and _positive_int(turn)
                and _positive_int(binding.get("turn_number"))
                and binding["turn_number"] == turn
                and isinstance(binding.get("decision_id"), str)
                and binding["decision_id"].strip()
                for turn, binding in zip(
                    accepted_turns, turn_bindings, strict=True
                )
            )
            and len({binding["decision_id"] for binding in turn_bindings})
            == len(turn_bindings)
        )
        if not bindings_valid:
            findings.append(
                _finding(
                    code="external_segment_turn_bindings_invalid",
                    severity="contradictory_evidence",
                    message=f"external segment {index} must bind every accepted turn to one decision id",
                    segment_id=index,
                )
            )
        else:
            observed_decision_ids.extend(
                binding["decision_id"] for binding in turn_bindings
            )

        receipt_path = _bound_artifact_path(
            run_dir, segment.get("receipt"), "segment_receipt", findings
        )
        ledger_path = _bound_artifact_path(
            run_dir,
            segment.get("invocation_ledger"),
            "invocation_ledger",
            findings,
        )
        checkpoint_path = _bound_artifact_path(
            run_dir,
            segment.get("checkpoint_manifest"),
            "checkpoint_manifest",
            findings,
        )
        metadata_path = _bound_artifact_path(
            run_dir,
            segment.get("runner_metadata"),
            "runner_metadata",
            findings,
        )
        ledger_descriptor = segment.get("invocation_ledger")
        if isinstance(ledger_descriptor, dict) and _is_sha256(
            ledger_descriptor.get("sha256")
        ):
            ledger_hashes.add(ledger_descriptor["sha256"])
        if ledger_path is not None and not ledger_path.read_text(
            encoding="utf-8"
        ).strip():
            findings.append(
                _finding(
                    code="invocation_ledger_empty",
                    severity="contradictory_evidence",
                    message=f"external segment {index} invocation ledger is empty",
                )
            )
        if ledger_path is not None:
            _invocation_ledger_contract_ok(
                ledger_path,
                segment_id=index,
                invocation_id=invocation_id,
                accepted_turns=accepted_turns,
                turn_bindings=turn_bindings,
                attestation=top_attestation,
                findings=findings,
            )

        receipt: dict[str, Any] | None = None
        if receipt_path is not None:
            try:
                receipt = _object(_read_json(receipt_path), "segment receipt")
            except ValueError as exc:
                findings.append(
                    _finding(
                        code="segment_receipt_invalid",
                        severity="contradictory_evidence",
                        message=str(exc),
                    )
                )
        if receipt is not None:
            source = receipt.get("runner_invocation_source")
            if (
                receipt.get("evidence_class") != "external"
                or receipt.get("logical_session_id") != session_id
                or receipt.get("runner_invocation_id") != invocation_id
                or receipt.get("accepted_turns") != accepted_turns
            ):
                findings.append(
                    _finding(
                        code="segment_receipt_mismatch",
                        severity="contradictory_evidence",
                        message=f"external segment {index} does not match its bound receipt",
                    )
                )
            if receipt.get("turn_bindings") != turn_bindings:
                findings.append(
                    _finding(
                        code="segment_receipt_turn_bindings_mismatch",
                        severity="contradictory_evidence",
                        message=f"external segment {index} receipt does not bind the exact accepted turn decisions",
                        segment_id=index,
                    )
                )
            if receipt.get("runner") != SEGMENT_CONTINUITY_RUNNER:
                findings.append(
                    _finding(
                        code="segment_receipt_runner_identity_mismatch",
                        severity="contradictory_evidence",
                        message=f"external segment {index} receipt runner identity is not canonical",
                        segment_id=index,
                    )
                )
            if not (
                isinstance(source, dict)
                and source.get("kind") == "runner_issued_uuid"
                and source.get("json_pointer") == "/runner_invocation_id"
                and _rebase_receipt_descriptor(
                    run_dir, receipt_path, source.get("artifact")
                )
                == segment.get("runner_metadata")
            ):
                findings.append(
                    _finding(
                        code="external_runner_invocation_id_source_missing",
                        severity="contradictory_evidence",
                        message=f"external segment {index} invocation id lacks its source field",
                    )
                )
            elif metadata_path is not None:
                metadata_receipt: dict[str, Any] = {}
                try:
                    metadata_receipt = _object(
                        _read_json(metadata_path), "runner metadata receipt"
                    )
                    metadata_invocation_id = _json_pointer_value(
                        metadata_receipt, source["json_pointer"]
                    )
                except ValueError:
                    metadata_invocation_id = None
                if (
                    metadata_receipt.get("schema_version") != 1
                    or metadata_receipt.get("eval_spec") != EVAL_SPEC
                    or metadata_receipt.get("source")
                    != "coc_eval_live_cell.run_live_segment"
                    or metadata_invocation_id != invocation_id
                ):
                    findings.append(
                        _finding(
                            code="external_runner_invocation_metadata_mismatch",
                            severity="contradictory_evidence",
                            message=f"external segment {index} invocation id is not present in bound live-match metadata",
                        )
                    )
            receipt_artifacts = receipt.get("artifacts")
            if not isinstance(receipt_artifacts, dict) or (
                _rebase_receipt_descriptor(
                    run_dir,
                    receipt_path,
                    receipt_artifacts.get("invocation_ledger")
                )
                != ledger_descriptor
                or _rebase_receipt_descriptor(
                    run_dir,
                    receipt_path,
                    receipt_artifacts.get("checkpoint_resume")
                )
                != segment.get("checkpoint_manifest")
                or _rebase_receipt_descriptor(
                    run_dir,
                    receipt_path,
                    receipt_artifacts.get("run_metadata")
                )
                != segment.get("runner_metadata")
            ):
                findings.append(
                    _finding(
                        code="segment_receipt_artifact_mismatch",
                        severity="contradictory_evidence",
                        message=f"external segment {index} artifact bindings differ from its receipt",
                    )
                )
            receipt_attestation = receipt.get("attestation")
            if not _continuity_attestation_exact(
                receipt_attestation, top_level=False
            ):
                findings.append(
                    _finding(
                        code="segment_receipt_attestation_mismatch",
                        severity="contradictory_evidence",
                        message=f"external segment {index} runner/model attestation is inconsistent",
                    )
                )

        checkpoint_snapshot = segment.get("checkpoint_snapshot_sha256")
        expected_checkpoint = restart.get(
            "pre_checkpoint_sha256" if index == 1 else "post_checkpoint_sha256"
        )
        if checkpoint_snapshot != expected_checkpoint or not _is_sha256(
            checkpoint_snapshot
        ):
            findings.append(
                _finding(
                    code="segment_checkpoint_snapshot_mismatch",
                    severity="contradictory_evidence",
                    message=f"external segment {index} checkpoint does not bind restart evidence",
                )
            )
        if receipt is not None and receipt.get("snapshot_sha256") != checkpoint_snapshot:
            findings.append(
                _finding(
                    code="segment_checkpoint_snapshot_mismatch",
                    severity="contradictory_evidence",
                    message=f"external segment {index} receipt reports another checkpoint",
                )
            )
        if checkpoint_path is not None:
            try:
                checkpoint_payload = _read_json(checkpoint_path)
            except ValueError as exc:
                findings.append(
                    _finding(
                        code="checkpoint_manifest_invalid",
                        severity="contradictory_evidence",
                        message=str(exc),
                    )
                )
            else:
                if _sha256_json(checkpoint_payload) != checkpoint_snapshot:
                    findings.append(
                        _finding(
                            code="checkpoint_manifest_snapshot_mismatch",
                            severity="contradictory_evidence",
                            message=f"external segment {index} manifest content does not match snapshot hash",
                        )
                    )
                file_hashes = _checkpoint_manifest_file_hashes(
                    checkpoint_payload,
                    segment_id=index,
                    findings=findings,
                )
                if file_hashes is not None:
                    checkpoint_files[index - 1] = file_hashes
    if len(invocation_ids) != len(set(invocation_ids)):
        findings.append(
            _finding(
                code="external_runner_invocation_id_duplicate",
                severity="contradictory_evidence",
                message="external segment runner invocation ids must be distinct",
            )
        )
    if len(observed_decision_ids) != len(set(observed_decision_ids)):
        findings.append(
            _finding(
                code="external_segment_decision_id_duplicate",
                severity="contradictory_evidence",
                message="external segment decision ids must be unique across the lane",
            )
        )
    if observed_turns != evidence.get("accepted_turns"):
        findings.append(
            _finding(
                code="external_segment_turns_mismatch",
                severity="contradictory_evidence",
                message="external segment turn ranges do not compose the top-level accepted turns",
            )
        )
    return ledger_hashes, checkpoint_files


def _continuity_secret_audit_ok(
    run_dir: Path,
    evidence: dict[str, Any],
    evidence_class: str | None,
    ledger_hashes: set[str],
    findings: list[dict[str, Any]],
) -> None:
    _secret_audit_ok(evidence, findings)
    audit = evidence.get("secret_audit")
    if not isinstance(audit, dict):
        return
    references = audit.get("references")
    if not isinstance(references, list):
        return
    referenced_ids: set[str] = set()
    artifact_finding_ids: set[str] = set()
    for reference in references:
        if not isinstance(reference, dict):
            continue
        finding_id = reference.get("finding_id")
        path = _bound_artifact_path(
            run_dir, reference, "secret_audit_artifact", findings
        )
        if not isinstance(finding_id, str) or not finding_id or path is None:
            continue
        referenced_ids.add(finding_id)
        try:
            payload = _object(_read_json(path), "secret audit artifact")
        except ValueError as exc:
            findings.append(
                _finding(
                    code="secret_audit_artifact_invalid",
                    severity="contradictory_evidence",
                    message=str(exc),
                )
            )
            continue
        artifact_findings = payload.get("findings")
        if not isinstance(artifact_findings, list):
            findings.append(
                _finding(
                    code="secret_audit_findings_missing",
                    severity="contradictory_evidence",
                    message="secret audit artifact requires structured findings",
                )
            )
            continue
        by_id = {
            item.get("finding_id"): item
            for item in artifact_findings
            if isinstance(item, dict) and isinstance(item.get("finding_id"), str)
        }
        artifact_finding_ids.update(by_id)
        finding = by_id.get(finding_id)
        if finding is None:
            findings.append(
                _finding(
                    code="secret_audit_finding_missing",
                    severity="contradictory_evidence",
                    message=f"secret audit finding does not exist: {finding_id}",
                )
            )
            continue
        if finding.get("status") != "PASS" or finding.get("prose_scanned") is not False:
            findings.append(
                _finding(
                    code="secret_audit_finding_failed",
                    severity="contradictory_evidence",
                    message=f"secret audit finding is not a structured PASS: {finding_id}",
                )
            )
        if evidence_class == "external" and finding.get(
            "invocation_ledger_sha256"
        ) not in ledger_hashes:
            findings.append(
                _finding(
                    code="secret_audit_ledger_unbound",
                    severity="contradictory_evidence",
                    message=f"secret audit finding is not bound to a segment ledger: {finding_id}",
                )
            )
    if artifact_finding_ids != referenced_ids:
        findings.append(
            _finding(
                code="secret_audit_finding_set_mismatch",
                severity="contradictory_evidence",
                message="every secret audit finding must have one hash-bound reference",
            )
        )


def _secret_audit_ok(evidence: dict[str, Any], findings: list[dict[str, Any]]) -> None:
    audit = evidence.get("secret_audit")
    if not isinstance(audit, dict):
        findings.append(
            _finding(
                code="secret_audit_missing",
                severity="contradictory_evidence",
                message="structured secret_audit object is required",
            )
        )
        return
    references = audit.get("references")
    if not isinstance(references, list) or not references:
        findings.append(
            _finding(
                code="secret_audit_references_missing",
                severity="contradictory_evidence",
                message="secret_audit.references must be a non-empty structured list",
            )
        )
        return
    for index, item in enumerate(references):
        if not isinstance(item, dict):
            findings.append(
                _finding(
                    code="secret_audit_reference_invalid",
                    severity="contradictory_evidence",
                    message=f"secret_audit.references[{index}] must be an object",
                )
            )
            continue
        if not isinstance(item.get("artifact"), str) or not item.get("artifact"):
            findings.append(
                _finding(
                    code="secret_audit_reference_invalid",
                    severity="contradictory_evidence",
                    message=f"secret_audit.references[{index}].artifact required",
                )
            )
        if not isinstance(item.get("finding_id"), str) or not item.get("finding_id"):
            findings.append(
                _finding(
                    code="secret_audit_reference_invalid",
                    severity="contradictory_evidence",
                    message=f"secret_audit.references[{index}].finding_id required",
                )
            )
    status = audit.get("status")
    if status not in {"PASS", "FAIL"}:
        findings.append(
            _finding(
                code="secret_audit_status_invalid",
                severity="contradictory_evidence",
                message="secret_audit.status must be PASS or FAIL",
            )
        )
    elif status == "FAIL":
        findings.append(
            _finding(
                code="secret_audit_failed",
                severity="contradictory_evidence",
                message="structured secret audit recorded FAIL",
            )
        )


def _eligibility_fields(
    evidence: dict[str, Any],
    requirements: dict[str, Any],
    findings: list[dict[str, Any]],
) -> tuple[str | None, bool | None]:
    required = (requirements.get("evidence_eligibility") or {}).get("required_fields") or []
    for field in required:
        if field not in evidence:
            findings.append(
                _finding(
                    code="eligibility_field_missing",
                    severity="contradictory_evidence",
                    message=f"missing eligibility field: {field}",
                    field=field,
                )
            )
    evidence_class = evidence.get("evidence_class")
    if evidence_class not in EVIDENCE_CLASSES:
        findings.append(
            _finding(
                code="evidence_class_invalid",
                severity="contradictory_evidence",
                message="evidence_class must be fixture or external",
            )
        )
        evidence_class = None
    eligible = evidence.get("eligible")
    if not isinstance(eligible, bool):
        findings.append(
            _finding(
                code="eligible_flag_invalid",
                severity="contradictory_evidence",
                message="eligible must be a boolean",
            )
        )
        eligible = None
    return evidence_class, eligible


def _attestation_present(attestation: Any) -> bool:
    if not isinstance(attestation, dict) or not attestation:
        return False
    player = attestation.get("player_model")
    kp = attestation.get("kp_model")
    runner = attestation.get("runner")
    runners = attestation.get("runners")
    attested = attestation.get("attested")
    if not isinstance(player, dict) or not player.get("id"):
        return False
    if not isinstance(kp, dict) or not kp.get("id"):
        return False
    if not isinstance(runner, str) or not runner:
        return False
    if not isinstance(runners, dict) or not runners:
        return False
    if attested is not True:
        return False
    return True


def _continuity_attestation_exact(
    attestation: Any, *, top_level: bool
) -> bool:
    if not isinstance(attestation, dict):
        return False
    return bool(
        attestation.get("player_model") == EXPECTED_MODEL_ROLES["player"]
        and attestation.get("kp_model") == EXPECTED_MODEL_ROLES["kp"]
        and attestation.get("runner")
        == (TOP_CONTINUITY_RUNNER if top_level else SEGMENT_CONTINUITY_RUNNER)
        and attestation.get("runners") == _expected_runner_attestation()
        and attestation.get("attested") is True
    )


def validate_continuity_run(
    run_dir: Path | str,
    requirements: dict[str, Any],
) -> dict[str, Any]:
    """Validate structured continuity evidence against lane requirements."""
    if not isinstance(requirements, dict):
        raise ValueError("requirements must be an object")
    path = Path(run_dir)
    findings: list[dict[str, Any]] = []

    if not path.exists() or not path.is_dir():
        findings.append(
            _finding(
                code="run_dir_missing",
                severity="missing_evidence",
                message=f"run directory missing: {path}",
            )
        )
        return _base_result(status="NOT_RUN", findings=findings)

    evidence_path = _resolve_evidence_path(path, CONTINUITY_EVIDENCE_FILE)
    if evidence_path is None:
        findings.append(
            _finding(
                code="continuity_evidence_missing",
                severity="missing_evidence",
                message=f"{CONTINUITY_EVIDENCE_FILE} not found under run_dir",
            )
        )
        return _base_result(status="NOT_RUN", findings=findings)

    try:
        evidence = _read_json(evidence_path)
    except ValueError as exc:
        findings.append(
            _finding(
                code="continuity_evidence_unreadable",
                severity="missing_evidence",
                message=str(exc),
            )
        )
        return _base_result(status="NOT_RUN", findings=findings)

    if not isinstance(evidence, dict):
        findings.append(
            _finding(
                code="continuity_evidence_invalid",
                severity="contradictory_evidence",
                message="continuity evidence must be a JSON object",
            )
        )
        return _base_result(status="FAIL", findings=findings)

    if evidence.get("schema_version") != 1 or evidence.get("eval_spec") != EVAL_SPEC:
        findings.append(
            _finding(
                code="continuity_evidence_version_mismatch",
                severity="contradictory_evidence",
                message="continuity evidence must declare schema_version=1 and eval-spec-v1",
            )
        )

    evidence_class, eligible = _eligibility_fields(evidence, requirements, findings)

    # External lanes that executed without attestation are INELIGIBLE.
    if evidence_class == "external" and not _attestation_present(evidence.get("attestation")):
        findings.append(
            _finding(
                code="external_attestation_missing",
                severity="ineligible",
                message="external continuity lane requires runner/model attestation",
            )
        )
        return _base_result(
            status="INELIGIBLE",
            findings=findings,
            evidence_class=evidence_class,
            gameplay_evidence=False,
        )
    if evidence_class == "external":
        attestation = evidence.get("attestation")
        if not isinstance(attestation, dict) or any(
            attestation.get(field) != EXPECTED_MODEL_ROLES[role]
            for field, role in (("player_model", "player"), ("kp_model", "kp"))
        ):
            findings.append(
                _finding(
                    code="external_model_identity_mismatch",
                    severity="contradictory_evidence",
                    message="external continuity evidence requires the GLM/Luna model roles",
                )
            )
        if not _continuity_attestation_exact(attestation, top_level=True):
            findings.append(
                _finding(
                    code="external_runner_identity_mismatch",
                    severity="contradictory_evidence",
                    message="external continuity evidence requires exact canonical segment and adapter identities",
                )
            )

    expected_turns = requirements.get("turn_count")
    accepted = evidence.get("accepted_turns")
    reported_count = evidence.get("turn_count")
    if not isinstance(accepted, list) or not all(
        _positive_int(item) for item in accepted
    ):
        findings.append(
            _finding(
                code="accepted_turns_invalid",
                severity="contradictory_evidence",
                message="accepted_turns must be a list of integers",
            )
        )
        accepted = []
    if expected_turns is not None and (
        reported_count != expected_turns or len(accepted) != expected_turns
    ):
        findings.append(
            _finding(
                code="turn_count_mismatch",
                severity="contradictory_evidence",
                message=(
                    f"expected turn_count={expected_turns}, "
                    f"got turn_count={reported_count} accepted={len(accepted)}"
                ),
                expected=expected_turns,
                actual_turn_count=reported_count,
                actual_accepted_count=len(accepted),
            )
        )
    if (
        isinstance(expected_turns, int)
        and not isinstance(expected_turns, bool)
        and accepted
        and accepted != list(range(1, expected_turns + 1))
    ):
        findings.append(
            _finding(
                code="accepted_turn_range_mismatch",
                severity="contradictory_evidence",
                message="accepted_turns must be the exact range 1..turn_count",
            )
        )

    accepted_req = requirements.get("accepted_turns") or {}
    if accepted_req.get("monotonic") and accepted:
        if accepted != sorted(accepted) or len(accepted) != len(set(accepted)):
            findings.append(
                _finding(
                    code="accepted_turns_not_monotonic",
                    severity="contradictory_evidence",
                    message="accepted_turns must be strictly increasing unique turn ids",
                )
            )

    restart_req = requirements.get("restart") or {}
    restart = evidence.get("restart")
    if restart_req.get("required"):
        if not isinstance(restart, dict):
            findings.append(
                _finding(
                    code="restart_evidence_missing",
                    severity="contradictory_evidence",
                    message="restart evidence object is required",
                )
            )
            restart = {}
        expected_at = restart_req.get("at_turn")
        if expected_at is not None and restart.get("at_turn") != expected_at:
            findings.append(
                _finding(
                    code="restart_turn_mismatch",
                    severity="contradictory_evidence",
                    message=f"restart.at_turn must be {expected_at}",
                    expected=expected_at,
                    actual=restart.get("at_turn"),
                )
            )
        if restart_req.get("require_pre_checkpoint_sha256") and not _is_sha256(
            restart.get("pre_checkpoint_sha256")
        ):
            findings.append(
                _finding(
                    code="pre_checkpoint_hash_missing",
                    severity="contradictory_evidence",
                    message="restart.pre_checkpoint_sha256 must be a sha256 hex digest",
                )
            )
        if restart_req.get("require_post_checkpoint_sha256") and not _is_sha256(
            restart.get("post_checkpoint_sha256")
        ):
            findings.append(
                _finding(
                    code="post_checkpoint_hash_missing",
                    severity="contradictory_evidence",
                    message="restart.post_checkpoint_sha256 must be a sha256 hex digest",
                )
            )
        if (requirements.get("checkpoint_integrity") or {}).get(
            "pre_post_hash_match_required"
        ):
            pre_hash = restart.get("pre_checkpoint_sha256")
            post_hash = restart.get("post_checkpoint_sha256")
            if _is_sha256(pre_hash) and _is_sha256(post_hash) and pre_hash != post_hash:
                findings.append(
                    _finding(
                        code="checkpoint_hash_mismatch",
                        severity="contradictory_evidence",
                        message="pre/post checkpoint hashes must match for continuity resume",
                    )
                )
        if restart_req.get("require_session_identity_continuity"):
            before = restart.get("session_id_before")
            after = restart.get("session_id_after")
            session_id = evidence.get("session_id")
            if not before or not after or before != after:
                findings.append(
                    _finding(
                        code="session_identity_broken",
                        severity="contradictory_evidence",
                        message="session identity must continue across restart",
                    )
                )
            elif session_id and session_id != after:
                findings.append(
                    _finding(
                        code="session_identity_broken",
                        severity="contradictory_evidence",
                        message="top-level session_id must match restart session identity",
                    )
                )
        if restart.get("resumed") is not True:
            findings.append(
                _finding(
                    code="restart_not_resumed",
                    severity="contradictory_evidence",
                    message="restart.resumed must be true",
                )
            )
        if evidence_class == "external" and not (
            restart.get("model_workers_restarted_between_segments") is True
            and restart.get("logical_evaluation_session_continued") is True
            and restart.get("model_conversation_session_continuity_claimed") is False
        ):
            findings.append(
                _finding(
                    code="restart_session_scope_invalid",
                    severity="contradictory_evidence",
                    message=(
                        "restart evidence must distinguish restarted model workers "
                        "from the continued logical evaluation session"
                    ),
                )
            )

    anchors = evidence.get("recall_anchors")
    if not isinstance(anchors, dict):
        anchors = {}
        findings.append(
            _finding(
                code="recall_anchors_missing",
                severity="contradictory_evidence",
                message="recall_anchors object is required",
            )
        )
    for anchor_name in requirements.get("recall_anchors") or []:
        anchor = anchors.get(anchor_name)
        if not isinstance(anchor, dict):
            findings.append(
                _finding(
                    code="recall_anchor_missing",
                    severity="contradictory_evidence",
                    message=f"missing recall anchor: {anchor_name}",
                    anchor=anchor_name,
                )
            )
            continue
        if not anchor.get("anchor_id"):
            findings.append(
                _finding(
                    code="recall_anchor_incomplete",
                    severity="contradictory_evidence",
                    message=f"recall anchor {anchor_name} missing anchor_id",
                    anchor=anchor_name,
                )
            )
        if anchor.get("present_before_restart") is not True or (
            anchor.get("present_after_restart") is not True
        ):
            findings.append(
                _finding(
                    code="recall_anchor_not_retained",
                    severity="contradictory_evidence",
                    message=f"recall anchor {anchor_name} not retained across restart",
                    anchor=anchor_name,
                )
            )

    ledger_hashes: set[str] = set()
    checkpoint_files: list[dict[str, str]] | None = None
    if evidence_class == "external":
        ledger_hashes, checkpoint_files = _continuity_external_segments_ok(
            path, evidence, findings
        )
    _continuity_recall_receipt_ok(
        path, evidence, evidence_class, checkpoint_files, findings
    )

    if (requirements.get("secret_leakage_audit") or {}).get("required"):
        _continuity_secret_audit_ok(
            path, evidence, evidence_class, ledger_hashes, findings
        )

    if eligible is False:
        findings.append(
            _finding(
                code="evidence_marked_ineligible",
                severity="ineligible",
                message="evidence.eligible is false",
            )
        )
        return _base_result(
            status="INELIGIBLE",
            findings=findings,
            evidence_class=evidence_class,
            gameplay_evidence=False,
        )

    if findings:
        return _base_result(
            status="FAIL",
            findings=findings,
            evidence_class=evidence_class,
            gameplay_evidence=False,
            metrics={
                "accepted_turn_count": len(accepted),
                "reported_turn_count": reported_count,
            },
        )

    gameplay = evidence_class == "external"
    return _base_result(
        status="PASS",
        findings=[],
        evidence_class=evidence_class,
        gameplay_evidence=gameplay,
        metrics={
            "accepted_turn_count": len(accepted),
            "reported_turn_count": reported_count,
            "restart_at_turn": (restart or {}).get("at_turn") if isinstance(restart, dict) else None,
        },
    )
