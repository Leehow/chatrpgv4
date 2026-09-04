#!/usr/bin/env python3
"""Operation adapter cell: setup-session."""
from __future__ import annotations

from coc_operation_kernel_runtime import (
    Any,
    Ctx,
    Path,
    TOOLS,
    ToolError,
    _CONTINUATION_DOMAINS,
    _CUSTOM_SETUP_OPERATION_KINDS,
    _campaign_play_language,
    _canonical_digest,
    _continuation_revision,
    _ensure_first_impression_roll,
    _latest_narrative_opportunity,
    _load_roll_receipt_document,
    _now_iso,
    _open_attempt_opportunities,
    _opening_host_work_mode,
    _pi_opening_setup_gate,
    _pi_opening_setup_operation_allowed,
    _read_jsonl_records,
    _read_optional_json,
    _record_table_transcript_entry,
    _run_segment_binding,
    _save_roll_receipt_document,
    _table_transcript_rows,
    _tool_scene_context,
    _turn_recovery_meaningful_tools,
    coc_compiled_archive,
    coc_continuation,
    coc_development,
    coc_first_impression,
    coc_git_history,
    coc_handouts,
    coc_host_context,
    coc_language,
    coc_module_project,
    coc_npc_event_chain,
    coc_opening_phase,
    coc_runtime_ops,
    coc_state,
    coc_time,
    coc_turn_finalization,
    coc_turn_manifest,
    deepcopy,
    hashlib,
    json,
    reconcile_campaign_continuity,
    time,
    tool,
)

import coc_history_projection
import coc_temporal_memory

_SESSION_RESUME_DATA_MAX_BYTES = 40 * 1024

# Every reduction name the ladder below can append. The budget metadata block
# is appended *after* the ladder finishes, so the ladder must trim to a ceiling
# that already accounts for it -- otherwise a payload that lands just under the
# raw ceiling is declared small enough, then pushed back over by the very block
# recording that it was small enough. That is not hypothetical: a campaign at
# turn 51 reduced to 40769 bytes, 191 under the ceiling, and the metadata took
# it to 41006. The campaign stayed durable and became permanently unresumable,
# and the error blamed the metadata rather than the undershooting ladder.
_SESSION_RESUME_REDUCTION_NAMES: tuple[str, ...] = (
    "host_input_text_to_ref",
    "delivery_text_to_typed_read",
    "current_turn_rows_to_refs",
    "scene_context_to_core_projection",
    "older_semantic_summaries_to_count",
    "recent_semantic_summaries_to_typed_refs",
    "temporal_capsule_to_counts",
    "pending_output_context_to_typed_read",
    "scene_context_to_minimal_ref",
    "current_turn_to_receipt_refs",
)

def _wire_bytes(value: Any) -> int:
    return len(json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    ).encode("utf-8"))


def _resume_budget_metadata_reserve() -> int:
    """Upper bound on the wire cost of the appended budget metadata block.

    Derived from the exhaustive reduction-name list rather than a magic
    constant, so a new rung cannot silently shrink the reserve below what its
    own name costs.
    """
    return _wire_bytes({
        "resume_budget": {
            "schema_version": 1,
            "max_data_bytes": _SESSION_RESUME_DATA_MAX_BYTES,
            "measured_data_bytes": _SESSION_RESUME_DATA_MAX_BYTES,
            "reductions": list(_SESSION_RESUME_REDUCTION_NAMES),
            "canonical_sources_unchanged": True,
        },
    })


def _bound_session_resume_data(data: dict[str, Any]) -> dict[str, Any]:
    """Keep the recovery working set inside one explicit wire budget.

    Canonical sources remain untouched.  Oversized inline projections degrade
    to hash-bound refs and exact typed read cards, never guessed summaries.
    """
    bounded = deepcopy(data)
    reductions: list[str] = []

    # The ladder trims to the ceiling minus what the budget metadata will cost,
    # so "small enough" stays true once that block is appended.
    effective_max = _SESSION_RESUME_DATA_MAX_BYTES - _resume_budget_metadata_reserve()

    def over() -> bool:
        return _wire_bytes(bounded) > effective_max

    host_input = bounded.get("host_input")
    if over() and isinstance(host_input, dict) and isinstance(
        host_input.get("text"), str
    ):
        host_input["text_ref"] = (
            ".coc/runtime/host-sessions/"
            + str(((bounded.get("host_context") or {}).get("before_resume") or {}).get(
                "session_id"
            ) or "current")
        )
        host_input["text"] = None
        reductions.append("host_input_text_to_ref")

    delivery = bounded.get("delivery")
    if over() and isinstance(delivery, dict) and isinstance(
        delivery.get("exact_text"), str
    ):
        exact = delivery["exact_text"]
        delivery["exact_text_bytes"] = len(exact.encode("utf-8"))
        delivery["exact_text"] = None
        delivery["replay_operation"] = {
            "operation": "session.delivery_text",
            "invoke_via": "coc_invoke",
            # Semantic replay card only: the host binds the latest canonical
            # delivery identity; the model never copies ids or hashes.
            "prefilled_arguments": {"mode": "replay"},
            "missing_arguments": [],
        }
        reductions.append("delivery_text_to_typed_read")

    current_turn = bounded.get("current_turn")
    if over() and isinstance(current_turn, dict):
        for row in current_turn.get("rows") or []:
            if not over():
                break
            if isinstance(row, dict) and "data" in row:
                payload = row.pop("data")
                row["data_ref"] = row.get("data_ref") or (
                    "logs/toolbox-calls.jsonl#call-"
                    + str(row.get("call_index") or "unknown")
                )
                row["data_digest"] = hashlib.sha256(json.dumps(
                    payload,
                    ensure_ascii=False,
                    sort_keys=True,
                    separators=(",", ":"),
                    default=str,
                ).encode("utf-8")).hexdigest()
                row["data_bytes"] = _wire_bytes(payload)
        reductions.append("current_turn_rows_to_refs")

    if over() and isinstance(bounded.get("scene_context"), dict):
        scene = bounded["scene_context"]
        bounded["scene_context"] = {
            key: deepcopy(scene.get(key))
            for key in (
                "campaign_id", "active_scene_id", "scene", "npcs_present",
                "exits", "party", "party_investigators", "time",
                "tension_level", "turn_number", "action_routes",
                "operation_opportunities", "progressive", "drilldown_refs",
            )
            if key in scene
        }
        bounded["scene_context"]["full_projection_operation"] = {
            "operation": "scene.context",
            "invoke_via": "coc_invoke",
            "prefilled_arguments": {},
            "missing_arguments": [],
        }
        reductions.append("scene_context_to_core_projection")

    capsule = bounded.get("semantic_capsule")
    if over() and isinstance(capsule, dict):
        summaries = capsule.get("recent_summaries")
        if isinstance(summaries, list):
            original_count = len(summaries)
            kept = list(summaries)
            # Deterministically discard oldest inline summaries one at a time,
            # but keep the latest two continuity beats whenever present.
            while over() and len(kept) > 2:
                kept.pop(0)
                capsule["recent_summaries"] = deepcopy(kept)
                capsule["older_summary_count"] = original_count - len(kept)
            if original_count != len(kept):
                reductions.append("older_semantic_summaries_to_count")
            if over() and kept:
                # If even the last two exact strings exceed the envelope,
                # retain their ordered typed identities for exact drilldown.
                capsule["recent_summaries"] = [
                    {
                        "summary_index": original_count - len(kept) + index,
                        "summary_sha256": hashlib.sha256(
                            str(summary).encode("utf-8")
                        ).hexdigest(),
                        "summary_bytes": len(str(summary).encode("utf-8")),
                        "summary_ref": {
                            "operation": "session.continuation_detail",
                            "invoke_via": "coc_invoke",
                            "prefilled_arguments": {
                                "section": "recent_summaries",
                                "offset": original_count - len(kept) + index,
                                "limit": 1,
                            },
                            "missing_arguments": [],
                        },
                    }
                    for index, summary in enumerate(kept)
                ]
                reductions.append("recent_semantic_summaries_to_typed_refs")

    temporal = bounded.get("temporal_capsule")
    if over() and isinstance(temporal, dict):
        for field in (
            "recent_episodes", "active_assertions", "open_hooks",
            "pending_candidates", "session_summaries",
        ):
            rows = temporal.get(field)
            if isinstance(rows, list) and rows:
                temporal[field + "_count"] = len(rows)
                temporal[field] = []
        reductions.append("temporal_capsule_to_counts")

    if over() and bounded.get("pending_output_context") is not None:
        bounded["pending_output_context"] = {
            "projection_ref": "turn.output_context",
            "operation": {
                "operation": "turn.output_context",
                "invoke_via": "coc_invoke",
                "prefilled_arguments": {},
                "missing_arguments": [],
            },
        }
        reductions.append("pending_output_context_to_typed_read")

    if over() and isinstance(bounded.get("scene_context"), dict):
        scene = bounded["scene_context"]
        bounded["scene_context"] = {
            key: deepcopy(scene.get(key))
            for key in (
                "campaign_id", "active_scene_id", "scene", "party", "time",
                "operation_opportunities", "progressive",
                "full_projection_operation",
            )
            if key in scene
        }
        reductions.append("scene_context_to_minimal_ref")

    if over() and isinstance(current_turn, dict):
        current_turn["rows"] = [
            {
                "call_index": row.get("call_index"),
                "tool": row.get("tool"),
                "ok": row.get("ok"),
                "row_ref": row.get("row_ref") or row.get("data_ref"),
                "row_digest": row.get("row_digest") or row.get("data_digest"),
            }
            for row in current_turn.get("rows") or []
            if isinstance(row, dict)
        ]
        reductions.append("current_turn_to_receipt_refs")

    measured = _wire_bytes(bounded)
    if measured > effective_max:
        raise ToolError(
            "resume_budget_exceeded",
            "bounded recovery identities still exceed the fixed resume budget; "
            "preserve canonical refs and inspect the cited typed projection",
        )
    bounded["resume_budget"] = {
        "schema_version": 1,
        "max_data_bytes": _SESSION_RESUME_DATA_MAX_BYTES,
        "measured_data_bytes": measured,
        "reductions": reductions,
        "canonical_sources_unchanged": True,
    }
    # Account for the budget metadata itself.
    bounded["resume_budget"]["measured_data_bytes"] = _wire_bytes(bounded)
    if bounded["resume_budget"]["measured_data_bytes"] > _SESSION_RESUME_DATA_MAX_BYTES:
        raise ToolError(
            "resume_budget_exceeded",
            "resume budget metadata exceeded the fixed recovery budget",
        )
    return bounded

def _recover_compiled_archive_for_resume(
    campaign_dir: Path,
) -> tuple[dict[str, Any], list[str]]:
    """Publish a missing/stale rebuildable archive at lifecycle recovery.

    ``session.resume`` already repairs continuation caches.  Doing the same
    once-per-context maintenance for the compiled archive keeps ordinary turns
    on typed scene/entity projections instead of inviting host file scans.
    Canonical scenario IR is never modified.
    """
    loaded = coc_compiled_archive.load_published(campaign_dir)
    if loaded.get("ok"):
        return {
            "status": "reused",
            "archive_revision": loaded.get("archive_revision"),
            "canonical_sources_unchanged": True,
        }, []
    published = coc_compiled_archive.publish_from_campaign(campaign_dir)
    if published.get("ok"):
        return {
            "status": "published",
            "reason": loaded.get("code") or "archive_unavailable",
            "archive_revision": published.get("archive_revision"),
            "canonical_sources_unchanged": True,
        }, []
    return {
        "status": "fallback",
        "reason": loaded.get("code") or "archive_unavailable",
        "archive_revision": None,
        "canonical_sources_unchanged": True,
    }, [
        "compiled archive lifecycle maintenance failed; scene.context will use "
        "canonical IR fallback, but hosts must still use typed operations rather "
        "than reading module files: "
        + str(published.get("error") or loaded.get("error") or "unknown error")
    ]

def _campaign_has_confirmed_investigator(
    campaign_dir: Path,
    campaign_id: str,
) -> bool:
    """True when the party has a finished investigator, not a setup placeholder.

    Electron/web links ``complete_sheet_placeholder`` so the UI has a sheet
    during guided creation. That party row is not character-creation completion.
    One shared predicate lives in ``coc_state``.
    """
    return coc_state.campaign_has_confirmed_investigator(
        Path(campaign_dir), campaign_id,
    )

