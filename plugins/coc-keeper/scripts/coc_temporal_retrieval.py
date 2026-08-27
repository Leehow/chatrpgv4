#!/usr/bin/env python3
"""Deterministic temporal-memory retrieval core (narrow -> rank -> project).

Data retrieval only. This module never decides semantic relevance, never
inspects free-prose ``statement`` text, and never performs keyword or
phrase matching: every filter consumes structured fields only
(subject/knowers, exact timeline, bitemporal turn intervals, privacy,
entity-id sets, scene id, assertion kinds). Relevance judgement stays
with the KP (Semantic Matcher Constitution); ranking weights are data,
not meaning.

Three bounded projection tiers over one shared narrowing core:

- ``hot``  -- nearest projection of the exact timeline (session resume):
  newest currently-effective assertions, newest-first.
- ``warm`` -- deterministic index narrowing by subject / entities / scene /
  time / privacy, ranked by structured entity overlap + scene hit +
  explicit salience + recency.
- ``cold`` -- archive tier: ``summary`` assertions (auditable compression
  with ``covers_commits``) plus superseded/closed assertions. The valid-time
  anchor is intentionally relaxed here; each row carries its own interval.

Every candidate carries machine-attached source refs (source_commit /
source_turn / source_receipts / covers_commits / superseded_by) for exact
drill-down. Commit SHAs remain machine-internal integrity evidence: models
are never asked to transcribe them.

Input trust boundary: every assertion row is contract-validated
(``contract.validate_assertion``) before any filtering or ranking.
Malformed rows fail closed — excluded from every tier and every view
(invalid privacy/valid-time/scope/provenance can never leak into a player
projection or corrupt narrowing) — and reported as explicit diagnostics,
never silently dropped. Cross-campaign (None-scope) rows additionally
require an explicit validated identity binding before entering a
campaign-pinned recall.

Privacy law: a player view (``privacy="player_safe"``) returns only rows
whose own ``privacy`` is exactly ``player_safe``; keeper-only (and any
system-only) rows are never exposed to the player view by construction.

Pure functions over in-memory data: no filesystem, no Git, no SQLite, no
wall-clock. Identical inputs produce identical outputs.
"""
from __future__ import annotations

import re
import sys
from collections.abc import Iterable, Mapping
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import coc_temporal_memory_contract as contract

SCHEMA_GENERATION = contract.SCHEMA_GENERATION
AUTHORITY = "advisory"

# Viewer scopes. "keeper" is the full keeper view; "player_safe" is the
# deterministic player-safe projection (only rows whose own privacy is
# exactly player_safe pass).
VIEWS: tuple[str, ...] = ("player_safe", "keeper")

DEFAULT_HOT_BUDGET = 8
DEFAULT_WARM_LIMIT = 12
DEFAULT_COLD_BUDGET = 8
MIN_LIMIT = 1
MAX_LIMIT = 64

# Ranking weights (data only; KP owns relevance).
ENTITY_WEIGHT = 4.0
SCENE_WEIGHT = 2.0
SALIENCE_WEIGHT = 2.0
RECENCY_WEIGHT = 1.0
# Recency horizon: a memory recorded >= this many turns before the anchor
# scores 0.0 recency; recorded at the anchor scores 1.0.
RECENCY_TURN_SPAN = 20

MAX_ID_CHARS = 128
_SCENE_ID_RE = re.compile(r"^[a-z0-9][a-z0-9._:-]*$")

CONTEXT_FIELDS: tuple[str, ...] = (
    "subject_id",
    "timeline_id",
    "turn_number",
    "entities",
    "scene_id",
    "privacy",
    "campaign_id",
    "bound_subject_ids",
    "kinds",
    "include_superseded",
    "salience",
    "limit",
)

__all__ = [
    "SCHEMA_GENERATION",
    "AUTHORITY",
    "VIEWS",
    "CONTEXT_FIELDS",
    "TemporalRetrievalError",
    "build_recall_context",
    "validate_assertion_rows",
    "narrow_candidates",
    "build_hot_projection",
    "build_warm_projection",
    "build_cold_projection",
    "select_candidates",
    "is_canonical_entity_id",
]


