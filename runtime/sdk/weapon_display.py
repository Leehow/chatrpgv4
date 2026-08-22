"""Authoritative player-facing weapon projection for the pi-coc UI sidecar.

Read-only: never writes inventory. Mechanics come from complete explicit row
data or an exact stable ID in the ruleset/module catalog. Display labels never
select rules data.
"""
from __future__ import annotations

from collections.abc import Mapping
import json
import math
from pathlib import Path
from typing import Any

_REPO_ROOT = Path(__file__).resolve().parents[2]
_RULESETS_DIR = _REPO_ROOT / "plugins" / "coc-keeper" / "rulesets"

_MECHANICS_FIELDS = ("damage", "skill_label", "range", "ammo")


def _ruleset_json_dir(ruleset_id: str | None) -> Path | None:
    """Resolve one installed ruleset package without falling back to CoC 7."""
    if not isinstance(ruleset_id, str) or not ruleset_id.strip():
        return None
    stable_id = ruleset_id.strip()
    if Path(stable_id).name != stable_id or "/" in stable_id or "\\" in stable_id:
        return None
    package_dir = _RULESETS_DIR / stable_id
    manifest_path = package_dir / "manifest.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return None
    if not isinstance(manifest, dict) or manifest.get("ruleset_id") != stable_id:
        return None
    rules_json_dir = package_dir / "rules-json"
    return rules_json_dir if rules_json_dir.is_dir() else None


def _nonempty_string(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _safe_scalar(value: Any) -> bool:
    if isinstance(value, bool):
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, int):
        return True
    return isinstance(value, float) and math.isfinite(value)


def _mechanics_shape_valid(row: Mapping[str, Any], *, skill_key: str) -> bool:
    if not _nonempty_string(row.get("damage")) or not _nonempty_string(
        row.get(skill_key)
    ):
        return False
    return all(
        key not in row or row.get(key) is None or _safe_scalar(row.get(key))
        for key in ("range", "ammo")
    )


def _drop_malformed_mechanics(row: dict[str, Any]) -> None:
    for key in ("damage", "skill_label"):
        if key in row and not _nonempty_string(row.get(key)):
            row.pop(key, None)
    for key in ("range", "ammo"):
        if (
            key in row
            and row.get(key) is not None
            and not _safe_scalar(row.get(key))
        ):
            row.pop(key, None)


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
    ruleset_id: str | None = None,
    module_id: str | None = None,
    module_profiles: Mapping[str, Mapping[str, Any]] | None = None,
) -> dict[str, dict[str, Any]]:
    presets: dict[str, dict[str, Any]] = {}
    ruleset_json_dir = _ruleset_json_dir(ruleset_id)
    if ruleset_json_dir is None:
        return presets
    weapons_json = ruleset_json_dir / "weapons.json"
    if weapons_json.is_file():
        try:
            payload = json.loads(weapons_json.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            payload = None
        weapons = payload.get("weapons") if isinstance(payload, dict) else None
        if isinstance(weapons, dict):
            for weapon_id, spec in weapons.items():
                if isinstance(spec, dict):
                    presets[str(weapon_id)] = _row_from_catalog(
                        str(weapon_id), spec, source="ruleset_catalog"
                    )
    if module_id:
        module_paths = {
            path.stem: path
            for path in ruleset_json_dir.glob("*.json")
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
        if not stable_id or profile_id != stable_id or stable_id in presets:
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
    explicit_mechanics = any(key in out for key in _MECHANICS_FIELDS)
    if _mechanics_shape_valid(out, skill_key="skill_label"):
        out["params_source"] = "explicit"
        out["mechanics_available"] = True
        return out
    if explicit_mechanics and any(
        (key in out and out.get(key) is not None)
        and (
            (key in {"damage", "skill_label"} and not _nonempty_string(out.get(key)))
            or (key in {"range", "ammo"} and not _safe_scalar(out.get(key)))
        )
        for key in _MECHANICS_FIELDS
    ):
        _drop_malformed_mechanics(out)
        out["params_source"] = "unresolved"
        out["mechanics_available"] = False
        return out
    filled = synthesize_weapon_params(
        weapon_id=str(out.get("weapon_id") or "") or None,
        label=str(out.get("label") or out.get("name") or "") or None,
        presets=presets,
    )
    source = filled.get("resolved")
    if source != "unresolved" and _mechanics_shape_valid(filled, skill_key="skill"):
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

    _drop_malformed_mechanics(out)
    for key in _MECHANICS_FIELDS:
        if out.get(key) in (None, ""):
            out.pop(key, None)
    out.pop("weapon_class", None)
    out.pop("template_weapon_id", None)
    out["params_source"] = "unresolved"
    out["mechanics_available"] = False
    return out
