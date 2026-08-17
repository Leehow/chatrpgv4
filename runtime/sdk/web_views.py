"""Read-only view projections for non-Python web hosts.

These helpers serve the Node web server (``web/server-node/``) through
``runtime/sdk/rpc_server.py``. They exist only where a projection needs
canonical Python plugin functions (``coc_language`` / ``coc_starter`` /
``coc_module_registry`` / engine internals); pure JSON-file formatting lives
on the Node side. All game semantics stay in the canonical runtime SDK and
keeper runner — nothing here adds rules, state, or narration behavior.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from typing import Any

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))


def _load_engine_module(name: str, workspace: Path):
    path = _REPO_ROOT / "runtime" / "engine" / f"{name}.py"
    spec = importlib.util.spec_from_file_location(f"runtime_{name}_webview", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def _load_plugin_locator(workspace: Path):
    return _load_engine_module("plugin_locator", workspace)


def _load_plugin_module(workspace: Path, name: str):
    """Import a canonical plugin script (coc_*) exactly as the toolbox does."""
    scripts = _load_plugin_locator(workspace).plugin_scripts_dir(workspace)
    if str(scripts) not in sys.path:
        sys.path.insert(0, str(scripts))
    return __import__(name)


def _coc_root(workspace: Path) -> Path:
    return workspace / ".coc"


def _campaign_dir(workspace: Path, campaign_id: str) -> Path:
    return _coc_root(workspace) / "campaigns" / campaign_id


def campaign_compat(workspace: Path | str, campaign_id: str) -> dict[str, Any]:
    """Clean-slate compatibility: exact current campaign schema plus binding."""
    workspace = Path(workspace)
    path = _campaign_dir(workspace, campaign_id) / "campaign.json"
    if not path.is_file():
        return {"exists": False, "compatible": False}
    try:
        raw = json.loads(path.read_text("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return {"exists": True, "compatible": False}
    if not isinstance(raw, dict):
        return {"exists": True, "compatible": False}
    schema = raw.get("schema_version")
    current = _load_plugin_locator(workspace).CURRENT_CAMPAIGN_SCHEMA_VERSION
    compatible = (
        schema == current
        and isinstance(raw.get("ruleset_id"), str)
        and bool(raw.get("ruleset_id"))
    )
    return {"exists": True, "schema_version": schema, "compatible": compatible}


def _display_character(
    workspace: Path,
    character: dict[str, Any],
    play_language: str,
    inventory: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Project one character sheet into player-facing display labels.

    Labels come only from canonical sources: the sheet's own
    ``player_facing_sheet_<lang>`` layer (built by ``coc_starter`` for shipped
    pregens), otherwise the plugin's ``coc_language`` table vocabulary. When
    neither covers a term, the canonical English key is kept, exactly like the
    keeper's own renderers.

    When ``inventory`` (normalized campaign-local runtime inventory) is
    given, weapons and items reflect live play: granted gear/weapons appear,
    recorded losses drop out, and ``inventory_items`` carries the structured
    parameters (quantity/consumable/note) the sidebar renders and acts on.
    """
    coc_language = _load_plugin_module(workspace, "coc_language")
    suffix = {"zh-Hans": "zh", "zh": "zh"}.get(play_language)
    sheet: dict[str, Any] | None = None
    if suffix:
        candidate = character.get(f"player_facing_sheet_{suffix}")
        # Always run ensure for known starter pregens: older sheets may already
        # carry a pf layer that is missing equipment (or other display fields).
        try:
            coc_starter = _load_plugin_module(workspace, "coc_starter")
            ensured = coc_starter.ensure_pregen_player_facing_sheet(character)
            ensured_sheet = ensured.get(f"player_facing_sheet_{suffix}")
            if isinstance(ensured_sheet, dict):
                candidate = ensured_sheet
        except Exception:  # noqa: BLE001 - display layer is best-effort
            pass
        if isinstance(candidate, dict):
            sheet = candidate
    terms = coc_language.default_localized_terms(play_language)

    raw_chars = character.get("characteristics")
    raw_chars = raw_chars if isinstance(raw_chars, dict) else {}
    pf_chars: dict[str, str] = {}
    if sheet and isinstance(sheet.get("characteristics"), dict):
        for label, entry in sheet["characteristics"].items():
            if isinstance(entry, dict) and entry.get("key"):
                pf_chars[str(entry["key"])] = str(label)
    characteristics = [
        {
            "key": str(key),
            "label": pf_chars.get(str(key)) or terms.get(str(key)) or str(key),
            "value": value,
        }
        for key, value in raw_chars.items()
    ]

    raw_skills = character.get("skills")
    raw_skills = raw_skills if isinstance(raw_skills, dict) else {}
    pf_skills: dict[str, str] = {}
    if sheet and isinstance(sheet.get("skills"), list):
        for entry in sheet["skills"]:
            if isinstance(entry, dict) and entry.get("key"):
                pf_skills[str(entry["key"])] = str(entry.get("label") or entry["key"])
    skills = [
        {
            "key": str(key),
            "label": pf_skills.get(str(key))
            or coc_language.player_facing_skill_label(
                str(key), play_language, terms=terms
            ),
            "value": value,
        }
        for key, value in raw_skills.items()
    ]

    pf_weapons = sheet.get("weapons") if sheet else None
    sheet_weapon_rows = [
        row for row in (character.get("weapons") or []) if isinstance(row, dict)
    ]
    if inventory is not None:
        coc_inventory = _load_plugin_module(workspace, "coc_inventory")
        weapon_rows = coc_inventory.effective_weapons(sheet_weapon_rows, inventory)
    else:
        coc_inventory = None
        weapon_rows = sheet_weapon_rows
    # Player-facing weapon labels index into the sheet's own weapon list; map
    # them by weapon_id so runtime merges (grants/losses) keep their labels.
    pf_weapon_by_id: dict[str, dict[str, Any]] = {}
    if isinstance(pf_weapons, list):
        for index, row in enumerate(sheet_weapon_rows):
            if index >= len(pf_weapons) or not isinstance(pf_weapons[index], dict):
                continue
            wid = row.get("weapon_id")
            if isinstance(wid, str) and wid:
                pf_weapon_by_id[wid] = pf_weapons[index]
    # Runtime-granted weapon specs carry no display label of their own; the
    # granting entry's label (play-language, chosen by the KP) is the label.
    entry_weapon_labels: dict[str, str] = {}
    if inventory is not None and coc_inventory is not None:
        for entry in inventory.get("entries") or []:
            if not isinstance(entry, dict) or entry.get("kind") != "weapon":
                continue
            wid = coc_inventory.weapon_ref_id(entry.get("weapon"))
            label = entry.get("label")
            if wid and isinstance(label, str) and label.strip():
                entry_weapon_labels[wid] = label.strip()
    weapons: list[dict[str, Any]] = []
    for weapon in weapon_rows:
        if not isinstance(weapon, dict):
            continue
        weapon_id = str(weapon.get("weapon_id") or "")
        pf_weapon = pf_weapon_by_id.get(weapon_id, {})
        skill = pf_weapon.get("skill_label")
        if not skill and weapon.get("skill"):
            skill = coc_language.player_facing_skill_label(
                str(weapon["skill"]), play_language, terms=terms
            )
        weapons.append(
            {
                "label": pf_weapon.get("label")
                or entry_weapon_labels.get(weapon_id)
                or weapon.get("label")
                or weapon.get("name")
                or weapon.get("weapon_id"),
                "skill_label": skill,
                "damage": weapon.get("damage"),
                "range": weapon.get("range"),
                "ammo": pf_weapon.get("ammo_capacity", weapon.get("ammo")),
            }
        )

    raw_derived = character.get("derived")

    def _equipment_labels(source: Any) -> list[str]:
        if not isinstance(source, list):
            return []
        labels: list[str] = []
        for item in source:
            if isinstance(item, str) and item.strip():
                labels.append(item.strip())
            elif isinstance(item, dict):
                label = item.get("label") or item.get("name")
                if isinstance(label, str) and label.strip():
                    labels.append(label.strip())
        return labels

    # Prefer the player-facing equipment layer (Chinese for zh-Hans play);
    # fall back to machine-sheet strings when no localized list exists.
    equipment = _equipment_labels((sheet or {}).get("equipment"))
    if not equipment:
        equipment = _equipment_labels(character.get("equipment"))

    inventory_items: list[dict[str, Any]] | None = None
    if inventory is not None and coc_inventory is not None:
        sheet_rows = character.get("equipment") or []
        pf_equipment = (sheet or {}).get("equipment")
        # Localized labels for sheet-derived gear, keyed by the deterministic
        # sheet item id so runtime merges keep the player-facing wording.
        pf_item_labels: dict[str, str] = {}
        for index, row in enumerate(sheet_rows):
            row_id = coc_inventory.sheet_equipment_item_id(row)
            if row_id is None:
                continue
            if isinstance(pf_equipment, list) and index < len(pf_equipment):
                labels = _equipment_labels([pf_equipment[index]])
                if labels:
                    pf_item_labels[row_id] = labels[0]
        sheet_item_ids = {
            row_id
            for row in sheet_rows
            if (row_id := coc_inventory.sheet_equipment_item_id(row)) is not None
        }
        inventory_items = []
        for entry in coc_inventory.effective_items(sheet_rows, inventory):
            item_id = str(entry.get("item_id") or "")
            if not item_id:
                continue
            item: dict[str, Any] = {
                "item_id": item_id,
                "label": pf_item_labels.get(item_id)
                or str(entry.get("label") or item_id),
                "kind": entry.get("kind") if entry.get("kind") in ("gear", "weapon") else "gear",
                "source": "sheet" if item_id in sheet_item_ids else "campaign",
            }
            if entry.get("consumable") is not None:
                item["consumable"] = entry["consumable"]
            if entry.get("quantity") is not None:
                item["quantity"] = entry["quantity"]
            if entry.get("note"):
                item["note"] = entry["note"]
            inventory_items.append(item)
        # The legacy flat label list follows the live merge too (gear only,
        # exactly what the old sheet-only projection showed).
        equipment = [item["label"] for item in inventory_items if item["kind"] == "gear"]

    return {
        "name": (sheet or {}).get("display_name") or character.get("name"),
        "occupation": (sheet or {}).get("occupation") or character.get("occupation"),
        "era": (sheet or {}).get("era") or character.get("era"),
        "age": character.get("age"),
        "sex": character.get("sex"),
        "residence": character.get("residence"),
        "birthplace": character.get("birthplace"),
        "characteristics": characteristics,
        "derived": raw_derived if isinstance(raw_derived, dict) else {},
        "skills": skills,
        "weapons": weapons,
        "equipment": equipment,
        "inventory_items": inventory_items,
        "localized": sheet is not None,
    }