class TemporalRetrievalError(ValueError):
    """Invalid recall context, budget, or assertion input."""

    def __init__(self, message: str, *, field: str = "", value: Any = None) -> None:
        super().__init__(message)
        self.field = field
        self.value = value


# ---------------------------------------------------------------------------
# Primitives
# ---------------------------------------------------------------------------


def _is_exact_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _check_semantic_id(
    value: Any, *, field: str, prefix: str, allow_none: bool = False
) -> str | None:
    if value is None and allow_none:
        return None
    if not isinstance(value, str) or not value.startswith(prefix):
        raise TemporalRetrievalError(
            f"context.{field}={value!r} must be a semantic id with prefix {prefix!r}",
            field=field,
            value=value,
        )
    if len(value) > MAX_ID_CHARS or not contract.SEMANTIC_ID_RE.match(value):
        raise TemporalRetrievalError(
            f"context.{field}={value!r} violates the semantic id grammar",
            field=field,
            value=value,
        )
    return value


def _string_list(value: Any, *, field: str) -> list[str]:
    if isinstance(value, (str, bytes)) or not isinstance(value, Iterable):
        raise TemporalRetrievalError(
            f"context.{field} must be a list of strings", field=field, value=value
        )
    items: list[str] = []
    for item in value:
        if not isinstance(item, str) or not item:
            raise TemporalRetrievalError(
                f"context.{field} entries must be non-empty strings",
                field=field,
                value=item,
            )
        items.append(item)
    return items


def _require_context(context: Any) -> Mapping[str, Any]:
    if not isinstance(context, Mapping):
        raise TemporalRetrievalError(
            "context must be a mapping built by build_recall_context",
            field="context",
            value=context,
        )
    if set(context) != set(CONTEXT_FIELDS):
        raise TemporalRetrievalError(
            "context must be built by build_recall_context (closed field set)",
            field="context",
            value=sorted(map(str, context)),
        )
    return context


def _check_binding_records(value: Any) -> list[Mapping[str, Any]]:
    """Validate caller-supplied identity-binding subject records.

    Every record must pass ``contract.validate_subject``: bindings are
    only explicit when they are contract-valid. Fail fast on any invalid
    binding record — a malformed identity edge must never silently widen
    (or narrow) campaign recall.
    """
    if value is None:
        return []
    if isinstance(value, (str, bytes)) or not isinstance(value, Iterable):
        raise TemporalRetrievalError(
            "context.identity_bindings must be an iterable of subject records",
            field="identity_bindings",
            value=value,
        )
    records: list[Mapping[str, Any]] = []
    for record in value:
        if not isinstance(record, Mapping):
            raise TemporalRetrievalError(
                "context.identity_bindings entries must be subject record mappings",
                field="identity_bindings",
                value=record,
            )
        try:
            contract.validate_subject(record)
        except contract.TemporalMemoryContractError as err:
            raise TemporalRetrievalError(
                f"identity binding record fails contract validation: {err}",
                field="identity_bindings",
                value=record.get("subject_id") if isinstance(record, Mapping) else record,
            ) from err
        records.append(record)
    return records


def _derive_bound_subject_ids(
    records: list[Mapping[str, Any]], campaign_id: str | None
) -> list[str]:
    """Deterministically derive the global/None-scope subject ids explicitly
    bound to ``campaign_id`` from validated binding records.

    Authorization is an explicit ``same_subject_as`` edge that directly
    binds the global subject to a subject scoped to exactly the target
    campaign. The edge may be declared on either endpoint, but both
    endpoint records must be present in the set (dangling edges prove
    nothing). Mere presence of a target-campaign subject record is never
    authorization, and no transitive chain — including any path passing
    through a record scoped to another campaign — substitutes for the
    direct edge. Fail closed everywhere."""
    if campaign_id is None or not records:
        return []
    by_id: dict[str, Mapping[str, Any]] = {
        rec["subject_id"]: rec for rec in records
    }
    target_ids: set[str] = {
        rec["subject_id"]
        for rec in records
        if rec.get("campaign_id") == campaign_id
    }
    bound: set[str] = set()
    for rec in records:
        if rec.get("campaign_id") is not None:
            # Only a global/None-scope subject needs campaign authorization.
            # A campaign-scoped record's own presence is never
            # authorization for anything.
            continue
        sid = rec["subject_id"]
        # forward edge: global record declares sameness with a
        # target-campaign subject that is present in the set
        if any(edge in target_ids for edge in (rec.get("same_subject_as") or [])):
            bound.add(sid)
            continue
        # reverse edge: a target-campaign subject present in the set
        # declares sameness with the global subject
        for target in sorted(target_ids):
            if sid in (by_id[target].get("same_subject_as") or []):
                bound.add(sid)
                break
    return sorted(bound)


