#!/usr/bin/env python3
"""Ruleset-agnostic catalog candidate recall (catalog-core).

Canonical table bytes stay in ``rulesets/<id>/rules-json/**``. This module
only validates query inputs, asks the active resolver for already-shaped
catalog records, and applies deterministic structured-token recall. It never
selects a winner and never projects player-safe views.
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


def _dto(record: dict[str, Any], reasons: list[str]) -> dict[str, Any]:
    aliases = record.get("aliases") if isinstance(record.get("aliases"), list) else []
    era = record.get("era") if isinstance(record.get("era"), list) else []
    source = record.get("source") if isinstance(record.get("source"), dict) else {}
    summary = record.get("summary") if isinstance(record.get("summary"), dict) else {}
    params = record.get("params") if isinstance(record.get("params"), dict) else {}
    localized = record.get("localized_name")
    return {
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
    for record in records:
        if not isinstance(record, dict):
            continue
        if not _era_ok(record, era_value):
            continue
        tokens = _record_tokens(record)
        reasons = _matches(query, tokens, record)
        if not reasons:
            continue
        scored.append((_rank(record, reasons), _dto(record, reasons)))

    scored.sort(key=lambda item: item[0])
    candidates = [item[1] for item in scored[:bound]]
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
    }
