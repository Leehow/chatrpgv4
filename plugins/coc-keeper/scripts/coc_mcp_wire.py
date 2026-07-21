#!/usr/bin/env python3
"""Bounded MCP wire projections for coding-host COC play.

The canonical toolbox result is logged before this module runs.  These pure
functions only reduce the copy returned through MCP so hosts with a small tool
result ceiling do not truncate the lifecycle acknowledgement and exact next
operation cards.  No rules, state, secret, or narrative decision lives here.
"""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
from typing import Any, Callable


SCHEMA_VERSION = 1
PROFILE_ID = "keeper_hot_v1"
# Grok's documented default is 20,000 bytes.  Budget the complete envelope,
# not only ``data``, and retain headroom for the host's MCP wrapper.
MAX_INLINE_BYTES = 16 * 1024

# Compact projection of the canonical ``turn.finalize`` argument contract.
# This is intentionally smaller than the archived MCP schema: it carries only
# the fields a Keeper must retain between output-context and finalization, and
# never supplies meaning-bearing coverage values on the Keeper's behalf.
FINALIZE_ARGUMENTS = (
    "draft",
    "coverage",
    "decision_id",
    "mechanics_placements",
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


def transport_bytes(value: Any) -> int:
    """Return bytes for the same non-ASCII JSON shape emitted by the server."""
    return len(json.dumps(value, ensure_ascii=False).encode("utf-8"))


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
        if transport_bytes(result) <= MAX_INLINE_BYTES:
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


def _operation_card(
    operation: str,
    *,
    prefilled: dict[str, Any] | None = None,
    missing: list[str] | None = None,
    inline_argument_schema: bool = False,
) -> dict[str, Any]:
    card = {
        "operation": operation,
        "invoke_via": "coc_invoke",
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
            "rendered_sha256",
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
            ("finalization_id", "journal_decision_id", "rendered_sha256"),
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
            "impression",
            "presence",
            "availability",
            "trust",
            "fear",
            "suspicion",
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
            "pending_san_triggers",
            "action_routes",
            "operation_opportunities",
            "keeper_mechanics",
            "exit_ready",
            "progressive",
            "drilldown_refs",
        ),
    )
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
            _pick(row, ("to", "kind", "open", "when", "label", "cue"))
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
            "turn_number",
            "source_digest",
            "source_roll_ids",
            "obligations",
            "required_obligation_ids",
            "mechanics_bundle_sha256",
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
    prefilled: dict[str, Any] = {}
    if isinstance(journal_decision_id, str) and journal_decision_id:
        prefilled["decision_id"] = f"{journal_decision_id}:finalize"
    missing = ["draft"]
    if required_obligation_ids:
        missing.append("coverage")
    else:
        prefilled["coverage"] = []
    finalize_operation = _operation_card(
        "turn.finalize",
        prefilled=prefilled,
        missing=missing,
    )
    finalize_operation["argument_contract"] = {
        "required_arguments": ["draft", "coverage", "decision_id"],
        "allowed_arguments": list(FINALIZE_ARGUMENTS),
        "forbidden_aliases": ["draft_text", "journal_decision_id"],
        "instruction": (
            "Merge prefilled_arguments unchanged, add only missing_arguments, "
            "and invoke directly without coc_discover."
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
    if tight:
        projected.pop("candidate_factors", None)
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
            prefilled={
                "finalization_id": projected.get("finalization_id"),
                "rendered_sha256": projected.get("rendered_sha256"),
            },
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
            _pick(row, ("to", "kind", "open"))
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
            "turn_id",
            "turn_number",
            "source_digest",
            "rendered_sha256",
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
    if (
        isinstance(operation, str)
        and operation
        and decorated.get("invoke_via") == "coc_invoke"
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
        "rendered_sha256",
        "checkpoint_id",
        "source_digest",
    )
    return {
        **_pick(data, identity_fields),
        "projection_sha256": canonical_digest(data),
        "replay_operation": _operation_card(operation),
    }


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
    elif operation == "actions.advise":
        projector = _project_actions
    elif operation == "npc.reaction":
        projector = _project_npc_reaction
    elif operation == "turn.output_context":
        projector = _compact_output_context
    elif operation == "turn.finalize":
        projector = _project_finalize

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
        )

    if transport_bytes(result) > MAX_INLINE_BYTES and operation == "session.resume":
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

    if transport_bytes(result) > MAX_INLINE_BYTES:
        result["hints"] = result["hints"][:3]
        result["warnings"] = result["warnings"][:3]

    if transport_bytes(result) > MAX_INLINE_BYTES:
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
                "message": (
                    "The canonical operation succeeded, but its safe coding-host "
                    "projection could not fit the transport budget. Replay the "
                    "typed operation after narrowing its exact projection."
                ),
            },
            "data": _minimal_identity(operation, data),
            "warnings": [],
            "hints": [],
        }
    return result
