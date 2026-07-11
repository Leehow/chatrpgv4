from __future__ import annotations

import importlib.util
from pathlib import Path
from typing import Any


def _load_config_module():
    path = Path(__file__).resolve().parent / "config.py"
    spec = importlib.util.spec_from_file_location("runtime_config", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def _load_subsystem_executor():
    path = Path(__file__).resolve().parents[2] / "plugins" / "coc-keeper" / "scripts" / "coc_subsystem_executor.py"
    spec = importlib.util.spec_from_file_location("runtime_subsystem_executor", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def _load_state_gateway():
    path = Path(__file__).resolve().parent / "state_gateway.py"
    spec = importlib.util.spec_from_file_location("runtime_state_gateway", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def _load_paths():
    path = Path(__file__).resolve().parent / "paths.py"
    spec = importlib.util.spec_from_file_location("runtime_paths_public_state", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def _canonical_player_pending_choice(campaign_dir: Path) -> tuple[bool, dict[str, Any] | None]:
    # The caller has already validated the campaign tree; re-resolve the exact
    # consumed file immediately before handing the campaign to the projector.
    path_mod = _load_paths()
    save = path_mod.contained_path(campaign_dir, campaign_dir / "save")
    path = path_mod.contained_path(save, save / "subsystem-state.json")
    if not path.exists():
        return False, None
    try:
        choice = _load_subsystem_executor().project_player_pending_choice(campaign_dir)
    except (OSError, UnicodeError, ValueError, RuntimeError):
        return True, None
    return True, choice


def _combat_defense_choice(
    campaign_dir: Path,
    investigator_id: str | None,
) -> dict[str, Any] | None:
    if not investigator_id:
        return None
    path_mod = _load_paths()
    save = path_mod.contained_path(campaign_dir, campaign_dir / "save")
    path = path_mod.contained_path(save, save / "combat.json")
    if not path.exists():
        return None
    try:
        return _load_subsystem_executor().project_player_combat_defense(
            campaign_dir, investigator_id
        )
    except (OSError, UnicodeError, ValueError, RuntimeError):
        return None


def _nullable_string(value: Any, gateway: Any, state: str) -> str | None:
    if value is None or isinstance(value, str):
        return value
    gateway.record_invalid_fields(state)
    return None


def build_public_state(
    workspace: Path | str,
    campaign_id: str,
    investigator_id: str | None = None,
) -> dict[str, Any]:
    gateway = _load_state_gateway().RuntimeStateGateway(
        workspace, campaign_id, investigator_id
    )
    gateway.validate_consumed_paths()
    snapshot = gateway.load()
    campaign_dir = gateway.campaign_dir
    meta = snapshot["campaign"]
    world = snapshot["world"]
    pacing = snapshot["pacing"]
    investigators = snapshot["investigators"]
    if investigator_id is None and len(investigators) == 1:
        investigator_id = investigators[0]["id"]

    raw_clue_ids = world.get("discovered_clue_ids")
    if raw_clue_ids is None:
        clue_ids: list[str] = []
    elif isinstance(raw_clue_ids, list):
        clue_ids = [clue_id for clue_id in raw_clue_ids if isinstance(clue_id, str)]
        if len(clue_ids) != len(raw_clue_ids):
            gateway.record_invalid_fields("world")
    else:
        gateway.record_invalid_fields("world")
        clue_ids = []

    raw_turn_number = pacing.get("turn_number", 0)
    if isinstance(raw_turn_number, int) and not isinstance(raw_turn_number, bool):
        turn_number = raw_turn_number
    else:
        if raw_turn_number != 0:
            gateway.record_invalid_fields("pacing")
        turn_number = 0

    blocking_aux = {
        issue["state"] for issue in gateway.health()["issues"]
        if issue["code"] in {
            "corrupt", "invalid_utf8", "invalid_json", "non_object",
            "forward_version", "invalid_schema",
        }
    }
    if "subsystem" in blocking_aux:
        _has_canonical_pending_state, pending = True, None
    else:
        _has_canonical_pending_state, pending = _canonical_player_pending_choice(campaign_dir)
    if (pending is None and "subsystem" not in blocking_aux
            and "combat" not in blocking_aux):
        pending = _combat_defense_choice(campaign_dir, investigator_id)

    cfg = _load_config_module().load_runtime_config(gateway.workspace)

    return {
        "schema_version": 1,
        "campaign_id": gateway.campaign_id,
        "play_language": _nullable_string(meta.get("play_language"), gateway, "campaign"),
        "active_scene_id": _nullable_string(world.get("active_scene_id"), gateway, "world"),
        "tension_level": _nullable_string(pacing.get("tension_level"), gateway, "pacing"),
        "turn_number": turn_number,
        "discovered_clue_ids": list(clue_ids),
        "investigators": investigators,
        "brain": cfg["brain"],
        "pending_choice": pending,
        "state_health": gateway.health(),
    }
