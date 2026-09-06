"""Catalog records and candidate recall. Ported from the old rulesets/coc7/catalog.py
(record builders) and scripts/coc_catalog.py (query core).

The shape adapter reads only the coc7 rules-json tables; the query core applies
deterministic structured-token recall and never picks a winner. A second
namespace — the campaign module's own spell nodes — is handed in as records and
recalled beside the rulebook rows; the rulebook wins a shared name."""

from __future__ import annotations

import re
from copy import deepcopy
from typing import Any

from .tables import RuleTables, slug

# Keeper-only kinds: never player-projected.
SECRET_KINDS = frozenset({"spell", "creature", "artifact", "tome", "poison"})

SUPPORTED_KINDS = (
    "weapon", "item", "spell", "creature", "skill", "vehicle", "rule", "artifact", "tome",
    "poison", "occupation", "phobia", "mania", "hazard",
)

DEFAULT_LIMIT = 20
MIN_LIMIT = 1
MAX_LIMIT = 50

FAMILY_PARAMETER_KIND_FIELD = "family_parameter_kind"
MODULE_AUTHORED_FIELD = "module_authored"

_TOKEN_RE = re.compile(r"[0-9A-Za-z]+")


def query_tokens(query: str) -> list[str]:
    return [token.casefold() for token in _TOKEN_RE.findall(str(query))]


def _normalized(text: Any) -> str:
    if not isinstance(text, str):
        return ""
    return " ".join(query_tokens(text))


def _pick(row: dict[str, Any], keys: tuple[str, ...]) -> dict[str, Any]:
    return {key: row[key] for key in keys if key in row}


def _record(*, kind: str, entity_id: str, name: str, table: str, summary: dict[str, Any],
            params: dict[str, Any] | None = None, aliases: list[str] | None = None,
            era: list[str] | None = None, localized_name: str | None = None,
            tags: list[str] | None = None, category: str | None = None,
            labels: list[str] | None = None, family_parameter_kind: str | None = None) -> dict[str, Any]:
    rec: dict[str, Any] = {
        "kind": kind, "entity_id": entity_id, "name": name, "localized_name": localized_name,
        "aliases": aliases or [], "labels": labels or [], "tags": tags or [], "category": category,
        "era": era or [], "secret": kind in SECRET_KINDS, "source": {"table": table},
        "summary": summary, "params": params or {},
    }
    if family_parameter_kind:
        rec[FAMILY_PARAMETER_KIND_FIELD] = family_parameter_kind
    return rec


