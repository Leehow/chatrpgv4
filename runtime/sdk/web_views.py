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

from runtime.sdk.weapon_display import enrich_weapon_row, load_weapon_presets

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


def _campaign_module_weapon_profiles(
    workspace: Path, campaign_id: str
) -> dict[str, dict[str, Any]]:
    """Load validated source-authored weapon profiles for the active campaign."""
    path = _campaign_dir(workspace, campaign_id) / "scenario" / "module-meta.json"
    try:
        module_meta = json.loads(path.read_text("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return {}
    mechanics_root = (
        module_meta.get("module_mechanics") if isinstance(module_meta, dict) else None
    )
    items = mechanics_root.get("items") if isinstance(mechanics_root, dict) else None
    if not isinstance(items, dict):
        return {}
    try:
        coc_mechanics = _load_plugin_module(workspace, "coc_mechanics")
    except Exception:  # noqa: BLE001 - no validator means no trusted profiles
        return {}
    profiles: dict[str, dict[str, Any]] = {}
    for item in items.values():
        record = item.get("mechanics") if isinstance(item, dict) else None
        if not isinstance(record, dict) or record.get("status") != "authored":
            continue
        try:
            coc_mechanics.validate_mechanics_record(record, subject_kind="item")
        except Exception:  # noqa: BLE001 - malformed authored data fails closed
            continue
        profile = coc_mechanics.authored_profile(record)
        if not isinstance(profile, dict) or profile.get("profile_kind") != "weapon":
            continue
        weapon_id = str(profile.get("weapon_id") or "").strip()
        if weapon_id:
            profiles[weapon_id] = profile
    return profiles


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


# Fields copied from the campaign-local cash ledger (same shape as
# ``state.cash_query`` / ``coc_cash``). Never invent keys or parse prose.
_CASH_LEDGER_PUBLIC = (
    "decision_id",
    "op",
    "amount",
    "currency",
    "unit",
    "balance_before",
    "balance_after",
    "localized_reason",
    "game_time",
    "player_time",
)
_CASH_LEDGER_AUDIT = frozenset({"source", "reason", "tool", "recorded_at"})
_CASH_GAME_TIME_PUBLIC = ("elapsed_minutes", "display", "day_phase", "player_time")
_CASH_PLAYER_TIME_PUBLIC = ("phase", "appearance_mode", "display_label")
_CASH_LEDGER_RECENT = 12


def _empty_cash_view() -> dict[str, Any]:
    return {
        "schema_version": 2,
        "balances": {},
        "ledger": [],
    }


def _project_player_time(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    out: dict[str, Any] = {}
    for key in _CASH_PLAYER_TIME_PUBLIC:
        if key not in raw:
            continue
        value = raw[key]
        if value is None:
            out[key] = None
        elif isinstance(value, str):
            out[key] = value
    return out or None


def _project_game_time(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    out: dict[str, Any] = {}
    elapsed = raw.get("elapsed_minutes")
    if isinstance(elapsed, int) and not isinstance(elapsed, bool) and elapsed >= 0:
        out["elapsed_minutes"] = elapsed
    display = raw.get("display")
    if isinstance(display, str):
        out["display"] = display
    day_phase = raw.get("day_phase")
    if isinstance(day_phase, str) and day_phase:
        out["day_phase"] = day_phase
    player_time = _project_player_time(raw.get("player_time"))
    if player_time is not None:
        out["player_time"] = player_time
    return out or None


def _project_cash_ledger_row(row: Any) -> dict[str, Any] | None:
    if not isinstance(row, dict):
        return None
    op = row.get("op")
    if op not in {"grant", "spend"}:
        return None
    amount = row.get("amount")
    if not isinstance(amount, str) or not amount:
        return None
    out: dict[str, Any] = {"op": op, "amount": amount}
    for key in _CASH_LEDGER_PUBLIC:
        if key in {"op", "amount", "game_time", "player_time"}:
            continue
        if key not in row:
            continue
        value = row[key]
        if isinstance(value, str) and value:
            out[key] = value
    game_time = _project_game_time(row.get("game_time"))
    if game_time is not None:
        out["game_time"] = game_time
    player_time = _project_player_time(row.get("player_time"))
    if player_time is None and game_time is not None:
        player_time = game_time.get("player_time") if isinstance(
            game_time.get("player_time"), dict
        ) else None
    if player_time is not None:
        out["player_time"] = player_time
    for leaked in _CASH_LEDGER_AUDIT:
        out.pop(leaked, None)
    return out


def _project_cash(raw: Any, *, workspace: Path | None = None) -> dict[str, Any]:
    """Read-only cash view from investigator-state ``cash`` (cash_query source).

    Prefer ``coc_cash.normalize_cash`` when the plugin module exists so the
    projection stays aligned with ``state.cash_query``. Missing or corrupt
    ledgers become the empty view; the panel must not crash.
    """
    if workspace is not None:
        try:
            coc_cash = _load_plugin_module(workspace, "coc_cash")
        except Exception:  # noqa: BLE001 - older plugin trees lack the module
            coc_cash = None
        if coc_cash is not None:
            try:
                normalized = coc_cash.normalize_cash(raw)
            except Exception:  # noqa: BLE001 - corrupt ledger is an empty view
                return _empty_cash_view()
            ledger = [
                projected
                for row in (normalized.get("ledger") or [])
                if (projected := _project_cash_ledger_row(row)) is not None
            ]
            return {
                "schema_version": normalized.get("schema_version") or 2,
                "balances": normalized.get("balances") or {},
                "ledger": ledger[-_CASH_LEDGER_RECENT:],
            }
    if raw is None or not isinstance(raw, dict):
        return _empty_cash_view()
    if raw.get("schema_version") != 2 or not isinstance(raw.get("balances"), dict):
        return _empty_cash_view()
    ledger: list[dict[str, Any]] = []
    ledger_raw = raw.get("ledger")
    if isinstance(ledger_raw, list):
        for row in ledger_raw:
            projected = _project_cash_ledger_row(row)
            if projected is not None:
                ledger.append(projected)
    return {
        "schema_version": 2,
        "balances": raw.get("balances") or {},
        "ledger": ledger[-_CASH_LEDGER_RECENT:],
    }


def _table_chrome(workspace: Path | None, play_language: str) -> dict[str, str]:
    if workspace is not None:
        try:
            coc_language = _load_plugin_module(workspace, "coc_language")
            return coc_language.table_mechanics_labels(play_language)
        except Exception:  # noqa: BLE001 - display chrome is best-effort
            pass
    return {}


def _living_standard_display(
    value: str,
    play_language: str,
    workspace: Path | None = None,
) -> str:
    text = value.strip()
    if workspace is not None:
        try:
            coc_language = _load_plugin_module(workspace, "coc_language")
            return coc_language.living_standard_label(text, play_language)
        except Exception:  # noqa: BLE001 - keep the canonical English name
            pass
    chrome = _table_chrome(workspace, play_language)
    mapped = chrome.get("living_" + text.replace(" ", "_"))
    if isinstance(mapped, str) and mapped.strip():
        return mapped
    return text


def _format_sheet_money(entry: Any) -> str:
    if not isinstance(entry, dict):
        return ""
    amount = entry.get("amount")
    if amount is None or isinstance(amount, bool):
        return ""
    if not isinstance(amount, (int, float)):
        return ""
    currency = str(entry.get("currency") or "USD")
    if isinstance(amount, float) and amount.is_integer():
        amount = int(amount)
    if isinstance(amount, int):
        formatted = f"{amount:,}"
    else:
        formatted = str(amount)
    if currency == "USD":
        return f"${formatted}"
    return f"{formatted} {currency}"


def _finance_labels(chrome: dict[str, str], *, current: bool) -> dict[str, str]:
    spending = chrome.get("spending_level", "Daily unbooked allowance")
    if current:
        current_cash = chrome.get("current_cash", "Current cash")
        return {
            "assets": chrome.get("current_assets", "Current Assets"),
            "cash": current_cash,
            "current_cash": current_cash,
            "living_standard": chrome.get("living_standard", "Living standard"),
            "spending_level": spending,
            "empty_ledger": chrome.get("cash_empty_ledger", "No ledger rows."),
            "no_record": chrome.get("cash_no_record", "No cash recorded yet."),
            "no_reason": chrome.get("cash_no_reason", "No reason given"),
            "pair_sep": chrome.get("pair_sep", ": "),
        }
    return {
        "assets": chrome.get("creation_assets", "Creation Assets"),
        "cash": chrome.get("creation_cash", "Creation cash"),
        "living_standard": chrome.get("creation_living_standard", "Creation living standard"),
        "spending_level": spending,
        "empty_ledger": chrome.get("cash_empty_ledger", "No ledger rows."),
        "no_record": chrome.get("cash_no_record", "No cash recorded yet."),
        "no_reason": chrome.get("cash_no_reason", "No reason given"),
        "pair_sep": chrome.get("pair_sep", ": "),
    }


def _format_runtime_money(amount: Any, currency: str) -> str:
    if amount is None or isinstance(amount, bool):
        return ""
    if isinstance(amount, dict):
        return _format_sheet_money(amount) or _format_runtime_money(
            amount.get("amount"), str(amount.get("currency") or currency)
        )
    text = str(amount).strip()
    if not text:
        return ""
    if text.endswith(".00"):
        text = text[:-3]
    identity = str(currency or "USD")
    if identity == "USD":
        return f"${text}"
    if identity == "GBP":
        return f"£{text}"
    return f"{text} {identity}"


def _project_sheet_assets(
    character: dict[str, Any], *,
    play_language: str,
    workspace: Path | None = None,
) -> dict[str, Any] | None:
    """Chargen asset snapshot. Not live play finance."""
    raw = character.get("assets")
    display = _format_sheet_money(raw)
    if not display:
        return None
    assert isinstance(raw, dict)
    chrome = _table_chrome(workspace, play_language)
    out: dict[str, Any] = {
        "amount": raw.get("amount"),
        "currency": str(raw.get("currency") or "USD"),
        "display": display,
        "current": False,
        "baseline": True,
        "labels": _finance_labels(chrome, current=False),
    }
    if raw.get("formula"):
        out["source"] = chrome.get("credit_rating_source", "Credit Rating")
    living = character.get("living_standard")
    if isinstance(living, str) and living.strip():
        out["living_standard"] = _living_standard_display(
            living, play_language, workspace=workspace
        )
    spend = _format_sheet_money(character.get("spending_level"))
    if spend:
        out["spending_level"] = spend
    return out


def _project_runtime_assets(
    finance: dict[str, Any], *,
    play_language: str,
    workspace: Path | None = None,
) -> dict[str, Any] | None:
    """Live Assets / living standard / Spending Level from investigator-state."""
    currency = str(finance.get("currency") or "USD")
    assets = finance.get("assets") if isinstance(finance.get("assets"), dict) else {}
    balances = assets.get("balances") if isinstance(assets, dict) else {}
    wallet = balances.get(currency) if isinstance(balances, dict) else None
    amount = None
    if isinstance(wallet, dict):
        amount = wallet.get("amount")
    display = _format_runtime_money(amount, currency)
    if not display and amount is None:
        display = _format_runtime_money("0", currency)
    chrome = _table_chrome(workspace, play_language)
    out: dict[str, Any] = {
        "amount": amount,
        "currency": currency,
        "display": display,
        "current": True,
        "baseline": False,
        "labels": _finance_labels(chrome, current=True),
    }
    living = finance.get("living_standard")
    if isinstance(living, str) and living.strip():
        out["living_standard"] = _living_standard_display(
            living, play_language, workspace=workspace
        )
    spend = finance.get("spending_level")
    spend_display = _format_runtime_money(spend, currency)
    if spend_display:
        out["spending_level"] = spend_display
    return out


def _display_character(
    workspace: Path,
    character: dict[str, Any],
    play_language: str,
    inventory: dict[str, Any] | None = None,
    cash: dict[str, Any] | None = None,
    assets: dict[str, Any] | None = None,
    ruleset_id: str | None = None,
    module_id: str | None = None,
    module_weapon_profiles: dict[str, dict[str, Any]] | None = None,
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
    When ``cash`` is given (same investigator-state file as ``state.cash_query``),
    the panel receives the current balance and recent ledger rows.
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
    weapon_chrome = _table_chrome(workspace, play_language)
    _weapon_presets = load_weapon_presets(
        ruleset_id=ruleset_id,
        module_id=module_id,
        module_profiles=module_weapon_profiles,
    )
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
        projected_weapon = enrich_weapon_row(
            {
                "weapon_id": weapon_id,
                "label": pf_weapon.get("label")
                or entry_weapon_labels.get(weapon_id)
                or weapon.get("label")
                or weapon.get("name")
                or weapon.get("weapon_id"),
                "skill_label": skill,
                "damage": weapon.get("damage"),
                "range": weapon.get("range") or weapon.get("range_yards"),
                "ammo": pf_weapon.get(
                    "ammo_capacity",
                    weapon.get("ammo") or weapon.get("ammo_per_clip"),
                ),
            },
            presets=_weapon_presets,
        )
        if (
            projected_weapon.get("params_source")
            in {"ruleset_catalog", "module_preset"}
            and isinstance(projected_weapon.get("skill_label"), str)
        ):
            projected_weapon["skill_label"] = coc_language.player_facing_skill_label(
                projected_weapon["skill_label"], play_language, terms=terms
            )
        if projected_weapon.get("mechanics_available") is False:
            status_label = weapon_chrome.get("weapon_mechanics_unavailable")
            if isinstance(status_label, str) and status_label.strip():
                projected_weapon["mechanics_status_label"] = status_label
        else:
            range_label = weapon_chrome.get("weapon_range")
            if (
                projected_weapon.get("range") not in (None, "")
                and isinstance(range_label, str)
                and range_label.strip()
            ):
                projected_weapon["range_label"] = range_label
            ammo_label = weapon_chrome.get("weapon_ammo")
            if (
                projected_weapon.get("ammo") not in (None, "")
                and isinstance(ammo_label, str)
                and ammo_label.strip()
            ):
                projected_weapon["ammo_label"] = ammo_label
        weapons.append(projected_weapon)

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

    panel_fields = {
        "personal_description",
        "ideology_beliefs",
        "significant_people",
        "meaningful_locations",
        "treasured_possessions",
        "traits",
        "scenario_bound",
    }
    backstory: list[dict[str, Any]] = []
    details = (sheet or {}).get("backstory_details")
    if isinstance(details, list):
        for block in details:
            if not isinstance(block, dict):
                continue
            field = block.get("field")
            if field not in panel_fields:
                continue
            label = block.get("label")
            items = block.get("items")
            if not isinstance(label, str) or not isinstance(items, list) or not items:
                continue
            prose = [str(item) for item in items if str(item).strip()]
            if not prose:
                continue
            row: dict[str, Any] = {"field": field, "label": label, "items": prose}
            if block.get("starred") is True:
                row["starred"] = True
            backstory.append(row)
    derived = raw_derived if isinstance(raw_derived, dict) else {}
    luck = derived.get("Luck")
    if not isinstance(luck, int) or isinstance(luck, bool):
        luck = derived.get("LUCK")
    if isinstance(luck, bool) or not isinstance(luck, int):
        luck = None

    return {
        "name": (sheet or {}).get("display_name") or character.get("name"),
        "occupation": (sheet or {}).get("occupation") or character.get("occupation"),
        "era": (sheet or {}).get("era") or character.get("era"),
        "age": character.get("age"),
        "sex": character.get("sex"),
        "residence": character.get("residence"),
        "birthplace": character.get("birthplace"),
        "characteristics": characteristics,
        "derived": derived,
        "luck": luck,
        "backstory": backstory,
        "skills": skills,
        "weapons": weapons,
        "equipment": equipment,
        "inventory_items": inventory_items,
        "cash": cash,
        "assets": assets,
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
    cash: dict[str, Any] | None = None
    assets: dict[str, Any] | None = None
    ruleset_id: str | None = None
    module_id: str | None = None
    module_weapon_profiles: dict[str, dict[str, Any]] | None = None
    if campaign_id:
        campaign_path = _campaign_dir(workspace, campaign_id) / "campaign.json"
        try:
            campaign = json.loads(campaign_path.read_text("utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            campaign = None
        if isinstance(campaign, dict):
            candidate_ruleset_id = campaign.get("ruleset_id")
            if (
                isinstance(candidate_ruleset_id, str)
                and candidate_ruleset_id.strip()
            ):
                ruleset_id = candidate_ruleset_id.strip()
            candidate_module_id = campaign.get("active_scenario_id")
            if isinstance(candidate_module_id, str) and candidate_module_id.strip():
                module_id = candidate_module_id.strip()
        module_weapon_profiles = _campaign_module_weapon_profiles(
            workspace, campaign_id
        )
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
            try:
                coc_inventory = _load_plugin_module(workspace, "coc_inventory")
                inventory = coc_inventory.normalize_inventory(inv_state)
            except Exception:  # noqa: BLE001 - inventory is independent of cash
                inventory = None
            cash = _project_cash(inv_state.get("cash"), workspace=workspace)
            try:
                coc_finance = _load_plugin_module(workspace, "coc_finance")
                finance = coc_finance.normalize_finance(inv_state.get("finance"))
                assets = _project_runtime_assets(
                    finance,
                    play_language=play_language,
                    workspace=workspace,
                )
            except Exception:  # noqa: BLE001 - missing finance is not the sheet
                assets = None
        else:
            cash = _empty_cash_view()
    else:
        assets = _project_sheet_assets(
            character,
            play_language=play_language,
            workspace=workspace,
        )
    chrome = _table_chrome(workspace, play_language)
    if isinstance(cash, dict):
        cash = dict(cash)
        cash["labels"] = _finance_labels(chrome, current=True)
    return _display_character(
        workspace,
        character,
        play_language,
        inventory=inventory,
        cash=cash,
        assets=assets,
        ruleset_id=ruleset_id,
        module_id=module_id,
        module_weapon_profiles=module_weapon_profiles,
    )


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
    projected = public_state.build_public_state(workspace, campaign_id, actor_id)
    projected["opening_phase"] = _project_opening_phase(workspace, campaign_id)
    return projected


def _project_opening_phase(
    workspace: Path, campaign_id: str
) -> dict[str, Any] | None:
    """Single opening-lifecycle phase for the UI.

    The browser must not re-derive setup progress from directory scans; this is
    the same plugin derivation the Keeper gate and ``setup.complete`` consume.
    """
    try:
        coc_opening_phase = _load_plugin_module(workspace, "coc_opening_phase")
    except Exception:  # noqa: BLE001 - projection stays renderable without it
        return None
    try:
        return coc_opening_phase.opening_phase_projection(workspace, campaign_id)
    except Exception:  # noqa: BLE001 - a corrupt campaign is not a UI crash
        return None


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
