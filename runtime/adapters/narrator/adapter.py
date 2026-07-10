"""Narrator adapter: spawn constrained subprocess bridge, parse KP narration."""
from __future__ import annotations

import copy
import json
import subprocess
from pathlib import Path
from typing import Any

NARRATOR_REQUEST_KEYS = (
    "narration_envelope",
    "last_player_text",
    "play_language",
    "recent_narrations",
)

# Planner-side fields that must never reach the narrator model.
_ENVELOPE_DROP_KEYS = frozenset({"rationale", "keeper_secrets", "director_rationale"})


def _narrator_dir() -> Path:
    return Path(__file__).resolve().parent


def _default_runner() -> Path:
    return _narrator_dir() / "run_narration.mjs"


def _runner_cmd(runner_path: Path) -> list[str]:
    """Invoke .mjs/.js via node; otherwise run the path directly (fake runners)."""
    if runner_path.suffix.lower() in {".mjs", ".js"}:
        return ["node", str(runner_path)]
    return [str(runner_path)]


def sanitize_narration_envelope(envelope: Any) -> dict[str, Any]:
    """Return a deep copy of the envelope without planner-only fields.

    The envelope is already spoiler-safe by construction from
    ``build_narration_envelope``; this only drops planner-side rationale and
    any accidental keeper_secrets key.
    """
    if not isinstance(envelope, dict):
        return {}
    cleaned = copy.deepcopy(envelope)
    for key in _ENVELOPE_DROP_KEYS:
        cleaned.pop(key, None)
    return cleaned


def prepare_narrator_request(request: dict[str, Any]) -> dict[str, Any]:
    """Validate and sanitize a narrator request before spawning the runner."""
    if not isinstance(request, dict):
        raise ValueError("narrator_send_turn request must be a dict")
    for key in NARRATOR_REQUEST_KEYS:
        if key not in request:
            raise ValueError(f"narrator_send_turn request missing {key!r}")
    prepared = dict(request)
    prepared["narration_envelope"] = sanitize_narration_envelope(
        request.get("narration_envelope")
    )
    recent = prepared.get("recent_narrations")
    if recent is None:
        prepared["recent_narrations"] = []
    elif not isinstance(recent, list):
        raise ValueError("recent_narrations must be a list")
    else:
        prepared["recent_narrations"] = [str(x) for x in recent[-2:]]
    prepared["last_player_text"] = str(prepared.get("last_player_text") or "")
    prepared["play_language"] = str(prepared.get("play_language") or "zh-Hans")
    return prepared


def parse_runner_response(raw: dict[str, Any]) -> dict[str, Any]:
    """Validate runner JSON envelope and return final_text (+ optional notes)."""
    if not isinstance(raw, dict):
        raise RuntimeError("narrator runner response must be a JSON object")
    if raw.get("ok") is not True:
        err = raw.get("error") or "narrator runner returned ok=false"
        raise RuntimeError(str(err))
    final_text = raw.get("final_text")
    if not isinstance(final_text, str) or not final_text.strip():
        raise RuntimeError("narrator runner response missing non-empty final_text string")
    result: dict[str, Any] = {"ok": True, "final_text": final_text}
    notes = raw.get("notes")
    if notes is not None:
        if not isinstance(notes, str):
            raise RuntimeError("notes must be a string when present")
        result["notes"] = notes
    return result


def narrator_send_turn(
    request: dict[str, Any],
    *,
    runner_path: Path | str | None = None,
    timeout_s: float = 300,
) -> dict[str, Any]:
    """Run one KP narration turn through the narrator-brain bridge.

    ``request`` must include: narration_envelope, last_player_text,
    play_language, recent_narrations. The adapter strips planner-side
    ``rationale`` / keeper secrets before spawning.
    """
    prepared = prepare_narrator_request(request)

    # Resolve against the caller's cwd *before* spawning: the subprocess runs
    # with cwd=_narrator_dir(), which would silently re-anchor relative paths.
    runner = Path(runner_path).resolve() if runner_path is not None else _default_runner()
    if not runner.exists():
        raise RuntimeError(f"narrator runner not found: {runner}")

    cmd = _runner_cmd(runner)
    payload = json.dumps(prepared, ensure_ascii=False)
    try:
        proc = subprocess.run(
            cmd,
            input=payload,
            capture_output=True,
            text=True,
            timeout=timeout_s,
            cwd=str(_narrator_dir()),
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"narrator runner timed out after {timeout_s}s") from exc
    except FileNotFoundError as exc:
        raise RuntimeError(f"failed to start narrator runner: {cmd[0]}") from exc

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
        raise RuntimeError(f"narrator runner failed: {detail}")

    if not stdout:
        raise RuntimeError("narrator runner produced empty stdout")

    try:
        raw = json.loads(stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"narrator runner stdout is not JSON: {stdout[:200]!r}") from exc

    return parse_runner_response(raw)
