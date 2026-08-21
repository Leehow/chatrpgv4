"""CoC7 catalog shape adapter. Reads only this package's rules-json tables."""
from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

DATA_DIR = Path(__file__).resolve().parent / "rules-json"

# Keeper-only kinds: core never player-projects these (or any other kind).
SECRET_KINDS = frozenset({"spell", "creature", "artifact", "tome", "poison"})

SUPPORTED_KINDS = (
    "weapon",
    "item",
    "spell",
    "creature",
    "skill",
    "vehicle",
    "rule",
    "artifact",
    "tome",
    "poison",
    "occupation",
    "phobia",
    "hazard",
)

_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _slug(value: str) -> str:
    return _SLUG_RE.sub("_", value.casefold()).strip("_")


@lru_cache(maxsize=32)
def _load_table(name: str) -> Any:
    path = DATA_DIR / f"{name}.json"
    return json.loads(path.read_text(encoding="utf-8"))


def supported_kinds() -> tuple[str, ...]:
    return SUPPORTED_KINDS


def _pick(row: dict[str, Any], keys: tuple[str, ...]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key in keys:
        if key in row:
            out[key] = row[key]
    return out


def _record(
    *,
    kind: str,
    entity_id: str,
    name: str,
    table: str,
    summary: dict[str, Any],
    params: dict[str, Any] | None = None,
    aliases: list[str] | None = None,
    era: list[str] | None = None,
    localized_name: str | None = None,
    tags: list[str] | None = None,
    category: str | None = None,
    labels: list[str] | None = None,
) -> dict[str, Any]:
    rec: dict[str, Any] = {
        "kind": kind,
        "entity_id": entity_id,
        "name": name,
        "localized_name": localized_name,
        "aliases": aliases or [],
        "labels": labels or [],
        "tags": tags or [],
        "category": category,
        "era": era or [],
        "secret": kind in SECRET_KINDS,
        "source": {"table": table},
        "summary": summary,
        "params": params or {},
    }
    return rec


def _equipment_records() -> list[dict[str, Any]]:
    data = _load_table("equipment")
    if not isinstance(data, dict) or data.get("schema_version") != 2:
        raise ValueError("equipment.json must use schema_version 2 records[]")
    if "periods" in data:
        raise ValueError("legacy equipment.json periods shape is not supported")
    records = data.get("records")
    if not isinstance(records, list):
        raise ValueError("equipment.json records[] is required")
    return records


def _price_projection(row: dict[str, Any]) -> dict[str, Any]:
    price = row.get("price") if isinstance(row.get("price"), dict) else {}
    projection: dict[str, Any] = {
        "price_id": row.get("price_id"),
        "era": row.get("era"),
        "kind": price.get("kind"),
        "source_display": price.get("source_display"),
        "currency": price.get("currency"),
    }
    for key in ("amount", "min", "max", "unit", "dice", "multiplier", "addend", "reason"):
        if key in price:
            projection[key] = price[key]
    return projection


def _weapon_price_index() -> dict[str, list[dict[str, Any]]]:
    index: dict[str, list[dict[str, Any]]] = {}
    for row in _equipment_records():
        if not isinstance(row, dict):
            continue
        ref = row.get("entity_ref") or {}
        if not isinstance(ref, dict):
            continue
        if ref.get("kind") != "weapon":
            continue
        entity_id = ref.get("entity_id")
        if not isinstance(entity_id, str) or not entity_id:
            continue
        index.setdefault(entity_id, []).append(row)
    return index


def _weapons() -> list[dict[str, Any]]:
    table = _load_table("weapons").get("weapons") or {}
    rows: list[dict[str, Any]] = []
    if not isinstance(table, dict):
        return rows
    prices = _weapon_price_index()
    for key, row in table.items():
        if not isinstance(row, dict):
            continue
        name = str(row.get("display_name") or key)
        eras = [str(item) for item in row.get("eras") or [] if isinstance(item, str)]
        params = _pick(row, (
            "skill", "damage_die", "base_range_yards", "magazine",
            "malfunction", "impales", "adds_damage_bonus", "damage_type",
        ))
        linked = prices.get(str(key)) or []
        if linked:
            params["price_ref"] = [str(item.get("price_id")) for item in linked]
            params["price_projection"] = [_price_projection(item) for item in linked]
        rows.append(_record(
            kind="weapon",
            entity_id=str(key),
            name=name,
            table="weapons.json",
            aliases=[str(key)],
            era=eras,
            summary=_pick(row, ("skill", "damage_die", "uses_per_round")),
            params=params,
        ))
    return rows


def _items() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for row in _equipment_records():
        if not isinstance(row, dict):
            continue
        price_id = str(row.get("price_id") or "")
        name = str(row.get("name") or "")
        if not price_id or not name:
            continue
        era_name = str(row.get("era") or "")
        category = str(row.get("category") or "") or None
        price = row.get("price") if isinstance(row.get("price"), dict) else {}
        params: dict[str, Any] = {
            "price_id": price_id,
            "category": category,
            "price": price,
            "provenance": row.get("provenance") or {},
        }
        ref = row.get("entity_ref")
        if isinstance(ref, dict) and ref:
            params["entity_ref"] = ref
        rows.append(_record(
            kind="item",
            entity_id=price_id,
            name=name,
            table="equipment.json",
            era=[era_name] if era_name else [],
            category=category,
            summary={
                "category": category,
                "price_kind": price.get("kind"),
                "source_display": price.get("source_display"),
            },
            params=params,
        ))
    return rows


def _spells() -> list[dict[str, Any]]:
    spells = _load_table("spells").get("spells") or []
    rows: list[dict[str, Any]] = []
    if not isinstance(spells, list):
        return rows
    for row in spells:
        if not isinstance(row, dict):
            continue
        name = str(row.get("name") or "")
        if not name:
            continue
        alts = [str(item) for item in row.get("alternative_names") or [] if isinstance(item, str)]
        rows.append(_record(
            kind="spell",
            entity_id=_slug(name),
            name=name,
            table="spells.json",
            aliases=alts,
            summary=_pick(row, ("cost_mp", "cost_sanity", "cost_pow")),
            params=_pick(row, ("cost_mp", "cost_sanity", "cost_pow", "source_page")),
        ))
    return rows


def _creatures() -> list[dict[str, Any]]:
    table = _load_table("monsters").get("monsters") or {}
    rows: list[dict[str, Any]] = []
    if not isinstance(table, dict):
        return rows
    for name, row in table.items():
        if not isinstance(row, dict):
            continue
        rows.append(_record(
            kind="creature",
            entity_id=_slug(str(name)),
            name=str(name),
            table="monsters.json",
            summary=_pick(row, ("hp", "armor", "mov")),
            params=_pick(row, ("hp", "armor", "mov", "san_loss", "source_page")),
        ))
    return rows


def _skills() -> list[dict[str, Any]]:
    table = _load_table("skills").get("skills") or {}
    rows: list[dict[str, Any]] = []
    if not isinstance(table, dict):
        return rows
    for name, row in table.items():
        if not isinstance(row, dict):
            continue
        labels = row.get("localized_labels") if isinstance(row.get("localized_labels"), dict) else {}
        zh = labels.get("zh-Hans") if isinstance(labels, dict) else None
        extra_aliases = [str(v) for v in labels.values() if isinstance(v, str)] if labels else []
        era = ["modern"] if row.get("modern_only") else []
        rows.append(_record(
            kind="skill",
            entity_id=str(name),
            name=str(name),
            table="skills.json",
            localized_name=zh if isinstance(zh, str) else None,
            aliases=extra_aliases,
            era=era,
            tags=["uncommon"] if row.get("uncommon") else [],
            category=str(row.get("group") or "") or None,
            summary=_pick(row, ("base_chance", "group", "modern_only", "uncommon")),
            params=_pick(row, ("base_chance", "group", "modern_only", "uncommon")),
        ))
    return rows


def _vehicles() -> list[dict[str, Any]]:
    block = _load_table("chase").get("vehicles") or {}
    entries = block.get("entries") or {}
    aliases_map = block.get("aliases") or {}
    reverse: dict[str, list[str]] = {}
    if isinstance(aliases_map, dict):
        for alias, target in aliases_map.items():
            reverse.setdefault(str(target), []).append(str(alias))
    rows: list[dict[str, Any]] = []
    if not isinstance(entries, dict):
        return rows
    for key, row in entries.items():
        if not isinstance(row, dict):
            continue
        name = str(row.get("label") or key)
        rows.append(_record(
            kind="vehicle",
            entity_id=str(key),
            name=name,
            table="chase.json",
            aliases=reverse.get(str(key), []),
            labels=[name],
            summary=_pick(row, ("mov", "build", "armor", "passengers")),
            params=_pick(row, ("mov", "build", "armor", "passengers")),
        ))
    return rows


def _rules() -> list[dict[str, Any]]:
    rules = _load_table("rule-index").get("rules") or []
    rows: list[dict[str, Any]] = []
    if not isinstance(rules, list):
        return rows
    for row in rules:
        if not isinstance(row, dict):
            continue
        rid = row.get("id")
        if not isinstance(rid, str):
            continue
        rows.append(_record(
            kind="rule",
            entity_id=rid,
            name=rid,
            table="rule-index.json",
            category=str(row.get("category") or "") or None,
            summary=_pick(row, ("category", "source_table")),
            params=_pick(row, ("category", "source_table", "numeric")),
        ))
    return rows


def _artifacts() -> list[dict[str, Any]]:
    table = _load_table("artifacts").get("artifacts") or {}
    rows: list[dict[str, Any]] = []
    if not isinstance(table, dict):
        return rows
    for name, row in table.items():
        if not isinstance(row, dict):
            continue
        rows.append(_record(
            kind="artifact",
            entity_id=_slug(str(name)),
            name=str(name),
            table="artifacts.json",
            summary=_pick(row, ("mechanics", "source_page")),
            params=_pick(row, ("mechanics", "source_page")),
        ))
    return rows


def _tomes() -> list[dict[str, Any]]:
    table = _load_table("tomes").get("tomes") or {}
    rows: list[dict[str, Any]] = []
    if not isinstance(table, dict):
        return rows
    for name, row in table.items():
        if not isinstance(row, dict):
            continue
        rows.append(_record(
            kind="tome",
            entity_id=_slug(str(name)),
            name=str(name),
            table="tomes.json",
            summary=_pick(row, ("sanity_cost", "mythos_rating", "full_study_weeks")),
            params=_pick(row, (
                "sanity_cost", "mythos_rating", "full_study_weeks",
                "cthulhu_mythos_initial", "cthulhu_mythos_full",
            )),
        ))
    return rows


def _poisons() -> list[dict[str, Any]]:
    table = _load_table("poisons").get("poisons") or {}
    rows: list[dict[str, Any]] = []
    if not isinstance(table, dict):
        return rows
    for name, row in table.items():
        if not isinstance(row, dict):
            continue
        rows.append(_record(
            kind="poison",
            entity_id=_slug(str(name)),
            name=str(name),
            table="poisons.json",
            summary=_pick(row, ("potency", "damage_expr", "delivery")),
            params=_pick(row, ("potency", "damage_expr", "delivery", "onset")),
        ))
    return rows


def _occupations() -> list[dict[str, Any]]:
    table = _load_table("occupations").get("occupations") or {}
    rows: list[dict[str, Any]] = []
    if not isinstance(table, dict):
        return rows
    for name, row in table.items():
        if not isinstance(row, dict):
            continue
        tags = [str(item) for item in row.get("tags") or [] if isinstance(item, str)]
        rows.append(_record(
            kind="occupation",
            entity_id=str(name),
            name=str(name),
            table="occupations.json",
            tags=tags,
            summary=_pick(row, ("credit_rating_range", "skill_point_formula")),
            params=_pick(row, ("credit_rating_range", "skill_point_formula")),
        ))
    return rows


def _phobias() -> list[dict[str, Any]]:
    table = _load_table("phobias").get("phobias") or {}
    rows: list[dict[str, Any]] = []
    if not isinstance(table, dict):
        return rows
    for name, row in table.items():
        if not isinstance(row, dict):
            continue
        tags = [str(item) for item in row.get("trigger_tags") or [] if isinstance(item, str)]
        rows.append(_record(
            kind="phobia",
            entity_id=str(name),
            name=str(name),
            table="phobias.json",
            tags=tags,
            summary=_pick(row, ("trigger",)),
            params=_pick(row, ("trigger", "source_page")),
        ))
    return rows


def _hazards() -> list[dict[str, Any]]:
    presets = _load_table("hazards").get("presets") or {}
    rows: list[dict[str, Any]] = []
    if not isinstance(presets, dict):
        return rows
    for key, row in presets.items():
        if not isinstance(row, dict):
            continue
        name = str(row.get("example") or key)
        rows.append(_record(
            kind="hazard",
            entity_id=str(key),
            name=name,
            table="hazards.json",
            category=str(row.get("category") or "") or None,
            summary=_pick(row, ("severity", "category")),
            params=_pick(row, ("severity", "category", "suffocation")),
        ))
    return rows


_BUILDERS = {
    "weapon": _weapons,
    "item": _items,
    "spell": _spells,
    "creature": _creatures,
    "skill": _skills,
    "vehicle": _vehicles,
    "rule": _rules,
    "artifact": _artifacts,
    "tome": _tomes,
    "poison": _poisons,
    "occupation": _occupations,
    "phobia": _phobias,
    "hazard": _hazards,
}


def catalog_records(kinds: list[str] | tuple[str, ...] | None = None) -> list[dict[str, Any]]:
    wanted = list(kinds) if kinds else list(SUPPORTED_KINDS)
    out: list[dict[str, Any]] = []
    for kind in wanted:
        builder = _BUILDERS.get(kind)
        if builder is None:
            continue
        out.extend(builder())
    return out
