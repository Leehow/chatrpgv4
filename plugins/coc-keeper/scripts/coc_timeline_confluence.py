#!/usr/bin/env python3
"""Pure deterministic conflict core for timeline confluence (worldline merges).

Given two authority projections — structural summaries of one timeline's
authoritative state and recorded events (the row shapes produced by the
history projection extractors) — this module:

1. enumerates every structured disagreement as a conflict record shaped for
   ``coc_temporal_memory_contract.validate_confluence`` (closed fields,
   semantic conflict ids, left/right order preserved) — including one-sided
   post-fork non-duplicable mechanics (rolls, one-time effects,
   consumptions, death), which are explicit resolution obligations whose
   missing side carries an ``{"absent": true}`` marker, never
   disposition-free additions;
2. classifies each divergence with the contract conflict classes
   (HARD_STATE / KP_SEMANTIC, plus the NON_DUPLICABLE subset);
3. validates exactly one disposition + receipt per conflict — hard state
   additionally requires ``resolver_receipt``, and roll receipts, one-time
   effects, consumed resources, and death may never be combined or
   duplicated;
4. builds a confluence plan whose conflicts, manifests, and keyword mirror
   are directly compatible with ``coc_git_history.confluence_timelines``.

Pure functions only: no Git access, no filesystem access, no state mutation.
Every input arrives as data; every output is a new structure. Dispositions
are validated, never applied — merged-tree assembly and rules/state costs
belong to the canonical Git/rules layers.

Semantic Matcher Constitution: divergence detection is structural (exact
pointer/key/semantic-id comparison, canonical-JSON equality). Prose, names,
and keyword patterns are never mined for meaning; classification reads exact
structured key/segment names only. KP-semantic conflicts are surfaced
explicitly for KP judgement — nothing is silently merged or auto-resolved.

No wall-clock fields anywhere; digests are SHA-256 over canonical JSON and
are machine-internal integrity evidence, never model-facing identifiers.
"""
from __future__ import annotations

import copy
import json
import re
import sys
from collections.abc import Iterable as _Iterable
from pathlib import Path
from typing import Any, Mapping

_SCRIPT_DIR = Path(__file__).resolve().parent
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))

import coc_temporal_memory_contract as tm_contract

SCHEMA_GENERATION = tm_contract.SCHEMA_GENERATION

# ---------------------------------------------------------------------------
# Projection shape (closed field set)
# ---------------------------------------------------------------------------

# ``state`` is a JSON-pointer -> leaf-value mapping (history-projection
# snapshot leaves). Row sections hold the history-projection event rows.
PROJECTION_FIELDS: tuple[str, ...] = (
    "timeline_id",
    "campaign_id",
    "turn_number",
    "commit_sha",
    "state",
    "events",
    "receipts",
    "rolls",
    "effects",
    "transactions",
    "relations",
    "entities",
    "assertions",
)
ROW_SECTIONS: tuple[str, ...] = (
    "rolls",
    "effects",
    "transactions",
    "receipts",
    "events",
    "relations",
    "entities",
    "assertions",
)
SECTION_ORDER: tuple[str, ...] = ("state",) + ROW_SECTIONS

# ---------------------------------------------------------------------------
# Deterministic state classification tables (exact segment matches only)
# ---------------------------------------------------------------------------

# Boolean leaf flags with a well-defined absent-side default: a fork where
# one side never wrote the key still asserts the default, so an explicit
# opposite value on the other side is a disagreement, not an addition.
_DEFAULTABLE_LEAVES: dict[str, tuple[str, Any]] = {}
for _seg in ("dead", "is_dead", "deceased", "died", "death"):
    _DEFAULTABLE_LEAVES[_seg] = ("death", False)
for _seg in ("alive", "is_alive", "living"):
    _DEFAULTABLE_LEAVES[_seg] = ("death", True)
for _seg in ("consumed", "is_consumed"):
    _DEFAULTABLE_LEAVES[_seg] = ("consumed_resource", False)

# Exact pointer segments naming death / consumption. Any leaf whose pointer
# carries one of these segments diverges as a non-duplicable mechanic: a
# death or a consumption happens at most once in the merged world, so even
# a one-sided post-fork value is an explicit resolution obligation, never a
# disposition-free addition.
_DEATH_SEGMENTS = frozenset(
    {
        "dead",
        "is_dead",
        "deceased",
        "died",
        "death",
        "death_turn",
        "death_cause",
        "death_date",
        "date_of_death",
        "cause_of_death",
        "killed",
        "slain",
    }
)
_CONSUMED_SEGMENTS = frozenset(
    {"consumed", "is_consumed", "consumed_by", "consumed_at", "consumption"}
)

# Marker carried as the ``value`` of the side that does not have a
# one-sided non-duplicable mechanic. Structured and explicit so an absent
# side can never be confused with a real null/zero value; the absent side's
# ``refs`` mirror the present side's refs (the object under decision).
ABSENT_VALUE: dict[str, Any] = {"absent": True}

# Row sections whose every row is a NON_DUPLICABLE mechanic (rolls, one-time
# effects, resource-consuming transactions): a row present on only one
# branch still changes the merged world, so it becomes a conflict requiring
# a disposition instead of a disposition-free addition.
_ONE_SIDED_CONFLICT_SECTIONS = frozenset({"rolls", "effects", "transactions"})

_INVENTORY_SEGMENTS = frozenset(
    {"inventory", "items", "belongings", "gear", "equipment", "possessions"}
)
_CASH_SEGMENTS = frozenset(
    {"cash", "money", "funds", "credits", "wealth", "credit_rating", "spending_level"}
)
_INJURY_SEGMENTS = frozenset(
    {"injury", "injuries", "wound", "wounds", "major_wound", "critical_wound"}
)
_IDENTITY_SEGMENTS = frozenset(
    {"name", "display_name", "full_name", "aliases", "identity", "same_entity_as"}
)

