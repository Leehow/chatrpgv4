#!/usr/bin/env python3
"""Build and revalidate evidence-grade COC playtest provenance receipts."""
from __future__ import annotations

import copy
import hashlib
import json
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any


EVIDENCE_SCHEMA_VERSION = 1
SCRIPT_DIR = Path(__file__).resolve().parent
PLUGIN_DIR = SCRIPT_DIR.parent
REPO_ROOT = PLUGIN_DIR.parents[1]
TRUSTED_RUNNER_REGISTRY_PATH = (
    PLUGIN_DIR / "references" / "trusted-playtest-runners.json"
)
LEDGER_OUTCOMES = frozenset(
    {"external_success", "template", "template_fallback", "runner_failure"}
)
FALLBACK_KINDS = frozenset({"template", "prose_degradation"})


def sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _finding(findings: list[dict[str, str]], code: str, field: str) -> None:
    item = {"code": code, "field": field, "severity": "error"}
    if item not in findings:
        findings.append(item)


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


def _build_artifact(run_dir: Path, raw_path: Any) -> dict[str, Any]:
    resolved, stored_path = _artifact_path(run_dir, raw_path)
    digest = (
        sha256_path(resolved)
        if resolved is not None
        and _inside_run_dir(run_dir, resolved)
        and resolved.is_file()
        else None
    )
    return {"path": stored_path, "sha256": digest}


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


def _normalize_model_identity(value: Any) -> dict[str, str] | None:
    if not isinstance(value, dict):
        return None
    provider = value.get("provider")
    model_id = value.get("id", value.get("model"))
    if not (
        isinstance(provider, str)
        and provider.strip()
        and isinstance(model_id, str)
        and model_id.strip()
    ):
        return None
    return {"provider": provider.strip(), "id": model_id.strip()}


