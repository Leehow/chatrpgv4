from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from typing import Any


def _load_config_module():
    path = Path(__file__).resolve().parent / "config.py"
    spec = importlib.util.spec_from_file_location("runtime_config", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def _load_plugin_locator():
    path = Path(__file__).resolve().parent / "plugin_locator.py"
    spec = importlib.util.spec_from_file_location("runtime_plugin_locator_public_state", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def _load_plugin_script(name: str, filename: str, workspace: Path | str | None):
    path = _load_plugin_locator().plugin_scripts_dir(workspace) / filename
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def _load_subsystem_executor(workspace: Path | str | None = None):
    return _load_plugin_script(
        "runtime_subsystem_executor", "coc_subsystem_executor.py", workspace
    )


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


def _load_scene_graph(workspace: Path | str | None = None):
    return _load_plugin_script(
        "runtime_public_scene_graph", "coc_scene_graph.py", workspace
    )


def _load_scenario_validator(workspace: Path | str | None = None):
    return _load_plugin_script(
        "runtime_public_scenario_validator", "coc_scenario_compile.py", workspace
    )


def _terminal_evidence(
    campaign_dir: Path, world: dict[str, Any], workspace: Path | str | None = None
) -> tuple[dict[str, Any], bool]:
    """Project canonical structured ending facts without source/narration prose."""
    path_mod = _load_paths()
    scenario = path_mod.contained_path(campaign_dir, campaign_dir / "scenario")
    story_path = path_mod.contained_path(scenario, scenario / "story-graph.json")
    empty = {
        "reached_terminal": False,
        "active_scene_id": world.get("active_scene_id")
        if isinstance(world.get("active_scene_id"), str) else None,
        "graph_terminal": False,
        "session_ending": False,
    }
    if not story_path.exists():
        return empty, False
    story: dict[str, Any] = {}
    try:
        validation = _load_scenario_validator(workspace).validate_scenario(scenario)
    except (OSError, UnicodeError, json.JSONDecodeError, TypeError, ValueError):
        return empty, True
    if not isinstance(validation, dict) or validation.get("errors"):
        return empty, True
    if story_path.is_file():
        try:
            loaded = json.loads(story_path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                story = loaded
        except (OSError, UnicodeError, json.JSONDecodeError):
            return empty, True
    if not story:
        return empty, True

    logs = path_mod.contained_path(campaign_dir, campaign_dir / "logs")
    events_path = path_mod.contained_path(logs, logs / "events.jsonl")
    events: list[dict[str, Any]] = []
    if events_path.is_file():
        try:
            for line in events_path.read_text(encoding="utf-8").splitlines():
                if not line.strip():
                    continue
                row = json.loads(line)
                if not isinstance(row, dict):
                    return empty, True
                event_type = row.get("event_type") or row.get("type")
                if event_type == "session_ending":
                    payload = row.get("payload")
                    scene_id = world.get("active_scene_id")
                    if (
                        not isinstance(payload, dict)
                        or not isinstance(payload.get("scenario_id"), str)
                        or not payload["scenario_id"]
                        or not isinstance(payload.get("scene_id"), str)
                        or payload.get("scene_id") != scene_id
                        or row.get("scene_id") not in {None, scene_id}
                        or not isinstance(row.get("decision_id"), str)
                        or not row["decision_id"]
                    ):
                        return empty, True
                    events.append({"event_type": "session_ending"})
        except (OSError, UnicodeError, json.JSONDecodeError):
            return empty, True
    evidence = _load_scene_graph(workspace).terminal_evidence(story, world, events)
    return {
        "reached_terminal": evidence["reached_terminal"],
        "active_scene_id": evidence["active_scene_id"],
        "graph_terminal": evidence["graph_terminal"],
        "session_ending": evidence["session_ending"],
    }, False


def _canonical_player_pending_choice(
    campaign_dir: Path, workspace: Path | str | None = None
) -> tuple[bool, dict[str, Any] | None]:
    # The caller has already validated the campaign tree; re-resolve the exact
    # consumed file immediately before handing the campaign to the projector.
    path_mod = _load_paths()
    save = path_mod.contained_path(campaign_dir, campaign_dir / "save")
    path = path_mod.contained_path(save, save / "subsystem-state.json")
    if not path.exists():
        return False, None
    try:
        choice = _load_subsystem_executor(workspace).project_player_pending_choice(campaign_dir)
    except (OSError, UnicodeError, ValueError, RuntimeError):
        return True, None
    return True, choice


def _combat_defense_choice(
    campaign_dir: Path,
    investigator_id: str | None,
    workspace: Path | str | None = None,
) -> dict[str, Any] | None:
    if not investigator_id:
        return None
    path_mod = _load_paths()
    save = path_mod.contained_path(campaign_dir, campaign_dir / "save")
    path = path_mod.contained_path(save, save / "combat.json")
    if not path.exists():
        return None
    try:
        return _load_subsystem_executor(workspace).project_player_combat_defense(
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
        _has_canonical_pending_state, pending = _canonical_player_pending_choice(
            campaign_dir, gateway.workspace
        )
    if (pending is None and "subsystem" not in blocking_aux
            and "combat" not in blocking_aux):
        pending = _combat_defense_choice(campaign_dir, investigator_id, gateway.workspace)

    cfg = _load_config_module().load_runtime_config(gateway.workspace)

    terminal_evidence, invalid_terminal_evidence = _terminal_evidence(
        campaign_dir, world, gateway.workspace
    )
    if invalid_terminal_evidence:
        gateway.record_invalid_fields("terminal")

    active_scene_id = _nullable_string(world.get("active_scene_id"), gateway, "world")
    return {
        "schema_version": 1,
        "campaign_id": gateway.campaign_id,
        "play_language": _nullable_string(meta.get("play_language"), gateway, "campaign"),
        "active_scene_id": active_scene_id,
        "tension_level": _nullable_string(pacing.get("tension_level"), gateway, "pacing"),
        "turn_number": turn_number,
        "discovered_clue_ids": list(clue_ids),
        "investigators": investigators,
        # Compatibility display only.  Dispatch is determined by the frozen
        # session pipeline, never by this public projection.
        "brain": (
            "pi"
            if isinstance(cfg.get("narrator"), dict)
            and cfg["narrator"].get("kind") == "pi"
            else "debug"
        ),
        "pending_choice": pending,
        "terminal_evidence": terminal_evidence,
        "state_health": gateway.health(),
    }
