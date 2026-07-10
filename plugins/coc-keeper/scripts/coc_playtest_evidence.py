#!/usr/bin/env python3
"""Build and validate provenance receipts for evidence-grade playtests.

Eligibility is derived from structured runner attestations and hashes of the
actual files on disk.  Caller-supplied ``live`` / eligibility booleans are not
part of the trust decision.
"""
from __future__ import annotations

import copy
import hashlib
import json
from datetime import datetime
from pathlib import Path
from typing import Any


EVIDENCE_SCHEMA_VERSION = 1
ELIGIBLE_RUNNER_KINDS = frozenset({"external_model_bridge"})


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _inside_run_dir(run_dir: Path, path: Path) -> bool:
    try:
        path.resolve().relative_to(run_dir.resolve())
    except ValueError:
        return False
    return True


def _artifact_path(run_dir: Path, raw_path: Any) -> tuple[Path | None, str | None]:
    if not isinstance(raw_path, (str, Path)) or not str(raw_path).strip():
        return None, None
    candidate = Path(raw_path)
    if not candidate.is_absolute():
        candidate = run_dir / candidate
    resolved = candidate.resolve()
    if not _inside_run_dir(run_dir, resolved):
        return resolved, str(raw_path)
    return resolved, resolved.relative_to(run_dir.resolve()).as_posix()


def _runner_path(run_dir: Path, raw_path: Any) -> tuple[Path | None, str | None]:
    if not isinstance(raw_path, (str, Path)) or not str(raw_path).strip():
        return None, None
    candidate = Path(raw_path)
    if not candidate.is_absolute():
        candidate = run_dir / candidate
    resolved = candidate.resolve()
    if _inside_run_dir(run_dir, resolved):
        return resolved, resolved.relative_to(run_dir.resolve()).as_posix()
    # Runner executables may live outside a run directory.  Unlike receipt
    # artifacts, their path is allowed, but it is always hashed from disk.
    return resolved, str(resolved)


def _valid_package_identity(value: Any) -> bool:
    return (
        isinstance(value, dict)
        and isinstance(value.get("name"), str)
        and bool(value["name"].strip())
        and isinstance(value.get("version"), str)
        and bool(value["version"].strip())
    )


def _normalize_model_identity(value: Any) -> Any:
    if isinstance(value, str) and value.strip():
        return value.strip()
    if (
        isinstance(value, dict)
        and isinstance(value.get("provider"), str)
        and value["provider"].strip()
        and isinstance(value.get("model"), str)
        and value["model"].strip()
    ):
        return copy.deepcopy(value)
    return None


def _build_runner(run_dir: Path, source: Any) -> dict[str, Any] | None:
    if not isinstance(source, dict):
        return None
    resolved, stored_path = _runner_path(run_dir, source.get("path"))
    digest = _sha256_file(resolved) if resolved is not None and resolved.is_file() else None
    package_identity = source.get("package_identity")
    return {
        "kind": str(source.get("kind") or "unknown"),
        "identity": (
            source.get("identity").strip()
            if isinstance(source.get("identity"), str) and source["identity"].strip()
            else None
        ),
        "path": stored_path,
        "sha256": digest,
        "package_identity": (
            copy.deepcopy(package_identity) if _valid_package_identity(package_identity) else None
        ),
        "model_identity": _normalize_model_identity(source.get("model_identity")),
        "turn_count": source.get("turn_count"),
        "attestation": (
            copy.deepcopy(source.get("attestation"))
            if isinstance(source.get("attestation"), dict)
            else None
        ),
    }


def _build_artifact(run_dir: Path, raw_path: Any) -> dict[str, Any]:
    resolved, stored_path = _artifact_path(run_dir, raw_path)
    digest = (
        _sha256_file(resolved)
        if resolved is not None and _inside_run_dir(run_dir, resolved) and resolved.is_file()
        else None
    )
    return {"path": stored_path, "sha256": digest}


def _finding(findings: list[dict[str, str]], code: str, field: str) -> None:
    item = {"code": code, "field": field, "severity": "error"}
    if item not in findings:
        findings.append(item)


