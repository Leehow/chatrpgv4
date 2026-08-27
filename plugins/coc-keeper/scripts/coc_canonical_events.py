#!/usr/bin/env python3
"""Frozen contract layer for the canonical COC campaign event stream.

This module owns the ``coc-events-1`` contract: the closed envelope
schema, the 12-type event registry, per-type closed payload schemas,
deterministic semantic-ID construction, durable sequence allocation,
emission (:func:`emit` into ``logs/canonical-events.jsonl`` through the
campaign JSONL machinery), decision-id idempotency, and the choke-point
"uncovered writes" sidecar. It also owns the rebuildable read-only SQLite
projection (``memory/events-projection.db``, generation ``coc-events-1``):
the JSONL stream stays the sole canonical record and the database is a
deletable cache rebuilt or incrementally applied after every successful
emit.

Standing law encoded by this contract:

- ``state.*`` / ``rules.*`` stay authoritative. Canonical events are
  **derived evidence**: feeding projections (battle report, history query),
  never an event-replay state-restoration mechanism.
- Clean-slate schema generation ``coc-events-1``: no migrations, no dual
  readers, no compatibility fallbacks. Historical events stay read-only;
  upcasting happens read-side, only when a projection needs normalization.
- Envelope follows CloudEvents *shape* without adopting an SDK: ``data``
  holds domain payloads, context attributes hold identity/causality. The
  field set is closed; unknown fields fail validation.
- Event types come from emission-point code. No keyword, regex, or prose
  classification ever assigns a type (semantic matcher constitution):
  similar facts merge into one type, detail demotes to payload fields.
- Model-visible identifiers are semantic ids (human-readable kebab tokens);
  digests are machine-internal integrity evidence code attaches and checks.
  IDs are built deterministically by :func:`event_id_for`; models never
  transcribe random bytes.
- Idempotency key is ``decision_id``: replaying an emit whose semantic
  content byte-matches the stored record is a no-op; replaying under the
  same ``decision_id`` with different content fails closed.
- Player-visible language zh-Hans governs rendered output; this stream is
  machine data. ``privacy="secret"`` events are Keeper-side only.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Iterator, Mapping

CONTRACT_NAME = "canonical-events"
CONTRACT_SCHEMA_VERSION = 1
SCHEMA_GENERATION = "coc-events-1"

SPECVERSION = "coc-events/1"

# ---------------------------------------------------------------------------
# Closed enums (frozen tuples; membership is the only accepted test)
# ---------------------------------------------------------------------------

PRIVACY_LEVELS: tuple[str, ...] = ("public", "secret")

EVENT_TYPES: tuple[str, ...] = (
    "turn-started",
    "player-declared",
    "roll-resolved",
    "clue-discovered",
    "scene-moved",
    "npc-relationship-changed",
    "belief-asserted",
    "belief-reframed",
    "memory-written",
    "sanity-changed",
    "item-transferred",
    "turn-finalized",
)

# Merge discipline v1 ("merge similar, demote detail to payload fields"):
# legacy detail tokens fold into these types as payload discriminators, e.g.
# ``sanity_loss`` / ``sanity_rewarded`` -> sanity-changed.delta sign and
# ``mode``-style variants -> explicit payload fields below.
ROLL_RESULT_LEVELS: tuple[str, ...] = (
    "critical",
    "extreme",
    "hard",
    "regular",
    "failure",
    "fumble",
)

BELIEF_MODES: tuple[str, ...] = ("asserted", "repeated")

SCENE_MOVE_CAUSES: tuple[str, ...] = ("kp", "player", "storylet", "rule")

MEMORY_KINDS: tuple[str, ...] = (
    "episode",
    "assertion",
    "summary",
    "hook",
    "transfer",
    "backlog",
)

# ---------------------------------------------------------------------------
# Token grammars (lowercase only: model transcription safety)
# ---------------------------------------------------------------------------

# Kebab-style semantic identifiers: at least one "-" separating tokens;
# tokens allow [a-z0-9._:]. Shared with the temporal-memory contract so
# referenced ids (assertion ids, episode ids, roll receipts' semantic ids)
# interoperate unchanged across stores.
SEMANTIC_ID_RE = re.compile(r"^[a-z0-9][a-z0-9._:-]*(?:-[a-z0-9][a-z0-9._:-]*)+$")

# Bare tokens for entity/scene/actor slugs and the ``source`` attribute
# (emitting module semantic names use dots to expose module + writer).
TOKEN_RE = re.compile(r"^[a-z0-9][a-z0-9._-]*$")

_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9.-]*$")

_MAX_ID_LEN = 128
_MAX_REF_LEN = 128
_MAX_TEXT_CHARS = 400

SEQUENCE_MIN = 1
TURN_MIN = 1

# Recommended-but-unenforced prefixes for cross-store references inside
# payloads. Enforcement stays grammar-level so wired emitters can match the
# identifier shapes their own stores already mint.
RECOMMENDED_REFERENCE_PREFIXES = {
    "roll_id": "roll-",
    "clue_id": "clue-",
    "hypothesis_id": "hyp-",
    "finalization_id": "fin-",
    "memory_id": "mem-",
}

# ---------------------------------------------------------------------------
# Closed envelope field set (unknown keys are validation errors: frozen)
# ---------------------------------------------------------------------------

ENVELOPE_FIELDS: tuple[str, ...] = (
    "specversion",
    "type",
    "id",
    "source",
    "campaign",
    "timeline",
    "turn",
    "sequence",
    "game_time",
    "privacy",
    "decision_id",
    "data",
)

# ---------------------------------------------------------------------------
# Closed per-type payload schemas v1
# ---------------------------------------------------------------------------
#
# PAYLOAD_FIELDS     every key a payload may carry (besides mandatory "_v")
# PAYLOAD_REQUIRED   subset that must be present and non-null
# PAYLOAD_FIELD_KINDS
#                    per-field checker tag: how the value is interpreted.
#                    Kinds: semantic_id (grammar-checked reference), ref
#                    (bare token), text (free short string), enum:<NAME>
#                    (closed enum), int (exact integer), pos_int (>= 1),
#                    bool, id_list (list of semantic ids), scalar (JSON
#                    number-or-string ballast such as a dice rendering).

TURN_STARTED_FIELDS: tuple[str, ...] = ("note",)

PLAYER_DECLARED_FIELDS: tuple[str, ...] = (
    "declared_kind",
    "choice_ref",
    "note",
)

ROLL_RESOLVED_FIELDS: tuple[str, ...] = (
    "roll_id",
    "check",
    "actor",
    "result_level",
    "dice",
    "target_value",
    "cause",
    "effect_refs",
)

CLUE_DISCOVERED_FIELDS: tuple[str, ...] = (
    "clue_id",
    "discovered_by",
    "method",
    "scene_ref",
    "handout_ref",
    "note",
)

SCENE_MOVED_FIELDS: tuple[str, ...] = (
    "to_scene",
    "from_scene",
    "moved_by",
    "reason",
)

NPC_RELATIONSHIP_CHANGED_FIELDS: tuple[str, ...] = (
    "npc",
    "investigator",
    "channel",
    "before",
    "after",
    "reason",
    "source_roll_id",
)

BELIEF_ASSERTED_FIELDS: tuple[str, ...] = (
    "hypothesis_id",
    "holder",
    "mode",
    "statement",
    "evidence_refs",
)

BELIEF_REFRAMED_FIELDS: tuple[str, ...] = (
    "hypothesis_id",
    "change",
    "previous_hypothesis_id",
    "holder",
    "reason",
    "evidence_refs",
)

MEMORY_WRITTEN_FIELDS: tuple[str, ...] = (
    "memory_id",
    "memory_kind",
    "subject_refs",
    "note",
)

SANITY_CHANGED_FIELDS: tuple[str, ...] = (
    "investigator",
    "delta",
    "cause",
    "before",
    "after",
    "source_roll_id",
)

ITEM_TRANSFERRED_FIELDS: tuple[str, ...] = (
    "item",
    "from_holder",
    "to_holder",
    "qty",
    "reason",
    "source_roll_id",
)

TURN_FINALIZED_FIELDS: tuple[str, ...] = (
    "finalization_id",
    "settled_roll_ids",
    "note",
)

PAYLOAD_FIELDS: dict[str, tuple[str, ...]] = {
    "turn-started": TURN_STARTED_FIELDS,
    "player-declared": PLAYER_DECLARED_FIELDS,
    "roll-resolved": ROLL_RESOLVED_FIELDS,
    "clue-discovered": CLUE_DISCOVERED_FIELDS,
    "scene-moved": SCENE_MOVED_FIELDS,
    "npc-relationship-changed": NPC_RELATIONSHIP_CHANGED_FIELDS,
    "belief-asserted": BELIEF_ASSERTED_FIELDS,
    "belief-reframed": BELIEF_REFRAMED_FIELDS,
    "memory-written": MEMORY_WRITTEN_FIELDS,
    "sanity-changed": SANITY_CHANGED_FIELDS,
    "item-transferred": ITEM_TRANSFERRED_FIELDS,
    "turn-finalized": TURN_FINALIZED_FIELDS,
}

PAYLOAD_REQUIRED: dict[str, tuple[str, ...]] = {
    "turn-started": (),
    "player-declared": ("declared_kind",),
    "roll-resolved": ("roll_id", "check", "actor", "result_level"),
    "clue-discovered": ("clue_id", "discovered_by"),
    "scene-moved": ("to_scene",),
    "npc-relationship-changed": ("npc", "investigator", "channel", "after"),
    "belief-asserted": ("hypothesis_id", "holder"),
    "belief-reframed": ("hypothesis_id", "change"),
    "memory-written": ("memory_id", "memory_kind"),
    "sanity-changed": ("investigator", "delta", "cause"),
    "item-transferred": ("item", "from_holder", "to_holder"),
    "turn-finalized": ("finalization_id",),
}

PAYLOAD_FIELD_KINDS: dict[str, dict[str, str]] = {
    "turn-started": {"note": "text"},
    "player-declared": {
        "declared_kind": "ref",
        "choice_ref": "ref",
        "note": "text",
    },
    "roll-resolved": {
        "roll_id": "semantic_id",
        "check": "text",
        "actor": "ref",
        "result_level": "enum:ROLL_RESULT_LEVELS",
        "dice": "scalar",
        "target_value": "int",
        "cause": "text",
        "effect_refs": "id_list",
    },
    "clue-discovered": {
        "clue_id": "semantic_id",
        "discovered_by": "ref",
        "method": "ref",
        "scene_ref": "ref",
        "handout_ref": "ref",
        "note": "text",
    },
    "scene-moved": {
        "to_scene": "ref",
        "from_scene": "ref",
        "moved_by": "enum:SCENE_MOVE_CAUSES",
        "reason": "text",
    },
    "npc-relationship-changed": {
        "npc": "ref",
        "investigator": "ref",
        "channel": "ref",
        "before": "scalar",
        "after": "scalar",
        "reason": "text",
        "source_roll_id": "semantic_id",
    },
    "belief-asserted": {
        "hypothesis_id": "semantic_id",
        "holder": "ref",
        "mode": "enum:BELIEF_MODES",
        "statement": "text",
        "evidence_refs": "id_list",
    },
    "belief-reframed": {
        "hypothesis_id": "semantic_id",
        "change": "text",
        "previous_hypothesis_id": "semantic_id",
        "holder": "ref",
        "reason": "text",
        "evidence_refs": "id_list",
    },
    "memory-written": {
        "memory_id": "semantic_id",
        "memory_kind": "enum:MEMORY_KINDS",
        "subject_refs": "id_list",
        "note": "text",
    },
    "sanity-changed": {
        "investigator": "ref",
        "delta": "int",
        "cause": "text",
        "before": "int",
        "after": "int",
        "source_roll_id": "semantic_id",
    },
    "item-transferred": {
        "item": "ref",
        "from_holder": "ref",
        "to_holder": "ref",
        "qty": "pos_int",
        "reason": "text",
        "source_roll_id": "semantic_id",
    },
    "turn-finalized": {
        "finalization_id": "semantic_id",
        "settled_roll_ids": "id_list",
        "note": "text",
    },
}


# ---------------------------------------------------------------------------
# Error hierarchy
# ---------------------------------------------------------------------------


class CanonicalEventsContractError(ValueError):
    """Base error for canonical-event contract violations."""

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


class UnknownFieldError(CanonicalEventsContractError):
    pass


class MissingFieldError(CanonicalEventsContractError):
    pass


class ClosedEnumError(CanonicalEventsContractError):
    pass


class SemanticIdError(CanonicalEventsContractError):
    pass


class PrivacyError(CanonicalEventsContractError):
    pass


class SequenceError(CanonicalEventsContractError):
    """Allocation or ordering violations for the ``sequence`` attribute."""


class DuplicateDecisionIdError(CanonicalEventsContractError):
    """Same ``decision_id``, different semantic content (fail closed)."""


class PayloadVersionError(CanonicalEventsContractError):
    """Payload ``_v`` missing, mistyped, or unknown to this generation."""


# ---------------------------------------------------------------------------
# Determinism helpers
# ---------------------------------------------------------------------------


def canonical_json(record: Mapping[str, Any]) -> str:
    """Stable serialization: sorted keys, compact separators."""
    return json.dumps(record, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def record_digest(record: Mapping[str, Any]) -> str:
    """SHA-256 over :func:`canonical_json`. Machine-internal integrity
    evidence only — never a model-facing identifier."""
    return hashlib.sha256(canonical_json(record).encode("utf-8")).hexdigest()


def _is_exact_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _require_mapping(record: Any, kind: str) -> Mapping[str, Any]:
    if not isinstance(record, Mapping):
        raise CanonicalEventsContractError(
            f"{kind} must be a mapping, got {type(record).__name__}",
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


def _check_enum(
    value: Any, allowed: tuple[str, ...], *, kind: str, field: str
) -> str:
    if value not in allowed:
        raise ClosedEnumError(
            f"{kind}.{field}={value!r} not in closed enum {list(allowed)}",
            record_kind=kind,
            field=field,
            value=value,
        )
    return value


def _check_semantic_id(value: Any, *, kind: str, field: str) -> str:
    if not isinstance(value, str):
        raise SemanticIdError(
            f"{kind}.{field}={value!r} must be a semantic id string",
            record_kind=kind,
            field=field,
            value=value,
        )
    pattern_ok = bool(SEMANTIC_ID_RE.match(value))
    if len(value) > _MAX_ID_LEN or not pattern_ok:
        raise SemanticIdError(
            f"{kind}.{field}={value!r} violates semantic id grammar "
            f"{SEMANTIC_ID_RE.pattern}",
            record_kind=kind,
            field=field,
            value=value,
        )
    return value


def _check_token(value: Any, *, kind: str, field: str) -> str:
    if not isinstance(value, str) or len(value) > _MAX_REF_LEN:
        raise CanonicalEventsContractError(
            f"{kind}.{field}={value!r} must be a token string "
            f"(<= {_MAX_REF_LEN} chars)",
            record_kind=kind,
            field=field,
            value=value,
        )
    if not TOKEN_RE.match(value):
        raise CanonicalEventsContractError(
            f"{kind}.{field}={value!r} violates token grammar {TOKEN_RE.pattern}",
            record_kind=kind,
            field=field,
            value=value,
        )
    return value


def _check_text(value: Any, *, kind: str, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise CanonicalEventsContractError(
            f"{kind}.{field} must be a non-empty string",
            record_kind=kind,
            field=field,
            value=value,
        )
    if len(value) > _MAX_TEXT_CHARS:
        raise CanonicalEventsContractError(
            f"{kind}.{field} exceeds {_MAX_TEXT_CHARS} chars",
            record_kind=kind,
            field=field,
            value=value,
        )
    return value


def _check_scalar(value: Any, *, kind: str, field: str) -> Any:
    if not (
        isinstance(value, str)
        or (_is_exact_int(value))
        or (isinstance(value, float))
    ):
        raise CanonicalEventsContractError(
            f"{kind}.{field}={value!r} must be a string or number",
            record_kind=kind,
            field=field,
            value=value,
        )
    return value


def _check_int_field(value: Any, *, kind: str, field: str) -> int:
    if not _is_exact_int(value):
        raise CanonicalEventsContractError(
            f"{kind}.{field}={value!r} must be an exact integer "
            "(no bool/float coercion)",
            record_kind=kind,
            field=field,
            value=value,
        )
    return value


def _check_pos_int(value: Any, *, kind: str, field: str) -> int:
    checked = _check_int_field(value, kind=kind, field=field)
    if checked < 1:
        raise CanonicalEventsContractError(
            f"{kind}.{field}={checked!r} must be >= 1",
            record_kind=kind,
            field=field,
            value=value,
        )
    return checked


def _check_bool(value: Any, *, kind: str, field: str) -> bool:
    if not isinstance(value, bool):
        raise CanonicalEventsContractError(
            f"{kind}.{field}={value!r} must be a boolean",
            record_kind=kind,
            field=field,
            value=value,
        )
    return value


def _check_id_list(
    value: Any, *, kind: str, field: str, allow_empty: bool = True
) -> list[str]:
    if value is None:
        value = []
    if not isinstance(value, (list, tuple)):
        raise CanonicalEventsContractError(
            f"{kind}.{field} must be a list of semantic ids",
            record_kind=kind,
            field=field,
            value=value,
        )
    seen: set[str] = set()
    for item in value:
        _check_semantic_id(item, kind=kind, field=field)
        if item in seen:
            raise CanonicalEventsContractError(
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


_ENUM_REGISTRIES: dict[str, tuple[str, ...]] = {
    "ROLL_RESULT_LEVELS": ROLL_RESULT_LEVELS,
    "BELIEF_MODES": BELIEF_MODES,
    "SCENE_MOVE_CAUSES": SCENE_MOVE_CAUSES,
    "MEMORY_KINDS": MEMORY_KINDS,
}


def _check_payload_value(
    kind_tag: str, value: Any, *, event_type: str, field: str
) -> None:
    kind_name = f"{event_type} payload"
    if kind_tag.startswith("enum:"):
        registry = _ENUM_REGISTRIES[kind_tag.split(":", 1)[1]]
        _check_enum(value, registry, kind=kind_name, field=field)
        return
    handler = {
        "semantic_id": lambda: _check_semantic_id(value, kind=kind_name, field=field),
        "ref": lambda: _check_token(value, kind=kind_name, field=field),
        "text": lambda: _check_text(value, kind=kind_name, field=field),
        "scalar": lambda: _check_scalar(value, kind=kind_name, field=field),
        "int": lambda: _check_int_field(value, kind=kind_name, field=field),
        "pos_int": lambda: _check_pos_int(value, kind=kind_name, field=field),
        "bool": lambda: _check_bool(value, kind=kind_name, field=field),
        "id_list": lambda: _check_id_list(value, kind=kind_name, field=field),
    }[kind_tag]
    handler()


# ---------------------------------------------------------------------------
# Deterministic ID constructors (code builds IDs; models never invent them)
# ---------------------------------------------------------------------------

PAYLOAD_SCHEMA_VERSION = CONTRACT_SCHEMA_VERSION

_EVENT_ORDINAL_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")


def ordinal_slug(index: int) -> str:
    """Two-digit zero-padded occurrence slug for Nth same-turn occurrence.

    Example: ``ordinal_slug(7) == "occ-07"``. Keeps multiple events of the
    same type within one turn lexicographically ordered and transcribable.
    """
    if not _is_exact_int(index) or index < 1:
        raise CanonicalEventsContractError(
            f"ordinal index must be an int >= 1, got {index!r}", value=index
        )
    return f"occ-{index:02d}"


def event_id_for(
    event_type: str, campaign: str, timeline: str, turn: int, slug: str
) -> str:
    """Deterministic event id:
    ``<type>-<campaign>-<timeline>-t<turn>-<slug>``.

    Campaign/timeline slugs contain "-" themselves by design; matching is
    always whole-string (construction + exact equality), never dash-splitting.
    """
    _check_enum(event_type, EVENT_TYPES, kind="event", field="type")
    for label, part in (("campaign", campaign), ("timeline", timeline)):
        if not isinstance(part, str) or not part or len(part) > _MAX_REF_LEN:
            raise SemanticIdError(f"event id needs valid {label}, got {part!r}")
    _check_pos_int(turn, kind="event", field="turn")
    if not isinstance(slug, str) or not _EVENT_ORDINAL_SLUG_RE.match(slug):
        raise SemanticIdError(
            f"event id slug {slug!r} violates grammar {_EVENT_ORDINAL_SLUG_RE.pattern}"
        )
    event_id = f"{event_type}-{campaign}-{timeline}-t{turn}-{slug}"
    _check_semantic_id(event_id, kind="event", field="id")
    return event_id


# ---------------------------------------------------------------------------
# Sequence allocation seam (storage-agnostic; JSONL append lands in task t2)
# ---------------------------------------------------------------------------


class SequenceAllocator:
    """Interface: monotonic per-(campaign, timeline) sequence allocation.

    Contract for implementers (task t2 provides the file-backed one):

    - ``next_sequence(campaign, timeline)`` returns SEQUENCE_MIN on first
      call for a fresh (campaign, timeline) pair and advances by exactly 1
      on each subsequent call; sequences are comparable *only within* one
      (campaign, timeline) pair.
    - The backing cursor must be persisted together with the appended line
      (same transaction) so a crash never reissues a used sequence.
    """

    def next_sequence(self, campaign: str, timeline: str) -> int:  # pragma: no cover
        raise NotImplementedError("sequence allocators must implement next_sequence")


class MemorySequenceAllocator(SequenceAllocator):
    """In-process allocator for tests and single-session tooling."""

    def __init__(self) -> None:
        self._counters: dict[tuple[str, str], int] = {}

    def next_sequence(self, campaign: str, timeline: str) -> int:
        key = (campaign, timeline)
        nxt = self._counters.get(key, SEQUENCE_MIN - 1) + 1
        self._counters[key] = nxt
        return nxt


# ---------------------------------------------------------------------------
# Emit API (pure build + validate; persistence seam is task t2)
# ---------------------------------------------------------------------------


def build_event(
    *,
    event_type: str,
    campaign: str,
    timeline: str,
    turn: int,
    slug: str,
    source: str,
    game_time: str,
    privacy: str,
    decision_id: str,
    data: Mapping[str, Any],
    sequence: int | None = None,
    allocator: SequenceAllocator | None = None,
) -> dict[str, Any]:
    """Construct, sequence, and validate one canonical event envelope.

    Either pass an explicit ``sequence`` or an ``allocator``; passing neither
    raises :class:`SequenceError`. Emitters call this *only after* the
    transactional/rules settlement succeeded (post-commit discipline).
    """
    if sequence is None:
        if allocator is None:
            raise SequenceError(
                "build_event needs an explicit sequence or a SequenceAllocator"
            )
        sequence = allocator.next_sequence(campaign, timeline)
    record: dict[str, Any] = {
        "specversion": SPECVERSION,
        "type": event_type,
        "id": event_id_for(event_type, campaign, timeline, turn, slug),
        "source": source,
        "campaign": campaign,
        "timeline": timeline,
        "turn": turn,
        "sequence": sequence,
        "game_time": game_time,
        "privacy": privacy,
        "decision_id": decision_id,
        "data": dict(data),
    }
    validate_event(record)
    return record


def resolve_duplicate(existing: Mapping[str, Any], incoming: Mapping[str, Any]) -> Mapping[str, Any]:
    """Idempotency rule keyed by ``decision_id``.

    Both records must already validate. If they agree on every attribute
    except the allocator-stamped ``sequence``, the emission is a repeat:
    return ``existing`` untouched. If they differ anywhere else, the same
    decision id was reused for a materially different fact and the call
    fails closed.
    """
    left, right = dict(existing), dict(incoming)
    left.pop("sequence")
    right.pop("sequence")
    if canonical_json(left) == canonical_json(right):
        return existing
    raise DuplicateDecisionIdError(
        f"decision_id={existing.get('decision_id')!r} reused with different "
        "content; idempotency requires identical semantic payload"
    )


# ---------------------------------------------------------------------------
# Validators
# ---------------------------------------------------------------------------


def validate_envelope(record: Any) -> None:
    rec = _require_mapping(record, "envelope")
    _check_fields(rec, "envelope", ENVELOPE_FIELDS, required=ENVELOPE_FIELDS)

    if rec["specversion"] != SPECVERSION:
        raise CanonicalEventsContractError(
            f"envelope.specversion={rec['specversion']!r} must be "
            f"{SPECVERSION!r} (generation {SCHEMA_GENERATION})",
            record_kind="envelope",
            field="specversion",
            value=rec["specversion"],
        )

    event_type = _check_enum(rec["type"], EVENT_TYPES, kind="envelope", field="type")

    _check_semantic_id(rec["id"], kind="envelope", field="id")
    expected_prefix = f"{event_type}-"
    if not str(rec["id"]).startswith(expected_prefix):
        raise SemanticIdError(
            f"envelope.id={rec['id']!r} must start with {expected_prefix!r} "
            "for its type (deterministic event_id_for construction)",
            record_kind="envelope",
            field="id",
            value=rec["id"],
        )

    _check_token(rec["source"], kind="envelope", field="source")
    _check_token(rec["campaign"], kind="envelope", field="campaign")
    _check_token(rec["timeline"], kind="envelope", field="timeline")

    turn = _check_int_field(rec["turn"], kind="envelope", field="turn")
    if turn < TURN_MIN:
        raise CanonicalEventsContractError(
            f"envelope.turn={turn!r} must be >= {TURN_MIN} "
            "(opening bookkeeping belongs to the first turn's events)",
            record_kind="envelope",
            field="turn",
            value=turn,
        )

    seq = _check_int_field(rec["sequence"], kind="envelope", field="sequence")
    if seq < SEQUENCE_MIN:
        raise SequenceError(
            f"envelope.sequence={seq!r} must be >= {SEQUENCE_MIN}",
            record_kind="envelope",
            field="sequence",
            value=seq,
        )

    _check_text(rec["game_time"], kind="envelope", field="game_time")

    # Closed two-level visibility: public rows may reach player-facing
    # projections verbatim; secret rows stay Keeper-side. A future third
    # level is an additive schema change of its own task.
    if rec["privacy"] not in PRIVACY_LEVELS:
        raise PrivacyError(
            f"envelope.privacy={rec['privacy']!r} not in closed enum "
            f"{list(PRIVACY_LEVELS)}",
            record_kind="envelope",
            field="privacy",
            value=rec["privacy"],
        )

    _check_semantic_id(rec["decision_id"], kind="envelope", field="decision_id")

    validate_payload(event_type, rec["data"])


def validate_payload(event_type: str, payload: Any) -> None:
    kind_name = f"{event_type} payload"
    if event_type not in EVENT_TYPES:
        raise ClosedEnumError(
            f"payload bound to unknown event type {event_type!r}",
            record_kind=kind_name,
            value=event_type,
        )
    body = _require_mapping(payload, kind_name)
    _check_fields(body, kind_name, ("_v",) + PAYLOAD_FIELDS[event_type], ("_v",))

    version = body["_v"]
    if not _is_exact_int(version):
        raise PayloadVersionError(
            f"{kind_name}._v={version!r} must be an integer",
            record_kind=kind_name,
            field="_v",
            value=version,
        )
    known_versions = {PAYLOAD_SCHEMA_VERSION}
    if version not in known_versions:
        raise PayloadVersionError(
            f"{kind_name}._v={version!r} unknown to generation "
            f"{SCHEMA_GENERATION}; tolerant readers upcast read-side only",
            record_kind=kind_name,
            field="_v",
            value=version,
        )

    missing = [name for name in PAYLOAD_REQUIRED[event_type] if body.get(name) is None]
    if missing:
        raise MissingFieldError(
            f"{kind_name} is missing required fields {missing}",
            record_kind=kind_name,
            field=missing[0],
        )

    kinds = PAYLOAD_FIELD_KINDS[event_type]
    for field, kind_tag in kinds.items():
        if field not in body:
            continue
        value = body[field]
        if value is None:
            raise MissingFieldError(
                f"{kind_name}.{field} present but null; omit the field "
                "instead (closed-set semantics)",
                record_kind=kind_name,
                field=field,
            )
        _check_payload_value(kind_tag, value, event_type=event_type, field=field)


def validate_event(record: Any) -> None:
    """Validate one full canonical event (envelope + typed payload)."""
    validate_envelope(record)


# ---------------------------------------------------------------------------
# Read-side conveniences (tolerant-reader surface for projections)
# ---------------------------------------------------------------------------


def iter_events(lines: Iterable[str]) -> Iterator[dict[str, Any]]:
    """Parse JSONL lines lazily, skipping blank lines. Malformed JSON and
    schema errors raise immediately; projections desiring skip-and-diagnose
    behavior wrap this generator themselves."""
    for line in lines:
        stripped = line.strip()
        if stripped:
            yield json.loads(stripped)


def project_player_view(events: Iterable[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Drop ``privacy="secret"`` events for player-facing surfaces. This is
    projection policy, not authority: canonical privacy lives on envelopes."""
    return [
        dict(event)
        for event in events
        if event.get("privacy") == "public"
    ]


