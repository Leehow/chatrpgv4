#!/usr/bin/env python3
"""Ruleset-agnostic catalog candidate recall (catalog-core).

Canonical table bytes stay in ``rulesets/<id>/rules-json/**``. This module
only validates query inputs, asks the active resolver for already-shaped
catalog records, and applies deterministic structured-token recall. It never
selects a winner and never projects player-safe views.

Parameterised families
----------------------
Some catalogues print one entry for a whole family of entities and leave the
member as a parameter of the name: CoC7 writes ``Summon/Bind Spells`` once and
content names ``Summon/Bind Dimensional Shambler``. Two structural facts, not a
list of names, make that resolvable here:

* a family entry names itself with the plural head of its own kind
  (``... Spells`` for ``kind="spell"``), so its stem is the name without that
  head word — ``Summon/Bind``, ``Contact``, ``Contact Deity``;
* the ruleset package declares, per record, which catalog *kind* the parameter
  is drawn from (``family_parameter_kind``), so the parameter is validated
  against real catalogue rows of that kind rather than against anything written
  in this module.

A parameter that no catalogue row matches is a content gap: the family is not
offered as a candidate and the query is reported in
``unresolved_family_parameters`` instead of being papered over.
"""
from __future__ import annotations

import re
from typing import Any

import coc_rulesets

DEFAULT_LIMIT = 20
MIN_LIMIT = 1
MAX_LIMIT = 50

_TOKEN_RE = re.compile(r"[0-9A-Za-z]+")


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
    seen: set[str] = set()
    for kind in kinds:
        if not isinstance(kind, str) or not kind.strip():
            return _error("invalid_catalog_kinds", detail="each kind must be a non-empty string")
        key = kind.strip()
        if key not in seen:
            seen.add(key)
            out.append(key)
    return out


def _normalize_limit(limit: Any) -> int | dict[str, Any]:
    if limit is None:
        return DEFAULT_LIMIT
    if isinstance(limit, bool) or not isinstance(limit, int):
        return _error("invalid_catalog_limit", detail="limit must be an integer")
    if limit < MIN_LIMIT or limit > MAX_LIMIT:
        return _error(
            "invalid_catalog_limit",
            detail=f"limit must be between {MIN_LIMIT} and {MAX_LIMIT}",
        )
    return limit


def query_tokens(query: str) -> list[str]:
    """Deterministic tokens from ID/name-like query text (digits kept)."""
    return [token.casefold() for token in _TOKEN_RE.findall(query)]


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
    category = record.get("category")
    if isinstance(category, str):
        parts.append(category)
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
    q = query.strip()
    q_fold = q.casefold()
    entity_id = str(record.get("entity_id") or "")
    name = str(record.get("name") or "")
    if entity_id.casefold() == q_fold:
        reasons.append("exact_id")
    if name.casefold() == q_fold:
        reasons.append("exact_name")
    q_tokens = query_tokens(q)
    record_token_set = set(tokens)
    if q_tokens and set(q_tokens) <= record_token_set:
        for token in q_tokens:
            reasons.append(f"token:{token}")
    return reasons


def _rank(record: dict[str, Any], reasons: list[str]) -> tuple[int, str, str]:
    exact_id = 0 if "exact_id" in reasons else 1
    return (exact_id, str(record.get("kind") or ""), str(record.get("entity_id") or ""))


def _era_ok(record: dict[str, Any], era: str | None) -> bool:
    if era is None:
        return True
    eras = record.get("era")
    if not isinstance(eras, list) or not eras:
        return True
    return era in eras


# ---------------------------------------------------------------------------
# Parameterised family recall
# ---------------------------------------------------------------------------

#: Record field a ruleset package sets to declare that this entry may be a
#: family whose name carries one parameter drawn from the named catalog kind.
FAMILY_PARAMETER_KIND_FIELD = "family_parameter_kind"


def _normalized(text: Any) -> str:
    """Structured-token normal form; ``Mi-Go`` and ``mi_go`` collapse alike."""
    if not isinstance(text, str):
        return ""
    return " ".join(query_tokens(text))


