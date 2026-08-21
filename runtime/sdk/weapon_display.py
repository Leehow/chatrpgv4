"""Player-facing weapon parameter resolution for the pi-coc UI sidecar.

Read-only: never writes inventory. Preset rows win; otherwise a same-class
catalog template is copied so the items panel is never name-only.
"""
from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path
from typing import Any

_REPO_ROOT = Path(__file__).resolve().parents[2]
_WEAPONS_JSON = (
    _REPO_ROOT / "plugins" / "coc-keeper" / "rulesets" / "coc7" / "rules-json" / "weapons.json"
)
_RULESET_JSON_DIR = _REPO_ROOT / "plugins" / "coc-keeper" / "rulesets" / "coc7" / "rules-json"

_CLASS_ALIASES = (
    ("rifle", ("rifle", "步枪", "卡宾", "carcano", "enfield", "springfield", "mannlicher")),
    ("handgun", ("handgun", "pistol", "revolver", "手枪", "左轮")),
    ("shotgun", ("shotgun", "霰弹", "shot gun")),
    ("smg", ("smg", "submachine", "冲锋")),
    ("melee", ("knife", "club", "sword", "刀", "棍", "剑", "melee")),
)

_DEFAULT_TEMPLATES = {
    "rifle": "30_06_bolt_action_rifle",
    "handgun": "revolver_45",
    "shotgun": "shotgun_12g",
    "smg": "thompson",
    "melee": "knife_large",
}


def _fold(text: str) -> str:
    raw = unicodedata.normalize("NFKC", text or "").casefold()
    return re.sub(r"[^0-9a-z\u4e00-\u9fff]+", "", raw)


def _weapon_class(text: str) -> str:
    folded = _fold(text)
    for cls, tokens in _CLASS_ALIASES:
        if any(token in folded or _fold(token) in folded for token in tokens):
            return cls
    return "rifle"


def _row_from_catalog(weapon_id: str, spec: dict[str, Any]) -> dict[str, Any]:
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
        "source": "catalog",
        "malfunction": spec.get("malfunction"),
        "uses_per_round": spec.get("uses_per_round"),
    }


def load_weapon_presets() -> dict[str, dict[str, Any]]:
    presets: dict[str, dict[str, Any]] = {}
    if _WEAPONS_JSON.is_file():
        payload = json.loads(_WEAPONS_JSON.read_text(encoding="utf-8"))
        weapons = payload.get("weapons") if isinstance(payload, dict) else None
        if isinstance(weapons, dict):
            for weapon_id, spec in weapons.items():
                if isinstance(spec, dict):
                    presets[str(weapon_id)] = _row_from_catalog(str(weapon_id), spec)
    if _RULESET_JSON_DIR.is_dir():
        for path in _RULESET_JSON_DIR.glob("*.json"):
            if path.name == "weapons.json":
                continue
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            rows = payload.get("weapons") if isinstance(payload, dict) else None
            if not isinstance(rows, list):
                continue
            for spec in rows:
                if not isinstance(spec, dict):
                    continue
                weapon_id = str(spec.get("weapon_id") or "").strip()
                if not weapon_id or weapon_id in presets:
                    continue
                presets[weapon_id] = _row_from_catalog(weapon_id, spec)
                presets[weapon_id]["source"] = "module_preset"
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
    needle = _fold(label or "")
    if not needle:
        return None
    for spec in catalog.values():
        hay = _fold(str(spec.get("label") or "")) + _fold(str(spec.get("weapon_id") or ""))
        if needle in hay or hay in needle:
            return dict(spec)
        # Partial token: 卡卡诺步枪 vs Mannlicher-Carcano
        if "carcano" in hay and "卡卡诺" in (label or ""):
            return dict(spec)
        if "卡卡诺" in _fold(str(spec.get("label") or "")) and "carcano" in needle:
            return dict(spec)
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
        hit["resolved"] = "preset"
        if label:
            hit["label"] = label
        return hit
    cls = _weapon_class(f"{weapon_id or ''} {label or ''}")
    template_id = _DEFAULT_TEMPLATES.get(cls, "30_06_bolt_action_rifle")
    template = dict(catalog.get(template_id) or {
        "weapon_id": template_id,
        "damage": "1D8",
        "skill": "Firearms (rifle)",
        "range": 50,
        "ammo": None,
    })
    template["weapon_id"] = weapon_id or template.get("weapon_id")
    template["label"] = label or weapon_id or template.get("label")
    template["source"] = "class_template"
    template["resolved"] = "fallback"
    template["template_weapon_id"] = template_id
    template["weapon_class"] = cls
    return template


def enrich_weapon_row(weapon: dict[str, Any], presets: dict[str, dict[str, Any]] | None = None) -> dict[str, Any]:
    out = dict(weapon)
    if out.get("damage") and out.get("skill_label"):
        return out
    filled = synthesize_weapon_params(
        weapon_id=str(out.get("weapon_id") or "") or None,
        label=str(out.get("label") or out.get("name") or "") or None,
        presets=presets,
    )
    if not out.get("damage"):
        out["damage"] = filled.get("damage")
    if not out.get("skill_label") and filled.get("skill"):
        out["skill_label"] = filled.get("skill")
    if out.get("ammo") in (None, "") and filled.get("ammo") is not None:
        out["ammo"] = filled.get("ammo")
    if out.get("range") in (None, "") and filled.get("range") is not None:
        out["range"] = filled.get("range")
    out["params_source"] = filled.get("resolved")
    return out
