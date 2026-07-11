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


def _load_paths():
    return _load_module("runtime_paths", _engine_dir() / "paths.py")


def _load_public_state():
    return _load_module("runtime_public_state", _engine_dir() / "public_state.py")


def _load_debug_adapter():
    path = _repo_root() / "runtime" / "adapters" / "debug" / "adapter.py"
    return _load_module("runtime_debug_adapter", path)


def _load_pi_adapter():
    path = _repo_root() / "runtime" / "adapters" / "pi" / "adapter.py"
    return _load_module("runtime_pi_adapter", path)


def _validated_session_record(session_id: str, record: dict[str, Any]) -> dict[str, Any]:
    """Rebuild all paths from canonical record fields for every access."""
    paths = _load_paths()
    paths.validate_id(session_id, "session_id")
    root = paths.workspace_root(record["workspace"])
    campaign_id = paths.validate_id(record["campaign_id"], "campaign_id")
    investigator_id = paths.validate_id(record["investigator_id"], "investigator_id")
    campaign_dir = paths.campaign_dir(root, campaign_id)
    coc = paths.coc_root(root)
    character_relpath = record.get("character_relpath")
    if not isinstance(character_relpath, str) or Path(character_relpath).is_absolute():
        raise ValueError("invalid character_path")
    character_path = paths.contained_path(coc, root / character_relpath)
    if character_path.relative_to(root).as_posix() != character_relpath:
        raise ValueError("invalid character_path")
    # A campaign directory can be exchanged for a symlink after session
    # creation.  Validate each state path before adapters see a raw path.
    state_paths = paths.campaign_save_paths(campaign_dir, investigator_id)
    return {
        "session_id": session_id,
        "workspace": root,
        "campaign_id": campaign_id,
        "investigator_id": investigator_id,
        "character_relpath": character_relpath,
        "character_path": character_path,
        "campaign_dir": campaign_dir,
        "state_paths": state_paths,
        "brain_at_create": record["brain_at_create"],
    }


def create_session(
    workspace: Path | str,
    *,
    campaign_id: str,
    investigator_id: str,
    character_path: Path | str | None = None,
) -> str:
    paths = _load_paths()
    root = paths.workspace_root(workspace)
    campaign_id = paths.validate_id(campaign_id, "campaign_id")
    investigator_id = paths.validate_id(investigator_id, "investigator_id")
    coc = paths.coc_root(root)
    campaign_dir = paths.campaign_dir(root, campaign_id)
    if character_path is None:
        resolved_character = paths.investigator_character_path(root, investigator_id)
    else:
        resolved_character = paths.contained_path(
            coc,
            Path(character_path) if Path(character_path).is_absolute() else root / Path(character_path),
        )
    character_relpath = paths.canonical_workspace_relative_path(
        root,
        resolved_character,
        field="character_path",
        allowed_root=coc,
    )
    # Validate all derived paths before allocating an ID or touching the
    # registry.  This also detects a save/state symlink outside the campaign.
    paths.campaign_save_paths(campaign_dir, investigator_id)
    cfg = _load_config().load_runtime_config(root)
    brain = cfg["brain"]

    session_id = f"sess_{uuid.uuid4().hex[:16]}"
    _SESSIONS[session_id] = {
        "session_id": session_id,
        "workspace": root,
        "campaign_id": campaign_id,
        "investigator_id": investigator_id,
        "character_relpath": character_relpath,
        "brain_at_create": brain,
    }
    return session_id


def get_session(session_id: str) -> dict[str, Any]:
    _load_paths().validate_id(session_id, "session_id")
    try:
        return _validated_session_record(session_id, _SESSIONS[session_id])
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
    campaign_dir = record["campaign_dir"]
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
    _load_paths().validate_id(session_id, "session_id")
    _SESSIONS.pop(session_id, None)
