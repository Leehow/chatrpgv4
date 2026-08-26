#!/usr/bin/env python3
"""Cross-timeline memory transfer: pure deterministic plan/validation.

One authoritative ``transfer`` event derives new subjective assertions on a
target timeline (``cross_timeline_echo``). This module only *plans and
validates*: it never persists, never registers a toolbox tool, never applies
rules or state effects. Hard play costs are returned as typed requests for
later canonical ``rules.*`` / ``state.*`` application.

Integration status: ``unintegrated`` (component contract only, per the
feature-integration discipline; canonical consumers land in a later wave).

Deterministic rules owned here (everything else lives in the frozen contract):

- Player meta-knowledge (``player_assertion`` / ``player_preference``) never
  automatically transfers. Only an explicit transfer event creates character
  memory on another timeline.
- Derived targets are NEW assertions: fresh deterministic ids
  (``mem-<campaign>-echo-<from>-to-<to>-<slug>``, embedding the full
  transfer identity plus the source slug so A→B and A→C never collide),
  state ``cross_timeline_echo``, ``transfer_ref`` back to the event, source
  provenance (commit/turn/receipts) preserved verbatim.
- ``from != to`` timelines; each entry's source lives on the source timeline
  of the same campaign; the transfer anchor never precedes memory formation.
- Echo fidelity bounds couple ``state`` / ``credibility`` / ``distortion``:
  a faithful echo is credible (>= 0.5) and undistorted; ``uncertain`` is
  strictly below 0.5; ``distorted`` / ``dreamlike`` must describe their
  distortion. Fidelity labels live on the transfer entry; the derived
  assertion's memory state is always ``cross_timeline_echo``.
- Privacy never broadens: ``keeper_only`` sources stay ``keeper_only``;
  ``player_safe`` sources may stay or tighten.
- ``cause`` (KP-semantic reason for the bleed) is durable authoritative
  evidence: the frozen ``TRANSFER_FIELDS`` schema has no dedicated field,
  so the record's ``play_cost`` always carries the canonical envelope
  ``{"cause": ..., "costs": [...]}``; ``cause_from_event`` and
  ``cost_requests_from_event`` rebuild it from the bare persisted record.

Standing API:

- ``build_transfer_event(campaign_id, from_timeline, to_timeline,
  source_assertions, entries, cause, play_cost, receipt)`` -> plan mapping
- ``derive_target_assertions(transfer_event, source_assertions)`` -> records
- ``validate_transfer_plan(plan_or_event, source_assertions,
  target_assertions, existing_assertions=None,
  existing_transfer_events=None, existing_event_lookup=None)`` -> report
  (raises on any violation; re-derivation must match the provided targets
  byte-for-byte; replay is idempotent only when the entire persisted
  authoritative event is canonically identical — changed cause, costs,
  receipt, provenance, or entries fail closed; orphan target assertions
  claiming a missing event fail closed)
- ``cause_from_event(plan_or_event)`` -> durable cause rebuilt from record
- ``cost_requests_from_event(plan_or_event)`` -> typed cost requests
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Iterable, Mapping

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import coc_temporal_memory_contract as contract

SCHEMA_GENERATION = contract.SCHEMA_GENERATION
AUTHORITY = "advisory"
INTEGRATION_STATUS = "unintegrated"

# Player meta-knowledge is the player's, never a character's memory; it is
# excluded from transfer entirely (the KP may still narrate meta feelings).
PLAYER_META_KINDS: tuple[str, ...] = (
    "player_assertion",
    "player_preference",
)

# Fidelity labels an echo may arrive with. The derived assertion's memory
# state is always DERIVED_ECHO_STATE; these labels live on the entry.
ECHO_ENTRY_STATES: tuple[str, ...] = (
    "cross_timeline_echo",  # faithful echo
    "uncertain",  # hazy, low confidence
    "distorted",  # wrong content, distortion described
    "dreamlike",  # fragmentary dream imagery, distortion described
)
FAITHFUL_ECHO_STATE = "cross_timeline_echo"
DERIVED_ECHO_STATE = "cross_timeline_echo"
UNCERTAIN_STATE = "uncertain"
DISTORTED_STATES: tuple[str, ...] = ("distorted", "dreamlike")
FAITHFUL_CREDIBILITY_MIN = 0.5

# A forgotten memory has no content left to echo across timelines.
UNTRANSFERABLE_SOURCE_STATES: tuple[str, ...] = ("forgotten",)

# Typed play-cost vocabulary: each kind maps to the canonical operation the
# later integration layer must route through. Applied here: never.
PLAY_COST_KINDS: tuple[str, ...] = (
    "san_loss",
    "san_check",
    "skill_check",
    "luck_spend",
    "resource_spend",
    "status_effect",
    "relationship_shift",
)
COST_OPERATION_FOR_KIND: dict[str, str] = {
    "san_loss": "rules.san_loss",
    "san_check": "rules.san_check",
    "skill_check": "rules.skill_check",
    "luck_spend": "rules.luck_spend",
    "resource_spend": "state.resource_spend",
    "status_effect": "state.effect",
    "relationship_shift": "state.effect",
}

# Caller-facing closed field sets (the contract-side entry/record field sets
# stay owned by coc_temporal_memory_contract).
ENTRY_INPUT_FIELDS: tuple[str, ...] = (
    "source_assertion",
    "state",
    "credibility",
    "distortion",
    "privacy",
)
COST_INPUT_FIELDS: tuple[str, ...] = ("kind", "amount", "subject_id", "note")
COST_REQUEST_FIELDS: tuple[str, ...] = (
    "request_id",
    "operation",
    "campaign_id",
    "timeline_id",
    "transfer_id",
    "kind",
    "amount",
    "subject_id",
    "note",
    "cause",
    "applied",
    "decision_id",
)

MAX_CAUSE_CHARS = 500
MAX_DISTORTION_CHARS = 500
MAX_COST_NOTE_CHARS = 500
MAX_AMOUNT_CHARS = 50
MAX_COST_FIELD_CHARS = 500  # contract bound on the play_cost record field
# Durable cause+costs envelope carried inside the record's play_cost field
# (frozen TRANSFER_FIELDS has no dedicated cause field).
_COST_ENVELOPE_KEYS: tuple[str, ...] = ("cause", "costs")
_MAX_ID_LEN = 128


# ---------------------------------------------------------------------------
# Small local primitives (contract keeps the authoritative ones; these are
# thin wrappers so error taxonomy stays closed and named)
# ---------------------------------------------------------------------------


def _require_name(value: Any, *, field: str, max_chars: int) -> str:
    if not isinstance(value, str) or not value.strip():
        raise contract.TransferError(
            f"{field} must be a non-empty string",
            field=field,
            value=value,
        )
    if len(value) > max_chars:
        raise contract.TransferError(
            f"{field} exceeds {max_chars} chars",
            field=field,
            value=value,
        )
    return value


def _check_timeline_id(value: Any, *, field: str) -> str:
    if (
        not isinstance(value, str)
        or not value.startswith(contract.ID_PREFIX["timeline"])
        or len(value) > _MAX_ID_LEN
        or not contract.SEMANTIC_ID_RE.match(value)
    ):
        raise contract.TransferError(
            f"{field}={value!r} must be a semantic timeline id "
            "(tl-<slug>, lowercase kebab)",
            field=field,
            value=value,
        )
    return value


def _check_cost_subject_id(value: Any) -> str | None:
    if value is None:
        return None
    if (
        not isinstance(value, str)
        or not value.startswith(contract.ID_PREFIX["subject"])
        or len(value) > _MAX_ID_LEN
        or not contract.SEMANTIC_ID_RE.match(value)
    ):
        raise contract.TransferError(
            f"play cost subject_id={value!r} must be a semantic subject id",
            field="play_cost",
            value=value,
        )
    return value


def _check_cost_amount(value: Any) -> int | str | None:
    if value is None:
        return None
    if isinstance(value, bool):
        raise contract.TransferError(
            "play cost amount must be an int >= 0 or a short string spec "
            "(e.g. '1d4'), not a bool",
            field="play_cost",
            value=value,
        )
    if isinstance(value, int):
        if value < 0:
            raise contract.TransferError(
                "play cost amount must be >= 0",
                field="play_cost",
                value=value,
            )
        return value
    if isinstance(value, str):
        if not value.strip() or len(value) > MAX_AMOUNT_CHARS:
            raise contract.TransferError(
                f"play cost amount must be a non-empty string of at most "
                f"{MAX_AMOUNT_CHARS} chars",
                field="play_cost",
                value=value,
            )
        return value
    raise contract.TransferError(
        "play cost amount must be an int >= 0 or a string spec (e.g. '1d4')",
        field="play_cost",
        value=value,
    )


def _event_of(plan_or_event: Any) -> dict[str, Any]:
    """Accept either a plan mapping from ``build_transfer_event`` or a bare
    contract-valid transfer record."""
    if not isinstance(plan_or_event, Mapping):
        raise contract.TransferError(
            "expected a transfer event record or a build_transfer_event plan",
            field="transfer_event",
        )
    if "transfer_id" in plan_or_event:
        return dict(plan_or_event)
    inner = plan_or_event.get("transfer")
    if isinstance(inner, Mapping) and "transfer_id" in inner:
        return dict(inner)
    raise contract.TransferError(
        "expected a transfer event record or a plan with a 'transfer' key",
        field="transfer_event",
    )


def _index_sources(source_assertions: Iterable[Mapping[str, Any]]) -> dict[str, dict]:
    if not isinstance(source_assertions, (list, tuple)):
        raise contract.TransferError(
            "source_assertions must be a list of assertion records",
            field="source_assertions",
        )
    by_id: dict[str, dict] = {}
    for record in source_assertions:
        if not isinstance(record, Mapping):
            raise contract.TransferError(
                "each source assertion must be a mapping",
                field="source_assertions",
            )
        contract.validate_assertion(record)
        aid = record["assertion_id"]
        if aid in by_id:
            raise contract.TransferError(
                f"duplicate source assertion {aid!r}",
                field="source_assertions",
                value=aid,
            )
        by_id[aid] = dict(record)
    return by_id


def _index_targets(records: Iterable[Mapping[str, Any]]) -> dict[str, dict]:
    if not isinstance(records, (list, tuple)):
        raise contract.TransferError(
            "target assertions must be a list of assertion records",
            field="target_assertions",
        )
    by_id: dict[str, dict] = {}
    for record in records:
        if not isinstance(record, Mapping):
            raise contract.TransferError(
                "each target assertion must be a mapping",
                field="target_assertions",
            )
        contract.validate_assertion(record)
        aid = record["assertion_id"]
        if aid in by_id:
            raise contract.TransferError(
                f"duplicate target assertion {aid!r}",
                field="target_assertions",
                value=aid,
            )
        by_id[aid] = dict(record)
    return by_id


# ---------------------------------------------------------------------------
# Deterministic echo id
# ---------------------------------------------------------------------------


def _echo_id(
    campaign_id: str, from_timeline: str, to_timeline: str, source_assertion_id: str
) -> str:
    prefix = f"mem-{campaign_id}-"
    if not source_assertion_id.startswith(prefix):
        raise contract.TransferError(
            f"source assertion {source_assertion_id!r} is not campaign-scoped "
            f"for {campaign_id!r}; cross-campaign assertions never transfer",
            field="entries",
            value=source_assertion_id,
        )
    slug = source_assertion_id[len(prefix) :]
    # Embed the FULL transfer identity (campaign + from + to, i.e. exactly
    # the discriminating part of transfer-<campaign>-<from>-to-<to>) plus
    # the source slug. A->B and A->C therefore derive distinct echo ids for
    # the same source; by contract construction there is one authoritative
    # transfer event per ordered (from, to) pair per campaign, so no extra
    # ordinal is needed and the id stays derivable from the record alone.
    echo_id = f"{prefix}echo-{from_timeline}-to-{to_timeline}-{slug}"
    if len(echo_id) > _MAX_ID_LEN or not contract.SEMANTIC_ID_RE.match(echo_id):
        raise contract.TransferError(
            f"derived echo id {echo_id!r} violates the semantic id grammar "
            f"or exceeds {_MAX_ID_LEN} chars; shorten the source slug",
            field="entries",
            value=echo_id,
        )
    return echo_id


def echo_assertion_id_for(
    transfer: Mapping[str, Any], source_assertion_id: str
) -> str:
    """Deterministic target id embedding the full transfer identity
    (campaign, from_timeline, to_timeline) plus the source slug, so echoes
    of the same source onto different destination timelines never collide
    and the id is derivable from the transfer record alone."""
    return _echo_id(
        transfer["campaign_id"],
        transfer["from_timeline"],
        transfer["to_timeline"],
        source_assertion_id,
    )


# ---------------------------------------------------------------------------
# Entry normalization (input side)
# ---------------------------------------------------------------------------


def _normalize_entry(
    raw: Any,
    sources: Mapping[str, Mapping[str, Any]],
    *,
    campaign_id: str,
    from_timeline: str,
) -> dict[str, Any]:
    if not isinstance(raw, Mapping):
        raise contract.TransferError(
            "each transfer entry must be a mapping", field="entries"
        )
    unknown = sorted(set(raw) - set(ENTRY_INPUT_FIELDS))
    if unknown:
        raise contract.UnknownFieldError(
            f"transfer entry has unknown fields {unknown}",
            record_kind="transfer_entry",
            field=unknown[0],
        )
    source_id = raw.get("source_assertion")
    if not source_id:
        raise contract.MissingFieldError(
            "transfer entry requires source_assertion",
            record_kind="transfer_entry",
            field="source_assertion",
        )
    source = sources.get(source_id)
    if source is None:
        raise contract.TransferError(
            f"transfer entry source {source_id!r} is not in source_assertions",
            field="entries",
            value=source_id,
        )

    # Player meta-knowledge boundary: never auto-transfers, and this module
    # refuses to plan such a transfer at all.
    if source["kind"] in PLAYER_META_KINDS:
        raise contract.TransferError(
            f"player meta-knowledge ({source['kind']} {source_id!r}) never "
            "transfers; only explicit echoes are character memory",
            field="entries",
            value=source_id,
        )
    if source["state"] in UNTRANSFERABLE_SOURCE_STATES:
        raise contract.TransferError(
            f"source assertion {source_id!r} is {source['state']!r}; there is "
            "no content left to echo",
            field="entries",
            value=source_id,
        )
    if source.get("scope") != "campaign" or source.get("campaign_id") != campaign_id:
        raise contract.TransferError(
            f"transfer source {source_id!r} is not a campaign-scoped "
            f"assertion of campaign {campaign_id!r}",
            field="entries",
            value=source_id,
        )
    if source.get("timeline_id") != from_timeline:
        raise contract.TransferError(
            f"transfer source {source_id!r} lives on timeline "
            f"{source.get('timeline_id')!r}, not from_timeline {from_timeline!r}",
            field="entries",
            value=source_id,
        )

    state = raw.get("state") or FAITHFUL_ECHO_STATE
    if state not in ECHO_ENTRY_STATES:
        raise contract.ClosedEnumError(
            f"transfer entry state={state!r} not an echo fidelity state "
            f"{list(ECHO_ENTRY_STATES)}",
            record_kind="transfer_entry",
            field="state",
            value=state,
        )

    credibility = raw.get("credibility")
    if credibility is None:
        credibility = 1.0
    if (
        isinstance(credibility, bool)
        or not isinstance(credibility, (int, float))
        or not 0.0 <= float(credibility) <= 1.0
    ):
        raise contract.TransferError(
            "credibility must be a number in [0, 1]",
            field="credibility",
            value=credibility,
        )
    credibility = float(credibility)

    distortion = raw.get("distortion")
    if distortion is not None and (
        not isinstance(distortion, str)
        or not distortion.strip()
        or len(distortion) > MAX_DISTORTION_CHARS
    ):
        raise contract.TransferError(
            "distortion must be a non-empty semantic description of at most "
            f"{MAX_DISTORTION_CHARS} chars, or null",
            field="distortion",
            value=distortion,
        )

    # Fidelity coupling: the state label must match the numbers.
    if state == FAITHFUL_ECHO_STATE:
        if credibility < FAITHFUL_CREDIBILITY_MIN:
            raise contract.TransferError(
                f"a faithful echo requires credibility >= "
                f"{FAITHFUL_CREDIBILITY_MIN}; use state="
                f"{UNCERTAIN_STATE!r} or a distorted state for fainter "
                "echoes",
                field="credibility",
                value=credibility,
            )
        if distortion is not None:
            raise contract.TransferError(
                "a faithful echo carries no distortion; describe degradation "
                "with state=distorted/dreamlike instead",
                field="distortion",
                value=distortion,
            )
    elif state == UNCERTAIN_STATE:
        if credibility >= FAITHFUL_CREDIBILITY_MIN:
            raise contract.TransferError(
                f"an uncertain echo requires credibility < "
                f"{FAITHFUL_CREDIBILITY_MIN}",
                field="credibility",
                value=credibility,
            )
    else:  # distorted / dreamlike
        if distortion is None:
            raise contract.TransferError(
                f"a {state} echo must describe its distortion (what the "
                "character gets wrong) in the entry",
                field="distortion",
            )

    privacy = raw.get("privacy") or source["privacy"]
    if privacy not in contract.PRIVACY_LEVELS:
        raise contract.ClosedEnumError(
            f"transfer entry privacy={privacy!r} not in closed enum "
            f"{list(contract.PRIVACY_LEVELS)}",
            record_kind="transfer_entry",
            field="privacy",
            value=privacy,
        )
    # Privacy never broadens across timelines.
    if source["privacy"] == "keeper_only" and privacy != "keeper_only":
        raise contract.PrivacyError(
            f"keeper_only source {source_id!r} may not transfer as "
            f"{privacy!r}; privacy never broadens",
            record_kind="transfer_entry",
            field="privacy",
            value=privacy,
        )

    return {
        "source_assertion": source_id,
        "state": state,
        "credibility": credibility,
        "distortion": distortion,
        "privacy": privacy,
    }


# ---------------------------------------------------------------------------
# Typed play-cost requests
# ---------------------------------------------------------------------------


def _build_cost_requests(
    play_cost: Any,
    *,
    campaign_id: str,
    from_timeline: str,
    to_timeline: str,
    transfer_id: str,
    cause: str,
) -> tuple[list[dict], list[dict]]:
    """Validate raw cost inputs and return (raw_costs, typed_requests).

    Requests are typed, unapplied, and carry their canonical operation; the
    integration layer routes them through ``rules.*`` / ``state.*`` tools.
    """
    if play_cost is None:
        return [], []
    if isinstance(play_cost, Mapping):
        raw_list: list[Any] = [play_cost]
    elif isinstance(play_cost, (list, tuple)):
        raw_list = list(play_cost)
    else:
        raise contract.TransferError(
            "play_cost must be None, a cost mapping, or a list of cost "
            "mappings",
            field="play_cost",
            value=type(play_cost).__name__,
        )
    if not raw_list:
        return [], []

    raw_costs: list[dict] = []
    requests: list[dict] = []
    for ordinal, raw in enumerate(raw_list, start=1):
        if not isinstance(raw, Mapping):
            raise contract.TransferError(
                "each play cost must be a mapping", field="play_cost"
            )
        unknown = sorted(set(raw) - set(COST_INPUT_FIELDS))
        if unknown:
            raise contract.UnknownFieldError(
                f"play cost has unknown fields {unknown}",
                record_kind="play_cost",
                field=unknown[0],
            )
        kind = raw.get("kind")
        if kind not in PLAY_COST_KINDS:
            raise contract.ClosedEnumError(
                f"play cost kind={kind!r} not in closed enum "
                f"{list(PLAY_COST_KINDS)}",
                record_kind="play_cost",
                field="kind",
                value=kind,
            )
        amount = _check_cost_amount(raw.get("amount"))
        subject_id = _check_cost_subject_id(raw.get("subject_id"))
        note = raw.get("note")
        if note is not None and (
            not isinstance(note, str) or not note.strip() or len(note) > MAX_COST_NOTE_CHARS
        ):
            raise contract.TransferError(
                "play cost note must be a non-empty string of at most "
                f"{MAX_COST_NOTE_CHARS} chars, or null",
                field="play_cost",
                value=note,
            )
        request_id = f"cost-{campaign_id}-{from_timeline}-to-{to_timeline}-{ordinal}-{kind}"
        if len(request_id) > _MAX_ID_LEN or not contract.SEMANTIC_ID_RE.match(request_id):
            raise contract.TransferError(
                f"cost request id {request_id!r} violates the semantic id "
                "grammar; identifiers are too long",
                field="play_cost",
                value=request_id,
            )
        raw_cost = {
            "kind": kind,
            "amount": amount,
            "subject_id": subject_id,
            "note": note,
        }
        raw_costs.append(raw_cost)
        requests.append(
            {
                "request_id": request_id,
                "operation": COST_OPERATION_FOR_KIND[kind],
                "campaign_id": campaign_id,
                "timeline_id": to_timeline,
                "transfer_id": transfer_id,
                "kind": kind,
                "amount": amount,
                "subject_id": subject_id,
                "note": note,
                "cause": cause,
                "applied": False,
                "decision_id": None,
            }
        )
    return raw_costs, requests


def _cost_envelope_from_event(event: Mapping[str, Any]) -> tuple[str, list[Any]]:
    """Parse and verify the durable play-cost envelope
    ``{"cause": ..., "costs": [...]}`` from a transfer record.

    The frozen ``TRANSFER_FIELDS`` schema has no dedicated ``cause`` field,
    so the authoritative record durably retains the KP-semantic cause inside
    ``play_cost`` as canonical JSON. Persistence/reload preserves it exactly;
    audit and narration consumers rebuild it from the record alone.
    """
    raw = event.get("play_cost")
    if raw is None:
        raise contract.TransferError(
            "transfer record carries no play_cost envelope; cause is "
            "mandatory durable evidence (rebuild via build_transfer_event)",
            field="play_cost",
        )
    try:
        envelope = json.loads(raw)
    except (TypeError, ValueError) as exc:
        raise contract.TransferError(
            "play_cost must be canonical JSON produced by build_transfer_event",
            field="play_cost",
        ) from exc
    if not isinstance(envelope, Mapping) or set(envelope) != set(
        _COST_ENVELOPE_KEYS
    ):
        raise contract.TransferError(
            "play_cost envelope must carry exactly the keys "
            f"{list(_COST_ENVELOPE_KEYS)} (durable cause + costs)",
            field="play_cost",
        )
    if contract.canonical_json(envelope) != raw:
        raise contract.TransferError(
            "play_cost envelope is not canonical JSON (sorted keys, compact); "
            "rebuild the event via build_transfer_event",
            field="play_cost",
        )
    cause = _require_name(envelope["cause"], field="cause", max_chars=MAX_CAUSE_CHARS)
    costs = envelope["costs"]
    if not isinstance(costs, list):
        raise contract.TransferError(
            "play_cost envelope costs must be a list of cost mappings",
            field="play_cost",
        )
    return cause, costs


def cause_from_event(plan_or_event: Mapping[str, Any]) -> str:
    """Rebuild the durable KP-semantic cause from the authoritative record.

    Works identically from a bare persisted record and from a
    ``build_transfer_event`` plan, so post-reload audit and narration
    consumers recover why the transfer occurred without any sidecar.
    """
    event = _event_of(plan_or_event)
    contract.validate_transfer(event)
    cause, _ = _cost_envelope_from_event(event)
    return cause


def cost_requests_from_event(plan_or_event: Mapping[str, Any]) -> list[dict]:
    """Rebuild the typed (unapplied) cost requests from an event record.

    The record's ``play_cost`` field durably carries the canonical envelope
    ``{"cause": ..., "costs": [...]}``; requests (including their cause)
    are re-derived deterministically, so a bare persisted record replays the
    exact requests the plan originally returned.
    """
    event = _event_of(plan_or_event)
    contract.validate_transfer(event)
    cause, raw_list = _cost_envelope_from_event(event)
    _, requests = _build_cost_requests(
        raw_list,
        campaign_id=event["campaign_id"],
        from_timeline=event["from_timeline"],
        to_timeline=event["to_timeline"],
        transfer_id=event["transfer_id"],
        cause=cause,
    )
    return requests


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def build_transfer_event(
    campaign_id: str,
    from_timeline: str,
    to_timeline: str,
    source_assertions: Iterable[Mapping[str, Any]],
    entries: Iterable[Mapping[str, Any]],
    cause: str,
    play_cost: Any = None,
    receipt: str | None = None,
    *,
    source_commit: str | None = None,
    source_turn: int | None = None,
) -> dict[str, Any]:
    """Build the authoritative transfer-event payload plus typed costs.

    Returns ``{"transfer": <contract-valid record>, "cause": ...,
    "cost_requests": [...]}``. Pure: nothing is written; inputs are never
    mutated. ``receipt`` is the authoritative receipt name binding the KP
    decision; ``cause`` is KP-semantic free text durably retained inside
    the record's ``play_cost`` envelope (``{"cause": ..., "costs": ...}``)
    so persistence/reload preserves it.

    The anchor provenance defaults to the newest evidence among the
    transferred sources (max source_turn, ties broken by commit sha); pass
    ``source_commit`` / ``source_turn`` to anchor explicitly.
    """
    _require_name(campaign_id, field="campaign_id", max_chars=128)
    _check_timeline_id(from_timeline, field="from_timeline")
    _check_timeline_id(to_timeline, field="to_timeline")
    if from_timeline == to_timeline:
        raise contract.TransferError(
            "cross-timeline transfer requires distinct timelines",
            field="to_timeline",
            value=to_timeline,
        )
    _require_name(cause, field="cause", max_chars=MAX_CAUSE_CHARS)
    _require_name(receipt, field="receipt", max_chars=200)

    sources = _index_sources(source_assertions)
    if not isinstance(entries, (list, tuple)) or not entries:
        raise contract.TransferError(
            "transfer requires at least one entry", field="entries"
        )

    normalized: list[dict[str, Any]] = []
    seen_sources: set[str] = set()
    for raw in entries:
        entry = _normalize_entry(
            raw, sources, campaign_id=campaign_id, from_timeline=from_timeline
        )
        sid = entry["source_assertion"]
        if sid in seen_sources:
            raise contract.TransferError(
                f"source assertion {sid!r} appears in multiple entries; one "
                "echo per source per transfer",
                field="entries",
                value=sid,
            )
        seen_sources.add(sid)
        normalized.append(entry)

    transferred = [sources[sid] for sid in sorted(seen_sources)]
    if source_turn is None:
        source_turn = max(s["source_turn"] for s in transferred)
    elif isinstance(source_turn, bool) or not isinstance(source_turn, int) or source_turn < 0:
        raise contract.TransferError(
            "source_turn must be an int >= 0", field="source_turn", value=source_turn
        )
    if source_commit is None:
        anchor = max(transferred, key=lambda s: (s["source_turn"], s["source_commit"]))
        source_commit = anchor["source_commit"]
    for s in transferred:
        if s["valid_from_turn"] > source_turn:
            raise contract.TransferError(
                f"transfer anchored at turn {source_turn} precedes the "
                f"formation of {s['assertion_id']!r} "
                f"(valid_from_turn={s['valid_from_turn']})",
                field="source_turn",
                value=source_turn,
            )

    transfer_id = contract.transfer_id_for(campaign_id, from_timeline, to_timeline)
    raw_costs, cost_requests = _build_cost_requests(
        play_cost,
        campaign_id=campaign_id,
        from_timeline=from_timeline,
        to_timeline=to_timeline,
        transfer_id=transfer_id,
        cause=cause,
    )
    # Durable evidence envelope: cause must survive persistence/reload inside
    # the authoritative record, so it always travels with the costs.
    play_cost_str = contract.canonical_json({"cause": cause, "costs": raw_costs})
    if len(play_cost_str) > MAX_COST_FIELD_CHARS:
        raise contract.TransferError(
            f"play_cost envelope (cause + costs) exceeds the "
            f"{MAX_COST_FIELD_CHARS}-char record field; shorten the cause or "
            "notes, or split the transfer",
            field="play_cost",
        )

    record_entries = []
    for entry in normalized:
        record_entries.append(
            {
                "source_assertion": entry["source_assertion"],
                "target_assertion": _echo_id(
                    campaign_id, from_timeline, to_timeline, entry["source_assertion"]
                ),
                "state": entry["state"],
                "credibility": entry["credibility"],
                "distortion": entry["distortion"],
                "privacy": entry["privacy"],
            }
        )
    record = {
        "transfer_id": transfer_id,
        "campaign_id": campaign_id,
        "from_timeline": from_timeline,
        "to_timeline": to_timeline,
        "receipt": receipt,
        "source_commit": source_commit,
        "source_turn": source_turn,
        "entries": record_entries,
        "play_cost": play_cost_str,
    }
    contract.validate_transfer(record)
    return {"transfer": record, "cause": cause, "cost_requests": cost_requests}


def derive_target_assertions(
    transfer_event: Mapping[str, Any],
    source_assertions: Iterable[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    """Derive the new target-timeline assertions for a transfer event.

    Each target is a fresh contract-valid assertion: new deterministic id,
    state ``cross_timeline_echo``, ``transfer_ref`` back to the event,
    timeline = ``to_timeline``, provenance (commit/turn/receipts) preserved
    from the source, knowers/entities/statement preserved, cross-line graph
    links (superseded_by/contradicts/confirms) reset for an independent
    lifecycle. Fidelity data (state/credibility/distortion) lives on the
    transfer entry; the KP owns narrative realization later. Inputs are
    never mutated.
    """
    event = _event_of(transfer_event)
    contract.validate_transfer(event)
    sources = _index_sources(source_assertions)

    targets: list[dict[str, Any]] = []
    for entry in event["entries"]:
        sid = entry["source_assertion"]
        source = sources.get(sid)
        if source is None:
            raise contract.TransferError(
                f"transfer source {sid!r} missing from source_assertions",
                field="entries",
                value=sid,
            )
        if source.get("timeline_id") != event["from_timeline"]:
            raise contract.TransferError(
                f"transfer source {sid!r} is not on from_timeline "
                f"{event['from_timeline']!r}",
                field="entries",
                value=sid,
            )
        if source["kind"] in PLAYER_META_KINDS:
            raise contract.TransferError(
                f"player meta-knowledge ({source['kind']} {sid!r}) never "
                "transfers",
                field="entries",
                value=sid,
            )
        occurred = source.get("occurred_turn")
        if occurred is not None and occurred > event["source_turn"]:
            raise contract.TransferError(
                f"echo arrival turn {event['source_turn']} precedes the "
                f"occurrence recorded by {sid!r} (occurred_turn={occurred})",
                field="entries",
                value=occurred,
            )
        target = {
            "assertion_id": echo_assertion_id_for(event, sid),
            "kind": source["kind"],
            "scope": "campaign",
            "campaign_id": event["campaign_id"],
            "timeline_id": event["to_timeline"],
            "subject_id": source["subject_id"],
            "knowers": [k for k in (source.get("knowers") or [])],
            "privacy": entry["privacy"],
            "state": DERIVED_ECHO_STATE,
            "statement": source["statement"],
            "entities": [e for e in (source.get("entities") or [])],
            "occurred_turn": occurred,
            "valid_from_turn": event["source_turn"],
            "valid_until_turn": None,
            "superseded_by": [],
            "contradicts": [],
            "confirms": [],
            "covers_commits": [c for c in (source.get("covers_commits") or [])],
            "transfer_ref": event["transfer_id"],
            "source_commit": source["source_commit"],
            "source_turn": source["source_turn"],
            "source_receipts": [r for r in source["source_receipts"]],
        }
        contract.validate_assertion(target)
        targets.append(target)
    return targets


def _index_existing_events(
    existing_transfer_events: Any,
    existing_event_lookup: Any,
    *,
    transfer_id: str,
) -> dict[str, dict[str, Any]]:
    """Index persisted authoritative transfer events by transfer id.

    Accepts an iterable of event records and/or a lookup callable
    ``transfer_id -> event record | None`` (store-backed). Events for other
    ordered pairs pass through untouched; they are only schema-validated.
    Two persisted records sharing one id with different digests are a hard
    error (the store itself is inconsistent).
    """
    by_id: dict[str, dict[str, Any]] = {}

    def _accept(record: Any) -> None:
        if not isinstance(record, Mapping):
            raise contract.TransferError(
                "existing transfer events must be mappings",
                field="existing_transfer_events",
            )
        contract.validate_transfer(record)
        tid = record["transfer_id"]
        prior = by_id.get(tid)
        if prior is not None and contract.record_digest(prior) != contract.record_digest(
            record
        ):
            raise contract.TransferError(
                f"persisted store holds two divergent transfer events under "
                f"{tid!r}; the authoritative event store is inconsistent",
                field="existing_transfer_events",
                value=tid,
            )
        by_id[tid] = dict(record)

    if existing_transfer_events is not None:
        if not isinstance(existing_transfer_events, (list, tuple)):
            raise contract.TransferError(
                "existing_transfer_events must be a list of transfer records "
                "or None",
                field="existing_transfer_events",
            )
        for record in existing_transfer_events:
            _accept(record)
    if existing_event_lookup is not None:
        if not callable(existing_event_lookup):
            raise contract.TransferError(
                "existing_event_lookup must be a callable "
                "transfer_id -> record | None",
                field="existing_event_lookup",
            )
        found = existing_event_lookup(transfer_id)
        if found is not None:
            _accept(found)
    return by_id


def _divergent_event_fields(
    existing: Mapping[str, Any], event: Mapping[str, Any]
) -> list[str]:
    """Top-level fields whose values differ between the persisted event and
    the replayed event (for fail-closed error messages)."""
    return [
        key
        for key in sorted(set(existing) | set(event))
        if existing.get(key) != event.get(key)
    ]


def validate_transfer_plan(
    plan_or_event: Mapping[str, Any],
    source_assertions: Iterable[Mapping[str, Any]],
    target_assertions: Iterable[Mapping[str, Any]],
    *,
    existing_assertions: Iterable[Mapping[str, Any]] | None = None,
    existing_transfer_events: Iterable[Mapping[str, Any]] | None = None,
    existing_event_lookup: Any = None,
) -> dict[str, Any]:
    """Authoritative gate for a transfer plan. Raises on any violation.

    Checks: contract schema for the event and every assertion; per-entry
    module rules (re-derivation must match the provided targets
    digest-for-digest); cross-record links via ``validate_transfer_links``;
    id collision against ``existing_assertions`` (identical content is an
    idempotent replay; divergent content is a hard error — echoes are never
    overwritten).

    Event-level replay binding: one ordered campaign/from/to pair has exactly
    one semantic transfer id, so a replay is idempotent ONLY when the entire
    persisted authoritative event is canonically identical. Pass the existing
    event records via ``existing_transfer_events`` or a store-backed
    ``existing_event_lookup(transfer_id)``. Any changed cause/cost envelope,
    receipt, source provenance, entries (credibility/distortion/privacy), or
    any other field fails closed even when the derived target assertions are
    identical. Existing assertions claiming this event's ``transfer_ref``
    while the authoritative event is missing fail closed as orphan evidence.

    Returns a report; applies nothing.
    """
    event = _event_of(plan_or_event)
    contract.validate_transfer(event)
    sources = _index_sources(source_assertions)

    existing_events = _index_existing_events(
        existing_transfer_events,
        existing_event_lookup,
        transfer_id=event["transfer_id"],
    )
    existing_event = existing_events.get(event["transfer_id"])
    idempotent_event = False
    if existing_event is not None:
        if contract.record_digest(existing_event) != contract.record_digest(event):
            divergent = _divergent_event_fields(existing_event, event)
            raise contract.TransferError(
                f"transfer event {event['transfer_id']!r} is already "
                f"persisted with different content (divergent fields: "
                f"{divergent}); one ordered campaign/from/to pair has "
                "exactly one authoritative event and replay must be "
                "canonically identical — cause, costs, receipt, provenance, "
                "entries included",
                field="existing_transfer_events",
                value=divergent,
            )
        idempotent_event = True

    derived = derive_target_assertions(event, list(sources.values()))
    derived_by_id = {t["assertion_id"]: t for t in derived}

    provided = _index_targets(target_assertions)
    missing = sorted(set(derived_by_id) - set(provided))
    extra = sorted(set(provided) - set(derived_by_id))
    if missing or extra:
        raise contract.TransferError(
            f"target assertion set diverges from the deterministic "
            f"derivation (missing={missing}, extra={extra})",
            field="target_assertions",
            value=missing or extra,
        )
    for tid, expected in derived_by_id.items():
        if contract.record_digest(provided[tid]) != contract.record_digest(expected):
            raise contract.TransferError(
                f"target assertion {tid!r} diverges from the deterministic "
                "derivation; rebuild targets via derive_target_assertions",
                field="target_assertions",
                value=tid,
            )

    contract.validate_transfer_links(
        event, list(sources.values()) + list(provided.values())
    )

    idempotent: list[str] = []
    claiming: dict[str, dict[str, Any]] = {}
    if existing_assertions is not None:
        existing = _index_targets(existing_assertions)
        for aid, record in existing.items():
            if record.get("transfer_ref") == event["transfer_id"]:
                claiming[aid] = record
        if claiming and existing_event is None:
            orphans = sorted(claiming)
            raise contract.TransferError(
                f"orphan evidence: existing assertions {orphans} claim "
                f"transfer_ref={event['transfer_id']!r} but no authoritative "
                "transfer event was provided; replay validation requires "
                "the persisted event (existing_transfer_events / "
                "existing_event_lookup)",
                field="existing_transfer_events",
                value=orphans,
            )
        for aid, record in sorted(claiming.items()):
            if aid not in derived_by_id:
                raise contract.TransferError(
                    f"existing assertion {aid!r} claims "
                    f"transfer_ref={event['transfer_id']!r} but is not "
                    "derivable from the authoritative event; echoes exist "
                    "only through their transfer",
                    field="existing_assertions",
                    value=aid,
                )
        for tid in sorted(derived_by_id):
            if tid in existing:
                if contract.record_digest(existing[tid]) != contract.record_digest(
                    derived_by_id[tid]
                ):
                    raise contract.TransferError(
                        f"target assertion {tid!r} already exists with "
                        "different content; echoes are never overwritten "
                        "(close via supersession on the target timeline)",
                        field="existing_assertions",
                        value=tid,
                    )
                idempotent.append(tid)

    cost_requests = cost_requests_from_event(plan_or_event)
    plan_digest = contract.record_digest(
        {"transfer": event, "targets": derived}
    )
    return {
        "transfer_id": event["transfer_id"],
        "campaign_id": event["campaign_id"],
        "from_timeline": event["from_timeline"],
        "to_timeline": event["to_timeline"],
        "entry_count": len(event["entries"]),
        "target_ids": [t["assertion_id"] for t in derived],
        "idempotent_target_ids": idempotent,
        "idempotent_transfer": idempotent_event,
        "event_digest": contract.record_digest(event),
        "cost_operations": list(dict.fromkeys(r["operation"] for r in cost_requests)),
        "cost_requests": cost_requests,
        "applied": False,
        "plan_digest": plan_digest,
    }