def _character_creation_resume_projection(
    campaign_dir: Path,
    campaign_id: str,
) -> dict[str, Any] | None:
    """Player-safe creation pointer for an unlinked campaign resume.

    ``session.resume`` is the first allowed campaign read after host restart.
    Without this projection the KP is told not to rescan ``.coc`` and therefore
    cannot discover ``campaign.character_creation.briefing_path``.
    """
    if _campaign_has_confirmed_investigator(campaign_dir, campaign_id):
        return None
    try:
        campaign = coc_state.load_campaign_state(campaign_dir)
    except (OSError, ValueError):
        return None
    if not isinstance(campaign, dict):
        return None
    if campaign.get("status") == "ready_for_table":
        return None
    recorded = campaign.get("character_creation")
    recorded = recorded if isinstance(recorded, dict) else {}
    projection: dict[str, Any] = {
        "status": "incomplete",
        "campaign_id": str(campaign_id),
    }
    era = campaign.get("era")
    if isinstance(era, str) and era.strip():
        projection["era"] = era.strip()
    play_language = campaign.get("play_language")
    if isinstance(play_language, str) and play_language.strip():
        projection["play_language"] = play_language.strip()
    title = campaign.get("title")
    if isinstance(title, str) and title.strip():
        projection["title"] = title.strip()
    facts = campaign.get("source_fast_facts")
    if isinstance(facts, dict):
        place = facts.get("place")
        if isinstance(place, dict) and place.get("status") == "source":
            value = place.get("value")
            if isinstance(value, str) and value.strip():
                projection["place"] = value.strip()
    briefing_path = recorded.get("briefing_path")
    if isinstance(briefing_path, str) and briefing_path.strip():
        projection["briefing_path"] = briefing_path.strip()
        language = recorded.get("language")
        if isinstance(language, str) and language.strip():
            projection["language"] = language.strip()
        return projection
    projection["render_operation"] = {
        "operation": "setup.invoke",
        "invoke_via": "coc_invoke",
        "campaign": str(campaign_id),
        "arguments": {
            "kind": "campaign.render_briefing",
            "payload": {"campaign_id": str(campaign_id)},
        },
    }
    return projection

def _tool_setup_inspect(ctx: Ctx, args: dict[str, Any]):
    if args:
        raise ToolError("invalid_param", "setup.inspect takes no arguments")
    try:
        receipt = coc_runtime_ops.execute_setup_operation(
            ctx.root,
            operation={
                "schema_version": 1,
                "kind": "onboarding.inspect",
                "payload": {},
            },
        )
    except coc_runtime_ops.RuntimeOperationError as exc:
        raise ToolError("setup_failed", str(exc)) from exc
    return receipt, [], [
        "use the returned exact scenario_id with setup.quick_start; include pregen_id only when that starter listed one; omit pregen_id when the public pregen list is empty, then continue existing character creation; do not search plugin or campaign files",
    ]

def _tool_setup_phase(ctx: Ctx, args: dict[str, Any]):
    unsupported = sorted(set(args) - {"campaign_id"})
    if unsupported:
        raise ToolError(
            "invalid_param",
            "setup.phase has unsupported fields: " + ", ".join(unsupported),
        )
    campaign_id = str(args.get("campaign_id") or ctx.campaign_id or "").strip()
    if not campaign_id:
        raise ToolError(
            "invalid_param",
            "setup.phase requires campaign_id or a current campaign",
        )
    derived = coc_opening_phase.derive_opening_phase(
        ctx.root,
        campaign_id,
        host_work_mode=_opening_host_work_mode(ctx.execution_class),
    )
    return derived, [], [
        "this is the single opening lifecycle authority; follow "
        "next_operation when present instead of re-deriving setup progress",
    ]

def _tool_setup_quick_start(ctx: Ctx, args: dict[str, Any]):
    allowed = {
        "scenario_id", "pregen_id", "campaign_id", "title", "decision_id",
        "play_register",
    }
    unsupported = sorted(set(args) - allowed)
    if unsupported or "scenario_id" not in args:
        raise ToolError(
            "invalid_param",
            "setup.quick_start requires scenario_id"
            + (
                "; unsupported fields: " + ", ".join(unsupported)
                if unsupported else ""
            ),
        )
    pregen_raw = args.get("pregen_id")
    if pregen_raw is not None and not str(pregen_raw).strip():
        raise ToolError(
            "invalid_param",
            "pregen_id is empty; omit the field for an investigator-less "
            "starter, or pass an exact public pregen_id",
        )
    payload = {
        key: args[key]
        for key in (
            "scenario_id", "pregen_id", "campaign_id", "title", "decision_id",
            "play_register",
        )
        if args.get(key) is not None
    }
    try:
        receipt = coc_runtime_ops.execute_setup_operation(
            ctx.root,
            operation={
                "schema_version": 1,
                "kind": "campaign.quick_start",
                "payload": payload,
            },
        )
        campaign_id = str((receipt.get("result") or {}).get("campaign_id") or "")
        warnings = coc_runtime_ops.coc_starter.quick_start_response_warnings(
            ctx.root,
            campaign_id=campaign_id,
            decision_id=str(receipt.get("decision_id") or ""),
        )
    except coc_runtime_ops.RuntimeOperationError as exc:
        raise ToolError(exc.code or "setup_failed", str(exc), details=exc.details) from exc
    except coc_runtime_ops.coc_starter.QuickStartIdempotencyConflict as exc:
        raise ToolError("idempotency_conflict", str(exc)) from exc
    except (FileExistsError, FileNotFoundError) as exc:
        raise ToolError("setup_failed", str(exc)) from exc
    hints = [
        "this campaign was created in the current host setup context; retain "
        "this receipt and continue setup/opening directly without session.resume",
        "use session.resume only when continuing a campaign generation that "
        "predates the current host context",
        "do not pass play_language to setup.quick_start; the canonical built-in starter already defaults to zh-Hans",
    ] if campaign_id else []
    result = receipt.get("result") or {}
    if campaign_id and result.get("needs_investigator") is True:
        hints.append(
            "this starter is bound without an investigator; continue the "
            "existing character-creation card/workflow (setup.chargen_run). "
            "setup.complete stays blocked until a confirmed investigator is "
            "linked — this is not a missing campaign_id"
        )
    return receipt, warnings, hints

def _tool_setup_complete(ctx: Ctx, args: dict[str, Any]):
    allowed = {"campaign_id", "decision_id"}
    unsupported = sorted(set(args) - allowed)
    if unsupported or "campaign_id" not in args or "decision_id" not in args:
        raise ToolError(
            "invalid_param",
            "setup.complete requires campaign_id and decision_id",
        )
    try:
        receipt = coc_runtime_ops.execute_setup_operation(
            ctx.root,
            operation={
                "schema_version": 1,
                "kind": "campaign.complete",
                "payload": {
                    "campaign_id": args["campaign_id"],
                    "decision_id": args["decision_id"],
                },
            },
        )
    except coc_runtime_ops.RuntimeOperationError as exc:
        raise ToolError(
            exc.code or "setup_failed",
            str(exc),
            details=exc.details if isinstance(exc.details, dict) else None,
        ) from exc
    except FileNotFoundError as exc:
        raise ToolError("unknown_campaign", str(exc)) from exc
    return receipt, [], [
        "retain this handoff receipt; the setup session should exit so a play session can session.resume this ready_for_table campaign",
    ]

def _tool_setup_chargen_run(ctx: Ctx, args: dict[str, Any]):
    allowed = set(coc_runtime_ops.coc_character.CHARGEN_RUN_ALLOWED)
    unsupported = sorted(set(args) - allowed)
    if unsupported:
        raise ToolError(
            "invalid_param",
            "setup.chargen_run has unsupported fields: " + ", ".join(unsupported),
        )
    try:
        receipt = coc_runtime_ops.execute_setup_operation(
            ctx.root,
            operation={
                "schema_version": 1,
                "kind": "setup.chargen_run",
                "payload": {
                    key: args[key] for key in allowed if key in args
                },
            },
        )
    except (
        coc_runtime_ops.RuntimeOperationError,
        FileExistsError,
        FileNotFoundError,
    ) as exc:
        raise ToolError("setup_failed", str(exc)) from exc
    result = receipt.get("result") if isinstance(receipt.get("result"), dict) else {}
    hints = [
        "normal Quick Fire path is setup.chargen_run / coc_chargen_delegate; "
        "do not hand-assemble investigator.create",
        "do not call setup.quick_start when a setup campaign already exists",
    ]
    if result.get("ok") is not True:
        error = str(result.get("error") or "setup.chargen_run failed")
        unrecognized = (
            "unrecognized occupation_skill_names" in error
            or (
                result.get("stage") == "assignment"
                and "unrecognized:" in error
            )
        )
        raise ToolError(
            "invalid_param" if unrecognized else "chargen_failed",
            error,
            details=result if isinstance(result, dict) else None,
        )
    warnings: list[str] = []
    raw_warnings = result.get("warnings")
    if isinstance(raw_warnings, list):
        warnings.extend(
            str(item).strip()
            for item in raw_warnings
            if isinstance(item, str) and item.strip()
        )
    return receipt, warnings, hints

def _tool_setup_investigator_contract(ctx: Ctx, args: dict[str, Any]):
    if set(args) != {"campaign_id"}:
        detail = (
            " (received "
            + ", ".join(sorted(args))
            + "; this operation's top-level key is campaign_id, not campaign)"
            if "campaign" in args
            else ""
        )
        raise ToolError(
            "invalid_param",
            "setup.investigator_contract requires exactly campaign_id" + detail,
        )
    try:
        receipt = coc_runtime_ops.execute_setup_operation(
            ctx.root,
            operation={
                "schema_version": 1,
                "kind": "investigator.contract",
                "payload": {"campaign_id": args["campaign_id"]},
            },
        )
    except (
        coc_runtime_ops.RuntimeOperationError,
        FileNotFoundError,
    ) as exc:
        raise ToolError("setup_failed", str(exc)) from exc
    # A restart/recovery host that resumes mid-setup has no in-memory route
    # state; the persisted opening gate on the receipt is the canonical
    # reconstruction source for the extension (mirrors the bind receipt).
    opening_setup_gate = _pi_opening_setup_gate(
        ctx.root, args["campaign_id"],
    )
    if opening_setup_gate is not None and isinstance(receipt, dict):
        receipt = deepcopy(receipt)
        receipt["opening_gate"] = opening_setup_gate
    return receipt, [], [
        "use result.payload_schema to construct the final investigator.create "
        "payload; deterministic runtime validation remains authoritative",
        "retain this campaign-bound contract for the current creation flow; "
        "do not rediscover or requery it before investigator.create",
        "when the payload_schema requires luck_roll_receipt, issue the Luck "
        "source roll as rules.roll_dice with campaign="
        f"{args['campaign_id']}, arguments={{'expression': '3D6', "
        "'decision_id': '<new-unique-id>', 'purpose': "
        "'investigator_creation_luck'}} and copy its returned roll_id/total "
        "into luck_roll_receipt/luck_roll_total verbatim",
    ]

def _opening_fast_fact_ref_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "additionalProperties": False,
        "required_fields": ["source_id", "pdf_index"],
        "properties": {
            "source_id": {"type": "string", "minLength": 1},
            "pdf_index": {"type": "integer", "minimum": 0},
        },
    }

def _opening_fast_fact_answer_schema(*, list_value: bool) -> dict[str, Any]:
    value_schema: dict[str, Any] = (
        {
            "type": "array",
            "minItems": 1,
            "uniqueItems": True,
            "items": {"type": "string", "minLength": 1},
        }
        if list_value
        else {"type": "string", "minLength": 1}
    )
    refs = {
        "type": "array",
        "minItems": 1,
        "items": _opening_fast_fact_ref_schema(),
    }
    return {
        "type": "object",
        "additionalProperties": False,
        "required_fields": ["status"],
        "desc": (
            "Exact status-dependent shape: source requires only status, value, "
            "and source_refs; unresolved requires only status and non-empty "
            "inspected_source_refs. References select accepted pages from the "
            "currently bound campaign source bundle."
        ),
        "properties": {
            "status": {
                "type": "string",
                "enum": ["source", "unresolved"],
            },
            "value": value_schema,
            "source_refs": deepcopy(refs),
            "inspected_source_refs": deepcopy(refs),
        },
    }

_OPENING_FAST_FACTS_TOOL_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required_fields": [
        "schema_version",
        "contract_id",
        "era",
        "place",
        "investigator_hook",
        "investigator_constraints",
        "player_safe_summary",
        "content_flags",
    ],
    "properties": {
        "schema_version": {"type": "integer", "enum": [1]},
        "contract_id": {
            "type": "string",
            "enum": ["coc.opening-fast-facts.v1"],
        },
        "era": _opening_fast_fact_answer_schema(list_value=False),
        "place": _opening_fast_fact_answer_schema(list_value=False),
        "investigator_hook": _opening_fast_fact_answer_schema(list_value=False),
        "investigator_constraints": _opening_fast_fact_answer_schema(
            list_value=False
        ),
        "player_safe_summary": _opening_fast_fact_answer_schema(list_value=False),
        "content_flags": _opening_fast_fact_answer_schema(list_value=True),
    },
}

def _tool_setup_adopt_source_facts(ctx: Ctx, args: dict[str, Any]):
    if set(args) != {"campaign_id", "facts"}:
        raise ToolError(
            "invalid_param",
            "setup.adopt_source_facts requires exactly campaign_id and facts",
        )
    try:
        receipt = coc_runtime_ops.execute_setup_operation(
            ctx.root,
            operation={
                "schema_version": 1,
                "kind": "campaign.adopt_source_facts",
                "payload": {
                    "campaign_id": args["campaign_id"],
                    "facts": args["facts"],
                },
            },
        )
    except (
        coc_runtime_ops.RuntimeOperationError,
        FileNotFoundError,
    ) as exc:
        raise ToolError("setup_failed", str(exc)) from exc
    return receipt, [], [
        "after both era and place resolve, call setup.investigator_contract; "
        "do not treat this receipt as investigator creation or linkage",
    ]

