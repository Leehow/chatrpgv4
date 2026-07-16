#!/usr/bin/env python3
"""Build and revalidate evidence-grade COC playtest provenance receipts."""
from __future__ import annotations

import copy
import hashlib
import json
import os
import tempfile
import importlib.util
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
    {
        "external_success", "template", "template_fallback", "runner_failure",
        "operator_input", "operator_review_pending",
    }
)
FALLBACK_KINDS = frozenset(
    {"template", "prose_degradation", "secret_audit", "fact_fidelity"}
)
RUN_KINDS = frozenset({"diagnostic_spoiler_run", "blind_actual_play"})
EXPECTED_INTERACTIVE_NARRATOR_MODEL = {"provider": "zhipu-coding", "id": "glm-5.2"}
_TRUSTED_KIND_BY_ROLE = {
    "player": "external_model_bridge",
    "narrator": "external_model_bridge",
    "action_resolver": "external_model_bridge",
    "interactive_driver": "python_cli",
}
_FIXED_ARTIFACT_BASENAMES = {
    "evidence_receipt": "evidence.json",
    "invocation_ledger": "runner-invocations.jsonl",
}


def _load_operator_review():
    spec = importlib.util.spec_from_file_location(
        "coc_operator_review_evidence", SCRIPT_DIR / "coc_operator_review.py"
    )
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _write_fixed_artifact_atomic(
    run_dir: Path,
    artifact_kind: str,
    text: str,
) -> Path:
    """Atomically replace one repository-defined evidence artifact."""
    basename = _FIXED_ARTIFACT_BASENAMES[artifact_kind]
    root = Path(run_dir)
    root.mkdir(parents=True, exist_ok=True)
    root = root.resolve(strict=True)
    output = root / basename
    temp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            dir=root,
            prefix=f".{basename}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            temp_path = Path(handle.name)
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, output)
        temp_path = None
    finally:
        if temp_path is not None:
            try:
                temp_path.unlink(missing_ok=True)
            except OSError:
                pass
    return output


