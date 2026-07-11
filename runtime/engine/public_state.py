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


def _load_subsystem_executor():
    path = Path(__file__).resolve().parents[2] / "plugins" / "coc-keeper" / "scripts" / "coc_subsystem_executor.py"
    spec = importlib.util.spec_from_file_location("runtime_subsystem_executor", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def _read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default
    return raw if isinstance(raw, type(default)) or (default is None and isinstance(raw, dict)) else default


def _investigator_entry(path: Path) -> dict[str, Any]:
    data = _read_json(path, {})
    if not isinstance(data, dict):
        data = {}
    inv_id = data.get("investigator_id") or path.stem
    conditions = data.get("conditions") or []
    if not isinstance(conditions, list):
        conditions = []
    return {
        "id": str(inv_id),
        "current_hp": data.get("current_hp"),
        "current_san": data.get("current_san"),
        "current_mp": data.get("current_mp"),
        "conditions": list(conditions),
    }


def _canonical_player_pending_choice(campaign_dir: Path) -> tuple[bool, dict[str, Any] | None]:
    save = campaign_dir / "save"
    path = save / "subsystem-state.json"
    if not path.exists():
        return False, None
    try:
        choice = _load_subsystem_executor().project_player_pending_choice(campaign_dir)
    except (OSError, UnicodeError, ValueError, RuntimeError):
        return True, None
    return True, choice


def _combat_defense_choice(campaign_dir: Path) -> dict[str, Any] | None:
    path = campaign_dir / "save" / "combat.json"
    if not path.exists():
        return None
    try:
        return _load_subsystem_executor().project_player_combat_defense(campaign_dir)
    except (OSError, UnicodeError, ValueError, RuntimeError):
        return None


def build_public_state(workspace: Path | str, campaign_id: str) -> dict[str, Any]:
    root = Path(workspace)
    campaign_dir = root / ".coc" / "campaigns" / campaign_id
    save = campaign_dir / "save"

    meta = _read_json(campaign_dir / "campaign.json", {})
    world = _read_json(save / "world-state.json", {})
    pacing = _read_json(save / "pacing-state.json", {})

    inv_dir = save / "investigator-state"
    investigators: list[dict[str, Any]] = []
    if inv_dir.is_dir():
        for path in sorted(inv_dir.glob("*.json")):
            investigators.append(_investigator_entry(path))

    clue_ids = world.get("discovered_clue_ids") if isinstance(world, dict) else None
    if not isinstance(clue_ids, list):
        clue_ids = []

    turn_number = pacing.get("turn_number", 0) if isinstance(pacing, dict) else 0
    try:
        turn_number = int(turn_number)
    except (TypeError, ValueError):
        turn_number = 0

    has_canonical_pending_state, pending = _canonical_player_pending_choice(campaign_dir)
    if not has_canonical_pending_state:
        if isinstance(world, dict) and "pending_choice" in world:
            pending = world.get("pending_choice")
        elif isinstance(meta, dict) and "pending_choice" in meta:
            pending = meta.get("pending_choice")
    if pending is None:
        pending = _combat_defense_choice(campaign_dir)

    cfg = _load_config_module().load_runtime_config(root)

    return {
        "schema_version": 1,
        "campaign_id": campaign_id,
        "play_language": meta.get("play_language") if isinstance(meta, dict) else None,
        "active_scene_id": world.get("active_scene_id") if isinstance(world, dict) else None,
        "tension_level": pacing.get("tension_level") if isinstance(pacing, dict) else None,
        "turn_number": turn_number,
        "discovered_clue_ids": list(clue_ids),
        "investigators": investigators,
        "brain": cfg["brain"],
        "pending_choice": pending,
    }
