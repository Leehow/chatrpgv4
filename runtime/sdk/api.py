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


def _load_paths_module():
    path = Path(__file__).resolve().parents[1] / "engine" / "paths.py"
    spec = importlib.util.spec_from_file_location("runtime_sdk_paths", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


_session = _load_session_module()
UnknownSessionError = _session.UnknownSessionError


def create_session(
    workspace: Path | str,
    *,
    campaign_id: str,
    investigator_id: str,
    character_path: Path | str | None = None,
) -> str:
    """Start a session; brain is bound from `.coc/runtime.json` at create time."""
    paths = _load_paths_module()
    paths.workspace_root(workspace)
    paths.validate_id(campaign_id, "campaign_id")
    paths.validate_id(investigator_id, "investigator_id")
    return _session.create_session(
        workspace,
        campaign_id=campaign_id,
        investigator_id=investigator_id,
        character_path=character_path,
    )


def send(
    session_id: str,
    player_input: str,
    *,
    subsystem_request: dict[str, Any] | None = None,
    pending_choice_response: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """Run one player turn or an exact typed subsystem continuation.

    Raises:
        UnknownSessionError: with stable ``kind == "unknown_session"`` when
            the session does not exist, was closed, or expired.
    """
    _load_paths_module().validate_id(session_id, "session_id")
    return _session.send(
        session_id, player_input, subsystem_request=subsystem_request,
        pending_choice_response=pending_choice_response,
    )


def get_state(session_id: str) -> dict[str, Any]:
    """Return player-safe PublicState or ``UnknownSessionError``."""
    _load_paths_module().validate_id(session_id, "session_id")
    return _session.get_state(session_id)


def close_session(session_id: str) -> None:
    """End the session. Further send/get_state raise."""
    _load_paths_module().validate_id(session_id, "session_id")
    _session.close_session(session_id)


def get_telemetry_receipts(session_id: str) -> list[dict[str, Any]]:
    """Reload privacy-safe timing receipts recorded for this active session."""
    _load_paths_module().validate_id(session_id, "session_id")
    return _session.get_telemetry_receipts(session_id)
