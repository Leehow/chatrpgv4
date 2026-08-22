"""Authoritative player-facing weapon projection for the pi-coc UI sidecar.

Read-only: never writes inventory. Mechanics come from complete explicit row
data or an exact stable ID in the ruleset/module catalog. Display labels never
select rules data.
"""
from __future__ import annotations

from collections.abc import Mapping
import json
from pathlib import Path
from typing import Any

_REPO_ROOT = Path(__file__).resolve().parents[2]
_WEAPONS_JSON = (
    _REPO_ROOT / "plugins" / "coc-keeper" / "rulesets" / "coc7" / "rules-json" / "weapons.json"
)
_RULESET_JSON_DIR = _REPO_ROOT / "plugins" / "coc-keeper" / "rulesets" / "coc7" / "rules-json"

_MECHANICS_FIELDS = ("damage", "skill_label", "range", "ammo")


def _row_from_catalog(
    weapon_id: str,
    spec: dict[str, Any],
    *,
    source: str,
) -> dict[str, Any]:
    damage = spec.get("damage_die") or spec.get("damage")
    skill = spec.get("skill")
    ammo = spec.get("magazine") or spec.get("ammo_per_clip") or spec.get("ammo")
    range_yards = spec.get("base_range_yards") or spec.get("range_yards") or spec.get("range")
    return {
        "weapon_id": weapon_id,
        "label": spec.get("display_name") or spec.get("name") or weapon_id,
        "skill": skill,
        "damage": damage,
        "range": range_yards,
        "ammo": ammo,
        "source": source,
        "malfunction": spec.get("malfunction"),
        "uses_per_round": spec.get("uses_per_round"),
    }


def _inherit_weapon_fields(
    row: dict[str, Any],
    *,
    spec: Mapping[str, Any],
    presets: Mapping[str, dict[str, Any]],
) -> None:
    extends = str(spec.get("extends") or "").strip()
    inherited = presets.get(extends) if extends else None
    if not inherited:
        return
    for key in (
        "skill",
        "damage",
        "range",
        "ammo",
        "malfunction",
        "uses_per_round",
    ):
        if row.get(key) in (None, "") and inherited.get(key) not in (None, ""):
            row[key] = inherited[key]


def load_weapon_presets(
    *,
    module_id: str | None = None,
    module_profiles: Mapping[str, Mapping[str, Any]] | None = None,
) -> dict[str, dict[str, Any]]:
    presets: dict[str, dict[str, Any]] = {}
    if _WEAPONS_JSON.is_file():
        payload = json.loads(_WEAPONS_JSON.read_text(encoding="utf-8"))
        weapons = payload.get("weapons") if isinstance(payload, dict) else None
        if isinstance(weapons, dict):
            for weapon_id, spec in weapons.items():
                if isinstance(spec, dict):
                    presets[str(weapon_id)] = _row_from_catalog(
                        str(weapon_id), spec, source="ruleset_catalog"
                    )
    if _RULESET_JSON_DIR.is_dir() and module_id:
        module_paths = {
            path.stem: path
            for path in _RULESET_JSON_DIR.glob("*.json")
            if path.name != "weapons.json"
        }
        path = module_paths.get(module_id)
        if path is not None:
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                payload = None
            rows = payload.get("weapons") if isinstance(payload, dict) else None
            for spec in rows if isinstance(rows, list) else []:
                if not isinstance(spec, dict):
                    continue
                weapon_id = str(spec.get("weapon_id") or "").strip()
                if not weapon_id or weapon_id in presets:
                    continue
                row = _row_from_catalog(weapon_id, spec, source="module_preset")
                _inherit_weapon_fields(row, spec=spec, presets=presets)
                presets[weapon_id] = row
    # Imported/custom content is already validated as source-authored by the
    # campaign projection seam. It can only enter this catalog under its exact
    # stable weapon_id; labels never participate in resolution.
    for weapon_id, profile in (module_profiles or {}).items():
        stable_id = str(weapon_id).strip()
        profile_id = str(profile.get("weapon_id") or "").strip()
        if not stable_id or profile_id != stable_id:
            continue
        row = _row_from_catalog(stable_id, dict(profile), source="module_preset")
        _inherit_weapon_fields(row, spec=profile, presets=presets)
        presets[stable_id] = row
    return presets


def resolve_weapon_preset(
    *,
    weapon_id: str | None,
    label: str | None,
    presets: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any] | None:
    catalog = presets if presets is not None else load_weapon_presets()
    if weapon_id and weapon_id in catalog:
        return dict(catalog[weapon_id])
    # ``label`` remains in the signature for callers that already pass it, but
    # it is display-only and must never select authoritative mechanics.
    _ = label
    return None


def synthesize_weapon_params(
    *,
    weapon_id: str | None,
    label: str | None,
    presets: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    catalog = presets if presets is not None else load_weapon_presets()
    hit = resolve_weapon_preset(weapon_id=weapon_id, label=label, presets=catalog)
    if hit:
        hit["resolved"] = hit.get("source")
        if label:
            hit["label"] = label
        return hit
    return {
        "weapon_id": weapon_id,
        "label": label or weapon_id,
        "resolved": "unresolved",
    }


def enrich_weapon_row(
    weapon: dict[str, Any],
    presets: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    out = dict(weapon)
    if out.get("damage") and out.get("skill_label"):
        out["params_source"] = "explicit"
        out["mechanics_available"] = True
        return out
    filled = synthesize_weapon_params(
        weapon_id=str(out.get("weapon_id") or "") or None,
        label=str(out.get("label") or out.get("name") or "") or None,
        presets=presets,
    )
    source = filled.get("resolved")
    if source != "unresolved" and filled.get("damage") and filled.get("skill"):
        out["damage"] = filled["damage"]
        out["skill_label"] = filled["skill"]
        for key in ("ammo", "range"):
            if filled.get(key) is not None:
                out[key] = filled[key]
            else:
                out.pop(key, None)
        out["params_source"] = source
        out["mechanics_available"] = True
        return out

    for key in _MECHANICS_FIELDS:
        if out.get(key) in (None, ""):
            out.pop(key, None)
    out.pop("weapon_class", None)
    out.pop("template_weapon_id", None)
    out["params_source"] = "unresolved"
    out["mechanics_available"] = False
    return out