# ---------------------------------------------------------------------------
# Emission layer (task t2): durable sequence allocation, JSONL append,
# decision-id idempotency, and the choke-point "uncovered writes" ledger.
# ---------------------------------------------------------------------------

# Fixed file names inside ``.coc/campaigns/<id>/logs/``.
CANONICAL_STREAM_NAME = "canonical-events.jsonl"
UNCOVERED_LEDGER_NAME = "canonical-events-uncovered.jsonl"
SEQUENCE_CURSOR_NAME = "canonical-events-sequence.json"

# The choke-point sidecar must never observe (and thereby ledger) the
# canonical stream itself or its own ledger rows. Cursor persistence is not
# an append at all; listed here for one shared exemption face.
_EXEMPT_STREAM_NAMES = frozenset(
    {CANONICAL_STREAM_NAME, UNCOVERED_LEDGER_NAME}
)

# Semantic record keys: only *explicit structured identity fields* of the
# appended record are surfaced to the ledger. This is schema knowledge
# (field names), never content inference: the fallback NEVER assigns or
# guesses an event type — that stays the exclusive right of emission-point
# code per the semantic matcher constitution.
_KNOWN_RECORD_KEY_FIELDS: tuple[str, ...] = (
    "event_id",
    "id",
    "roll_id",
    "finalization_id",
    "memory_id",
    "episode_id",
    "assertion_id",
    "delivery_id",
    "transition_id",
    "repair_id",
    "backlog_id",
)
_MAX_RECORD_KEY_CHARS = 96