def _tool_setup_player_vocabulary(ctx: Ctx, args: dict[str, Any]):
    """Write the player-visible vocabulary a campaign renders itself with.

    `localized_terms` was initialized empty at campaign creation and written by
    nothing -- 249 preserved campaigns, 249 empty maps -- so the per-campaign
    override path that opens the language space had no entrance. This is it.

    Chrome labels are what the host emits around Keeper prose; a language with
    no built-in table renders them in English until this supplies them. The
    receipt reports coverage rather than success, because a partial vocabulary
    renders some words in the table's language and the rest in English, which
    is worse than either.
    """
    if set(args) - {"campaign_id", "language", "entries"}:
        raise ToolError(
            "invalid_param",
            "setup.player_vocabulary accepts exactly campaign_id, language and entries",
        )
    campaign_id = str(args.get("campaign_id") or "").strip()
    if not campaign_id:
        raise ToolError("missing_param", "required parameter: campaign_id")
    campaign_dir = ctx.root / ".coc" / "campaigns" / campaign_id
    try:
        campaign = coc_state.load_campaign_state(campaign_dir)
    except Exception as exc:  # noqa: BLE001 - surfaced as a tool error
        raise ToolError("unsupported_save_schema", str(exc)) from exc

    language = str(args.get("language") or "").strip() or str(
        campaign.get("play_language") or ""
    ).strip()
    try:
        report = coc_state.set_campaign_player_vocabulary(
            campaign, language, args.get("entries") or {},
        )
    except ValueError as exc:
        raise ToolError("invalid_param", str(exc)) from exc

    coc_state.write_json_atomic(campaign_dir / "campaign.json", campaign)
    coverage = report["chrome_coverage"]
    hints = []
    if not coverage["complete"]:
        hints.append(
            f"chrome coverage {coverage['overridden']}/{coverage['total']} for "
            f"{coverage['language']}: the remaining labels render in English, so "
            "player-visible mechanics blocks will mix languages until they are supplied"
        )
    return report, [], hints


def _tool_setup_invoke(ctx: Ctx, args: dict[str, Any]):
    unsupported = sorted(set(args) - {"kind", "payload"})
    if unsupported:
        raise ToolError(
            "invalid_param",
            "setup.invoke has unsupported fields: " + ", ".join(unsupported),
        )
    kind = args.get("kind")
    if kind not in _CUSTOM_SETUP_OPERATION_KINDS:
        raise ToolError(
            "invalid_param",
            "setup.invoke kind must be one of: "
            + ", ".join(_CUSTOM_SETUP_OPERATION_KINDS),
        )
    payload = args.get("payload")
    if not isinstance(payload, dict):
        raise ToolError("invalid_param", "setup.invoke payload must be an object")
    payload_campaign_id = str(
        payload.get("campaign_id") or ctx.campaign_id or ""
    ).strip()
    if kind == "investigator.create":
        creation = payload.get("creation")
        if isinstance(creation, dict) and (
            creation.get("characteristic_assignment_order") is not None
            or creation.get("luck_roll_total") is not None
            or (
                isinstance(creation.get("luck"), dict)
                and creation.get("luck", {}).get("mode") == "auto_roll"
            )
        ):
            declared_campaign = str(
                payload.get("campaign_id") or ""
            ).strip()
            luck_reference = creation.get("luck_roll_receipt")
            auto_luck = (
                isinstance(creation.get("luck"), dict)
                and creation.get("luck", {}).get("mode") == "auto_roll"
            )
            referenced_campaign = (
                str(luck_reference.get("campaign_id") or "").strip()
                if isinstance(luck_reference, dict)
                else (declared_campaign if auto_luck else "")
            )
            if (
                not ctx.campaign_id
                or declared_campaign != ctx.campaign_id
                or referenced_campaign != declared_campaign
            ):
                raise ToolError(
                    "invalid_param",
                    "Quick Fire investigator.create payload campaign_id and "
                    "luck_roll_receipt.campaign_id must equal the current "
                    "top-level campaign "
                    f"(top-level={ctx.campaign_id!r}, "
                    f"payload.campaign_id={declared_campaign!r}, "
                    f"luck_roll_receipt.campaign_id={referenced_campaign!r})",
                )
    opening_setup_gate = _pi_opening_setup_gate(
        ctx.root, payload_campaign_id or None,
    )
    if (
        opening_setup_gate is not None
        and not _pi_opening_setup_operation_allowed(
            "setup.invoke", {"kind": kind, "payload": payload},
            opening_setup_gate,
        )
    ):
        raise ToolError(
            "opening_setup_incomplete",
            (
                f"setup.invoke kind {kind!r} is unavailable until the "
                "source-bound opening projection is current"
            ),
            details=opening_setup_gate,
        )
    try:
        receipt = coc_runtime_ops.execute_setup_operation(
            ctx.root,
            operation={
                "schema_version": 1,
                "kind": kind,
                "payload": deepcopy(payload),
            },
        )
    except (
        coc_runtime_ops.RuntimeOperationError,
        FileExistsError,
        FileNotFoundError,
    ) as exc:
        raise ToolError("setup_failed", str(exc)) from exc
    hints = [
        "retain this current setup receipt and complete only the remaining "
        "canonical setup/opening steps without session.resume",
        "use session.resume only to recover a campaign generation that "
        "predates the current host context, never merely because a campaign "
        "id now exists",
    ]
    if kind == "scenario.bind_pdf" and receipt.get("status") == "PASS":
        briefing = (receipt.get("result") or {}).get(
            "character_creation_briefing"
        )
        briefing_path = (
            briefing.get("briefing_path") if isinstance(briefing, dict) else None
        )
        if isinstance(briefing_path, str) and briefing_path:
            hints.extend(
                [
                    "consume the exact result.character_creation_briefing."
                    "briefing_path directly from this receipt, rooted at the "
                    "current workspace; do not rerender it or rediscover it "
                    "through campaign.json, find, ls, glob, or directory listing "
                    "under .coc",
                    "call campaign.render_briefing only if a bind receipt lacks "
                    "that path or player-safe public setup metadata later changes",
                ]
            )
    opening_setup_gate = _pi_opening_setup_gate(
        ctx.root, payload_campaign_id or None,
    )
    if receipt.get("status") == "PASS" and opening_setup_gate is not None:
        receipt = deepcopy(receipt)
        receipt["opening_gate"] = opening_setup_gate
        next_operation = opening_setup_gate.get("next_operation")
        if isinstance(next_operation, dict):
            receipt["next_operation"] = deepcopy(next_operation)
            hints.insert(
                0,
                "opening setup is hard-gated: invoke data.next_operation "
                "exactly before any live-play discovery, read, mutation, "
                "session.resume, rebind, or opening narration",
            )
        else:
            hints.insert(
                0,
                "opening source materialization is already running; retain its "
                "bootstrap receipt and wait for the host terminal lifecycle "
                "without polling, rebinding, resuming, or entering play",
            )
    warnings: list[str] = []
    if kind == "campaign.create":
        created_id = str(
            (payload.get("campaign_id") or "")).strip()
        recent = _recently_created_campaigns(ctx.root, exclude=created_id)
        if recent:
            warnings.append(
                "campaign.create succeeded, but these campaigns were also "
                "created minutes ago: "
                + ", ".join(recent)
                + ". Mid-setup duplicate campaigns split durable state; "
                "continue the intended campaign instead of creating another."
            )
    return receipt, warnings, hints

def _recently_created_campaigns(
    root: Path, *, exclude: str, within_minutes: int = 10,
) -> list[str]:
    """Deterministic bookkeeping: campaign dirs whose state file is fresh."""
    campaigns_dir = root / ".coc" / "campaigns"
    if not campaigns_dir.is_dir():
        return []
    now = time.time()
    recent: list[tuple[float, str]] = []
    try:
        entries = list(campaigns_dir.iterdir())
    except OSError:
        return []
    for entry in entries:
        if not entry.is_dir() or entry.name == exclude:
            continue
        state_file = entry / "campaign.json"
        try:
            age_minutes = (now - state_file.stat().st_mtime) / 60
        except OSError:
            continue
        if age_minutes <= within_minutes:
            recent.append((age_minutes, entry.name))
    return [name for _, name in sorted(recent, reverse=True)]

_TURN_TAIL_DURABLE_DECISION_TOOLS = frozenset({
    "evidence.table_opening",
    "session.begin",
    "session.delivery_ack",
    "setup.complete",
    "development.settle",
    "state.end_session",
})

def _quarantine_unbound_turn_tail(ctx: Ctx) -> dict[str, Any]:
    """Quarantine true orphans without destroying a recoverable open turn.

    A successful non-replay mutation after the durable turn cursor is the
    current in-flight turn, even when a host restart happened before
    ``state.journal``.  ``session.resume.current_turn`` already exposes that
    exact source window, so quarantine must defer while it is recoverable;
    otherwise it would advertise a reusable receipt after voiding the same
    roll and restoring its state.  With no open source window, genuinely
    unbound rolls are dispositioned append-only and turn-scoped state restores
    from the latest finalized commit as before.  Rolls owned by a live pending
    manifest are likewise legitimate in-flight work.
    """
    pending_window_rolls: set[str] = set()
    has_pending_turn = False
    try:
        refresh = coc_turn_manifest.refresh_pending_window(ctx.campaign_dir)
    except coc_turn_manifest.TurnManifestError:
        refresh = None
    if refresh is not None:
        has_pending_turn = True
        _manifest, window, _journal = refresh
        pending_window_rolls = coc_turn_finalization._referenced_roll_ids(window)
    source_tail: list[dict[str, Any]] = []
    if not has_pending_turn:
        source_boundary = coc_turn_manifest.effective_source_boundary(
            ctx.campaign_dir
        )
        source_tail = coc_turn_manifest.uncommitted_source_rows(ctx.campaign_dir)
        meaningful_tools = _turn_recovery_meaningful_tools()
        recoverable_rows = [
            row
            for row in source_tail
            if row.get("ok") is True
            and row.get("idempotent_replay") is not True
            and str(row.get("tool") or "") in meaningful_tools
        ]
        if (
            source_boundary["cursor_close_owner"] == "turn.finalize"
            and int(source_boundary["effective_start_index"]) > 0
            and recoverable_rows
        ):
            # The exact toolbox rows and canonical state are the recovery
            # source.  Deferring unrelated orphan cleanup is required because
            # restoring save/ here would also roll back this live turn.  Once
            # the turn finalizes, its cursor advances and a later empty-window
            # resume can quarantine any independent historical orphan safely.
            return {
                "quarantined_orphan_rolls": [],
                "restored_commit_snapshot": None,
                "invalidated_decisions": [],
                "discarded_development_ticks": {
                    "queue": 0, "claims": 0, "archive": 0,
                },
            }
    orphan_ids = [
        roll_id
        for roll_id in coc_turn_finalization.unbound_public_roll_ids(ctx.campaign_dir)
        if roll_id not in pending_window_rolls
    ]
    if not orphan_ids:
        return {
            "quarantined_orphan_rolls": [],
            "restored_commit_snapshot": None,
            "invalidated_decisions": [],
            "discarded_development_ticks": {"queue": 0, "claims": 0, "archive": 0},
        }
    orphan_set = set(orphan_ids)

    invalidation_candidates: set[tuple[str, str]] = set()
    if not has_pending_turn:
        for row in source_tail:
            tool_name = str(row.get("tool") or "")
            tool_spec = TOOLS.get(tool_name)
            row_args = row.get("args") if isinstance(row.get("args"), dict) else {}
            decision_id = str(row_args.get("decision_id") or "").strip()
            if (
                row.get("ok") is True
                and isinstance(tool_spec, dict)
                and tool_spec.get("access", "mutation") != "query"
                and tool_name not in _TURN_TAIL_DURABLE_DECISION_TOOLS
                and decision_id
            ):
                invalidation_candidates.add((tool_name, decision_id))

    orphan_sources: set[str] = set()
    document: dict[str, Any] | None = None
    try:
        document = _load_roll_receipt_document(ctx)
    except ToolError:
        document = None
    if document is not None:
        for tool_name, by_tool in (document.get("receipts") or {}).items():
            if not isinstance(by_tool, dict):
                continue
            for decision_id, receipt in by_tool.items():
                if isinstance(receipt, dict) and str(receipt.get("roll_id")) in orphan_set:
                    orphan_sources.add(f"{tool_name}:{decision_id}")

    # Restore turn-scoped state first (only when no legitimate in-flight turn
    # owns current state); dispositions are recorded afterwards so the restore
    # cannot wipe them.
    restored: str | None = None
    if not has_pending_turn:
        try:
            restored = coc_git_history.restore_save_subset(
                ctx.root, ctx.campaign_id
            )
        except coc_git_history.GitHistoryError as exc:
            raise ToolError("history_restore_failed", str(exc)) from exc
    if restored is None:
        # With no prior finalized history baseline, quarantine cannot claim
        # that unrelated state writes were rolled back. Tombstone only the
        # exact roll-source decisions being dispositioned; otherwise canonical
        # state would remain live behind an unusable idempotency key.
        invalidation_candidates = {
            (tool_name, decision_id)
            for tool_name, decision_id in invalidation_candidates
            if f"{tool_name}:{decision_id}" in orphan_sources
        }

    now = _now_iso()
    coc_turn_finalization.record_roll_dispositions(
        ctx.campaign_dir,
        {
            roll_id: {
                "visibility": "voided",
                "reason": "unfinalized_turn_tail",
                "supersession_id": f"turn-tail-quarantine:{now}",
                "ts": now,
            }
            for roll_id in orphan_ids
        },
    )
    invalidated_decisions = ctx.ledger_invalidate(
        invalidation_candidates,
        reason="unfinalized_turn_tail",
        source="session.resume",
    )

    if document is not None:
        pending = document.get("pending_side_effects") or {}
        changed = False
        for key in list(pending):
            if str(pending.get(key)) in orphan_set:
                del pending[key]
                changed = True
        if changed:
            _save_roll_receipt_document(ctx, document)
    discarded_ticks = {"queue": 0, "claims": 0, "archive": 0}
    if orphan_sources:
        for investigator_id in ctx.party_ids():
            removed = coc_development.discard_development_ticks(
                ctx.campaign_dir, investigator_id, orphan_sources
            )
            for key in discarded_ticks:
                discarded_ticks[key] += removed[key]

    ctx.log_event({
        "event_type": "turn_tail_abandoned",
        "roll_ids": sorted(orphan_set),
        "restored_commit_snapshot": restored,
        "reason": "unfinalized_turn_tail",
        "invalidated_decisions": invalidated_decisions,
        "discarded_development_ticks": discarded_ticks,
    })
    return {
        "quarantined_orphan_rolls": sorted(orphan_set),
        "restored_commit_snapshot": restored,
        "invalidated_decisions": invalidated_decisions,
        "discarded_development_ticks": discarded_ticks,
    }