class Catalog:
    def __init__(self, tables: RuleTables) -> None:
        self.tables = tables
        self._records: dict[str, list[dict[str, Any]]] = {}
        self._builders = {
            "weapon": self._weapons, "item": self._items, "spell": self._spells,
            "creature": self._creatures, "skill": self._skills, "vehicle": self._vehicles,
            "rule": self._rules, "artifact": self._artifacts, "tome": self._tomes,
            "poison": self._poisons, "occupation": self._occupations, "phobia": self._phobias,
            "mania": self._manias, "hazard": self._hazards,
        }

    @staticmethod
    def supported_kinds() -> tuple[str, ...]:
        return SUPPORTED_KINDS

    # ---- record builders --------------------------------------------------

    def _equipment_records(self) -> list[dict[str, Any]]:
        return self.tables.equipment_table()["records"]

    @staticmethod
    def _price_projection(row: dict[str, Any]) -> dict[str, Any]:
        price = row.get("price") if isinstance(row.get("price"), dict) else {}
        projection: dict[str, Any] = {"price_id": row.get("price_id"), "era": row.get("era"),
                                      "kind": price.get("kind"), "source_display": price.get("source_display"),
                                      "currency": price.get("currency")}
        for key in ("amount", "min", "max", "unit", "dice", "multiplier", "addend", "reason"):
            if key in price:
                projection[key] = price[key]
        return projection

    def _weapon_price_index(self) -> dict[str, list[dict[str, Any]]]:
        index: dict[str, list[dict[str, Any]]] = {}
        for row in self._equipment_records():
            if not isinstance(row, dict):
                continue
            ref = row.get("entity_ref") or {}
            if not isinstance(ref, dict) or ref.get("kind") != "weapon":
                continue
            entity_id = ref.get("entity_id")
            if isinstance(entity_id, str) and entity_id:
                index.setdefault(entity_id, []).append(row)
        return index

    def _weapons(self) -> list[dict[str, Any]]:
        table = self.tables.weapons_table()
        rows: list[dict[str, Any]] = []
        prices = self._weapon_price_index()
        for key, row in table.items():
            if not isinstance(row, dict):
                continue
            eras = [str(item) for item in row.get("eras") or [] if isinstance(item, str)]
            params = _pick(row, ("skill", "damage_die", "base_range_yards", "magazine", "malfunction",
                                 "impales", "adds_damage_bonus", "damage_type"))
            linked = prices.get(str(key)) or []
            if linked:
                params["price_ref"] = [str(item.get("price_id")) for item in linked]
                params["price_projection"] = [self._price_projection(item) for item in linked]
            rows.append(_record(kind="weapon", entity_id=str(key), name=str(row.get("display_name") or key),
                                table="weapons.json", aliases=[str(key)], era=eras,
                                summary=_pick(row, ("skill", "damage_die", "uses_per_round")), params=params))
        return rows

    def _items(self) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for row in self._equipment_records():
            if not isinstance(row, dict):
                continue
            price_id = str(row.get("price_id") or "")
            name = str(row.get("name") or "")
            if not price_id or not name:
                continue
            era_name = str(row.get("era") or "")
            category = str(row.get("category") or "") or None
            price = row.get("price") if isinstance(row.get("price"), dict) else {}
            params: dict[str, Any] = {"price_id": price_id, "category": category, "price": price,
                                      "provenance": row.get("provenance") or {}}
            ref = row.get("entity_ref")
            if isinstance(ref, dict) and ref:
                params["entity_ref"] = ref
            rows.append(_record(kind="item", entity_id=price_id, name=name, table="equipment.json",
                                era=[era_name] if era_name else [], category=category,
                                summary={"category": category, "price_kind": price.get("kind"),
                                         "source_display": price.get("source_display")}, params=params))
        return rows

    def _spells(self) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for row in self.tables.spells_table().get("spells") or []:
            if not isinstance(row, dict) or not str(row.get("name") or ""):
                continue
            name = str(row["name"])
            alts = [str(item) for item in row.get("alternative_names") or [] if isinstance(item, str)]
            rows.append(_record(kind="spell", entity_id=slug(name), name=name, table="spells.json", aliases=alts,
                                summary=_pick(row, ("cost_mp", "cost_sanity", "cost_pow")),
                                params=_pick(row, ("cost_mp", "cost_sanity", "cost_pow", "source_page")),
                                family_parameter_kind="creature"))
        return rows

    def _creatures(self) -> list[dict[str, Any]]:
        return [_record(kind="creature", entity_id=slug(name), name=str(name), table="monsters.json",
                        summary=_pick(row, ("hp", "armor", "mov")),
                        params=_pick(row, ("hp", "armor", "mov", "san_loss", "source_page")))
                for name, row in self.tables.monsters_table().items() if isinstance(row, dict)]

    def _skills(self) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for name, row in self.tables.skills_table().items():
            if not isinstance(row, dict):
                continue
            labels = row.get("localized_labels") if isinstance(row.get("localized_labels"), dict) else {}
            zh = labels.get("zh-Hans")
            rows.append(_record(kind="skill", entity_id=str(name), name=str(name), table="skills.json",
                                localized_name=zh if isinstance(zh, str) else None,
                                aliases=[str(v) for v in labels.values() if isinstance(v, str)],
                                era=["modern"] if row.get("modern_only") else [],
                                tags=["uncommon"] if row.get("uncommon") else [],
                                category=str(row.get("group") or "") or None,
                                summary=_pick(row, ("base_chance", "group", "modern_only", "uncommon")),
                                params=_pick(row, ("base_chance", "group", "modern_only", "uncommon"))))
        return rows

    def _vehicles(self) -> list[dict[str, Any]]:
        block = self.tables.chase_table().get("vehicles") or {}
        entries = block.get("entries") or {}
        reverse: dict[str, list[str]] = {}
        for alias, target in (block.get("aliases") or {}).items():
            reverse.setdefault(str(target), []).append(str(alias))
        rows: list[dict[str, Any]] = []
        for key, row in entries.items():
            if not isinstance(row, dict):
                continue
            name = str(row.get("label") or key)
            rows.append(_record(kind="vehicle", entity_id=str(key), name=name, table="chase.json",
                                aliases=reverse.get(str(key), []), labels=[name],
                                summary=_pick(row, ("mov", "build", "armor", "passengers")),
                                params=_pick(row, ("mov", "build", "armor", "passengers"))))
        return rows

    def _rules(self) -> list[dict[str, Any]]:
        return [_record(kind="rule", entity_id=row["id"], name=row["id"], table="rule-index.json",
                        category=str(row.get("category") or "") or None,
                        summary=_pick(row, ("category", "source_table")),
                        params=_pick(row, ("category", "source_table", "numeric", "source_note")))
                for row in self.tables.rule_index()]

    def _artifacts(self) -> list[dict[str, Any]]:
        return [_record(kind="artifact", entity_id=slug(name), name=str(name), table="artifacts.json",
                        summary=_pick(row, ("mechanics", "source_page")), params=_pick(row, ("mechanics", "source_page")))
                for name, row in self.tables.artifacts_table().items() if isinstance(row, dict)]

    def _tomes(self) -> list[dict[str, Any]]:
        return [_record(kind="tome", entity_id=slug(name), name=str(name), table="tomes.json",
                        summary=_pick(row, ("sanity_cost", "mythos_rating", "full_study_weeks")),
                        params=_pick(row, ("sanity_cost", "mythos_rating", "full_study_weeks",
                                           "cthulhu_mythos_initial", "cthulhu_mythos_full")))
                for name, row in self.tables.tomes_table().items() if isinstance(row, dict)]

    def _poisons(self) -> list[dict[str, Any]]:
        return [_record(kind="poison", entity_id=slug(name), name=str(name), table="poisons.json",
                        summary=_pick(row, ("potency", "damage_expr", "delivery")),
                        params=_pick(row, ("potency", "damage_expr", "delivery", "onset")))
                for name, row in self.tables.poisons_table().items() if isinstance(row, dict)]

    def _occupations(self) -> list[dict[str, Any]]:
        return [_record(kind="occupation", entity_id=str(name), name=str(name), table="occupations.json",
                        tags=[str(t) for t in row.get("tags") or [] if isinstance(t, str)],
                        summary=_pick(row, ("credit_rating_range", "skill_point_formula")),
                        params=_pick(row, ("credit_rating_range", "skill_point_formula", "occupational_skills")))
                for name, row in self.tables.occupations_table().items() if isinstance(row, dict)]

    def _phobias(self) -> list[dict[str, Any]]:
        return [_record(kind="phobia", entity_id=str(name), name=str(name), table="phobias.json",
                        tags=[str(t) for t in row.get("trigger_tags") or [] if isinstance(t, str)],
                        summary=_pick(row, ("trigger",)), params=_pick(row, ("trigger", "source_page")))
                for name, row in self.tables.phobias_table().items() if isinstance(row, dict)]

    def _manias(self) -> list[dict[str, Any]]:
        return [_record(kind="mania", entity_id=str(name), name=str(name), table="manias.json",
                        tags=[str(t) for t in row.get("trigger_tags") or [] if isinstance(t, str)],
                        summary=_pick(row, ("trigger",)), params=_pick(row, ("trigger", "source_page")))
                for name, row in self.tables.manias_table().items() if isinstance(row, dict)]

    def _hazards(self) -> list[dict[str, Any]]:
        presets = self.tables.hazards_table().get("presets") or {}
        return [_record(kind="hazard", entity_id=str(key), name=str(row.get("example") or key), table="hazards.json",
                        category=str(row.get("category") or "") or None,
                        summary=_pick(row, ("severity", "category")),
                        params=_pick(row, ("severity", "category", "suffocation")))
                for key, row in presets.items() if isinstance(row, dict)]

    def records(self, kinds: list[str] | tuple[str, ...] | None = None) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for kind in (list(kinds) if kinds else list(SUPPORTED_KINDS)):
            builder = self._builders.get(kind)
            if builder is None:
                continue
            if kind not in self._records:
                self._records[kind] = builder()
            out.extend(deepcopy(self._records[kind]))
        return out

    # ---- recall -----------------------------------------------------------

    def search(self, query: Any, *, kinds: Any = None, era: Any = None, limit: Any = None,
               module_spells: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        """Recall structured candidates. Never auto-selects a winner."""
        if not isinstance(query, str) or not query.strip():
            return _error("invalid_catalog_query", detail="query must be a non-empty string")
        query = query.strip()
        kinds_or_err = _normalize_kinds(kinds)
        if isinstance(kinds_or_err, dict):
            return kinds_or_err
        requested_kinds = kinds_or_err
        if era is not None and (not isinstance(era, str) or not era.strip()):
            return _error("invalid_catalog_era", detail="era must be a non-empty string when provided")
        era_value = era.strip() if isinstance(era, str) else None
        limit_or_err = _normalize_limit(limit)
        if isinstance(limit_or_err, dict):
            return limit_or_err
        bound = limit_or_err
        supported_set = set(SUPPORTED_KINDS)
        if requested_kinds:
            missing = [kind for kind in requested_kinds if kind not in supported_set]
            if missing:
                return _error("unsupported_catalog_kind", kinds=missing, supported_kinds=list(SUPPORTED_KINDS))
            load_kinds = requested_kinds
        else:
            load_kinds = list(SUPPORTED_KINDS)
        records = self.records(load_kinds)

        scored: list[tuple[tuple[int, str, str], dict[str, Any]]] = []
        matched_ids: set[str] = set()
        for record in records:
            if not _era_ok(record, era_value):
                continue
            reasons = _matches(query, _record_tokens(record), record)
            if not reasons:
                continue
            matched_ids.add(str(record.get("entity_id") or ""))
            scored.append((_rank(record, reasons), _dto(record, reasons)))

        family_resolution = {"hits": [], "gaps": []}
        declarations = _family_declarations(records)
        if declarations:
            extra_kinds = sorted({row["parameter_kind"] for row in declarations} - set(load_kinds))
            pool = list(records)
            supported_extra = [k for k in extra_kinds if k in supported_set]
            if supported_extra:
                pool.extend(self.records(supported_extra))
            family_resolution = resolve_family_parameter(query, pool)
        for hit in family_resolution["hits"]:
            record = hit["family"]
            if not _era_ok(record, era_value) or str(record.get("entity_id") or "") in matched_ids:
                continue
            reasons = ["family_parameter", f"parameter:{hit['parameter'].get('entity_id')}"]
            scored.append((_rank(record, reasons), _dto(record, reasons, _parameterisation(hit))))

        for record in _module_records(module_spells, load_kinds):
            if not _era_ok(record, era_value):
                continue
            reasons = _module_matches(query, record)
            if reasons:
                scored.append((_rank(record, reasons), _module_dto(record, reasons)))

        scored.sort(key=lambda item: item[0])
        candidates = _mark_shadowed([item[1] for item in scored[:bound]])
        gaps = ([] if any("exact_name" in row["match_reasons"] or "exact_id" in row["match_reasons"]
                          for row in candidates) else family_resolution["gaps"])
        return {
            "ok": True, "query": query, "kinds": load_kinds, "era": era_value, "limit": bound,
            "ruleset_id": "coc7", "selected": None, "candidate_count": len(candidates),
            "truncated": len(scored) > bound, "candidates": candidates,
            "unresolved_family_parameters": [
                {"family_name": row["family"].get("name"), "family_entity_id": row["family"].get("entity_id"),
                 "parameter_kind": row["parameter_kind"], "parameter_query": row["parameter_query"]}
                for row in gaps
            ],
        }

    def resolve_name(self, kind: Any, name: Any, *,
                     module_spells: list[dict[str, Any]] | None = None) -> dict[str, Any] | None:
        """Resolve one authored `kind` name across both namespaces; the rulebook wins."""
        if not isinstance(kind, str) or not kind.strip() or not isinstance(name, str) or not name.strip():
            return None
        kind = kind.strip()
        name = name.strip()
        result = self.search(name, kinds=[kind], limit=MAX_LIMIT, module_spells=module_spells)
        if not result.get("ok"):
            return None
        fold = name.casefold()
        module_hit: dict[str, Any] | None = None
        for candidate in result["candidates"]:
            block = candidate.get(MODULE_AUTHORED_FIELD)
            if isinstance(block, dict):
                if (module_hit is None and block.get("authority") == "module_authored_spell"
                        and _module_names_it(candidate, fold)):
                    module_hit = candidate
                continue
            parameterisation = candidate.get("parameterisation")
            if parameterisation is not None:
                if str(parameterisation.get("requested_name") or "").casefold() == fold:
                    return {"canonical_name": str(parameterisation["canonical_name"]), "record": candidate,
                            "parameterisation": parameterisation, "module_authored": None}
                continue
            if str(candidate.get("name") or "").casefold() == fold:
                return {"canonical_name": str(candidate.get("name")), "record": candidate,
                        "parameterisation": None, "module_authored": _annotation(result["candidates"], fold)}
        if module_hit is not None:
            return {"canonical_name": str(module_hit.get("name")), "record": module_hit,
                    "parameterisation": None, "module_authored": deepcopy(module_hit[MODULE_AUTHORED_FIELD])}
        return None


# ---- query helpers --------------------------------------------------------------

def _error(code: str, **fields: Any) -> dict[str, Any]:
    return {"ok": False, "error": {"code": code, **fields}}


def _normalize_kinds(kinds: Any) -> list[str] | dict[str, Any]:
    if kinds is None:
        return []
    if isinstance(kinds, str):
        kinds = [kinds]
    if not isinstance(kinds, (list, tuple)):
        return _error("invalid_catalog_kinds", detail="kinds must be a list of strings")
    out: list[str] = []
    for kind in kinds:
        if not isinstance(kind, str) or not kind.strip():
            return _error("invalid_catalog_kinds", detail="each kind must be a non-empty string")
        if kind.strip() not in out:
            out.append(kind.strip())
    return out


def _normalize_limit(limit: Any) -> int | dict[str, Any]:
    if limit is None:
        return DEFAULT_LIMIT
    if isinstance(limit, bool) or not isinstance(limit, int):
        return _error("invalid_catalog_limit", detail="limit must be an integer")
    if limit < MIN_LIMIT or limit > MAX_LIMIT:
        return _error("invalid_catalog_limit", detail=f"limit must be between {MIN_LIMIT} and {MAX_LIMIT}")
    return limit


def _record_tokens(record: dict[str, Any]) -> list[str]:
    parts: list[str] = []
    for key in ("entity_id", "name", "localized_name"):
        value = record.get(key)
        if isinstance(value, str):
            parts.append(value)
    for key in ("aliases", "labels", "tags"):
        values = record.get(key)
        if isinstance(values, list):
            parts.extend(str(item) for item in values if isinstance(item, (str, int)))
    if isinstance(record.get("category"), str):
        parts.append(record["category"])
    tokens: list[str] = []
    seen: set[str] = set()
    for part in parts:
        for token in query_tokens(part):
            if token not in seen:
                seen.add(token)
                tokens.append(token)
    return tokens


def _matches(query: str, tokens: list[str], record: dict[str, Any]) -> list[str]:
    reasons: list[str] = []
    q_fold = query.strip().casefold()
    if str(record.get("entity_id") or "").casefold() == q_fold:
        reasons.append("exact_id")
    if str(record.get("name") or "").casefold() == q_fold:
        reasons.append("exact_name")
    # The zh-Hans label is what a Keeper playing in Chinese will type; token
    # recall only sees ASCII, so an exact localized hit is its own reason.
    if str(record.get("localized_name") or "").casefold() == q_fold and q_fold:
        reasons.append("exact_localized_name")
    q_tokens = query_tokens(query)
    if q_tokens and set(q_tokens) <= set(tokens):
        reasons.extend(f"token:{token}" for token in q_tokens)
    return reasons


def _rank(record: dict[str, Any], reasons: list[str]) -> tuple[int, str, int, str]:
    exact = 0 if ("exact_id" in reasons or "exact_name" in reasons or "exact_localized_name" in reasons) else 1
    # The rulebook row lists before a module node of the same rank: it is the one that
    # prices the entry; the module node is its annotation.
    module = 1 if isinstance(record.get(MODULE_AUTHORED_FIELD), dict) else 0
    return (exact, str(record.get("kind") or ""), module, str(record.get("entity_id") or ""))


def _era_ok(record: dict[str, Any], era: str | None) -> bool:
    if era is None:
        return True
    eras = record.get("era")
    if not isinstance(eras, list) or not eras:
        return True
    return era in eras


def _family_stem(kind: str, label: Any) -> str | None:
    if not isinstance(label, str) or not isinstance(kind, str) or not kind:
        return None
    parts = label.split()
    if len(parts) < 2 or parts[-1].casefold() != f"{kind}s".casefold():
        return None
    stem = " ".join(parts[:-1]).strip()
    return stem or None


def _family_declarations(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for record in records:
        parameter_kind = record.get(FAMILY_PARAMETER_KIND_FIELD)
        if not isinstance(parameter_kind, str) or not parameter_kind:
            continue
        kind = str(record.get("kind") or "")
        stems: list[str] = []
        for label in [record.get("name"), *(record.get("aliases") or [])]:
            stem = _family_stem(kind, label)
            if stem and stem not in stems:
                stems.append(stem)
        if stems:
            out.append({"record": record, "stems": stems, "parameter_kind": parameter_kind})
    return out


def _parameter_index(records: list[dict[str, Any]], kind: str) -> dict[str, dict[str, Any]]:
    index: dict[str, dict[str, Any]] = {}
    for record in records:
        if str(record.get("kind") or "") != kind:
            continue
        for label in [record.get("name"), record.get("entity_id"), *(record.get("aliases") or [])]:
            key = _normalized(label)
            if key:
                index.setdefault(key, record)
    return index


def resolve_family_parameter(query: str, records: list[dict[str, Any]]) -> dict[str, Any]:
    """Match `<family stem> <parameter>`; the longest stem wins. A stem whose parameter
    matches no row of the declared kind is a reported gap, never an invented entry."""
    q_norm = _normalized(query)
    if not q_norm:
        return {"hits": [], "gaps": []}
    indexes: dict[str, dict[str, dict[str, Any]]] = {}
    hits: list[dict[str, Any]] = []
    gaps: list[dict[str, Any]] = []
    for declaration in _family_declarations(records):
        parameter_kind = declaration["parameter_kind"]
        if parameter_kind not in indexes:
            indexes[parameter_kind] = _parameter_index(records, parameter_kind)
        for stem in declaration["stems"]:
            stem_norm = _normalized(stem)
            if not stem_norm or not q_norm.startswith(stem_norm + " "):
                continue
            remainder = q_norm[len(stem_norm) + 1:].strip()
            if not remainder:
                continue
            row = {"stem": stem, "stem_length": len(stem_norm), "family": declaration["record"],
                   "parameter_kind": parameter_kind, "parameter_query": remainder, "requested_name": query}
            parameter = indexes[parameter_kind].get(remainder)
            if parameter is None:
                gaps.append(row)
                continue
            row["parameter"] = parameter
            row["canonical_name"] = f"{declaration['stems'][0]} {parameter.get('name')}"
            hits.append(row)
    if hits:
        longest = max(row["stem_length"] for row in hits)
        return {"hits": [row for row in hits if row["stem_length"] == longest], "gaps": []}
    if gaps:
        longest = max(row["stem_length"] for row in gaps)
        gaps = [row for row in gaps if row["stem_length"] == longest]
    return {"hits": [], "gaps": gaps}


def _parameterisation(hit: dict[str, Any]) -> dict[str, Any]:
    family = hit["family"]
    parameter = hit["parameter"]
    return {
        "canonical_name": hit["canonical_name"], "requested_name": hit["requested_name"],
        "family_name": family.get("name"), "family_entity_id": family.get("entity_id"),
        "parameter": {"kind": hit["parameter_kind"], "entity_id": parameter.get("entity_id"),
                      "name": parameter.get("name")},
        "note": (f"{hit['canonical_name']} is the catalogue family {family.get('name')!r} bound to the "
                 f"{hit['parameter_kind']} {parameter.get('name')!r}; it is not a separate catalogue entry. "
                 "Learn and cast it under canonical_name."),
    }


def _dto(record: dict[str, Any], reasons: list[str],
         parameterisation: dict[str, Any] | None = None) -> dict[str, Any]:
    source = record.get("source") if isinstance(record.get("source"), dict) else {}
    localized = record.get("localized_name")
    dto: dict[str, Any] = {
        "kind": record.get("kind"), "entity_id": record.get("entity_id"), "name": record.get("name"),
        "localized_name": localized if isinstance(localized, str) else None,
        "aliases": [a for a in (record.get("aliases") or []) if isinstance(a, str)],
        "era": [e for e in (record.get("era") or []) if isinstance(e, str)],
        "secret": bool(record.get("secret")),
        "source": {"table": source.get("table")},
        "summary": record.get("summary") if isinstance(record.get("summary"), dict) else {},
        "params": record.get("params") if isinstance(record.get("params"), dict) else {},
        "match_reasons": list(reasons),
    }
    if parameterisation is not None:
        dto["parameterisation"] = parameterisation
    return dto


def _module_records(module_spells: Any, load_kinds: list[str]) -> list[dict[str, Any]]:
    if not isinstance(module_spells, list):
        return []
    wanted = set(load_kinds)
    return [record for record in module_spells
            if isinstance(record, dict) and isinstance(record.get(MODULE_AUTHORED_FIELD), dict)
            and str(record.get("kind") or "") in wanted]


def _module_matches(query: str, record: dict[str, Any]) -> list[str]:
    reasons = _matches(query, _record_tokens(record), record)
    q_fold = query.strip().casefold()
    for alias in record.get("aliases") or []:
        if isinstance(alias, str) and alias.casefold() == q_fold:
            reasons.insert(0, "exact_alias")
            break
    return reasons


def _module_dto(record: dict[str, Any], reasons: list[str]) -> dict[str, Any]:
    dto = _dto(record, reasons)
    block = record.get(MODULE_AUTHORED_FIELD)
    dto[MODULE_AUTHORED_FIELD] = deepcopy(block) if isinstance(block, dict) else {}
    return dto


def demoted_module_block(record: dict[str, Any]) -> dict[str, Any] | None:
    block = record.get(MODULE_AUTHORED_FIELD)
    if not isinstance(block, dict):
        return None
    demoted = deepcopy(block)
    demoted["authority"] = "module_annotation"
    demoted["note"] = (f"the module also authors {demoted.get('node_id')!r} under this name. The ruleset "
                       "catalogue row resolves and prices the entry; this node is the module's annotation on "
                       "it — read its properties and source_refs, not its costs.")
    return demoted


def module_record_named(module_spells: Any, name: str) -> dict[str, Any] | None:
    if not isinstance(module_spells, list):
        return None
    fold = name.strip().casefold()
    for record in module_spells:
        if (isinstance(record, dict) and isinstance(record.get(MODULE_AUTHORED_FIELD), dict)
                and str(record.get("name") or "").casefold() == fold):
            return record
    return None


def _mark_shadowed(candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    catalog_names = {str(row.get("name") or "").casefold() for row in candidates
                     if not isinstance(row.get(MODULE_AUTHORED_FIELD), dict)}
    catalog_names.discard("")
    for row in candidates:
        if isinstance(row.get(MODULE_AUTHORED_FIELD), dict) and str(row.get("name") or "").casefold() in catalog_names:
            row[MODULE_AUTHORED_FIELD] = demoted_module_block(row)
    return candidates


def _module_names_it(candidate: dict[str, Any], fold: str) -> bool:
    if str(candidate.get("name") or "").casefold() == fold:
        return True
    return any(isinstance(alias, str) and alias.casefold() == fold for alias in candidate.get("aliases") or [])


def _annotation(candidates: list[dict[str, Any]], fold: str) -> dict[str, Any] | None:
    for candidate in candidates:
        block = candidate.get(MODULE_AUTHORED_FIELD)
        if isinstance(block, dict) and str(candidate.get("name") or "").casefold() == fold:
            return deepcopy(block)
    return None


# ---- the module's own spell namespace -------------------------------------------

_SPELL_COST_FIELDS = ("cost_mp", "cost_sanity")


def module_spell_records(graph: Any) -> list[dict[str, Any]]:
    """Records for the module graph's `spell` nodes, shaped like catalog rows.

    Costs come only from the node's properties (`cost_mp`, `cost_sanity`, `cost_pow`);
    a node that prices nothing is recorded as unpriced so casting refuses instead of
    reading an absent cost as zero."""
    out: list[dict[str, Any]] = []
    for node in graph.by_kind.get("spell", []):
        props = node.get("properties") or {}
        fields = {key: props[key] for key in ("cost_mp", "cost_sanity", "cost_pow") if key in props}
        missing = [key for key in _SPELL_COST_FIELDS if key not in fields]
        name = str(node.get("name") or graph.handle(node))
        out.append({
            "kind": "spell", "entity_id": graph.handle(node), "name": name, "localized_name": None,
            "aliases": [str(a) for a in node.get("aliases") or [] if isinstance(a, str)],
            "labels": [], "tags": [], "category": None, "era": [], "secret": True,
            "source": {"table": "module-graph"}, "summary": {"summary": node.get("summary")},
            "params": deepcopy(props),
            MODULE_AUTHORED_FIELD: {
                "authority": "module_authored_spell", "node_id": node["node_id"], "module_id": graph.module_id,
                "summary": node.get("summary"), "runtime_rule_ref": props.get("runtime_rule_ref"),
                "costs": {"authored": not missing, "fields": fields, "missing": missing},
            },
        })
    return out