def validate_assertion_rows(assertions: Any) -> dict[str, Any]:
    """Contract-validate every input row before any filtering/ranking.

    Fail closed per row: a row that does not pass
    ``contract.validate_assertion`` never enters any projection or ranking
    (malformed privacy/valid-time/scope/provenance cannot leak into a
    player view or corrupt narrowing). Excluded rows are reported as
    diagnostics (assertion_id, error class, message, field) so integration
    and the KP can see what was rejected and why — never silently.
    """
    if isinstance(assertions, (str, bytes, Mapping)) or not isinstance(
        assertions, Iterable
    ):
        raise TemporalRetrievalError(
            "assertions must be an iterable of assertion mappings",
            field="assertions",
            value=assertions,
        )
    valid: list[Mapping[str, Any]] = []
    excluded: list[dict[str, Any]] = []
    for row in assertions:
        aid = row.get("assertion_id") if isinstance(row, Mapping) else None
        if not isinstance(row, Mapping):
            excluded.append(
                {
                    "assertion_id": None,
                    "error": "NotMapping",
                    "message": f"assertion row must be a mapping, got {type(row).__name__}",
                    "field": "assertion",
                }
            )
            continue
        try:
            contract.validate_assertion(row)
        except contract.TemporalMemoryContractError as err:
            excluded.append(
                {
                    "assertion_id": aid if isinstance(aid, str) else None,
                    "error": type(err).__name__,
                    "message": str(err),
                    "field": getattr(err, "field", "") or "",
                }
            )
            continue
        valid.append(row)
    excluded.sort(key=lambda d: (d["assertion_id"] or "", d["error"], d["field"]))
    return {"valid": valid, "excluded": excluded}


def _resolve_bound(
    value: Any, ctx: Mapping[str, Any], default: int, *, name: str
) -> int:
    resolved = value if value is not None else (ctx.get("limit") or default)
    if isinstance(resolved, bool) or not isinstance(resolved, int):
        raise TemporalRetrievalError(
            f"{name} must be an int, got {resolved!r}", field=name, value=resolved
        )
    if not MIN_LIMIT <= resolved <= MAX_LIMIT:
        raise TemporalRetrievalError(
            f"{name} must be within {MIN_LIMIT}..{MAX_LIMIT}, got {resolved!r}",
            field=name,
            value=resolved,
        )
    return resolved


# ---------------------------------------------------------------------------
# Recall context (validated, closed envelope)
# ---------------------------------------------------------------------------