def display_character(
    workspace: Path | str,
    investigator_id: str,
    play_language: str,
    campaign_id: str | None = None,
) -> dict[str, Any] | None:
    """Read-only player-facing character for the side panel (None if absent).

    With ``campaign_id``, the projection merges the campaign-local runtime
    inventory (``save/investigator-state/<id>.json``), so items granted or
    spent during play show up immediately instead of only after development
    settlement rewrites the library sheet.
    """
    workspace = Path(workspace)
    sheet_path = (
        _coc_root(workspace) / "investigators" / investigator_id / "character.json"
    )
    try:
        raw = json.loads(sheet_path.read_text("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return None
    if not isinstance(raw, dict):
        return None
    character = dict(raw)
    inventory: dict[str, Any] | None = None
    if campaign_id:
        state_path = (
            _campaign_dir(workspace, campaign_id)
            / "save"
            / "investigator-state"
            / f"{investigator_id}.json"
        )
        try:
            inv_state = json.loads(state_path.read_text("utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            inv_state = None
        if isinstance(inv_state, dict):
            coc_inventory = _load_plugin_module(workspace, "coc_inventory")
            inventory = coc_inventory.normalize_inventory(inv_state)
    return _display_character(workspace, character, play_language, inventory=inventory)


def list_library_modules(workspace: Path | str) -> list[dict[str, Any]]:
    """List compiled modules under ``.coc/module-library/`` for reuse."""
    workspace = Path(workspace)
    try:
        reg = _load_plugin_module(workspace, "coc_module_registry")
    except Exception:  # noqa: BLE001
        return []
    try:
        summaries = reg.list_modules(workspace)
    except Exception:  # noqa: BLE001
        return []
    out: list[dict[str, Any]] = []
    for summary in summaries:
        if not isinstance(summary, dict):
            continue
        cid = str(summary.get("canonical_module_id") or "").strip()
        if not cid:
            continue
        title = cid
        chapter = summary.get("chapter")
        era = summary.get("era")
        rules_edition = summary.get("rules_edition")
        parent = summary.get("parent_module_id")
        identity_path = _coc_root(workspace) / "module-library" / cid / "identity.json"
        try:
            if identity_path.is_file():
                identity = json.loads(identity_path.read_text("utf-8"))
                if isinstance(identity, dict):
                    for key in ("canonical_title", "title"):
                        if isinstance(identity.get(key), str) and identity[key].strip():
                            title = identity[key].strip()
                            break
                    # Prefer Chinese alias when present.
                    aliases = identity.get("aliases")
                    if isinstance(aliases, list):
                        for alias in aliases:
                            if (
                                isinstance(alias, dict)
                                and alias.get("locale") in {"zh-Hans", "zh"}
                                and isinstance(alias.get("title"), str)
                                and alias["title"].strip()
                            ):
                                title = alias["title"].strip()
                                break
                    if identity.get("chapter") is not None:
                        chapter = identity.get("chapter")
                    if identity.get("rules_edition") is not None:
                        rules_edition = identity.get("rules_edition")
                    if identity.get("parent_module_id") is not None:
                        parent = identity.get("parent_module_id")
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            pass
        # Confirm compiled scenario exists on disk.
        scenario_dir = _coc_root(workspace) / "module-library" / cid / "scenario"
        if not scenario_dir.is_dir():
            continue
        out.append(
            {
                "canonical_module_id": cid,
                "title": title,
                "chapter": chapter,
                "era": era,
                "rules_edition": rules_edition,
                "parent_module_id": parent,
                "location_hint": f".coc/module-library/{cid}/",
            }
        )
    return out


def install_module(
    workspace: Path | str, module_id: str, campaign_id: str
) -> dict[str, Any]:
    """Install a compiled module-library entry into a fresh campaign."""
    workspace = Path(workspace)
    reg = _load_plugin_module(workspace, "coc_module_registry")
    return reg.install_to_campaign(workspace, module_id, campaign_id)


def project_campaign_state(
    workspace: Path | str,
    campaign_id: str,
    investigator_id: str | None = None,
) -> dict[str, Any]:
    """Player-safe public state from disk. No keeper session required."""
    workspace = Path(workspace)
    public_state = _load_engine_module("public_state", workspace)
    actor_id = investigator_id.strip() if isinstance(investigator_id, str) else None
    if actor_id == "":
        actor_id = None
    return public_state.build_public_state(workspace, campaign_id, actor_id)


def public_transcript_base(
    workspace: Path | str, campaign_id: str, limit: int = 10000
) -> list[dict[str, Any]]:
    """Engine public transcript fallback when table-transcript.jsonl is absent."""
    workspace = Path(workspace)
    session_mod = _load_engine_module("session", workspace)
    base = session_mod._recent_public_transcript(
        _campaign_dir(workspace, campaign_id), limit=limit
    )
    if isinstance(base, list):
        return [m for m in base if isinstance(m, dict)]
    return []
