#!/usr/bin/env python3
"""Frozen contract layer for the Git-backed temporal memory / worldline system.

Contract-only module: enums, semantic-ID grammar, closed field sets, record
schemas, deterministic projection rules, and bundle/reference validation.
Git DAG storage, projection rebuild, retrieval, background extraction, and
the confluence runtime are later plan tasks; nothing here writes a campaign.

Standing law encoded by this contract:

- Git is the immutable source of history; every index/SQLite/summary is a
  rebuildable projection. Records therefore carry **no wall-clock fields**:
  recorded time is projected from the bound ``source_commit`` by code.
- ``state.*`` / ``rules.*`` stay authoritative. Memory is advisory: it
  answers "who knew, believed, misunderstood, or remembered what, when" and
  never overrides hard state.
- Bitemporal assertions: occurred/valid time (turn ordinals inside the
  source timeline) plus recorded provenance. ``timeline_id`` /
  ``source_commit`` / ``source_turn`` / ``source_receipts`` are always bound.
  Commit SHAs and receipt IDs are machine integrity evidence: code attaches
  and verifies them; models never transcribe them (semantic IDs only).
- Contradictions never delete: supersession closes an assertion with
  ``valid_until_turn`` + ``superseded_by`` and keeps both records addressable.
- Player assertions are candidates (``player_assertion``), never world
  truth until KP adjudication links them via ``confirms`` / ``contradicts``.
- Same-name entities/subjects are distinct unless explicitly bound through
  ``same_entity_as`` / ``same_subject_as``. Resolution is deterministic
  exact-match only; ambiguity is an error, never an auto-pick.
- Hard-state confluence must not duplicate rolls, one-time effects, item
  consumption, or death (``NON_DUPLICABLE_CONFLICT_CLASSES``), and every
  conflict carries a disposition receipt.
- Extraction backlog is explicit and recoverable; extraction failure never
  blocks ``turn.finalize`` (runtime invariant; this module provides the
  backlog record schema only).

Clean-slate schema generation ``temporal-memory-1``: no migrations, no dual
readers for older memory layouts. Existing campaign data stays read-only.
"""
from __future__ import annotations

import hashlib
import json
import re
from typing import Any, Iterable, Mapping

CONTRACT_NAME = "temporal-memory"
CONTRACT_SCHEMA_VERSION = 1
SCHEMA_GENERATION = "temporal-memory-1"

# ---------------------------------------------------------------------------
# Closed enums (frozen tuples; membership is the only accepted test)
# ---------------------------------------------------------------------------

SUBJECT_KINDS: tuple[str, ...] = (
    "world",
    "investigator",
    "npc",
    "party",
    "keeper",
    "player",
)
# Subject kinds whose identity may span campaigns (player preferences,
# keeper corrections, an investigator carried between campaigns).
CROSS_CAMPAIGN_SUBJECT_KINDS: tuple[str, ...] = (
    "investigator",
    "keeper",
    "player",
)
# Subject kinds that can hold knowledge/belief (used for knower checks).
KNOWER_SUBJECT_KINDS: tuple[str, ...] = (
    "investigator",
    "npc",
    "party",
    "keeper",
    "player",
)

ASSERTION_KINDS: tuple[str, ...] = (
    "world_event",  # occurred world fact; subject must be the world subject
    "knowledge",  # subject holds knowledge of referenced entities/events
    "belief",  # subjective model; may be false (see state)
    "relationship",  # directed edge subject -> exactly one entity target
    "player_assertion",  # candidate from the player; never world truth
    "player_preference",  # table-level preference; may be cross-campaign
    "keeper_correction",  # KP correction; may be cross-campaign
    "summary",  # auditable compression; requires covers_commits
)

MEMORY_STATES: tuple[str, ...] = (
    "accurate",
    "uncertain",
    "distorted",
    "suppressed",
    "forgotten",
    "implanted",
    "dreamlike",
    "cross_timeline_echo",
    "contradictory",
)

PRIVACY_LEVELS: tuple[str, ...] = ("player_safe", "keeper_only")

SCOPES: tuple[str, ...] = ("campaign", "cross_campaign")

ENTITY_KINDS: tuple[str, ...] = (
    "person",
    "creature",
    "location",
    "item",
    "clue",
    "organization",
    "event",
    "concept",
)

TIMELINE_KINDS: tuple[str, ...] = ("root", "fork", "confluence")
TIMELINE_CREATED_BY: tuple[str, ...] = (
    "initial",
    "player_request",
    "kp_decision",
    "confluence",
)

# Deterministic (hard-state) conflict classes: numbers and authoritative
# resources diffed structurally from state receipts; validated by the hard
# mechanics resolver before a confluence record may be written.
HARD_STATE_CONFLICT_CLASSES: tuple[str, ...] = (
    "roll_receipt",
    "one_time_effect",
    "consumed_resource",
    "death",
    "stat_value",
    "inventory_item",
    "cash",
    "injury",
)
# KP semantic conflict classes: identity, causality, memory, relationships,
# world facts. Disposition is a KP judgement recorded as a receipt.
KP_SEMANTIC_CONFLICT_CLASSES: tuple[str, ...] = (
    "identity",
    "causality",
    "memory_belief",
    "relationship",
    "world_fact",
)
CONFLICT_CLASSES: tuple[str, ...] = (
    HARD_STATE_CONFLICT_CLASSES + KP_SEMANTIC_CONFLICT_CLASSES
)

# Classes where the merged world must never end up with a duplicated or
# merged copy of the thing: exactly one side survives, or the item is
# paradoxed / sacrificed / deferred.
NON_DUPLICABLE_CONFLICT_CLASSES: tuple[str, ...] = (
    "roll_receipt",
    "one_time_effect",
    "consumed_resource",
    "death",
)
_FORBIDDEN_MODES_FOR_NON_DUPLICABLE: tuple[str, ...] = ("combine", "duplicate")

DISPOSITION_MODES: tuple[str, ...] = (
    "choose_left",
    "choose_right",
    "combine",
    "duplicate",
    "transform",
    "paradox",
    "sacrifice",
    "defer",
)

BACKLOG_STATUSES: tuple[str, ...] = ("pending", "recovered", "abandoned")
BACKLOG_REASONS: tuple[str, ...] = ("extraction_error", "review_required")

# ---------------------------------------------------------------------------
# Semantic ID grammar
# ---------------------------------------------------------------------------

# Kebab-style semantic tokens. Lowercase only (model transcription safety).
# Tokens allow [a-z0-9._:] so campaign ids like "amaranthine-16" embed
# cleanly. An ID must contain at least one "-" after the first token.
SEMANTIC_ID_RE = re.compile(r"^[a-z0-9][a-z0-9._:-]*(?:-[a-z0-9][a-z0-9._:-]*)+$")

# Commit SHAs are machine-internal integrity evidence, never model-facing
# identifiers. sha1 (40) and sha256 (64) object ids are both accepted.
COMMIT_SHA_RE = re.compile(r"^[0-9a-f]{40}$|^[0-9a-f]{64}$")

ID_PREFIX = {
    "subject": "subject-",
    "entity": "entity-",
    "assertion": "mem-",
    "episode": "episode-",
    "timeline": "tl-",
    "confluence": "confluence-",
    "conflict": "conflict-",
    "transfer": "transfer-",
    "backlog": "backlog-",
}

# Campaign-scoped assertion ids embed the campaign slug; cross-campaign
# assertion ids carry this marker instead.
CROSS_CAMPAIGN_ID_MARKER = "mem-xc-"

ROOT_TIMELINE_ID = "tl-main"

MAX_STATEMENT_CHARS = 2000
_MAX_ID_LEN = 128

# ---------------------------------------------------------------------------
# Closed field sets (unknown keys are validation errors: frozen schema)
# ---------------------------------------------------------------------------