def build_recall_context(
    subject_id: str | None = None,
    timeline_id: str = contract.ROOT_TIMELINE_ID,
    turn_number: int | None = None,
    entities: Iterable[str] = (),
    scene_id: str | None = None,
    privacy: str = "keeper",
    *,
    campaign_id: str | None = None,
    kinds: Iterable[str] = (),
    include_superseded: bool = False,
    salience: Mapping[str, float] | None = None,
    limit: int | None = None,
    identity_bindings: Iterable[Mapping[str, Any]] | None = None,
) -> dict[str, Any]:
    """Validate and freeze one recall context.

    ``privacy`` selects the viewer scope: ``"player_safe"`` projects only
    rows whose own privacy is exactly player_safe; ``"keeper"`` is the full
    keeper view. ``salience`` is explicit caller-supplied data
    (assertion_id -> weight in [0, 1]); it is never inferred from prose.
    ``turn_number`` is the valid-time anchor (None = no anchor).
    ``identity_bindings`` are contract-valid subject records; when
    ``campaign_id`` is pinned, a cross-campaign (None-scope) assertion is
    admitted only if its global/None-scope subject is explicitly bound to
    that campaign through a direct ``same_subject_as`` edge to a
    target-campaign subject (edge declared on either endpoint, both
    endpoint records present). Mere presence of a target-campaign subject
    record is never authorization, and chains through other campaigns are
    rejected. The context is closed: unknown fields cannot enter.
    """
    _check_semantic_id(subject_id, field="subject_id", prefix="subject-", allow_none=True)
    _check_semantic_id(
        timeline_id, field="timeline_id", prefix=contract.ID_PREFIX["timeline"]
    )

    if turn_number is not None and (not _is_exact_int(turn_number) or turn_number < 0):
        raise TemporalRetrievalError(
            f"context.turn_number must be an int >= 0 or None, got {turn_number!r}",
            field="turn_number",
            value=turn_number,
        )

    entity_list = _string_list(entities, field="entities")
    for entity in entity_list:
        _check_semantic_id(entity, field="entities", prefix="entity-")
    entity_sorted = sorted(set(entity_list))

    if scene_id is not None:
        if (
            not isinstance(scene_id, str)
            or len(scene_id) > MAX_ID_CHARS
            or not _SCENE_ID_RE.match(scene_id)
        ):
            raise TemporalRetrievalError(
                f"context.scene_id={scene_id!r} must be a lowercase structured id",
                field="scene_id",
                value=scene_id,
            )

    if privacy not in VIEWS:
        raise TemporalRetrievalError(
            f"context.privacy={privacy!r} must be one of {list(VIEWS)}",
            field="privacy",
            value=privacy,
        )

    if campaign_id is not None:
        if not isinstance(campaign_id, str) or not (
            1 <= len(campaign_id) <= MAX_ID_CHARS
        ):
            raise TemporalRetrievalError(
                f"context.campaign_id={campaign_id!r} must be a non-empty string",
                field="campaign_id",
                value=campaign_id,
            )

    kind_list = _string_list(kinds, field="kinds")
    for kind in kind_list:
        if kind not in contract.ASSERTION_KINDS:
            raise TemporalRetrievalError(
                f"context.kinds entry {kind!r} not in {list(contract.ASSERTION_KINDS)}",
                field="kinds",
                value=kind,
            )

    if not isinstance(include_superseded, bool):
        raise TemporalRetrievalError(
            f"context.include_superseded must be a bool, got {include_superseded!r}",
            field="include_superseded",
            value=include_superseded,
        )

    salience_map: dict[str, float] = {}
    if salience is not None:
        if not isinstance(salience, Mapping):
            raise TemporalRetrievalError(
                "context.salience must be a mapping of assertion_id -> weight",
                field="salience",
                value=salience,
            )
        for aid, weight in salience.items():
            _check_semantic_id(aid, field="salience", prefix="mem-")
            if (
                isinstance(weight, bool)
                or not isinstance(weight, (int, float))
                or not 0.0 <= float(weight) <= 1.0
            ):
                raise TemporalRetrievalError(
                    f"salience[{aid!r}]={weight!r} must be a number in [0, 1]",
                    field="salience",
                    value=weight,
                )
            salience_map[aid] = float(weight)

    if limit is not None and (
        isinstance(limit, bool) or not isinstance(limit, int) or not MIN_LIMIT <= limit <= MAX_LIMIT
    ):
        raise TemporalRetrievalError(
            f"context.limit must be an int within {MIN_LIMIT}..{MAX_LIMIT}, got {limit!r}",
            field="limit",
            value=limit,
        )

    binding_records = _check_binding_records(identity_bindings)
    bound_subject_ids = _derive_bound_subject_ids(binding_records, campaign_id)

    return {
        "subject_id": subject_id,
        "timeline_id": timeline_id,
        "turn_number": turn_number,
        "entities": entity_sorted,
        "scene_id": scene_id,
        "privacy": privacy,
        "campaign_id": campaign_id,
        "bound_subject_ids": bound_subject_ids,
        "kinds": sorted(set(kind_list)),
        "include_superseded": include_superseded,
        "salience": salience_map,
        "limit": limit,
    }


# ---------------------------------------------------------------------------
# Shared deterministic narrowing
# ---------------------------------------------------------------------------


