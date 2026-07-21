"""Constrained subprocess bridge for epistemic sidecar compilation."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import re
import subprocess
from pathlib import Path
from typing import Any


_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
_CORRECTABLE_CODES = {
    "compile_result_root_type_invalid",
    "compile_result_root_keys_mismatch",
    "compile_result_identity_invalid",
    "compile_result_provenance_invalid",
    "compile_result_document_type_invalid",
    "compile_result_validation_failed",
    "compile_result_not_submitted",
}
_SAFE_REJECTION_CODES = _CORRECTABLE_CODES | {
    "compile_result_submission_limit_exceeded",
    "compile_result_duplicate_valid_candidate",
}
_DIGEST_LIST_FIELDS = {
    "unexpected_key_sha256",
    "provenance_unexpected_key_sha256",
}


class EpistemicCompileRejected(RuntimeError):
    """A model result was rejected with only safe structured evidence retained."""

    def __init__(self, diagnostics: list[dict[str, Any]]):
        self.diagnostics = diagnostics
        code = diagnostics[-1].get("error_code", "epistemic_compile_rejected")
        super().__init__(f"epistemic compiler rejected result: {code}")


class EpistemicCompilerProtocolError(RuntimeError):
    """The runner violated a stable transport or identity contract."""

    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def _adapter_dir() -> Path:
    return Path(__file__).resolve().parent


def _default_runner() -> Path:
    return _adapter_dir() / "run_epistemic_compile.mjs"


def _contract_path() -> Path:
    # Import-time binding: no workspace context exists here, so this resolves
    # the default plugin root through the single locator (Phase 1 seam 4).
    locator_path = _adapter_dir().parents[1] / "engine" / "plugin_locator.py"
    spec = importlib.util.spec_from_file_location(
        "runtime_plugin_locator_epistemic", locator_path
    )
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod.plugin_scripts_dir() / "epistemic-contract.json"


def _load_contract() -> dict[str, Any]:
    return json.loads(_contract_path().read_text(encoding="utf-8"))


_CONTRACT = _load_contract()
_ROOT_KEYS = frozenset(_CONTRACT["ordered_root_keys"])
_PROVENANCE_KEYS = frozenset(_CONTRACT["provenance"]["ordered_keys"])
_DOCUMENT_KEYS = frozenset(_CONTRACT["document_keys"])


def _request_sha256(request: dict[str, Any]) -> str:
    encoded = json.dumps(
        request, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _safe_key_list(value: Any, allowed: frozenset[str]) -> list[str]:
    if not isinstance(value, list):
        return []
    result: list[str] = []
    for item in value[:32]:
        if not isinstance(item, str):
            continue
        if item in allowed:
            result.append(item)
    return sorted(result)


def _safe_model_identity(value: Any) -> dict[str, str] | None:
    if not isinstance(value, dict):
        return None
    provider = value.get("provider")
    model_id = value.get("id")
    identity_re = re.compile(r"^[A-Za-z0-9._:/+\-]{1,128}$")
    if (
        not isinstance(provider, str)
        or not isinstance(model_id, str)
        or not identity_re.fullmatch(provider)
        or not identity_re.fullmatch(model_id)
    ):
        return None
    return {"provider": provider, "id": model_id}


def _safe_diagnostic(value: Any, expected_request_sha: str) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    code = value.get("error_code")
    request_sha = value.get("epistemic_request_sha256")
    result_sha = value.get("rejected_result_sha256")
    result_bytes = value.get("rejected_result_bytes")
    diagnostic_subject = value.get("diagnostic_subject")
    if diagnostic_subject is None:
        diagnostic_subject = "rejected_result"
    if (
        not isinstance(code, str)
        or code not in _SAFE_REJECTION_CODES
        or request_sha != expected_request_sha
        or diagnostic_subject not in {"rejected_result", "none"}
    ):
        return None
    if diagnostic_subject == "rejected_result":
        if (
            not isinstance(result_sha, str)
            or not _SHA256_RE.fullmatch(result_sha)
            or not isinstance(result_bytes, int)
            or isinstance(result_bytes, bool)
            or result_bytes < 0
        ):
            return None
    elif result_sha is not None or result_bytes is not None:
        return None
    safe: dict[str, Any] = {
        "schema_version": 1,
        "phase": "epistemic_compile",
        "error_code": code,
        "diagnostic_subject": diagnostic_subject,
        "epistemic_request_sha256": request_sha,
    }
    if diagnostic_subject == "rejected_result":
        safe["rejected_result_sha256"] = result_sha
        safe["rejected_result_bytes"] = result_bytes
    for field in ("expected_key_names", "present_expected_key_names", "missing_key_names"):
        safe[field] = _safe_key_list(value.get(field), _ROOT_KEYS)
    for field in (
        "provenance_expected_key_names",
        "provenance_present_expected_key_names",
        "provenance_missing_key_names",
    ):
        safe[field] = _safe_key_list(value.get(field), _PROVENANCE_KEYS)
    for field in _DIGEST_LIST_FIELDS:
        digests = value.get(field)
        safe[field] = [
            item for item in (digests if isinstance(digests, list) else [])[:32]
            if isinstance(item, str) and _SHA256_RE.fullmatch(item)
        ]
    for field in ("unexpected_key_count", "provenance_unexpected_key_count"):
        count = value.get(field, 0)
        safe[field] = count if isinstance(count, int) and not isinstance(count, bool) and 0 <= count <= 32 else 32
    invalid_document_key = value.get("invalid_document_key")
    if isinstance(invalid_document_key, str) and invalid_document_key in _DOCUMENT_KEYS:
        safe["invalid_document_key"] = invalid_document_key
    identity = _safe_model_identity(value.get("model_identity"))
    if identity is None:
        return None
    safe["model_identity"] = identity
    submission_attempt = value.get("submission_attempt")
    if (
        isinstance(submission_attempt, int)
        and not isinstance(submission_attempt, bool)
        and 1 <= submission_attempt <= 2
    ):
        safe["submission_attempt"] = submission_attempt
    accepted_result_count = value.get("accepted_result_count")
    if (
        isinstance(accepted_result_count, int)
        and not isinstance(accepted_result_count, bool)
        and 0 <= accepted_result_count <= 1
    ):
        safe["accepted_result_count"] = accepted_result_count
    failure_class = value.get("failure_class")
    if failure_class in {
        "raw_validation", "duplicate_valid_candidate", "not_submitted"
    }:
        safe["failure_class"] = failure_class
    return safe


def _invoke_runner(
    runner: Path,
    envelope: dict[str, Any],
    *,
    timeout_s: float,
) -> tuple[int, str]:
    try:
        proc = subprocess.run(
            ["node", str(runner)],
            input=json.dumps(envelope, ensure_ascii=False),
            capture_output=True,
            text=True,
            timeout=timeout_s,
            cwd=str(_adapter_dir()),
            # Keep the Node runner on the same locator-resolved contract.
            env={**os.environ, "COC_EPISTEMIC_CONTRACT_PATH": str(_contract_path())},
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"epistemic compiler timed out after {timeout_s}s") from exc
    except FileNotFoundError as exc:
        raise RuntimeError("failed to start epistemic compiler: node") from exc
    return proc.returncode, (proc.stdout or "").strip()


def compile_epistemic(
    request: dict[str, Any],
    *,
    runner_path: Path | str | None = None,
    timeout_s: float = 900,
    max_attempts: int = 2,
) -> dict[str, Any]:
    """Compile one minimum-privilege request into provenance-bound sidecars."""
    if not isinstance(request, dict) or request.get("kind") != "coc_epistemic_compile_request":
        raise ValueError("invalid epistemic compile request")
    runner = Path(runner_path).resolve() if runner_path else _default_runner()
    if not runner.is_file():
        raise RuntimeError(f"epistemic compiler runner not found: {runner}")
    canonical_request_json = json.dumps(
        request, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    )
    request_digest = hashlib.sha256(canonical_request_json.encode("utf-8")).hexdigest()
    base_envelope = {
        "compile_request_json": canonical_request_json,
    }
    rejected: list[dict[str, Any]] = []
    bound_model_identity: dict[str, str] | None = None
    attempts = min(2, max(1, int(max_attempts or 1)))
    for attempt in range(1, attempts + 1):
        envelope = dict(base_envelope)
        if rejected:
            envelope["correction_feedback"] = rejected[-1]
        returncode, stdout = _invoke_runner(runner, envelope, timeout_s=timeout_s)
        try:
            raw = json.loads(stdout)
        except json.JSONDecodeError as exc:
            raise RuntimeError("epistemic compiler stdout is not JSON") from exc
        if returncode != 0 or not isinstance(raw, dict) or raw.get("ok") is not True:
            diagnostic = _safe_diagnostic(
                raw.get("diagnostic") if isinstance(raw, dict) else None,
                request_digest,
            )
            if diagnostic is None:
                raise RuntimeError("epistemic compiler failed without a safe diagnostic")
            diagnostic["attempt"] = attempt
            diagnostic["process_attempt"] = attempt
            if bound_model_identity is None:
                bound_model_identity = diagnostic["model_identity"]
            elif diagnostic["model_identity"] != bound_model_identity:
                raise EpistemicCompilerProtocolError("epistemic_model_identity_changed")
            rejected.append(diagnostic)
            if attempt < attempts and diagnostic["error_code"] in _CORRECTABLE_CODES:
                continue
            raise EpistemicCompileRejected(rejected)
        result = raw.get("compile_result")
        if not isinstance(result, dict):
            raise RuntimeError("epistemic compiler response requires compile_result")
        model_identity = _safe_model_identity(raw.get("model_identity"))
        if model_identity is None:
            raise EpistemicCompilerProtocolError("epistemic_model_identity_invalid")
        if bound_model_identity is not None and model_identity != bound_model_identity:
            raise EpistemicCompilerProtocolError("epistemic_model_identity_changed")
        return {
            "ok": True,
            "compile_result": result,
            "model_identity": model_identity,
            "usage": raw.get("usage"),
            "rejected_attempts": rejected,
            "epistemic_attempts": attempt,
        }
    raise EpistemicCompileRejected(rejected)
