"""Public Python SDK for the COC open runtime (V1 in-process)."""
from __future__ import annotations

import importlib.util
from pathlib import Path
from typing import Any


def _load_session_module():
    path = Path(__file__).resolve().parents[1] / "engine" / "session.py"
    spec = importlib.util.spec_from_file_location("runtime_session", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


_session = _load_session_module()


def create_session(
    workspace: Path | str,
    *,
    campaign_id: str,
    investigator_id: str,
    character_path: Path | str | None = None,
) -> str:
    """Start a session; brain is bound from `.coc/runtime.json` at create time."""
    return _session.create_session(
        workspace,
        campaign_id=campaign_id,
        investigator_id=investigator_id,
        character_path=character_path,
    )


def send(session_id: str, player_input: str) -> list[dict[str, Any]]:
    """Run one player turn; returns Event dicts."""
    return _session.send(session_id, player_input)


def get_state(session_id: str) -> dict[str, Any]:
    """Return player-safe PublicState for the session's campaign."""
    return _session.get_state(session_id)


def close_session(session_id: str) -> None:
    """End the session. Further send/get_state raise."""
    _session.close_session(session_id)