# Bound on buffered un-settled sightings per campaign so a long-lived
# process without turn-finalized emits cannot grow RAM forever. Overflow
# evicts the OLDEST sighting straight to the ledger (preserving evidence,
# trading a possible false-uncovered row for bounded memory).
MAX_BUFFERED_SIGHTINGS = 4096

_UNCOVERED_LEDGER_SCHEMA_VERSION = 1
_CURSOR_SCHEMA_VERSION = 1


def canonical_stream_path(campaign_logs_dir: Path) -> Path:
    return Path(campaign_logs_dir) / CANONICAL_STREAM_NAME


def uncovered_ledger_path(campaign_logs_dir: Path) -> Path:
    return Path(campaign_logs_dir) / UNCOVERED_LEDGER_NAME


def sequence_cursor_path(campaign_logs_dir: Path) -> Path:
    return Path(campaign_logs_dir) / SEQUENCE_CURSOR_NAME


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _atomic_write_json(path: Path, payload: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.tmp")
    with tmp.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, sort_keys=True)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(tmp, path)


class FileSequenceAllocator(SequenceAllocator):
    """Durable allocator backing the canonical stream's cursors.

    Counters live in ``logs/canonical-events-sequence.json``, keyed by
    timeline. On first use the allocator scans the canonical JSONL and
    seeds each cursor from ``max(stored_cursor, max_written_sequence)``:
    a crash between cursor save and line append can waste a sequence
    (harmless gap) but can never reissue one, because written lines are
    the take-max floor. Cursors persist atomically at allocation time;
    single-writer (one live Keeper process per campaign) by convention,
    matching every other ``logs/`` writer in this repository.
    """

    def __init__(self, campaign_logs_dir: Path | str) -> None:
        self._dir = Path(campaign_logs_dir)
        self._counters: dict[str, int] = {}
        self._initialized = False

    def _initialize(self) -> None:
        if self._initialized:
            return
        stored: dict[str, int] = {}
        cursor_file = sequence_cursor_path(self._dir)
        if cursor_file.is_file():
            raw = json.loads(cursor_file.read_text(encoding="utf-8"))
            for timeline, value in (raw.get("counters") or {}).items():
                if isinstance(value, int) and not isinstance(value, bool):
                    stored[timeline] = value
        scanned = max_sequences_in_stream(canonical_stream_path(self._dir))
        self._counters = {
            timeline: max(stored.get(timeline, 0), scanned.get(timeline, 0))
            for timeline in set(stored) | set(scanned)
        }
        self._initialized = True

    def next_sequence(self, campaign: str, timeline: str) -> int:
        self._initialize()
        nxt = self._counters.get(timeline, SEQUENCE_MIN - 1) + 1
        self._counters[timeline] = nxt
        _atomic_write_json(
            sequence_cursor_path(self._dir),
            {
                "_v": _CURSOR_SCHEMA_VERSION,
                "generation": SCHEMA_GENERATION,
                "counters": dict(sorted(self._counters.items())),
            },
        )
        return nxt


