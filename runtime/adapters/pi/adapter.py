"""Narrator Bridge (frozen): a bounded narrator, never a rules proxy or Pi Package."""
from __future__ import annotations

import importlib.util
from pathlib import Path
from typing import Any


def _pi_dir() -> Path:
    return Path(__file__).resolve().parent


def _default_runner() -> Path:
    return _pi_dir() / "run_turn.mjs"


def _load_narrator_adapter():
    path = Path(__file__).resolve().parents[1] / "narrator" / "adapter.py"
    spec = importlib.util.spec_from_file_location("runtime_pi_narrator_adapter", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def pi_narrate(
    request: dict[str, Any],
    *,
    runner_path: Path | str | None = None,
    timeout_s: float = 300,
    worker_pool: Any | None = None,
    worker_key: Any | None = None,
) -> dict[str, Any]:
    """Render only a sanitized narrator envelope after deterministic rules.

    The implementation delegates to the narrator adapter's own request
    sanitizer, so no caller can route workspace paths, player input logs, or
    Keeper rationale through this compatibility module.
    """
    runner = Path(runner_path).resolve() if runner_path is not None else _default_runner()
    return _load_narrator_adapter().narrator_send_turn(
        request,
        runner_path=runner,
        timeout_s=timeout_s,
        worker_pool=worker_pool,
        worker_key=worker_key,
    )


def pi_send_turn(*_args: Any, **_kwargs: Any) -> list[dict[str, Any]]:
    """Fail closed rather than revive the removed LLM-to-debug proxy."""
    raise RuntimeError(
        "pi_send_turn was removed: runtime Pi is narrator-only; run deterministic "
        "planner/rules first and call pi_narrate with a safe narration envelope"
    )


__all__ = ["pi_narrate", "pi_send_turn"]
