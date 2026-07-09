"""Pi brain adapter: spawn constrained Node bridge, parse Event list."""
from __future__ import annotations

import importlib.util
import json
import subprocess
from pathlib import Path
from typing import Any


def _pi_dir() -> Path:
    return Path(__file__).resolve().parent


def _default_runner() -> Path:
    return _pi_dir() / "run_turn.mjs"


def _load_events():
    path = Path(__file__).resolve().parents[2] / "engine" / "events.py"
    spec = importlib.util.spec_from_file_location("runtime_events", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def _runner_cmd(runner_path: Path) -> list[str]:
    """Invoke .mjs/.js via node; otherwise run the path directly (fake runners)."""
    if runner_path.suffix.lower() in {".mjs", ".js"}:
        return ["node", str(runner_path)]
    return [str(runner_path)]


def parse_runner_response(raw: dict[str, Any]) -> list[dict[str, Any]]:
    """Validate runner JSON envelope and return schema-valid Event dicts."""
    if not isinstance(raw, dict):
        raise RuntimeError("pi runner response must be a JSON object")
    if raw.get("ok") is not True:
        err = raw.get("error") or "pi runner returned ok=false"
        raise RuntimeError(str(err))
    events = raw.get("events")
    if not isinstance(events, list):
        raise RuntimeError("pi runner response missing events list")
    events_mod = _load_events()
    for ev in events:
        events_mod.validate_event(ev)
    return events


def pi_send_turn(
    request: dict[str, Any],
    *,
    runner_path: Path | str | None = None,
    timeout_s: float = 300,
) -> list[dict[str, Any]]:
    """Run one player turn through the Pi Node bridge; return Event dicts.

    ``request`` must include workspace, campaign_id, investigator_id,
    character_path, and player_text.
    """
    required = (
        "workspace",
        "campaign_id",
        "investigator_id",
        "character_path",
        "player_text",
    )
    for key in required:
        if key not in request:
            raise ValueError(f"pi_send_turn request missing {key!r}")

    runner = Path(runner_path) if runner_path is not None else _default_runner()
    if not runner.exists():
        raise RuntimeError(f"pi runner not found: {runner}")

    cmd = _runner_cmd(runner)
    payload = json.dumps(request, ensure_ascii=False)
    try:
        proc = subprocess.run(
            cmd,
            input=payload,
            capture_output=True,
            text=True,
            timeout=timeout_s,
            cwd=str(_pi_dir()),
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"pi runner timed out after {timeout_s}s") from exc
    except FileNotFoundError as exc:
        raise RuntimeError(f"failed to start pi runner: {cmd[0]}") from exc

    stdout = (proc.stdout or "").strip()
    stderr = (proc.stderr or "").strip()

    if proc.returncode != 0:
        detail = stderr or stdout or f"exit {proc.returncode}"
        # Prefer structured error from stdout when present.
        if stdout:
            try:
                parsed = json.loads(stdout)
                if isinstance(parsed, dict) and parsed.get("error"):
                    detail = str(parsed["error"])
            except json.JSONDecodeError:
                pass
        raise RuntimeError(f"pi runner failed: {detail}")

    if not stdout:
        raise RuntimeError("pi runner produced empty stdout")

    try:
        raw = json.loads(stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"pi runner stdout is not JSON: {stdout[:200]!r}") from exc

    return parse_runner_response(raw)