def _tool_session_begin(ctx: Ctx, args: dict[str, Any]):
    tool_name = "session.begin"
    decision_id = str(args["decision_id"])
    prior = ctx.ledger_lookup(tool_name, decision_id)
    if prior is not None:
        return prior.get("data"), [
            "duplicate decision_id: returning the previously opened session"
        ], []
    seq = coc_development.begin_table_session(ctx.campaign_dir)
    session_key = coc_development.current_table_session_key(ctx.campaign_dir)
    data = {
        "schema_version": 1,
        "table_session_seq": seq,
        "session_key": session_key,
    }
    ctx.ledger_record(decision_id, tool_name, data)
    hints = [
        "development settlement is unique per investigator per table session: "
        "end_session in this new session opens a fresh settlement boundary; "
        "a repeat end_session within one session replays the original receipt"
    ]
    return data, [], hints

def _session_resume_ending_output(ctx: Ctx) -> dict[str, Any] | None:
    ending = coc_development.structured_ending_evidence(ctx.campaign_dir)
    if ending is None:
        return None
    # An ending event is state, not player output.  Only replay a later
    # hash-bound turn.finalize transcript; if that receipt does not exist yet,
    # session.resume must expose the pending turn instead of publishing the
    # ending summary directly.
    if coc_turn_manifest.pending_manifest(ctx.campaign_dir) is not None:
        return None
    captured_at = str(ending.get("captured_at") or "")
    finalized_rows = [
        row
        for row in _read_jsonl_records(
            ctx.campaign_dir / "logs" / "table-transcript.jsonl"
        )
        if row.get("role") == "keeper"
        and isinstance(row.get("finalization_id"), str)
        and isinstance(row.get("text"), str)
        and isinstance(row.get("text_sha256"), str)
        and (not captured_at or str(row.get("ts") or "") >= captured_at)
    ]
    if not finalized_rows:
        return None
    finalized = finalized_rows[-1]
    return {
        "ending_id": ending["ending_id"],
        "scene_id": ending.get("scene_id"),
        "kind": ending.get("kind"),
        "summary": str(ending.get("summary") or "").strip(),
        "finalization_id": finalized["finalization_id"],
        "rendered_text": finalized["text"],
        "rendered_sha256": finalized["text_sha256"],
    }

# Closed model-facing projections of temporal capsule rows. Machine-internal
# integrity evidence (commit shas, text/blob digests, covers_commits) stays
# out of the recovery working set: identity and semantics travel, opaque
# bytes never do.
_TEMPORAL_EPISODE_FIELDS = (
    "episode_id", "campaign_id", "timeline_id", "turn_number",
    "finalization_receipt", "subjects_present", "entities",
)
_TEMPORAL_ASSERTION_FIELDS = (
    "assertion_id", "kind", "scope", "campaign_id", "timeline_id",
    "subject_id", "knowers", "privacy", "state", "statement", "entities",
    "occurred_turn", "valid_from_turn", "valid_until_turn",
    "superseded_by", "contradicts", "confirms", "transfer_ref",
    "source_turn", "source_receipts",
)
_TEMPORAL_HOOK_FIELDS = (
    "memory_id", "assertion_id", "kind", "status", "introduced_at",
    "possible_payoff", "planted_turn", "age_turns",
)

def _temporal_rows(rows: Any, fields: tuple[str, ...]) -> list[dict[str, Any]]:
    return [
        {key: deepcopy(row[key]) for key in fields if key in row}
        for row in rows or []
        if isinstance(row, dict)
    ]

def _empty_temporal_capsule(campaign_id: str) -> dict[str, Any]:
    """Explicit absent state; absent history is never summarized."""
    return {
        "schema_version": 1,
        "status": "no_finalized_history",
        "authority": "advisory",
        "hard_gate": False,
        "campaign_id": campaign_id,
        "timeline_id": None,
        "current_finalized_turn": None,
        "recent_episodes": [],
        "active_assertions": [],
        "open_hooks": [],
        "pending_candidates": [],
        "session_summaries": [],
    }

def _recover_temporal_history_for_resume(
    ctx: Ctx,
) -> tuple[dict[str, Any], dict[str, Any], list[str]]:
    """History-projection maintenance + bounded advisory temporal capsule.

    Recovery-only consumer of the Git/history/temporal-memory subsystem:

    1. ``rebuild_history_projection`` refreshes the deletable projection
       cache from Git history. A rebuild failure leaves the previous cache,
       Git history, and campaign evidence untouched, so it only downgrades
       the reported status with a warning — it never blocks recovery.
    2. The active timeline and current finalized turn are resolved through
       the Git history coordinator from semantic ids only. Commit shas stay
       machine-internal; the model is never asked to relay one.
    3. The capsule is built from the canonical temporal store for exactly
       the active timeline / current finalized turn, using the component's
       own bounded limits. No finalized history, no temporal store, or no
       assertions project explicit empty state. A corrupt canonical
       temporal store fails closed with a structured error instead of
       fabricating memory. Legacy Markdown memory cards are never read.
    """
    root = ctx.root
    campaign_id = str(ctx.campaign_id)
    warnings: list[str] = []
    history: dict[str, Any] = {
        "status": "rebuilt",
        "schema_generation": coc_history_projection.SCHEMA_GENERATION,
        "commit_count": 0,
        "canonical_sources_unchanged": True,
    }
    capsule = _empty_temporal_capsule(campaign_id)
    try:
        envelope = coc_history_projection.rebuild_history_projection(
            root, campaign_id,
        )
        history["commit_count"] = int(envelope.get("commit_count") or 0)
    except coc_history_projection.HistoryProjectionError as exc:
        history = {
            "status": "rebuild_failed",
            "schema_generation": coc_history_projection.SCHEMA_GENERATION,
            "reason": str(exc),
            "canonical_sources_unchanged": True,
        }
        warnings.append(
            "history projection rebuild failed; the previous projection "
            "cache, Git history, and campaign evidence are unchanged, and "
            "the temporal capsule is built without the projection cache: "
            + str(exc)
        )

    # A successful zero-commit scan proves the campaign has no Git history
    # at all yet (a deferred quick-start baseline included): report explicit
    # empty state instead of resolving refs that cannot exist.
    if (
        history.get("status") == "rebuilt"
        and int(history.get("commit_count") or 0) == 0
    ):
        return history, capsule, warnings
    try:
        active = coc_git_history.active_timeline_id(root, campaign_id)
        resolved = coc_git_history.resolve_history_selector(
            root, campaign_id, {"timeline_id": active},
        )
    except coc_git_history.GitHistoryUnavailableError as exc:
        raise ToolError(
            "git_history_unavailable",
            "campaign history recovery requires the git binary; there is no "
            "degraded mode: " + str(exc),
            details={"campaign_id": campaign_id},
        ) from exc
    except coc_git_history.GitHistoryError as exc:
        raise ToolError(
            "history_resolution_failed",
            "cannot resolve the active timeline and current finalized turn "
            "for campaign " + campaign_id + ": " + str(exc),
            details={"campaign_id": campaign_id},
        ) from exc
    capsule["timeline_id"] = active
    turn_raw = str(resolved.get("turn_number") or "")
    if resolved.get("commit_type") != "turn" or not turn_raw.isdigit():
        # History exists but the active timeline ref has no finalized turn
        # head yet (baseline-only or a fresh confluence timeline).
        return history, capsule, warnings
    turn = int(turn_raw)
    capsule["current_finalized_turn"] = turn
    # Reading never bootstraps the canonical store: an absent store is
    # reported as explicit empty state, not created during recovery.
    if not (
        coc_temporal_memory.temporal_dir(ctx.campaign_dir) / "schema.json"
    ).exists():
        capsule["status"] = "no_temporal_store"
        return history, capsule, warnings
    try:
        built = coc_temporal_memory.build_resume_projection(
            campaign_id,
            turn,
            campaign_dir=ctx.campaign_dir,
            timeline_id=active,
        )
    except (ValueError, OSError) as exc:
        raise ToolError(
            "temporal_store_corrupt",
            "the canonical temporal store for campaign " + campaign_id
            + " failed to load; resume fails closed rather than guessing "
            "memory: " + str(exc),
            details={
                "campaign_id": campaign_id,
                "timeline_id": active,
                "turn_number": turn,
            },
        ) from exc
    capsule.update({
        "status": "ready",
        "schema_generation": built.get("schema_generation"),
        "recent_episodes": _temporal_rows(
            built.get("recent_episodes"), _TEMPORAL_EPISODE_FIELDS,
        ),
        "active_assertions": _temporal_rows(
            built.get("active_assertions"), _TEMPORAL_ASSERTION_FIELDS,
        ),
        "open_hooks": _temporal_rows(
            built.get("open_hooks"), _TEMPORAL_HOOK_FIELDS,
        ),
        "pending_candidates": _temporal_rows(
            built.get("pending_candidates"), _TEMPORAL_ASSERTION_FIELDS,
        ),
        "session_summaries": deepcopy(built.get("session_summaries") or []),
    })
    return history, capsule, warnings


def _session_open_turn_anchor(
    ctx: Ctx,
    *,
    checkpoint: dict[str, Any] | None,
    temporal_capsule: dict[str, Any],
) -> dict[str, Any] | None:
    """Host-only semantic worldline/turn anchor for accepted player input.

    The anchor is rebuilt from canonical session-resume facts.  It never asks
    the model to relay a timeline, digest, or turn identity.  Missing or
    internally inconsistent history returns no anchor, so Pi declines to cache
    the next player message rather than binding it to a guessed worldline.
    """
    timeline_id = temporal_capsule.get("timeline_id")
    if not isinstance(timeline_id, str) or not timeline_id.strip():
        try:
            timeline_id = coc_git_history.active_timeline_id(
                ctx.root, str(ctx.campaign_id)
            )
        except (
            coc_git_history.GitHistoryError,
            coc_git_history.GitHistoryUnavailableError,
        ):
            return None
    timeline_id = str(timeline_id).strip()
    if not timeline_id:
        return None

    prior_turn = 0
    if isinstance(checkpoint, dict):
        raw_turn = checkpoint.get("turn_number")
        if isinstance(raw_turn, int) and not isinstance(raw_turn, bool):
            prior_turn = raw_turn
    if prior_turn < 0:
        return None
    history_turn = temporal_capsule.get("current_finalized_turn")
    if history_turn is not None and (
        isinstance(history_turn, bool)
        or not isinstance(history_turn, int)
        or history_turn != prior_turn
    ):
        return None

    prior_source_digest: str | None = None
    if prior_turn > 0:
        source = (
            checkpoint.get("source")
            if isinstance(checkpoint, dict)
            and isinstance(checkpoint.get("source"), dict)
            else {}
        )
        finalization_id = str(source.get("finalization_id") or "").strip()
        if not finalization_id:
            return None
        finalization = next(
            (
                row
                for row in reversed(
                    coc_turn_finalization.load_finalizations(ctx.campaign_dir)
                )
                if row.get("finalization_id") == finalization_id
            ),
            None,
        )
        digest = (
            str(finalization.get("source_digest") or "").strip()
            if isinstance(finalization, dict)
            else ""
        )
        if (
            not digest.startswith("sha256:")
            or len(digest) != len("sha256:") + 64
            or any(char not in "0123456789abcdef" for char in digest[7:])
        ):
            return None
        prior_source_digest = digest

    body = {
        "schema_version": 1,
        "kind": "coc_open_turn_anchor",
        "timeline_id": timeline_id,
        "prior_finalized_turn": prior_turn,
        "prior_finalized_source_digest": prior_source_digest,
        "next_turn_ordinal": prior_turn + 1,
    }
    return {**body, "anchor_digest": _canonical_digest(body)}