def write_invocation_ledger_artifact(run_dir: Path, text: str) -> Path:
    """Write the fixed-name invocation ledger without following output symlinks."""
    return _write_fixed_artifact_atomic(run_dir, "invocation_ledger", text)


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
    *,
    roles: tuple[str, ...] | None = None,
) -> dict[str, dict[str, Any]]:
    try:
        payload = json.loads(TRUSTED_RUNNER_REGISTRY_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        _finding(findings, "trusted_runner_registry_invalid", "trusted_runner_registry")
        return {}
    if not isinstance(payload, dict):
        _finding(findings, "trusted_runner_registry_invalid", "trusted_runner_registry")
        return {}
    runners = payload.get("runners")
    if payload.get("schema_version") != 1 or not isinstance(runners, dict):
        _finding(findings, "trusted_runner_registry_invalid", "trusted_runner_registry")
        return {}
    selected = roles or ("player", "narrator", "action_resolver", "interactive_driver")
    valid: dict[str, dict[str, Any]] = {}
    for role in selected:
        entry = runners.get(role)
        if not isinstance(entry, dict):
            _finding(findings, "trusted_runner_registry_invalid", f"registry.{role}")
            continue
        expected_kind = _TRUSTED_KIND_BY_ROLE.get(role)
        canonical = (REPO_ROOT / str(entry.get("path") or "")).resolve()
        expected = entry.get("sha256")
        if (
            entry.get("role") != role
            or expected_kind is None
            or entry.get("kind") != expected_kind
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
    registry = _load_trusted_registry(findings, roles=(role,))
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
    role_rows: dict[str, list[dict[str, Any]]] = {
        "player": [], "narrator": [], "action_resolver": [],
    }
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
    expected_action_resolver = expected_player if role_rows["action_resolver"] else Counter()
    observed_player = Counter(row.get("transcript_turn") for row in role_rows["player"])
    observed_narrator = Counter(row.get("transcript_turn") for row in role_rows["narrator"])
    observed_action_resolver = Counter(
        row.get("transcript_turn") for row in role_rows["action_resolver"]
    )
    if not ledger_shape_invalid and (
        observed_player != expected_player
        or observed_narrator != expected_narrator
        or observed_action_resolver != expected_action_resolver
    ):
        _finding(findings, "invocation_transcript_mismatch", "invocation_ledger")

    if external_player_turns < 1:
        _finding(findings, "no_external_player_turns", "external_model_turns.player")
    if external_model_turns < 1:
        _finding(findings, "no_external_model_turns", "external_model_turns")
    runners = {
        role: _runner_descriptor(role, registry, role_rows[role])
        for role in ("player", "narrator", "action_resolver")
    }
    if not role_rows["player"]:
        _finding(findings, "runner_not_trusted", "runners.player")
    return runners, external_model_turns, fallback_turns


def _canonical_json_bytes(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def _sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _validate_action_ledger_chain(
    path: Path | None,
    findings: list[dict[str, str]],
) -> list[dict[str, Any]]:
    rows = _read_jsonl(path, findings, "action_ledger_malformed")
    if path is None:
        _finding(findings, "action_ledger_missing", "artifacts.action_ledger")
        return []
    if not rows:
        _finding(findings, "action_ledger_empty", "artifacts.action_ledger")
        return []
    previous = "0" * 64
    for index, row in enumerate(rows):
        field = f"action_ledger.{index}"
        turn = row.get("turn_number")
        previous_sha = row.get("previous_sha256")
        row_sha = row.get("row_sha256")
        action = row.get("action")
        if (
            not isinstance(turn, int)
            or isinstance(turn, bool)
            or turn != index + 1
            or previous_sha != previous
            or not isinstance(row_sha, str)
            or not isinstance(action, dict)
        ):
            _finding(findings, "action_ledger_chain_invalid", field)
            return rows
        expected = _sha256_bytes(
            _canonical_json_bytes(
                {key: value for key, value in row.items() if key != "row_sha256"}
            )
        )
        if row_sha != expected:
            _finding(findings, "action_ledger_chain_invalid", f"{field}.row_sha256")
            return rows
        previous = row_sha
    return rows


def _validate_checkpoint_chain(
    run_dir: Path,
    artifacts: dict[str, Any],
    action_rows: list[dict[str, Any]],
    findings: list[dict[str, str]],
) -> None:
    checkpoint_artifacts = artifacts.get("checkpoints")
    if not isinstance(checkpoint_artifacts, list) or not checkpoint_artifacts:
        _finding(findings, "checkpoint_chain_missing", "artifacts.checkpoints")
        return
    if len(checkpoint_artifacts) != len(action_rows):
        _finding(findings, "checkpoint_chain_mismatch", "artifacts.checkpoints")
    previous_chain = "0" * 64
    for index, artifact in enumerate(checkpoint_artifacts):
        field = f"artifacts.checkpoints.{index}"
        resolved = _validate_artifact(
            run_dir,
            artifact,
            findings,
            field=field,
            missing_code="checkpoint_missing",
            mismatch_code="checkpoint_hash_mismatch",
        )
        if resolved is None:
            continue
        try:
            manifest = json.loads(resolved.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            _finding(findings, "checkpoint_malformed", field)
            continue
        if not isinstance(manifest, dict):
            _finding(findings, "checkpoint_malformed", field)
            continue
        turn = manifest.get("turn_number")
        chain = manifest.get("action_chain_sha256")
        if (
            not isinstance(turn, int)
            or isinstance(turn, bool)
            or turn != index + 1
            or not isinstance(chain, str)
        ):
            _finding(findings, "checkpoint_chain_invalid", field)
            continue
        if index < len(action_rows) and chain != action_rows[index].get("row_sha256"):
            _finding(findings, "checkpoint_action_mismatch", field)
            continue
        if index > 0 and previous_chain == "0" * 64:
            _finding(findings, "checkpoint_chain_invalid", field)
        previous_chain = chain if isinstance(chain, str) else previous_chain


def _validate_interactive_driver(
    run_dir: Path,
    artifacts: dict[str, Any],
    registry: dict[str, dict[str, Any]],
    findings: list[dict[str, str]],
) -> dict[str, Any]:
    entry = registry.get("interactive_driver")
    observed = artifacts.get("interactive_driver")
    if not isinstance(observed, dict):
        _finding(findings, "interactive_driver_missing", "artifacts.interactive_driver")
        return {"kind": "missing", "identity": None, "sha256": None}
    resolved, _stored = _artifact_path(run_dir, observed.get("path"))
    # Driver path is repository-owned; allow absolute path to the trusted script.
    raw_path = observed.get("path")
    candidate = Path(str(raw_path)).resolve() if isinstance(raw_path, (str, Path)) else None
    stored_hash = observed.get("sha256")
    if entry is None:
        _finding(findings, "interactive_driver_untrusted", "artifacts.interactive_driver")
        return {"kind": "unknown", "identity": None, "sha256": stored_hash}
    if (
        candidate is None
        or not candidate.is_file()
        or not isinstance(stored_hash, str)
        or str(candidate) != entry.get("resolved_path")
        or sha256_path(candidate) != entry.get("sha256")
        or stored_hash != entry.get("sha256")
    ):
        _finding(findings, "interactive_driver_untrusted", "artifacts.interactive_driver")
        return {
            "kind": "unknown",
            "identity": None,
            "sha256": stored_hash if isinstance(stored_hash, str) else None,
        }
    return {
        "kind": entry["kind"],
        "identity": entry["identity"],
        "sha256": entry["sha256"],
        "path": entry["resolved_path"],
    }


def _validate_interactive_narrator_models(
    ledger_rows: list[dict[str, Any]],
    registry: dict[str, dict[str, Any]],
    findings: list[dict[str, str]],
) -> list[dict[str, str]]:
    models: list[dict[str, str]] = []
    narrator_rows = [row for row in ledger_rows if row.get("role") == "narrator"]
    if not narrator_rows:
        _finding(findings, "interactive_narrator_missing", "invocation_ledger.narrator")
        return models
    for index, row in enumerate(narrator_rows):
        field = f"invocation_ledger.narrator.{index}"
        if row.get("outcome") != "external_success":
            _finding(findings, "interactive_narrator_not_external", field)
            continue
        if not _row_matches_registry(row, registry.get("narrator")):
            _finding(findings, "untrusted_narrator_runner_used", f"{field}.runner_path")
            continue
        model = _normalize_model_identity(row.get("model_identity"))
        if model is None:
            _finding(findings, "model_identity_missing", f"{field}.model_identity")
            continue
        if model != EXPECTED_INTERACTIVE_NARRATOR_MODEL:
            _finding(findings, "interactive_narrator_model_mismatch", f"{field}.model_identity")
            continue
        if row.get("fallback_kind") is not None:
            _finding(findings, "interactive_narrator_fallback", f"{field}.fallback_kind")
            continue
        if model not in models:
            models.append(model)
    return models


def _evaluate_interactive_evidence(
    run_dir: Path,
    validated: dict[str, Any],
    findings: list[dict[str, str]],
) -> None:
    run_kind = validated.get("run_kind")
    if run_kind not in RUN_KINDS:
        _finding(findings, "run_kind_invalid", "run_kind")
        return
    registry = _load_trusted_registry(
        findings, roles=("interactive_driver", "narrator")
    )
    artifacts = validated.get("artifacts")
    if not isinstance(artifacts, dict):
        artifacts = {}
        validated["artifacts"] = artifacts

    driver = _validate_interactive_driver(run_dir, artifacts, registry, findings)
    _validate_artifact(
        run_dir,
        artifacts.get("transcript"),
        findings,
        field="artifacts.transcript",
        missing_code="transcript_hash_missing",
        mismatch_code="transcript_hash_mismatch",
    )
    _validate_artifact(
        run_dir,
        artifacts.get("player_view"),
        findings,
        field="artifacts.player_view",
        missing_code="player_view_hash_missing",
        mismatch_code="player_view_hash_mismatch",
    )
    action_path = _validate_artifact(
        run_dir,
        artifacts.get("action_ledger"),
        findings,
        field="artifacts.action_ledger",
        missing_code="action_ledger_missing",
        mismatch_code="action_ledger_hash_mismatch",
    )
    action_rows = _validate_action_ledger_chain(action_path, findings)
    _validate_checkpoint_chain(run_dir, artifacts, action_rows, findings)

    ledger_path = _validate_artifact(
        run_dir,
        artifacts.get("invocation_ledger"),
        findings,
        field="artifacts.invocation_ledger",
        missing_code="invocation_ledger_missing",
        mismatch_code="invocation_ledger_hash_mismatch",
    )
    ledger_rows = _read_jsonl(ledger_path, findings, "invocation_ledger_malformed")
    models = _validate_interactive_narrator_models(ledger_rows, registry, findings)

    event_logs = artifacts.get("event_logs")
    if not isinstance(event_logs, list) or not event_logs:
        _finding(findings, "event_log_hash_missing", "artifacts.event_logs")
    else:
        for index, artifact in enumerate(event_logs):
            _validate_artifact(
                run_dir,
                artifact,
                findings,
                field=f"artifacts.event_logs.{index}",
                missing_code="event_log_hash_missing",
                mismatch_code="event_log_hash_mismatch",
            )

    validated["runners"] = {
        "interactive_driver": driver,
        "narrator": {
            "kind": registry["narrator"]["kind"] if "narrator" in registry else "unknown",
            "identity": registry["narrator"]["identity"] if "narrator" in registry else None,
            "sha256": registry["narrator"]["sha256"] if "narrator" in registry else None,
            "model_identities": models,
        },
    }
    validated["external_model_turns"] = len(
        [
            row
            for row in ledger_rows
            if row.get("role") == "narrator" and row.get("outcome") == "external_success"
        ]
    )
    validated["fallback_turns"] = sum(
        1 for row in ledger_rows if row.get("fallback_kind") in FALLBACK_KINDS
    )
    if run_kind == "diagnostic_spoiler_run":
        _finding(
            findings,
            "diagnostic_spoiler_run_not_battle_report_eligible",
            "run_kind",
        )


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

    run_kind = validated.get("run_kind")
    if run_kind is not None:
        _evaluate_interactive_evidence(root, validated, findings)
        reasons = list(dict.fromkeys(item["code"] for item in findings))
        validated["validation_findings"] = findings
        validated["evidence_reasons"] = reasons
        validated["eligible_as_gameplay_evidence"] = (
            run_kind == "blind_actual_play" and not reasons
        )
        validated["run_kind"] = run_kind if run_kind in RUN_KINDS else None
        return validated

    registry = _load_trusted_registry(
        findings, roles=("player", "narrator", "action_resolver")
    )

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
    operator_review_status = "not_required"
    operator_review_artifact = artifacts.get("operator_review")
    if validated.get("operator_long_play") is True:
        # Operator mode intentionally replaces the external player model with
        # an attested operator-input lane.  This is a mode fact, independent
        # of whether the later review approves or requests changes.
        findings = [
            item for item in findings
            if item["code"] != "no_external_player_turns"
        ]
        operator_review_status = "pending"
        if operator_review_artifact is not None:
            review_path = _validate_artifact(
                root,
                operator_review_artifact,
                findings,
                field="artifacts.operator_review",
                missing_code="operator_review_missing",
                mismatch_code="operator_review_hash_mismatch",
            )
            if review_path is not None:
                try:
                    review_payload = json.loads(review_path.read_text(encoding="utf-8"))
                    normalized_review = _load_operator_review().validate_review(
                        review_payload,
                        run_id=root.name,
                    )
                    if (
                        review_payload.get("status") != normalized_review["status"]
                        or review_payload.get("automated_fact_fidelity_pass") is not False
                    ):
                        raise ValueError("recorded operator review fields are inconsistent")
                    operator_review_status = normalized_review["status"]
                except (OSError, json.JSONDecodeError, ValueError, TypeError):
                    _finding(
                        findings,
                        "operator_review_invalid",
                        "artifacts.operator_review",
                    )
                    operator_review_status = "invalid"
        if operator_review_status == "approved":
            player_rows = [row for row in ledger_rows if row.get("role") == "player"]
            if not player_rows or any(
                row.get("outcome") != "operator_input" for row in player_rows
            ):
                _finding(
                    findings,
                    "operator_player_ledger_invalid",
                    "artifacts.invocation_ledger",
                )
            if (runners.get("narrator") or {}).get("kind") != "external_model_bridge":
                _finding(
                    findings,
                    "operator_narrator_runner_untrusted",
                    "runners.narrator",
                )
            disqualifying = {
                item["code"] for item in findings
                if item["code"] != "no_external_player_turns"
            }
            if not disqualifying:
                findings = [
                    item for item in findings
                    if item["code"] != "no_external_player_turns"
                ]
        elif operator_review_status == "pending":
            _finding(
                findings,
                "operator_review_pending",
                "artifacts.operator_review",
            )
        elif operator_review_status == "changes_required":
            _finding(
                findings,
                "operator_review_changes_required",
                "artifacts.operator_review",
            )
    reasons = list(dict.fromkeys(item["code"] for item in findings))
    validated["runners"] = runners
    validated["external_model_turns"] = external_model_turns
    validated["fallback_turns"] = fallback_turns
    validated["operator_review_status"] = operator_review_status
    validated["play_kind"] = (
        "operator_reviewed_actual_play"
        if operator_review_status == "approved" and not reasons
        else None
    )
    validated["qualification_method"] = (
        "structured_operator_review"
        if validated["play_kind"] == "operator_reviewed_actual_play"
        else None
    )
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
    run_kind = source.get("run_kind")
    artifacts: dict[str, Any] = {
        "transcript": _build_artifact(root, source.get("transcript_path")),
        "invocation_ledger": _build_artifact(
            root, source.get("invocation_ledger_path")
        ),
        "event_logs": [_build_artifact(root, path) for path in event_paths],
    }
    if run_kind in RUN_KINDS:
        artifacts["player_view"] = _build_artifact(root, source.get("player_view_path"))
        artifacts["action_ledger"] = _build_artifact(
            root, source.get("action_ledger_path")
        )
        checkpoint_paths = source.get("checkpoint_manifest_paths")
        checkpoint_paths = checkpoint_paths if isinstance(checkpoint_paths, list) else []
        artifacts["checkpoints"] = [
            _build_artifact(root, path) for path in checkpoint_paths
        ]
        driver_path = source.get("interactive_driver_path")
        if driver_path is None:
            driver_path = str(
                (REPO_ROOT / "plugins/coc-keeper/scripts/coc_interactive_playtest.py")
                .resolve()
            )
        resolved_driver = Path(driver_path).resolve()
        artifacts["interactive_driver"] = {
            "path": str(resolved_driver),
            "sha256": sha256_path(resolved_driver) if resolved_driver.is_file() else None,
        }
    receipt: dict[str, Any] = {
        "schema_version": EVIDENCE_SCHEMA_VERSION,
        "started_at": source.get("started_at"),
        "ended_at": source.get("ended_at"),
        "user_claimed_live": source.get("user_claimed_live") is True,
        "operator_long_play": source.get("operator_long_play") is True,
        "run_kind": run_kind if run_kind in RUN_KINDS else None,
        "runners": {},
        "external_model_turns": 0,
        "fallback_turns": 0,
        "artifacts": artifacts,
        "validation_findings": [],
        "eligible_as_gameplay_evidence": False,
        "evidence_reasons": [],
    }
    if receipt["run_kind"] is None and "run_kind" in source and source.get("run_kind") is not None:
        # Preserve invalid declared run_kind so validation can fail closed.
        receipt["run_kind"] = source.get("run_kind")
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
    root = root.resolve(strict=True)
    validated = validate_evidence_receipt(root, receipt)
    return _write_fixed_artifact_atomic(
        root,
        "evidence_receipt",
        json.dumps(validated, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
    )


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
