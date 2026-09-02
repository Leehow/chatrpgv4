#!/usr/bin/env python3
"""Bounded MCP wire projections for coding-host COC play.

The canonical toolbox result is logged before this module runs.  These pure
functions only reduce the copy returned through MCP so hosts with a small tool
result ceiling do not truncate the lifecycle acknowledgement and exact next
operation cards.  No rules, state, secret, or narrative decision lives here.
"""
from __future__ import annotations

from collections.abc import Iterator
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import re
from typing import Any, Callable


SCHEMA_VERSION = 1
PROFILE_ID = "keeper_hot_v1"
# Grok's documented default is 20,000 bytes.  Budget the complete envelope,
# not only ``data``, and retain headroom for the host's MCP wrapper.
MAX_INLINE_BYTES = 16 * 1024
# ``wire.measured_inline_bytes`` is attached after projection. Reserve enough
# space while fitting hot schemas so that final accounting cannot push an
# otherwise valid packet back over the hard wire ceiling.
FINAL_MEASUREMENT_RESERVE_BYTES = 64
SOURCE_MATERIAL_MENTION_LIMIT = 6
SOURCE_MATERIAL_SCENE_REF_LIMIT = 8
SOURCE_MATERIAL_MENTION_REF_LIMIT = 4
SOURCE_MATERIAL_MAX_BYTES = 4 * 1024
SOURCE_MATERIAL_METADATA_RESERVE_BYTES = 512
SOURCE_MATERIAL_SUMMARY_BYTE_LIMIT = 768
SOURCE_MATERIAL_NOTE_BYTE_LIMIT = 640
SOURCE_MATERIAL_POLICY_BYTE_LIMIT = 512
SOURCE_MATERIAL_LABEL_BYTE_LIMIT = 128
SOURCE_IDENTIFIER_MAX_CHARS = 128
RULE_DECISION_CARD_LIMIT = 8
RULE_DECISION_INPUT_LIMIT = 16
RULE_DECISION_REF_LIMIT = 16
RULE_DECISION_LABEL_BYTE_LIMIT = 512
# Sibling decisions in one family repeat nearly identical rule/source refs, so
# the producer hoists the distinct refs into one block-level ``ref_table`` and
# leaves zero-based indexes on each card.  The wire keeps that shape: the table
# is the union of the block's per-card refs, so it is bounded by the per-card
# limit times the card limit rather than by the per-card limit alone.
RULE_DECISION_REF_TABLE_LIMIT = RULE_DECISION_REF_LIMIT * RULE_DECISION_CARD_LIMIT
RULE_DECISION_CARD_FIELDS = frozenset({
    "schema_version",
    "decision_ref",
    "family",
    "label",
    "applicability",
    "required_inputs",
    "locked_inputs",
    "rule_ref_ids",
    "source_ref_ids",
    "capability_ref",
    "effect_refs",
    "possible_continuations",
    "authority",
})
#: Fields a card MAY carry. The required set above is compared exactly, and a
#: card whose shape is unexpected is dropped whole by design, so an optional
#: field has to be declared here or every card that omits it would vanish.
#:
#: ``answers_declared_intent`` is set only when the decision declares a
#: trigger on the player's declared action and an intent was declared this
#: turn. Without it on the wire the Keeper cannot tell which card answers what
#: the player actually said, which is the whole point of declaring one.
RULE_DECISION_OPTIONAL_CARD_FIELDS = frozenset({
    "answers_declared_intent",
    "settle_form",
})
RULE_DECISION_BLOCK_FIELDS = frozenset({
    "schema_version",
    "family",
    "investigator_id",
    "status",
    "cards",
    "ref_table",
    "authority",
})
RULE_DECISION_REF_TABLE_FIELDS = frozenset({
    "rule_refs", "source_refs", "resolution",
})
# `description` is optional: the authored input-slot sentence saying what the
# slot wants. Carried, not required -- a slot with no authored description is
# still a valid row. Without it a slot typed `object` reached the Keeper with
# no contract at all, and this whitelist is exact-match, so an unregistered key
# does not degrade: it returns None and drops EVERY card in the block.
RULE_DECISION_INPUT_FIELDS = frozenset({"name", "owner", "type"})
RULE_DECISION_INPUT_OPTIONAL_FIELDS = frozenset({"description", "shape"})
RULE_DECISION_INPUT_DESCRIPTION_MAX = 400
# The slot's authored JSON-schema fragment, for slots whose contract is not
# evident from the type word. Bounded by serialized size rather than by a key
# whitelist: it is a schema, and the Keeper already reads schemas everywhere
# else (`expected_schema` on a failure). Registered here because this
# projector is exact-match on keys and drops the WHOLE block on one unmatched
# row -- an unregistered `shape` would take every card with it.
RULE_DECISION_INPUT_SHAPE_MAX_BYTES = 2048
RULE_DECISION_INPUT_OWNERS = frozenset({
    "keeper-semantic", "player-source", "optional-semantic",
})
# The authored graph's own slot vocabulary. Five model-facing types were
# missing -- `enum`, `object`, `array`, `semantic`, `semantic-ref-array`, 20
# slots across the coc7 ruleset -- and this list is exact-match on a projector
# that returns None for the WHOLE block on one unmatched row. So any card with
# an enum or object slot vanished from scene.context entirely, including
# `social:adjudicate-difficulty`, whose `approach` is an enum and whose
# `supporting_action` is an object. That is the same failure already recorded
# a few hundred lines below for `possible_continuations`: one unmatched member
# drops the entire card rather than degrading it.
RULE_DECISION_INPUT_TYPES = frozenset({
    "actor-ref", "boolean", "bool", "integer", "int", "number", "scalar",
    "string", "enum", "object", "array", "semantic", "semantic-ref-array",
})
RULE_DECISION_AUTHORITY_FIELDS = frozenset({
    "selection", "execution", "hard_gate",
})
RULE_DECISION_BLOCK_AUTHORITY_FIELDS = frozenset({
    "hard_gate", "role", "note",
})
_OPAQUE_UUID = re.compile(
    r"(?i)(?:^|[:._-])[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-"
    r"[89ab][0-9a-f]{3}-[0-9a-f]{12}(?:$|[:._-])"
)
_OPAQUE_HEX = re.compile(r"(?i)(?:^|[:._-])[0-9a-f]{16,}(?:$|[:._-])")
_SOURCE_IDENTIFIER_FIRST = frozenset(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
)
_SOURCE_IDENTIFIER_REST = _SOURCE_IDENTIFIER_FIRST | frozenset("._:-")
_LOWER_HEX = frozenset("0123456789abcdef")
SOURCE_WORKER_CONTRACT_PATH = (
    Path(__file__).resolve().parent.parent
    / "references"
    / "source-pack-worker-v1.json"
)

# Compact projection of the canonical ``turn.finalize`` argument contract.
# This is intentionally smaller than the archived MCP schema: it carries only
# the fields a Keeper must retain between output-context and finalization, and
# never supplies meaning-bearing coverage values on the Keeper's behalf.
FINALIZE_ARGUMENTS = (
    "draft",
    "coverage",
    "decision_id",
    "revision",
    "mechanics_placements",
    "narration_review_id",
    "agency_claims",
    "repair_finalization_id",
    "validate_only",
    "advisory_uptake",
)
FINALIZE_COVERAGE_FIELDS = (
    "obligation_id",
    "realization",
    "action_realization",
    "response",
    "causal_explanation",
    "persona_fit",
    "player_input_handling",
    "exact_excerpt",
    "exceptional_beat",
)
FINALIZE_REALIZATION_VALUES = (
    "fictional_beat",
    "concealed_no_player_visible_beat",
)
FINALIZE_PLAYER_INPUT_HANDLING_VALUES = (
    "abstract_completed",
    "specific_preserved",
    "not_applicable",
)
INLINE_ARGUMENT_SCHEMA_MARKER = "_inline_argument_schema"

# Closed machine task envelopes pass through the wire verbatim. Their nested
# operation cards (e.g. the locator task's ``resolve_operation``) are consumed
# with exactKeys validation by the Pi extension; wire decoration would add
# contract_ref/discovery_required keys and break that strict machine contract.
LOCATOR_TASK_CONTRACT_IDS = frozenset({
    "coc.pi-source-scope-locator-task.v1",
    "coc.codex-source-scope-locator-task.v1",
})


def transport_bytes(value: Any) -> int:
    """Return bytes for the same non-ASCII JSON shape emitted by the server."""
    return len(json.dumps(value, ensure_ascii=False).encode("utf-8"))


def _exceeds_inline_budget(value: Any, *, reserve_bytes: int = 0) -> bool:
    """Return whether ``value`` plus bounded final metadata exceeds the wire."""
    return (
        transport_bytes(value) + max(0, reserve_bytes)
        > MAX_INLINE_BYTES
    )


def canonical_digest(value: Any) -> str:
    payload = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    ).encode("utf-8")
    return f"sha256:{hashlib.sha256(payload).hexdigest()}"


def _without_schema_annotations(value: Any) -> Any:
    """Keep exact structural constraints while dropping token-heavy prose."""
    if isinstance(value, dict):
        return {
            key: _without_schema_annotations(child)
            for key, child in value.items()
            if key not in {"description", "examples", "default"}
        }
    if isinstance(value, list):
        return [_without_schema_annotations(child) for child in value]
    return deepcopy(value)


def _fit_hot_argument_schemas(
    result: dict[str, Any],
    *,
    omit_order: tuple[str, ...],
    reserve_bytes: int = 0,
) -> None:
    """Prefer structural hot schemas over another discovery round trip."""
    wire = result.setdefault("wire", {})
    wire.pop("hot_argument_schemas_compacted", None)
    wire.pop("hot_argument_schemas_omitted", None)
    hot = (result.get("data") or {}).get("ordinary_turn_operations")
    if not isinstance(hot, dict):
        return
    compacted: list[str] = []
    for operation, card in hot.items():
        if not isinstance(card, dict) or not isinstance(
            card.get("arguments_schema"), dict
        ):
            continue
        compact = _without_schema_annotations(card["arguments_schema"])
        if compact != card["arguments_schema"]:
            card["arguments_schema"] = compact
            compacted.append(str(operation))
    if compacted:
        wire["hot_argument_schemas_compacted"] = compacted

    omitted: list[str] = []
    for operation in omit_order:
        if not _exceeds_inline_budget(result, reserve_bytes=reserve_bytes):
            break
        card = hot.get(operation)
        if isinstance(card, dict) and card.pop("arguments_schema", None) is not None:
            omitted.append(operation)
    if omitted:
        wire["hot_argument_schemas_omitted"] = omitted


def _pick(value: Any, fields: tuple[str, ...]) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    return {
        field: deepcopy(value[field])
        for field in fields
        if field in value
    }


def _model_invocation_tool(operation: str) -> str | None:
    """Tool the model may reach ``operation`` through, or None if host-private.

    Resolved through the canonical operation policy so this projection and the
    Pi execute ACL cannot disagree. Import failure yields ``None``: a card with
    no invocation is inert, whereas a wrongly advertised one is refused by the
    ACL and costs the Keeper a round trip.
    """
    try:
        import coc_operation_policy
    except ImportError:
        return None
    try:
        return coc_operation_policy.model_invocation_tool(operation)
    except (KeyError, ValueError):
        return None


def _operation_card(
    operation: str,
    *,
    prefilled: dict[str, Any] | None = None,
    missing: list[str] | None = None,
    inline_argument_schema: bool = False,
) -> dict[str, Any]:
    """Semantic replay/continuation card for one canonical operation.

    ``invoke_via`` names the tool the model may actually call. It is NOT
    unconditionally ``coc_invoke``: that is the hidden compatibility wrapper
    for a closed set of host-private operations, and the Pi execute ACL
    refuses every other ``kp_surface: "none"`` operation sent through it with
    ``host_private_operation``.

    A host-private operation therefore gets ``invoke_via: None`` plus
    ``model_invocable: False`` rather than an invitation the model cannot
    accept. This matters beyond tidiness: the ten-family RuleGraph cutover
    moved the legacy family operations to ``kp_surface: "none"``, so a bounded
    projection of, for example, a ``combat.end`` result used to hand the Keeper
    a ``coc_invoke`` card that could only ever be denied — one wasted model
    round trip against a 180-second turn budget, and an invitation to retry.
    """
    invoke_via = _model_invocation_tool(operation)
    card = {
        "operation": operation,
        "invoke_via": invoke_via,
        "model_invocable": invoke_via is not None,
        "prefilled_arguments": deepcopy(prefilled or {}),
        "missing_arguments": list(missing or []),
        "authority": "advisory",
        "hard_gate": False,
    }
    if inline_argument_schema:
        card[INLINE_ARGUMENT_SCHEMA_MARKER] = True
    return card


def _compact_checkpoint(
    value: Any, *, tight: bool = False
) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    source = _pick(
        value.get("source"),
        (
            "finalization_id",
            "journal_decision_id",
            "run_segment_id",
            "session_id",
            "turn_id",
            "accepted_revision",
            "settlement_snapshot_id",
            "rendered_text_sha256",
            "contract_projection_sha256",
            "source_digest",
            "integrity_digest",
        ),
    )
    projected = {
        **_pick(
            value,
            (
                "schema_version",
                "kind",
                "campaign_id",
                "checkpoint_id",
                "turn_number",
                "status",
                "created_at",
                "content_sha256",
            ),
        ),
        "source": source,
        "refs": _pick(
            value.get("refs"),
            (
                "finalization",
                "transcript",
                "session_summaries",
                "world",
                "pending_turn",
            ),
        ),
    }
    if tight:
        projected.pop("created_at", None)
        projected.pop("kind", None)
        projected.pop("campaign_id", None)
        projected["source"] = _pick(
            source,
            (
                "run_segment_id", "session_id", "turn_id", "finalization_id",
                "journal_decision_id", "accepted_revision",
                "settlement_snapshot_id", "rendered_text_sha256",
                "contract_projection_sha256",
            ),
        )
        projected["refs"] = _pick(
            projected.get("refs"),
            ("finalization",),
        )
    return projected


def _compact_capsule(value: Any, *, tight: bool) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    summary_limit = 1 if tight else 2
    row_limit = 2 if tight else 8
    threads = [
        deepcopy(row)
        for row in value.get("threads") or []
        if isinstance(row, dict) and row.get("status") != "resolved"
    ]
    if not threads:
        threads = [
            deepcopy(row)
            for row in (value.get("threads") or [])[-2:]
            if isinstance(row, dict)
        ]
    full_counts = {
        key: len(value.get(key) or [])
        for key in (
            "recent_summaries",
            "threads",
            "confirmed_decisions",
            "do_not_repeat",
            "style_commitments",
        )
    }
    projected = {
        **_pick(
            value,
            (
                "schema_version",
                "kind",
                "unresolved_intent",
                "updated_from_turn",
            ),
        ),
        "recent_summaries": deepcopy(
            (value.get("recent_summaries") or [])[-summary_limit:]
        ),
        "threads": threads[-12 if not tight else -6 :],
        "confirmed_decisions": deepcopy(
            (value.get("confirmed_decisions") or [])[-row_limit:]
        ),
        "do_not_repeat": deepcopy(
            (value.get("do_not_repeat") or [])[-row_limit:]
        ),
        "style_commitments": list(dict.fromkeys(deepcopy(
            (value.get("style_commitments") or [])[-6 if tight else -8 :]
        ))),
        "full_capsule_sha256": canonical_digest(value),
        "full_counts": full_counts,
    }
    omitted = {
        key: max(0, full_counts[key] - len(projected.get(key) or []))
        for key in full_counts
    }
    if any(omitted.values()):
        projected["omitted_counts"] = omitted
        projected["detail_operation"] = _operation_card(
            "session.continuation_detail", missing=["section"]
        )
    return projected


def _compact_exit(value: Any, *, tight: bool) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    projected = _pick(value, ("to", "kind", "open", "when", "label", "cue"))
    opportunity = value.get("operation_opportunity")
    if not tight:
        projected["operation_opportunity"] = deepcopy(opportunity)
    elif isinstance(opportunity, dict):
        projected["operation_opportunity"] = _pick(
            opportunity,
            (
                "operation",
                "invoke_via",
                "prefilled_arguments",
                "missing_arguments",
                "authority",
                "hard_gate",
                "contract_ref",
                "discovery_required",
            ),
        )
    return projected


def _ordinary_turn_operations(mode: Any) -> dict[str, Any]:
    """Return bounded hot contracts appropriate to the resumed lifecycle."""
    if mode in {"awaiting_player", "open_turn_recovery"}:
        return {
            "turn_sequence": [
                "1. rules/state tools (rolls, clues, scenes, npc, time, exceptional)",
                "2. state.journal (closes the turn; player_text byte-for-byte)",
                "3. turn.output_context (returns obligations + finalize card)",
                "4. turn.finalize (draft + coverage; then deliver rendered_text)",
            ],
            "actions.advise": _operation_card(
                "actions.advise",
                missing=["player_text", "intent_evidence"],
                inline_argument_schema=True,
            ),
            "state.journal": _operation_card(
                "state.journal",
                missing=[
                    "decision_id",
                    "summary",
                    "player_text",
                    "player_action",
                    "intent_class",
                    "player_speaker",
                ],
                inline_argument_schema=True,
            ),
            "turn.output_context": _operation_card(
                "turn.output_context",
                inline_argument_schema=True,
            ),
        }
    return {}