def _load_trusted_registry(
    findings: list[dict[str, str]],
) -> dict[str, dict[str, Any]]:
    try:
        payload = json.loads(TRUSTED_RUNNER_REGISTRY_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        _finding(findings, "trusted_runner_registry_invalid", "trusted_runner_registry")
        return {}
    runners = payload.get("runners") if isinstance(payload, dict) else None
    if payload.get("schema_version") != 1 or not isinstance(runners, dict):
        _finding(findings, "trusted_runner_registry_invalid", "trusted_runner_registry")
        return {}
    valid: dict[str, dict[str, Any]] = {}
    for role in ("player", "narrator"):
        entry = runners.get(role)
        if not isinstance(entry, dict):
            _finding(findings, "trusted_runner_registry_invalid", f"registry.{role}")
            continue
        canonical = (REPO_ROOT / str(entry.get("path") or "")).resolve()
        expected = entry.get("sha256")
        if (
            entry.get("role") != role
            or entry.get("kind") != "external_model_bridge"
            or not isinstance(entry.get("identity"), str)
            or not entry["identity"].strip()
            or not canonical.is_file()
            or not isinstance(expected, str)
            or sha256_path(canonical) != expected
        ):
            _finding(findings, "trusted_runner_registry_mismatch", f"registry.{role}")
            continue
        valid[role] = {**copy.deepcopy(entry), "resolved_path": str(canonical)}
    return valid


def observe_runner(run_dir: Path, role: str, runner_path: Path | str | None) -> dict[str, Any]:
    """Describe an observed path using repository-owned trust data only."""
    findings: list[dict[str, str]] = []
    registry = _load_trusted_registry(findings)
    if runner_path is None:
        return {
            "role": role,
            "trusted": role == "narrator",
            "kind": "absent" if role == "narrator" else "missing",
            "identity": "deterministic_template" if role == "narrator" else None,
            "path": None,
            "sha256": None,
            "package_identity": None,
        }
    resolved = Path(runner_path).resolve()
    digest = sha256_path(resolved) if resolved.is_file() else None
    entry = registry.get(role)
    trusted = bool(
        entry
        and str(resolved) == entry.get("resolved_path")
        and digest == entry.get("sha256")
    )
    return {
        "role": role,
        "trusted": trusted,
        "kind": entry["kind"] if trusted else "unknown",
        "identity": entry["identity"] if trusted else None,
        "path": str(resolved),
        "sha256": digest,
        "package_identity": copy.deepcopy(entry.get("package_identity")) if trusted else None,
    }


def _validate_artifact(
    run_dir: Path,
    artifact: Any,
    findings: list[dict[str, str]],
    *,
    field: str,
    missing_code: str,
    mismatch_code: str,
) -> Path | None:
    if not isinstance(artifact, dict):
        _finding(findings, missing_code, field)
        return None
    resolved, _stored = _artifact_path(run_dir, artifact.get("path"))
    if resolved is not None and not _inside_run_dir(run_dir, resolved):
        _finding(findings, "artifact_path_outside_run_dir", f"{field}.path")
        _finding(findings, missing_code, f"{field}.sha256")
        return None
    stored_hash = artifact.get("sha256")
    if resolved is None or not resolved.is_file() or not isinstance(stored_hash, str):
        _finding(findings, missing_code, f"{field}.sha256")
        return None
    if sha256_path(resolved) != stored_hash:
        _finding(findings, mismatch_code, f"{field}.sha256")
        return None
    return resolved


def _read_jsonl(path: Path | None, findings: list[dict[str, str]], code: str) -> list[dict[str, Any]]:
    if path is None:
        return []
    rows: list[dict[str, Any]] = []
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        _finding(findings, code, path.name)
        return []
    for index, line in enumerate(lines, start=1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            _finding(findings, code, f"{path.name}.{index}")
            continue
        if not isinstance(row, dict):
            _finding(findings, code, f"{path.name}.{index}")
            continue
        rows.append(row)
    return rows


def _runner_descriptor(
    role: str,
    registry: dict[str, dict[str, Any]],
    rows: list[dict[str, Any]],
) -> dict[str, Any]:
    if role == "narrator" and rows and all(row.get("runner_path") is None for row in rows):
        return {
            "kind": "absent",
            "identity": "deterministic_template",
            "sha256": None,
            "package_identity": None,
            "model_identities": [],
        }
    entry = registry.get(role)
    trusted_rows = [row for row in rows if _row_matches_registry(row, entry)]
    models: list[dict[str, str]] = []
    for row in trusted_rows:
        model = _normalize_model_identity(row.get("model_identity"))
        if model is not None and model not in models:
            models.append(model)
    if not trusted_rows or entry is None:
        return {
            "kind": "unknown" if rows else ("absent" if role == "narrator" else "missing"),
            "identity": None,
            "sha256": None,
            "package_identity": None,
            "model_identities": models,
        }
    return {
        "kind": entry["kind"],
        "identity": entry["identity"],
        "sha256": entry["sha256"],
        "package_identity": copy.deepcopy(entry.get("package_identity")),
        "model_identities": models,
    }


def _row_matches_registry(row: dict[str, Any], entry: dict[str, Any] | None) -> bool:
    if entry is None:
        return False
    raw_path = row.get("runner_path")
    if not isinstance(raw_path, str) or not raw_path.strip():
        return False
    resolved = Path(raw_path).resolve()
    if not resolved.is_file():
        return False
    actual = sha256_path(resolved)
    return (
        str(resolved) == entry.get("resolved_path")
        and actual == entry.get("sha256")
        and row.get("runner_sha256") == actual
        and row.get("runner_identity") == entry.get("identity")
    )


def _evaluate_ledger(
    ledger_rows: list[dict[str, Any]],
    transcript_rows: list[dict[str, Any]],
    registry: dict[str, dict[str, Any]],
    findings: list[dict[str, str]],
) -> tuple[dict[str, Any], int, int]:
    role_rows: dict[str, list[dict[str, Any]]] = {"player": [], "narrator": []}
    external_model_turns = 0
    external_player_turns = 0
    fallback_turns = 0
    ledger_shape_invalid = False
    for index, row in enumerate(ledger_rows):
        field = f"invocation_ledger.{index}"
        role = row.get("role")
        outcome = row.get("outcome")
        attempt = row.get("attempt")
        transcript_turn = row.get("transcript_turn")
        if (
            role not in role_rows
            or outcome not in LEDGER_OUTCOMES
            or isinstance(attempt, bool)
            or not isinstance(attempt, int)
            or attempt < 1
            or isinstance(transcript_turn, bool)
            or not isinstance(transcript_turn, int)
            or transcript_turn < 1
        ):
            _finding(findings, "invocation_ledger_malformed", field)
            ledger_shape_invalid = True
            continue
        fallback_kind = row.get("fallback_kind")
        if fallback_kind is not None and fallback_kind not in FALLBACK_KINDS:
            _finding(findings, "invocation_ledger_malformed", f"{field}.fallback_kind")
            ledger_shape_invalid = True
            continue
        role_rows[role].append(row)
        if fallback_kind in FALLBACK_KINDS:
            fallback_turns += 1
        if outcome != "external_success":
            continue
        trusted = _row_matches_registry(row, registry.get(role))
        model = _normalize_model_identity(row.get("model_identity"))
        if not trusted:
            _finding(
                findings,
                f"untrusted_{role}_runner_used",
                f"{field}.runner_path",
            )
            continue
        if model is None:
            _finding(findings, "model_identity_missing", f"{field}.model_identity")
            continue
        external_model_turns += 1
        if role == "player":
            external_player_turns += 1

    expected_player = Counter(
        row.get("turn")
        for row in transcript_rows
        if row.get("role") == "player_simulator" and isinstance(row.get("turn"), int)
    )
    expected_narrator = Counter(
        row.get("turn")
        for row in transcript_rows
        if row.get("role") == "keeper_under_test" and isinstance(row.get("turn"), int)
    )
    observed_player = Counter(row.get("transcript_turn") for row in role_rows["player"])
    observed_narrator = Counter(row.get("transcript_turn") for row in role_rows["narrator"])
    if not ledger_shape_invalid and (
        observed_player != expected_player or observed_narrator != expected_narrator
    ):
        _finding(findings, "invocation_transcript_mismatch", "invocation_ledger")

    if external_player_turns < 1:
        _finding(findings, "no_external_player_turns", "external_model_turns.player")
        _finding(findings, "no_external_model_turns", "external_model_turns")
    runners = {
        role: _runner_descriptor(role, registry, role_rows[role])
        for role in ("player", "narrator")
    }
    if not role_rows["player"]:
        _finding(findings, "runner_not_trusted", "runners.player")
    return runners, external_model_turns, fallback_turns


def validate_evidence_receipt(run_dir: Path, receipt: dict[str, Any]) -> dict[str, Any]:
    """Recompute trust, counts, and current artifact hashes from the ledger."""
    root = Path(run_dir)
    validated = copy.deepcopy(receipt) if isinstance(receipt, dict) else {}
    findings: list[dict[str, str]] = []
    if (
        isinstance(validated.get("schema_version"), bool)
        or validated.get("schema_version") != EVIDENCE_SCHEMA_VERSION
    ):
        _finding(findings, "evidence_schema_invalid", "schema_version")
    _validate_timestamps(validated, findings)
    registry = _load_trusted_registry(findings)

    artifacts = validated.get("artifacts")
    if not isinstance(artifacts, dict):
        artifacts = {}
    transcript_path = _validate_artifact(
        root,
        artifacts.get("transcript"),
        findings,
        field="artifacts.transcript",
        missing_code="transcript_hash_missing",
        mismatch_code="transcript_hash_mismatch",
    )
    ledger_path = _validate_artifact(
        root,
        artifacts.get("invocation_ledger"),
        findings,
        field="artifacts.invocation_ledger",
        missing_code="invocation_ledger_missing",
        mismatch_code="invocation_ledger_hash_mismatch",
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

    transcript_rows = _read_jsonl(transcript_path, findings, "transcript_malformed")
    ledger_rows = _read_jsonl(ledger_path, findings, "invocation_ledger_malformed")
    runners, external_model_turns, fallback_turns = _evaluate_ledger(
        ledger_rows,
        transcript_rows,
        registry,
        findings,
    )
    reasons = list(dict.fromkeys(item["code"] for item in findings))
    validated["runners"] = runners
    validated["external_model_turns"] = external_model_turns
    validated["fallback_turns"] = fallback_turns
    validated["validation_findings"] = findings
    validated["evidence_reasons"] = reasons
    validated["eligible_as_gameplay_evidence"] = not reasons
    return validated


def build_evidence_receipt(
    run_dir: Path,
    provenance: dict[str, Any],
) -> dict[str, Any]:
    """Build from non-authoritative observations and repository-owned trust."""
    root = Path(run_dir)
    source = provenance if isinstance(provenance, dict) else {}
    event_paths = source.get("event_log_paths")
    event_paths = event_paths if isinstance(event_paths, list) else []
    receipt: dict[str, Any] = {
        "schema_version": EVIDENCE_SCHEMA_VERSION,
        "started_at": source.get("started_at"),
        "ended_at": source.get("ended_at"),
        "user_claimed_live": source.get("user_claimed_live") is True,
        "runners": {},
        "external_model_turns": 0,
        "fallback_turns": 0,
        "artifacts": {
            "transcript": _build_artifact(root, source.get("transcript_path")),
            "invocation_ledger": _build_artifact(
                root, source.get("invocation_ledger_path")
            ),
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
        "runners": {
            "player": {"kind": "missing", "identity": None, "model_identities": []},
            "narrator": {"kind": "absent", "identity": "deterministic_template", "model_identities": []},
        },
        "validation_findings": [finding],
        "evidence_reasons": [code],
        "eligible_as_gameplay_evidence": False,
        "external_model_turns": 0,
        "fallback_turns": 0,
    }


def write_evidence_receipt(run_dir: Path, receipt: dict[str, Any]) -> Path:
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