SUBJECT_FIELDS: tuple[str, ...] = (
    "subject_id",
    "kind",
    "campaign_id",
    "display_name",
    "same_subject_as",
)
ENTITY_FIELDS: tuple[str, ...] = (
    "entity_id",
    "kind",
    "campaign_id",
    "display_name",
    "aliases",
    "same_entity_as",
    "subject_ref",
)
ASSERTION_FIELDS: tuple[str, ...] = (
    "assertion_id",
    "kind",
    "scope",
    "campaign_id",
    "timeline_id",
    "subject_id",
    "knowers",
    "privacy",
    "state",
    "statement",
    "entities",
    "occurred_turn",
    "valid_from_turn",
    "valid_until_turn",
    "superseded_by",
    "contradicts",
    "confirms",
    "covers_commits",
    "transfer_ref",
    "source_commit",
    "source_turn",
    "source_receipts",
)
EPISODE_FIELDS: tuple[str, ...] = (
    "episode_id",
    "campaign_id",
    "timeline_id",
    "commit",
    "turn_number",
    "finalization_receipt",
    "subjects_present",
    "entities",
)
FORK_POINT_FIELDS: tuple[str, ...] = ("commit", "turn", "episode_id")
TIMELINE_FIELDS: tuple[str, ...] = (
    "timeline_id",
    "campaign_id",
    "kind",
    "parents",
    "fork_point",
    "created_by",
)
CONFLUENCE_FIELDS: tuple[str, ...] = (
    "confluence_id",
    "campaign_id",
    "timeline_id",
    "parents",
    "merge_commit",
    "receipt",
    "conflicts",
)
CONFLICT_SIDE_FIELDS: tuple[str, ...] = ("timeline", "refs", "value")
DISPOSITION_FIELDS: tuple[str, ...] = (
    "mode",
    "receipt",
    "resolver_receipt",
    "note",
)
TRANSFER_FIELDS: tuple[str, ...] = (
    "transfer_id",
    "campaign_id",
    "from_timeline",
    "to_timeline",
    "receipt",
    "source_commit",
    "source_turn",
    "entries",
    "play_cost",
)
TRANSFER_ENTRY_FIELDS: tuple[str, ...] = (
    "source_assertion",
    "target_assertion",
    "state",
    "credibility",
    "distortion",
    "privacy",
)
BACKLOG_FIELDS: tuple[str, ...] = (
    "backlog_id",
    "campaign_id",
    "timeline_id",
    "commit",
    "turn_number",
    "reason",
    "status",
)

# Kinds that require subject_id to appear in knowers (the owner holds the
# memory). world_event and summary are exempt (world is not a knower).
_OWNER_IN_KNOWERS_KINDS: tuple[str, ...] = (
    "knowledge",
    "belief",
    "relationship",
    "player_assertion",
    "player_preference",
    "keeper_correction",
)


# ---------------------------------------------------------------------------
# Error taxonomy (all validation errors are closed and named)
# ---------------------------------------------------------------------------


class TemporalMemoryContractError(ValueError):
    """Base error for temporal-memory contract violations."""

    def __init__(
        self,
        message: str,
        *,
        record_kind: str = "",
        field: str = "",
        value: Any = None,
    ) -> None:
        super().__init__(message)
        self.record_kind = record_kind
        self.field = field
        self.value = value


class UnknownFieldError(TemporalMemoryContractError):
    pass


class MissingFieldError(TemporalMemoryContractError):
    pass


class ClosedEnumError(TemporalMemoryContractError):
    pass


class SemanticIdError(TemporalMemoryContractError):
    pass


class ProvenanceError(TemporalMemoryContractError):
    pass


class PrivacyError(TemporalMemoryContractError):
    pass


class SupersessionError(TemporalMemoryContractError):
    pass


class ScopeError(TemporalMemoryContractError):
    pass


class IdentityError(TemporalMemoryContractError):
    pass


class TimelineError(TemporalMemoryContractError):
    pass


class ConfluenceError(TemporalMemoryContractError):
    pass


class TransferError(TemporalMemoryContractError):
    pass


# ---------------------------------------------------------------------------
# Determinism helpers
# ---------------------------------------------------------------------------


