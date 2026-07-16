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
TelemetryPersistenceError = _session.TelemetryPersistenceError


def setup_workspace(
    workspace: Path | str,
    operation: dict[str, Any],
) -> dict[str, Any]:
    """Inspect or mutate canonical COC onboarding state before a session."""
    root = _load_paths_module().workspace_root(workspace)
    return _session.setup_workspace_operation(root, operation)


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
    player_intent: dict[str, Any] | None = None,
    rng_seed: int | str | None = None,
) -> list[dict[str, Any]]:
    """Run one full keeper-agent turn for this player input.

    Raises:
        UnknownSessionError: with stable ``kind == "unknown_session"`` when
            the session does not exist, was closed, or expired.
    """
    _load_paths_module().validate_id(session_id, "session_id")
    return _session.send(
        session_id, player_input, player_intent=player_intent,
        rng_seed=rng_seed,
    )


def interact(
    session_id: str,
    player_input: str,
    *,
    semantic_route: dict[str, Any] | None = None,
    rng_seed: int | str | None = None,
) -> dict[str, Any]:
    """Natural-language entry with semantic turn/operation dispatch."""
    _load_paths_module().validate_id(session_id, "session_id")
    return _session.interact(
        session_id,
        player_input,
        semantic_route=semantic_route,
        rng_seed=rng_seed,
    )


def operate(
    session_id: str,
    operation: dict[str, Any],
    *,
    rng_seed: int | str | None = None,
) -> dict[str, Any]:
    """Run a canonical typed non-turn operation through the shared plugin core."""
    _load_paths_module().validate_id(session_id, "session_id")
    return _session.operate(session_id, operation, rng_seed=rng_seed)


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


def get_last_turn_attestation(session_id: str) -> dict[str, Any]:
    """Return the durable player-safe receipt digest for the latest turn."""
    _load_paths_module().validate_id(session_id, "session_id")
    return _session.get_last_turn_attestation(session_id)


def snapshot_workspace_sessions(workspace: Path | str) -> Path:
    """Persist sanitized recoverable session metadata for one workspace."""
    paths = _load_paths_module()
    root = paths.workspace_root(workspace)
    return _session.snapshot_workspace_sessions(root)


def restore_workspace_sessions(workspace: Path | str) -> list[str]:
    """Restore sanitized session metadata from one workspace generation."""
    paths = _load_paths_module()
    root = paths.workspace_root(workspace)
    return _session.restore_workspace_sessions(root)