def max_sequences_in_stream(stream: Path) -> dict[str, int]:
    """Highest persisted ``sequence`` per ``timeline`` in a canonical stream."""
    result: dict[str, int] = {}
    if not stream.is_file():
        return result
    with stream.open("r", encoding="utf-8") as handle:
        for line in handle:
            stripped = line.strip()
            if not stripped:
                continue
            try:
                record = json.loads(stripped)
            except json.JSONDecodeError as exc:
                raise SequenceError(
                    f"canonical stream has malformed JSON: {stream}"
                ) from exc
            if not isinstance(record, dict):
                continue
            seq = record.get("sequence")
            timeline = record.get("timeline")
            if (
                isinstance(seq, int)
                and not isinstance(seq, bool)
                and isinstance(timeline, str)
            ):
                if seq > result.get(timeline, 0):
                    result[timeline] = seq
    return result


# ---------------------------------------------------------------------------
# Process-local emission runtime (coverage index + uncovered-write buffer)
# ---------------------------------------------------------------------------

# decision_id -> stored event, per campaign logs dir. Idempotency lookups
# come from this scan-once index instead of re-reading the JSONL per emit.
_WRITE_INDEX: dict[str, dict[str, dict[str, Any]]] = {}
_ALLOCATORS: dict[str, FileSequenceAllocator] = {}
_EMITTED_EVENT_IDS: dict[str, set[str]] = {}

# Choke-point state: appends seen but not yet settled for their turn.
# Sightings are semantic references only (stream ref / turn / explicit
# record key / decision id); never record bodies, never digests.
_PENDING_SIGHTINGS: dict[str, list[dict[str, Any]]] = {}
_PENDING_SIGS: dict[str, set[tuple[Any, ...]]] = {}
_LEDGER_WRITTEN_SIGS: dict[str, set[tuple[Any, ...]]] = {}
_EMITTED_DECISIONS: dict[str, set[str]] = {}


def reset_emission_runtime_state() -> None:
    """Drop all process-local emission caches.

    Files on disk are authoritative and are never touched. Long-lived tools
    may call this when switching campaigns; tests call it for isolation.
    """
    _WRITE_INDEX.clear()
    _ALLOCATORS.clear()
    _EMITTED_EVENT_IDS.clear()
    _PENDING_SIGHTINGS.clear()
    _PENDING_SIGS.clear()
    _LEDGER_WRITTEN_SIGS.clear()
    _EMITTED_DECISIONS.clear()


def _logs_key(logs_dir: Path | str) -> str:
    return str(Path(logs_dir).resolve())


