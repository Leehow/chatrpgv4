"""Debug adapter: run_live_turn → Event stream."""
from __future__ import annotations

import importlib.util
from pathlib import Path
from typing import Any

_LIVE_RUNNER = None
_MAPPER = None


def _repo_root() -> Path:
    # runtime/adapters/debug/adapter.py → repo root is parents[3]
    return Path(__file__).resolve().parents[3]


def _load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _live_runner():
    global _LIVE_RUNNER
    if _LIVE_RUNNER is None:
        path = _repo_root() / "plugins" / "coc-keeper" / "scripts" / "coc_live_turn_runner.py"
        _LIVE_RUNNER = _load_module("coc_live_turn_runner", path)
    return _LIVE_RUNNER


def _mapper():
    global _MAPPER
    if _MAPPER is None:
        path = _repo_root() / "runtime" / "engine" / "live_turn_mapper.py"
        _MAPPER = _load_module("live_turn_mapper", path)
    return _MAPPER


def debug_send_turn(
    workspace: Path | str,
    campaign_dir: Path | str,
    character_path: Path | str,
    investigator_id: str,
    player_text: str,
    include_result: bool = False,
    **kwargs: Any,
) -> list[dict[str, Any]] | tuple[list[dict[str, Any]], dict[str, Any]]:
    """Run one live turn via coc-keeper and map the result to Events.

    ``workspace`` is accepted for API symmetry with the session layer; the
    live runner operates on ``campaign_dir`` / character paths directly.
    """
    _ = workspace  # reserved for future workspace-scoped config
    result = _live_runner().run_live_turn(
        campaign_dir,
        character_path,
        investigator_id,
        player_text,
        **kwargs,
    )
    events = _mapper().map_live_turn_result(result)
    return (events, result) if include_result else events