def _tool_session_resume(ctx: Ctx, args: dict[str, Any]):
    current_host_marker = coc_host_context.current_marker(
        ctx.root, session_id=args.get("host_session_id")
    )
    requested_epoch = args.get("context_epoch")
    if (
        current_host_marker is not None
        and requested_epoch is not None
        and int(requested_epoch) != int(current_host_marker["context_epoch"])
    ):
        raise ToolError(
            "context_epoch_conflict",
            "host context changed since this session.resume request was prepared; "
            "use the current lifecycle epoch",
        )
    ending_output = _session_resume_ending_output(ctx)
    if (
        ending_output is None
        and
        current_host_marker is not None
        and current_host_marker.get("ended_at") is None
        and current_host_marker.get("requires_resume") is False
        and current_host_marker.get("acknowledged_campaign_id")
        == str(ctx.campaign_id)
    ):
        acknowledged = coc_host_context.pending_projection(current_host_marker)
        if isinstance(acknowledged, dict):
            acknowledged["requires_resume"] = False
        data = _bound_session_resume_data({
            "schema_version": 1,
            "campaign_id": ctx.campaign_id,
            "mode": "already_acknowledged",
            "reuse_existing_working_set": True,
            "host_context": {"acknowledged": acknowledged},
            "next_operations": ["continue_from_existing_working_set"],
            "recovery_contract": {
                "authoritative_truth": [
                    "the bounded working set already returned for this exact host context epoch",
                    "deterministic receipts and canonical campaign state",
                ],
                "never": [
                    "rebuild campaign context again inside the same acknowledged epoch",
                    "reread saves, module files, or the full tool catalog",
                ],
            },
        })
        return data, [
            "session.resume already acknowledged this exact host context epoch; "
            "returning a no-op instead of rebuilding campaign context"
        ], [
            "reuse the working set and receipts already in model context; continue "
            "the current player turn without another recovery pass"
        ]

    turn_tail_quarantine = _quarantine_unbound_turn_tail(ctx)
    pending = coc_turn_manifest.pending_manifest(ctx.campaign_dir)
    if pending is None:
        reconcile_campaign_continuity(
            ctx.campaign_dir,
            ctx=ctx,
            domains=TOOLS["session.resume"].get("recovery_domains"),
        )
    archive_recovery, archive_warnings = _recover_compiled_archive_for_resume(
        ctx.campaign_dir
    )
    history_recovery, temporal_capsule, temporal_warnings = (
        _recover_temporal_history_for_resume(ctx)
    )
    revision_vector, revision_token = _continuation_revision(ctx)
    checkpoint, checkpoint_warnings = coc_continuation.ensure_latest_checkpoint(
        ctx.campaign_dir,
        revision_vector=revision_vector,
        revision_token=revision_token,
    )
    current_window = coc_turn_manifest.resume_window(
        ctx.campaign_dir,
        meaningful_tools=_turn_recovery_meaningful_tools(),
    )
    delivery = coc_continuation.delivery_projection(
        ctx.campaign_dir, checkpoint
    )
    semantic_capsule = (
        deepcopy(checkpoint["semantic_capsule"])
        if checkpoint is not None
        else coc_continuation.empty_semantic_capsule()
    )
    host_marker = coc_host_context.pending_marker(
        ctx.root, session_id=args.get("host_session_id")
    )
    host_before = coc_host_context.pending_projection(host_marker)
    unclassified_input = coc_continuation.classify_host_input(
        ctx.campaign_dir,
        coc_host_context.latest_unclassified_input(
            ctx.root,
            campaign_id=str(ctx.campaign_id),
            session_id=args.get("host_session_id"),
        ),
    )
    attempt_opportunities = _open_attempt_opportunities(
        ctx,
        scene_id=str(ctx.world().get("active_scene_id") or "") or None,
    )
    open_turn_anchor = _session_open_turn_anchor(
        ctx,
        checkpoint=checkpoint,
        temporal_capsule=temporal_capsule,
    )

    warnings = [*checkpoint_warnings, *archive_warnings, *temporal_warnings]
    hints: list[str] = []
    scene_context: dict[str, Any] | None = None
    pending_output_context: dict[str, Any] | None = None
    if ending_output is not None:
        mode = "ending"
        next_operations = []
        hints.extend([
            "this campaign already has a durable state.end_session receipt",
            "render ending_output exactly once; do not reopen narration, rerun settlement, or call turn.finalize",
        ])
    elif pending is not None:
        try:
            pending_output_context = coc_turn_finalization.build_output_context(
                ctx.campaign_dir
            )
        except coc_turn_finalization.TurnContractError as exc:
            raise ToolError(exc.code, str(exc)) from exc
        pending_output_context["narrative_opportunity"] = (
            _latest_narrative_opportunity(current_window)
        )
        mode = "pending_finalization"
        next_operations = ["turn.finalize"]
        if (
            pending_output_context.get("missing_substantive_effects")
            or pending_output_context.get("pending_modifier_consumptions")
        ):
            next_operations.insert(0, "state.exceptional_effect")
        hints.extend([
            "the journaled turn is already settled: use pending_output_context and finalize it before accepting another player action",
            "do not reroll, repeat state writes, reopen scene discovery, or regenerate deterministic mechanics",
        ])
    else:
        scene_context, scene_warnings, scene_hints = _tool_scene_context(
            ctx,
            {"investigator": args.get("investigator")},
        )
        warnings.extend(scene_warnings)
        hints.extend(scene_hints)
        if current_window["meaningful_row_count"]:
            mode = "open_turn_recovery"
            next_operations = ["continue_current_turn_from_receipts"]
            if turn_tail_quarantine.get("invalidated_decisions"):
                hints.insert(
                    0,
                    "continue semantic adjudication from current_turn.rows, but do not reuse "
                    "decision ids listed in turn_tail_quarantine.invalidated_decisions; "
                    "those abandoned receipts are invalidated rather than reusable",
                )
            else:
                hints.insert(
                    0,
                    "continue semantic adjudication from current_turn.rows; reuse successful receipts by decision_id and never reroll them",
                )
        else:
            mode = "awaiting_player"
            next_operations = ["interpret_current_player_message"]
            hints.insert(
                0,
                "the campaign is ready for the current player message; use the recovered voice, scene, and unresolved threads without rereading history",
            )

    if current_window["overflow"]:
        warnings.append(
            "the current turn exceeded the bounded inline recovery budget; reference-only rows cite exact toolbox receipts and must not be guessed"
        )
    if (
        unclassified_input is not None
        and unclassified_input.get("disposition")
        == "uncommitted_unclassified"
    ):
        hints.append(
            "host_input is unclassified transport evidence only; semantically decide whether it is a player action, meta request, or something else before journaling"
        )
    if delivery["status"] == "unconfirmed":
        hints.append(
            "the previous exact Keeper output may not have reached the player; replay only delivery.exact_text byte-for-byte if absent, without any tool or state replay"
        )
    if attempt_opportunities:
        hints.append(
            "resume preserved an unresolved ordinary failure: prefer its exact Push opportunity, a changed goal, or structured reset evidence instead of repeating the same check"
        )
    hints.append(
        "temporal_capsule is advisory per-timeline memory through the current "
        "finalized turn; rules receipts and canonical state stay authoritative, "
        "keeper_only rows never reach the player, and absent history is "
        "reported as absent rather than summarized"
    )

    data: dict[str, Any] = {
        "schema_version": 1,
        "campaign_id": ctx.campaign_id,
        "mode": mode,
        "working_set": {
            "mode": "full",
            "revision": revision_token,
            "read_domains": revision_vector,
        },
        "checkpoint": (
            {
                key: deepcopy(checkpoint[key])
                for key in (
                    "schema_version", "kind", "campaign_id", "checkpoint_id",
                    "turn_number", "status", "created_at", "source",
                    "canonical_projection", "refs", "content_sha256",
                )
                if key in checkpoint
            }
            if checkpoint is not None
            else None
        ),
        "semantic_capsule": semantic_capsule,
        "delivery": delivery,
        "current_turn": current_window,
        "pending_turn": deepcopy(pending),
        "pending_output_context": pending_output_context,
        "ending_output": ending_output,
        "scene_context": scene_context,
        "host_input": unclassified_input,
        "host_context": {
            "before_resume": host_before,
            "acknowledged": None,
        },
        "operation_opportunities": attempt_opportunities,
        "compiled_archive_recovery": archive_recovery,
        "history_projection_recovery": history_recovery,
        "temporal_capsule": temporal_capsule,
        "turn_tail_quarantine": turn_tail_quarantine,
        "next_operations": next_operations,
        "recovery_contract": {
            "authoritative_truth": [
                "deterministic rules receipts and canonical state",
                "canonical_projection.time and scene_context.time override any time claim in summary prose",
                "turn finalization receipt and exact transcript",
                "KP-authored semantic capsule",
                "rebuildable continuation checkpoint",
            ],
            "never": [
                "reroll or reapply a successful receipt",
                "treat checkpoint prose as a second state ledger",
                "promote unclassified host input to campaign fact automatically",
                "drop scene craft, NPC agency, causality, or Table Wit after compaction",
                "derive exact elapsed time from narrative prose or expose backend clock arithmetic to the player",
            ],
        },
    }
    if open_turn_anchor is not None:
        data["open_turn_anchor"] = open_turn_anchor
    if ctx.campaign_dir is not None:
        try:
            campaign_row = coc_state.load_campaign_state(ctx.campaign_dir)
        except (OSError, ValueError):
            campaign_row = {}
        has_playable_investigator = bool(ctx.party_ids())
        if (
            isinstance(campaign_row, dict)
            and campaign_row.get("status") in {"ready_for_table", "active"}
            and has_playable_investigator
            and not _table_transcript_rows(ctx)
            and not str(
                _read_optional_json(
                    ctx.campaign_dir / "save" / "turn-source-cursor.json", {}
                ).get("last_finalized_turn_id")
                or ""
            ).strip()
            and data.get("mode") == "awaiting_player"
        ):
            data["mode"] = "table_opening"
            data["next_operations"] = ["evidence.table_opening"]
            hints.insert(
                0,
                "the playable campaign has no table transcript yet; open the table with "
                "evidence.table_opening rather than character setup",
            )
        character_creation = _character_creation_resume_projection(
            ctx.campaign_dir,
            str(ctx.campaign_id),
        )
        if character_creation is not None:
            data["character_creation"] = character_creation
            if character_creation.get("briefing_path"):
                hints.append(
                    "character creation is incomplete: read the exact "
                    "character_creation.briefing_path once, rooted at the "
                    "current workspace, before the first creation question; "
                    "do not invent era, place, mood, or characteristic "
                    "generation methods"
                )
            else:
                hints.append(
                    "character creation is incomplete: invoke "
                    "character_creation.render_operation exactly, then read "
                    "the returned briefing_path; do not invent era, place, "
                    "mood, or characteristic generation methods"
                )
    acknowledged = coc_host_context.acknowledge_resume(
        ctx.root,
        campaign_id=str(ctx.campaign_id),
        checkpoint_id=(
            str(checkpoint["checkpoint_id"])
            if checkpoint is not None
            else None
        ),
        session_id=args.get("host_session_id"),
        context_epoch=args.get("context_epoch"),
    )
    data["host_context"]["acknowledged"] = (
        coc_host_context.pending_projection(acknowledged)
        if acknowledged is not None
        else None
    )
    if isinstance(data["host_context"]["acknowledged"], dict):
        data["host_context"]["acknowledged"]["requires_resume"] = False
    data = _bound_session_resume_data(data)
    if data["resume_budget"]["reductions"]:
        hints.append(
            "resume projections exceeded the inline budget; use the returned exact typed read cards instead of scanning files"
        )
    return data, warnings, hints

