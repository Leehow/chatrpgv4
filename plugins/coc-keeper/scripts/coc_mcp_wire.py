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
from pathlib import Path
from typing import Any, Callable


SCHEMA_VERSION = 1
PROFILE_ID = "keeper_hot_v1"
# Grok's documented default is 20,000 bytes.  Budget the complete envelope,
# not only ``data``, and retain headroom for the host's MCP wrapper.
MAX_INLINE_BYTES = 16 * 1024
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
        ),
    )
    source_material = _compact_source_material(value.get("source_material"))
    if source_material is not None:
        projected["source_material"] = source_material
    if isinstance(value.get("progressive"), dict):
        projected["progressive"] = _project_source_work_lifecycle(
            value["progressive"]
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
            "source_scope_takeover",
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
            "source_scope_takeover",
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


def _project_request_deepen(value: Any) -> Any:
    if not isinstance(value, dict):
        return deepcopy(value)
    projected = _pick(
        value,
        (
            "campaign_id",
            "asset_root_id",
            "kind",
            "target_id",
            "current_dependency",
            "dependency_ref",
            "source_lifecycle",
            "background_takeover",
            "source_scope_takeover",
            "merged_location_ids",
        ),
    )
    if isinstance(value.get("status"), dict):
        projected["status"] = _pick(
            value["status"],
            (
                "kind",
                "entity_id",
                "exists",
                "parse_state",
                "evidence_gap",
                "deep_ready",
                "title",
                "ingest_timing",
                "fate_closure_gate",
            ),
        )
    host_work = value.get("host_work")
    if isinstance(host_work, dict):
        dependency_ref = (
            value.get("dependency_ref")
            if value.get("current_dependency") is True
            and isinstance(value.get("dependency_ref"), dict)
            else None
        )
        projected["host_work"] = _project_source_work_lifecycle(
            host_work,
            exact_dependency_ref=dependency_ref,
        )
        if (
            value.get("current_dependency") is True
            and projected["host_work"].get(
                "current_dependency_projection_status"
            ) == "blocked"
        ):
            projected["current_dependency_projection_blocker"] = {
                "schema_version": 1,
                "contract_id": (
                    "coc.source-current-dependency-projection-blocker.v1"
                ),
                "status": "blocked",
                "reason": projected["host_work"].get(
                    "current_dependency_projection_reason"
                ),
            }
    return projected


def _current_dependency_projection_blocker(
    value: Any,
    *,
    reason: str,
) -> dict[str, Any]:
    data = value if isinstance(value, dict) else {}
    host_work = data.get("host_work")
    campaign_id = (
        str(host_work.get("campaign_id") or "").strip()
        if isinstance(host_work, dict)
        else ""
    )
    dependency_ref = data.get("dependency_ref")
    exact_waits = [
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
        for row in (
            host_work.get("current_dependency_waits") or []
            if isinstance(host_work, dict)
            else []
        )
        if isinstance(row, dict)
        and isinstance(dependency_ref, dict)
        and row.get("dependency_ref") == dependency_ref
    ]
    return {
        **_pick(
            data,
            (
                "asset_root_id",
                "kind",
                "target_id",
                "current_dependency",
                "dependency_ref",
            ),
        ),
        **({"campaign_id": campaign_id} if campaign_id else {}),
        **({
            "host_work": {
                "campaign_id": campaign_id,
                "current_dependency_snapshot_scope": {
                    "schema_version": 1,
                    "contract_id": (
                        "coc.source-current-dependency-snapshot-scope.v1"
                    ),
                    "kind": "exact_dependency_ref",
                    "campaign_id": campaign_id,
                    "dependency_ref": deepcopy(dependency_ref),
                },
                "current_dependency_snapshot_complete": True,
                "current_dependency_waits": exact_waits,
                "current_dependency_dispatches": [],
                "current_dependency_projection_status": "blocked",
            },
        } if (
            campaign_id
            and len(exact_waits) == 1
            and isinstance(host_work, dict)
            and host_work.get("current_dependency_snapshot_complete") is True
        ) else {}),
        "current_dependency_projection_blocker": {
            "schema_version": 1,
            "contract_id": (
                "coc.source-current-dependency-projection-blocker.v1"
            ),
            "status": "blocked",
            "reason": reason,
            "instruction": (
                "Do not release source-dependent output. Retain the exact "
                "settlement identity and retry its canonical projection; never "
                "read files or infer source facts from earlier previews."
            ),
        },
    }


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
    # ``scene`` is the internal tight projection produced by ``_compact_scene``;
    # source material was already validated, packed, and digested exactly once.
    source_material = scene.get("source_material")
    if isinstance(source_material, dict):
        scene_index["source_material"] = deepcopy(source_material)
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
    if (
        isinstance(value.get("contract_id"), str)
        and value["contract_id"] in LOCATOR_TASK_CONTRACT_IDS
    ):
        # Closed locator task envelopes are machine contracts, not KP-facing
        # cards: pass them through byte-for-byte so the Pi extension's
        # exactKeys validation sees exactly what the toolbox emitted.
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
    if (
        isinstance(operation, str)
        and operation
        and decorated.get("invoke_via") in {
            "coc_invoke", "canonical_typed_operation_gateway",
        }
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
_INVESTIGATOR_CONTRACT_IMPORT_DEF_KEYS = (
    "complete_sheet",
    "complete_sheet_creation",
)


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
    Adaptive results also carry the unused Quick Fire sheet/catalog bulk that
    pushes the complete envelope past 16 KiB; without a typed projector the
    host collapses to identity-only and the KP loses ``payload_schema``.
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

    # 1920s Quick Fire already fits the hot budget with the full archive shape
    # (both create branches + skill catalog rows). Keep that byte-stable and
    # only slim the adaptive route that otherwise identity-collapses.
    if input_mode == _GUIDED_QUICK_FIRE_INPUT_MODE:
        return projected

    selected = [
        deepcopy(branch)
        for branch in branches
        if _investigator_contract_branch_input_mode(branch, definitions)
        == input_mode
    ]
    if len(selected) != 1:
        return projected
    schema["oneOf"] = selected

    drop_keys = set(_INVESTIGATOR_CONTRACT_IMPORT_DEF_KEYS)
    for mode, keys in _INVESTIGATOR_CONTRACT_BRANCH_DEF_KEYS.items():
        if mode != input_mode:
            drop_keys.update(keys)
    for key in drop_keys:
        definitions.pop(key, None)

    # Quick Fire skill rows are construction data only for that route. Adaptive
    # create uses base skills + provenance; keep catalog metadata only.
    catalog = result.get("guided_quick_fire_skill_catalog")
    if isinstance(catalog, dict):
        result["guided_quick_fire_skill_catalog"] = {
            key: deepcopy(value)
            for key, value in catalog.items()
            if key != "rows"
        }

    # Drop prose annotations from the remaining structural schema.
    result["payload_schema"] = _without_schema_annotations(schema)
    return projected


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
    elif operation == "progressive.request_deepen":
        projector = _project_request_deepen
    elif operation == "actions.advise":
        projector = _project_actions
    elif operation == "npc.reaction":
        projector = _project_npc_reaction
    elif operation == "turn.output_context":
        projector = _compact_output_context
    elif operation == "turn.finalize":
        projector = _project_finalize
    elif operation == "setup.investigator_contract":
        projector = _project_investigator_contract

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

    if transport_bytes(result) > MAX_INLINE_BYTES:
        result["hints"] = result["hints"][:3]
        result["warnings"] = result["warnings"][:3]

    if (
        transport_bytes(result) > MAX_INLINE_BYTES
        and operation == "progressive.request_deepen"
        and isinstance(data, dict)
        and data.get("current_dependency") is True
    ):
        result["data"] = _current_dependency_projection_blocker(
            data,
            reason="exact_dependency_projection_exceeds_transport_budget",
        )
        result["wire"]["payload_projected"] = True
        result["wire"]["current_dependency_projection_blocked"] = True
        result["warnings"] = [
            "The exact current-dependency control packet exceeded the bounded "
            "transport budget; player-visible output remains blocked."
        ]
        result["hints"] = []

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