# Row-section -> contract conflict class (fixed by what the section is).
_SECTION_CLASSES: dict[str, str] = {
    "rolls": "roll_receipt",
    "effects": "one_time_effect",
    "transactions": "consumed_resource",
    "receipts": "world_fact",
    "events": "world_fact",
    "relations": "relationship",
    "entities": "identity",
    "assertions": "memory_belief",
}
# Structured causal-link payload keys (exact key membership, never prose).
_CAUSALITY_PAYLOAD_KEYS = frozenset(
    {"caused_by", "causes", "cause", "effect_of", "consequence_of"}
)

# Semantic payload-id fields tried, in order, as cross-side row keys.
_ROW_KEY_FIELDS: dict[str, tuple[tuple[str, ...], ...]] = {
    "rolls": (("roll_id",), ("decision_id",)),
    "effects": (("effect_id",), ("decision_id",)),
    "transactions": (("transaction_id",), ("decision_id",)),
    "receipts": (("finalization_id",), ("decision_id",)),
    "events": (("decision_id",),),
    "assertions": (("assertion_id",),),
}

# Row fields that are per-timeline provenance, not payload identity. Two
# sides of a fork always differ here; equality is judged on what remains.
_PROVENANCE_ROW_KEYS = frozenset(
    {
        "event_id",
        "row_kind",
        "campaign_id",
        "timeline_id",
        "turn_number",
        "commit_sha",
        "commit_type",
        "finalization_id",
        "source_path",
        "source_ordinal",
        "paths",
        "commit",
        "source_commit",
        "source_turn",
        "source_receipts",
        "covers_commits",
    }
)

_MAX_REF_CHARS = 200
_SLUG_ALLOWED = re.compile(r"[^a-z0-9._:]")
_MISSING = object()


class ConfluenceConflictError(tm_contract.ConfluenceError):
    """Deterministic confluence conflict core violation (fail-closed)."""


__all__ = [
    "SCHEMA_GENERATION",
    "PROJECTION_FIELDS",
    "ROW_SECTIONS",
    "SECTION_ORDER",
    "ABSENT_VALUE",
    "ConfluenceConflictError",
    "conflict_ids_for",
    "validate_projection",
    "enumerate_conflicts",
    "classify_conflict",
    "validate_dispositions",
    "build_confluence_plan",
]


# ---------------------------------------------------------------------------
# Small deterministic helpers
# ---------------------------------------------------------------------------


def _canonical(value: Any) -> str:
    try:
        return tm_contract.canonical_json(value)
    except (TypeError, ValueError) as exc:
        raise ConfluenceConflictError(
            f"projection values must be JSON data: {exc}",
            record_kind="projection",
        ) from exc


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _require_token(value: Any, name: str, *, max_chars: int = 200) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ConfluenceConflictError(f"{name} must be a non-empty string")
    token = value.strip()
    if len(token) > max_chars:
        raise ConfluenceConflictError(f"{name} exceeds {max_chars} chars")
    return token


def _require_single_line(value: Any, name: str) -> str:
    token = _require_token(value, name)
    return re.sub(r"\s+", " ", token).strip()[:_MAX_REF_CHARS]