def _tool_session_continuation_detail(ctx: Ctx, args: dict[str, Any]):
    section = str(args.get("section") or "").strip()
    allowed = {
        "recent_summaries": "turn_number",
        "threads": "thread_id",
        "confirmed_decisions": "decision_id",
        "do_not_repeat": "item_id",
        "style_commitments": None,
        "current_turn": "call_index",
    }
    if section not in allowed:
        raise ToolError("invalid_param", "unknown continuation detail section")
    offset = int(args.get("offset") or 0)
    limit = int(args.get("limit") or 4)
    if offset < 0 or not 1 <= limit <= 8:
        raise ToolError(
            "invalid_param", "offset must be non-negative and limit must be 1..8"
        )
    requested_ids = args.get("ids") or []
    if (
        not isinstance(requested_ids, list)
        or len(requested_ids) > 16
        or any(not isinstance(value, str) or not value for value in requested_ids)
    ):
        raise ToolError("invalid_param", "ids must contain at most 16 exact strings")

    if section == "current_turn":
        source = coc_turn_manifest.resume_window(
            ctx.campaign_dir,
            meaningful_tools=_turn_recovery_meaningful_tools(),
        )
        rows = deepcopy(source.get("rows") or [])
        source_identity = source.get("source_digest")
    else:
        checkpoint = coc_continuation.load_latest_checkpoint(ctx.campaign_dir)
        capsule = (
            checkpoint.get("semantic_capsule")
            if isinstance(checkpoint, dict)
            else coc_continuation.empty_semantic_capsule()
        )
        rows = deepcopy(capsule.get(section) or [])
        source_identity = (
            checkpoint.get("content_sha256")
            if isinstance(checkpoint, dict)
            else None
        )
    id_field = allowed[section]
    if requested_ids:
        wanted = {str(value) for value in requested_ids}
        if id_field is None:
            rows = [row for row in rows if str(row) in wanted]
        else:
            rows = [
                row for row in rows
                if isinstance(row, dict) and str(row.get(id_field)) in wanted
            ]
    total = len(rows)
    page = rows[offset : offset + limit]
    next_offset = offset + len(page)
    data = {
        "schema_version": 1,
        "campaign_id": ctx.campaign_id,
        "section": section,
        "source_identity": source_identity,
        "section_sha256": _canonical_digest(rows),
        "offset": offset,
        "returned": len(page),
        "total": total,
        "rows": page,
        "next_offset": next_offset if next_offset < total else None,
    }
    if data["next_offset"] is not None:
        data["next_page_operation"] = {
            "operation": "session.continuation_detail",
            "invoke_via": "coc_invoke",
            "prefilled_arguments": {
                "section": section,
                "offset": data["next_offset"],
                "limit": limit,
                **({"ids": requested_ids} if requested_ids else {}),
            },
            "missing_arguments": [],
            "authority": "advisory",
            "hard_gate": False,
        }
    return data, [], [
        "this is an exact paged continuation projection; use only facts relevant to the current semantic decision and retain the compact working set",
    ]

_DELIVERY_REPLAY_MAX_CHUNK_BYTES = 4096


def _exact_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _utf8_chunk_end(data: bytes, start: int, limit: int) -> int:
    """One bounded chunk end that never splits a UTF-8 code point."""
    end = min(start + limit, len(data))
    if end < len(data):
        while end > start and (data[end] & 0xC0) == 0x80:
            end -= 1
        if end == start:
            # A single code point larger than the limit: emit it whole.
            end = start + 1
            while end < len(data) and (data[end] & 0xC0) == 0x80:
                end += 1
    return end


def _delivery_replay_chunk(ctx: Ctx, args: dict[str, Any]):
    """Host-bound exact replay of the latest canonical delivery.

    Replay targets the durable latest continuation delivery, so the model
    never copies finalization identity. Machine-injected identity arguments
    are validated strictly against that latest delivery. This stays a pure
    query: the host emits the exact chunks and owns any delivery ack.
    """
    checkpoint = coc_continuation.load_latest_checkpoint(ctx.campaign_dir)
    if checkpoint is None:
        raise ToolError(
            "no_finalized_turn", "no finalized delivery exists to replay"
        )
    source = checkpoint["source"]
    latest_id = str(source["finalization_id"])
    latest_sha = str(source["rendered_text_sha256"])
    for arg_name, expected in (
        ("finalization_id", latest_id),
        ("rendered_sha256", latest_sha),
    ):
        supplied = args.get(arg_name)
        if supplied is not None and str(supplied) != expected:
            raise ToolError(
                "delivery_conflict",
                "replay identity does not match the latest canonical delivery",
            )
    receipt = coc_turn_finalization.finalization_by_id(ctx.campaign_dir, latest_id)
    if (
        not isinstance(receipt, dict)
        or receipt.get("rendered_text_sha256") != latest_sha
    ):
        raise ToolError(
            "delivery_conflict",
            "latest canonical delivery receipt is missing or drifted",
        )
    rendered = receipt.get("rendered_text")
    if not isinstance(rendered, str):
        raise ToolError(
            "state_corrupt", "latest canonical delivery has no rendered text"
        )
    if coc_turn_finalization.canonical_digest(rendered) != latest_sha:
        raise ToolError(
            "delivery_conflict",
            "latest canonical delivery text no longer matches its receipt hash",
        )
    data = rendered.encode("utf-8")
    total_bytes = len(data)
    raw_offset = args.get("text_offset")
    if raw_offset is None:
        offset = 0
    elif _exact_int(raw_offset) and 0 <= raw_offset <= total_bytes:
        offset = raw_offset
    else:
        raise ToolError(
            "invalid_param",
            "text_offset must be a byte offset inside the canonical text",
        )
    raw_limit = args.get("text_limit")
    if raw_limit is None:
        limit = _DELIVERY_REPLAY_MAX_CHUNK_BYTES
    elif (
        _exact_int(raw_limit)
        and 0 < raw_limit <= _DELIVERY_REPLAY_MAX_CHUNK_BYTES
    ):
        limit = raw_limit
    else:
        raise ToolError(
            "invalid_param",
            "text_limit must be a positive byte count up to "
            + str(_DELIVERY_REPLAY_MAX_CHUNK_BYTES),
        )
    while offset < total_bytes and (data[offset] & 0xC0) == 0x80:
        offset += 1
    end = _utf8_chunk_end(data, offset, limit)
    # Ordinal/count are semantic chunk facts under the requested limit; the
    # host loop follows next_offset boundaries, so they stay exact there.
    ordinal = 0
    position = 0
    while position < offset:
        position = _utf8_chunk_end(data, position, limit)
        ordinal += 1
    total_chunks = ordinal + 1
    cursor = end
    while cursor < total_bytes:
        cursor = _utf8_chunk_end(data, cursor, limit)
        total_chunks += 1
    next_offset = end if end < total_bytes else None
    return {
        "mode": "replay",
        "finalization_id": latest_id,
        "accepted_revision": source.get("accepted_revision"),
        "rendered_text_sha256": latest_sha,
        "rendered_sha256": latest_sha,
        "text": data[offset:end].decode("utf-8"),
        "text_offset": offset,
        "returned_bytes": end - offset,
        "total_bytes": total_bytes,
        "chunk_ordinal": ordinal,
        "chunk_count": total_chunks,
        "final": next_offset is None,
        "next_offset": next_offset,
    }, [], [
        "host-owned replay: emit this exact text chunk untrimmed, follow "
        "next_offset to completion, and never regenerate or extend the "
        "canonical wording",
    ]


def _tool_session_delivery_text(ctx: Ctx, args: dict[str, Any]):
    mode = args.get("mode")
    if mode is not None:
        normalized_mode = str(mode)
        if normalized_mode == "replay":
            return _delivery_replay_chunk(ctx, args)
        if normalized_mode != "context":
            raise ToolError(
                "invalid_param", "mode must be 'context' or 'replay'"
            )
    receipt = coc_turn_finalization.finalization_by_id(
        ctx.campaign_dir, str(args["finalization_id"])
    )
    if (
        not isinstance(receipt, dict)
        or receipt.get("rendered_text_sha256") != str(args["rendered_sha256"])
    ):
        raise ToolError(
            "delivery_conflict",
            "requested delivery text does not match the canonical finalization",
        )
    return {
        "finalization_id": receipt["finalization_id"],
        "accepted_revision": receipt["accepted_revision"],
        "rendered_text_sha256": receipt["rendered_text_sha256"],
        "rendered_sha256": receipt["rendered_text_sha256"],
        "exact_text": receipt["rendered_text"],
    }, [], [
        "replay exact_text byte-for-byte only when the player did not receive it; never regenerate equivalent prose"
    ]

def _tool_session_delivery_ack(ctx: Ctx, args: dict[str, Any]):
    receipt = coc_continuation.acknowledge_delivery(
        ctx.campaign_dir,
        finalization_id=str(args["finalization_id"]),
        rendered_sha256=str(args["rendered_sha256"]),
        ack_kind=str(args["ack_kind"]),
        source_id=str(args["source_id"]),
    )
    return receipt, [], [
        "delivery confirmation closes transport uncertainty only; it does not create a new played turn"
    ]

def _opening_first_impression_lines(
    ctx: Ctx,
    *,
    run_id: str,
    presented_roll_ids: Any,
) -> tuple[list[str], list[str]]:
    if not isinstance(presented_roll_ids, list):
        raise ToolError("invalid_param", "presented_roll_ids must be an ordered list")
    roll_ids = list(presented_roll_ids)
    if any(
        not isinstance(value, str) or not value or value != value.strip()
        for value in roll_ids
    ):
        raise ToolError(
            "invalid_param", "presented_roll_ids must contain non-empty roll_id strings"
        )
    if len(set(roll_ids)) != len(roll_ids):
        raise ToolError("invalid_param", "presented_roll_ids must not contain duplicates")
    campaign_id = coc_npc_event_chain.resolve_campaign_id(ctx.campaign_dir)
    try:
        document = coc_first_impression.load_document(ctx.campaign_dir, campaign_id)
    except ValueError as exc:
        raise ToolError("state_corrupt", str(exc)) from exc
    receipts_by_roll_id = {
        str(receipt.get("roll_id")): receipt
        for receipt in document.get("receipts", {}).values()
        if isinstance(receipt, dict) and receipt.get("schema_version") == 2
    }

    def bind(roll_id: str, receipt: dict[str, Any], *, require_run: bool) -> str | None:
        record = receipt.get("roll_record")
        if (
            receipt.get("campaign_id") != campaign_id
            or (require_run and receipt.get("run_id") != run_id)
            or not isinstance(record, dict)
            or record.get("roll_id") != roll_id
            or record.get("kind") != "npc_first_impression"
            or record.get("visibility") != "public"
        ):
            return None
        _ensure_first_impression_roll(ctx, receipt)
        return coc_turn_finalization._render_public_roll(
            record,
            play_language=_campaign_play_language(ctx),
        )

    rendered: list[str] = []
    accepted: list[str] = []
    for roll_id in roll_ids:
        receipt = receipts_by_roll_id.get(roll_id)
        if not isinstance(receipt, dict):
            continue
        line = bind(roll_id, receipt, require_run=True)
        if line is None:
            continue
        accepted.append(roll_id)
        rendered.append(line)
    if accepted:
        return accepted, rendered
    for roll_id, receipt in receipts_by_roll_id.items():
        if not isinstance(receipt, dict):
            continue
        line = bind(roll_id, receipt, require_run=False)
        if line is None:
            continue
        accepted.append(roll_id)
        rendered.append(line)
    return accepted, rendered

def _opening_text_with_public_rolls(text: str, rendered_lines: list[str]) -> str:
    if not rendered_lines:
        return text
    mechanics_block = "[roll]\n" + "\n".join(rendered_lines) + "\n[/roll]"
    closing_marker = "[/in_game]"
    marker_index = text.rfind(closing_marker)
    if marker_index < 0:
        return text.rstrip() + "\n\n" + mechanics_block
    before = text[:marker_index].rstrip()
    after = text[marker_index:]
    prefix = before + "\n\n" if before else ""
    return prefix + mechanics_block + "\n" + after

def _current_opening_time_anchor(ctx: Ctx) -> dict[str, Any]:
    stamp = coc_time.current_stamp(ctx.campaign_dir)
    player_time = (
        deepcopy(stamp.get("player_time"))
        if isinstance(stamp.get("player_time"), dict) else {}
    )
    display = str(stamp.get("display") or "").strip()
    if not display:
        display = coc_language.player_time_label(
            player_time,
            _campaign_play_language(ctx),
        )
    language = _campaign_play_language(ctx)
    label = "开场时间" if language.startswith("zh") else "Opening time"
    return {
        "schema_version": 1,
        "display": display,
        "player_time": player_time,
        "source_ref": player_time.get("source_ref"),
        "rendered_line": f"【{label}】{display}",
    }

def _opening_text_with_time_anchor(
    text: str,
    anchor: dict[str, Any],
) -> str:
    rendered = str(anchor.get("rendered_line") or "").strip()
    if not rendered:
        return text
    opening_marker = "[in_game]"
    marker_index = text.find(opening_marker)
    if marker_index < 0:
        return rendered + "\n\n" + text.lstrip()
    insert_at = marker_index + len(opening_marker)
    before = text[:insert_at].rstrip()
    after = text[insert_at:].lstrip("\n")
    return before + "\n" + rendered + ("\n\n" + after if after else "")