def _passes_scope(assertion: Mapping[str, Any], ctx: Mapping[str, Any]) -> bool:
    """Privacy / timeline / campaign / subject / kinds filters. Structured
    fields only; the statement text is never read.

    Campaign pinning: a campaign-scoped row must match the pinned campaign
    exactly. A cross-campaign (None-scope) row is admitted only when its
    global/None-scope subject carries an explicit direct
    ``same_subject_as`` binding to a target-campaign subject in the
    context's validated ``identity_bindings`` (``bound_subject_ids``);
    unbound None-scope rows, dangling edges, chains through other
    campaigns, and bare target-campaign record presence never authorize
    entry into a campaign-pinned recall."""
    if ctx["privacy"] == "player_safe" and assertion.get("privacy") != "player_safe":
        return False
    row_timeline = assertion.get("timeline_id")
    if row_timeline is not None and row_timeline != ctx["timeline_id"]:
        return False
    pinned_campaign = ctx["campaign_id"]
    if pinned_campaign is not None:
        row_campaign = assertion.get("campaign_id")
        if row_campaign is not None:
            if row_campaign != pinned_campaign:
                return False
        elif assertion.get("subject_id") not in ctx["bound_subject_ids"]:
            return False
    subject = ctx["subject_id"]
    if subject is not None:
        knowers = assertion.get("knowers") or []
        if assertion.get("subject_id") != subject and subject not in knowers:
            return False
    if ctx["kinds"] and assertion.get("kind") not in ctx["kinds"]:
        return False
    return True


def _passes_time(assertion: Mapping[str, Any], ctx: Mapping[str, Any]) -> bool:
    """Valid-time gate for point-in-time tiers (hot/warm).

    With an anchor turn: exact [valid_from_turn, valid_until_turn]
    membership (inclusive; None = still current). Without an anchor: only
    currently-open assertions pass unless the context explicitly asks for
    superseded rows too."""
    anchor = ctx["turn_number"]
    if anchor is not None:
        return contract.effective_at(assertion, anchor)
    if ctx["include_superseded"]:
        return True
    return assertion.get("valid_until_turn") is None


def _entity_overlap(assertion: Mapping[str, Any], ctx: Mapping[str, Any]) -> int:
    wanted = set(ctx["entities"])
    if not wanted:
        return 0
    return len(wanted & {str(e) for e in (assertion.get("entities") or [])})


def _scene_match(assertion: Mapping[str, Any], ctx: Mapping[str, Any]) -> bool:
    scene_id = ctx["scene_id"]
    if scene_id is None:
        return False
    return scene_id in {str(e) for e in (assertion.get("entities") or [])}


def _recency_score(assertion: Mapping[str, Any], ctx: Mapping[str, Any]) -> float:
    anchor = ctx["turn_number"]
    if anchor is None:
        return 0.0
    formed = assertion.get("source_turn")
    if not _is_exact_int(formed):
        formed = assertion.get("valid_from_turn")
    if not _is_exact_int(formed):
        formed = 0
    age = anchor - formed
    if age <= 0:
        return 1.0
    if age >= RECENCY_TURN_SPAN:
        return 0.0
    return round(1.0 - age / RECENCY_TURN_SPAN, 6)


def _source_refs(assertion: Mapping[str, Any]) -> dict[str, Any]:
    """Machine-attached drill-down refs (commit SHA stays machine-internal
    evidence; models never transcribe it)."""
    return {
        "assertion_id": assertion["assertion_id"],
        "timeline_id": assertion.get("timeline_id"),
        "source_commit": assertion.get("source_commit"),
        "source_turn": assertion.get("source_turn"),
        "source_receipts": list(assertion.get("source_receipts") or []),
        "covers_commits": list(assertion.get("covers_commits") or []),
        "superseded_by": list(assertion.get("superseded_by") or []),
    }


def _turn_of(assertion: Mapping[str, Any]) -> int:
    turn = assertion.get("source_turn")
    return turn if _is_exact_int(turn) else 0


def _warm_sort_key(item: Mapping[str, Any]) -> tuple[float, int, str]:
    return (-item["score"], -_turn_of(item), item["assertion_id"])


def _recency_sort_key(assertion: Mapping[str, Any]) -> tuple[int, int, str]:
    valid_from = assertion.get("valid_from_turn")
    from_turn = valid_from if _is_exact_int(valid_from) else 0
    return (-_turn_of(assertion), -from_turn, assertion["assertion_id"])