def _require_timeline_id(value: Any, *, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ConfluenceConflictError(f"{field} must be a non-empty string")
    token = value.strip()
    if not token.startswith(tm_contract.ID_PREFIX["timeline"]):
        raise ConfluenceConflictError(
            f"{field}={token!r} must carry the tl- semantic prefix",
            field=field,
            value=token,
        )
    try:
        tm_contract._check_semantic_id(
            token, kind="projection", field=field, prefix=tm_contract.ID_PREFIX["timeline"]
        )
    except tm_contract.TemporalMemoryContractError as exc:
        raise ConfluenceConflictError(str(exc)) from exc
    return token


def _require_confluence_id(value: Any) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ConfluenceConflictError("confluence_id must be a non-empty string")
    token = value.strip()
    try:
        tm_contract._check_semantic_id(
            token,
            kind="confluence",
            field="confluence_id",
            prefix=tm_contract.ID_PREFIX["confluence"],
        )
    except tm_contract.TemporalMemoryContractError as exc:
        raise ConfluenceConflictError(str(exc)) from exc
    return token


def _require_refs(refs: list[str], *, conflict_id: str) -> list[str]:
    ordered: list[str] = []
    for ref in refs:
        if not isinstance(ref, str) or not ref.strip():
            raise ConfluenceConflictError(
                f"conflict {conflict_id!r} has an empty side ref",
                record_kind="conflict",
                field="refs",
            )
        token = ref.strip()
        if len(token) > _MAX_REF_CHARS:
            raise ConfluenceConflictError(
                f"conflict {conflict_id!r} side ref exceeds {_MAX_REF_CHARS} chars",
                record_kind="conflict",
                field="refs",
                value=token,
            )
        if token not in ordered:
            ordered.append(token)
    if not ordered:
        raise ConfluenceConflictError(
            f"conflict {conflict_id!r} side has no refs",
            record_kind="conflict",
            field="refs",
        )
    return ordered


def _slug_token(text: str) -> str:
    """Sanitize one slug token: lowercase, drop non [a-z0-9._:] runs."""
    lowered = _SLUG_ALLOWED.sub("-", text.lower())
    parts = [part for part in lowered.split("-") if part]
    cleaned: list[str] = []
    for part in parts:
        part = part.lstrip("._:")
        if part:
            cleaned.append(part)
    return "-".join(cleaned)


def conflict_ids_for(
    confluence_id: str, ordered_raw: list[Mapping[str, Any]]
) -> list[str]:
    """Deterministic, collision-free conflict ids for the ordered raw diff.

    Namespace design (semantic only; never random or hash bytes):
    ``<conflict-prefix>-<scope>-<ordinal>`` where

    - ``<conflict-prefix>`` nests under the confluence id exactly as
      ``tm_contract.conflict_id_for`` does (kind + campaign + merged
      timeline);
    - ``<scope>`` is the meaning-bearing section + entity/path/entity-id
      slug (``state``/``rolls``/... plus the pointer or semantic row key),
      clipped only at a pre-computed length budget;
    - ``<ordinal>`` is the conflict's stable 1-based position in the
      deterministic (section, key) ordering, zero-padded to one fixed
      width per enumeration, and assigned only after that ordering.

    The ordinal's width is budgeted *before* the scope is clipped, so two
    long keys sharing an identical 128+-character prefix can never
    collapse into one id, and final ids — never pre-truncation slugs —
    are grammar- and uniqueness-checked fail-closed.
    """
    prefix = tm_contract.conflict_id_for(confluence_id, "")[:-1]
    count = len(ordered_raw)
    ordinal_width = max(len(str(count)), 1)
    scope_budget = tm_contract._MAX_ID_LEN - len(prefix) - 2 - ordinal_width
    if scope_budget < 1:
        raise ConfluenceConflictError(
            f"confluence id {confluence_id!r} leaves no room for semantic "
            f"conflict ids within {tm_contract._MAX_ID_LEN} chars",
            record_kind="conflict",
            field="confluence_id",
            value=confluence_id,
        )

    ids: list[str] = []
    seen: set[str] = set()
    for ordinal, item in enumerate(ordered_raw, start=1):
        scope = _slug_token(f"{item['section']}-{item['key']}")[:scope_budget].rstrip("-")
        if not scope:
            scope = "item"
        conflict_id = f"{prefix}-{scope}-{ordinal:0{ordinal_width}d}"
        if len(conflict_id) > tm_contract._MAX_ID_LEN or not tm_contract.SEMANTIC_ID_RE.match(
            conflict_id
        ):
            raise ConfluenceConflictError(
                f"generated conflict id {conflict_id!r} violates the semantic "
                f"id grammar or the {tm_contract._MAX_ID_LEN}-char limit",
                record_kind="conflict",
                field="conflict_id",
                value=conflict_id,
            )
        if conflict_id in seen:
            raise ConfluenceConflictError(
                f"conflict id collision on final ids: {conflict_id!r}",
                record_kind="conflict",
                field="conflict_id",
                value=conflict_id,
            )
        seen.add(conflict_id)
        ids.append(conflict_id)
    return ids


# ---------------------------------------------------------------------------
# Projection validation
# ---------------------------------------------------------------------------


def validate_projection(projection: Any, *, role: str = "") -> dict[str, Any]:
    """Validate one authority projection and return a normalized copy.

    A projection is a mapping with the closed field set ``PROJECTION_FIELDS``:
    ``timeline_id`` (tl- semantic id) and ``campaign_id`` are required;
    ``turn_number``/``commit_sha`` are optional machine context; ``state``
    maps JSON pointers to leaf values; every row section is a list of
    mappings. Unknown fields are errors (frozen shape).
    """
    if not isinstance(projection, Mapping):
        raise ConfluenceConflictError(
            f"{role or 'projection'} projection must be a mapping",
            record_kind="projection",
        )
    unknown = sorted(set(projection) - set(PROJECTION_FIELDS))
    if unknown:
        raise ConfluenceConflictError(
            f"{role or 'projection'} projection has unknown fields {unknown}; "
            f"schema {SCHEMA_GENERATION} is frozen",
            record_kind="projection",
            field=unknown[0],
        )
    missing = [
        name for name in ("timeline_id", "campaign_id") if projection.get(name) is None
    ]
    if missing:
        raise ConfluenceConflictError(
            f"{role or 'projection'} projection is missing required fields {missing}",
            record_kind="projection",
            field=missing[0],
        )

    timeline_id = _require_timeline_id(
        projection["timeline_id"], field="timeline_id"
    )
    campaign_id = _require_token(projection["campaign_id"], "campaign_id", max_chars=128)
    turn_number = projection.get("turn_number")
    if turn_number is not None and (
        isinstance(turn_number, bool) or not isinstance(turn_number, int)
    ):
        raise ConfluenceConflictError(
            "turn_number must be an integer or null",
            record_kind="projection",
            field="turn_number",
            value=turn_number,
        )
    commit_sha = projection.get("commit_sha")
    if commit_sha is not None:
        if not isinstance(commit_sha, str) or not tm_contract.COMMIT_SHA_RE.match(
            commit_sha
        ):
            raise ConfluenceConflictError(
                "commit_sha must be a 40/64 lowercase-hex sha or null",
                record_kind="projection",
                field="commit_sha",
            )

    raw_state = projection.get("state")
    if raw_state is None:
        raw_state = {}
    if not isinstance(raw_state, Mapping):
        raise ConfluenceConflictError(
            "state must be a mapping of JSON pointers to leaf values",
            record_kind="projection",
            field="state",
        )
    state: dict[str, Any] = {}
    for pointer, value in raw_state.items():
        if not isinstance(pointer, str) or not pointer.strip():
            raise ConfluenceConflictError(
                "state keys must be non-empty JSON pointer strings",
                record_kind="projection",
                field="state",
                value=pointer,
            )
        _canonical(value)
        state[pointer] = copy.deepcopy(value)

    sections: dict[str, list[dict[str, Any]]] = {}
    for section in ROW_SECTIONS:
        rows = projection.get(section)
        if rows is None:
            rows = []
        if not isinstance(rows, (list, tuple)):
            raise ConfluenceConflictError(
                f"projection.{section} must be a list of row mappings",
                record_kind="projection",
                field=section,
            )
        normalized: list[dict[str, Any]] = []
        for row in rows:
            if not isinstance(row, Mapping):
                raise ConfluenceConflictError(
                    f"projection.{section} rows must be mappings",
                    record_kind="projection",
                    field=section,
                )
            _canonical(dict(row))
            normalized.append(dict(row))
        sections[section] = normalized

    return {
        "timeline_id": timeline_id,
        "campaign_id": campaign_id,
        "turn_number": turn_number,
        "commit_sha": commit_sha,
        "state": state,
        **sections,
    }


# ---------------------------------------------------------------------------
# Row identity / keys
# ---------------------------------------------------------------------------


def _id_value(row: Mapping[str, Any], field: str) -> str | None:
    value = row.get(field)
    if isinstance(value, str) and value.strip():
        return value.strip()
    nested = row.get("structured_ids")
    if isinstance(nested, Mapping):
        value = nested.get(field)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _row_identity(row: Mapping[str, Any]) -> str:
    digest = row.get("payload_sha256")
    if isinstance(digest, str) and digest:
        return digest
    payload_json = row.get("payload_json")
    if isinstance(payload_json, str) and payload_json:
        return payload_json
    clean = {k: v for k, v in row.items() if k not in _PROVENANCE_ROW_KEYS}
    return _canonical(clean)


def _position_key(row: Mapping[str, Any]) -> str | None:
    """Timeline-independent source position (pre-fork rows share it)."""
    path = row.get("source_path")
    ordinal = row.get("source_ordinal")
    if isinstance(path, str) and path and isinstance(ordinal, int):
        return f"{path}:{ordinal}"
    inner_path = row.get("path")
    pointer = row.get("pointer")
    if isinstance(inner_path, str) and inner_path and isinstance(pointer, str) and pointer:
        return f"{inner_path}{pointer}"
    return None


def _row_key_and_ref(
    section: str, row: Mapping[str, Any], *, ordinal: int
) -> tuple[str, str | None]:
    """Deterministic cross-side key plus its human-facing ref, if any.

    Cross-side keys are timeline-independent identities (semantic payload
    ids, relation endpoints, or a shared source position). Rows carrying no
    identity at all get an ordinal key that is only unique inside its own
    side — such rows can never collide across sides, so a divergence among
    them stays an explicit addition for the KP instead of a fabricated
    conflict.
    """
    if section == "relations":
        relation_id = _id_value(row, "relation_id")
        if relation_id:
            return relation_id, relation_id
        # Key on endpoints only: ally vs rival between the same pair is the
        # classic relationship divergence and must collide into a conflict.
        from_id = _id_value(row, "from_entity_id")
        to_id = _id_value(row, "to_entity_id")
        kind = row.get("relation_kind")
        kind_token = kind.strip() if isinstance(kind, str) else ""
        if from_id and to_id:
            key = f"relation-{from_id}-to-{to_id}"
            return key, key + (f"-{kind_token}" if kind_token else "")
    elif section == "entities":
        entity_id = _id_value(row, "entity_id")
        if entity_id:
            return entity_id, entity_id
    else:
        for fields in _ROW_KEY_FIELDS.get(section, ()):
            for field in fields:
                value = _id_value(row, field)
                if value:
                    return value, value
    position = _position_key(row)
    if position is not None:
        return f"{section}:{position}", position
    event_id = _id_value(row, "event_id")
    if event_id:
        return f"{section}:{event_id}", event_id
    return f"{section}-row-{ordinal}", None


def _index_rows(
    section: str, rows: list[Mapping[str, Any]]
) -> dict[str, dict[str, Any]]:
    """Index one section's rows by cross-side key, deterministic order."""
    ordered = sorted(rows, key=_row_identity)
    indexed: dict[str, dict[str, Any]] = {}
    ordinal = 0
    for row in ordered:
        key, ref = _row_key_and_ref(section, row, ordinal=ordinal)
        entry = indexed.setdefault(key, {"identities": [], "rows": [], "refs": []})
        entry["identities"].append(_row_identity(row))
        entry["rows"].append(row)
        if ref is not None and ref not in entry["refs"]:
            entry["refs"].append(ref)
        source_path = row.get("source_path")
        if isinstance(source_path, str) and source_path and source_path not in entry["refs"]:
            entry["refs"].append(source_path)
        if ref is None:
            ordinal += 1
    return indexed


def _row_clean_value(row: Mapping[str, Any]) -> Any:
    payload_json = row.get("payload_json")
    if isinstance(payload_json, str) and payload_json:
        try:
            return json.loads(payload_json)
        except (json.JSONDecodeError, ValueError):
            pass
    clean = {k: copy.deepcopy(v) for k, v in row.items() if k not in _PROVENANCE_ROW_KEYS}
    return clean


def _side_values_and_refs(entry: Mapping[str, Any]) -> tuple[Any, list[str]]:
    rows = entry["rows"]
    ordered = sorted(rows, key=_row_identity)
    values = [_row_clean_value(row) for row in ordered]
    value: Any = values[0] if len(values) == 1 else values
    refs = list(entry["refs"])
    if not refs:
        refs = [_canonical(value)[:_MAX_REF_CHARS]]
    return value, refs


# ---------------------------------------------------------------------------
# Classification
# ---------------------------------------------------------------------------


def _defaultable_leaf(pointer: str) -> tuple[str, Any] | None:
    segments = [seg for seg in pointer.split("/") if seg]
    if not segments:
        return None
    leaf = segments[-1]
    return _DEFAULTABLE_LEAVES.get(leaf)


def _classify_state_pointer(pointer: str, left: Any, right: Any) -> str:
    segments = [seg for seg in pointer.split("/") if seg]
    leaf = segments[-1] if segments else ""
    if leaf in _DEFAULTABLE_LEAVES:
        return _DEFAULTABLE_LEAVES[leaf][0]
    if any(seg in _DEATH_SEGMENTS for seg in segments):
        return "death"
    if any(seg in _CONSUMED_SEGMENTS for seg in segments):
        return "consumed_resource"
    if any(seg in _INVENTORY_SEGMENTS for seg in segments):
        return "inventory_item"
    if any(seg in _CASH_SEGMENTS for seg in segments):
        return "cash"
    if any(seg in _INJURY_SEGMENTS for seg in segments):
        return "injury"
    if any(seg in _IDENTITY_SEGMENTS for seg in segments):
        return "identity"
    if _is_number(left) and _is_number(right):
        return "stat_value"
    return "world_fact"


def _has_causal_marker(value: Any) -> bool:
    if isinstance(value, Mapping):
        return any(key in _CAUSALITY_PAYLOAD_KEYS for key in value)
    if isinstance(value, list):
        return any(_has_causal_marker(item) for item in value)
    return False


def classify_conflict(conflict: Any) -> dict[str, Any]:
    """Classify one raw structural divergence into contract conflict classes.

    ``conflict`` is a raw divergence mapping with ``section`` (state or a
    row section), ``key`` (pointer / cross-side key), and the diverging
    ``left`` / ``right`` values. Returns a deterministic classification
    ``{"class", "category", "non_duplicable"}`` using the frozen contract
    constants — never a keyword guess from prose.
    """
    if not isinstance(conflict, Mapping):
        raise ConfluenceConflictError(
            "raw conflict must be a mapping", record_kind="conflict"
        )
    section = conflict.get("section")
    if section not in SECTION_ORDER:
        raise ConfluenceConflictError(
            f"raw conflict section {section!r} not in {list(SECTION_ORDER)}",
            record_kind="conflict",
            field="section",
            value=section,
        )
    key = conflict.get("key")
    if not isinstance(key, str) or not key.strip():
        raise ConfluenceConflictError(
            "raw conflict key must be a non-empty string",
            record_kind="conflict",
            field="key",
        )
    if section == "state":
        conflict_class = _classify_state_pointer(
            key, conflict.get("left"), conflict.get("right")
        )
    else:
        conflict_class = _SECTION_CLASSES[section]
        if section == "events" and (
            _has_causal_marker(conflict.get("left"))
            or _has_causal_marker(conflict.get("right"))
        ):
            conflict_class = "causality"
    return {
        "class": conflict_class,
        "category": (
            "hard_state"
            if conflict_class in tm_contract.HARD_STATE_CONFLICT_CLASSES
            else "kp_semantic"
        ),
        "non_duplicable": conflict_class in tm_contract.NON_DUPLICABLE_CONFLICT_CLASSES,
    }


# ---------------------------------------------------------------------------
# Conflict enumeration
# ---------------------------------------------------------------------------


def enumerate_conflicts(
    left_projection: Any,
    right_projection: Any,
    *,
    confluence_id: str,
) -> dict[str, Any]:
    """Enumerate the complete structural diff of two authority projections.

    Returns ``{"confluence_id", "campaign_id", "parents", "conflicts",
    "additions", "enumeration_sha256"}``:

    - ``conflicts``: every disagreement as a contract-shaped conflict record
      (closed fields ``conflict_id``/``class``/``left``/``right``/
      ``disposition`` with ``disposition`` still ``None``), ordered by
      ``(section, key)``; left/right order mirrors the argument order and
      ``parents`` is ``[left, right]``. Conflict ids use the designed
      ``<conflict-prefix>-<scope>-<ordinal>`` namespace (see
      ``conflict_ids_for``): the meaning-bearing section + path/entity slug
      plus the stable 1-based position in this ordering, always within the
      contract length and collision-checked on final ids;
    - ``additions``: ``left_only`` / ``right_only`` one-sided divergences
      that are **not** non-duplicable mechanics (new post-fork content such
      as entities, events, memories, or plain state leaves). They are
      surfaced explicitly — nothing is silently merged — but need no
      disposition. One-sided rolls, one-time effects, consumptions, and
      death/consumption state leaves are NOT additions: each is a conflict
      (see below), so no authoritative mechanic survives the merge without
      a receipted disposition;
    - ``enumeration_sha256``: integrity digest over the whole enumeration.

    Disagreement rules (deterministic): identical keys with identical
    canonical values are shared history (no conflict); the same key with
    different values is a conflict; boolean death/consumption leaves compare
    against their absent-side default; rows are compared by timeline-
    independent identity (semantic payload id, relation endpoints, or shared
    source position). A one-sided roll/effect/consumption row, or a one-sided
    death/consumption state leaf, becomes a conflict whose missing side
    carries the explicit ``{"absent": true}`` marker value (module constant
    ``ABSENT_VALUE``) with refs mirroring the present side — the disposition
    then receipts, per mechanic, whether it survives the merged world, is
    sacrificed, paradoxed, or deferred. Distinct non-duplicable mechanics on
    both branches therefore cannot both survive silently: each survival is
    an explicit, receipted decision inside the confluence record.
    """
    left = validate_projection(left_projection, role="left")
    right = validate_projection(right_projection, role="right")
    confluence_id = _require_confluence_id(confluence_id)
    if left["campaign_id"] != right["campaign_id"]:
        raise ConfluenceConflictError(
            "projections belong to different campaigns: "
            f"{left['campaign_id']!r} vs {right['campaign_id']!r}",
            record_kind="projection",
            field="campaign_id",
        )
    if left["timeline_id"] == right["timeline_id"]:
        raise ConfluenceConflictError(
            "a confluence merges two distinct timelines, got "
            f"{left['timeline_id']!r} twice",
            record_kind="projection",
            field="timeline_id",
            value=left["timeline_id"],
        )

    raw: list[dict[str, Any]] = []
    left_only: list[dict[str, Any]] = []
    right_only: list[dict[str, Any]] = []

    # --- state leaves -----------------------------------------------------
    for pointer in sorted(set(left["state"]) | set(right["state"])):
        left_value = left["state"].get(pointer, _MISSING)
        right_value = right["state"].get(pointer, _MISSING)
        if left_value is not _MISSING and right_value is not _MISSING:
            if _canonical(left_value) == _canonical(right_value):
                continue
            raw.append(
                {
                    "section": "state",
                    "key": pointer,
                    "left_refs": [pointer],
                    "left_value": left_value,
                    "right_refs": [pointer],
                    "right_value": right_value,
                }
            )
            continue
        present_left = left_value is not _MISSING
        value = left_value if present_left else right_value
        defaultable = _defaultable_leaf(pointer)
        if defaultable is not None:
            conflict_class, default = defaultable
            if _canonical(value) != _canonical(default):
                # The absent side still asserts the default: dead/alive and
                # consumed-or-not are disagreements, never silent additions.
                raw.append(
                    {
                        "section": "state",
                        "key": pointer,
                        "left_refs": [pointer],
                        "left_value": left_value if present_left else default,
                        "right_refs": [pointer],
                        "right_value": right_value if not present_left else default,
                    }
                )
            continue
        # One-sided leaf: a non-duplicable mechanic (death / consumption
        # segment) is an explicit resolution obligation — the absent side
        # carries the ABSENT marker — while everything else stays a
        # surfaced addition.
        refs = [pointer]
        if (
            _classify_state_pointer(pointer, value, ABSENT_VALUE)
            in tm_contract.NON_DUPLICABLE_CONFLICT_CLASSES
        ):
            raw.append(
                {
                    "section": "state",
                    "key": pointer,
                    "left_refs": refs,
                    "left_value": left_value if present_left else ABSENT_VALUE,
                    "right_refs": refs,
                    "right_value": right_value if not present_left else ABSENT_VALUE,
                }
            )
            continue
        addition = {
            "section": "state",
            "key": pointer,
            "refs": refs,
            "value": copy.deepcopy(value),
        }
        (left_only if present_left else right_only).append(addition)

    # --- row sections -----------------------------------------------------
    for section in ROW_SECTIONS:
        left_index = _index_rows(section, left[section])
        right_index = _index_rows(section, right[section])
        for key in sorted(set(left_index) | set(right_index)):
            in_left = key in left_index
            in_right = key in right_index
            if in_left and in_right:
                left_ids = left_index[key]["identities"]
                right_ids = right_index[key]["identities"]
                if section == "relations":
                    equal = sorted(set(left_ids)) == sorted(set(right_ids))
                else:
                    equal = left_ids == right_ids
                if equal:
                    continue
                left_value, left_refs = _side_values_and_refs(left_index[key])
                right_value, right_refs = _side_values_and_refs(right_index[key])
                raw.append(
                    {
                        "section": section,
                        "key": key,
                        "left_refs": left_refs,
                        "left_value": left_value,
                        "right_refs": right_refs,
                        "right_value": right_value,
                    }
                )
                continue
            entry = left_index[key] if in_left else right_index[key]
            value, refs = _side_values_and_refs(entry)
            if section in _ONE_SIDED_CONFLICT_SECTIONS:
                # A roll / one-time effect / consumption recorded on only
                # one branch is a NON_DUPLICABLE mechanic: it cannot enter
                # the merged world silently. It becomes a conflict with the
                # ABSENT marker on the missing side, so the KP and the hard
                # resolver must receipt whether it survives, is sacrificed,
                # paradoxed, or deferred.
                raw.append(
                    {
                        "section": section,
                        "key": key,
                        "left_refs": refs,
                        "left_value": value if in_left else ABSENT_VALUE,
                        "right_refs": refs,
                        "right_value": value if not in_left else ABSENT_VALUE,
                    }
                )
                continue
            addition = {
                "section": section,
                "key": key,
                "refs": refs,
                "value": value,
            }
            (left_only if in_left else right_only).append(addition)

    section_rank = {name: rank for rank, name in enumerate(SECTION_ORDER)}
    raw.sort(key=lambda item: (section_rank[item["section"]], item["key"]))

    conflicts: list[dict[str, Any]] = []
    # Ids are minted only after the deterministic ordering above, from the
    # designed <prefix>-<scope>-<ordinal> namespace (see conflict_ids_for).
    for item, conflict_id in zip(raw, conflict_ids_for(confluence_id, raw)):
        classification = classify_conflict(
            {
                "section": item["section"],
                "key": item["key"],
                "left": item["left_value"],
                "right": item["right_value"],
            }
        )
        conflicts.append(
            {
                "conflict_id": conflict_id,
                "class": classification["class"],
                "left": {
                    "timeline": left["timeline_id"],
                    "refs": _require_refs(item["left_refs"], conflict_id=conflict_id),
                    "value": copy.deepcopy(item["left_value"]),
                },
                "right": {
                    "timeline": right["timeline_id"],
                    "refs": _require_refs(item["right_refs"], conflict_id=conflict_id),
                    "value": copy.deepcopy(item["right_value"]),
                },
                "disposition": None,
            }
        )

    section_order_key = lambda entry: (  # noqa: E731
        section_rank[entry["section"]],
        entry["key"],
    )
    left_only.sort(key=section_order_key)
    right_only.sort(key=section_order_key)
    additions = {"left_only": left_only, "right_only": right_only}

    enumeration = {
        "confluence_id": confluence_id,
        "campaign_id": left["campaign_id"],
        "parents": [left["timeline_id"], right["timeline_id"]],
        "conflicts": conflicts,
        "additions": additions,
    }
    enumeration["enumeration_sha256"] = tm_contract.record_digest(enumeration)
    return enumeration


# ---------------------------------------------------------------------------
# Disposition validation
# ---------------------------------------------------------------------------


def _validate_conflict_inputs(conflicts: Any) -> list[dict[str, Any]]:
    if not isinstance(conflicts, (list, tuple)):
        raise ConfluenceConflictError(
            "conflicts must be a list of conflict records",
            record_kind="conflict",
        )
    seen: set[str] = set()
    checked: list[dict[str, Any]] = []
    for conflict in conflicts:
        if not isinstance(conflict, Mapping):
            raise ConfluenceConflictError(
                "each conflict must be a mapping", record_kind="conflict"
            )
        conflict_id = conflict.get("conflict_id")
        if not isinstance(conflict_id, str) or not conflict_id.strip():
            raise ConfluenceConflictError(
                "each conflict requires a non-empty conflict_id",
                record_kind="conflict",
                field="conflict_id",
            )
        if conflict_id in seen:
            raise ConfluenceConflictError(
                f"duplicate conflict id {conflict_id!r}",
                record_kind="conflict",
                field="conflict_id",
                value=conflict_id,
            )
        seen.add(conflict_id)
        conflict_class = conflict.get("class")
        if conflict_class not in tm_contract.CONFLICT_CLASSES:
            raise ConfluenceConflictError(
                f"conflict {conflict_id!r} class {conflict_class!r} not in "
                f"closed enum {list(tm_contract.CONFLICT_CLASSES)}",
                record_kind="conflict",
                field="class",
                value=conflict_class,
            )
        for side in ("left", "right"):
            if not isinstance(conflict.get(side), Mapping):
                raise ConfluenceConflictError(
                    f"conflict {conflict_id!r} requires mapping {side} side",
                    record_kind="conflict",
                    field=side,
                )
        checked.append(dict(conflict))
    return checked


def _normalize_dispositions(dispositions: Any) -> dict[str, dict[str, Any]]:
    normalized: dict[str, dict[str, Any]] = {}
    if isinstance(dispositions, Mapping):
        items = list(dispositions.items())
        for conflict_id, disposition in items:
            if not isinstance(conflict_id, str) or not conflict_id.strip():
                raise ConfluenceConflictError(
                    "disposition keys must be conflict ids",
                    record_kind="disposition",
                    field="conflict_id",
                )
            if conflict_id in normalized:
                raise ConfluenceConflictError(
                    f"duplicate disposition for conflict {conflict_id!r}",
                    record_kind="disposition",
                    field="conflict_id",
                    value=conflict_id,
                )
            normalized[conflict_id] = disposition
        return normalized
    if isinstance(dispositions, (list, tuple)) or (
        isinstance(dispositions, _Iterable) and not isinstance(dispositions, (str, bytes))
    ):
        for entry in dispositions:
            if not isinstance(entry, Mapping):
                raise ConfluenceConflictError(
                    "disposition entries must be mappings",
                    record_kind="disposition",
                )
            conflict_id = entry.get("conflict_id")
            disposition = entry.get("disposition")
            if not isinstance(conflict_id, str) or not conflict_id.strip():
                raise ConfluenceConflictError(
                    "disposition entry requires a non-empty conflict_id",
                    record_kind="disposition",
                    field="conflict_id",
                )
            if conflict_id in normalized:
                raise ConfluenceConflictError(
                    f"duplicate disposition for conflict {conflict_id!r}",
                    record_kind="disposition",
                    field="conflict_id",
                    value=conflict_id,
                )
            normalized[conflict_id] = disposition
        return normalized
    raise ConfluenceConflictError(
        "dispositions must be a conflict_id -> disposition mapping or a list "
        "of {conflict_id, disposition} entries",
        record_kind="disposition",
    )


def _validate_one_disposition(
    conflict_id: str, conflict_class: str, disposition: Any
) -> None:
    kind = "disposition"
    if not isinstance(disposition, Mapping):
        raise ConfluenceConflictError(
            f"conflict {conflict_id!r} disposition must be a mapping",
            record_kind=kind,
        )
    unknown = sorted(set(disposition) - set(tm_contract.DISPOSITION_FIELDS))
    if unknown:
        raise ConfluenceConflictError(
            f"disposition for {conflict_id!r} has unknown fields {unknown}; "
            "the disposition field set is frozen",
            record_kind=kind,
            field=unknown[0],
        )
    missing = [
        name
        for name in ("mode", "receipt")
        if disposition.get(name) is None
    ]
    if missing:
        raise ConfluenceConflictError(
            f"disposition for {conflict_id!r} is missing required fields {missing}",
            record_kind=kind,
            field=missing[0],
        )
    mode = disposition.get("mode")
    if mode not in tm_contract.DISPOSITION_MODES:
        raise ConfluenceConflictError(
            f"disposition for {conflict_id!r} mode {mode!r} not in closed enum "
            f"{list(tm_contract.DISPOSITION_MODES)}",
            record_kind=kind,
            field="mode",
            value=mode,
        )
    receipt = disposition.get("receipt")
    if not isinstance(receipt, str) or not receipt.strip():
        raise ConfluenceConflictError(
            f"disposition for {conflict_id!r} requires a non-empty receipt",
            record_kind=kind,
            field="receipt",
        )
    if len(receipt.strip()) > _MAX_REF_CHARS:
        raise ConfluenceConflictError(
            f"disposition for {conflict_id!r} receipt exceeds "
            f"{_MAX_REF_CHARS} chars",
            record_kind=kind,
            field="receipt",
        )
    resolver_receipt = disposition.get("resolver_receipt")
    if resolver_receipt is not None and (
        not isinstance(resolver_receipt, str) or not resolver_receipt.strip()
    ):
        raise ConfluenceConflictError(
            f"disposition for {conflict_id!r} resolver_receipt must be a "
            "non-empty string when present",
            record_kind=kind,
            field="resolver_receipt",
        )
    if (
        conflict_class in tm_contract.HARD_STATE_CONFLICT_CLASSES
        and not (resolver_receipt or "").strip()
    ):
        raise ConfluenceConflictError(
            f"hard-state conflict {conflict_id!r} (class {conflict_class!r}) "
            "requires disposition.resolver_receipt: the hard mechanics "
            "resolver must validate the numbers before confluence",
            record_kind=kind,
            field="resolver_receipt",
        )
    if (
        conflict_class in tm_contract.NON_DUPLICABLE_CONFLICT_CLASSES
        and mode in ("combine", "duplicate")
    ):
        raise ConfluenceConflictError(
            f"conflict {conflict_id!r} class {conflict_class!r} must not be "
            f"disposed via {mode!r}: rolls, one-time effects, item "
            "consumption, and death are never duplicated or combined across "
            "timelines",
            record_kind=kind,
            field="mode",
            value=mode,
        )
    note = disposition.get("note")
    if mode == "defer" and (not isinstance(note, str) or not note.strip()):
        raise ConfluenceConflictError(
            f"deferred conflict {conflict_id!r} requires a disposition note "
            "naming the follow-up",
            record_kind=kind,
            field="note",
        )


def validate_dispositions(conflicts: Any, dispositions: Any) -> list[dict[str, Any]]:
    """Validate exactly one disposition + receipt per conflict.

    ``conflicts`` is a conflict list (as produced by ``enumerate_conflicts``;
    any pre-existing ``disposition`` value is replaced). ``dispositions`` is
    a ``conflict_id -> disposition`` mapping (or a list of
    ``{"conflict_id", "disposition"}`` entries). Fails closed on missing
    dispositions, dispositions naming unknown conflicts, duplicate
    dispositions, unknown disposition fields, hard-state conflicts without
    ``resolver_receipt``, combine/duplicate on non-duplicable classes, and
    ``defer`` without a note. Returns new conflict records with the
    disposition attached, in the original conflict order; inputs are never
    mutated and nothing is merged silently.
    """
    conflict_list = _validate_conflict_inputs(conflicts)
    disposition_map = _normalize_dispositions(dispositions)
    conflict_ids = [conflict["conflict_id"] for conflict in conflict_list]

    missing = [cid for cid in conflict_ids if cid not in disposition_map]
    if missing:
        raise ConfluenceConflictError(
            f"conflicts missing dispositions (complete dispositions only; no "
            f"silent merge): {missing}",
            record_kind="disposition",
            field="conflict_id",
            value=missing[0],
        )
    extra = sorted(set(disposition_map) - set(conflict_ids))
    if extra:
        raise ConfluenceConflictError(
            f"dispositions reference unknown conflict ids: {extra}",
            record_kind="disposition",
            field="conflict_id",
            value=extra[0],
        )

    resolved: list[dict[str, Any]] = []
    for conflict in conflict_list:
        conflict_id = conflict["conflict_id"]
        disposition = disposition_map[conflict_id]
        _validate_one_disposition(conflict_id, conflict["class"], disposition)
        record = dict(conflict)
        record["disposition"] = dict(disposition)
        resolved.append(record)
    return resolved


# ---------------------------------------------------------------------------
# Confluence plan
# ---------------------------------------------------------------------------


def build_confluence_plan(
    *,
    campaign_id: str,
    timeline_id: str,
    left_projection: Mapping[str, Any],
    right_projection: Mapping[str, Any],
    dispositions: Mapping[str, Any],
    receipt: str,
    schema_generation: str,
    confluence_id: str | None = None,
    created_by: str = "confluence",
    game_reason: str = "timeline confluence",
    path_resolutions: Mapping[str, Any] | None = None,
    activate: bool = False,
) -> dict[str, Any]:
    """Build a pure confluence plan for ``coc_git_history.confluence_timelines``.

    Runs the full deterministic pipeline — projection validation, conflict
    enumeration, disposition validation, and contract validation of the
    resulting confluence record (with a placeholder ``merge_commit``; the
    real merge sha is produced by Git later). No Git access, no state
    mutation: the plan is data.

    The returned plan carries ``conflicts`` ready for ``confluence_timelines``
    verbatim, plus manifest digests computed exactly the way that function
    computes them, and ``git_history_arguments`` mirroring its keyword
    arguments (pass ``confluence_timelines(root, **plan["git_history_arguments"])``).
    ``plan_sha256`` is the integrity digest of the whole plan result.
    """
    campaign_id = _require_token(campaign_id, "campaign_id", max_chars=128)
    timeline_id = _require_timeline_id(timeline_id, field="timeline_id")
    receipt = _require_single_line(receipt, "receipt")
    schema_generation = _require_token(schema_generation, "schema_generation")
    game_reason = _require_single_line(game_reason, "game_reason")
    if not game_reason:
        raise ConfluenceConflictError("game_reason must be a non-empty string")
    if created_by not in tm_contract.TIMELINE_CREATED_BY:
        raise ConfluenceConflictError(
            f"created_by {created_by!r} not in closed enum "
            f"{list(tm_contract.TIMELINE_CREATED_BY)}",
            field="created_by",
            value=created_by,
        )

    if confluence_id is None:
        confluence_id = f"confluence-{campaign_id}-{timeline_id}"
    enumeration = enumerate_conflicts(
        left_projection, right_projection, confluence_id=confluence_id
    )
    confluence_id = enumeration["confluence_id"]

    left_timeline_id = enumeration["parents"][0]
    right_timeline_id = enumeration["parents"][1]
    if timeline_id in (left_timeline_id, right_timeline_id):
        raise ConfluenceConflictError(
            "the merged timeline is a third timeline, not one of its parents",
            field="timeline_id",
            value=timeline_id,
        )
    if timeline_id == tm_contract.ROOT_TIMELINE_ID:
        raise ConfluenceConflictError(
            f"the root timeline {tm_contract.ROOT_TIMELINE_ID!r} cannot be a "
            "confluence target",
            field="timeline_id",
            value=timeline_id,
        )
    if enumeration["campaign_id"] != campaign_id:
        raise ConfluenceConflictError(
            "projection campaign "
            f"{enumeration['campaign_id']!r} does not match plan campaign "
            f"{campaign_id!r}",
            field="campaign_id",
        )

    conflicts = validate_dispositions(enumeration["conflicts"], dispositions)

    placeholder_commit = "0" * 40
    confluence_record = {
        "confluence_id": confluence_id,
        "campaign_id": campaign_id,
        "timeline_id": timeline_id,
        "parents": [left_timeline_id, right_timeline_id],
        "merge_commit": placeholder_commit,
        "receipt": receipt,
        "conflicts": conflicts,
    }
    try:
        tm_contract.validate_confluence(confluence_record)
    except tm_contract.TemporalMemoryContractError as exc:
        raise ConfluenceConflictError(
            f"confluence plan violates the frozen contract: {exc}",
            record_kind="confluence",
        ) from exc

    # Manifest digests mirror coc_git_history.confluence_timelines exactly.
    conflict_manifest_sha256 = tm_contract.record_digest({"conflicts": conflicts})
    disposition_manifest_sha256 = tm_contract.record_digest(
        {
            "dispositions": [
                {
                    "conflict_id": conflict["conflict_id"],
                    "disposition": conflict["disposition"],
                }
                for conflict in conflicts
            ]
        }
    )
    resolutions = dict(path_resolutions or {})
    plan_core = {
        "confluence_id": confluence_id,
        "campaign_id": campaign_id,
        "timeline_id": timeline_id,
        "parents": [left_timeline_id, right_timeline_id],
        "receipt": receipt,
        "conflicts": conflicts,
        "conflict_manifest_sha256": conflict_manifest_sha256,
        "disposition_manifest_sha256": disposition_manifest_sha256,
    }
    return {
        **plan_core,
        "left_timeline_id": left_timeline_id,
        "right_timeline_id": right_timeline_id,
        "plan_sha256": tm_contract.record_digest(plan_core),
        "enumeration_sha256": enumeration["enumeration_sha256"],
        "additions": enumeration["additions"],
        "path_resolutions": resolutions,
        "git_history_arguments": {
            "campaign_id": campaign_id,
            "timeline_id": timeline_id,
            "left_timeline_id": left_timeline_id,
            "right_timeline_id": right_timeline_id,
            "receipt": receipt,
            "schema_generation": schema_generation,
            "conflicts": conflicts,
            "path_resolutions": resolutions,
            "confluence_id": confluence_id,
            "created_by": created_by,
            "game_reason": game_reason,
            "activate": activate,
        },
        # The merge sha is machine evidence produced by Git later; the plan
        # itself carries no commit.
        "merge_commit": None,
    }