def _require_projected_opening_source(ctx: Ctx) -> None:
    """Block a fabricated opening while the source lane is pending or failed.

    Character creation runs in parallel with the background source build; this
    is where the two lanes rejoin. A source-bound campaign may only open from a
    parsed, verified, projected opening, so a still-running parse blocks here and
    a failed parse is reported instead of improvised.
    """
    if ctx.campaign_dir is None:
        return
    readiness = coc_module_project.opening_source_readiness(ctx.campaign_dir)
    state = str(readiness.get("state") or "")
    if state in {
        coc_module_project.OPENING_SOURCE_NOT_GATED,
        coc_module_project.OPENING_SOURCE_READY,
    }:
        return
    if state == coc_module_project.OPENING_SOURCE_FAILED:
        last_error = readiness.get("last_error")
        detail = ""
        if isinstance(last_error, dict):
            code = str(last_error.get("code") or "").strip()
            message = str(last_error.get("message") or "").strip()
            detail = f" ({code or 'error'}: {message})" if message or code else ""
        raise ToolError(
            "opening_source_failed",
            "the bound source opening failed to parse and project"
            f"{detail}; report this failure instead of inventing an opening",
        )
    if state == coc_module_project.OPENING_SOURCE_NOT_PREPARED:
        raise ToolError(
            "opening_source_not_prepared",
            "this campaign is source-bound but no opening projection was ever "
            "prepared; run the canonical opening bootstrap before opening the table",
        )
    raise ToolError(
        "opening_source_pending",
        "the background source parse has not projected the opening yet "
        f"({readiness.get('reason')}); wait for its terminal lifecycle notice "
        "rather than opening the table now",
    )

def _table_opening_default_decision_id(campaign_id: str) -> str:
    return f"table-opening:{campaign_id}:opening-1"


def _table_opening_default_run_id(campaign_id: str) -> str:
    return f"run-{campaign_id}"


def _tool_evidence_table_opening(ctx: Ctx, args: dict[str, Any]):
    campaign_id = str(ctx.campaign_id or "").strip()
    raw_decision_id = str(args.get("decision_id") or "")
    decision_id = raw_decision_id.strip()
    if not decision_id:
        if not campaign_id:
            raise ToolError(
                "invalid_param",
                "evidence.table_opening requires a stable decision_id",
            )
        decision_id = _table_opening_default_decision_id(campaign_id)
    elif decision_id != raw_decision_id:
        raise ToolError("invalid_param", "evidence.table_opening requires a stable decision_id")
    raw_run_id = str(args.get("run_id") or "")
    run_id = raw_run_id.strip()
    if not run_id:
        if not campaign_id:
            raise ToolError(
                "invalid_param",
                "evidence.table_opening requires a stable run_id",
            )
        run_id = _table_opening_default_run_id(campaign_id)
    elif run_id != raw_run_id:
        raise ToolError("invalid_param", "evidence.table_opening requires a stable run_id")
    run_binding = _run_segment_binding(ctx, supplied_alias=run_id, opening=True)
    run_id = str(run_binding["run_segment_id"])
    prior = ctx.ledger_lookup("evidence.table_opening", decision_id)
    presented_roll_ids, rendered_lines = _opening_first_impression_lines(
        ctx,
        run_id=run_id,
        presented_roll_ids=args.get("presented_roll_ids"),
    )
    prior_data = (
        prior.get("data")
        if isinstance(prior, dict) and isinstance(prior.get("data"), dict)
        else None
    )
    prior_anchor = (
        prior_data.get("authoritative_time_anchor")
        if isinstance(prior_data, dict) else None
    )
    time_anchor = (
        deepcopy(prior_anchor)
        if isinstance(prior_anchor, dict)
        else _current_opening_time_anchor(ctx)
    )
    exact_text = _opening_text_with_time_anchor(
        _opening_text_with_public_rolls(
            str(args.get("text") or ""), rendered_lines
        ),
        time_anchor,
    )
    if prior is not None:
        entry = _record_table_transcript_entry(
            ctx,
            role="keeper",
            text=exact_text,
            run_id=run_id,
            turn_number=0,
            turn_id=f"opening:{run_id}",
            journal_decision_id="",
            source_id=decision_id,
            speaker=str(args.get("speaker") or "KP"),
            presented_roll_ids=presented_roll_ids,
            run_segment_source=str(run_binding["source"]),
            run_segment_trust=str(run_binding["trust"]),
        )
        entry["authoritative_time_anchor"] = time_anchor
        return entry, ["duplicate decision_id: returning the immutable opening transcript row"], []
    if _table_transcript_rows(ctx):
        raise ToolError(
            "opening_already_started",
            "the table transcript already contains dialogue; an opening cannot be inserted later",
        )
    _require_projected_opening_source(ctx)
    entry = _record_table_transcript_entry(
        ctx,
        role="keeper",
        text=exact_text,
        run_id=run_id,
        turn_number=0,
        turn_id=f"opening:{run_id}",
        journal_decision_id="",
        source_id=decision_id,
        speaker=str(args.get("speaker") or "KP"),
        presented_roll_ids=presented_roll_ids,
        run_segment_source=str(run_binding["source"]),
        run_segment_trust=str(run_binding["trust"]),
    )
    entry["authoritative_time_anchor"] = time_anchor
    # Advisory candidate set only. Opening cards stay undelivered until the
    # KP records the actual handoff through state.deliver_handout.
    opening_candidates = coc_handouts.HandoutCatalog.load(ctx).opening_candidates(
        ctx.world()
    )
    if opening_candidates:
        entry["pending_opening_handouts"] = opening_candidates
    ctx.ledger_record(decision_id, "evidence.table_opening", entry)
    hints = [
        "deliver data.text exactly; its authoritative opening-time anchor and "
        "deterministic public first-impression block are canonical and must not "
        "be contradicted, recomputed, rewritten, or duplicated",
    ]
    if opening_candidates:
        hints.append(
            "opening handout cards are staged but not yet delivered — hand them "
            "to the players with state.deliver_handout as the opening fiction "
            "presents them, then render the card body verbatim"
        )
    return entry, [], hints