def _compact_npc(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    projected = _pick(
        value,
        (
            "npc_id",
            "name",
            "origin",
            "role_label",
            "agenda",
            "voice",
            "relationship_to_investigators",
            "identity_ref",
            "profile_revision_ref",
            "impression",
            "presence",
            "availability",
            "trust",
            "fear",
            "suspicion",
            "parse_state",
            "evidence_gap",
        ),
    )
    social_role = value.get("social_role")
    if isinstance(social_role, dict):
        projected["social_role"] = _pick(
            social_role,
            (
                "authority_scope",
                "responsibility_domains",
                "initiative_style",
            ),
        )
    impression = projected.get("impression")
    if isinstance(impression, dict):
        projected["impression"] = _pick(
            impression,
            (
                "schema_version",
                "summary",
                "expectations",
                "reservations",
                "initialized_from_first_impression",
            ),
        )
    for empty_field in ("role_label", "presence"):
        if projected.get(empty_field) is None:
            projected.pop(empty_field, None)
    return projected


def _compact_clue(
    value: Any,
    *,
    play_language: str | None,
) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    projected = _pick(
        value,
        (
            "clue_id",
            "conclusion_id",
            "discovered",
            "delivery",
            "delivery_kind",
            "skill",
            "difficulty",
            "secret",
            "keeper_only",
        ),
    )
    localized = value.get("localized_text")
    localized_entry = (
        localized.get(play_language)
        if isinstance(localized, dict) and isinstance(play_language, str)
        else None
    )
    localized_summary = (
        localized_entry.get("player_safe_summary")
        if isinstance(localized_entry, dict)
        else None
    )
    if isinstance(localized_summary, str) and localized_summary.strip():
        projected["player_safe_summary"] = localized_summary
        projected["localized_for"] = play_language
    else:
        if value.get("player_safe_summary") is not None:
            projected["player_safe_summary"] = deepcopy(
                value.get("player_safe_summary")
            )
        if isinstance(localized, dict) and localized:
            projected["localized_text"] = deepcopy(localized)
    return {
        field: child
        for field, child in projected.items()
        if child is not None
    }


def _compact_flag(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    projected = _pick(value, ("flag_id", "value", "present"))
    provenance = value.get("provenance")
    if isinstance(provenance, dict):
        projected["provenance"] = _pick(
            provenance,
            ("source_ref", "decision_id", "reason", "integrity_status"),
        )
    return projected


def _compact_effect(value: Any, *, tight: bool) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    fields = [
        "effect_id",
        "direction",
        "effect_kind",
        "player_visible_impact",
        "boundary",
        "mechanics",
        "visibility",
        "status",
    ]
    if not tight:
        fields.insert(4, "causal_link")
    return _pick(
        value,
        tuple(fields),
    )


def _compact_continuity(value: Any, *, tight: bool) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    projected = _pick(
        value,
        (
            "schema_version",
            "state_precedence",
            "keeper_only",
            "active_time_markers",
            "unverified_world_flags",
        ),
    )
    projected["live_world_flags"] = [
        _compact_flag(row)
        for row in value.get("live_world_flags") or []
        if isinstance(row, dict)
    ]
    projected["active_exceptional_effects"] = [
        _compact_effect(row, tight=tight)
        for row in value.get("active_exceptional_effects") or []
        if isinstance(row, dict)
    ]
    if not tight:
        projected["recent_world_flag_changes"] = deepcopy(
            value.get("recent_world_flag_changes") or []
        )
    return projected


def _bounded_source_text_bytes(
    value: Any,
    limit: int,
) -> tuple[str | None, bool]:
    """Trim UTF-8 text without splitting a code point."""
    if not isinstance(value, str):
        return None, False
    encoded = value.encode("utf-8")
    if len(encoded) <= limit:
        return value, False
    ellipsis = "…"
    payload = encoded[: max(0, limit - len(ellipsis.encode("utf-8")))]
    while payload:
        try:
            return payload.decode("utf-8") + ellipsis, True
        except UnicodeDecodeError:
            payload = payload[:-1]
    return ellipsis if limit >= len(ellipsis.encode("utf-8")) else "", True


def _is_source_identifier(value: Any) -> bool:
    return (
        isinstance(value, str)
        and 0 < len(value) <= SOURCE_IDENTIFIER_MAX_CHARS
        and value[0] in _SOURCE_IDENTIFIER_FIRST
        and all(char in _SOURCE_IDENTIFIER_REST for char in value[1:])
    )


def _is_lower_sha256(value: Any) -> bool:
    return (
        isinstance(value, str)
        and len(value) == 64
        and all(char in _LOWER_HEX for char in value)
    )


def _compact_source_ref(value: Any) -> dict[str, Any]:
    """Whitelist one exact canonical ref; drop rather than rewrite bad fields."""
    if not isinstance(value, dict):
        return {}
    source_id = value.get("source_id")
    if not _is_source_identifier(source_id):
        return {}
    pdf_index = value.get("pdf_index")
    if (
        not isinstance(pdf_index, int)
        or isinstance(pdf_index, bool)
        or pdf_index < 0
    ):
        return {}
    text_sha256 = value.get("text_sha256")
    if text_sha256 is not None and not _is_lower_sha256(text_sha256):
        return {}
    return {
        "source_id": source_id,
        "pdf_index": pdf_index,
        **(
            {"text_sha256": text_sha256}
            if isinstance(text_sha256, str)
            else {}
        ),
    }


_MODULE_CONTEXT_RUNTIME_PROPERTY_KEYS = {
    # Scenario-IR materialization payloads are already available through the
    # owning scene/clue/NPC tools. Repeating them on every graph node can make
    # a five-node neighbourhood exceed the entire MCP hot-envelope budget and
    # collapse the semantic edges the Keeper actually requested.
    "runtime_projection",
    "runtime_record",
}


def _project_module_context_source_ref(value: Any) -> dict[str, Any]:
    """Keep semantic page provenance, never archive/integrity machinery."""
    if not isinstance(value, dict):
        return {}
    projected = _pick(
        value,
        ("source_id", "pdf_index", "printed_page", "page_ref"),
    )
    return {
        key: deepcopy(item)
        for key, item in projected.items()
        if item is not None
    }


def _project_module_context_node(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    projected = _pick(
        value,
        (
            "node_id",
            "node_kind",
            "name",
            "aliases",
            "summary",
            "visibility",
            "evidence_span_ids",
        ),
    )
    properties = value.get("properties")
    projected["properties"] = {
        key: deepcopy(item)
        for key, item in (properties.items() if isinstance(properties, dict) else [])
        if key not in _MODULE_CONTEXT_RUNTIME_PROPERTY_KEYS
        and not key.endswith("_sha256")
    }
    projected["source_refs"] = [
        ref
        for ref in (
            _project_module_context_source_ref(row)
            for row in value.get("source_refs") or []
        )
        if ref
    ]
    return projected


def _project_module_context_claim(value: Any) -> dict[str, Any]:
    """Keep claim semantics once; omit repeated empty extraction scaffolding."""
    if not isinstance(value, dict):
        return {}
    projected = _pick(
        value,
        (
            "claim_id",
            "subject_id",
            "predicate",
            "object",
            "truth_status",
            "visibility",
            "validity",
            "confidence",
            "reason",
        ),
    )
    for field in ("evidence_span_ids", "asserted_by_ids", "known_by_ids"):
        rows = value.get(field)
        if isinstance(rows, list) and rows:
            projected[field] = deepcopy(rows)
    return projected


def _project_module_context(data: Any) -> Any:
    """Bound one ModuleGraph search/neighbourhood without losing its edges.

    The graph already bounds node count and depth. This wire view removes only
    duplicated Scenario-IR runtime records and machine provenance, while
    preserving semantic node ids, authored properties, claims, relations,
    secrecy, source pages, completeness, and language presentation. The full
    canonical result remains hash-bound in the wire header.
    """
    if not isinstance(data, dict):
        return deepcopy(data)
    module = data.get("module")
    context = data.get("context")
    projected = _pick(
        data,
        (
            "schema_version",
            "mode",
            "available",
            "candidates",
            "presentation",
            "authority",
        ),
    )
    if isinstance(module, dict):
        projected["module"] = _pick(
            module,
            (
                "module_id",
                "graph_contract_id",
                "graph_schema_version",
                "build_status",
                "source_languages",
                "coverage",
                "source_gaps",
                "missing_shards",
            ),
        )
    if isinstance(context, dict):
        projected["context"] = {
            **_pick(
                context,
                (
                    "module_id",
                    "seed_ids",
                    "depth",
                    "audience",
                    "truncated",
                ),
            ),
            "nodes": [
                row
                for row in (
                    _project_module_context_node(item)
                    for item in context.get("nodes") or []
                )
                if row
            ],
            "relations": [
                deepcopy(row)
                for row in context.get("relations") or []
                if isinstance(row, dict)
            ],
            "claims": [
                row
                for row in (
                    _project_module_context_claim(item)
                    for item in context.get("claims") or []
                )
                if row
            ],
        }
    elif context is None:
        projected["context"] = None
    return projected


THREAD_OBJECTIVE_LIMIT = 3
THREAD_CLUE_LIMIT = 3


def _compact_story_thread(value: Any) -> dict[str, Any] | None:
    """The assembled main line, bounded.

    Three objectives deep and three clues wide: this is a planning aid, and a
    Keeper who has to scroll it will do what they did with the four flat lists
    it replaces, which is nothing.
    """
    if not isinstance(value, dict):
        return None
    rows = []
    for row in (value.get("outstanding") or [])[:THREAD_OBJECTIVE_LIMIT]:
        if not isinstance(row, dict):
            continue
        projected_row = _pick(row, ("objective", "description", "still_needs", "elsewhere"))
        projected_row["in_this_scene"] = [
            _pick(clue, ("clue_id", "delivery_kind", "delivery"))
            for clue in (row.get("in_this_scene") or [])[:THREAD_CLUE_LIMIT]
            if isinstance(clue, dict)
        ]
        projected_row["one_move_away"] = [
            {
                **_pick(dest, ("scene_id", "transition")),
                "clues": [
                    _pick(clue, ("clue_id", "delivery_kind", "delivery"))
                    for clue in (dest.get("clues") or [])[:THREAD_CLUE_LIMIT]
                    if isinstance(clue, dict)
                ],
            }
            for dest in (row.get("one_move_away") or [])[:THREAD_CLUE_LIMIT]
            if isinstance(dest, dict)
        ]
        rows.append(projected_row)
    projected = _pick(value, ("keeper_only", "authority", "note"))
    projected["outstanding"] = rows
    return projected


PENDING_DELIVERY_LIMIT = 6


def _compact_pending_deliveries(value: Any) -> dict[str, Any] | None:
    """Bounded list of the module's own pushes for this scene.

    Carries the delivery text — what happens — because that is what the Keeper
    narrates from, and the player-safe summary of what it tells them. Core
    objectives sort first, so a long scene's list leads with the main line.
    """
    if not isinstance(value, dict):
        return None
    clues = [
        _pick(row, ("clue_id", "delivery_kind", "delivery", "player_safe_summary",
                    "serves_objective", "objective_importance"))
        for row in (value.get("clues") or [])[:PENDING_DELIVERY_LIMIT]
        if isinstance(row, dict)
    ]
    projected = _pick(value, ("keeper_only", "authority", "note"))
    projected["clues"] = clues
    return projected


NEARBY_DESTINATION_LIMIT = 6
NEARBY_ROUTE_LIMIT = 4


def _compact_nearby_routes(value: Any) -> dict[str, Any] | None:
    """Bounded index of what the neighbouring scenes hold.

    Cues only, never clue content, and capped on both axes: this is a pointer
    ("the rumours live in the negotiation scene, and the module gets you there
    the morning after the feast"), not a second scene projection.
    """
    if not isinstance(value, dict):
        return None
    destinations = []
    for row in (value.get("destinations") or [])[:NEARBY_DESTINATION_LIMIT]:
        if not isinstance(row, dict):
            continue
        projected_row = _pick(row, ("scene_id", "display_name", "transition",
                                    "open_route_count"))
        projected_row["open_routes"] = [
            _pick(route, ("affordance_id", "cue", "skills"))
            for route in (row.get("open_routes") or [])[:NEARBY_ROUTE_LIMIT]
            if isinstance(route, dict)
        ]
        destinations.append(projected_row)
    projected = _pick(value, ("keeper_only", "authority", "note"))
    projected["destinations"] = destinations
    return projected


def _compact_story_progress(value: Any) -> dict[str, Any] | None:
    """The Keeper's quest log: which authored objectives are worked out.

    Compacted rather than passed through, because the objective descriptions are
    the module's own truths and a scene projection is not the place to dump all
    of them. Core objectives keep their description — that is the main line the
    Keeper paces against; supporting and optional ones travel as counts, and the
    Keeper reads the clue graph when they want the detail.
    """
    if not isinstance(value, dict):
        return None
    rows = []
    others = {"answered": 0, "open": 0}
    for row in value.get("objectives") or []:
        if not isinstance(row, dict):
            continue
        if str(row.get("importance") or "") != "core":
            others["answered" if row.get("answered") else "open"] += 1
            continue
        rows.append(_pick(row, (
            "conclusion_id", "description", "routes_required", "routes_found",
            "routes_outstanding", "answered",
        )))
    projected = _pick(value, ("keeper_only", "authority", "core_total",
                              "core_answered", "main_line_complete"))
    projected["core_objectives"] = rows
    projected["other_objectives"] = others
    return projected


def _compact_source_material(value: Any) -> dict[str, Any] | None:
    """Pack raw Keeper-only authored context once for every wire path."""
    if not isinstance(value, dict) or value.get("keeper_only") is not True:
        return None

    trimmed_fields = 0
    summary, trimmed = _bounded_source_text_bytes(
        value.get("player_safe_summary"),
        SOURCE_MATERIAL_SUMMARY_BYTE_LIMIT,
    )
    trimmed_fields += int(trimmed)
    disclosure_value = (
        value.get("disclosure")
        if isinstance(value.get("disclosure"), dict)
        else {}
    )
    policy, trimmed = _bounded_source_text_bytes(
        disclosure_value.get("semantic_policy"),
        SOURCE_MATERIAL_POLICY_BYTE_LIMIT,
    )
    trimmed_fields += int(trimmed)
    disclosure: dict[str, Any] = {}
    if _is_source_identifier(disclosure_value.get("authority")):
        disclosure["authority"] = disclosure_value["authority"]
    for field in ("hard_gate", "opening_teaser_is_not_delivery"):
        if isinstance(disclosure_value.get(field), bool):
            disclosure[field] = disclosure_value[field]
    if policy is not None:
        disclosure["semantic_policy"] = policy

    projected: dict[str, Any] = {
        "keeper_only": True,
        "player_safe_summary": summary,
        "contextual_mentions": [],
        "source_refs": [],
        "disclosure": disclosure,
    }
    schema_version = value.get("schema_version")
    if (
        isinstance(schema_version, int)
        and not isinstance(schema_version, bool)
        and 0 <= schema_version <= 1_000_000
    ):
        projected["schema_version"] = schema_version
    if _is_source_identifier(value.get("authority")):
        projected["authority"] = value["authority"]

    all_mentions = [
        row
        for row in value.get("contextual_mentions") or []
        if isinstance(row, dict)
    ]
    scene_refs = [
        row for row in value.get("source_refs") or []
        if isinstance(row, dict)
    ]
    mention_refs = [
        [
            row for row in mention.get("source_refs") or []
            if isinstance(row, dict)
        ]
        for mention in all_mentions
    ]
    total_refs = len(scene_refs) + sum(len(rows) for rows in mention_refs)

    # Reserve the one fixed metadata object, then spend the remaining bytes in
    # source-utility order. Item JSON sizes are sufficient because the empty
    # list brackets already exist in ``projected``.
    remaining = (
        SOURCE_MATERIAL_MAX_BYTES
        - transport_bytes(projected)
        - SOURCE_MATERIAL_METADATA_RESERVE_BYTES
    )

    valid_scene_refs = []
    for raw_ref in scene_refs[:SOURCE_MATERIAL_SCENE_REF_LIMIT]:
        ref = _compact_source_ref(raw_ref)
        if ref:
            valid_scene_refs.append(ref)
    if valid_scene_refs:
        first_ref = valid_scene_refs.pop(0)
        cost = transport_bytes(first_ref)
        if cost <= remaining:
            projected["source_refs"].append(first_ref)
            remaining -= cost

    for mention_index, mention in enumerate(
        all_mentions[:SOURCE_MATERIAL_MENTION_LIMIT]
    ):
        row: dict[str, Any] = {}
        for field in ("kind", "ref_id", "name", "raw_label"):
            text, trimmed = _bounded_source_text_bytes(
                mention.get(field),
                SOURCE_MATERIAL_LABEL_BYTE_LIMIT,
            )
            if text is not None:
                row[field] = text
            trimmed_fields += int(trimmed)
        note, trimmed = _bounded_source_text_bytes(
            mention.get("note"),
            SOURCE_MATERIAL_NOTE_BYTE_LIMIT,
        )
        if note is not None:
            row["note"] = note
        trimmed_fields += int(trimmed)
        row_cost = transport_bytes(row)
        row_cost += int(bool(projected["contextual_mentions"]))
        if not row or row_cost > remaining:
            continue
        remaining -= row_cost

        valid_refs = []
        for raw_ref in mention_refs[mention_index][
            :SOURCE_MATERIAL_MENTION_REF_LIMIT
        ]:
            ref = _compact_source_ref(raw_ref)
            if ref:
                valid_refs.append(ref)
        if valid_refs:
            ref_list_cost = len(',"source_refs":[]'.encode("utf-8"))
            selected_refs = []
            for ref in valid_refs:
                ref_cost = transport_bytes(ref) + int(bool(selected_refs))
                if ref_list_cost + ref_cost > remaining:
                    break
                selected_refs.append(ref)
                ref_list_cost += ref_cost
            if selected_refs:
                row["source_refs"] = selected_refs
                remaining -= ref_list_cost
        projected["contextual_mentions"].append(row)

    for ref in valid_scene_refs:
        cost = transport_bytes(ref) + int(bool(projected["source_refs"]))
        if cost > remaining:
            break
        projected["source_refs"].append(ref)
        remaining -= cost

    emitted_refs = len(projected["source_refs"]) + sum(
        len(mention.get("source_refs") or [])
        for mention in projected["contextual_mentions"]
    )
    omitted_mentions = len(all_mentions) - len(
        projected["contextual_mentions"]
    )
    omitted_refs = total_refs - emitted_refs
    if omitted_mentions or omitted_refs or trimmed_fields:
        projected["projection"] = {
            "full_source_material_sha256": canonical_digest(value),
            "contextual_mention_count": len(all_mentions),
            "emitted_contextual_mention_count": len(
                projected["contextual_mentions"]
            ),
            "omitted_contextual_mention_count": omitted_mentions,
            "omitted_source_ref_count": omitted_refs,
            "trimmed_text_field_count": trimmed_fields,
        }

    if transport_bytes(projected) <= SOURCE_MATERIAL_MAX_BYTES:
        return projected

    # Fixed fail-closed packet for future metadata growth. It retains the
    # digest and advisory boundary but never manufactures an exact ref.
    return {
        "keeper_only": True,
        "player_safe_summary": summary,
        "contextual_mentions": [],
        "source_refs": [],
        "disclosure": disclosure,
        "projection": {
            "full_source_material_sha256": canonical_digest(value),
            "contextual_mention_count": len(all_mentions),
            "emitted_contextual_mention_count": 0,
            "omitted_contextual_mention_count": len(all_mentions),
            "omitted_source_ref_count": total_refs,
            "trimmed_text_field_count": trimmed_fields,
        },
    }


def _model_semantic_identifier(value: Any) -> bool:
    """Meaning-bearing ASCII identity; rejects entropy/path/integrity tokens."""
    return (
        _is_source_identifier(value)
        and isinstance(value, str)
        and not value.startswith(("sha256:", "card-grant:", "receipt:"))
        and _OPAQUE_UUID.search(value) is None
        and _OPAQUE_HEX.search(value) is None
    )


# The two node kinds a `continues-as` relation may name.
RULE_CONTINUATION_REF_PREFIXES = ("decision:", "continuation:")


def _semantic_prefixed_ref(value: Any, prefix: str) -> bool:
    return (
        _model_semantic_identifier(value)
        and isinstance(value, str)
        and value.startswith(prefix)
        and len(value) > len(prefix)
    )


def _closed_rule_decision_ref_list(
    value: Any,
    *,
    prefix: str | tuple[str, ...],
    limit: int = RULE_DECISION_REF_LIMIT,
) -> list[str] | None:
    prefixes = (prefix,) if isinstance(prefix, str) else prefix
    if (
        not isinstance(value, list)
        or len(value) > limit
        or any(
            not any(_semantic_prefixed_ref(ref, one) for one in prefixes)
            for ref in value
        )
        or len(set(value)) != len(value)
    ):
        return None
    return list(value)


def _closed_rule_source_refs(
    value: Any,
    *,
    limit: int = RULE_DECISION_REF_LIMIT,
    allow_empty: bool = False,
) -> list[str] | None:
    """The one source-ref grammar for rule decision surfaces.

    ``limit`` widens only for the block-level ``ref_table``, which holds the
    union of the block's per-card refs rather than one card's list.  That table
    may also be empty (13 decisions in the production coc7 graph bind no rules
    at all); "this card must have sources" is enforced per card instead.
    """
    if (
        not isinstance(value, list)
        or (not value and not allow_empty)
        or len(value) > limit
    ):
        return None
    prefixes = ("span-", "source:", "pdf:", "module:", "handout:")
    # Grammar before dedupe: an unhashable member must fail closed here, never
    # raise out of the wire projection.
    if any(
        not isinstance(ref, str)
        or not _model_semantic_identifier(ref)
        or not any(ref.startswith(prefix) for prefix in prefixes)
        for ref in value
    ):
        return None
    if len(set(value)) != len(value):
        return None
    return list(value)


def _closed_rule_ref_table(value: Any) -> dict[str, Any] | None:
    """Project the block-level rule/source ref table.

    Both member lists use the same closed grammars the cards used to carry
    inline, so hoisting never widens what reaches the model.
    """
    if not isinstance(value, dict) or set(value) != RULE_DECISION_REF_TABLE_FIELDS:
        return None
    resolution = value.get("resolution")
    if not isinstance(resolution, str) or not resolution.strip():
        return None
    rule_refs = _closed_rule_decision_ref_list(
        value.get("rule_refs"),
        prefix="rule:",
        limit=RULE_DECISION_REF_TABLE_LIMIT,
    )
    source_refs = _closed_rule_source_refs(
        value.get("source_refs"),
        limit=RULE_DECISION_REF_TABLE_LIMIT,
        allow_empty=True,
    )
    bounded_resolution, _trimmed = _bounded_source_text_bytes(
        resolution, RULE_DECISION_LABEL_BYTE_LIMIT,
    )
    if rule_refs is None or source_refs is None or bounded_resolution is None:
        return None
    return {
        "rule_refs": rule_refs,
        "source_refs": source_refs,
        "resolution": bounded_resolution,
    }


def _closed_rule_ref_id_list(
    value: Any, *, table_size: int, required: bool,
) -> list[int] | None:
    """Zero-based indexes into the block ref table, bounded and resolvable.

    An index outside the table would be an unreachable ref, so the card fails
    closed exactly as a malformed inline ref did.
    """
    if (
        not isinstance(value, list)
        or len(value) > RULE_DECISION_REF_LIMIT
        or (required and not value)
    ):
        return None
    # Type and range before dedupe: an unhashable member must fail closed
    # here, never raise out of the wire projection.
    for index in value:
        if not isinstance(index, int) or isinstance(index, bool):
            return None
        if index < 0 or index >= table_size:
            return None
    if len(set(value)) != len(value):
        return None
    return list(value)


def _closed_rule_required_inputs(value: Any) -> list[dict[str, str]] | None:
    if not isinstance(value, list) or len(value) > RULE_DECISION_INPUT_LIMIT:
        return None
    rows: list[dict[str, str]] = []
    names: set[str] = set()
    for raw in value:
        if (
            not isinstance(raw, dict)
            or not RULE_DECISION_INPUT_FIELDS <= set(raw)
            or not set(raw) <= (
                RULE_DECISION_INPUT_FIELDS | RULE_DECISION_INPUT_OPTIONAL_FIELDS
            )
            or not _model_semantic_identifier(raw.get("name"))
            or raw.get("owner") not in RULE_DECISION_INPUT_OWNERS
            or raw.get("type") not in RULE_DECISION_INPUT_TYPES
            or raw["name"] in names
        ):
            return None
        description = raw.get("description")
        if description is not None and (
            not isinstance(description, str)
            or not description.strip()
            or len(description) > RULE_DECISION_INPUT_DESCRIPTION_MAX
        ):
            return None
        shape = raw.get("shape")
        if shape is not None:
            if not isinstance(shape, dict) or not shape:
                return None
            try:
                encoded = json.dumps(
                    shape, ensure_ascii=False, sort_keys=True, default=str,
                )
            except (TypeError, ValueError):
                return None
            if len(encoded.encode("utf-8")) > RULE_DECISION_INPUT_SHAPE_MAX_BYTES:
                return None
        names.add(raw["name"])
        rows.append({
            "name": raw["name"],
            "owner": raw["owner"],
            "type": raw["type"],
            **({"description": description.strip()} if description else {}),
            **({"shape": deepcopy(shape)} if shape else {}),
        })
    return rows


def _closed_rule_locked_inputs(value: Any) -> list[str] | None:
    if (
        not isinstance(value, list)
        or len(value) > RULE_DECISION_INPUT_LIMIT
        or any(not _model_semantic_identifier(name) for name in value)
        or len(set(value)) != len(value)
    ):
        return None
    return list(value)


def _closed_rule_card_authority(value: Any) -> dict[str, Any] | None:
    if (
        not isinstance(value, dict)
        or set(value) != RULE_DECISION_AUTHORITY_FIELDS
        or value.get("selection") != "keeper-semantic"
        or value.get("execution") != "current-ruleset-adapter"
        or not isinstance(value.get("hard_gate"), bool)
    ):
        return None
    return {
        "selection": value["selection"],
        "execution": value["execution"],
        "hard_gate": value["hard_gate"],
    }


def _compact_rule_decision_card(
    value: Any,
    *,
    family: str,
    rule_table_size: int = 0,
    source_table_size: int = 0,
) -> dict[str, Any] | None:
    """Project one source-bound model-safe RuleDecisionCard.

    Card grants, canonical actor identity, paths, hashes, and arbitrary extra
    fields stay out of the MCP wire. Invalid identity-bearing cards drop as a
    whole so a partial card can never authorize settlement.
    """
    if (
        not isinstance(value, dict)
        or not RULE_DECISION_CARD_FIELDS <= set(value)
        or not set(value) <= (
            RULE_DECISION_CARD_FIELDS | RULE_DECISION_OPTIONAL_CARD_FIELDS
        )
        or value.get("schema_version") != 1
        or value.get("family") != family
        or not isinstance(value.get("label"), str)
        or not value["label"].strip()
    ):
        return None
    decision_ref = value.get("decision_ref")
    capability_ref = value.get("capability_ref")
    if (
        not _semantic_prefixed_ref(decision_ref, "decision:")
        or not _semantic_prefixed_ref(capability_ref, "capability:")
        or value.get("applicability") != "applicable"
    ):
        return None
    required_inputs = _closed_rule_required_inputs(value.get("required_inputs"))
    locked_inputs = _closed_rule_locked_inputs(value.get("locked_inputs"))
    rule_refs = _closed_rule_ref_id_list(
        value.get("rule_ref_ids"), table_size=rule_table_size, required=True,
    )
    source_refs = _closed_rule_ref_id_list(
        value.get("source_ref_ids"), table_size=source_table_size, required=True,
    )
    effect_refs = _closed_rule_decision_ref_list(
        value.get("effect_refs"), prefix="effect:",
    )
    # A `continues-as` edge points at either a decision or a `continuation`
    # node -- the rule graph authors both (11 and 3 of them in coc7). This
    # accepted only `decision:`, and a single unmatched ref returns None for
    # the whole list, which drops the ENTIRE card: `social:adjudicate-difficulty`
    # continues as `continuation:coc7:push-luck:after-fail-push`, so the core
    # social rule vanished from every Keeper's rules context.
    continuations = _closed_rule_decision_ref_list(
        value.get("possible_continuations"),
        prefix=RULE_CONTINUATION_REF_PREFIXES,
    )
    authority = _closed_rule_card_authority(value.get("authority"))
    if (
        required_inputs is None
        or locked_inputs is None
        or rule_refs is None
        or not rule_refs
        or source_refs is None
        or effect_refs is None
        or continuations is None
        or authority is None
    ):
        return None
    label, _trimmed = _bounded_source_text_bytes(
        value.get("label"), RULE_DECISION_LABEL_BYTE_LIMIT,
    )
    if label is None:
        return None
    return {
        "schema_version": 1,
        "decision_ref": decision_ref,
        "family": family,
        "label": label,
        "applicability": "applicable",
        "required_inputs": required_inputs,
        "locked_inputs": locked_inputs,
        "rule_ref_ids": rule_refs,
        "source_ref_ids": source_refs,
        "capability_ref": capability_ref,
        "effect_refs": effect_refs,
        "possible_continuations": continuations,
        "authority": authority,
        **(
            {"answers_declared_intent": bool(value["answers_declared_intent"])}
            if isinstance(value.get("answers_declared_intent"), bool)
            else {}
        ),
        **(
            {"settle_form": _closed_settle_form(value["settle_form"])}
            if _closed_settle_form(value.get("settle_form")) is not None
            else {}
        ),
    }


def _closed_rule_block_authority(value: Any) -> dict[str, Any] | None:
    if (
        not isinstance(value, dict)
        or set(value) != RULE_DECISION_BLOCK_AUTHORITY_FIELDS
        or value.get("hard_gate") is not False
        or value.get("role") != "affordance"
        or not isinstance(value.get("note"), str)
        or not value["note"].strip()
    ):
        return None
    return {"hard_gate": False, "role": "affordance"}


def _closed_settle_form(value: Any) -> dict[str, Any] | None:
    """Carry the runtime's per-card settle form, or nothing."""
    if not isinstance(value, dict):
        return None
    prefilled = value.get("prefilled_arguments")
    missing = value.get("missing_arguments")
    if not isinstance(prefilled, dict) or not isinstance(missing, list):
        return None
    decision_ref = prefilled.get("decision_ref")
    if not _semantic_prefixed_ref(decision_ref, "decision:"):
        return None
    if not all(isinstance(name, str) and name for name in missing):
        return None
    form: dict[str, Any] = {
        "prefilled_arguments": {"decision_ref": decision_ref},
        "missing_arguments": [str(name) for name in missing],
    }
    optional = value.get("optional_arguments")
    if isinstance(optional, list) and all(
        isinstance(name, str) and name for name in optional
    ):
        if optional:
            form["optional_arguments"] = [str(name) for name in optional]
    return form


def _compact_rule_decision_card_block(value: Any) -> dict[str, Any] | None:
    if (
        not isinstance(value, dict)
        or set(value) != RULE_DECISION_BLOCK_FIELDS
        or value.get("schema_version") != 1
        or not _model_semantic_identifier(value.get("family"))
        or value.get("status") != "ok"
        or not isinstance(value.get("investigator_id"), str)
        or not value["investigator_id"]
        or not isinstance(value.get("cards"), list)
        or not value["cards"]
    ):
        return None
    family = value["family"]
    authority = _closed_rule_block_authority(value.get("authority"))
    ref_table = _closed_rule_ref_table(value.get("ref_table"))
    if authority is None or ref_table is None:
        return None
    cards = [
        projected
        for raw in value["cards"][:RULE_DECISION_CARD_LIMIT]
        if (
            projected := _compact_rule_decision_card(
                raw,
                family=family,
                rule_table_size=len(ref_table["rule_refs"]),
                source_table_size=len(ref_table["source_refs"]),
            )
        ) is not None
    ]
    if not cards:
        return None
    # Only keep the table members the surviving cards can still reach, and
    # renumber their indexes so every id resolves inside this exact payload.
    kept_rules = sorted({i for card in cards for i in card["rule_ref_ids"]})
    kept_sources = sorted({i for card in cards for i in card["source_ref_ids"]})
    rule_remap = {old: new for new, old in enumerate(kept_rules)}
    source_remap = {old: new for new, old in enumerate(kept_sources)}
    for card in cards:
        card["rule_ref_ids"] = [rule_remap[i] for i in card["rule_ref_ids"]]
        card["source_ref_ids"] = [source_remap[i] for i in card["source_ref_ids"]]
    return {
        "schema_version": 1,
        "family": family,
        "status": "ok",
        "cards": cards,
        "ref_table": {
            "rule_refs": [ref_table["rule_refs"][i] for i in kept_rules],
            "source_refs": [ref_table["source_refs"][i] for i in kept_sources],
            "resolution": ref_table["resolution"],
        },
        "settle_operation": _operation_card(
            "rules.settle",
            missing=["decision_ref", "semantic_inputs", "decision_id"],
        ),
        "authority": authority,
    }


def _compact_scene(
    value: Any,
    *,
    tight: bool,
    play_language: str | None = None,
) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    projected = _pick(
        value,
        (
            "campaign_id",
            "active_scene_id",
            "scene",
            "npcs_present",
            "party",
            "party_investigators",
            "time",
            "tension_level",
            "turn_number",
            "clues_here",
            "discovered_clue_count",
            "discovered_clues_public",
            "pending_san_triggers",
            "action_routes",
            "operation_opportunities",
            "keeper_mechanics",
            "exit_ready",
            "drilldown_refs",
            # The live reading of the clocks this scene's own pressure moves
            # name. Third time this whitelist has been the reason an authored
            # mechanic never reached a table: the block was correct at the
            # producer and correct at the Keeper's identity projection, and
            # arrived as null because the RPC path did not name it.
            "threat_clocks",
            # The module's loop declaration. Small, module-level, and the
            # Keeper cannot fork a worldline it was never told loops.
            "worldline_loop",
            # The forward nudge the kernel has computed on every scene read
            # since it was written, and that nothing has ever delivered: one
            # producer line, no consumer anywhere. The comment beside it
            # promised the KP a beat "without a separate director.advise
            # call"; the RPC path did not name it, so no Keeper ever saw one.
            "recommended_next_beat",
        ),
    )
    # Where the main line stands. This is the second projection between the
    # producer and the Keeper: scene.context builds it, the CLI shows it, and
    # this whitelist decides what the RPC path — the one a player actually
    # runs — is allowed to carry. A field can therefore be correct at the
    # producer, correct at the consumer, verified on the CLI, and still never
    # reach the table. It took one turn of real play to find that.
    if isinstance(value.get("story_progress"), dict):
        projected["story_progress"] = _compact_story_progress(value["story_progress"])
    # Same lesson, applied on the way in this time rather than after a playtest
    # found the field missing: a projection the RPC path does not name is a
    # projection the Keeper never sees.
    if isinstance(value.get("nearby_routes"), dict):
        projected["nearby_routes"] = _compact_nearby_routes(value["nearby_routes"])
    if isinstance(value.get("story_thread"), dict):
        projected["story_thread"] = _compact_story_thread(value["story_thread"])
    if isinstance(value.get("pending_deliveries"), dict):
        projected["pending_deliveries"] = _compact_pending_deliveries(
            value["pending_deliveries"]
        )
    source_material = _compact_source_material(value.get("source_material"))
    if source_material is not None:
        projected["source_material"] = source_material
    if isinstance(value.get("progressive"), dict):
        projected["progressive"] = _project_source_work_lifecycle(
            value["progressive"]
        )
    rule_decision_cards = _compact_rule_decision_card_block(
        value.get("rule_decision_cards")
    )
    if rule_decision_cards is not None:
        # One main card block is sufficient for both ordinary scene context and
        # recovery. The canonical duplicate under recovery.healing remains in
        # the full result/cache but is not repeated across the bounded wire.
        projected["rule_decision_cards"] = rule_decision_cards
    if tight:
        projected["npcs_present"] = [
            _compact_npc(row)
            for row in value.get("npcs_present") or []
            if isinstance(row, dict)
        ]
        projected["clues_here"] = [
            _compact_clue(row, play_language=play_language)
            for row in value.get("clues_here") or []
            if isinstance(row, dict)
        ]
        # Keep a small player-safe discovered index for table HUD hosts.
        public_discovered = []
        for row in value.get("discovered_clues_public") or []:
            if not isinstance(row, dict):
                continue
            public_discovered.append(
                _pick(
                    row,
                    ("clue_id", "discovered", "player_safe_summary", "localized_text"),
                )
            )
            if len(public_discovered) >= 16:
                break
        projected["discovered_clues_public"] = public_discovered
        for empty_field in (
            "pending_san_triggers",
            "operation_opportunities",
            "progressive",
            "drilldown_refs",
        ):
            if projected.get(empty_field) in (None, [], {}, False):
                projected.pop(empty_field, None)
    if tight:
        projected["exits"] = [
            _pick(
                row,
                (
                    "to",
                    "kind",
                    "open",
                    "when",
                    "label",
                    "cue",
                    "travel_minutes",
                ),
            )
            for row in value.get("exits") or []
            if isinstance(row, dict)
        ]
        if projected["exits"]:
            projected["exit_operation_template"] = _operation_card(
                "state.move_scene",
                missing=["reason", "decision_id"],
            )
            projected["exit_operation_template"]["argument_binding"] = {
                "scene_id": "copy exact `to` from the selected open exits[] row"
            }
    else:
        projected["exits"] = [
            _compact_exit(row, tight=False)
            for row in value.get("exits") or []
            if isinstance(row, dict)
        ]
    projected["continuity"] = _compact_continuity(
        value.get("continuity"), tight=tight
    )
    if tight:
        projected["full_projection_operation"] = _operation_card(
            "scene.context"
        )
    return projected


def _project_progressive_status(value: Any) -> Any:
    if not isinstance(value, dict):
        return deepcopy(value)
    projected = _pick(
        value,
        (
            "progressive",
            "asset_root_id",
            "worker",
            "source_cache",
            "start_clock_status",
            "background_takeover",
            "entity",
        ),
    )
    queue = value.get("queue")
    if isinstance(queue, dict):
        projected["queue"] = _pick(
            queue,
            (
                "schema_version",
                "pending",
                "in_flight",
                "done_count",
                "awaiting_host_count",
                "historical_host_handoff_count",
                "timing_ms",
            ),
        )
    host_work = value.get("host_work")
    if isinstance(host_work, dict):
        projected["host_work"] = _project_source_work_lifecycle(host_work)
    return projected


def _project_source_work_lifecycle(
    value: Any,
    *,
    exact_dependency_ref: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Keep exact current-dependency control while dropping bulky previews.

    Pi consumes the wait and dispatch rows as a closed lifecycle contract.
    Losing either one turns a blocking micro-dependency into ordinary model
    prose, so these fields take precedence over source request previews.
    """
    if not isinstance(value, dict):
        return {}
    projected = _pick(
        value,
        (
            "asset_root_id",
            "campaign_id",
            "open_count",
            "open_host_work_count",
            "ready_for_background_count",
            "runnable_count",
            "leased_count",
            "needs_source_window_count",
            "awaiting_scope_count",
            "awaiting_cache_count",
            "stale_count",
            "stranded_ready_count",
            "blocking_micro_ready_count",
            "claim_operation",
            "background_takeover",
            "pi_coordinator_dispatch_status",
            "pi_coordinator_max_attempts",
            "pi_coordinator_retry_exhausted_count",
            "automatic_retry_remaining",
        ),
    )
    request_field = next(
        (
            field for field in ("requests", "ready_background_requests")
            if isinstance(value.get(field), list)
        ),
        None,
    )
    if request_field is not None:
        projected[request_field] = [
            _pick(
                row,
                (
                    "job_id",
                    "kind",
                    "target_id",
                    "requested_pdf_indices",
                    "source_aspect",
                    "deadline_class",
                    "work_level",
                    "dependency_ref",
                    "work_group_id",
                    "dispatch_state",
                    "dispatch_attempts",
                    "cached_scope_complete",
                ),
            )
            for row in value[request_field][:4]
            if isinstance(row, dict)
        ]
    waits = [
        row for row in value.get("current_dependency_waits") or []
        if isinstance(row, dict)
    ]
    dispatches = [
        row for row in value.get("current_dependency_dispatches") or []
        if isinstance(row, dict)
    ]
    source_complete = value.get("current_dependency_snapshot_complete") is True
    if exact_dependency_ref is not None:
        campaign_id = str(value.get("campaign_id") or "").strip()
        exact_waits = [
            deepcopy(row)
            for row in waits
            if row.get("dependency_ref") == exact_dependency_ref
        ]
        wait_keys = {
            (str(row.get("dependency_id") or ""), str(row.get("job_id") or ""))
            for row in exact_waits
        }
        exact_dispatches = [
            deepcopy(row)
            for row in dispatches
            if row.get("dependency_ref") == exact_dependency_ref
            and (
                str(row.get("dependency_id") or ""),
                str(row.get("job_id") or ""),
            ) in wait_keys
        ]
        projected.update({
            "current_dependency_snapshot_scope": {
                "schema_version": 1,
                "contract_id": (
                    "coc.source-current-dependency-snapshot-scope.v1"
                ),
                "kind": "exact_dependency_ref",
                "campaign_id": campaign_id,
                "dependency_ref": deepcopy(exact_dependency_ref),
            },
            "current_dependency_snapshot_complete": source_complete,
            "current_dependency_waits": exact_waits,
            "current_dependency_dispatches": exact_dispatches,
            "current_dependency_projection_status": (
                "exact"
                if source_complete and len(exact_waits) == 1
                else "blocked"
            ),
            "current_dependency_projection_reason": (
                None
                if source_complete and len(exact_waits) == 1
                else (
                    "source_snapshot_incomplete"
                    if not source_complete
                    else "exact_wait_identity_not_unique"
                )
            ),
        })
    elif waits or dispatches:
        # Ordinary scene/status/deepen observations do not own one settlement
        # identity. Never copy an unbounded task set or call a truncated prefix
        # globally complete: the originating exact request owns dispatch.
        projected.update({
            "current_dependency_snapshot_complete": False,
            "current_dependency_projection_status": "summary_only",
            "current_dependency_wait_count": len(waits),
            "current_dependency_dispatch_count": len(dispatches),
        })
    elif "current_dependency_snapshot_complete" in value:
        projected.update({
            "current_dependency_snapshot_complete": source_complete,
            "current_dependency_waits": [],
            "current_dependency_dispatches": [],
            "current_dependency_projection_status": "complete_empty",
        })
    return projected


def _slim_background_takeover(value: Any) -> Any:
    """Drop the duplicate Pi coordinator packet from a background takeover.

    The generic Pi coordinator route embeds ``coordinator_dispatch.pi_task``
    and then repeats the identical task as ``next_host_action.task``
    (byte-for-byte). The Pi extension dispatches only from
    ``next_host_action.task``; Codex keeps ``coordinator_dispatch.codex_task``
    which is not duplicated there, so it survives.
    """
    if not isinstance(value, dict):
        return deepcopy(value)
    coordinator = value.get("coordinator_dispatch")
    next_action = value.get("next_host_action")
    if not isinstance(coordinator, dict) or not isinstance(next_action, dict):
        return deepcopy(value)
    task = next_action.get("task")
    pi_task = coordinator.get("pi_task")
    if (
        isinstance(task, dict)
        and isinstance(pi_task, dict)
        and canonical_digest(task) == canonical_digest(pi_task)
    ):
        projected = deepcopy(value)
        projected.pop("coordinator_dispatch", None)
        return projected
    return deepcopy(value)


def _project_register_source_bundle(value: Any) -> Any:
    """Keep the exact registered-bundle receipt and host dispatch core.

    register_source_bundle attaches the same background_takeover both top-level
    and nested inside host_work; the nested copy plus the duplicated Pi
    coordinator packet pushes the envelope past the inline budget.
    """
    if not isinstance(value, dict):
        return deepcopy(value)
    projected = _pick(
        value,
        (
            "asset_root_id",
            "requested_asset_root_id",
            "reused_existing_root",
            "bundle_sha256",
            "cached_pdf_indices",
            "page_revisions",
            "new_page_count",
            "reused_page_count",
            "bundle_validation_and_cache_ms",
            "background_takeover",
        ),
    )
    host_work = value.get("host_work")
    if isinstance(host_work, dict):
        projected["host_work"] = _project_source_work_lifecycle(host_work)
        projected["host_work"].pop("background_takeover", None)
    if isinstance(projected.get("background_takeover"), dict):
        projected["background_takeover"] = _slim_background_takeover(
            projected["background_takeover"]
        )
    return projected


def _project_opening_bootstrap(value: Any) -> Any:
    """Keep the queued bootstrap receipt and Pi dispatch takeover under budget.

    A live opening_bootstrap result nests ``source_work.background_takeover``
    with a duplicated coordinator packet plus bulky skeleton/sparse rows. Card
    decoration then pushes the envelope over the inline budget, and the generic
    identity-only fallback strips the takeover entirely. The Pi observer treats
    a missing task as ``opening_bootstrap_result_invalid`` and never spawns the
    coordinator, so the job sits ready forever. Keep the lifecycle core and the
    slimmed nested takeover; drop the rest.
    """
    if not isinstance(value, dict):
        return deepcopy(value)
    projected = _pick(
        value,
        (
            "status",
            "idempotent",
            "asset_root_id",
            "source_file_sha256",
            "start_location",
            "opening_pdf_indices",
            "projection_watch",
            "background_takeover",
        ),
    )
    source_work = value.get("source_work")
    if isinstance(source_work, dict):
        projected_source = _pick(
            source_work,
            (
                "status",
                "idempotent",
                "asset_root_id",
                "start_location_id",
                "request_purpose",
                "source_scope_signature",
                "job_id",
                "dedupe_state",
                "worker_kick",
                "host_request_id",
                "stub_created",
                "background_takeover",
            ),
        )
        host_work = source_work.get("host_work")
        if isinstance(host_work, dict):
            projected_source["host_work"] = _project_source_work_lifecycle(
                host_work,
            )
            projected_source["host_work"].pop("background_takeover", None)
        takeover = projected_source.get("background_takeover")
        if isinstance(takeover, dict):
            projected_source["background_takeover"] = _slim_background_takeover(
                takeover,
            )
        projected["source_work"] = projected_source
    if isinstance(projected.get("background_takeover"), dict):
        projected["background_takeover"] = _slim_background_takeover(
            projected["background_takeover"]
        )
    return projected


def _compact_narrative_opportunity(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    projected = _pick(
        value,
        (
            "schema_version",
            "authority",
            "hard_gate",
            "advice_id",
            "candidate_ref",
            "candidate",
            "reason",
        ),
    )
    if projected.get("candidate_ref"):
        projected["adoption_operation"] = _operation_card(
            "turn.finalize",
            prefilled={
                "advisory_uptake": {
                    "advice_id": projected.get("advice_id"),
                    "candidate_ref": projected.get("candidate_ref"),
                }
            },
            missing=[
                "draft",
                "coverage",
                "decision_id",
                "advisory_uptake.disposition",
                "advisory_uptake.reason",
                "advisory_uptake.adopted_fields",
                "advisory_uptake.exact_excerpt",
            ],
        )
    return projected


def _compact_public_check(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    return _pick(
        value,
        (
            "roll_id",
            "kind",
            "skill",
            "display_skill",
            "characteristic",
            "goal",
            "roll",
            "base_target",
            "required_level",
            "required_target",
            "achieved_level",
            "passed",
            "success",
            "surplus_levels",
            "outcome",
            "pushed",
            "visibility",
            "original_roll",
            "luck_spent",
            "adjusted_roll",
        ),
    )


# Closed canonical pending-draft receipt schema mirrored for the wire's
# fail-closed secrecy gate: exactly the producer field set and types, with
# digest recomputation over the payload minus the digest field (the same
# canonical stable-JSON convention as the kernel and Pi hydration).
_PENDING_DRAFT_RECEIPT_FIELDS = frozenset({
    "schema_version", "kind", "secrecy", "campaign_id", "receipt_id",
    "review_decision_id", "review_id", "turn_id", "source_digest",
    "revision", "draft_sha256", "draft_text", "draft_utf8_bytes",
    "review_digest", "request_digest", "producer_kind", "source_operation",
    "materialization_decision_id", "provenance", "receipt_digest",
})
_PENDING_DRAFT_RECEIPT_MAX_UTF8_BYTES = 8192
_PENDING_DRAFT_RECEIPT_SUBMISSION_PROVENANCE = frozenset({"kind"})
_PENDING_DRAFT_RECEIPT_RECOVERY_PROVENANCE = frozenset({
    "kind", "source_path", "source_row_count", "primary_row_digest",
    "corroboration_digest",
})
_PENDING_DRAFT_RECEIPT_MAX_PROVENANCE_ROWS = 8
# The exact subset of canonical statuses that may keep the card chain.
_PENDING_DRAFT_CARD_STATUSES = frozenset({
    "not_applicable", "not_submitted", "available",
})
# Closed actionable status object: exactly these fields, canonical schema
# and secrecy, explicit actionable true, and an allowed actionable status.
# The canonical producer emits a "diagnostic" only on non-actionable
# statuses, so an actionable status carrying one is not canonical.
_PENDING_DRAFT_STATUS_ACTIONABLE_FIELDS = frozenset({
    "schema_version", "secrecy", "status", "actionable",
})
_PENDING_DRAFT_STATUS_MAX_TEXT_UTF8_BYTES = 128
_PENDING_DRAFT_STATUS_MAX_DIAGNOSTIC_UTF8_BYTES = 512


def _valid_actionable_draft_status(status: Any) -> bool:
    """Exact closed canonical actionable pending-draft status validity.
    Deciding retention from only ``actionable`` + a status string is not
    sufficient: schema, secrecy, closed keys, and the status value must all
    match the canonical producer shape, and schema_version must be exactly
    the integer 1 — Python equality accepts ``True`` and ``1.0``, so the
    strict ``int`` type is required before the value comparison."""
    schema_version = (
        status.get("schema_version") if isinstance(status, dict) else None
    )
    return (
        isinstance(status, dict)
        and set(status) == _PENDING_DRAFT_STATUS_ACTIONABLE_FIELDS
        and type(schema_version) is int
        and schema_version == 1
        and status.get("secrecy") == "keeper_only"
        and status.get("actionable") is True
        and status.get("status") in _PENDING_DRAFT_CARD_STATUSES
    )


def _bounded_draft_status(status: Any) -> dict[str, Any] | None:
    """Bounded canonical status projection: known fields only, bounded
    strings; arbitrary extra or oversize status payload never rides the
    wire. A non-dict status projects as nothing."""
    if not isinstance(status, dict):
        return None
    bounded: dict[str, Any] = {}
    schema_version = status.get("schema_version")
    if isinstance(schema_version, int) and not isinstance(schema_version, bool):
        bounded["schema_version"] = schema_version
    actionable = status.get("actionable")
    if isinstance(actionable, bool):
        bounded["actionable"] = actionable
    for key in ("secrecy", "status"):
        entry = status.get(key)
        if (
            isinstance(entry, str)
            and 0
            < len(entry.encode("utf-8"))
            <= _PENDING_DRAFT_STATUS_MAX_TEXT_UTF8_BYTES
        ):
            bounded[key] = entry
    diagnostic = status.get("diagnostic")
    if (
        isinstance(diagnostic, str)
        and 0
        < len(diagnostic.encode("utf-8"))
        <= _PENDING_DRAFT_STATUS_MAX_DIAGNOSTIC_UTF8_BYTES
    ):
        bounded["diagnostic"] = diagnostic
    return bounded


def _wire_sha256_digest(value: Any) -> bool:
    return (
        isinstance(value, str)
        and value.startswith("sha256:")
        and len(value) == 71
        and all(char in "0123456789abcdef" for char in value[7:])
    )


def _wire_canonical_digest(payload: Any) -> str:
    encoded = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    ).encode("utf-8")
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


def _valid_wire_frozen_draft_receipt(receipt: Any) -> bool:
    """Full closed receipt validity for the wire secrecy gate, mirroring the
    canonical kernel/Pi schema: exact field set, strict non-empty string
    identities, strict scalar integer types (schema_version, revision,
    draft_utf8_bytes, provenance source_row_count must be exactly ``int``;
    ``bool`` and numerically equal ``float`` never pass), digest formats,
    revision bounds, receipt_id derivation, producer-specific
    materialization identity, bounded closed provenance, exact draft bytes
    bound, and a recomputed receipt_digest."""
    if not isinstance(receipt, dict) or set(receipt) != _PENDING_DRAFT_RECEIPT_FIELDS:
        return False
    identity_fields = (
        "campaign_id", "receipt_id", "review_decision_id", "review_id",
        "turn_id", "source_digest", "materialization_decision_id",
    )
    if any(
        not isinstance(receipt.get(field), str) or not receipt[field].strip()
        for field in identity_fields
    ):
        return False
    revision = receipt.get("revision")
    schema_version = receipt.get("schema_version")
    if (
        type(schema_version) is not int
        or schema_version != 1
        or receipt.get("kind") != "pending_narration_draft"
        or receipt.get("secrecy") != "keeper_only"
        or type(revision) is not int
        or not 1 <= revision <= 2
        or receipt.get("source_operation") != "narration.review"
        or receipt.get("producer_kind") not in (
            "narration_review_submission", "toolbox_audit_recovery",
        )
        or receipt["receipt_id"] != (
            f"pending-narration-draft:{receipt['review_decision_id']}"
            f":revision-{revision}"
        )
    ):
        return False
    if receipt["producer_kind"] == "narration_review_submission":
        if receipt["materialization_decision_id"] != receipt["review_decision_id"]:
            return False
    elif receipt["materialization_decision_id"] == receipt["review_decision_id"]:
        return False
    provenance = receipt.get("provenance")
    if not isinstance(provenance, dict):
        return False
    if receipt["producer_kind"] == "narration_review_submission":
        if set(provenance) != _PENDING_DRAFT_RECEIPT_SUBMISSION_PROVENANCE:
            return False
        if provenance.get("kind") != "direct_review_submission":
            return False
    else:
        if set(provenance) != _PENDING_DRAFT_RECEIPT_RECOVERY_PROVENANCE:
            return False
        row_count = provenance.get("source_row_count")
        if (
            provenance.get("kind") != "verified_toolbox_audit_recovery"
            or provenance.get("source_path") != "logs/toolbox-calls.jsonl"
            or type(row_count) is not int
            or not 1 <= row_count <= _PENDING_DRAFT_RECEIPT_MAX_PROVENANCE_ROWS
            or not _wire_sha256_digest(provenance.get("primary_row_digest"))
            or not _wire_sha256_digest(provenance.get("corroboration_digest"))
        ):
            return False
    draft_text = receipt.get("draft_text")
    if (
        not isinstance(draft_text, str)
        or not draft_text
        # NUL parity with the canonical Python validator: a NUL-bearing
        # draft is invalid even when its digests recompute.
        or "\x00" in draft_text
        or not _wire_sha256_digest(receipt.get("draft_sha256"))
        or not _wire_sha256_digest(receipt.get("review_digest"))
        or not _wire_sha256_digest(receipt.get("request_digest"))
        or not _wire_sha256_digest(receipt.get("receipt_digest"))
    ):
        return False
    try:
        encoded = draft_text.encode("utf-8", errors="strict")
    except UnicodeEncodeError:
        return False
    draft_utf8_bytes = receipt.get("draft_utf8_bytes")
    if (
        not 0 < len(encoded) <= _PENDING_DRAFT_RECEIPT_MAX_UTF8_BYTES
        # An equal float (or ``True``) must not satisfy the byte count:
        # require the exact ``int`` type before the value comparison.
        or type(draft_utf8_bytes) is not int
        or draft_utf8_bytes != len(encoded)
        or receipt["draft_sha256"] != _wire_canonical_digest(draft_text)
    ):
        return False
    digest_payload = {
        key: entry for key, entry in receipt.items() if key != "receipt_digest"
    }
    return receipt["receipt_digest"] == _wire_canonical_digest(digest_payload)


def _compact_output_context(value: Any, *, tight: bool = False) -> Any:
    if not isinstance(value, dict):
        return deepcopy(value)
    bundle = value.get("mechanics_bundle")
    mechanics_summary: dict[str, Any] | None = None
    if isinstance(bundle, dict):
        mechanics_summary = {
            "journal_decision_id": bundle.get("journal_decision_id"),
            "public_check": [
                _compact_public_check(row)
                for row in bundle.get("public_check") or []
                if isinstance(row, dict)
            ],
            "state_delta": deepcopy(bundle.get("state_delta") or []),
            "exceptional_effect": deepcopy(
                bundle.get("exceptional_effect") or []
            ),
            "concealed_consequence": deepcopy(
                bundle.get("concealed_consequence") or []
            ),
        }
    projected = _pick(
        value,
        (
            "schema_version",
            "turn_id",
            "manifest_revision",
            "journal_decision_id",
            "journal_context",
            "turn_number",
            "source_digest",
            "source_roll_ids",
            "obligations",
            "required_obligation_ids",
            "mechanics_bundle_sha256",
            "settlement_snapshot_id",
            "contract_projection_sha256",
            "contract_projection",
            "frozen_narration_draft",
            "accepted_review_evidence",
            "pending_narration_draft_status",
            "npc_performance_constraints",
            "candidate_factors",
            "missing_substantive_effects",
            "pending_modifier_consumptions",
            "composition_mode",
            "placement_segment_types",
        ),
    )
    projected["mechanics_summary"] = mechanics_summary
    projected["narrative_opportunity"] = _compact_narrative_opportunity(
        value.get("narrative_opportunity")
    )
    projected["full_projection_operation"] = _operation_card(
        "turn.output_context"
    )
    required_obligation_ids = [
        str(obligation_id)
        for obligation_id in value.get("required_obligation_ids") or []
        if isinstance(obligation_id, str) and obligation_id
    ]
    journal_decision_id = value.get("journal_decision_id")
    contract_projection = value.get("contract_projection")
    agency_review_required = (
        isinstance(contract_projection, dict)
        and contract_projection.get("agency_review_required") is True
    )
    # This projection is built field by field, so anything the operation adds
    # and nobody registers here never reaches the model. Three timing signals
    # were written, tested, and delivered into a payload that dropped them --
    # the same whitelist gap this repository has hit before.
    if "banter_signals" in value:
        projected["banter_signals"] = deepcopy(value.get("banter_signals"))
    agency_review_operation = value.get("agency_review_operation")
    if "agency_review_operation" in value:
        projected["agency_review_operation"] = deepcopy(agency_review_operation)
    source_finalize_operation = value.get("finalize_operation")
    source_finalize_invoke_via = (
        source_finalize_operation.get("invoke_via")
        if isinstance(source_finalize_operation, dict) else None
    )
    source_finalize_prefilled = (
        source_finalize_operation.get("prefilled_arguments")
        if isinstance(source_finalize_operation, dict) else None
    )
    source_finalize_revision = (
        source_finalize_prefilled.get("revision")
        if isinstance(source_finalize_prefilled, dict) else None
    )
    finalize_revision = (
        source_finalize_revision
        if isinstance(source_finalize_operation, dict)
        and source_finalize_operation.get("operation") == "turn.finalize"
        and isinstance(source_finalize_revision, int)
        and not isinstance(source_finalize_revision, bool)
        and source_finalize_revision > 0
        else None
    )
    prefilled: dict[str, Any] = {}
    if isinstance(journal_decision_id, str) and journal_decision_id:
        prefilled["decision_id"] = f"{journal_decision_id}:finalize"
    if finalize_revision is not None:
        prefilled["revision"] = finalize_revision
    missing = ["draft"]
    if required_obligation_ids:
        missing.append("coverage")
    else:
        prefilled["coverage"] = []
    if agency_review_required:
        missing.extend(["narration_review_id", "agency_claims"])
    finalize_operation = _operation_card(
        "turn.finalize",
        prefilled=prefilled,
        missing=missing,
    )
    if (
        agency_review_required
        or source_finalize_invoke_via == "coc_turn_finalize"
    ):
        finalize_operation["invoke_via"] = "coc_turn_finalize"
    finalize_operation["argument_contract"] = {
        "required_arguments": [
            "draft", "coverage", "decision_id", "revision",
            *(
                ["narration_review_id", "agency_claims"]
                if agency_review_required else []
            ),
        ],
        "allowed_arguments": list(FINALIZE_ARGUMENTS),
        "forbidden_aliases": ["draft_text", "journal_decision_id"],
        "instruction": (
            "Merge prefilled_arguments unchanged, add only missing_arguments, "
            "and invoke directly without coc_discover. When authority review is "
            "required, call agency_review_operation on the exact draft first, "
            "including its closed state_authority_review; agency ownership and "
            "player-state receipt binding are the only hard review scopes."
        ),
    }
    if required_obligation_ids:
        finalize_operation["coverage_contract"] = {
            "obligation_ids": required_obligation_ids,
            "required_fields": list(FINALIZE_COVERAGE_FIELDS),
            "realization_values": list(FINALIZE_REALIZATION_VALUES),
            "player_input_handling_values": list(
                FINALIZE_PLAYER_INPUT_HANDLING_VALUES
            ),
            "instruction": (
                "Keeper supplies one semantic row per obligation; no value is "
                "prefilled or inferred by the transport."
            ),
        }
    projected["finalize_operation"] = finalize_operation
    # Keeper-only frozen draft secrecy gate, fail closed: the exact draft
    # AND the actionable card chain survive ONLY when the canonical status
    # object is the exact closed actionable shape (schema 1, keeper-only,
    # explicit actionable true, closed four-field set, allowed actionable
    # status) and — for a draft-bearing context — the receipt is fully
    # valid within the deterministic UTF-8 bound. A missing "actionable", a
    # false value, a missing/wrong status, a wrong schema/secrecy, extra
    # status fields, a missing "available" receipt, or a malformed/
    # NUL-bearing/oversize draft or receipt keeps at most the bounded
    # diagnostic status — never the draft text, and no actionable cards.
    # The existing transport budget gate above remains the envelope-level
    # fail closed path for an oversize combined projection.
    draft_status_value = value.get("pending_narration_draft_status")
    actionable_status = _valid_actionable_draft_status(draft_status_value)
    status_name = (
        draft_status_value.get("status")
        if isinstance(draft_status_value, dict)
        and isinstance(draft_status_value.get("status"), str)
        else None
    )
    has_source_draft = "frozen_narration_draft" in value
    draft_kept = False
    if "frozen_narration_draft" in projected:
        frozen = projected.get("frozen_narration_draft")
        if (
            actionable_status
            and status_name == "available"
            and isinstance(frozen, dict)
            and _valid_wire_frozen_draft_receipt(frozen)
        ):
            draft_kept = True
        else:
            projected.pop("frozen_narration_draft", None)
    cards_survive = (
        actionable_status
        # A context that carries a frozen draft keeps its cards only when
        # the exact valid actionable receipt survived with it.
        and (not has_source_draft or draft_kept)
        # The "available" status promises an exact draft; without one the
        # status itself is wrong, not merely draftless.
        and not (status_name == "available" and not has_source_draft)
    )
    if not draft_kept:
        projected.pop("accepted_review_evidence", None)
    if not cards_survive:
        projected.pop("agency_review_operation", None)
        projected.pop("finalize_operation", None)
    # The status object itself is projected bounded: canonical fields only,
    # bounded strings, never an arbitrary extra or oversize payload.
    if "pending_narration_draft_status" in projected:
        bounded_status = _bounded_draft_status(draft_status_value)
        if bounded_status is None:
            projected.pop("pending_narration_draft_status", None)
        else:
            projected["pending_narration_draft_status"] = bounded_status
    if tight:
        projected.pop("candidate_factors", None)
    return projected


_OUTPUT_CONTEXT_TIGHT_DROP = (
    "obligations",
    "source_roll_ids",
    "npc_performance_constraints",
    "candidate_factors",
    "missing_substantive_effects",
    "pending_modifier_consumptions",
    "composition_mode",
    "placement_segment_types",
    "mechanics_summary",
    "narrative_opportunity",
    "full_projection_operation",
    "manifest_revision",
)


def _project_output_context_review_card(value: Any) -> Any:
    """Keep the exact Pi continuation cards when compact output is oversized.

    The explicit ``agency_review_required`` boolean selects either the review
    plus finalize chain or the direct finalize chain. Keep that mode, the
    applicable operation cards, bounded agency authority, and turn/source
    identity without inventing fields or copying drafting bulk and secrets.
    """
    if not isinstance(value, dict):
        return deepcopy(value)
    projected = _compact_output_context(value, tight=True)
    for key in _OUTPUT_CONTEXT_TIGHT_DROP:
        projected.pop(key, None)
    contract = value.get("contract_projection")
    if isinstance(contract, dict):
        slim_contract: dict[str, Any] = {}
        authority = contract.get("agency_authority")
        if isinstance(authority, dict):
            slim_contract["agency_authority"] = deepcopy(authority)
        agency_review_required = contract.get("agency_review_required")
        if isinstance(agency_review_required, bool):
            slim_contract["agency_review_required"] = agency_review_required
        projected["contract_projection"] = slim_contract
    else:
        projected.pop("contract_projection", None)
    finalize = projected.get("finalize_operation")
    if isinstance(finalize, dict):
        argument_contract = finalize.get("argument_contract")
        if isinstance(argument_contract, dict):
            argument_contract.pop("instruction", None)
        coverage_contract = finalize.get("coverage_contract")
        if isinstance(coverage_contract, dict):
            coverage_contract.pop("instruction", None)
    return projected


def _compact_current_turn(value: Any, *, tight: bool) -> Any:
    if not isinstance(value, dict) or not tight:
        return deepcopy(value)
    rows: list[dict[str, Any]] = []
    for row in value.get("rows") or []:
        if not isinstance(row, dict):
            continue
        compact = _pick(
            row,
            (
                "call_index",
                "tool",
                "ok",
                "args",
                "data_ref",
                "data_digest",
                "data_bytes",
                "row_ref",
                "row_digest",
            ),
        )
        data = row.get("data")
        if isinstance(data, dict):
            compact["receipt_summary"] = _pick(
                data,
                (
                    "decision_id",
                    "roll_id",
                    "outcome",
                    "success",
                    "passed",
                    "route_id",
                    "clue_id",
                    "effect_id",
                    "finalization_id",
                ),
            )
        rows.append(compact)
    projected = {
        **_pick(
            value,
            (
                "schema_version",
                "source_start_offset",
                "source_start_index",
                "observed_end_offset",
                "source_row_count",
                "meaningful_row_count",
                "operational_row_count",
                "projected_row_count",
                "omitted_row_count",
                "reference_only_row_count",
                "overflow",
                "source_digest",
            ),
        ),
        "rows": rows,
    }
    if rows:
        projected["detail_operation"] = _operation_card(
            "session.continuation_detail",
            prefilled={"section": "current_turn"},
        )
    return projected


def _compact_delivery(value: Any, *, tight: bool) -> Any:
    if not isinstance(value, dict):
        return deepcopy(value)
    projected = deepcopy(value)
    exact_text = projected.get("exact_text")
    if tight and isinstance(exact_text, str):
        projected["exact_text_bytes"] = len(exact_text.encode("utf-8"))
        projected["exact_text"] = None
        projected["replay_operation"] = _operation_card(
            "session.delivery_text",
            # Semantic replay card only: the host binds the latest canonical
            # delivery identity; the model never copies ids or hashes.
            prefilled={"mode": "replay"},
        )
    return projected


def _project_resume(data: Any, *, tight: bool) -> Any:
    if not isinstance(data, dict):
        return deepcopy(data)
    checkpoint = data.get("checkpoint")
    play_language = None
    if isinstance(checkpoint, dict):
        canonical_projection = checkpoint.get("canonical_projection")
        if isinstance(canonical_projection, dict):
            campaign_projection = canonical_projection.get("campaign")
            if isinstance(campaign_projection, dict):
                candidate = campaign_projection.get("play_language")
                if isinstance(candidate, str) and candidate.strip():
                    play_language = candidate.strip()
    projected = {
        **_pick(
            data,
            (
                "schema_version",
                "campaign_id",
                "mode",
                "reuse_existing_working_set",
                "working_set",
                "pending_turn",
                "host_input",
                "host_context",
                "operation_opportunities",
                "compiled_archive_recovery",
                "next_operations",
                # Opening-lifecycle discriminator: a resume that still owes
                # character creation carries this player-safe projection, and
                # the Pi extension keeps the setup tool surface only when it
                # survives the wire.  Dropping it deadlocks guided chargen.
                "character_creation",
                "opening_gate",
                # A durable state.end_session receipt outranks stale pending
                # turn recovery. The Pi host needs this exact player-safe
                # projection to release one terminal output after restart.
                "ending_output",
                "open_turn_anchor",
            ),
        ),
        "delivery": _compact_delivery(data.get("delivery"), tight=tight),
        "checkpoint": _compact_checkpoint(data.get("checkpoint"), tight=tight),
        "semantic_capsule": _compact_capsule(
            data.get("semantic_capsule"), tight=tight
        ),
        "current_turn": _compact_current_turn(
            data.get("current_turn"), tight=tight
        ),
        "pending_output_context": _compact_output_context(
            data.get("pending_output_context"), tight=tight
        ),
        "scene_context": _compact_scene(
            data.get("scene_context"),
            tight=tight,
            play_language=play_language,
        ),
    }
    if play_language is not None:
        projected["play_language"] = play_language
    if tight and isinstance(projected.get("current_turn"), dict):
        compact_turn = projected["current_turn"]
        if (
            compact_turn.get("meaningful_row_count") == 0
            and not compact_turn.get("rows")
        ):
            # ``mode=awaiting_player`` already proves there is no recoverable
            # open turn.  Keep the empty audit counts canonical, but do not
            # spend every future resume packet repeating them.
            projected.pop("current_turn", None)
    ordinary_turn_operations = _ordinary_turn_operations(data.get("mode"))
    if ordinary_turn_operations:
        projected["ordinary_turn_operations"] = ordinary_turn_operations
    acknowledged = (
        (data.get("host_context") or {}).get("acknowledged")
        if isinstance(data.get("host_context"), dict)
        else None
    )
    if not tight:
        # The full projection supplies this once so ``wire.control`` can bind
        # the lifecycle header.  Tight data omits the duplicate manifest: its
        # checkpoint and working-set identities are already present elsewhere.
        projected["working_set_manifest"] = {
            "context_epoch": (
                acknowledged.get("context_epoch")
                if isinstance(acknowledged, dict)
                else None
            ),
            "acknowledged": bool(
                isinstance(acknowledged, dict)
                and acknowledged.get("requires_resume") is False
            ),
            "checkpoint_id": (
                projected.get("checkpoint") or {}
            ).get("checkpoint_id"),
            "working_set_revision": (
                data.get("working_set") or {}
            ).get("revision"),
        }
    if tight and isinstance(projected.get("host_input"), dict):
        host_input = projected["host_input"]
        text = host_input.get("text")
        if isinstance(text, str):
            host_input["text_sha256"] = host_input.get(
                "text_sha256"
            ) or canonical_digest(text)
            host_input["char_count"] = host_input.get("char_count", len(text))
            host_input["text"] = None
            host_input["instruction"] = (
                "The exact host prompt remains in the current model turn; this "
                "projection preserves only its transport identity."
            )
    if tight and isinstance(projected.get("host_context"), dict):
        projected["host_context"] = {
            "acknowledged": deepcopy(
                projected["host_context"].get("acknowledged")
            )
        }
    return projected


def _project_scene_recovery_index(scene: Any) -> dict[str, Any] | None:
    """Reduce one tight scene to the shared bounded typed index."""
    if not isinstance(scene, dict):
        return None
    npcs = scene.get("npcs_present") or []
    routes = scene.get("action_routes") or []
    clues = scene.get("clues_here") or []
    exits = scene.get("exits") or []
    scene_identity = _pick(
        scene.get("scene"),
        ("scene_id", "scene_type"),
    )
    if not scene_identity.get("scene_id") and scene.get("active_scene_id"):
        scene_identity["scene_id"] = deepcopy(scene["active_scene_id"])
    scene_index = {
        "schema_version": 1,
        "kind": "typed_scene_recovery_index",
        **_pick(
            scene,
            (
                "campaign_id",
                "active_scene_id",
                "party",
                "time",
                "tension_level",
                "turn_number",
                "exit_ready",
                "progressive",
                # A collapsed Keeper still has to run the scene, so the small
                # decision-critical blocks ride along instead of being traded
                # for an index of things it can look up. Both are bounded: the
                # clocks this scene's own moves name, and the module's loop
                # declaration. The collapsed envelope sits around 7 KB against
                # a 16 KB cap, and losing these is what made a doom clock and a
                # declared time loop invisible at a table whose whole remaining
                # path ran through them.
                "threat_clocks",
                "worldline_loop",
                # Authored SAN triggers the Keeper still owes a
                # rules.sanity_check. Pending authoritative work, not a lookup.
                "pending_san_triggers",
            ),
        ),
        "scene_identity": scene_identity,
        "npc_index": [
            _pick(
                row,
                (
                    "npc_id",
                    "name",
                    "relationship_to_investigators",
                    "identity_ref",
                    "profile_revision_ref",
                ),
            )
            for row in npcs[:16]
            if isinstance(row, dict)
        ],
        "route_index": [
            _pick(
                row,
                (
                    "route_id",
                    "route_type",
                    "resolution_kind",
                    "grants_clue_ids",
                ),
            )
            for row in routes[:16]
            if isinstance(row, dict)
        ],
        "clue_index": [
            _pick(
                row,
                (
                    "clue_id",
                    "discovered",
                    "delivery_kind",
                    "skill",
                    "difficulty",
                ),
            )
            for row in clues[:24]
            if isinstance(row, dict)
        ],
        "exit_index": [
            _pick(row, ("to", "kind", "open", "travel_minutes"))
            for row in exits[:24]
            if isinstance(row, dict)
        ],
        "counts": {
            "npcs_present": len(npcs),
            "action_routes": len(routes),
            "clues_here": len(clues),
            "exits": len(exits),
        },
        "full_projection_operation": _operation_card("scene.context"),
    }
    # ``scene`` is the internal tight projection produced by ``_compact_scene``;
    # source material was already validated, packed, and digested exactly once.
    source_material = scene.get("source_material")
    if isinstance(source_material, dict):
        scene_index["source_material"] = deepcopy(source_material)
    rule_decision_cards = scene.get("rule_decision_cards")
    if isinstance(rule_decision_cards, dict):
        # This is the one actionable RuleGraph surface. Keep it ahead of the
        # identity-only fallback; recovery.healing is the same canonical card
        # set and is deliberately not duplicated on the bounded wire.
        scene_index["rule_decision_cards"] = deepcopy(rule_decision_cards)
    if isinstance(scene.get("exit_operation_template"), dict):
        scene_index["exit_operation_template"] = deepcopy(
            scene["exit_operation_template"]
        )
    return scene_index


def _project_resume_recovery_index(data: Any) -> Any:
    """Return a bounded typed index when even the tight working set is large."""
    base = _project_resume(data, tight=True)
    if not isinstance(base, dict):
        return base

    scene_index = _project_scene_recovery_index(base.get("scene_context"))

    capsule = base.get("semantic_capsule")
    capsule_index: dict[str, Any] | None = None
    if isinstance(capsule, dict):
        capsule_index = {
            **_pick(
                capsule,
                (
                    "schema_version",
                    "kind",
                    "updated_from_turn",
                    "full_capsule_sha256",
                    "full_counts",
                    "omitted_counts",
                ),
            ),
            "available_sections": [
                "recent_summaries",
                "threads",
                "confirmed_decisions",
                "do_not_repeat",
                "style_commitments",
                "current_turn",
            ],
            "detail_operation": _operation_card(
                "session.continuation_detail", missing=["section"]
            ),
        }

    current = base.get("current_turn")
    current_index: dict[str, Any] | None = None
    if isinstance(current, dict):
        rows = current.get("rows") or []
        selected_rows = rows if len(rows) <= 8 else rows[:4] + rows[-4:]
        current_index = {
            **_pick(
                current,
                (
                    "schema_version",
                    "source_start_index",
                    "source_row_count",
                    "meaningful_row_count",
                    "operational_row_count",
                    "omitted_row_count",
                    "reference_only_row_count",
                    "overflow",
                    "source_digest",
                ),
            ),
            "rows": [
                _pick(
                    row,
                    (
                        "call_index",
                        "tool",
                        "ok",
                        "data_ref",
                        "data_digest",
                        "data_bytes",
                        "row_ref",
                        "row_digest",
                        "receipt_summary",
                    ),
                )
                for row in selected_rows
                if isinstance(row, dict)
            ],
        }
        if rows:
            current_index["detail_operation"] = _operation_card(
                "session.continuation_detail",
                prefilled={"section": "current_turn"},
            )

    pending_output = base.get("pending_output_context")
    pending_index = None
    if isinstance(pending_output, dict):
        pending_index = {
            **_pick(
                pending_output,
                (
                    "schema_version",
                    "turn_id",
                    "journal_decision_id",
                    "turn_number",
                    "source_digest",
                    "required_obligation_ids",
                    "missing_substantive_effects",
                    "pending_modifier_consumptions",
                ),
            ),
            "full_projection_operation": _operation_card(
                "turn.output_context"
            ),
        }

    opportunities = []
    for row in base.get("operation_opportunities") or []:
        if isinstance(row, dict) and len(opportunities) < 8:
            opportunities.append(
                _pick(
                    row,
                    (
                        "schema_version",
                        "kind",
                        "authority",
                        "hard_gate",
                        "reason_code",
                        "source",
                        "suggested_operation",
                        "attempt_pressure",
                        "retry_status",
                    ),
                )
            )

    return {
        **_pick(
            base,
            (
                "schema_version",
                "campaign_id",
                "mode",
                "working_set",
                "pending_turn",
                "host_context",
                "next_operations",
                "compiled_archive_recovery",
                "working_set_manifest",
                "ending_output",
                "open_turn_anchor",
            ),
        ),
        "delivery": deepcopy(base.get("delivery")),
        "checkpoint": deepcopy(base.get("checkpoint")),
        "semantic_capsule": capsule_index,
        "current_turn": current_index,
        "pending_output_context": pending_index,
        "scene_context": scene_index,
        "operation_opportunities": opportunities,
        "ordinary_turn_operations": deepcopy(
            base.get("ordinary_turn_operations") or {}
        ),
        "recovery_index": {
            "schema_version": 1,
            "kind": "typed_progressive_recovery_index",
            "instruction": (
                "Use only the returned exact scene/detail cards needed for the "
                "current decision; never read campaign files or rediscover tools."
            ),
        },
    }


def _project_actions(data: Any) -> Any:
    if not isinstance(data, dict):
        return deepcopy(data)
    selected = isinstance(data.get("intent_evidence"), dict)
    projected = _pick(
        data,
        (
            "schema_version",
            "authority",
            "hard_gate",
            "scene_id",
            "investigator_id",
            "authored_roll_gate_count",
            "intent_evidence",
            "resolution_advice",
        ),
    )
    if not selected:
        projected["rule_advice"] = deepcopy(data.get("rule_advice") or [])
        projected["action_routes"] = deepcopy(data.get("action_routes") or [])
    projected["operation_opportunities"] = deepcopy(
        data.get("operation_opportunities") or []
    )
    projected["narrative_opportunity"] = _compact_narrative_opportunity(
        data.get("narrative_opportunity")
    )
    return projected


def _project_combat_context(data: Any) -> Any:
    """Keep the exact pending defense while bounding the secret combat ledger."""
    if not isinstance(data, dict):
        return deepcopy(data)
    projected: dict[str, Any] = {
        "active": bool(data.get("active")),
        "pending_defense": deepcopy(data.get("pending_defense")),
    }
    wrapped = data.get("combat")
    state = wrapped.get("value") if isinstance(wrapped, dict) else None
    if isinstance(state, dict):
        projected["combat"] = {
            "secret": True,
            "value": _pick(
                state,
                (
                    "schema_version",
                    "combat_id",
                    "scene_ref",
                    "status",
                    "revision",
                    "current_round",
                    "initiative_cursor",
                    "current_initiative",
                ),
            ),
        }
    else:
        projected["combat"] = None
    return projected


def _project_combat_resolve(data: Any) -> Any:
    """Keep the settled beat and exact next combat decision under budget."""
    if not isinstance(data, dict):
        return deepcopy(data)
    combat = data.get("combat")
    projected_combat = None
    if isinstance(combat, dict):
        projected_combat = _pick(
            combat,
            (
                "schema_version",
                "combat_id",
                "scene_ref",
                "status",
                "outcome",
                "revision",
                "current_round",
                "initiative_cursor",
                "current_initiative",
            ),
        )
    return {
        "events": deepcopy(data.get("events") or []),
        "combat": projected_combat,
        "pending_defense": deepcopy(data.get("pending_defense")),
        "improvement_ticks_recorded": deepcopy(
            data.get("improvement_ticks_recorded") or []
        ),
        "player_state_receipt": deepcopy(data.get("player_state_receipt")),
    }


def _project_npc_reaction(data: Any) -> Any:
    """Inline the exact conditional engagement contract for lazy hosts."""
    projected = deepcopy(data)
    if not isinstance(projected, dict):
        return projected
    card = projected.get("record_engagement_operation")
    if isinstance(card, dict):
        card[INLINE_ARGUMENT_SCHEMA_MARKER] = True
    return projected


def _project_finalize(data: Any) -> Any:
    if not isinstance(data, dict):
        return deepcopy(data)
    return _pick(
        data,
        (
            "schema_version",
            "finalization_id",
            "decision_id",
            "journal_decision_id",
            "run_segment_id",
            "session_id",
            "turn_id",
            "turn_number",
            "source_digest",
            "settlement_snapshot_id",
            "accepted_revision",
            "accepted_draft_sha256",
            "rendered_text_sha256",
            "contract_projection_sha256",
            "rendered_text",
            "integrity_digest",
            "created_at",
        ),
    )


def _decorate_cards(
    value: Any,
    *,
    contract_digest: str,
    argument_schemas: dict[str, dict[str, Any]] | None = None,
) -> Any:
    if isinstance(value, list):
        return [
            _decorate_cards(
                row,
                contract_digest=contract_digest,
                argument_schemas=argument_schemas,
            )
            for row in value
        ]
    if not isinstance(value, dict):
        return value
    if (
        isinstance(value.get("contract_id"), str)
        and value["contract_id"] in LOCATOR_TASK_CONTRACT_IDS
    ):
        # Closed locator task envelopes are machine contracts, not KP-facing
        # cards: pass them through byte-for-byte so the Pi extension's
        # exactKeys validation sees exactly what the toolbox emitted.
        return deepcopy(value)
    if (
        isinstance(value.get("operation"), str)
        and value["operation"] == "setup.adopt_source_facts"
        and value.get("invoke_via") == "coc_invoke"
    ):
        # The sealed source-facts adoption card is a strict machine contract,
        # not a KP-facing advisory card: the Pi extension validates it with
        # exactKeys(card, [operation, invoke_via, campaign, arguments]) and
        # its arguments carry the sealed fast-facts payload verbatim. Pass it
        # through byte-for-byte like the locator envelopes above; wire
        # decoration would add contract_ref/discovery_required keys and break
        # that strict contract, so the adopt card could never be delivered
        # through any canonical path.
        return deepcopy(value)
    inline_argument_schema = value.get(INLINE_ARGUMENT_SCHEMA_MARKER) is True
    decorated = {
        key: _decorate_cards(
            item,
            contract_digest=contract_digest,
            argument_schemas=argument_schemas,
        )
        for key, item in value.items()
        if key != INLINE_ARGUMENT_SCHEMA_MARKER
    }
    operation = decorated.get("operation")
    # Decorate any card the model can actually act on. `invoke_via` used to be
    # the constant "coc_invoke" for every builder-produced card; it now names
    # the operation's real model-facing tool (a `coc_*` domain tool, the
    # compatibility wrapper, or the typed gateway) and is None for host-private
    # operations. A host-private card carries no contract_ref, no argument
    # schema and no discovery flag, because there is no call to prepare.
    invoke_via = decorated.get("invoke_via")
    if (
        isinstance(operation, str)
        and operation
        and isinstance(invoke_via, str)
        and invoke_via
    ):
        decorated.setdefault(
            "contract_ref",
            f"{operation}@{contract_digest.removeprefix('sha256:')[:16]}",
        )
        decorated.setdefault("discovery_required", False)
        if (
            inline_argument_schema
            and isinstance(argument_schemas, dict)
            and operation in argument_schemas
        ):
            decorated["arguments_schema"] = deepcopy(
                argument_schemas[operation]
            )
    return decorated


def _compact_messages(values: Any, *, limit: int) -> list[Any]:
    if not isinstance(values, list):
        return []
    return deepcopy(values[:limit])


def _minimal_identity(operation: str, data: Any) -> dict[str, Any]:
    identity_fields = (
        "schema_version",
        "campaign_id",
        "mode",
        "scene_id",
        "active_scene_id",
        "turn_id",
        "turn_number",
        "decision_id",
        "journal_decision_id",
        "roll_id",
        "finalization_id",
        "run_segment_id",
        "session_id",
        "accepted_revision",
        "settlement_snapshot_id",
        "rendered_text_sha256",
        "contract_projection_sha256",
        "rendered_sha256",
        "checkpoint_id",
        "source_digest",
        # A restarted host rebuilds its in-memory opening route state from
        # exactly this receipt field; dropping it in the identity collapse
        # defeats the recovery contract (mirrors the bind receipt).
        "opening_gate",
    )
    projected = {
        **_pick(data, identity_fields),
        "projection_sha256": canonical_digest(data),
        "replay_operation": _operation_card(operation),
    }
    if not isinstance(data, dict):
        return projected
    if operation in {
        "progressive.register_source_bundle",
        "progressive.status",
        "progressive.opening_bootstrap",
    }:
        # Host dispatch fields are operation-critical: losing them turns a
        # background job into invisible debt the KP cannot advance. Keep the
        # exact takeover and dependency waits even in the last-resort identity
        # projection. opening_bootstrap nests its production takeover under
        # source_work; preserve that path too so Pi can still auto-dispatch.
        if isinstance(data.get("background_takeover"), dict):
            projected["background_takeover"] = _slim_background_takeover(
                data["background_takeover"]
            )
        source_work = data.get("source_work")
        if isinstance(source_work, dict):
            projected_source = _pick(
                source_work,
                (
                    "status",
                    "job_id",
                    "worker_kick",
                    "host_request_id",
                    "background_takeover",
                ),
            )
            takeover = projected_source.get("background_takeover")
            if isinstance(takeover, dict):
                projected_source["background_takeover"] = (
                    _slim_background_takeover(takeover)
                )
            if projected_source:
                projected["source_work"] = projected_source
                if projected.get("status") is None and source_work.get("status") is not None:
                    projected["status"] = source_work.get("status")
        host_work = data.get("host_work")
        if isinstance(host_work, dict):
            waits = [
                row for row in host_work.get("current_dependency_waits") or []
                if isinstance(row, dict)
            ]
            if waits:
                projected["current_dependency_waits"] = [
                    _pick(
                        row,
                        (
                            "schema_version",
                            "contract_id",
                            "campaign_id",
                            "dependency_id",
                            "job_id",
                            "dependency_ref",
                            "operational_class",
                        ),
                    )
                    for row in waits
                ]
    return projected


def _claim_lease_bindings(data: Any) -> list[dict[str, Any]]:
    """Preserve enough exact ownership to release a projected-away claim."""
    if not isinstance(data, dict):
        return []
    bindings: list[dict[str, Any]] = []
    for task in data.get("dispatch_tasks") or []:
        if not isinstance(task, dict) or not isinstance(task.get("packet"), dict):
            continue
        packet = task["packet"]
        lease_id = str(packet.get("packet_id") or "").strip()
        job_ids = [
            str(request.get("job_id") or "").strip()
            for request in packet.get("requests") or []
            if isinstance(request, dict)
        ]
        if lease_id and job_ids and all(job_ids):
            bindings.append({"lease_id": lease_id, "job_ids": job_ids})
    return bindings


def _canonical_wire_result_contracts() -> dict[str, dict[str, Any]]:
    """Return exact host-local contracts safe to transmit by hash only."""
    document = json.loads(SOURCE_WORKER_CONTRACT_PATH.read_text(encoding="utf-8"))
    contract = document["packet"]["foreground_opening_slice"]["result_contract"]
    return {canonical_digest(contract): contract}


def _project_claim_dispatch(data: Any) -> dict[str, Any]:
    """Reference exact result contracts without losing leaf work.

    One coalesced source packet can contain several requests with the same
    closed result contract.  Keeping one packet-local registry entry plus
    explicit request references preserves the complete contract while avoiding
    a multi-kilobyte copy per request. A canonical singleton foreground contract
    travels by its allowlisted hash alone; the Pi runtime independently loads,
    rehashes, and inflates the bundled canonical contract before validating or
    spawning a leaf.
    """
    if not isinstance(data, dict):
        return {}
    projected = deepcopy(data)
    projected["lease_bindings"] = _claim_lease_bindings(data)
    canonical_contracts = _canonical_wire_result_contracts()
    for task in projected.get("dispatch_tasks") or []:
        if not isinstance(task, dict) or not isinstance(task.get("packet"), dict):
            continue
        packet = task["packet"]
        requests = packet.get("requests")
        if not isinstance(requests, list):
            continue
        contract_rows: dict[str, tuple[dict[str, Any], list[int]]] = {}
        for index, request in enumerate(requests):
            if not isinstance(request, dict) or not isinstance(
                request.get("result_contract"), dict
            ):
                continue
            contract = request["result_contract"]
            ref = canonical_digest(contract)
            current = contract_rows.setdefault(ref, (deepcopy(contract), []))
            current[1].append(index)
        referenced = {
            ref: row
            for ref, row in contract_rows.items()
            if len(row[1]) > 1 or ref in canonical_contracts
        }
        if not referenced:
            continue
        local_contracts = {
            ref: row[0]
            for ref, row in referenced.items()
            if ref not in canonical_contracts
        }
        if local_contracts:
            packet["wire_result_contracts"] = local_contracts
        for ref, (_contract, indices) in referenced.items():
            for index in indices:
                requests[index].pop("result_contract", None)
                requests[index]["result_contract_ref"] = ref
    return projected


_SPILLABLE_STRUCTURE_KEYS = ("classification_request", "extraction_request")
# A closed source-worker instruction is repeated on every leased leaf and is
# already persisted verbatim in that leaf's host-work job. Keep it inline for
# ordinary claims, then spill it only if structure projection still exceeds the
# hot envelope budget.
_SPILLABLE_REPEATED_REQUEST_KEYS = ("instruction",)


def _iter_claim_packets(projected: Any) -> Iterator[dict[str, Any]]:
    """Yield every source packet in a claim result, whichever shape it took.

    ``result_delivery="return_to_parent"`` — what the live source coordinator
    actually sends — leaves the leased packets in ``packets``. Only the
    host-spawn deliveries wrap them as ``dispatch_tasks[].packet``. A projector
    that walks just one of the two silently no-ops on the real path.
    """
    if not isinstance(projected, dict):
        return
    for packet in projected.get("packets") or []:
        if isinstance(packet, dict):
            yield packet
    for task in projected.get("dispatch_tasks") or []:
        if not isinstance(task, dict):
            continue
        packet = task.get("packet")
        if isinstance(packet, dict):
            yield packet


def _spill_request_fields(
    projected: Any,
    *,
    keys: tuple[str, ...],
) -> bool:
    """Replace selected durable request fields with exact host-work receipts."""
    spilled = False
    for packet in _iter_claim_packets(projected):
        root_id = packet.get("asset_root_id")
        if not isinstance(root_id, str) or not root_id:
            continue
        for request in packet.get("requests") or []:
            if not isinstance(request, dict):
                continue
            job_id = request.get("job_id")
            if not isinstance(job_id, str) or not job_id:
                continue
            for key in keys:
                value = request.get(key)
                if key == "instruction":
                    if not isinstance(value, str) or not value.strip():
                        continue
                elif not isinstance(value, dict) or not value:
                    continue
                if f"{key}_ref" in request:
                    continue
                request[f"{key}_ref"] = {
                    "host_work_path": (
                        f".coc/module-assets/{root_id}/host-work/{job_id}.json"
                    ),
                    "field": key,
                    "sha256": canonical_digest(value),
                }
                del request[key]
                spilled = True
    return spilled


def _spill_structure_requests(projected: Any) -> bool:
    """Move whole-book structure payloads out of the hot claim envelope.

    A ``classify_sections`` request carries the entire candidate list for the
    book — 42 rows and ~13 KiB for `dust-to-dust`, which on its own exceeds the
    claim budget and voids every lease in the batch, so the section lane can
    never start. Those exact bytes already sit in the host-work job file, so
    send a workspace-relative path plus a digest instead: the same shape
    ``cached_page_refs`` already uses. The Pi runtime inflates and re-verifies
    the digest before a leaf is spawned, so the worker contract is unchanged.

    Returns True when anything was spilled.
    """
    return _spill_request_fields(
        projected,
        keys=_SPILLABLE_STRUCTURE_KEYS,
    )


def _spill_repeated_request_fields(projected: Any) -> bool:
    """Spill repeated durable fields only after structure spill was insufficient."""
    return _spill_request_fields(
        projected,
        keys=_SPILLABLE_REPEATED_REQUEST_KEYS,
    )


def _claim_projection_failure(data: Any) -> dict[str, Any]:
    """Return a small fail-closed claim receipt with recoverable ownership."""
    projected = {
        **_pick(
            data,
            (
                "leased_group_count",
                "ready_group_count",
                "cached_only",
                "dispatch_task_count",
            ),
        ),
        "dispatch_tasks": [],
        "lease_bindings": _claim_lease_bindings(data),
        "wire_projection_failed": True,
    }
    return projected


_GUIDED_QUICK_FIRE_INPUT_MODE = "guided_quick_fire"
_KP_GUIDED_ERA_ADAPTIVE_INPUT_MODE = "kp_guided_era_adaptive"
_INVESTIGATOR_CONTRACT_BRANCH_DEF_KEYS = {
    _GUIDED_QUICK_FIRE_INPUT_MODE: (
        "quick_fire_sheet",
        "quick_fire_creation",
    ),
    _KP_GUIDED_ERA_ADAPTIVE_INPUT_MODE: (
        "kp_guided_era_adaptive_sheet",
        "kp_guided_era_adaptive_creation",
        "kp_guided_characteristics",
        "kp_guided_derived",
        "kp_guided_roll_receipt",
        "kp_guided_characteristic_roll_receipts",
        "kp_guided_occupation",
        "kp_guided_skill_provenance",
        "kp_guided_player_skill_row",
        "kp_guided_player_sheet",
    ),
}
def _investigator_contract_input_mode(result: dict[str, Any]) -> str | None:
    """Resolve the sole guided create route encoded on the contract result."""
    era_contract = result.get("guided_quick_fire_campaign_era")
    if not isinstance(era_contract, dict):
        return None
    if (
        era_contract.get("status") == "standard_quick_fire_available"
        and era_contract.get("supported") is True
    ):
        return _GUIDED_QUICK_FIRE_INPUT_MODE
    fallback = era_contract.get("fallback")
    if (
        era_contract.get("status") == "kp_guided_era_adaptive_available"
        and isinstance(fallback, dict)
        and fallback.get("status") == "available"
        and fallback.get("available") is True
        and fallback.get("route") == _KP_GUIDED_ERA_ADAPTIVE_INPUT_MODE
        and fallback.get("input_mode") == _KP_GUIDED_ERA_ADAPTIVE_INPUT_MODE
    ):
        return _KP_GUIDED_ERA_ADAPTIVE_INPUT_MODE
    return None


def _investigator_contract_branch_input_mode(
    branch: Any,
    definitions: dict[str, Any],
) -> str | None:
    if not isinstance(branch, dict):
        return None
    properties = branch.get("properties")
    if not isinstance(properties, dict):
        return None
    creation = properties.get("creation")
    if not isinstance(creation, dict):
        return None
    ref = creation.get("$ref")
    if not isinstance(ref, str) or not ref.startswith("#/$defs/"):
        return None
    definition = definitions.get(ref[len("#/$defs/"):])
    if not isinstance(definition, dict):
        return None
    definition_properties = definition.get("properties")
    if not isinstance(definition_properties, dict):
        return None
    mode = definition_properties.get("input_mode")
    if not isinstance(mode, dict):
        return None
    const = mode.get("const")
    return const if isinstance(const, str) and const else None


def _project_investigator_contract(data: Any) -> Any:
    """Keep the create payload schema core under the hot transport budget.

    The full investigator contract is archived via ``full_result_sha256``.
    Both Quick Fire and adaptive full envelopes can exceed 16 KiB; without a
    typed projector the host collapses to identity-only and the KP loses
    ``payload_schema``. Only this hot copy may drop unused opposite-branch
    defs, catalog rows the active route does not use, and schema
    description/examples/default prose already represented structurally.
    """
    if not isinstance(data, dict):
        return {}
    projected = deepcopy(data)
    result = projected.get("result")
    if not isinstance(result, dict):
        return projected
    input_mode = _investigator_contract_input_mode(result)
    schema = result.get("payload_schema")
    definitions = schema.get("$defs") if isinstance(schema, dict) else None
    branches = schema.get("oneOf") if isinstance(schema, dict) else None
    if (
        input_mode is None
        or not isinstance(schema, dict)
        or not isinstance(definitions, dict)
        or not isinstance(branches, list)
    ):
        return projected

    # Keep the applicable guided branch plus complete-sheet import. A preset
    # must never be coerced into an invented guided Luck roll merely because
    # the campaign era lacks the package's standard Quick Fire sheet.
    selected_modes = {input_mode, "import_complete_sheet"}
    selected = [
        deepcopy(branch)
        for branch in branches
        if _investigator_contract_branch_input_mode(branch, definitions)
        in selected_modes
    ]
    if len(selected) != len(selected_modes):
        return projected
    schema["oneOf"] = selected

    drop_keys: set[str] = set()
    for mode, keys in _INVESTIGATOR_CONTRACT_BRANCH_DEF_KEYS.items():
        if mode != input_mode:
            drop_keys.update(keys)
    for key in drop_keys:
        definitions.pop(key, None)

    # Quick Fire skill rows are the only actionable catalog. Adaptive create
    # uses base skills + provenance, so drop the unused 1920s row dump.
    if input_mode != _GUIDED_QUICK_FIRE_INPUT_MODE:
        catalog = result.get("guided_quick_fire_skill_catalog")
        if isinstance(catalog, dict):
            result["guided_quick_fire_skill_catalog"] = {
                key: deepcopy(value)
                for key, value in catalog.items()
                if key != "rows"
            }

    result["payload_schema"] = _without_schema_annotations(schema)
    return projected


# ``npc.query`` without an ``npc_id`` returns one complete dossier per authored
# NPC, so its size is the cast list times the authored depth of a person.  The
# product's own Keeper guidance is per-target ("call npc.query for the exact
# target"), and a single-target query measures 7,423 bytes against the 16 KiB
# budget; the live 9-NPC roster of `pi-coc-gate9-depth-20260901-03` measures
# 22,458 and used to collapse to an identity-only envelope, which is how the
# Keeper ended up with no cast at all.  So when a roster does not fit, keep
# every NPC present and demote the deep dossier material by tier, leaving one
# exact typed route back to any complete dossier.
NPC_QUERY_ROSTER_FIELDS = (
    "npc_id",
    "name",
    "origin",
    "identity_ref",
    "profile_revision_ref",
    "identity_contract",
    "relationship_to_investigators",
    "role_label",
    # The Pi host reads facts[].fact_id off every row to offer
    # ``npc_fact:<npc_id>/<fact_id>`` evidence refs, and the Keeper forms the
    # same ref by hand for rules.psychology_observe. Losing it here would
    # silently strip the evidence grammar rather than shrink a payload.
    "facts",
    "known_fact_ids",
    "revealable_fact_ids",
    "psych",
    # Only a single-target query carries this, and the Pi host arms
    # state.record_npc_engagement from it.
    "first_contact_readiness",
)
NPC_QUERY_INDEX_FIELDS = (
    "npc_id",
    "name",
    "origin",
    "identity_ref",
)


def _npc_query_relationship_started(row: dict[str, Any]) -> bool:
    """Whether this NPC already has investigator-facing relationship state.

    ``availability`` is excluded on purpose: the normalizer sets it for every
    NPC, so it says nothing about whether anyone has met this person.
    """
    psych = row.get("psych")
    if not isinstance(psych, dict):
        return False
    if isinstance(psych.get("impression"), dict):
        return True
    if any(psych.get(field) for field in ("trust", "fear", "suspicion")):
        return True
    return any(
        psych.get(field)
        for field in ("known_facts", "lies_told", "promises")
    )


def _npc_query_retention_rank(row: dict[str, Any]) -> tuple[int, int, int]:
    """Deterministic structural priority for keeping a dossier inline.

    Every term reads a structured field the producer already emits.  Nothing
    here inspects a name, a role label, or any other free prose.
    """
    contract = row.get("identity_contract")
    provenance = (
        contract.get("location_provenance") if isinstance(contract, dict) else None
    )
    in_scene = (
        isinstance(provenance, dict)
        and provenance.get("active_scene_matches_schedule") is True
    )
    return (
        0 if in_scene else 1,
        0 if _npc_query_relationship_started(row) else 1,
        0 if isinstance(row.get("first_contact_readiness"), dict) else 1,
    )


def _npc_query_row(row: Any, *, fields: tuple[str, ...]) -> Any:
    if not isinstance(row, dict):
        return deepcopy(row)
    projected = {
        key: deepcopy(row[key]) for key in fields if key in row
    }
    projected["dossier_required"] = True
    return projected


def _npc_query_tiered_rows(
    rows: list[Any],
    *,
    decorate: Callable[[Any], Any],
) -> tuple[list[Any], list[dict[str, Any]]]:
    """Project and decorate every row once per tier, in producer order.

    The ``roster`` tier keeps the working-set fields the host and the Keeper
    bind on; ``index`` is a bare name, reached only by a cast too large for
    even a bounded roster.  It does give up the per-row fact grammar, but
    naming that NPC still beats losing the cast.

    The fit search below runs over sizes, not over rebuilt payloads: a cast is
    unbounded, and re-serializing the whole result once per candidate made the
    projection quadratic in the number of NPCs.
    """
    tiers: list[dict[str, Any]] = []
    identities: list[Any] = []
    for row in rows:
        npc_id = row.get("npc_id") if isinstance(row, dict) else None
        identities.append(npc_id if isinstance(npc_id, str) else None)
        if not isinstance(npc_id, str):
            # A row without a stable id cannot be re-queried, so it is never
            # demoted and never carries a dossier card.
            projected = decorate(deepcopy(row))
            tiers.append({"full": projected, "roster": projected, "index": projected})
            continue
        tiers.append({
            "full": decorate(deepcopy(row)),
            "roster": decorate(_npc_query_row(row, fields=NPC_QUERY_ROSTER_FIELDS)),
            "index": decorate(_npc_query_row(row, fields=NPC_QUERY_INDEX_FIELDS)),
        })
    return identities, tiers


# Repair payloads a failure envelope may carry inline. `rule_decision_stale`
# embeds the whole refreshed card set (26 KB of the 27 KB envelope observed on
# 2026-09-02): the collapse below only ever shrank ``data``, so such a failure
# could never fit and fell through to the last-resort technical error — which
# then told the Keeper the canonical operation had SUCCEEDED and to replay it,
# losing the actual remedy. Bound the repair payload instead, keeping the
# pointers that make the error actionable.
_BULKY_ERROR_DETAIL_COLLECTIONS = ("refreshed_cards", "candidates", "cards")


def _bounded_error_details(details: Any) -> Any:
    """Keep an error's actionable pointers; summarize its bulky collections."""
    if not isinstance(details, dict):
        return details
    bounded: dict[str, Any] = {}
    for key, value in details.items():
        if key in _BULKY_ERROR_DETAIL_COLLECTIONS and isinstance(value, list):
            refs = [
                row.get("decision_ref") or row.get("id") or row.get("ref")
                for row in value
                if isinstance(row, dict)
            ]
            bounded[f"{key}_count"] = len(value)
            kept = [ref for ref in refs if isinstance(ref, str)]
            if kept:
                bounded[f"{key}_refs"] = kept[:12]
            bounded[f"{key}_omitted"] = (
                "the exact rows exceeded the transport budget; call the named "
                "refresh operation to read them"
            )
            continue
        bounded[key] = value
    return bounded


def project_envelope(
    operation: str,
    envelope: dict[str, Any],
    *,
    contract_digest: str,
    argument_schemas: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Return a deterministic complete-envelope projection under the budget."""
    full = deepcopy(envelope)
    full_bytes = transport_bytes(full)
    full_digest = canonical_digest(full)
    data = full.get("data")
    projector: Callable[[Any], Any] | None = None
    if operation == "session.resume":
        projector = lambda value: _project_resume(value, tight=False)
    elif operation == "scene.context":
        projector = lambda value: _compact_scene(value, tight=True)
    elif operation == "progressive.status":
        projector = _project_progressive_status
    elif operation == "progressive.register_source_bundle":
        projector = _project_register_source_bundle
    elif operation == "progressive.opening_bootstrap":
        projector = _project_opening_bootstrap
    elif operation == "actions.advise":
        projector = _project_actions
    elif operation == "combat.context":
        projector = _project_combat_context
    elif operation == "combat.resolve":
        projector = _project_combat_resolve
    elif operation == "npc.reaction":
        projector = _project_npc_reaction
    elif operation == "turn.output_context":
        projector = _compact_output_context
    elif operation == "turn.finalize":
        projector = _project_finalize
    elif operation == "setup.investigator_contract":
        projector = _project_investigator_contract
    elif operation == "module.context":
        projector = _project_module_context

    projected_data = projector(data) if projector is not None else deepcopy(data)
    result: dict[str, Any] = {
        "ok": bool(full.get("ok")),
        "tool": full.get("tool", operation),
        "wire": {
            "schema_version": SCHEMA_VERSION,
            "profile": PROFILE_ID,
            "canonical_operation": operation,
            "max_inline_bytes": MAX_INLINE_BYTES,
            "full_result_bytes": full_bytes,
            "full_result_sha256": full_digest,
            "contract_archive_sha256": contract_digest,
            "payload_projected": projector is not None,
        },
    }
    if operation == "session.resume" and isinstance(projected_data, dict):
        manifest = projected_data.get("working_set_manifest") or {}
        result["wire"]["control"] = {
            "mode": projected_data.get("mode"),
            "context_epoch": manifest.get("context_epoch"),
            "resume_acknowledged": manifest.get("acknowledged"),
            "working_set_revision": manifest.get("working_set_revision"),
            "next_operations": deepcopy(
                projected_data.get("next_operations") or []
            ),
        }
    if "error" in full:
        result["error"] = deepcopy(full["error"])
    if data is not None:
        result["data"] = projected_data
    result["warnings"] = _compact_messages(full.get("warnings"), limit=6)
    result["hints"] = _compact_messages(full.get("hints"), limit=6)
    for field in (
        "attempts",
        "max_attempts",
        "retryable",
        "retry_exhausted",
        "recovered_after_retry",
        "idempotent_replay",
        "cache",
        "context_rehydration",
        "continuation",
    ):
        if field in full:
            result[field] = deepcopy(full[field])
    result = _decorate_cards(
        result,
        contract_digest=contract_digest,
        argument_schemas=argument_schemas,
    )
    if operation == "module.context" and projector is not None:
        result["wire"]["module_context_projection"] = True

    if transport_bytes(result) > MAX_INLINE_BYTES and operation == "scene.context":
        tight_scene = _compact_scene(data, tight=True)
        result["data"] = _decorate_cards(
            _project_scene_recovery_index(tight_scene),
            contract_digest=contract_digest,
            argument_schemas=argument_schemas,
        )
        result["wire"]["payload_projected"] = True
        result["wire"]["scene_recovery_index_projection"] = True
        result["hints"] = [
            "the tight scene exceeded the transport budget; use the returned "
            "bounded scene indices and exact typed cards instead of reading files "
            "or broadly rediscovering operations",
            *result["hints"][:2],
        ]
        result["warnings"] = result["warnings"][:3]

    if transport_bytes(result) > MAX_INLINE_BYTES and operation == "session.resume":
        result["data"] = _decorate_cards(
            _project_resume(data, tight=True),
            contract_digest=contract_digest,
            argument_schemas=argument_schemas,
        )
        result["wire"]["payload_projected"] = True
        result["wire"]["tight_projection"] = True
        result["hints"] = result["hints"][:1]
        result["warnings"] = result["warnings"][:2]

    if transport_bytes(result) > MAX_INLINE_BYTES and operation == "session.resume":
        _fit_hot_argument_schemas(
            result,
            omit_order=("state.journal", "turn.output_context"),
            reserve_bytes=FINAL_MEASUREMENT_RESERVE_BYTES,
        )

    if (
        _exceeds_inline_budget(
            result,
            reserve_bytes=FINAL_MEASUREMENT_RESERVE_BYTES,
        )
        and operation == "session.resume"
    ):
        result["data"] = _decorate_cards(
            _project_resume_recovery_index(data),
            contract_digest=contract_digest,
            argument_schemas=argument_schemas,
        )
        _fit_hot_argument_schemas(
            result,
            omit_order=(
                "state.journal",
                "turn.output_context",
                "actions.advise",
            ),
            reserve_bytes=FINAL_MEASUREMENT_RESERVE_BYTES,
        )
        result["wire"]["payload_projected"] = True
        result["wire"]["recovery_index_projection"] = True
        result["hints"] = [
            "the inline working set exceeded the transport budget; use the "
            "returned typed recovery index and exact read cards on demand, "
            "never campaign files or broad discovery",
            *result["hints"][:2],
        ]
        result["warnings"] = result["warnings"][:3]

    if (
        transport_bytes(result) > MAX_INLINE_BYTES
        and operation == "progressive.claim_host_work"
    ):
        result["data"] = _project_claim_dispatch(data)
        result["wire"]["payload_projected"] = True
        result["wire"]["claim_dispatch_deduplicated"] = True
        result["warnings"] = result["warnings"][:3]
        result["hints"] = result["hints"][:3]

    if (
        transport_bytes(result) > MAX_INLINE_BYTES
        and operation == "progressive.claim_host_work"
        and _spill_structure_requests(result.get("data"))
    ):
        result["wire"]["payload_projected"] = True
        result["wire"]["claim_structure_requests_spilled"] = True

    if (
        transport_bytes(result) > MAX_INLINE_BYTES
        and operation == "progressive.claim_host_work"
        and _spill_repeated_request_fields(result.get("data"))
    ):
        result["wire"]["payload_projected"] = True
        result["wire"]["claim_request_instructions_spilled"] = True

    if (
        transport_bytes(result) > MAX_INLINE_BYTES
        and operation == "progressive.claim_host_work"
    ):
        result["data"] = _claim_projection_failure(data)
        result["wire"]["payload_projected"] = True
        result["wire"]["claim_dispatch_projection_failed"] = True
        result["warnings"] = [
            "The leased claim exceeded the bounded transport budget after "
            "contract deduplication; the returned exact lease bindings must be "
            "released before retry."
        ]
        result["hints"] = []

    if (
        transport_bytes(result) > MAX_INLINE_BYTES
        and operation == "turn.output_context"
    ):
        tight_output_context = _project_output_context_review_card(data)
        result["data"] = _decorate_cards(
            tight_output_context,
            contract_digest=contract_digest,
            argument_schemas=argument_schemas,
        )
        result["wire"]["payload_projected"] = True
        result["wire"]["tight_projection"] = True
        tight_contract = tight_output_context.get("contract_projection")
        review_required = (
            isinstance(tight_contract, dict)
            and tight_contract.get("agency_review_required") is True
        )
        result["hints"] = [
            "the output context exceeded the transport budget; continue from "
            + (
                "the returned agency_review_operation and finalize_operation"
                if review_required else "the returned finalize_operation"
            ),
            *result["hints"][:2],
        ]
        result["warnings"] = result["warnings"][:3]

    if (
        transport_bytes(result) > MAX_INLINE_BYTES
        and operation == "npc.query"
        and isinstance(data, dict)
        and isinstance(data.get("npcs"), list)
    ):
        # Demote by tier from the least-bound NPC inward, keeping the largest
        # shape that fits.  The identity-only collapse below would hand the
        # Keeper no cast at all, so any surviving roster row is strictly more
        # than this operation used to deliver.
        order = [
            row["npc_id"]
            for row in sorted(
                (
                    row for row in data["npcs"]
                    if isinstance(row, dict) and isinstance(row.get("npc_id"), str)
                ),
                key=_npc_query_retention_rank,
            )
        ]
        roster_hint = (
            "the full cast did not fit the transport budget; every NPC is "
            "still listed with its authored identity, role, scene provenance "
            "and relationship state — call the returned dossier_operation "
            "with the exact npc_id for any row marked dossier_required"
        )
        # Measure the exact shape that will ship, wire flags included: the
        # final-measurement reserve covers ``measured_inline_bytes`` alone, not
        # a projection marker added after the fit was decided.
        wire = {
            **result["wire"],
            "payload_projected": True,
            "npc_roster_projection": True,
        }
        warnings = result["warnings"][:2]

        def decorate(row: Any) -> Any:
            return _decorate_cards(
                row,
                contract_digest=contract_digest,
                argument_schemas=argument_schemas,
            )

        identities, tiers = _npc_query_tiered_rows(data["npcs"], decorate=decorate)
        shell = {
            key: deepcopy(value) for key, value in data.items() if key != "npcs"
        }
        shell["dossier_operation"] = decorate(
            _operation_card("npc.query", missing=["npc_id"])
        )

        def trial_for(tier_by_row: list[str]) -> dict[str, Any]:
            return {
                **result,
                "wire": wire,
                "data": {
                    **shell,
                    "npcs": [
                        tiers[index][tier]
                        for index, tier in enumerate(tier_by_row)
                    ],
                },
                "hints": [roster_hint],
                "warnings": warnings,
            }

        # Swapping one array element for another leaves every separator in
        # place, so a tier change costs exactly the two rows' byte difference.
        # Measure the all-index floor once, then price every candidate from
        # prefix sums instead of rebuilding the payload for each one.
        floor_bytes = transport_bytes(trial_for(["index"] * len(tiers)))
        budget = MAX_INLINE_BYTES - FINAL_MEASUREMENT_RESERVE_BYTES
        position = {npc_id: index for index, npc_id in enumerate(identities)}
        ranked = [position[npc_id] for npc_id in order]
        full_prefix = [0]
        roster_prefix = [0]
        for index in ranked:
            index_cost = transport_bytes(tiers[index]["index"])
            full_prefix.append(
                full_prefix[-1]
                + transport_bytes(tiers[index]["full"]) - index_cost
            )
            roster_prefix.append(
                roster_prefix[-1]
                + transport_bytes(tiers[index]["roster"]) - index_cost
            )

        def spend(full_count: int, roster_count: int) -> int:
            return (
                floor_bytes
                + full_prefix[full_count]
                + roster_prefix[roster_count] - roster_prefix[full_count]
            )

        # Every NPC gets the working-set roster tier if the budget allows it;
        # the deeper dossiers are what a tight budget gives up first.
        roster_count = len(ranked)
        full_count = len(ranked)
        while full_count and spend(full_count, roster_count) > budget:
            full_count -= 1
        while roster_count and spend(0, roster_count) > budget:
            roster_count -= 1
        full_count = min(full_count, roster_count)

        if spend(full_count, roster_count) <= budget:
            chosen = ["index"] * len(tiers)
            for rank, index in enumerate(ranked):
                if rank < full_count:
                    chosen[index] = "full"
                elif rank < roster_count:
                    chosen[index] = "roster"
            fitted = trial_for(chosen)
            # The arithmetic is exact, but never ship an unverified shape.
            if not _exceeds_inline_budget(
                fitted,
                reserve_bytes=FINAL_MEASUREMENT_RESERVE_BYTES,
            ):
                result = fitted
        # Otherwise even a bare index of this cast cannot fit; leave the result
        # alone so the identity-only collapse below stays the single last
        # resort rather than claiming a roster projection.

    if transport_bytes(result) > MAX_INLINE_BYTES:
        result["hints"] = result["hints"][:3]
        result["warnings"] = result["warnings"][:3]

    # A failure envelope's repair payload is bounded before the data collapse:
    # the collapse cannot reach `error.details`, and dropping the pointers is
    # worse than dropping the rows.
    if (
        transport_bytes(result) > MAX_INLINE_BYTES
        and isinstance(result.get("error"), dict)
        and isinstance(result["error"].get("details"), dict)
    ):
        result["error"] = {
            **result["error"],
            "details": _bounded_error_details(result["error"]["details"]),
        }
        result["wire"]["error_details_bounded"] = True

    # turn.output_context must not collapse to a cardless identity stub.
    # If the review card itself cannot fit, fail closed below.
    if (
        transport_bytes(result) > MAX_INLINE_BYTES
        and operation != "turn.output_context"
    ):
        result["data"] = _decorate_cards(
            _minimal_identity(operation, data),
            contract_digest=contract_digest,
            argument_schemas=argument_schemas,
        )
        result["wire"]["payload_projected"] = True
        result["wire"]["identity_only"] = True
        result["warnings"] = [
            "The canonical result exceeded the bounded coding-host projection; "
            "use the returned exact typed operation instead of reading files."
        ]
        result["hints"] = []

    measured = transport_bytes(result)
    result["wire"]["measured_inline_bytes"] = measured
    # Account once more for the measured field itself.
    measured = transport_bytes(result)
    result["wire"]["measured_inline_bytes"] = measured
    if measured > MAX_INLINE_BYTES:
        # This can only happen when an identity field itself is pathological.
        # Return a small deterministic technical failure rather than letting a
        # host silently truncate the lifecycle control header.
        result = {
            "ok": False,
            "tool": full.get("tool", operation),
            "wire": {
                "schema_version": SCHEMA_VERSION,
                "profile": PROFILE_ID,
                "canonical_operation": operation,
                "max_inline_bytes": MAX_INLINE_BYTES,
                "full_result_bytes": full_bytes,
                "full_result_sha256": full_digest,
                "contract_archive_sha256": contract_digest,
                "projection_failed": True,
            },
            "error": {
                "code": "mcp_wire_budget_exceeded",
                # Only a canonical success may be reported as one. A failure
                # that could not be inlined keeps its own code in
                # `original_error` so the Keeper still learns what went wrong
                # and does not replay an operation that will fail again.
                "message": (
                    "The canonical operation succeeded, but its safe coding-host "
                    "projection could not fit the transport budget. Replay the "
                    "typed operation after narrowing its exact projection."
                    if full.get("ok") is True
                    else "The canonical operation failed, and even its bounded "
                    "failure projection could not fit the transport budget. Do "
                    "not replay it unchanged; read the named original error."
                ),
                **(
                    {}
                    if full.get("ok") is True
                    else {
                        "original_error": {
                            key: value
                            for key, value in (
                                full.get("error") or {}
                            ).items()
                            if key in ("code", "message")
                        },
                    }
                ),
            },
            "data": _minimal_identity(operation, data),
            "warnings": [],
            "hints": [],
        }
    return result
