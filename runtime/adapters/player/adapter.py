"""Player brain adapter: spawn constrained subprocess bridge, parse player turn."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

PLAYER_REQUEST_KEYS = (
    "public_state",
    "narration",
    "character_card",
    "transcript_tail",
    "pending_choice",
)

# Mirrored from plugins/coc-keeper/scripts/coc_intent_router.py
# ``_PRIMARY_INTENT_ENUM`` (source of truth). Runtime must not import plugin
# scripts (Runtime Track); keep this frozenset in sync via
# tests/test_intent_router.py::test_player_adapter_intent_class_enum_stays_in_sync_with_router.
CANONICAL_INTENT_CLASSES = frozenset(
    {
        "investigate",
        "social",
        "move",
        "combat",
        "flee",
        "meta",
        "stuck",
        "idle",
        "ambiguous",
        "montage",
        "cast",
    }
)


def _player_dir() -> Path:
    return Path(__file__).resolve().parent


def _default_runner() -> Path:
    return _player_dir() / "run_player_turn.mjs"


def _runner_cmd(runner_path: Path) -> list[str]:
    """Invoke .mjs/.js via node; otherwise run the path directly (fake runners)."""
    if runner_path.suffix.lower() in {".mjs", ".js"}:
        return ["node", str(runner_path)]
    return [str(runner_path)]


def parse_runner_response(raw: dict[str, Any]) -> dict[str, Any]:
    """Validate runner JSON envelope and return player_text (+ optional fields).

    Optional ``intent_class`` is structured semantic evidence from the player
    brain (canonical enum). Invalid values are a bridge contract violation.
    """
    if not isinstance(raw, dict):
        raise RuntimeError("player runner response must be a JSON object")
    if raw.get("ok") is not True:
        err = raw.get("error") or "player runner returned ok=false"
        raise RuntimeError(str(err))
    player_text = raw.get("player_text")
    if not isinstance(player_text, str) or not player_text.strip():
        raise RuntimeError("player runner response missing non-empty player_text string")
    result: dict[str, Any] = {"ok": True, "player_text": player_text}
    notes = raw.get("player_notes")
    if notes is not None:
        if not isinstance(notes, str):
            raise RuntimeError("player_notes must be a string when present")
        result["player_notes"] = notes
    if "intent_class" in raw and raw.get("intent_class") is not None:
        intent_class = raw.get("intent_class")
        if not isinstance(intent_class, str) or intent_class not in CANONICAL_INTENT_CLASSES:
            raise RuntimeError(
                f"player runner intent_class {intent_class!r} is not a canonical "
                f"intent class (bridge contract violation)"
            )
        result["intent_class"] = intent_class
    return result


def player_send_turn(
    request: dict[str, Any],
    *,
    runner_path: Path | str | None = None,
    timeout_s: float = 300,
) -> dict[str, Any]:
    """Run one investigator turn through the player-brain bridge.

    ``request`` must include only player-safe fields:
    public_state, narration, character_card, transcript_tail, pending_choice.
    Never include director plans, keeper secrets, clue-graph, story-graph, or
    npc-agendas in the request — callers are responsible for spoiler isolation.
    """
    if not isinstance(request, dict):
        raise ValueError("player_send_turn request must be a dict")
    for key in PLAYER_REQUEST_KEYS:
        if key not in request:
            raise ValueError(f"player_send_turn request missing {key!r}")

    runner = Path(runner_path) if runner_path is not None else _default_runner()
    if not runner.exists():
        raise RuntimeError(f"player runner not found: {runner}")

    cmd = _runner_cmd(runner)
    payload = json.dumps(request, ensure_ascii=False)
    try:
        proc = subprocess.run(
            cmd,
            input=payload,
            capture_output=True,
            text=True,
            timeout=timeout_s,
            cwd=str(_player_dir()),
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"player runner timed out after {timeout_s}s") from exc
    except FileNotFoundError as exc:
        raise RuntimeError(f"failed to start player runner: {cmd[0]}") from exc

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
        raise RuntimeError(f"player runner failed: {detail}")

    if not stdout:
        raise RuntimeError("player runner produced empty stdout")

    try:
        raw = json.loads(stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"player runner stdout is not JSON: {stdout[:200]!r}") from exc

    return parse_runner_response(raw)