def _family_stem(kind: str, label: Any) -> str | None:
    """The stem of a family label, or None when the label names one entity.

    A catalogue family names itself with the plural head word of its own kind
    (``Summon/Bind Spells`` for ``kind="spell"``). Dropping that head word
    leaves the stem that authored content prefixes onto the parameter. This
    reads the record's own ``kind``; no family name is written down here.
    """
    if not isinstance(label, str) or not isinstance(kind, str) or not kind:
        return None
    parts = label.split()
    if len(parts) < 2:
        return None
    if parts[-1].casefold() != f"{kind}s".casefold():
        return None
    stem = " ".join(parts[:-1]).strip()
    return stem or None


def _family_declarations(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Every record that declares a parameter kind and reads as a family."""
    out: list[dict[str, Any]] = []
    for record in records:
        if not isinstance(record, dict):
            continue
        parameter_kind = record.get(FAMILY_PARAMETER_KIND_FIELD)
        if not isinstance(parameter_kind, str) or not parameter_kind:
            continue
        kind = str(record.get("kind") or "")
        stems: list[str] = []
        labels = [record.get("name")]
        aliases = record.get("aliases")
        if isinstance(aliases, list):
            labels.extend(aliases)
        for label in labels:
            stem = _family_stem(kind, label)
            if stem and stem not in stems:
                stems.append(stem)
        if stems:
            out.append({
                "record": record,
                "stems": stems,
                "parameter_kind": parameter_kind,
            })
    return out


def _parameter_index(
    records: list[dict[str, Any]], kind: str
) -> dict[str, dict[str, Any]]:
    index: dict[str, dict[str, Any]] = {}
    for record in records:
        if not isinstance(record, dict) or str(record.get("kind") or "") != kind:
            continue
        labels = [record.get("name"), record.get("entity_id")]
        aliases = record.get("aliases")
        if isinstance(aliases, list):
            labels.extend(aliases)
        for label in labels:
            key = _normalized(label)
            if key:
                index.setdefault(key, record)
    return index


def resolve_family_parameter(
    query: str,
    records: list[dict[str, Any]],
) -> dict[str, Any]:
    """Match ``query`` as ``<family stem> <parameter>`` against ``records``.

    Returns ``{"hits": [...], "gaps": [...]}``. A hit carries the family record
    and the catalogue row its parameter resolved to; a gap is a query whose
    stem named a family but whose parameter matches no catalogue row of the
    declared kind — a content gap to report, never to invent an entry for.

    The longest stem wins: ``Contact Deity Nyarlathotep`` belongs to
    ``Contact Deity Spells``, not to ``Contact Spells`` carrying a parameter
    that happens to begin with the word "Deity".
    """
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
        index = indexes[parameter_kind]
        for stem in declaration["stems"]:
            stem_norm = _normalized(stem)
            if not stem_norm or not q_norm.startswith(stem_norm + " "):
                continue
            remainder = q_norm[len(stem_norm) + 1:].strip()
            if not remainder:
                continue
            record = declaration["record"]
            row = {
                "stem": stem,
                "stem_length": len(stem_norm),
                "family": record,
                "parameter_kind": parameter_kind,
                "parameter_query": remainder,
                "requested_name": query,
            }
            parameter = index.get(remainder)
            if parameter is None:
                gaps.append(row)
                continue
            row["parameter"] = parameter
            # The family's own primary stem, not whichever alias the query
            # used: "Summoning Byakhee" and "Summon/Bind Byakhee" are one
            # spell, so they must canonicalise to one persisted name.
            row["canonical_name"] = (
                f"{declaration['stems'][0]} {parameter.get('name')}"
            )
            hits.append(row)
    if hits:
        longest = max(row["stem_length"] for row in hits)
        return {
            "hits": [row for row in hits if row["stem_length"] == longest],
            "gaps": [],
        }
    if gaps:
        longest = max(row["stem_length"] for row in gaps)
        gaps = [row for row in gaps if row["stem_length"] == longest]
    return {"hits": [], "gaps": gaps}


def _parameterisation(hit: dict[str, Any]) -> dict[str, Any]:
    """The explicit family-plus-parameter relationship a Keeper reads."""
    family = hit["family"]
    parameter = hit["parameter"]
    return {
        "canonical_name": hit["canonical_name"],
        "requested_name": hit["requested_name"],
        "family_name": family.get("name"),
        "family_entity_id": family.get("entity_id"),
        "parameter": {
            "kind": hit["parameter_kind"],
            "entity_id": parameter.get("entity_id"),
            "name": parameter.get("name"),
        },
        "note": (
            f"{hit['canonical_name']} is the catalogue family "
            f"{family.get('name')!r} bound to the "
            f"{hit['parameter_kind']} {parameter.get('name')!r}; it is not a "
            "separate catalogue entry. Learn and cast it under canonical_name."
        ),
    }


def _dto(
    record: dict[str, Any],
    reasons: list[str],
    parameterisation: dict[str, Any] | None = None,
) -> dict[str, Any]:
    aliases = record.get("aliases") if isinstance(record.get("aliases"), list) else []
    era = record.get("era") if isinstance(record.get("era"), list) else []
    source = record.get("source") if isinstance(record.get("source"), dict) else {}
    summary = record.get("summary") if isinstance(record.get("summary"), dict) else {}
    params = record.get("params") if isinstance(record.get("params"), dict) else {}
    localized = record.get("localized_name")
    dto: dict[str, Any] = {
        "kind": record.get("kind"),
        "entity_id": record.get("entity_id"),
        "name": record.get("name"),
        "localized_name": localized if isinstance(localized, str) else None,
        "aliases": [item for item in aliases if isinstance(item, str)],
        "era": [item for item in era if isinstance(item, str)],
        "secret": bool(record.get("secret")),
        "source": {"table": source.get("table")} if source.get("table") else {"table": None},
        "summary": summary,
        "params": params,
        "match_reasons": list(reasons),
    }
    if parameterisation is not None:
        # Present only on a family candidate reached through a
        # parameterised name, so an ordinary row's shape is unchanged and
        # the key's presence is itself the signal.
        dto["parameterisation"] = parameterisation
    return dto


def _capability_names(index: Any) -> set[str]:
    if isinstance(index, dict):
        return {str(key) for key in index}
    if isinstance(index, list):
        return {str(item) for item in index}
    return set()


def search_catalog(
    *,
    query: Any,
    kinds: Any = None,
    era: Any = None,
    limit: Any = None,
    ruleset_id: str | None = None,
    campaign: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Recall structured catalog candidates. Never auto-selects a winner."""
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

    if campaign is None and ruleset_id is not None:
        campaign = {"ruleset_id": ruleset_id}
    try:
        active_id = coc_rulesets.get_campaign_ruleset_id(campaign)
        resolver = coc_rulesets.get_resolver(campaign)
        advertised = _capability_names(resolver.public_api_index())
    except ValueError as exc:
        return _error("unknown_ruleset", detail=str(exc))

    if "catalog_search" not in advertised or not callable(getattr(resolver, "catalog_records", None)):
        return _error(
            "unsupported_ruleset_operation",
            operation="catalog_search",
            ruleset_id=active_id,
        )

    if not callable(getattr(resolver, "catalog_supported_kinds", None)):
        return _error(
            "unsupported_ruleset_operation",
            operation="catalog_search",
            ruleset_id=active_id,
        )
    supported = list(resolver.catalog_supported_kinds())
    supported_set = {str(item) for item in supported}

    if requested_kinds:
        missing = [kind for kind in requested_kinds if kind not in supported_set]
        if missing:
            return _error(
                "unsupported_catalog_kind",
                kinds=missing,
                supported_kinds=list(supported),
                ruleset_id=active_id,
            )
        load_kinds = requested_kinds
    else:
        load_kinds = list(supported)

    try:
        records = resolver.catalog_records(load_kinds)
    except Exception as exc:
        return _error("catalog_adapter_failed", detail=str(exc), ruleset_id=active_id)
    if not isinstance(records, list):
        return _error("catalog_adapter_failed", detail="catalog_records must return a list")

    scored: list[tuple[tuple[int, str, str], dict[str, Any]]] = []
    matched_ids: set[str] = set()
    for record in records:
        if not isinstance(record, dict):
            continue
        if not _era_ok(record, era_value):
            continue
        tokens = _record_tokens(record)
        reasons = _matches(query, tokens, record)
        if not reasons:
            continue
        matched_ids.add(str(record.get("entity_id") or ""))
        scored.append((_rank(record, reasons), _dto(record, reasons)))

    # A parameterised family name ("Summon/Bind Dimensional Shambler") shares no
    # token set with its family row, so plain recall can never reach it. Resolve
    # it against the catalogue's own rows: the parameter kind each family
    # declares must also be loaded, even when the caller filtered it out.
    family_resolution = {"hits": [], "gaps": []}
    declarations = _family_declarations(records)
    if declarations:
        extra_kinds = sorted(
            {row["parameter_kind"] for row in declarations}
            - set(load_kinds)
        )
        pool = list(records)
        if extra_kinds:
            supported_extra = [k for k in extra_kinds if k in supported_set]
            if supported_extra:
                try:
                    extra = resolver.catalog_records(supported_extra)
                except Exception as exc:
                    return _error(
                        "catalog_adapter_failed", detail=str(exc), ruleset_id=active_id
                    )
                if isinstance(extra, list):
                    pool.extend(row for row in extra if isinstance(row, dict))
        family_resolution = resolve_family_parameter(query, pool)
    for hit in family_resolution["hits"]:
        record = hit["family"]
        if not _era_ok(record, era_value):
            continue
        if str(record.get("entity_id") or "") in matched_ids:
            continue
        reasons = ["family_parameter", f"parameter:{hit['parameter'].get('entity_id')}"]
        scored.append((
            _rank(record, reasons),
            _dto(record, reasons, _parameterisation(hit)),
        ))

    scored.sort(key=lambda item: item[0])
    candidates = [item[1] for item in scored[:bound]]
    # A family's own name ("Contact Deity Spells") also reads as a shorter
    # family's stem over the parameter "Spells"; that is not a content gap, so
    # a query the catalogue named outright reports none.
    gaps = (
        []
        if any(
            "exact_name" in row["match_reasons"] or "exact_id" in row["match_reasons"]
            for row in candidates
        )
        else family_resolution["gaps"]
    )
    return {
        "ok": True,
        "query": query,
        "kinds": load_kinds,
        "era": era_value,
        "limit": bound,
        "ruleset_id": active_id,
        "selected": None,
        "candidate_count": len(candidates),
        "truncated": len(scored) > bound,
        "candidates": candidates,
        # A stem that named a family over a parameter no catalogue row carries.
        # Reported, never invented: this is a content gap in the query, not a
        # spell the Keeper may quietly settle.
        "unresolved_family_parameters": [
            {
                "family_name": row["family"].get("name"),
                "family_entity_id": row["family"].get("entity_id"),
                "parameter_kind": row["parameter_kind"],
                "parameter_query": row["parameter_query"],
            }
            for row in gaps
        ],
    }


def resolve_name(
    *,
    kind: Any,
    name: Any,
    ruleset_id: str | None = None,
    campaign: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """Resolve one authored ``kind`` name, following parameterised families.

    Returns ``None`` when the name is neither a catalogue row nor a family bound
    to a catalogue parameter. On success:

    ``{"canonical_name", "record", "parameterisation" | None}``

    ``canonical_name`` is what callers must persist and compare on: for a plain
    row it is the row's own name, and for a parameterised family it is the
    family stem over the parameter's catalogue name — the family name alone
    would lose which entity the name was bound to.
    """
    if not isinstance(kind, str) or not kind.strip():
        return None
    if not isinstance(name, str) or not name.strip():
        return None
    kind = kind.strip()
    name = name.strip()
    result = search_catalog(
        query=name, kinds=[kind], limit=MAX_LIMIT,
        ruleset_id=ruleset_id, campaign=campaign,
    )
    if not result.get("ok"):
        return None
    fold = name.casefold()
    for candidate in result["candidates"]:
        parameterisation = candidate.get("parameterisation")
        if parameterisation is not None:
            if str(parameterisation.get("requested_name") or "").casefold() == fold:
                return {
                    "canonical_name": str(parameterisation["canonical_name"]),
                    "record": candidate,
                    "parameterisation": parameterisation,
                }
            continue
        if str(candidate.get("name") or "").casefold() == fold:
            return {
                "canonical_name": str(candidate.get("name")),
                "record": candidate,
                "parameterisation": None,
            }
    return None