def _parse_timestamp(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    return parsed if parsed.tzinfo is not None else None


def _validate_timestamps(receipt: dict[str, Any], findings: list[dict[str, str]]) -> None:
    started = _parse_timestamp(receipt.get("started_at"))
    ended = _parse_timestamp(receipt.get("ended_at"))
    if started is None:
        _finding(findings, "started_at_missing_or_invalid", "started_at")
    if ended is None:
        _finding(findings, "ended_at_missing_or_invalid", "ended_at")
    if started is not None and ended is not None and ended < started:
        _finding(findings, "timestamp_order_invalid", "ended_at")


def _attestation_matches(runner: dict[str, Any], actual_sha256: str | None) -> bool:
    attestation = runner.get("attestation")
    if not isinstance(attestation, dict):
        return False
    if attestation.get("subject_identity") != runner.get("identity"):
        return False
    method = attestation.get("method")
    if method == "runner_sha256":
        expected = attestation.get("runner_sha256")
        return (
            isinstance(expected, str)
            and len(expected) == 64
            and actual_sha256 is not None
            and expected == actual_sha256
        )
    if method == "package_identity":
        package_identity = runner.get("package_identity")
        return (
            _valid_package_identity(package_identity)
            and attestation.get("package_identity") == package_identity
        )
    return False


def _validate_runner(
    run_dir: Path,
    role: str,
    runner: Any,
    findings: list[dict[str, str]],
) -> int:
    field = f"runners.{role}"
    if not isinstance(runner, dict):
        _finding(findings, "runner_missing", field)
        _finding(findings, "runner_not_attested", field)
        return 0

    kind = runner.get("kind")
    kind_eligible = kind in ELIGIBLE_RUNNER_KINDS
    if kind in (None, "", "absent"):
        _finding(findings, "runner_missing", f"{field}.kind")
    elif kind == "unknown":
        _finding(findings, "runner_kind_unknown", f"{field}.kind")
    elif not kind_eligible:
        _finding(findings, "runner_kind_ineligible", f"{field}.kind")

    identity = runner.get("identity")
    if not isinstance(identity, str) or not identity.strip():
        _finding(findings, "runner_identity_missing", f"{field}.identity")

    if _normalize_model_identity(runner.get("model_identity")) is None:
        _finding(findings, "model_identity_missing", f"{field}.model_identity")

    actual_sha256: str | None = None
    stored_sha256 = runner.get("sha256")
    raw_path = runner.get("path")
    if isinstance(raw_path, str) and raw_path.strip():
        resolved, _stored = _runner_path(run_dir, raw_path)
        if resolved is not None and resolved.is_file():
            actual_sha256 = _sha256_file(resolved)
            if not isinstance(stored_sha256, str) or not stored_sha256:
                _finding(findings, "runner_hash_missing", f"{field}.sha256")
            elif actual_sha256 != stored_sha256:
                _finding(findings, "runner_hash_mismatch", f"{field}.sha256")
        else:
            _finding(findings, "runner_hash_missing", f"{field}.sha256")
    elif not _valid_package_identity(runner.get("package_identity")):
        _finding(findings, "runner_hash_missing", f"{field}.sha256")

    attested = kind_eligible and _attestation_matches(runner, actual_sha256)
    if not attested:
        _finding(findings, "runner_not_attested", f"{field}.attestation")

    turns = runner.get("turn_count")
    if isinstance(turns, bool) or not isinstance(turns, int) or turns < 0:
        _finding(findings, "external_model_turns_malformed", f"{field}.turn_count")
        return 0
    return turns if attested else 0


def _validate_artifact(
    run_dir: Path,
    artifact: Any,
    findings: list[dict[str, str]],
    *,
    field: str,
    missing_code: str,
    mismatch_code: str,
) -> None:
    if not isinstance(artifact, dict):
        _finding(findings, missing_code, field)
        return
    resolved, _stored = _artifact_path(run_dir, artifact.get("path"))
    if resolved is not None and not _inside_run_dir(run_dir, resolved):
        _finding(findings, "artifact_path_outside_run_dir", f"{field}.path")
        _finding(findings, missing_code, f"{field}.sha256")
        return
    stored_hash = artifact.get("sha256")
    if resolved is None or not resolved.is_file() or not isinstance(stored_hash, str):
        _finding(findings, missing_code, f"{field}.sha256")
        return
    if _sha256_file(resolved) != stored_hash:
        _finding(findings, mismatch_code, f"{field}.sha256")


def validate_evidence_receipt(run_dir: Path, receipt: dict[str, Any]) -> dict[str, Any]:
    """Recompute all trust decisions and current on-disk hash matches."""
    root = Path(run_dir)
    validated = copy.deepcopy(receipt) if isinstance(receipt, dict) else {}
    findings: list[dict[str, str]] = []
    if validated.get("schema_version") != EVIDENCE_SCHEMA_VERSION:
        _finding(findings, "evidence_schema_invalid", "schema_version")
    _validate_timestamps(validated, findings)

    runners = validated.get("runners")
    if not isinstance(runners, dict):
        runners = {}
    external_model_turns = sum(
        _validate_runner(root, role, runners.get(role), findings)
        for role in ("player", "narrator")
    )
    if external_model_turns < 1:
        _finding(findings, "no_external_model_turns", "external_model_turns")

    fallback_turns = validated.get("fallback_turns")
    if (
        isinstance(fallback_turns, bool)
        or not isinstance(fallback_turns, int)
        or fallback_turns < 0
    ):
        _finding(findings, "fallback_turns_malformed", "fallback_turns")

    artifacts = validated.get("artifacts")
    if not isinstance(artifacts, dict):
        artifacts = {}
    _validate_artifact(
        root,
        artifacts.get("transcript"),
        findings,
        field="artifacts.transcript",
        missing_code="transcript_hash_missing",
        mismatch_code="transcript_hash_mismatch",
    )
    event_logs = artifacts.get("event_logs")
    if not isinstance(event_logs, list) or not event_logs:
        _finding(findings, "event_log_hash_missing", "artifacts.event_logs")
    else:
        for index, artifact in enumerate(event_logs):
            _validate_artifact(
                root,
                artifact,
                findings,
                field=f"artifacts.event_logs.{index}",
                missing_code="event_log_hash_missing",
                mismatch_code="event_log_hash_mismatch",
            )

    reasons = list(dict.fromkeys(item["code"] for item in findings))
    validated["external_model_turns"] = external_model_turns
    validated["validation_findings"] = findings
    validated["evidence_reasons"] = reasons
    validated["eligible_as_gameplay_evidence"] = not reasons
    return validated


def build_evidence_receipt(
    run_dir: Path,
    provenance: dict[str, Any],
) -> dict[str, Any]:
    """Build a canonical receipt from structured provenance and disk bytes."""
    root = Path(run_dir)
    source = provenance if isinstance(provenance, dict) else {}
    raw_event_paths = source.get("event_log_paths")
    event_paths = raw_event_paths if isinstance(raw_event_paths, list) else []
    receipt: dict[str, Any] = {
        "schema_version": EVIDENCE_SCHEMA_VERSION,
        "started_at": source.get("started_at"),
        "ended_at": source.get("ended_at"),
        "user_claimed_live": source.get("user_claimed_live") is True,
        "runners": {
            "player": _build_runner(root, source.get("player_runner")),
            "narrator": _build_runner(root, source.get("narrator_runner")),
        },
        "external_model_turns": 0,
        "fallback_turns": source.get("fallback_turns"),
        "artifacts": {
            "transcript": _build_artifact(root, source.get("transcript_path")),
            "event_logs": [_build_artifact(root, path) for path in event_paths],
        },
        "validation_findings": [],
        "eligible_as_gameplay_evidence": False,
        "evidence_reasons": [],
    }
    return validate_evidence_receipt(root, receipt)

def _invalid_receipt(code: str) -> dict[str, Any]:
    finding = {"code": code, "field": "evidence.json", "severity": "error"}
    return {
        "schema_version": EVIDENCE_SCHEMA_VERSION,
        "validation_findings": [finding],
        "evidence_reasons": [code],
        "eligible_as_gameplay_evidence": False,
        "external_model_turns": 0,
        "fallback_turns": None,
    }


def write_evidence_receipt(run_dir: Path, receipt: dict[str, Any]) -> Path:
    """Validate and write exactly ``run_dir/evidence.json``."""
    root = Path(run_dir)
    root.mkdir(parents=True, exist_ok=True)
    validated = validate_evidence_receipt(root, receipt)
    output = root / "evidence.json"
    output.write_text(
        json.dumps(validated, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return output


def read_evidence_receipt(run_dir: Path) -> dict[str, Any]:
    """Read and revalidate a receipt, failing closed when absent/malformed."""
    root = Path(run_dir)
    path = root / "evidence.json"
    if not path.is_file():
        return _invalid_receipt("evidence_receipt_missing")
    try:
        receipt = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return _invalid_receipt("evidence_receipt_malformed")
    if not isinstance(receipt, dict):
        return _invalid_receipt("evidence_receipt_malformed")
    return validate_evidence_receipt(root, receipt)