def _envelope(
    tier: str,
    ctx: Mapping[str, Any],
    candidates: list[dict[str, Any]],
    excluded: list[dict[str, Any]] | None = None,
    **extra: Any,
) -> dict[str, Any]:
    excluded = excluded or []
    env = {
        "schema_generation": SCHEMA_GENERATION,
        "authority": AUTHORITY,
        "hard_gate": False,
        "tier": tier,
        "view": ctx["privacy"],
        "timeline_id": ctx["timeline_id"],
        "turn_number": ctx["turn_number"],
        "subject_id": ctx["subject_id"],
        "count": len(candidates),
        "candidates": candidates,
        "excluded_count": len(excluded),
        "excluded": excluded,
    }
    env.update(extra)
    return env


# ---------------------------------------------------------------------------
# Public retrieval API
# ---------------------------------------------------------------------------


def _rank_rows(
    rows: list[Mapping[str, Any]], ctx: Mapping[str, Any], eff_limit: int
) -> list[dict[str, Any]]:
    ranked: list[dict[str, Any]] = []
    for row in rows:
        if not _passes_scope(row, ctx):
            continue
        if not _passes_time(row, ctx):
            continue
        overlap = _entity_overlap(row, ctx)
        if ctx["entities"] and overlap == 0:
            continue
        if ctx["scene_id"] is not None and not _scene_match(row, ctx):
            continue
        scene_hit = 1.0 if _scene_match(row, ctx) else 0.0
        salience = float(ctx["salience"].get(row["assertion_id"], 0.0))
        recency = _recency_score(row, ctx)
        score = round(
            ENTITY_WEIGHT * overlap
            + SCENE_WEIGHT * scene_hit
            + SALIENCE_WEIGHT * salience
            + RECENCY_WEIGHT * recency,
            6,
        )
        item = dict(row)
        item["entity_overlap"] = overlap
        item["scene_match"] = bool(scene_hit)
        item["salience"] = salience
        item["recency"] = recency
        item["score"] = score
        item["source_refs"] = _source_refs(row)
        ranked.append(item)
    ranked.sort(key=_warm_sort_key)
    return ranked[:eff_limit]


def narrow_candidates(
    assertions: Iterable[Mapping[str, Any]],
    context: Mapping[str, Any],
    limit: int | None = None,
) -> list[dict[str, Any]]:
    """Deterministic narrow -> rank over contract-validated rows.

    Every input row must pass ``contract.validate_assertion`` first;
    malformed rows fail closed — they are excluded from every projection
    and reported as diagnostics by ``validate_assertion_rows`` and the
    envelope tiers. Filters (all structured): privacy/view, exact timeline,
    campaign isolation (None-scope rows need a validated identity
    binding), subject/knowers, kinds, valid time, entity-id overlap, and
    scene-id membership. Ranking uses entity overlap + scene hit +
    explicit salience + recency as data only; ties break by newer
    source_turn, then assertion_id. Semantic relevance is the KP's
    judgement, never this function's.
    """
    ctx = _require_context(context)
    report = validate_assertion_rows(assertions)
    eff_limit = _resolve_bound(limit, ctx, DEFAULT_WARM_LIMIT, name="limit")
    return _rank_rows(report["valid"], ctx, eff_limit)


def is_canonical_entity_id(value: Any) -> bool:
    """Canonical ``entity-*`` semantic-id predicate.

    Exactly the grammar ``build_recall_context`` enforces for entity refs
    (prefix, length cap, semantic-id regex), as a pure predicate so callers
    holding mixed constraint lists can validate each ref independently and
    discard malformed ones instead of failing the whole query. Non-strings,
    empty/whitespace values, wrong prefixes, and grammar violations are
    all non-canonical.
    """
    if not isinstance(value, str):
        return False
    try:
        _check_semantic_id(value, field="entities", prefix="entity-")
    except TemporalRetrievalError:
        return False
    return True


def select_candidates(
    assertions: Iterable[Mapping[str, Any]],
    context: Mapping[str, Any],
) -> dict[str, Any]:
    """Deterministic narrow-only selection: no ranking, no capping.

    Selection primitive for consumers that apply their own deterministic
    ordering and bounded output shape (e.g. resume pending candidates:
    disposition filter, assertion-id ordering, fixed cap). Uses the exact
    same closed context, row-contract validation, and scope/valid-time
    gates as every projection tier — the input trust boundary never moves.
    Returns every contract-valid row passing scope and valid-time gates in
    input order, plus the usual exclusion diagnostics; consumers own all
    ordering and budget decisions beyond this point.
    """
    ctx = _require_context(context)
    report = validate_assertion_rows(assertions)
    kept = [
        row
        for row in report["valid"]
        if _passes_scope(row, ctx) and _passes_time(row, ctx)
    ]
    return {"candidates": kept, "excluded": report["excluded"]}


