"""Scenario compiler adapter: constrained subprocess bridge for module source IR."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any


REQUIRED_REQUEST_KEYS = (
    "schema_version",
    "module_identity",
    "source",
    "pages",
    "required_files",
    "compile_contract",
)
MAX_REVISION_ATTEMPT = 5
MAX_FEEDBACK_FINDINGS = 256
MAX_STRUCTURED_FEEDBACK_BYTES = 1_000_000
MAX_PARENT_BUNDLE_BYTES = 8_000_000
MAX_REVISION_REQUEST_BYTES = 12_000_000


def _adapter_dir() -> Path:
    return Path(__file__).resolve().parent


def _default_runner() -> Path:
    return _adapter_dir() / "run_scenario_compile.mjs"


def _runner_cmd(path: Path) -> list[str]:
    if path.suffix.lower() in {".mjs", ".js"}:
        return ["node", str(path)]
    return [str(path)]


def _json_size_bytes(value: Any, *, label: str) -> int:
    try:
        encoded = json.dumps(
            value,
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{label} must be JSON serializable") from exc
    return len(encoded)


def _validate_revision_feedback(request: dict[str, Any]) -> None:
    revision_attempt = request.get("revision_attempt")
    if revision_attempt is None:
        return
    if type(revision_attempt) is not int or not 2 <= revision_attempt <= MAX_REVISION_ATTEMPT:
        raise ValueError("revision_attempt must be an integer from 2 through 5")
    for key in ("parent_attempt", "best_attempt"):
        value = request.get(key)
        if value is not None and (
            type(value) is not int or not 1 <= value < revision_attempt
        ):
            raise ValueError(f"{key} must identify an earlier attempt")
    digest = request.get("parent_bundle_sha256")
    if digest is not None and (
        not isinstance(digest, str)
        or len(digest) != 64
        or any(char not in "0123456789abcdef" for char in digest)
    ):
        raise ValueError("parent_bundle_sha256 must be a lowercase sha256 digest")
    previous = request.get("previous_scenario_bundle")
    if previous is not None and not isinstance(previous, dict):
        raise ValueError("previous_scenario_bundle must be an object")
    if previous is not None and _json_size_bytes(
        previous, label="previous_scenario_bundle"
    ) > MAX_PARENT_BUNDLE_BYTES:
        raise ValueError("previous_scenario_bundle exceeds byte limit")
    for key in ("validation_findings", "regression_findings"):
        findings = request.get(key)
        if findings is None:
            continue
        if not isinstance(findings, list) or len(findings) > MAX_FEEDBACK_FINDINGS:
            raise ValueError(f"{key} must contain at most {MAX_FEEDBACK_FINDINGS} findings")
        for finding in findings:
            if not isinstance(finding, dict):
                raise ValueError(f"{key} entries must be objects")
            if not isinstance(finding.get("code"), str):
                raise ValueError(f"{key} entries require code")
            if finding.get("severity") not in {"error", "warning"}:
                raise ValueError(f"{key} entries require error or warning severity")
            if not isinstance(finding.get("path", ""), str):
                raise ValueError(f"{key} entries require string path")
            if "details" in finding and not isinstance(finding["details"], dict):
                raise ValueError(f"{key} details must be an object")
    for key in ("reference_snapshot", "regression_reference_snapshot"):
        value = request.get(key)
        if value is not None and not isinstance(value, dict):
            raise ValueError(f"{key} must be an object")
    lineage = request.get("revision_lineage")
    if lineage is not None and (
        not isinstance(lineage, list) or len(lineage) > MAX_REVISION_ATTEMPT
        or not all(isinstance(item, dict) for item in lineage)
    ):
        raise ValueError("revision_lineage must contain at most five objects")
    feedback = {
        key: request.get(key)
        for key in (
            "validation_findings", "regression_findings", "reference_snapshot",
            "regression_reference_snapshot", "revision_lineage",
        )
        if key in request
    }
    if _json_size_bytes(
        feedback, label="structured revision feedback"
    ) > MAX_STRUCTURED_FEEDBACK_BYTES:
        raise ValueError("structured revision feedback exceeds size limit")
    if _json_size_bytes(
        request, label="scenario compile revision request"
    ) > MAX_REVISION_REQUEST_BYTES:
        raise ValueError("scenario compile revision request exceeds byte limit")


def prepare_compile_request(request: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(request, dict):
        raise ValueError("scenario compile request must be an object")
    missing = [key for key in REQUIRED_REQUEST_KEYS if key not in request]
    if missing:
        raise ValueError(f"scenario compile request missing {missing!r}")
    pages = request.get("pages")
    if not isinstance(pages, list) or not pages:
        raise ValueError("scenario compile request pages must be non-empty")
    for page in pages:
        if not isinstance(page, dict):
            raise ValueError("scenario compile page must be an object")
        if not isinstance(page.get("pdf_index"), int):
            raise ValueError("scenario compile page requires integer pdf_index")
        if not isinstance(page.get("text"), str) or not page["text"].strip():
            raise ValueError("scenario compile page requires extracted text")
    _validate_revision_feedback(request)
    return json.loads(json.dumps(request, ensure_ascii=False))


def parse_runner_response(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise RuntimeError("scenario compiler response must be a JSON object")
    if raw.get("ok") is not True:
        raise RuntimeError(str(raw.get("error") or "scenario compiler returned ok=false"))
    bundle = raw.get("scenario_bundle")
    if isinstance(bundle, str):
        try:
            bundle = json.loads(bundle)
        except json.JSONDecodeError as exc:
            raise RuntimeError("scenario_bundle string is not valid JSON") from exc
    if not isinstance(bundle, dict):
        raise RuntimeError("scenario compiler response requires scenario_bundle object")
    result: dict[str, Any] = {"ok": True, "scenario_bundle": bundle}
    identity = raw.get("model_identity")
    if identity is not None:
        if not (
            isinstance(identity, dict)
            and isinstance(identity.get("provider"), str)
            and identity["provider"].strip()
            and isinstance(identity.get("id"), str)
            and identity["id"].strip()
        ):
            raise RuntimeError("model_identity requires non-empty provider and id")
        result["model_identity"] = {
            "provider": identity["provider"].strip(),
            "id": identity["id"].strip(),
        }
    usage = raw.get("usage")
    if usage is not None:
        if not isinstance(usage, dict):
            raise RuntimeError("usage must be an object")
        result["usage"] = usage
    return result


def compile_scenario(
    request: dict[str, Any],
    *,
    runner_path: Path | str | None = None,
    timeout_s: float = 900,
) -> dict[str, Any]:
    """Compile extracted Keeper-only source pages into structured scenario IR."""
    prepared = prepare_compile_request(request)
    runner = Path(runner_path).resolve() if runner_path else _default_runner()
    if not runner.is_file():
        raise RuntimeError(f"scenario compiler runner not found: {runner}")
    cmd = _runner_cmd(runner)
    try:
        proc = subprocess.run(
            cmd,
            input=json.dumps(prepared, ensure_ascii=False),
            capture_output=True,
            text=True,
            timeout=timeout_s,
            cwd=str(_adapter_dir()),
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"scenario compiler timed out after {timeout_s}s") from exc
    except FileNotFoundError as exc:
        raise RuntimeError(f"failed to start scenario compiler: {cmd[0]}") from exc
    stdout = (proc.stdout or "").strip()
    stderr = (proc.stderr or "").strip()
    if proc.returncode != 0:
        detail = stderr or stdout or f"exit {proc.returncode}"
        if stdout:
            try:
                parsed = json.loads(stdout)
                if isinstance(parsed, dict) and parsed.get("error"):
                    detail = str(parsed["error"])
            except json.JSONDecodeError:
                pass
        raise RuntimeError(f"scenario compiler failed: {detail}")
    if not stdout:
        raise RuntimeError("scenario compiler produced empty stdout")
    try:
        raw = json.loads(stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError("scenario compiler stdout is not JSON") from exc
    return parse_runner_response(raw)