def _get_write_index(campaign_logs_dir: Path) -> dict[str, dict[str, Any]]:
    key = _logs_key(campaign_logs_dir)
    index = _WRITE_INDEX.get(key)
    if index is None:
        index = {"decisions": {}, "max_seq": {}, "event_ids": set()}
        stream = canonical_stream_path(campaign_logs_dir)
        if stream.is_file():
            index["max_seq"] = max_sequences_in_stream(stream)
            with stream.open("r", encoding="utf-8") as handle:
                for line in handle:
                    stripped = line.strip()
                    if not stripped:
                        continue
                    record = json.loads(stripped)
                    if not isinstance(record, dict):
                        continue
                    decision_id = record.get("decision_id")
                    if isinstance(decision_id, str) and decision_id:
                        first = index["decisions"].setdefault(decision_id, record)
                        if first != record:
                            raise DuplicateDecisionIdError(
                                "canonical stream holds conflicting content for "
                                f"decision_id={decision_id!r}: {stream}"
                            )
                    event_id = record.get("id")
                    if isinstance(event_id, str) and event_id:
                        index["event_ids"].add(event_id)
        _WRITE_INDEX[key] = index
    return index


def _remember_emitted(campaign_logs_dir: Path, event: Mapping[str, Any]) -> None:
    key = _logs_key(campaign_logs_dir)
    _EMITTED_EVENT_IDS.setdefault(key, set()).add(str(event["id"]))
    _EMITTED_DECISIONS.setdefault(key, set()).add(str(event["decision_id"]))
    timeline = str(event["timeline"])
    seq = event["sequence"]
    index = _get_write_index(campaign_logs_dir)
    if seq > index["max_seq"].get(timeline, 0):
        index["max_seq"][timeline] = seq
    index["decisions"][str(event["decision_id"])] = dict(event)


