#!/usr/bin/env python3
"""Frozen contract layer for the canonical COC campaign event stream.

Contract-only module: the closed envelope schema, the 12-type event
registry, per-type closed payload schemas, deterministic semantic-ID
construction, sequence-allocation seam, and validation. JSONL append and
the projection rebuild are later plan tasks; nothing here writes a campaign.

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
import re
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


__all__ = [
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