def register_operations(registry) -> None:
    global TOOLS
    TOOLS = registry.legacy_tools
    registry.tool(
    "setup.inspect",
    "Inspect canonical pre-session onboarding state: campaigns, investigators, built-in starters/pregens, and setup operation ids. Use in an empty or unknown workspace instead of searching files.",
    {},
    needs_campaign=False,
    access="query",
)(_tool_setup_inspect)
    registry.tool(
    "setup.phase",
    "Read the single derived opening lifecycle phase for one campaign: "
    "module_preparation, character_creation, ready_for_table, or active, with "
    "the source sub-phase detail, the canonical next operation, and any "
    "blocking reason. Use this instead of inferring setup progress from files, "
    "party listings, or failed-call envelopes.",
    {
        "campaign_id": {
            "type": "string",
            "pattern": r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
            "desc": "campaign to derive; defaults to the current campaign",
        },
    },
    needs_campaign=False,
    access="query",
    read_domains=("setup",),
    write_domains=(),
    recovery_domains=(),
    response_mode="full",
    audit_mode="reference",
    strict_read_only=True,
    execution_class="parallel_read",
)(_tool_setup_phase)
    registry.tool(
    "setup.quick_start",
    "Create a canonical built-in starter campaign through the shared setup gateway, optionally linking a shipped pregen. Omit pregen_id when the starter's public pregen list is empty; the campaign binds the scenario and returns needs_investigator so existing character creation can finish. A selected campaign id that does not exist yet is the campaign_id for this first mutation — do not call campaign.create first. Do not call this when a setup campaign already exists; omitting campaign_id creates {scenario_id}-qs. Reuse the same semantic decision_id only to recover the exact same request after transport loss. The starter path defaults player-visible play_language to zh-Hans.",
    {
        "scenario_id": {
            "type": "string",
            "required": True,
            "desc": "exact built-in scenario_id returned by setup.inspect",
        },
        "decision_id": {
            "type": "string",
            "pattern": coc_runtime_ops.QUICK_START_DECISION_ID_PATTERN,
            "desc": "optional semantic retry identity such as quick-start:the-haunting:attempt-1; retain it unchanged only when retrying the exact same request after an unavailable response. When omitted, canonical runtime owns the stable campaign-scoped semantic decision id",
        },
        "pregen_id": {
            "type": "string",
            "desc": "optional exact public pregen_id from setup.inspect; omit when that starter listed none. Omitted is investigator-less; an empty string or unknown id is invalid",
        },
        "campaign_id": {
            "type": "string",
            "desc": "optional stable campaign id; omit to create {scenario_id}-qs. Pass a launcher-selected nonexistent id here as the first mutation. Forbidden when a setup campaign already exists",
        },
        "title": {
            "type": "string",
            "desc": "optional campaign title",
        },
        "play_register": {
            "type": "string",
            "enum": ["purist", "pulp"],
            "desc": (
                "the table's register: 'purist' for philosophical horror where "
                "uncovering the truth dooms the seeker, 'pulp' for desperate "
                "two-fisted action. Pass it only when the player states a "
                "preference; omit it otherwise, because the core rulebook "
                "supports the range between them and a guessed pole reads as "
                "authored intent"
            ),
        },
    },
    needs_campaign=False,
    access="mutation",
    write_domains=("setup",),
)(_tool_setup_quick_start)
    registry.tool(
    "setup.complete",
    "Handoff a finished setup campaign to play: require a bound current-schema scenario (active_scenario_id plus compiled built-in or source-module readiness), a confirmed investigator, and (when source-bound) a terminal opening projection; persist ready_for_table and emit the setup-session exit receipt.",
    {
        "campaign_id": {
            "type": "string",
            "required": True,
            "pattern": r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
            "desc": "exact existing campaign id to hand off",
        },
        "decision_id": {
            "type": "string",
            "required": True,
            "desc": "idempotency key for the handoff receipt",
        },
    },
    needs_campaign=False,
    access="mutation",
    write_domains=("setup",),
)(_tool_setup_complete)
    registry.tool(
    "setup.chargen_run",
    "In-process deterministic Quick Fire investigator: occupation table + "
    "assignment_priority → create → link → render_card under the session lock. "
    "Do not hand-assemble investigator.create. Do not call setup.quick_start "
    "when a setup campaign already exists.",
    {
        "campaign_id": {
            "type": "string",
            "required": True,
            "pattern": r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
            "desc": "existing campaign to link the investigator into",
        },
        "investigator_id": {
            "type": "string",
            "required": True,
            "pattern": r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
            "desc": "new reusable investigator id",
        },
        "name": {
            "type": "string",
            "required": True,
            "desc": "investigator display name",
        },
        "occupation_name": {
            "type": "string",
            "required": True,
            "desc": "sample occupation name from occupations.json, or a concept if skill names are supplied",
        },
        "assignment_priority": {
            "type": "array",
            "minItems": 8,
            "maxItems": 8,
            "uniqueItems": True,
            "items": {
                "type": "string",
                "enum": ["STR", "CON", "SIZ", "DEX", "APP", "INT", "POW", "EDU"],
            },
            "desc": "eight unique characteristic keys in Quick Fire descending priority",
        },
        "occupation_skill_names": {
            "type": "array",
            "items": {"type": "string"},
            "desc": "optional concrete occupation skill names",
        },
        "interest_skill_names": {
            "type": "array",
            "items": {"type": "string"},
            "desc": "optional personal-interest skill names",
        },
        "luck": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "mode": {"type": "string", "enum": ["auto_roll"]},
            },
            "required_fields": ["mode"],
            "desc": "optional {mode:auto_roll}; default auto_roll",
        },
        "age": {
            "type": "integer",
            "minimum": 15,
            "maximum": 89,
            "desc": "optional age 15-89; default 27. Runtime applies full age modifiers.",
        },
        "occupation_label": {
            "type": "string",
            "desc": "player-facing zh-Hans occupation; required when occupation_name is a catalog English key",
        },
        "own_language": {
            "type": "string",
            "desc": "concrete own-language name in play_language (e.g. 英语/国语); machine skill key stays Language (Own)",
        },
        "backstory": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "personal_description": {"type": "string"},
                "ideology_beliefs": {"type": "string"},
                "significant_people": {"type": "string"},
                "meaningful_locations": {"type": "string"},
                "treasured_possessions": {"type": "string"},
                "traits": {"type": "string"},
                "injuries_scars": {"type": "string"},
                "phobias_manias": {"type": "string"},
                "encounters": {"type": "string"},
                "scenario_bound": {"type": "string"},
            },
            "desc": "optional p.157 backstory plus scenario_bound; closed keys; prose only",
        },
        "equipment": {
            "type": "array",
            "items": {"type": "string"},
            "desc": "optional era-fitting carried items as strings; no costs or numeric values",
        },
        "key_connection": {
            "type": "object",
            "additionalProperties": False,
            "required_fields": ["backstory_field", "summary"],
            "properties": {
                "backstory_field": {
                    "type": "string",
                    "enum": [
                        "personal_description",
                        "ideology_beliefs",
                        "significant_people",
                        "meaningful_locations",
                        "treasured_possessions",
                        "traits",
                    ],
                },
                "summary": {"type": "string"},
            },
            "desc": "starred key connection from a backstory field written this chargen",
        },
    },
    needs_campaign=False,
    access="mutation",
    write_domains=("setup",),
)(_tool_setup_chargen_run)
    registry.tool(
    "setup.investigator_contract",
    "Return the active campaign ruleset's package-owned, versioned construction "
    "contract for the complete investigator.create payload. Query this once "
    "after campaign creation instead of guessing ruleset-specific sheet fields.",
    {
        "campaign_id": {
            "type": "string",
            "required": True,
            "pattern": r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
            "desc": "exact existing campaign id whose bound ruleset owns the contract",
        },
    },
    needs_campaign=False,
    access="query",
    read_domains=("setup",),
    write_domains=(),
    recovery_domains=(),
    response_mode="full",
    audit_mode="reference",
    strict_read_only=True,
)(_tool_setup_investigator_contract)
    registry.tool(
    "setup.adopt_source_facts",
    "Adopt the six source-grounded opening facts after scenario.bind_pdf and "
    "before investigator construction. Every source or unresolved answer must "
    "cite accepted pages inspected in the campaign's current bound bundle.",
    {
        "campaign_id": {
            "type": "string",
            "required": True,
            "pattern": r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
        },
        "facts": {
            **deepcopy(_OPENING_FAST_FACTS_TOOL_SCHEMA),
            "required": True,
        },
    },
    needs_campaign=False,
    access="mutation",
    write_domains=("setup",),
)(_tool_setup_adopt_source_facts)
    registry.tool(
    "setup.player_vocabulary",
    "Supply the player-visible vocabulary this campaign renders itself with, "
    "in the table's own language. Two kinds of key share one map: a bare key "
    "is rulebook terminology the module and Keeper both use (`Spot Hidden`), "
    "and a `chrome.` key is host render furniture only the finalizer emits "
    "(`chrome.change_tag`). The prefix is what stops one overwriting the "
    "other, and a misspelled `chrome.` key is rejected rather than ignored, "
    "because ignoring it leaves the table one label short of complete forever. "
    "The receipt reports chrome coverage rather than success: a partial "
    "vocabulary renders some words in this language and the rest in English. "
    "Languages with a built-in table (zh-Hans, en-US, ja-JP) are already "
    "complete and need this only to override a specific label.",
    {
        "campaign_id": {
            "type": "string",
            "required": True,
            "pattern": r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
        },
        "language": {
            "type": "string",
            "desc": "language tag to write under; defaults to the campaign's play_language",
        },
        "entries": {
            "type": "object",
            "required": True,
            "desc": (
                "vocabulary map: bare keys are rulebook terms, `chrome.<label>` "
                "keys are host render furniture. Values are the player-visible "
                "strings in this campaign's language"
            ),
        },
    },
    needs_campaign=False,
    access="mutation",
    write_domains=("setup",),
)(_tool_setup_player_vocabulary)
    registry.tool(
    "setup.invoke",
    "Invoke one existing canonical custom-campaign setup operation. This thin "
    "MCP-facing gateway delegates schema, source-bundle, path, and state "
    "validation to the shared pre-session setup runtime.",
    {
        "kind": {
            "type": "string",
            "required": True,
            "enum": list(_CUSTOM_SETUP_OPERATION_KINDS),
            "desc": "exact custom setup operation kind",
        },
        "payload": {
            "type": "object",
            "required": True,
            "desc": (
                "exact payload for the selected kind: campaign.create requires "
                "campaign_id/title and optionally ruleset_id/era/play_language/start_clock/play_register, "
                "where play_register is 'purist' or 'pulp' and decides how much "
                "levity the table's register carries -- omit it when the table "
                "has not chosen, because the core rulebook supports the range "
                "between them and a guessed pole reads as authored intent; "
                "and an omitted era stays unestablished rather than defaulting; "
                "actor.create requires campaign_id/actor_id/sheet and delegates "
                "validation to that campaign's ruleset; "
                "investigator.create requires investigator_id/sheet and optionally "
                "creation; deterministic Quick Fire additionally requires the "
                "current campaign_id and may omit sheet characteristics/derived when "
                "creation supplies characteristic_assignment_order plus either luck auto_roll "
                "or luck_roll_total plus that campaign's exact luck_roll_receipt; "
                "semantic Quick Fire payload is name/occupation/assignment_order/interest allocations "
                "and optional creation.luck={mode:auto_roll} — runtime owns INT*2 budget and Luck receipt; "
                "campaign.link_investigator requires exactly "
                "campaign_id/investigator_ids; scenario.bind_pdf requires "
                "campaign_id/scenario_id/title/source_bundle_path and optionally "
                "compile_now; playable-opening review authority is never a "
                "public setup payload; "
                "campaign.render_briefing requires campaign_id and "
                "optionally language; investigator.render_card requires "
                "campaign_id/investigator_id and optionally language/html_mode. "
                "Per-kind allowed fields are enforced by the canonical setup runtime. "
                "For installed-host progressive binding, omit compile_now or "
                "pass false; true requires the repository cold compiler runtime "
                "and is not part of the opening critical path"
            ),
            "properties": {
                "campaign_id": {"type": "string"},
                "actor_id": {"type": "string"},
                "title": {"type": "string"},
                "era": {"type": "string"},
                "play_language": {"type": "string"},
                "ruleset_id": {"type": "string"},
                "start_clock": {
                    "type": "object",
                    "additionalProperties": True,
                },
                "investigator_id": {"type": "string"},
                "sheet": {
                    "type": "object",
                    "additionalProperties": True,
                },
                "creation": {
                    "type": "object",
                    "additionalProperties": True,
                },
                "investigator_ids": {
                    "type": "array",
                    "minItems": 1,
                    "uniqueItems": True,
                    "items": {"type": "string"},
                },
                "scenario_id": {"type": "string"},
                "source_bundle_path": {"type": "string"},
                "language": {"type": "string"},
                "html_mode": {
                    "type": "string",
                    "enum": ["never", "auto", "always"],
                    "desc": "character-card HTML rendering mode",
                },
                "compile_now": {
                    "type": "boolean",
                    "desc": (
                        "optional cold full-module compile request; omit or pass "
                        "false for installed-host progressive import. true is "
                        "accepted only when the repository compiler runtime is "
                        "available and must not block the playable opening"
                    ),
                },
            },
            "additionalProperties": False,
        },
    },
    needs_campaign=False,
    access="mutation",
    write_domains=("setup",),
)(_tool_setup_invoke)
    registry.tool(
    "session.begin",
    "Open a new table session: advances the durable session cursor that scopes development settlement (skill development / Luck recovery) idempotency. Call when a fresh sitting begins; never on crash resume.",
    {
        "decision_id": {"type": "string", "required": True, "desc": "idempotency key"},
    },
)(_tool_session_begin)
    registry.tool(
    "session.resume",
    "Load one bounded, hash-bound Keeper recovery bundle when continuing a campaign generation that predates this host startup, process restart, switch, or context compaction. It is the first campaign call only for that continuation case; do not call it after creating, quick-starting, binding, or setting up the campaign in the current initial request.",
    {
        "investigator": {
            "type": "string",
            "desc": "optional investigator for pair-scoped NPC impression projection",
        },
        "host_session_id": {
            "type": "string",
            "desc": "optional host session identity when the host does not export one to child tools",
        },
        "context_epoch": {
            "type": "integer",
            "minimum": 1,
            "desc": "optional epoch from a host lifecycle notice; rejects a stale resume race",
        },
    },
    access="query",
    read_domains=_CONTINUATION_DOMAINS,
    recovery_domains=("flags", "time_markers", "npc"),
    audit_mode="reference",
)(_tool_session_resume)
    registry.tool(
    "session.continuation_detail",
    "Read one exact paged section omitted from the compact session.resume working set. Use only a returned detail_operation card; never scan save files or logs.",
    {
        "section": {
            "type": "string",
            "required": True,
            "enum": [
                "recent_summaries",
                "threads",
                "confirmed_decisions",
                "do_not_repeat",
                "style_commitments",
                "current_turn",
            ],
            "desc": "exact continuation section named by session.resume",
        },
        "offset": {
            "type": "integer",
            "minimum": 0,
            "desc": "zero-based row offset (default 0)",
        },
        "limit": {
            "type": "integer",
            "minimum": 1,
            "maximum": 8,
            "desc": "maximum exact rows to return (default 4, max 8)",
        },
        "ids": {
            "type": "array",
            "items": {"type": "string", "minLength": 1},
            "maxItems": 16,
            "desc": "optional exact structured ids; no prose or keyword search",
        },
    },
    access="query",
    read_domains=_CONTINUATION_DOMAINS,
    audit_mode="reference",
)(_tool_session_continuation_detail)
    registry.tool(
    "session.delivery_text",
    "Read the latest hash-bound immutable Keeper output when session.resume externalized it to stay inside the recovery byte budget.",
    {
        "mode": {
            "type": "string", "required": False,
            "desc": "context (default) reads an explicit hash-bound receipt; replay reads the latest canonical delivery as bounded exact chunks with host-bound identity",
        },
        "finalization_id": {
            "type": "string", "required": False,
            "desc": "context mode: finalization identity from session.resume.delivery; replay mode: optional machine-injected identity validated against the latest canonical delivery",
        },
        "rendered_sha256": {
            "type": "string", "required": False,
            "desc": "context mode: exact rendered hash from session.resume.delivery; replay mode: optional machine-injected hash validated against the latest canonical delivery",
        },
        "text_offset": {
            "type": "integer", "required": False,
            "desc": "replay mode: UTF-8 byte offset where this exact chunk starts (0 for the first chunk)",
        },
        "text_limit": {
            "type": "integer", "required": False,
            "desc": "replay mode: maximum UTF-8 bytes in this exact chunk; follow next_offset until final",
        },
    },
    access="query",
    read_domains=_CONTINUATION_DOMAINS,
    audit_mode="reference",
)(_tool_session_delivery_text)
    registry.tool(
    "session.delivery_ack",
    "Confirm that the latest immutable Keeper rendered_text was displayed or replayed. This never changes campaign fiction or mechanics.",
    {
        "finalization_id": {
            "type": "string", "required": True,
            "desc": "latest finalization_id returned by session.resume",
        },
        "rendered_sha256": {
            "type": "string", "required": True,
            "desc": "exact latest rendered_sha256 returned by session.resume",
        },
        "ack_kind": {
            "type": "string", "required": True,
            "enum": ["displayed", "replayed"],
            "desc": "how the host delivered the immutable text",
        },
        "source_id": {
            "type": "string", "required": True,
            "desc": "stable host delivery/event identity",
        },
        "decision_id": {
            "type": "string", "desc": "idempotency key",
        },
    },
    write_domains=("delivery",),
)(_tool_session_delivery_ack)
    registry.tool(
    "evidence.table_opening",
    "Record the exact player-visible Keeper opening before the first player message, canonical-render the current authoritative opening-time anchor and explicitly bound public first-impression rolls, and close the pre-turn setup/opening source prefix.",
    {
        "text": {"type": "string", "required": True, "desc": "Keeper-authored opening narrative; deterministic first-impression lines are inserted by the tool before a final [/in_game] marker when present, otherwise appended"},
        "run_id": {
            "type": "string",
            "desc": "current play/report segment id; omitted calls receive run-<campaign_id>",
        },
        "presented_roll_ids": {
            "type": "array",
            "items": {"type": "string"},
            "uniqueItems": True,
            "desc": "ordered public npc_first_impression roll_ids from this campaign/run; omitted or [] is valid",
        },
        "speaker": {"type": "string", "desc": "player-facing Keeper speaker label"},
        "decision_id": {
            "type": "string",
            "desc": "idempotency key; omitted calls receive table-opening:<campaign_id>:opening-1",
        },
    },
)(_tool_evidence_table_opening)


OPERATION_EXPORTS = (
    '_OPENING_FAST_FACTS_TOOL_SCHEMA',
    '_SESSION_RESUME_DATA_MAX_BYTES',
    '_TURN_TAIL_DURABLE_DECISION_TOOLS',
    '_bound_session_resume_data',
    '_campaign_has_confirmed_investigator',
    '_character_creation_resume_projection',
    '_current_opening_time_anchor',
    '_opening_fast_fact_answer_schema',
    '_opening_fast_fact_ref_schema',
    '_opening_first_impression_lines',
    '_opening_text_with_public_rolls',
    '_opening_text_with_time_anchor',
    '_quarantine_unbound_turn_tail',
    '_recently_created_campaigns',
    '_recover_compiled_archive_for_resume',
    '_recover_temporal_history_for_resume',
    '_require_projected_opening_source',
    '_session_resume_ending_output',
    '_tool_evidence_table_opening',
    '_tool_session_begin',
    '_tool_session_continuation_detail',
    '_tool_session_delivery_ack',
    '_tool_session_delivery_text',
    '_tool_session_resume',
    '_tool_setup_adopt_source_facts',
    '_tool_setup_chargen_run',
    '_tool_setup_complete',
    '_tool_setup_inspect',
    '_tool_setup_investigator_contract',
    '_tool_setup_invoke',
    '_tool_setup_phase',
    '_tool_setup_quick_start',
    '_wire_bytes',
)