def build_hot_projection(
    assertions: Iterable[Mapping[str, Any]],
    context: Mapping[str, Any],
    *,
    budget: int | None = None,
) -> dict[str, Any]:
    """Hot tier: bounded nearest projection of the exact timeline.

    Same privacy/timeline/campaign/subject/kinds/valid-time filters as
    narrowing, no entity/scene requirement, ordered newest-recorded-first.
    Session resume consumes this directly. Malformed input rows are
    excluded before any projection and reported in ``excluded``.
    """
    ctx = _require_context(context)
    report = validate_assertion_rows(assertions)
    eff_budget = _resolve_bound(budget, ctx, DEFAULT_HOT_BUDGET, name="budget")

    kept = [
        row for row in report["valid"] if _passes_scope(row, ctx) and _passes_time(row, ctx)
    ]
    kept.sort(key=_recency_sort_key)
    candidates: list[dict[str, Any]] = []
    for row in kept[:eff_budget]:
        item = dict(row)
        item["source_refs"] = _source_refs(row)
        candidates.append(item)
    return _envelope("hot", ctx, candidates, excluded=report["excluded"], budget=eff_budget)


def build_warm_projection(
    assertions: Iterable[Mapping[str, Any]],
    context: Mapping[str, Any],
    *,
    limit: int | None = None,
) -> dict[str, Any]:
    """Warm tier: the ranked narrow_candidates result as a bounded envelope,
    with per-row exclusion diagnostics attached."""
    ctx = _require_context(context)
    report = validate_assertion_rows(assertions)
    eff_limit = _resolve_bound(limit, ctx, DEFAULT_WARM_LIMIT, name="limit")
    candidates = _rank_rows(report["valid"], ctx, eff_limit)
    return _envelope(
        "warm", ctx, candidates, excluded=report["excluded"], limit=eff_limit
    )


def build_cold_projection(
    assertions: Iterable[Mapping[str, Any]],
    context: Mapping[str, Any],
    *,
    budget: int | None = None,
) -> dict[str, Any]:
    """Cold tier: bounded archive projection for drill-down.

    Returns summary assertions first (auditable compression; each carries
    ``covers_commits``), then superseded/closed assertions (each carries
    ``valid_until_turn`` + ``superseded_by``). Privacy/timeline/campaign/
    subject/kinds boundaries always apply; the valid-time anchor is
    intentionally relaxed because the archive is the time-travel tier.
    Malformed input rows are excluded before any projection and reported
    in ``excluded``.
    """
    ctx = _require_context(context)
    report = validate_assertion_rows(assertions)
    eff_budget = _resolve_bound(budget, ctx, DEFAULT_COLD_BUDGET, name="budget")

    scoped = [row for row in report["valid"] if _passes_scope(row, ctx)]
    summaries = [row for row in scoped if row.get("kind") == "summary"]
    closed = [
        row
        for row in scoped
        if row.get("kind") != "summary" and row.get("valid_until_turn") is not None
    ]
    summaries.sort(key=_recency_sort_key)
    closed.sort(key=_recency_sort_key)

    candidates: list[dict[str, Any]] = []
    for row in summaries[:eff_budget]:
        item = dict(row)
        item["source_refs"] = _source_refs(row)
        candidates.append(item)
    remaining = eff_budget - len(candidates)
    if remaining > 0:
        for row in closed[:remaining]:
            item = dict(row)
            item["source_refs"] = _source_refs(row)
            candidates.append(item)

    covers = sorted(
        {sha for row in summaries for sha in (row.get("covers_commits") or [])}
    )
    return _envelope(
        "cold",
        ctx,
        candidates,
        excluded=report["excluded"],
        budget=eff_budget,
        summary_count=len(summaries),
        superseded_count=len(closed),
        covers_commits=covers,
    )
