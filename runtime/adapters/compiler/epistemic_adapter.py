"""Constrained subprocess bridge for epistemic sidecar compilation."""
from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path
from typing import Any


def _adapter_dir() -> Path:
    return Path(__file__).resolve().parent


def _default_runner() -> Path:
    return _adapter_dir() / "run_epistemic_compile.mjs"


def _request_sha256(request: dict[str, Any]) -> str:
    encoded = json.dumps(
        request, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def compile_epistemic(
    request: dict[str, Any],
    *,
    runner_path: Path | str | None = None,
    timeout_s: float = 900,
) -> dict[str, Any]:
    """Compile one minimum-privilege request into provenance-bound sidecars."""
    if not isinstance(request, dict) or request.get("kind") != "coc_epistemic_compile_request":
        raise ValueError("invalid epistemic compile request")
    runner = Path(runner_path).resolve() if runner_path else _default_runner()
    if not runner.is_file():
        raise RuntimeError(f"epistemic compiler runner not found: {runner}")
    envelope = {
        "compile_request": json.loads(json.dumps(request, ensure_ascii=False)),
        "request_sha256": _request_sha256(request),
    }
    try:
        proc = subprocess.run(
            ["node", str(runner)],
            input=json.dumps(envelope, ensure_ascii=False),
            capture_output=True,
            text=True,
            timeout=timeout_s,
            cwd=str(_adapter_dir()),
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"epistemic compiler timed out after {timeout_s}s") from exc
    except FileNotFoundError as exc:
        raise RuntimeError("failed to start epistemic compiler: node") from exc
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
        raise RuntimeError(f"epistemic compiler failed: {detail}")
    try:
        raw = json.loads(stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError("epistemic compiler stdout is not JSON") from exc
    if not isinstance(raw, dict) or raw.get("ok") is not True:
        raise RuntimeError(str((raw or {}).get("error") or "epistemic compiler returned ok=false"))
    result = raw.get("compile_result")
    if not isinstance(result, dict):
        raise RuntimeError("epistemic compiler response requires compile_result")
    return {
        "ok": True,
        "compile_result": result,
        "model_identity": raw.get("model_identity"),
        "usage": raw.get("usage"),
    }
