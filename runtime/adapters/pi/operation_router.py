"""Semantic Pi router for natural player text to canonical runtime operations."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any


def _default_runner() -> Path:
    return Path(__file__).resolve().parent / "route_operation.mjs"


def _runner_cmd(path: Path) -> list[str]:
    return ["node", str(path)] if path.suffix.lower() in {".mjs", ".js"} else [str(path)]


def route_player_action(
    player_text: str,
    public_state: dict[str, Any],
    *,
    runner_path: Path | str | None = None,
    timeout_s: float = 120,
) -> dict[str, Any]:
    """Return structured semantic evidence; failures safely select ordinary turn."""
    if not isinstance(player_text, str) or not player_text.strip():
        raise ValueError("player_text must be non-empty")
    if not isinstance(public_state, dict):
        raise ValueError("public_state must be an object")
    runner = Path(runner_path).resolve() if runner_path is not None else _default_runner()
    try:
        completed = subprocess.run(
            _runner_cmd(runner),
            input=json.dumps({
                "player_text": player_text,
                "public_state": public_state,
            }, ensure_ascii=False),
            text=True,
            capture_output=True,
            timeout=timeout_s,
            check=False,
            cwd=runner.parent,
        )
        raw = json.loads((completed.stdout or "").strip())
        if completed.returncode != 0 or not isinstance(raw, dict) or raw.get("ok") is not True:
            raise RuntimeError(str((raw or {}).get("error") or completed.stderr or "router failed"))
        route = raw.get("semantic_route")
        if not isinstance(route, dict):
            raise RuntimeError("router response missing semantic_route")
        result = {"semantic_route": route}
        if isinstance(raw.get("model_identity"), dict):
            result["model_identity"] = raw["model_identity"]
        return result
    except (
        OSError,
        subprocess.SubprocessError,
        ValueError,
        TypeError,
        RuntimeError,
    ) as exc:
        return {
            "semantic_route": {
                "schema_version": 1,
                "route": "ordinary_turn",
                "reason": "operation_router_unavailable",
                "operation": None,
            },
            "fallback": True,
            "error_type": type(exc).__name__,
        }
