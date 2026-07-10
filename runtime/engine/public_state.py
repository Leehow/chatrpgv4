from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from typing import Any


_PUBLIC_PENDING_CHOICE_KEYS = {
    "choice_id",
    "kind",
    "command_id",
    "responder",
    "revision",
    "prompt",
    "options",
}


def _load_config_module():
    path = Path(__file__).resolve().parent / "config.py"
    spec = importlib.util.spec_from_file_location("runtime_config", path)
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


def _canonical_player_pending_choice(save: Path) -> tuple[bool, dict[str, Any] | None]:
    path = save / "subsystem-state.json"
    if not path.exists():
        return False, None
    state = _read_json(path, {})
    choices = state.get("pending_choices") if isinstance(state, dict) else None
    if not isinstance(choices, dict) or len(choices) != 1:
        return True, None
    choice_id, choice = next(iter(choices.items()))
    if (
        not isinstance(choice, dict)
        or set(choice) != _PUBLIC_PENDING_CHOICE_KEYS
        or choice.get("choice_id") != choice_id
        or choice.get("responder") != "player"
        or not isinstance(choice.get("kind"), str)
        or not isinstance(choice.get("command_id"), str)
        or isinstance(choice.get("revision"), bool)
        or not isinstance(choice.get("revision"), int)
        or not isinstance(choice.get("prompt"), str)
        or not isinstance(choice.get("options"), list)
    ):
        return True, None
    return True, json.loads(json.dumps(choice))


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

    has_canonical_pending_state, pending = _canonical_player_pending_choice(save)
    if not has_canonical_pending_state:
        if isinstance(world, dict) and "pending_choice" in world:
            pending = world.get("pending_choice")
        elif isinstance(meta, dict) and "pending_choice" in meta:
            pending = meta.get("pending_choice")

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
