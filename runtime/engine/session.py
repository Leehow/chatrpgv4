"""In-process session store for the COC runtime SDK (V1)."""
from __future__ import annotations

import importlib.util
import uuid
from pathlib import Path
from typing import Any


_SESSIONS: dict[str, dict[str, Any]] = {}


def _load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def _engine_dir() -> Path:
    return Path(__file__).resolve().parent


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _load_config():
    return _load_module("runtime_config", _engine_dir() / "config.py")


def _load_public_state():
    return _load_module("runtime_public_state", _engine_dir() / "public_state.py")


def _load_debug_adapter():
    path = _repo_root() / "runtime" / "adapters" / "debug" / "adapter.py"
    return _load_module("runtime_debug_adapter", path)


def _load_pi_adapter():
    path = _repo_root() / "runtime" / "adapters" / "pi" / "adapter.py"
    return _load_module("runtime_pi_adapter", path)


def create_session(
    workspace: Path | str,
    *,
    campaign_id: str,
    investigator_id: str,
    character_path: Path | str | None = None,
) -> str:
    root = Path(workspace)
    cfg = _load_config().load_runtime_config(root)
    brain = cfg["brain"]

    if character_path is None:
        resolved_character = root / ".coc" / "investigators" / investigator_id / "character.json"
    else:
        resolved_character = Path(character_path)

    session_id = f"sess_{uuid.uuid4().hex[:16]}"
    _SESSIONS[session_id] = {
        "session_id": session_id,
        "workspace": root,
        "campaign_id": campaign_id,
        "investigator_id": investigator_id,
        "character_path": resolved_character,
        "brain_at_create": brain,
    }
    return session_id


def get_session(session_id: str) -> dict[str, Any]:
    try:
        return _SESSIONS[session_id]
    except KeyError as exc:
        raise KeyError(f"unknown or closed session: {session_id!r}") from exc


def send(
    session_id: str,
    player_input: str,
    *,
    subsystem_request: dict[str, Any] | None = None,
    pending_choice_response: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    record = get_session(session_id)
    brain = record["brain_at_create"]
    workspace = record["workspace"]
    campaign_id = record["campaign_id"]
    campaign_dir = workspace / ".coc" / "campaigns" / campaign_id
    character_path = record["character_path"]
    investigator_id = record["investigator_id"]
    forwarded_pending_response: dict[str, Any] | None = None
    if pending_choice_response is not None:
        if subsystem_request is not None:
            raise ValueError("submit either subsystem_request or pending_choice_response")
        state = _load_public_state().build_public_state(
            workspace, campaign_id, investigator_id
        )
        pending = state.get("pending_choice")
        if (
            not isinstance(pending, dict)
            or not isinstance(pending_choice_response, dict)
            or pending_choice_response.get("choice_id") != pending.get("choice_id")
            or pending_choice_response.get("responder") != "player"
            or pending_choice_response.get("revision") != pending.get("revision")
            or pending_choice_response.get("action") not in {
                option.get("action") for option in pending.get("options", [])
                if isinstance(option, dict)
            }
        ):
            raise ValueError("pending_choice_response does not match canonical player choice")
        if pending.get("kind") == "combat_defense":
            subsystem_request = {
                "kind": "combat_defend",
                "payload": {
                    "decision_id": f"runtime-defense-{pending['attack_id']}-{pending['revision']}",
                    "revision": pending["revision"], "actor_id": investigator_id,
                    "attack_command_id": pending["attack_id"],
                    "defense_kind": pending_choice_response["action"],
                },
            }
        else:
            forwarded_pending_response = dict(pending_choice_response)

    if brain == "debug":
        return _load_debug_adapter().debug_send_turn(
            workspace,
            campaign_dir,
            character_path,
            investigator_id,
            player_input,
            subsystem_request=subsystem_request,
            pending_choice_response=forwarded_pending_response,
        )
    if brain == "pi":
        if subsystem_request is not None:
            raise ValueError(
                "typed subsystem_request is not supported by the pi brain"
            )
        if forwarded_pending_response is not None:
            raise ValueError(
                "typed pending_choice_response is not supported by the pi brain"
            )
        return _load_pi_adapter().pi_send_turn(
            {
                "workspace": str(workspace),
                "campaign_id": campaign_id,
                "investigator_id": investigator_id,
                "character_path": str(character_path),
                "player_text": player_input,
            }
        )
    raise ValueError(f"unsupported brain: {brain!r}")


def get_state(session_id: str) -> dict[str, Any]:
    record = get_session(session_id)
    state = _load_public_state().build_public_state(
        record["workspace"],
        record["campaign_id"],
        record["investigator_id"],
    )
    # Brain is bound at create_session; open sessions ignore later runtime.json edits.
    state["brain"] = record["brain_at_create"]
    return state


def close_session(session_id: str) -> None:
    _SESSIONS.pop(session_id, None)