def _append_small_jsonl(path: Path, row: Mapping[str, Any]) -> None:
    """Ledger-grade append used ONLY by the sidecar itself so the fallback
    never re-enters the machinery it instruments."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(row, ensure_ascii=False))
        handle.write("\n")


# ---------------------------------------------------------------------------
# Choke-point fallback (uncovered writes). Called from coc_state.append_jsonl
# and JsonlRecorder.append_jsonl. Never guesses event types; hot-path cost is
# a resolve plus a few dict operations.
# ---------------------------------------------------------------------------


def classify_campaign_log_append(path: Path | str) -> tuple[str, str] | None:
    """Return ``(campaign_id, "logs/<name>.jsonl")`` for a campaign log
    stream, or ``None`` for any path outside ``campaigns/<id>/logs/*.jsonl``
    or on the canonical/ledger exemption face."""
    if not str(path).endswith(".jsonl"):
        return None
    parts = Path(path).resolve().parts
    if len(parts) < 4 or parts[-2] != "logs" or parts[-4] != "campaigns":
        return None
    name = parts[-1]
    if name in _EXEMPT_STREAM_NAMES:
        return None
    return parts[-3], f"logs/{name}"


def _record_turn(record: Mapping[str, Any]) -> int | None:
    for field in ("turn_number", "turn"):
        value = record.get(field)
        if isinstance(value, int) and not isinstance(value, bool):
            return value
    return None


def _semantic_record_key(record: Mapping[str, Any]) -> str | None:
    for field in _KNOWN_RECORD_KEY_FIELDS:
        value = record.get(field)
        if isinstance(value, str) and 0 < len(value) <= 128:
            return value[:_MAX_RECORD_KEY_CHARS]
        if isinstance(value, int) and not isinstance(value, bool):
            return str(value)[:_MAX_RECORD_KEY_CHARS]
    return None


def note_choked_append(path: Path | str, record: Any) -> None:
    """Buffer one choked append as an uncovered-write candidate.

    Sidecar-only: swallows every internal failure so a ledger problem can
    never break the primary gameplay write.
    """
    try:
        if not isinstance(record, Mapping):
            return
        classified = classify_campaign_log_append(path)
        if classified is None:
            return
        campaign_id, stream_ref = classified
        decision_value = record.get("decision_id")
        sighting = {
            "campaign": campaign_id,
            "stream": stream_ref,
            "turn": _record_turn(record),
            "key": _semantic_record_key(record),
            "decision_id": (
                decision_value
                if isinstance(decision_value, str) and len(decision_value) <= 128
                else None
            ),
            "ts": _now_iso(),
        }
        dir_key = str(Path(path).resolve().parent)
        sig = (stream_ref, sighting["turn"], sighting["key"])
        seen = _PENDING_SIGS.setdefault(dir_key, set())
        if sig in seen:
            return
        buffer_list = _PENDING_SIGHTINGS.setdefault(dir_key, [])
        seen.add(sig)
        buffer_list.append(sighting)
        while len(buffer_list) > MAX_BUFFERED_SIGHTINGS:
            evicted = buffer_list.pop(0)
            seen.discard((evicted["stream"], evicted["turn"], evicted["key"]))
            _ledger_uncovered(dir_key, [evicted])
    except Exception:
        # The uncovered-write sidecar is best-effort evidence; it must never
        # take down a settlement write.
        return


def _ledger_uncovered(dir_key: str, rows: list[dict[str, Any]]) -> int:
    if not rows:
        return 0
    written_sig_set = _LEDGER_WRITTEN_SIGS.setdefault(dir_key, set())
    count = 0
    for row in rows:
        sig = (row["stream"], row["turn"], row["key"])
        if sig in written_sig_set:
            continue
        _append_small_jsonl(
            Path(dir_key) / UNCOVERED_LEDGER_NAME,
            {
                "_v": _UNCOVERED_LEDGER_SCHEMA_VERSION,
                "generation": SCHEMA_GENERATION,
                "ts": row["ts"],
                "campaign": row["campaign"],
                "stream": row["stream"],
                "turn": row["turn"],
                "record_key": row["key"],
                "decision_id": row["decision_id"],
            },
        )
        written_sig_set.add(sig)
        count += 1
    return count


def settle_uncovered_writes(
    campaign_logs_dir: Path | str, *, turn: int | None = None
) -> int:
    """Move buffered sightings of one turn (or all turns when ``turn`` is
    ``None``) into the uncovered-write ledger unless a canonical emit with
    the same semantic ``decision_id`` covers them.

    The match rule is code-assigned identity equality — shared
    ``decision_id`` — never record-content inference.

    Returns the number of ledger rows written by this call.
    """
    dir_key = _logs_key(campaign_logs_dir)
    buffer_list = _PENDING_SIGHTINGS.get(dir_key, [])
    covered = _EMITTED_DECISIONS.get(dir_key, frozenset())
    keep: list[dict[str, Any]] = []
    uncovered: list[dict[str, Any]] = []
    for sighting in buffer_list:
        in_scope = turn is None or sighting["turn"] == turn
        if not in_scope:
            keep.append(sighting)
            continue
        decision_id = sighting["decision_id"]
        if decision_id is not None and decision_id in covered:
            continue
        uncovered.append(sighting)
    _PENDING_SIGHTINGS[dir_key] = keep
    seen = _PENDING_SIGS.setdefault(dir_key, set())
    for row in uncovered:
        seen.discard((row["stream"], row["turn"], row["key"]))
    return _ledger_uncovered(dir_key, uncovered)


# ---------------------------------------------------------------------------
# Rebuildable SQLite projection (generation coc-events-1)
#
# ``.coc/campaigns/<id>/memory/events-projection.db`` is a deletable,
# rebuildable cache over ``logs/canonical-events.jsonl``. The JSONL stream
# stays the sole canonical record; this cache never feeds back into state,
# rules, or emission. Clean-slate law applies with full force: a corrupt,
# unreadable, wrong-generation, or stale-source database is deleted and
# rebuilt from the stream — never migrated, never dual-read.
#
# Determinism: rows are pure functions of validated records, so a full
# rebuild and a suffix-incremental apply insert byte-identical logical
# content (verified by :func:`events_projection_digest`). No wall-clock
# fields are recorded anywhere.
# ---------------------------------------------------------------------------

MEMORY_DIR_NAME = "memory"
EVENTS_PROJECTION_DB_NAME = "events-projection.db"
EVENTS_PROJECTION_USER_VERSION = 1

_EVENTS_PROJECTION_TABLES: tuple[str, ...] = (
    "projection_meta",
    "events",
    "event_entities",
)

_EVENTS_PROJECTION_INDEXES: tuple[str, ...] = (
    "idx_events_turn",
    "idx_events_type",
    "idx_events_privacy",
    "idx_events_event_id",
    "idx_event_entities_ref",
    "idx_event_entities_role",
)

_EVENTS_PROJECTION_DDL: tuple[str, ...] = (
    """
    CREATE TABLE projection_meta (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        schema_generation TEXT NOT NULL,
        source_name TEXT NOT NULL,
        source_prefix_sha256 TEXT NOT NULL,
        source_bytes_applied INTEGER NOT NULL,
        source_lines_applied INTEGER NOT NULL,
        event_count INTEGER NOT NULL
    )
    """,
    """
    CREATE TABLE events (
        campaign TEXT NOT NULL,
        timeline TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        turn INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        privacy TEXT NOT NULL,
        event_id TEXT NOT NULL,
        decision_id TEXT NOT NULL,
        source TEXT NOT NULL,
        game_time TEXT NOT NULL,
        envelope_sha256 TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        PRIMARY KEY (campaign, timeline, sequence)
    )
    """,
    """
    CREATE TABLE event_entities (
        campaign TEXT NOT NULL,
        timeline TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        role TEXT NOT NULL,
        entity_ref TEXT NOT NULL,
        PRIMARY KEY (campaign, timeline, sequence, role, entity_ref),
        FOREIGN KEY (campaign, timeline, sequence)
            REFERENCES events (campaign, timeline, sequence)
            ON DELETE CASCADE
    )
    """,
    # Selector coverage required by the contract: campaign/timeline via the
    # primary key prefix, plus turn / type / privacy / identity lookups.
    "CREATE INDEX idx_events_turn ON events (turn)",
    "CREATE INDEX idx_events_type ON events (event_type)",
    "CREATE INDEX idx_events_privacy ON events (privacy)",
    "CREATE UNIQUE INDEX idx_events_event_id ON events (event_id)",
    "CREATE INDEX idx_event_entities_ref ON event_entities (entity_ref)",
    "CREATE INDEX idx_event_entities_role ON event_entities (role)",
)

# Payload fields whose frozen kind marks them structured entity references:
# extraction is schema-driven (declared kind -> row), never content
# inference. Envelope attributes stay on the events row itself.
_ENTITY_REF_FIELD_KINDS = frozenset({"ref", "semantic_id", "id_list"})


class EventsProjectionError(CanonicalEventsContractError):
    """A projection build, apply, or integrity failure.

    The canonical JSONL stream and every other campaign artifact remain
    untouched; callers are expected to heal a projection cache through a
    fresh rebuild.
    """


class _ProjectionCacheMismatch(EventsProjectionError):
    """Internal signal: the existing cache cannot serve this source.

    Callers translate this into delete-and-rebuild; it is never surfaced as
    an application-level failure on its own.
    """


def events_projection_dir(campaign_logs_dir: Path | str) -> Path:
    """``<campaign>/memory`` directory owning the projection database."""
    return Path(campaign_logs_dir).parent / MEMORY_DIR_NAME


def events_projection_path(campaign_logs_dir: Path | str) -> Path:
    return events_projection_dir(campaign_logs_dir) / EVENTS_PROJECTION_DB_NAME


def payload_entity_refs(event_type: str, data: Mapping[str, Any]) -> list[tuple[str, str]]:
    """Structured ``(role, entity_ref)`` pairs implied by the frozen payload
    schema: one pair per declared ref/semantic-id/id-list field value.

    Schema-driven structural extraction only — no keyword, regex, or prose
    classification ever decides what counts as an entity reference (semantic
    matcher constitution); the closed field-kind table already decided.
    """
    if event_type not in EVENT_TYPES:
        raise ClosedEnumError(
            f"entity-ref extraction bound to unknown event type {event_type!r}",
            record_kind=f"{event_type} payload",
            value=event_type,
        )
    kinds = PAYLOAD_FIELD_KINDS[event_type]
    refs: list[tuple[str, str]] = []
    for field in sorted(kinds):
        if field not in data or data[field] is None:
            continue
        base_kind = kinds[field].split(":", 1)[0]
        if base_kind not in _ENTITY_REF_FIELD_KINDS:
            continue
        value = data[field]
        values = list(value) if isinstance(value, (list, tuple)) else [value]
        for item in values:
            refs.append((field, str(item)))
    return refs


def _connect_projection(db_path: Path, *, create: bool = False) -> sqlite3.Connection:
    try:
        if create:
            db_path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(db_path)
    except sqlite3.Error as exc:
        raise EventsProjectionError(
            f"cannot open events projection database {db_path}: {exc}",
        ) from exc
    connection.row_factory = sqlite3.Row
    try:
        # Single-file journal mode is load-bearing: the cache is published by
        # renaming one file over the target, so WAL sidecars must not exist.
        connection.execute("PRAGMA journal_mode = DELETE")
        connection.execute("PRAGMA foreign_keys = ON")
        if create:
            with connection:
                for statement in _EVENTS_PROJECTION_DDL:
                    connection.execute(statement)
            connection.execute(
                f"PRAGMA user_version = {EVENTS_PROJECTION_USER_VERSION}"
            )
            connection.commit()
    except sqlite3.Error as exc:
        connection.close()
        raise EventsProjectionError(
            f"cannot initialize events projection database {db_path}: {exc}",
        ) from exc
    return connection


def _read_projection_meta(connection: sqlite3.Connection) -> dict[str, Any]:
    """Return the cached source coverage, or raise ``_ProjectionCacheMismatch``
    for anything that is not an intact current-generation database."""
    try:
        user_version = int(connection.execute("PRAGMA user_version").fetchone()[0])
        if user_version != EVENTS_PROJECTION_USER_VERSION:
            raise _ProjectionCacheMismatch(
                f"events projection user_version={user_version!r}, expected "
                f"{EVENTS_PROJECTION_USER_VERSION!r} ({SCHEMA_GENERATION})"
            )
        present = {
            str(row[0])
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
        missing = [name for name in _EVENTS_PROJECTION_TABLES if name not in present]
        if missing:
            raise _ProjectionCacheMismatch(
                "events projection missing tables: " + ", ".join(missing)
            )
        indexes = {
            str(row[0])
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'index'"
            )
        }
        missing_idx = [
            name for name in _EVENTS_PROJECTION_INDEXES if name not in indexes
        ]
        if missing_idx:
            raise _ProjectionCacheMismatch(
                "events projection missing indexes: " + ", ".join(missing_idx)
            )
        integrity = [
            str(row[0]) for row in connection.execute("PRAGMA integrity_check")
        ]
        if integrity != ["ok"]:
            raise _ProjectionCacheMismatch(
                "events projection failed integrity check: "
                + "; ".join(integrity[:4])
            )
        row = connection.execute(
            "SELECT * FROM projection_meta WHERE singleton = 1"
        ).fetchone()
    except _ProjectionCacheMismatch:
        raise
    except sqlite3.Error as exc:
        raise _ProjectionCacheMismatch(
            f"events projection unreadable or corrupt: {exc}"
        ) from exc
    if row is None:
        raise _ProjectionCacheMismatch("events projection has no meta row")
    meta = dict(row)
    if meta.get("schema_generation") != SCHEMA_GENERATION:
        raise _ProjectionCacheMismatch(
            f"events projection generation {meta.get('schema_generation')!r} "
            f"!= {SCHEMA_GENERATION!r}; the cache is rebuilt, never migrated"
        )
    if meta.get("source_name") != CANONICAL_STREAM_NAME:
        raise _ProjectionCacheMismatch(
            f"events projection covers {meta.get('source_name')!r}, expected "
            f"{CANONICAL_STREAM_NAME!r}"
        )
    return meta


def _row_for_record(record: Mapping[str, Any]) -> dict[str, Any]:
    """Insertion-ready ``events`` row: a pure function of the record."""
    return {
        "campaign": record["campaign"],
        "timeline": record["timeline"],
        "sequence": record["sequence"],
        "turn": record["turn"],
        "event_type": record["type"],
        "privacy": record["privacy"],
        "event_id": record["id"],
        "decision_id": record["decision_id"],
        "source": record["source"],
        "game_time": record["game_time"],
        "envelope_sha256": record_digest(record),
        "payload_json": canonical_json(record["data"]),
    }


def _insert_projection_rows(
    connection: sqlite3.Connection, record: Mapping[str, Any]
) -> None:
    connection.execute(
        "INSERT INTO events (campaign, timeline, sequence, turn, event_type,"
        " privacy, event_id, decision_id, source, game_time, envelope_sha256,"
        " payload_json) VALUES (:campaign, :timeline, :sequence, :turn,"
        " :event_type, :privacy, :event_id, :decision_id, :source, :game_time,"
        " :envelope_sha256, :payload_json)",
        _row_for_record(record),
    )
    connection.executemany(
        "INSERT INTO event_entities (campaign, timeline, sequence, role,"
        " entity_ref) VALUES (?, ?, ?, ?, ?)",
        [
            (
                record["campaign"],
                record["timeline"],
                record["sequence"],
                role,
                entity_ref,
            )
            for role, entity_ref in payload_entity_refs(
                record["type"], record["data"]
            )
        ],
    )


def events_projection_digest(connection: sqlite3.Connection) -> str:
    """Deterministic SHA-256 over generation + every projection row
    (canonical JSON, sorted): depends only on logical content, never on
    insertion order, rowids, or wall clock. Machine-internal evidence."""
    hasher = hashlib.sha256()
    hasher.update(f"schema-generation:{SCHEMA_GENERATION}\n".encode("utf-8"))
    for table in _EVENTS_PROJECTION_TABLES:
        cursor = connection.execute(f'SELECT * FROM "{table}"')
        columns = [str(desc[0]) for desc in cursor.description or ()]
        lines = sorted(
            canonical_json(
                {
                    "columns": columns,
                    "row": dict(zip(columns, tuple(row))),
                }
            )
            for row in cursor.fetchall()
        )
        hasher.update(f"table:{table}:{len(lines)}\n".encode("utf-8"))
        for line in lines:
            hasher.update(line.encode("utf-8"))
            hasher.update(b"\n")
    return hasher.hexdigest()


def _read_validated_stream(stream: Path) -> list[dict[str, Any]]:
    """Parse and validate the whole canonical stream; raise typed errors
    naming the offending line for malformed JSON or schema violations.
    The stream itself is authoritative evidence — a broken line is never
    silently skipped here."""
    records: list[dict[str, Any]] = []
    if not stream.is_file():
        return records
    with stream.open("r", encoding="utf-8") as handle:
        for number, line in enumerate(handle, start=1):
            stripped = line.strip()
            if not stripped:
                continue
            try:
                record = json.loads(stripped)
                validate_event(record)
            except (json.JSONDecodeError, CanonicalEventsContractError) as exc:
                raise EventsProjectionError(
                    f"canonical stream {stream} line {number} failed "
                    f"validation: {exc}"
                ) from exc
            records.append(record)
    return records


def _validate_and_publish(logs_path: Path) -> dict[str, Any]:
    """Full rebuild: parse the whole stream, build a validated fresh
    database at a temp path, atomically publish it over the cache."""
    db_path = events_projection_path(logs_path)
    records = _read_validated_stream(canonical_stream_path(logs_path))
    consumed_bytes = 0
    consumed_lines = 0
    stream = canonical_stream_path(logs_path)
    if stream.is_file():
        raw = stream.read_bytes()
        consumed_bytes = len(raw)
        consumed_lines = sum(1 for line in raw.splitlines() if line.strip())
    prefix_hasher = hashlib.sha256()
    if stream.is_file():
        prefix_hasher.update(stream.read_bytes())
    temp_path = db_path.parent / (
        f".{EVENTS_PROJECTION_DB_NAME}.{os.getpid()}.tmp"
    )
    try:
        connection = _connect_projection(temp_path, create=True)
        try:
            with connection:
                for record in records:
                    _insert_projection_rows(connection, record)
                connection.execute(
                    "INSERT INTO projection_meta (singleton, schema_generation,"
                    " source_name, source_prefix_sha256, source_bytes_applied,"
                    " source_lines_applied, event_count) VALUES (1, ?, ?, ?,"
                    " ?, ?, ?)",
                    (
                        SCHEMA_GENERATION,
                        CANONICAL_STREAM_NAME,
                        prefix_hasher.hexdigest(),
                        consumed_bytes,
                        consumed_lines,
                        len(records),
                    ),
                )
            digest = events_projection_digest(connection)
        finally:
            connection.close()
        # Publication validation: fail closed unless the temp database is an
        # intact current-generation build before replacing the live cache.
        probe = _connect_projection(temp_path)
        try:
            _read_projection_meta(probe)
        finally:
            probe.close()
        os.replace(temp_path, db_path)
    except BaseException:
        try:
            temp_path.unlink()
        except OSError:
            pass
        raise
    return {
        "status": "rebuilt",
        "schema_generation": SCHEMA_GENERATION,
        "db_path": str(db_path),
        "event_count": len(records),
        "source_bytes_applied": consumed_bytes,
        "source_lines_applied": consumed_lines,
        "content_digest": digest,
    }


def _try_incremental_apply(
    connection: sqlite3.Connection, meta: dict[str, Any], stream: Path
) -> dict[str, Any] | None:
    """Apply the unconsumed suffix of the stream inside one transaction.

    Returns a status envelope, or ``None`` to signal the caller that this
    cache must be fully rebuilt (stale prefix, shrunken source, torn or
    invalid tail). Never mutates half of anything: validation happens before
    the transaction opens, and any failure rolls the transaction back whole.
    """
    applied = meta["source_bytes_applied"]
    size = stream.stat().st_size
    if size < applied:
        return None
    hasher = hashlib.sha256()
    with stream.open("rb") as handle:
        remaining = applied
        while remaining > 0:
            chunk = handle.read(min(remaining, 1 << 20))
            if not chunk:
                return None
            hasher.update(chunk)
            remaining -= len(chunk)
        if hasher.hexdigest() != meta["source_prefix_sha256"]:
            return None
        tail = handle.read()
    newline = tail.rfind(b"\n")
    complete = tail[: newline + 1] if newline >= 0 else b""
    if not complete:
        return {"status": "unchanged", "event_count": meta["event_count"]}
    pending_records: list[dict[str, Any]] = []
    pending_lines = 0
    for number, raw_line in enumerate(complete.splitlines(), start=1):
        stripped = raw_line.strip()
        if not stripped:
            pending_lines += 1
            continue
        try:
            record = json.loads(stripped.decode("utf-8"))
            validate_event(record)
        except (
            UnicodeDecodeError,
            json.JSONDecodeError,
            CanonicalEventsContractError,
        ) as exc:
            raise EventsProjectionError(
                f"canonical stream {stream} unapplied line {number} failed "
                f"validation: {exc}"
            ) from exc
        pending_records.append(record)
        pending_lines += 1
    hasher.update(complete)
    new_offset = applied + len(complete)
    try:
        with connection:
            for record in pending_records:
                _insert_projection_rows(connection, record)
            connection.execute(
                "UPDATE projection_meta SET source_prefix_sha256 = ?,"
                " source_bytes_applied = ?, source_lines_applied ="
                " source_lines_applied + ?, event_count = event_count + ?"
                " WHERE singleton = 1",
                (
                    hasher.hexdigest(),
                    new_offset,
                    pending_lines,
                    len(pending_records),
                ),
            )
    except sqlite3.Error:
        return None
    updated = dict(meta)
    updated.update(
        {
            "source_prefix_sha256": hasher.hexdigest(),
            "source_bytes_applied": new_offset,
            "source_lines_applied": meta["source_lines_applied"] + pending_lines,
            "event_count": meta["event_count"] + len(pending_records),
        }
    )
    return {
        "status": "incremental",
        "event_count": updated["event_count"],
        "applied_count": len(pending_records),
    }


def apply_events_projection(campaign_logs_dir: Path | str) -> dict[str, Any]:
    """Bring the projection cache up to date with the canonical stream.

    Incremental-suffix apply for a verified current-generation cache;
    delete-and-rebuild for anything else (missing, corrupt, wrong
    generation, stale/torn coverage). Both paths yield logically identical
    contents because rows are pure functions of validated records.
    """
    logs_path = Path(campaign_logs_dir)
    stream = canonical_stream_path(logs_path)
    db_path = events_projection_path(logs_path)
    if db_path.exists() and not db_path.is_file():
        raise EventsProjectionError(
            f"events projection path is not a regular file: {db_path}"
        )
    if not db_path.exists():
        return _validate_and_publish(logs_path)
    try:
        connection = _connect_projection(db_path)
        try:
            meta = _read_projection_meta(connection)
            if not stream.is_file():
                if meta["source_bytes_applied"] == 0:
                    return {
                        "status": "unchanged",
                        "event_count": meta["event_count"],
                    }
                # Source shrank to nothing underneath a non-empty cache:
                # republish an empty current-generation cache (projection
                # code never touches the stream itself).
                return _validate_and_publish(logs_path)
            result = _try_incremental_apply(connection, meta, stream)
        finally:
            connection.close()
    except _ProjectionCacheMismatch:
        return _validate_and_publish(logs_path)
    except EventsProjectionError:
        # An invalid suffix means some byte range the prefix verification
        # already blessed is unreadable: rebuild is both the heal and the
        # honest diagnostic surface for genuinely damaged evidence.
        return _validate_and_publish(logs_path)
    if result is None:
        return _validate_and_publish(logs_path)
    return result


def rebuild_events_projection(campaign_logs_dir: Path | str) -> dict[str, Any]:
    """Discard whatever cache exists and rebuild it from the full stream."""
    logs_path = Path(campaign_logs_dir)
    return _validate_and_publish(logs_path)


def query_events(
    campaign_logs_dir: Path | str,
    *,
    timeline: str | None = None,
    turn_from: int | None = None,
    turn_to: int | None = None,
    types: Iterable[str] | None = None,
    privacy: str = "public",
    entity_refs: Iterable[str] | None = None,
    limit: int | None = None,
) -> dict[str, Any]:
    """Structured, sequence-ordered read over the events projection.

    Filters are structured selectors only: exact timeline id, inclusive turn
    range, closed enum of event types, closed privacy view, and exact entity
    refs matched structurally against ``event_entities``. ``privacy`` defaults
    to ``"public"`` so player-facing queries can never observe secret events;
    ``"secret"`` and ``"all"`` views stay Keeper-side. Rows come back grouped
    by timeline ascending then ``sequence`` ascending. The cache self-heals
    first (:func:`apply_events_projection`), so a stale or corrupt database
    never answers a query.
    """
    if privacy not in PRIVACY_LEVELS and privacy != "all":
        raise PrivacyError(
            f"query privacy={privacy!r} not in {[ PRIVACY_LEVELS, 'all']} views",
            record_kind="events.query",
            field="privacy",
            value=privacy,
        )
    selected_types: list[str] = []
    for event_type in types or ():
        if event_type not in EVENT_TYPES:
            raise ClosedEnumError(
                f"query type {event_type!r} not in closed enum of {len(EVENT_TYPES)}"
                " event types",
                record_kind="events.query",
                field="types",
                value=event_type,
            )
        selected_types.append(event_type)
    selected_refs = [str(ref) for ref in (entity_refs or ())]
    if limit is not None and (not isinstance(limit, int) or isinstance(limit, bool)):
        raise CanonicalEventsContractError(
            f"query limit must be an integer, got {limit!r}",
            record_kind="events.query",
            field="limit",
            value=limit,
        )
    if limit is not None and limit < 1:
        raise CanonicalEventsContractError(
            f"query limit must be >= 1, got {limit!r}",
            record_kind="events.query",
            field="limit",
            value=limit,
        )
    effective_limit = limit if limit is not None else 100

    logs_path = Path(campaign_logs_dir)
    apply_events_projection(logs_path)
    connection = _connect_projection(events_projection_path(logs_path))
    try:
        # Every row in this campaign's projection came from this campaign's
        # own stream; the campaign id is the directory's own semantic name.
        clauses = ["e.campaign = ?"]
        params: list[Any] = [Path(logs_path).parent.name]
        if timeline is not None:
            clauses.append("e.timeline = ?")
            params.append(timeline)
        for label, bound, comparator in (
            ("turn_from", turn_from, ">="),
            ("turn_to", turn_to, "<="),
        ):
            if bound is None:
                continue
            if (
                not isinstance(bound, int)
                or isinstance(bound, bool)
                or bound < TURN_MIN
            ):
                raise CanonicalEventsContractError(
                    f"query {label} must be an int >= {TURN_MIN}, got {bound!r}",
                    record_kind="events.query",
                    field=label,
                    value=bound,
                )
            clauses.append(f"e.turn {comparator} ?")
            params.append(bound)
        if selected_types:
            clauses.append(
                "e.event_type IN (" + ",".join("?" for _ in selected_types) + ")"
            )
            params.extend(selected_types)
        if privacy != "all":
            clauses.append("e.privacy = ?")
            params.append(privacy)
        for entity_ref in selected_refs:
            clauses.append(
                "EXISTS (SELECT 1 FROM event_entities r WHERE"
                " r.campaign = e.campaign AND r.timeline = e.timeline"
                " AND r.sequence = e.sequence AND r.entity_ref = ?)"
            )
            params.append(entity_ref)
        sql = (
            "SELECT e.timeline, e.sequence, e.turn, e.event_type, e.privacy,"
            " e.event_id, e.decision_id, e.source, e.game_time, e.payload_json"
            " FROM events e WHERE "
            + " AND ".join(clauses)
            + " ORDER BY e.timeline ASC, e.sequence ASC LIMIT ?"
        )
        params.append(effective_limit)
        rows = connection.execute(sql, params).fetchall()
    finally:
        connection.close()
    events = [
        {
            "id": row["event_id"],
            "type": row["event_type"],
            "timeline": row["timeline"],
            "turn": row["turn"],
            "sequence": row["sequence"],
            "game_time": row["game_time"],
            "privacy": row["privacy"],
            "decision_id": row["decision_id"],
            "source": row["source"],
            "data": json.loads(row["payload_json"]),
        }
        for row in rows
    ]
    return {
        "schema_generation": SCHEMA_GENERATION,
        "count": len(events),
        "truncated": len(events) >= effective_limit,
        "events": events,
    }


# ---------------------------------------------------------------------------
# Public emit API
# ---------------------------------------------------------------------------


def emit(
    *,
    campaign_logs_dir: Path | str,
    event_type: str,
    campaign: str,
    timeline: str,
    turn: int,
    slug: str,
    source: str,
    game_time: str,
    privacy: str,
    decision_id: str,
    data: Mapping[str, Any],
    allocator: SequenceAllocator | None = None,
) -> dict[str, Any]:
    """Validate, sequence, persist, and index one canonical event.

    Call discipline: invoke only AFTER the transactional/rules settlement
    behind the event succeeded. Persistence goes through
    ``coc_state.append_jsonl`` — the same JSONL machinery every other
    campaign log uses — into ``logs/canonical-events.jsonl``.

    - Sequence allocation happens here in code via the durable allocator;
      it is never model-supplied.
    - A repeated ``decision_id`` with byte-equal semantic content is a
      no-op success returning the stored event; different content under a
      used decision id raises :class:`DuplicateDecisionIdError` (fail
      closed via :func:`resolve_duplicate`).
    - Emitting ``turn-finalized`` sweeps that turn's uncovered sightings
      through :func:`settle_uncovered_writes` first: the closing line of a
      turn is the emission-point boundary after which no more of that
      turn's writes can arrive.
    - Failed validation burns no sequence: allocation happens only after
      the envelope + payload validate on their own merits.
    """
    logs_path = Path(campaign_logs_dir)
    logs_path.mkdir(parents=True, exist_ok=True)
    index = _get_write_index(logs_path)

    draft: dict[str, Any] = {
        "specversion": SPECVERSION,
        "type": event_type,
        "id": event_id_for(event_type, campaign, timeline, turn, slug),
        "source": source,
        "campaign": campaign,
        "timeline": timeline,
        "turn": turn,
        "sequence": SEQUENCE_MIN,  # placeholder; re-stamped post-allocation
        "game_time": game_time,
        "privacy": privacy,
        "decision_id": decision_id,
        "data": dict(data),
    }
    validate_envelope(draft)

    stored = index["decisions"].get(decision_id)
    if stored is not None:
        return dict(resolve_duplicate(stored, draft))

    known_ids = _EMITTED_EVENT_IDS.get(_logs_key(logs_path)) or index["event_ids"]
    if draft["id"] in known_ids:
        raise SemanticIdError(
            f"event id {draft['id']!r} already exists in this stream; give this "
            "occurrence a distinct ordinal_slug"
        )

    if allocator is None:
        key = _logs_key(logs_path)
        allocator_obj = _ALLOCATORS.get(key)
        if allocator_obj is None:
            allocator_obj = FileSequenceAllocator(logs_path)
            _ALLOCATORS[key] = allocator_obj
        allocator = allocator_obj
    draft["sequence"] = allocator.next_sequence(campaign, timeline)
    validate_envelope(draft)
    event = draft

    if event_type == "turn-finalized":
        try:
            settle_uncovered_writes(logs_path, turn=turn)
        except Exception:
            pass

    import coc_state as _coc_state

    _coc_state.append_jsonl(canonical_stream_path(logs_path), event)
    _remember_emitted(logs_path, event)
    # Incremental projection apply AFTER successful persistence: rows are a
    # pure function of validated records, so this hook converges to exactly
    # what a full rebuild would produce. Best-effort by design — the canonical
    # line is already durable, and every query path self-heals the cache.
    try:
        apply_events_projection(logs_path)
    except Exception:  # noqa: BLE001 - cache upkeep never breaks emission
        pass
    return dict(event)


__all__ = [
    "CANONICAL_STREAM_NAME",
    "EVENTS_PROJECTION_DB_NAME",
    "EVENTS_PROJECTION_USER_VERSION",
    "EventsProjectionError",
    "FileSequenceAllocator",
    "UNCOVERED_LEDGER_NAME",
    "SEQUENCE_CURSOR_NAME",
    "classify_campaign_log_append",
    "emit",
    "events_projection_dir",
    "events_projection_path",
    "apply_events_projection",
    "rebuild_events_projection",
    "query_events",
    "events_projection_digest",
    "payload_entity_refs",
    "max_sequences_in_stream",
    "note_choked_append",
    "reset_emission_runtime_state",
    "settle_uncovered_writes",
    "uncovered_ledger_path",
    "canonical_stream_path",
    "sequence_cursor_path",
    "BELIEF_MODES",
    "BELIEF_ASSERTED_FIELDS",
    "BELIEF_REFRAMED_FIELDS",
    "CLUE_DISCOVERED_FIELDS",
    "CanonicalEventsContractError",
    "ClosedEnumError",
    "CONTRACT_NAME",
    "CONTRACT_SCHEMA_VERSION",
    "DuplicateDecisionIdError",
    "ENVELOPE_FIELDS",
    "EVENT_TYPES",
    "ITEM_TRANSFERRED_FIELDS",
    "MissingFieldError",
    "MEMORY_KINDS",
    "MEMORY_WRITTEN_FIELDS",
    "NPC_RELATIONSHIP_CHANGED_FIELDS",
    "PLAYER_DECLARED_FIELDS",
    "PAYLOAD_FIELD_KINDS",
    "PAYLOAD_FIELDS",
    "PAYLOAD_REQUIRED",
    "PAYLOAD_SCHEMA_VERSION",
    "PrivacyError",
    "PRIVACY_LEVELS",
    "PayloadVersionError",
    "ROLL_RESULT_LEVELS",
    "ROLL_RESOLVED_FIELDS",
    "SANITY_CHANGED_FIELDS",
    "SCENE_MOVED_FIELDS",
    "SCENE_MOVE_CAUSES",
    "SequenceAllocator",
    "SequenceError",
    "SCHEMA_GENERATION",
    "SPECVERSION",
    "SEMANTIC_ID_RE",
    "TURN_FINALIZED_FIELDS",
    "TURN_STARTED_FIELDS",
    "TURN_MIN",
    "UnknownFieldError",
    "MemorySequenceAllocator",
    "build_event",
    "canonical_json",
    "event_id_for",
    "iter_events",
    "ordinal_slug",
    "project_player_view",
    "record_digest",
    "resolve_duplicate",
    "validate_envelope",
    "validate_event",
    "validate_payload",
]