def canonical_json(record: Mapping[str, Any]) -> str:
    """Stable serialization: sorted keys, compact separators, no reordering
    sensitivity to dict insertion order."""
    return json.dumps(record, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def record_digest(record: Mapping[str, Any]) -> str:
    """SHA-256 over :func:`canonical_json`. Machine-internal integrity
    evidence only — never a model-facing identifier."""
    return hashlib.sha256(canonical_json(record).encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Field-level primitives
# ---------------------------------------------------------------------------


def _require_mapping(record: Any, kind: str) -> Mapping[str, Any]:
    if not isinstance(record, Mapping):
        raise TemporalMemoryContractError(
            f"{kind} record must be a mapping, got {type(record).__name__}",
            record_kind=kind,
        )
    return record


def _check_fields(
    record: Mapping[str, Any],
    kind: str,
    allowed: tuple[str, ...],
    required: tuple[str, ...],
) -> None:
    unknown = sorted(set(record) - set(allowed))
    if unknown:
        raise UnknownFieldError(
            f"{kind} has unknown fields {unknown}; schema "
            f"{SCHEMA_GENERATION} is frozen",
            record_kind=kind,
            field=unknown[0],
        )
    missing = [name for name in required if record.get(name) is None]
    if missing:
        raise MissingFieldError(
            f"{kind} is missing required fields {missing}",
            record_kind=kind,
            field=missing[0],
        )


def _is_exact_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _check_enum(value: Any, allowed: tuple[str, ...], *, kind: str, field: str) -> str:
    if value not in allowed:
        raise ClosedEnumError(
            f"{kind}.{field}={value!r} not in closed enum {list(allowed)}",
            record_kind=kind,
            field=field,
            value=value,
        )
    return value


def _check_semantic_id(
    value: Any,
    *,
    kind: str,
    field: str,
    prefix: str,
) -> str:
    if not isinstance(value, str) or not value.startswith(prefix):
        raise SemanticIdError(
            f"{kind}.{field}={value!r} must be a semantic id with prefix "
            f"{prefix!r}",
            record_kind=kind,
            field=field,
            value=value,
        )
    if len(value) > _MAX_ID_LEN or not SEMANTIC_ID_RE.match(value):
        raise SemanticIdError(
            f"{kind}.{field}={value!r} violates semantic id grammar "
            f"{SEMANTIC_ID_RE.pattern}",
            record_kind=kind,
            field=field,
            value=value,
        )
    return value


def _check_id_list(
    value: Any,
    *,
    kind: str,
    field: str,
    prefix: str,
    allow_empty: bool,
) -> list[str]:
    if value is None:
        value = []
    if not isinstance(value, (list, tuple)):
        raise TemporalMemoryContractError(
            f"{kind}.{field} must be a list, got {type(value).__name__}",
            record_kind=kind,
            field=field,
        )
    seen: set[str] = set()
    for item in value:
        _check_semantic_id(item, kind=kind, field=field, prefix=prefix)
        if item in seen:
            raise TemporalMemoryContractError(
                f"{kind}.{field} contains duplicate id {item!r}",
                record_kind=kind,
                field=field,
                value=item,
            )
        seen.add(item)
    if not value and not allow_empty:
        raise MissingFieldError(
            f"{kind}.{field} must not be empty",
            record_kind=kind,
            field=field,
        )
    return list(value)


def _check_commit_sha(value: Any, *, kind: str, field: str) -> str:
    if not isinstance(value, str) or not COMMIT_SHA_RE.match(value):
        raise ProvenanceError(
            f"{kind}.{field}={value!r} is not a commit sha (40/64 lowercase hex)",
            record_kind=kind,
            field=field,
            value=value,
        )
    return value


def _check_name(value: Any, *, kind: str, field: str, max_chars: int) -> str:
    if not isinstance(value, str) or not value.strip():
        raise TemporalMemoryContractError(
            f"{kind}.{field} must be a non-empty string",
            record_kind=kind,
            field=field,
        )
    if len(value) > max_chars:
        raise TemporalMemoryContractError(
            f"{kind}.{field} exceeds {max_chars} chars",
            record_kind=kind,
            field=field,
        )
    return value


# ---------------------------------------------------------------------------
# Deterministic ID constructors (code builds IDs; models never invent them)
# ---------------------------------------------------------------------------


def subject_id_for(kind: str, campaign_id: str | None, slug: str) -> str:
    """Deterministic subject id. world/party bind the campaign slug; npc is
    campaign-prefixed; investigator/keeper/player are global slugs."""
    if kind == "world":
        if not campaign_id:
            raise SemanticIdError("world subject requires campaign_id")
        return f"subject-world-{campaign_id}"
    if kind == "party":
        if not campaign_id:
            raise SemanticIdError("party subject requires campaign_id")
        return f"subject-party-{campaign_id}"
    if kind == "npc":
        if not campaign_id:
            raise SemanticIdError("npc subject requires campaign_id")
        return f"subject-npc-{campaign_id}-{slug}"
    if kind in CROSS_CAMPAIGN_SUBJECT_KINDS:
        return f"subject-{kind}-{slug}"
    raise ClosedEnumError(
        f"subject kind {kind!r} not in closed enum {list(SUBJECT_KINDS)}",
        value=kind,
    )


def entity_id_for(kind: str, slug: str) -> str:
    return f"entity-{kind}-{slug}"


def episode_id_for(campaign_id: str, timeline_id: str, turn_number: int) -> str:
    """One deterministic episode id per (campaign, timeline, finalized turn)."""
    if not _is_exact_int(turn_number) or turn_number < 1:
        raise TemporalMemoryContractError(
            f"turn_number must be an int >= 1, got {turn_number!r}",
            field="turn_number",
            value=turn_number,
        )
    return f"episode-{campaign_id}-{timeline_id}-turn-{turn_number}"


def conflict_id_for(confluence_id: str, slug: str) -> str:
    """Conflict ids nest under their confluence id deterministically."""
    return f"{confluence_id.replace('confluence-', 'conflict-', 1)}-{slug}"


def transfer_id_for(campaign_id: str, from_timeline: str, to_timeline: str) -> str:
    return f"transfer-{campaign_id}-{from_timeline}-to-{to_timeline}"


def backlog_id_for(campaign_id: str, turn_number: int, slug: str) -> str:
    return f"backlog-{campaign_id}-t{turn_number}-{slug}"


# ---------------------------------------------------------------------------
# Subject
# ---------------------------------------------------------------------------


def validate_subject(record: Any) -> None:
    kind_name = "subject"
    rec = _require_mapping(record, kind_name)
    _check_fields(
        rec,
        kind_name,
        SUBJECT_FIELDS,
        required=("subject_id", "kind", "display_name"),
    )
    kind = _check_enum(rec["kind"], SUBJECT_KINDS, kind=kind_name, field="kind")
    campaign_id = rec.get("campaign_id")
    if campaign_id is not None:
        _check_name(campaign_id, kind=kind_name, field="campaign_id", max_chars=128)
    _check_semantic_id(
        rec["subject_id"], kind=kind_name, field="subject_id", prefix=ID_PREFIX["subject"]
    )
    _check_name(
        rec["display_name"], kind=kind_name, field="display_name", max_chars=200
    )

    structural: str | None = None
    if kind in ("world", "party"):
        if not campaign_id:
            raise ScopeError(
                f"{kind_name} kind {kind!r} is campaign-scoped; campaign_id "
                "is required",
                record_kind=kind_name,
                field="campaign_id",
            )
        structural = subject_id_for(kind, campaign_id, "")
    elif kind == "npc":
        if not campaign_id:
            raise ScopeError(
                "npc subjects are campaign-scoped; campaign_id is required",
                record_kind=kind_name,
                field="campaign_id",
            )
        structural = f"subject-npc-{campaign_id}-"
    # investigator/keeper/player: global slug ids, campaign_id optional.

    if structural is not None:
        sid = rec["subject_id"]
        exact = kind in ("world", "party")
        ok = sid == structural if exact else sid.startswith(structural)
        if not ok:
            raise SemanticIdError(
                f"subject_id {sid!r} does not match the deterministic form "
                f"for kind {kind!r} ({structural!r}...)",
                record_kind=kind_name,
                field="subject_id",
                value=sid,
            )

    _check_id_list(
        rec.get("same_subject_as"),
        kind=kind_name,
        field="same_subject_as",
        prefix=ID_PREFIX["subject"],
        allow_empty=True,
    )
    if rec["subject_id"] in (rec.get("same_subject_as") or []):
        raise IdentityError(
            "same_subject_as must not reference itself",
            record_kind=kind_name,
            field="same_subject_as",
            value=rec["subject_id"],
        )


# ---------------------------------------------------------------------------
# Entity
# ---------------------------------------------------------------------------


def validate_entity(record: Any) -> None:
    kind_name = "entity"
    rec = _require_mapping(record, kind_name)
    _check_fields(
        rec, kind_name, ENTITY_FIELDS, required=("entity_id", "kind", "display_name")
    )
    _check_enum(rec["kind"], ENTITY_KINDS, kind=kind_name, field="kind")
    _check_semantic_id(
        rec["entity_id"], kind=kind_name, field="entity_id", prefix=ID_PREFIX["entity"]
    )
    if not rec["entity_id"].startswith(f"entity-{rec['kind']}-"):
        raise SemanticIdError(
            f"entity_id {rec['entity_id']!r} must embed kind {rec['kind']!r} "
            "as its first token",
            record_kind=kind_name,
            field="entity_id",
            value=rec["entity_id"],
        )
    _check_name(rec["display_name"], kind=kind_name, field="display_name", max_chars=200)

    campaign_id = rec.get("campaign_id")
    if campaign_id is not None:
        _check_name(campaign_id, kind=kind_name, field="campaign_id", max_chars=128)
    elif not (rec.get("same_entity_as")):
        # Entities are campaign-scoped by default; a cross-campaign entity
        # exists only through an explicit binding edge. Never conflate
        # same-name entities implicitly.
        raise ScopeError(
            "entity without campaign_id must declare an explicit "
            "same_entity_as binding",
            record_kind=kind_name,
            field="same_entity_as",
        )

    aliases = rec.get("aliases") or []
    if not isinstance(aliases, (list, tuple)):
        raise TemporalMemoryContractError(
            "entity.aliases must be a list", record_kind=kind_name, field="aliases"
        )
    for alias in aliases:
        _check_name(alias, kind=kind_name, field="aliases", max_chars=200)
    if len(set(aliases)) != len(aliases):
        raise TemporalMemoryContractError(
            "entity.aliases contains duplicates",
            record_kind=kind_name,
            field="aliases",
        )

    _check_id_list(
        rec.get("same_entity_as"),
        kind=kind_name,
        field="same_entity_as",
        prefix=ID_PREFIX["entity"],
        allow_empty=True,
    )
    if rec["entity_id"] in (rec.get("same_entity_as") or []):
        raise IdentityError(
            "same_entity_as must not reference itself",
            record_kind=kind_name,
            field="same_entity_as",
            value=rec["entity_id"],
        )
    if rec.get("subject_ref") is not None:
        _check_semantic_id(
            rec["subject_ref"],
            kind=kind_name,
            field="subject_ref",
            prefix=ID_PREFIX["subject"],
        )


# ---------------------------------------------------------------------------
# Assertion
# ---------------------------------------------------------------------------


def validate_assertion(record: Any) -> None:
    kind_name = "assertion"
    rec = _require_mapping(record, kind_name)
    _check_fields(
        rec,
        kind_name,
        ASSERTION_FIELDS,
        required=(
            "assertion_id",
            "kind",
            "scope",
            "subject_id",
            "privacy",
            "state",
            "statement",
            "valid_from_turn",
            "source_commit",
            "source_turn",
            "source_receipts",
        ),
    )
    kind = _check_enum(rec["kind"], ASSERTION_KINDS, kind=kind_name, field="kind")
    scope = _check_enum(rec["scope"], SCOPES, kind=kind_name, field="scope")
    privacy = _check_enum(rec["privacy"], PRIVACY_LEVELS, kind=kind_name, field="privacy")
    state = _check_enum(rec["state"], MEMORY_STATES, kind=kind_name, field="state")

    _check_semantic_id(
        rec["assertion_id"],
        kind=kind_name,
        field="assertion_id",
        prefix=ID_PREFIX["assertion"],
    )
    _check_name(
        rec["statement"], kind=kind_name, field="statement", max_chars=MAX_STATEMENT_CHARS
    )
    _check_semantic_id(
        rec["subject_id"], kind=kind_name, field="subject_id", prefix=ID_PREFIX["subject"]
    )

    campaign_id = rec.get("campaign_id")
    timeline_id = rec.get("timeline_id")

    # --- scope binding -----------------------------------------------------
    if scope == "campaign":
        if not campaign_id or not timeline_id:
            raise ScopeError(
                "campaign-scoped assertions require campaign_id and "
                "timeline_id (campaign/timeline binding)",
                record_kind=kind_name,
                field="campaign_id",
            )
        if not rec["assertion_id"].startswith(f"mem-{campaign_id}-"):
            raise SemanticIdError(
                f"assertion_id {rec['assertion_id']!r} must embed campaign "
                f"slug {campaign_id!r} (mem-<campaign>-<slug>)",
                record_kind=kind_name,
                field="assertion_id",
                value=rec["assertion_id"],
            )
        _check_semantic_id(
            timeline_id, kind=kind_name, field="timeline_id", prefix=ID_PREFIX["timeline"]
        )
    else:  # cross_campaign
        if campaign_id is not None or timeline_id is not None:
            raise ScopeError(
                "cross-campaign assertions carry no campaign_id/timeline_id",
                record_kind=kind_name,
                field="scope",
            )
        if not rec["assertion_id"].startswith(CROSS_CAMPAIGN_ID_MARKER):
            raise SemanticIdError(
                f"cross-campaign assertion_id {rec['assertion_id']!r} must "
                f"use the {CROSS_CAMPAIGN_ID_MARKER!r} marker",
                record_kind=kind_name,
                field="assertion_id",
                value=rec["assertion_id"],
            )

    # --- kind-specific scope rules ----------------------------------------
    if kind == "world_event" and scope != "campaign":
        raise ScopeError(
            "world_event assertions are campaign/timeline-scoped",
            record_kind=kind_name,
            field="scope",
        )
    if kind == "summary" and scope != "campaign":
        raise ScopeError(
            "summary assertions are campaign/timeline-scoped",
            record_kind=kind_name,
            field="scope",
        )
    if kind == "player_assertion":
        if not rec["subject_id"].startswith("subject-player-"):
            raise ScopeError(
                "player_assertion subject must be a player subject",
                record_kind=kind_name,
                field="subject_id",
            )
        if privacy != "player_safe":
            raise PrivacyError(
                "player_assertion is player-visible by construction",
                record_kind=kind_name,
                field="privacy",
                value=privacy,
            )
    if kind == "player_preference" and not rec["subject_id"].startswith("subject-player-"):
        raise ScopeError(
            "player_preference subject must be a player subject",
            record_kind=kind_name,
            field="subject_id",
        )
    if kind == "keeper_correction" and not rec["subject_id"].startswith("subject-keeper-"):
        raise ScopeError(
            "keeper_correction subject must be a keeper subject",
            record_kind=kind_name,
            field="subject_id",
        )

    # --- knowers -----------------------------------------------------------
    knowers = _check_id_list(
        rec.get("knowers"),
        kind=kind_name,
        field="knowers",
        prefix=ID_PREFIX["subject"],
        allow_empty=True,
    )
    if kind in _OWNER_IN_KNOWERS_KINDS:
        if not knowers:
            raise MissingFieldError(
                f"{kind} assertions require at least one knower",
                record_kind=kind_name,
                field="knowers",
            )
        if rec["subject_id"] not in knowers:
            raise TemporalMemoryContractError(
                f"{kind} assertions require subject_id in knowers",
                record_kind=kind_name,
                field="knowers",
                value=rec["subject_id"],
            )

    # --- privacy projection rules -----------------------------------------
    if state == "suppressed" and privacy != "keeper_only":
        raise PrivacyError(
            "suppressed memories are hidden from the player (keeper_only)",
            record_kind=kind_name,
            field="privacy",
            value=privacy,
        )

    # --- entity references -------------------------------------------------
    entities = _check_id_list(
        rec.get("entities"),
        kind=kind_name,
        field="entities",
        prefix=ID_PREFIX["entity"],
        allow_empty=True,
    )
    if kind == "relationship" and len(entities) != 1:
        raise TemporalMemoryContractError(
            "relationship assertions direct subject -> exactly one entity "
            f"target, got {len(entities)}",
            record_kind=kind_name,
            field="entities",
        )

    # --- bitemporal fields -------------------------------------------------
    valid_from = rec["valid_from_turn"]
    if not _is_exact_int(valid_from) or valid_from < 0:
        raise TemporalMemoryContractError(
            "valid_from_turn must be an int >= 0",
            record_kind=kind_name,
            field="valid_from_turn",
            value=valid_from,
        )
    valid_until = rec.get("valid_until_turn")
    if valid_until is not None and (not _is_exact_int(valid_until) or valid_until < 0):
        raise TemporalMemoryContractError(
            "valid_until_turn must be an int >= 0 or null",
            record_kind=kind_name,
            field="valid_until_turn",
            value=valid_until,
        )
    occurred = rec.get("occurred_turn")
    if occurred is not None and (not _is_exact_int(occurred) or occurred < 0):
        raise TemporalMemoryContractError(
            "occurred_turn must be an int >= 0 or null",
            record_kind=kind_name,
            field="occurred_turn",
            value=occurred,
        )
    if occurred is not None and occurred > valid_from:
        raise TemporalMemoryContractError(
            "occurred_turn must not be after valid_from_turn (a memory is "
            "formed at or after the event)",
            record_kind=kind_name,
            field="occurred_turn",
            value=occurred,
        )
    if valid_until is not None and valid_until < valid_from:
        raise TemporalMemoryContractError(
            "valid_until_turn must be >= valid_from_turn",
            record_kind=kind_name,
            field="valid_until_turn",
            value=valid_until,
        )

    # --- supersession / contradiction preservation -------------------------
    superseded_by = _check_id_list(
        rec.get("superseded_by"),
        kind=kind_name,
        field="superseded_by",
        prefix=ID_PREFIX["assertion"],
        allow_empty=True,
    )
    contradicts = _check_id_list(
        rec.get("contradicts"),
        kind=kind_name,
        field="contradicts",
        prefix=ID_PREFIX["assertion"],
        allow_empty=True,
    )
    confirms = _check_id_list(
        rec.get("confirms"),
        kind=kind_name,
        field="confirms",
        prefix=ID_PREFIX["assertion"],
        allow_empty=True,
    )
    own_id = rec["assertion_id"]
    for field, ids in (
        ("superseded_by", superseded_by),
        ("contradicts", contradicts),
        ("confirms", confirms),
    ):
        if own_id in ids:
            raise SupersessionError(
                f"assertion {field} must not reference itself",
                record_kind=kind_name,
                field=field,
                value=own_id,
            )
    if valid_until is not None and not superseded_by:
        raise SupersessionError(
            "an assertion is closed only by supersession: valid_until_turn "
            "requires non-empty superseded_by (records are never deleted)",
            record_kind=kind_name,
            field="superseded_by",
        )
    if superseded_by and valid_until is None:
        raise SupersessionError(
            "superseded_by requires valid_until_turn to close the assertion",
            record_kind=kind_name,
            field="valid_until_turn",
        )
    if state == "contradictory" and not contradicts:
        raise SupersessionError(
            "contradictory assertions must name what they contradict",
            record_kind=kind_name,
            field="contradicts",
        )

    # --- summary compression audit trail ------------------------------------
    covers = rec.get("covers_commits") or []
    if kind == "summary":
        if not covers:
            raise MissingFieldError(
                "summary assertions require covers_commits (auditable "
                "compression)",
                record_kind=kind_name,
                field="covers_commits",
            )
    elif covers:
        raise TemporalMemoryContractError(
            "covers_commits is reserved for summary assertions",
            record_kind=kind_name,
            field="covers_commits",
        )
    for sha in covers:
        _check_commit_sha(sha, kind=kind_name, field="covers_commits")

    if rec.get("transfer_ref") is not None:
        _check_semantic_id(
            rec["transfer_ref"],
            kind=kind_name,
            field="transfer_ref",
            prefix=ID_PREFIX["transfer"],
        )

    # --- provenance always bound --------------------------------------------
    _check_commit_sha(rec["source_commit"], kind=kind_name, field="source_commit")
    turn = rec["source_turn"]
    if not _is_exact_int(turn) or turn < 0:
        raise ProvenanceError(
            "source_turn must be an int >= 0 (0 = pre-campaign/baseline)",
            record_kind=kind_name,
            field="source_turn",
            value=turn,
        )
    receipts = rec["source_receipts"]
    if not isinstance(receipts, (list, tuple)) or not receipts:
        raise ProvenanceError(
            "source_receipts must be a non-empty list (provenance is always "
            "bound; receipt ids are machine-attached integrity evidence)",
            record_kind=kind_name,
            field="source_receipts",
        )
    for receipt in receipts:
        _check_name(
            receipt, kind=kind_name, field="source_receipts", max_chars=200
        )


def plan_supersession(
    assertion: Mapping[str, Any],
    successor_id: str,
    *,
    valid_until_turn: int,
) -> dict[str, Any]:
    """Return the closed copy of ``assertion`` superseded by ``successor_id``.

    Pure helper encoding the never-delete law: supersession mutates the old
    record in place (id unchanged, still addressable) rather than removing
    it. The caller owns persistence.
    """
    updated = dict(assertion)
    existing = list(updated.get("superseded_by") or [])
    if successor_id not in existing:
        existing.append(successor_id)
    updated["superseded_by"] = existing
    updated["valid_until_turn"] = valid_until_turn
    validate_assertion(updated)
    return updated


# ---------------------------------------------------------------------------
# Sanctioned same-id rewrites (immutable replay law)
# ---------------------------------------------------------------------------

# The only fields a sanctioned supersession close may change. Every other
# assertion field is immutable once written: same-id writes must replay
# byte-identically or apply exactly the plan_supersession delta.
SUPERSESSION_DELTA_FIELDS: tuple[str, ...] = ("valid_until_turn", "superseded_by")

# Identity fields of a subject/entity record that may never change after
# the first write. Same-name/same-id rewrites that touch any of these are
# silent identity replacement and are rejected.
SUBJECT_IMMUTABLE_FIELDS: tuple[str, ...] = ("kind", "campaign_id", "display_name")
SUBJECT_APPEND_ONLY_FIELDS: tuple[str, ...] = ("same_subject_as",)
ENTITY_IMMUTABLE_FIELDS: tuple[str, ...] = (
    "kind",
    "campaign_id",
    "display_name",
    "subject_ref",
)
ENTITY_APPEND_ONLY_FIELDS: tuple[str, ...] = ("aliases", "same_entity_as")


def is_sanctioned_supersession(
    prior: Mapping[str, Any], updated: Mapping[str, Any]
) -> bool:
    """True iff ``updated`` is exactly ``plan_supersession(prior, s, X)``.

    A stored assertion with the same id may only replay byte-identically
    (caller checks digests first) or close via the one sanctioned delta:
    the prior record is still open, and the new record differs solely by
    ``valid_until_turn`` plus the appended successor id. Subject, knowers,
    privacy, state, statement, entities, provenance, and existing edges
    must be untouched. A record that is already closed can never be
    rewritten again — only byte-identical replay remains.
    """
    if prior.get("assertion_id") != updated.get("assertion_id"):
        return False
    if prior.get("valid_until_turn") is not None:
        # Already closed: no second close, no edge edits, nothing mutable.
        return False
    new_until = updated.get("valid_until_turn")
    if new_until is None:
        return False
    successors = list(updated.get("superseded_by") or [])
    if len(successors) != 1:
        return False
    try:
        expected = plan_supersession(
            prior, successors[0], valid_until_turn=new_until
        )
    except TemporalMemoryContractError:
        return False
    return canonical_json(expected) == canonical_json(updated)


def is_sanctioned_identity_extension(
    prior: Mapping[str, Any],
    updated: Mapping[str, Any],
    *,
    record_kind: str,
) -> bool:
    """True iff ``updated`` keeps a subject/entity identity frozen and only
    appends new unique entries to append-only list fields.

    Same subject/entity id may replay byte-identically or extend explicitly:
    immutable identity fields (kind, campaign scope, display name, entity
    subject binding) must be equal, and ``aliases`` /
    ``same_subject_as`` / ``same_entity_as`` may only grow — the prior list
    must remain an exact ordered prefix. Removal, reordering, or rewriting
    of any prior entry is silent identity replacement and is rejected.
    """
    if record_kind == "subject":
        id_field = "subject_id"
        immutable = SUBJECT_IMMUTABLE_FIELDS
        append_only = SUBJECT_APPEND_ONLY_FIELDS
    elif record_kind == "entity":
        id_field = "entity_id"
        immutable = ENTITY_IMMUTABLE_FIELDS
        append_only = ENTITY_APPEND_ONLY_FIELDS
    else:
        raise TemporalMemoryContractError(
            f"unknown identity record kind {record_kind!r}",
            record_kind=record_kind,
        )
    if prior.get(id_field) != updated.get(id_field):
        return False
    for field in immutable:
        if prior.get(field) != updated.get(field):
            return False
    for field in append_only:
        old_list = prior.get(field) or []
        new_list = updated.get(field) or []
        if not isinstance(old_list, list) or not isinstance(new_list, list):
            return False
        if new_list[: len(old_list)] != old_list:
            return False
        if len(set(new_list)) != len(new_list):
            return False
    return True


# ---------------------------------------------------------------------------
# Episode
# ---------------------------------------------------------------------------


def validate_episode(record: Any) -> None:
    kind_name = "episode"
    rec = _require_mapping(record, kind_name)
    _check_fields(
        rec,
        kind_name,
        EPISODE_FIELDS,
        required=(
            "episode_id",
            "campaign_id",
            "timeline_id",
            "commit",
            "turn_number",
            "finalization_receipt",
        ),
    )
    _check_name(rec["campaign_id"], kind=kind_name, field="campaign_id", max_chars=128)
    _check_semantic_id(
        rec["timeline_id"], kind=kind_name, field="timeline_id", prefix=ID_PREFIX["timeline"]
    )
    _check_semantic_id(
        rec["episode_id"], kind=kind_name, field="episode_id", prefix=ID_PREFIX["episode"]
    )
    expected = episode_id_for(rec["campaign_id"], rec["timeline_id"], rec["turn_number"])
    if rec["episode_id"] != expected:
        raise SemanticIdError(
            f"episode_id {rec['episode_id']!r} must equal the deterministic "
            f"id {expected!r}",
            record_kind=kind_name,
            field="episode_id",
            value=rec["episode_id"],
        )
    _check_commit_sha(rec["commit"], kind=kind_name, field="commit")
    turn = rec["turn_number"]
    if not _is_exact_int(turn) or turn < 1:
        raise TemporalMemoryContractError(
            "episode turn_number must be an int >= 1 (one episode per "
            "finalized turn commit)",
            record_kind=kind_name,
            field="turn_number",
            value=turn,
        )
    _check_name(
        rec["finalization_receipt"],
        kind=kind_name,
        field="finalization_receipt",
        max_chars=200,
    )
    _check_id_list(
        rec.get("subjects_present"),
        kind=kind_name,
        field="subjects_present",
        prefix=ID_PREFIX["subject"],
        allow_empty=True,
    )
    _check_id_list(
        rec.get("entities"),
        kind=kind_name,
        field="entities",
        prefix=ID_PREFIX["entity"],
        allow_empty=True,
    )


# ---------------------------------------------------------------------------
# Timeline
# ---------------------------------------------------------------------------


def _validate_fork_point(value: Any, *, kind_name: str) -> None:
    if not isinstance(value, Mapping):
        raise TimelineError(
            "fork_point must be a mapping",
            record_kind=kind_name,
            field="fork_point",
        )
    _check_fields(value, "fork_point", FORK_POINT_FIELDS, required=FORK_POINT_FIELDS)
    _check_commit_sha(value["commit"], kind="fork_point", field="commit")
    if not _is_exact_int(value["turn"]) or value["turn"] < 1:
        raise TimelineError(
            "fork_point.turn must be an int >= 1",
            record_kind="fork_point",
            field="turn",
            value=value["turn"],
        )
    _check_semantic_id(
        value["episode_id"], kind="fork_point", field="episode_id", prefix=ID_PREFIX["episode"]
    )


def validate_timeline(record: Any) -> None:
    kind_name = "timeline"
    rec = _require_mapping(record, kind_name)
    _check_fields(
        rec,
        kind_name,
        TIMELINE_FIELDS,
        required=("timeline_id", "campaign_id", "kind", "parents", "created_by"),
    )
    _check_semantic_id(
        rec["timeline_id"], kind=kind_name, field="timeline_id", prefix=ID_PREFIX["timeline"]
    )
    _check_name(rec["campaign_id"], kind=kind_name, field="campaign_id", max_chars=128)
    kind = _check_enum(rec["kind"], TIMELINE_KINDS, kind=kind_name, field="kind")
    created_by = _check_enum(
        rec["created_by"], TIMELINE_CREATED_BY, kind=kind_name, field="created_by"
    )
    parents = _check_id_list(
        rec["parents"],
        kind=kind_name,
        field="parents",
        prefix=ID_PREFIX["timeline"],
        allow_empty=True,
    )

    if kind == "root":
        if rec["timeline_id"] != ROOT_TIMELINE_ID:
            raise TimelineError(
                f"the root timeline id is fixed to {ROOT_TIMELINE_ID!r}",
                record_kind=kind_name,
                field="timeline_id",
                value=rec["timeline_id"],
            )
        if parents or created_by != "initial":
            raise TimelineError(
                "root timeline has no parents and created_by=initial",
                record_kind=kind_name,
                field="parents",
            )
        if rec.get("fork_point") is not None:
            raise TimelineError(
                "root timeline has no fork_point",
                record_kind=kind_name,
                field="fork_point",
            )
    elif kind == "fork":
        if len(parents) != 1:
            raise TimelineError(
                "fork timelines have exactly one parent",
                record_kind=kind_name,
                field="parents",
                value=parents,
            )
        if rec["timeline_id"] in parents:
            raise TimelineError(
                "a timeline cannot be its own parent",
                record_kind=kind_name,
                field="parents",
                value=parents,
            )
        if rec.get("fork_point") is None:
            raise TimelineError(
                "fork timelines require fork_point (commit/turn/episode)",
                record_kind=kind_name,
                field="fork_point",
            )
        _validate_fork_point(rec["fork_point"], kind_name=kind_name)
    else:  # confluence
        if len(parents) != 2 or len(set(parents)) != 2:
            raise TimelineError(
                "confluence timelines have exactly two distinct parents",
                record_kind=kind_name,
                field="parents",
                value=parents,
            )
        if rec["timeline_id"] in parents:
            raise TimelineError(
                "a confluence timeline cannot be its own parent",
                record_kind=kind_name,
                field="parents",
            )
        if rec.get("fork_point") is None:
            raise TimelineError(
                "confluence timelines require fork_point",
                record_kind=kind_name,
                field="fork_point",
            )
        _validate_fork_point(rec["fork_point"], kind_name=kind_name)


def validate_timeline_set(
    timelines: Iterable[Any], *, active_timeline_id: str | None = None
) -> None:
    """Bundle rules: unique ids, resolvable parents, no cycles, exactly one
    root, and an in-set active pointer when provided."""
    records = list(timelines)
    by_id: dict[str, Mapping[str, Any]] = {}
    for record in records:
        validate_timeline(record)
        tid = record["timeline_id"]
        if tid in by_id:
            raise TimelineError(
                f"duplicate timeline id {tid!r}",
                record_kind="timeline",
                field="timeline_id",
                value=tid,
            )
        by_id[tid] = record
    if ROOT_TIMELINE_ID not in by_id:
        raise TimelineError(
            f"every campaign timeline set contains the root {ROOT_TIMELINE_ID!r}",
            record_kind="timeline",
            field="timeline_id",
        )

    def has_cycle(start: str) -> bool:
        # White/gray/black DFS: a node reached twice through different
        # parents is a diamond (the normal confluence shape), not a cycle;
        # only a gray node on the current path is a true cycle.
        color: dict[str, int] = {}

        def visit(node: str) -> bool:
            state = color.get(node, 0)
            if state == 1:
                return True
            if state == 2:
                return False
            color[node] = 1
            for parent in by_id.get(node, {}).get("parents") or []:
                if visit(parent):
                    return True
            color[node] = 2
            return False

        return visit(start)

    for tid in by_id:
        if has_cycle(tid):
            raise TimelineError(
                f"timeline parent graph has a cycle reachable from {tid!r}",
                record_kind="timeline",
                field="parents",
                value=tid,
            )
    if active_timeline_id is not None and active_timeline_id not in by_id:
        raise TimelineError(
            f"active timeline {active_timeline_id!r} is not in the timeline set",
            record_kind="timeline",
            field="timeline_id",
            value=active_timeline_id,
        )


# ---------------------------------------------------------------------------
# Confluence
# ---------------------------------------------------------------------------


def _validate_conflict_side(value: Any, *, parent: str) -> None:
    kind_name = "conflict"
    if not isinstance(value, Mapping):
        raise ConfluenceError(
            "conflict side must be a mapping",
            record_kind=kind_name,
            field="side",
        )
    _check_fields(value, "conflict_side", CONFLICT_SIDE_FIELDS, required=("timeline", "refs"))
    if value["timeline"] != parent:
        raise ConfluenceError(
            f"conflict side timeline {value['timeline']!r} does not match "
            f"assigned parent {parent!r} (left=parents[0], right=parents[1]: "
            "deterministic ordering)",
            record_kind="conflict_side",
            field="timeline",
            value=value["timeline"],
        )
    refs = value["refs"]
    if not isinstance(refs, (list, tuple)) or not refs:
        raise ConfluenceError(
            "conflict side refs must be a non-empty list of receipt/state "
            "references",
            record_kind="conflict_side",
            field="refs",
        )
    for ref in refs:
        _check_name(ref, kind="conflict_side", field="refs", max_chars=200)


def validate_confluence(record: Any) -> None:
    kind_name = "confluence"
    rec = _require_mapping(record, kind_name)
    _check_fields(
        rec,
        kind_name,
        CONFLUENCE_FIELDS,
        required=(
            "confluence_id",
            "campaign_id",
            "timeline_id",
            "parents",
            "merge_commit",
            "receipt",
            "conflicts",
        ),
    )
    _check_semantic_id(
        rec["confluence_id"],
        kind=kind_name,
        field="confluence_id",
        prefix=ID_PREFIX["confluence"],
    )
    _check_name(rec["campaign_id"], kind=kind_name, field="campaign_id", max_chars=128)
    _check_semantic_id(
        rec["timeline_id"], kind=kind_name, field="timeline_id", prefix=ID_PREFIX["timeline"]
    )
    parents = _check_id_list(
        rec["parents"],
        kind=kind_name,
        field="parents",
        prefix=ID_PREFIX["timeline"],
        allow_empty=False,
    )
    if len(parents) != 2 or len(set(parents)) != 2:
        raise ConfluenceError(
            "confluence has exactly two distinct parent timelines",
            record_kind=kind_name,
            field="parents",
            value=parents,
        )
    if rec["timeline_id"] in parents:
        raise ConfluenceError(
            "the merged timeline is a third timeline, not one of its parents",
            record_kind=kind_name,
            field="timeline_id",
        )
    _check_commit_sha(rec["merge_commit"], kind=kind_name, field="merge_commit")
    _check_name(rec["receipt"], kind=kind_name, field="receipt", max_chars=200)

    conflicts = rec["conflicts"]
    if not isinstance(conflicts, (list, tuple)):
        raise ConfluenceError(
            "conflicts must be a list (the complete deterministic diff)",
            record_kind=kind_name,
            field="conflicts",
        )
    conflict_prefix = rec["confluence_id"].replace(
        ID_PREFIX["confluence"], ID_PREFIX["conflict"], 1
    )
    seen_conflicts: set[str] = set()
    for conflict in conflicts:
        _validate_conflict(conflict, parents=parents, conflict_prefix=conflict_prefix)
        cid = conflict["conflict_id"]
        if cid in seen_conflicts:
            raise ConfluenceError(
                f"duplicate conflict id {cid!r}",
                record_kind="conflict",
                field="conflict_id",
                value=cid,
            )
        seen_conflicts.add(cid)


def _validate_conflict(
    conflict: Any, *, parents: list[str], conflict_prefix: str
) -> None:
    kind_name = "conflict"
    if not isinstance(conflict, Mapping):
        raise ConfluenceError(
            "each conflict must be a mapping", record_kind=kind_name, field="conflicts"
        )
    _check_fields(
        conflict,
        kind_name,
        ("conflict_id", "class", "left", "right", "disposition"),
        required=("conflict_id", "class", "left", "right"),
    )
    _check_semantic_id(
        conflict["conflict_id"],
        kind=kind_name,
        field="conflict_id",
        prefix=ID_PREFIX["conflict"],
    )
    if not conflict["conflict_id"].startswith(f"{conflict_prefix}-"):
        raise SemanticIdError(
            f"conflict_id {conflict['conflict_id']!r} must nest under its "
            f"confluence ({conflict_prefix!r}-)",
            record_kind=kind_name,
            field="conflict_id",
        )
    conflict_class = _check_enum(
        conflict["class"], CONFLICT_CLASSES, kind=kind_name, field="class"
    )
    _validate_conflict_side(conflict["left"], parent=parents[0])
    _validate_conflict_side(conflict["right"], parent=parents[1])

    disposition = conflict.get("disposition")
    if not isinstance(disposition, Mapping):
        raise ConfluenceError(
            "every conflict requires a disposition (complete dispositions "
            "only; no silent JSON merge)",
            record_kind=kind_name,
            field="disposition",
        )
    _check_fields(
        disposition,
        "disposition",
        DISPOSITION_FIELDS,
        required=("mode", "receipt"),
    )
    mode = _check_enum(disposition["mode"], DISPOSITION_MODES, kind="disposition", field="mode")
    _check_name(disposition["receipt"], kind="disposition", field="receipt", max_chars=200)
    if conflict_class in HARD_STATE_CONFLICT_CLASSES and not (
        disposition.get("resolver_receipt") or ""
    ).strip():
        raise ConfluenceError(
            f"hard-state conflict class {conflict_class!r} requires "
            "disposition.resolver_receipt (hard mechanics resolver must "
            "validate numbers before the confluence record is written)",
            record_kind="disposition",
            field="resolver_receipt",
        )
    if (
        conflict_class in NON_DUPLICABLE_CONFLICT_CLASSES
        and mode in _FORBIDDEN_MODES_FOR_NON_DUPLICABLE
    ):
        raise ConfluenceError(
            f"conflict class {conflict_class!r} must not be disposed via "
            f"{mode!r}: rolls, one-time effects, item consumption, and "
            "death are never duplicated or combined across timelines",
            record_kind="disposition",
            field="mode",
            value=mode,
        )
    if mode == "defer" and not (disposition.get("note") or "").strip():
        raise ConfluenceError(
            "deferred conflicts require a disposition note naming the "
            "follow-up",
            record_kind="disposition",
            field="note",
        )


# ---------------------------------------------------------------------------
# Cross-timeline transfer
# ---------------------------------------------------------------------------


def validate_transfer(record: Any) -> None:
    kind_name = "transfer"
    rec = _require_mapping(record, kind_name)
    _check_fields(
        rec,
        kind_name,
        TRANSFER_FIELDS,
        required=(
            "transfer_id",
            "campaign_id",
            "from_timeline",
            "to_timeline",
            "receipt",
            "source_commit",
            "source_turn",
            "entries",
        ),
    )
    _check_semantic_id(
        rec["transfer_id"],
        kind=kind_name,
        field="transfer_id",
        prefix=ID_PREFIX["transfer"],
    )
    _check_name(rec["campaign_id"], kind=kind_name, field="campaign_id", max_chars=128)
    from_tl = _check_semantic_id(
        rec["from_timeline"], kind=kind_name, field="from_timeline", prefix=ID_PREFIX["timeline"]
    )
    to_tl = _check_semantic_id(
        rec["to_timeline"], kind=kind_name, field="to_timeline", prefix=ID_PREFIX["timeline"]
    )
    if from_tl == to_tl:
        raise TransferError(
            "cross-timeline transfer requires distinct timelines",
            record_kind=kind_name,
            field="to_timeline",
        )
    _check_name(rec["receipt"], kind=kind_name, field="receipt", max_chars=200)
    _check_commit_sha(rec["source_commit"], kind=kind_name, field="source_commit")
    if not _is_exact_int(rec["source_turn"]) or rec["source_turn"] < 0:
        raise ProvenanceError(
            "source_turn must be an int >= 0",
            record_kind=kind_name,
            field="source_turn",
        )
    if rec.get("play_cost") is not None:
        _check_name(rec["play_cost"], kind=kind_name, field="play_cost", max_chars=500)

    entries = rec["entries"]
    if not isinstance(entries, (list, tuple)) or not entries:
        raise TransferError(
            "transfer requires at least one entry",
            record_kind=kind_name,
            field="entries",
        )
    seen_targets: set[str] = set()
    for entry in entries:
        if not isinstance(entry, Mapping):
            raise TransferError(
                "each transfer entry must be a mapping",
                record_kind=kind_name,
                field="entries",
            )
        _check_fields(
            entry,
            "transfer_entry",
            TRANSFER_ENTRY_FIELDS,
            required=(
                "source_assertion",
                "target_assertion",
                "state",
                "credibility",
                "privacy",
            ),
        )
        source = _check_semantic_id(
            entry["source_assertion"],
            kind="transfer_entry",
            field="source_assertion",
            prefix=ID_PREFIX["assertion"],
        )
        target = _check_semantic_id(
            entry["target_assertion"],
            kind="transfer_entry",
            field="target_assertion",
            prefix=ID_PREFIX["assertion"],
        )
        if source == target:
            raise TransferError(
                "a transferred assertion is a NEW assertion in the target "
                "timeline; ids must differ",
                record_kind="transfer_entry",
                field="target_assertion",
            )
        if target in seen_targets:
            raise TransferError(
                f"duplicate transfer target {target!r}",
                record_kind="transfer_entry",
                field="target_assertion",
                value=target,
            )
        seen_targets.add(target)
        _check_enum(entry["state"], MEMORY_STATES, kind="transfer_entry", field="state")
        _check_enum(entry["privacy"], PRIVACY_LEVELS, kind="transfer_entry", field="privacy")
        credibility = entry["credibility"]
        if (
            isinstance(credibility, bool)
            or not isinstance(credibility, (int, float))
            or not 0.0 <= float(credibility) <= 1.0
        ):
            raise TransferError(
                "credibility must be a number in [0, 1]",
                record_kind="transfer_entry",
                field="credibility",
                value=credibility,
            )
        if entry.get("distortion") is not None:
            _check_name(
                entry["distortion"],
                kind="transfer_entry",
                field="distortion",
                max_chars=500,
            )


def validate_transfer_links(
    transfer: Mapping[str, Any], assertions: Iterable[Mapping[str, Any]]
) -> None:
    """Cross-record rule: every entry target exists in the bundle, carries
    ``transfer_ref`` back to the transfer, and lives on the target timeline;
    every entry source lives on the source timeline."""
    validate_transfer(transfer)
    by_id = {a["assertion_id"]: a for a in assertions if isinstance(a, Mapping)}
    for entry in transfer["entries"]:
        source = by_id.get(entry["source_assertion"])
        if source is None:
            raise TransferError(
                f"transfer source {entry['source_assertion']!r} missing from "
                "the assertion bundle",
                record_kind="transfer",
                field="entries",
            )
        if source.get("timeline_id") != transfer["from_timeline"]:
            raise TransferError(
                f"transfer source {source['assertion_id']!r} is not on "
                f"from_timeline {transfer['from_timeline']!r}",
                record_kind="transfer",
                field="entries",
            )
        target = by_id.get(entry["target_assertion"])
        if target is None:
            raise TransferError(
                f"transfer target {entry['target_assertion']!r} missing from "
                "the assertion bundle",
                record_kind="transfer",
                field="entries",
            )
        if target.get("timeline_id") != transfer["to_timeline"]:
            raise TransferError(
                f"transfer target {target['assertion_id']!r} must live on "
                f"to_timeline {transfer['to_timeline']!r}",
                record_kind="transfer",
                field="entries",
            )
        if target.get("transfer_ref") != transfer["transfer_id"]:
            raise TransferError(
                f"transfer target {target['assertion_id']!r} must carry "
                f"transfer_ref={transfer['transfer_id']!r}",
                record_kind="transfer",
                field="entries",
            )


# ---------------------------------------------------------------------------
# Extraction backlog
# ---------------------------------------------------------------------------


def validate_backlog_record(record: Any) -> None:
    kind_name = "backlog"
    rec = _require_mapping(record, kind_name)
    _check_fields(
        rec,
        kind_name,
        BACKLOG_FIELDS,
        required=(
            "backlog_id",
            "campaign_id",
            "timeline_id",
            "commit",
            "turn_number",
            "reason",
            "status",
        ),
    )
    _check_semantic_id(
        rec["backlog_id"], kind=kind_name, field="backlog_id", prefix=ID_PREFIX["backlog"]
    )
    _check_name(rec["campaign_id"], kind=kind_name, field="campaign_id", max_chars=128)
    _check_semantic_id(
        rec["timeline_id"], kind=kind_name, field="timeline_id", prefix=ID_PREFIX["timeline"]
    )
    _check_commit_sha(rec["commit"], kind=kind_name, field="commit")
    if not _is_exact_int(rec["turn_number"]) or rec["turn_number"] < 1:
        raise TemporalMemoryContractError(
            "backlog turn_number must be an int >= 1",
            record_kind=kind_name,
            field="turn_number",
        )
    _check_enum(rec["reason"], BACKLOG_REASONS, kind=kind_name, field="reason")
    _check_enum(rec["status"], BACKLOG_STATUSES, kind=kind_name, field="status")


# ---------------------------------------------------------------------------
# Deterministic identity resolution (never conflates same names)
# ---------------------------------------------------------------------------


def resolve_subject_ids(
    subjects: Iterable[Mapping[str, Any]], *, campaign_id: str, name: str
) -> list[str]:
    """Exact-match resolution over a campaign bundle: campaign-scoped
    subjects match by campaign; cross-campaign subjects (player/keeper/
    investigator) are included. Multiple matches are returned — the caller
    (KP semantics) disambiguates. No fuzzy matching, ever."""
    matches: list[str] = []
    for subject in subjects:
        subject_campaign = subject.get("campaign_id")
        if subject_campaign is not None and subject_campaign != campaign_id:
            continue
        if subject.get("display_name") == name:
            matches.append(subject["subject_id"])
    return sorted(matches)


def resolve_entity_ids(
    entities: Iterable[Mapping[str, Any]], *, campaign_id: str, name: str
) -> list[str]:
    """Exact-match over display_name + aliases within the campaign (and
    explicitly bound cross-campaign entities). Same name, different ids ->
    multiple candidates: never auto-pick; KP binds via same_entity_as."""
    matches: list[str] = []
    for entity in entities:
        entity_campaign = entity.get("campaign_id")
        if entity_campaign is not None and entity_campaign != campaign_id:
            continue
        names = {entity.get("display_name"), *(entity.get("aliases") or [])}
        if name in names:
            matches.append(entity["entity_id"])
    return sorted(matches)


def require_unique_id(matches: list[str], *, kind: str, name: str) -> str:
    """Deterministic disambiguation gate: exactly one match, or an explicit
    IdentityError. Never silently conflate same-name identities."""
    if not matches:
        raise IdentityError(
            f"no {kind} matches name {name!r}",
            record_kind=kind,
            field="display_name",
            value=name,
        )
    if len(matches) > 1:
        raise IdentityError(
            f"{len(matches)} {kind} records match name {name!r}: {matches}; "
            "same-name identities are never conflated without an explicit "
            "same_entity_as/same_subject_as binding",
            record_kind=kind,
            field="display_name",
            value=name,
        )
    return matches[0]


# ---------------------------------------------------------------------------
# Deterministic projection (privacy / subject / time narrowing)
# ---------------------------------------------------------------------------


def is_player_visible(assertion: Mapping[str, Any]) -> bool:
    return assertion.get("privacy") == "player_safe"


def effective_at(assertion: Mapping[str, Any], turn: int) -> bool:
    """Valid-time membership on [valid_from_turn, valid_until_turn]
    (inclusive; valid_until_turn None = still current)."""
    valid_from = assertion.get("valid_from_turn")
    valid_until = assertion.get("valid_until_turn")
    if not _is_exact_int(valid_from):
        return False
    if turn < valid_from:
        return False
    if valid_until is not None and turn > valid_until:
        return False
    return True


def project_player_view(
    assertions: Iterable[Mapping[str, Any]],
) -> list[Mapping[str, Any]]:
    """Deterministic player-safe projection: privacy == player_safe, sorted
    by assertion id. Superseded/closed assertions remain visible unless their
    own record says otherwise (privacy is per-assertion)."""
    visible = [a for a in assertions if is_player_visible(a)]
    return sorted(visible, key=lambda a: a["assertion_id"])


def project_subject_view(
    assertions: Iterable[Mapping[str, Any]],
    subject_id: str,
    *,
    as_of_turn: int | None = None,
) -> list[Mapping[str, Any]]:
    """Deterministic retrieval narrowing: subject membership (owner or
    knower), optional valid-time point query, stable id ordering. Semantic
    relevance judgement stays with the KP; this is pure data narrowing."""
    rows: list[Mapping[str, Any]] = []
    for assertion in assertions:
        knowers = assertion.get("knowers") or []
        if assertion.get("subject_id") != subject_id and subject_id not in knowers:
            continue
        if as_of_turn is not None and not effective_at(assertion, as_of_turn):
            continue
        rows.append(assertion)
    return sorted(rows, key=lambda a: a["assertion_id"])


# ---------------------------------------------------------------------------
# Assertion bundle integrity
# ---------------------------------------------------------------------------


def validate_assertion_bundle(
    assertions: Iterable[Mapping[str, Any]], *, require_valid: bool = True
) -> None:
    """Bundle-level integrity: unique ids, every record individually valid,
    and every supersession/contradiction/confirmation/transfer reference
    resolvable inside the bundle (same campaign store)."""
    records = list(assertions)
    by_id: dict[str, Mapping[str, Any]] = {}
    for assertion in records:
        if require_valid:
            validate_assertion(assertion)
        aid = assertion["assertion_id"]
        if aid in by_id:
            raise TemporalMemoryContractError(
                f"duplicate assertion id {aid!r}",
                record_kind="assertion",
                field="assertion_id",
                value=aid,
            )
        by_id[aid] = assertion
    for assertion in records:
        for field in ("superseded_by", "contradicts", "confirms"):
            for ref in assertion.get(field) or []:
                if ref not in by_id:
                    raise SupersessionError(
                        f"assertion {assertion['assertion_id']!r} {field} "
                        f"references unknown assertion {ref!r}",
                        record_kind="assertion",
                        field=field,
                        value=ref,
                    )
        transfer_ref = assertion.get("transfer_ref")
        if transfer_ref is not None and require_valid:
            # The referenced transfer record is validated by
            # validate_transfer_links together with this bundle.
            _check_semantic_id(
                transfer_ref,
                kind="assertion",
                field="transfer_ref",
                prefix=ID_PREFIX["transfer"],
            )
