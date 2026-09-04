#!/usr/bin/env python3
"""Operation adapter cell: world-time-effects."""
from __future__ import annotations

from coc_operation_kernel_runtime import (
    Any,
    Ctx,
    ToolError,
    _SOURCE_RECEIPTS_KEY,
    _SOURCE_RECEIPT_INTEGRITY_KEY,
    _SOURCE_RECEIPT_SCHEMA_VERSION,
    _active_ruleset_id,
    _active_time_markers,
    _apply_marker_live_record,
    _authored_unlock_world,
    _clock_reached,
    _combat_state,
    _director_receipt_event_present,
    _ensure_first_impression_roll,
    _ensure_operation_event,
    _flag_receipt_rows,
    _latest_anchored_flag_head,
    _latest_anchored_marker_head,
    _load_roll_receipt_document,
    _load_time_markers,
    _marker_live_record,
    _new_source_receipt,
    _now_iso,
    _operation_event_id,
    _operation_event_present,
    _operation_fingerprint,
    _parse_complete_roll_frames,
    _project_time_marker,
    _put_source_receipt,
    _read_jsonl_records,
    _reconcile_all_flag_source_receipts,
    _reconcile_all_marker_source_receipts,
    _replay_source_receipt,
    _resolve_investigator,
    _roll_log_bytes,
    _save_time_markers,
    _source_receipt,
    _source_receipt_manifest,
    _stored_toolbox_receipt_valid,
    _validate_source_receipt,
    _validated_receipt_entity_head,
    _validated_roll_document_collection,
    coc_exceptional_effects,
    coc_first_impression,
    coc_flag_state,
    coc_npc_event_chain,
    coc_scene_graph,
    coc_state,
    coc_subsystem_executor,
    coc_time,
    coc_turn_finalization,
    datetime,
    deepcopy,
    json,
    timedelta,
    tool,
)

def _flag_head_is_source_anchored(
    ctx: Ctx, flags: dict[str, Any], head: dict[str, Any]
) -> bool:
    receipts = ((flags.get(_SOURCE_RECEIPTS_KEY) or {}).get("state.set_flag") or {})
    if isinstance(receipts, dict):
        for receipt in receipts.values():
            if (
                _stored_toolbox_receipt_valid(receipt)
                and receipt.get("tool") == "state.set_flag"
                and receipt.get("entity_head") == head
            ):
                _operation_event_present(ctx, receipt)
                return True
    director_receipts = flags.get(coc_flag_state.DIRECTOR_FLAG_RECEIPTS_KEY) or {}
    if not coc_flag_state.valid_director_flag_receipt_map(director_receipts):
        return False
    for receipt in director_receipts.values():
        if receipt.get("entity_head") == head:
            _director_receipt_event_present(ctx, receipt)
            return True
    return False

def _marker_head_is_source_anchored(
    ctx: Ctx, payload: dict[str, Any], head: dict[str, Any]
) -> bool:
    receipts = (
        (payload.get(_SOURCE_RECEIPTS_KEY) or {}).get("state.time_marker") or {}
    )
    if not isinstance(receipts, dict):
        return False
    for receipt in receipts.values():
        if (
            _stored_toolbox_receipt_valid(receipt)
            and receipt.get("tool") == "state.time_marker"
            and receipt.get("entity_head") == head
        ):
            _operation_event_present(ctx, receipt)
            return True
    return False

def _repair_flag_live_head(
    ctx: Ctx,
    flags: dict[str, Any],
    receipt: dict[str, Any],
) -> None:
    operation = receipt.get("operation") or {}
    flag_id = str(operation.get("flag_id") or "")
    target = _validated_receipt_entity_head(
        receipt, entity_kind="flag", entity_id=flag_id
    )
    if target is None:
        return
    if (
        str(target.get("producer")) != "state.set_flag"
        or str(target.get("decision_id")) != str(receipt.get("decision_id"))
        or (target.get("live_record") or {}).get("value")
        != bool(operation.get("value"))
    ):
        raise ToolError("state_corrupt", "flag receipt head is inconsistent")

    head_map = flags.get("flag_heads")
    if head_map is None:
        head_map = {}
        flags["flag_heads"] = head_map
    if not isinstance(head_map, dict):
        raise ToolError("state_corrupt", "canonical flag head map is invalid")
    expected_head = _latest_anchored_flag_head(
        ctx, flags, flag_id, require_event=False
    )
    if expected_head is None:
        expected_head = target
    causal_sequence = int(expected_head["source_sequence"])
    current_head = head_map.get(flag_id)
    if current_head is not None and current_head != expected_head:
        raise ToolError(
            "state_corrupt",
            f"flag '{flag_id}' live head does not equal its unique latest source receipt",
        )

    expected_record = deepcopy(expected_head["live_record"])
    actual_record = coc_flag_state.flag_live_record(flags, flag_id)
    changed = False
    if actual_record != expected_record:
        if actual_record.get("present") is True:
            raise ToolError(
                "state_corrupt", f"flag '{flag_id}' live value conflicts with its causal head"
            )
        try:
            coc_flag_state.apply_live_record(flags, expected_record)
        except ValueError as exc:
            raise ToolError("state_corrupt", str(exc)) from exc
        changed = True
    if current_head != expected_head:
        head_map[flag_id] = deepcopy(expected_head)
        changed = True
    if changed:
        flags["schema_version"] = max(int(flags.get("schema_version") or 1), 3)
        flags["flag_source_sequence"] = max(
            int(flags.get("flag_source_sequence") or 0), causal_sequence
        )
        ctx.save_flags(flags)

def _repair_marker_live_head(
    ctx: Ctx,
    payload: dict[str, Any],
    receipt: dict[str, Any],
) -> None:
    operation = receipt.get("operation") or {}
    marker_id = str(operation.get("marker_id") or "")
    target = _validated_receipt_entity_head(
        receipt, entity_kind="time_marker", entity_id=marker_id
    )
    if target is None:
        return
    if (
        str(target.get("producer")) != "state.time_marker"
        or str(target.get("decision_id")) != str(receipt.get("decision_id"))
    ):
        raise ToolError("state_corrupt", "time marker receipt head is inconsistent")

    head_map = payload.get("marker_heads")
    if not isinstance(head_map, dict):
        raise ToolError("state_corrupt", "canonical marker head map is invalid")
    expected_head = _latest_anchored_marker_head(
        ctx, payload, marker_id, require_event=False
    )
    if expected_head is None:
        expected_head = target
    causal_sequence = int(expected_head["source_sequence"])
    current_head = head_map.get(marker_id)
    if current_head is not None and current_head != expected_head:
        raise ToolError(
            "state_corrupt",
            f"time marker '{marker_id}' live head does not equal its unique latest source receipt",
        )

    expected_record = deepcopy(expected_head["live_record"])
    actual_record = _marker_live_record(payload, marker_id)
    changed = False
    if actual_record != expected_record:
        if actual_record.get("present") is True:
            raise ToolError(
                "state_corrupt",
                f"time marker '{marker_id}' live record conflicts with its causal head",
            )
        _apply_marker_live_record(payload, expected_record)
        changed = True
    if current_head != expected_head:
        head_map[marker_id] = deepcopy(expected_head)
        changed = True
    if changed:
        payload["schema_version"] = max(int(payload.get("schema_version") or 1), 3)
        payload["marker_source_sequence"] = max(
            int(payload.get("marker_source_sequence") or 0), causal_sequence
        )
        _save_time_markers(ctx, payload)

def _positive_source_sequence(value: Any) -> int | None:
    return coc_flag_state.positive_sequence(value)

def _next_flag_source_sequence(ctx: Ctx, flags: dict[str, Any]) -> int:
    """Allocate the next sequence from current source-owned receipts only."""
    stored = flags.get("flag_source_sequence")
    if (
        not isinstance(stored, int)
        or isinstance(stored, bool)
        or stored < 0
    ):
        raise ToolError("state_corrupt", "invalid flag_source_sequence counter")
    anchored: list[int] = []
    for sequence, _kind, receipt in _flag_receipt_rows(flags):
        if receipt.get("schema_version") == _SOURCE_RECEIPT_SCHEMA_VERSION:
            _operation_event_present(ctx, receipt)
        else:
            _director_receipt_event_present(ctx, receipt)
        anchored.append(sequence)
    if anchored:
        anchored_max = max(anchored)
        if stored != anchored_max:
            raise ToolError(
                "state_corrupt",
                "flag source counter is not anchored to the latest current receipt",
            )
        return anchored_max + 1
    if stored != 0:
        raise ToolError(
            "state_corrupt",
            "flag source counter has no current source receipt anchor",
        )
    return 1

def _next_marker_source_sequence(ctx: Ctx, payload: dict[str, Any]) -> int:
    stored = payload.get("marker_source_sequence", 0)
    if stored not in (None, 0) and _positive_source_sequence(stored) is None:
        raise ToolError("state_corrupt", "invalid marker_source_sequence counter")
    # Collect every receipt head because this is one global marker allocator.
    anchored: list[int] = []
    receipts = ((payload.get(_SOURCE_RECEIPTS_KEY) or {}).get("state.time_marker") or {})
    if not isinstance(receipts, dict):
        raise ToolError("state_corrupt", "canonical marker receipt map is invalid")
    for receipt in receipts.values():
        if not isinstance(receipt, dict):
            raise ToolError("state_corrupt", "canonical marker receipt is invalid")
        if receipt.get("schema_version") != _SOURCE_RECEIPT_SCHEMA_VERSION:
            raise ToolError("state_corrupt", "canonical marker receipt schema is unsupported")
        if (
            not _stored_toolbox_receipt_valid(receipt)
            or receipt.get("tool") != "state.time_marker"
        ):
            raise ToolError("state_corrupt", "canonical marker receipt integrity failed")
        _operation_event_present(ctx, receipt)
        anchored.append(int(receipt["entity_head"]["source_sequence"]))
    if anchored:
        anchored_max = max(anchored)
        if int(stored or 0) != anchored_max:
            raise ToolError(
                "state_corrupt",
                "marker source counter is not anchored to the latest valid receipt",
            )
        return anchored_max + 1
    if int(stored or 0) != 0:
        raise ToolError(
            "state_corrupt",
            "marker source counter has no current source receipt anchor",
        )
    return 1

def _deadline_due_at(current: dict[str, Any], minutes_from_now: int) -> dict[str, Any]:
    elapsed = int(current.get("elapsed_minutes") or 0)
    local_value = current.get("local_datetime")
    due_local: str | None = None
    due_display: str | None = None
    if local_value:
        try:
            due_dt = datetime.fromisoformat(str(local_value)) + timedelta(
                minutes=minutes_from_now
            )
            due_local = due_dt.isoformat()
            due_display = due_dt.strftime("%Y-%m-%d %H:%M")
            current_display = str(current.get("display") or "")
            if "," in current_display:
                due_display += current_display[current_display.index(","):]
        except (TypeError, ValueError):
            due_local = None
            due_display = None
    return {
        "elapsed_minutes": elapsed + minutes_from_now,
        "local_datetime": due_local,
        "display": due_display,
    }

def _project_active_time_markers(
    payload: dict[str, Any],
    current: dict[str, Any],
) -> list[dict[str, Any]]:
    markers = payload.get("markers")
    if not isinstance(markers, dict):
        markers = {}
    active = [
        _project_time_marker(marker, current)
        for marker in markers.values()
        if isinstance(marker, dict) and marker.get("status") == "active"
    ]
    return sorted(
        active,
        key=lambda marker: (
            int((marker.get("due_at") or {}).get("elapsed_minutes") or 0),
            str(marker.get("marker_id") or ""),
        ),
    )

def _tool_state_set_flag(ctx: Ctx, args: dict[str, Any]):
    tool_name = "state.set_flag"
    decision_id = str(args["decision_id"])
    flag_id = str(args["flag_id"])
    value = bool(args.get("value", True))
    reason = str(args["reason"]) if args.get("reason") is not None else None
    operation = {
        "flag_id": flag_id,
        "value": value,
        "reason": reason,
    }
    flags = ctx.flags()
    _reconcile_all_flag_source_receipts(ctx, flags)
    receipt = _source_receipt(flags, tool_name, decision_id)
    if receipt is not None:
        _validate_source_receipt(
            receipt,
            tool_name=tool_name,
            decision_id=decision_id,
            operation=operation,
        )
        _operation_event_present(ctx, receipt)
        _repair_flag_live_head(ctx, flags, receipt)
        # Verify/repair the immutable event before any additive world repair;
        # a duplicate or conflicting stable ID must leave world/ledger intact.
        _ensure_operation_event(ctx, receipt)
        # Unlocks are additive.  Repair only the exact IDs frozen in the
        # original receipt, preserving any later, unrelated world writes.
        frozen_unlocks = (receipt.get("data") or {}).get(
            "newly_unlocked_scenes"
        ) or []
        world = ctx.world()
        repaired = coc_scene_graph.apply_unlocks_to_world(
            world, [str(value) for value in frozen_unlocks if value]
        )
        if repaired:
            ctx.save_world(world)
        return _replay_source_receipt(ctx, receipt)

    prior = ctx.ledger_lookup(tool_name, decision_id)
    if prior is not None:
        raise ToolError(
            "state_corrupt",
            f"toolbox ledger entry for {tool_name} decision_id '{decision_id}' has no canonical source receipt",
        )

    flag_map = flags.get("flags")
    if flag_map is None:
        flag_map = {}
    elif not isinstance(flag_map, dict):
        raise ToolError(
            "state_corrupt",
            "save/flags.json has an invalid flags map; refusing to overwrite it",
        )
    flags["flags"] = flag_map
    current_head = (flags.get("flag_heads") or {}).get(flag_id)
    if current_head is not None and not _flag_head_is_source_anchored(
        ctx, flags, current_head
    ):
        raise ToolError(
            "state_corrupt",
            f"flag '{flag_id}' has an unanchored live head; refusing to overwrite it",
        )
    changed_at = _now_iso()
    source_sequence = _next_flag_source_sequence(ctx, flags)
    try:
        event, provenance, entity_head = coc_flag_state.commit_flag_mutation(
            flags,
            flag_id=flag_id,
            value=value,
            decision_id=decision_id,
            producer="state.set_flag",
            changed_at=changed_at,
            reason=reason,
            source_ref=f"save/flags.json#flag_provenance/{flag_id}",
            source_sequence=source_sequence,
            event_id=_operation_event_id(tool_name, decision_id),
        )
    except ValueError as exc:
        raise ToolError("state_corrupt", str(exc)) from exc
    flag_map = flags["flags"]

    # Freeze the unlock result from this exact source transition before any
    # append/ledger stage.  A replay repairs these IDs additively and never
    # recalculates previous_value/provenance from later state.
    world = ctx.world()
    unlock_world = _authored_unlock_world(
        ctx, world, clue_records=flags.get("clues_found")
    )
    unlock_candidates = coc_scene_graph.evaluate_unlocks(
        ctx.story_graph,
        unlock_world,
        clock_reached=_clock_reached(ctx),
        flags_set={str(key) for key, enabled in flag_map.items() if enabled},
    )
    newly_unlocked = coc_scene_graph.apply_unlocks_to_world(
        world, unlock_candidates
    )
    data = {
        "flag_id": flag_id,
        "value": value,
        "provenance": deepcopy(provenance),
        "newly_unlocked_scenes": list(newly_unlocked),
    }
    receipt = _new_source_receipt(
        tool_name=tool_name,
        decision_id=decision_id,
        operation=operation,
        event=event,
        data=data,
        entity_head=entity_head,
    )
    _put_source_receipt(flags, receipt)
    ctx.save_flags(flags)
    if newly_unlocked:
        ctx.save_world(world)
    _ensure_operation_event(ctx, receipt)
    ctx.ledger_record(
        decision_id,
        tool_name,
        data,
        source_receipt_manifest=_source_receipt_manifest(receipt),
    )
    return data, [], []

def _tool_state_clear_transient_condition(ctx: Ctx, args: dict[str, Any]):
    decision_id = str(args["decision_id"])
    prior = ctx.ledger_lookup("state.clear_transient_condition", decision_id)
    if prior is not None:
        return prior.get("data"), [
            "duplicate decision_id: returning the previously settled result"
        ], []
    investigator_id = _resolve_investigator(ctx, args)
    condition = str(args["condition"])
    allowed = coc_subsystem_executor.TRANSIENT_COMBAT_CONDITIONS
    if condition not in allowed:
        raise ToolError(
            "invalid_param",
            "only prone, grappled, surprised, outnumbered, or fled may be cleared here",
        )
    reason = str(args["reason"]).strip()
    if not reason:
        raise ToolError("invalid_param", "reason must be non-empty")
    combat = _combat_state(ctx)
    if combat.get("status") == "active":
        raise ToolError(
            "condition_owned_by_active_combat",
            "active-combat positional conditions must be changed through combat resolution",
        )
    state = ctx.inv_state(investigator_id)
    before = list(state.get("conditions") or [])
    changed = condition in before
    if changed:
        state["conditions"] = [value for value in before if value != condition]
        ctx.save_inv_state(investigator_id, state)
        ctx.log_event({
            "event_type": "transient_condition_cleared",
            "investigator_id": investigator_id,
            "condition": condition,
            "reason": reason,
        })
    data = {
        "investigator_id": investigator_id,
        "condition": condition,
        "changed": changed,
        "conditions_before": before,
        "conditions_after": list(state.get("conditions") or []),
        "conditions": list(state.get("conditions") or []),
        "reason": reason,
    }
    ctx.ledger_record(
        decision_id, "state.clear_transient_condition", data
    )
    warnings = [] if changed else [f"condition '{condition}' was already absent"]
    return data, warnings, []

def _tool_state_time_marker(ctx: Ctx, args: dict[str, Any]):
    tool_name = "state.time_marker"
    decision_id = str(args["decision_id"])
    action = str(args["action"]).strip().lower()
    if action not in {"set", "reset", "clear"}:
        raise ToolError("invalid_param", "action must be set, reset, or clear")
    marker_id = str(args["marker_id"]).strip()
    if not marker_id:
        raise ToolError("invalid_param", "marker_id must be non-empty")

    minutes_from_now: int | None = None
    if action in {"set", "reset"}:
        if args.get("minutes_from_now") is None:
            raise ToolError(
                "missing_param", "minutes_from_now is required for set/reset"
            )
        minutes_from_now = int(args["minutes_from_now"])
        if minutes_from_now < 0:
            raise ToolError(
                "invalid_param", "minutes_from_now must be >= 0 (time is monotonic)"
            )
    label = str(args["label"]) if args.get("label") is not None else None
    reason = str(args["reason"]) if args.get("reason") is not None else None
    operation = {
        "action": action,
        "marker_id": marker_id,
        "minutes_from_now": minutes_from_now,
        "label": label if action in {"set", "reset"} else None,
        "reason": reason,
    }

    payload = _load_time_markers(ctx)
    _reconcile_all_marker_source_receipts(ctx, payload)
    receipt = _source_receipt(payload, tool_name, decision_id)
    if receipt is not None:
        _validate_source_receipt(
            receipt,
            tool_name=tool_name,
            decision_id=decision_id,
            operation=operation,
        )
        _operation_event_present(ctx, receipt)
        _repair_marker_live_head(ctx, payload, receipt)
        return _replay_source_receipt(ctx, receipt)

    prior = ctx.ledger_lookup(tool_name, decision_id)
    if prior is not None:
        raise ToolError(
            "state_corrupt",
            f"toolbox ledger entry for {tool_name} decision_id '{decision_id}' has no canonical source receipt",
        )

    markers = payload["markers"]
    existing = markers.get(marker_id)
    existing = deepcopy(existing) if isinstance(existing, dict) else None
    current_head = payload["marker_heads"].get(marker_id)
    if current_head is not None and not _marker_head_is_source_anchored(
        ctx, payload, current_head
    ):
        raise ToolError(
            "state_corrupt",
            f"time marker '{marker_id}' has an unanchored live head; refusing to overwrite it",
        )
    warnings: list[str] = []
    now_wall = _now_iso()
    current = coc_time.current_stamp(ctx.campaign_dir)
    projected_marker: dict[str, Any] | None
    source_sequence = _next_marker_source_sequence(ctx, payload)
    payload["marker_source_sequence"] = source_sequence

    if action in {"set", "reset"}:
        assert minutes_from_now is not None
        if action == "reset" and existing is None:
            warnings.append(
                f"time marker '{marker_id}' did not exist; reset created it"
            )
        if action == "set" and existing and existing.get("status") == "active":
            warnings.append(
                f"time marker '{marker_id}' was already active; set replaced its due time"
            )
        revision = int((existing or {}).get("revision") or 0) + 1
        marker = {
            "schema_version": coc_flag_state.TIME_MARKER_SCHEMA_VERSION,
            "marker_id": marker_id,
            "label": str(
                label
                or (existing or {}).get("label")
                or marker_id
            ),
            "status": "active",
            "revision": revision,
            "due_at": _deadline_due_at(current, minutes_from_now),
            "created_at": (existing or {}).get("created_at") or now_wall,
            "updated_at": now_wall,
            "decision_id": decision_id,
            "reason": reason,
            "source_sequence": source_sequence,
            "producer": "state.time_marker",
        }
        markers[marker_id] = marker
        projected_marker = _project_time_marker(marker, current)
    else:
        if existing is None:
            warnings.append(
                f"time marker '{marker_id}' was already absent; clear recorded a no-op"
            )
            projected_marker = None
        else:
            existing["schema_version"] = coc_flag_state.TIME_MARKER_SCHEMA_VERSION
            existing["status"] = "cleared"
            existing["revision"] = int(existing.get("revision") or 0) + 1
            existing["updated_at"] = now_wall
            existing["cleared_at"] = now_wall
            existing["decision_id"] = decision_id
            existing["reason"] = reason
            existing["source_sequence"] = source_sequence
            existing["producer"] = "state.time_marker"
            markers[marker_id] = existing
            projected_marker = _project_time_marker(existing, current)

    event = {
        "time_marker_schema_version": coc_flag_state.TIME_MARKER_SCHEMA_VERSION,
        "event_type": "time_marker_changed",
        "event_id": _operation_event_id(tool_name, decision_id),
        "action": action,
        "marker_id": marker_id,
        "decision_id": decision_id,
        "reason": reason,
        "previous_due_at": deepcopy((existing or {}).get("due_at")),
        "due_at": deepcopy((markers.get(marker_id) or {}).get("due_at")),
        "status": (markers.get(marker_id) or {}).get("status", "absent"),
        "ts": now_wall,
        "source_sequence": source_sequence,
    }
    data = {
        "action": action,
        "marker": projected_marker,
        "current_time": current,
        "active_time_markers": _project_active_time_markers(payload, current),
    }
    hints = [
        "time markers are deterministic bookkeeping only; due/overdue status does not auto-trigger rescue, scene movement, or any narrative gate"
    ]
    marker_live_record = _marker_live_record(payload, marker_id)
    entity_head = coc_flag_state.entity_head(
        entity_kind="time_marker",
        entity_id=marker_id,
        decision_id=decision_id,
        source_sequence=source_sequence,
        producer="state.time_marker",
        live_record=marker_live_record,
    )
    event["live_head_digest"] = coc_flag_state.canonical_digest(entity_head)
    payload["marker_heads"][marker_id] = deepcopy(entity_head)
    receipt = _new_source_receipt(
        tool_name=tool_name,
        decision_id=decision_id,
        operation=operation,
        event=event,
        data=data,
        warnings=warnings,
        hints=hints,
        entity_head=entity_head,
    )
    _put_source_receipt(payload, receipt)
    _save_time_markers(ctx, payload)
    _ensure_operation_event(ctx, receipt)
    ctx.ledger_record(
        decision_id,
        tool_name,
        data,
        source_receipt_manifest=_source_receipt_manifest(receipt),
    )
    return data, warnings, hints

def _tool_state_time_appearance(ctx: Ctx, args: dict[str, Any]):
    tool_name = "state.time_appearance"
    prior = ctx.ledger_lookup(tool_name, args.get("decision_id"))
    if prior is not None:
        return prior.get("data"), [
            "duplicate decision_id: returning the previously settled result"
        ], []
    try:
        result = coc_time.set_time_appearance(
            ctx.campaign_dir,
            mode=str(args["mode"]),
            display_label=args.get("display_label"),
            reason=str(args["reason"]),
            source_ref=args.get("source_ref"),
            decision_id=str(args.get("decision_id") or f"toolbox-{_now_iso()}"),
        )
    except ValueError as exc:
        raise ToolError("invalid_param", str(exc)) from exc
    ctx.ledger_record(args.get("decision_id"), tool_name, result)
    return result, [], [
        "exact elapsed/civil time remains Keeper-only; player prose and final "
        "mechanics should use current_time.player_time",
    ]

def _tool_state_advance_time(ctx: Ctx, args: dict[str, Any]):
    prior = ctx.ledger_lookup("state.advance_time", args.get("decision_id"))
    if prior is not None:
        return prior.get("data"), ["duplicate decision_id: returning the previously settled result"], []
    result = coc_time.advance_time(
        ctx.campaign_dir,
        int(args["minutes"]),
        decision_id=str(args.get("decision_id") or f"toolbox-{_now_iso()}"),
        reason=str(args["reason"]),
        source="keeper_toolbox",
        day_phase_after=args.get("day_phase_after"),
        display_after=args.get("display_after"),
    )
    hints = []
    active_time_markers = _active_time_markers(ctx)
    result["active_time_markers"] = active_time_markers
    if result.get("fired_triggers"):
        hints.append("scheduled trigger(s) fired — weave their effects into the narration")
    if any(
        marker.get("timing_state") in {"due", "overdue"}
        for marker in active_time_markers
    ):
        hints.append(
            "one or more time markers are due/overdue; use the structured values for bookkeeping, but do not auto-apply a narrative consequence"
        )
    ctx.ledger_record(args.get("decision_id"), "state.advance_time", result)
    return result, [], hints

def _tool_state_clock_discontinuity(ctx: Ctx, args: dict[str, Any]):
    tool_name = "state.clock_discontinuity"
    decision_id = str(args["decision_id"])
    prior = ctx.ledger_lookup(tool_name, decision_id)
    if prior is not None:
        return prior.get("data"), [
            "duplicate decision_id: returning the previously recorded civil-clock transition"
        ], []
    try:
        result = coc_time.record_clock_discontinuity(
            ctx.campaign_dir,
            discontinuity_kind=str(args["discontinuity_kind"]),
            calendar_mode=str(args["calendar_mode"]),
            precision=str(args["precision"]),
            display=str(args["display"]),
            decision_id=decision_id,
            reason=str(args["reason"]),
            local_datetime=args.get("local_datetime"),
            local_date=args.get("local_date"),
            timezone=args.get("timezone"),
            day_phase=args.get("day_phase"),
            source_ref=args.get("source_ref"),
            civil_anchor_elapsed=args.get("civil_anchor_elapsed"),
        )
    except ValueError as exc:
        raise ToolError("invalid_param", str(exc)) from exc
    result["active_time_markers"] = _active_time_markers(ctx)
    ctx.ledger_record(decision_id, tool_name, result)
    return result, [], [
        "the civil calendar changed, but elapsed_minutes and relative trigger deadlines remained monotonic",
        "render only the precision the source supports; a hidden date or era remains Keeper-only until play establishes it",
    ]

def _tool_state_mark_safe_rest(ctx: Ctx, args: dict[str, Any]):
    tool_name = "state.mark_safe_rest"
    decision_id = str(args["decision_id"])
    prior = ctx.ledger_lookup(tool_name, decision_id)
    if prior is not None:
        return prior.get("data"), [
            "duplicate decision_id: returning the previously recorded rest"
        ], []
    rest_kind = str(args.get("rest_kind") or "").strip()
    if rest_kind != "full_sleep":
        raise ToolError(
            "invalid_param",
            "rest_kind must be full_sleep; ordinary pauses do not reset the rest anchor",
        )
    investigator_id = _resolve_investigator(ctx, args)
    result = coc_time.mark_safe_rest(
        ctx.campaign_dir,
        investigator_id,
        decision_id=decision_id,
        rest_kind=rest_kind,
    )
    if result.get("at_elapsed") is None:
        raise ToolError("state_corrupt", "time state is not initialized")
    sanity_day = result.get("sanity_day")
    sanity_day_closed = (
        isinstance(sanity_day, dict) and bool(sanity_day.get("closed"))
    )
    sanity_day_reset = sanity_day_closed or bool(result.get("sanity_day_reset"))
    fired = coc_time.process_due_triggers(
        ctx.campaign_dir,
        skip_handlers=coc_time._GRAPH_SETTLED_TRIGGER_HANDLERS,
    )
    time_state = coc_time.read_time_state(ctx.campaign_dir)
    due = coc_time.peek_due_triggers(ctx.campaign_dir)
    data = {
        **result,
        "sanity_day_reset": sanity_day_reset,
        "fired_triggers": fired,
        "time_signals": coc_time.build_time_signals(time_state, due),
    }
    ctx.ledger_record(decision_id, tool_name, data)
    hints = [
        "the canonical rest anchor now drives later Director continuity; state.advance_time alone never records completed rest"
    ]
    if sanity_day_reset:
        hints.append(
            "the game-day SAN counter reset with this safe rest: the 1/5-per-day "
            "indefinite-insanity window re-anchored at current SAN"
        )
    if sanity_day_closed and sanity_day.get("indefinite_insanity_triggered"):
        hints.append(
            "the day boundary settled the one-fifth cumulative SAN rule: "
            "indefinite insanity is now authoritative — portray it and its "
            "weekly-treatment schedule from the sanity pipeline evidence"
        )
    if fired:
        hints.append(
            "safe-rest trigger(s) fired — settle and portray their authoritative outcomes"
        )
    return data, [], hints

_EXCEPTIONAL_CHANGE_KINDS = frozenset({
    "arrival", "hazard", "opening", "loss", "escalation", "reversal",
})

def _ledger_roll_owner(
    ctx: Ctx, tools: frozenset[str], roll_id: str
) -> dict[str, Any] | None:
    """Resolve the canonical ledger entry whose settled data owns ``roll_id``.

    Roll evidence logged outside the receipt document (opposed contests, SAN
    checks) does not always carry its owning decision_id on the roll row; the
    ledger is the authoritative map back to it.  Exactly one entry may own a
    roll id.
    """
    def _contains(value: Any) -> bool:
        if isinstance(value, str):
            return value == roll_id
        if isinstance(value, dict):
            return any(_contains(item) for item in value.values())
        if isinstance(value, list):
            return any(_contains(item) for item in value)
        return False

    owners = [
        entry
        for entry in ctx._load_ledger()["entries"].values()
        if isinstance(entry, dict)
        and entry.get("tool") in tools
        and _contains(entry.get("data"))
    ]
    if len(owners) > 1:
        raise ToolError(
            "state_corrupt",
            f"roll_id '{roll_id}' has multiple canonical sources",
        )
    return owners[0] if owners else None

def _exceptional_roll_source(
    ctx: Ctx, roll_id: str
) -> dict[str, Any]:
    document = _load_roll_receipt_document(ctx)
    receipts, _ = _validated_roll_document_collection(document)
    matches = [row for row in receipts if str(row.get("roll_id")) == roll_id]
    if len(matches) == 1:
        receipt = matches[0]
        if receipt.get("tool") not in {"rules.roll", "rules.push"}:
            raise ToolError(
                "invalid_source_roll", "exceptional effects require a percentile check"
            )
        return receipt
    if matches:
        raise ToolError("state_corrupt", f"roll_id '{roll_id}' has multiple canonical sources")

    # CombatSession writes its authoritative percentile evidence directly to
    # logs/rolls.jsonl rather than the rules.roll receipt document.  These
    # rows still need to own critical/fumble effects; otherwise the finalizer
    # requires a substantive effect that state.exceptional_effect can never
    # create.
    raw_roll_log = _roll_log_bytes(ctx)
    _complete, tail, roll_index = _parse_complete_roll_frames(raw_roll_log)
    if tail:
        raise ToolError(
            "state_corrupt",
            "logs/rolls.jsonl has an incomplete tail; combat exceptional source cannot be proven",
        )
    logged_roll = roll_index.get(roll_id)
    if isinstance(logged_roll, dict):
        payload = logged_roll.get("payload")
        payload = payload if isinstance(payload, dict) else {}
        roll_role = logged_roll.get("roll_role", payload.get("roll_role"))
        source_command_id = str(
            logged_roll.get("source_command_id")
            or payload.get("source_command_id")
            or ""
        )
        roll_kind = logged_roll.get("kind") or payload.get("kind")
        # A SAN check fumble is a legitimate exceptional result whose effect
        # (san_loss) must bind through state.exceptional_effect.  The sanity
        # check roll lives in logs/rolls.jsonl with kind=sanity_check.  Its
        # owning decision_id comes from the canonical rules.sanity_check /
        # sanity.execute ledger entry (the roll row itself proves provenance
        # only for subsystem rows that embed source_command_id/decision_id).
        if roll_kind == "sanity_check":
            owner = _ledger_roll_owner(
                ctx, frozenset({"rules.sanity_check", "sanity.execute"}), roll_id
            )
            decision_id = (
                str(owner["decision_id"]) if owner is not None else ""
            ) or source_command_id or str(payload.get("decision_id") or "")
            if decision_id:
                tool_name = (
                    str(owner["tool"]) if owner is not None else "rules.sanity_check"
                )
                data = {
                    key: deepcopy(value)
                    for key, value in logged_roll.items()
                    if key != "payload"
                }
                for key, value in payload.items():
                    data.setdefault(key, deepcopy(value))
                actor_id = data.get("actor")
                if isinstance(actor_id, str) and actor_id in set(ctx.party_ids()):
                    data.setdefault("investigator_id", actor_id)
                data.setdefault("pushed", False)
                data.setdefault("visibility", str(logged_roll.get("visibility") or "consequence_public"))
                return {
                    "tool": tool_name,
                    "decision_id": decision_id,
                    "roll_id": roll_id,
                    "roll_record": deepcopy(logged_roll),
                    "data": data,
                    _SOURCE_RECEIPT_INTEGRITY_KEY: coc_exceptional_effects.canonical_digest(
                        logged_roll
                    ),
                }
        # An opposed contest (e.g. POW vs POW) can also settle critical/fumble
        # on either side.  rules.opposed logs both sides with
        # kind=opposed_check and no source_command_id; its canonical ledger
        # entry owns the roll ids, so resolve the source decision_id there.
        if roll_kind == "opposed_check":
            owner = _ledger_roll_owner(ctx, frozenset({"rules.opposed"}), roll_id)
            if owner is not None:
                data = {
                    key: deepcopy(value)
                    for key, value in logged_roll.items()
                    if key != "payload"
                }
                for key, value in payload.items():
                    data.setdefault(key, deepcopy(value))
                actor_id = data.get("actor")
                if isinstance(actor_id, str) and actor_id in set(ctx.party_ids()):
                    data.setdefault("investigator_id", actor_id)
                data.setdefault("pushed", False)
                data.setdefault("visibility", str(logged_roll.get("visibility") or "public"))
                return {
                    "tool": "rules.opposed",
                    "decision_id": str(owner["decision_id"]),
                    "roll_id": roll_id,
                    "roll_record": deepcopy(logged_roll),
                    "data": data,
                    _SOURCE_RECEIPT_INTEGRITY_KEY: coc_exceptional_effects.canonical_digest(
                        logged_roll
                    ),
                }
        # Healing percentile evidence (First Aid / Medicine / dying CON /
        # weekly care) is written to logs/rolls.jsonl by the subsystem
        # executor as {command_id}:roll.  It is not a rules.roll receipt.
        # Resolve only when that exact roll_id is owned by one canonical
        # healing ledger entry — never by stripping suffixes or matching
        # free-form IDs.
        if roll_role == "percentile_check":
            owner = _ledger_roll_owner(
                ctx,
                frozenset({
                    "rules.first_aid",
                    "rules.medicine",
                    "rules.dying_check",
                    "rules.weekly_recovery",
                }),
                roll_id,
            )
            if owner is not None:
                data = {
                    key: deepcopy(value)
                    for key, value in logged_roll.items()
                    if key != "payload"
                }
                for key, value in payload.items():
                    data.setdefault(key, deepcopy(value))
                owner_data = owner.get("data") if isinstance(owner.get("data"), dict) else {}
                patient_id = owner_data.get("investigator_id")
                if isinstance(patient_id, str) and patient_id:
                    data["investigator_id"] = patient_id
                else:
                    actor_id = data.get("actor") or data.get("actor_id")
                    if isinstance(actor_id, str) and actor_id in set(ctx.party_ids()):
                        data.setdefault("investigator_id", actor_id)
                data.setdefault("pushed", bool(payload.get("pushed") is True))
                data.setdefault(
                    "visibility",
                    str(
                        logged_roll.get("visibility")
                        or payload.get("visibility")
                        or "public"
                    ),
                )
                return {
                    "tool": str(owner["tool"]),
                    "decision_id": str(owner["decision_id"]),
                    "roll_id": roll_id,
                    "roll_record": deepcopy(logged_roll),
                    "data": data,
                    _SOURCE_RECEIPT_INTEGRITY_KEY: coc_exceptional_effects.canonical_digest(
                        logged_roll
                    ),
                }
        if roll_role == "percentile_check" and source_command_id.startswith("combat-"):
            data = {
                key: deepcopy(value)
                for key, value in logged_roll.items()
                if key != "payload"
            }
            for key, value in payload.items():
                data.setdefault(key, deepcopy(value))
            actor_id = data.get("actor_id")
            if isinstance(actor_id, str) and actor_id in set(ctx.party_ids()):
                data.setdefault("investigator_id", actor_id)
            data.setdefault("pushed", False)
            data.setdefault("visibility", str(logged_roll.get("visibility") or "public"))
            return {
                "tool": "combat.resolve",
                "decision_id": source_command_id,
                "roll_id": roll_id,
                "roll_record": deepcopy(logged_roll),
                "data": data,
                _SOURCE_RECEIPT_INTEGRITY_KEY: coc_exceptional_effects.canonical_digest(
                    logged_roll
                ),
            }

    try:
        campaign_id = coc_npc_event_chain.resolve_campaign_id(ctx.campaign_dir)
        impressions = coc_first_impression.load_document(
            ctx.campaign_dir, campaign_id
        )
    except ValueError as exc:
        raise ToolError("state_corrupt", str(exc)) from exc
    impression_matches = [
        receipt
        for receipt in (impressions.get("receipts") or {}).values()
        if isinstance(receipt, dict)
        and receipt.get("schema_version") == 2
        and receipt.get("roll_id") == roll_id
    ]
    if len(impression_matches) != 1:
        raise ToolError(
            "unknown_source_roll",
            "source_roll_id must name exactly one canonical percentile or schema-v2 first-impression receipt",
        )
    impression = impression_matches[0]
    _ensure_first_impression_roll(ctx, impression)
    roll_record = deepcopy(impression["roll_record"])
    return {
        "tool": "npc.reaction",
        "decision_id": impression["decision_id"],
        "roll_id": impression["roll_id"],
        "roll_record": roll_record,
        "data": {
            **{
                key: deepcopy(value)
                for key, value in roll_record.items()
                if key not in {"payload"}
            },
            "pushed": False,
            "visibility": "public",
        },
        _SOURCE_RECEIPT_INTEGRITY_KEY: impression["integrity_digest"],
    }

def _exceptional_resolution_source(
    ctx: Ctx, roll_id: str
) -> dict[str, Any]:
    """Return the authoritative final settlement for a resolution check.

    Luck spending does not create a second dice row: its canonical receipt
    supersedes the failed settlement carried by the original ``rules.roll``
    receipt.  Persistent-effect resolution therefore has to consult that
    adjustment instead of treating the immutable original roll as final.
    """
    source = _exceptional_roll_source(ctx, roll_id)
    if source["data"].get("passed") is True:
        return source

    document = _load_roll_receipt_document(ctx)
    _validated_roll_document_collection(document)
    adjustments = [
        receipt
        for receipt in document["luck_spends"].values()
        if isinstance(receipt, dict)
        and receipt.get("source_receipt", {}).get("roll_id") == roll_id
    ]
    if len(adjustments) > 1:
        raise ToolError(
            "state_corrupt",
            f"roll_id '{roll_id}' has multiple canonical Luck settlements",
        )
    if not adjustments:
        return source

    adjusted = deepcopy(source)
    adjusted["data"] = deepcopy(adjustments[0]["data"])
    adjusted["settlement_tool"] = "rules.luck_spend"
    adjusted["settlement_decision_id"] = str(adjustments[0]["decision_id"])
    return adjusted

def _successful_call_by_decision(
    ctx: Ctx, decision_id: str
) -> dict[str, Any]:
    path = ctx.campaign_dir / "logs" / "toolbox-calls.jsonl"
    rows = _read_jsonl_records(path) if path.is_file() else []
    matches = [
        row for row in rows
        if row.get("ok") is True
        and isinstance(row.get("args"), dict)
        and str(row["args"].get("decision_id") or "") == decision_id
    ]
    if len(matches) != 1:
        raise ToolError(
            "invalid_linked_effect",
            f"linked decision_id '{decision_id}' must name exactly one successful tool call",
        )
    return matches[0]

def _validated_exceptional_mechanics(
    ctx: Ctx,
    *,
    effect_kind: str,
    mechanics: Any,
    boundary: dict[str, Any],
) -> dict[str, Any]:
    if not isinstance(mechanics, dict):
        raise ToolError("invalid_param", "mechanics must be an object")
    normalized = deepcopy(mechanics)
    if effect_kind in {"bonus_die", "penalty_die"}:
        base_fields = {
            "dice", "investigator_id", "skill", "scene_id", "target_id",
        }
        allowed_field_sets = {
            frozenset(base_fields),
            frozenset({*base_fields, "target_display_name"}),
            frozenset({*base_fields, "source_decision_ids", "target_display_name"}),
        }
        if frozenset(normalized) not in allowed_field_sets:
            raise ToolError(
                "invalid_param",
                "dice-modifier mechanics require dice, investigator_id, skill, scene_id, target_id, plus optional source_decision_ids for a relationship reward",
            )
        if normalized.get("dice") not in {1, 2}:
            raise ToolError("invalid_param", "exceptional modifier dice must be 1 or 2")
        for key in ("investigator_id", "skill"):
            if not isinstance(normalized.get(key), str) or not normalized[key].strip():
                raise ToolError("invalid_param", f"mechanics.{key} must be non-empty")
            normalized[key] = normalized[key].strip()
        for key in ("scene_id", "target_id"):
            value = normalized.get(key)
            if value is not None and (not isinstance(value, str) or not value.strip()):
                raise ToolError("invalid_param", f"mechanics.{key} must be null or non-empty")
            normalized[key] = value.strip() if isinstance(value, str) else None
        target_display_name = normalized.get("target_display_name")
        if normalized["target_id"] is not None:
            if (
                not isinstance(target_display_name, str)
                or not target_display_name.strip()
                or target_display_name.strip() == normalized["target_id"]
            ):
                raise ToolError(
                    "invalid_param",
                    "an NPC-scoped modifier requires a localized player-safe target_display_name distinct from target_id",
                )
            normalized["target_display_name"] = target_display_name.strip()
        elif "target_display_name" in normalized and target_display_name is not None:
            raise ToolError(
                "invalid_param", "target_display_name must be null/absent when target_id is null"
            )
        if boundary != {"kind": "until_consumed", "uses": 1}:
            raise ToolError(
                "invalid_param", "bonus/penalty effects must use one-shot until_consumed boundary"
            )
        document = coc_exceptional_effects.load(ctx.campaign_dir)
        source_decision_ids = normalized.get("source_decision_ids")
        if source_decision_ids is not None:
            if (
                normalized["target_id"] is None
                or not isinstance(source_decision_ids, list)
                or not source_decision_ids
                or not all(
                    isinstance(value, str) and bool(value.strip())
                    for value in source_decision_ids
                )
                or len(set(source_decision_ids)) != len(source_decision_ids)
            ):
                raise ToolError(
                    "invalid_param",
                    "relationship reward source_decision_ids require a non-null target_id and unique non-empty decision ids",
                )
            normalized["source_decision_ids"] = [
                value.strip() for value in source_decision_ids
            ]
            linked_calls = [
                _successful_call_by_decision(ctx, value)
                for value in normalized["source_decision_ids"]
            ]
            if not any(
                call.get("tool") == "state.npc_update"
                and (call.get("data") or {}).get("npc_id") == normalized["target_id"]
                and (call.get("data") or {}).get("investigator_id")
                == normalized["investigator_id"]
                and bool((call.get("data") or {}).get("applied"))
                for call in linked_calls
                if isinstance(call.get("data"), dict)
            ):
                raise ToolError(
                    "invalid_linked_effect",
                    "an NPC-scoped relationship reward must link a successful state.npc_update for the same target_id",
                )
        for effect in document["effects"].values():
            if (
                effect.get("status") == "active"
                and effect.get("effect_kind") in {"bonus_die", "penalty_die"}
                and (effect.get("mechanics") or {}).get("investigator_id")
                == normalized["investigator_id"]
                and str((effect.get("mechanics") or {}).get("skill") or "").casefold()
                == normalized["skill"].casefold()
                and (effect.get("mechanics") or {}).get("target_id")
                == normalized["target_id"]
                and (effect.get("mechanics") or {}).get("scene_id")
                == normalized["scene_id"]
            ):
                raise ToolError(
                    "modifier_scope_conflict",
                    "an unconsumed exceptional modifier already owns this investigator+skill+NPC+scene scope",
                )
    elif effect_kind == "condition":
        if set(normalized) != {"target_id", "condition_id", "scene_id"}:
            raise ToolError(
                "invalid_param", "condition mechanics require target_id, condition_id, scene_id"
            )
        if boundary.get("kind") == "immediate":
            raise ToolError("invalid_param", "a condition requires a continuing boundary")
        if boundary.get("kind") == "until_consumed":
            raise ToolError("invalid_param", "only bonus/penalty effects may be consumed")
    elif effect_kind == "restriction":
        if set(normalized) != {"subject_id", "restriction_id", "scope", "scene_id"}:
            raise ToolError(
                "invalid_param", "restriction mechanics require subject_id, restriction_id, scope, scene_id"
            )
        if boundary.get("kind") == "immediate":
            raise ToolError("invalid_param", "a restriction requires a continuing boundary")
        if boundary.get("kind") == "until_consumed":
            raise ToolError("invalid_param", "only bonus/penalty effects may be consumed")
    elif effect_kind == "scene_event":
        if set(normalized) != {"scene_id", "event_id", "change_kind"}:
            raise ToolError(
                "invalid_param", "scene_event mechanics require scene_id, event_id, change_kind"
            )
        if normalized.get("change_kind") not in _EXCEPTIONAL_CHANGE_KINDS:
            raise ToolError(
                "invalid_param",
                "scene_event change_kind must be: " + ", ".join(sorted(_EXCEPTIONAL_CHANGE_KINDS)),
            )
        if boundary.get("kind") == "immediate":
            raise ToolError(
                "invalid_param",
                "scene_event requires a continuing boundary "
                "(until_scene_end, until_time_marker, or until_condition) so "
                "scene.context can consume it; immediate is invalid",
            )
        if boundary.get("kind") == "until_consumed":
            raise ToolError("invalid_param", "only bonus/penalty effects may be consumed")
    elif effect_kind in {"resource_delta", "relationship_or_clock"}:
        expected = (
            {"source_decision_ids"}
            if effect_kind == "resource_delta"
            else {"source_decision_ids", "affected_id", "change_summary"}
        )
        if set(normalized) != expected:
            raise ToolError(
                "invalid_param",
                f"{effect_kind} mechanics require exactly: " + ", ".join(sorted(expected)),
            )
        decision_ids = normalized.get("source_decision_ids")
        if (
            not isinstance(decision_ids, list)
            or not decision_ids
            or not all(isinstance(value, str) and value.strip() for value in decision_ids)
            or len(set(decision_ids)) != len(decision_ids)
        ):
            raise ToolError(
                "invalid_param", "source_decision_ids must be unique non-empty strings"
            )
        normalized["source_decision_ids"] = [value.strip() for value in decision_ids]
        calls = [
            _successful_call_by_decision(ctx, value)
            for value in normalized["source_decision_ids"]
        ]
        if effect_kind == "resource_delta":
            projected = coc_turn_finalization._project_state_deltas(
                calls,
                ruleset_id=_active_ruleset_id(ctx),
            )
            material = [
                row for row in projected
                if row.get("effect_kind") != "time"
                and row.get("source_decision_id") in normalized["source_decision_ids"]
            ]
            if not material:
                raise ToolError(
                    "invalid_linked_effect",
                    "resource_delta must link an authoritative non-time player state change",
                )
            if boundary != {"kind": "immediate"}:
                raise ToolError("invalid_param", "resource_delta boundary must be immediate")
        else:
            material = False
            for call in calls:
                tool_name = str(call.get("tool") or "")
                data = call.get("data") if isinstance(call.get("data"), dict) else {}
                if tool_name == "state.npc_update" and bool(data.get("applied")):
                    material = True
                elif tool_name == "state.threat_tick" and bool(data):
                    material = True
                elif tool_name == "state.time_marker" and bool(data.get("marker")):
                    material = True
                elif tool_name == "state.advance_time" and bool(data.get("fired_triggers")):
                    material = True
            if not material:
                raise ToolError(
                    "invalid_linked_effect",
                    "relationship_or_clock must link a real NPC/threat/deadline change; elapsed time or a flag name alone is insufficient",
                )
    else:
        raise ToolError("invalid_param", f"unsupported effect_kind: {effect_kind}")

    for key, value in normalized.items():
        if key.endswith("_id") and value is not None:
            if not isinstance(value, str) or not value.strip():
                raise ToolError("invalid_param", f"mechanics.{key} must be non-empty")
            normalized[key] = value.strip()
    if boundary.get("kind") == "until_scene_end":
        mechanics_scene = normalized.get("scene_id")
        if mechanics_scene != boundary.get("scene_id"):
            raise ToolError(
                "invalid_param",
                "until_scene_end requires mechanics.scene_id to match boundary.scene_id",
            )
    if (
        effect_kind == "relationship_or_clock"
        and boundary.get("kind") == "until_consumed"
    ):
        raise ToolError("invalid_param", "only bonus/penalty effects may be consumed")
    return normalized

def _tool_state_exceptional_effect(ctx: Ctx, args: dict[str, Any]):
    tool_name = "state.exceptional_effect"
    decision_id = str(args["decision_id"])
    action = str(args["action"]).strip()
    if action not in {"apply", "consume", "resolve"}:
        raise ToolError("invalid_param", "action must be apply, consume, or resolve")
    semantic_args = {
        key: deepcopy(value)
        for key, value in args.items()
        if key not in {"decision_id"}
    }
    fingerprint = _operation_fingerprint(tool_name, semantic_args)
    try:
        document = coc_exceptional_effects.load(ctx.campaign_dir)
    except ValueError as exc:
        raise ToolError("state_corrupt", str(exc)) from exc
    prior_operation = document["operations"].get(decision_id)
    if prior_operation is not None:
        if prior_operation.get("fingerprint") != fingerprint:
            raise ToolError(
                "idempotency_conflict",
                f"decision_id '{decision_id}' already owns a different exceptional effect operation",
            )
        data = deepcopy(prior_operation["data"])
        if ctx.ledger_lookup(tool_name, decision_id) is None:
            ctx.ledger_record(decision_id, tool_name, data)
        return data, ["duplicate decision_id: returning the immutable exceptional effect result"], []

    now = _now_iso()
    if action == "apply":
        source_roll_id = str(args.get("source_roll_id") or "").strip()
        direction = str(args.get("direction") or "").strip()
        effect_kind = str(args.get("effect_kind") or "").strip()
        visibility = str(args.get("visibility") or "player_visible").strip()
        impact = str(args.get("player_visible_impact") or "").strip()
        causal_link = str(args.get("causal_link") or "").strip()
        boundary = deepcopy(args.get("boundary"))
        if direction not in coc_exceptional_effects.DIRECTIONS:
            raise ToolError("invalid_param", "direction must be benefit or cost")
        if effect_kind not in coc_exceptional_effects.EFFECT_KINDS:
            raise ToolError("invalid_param", "unknown exceptional effect_kind")
        if visibility not in coc_exceptional_effects.VISIBILITIES:
            raise ToolError("invalid_param", "invalid exceptional effect visibility")
        if not impact or not causal_link:
            raise ToolError(
                "invalid_param", "player_visible_impact and causal_link must be non-empty"
            )
        if not coc_exceptional_effects._valid_boundary(boundary):
            raise ToolError("invalid_param", "boundary does not match the closed schema")
        source = _exceptional_roll_source(ctx, source_roll_id)
        source_data = source["data"]
        outcome = str(source_data.get("outcome") or "")
        pushed_failure = bool(source_data.get("pushed") is True and outcome == "failure")
        mechanics = _validated_exceptional_mechanics(
            ctx,
            effect_kind=effect_kind,
            mechanics=args.get("mechanics"),
            boundary=boundary,
        )
        relationship_reward = bool(
            source.get("tool") in {"rules.roll", "rules.push"}
            and source_data.get("passed") is True
            and outcome not in {"critical"}
            and direction == "benefit"
            and effect_kind == "bonus_die"
            and mechanics.get("target_id") is not None
            and mechanics.get("source_decision_ids")
        )
        expected_direction = (
            "benefit" if outcome == "critical"
            else "cost" if outcome == "fumble" or pushed_failure
            else "benefit" if relationship_reward
            else None
        )
        if expected_direction is None:
            raise ToolError(
                "invalid_source_roll",
                "only critical, fumble, failed pushed checks, or a successful NPC-scoped relationship reward with linked state.npc_update may create this effect",
            )
        if direction != expected_direction:
            raise ToolError(
                "invalid_param",
                f"{outcome}{' pushed' if pushed_failure else ''} requires direction={expected_direction}",
            )
        effect_id = coc_exceptional_effects.stable_effect_id(
            decision_id, source_roll_id
        )
        effect = {
            "schema_version": 1,
            "effect_id": effect_id,
            "source_roll": {
                "tool": source["tool"],
                "decision_id": source["decision_id"],
                "roll_id": source_roll_id,
                "integrity_digest": source[_SOURCE_RECEIPT_INTEGRITY_KEY],
                "outcome": outcome,
                "pushed": bool(source_data.get("pushed") is True),
                "visibility": str(source_data.get("visibility") or source["roll_record"].get("visibility") or "public"),
            },
            "direction": direction,
            "effect_kind": effect_kind,
            "player_visible_impact": impact,
            "causal_link": causal_link,
            "boundary": boundary,
            "mechanics": mechanics,
            "visibility": visibility,
            "status": "active" if boundary.get("kind") != "immediate" else "applied",
            "created_at": now,
            "created_decision_id": decision_id,
            "consumed_at": None,
            "consumed_decision_id": None,
            "consumed_by_roll_id": None,
            "integrity_digest": "",
        }
        effect["integrity_digest"] = coc_exceptional_effects.canonical_digest({
            key: deepcopy(value)
            for key, value in effect.items()
            if key != "integrity_digest"
        })
        if not coc_exceptional_effects.valid_effect(effect):
            raise ToolError("state_corrupt", "generated exceptional effect is invalid")
        document["effects"][effect_id] = effect
        projected = coc_exceptional_effects.project_player_effect(effect)
        data = {"action": "apply", "effect": deepcopy(effect), "player_effect": projected}
    elif action == "consume":
        effect_id = str(args.get("effect_id") or "").strip()
        consuming_roll_id = str(args.get("consuming_roll_id") or "").strip()
        effect = document["effects"].get(effect_id)
        if not isinstance(effect, dict):
            raise ToolError("unknown_effect", "effect_id is not a canonical exceptional effect")
        if effect.get("status") != "active" or effect.get("effect_kind") not in {"bonus_die", "penalty_die"}:
            raise ToolError("invalid_effect_state", "only an active bonus/penalty effect may be consumed")
        consuming = _exceptional_roll_source(ctx, consuming_roll_id)
        consuming_data = consuming["data"]
        mechanics = effect["mechanics"]
        if (
            consuming_data.get("investigator_id") != mechanics.get("investigator_id")
            or str(consuming_data.get("skill") or "").casefold()
            != str(mechanics.get("skill") or "").casefold()
        ):
            raise ToolError(
                "modifier_scope_mismatch",
                "consuming roll actor/skill does not match the declared exceptional scope",
            )
        if (
            mechanics.get("target_id") is not None
            and consuming_data.get("npc_id") != mechanics.get("target_id")
        ):
            raise ToolError(
                "modifier_scope_mismatch",
                "consuming roll NPC does not match the relationship reward target_id",
            )
        scene_id = mechanics.get("scene_id")
        if scene_id is not None and str(ctx.world().get("active_scene_id") or "") != scene_id:
            raise ToolError(
                "modifier_scope_mismatch", "consuming roll is outside the declared scene scope"
            )
        expected_key = "bonus" if effect["effect_kind"] == "bonus_die" else "penalty"
        opposite_key = "penalty" if expected_key == "bonus" else "bonus"
        if (
            consuming_data.get(expected_key) != mechanics.get("dice")
            or consuming_data.get(opposite_key) != 0
        ):
            raise ToolError(
                "modifier_not_applied",
                "the consuming roll must carry exactly the declared net bonus/penalty dice",
            )
        effect = deepcopy(effect)
        effect.update({
            "status": "consumed",
            "consumed_at": now,
            "consumed_decision_id": decision_id,
            "consumed_by_roll_id": consuming_roll_id,
            "integrity_digest": "",
        })
        effect["integrity_digest"] = coc_exceptional_effects.canonical_digest({
            key: deepcopy(value)
            for key, value in effect.items()
            if key != "integrity_digest"
        })
        document["effects"][effect_id] = effect
        data = {
            "action": "consume",
            "effect": deepcopy(effect),
            "player_effect": coc_exceptional_effects.project_player_effect(effect),
        }
    else:
        effect_id = str(args.get("effect_id") or "").strip()
        resolution_roll_id = str(args.get("resolution_roll_id") or "").strip()
        resolution_event_ids = args.get("resolution_event_ids") or []
        resolution_reason = str(args.get("resolution_reason") or "").strip()
        effect = document["effects"].get(effect_id)
        if not isinstance(effect, dict):
            raise ToolError("unknown_effect", "effect_id is not a canonical exceptional effect")
        if (
            effect.get("status") != "active"
            or effect.get("effect_kind") not in {"condition", "restriction"}
            or (effect.get("boundary") or {}).get("kind") != "until_condition"
        ):
            raise ToolError(
                "invalid_effect_state",
                "resolve requires an active condition/restriction with an until_condition boundary",
            )
        if not isinstance(resolution_event_ids, list) or any(
            not isinstance(value, str) or not value.strip()
            for value in resolution_event_ids
        ):
            raise ToolError(
                "invalid_param", "resolution_event_ids must be non-empty strings"
            )
        resolution_event_ids = [value.strip() for value in resolution_event_ids]
        if bool(resolution_roll_id) == bool(resolution_event_ids):
            raise ToolError(
                "invalid_param",
                "resolve requires exactly one of resolution_roll_id or resolution_event_ids",
            )
        if not resolution_reason:
            raise ToolError("invalid_param", "resolve requires resolution_reason")
        terminal_source_id: str | None = resolution_roll_id or None
        if resolution_roll_id:
            resolving = _exceptional_resolution_source(ctx, resolution_roll_id)
            if resolving["data"].get("passed") is not True:
                raise ToolError(
                    "resolution_not_proven",
                    "resolution_roll_id must name a successful canonical check",
                )
        else:
            event_rows: list[dict[str, Any]] = []
            events_path = ctx.campaign_dir / "logs" / "events.jsonl"
            if events_path.is_file():
                for line in events_path.read_text(encoding="utf-8").splitlines():
                    try:
                        row = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if isinstance(row, dict):
                        event_rows.append(row)
            missing = [
                evidence_id for evidence_id in resolution_event_ids
                if not any(
                    evidence_id in {row.get("event_id"), row.get("decision_id")}
                    for row in event_rows
                )
            ]
            if missing:
                raise ToolError(
                    "resolution_not_proven",
                    "resolution_event_ids are not canonical campaign events: "
                    + ", ".join(missing),
                )
        effect = deepcopy(effect)
        effect.update({
            "status": "resolved",
            "consumed_at": now,
            "consumed_decision_id": decision_id,
            "consumed_by_roll_id": terminal_source_id,
            "integrity_digest": "",
        })
        effect["integrity_digest"] = coc_exceptional_effects.canonical_digest({
            key: deepcopy(value)
            for key, value in effect.items()
            if key != "integrity_digest"
        })
        document["effects"][effect_id] = effect
        data = {
            "action": "resolve",
            "effect": deepcopy(effect),
            "player_effect": coc_exceptional_effects.project_player_effect(effect),
        }

    document["operations"][decision_id] = {
        "decision_id": decision_id,
        "action": action,
        "fingerprint": fingerprint,
        "effect_id": effect_id,
        "data": deepcopy(data),
    }
    if not coc_exceptional_effects.valid_document(document):
        raise ToolError("state_corrupt", "generated exceptional effect document is invalid")
    coc_state.write_json_atomic(
        ctx.campaign_dir / "save" / coc_exceptional_effects.FILENAME,
        document,
    )
    ctx.log_event({
        "event_type": "exceptional_effect_" + action,
        "effect_id": effect_id,
        "decision_id": decision_id,
        "effect_kind": effect["effect_kind"],
        "direction": effect["direction"],
        "status": effect["status"],
    })
    ctx.ledger_record(decision_id, tool_name, data)
    return data, [], [
        "this effect is canonical state; realize its causal link in fiction and let turn.finalize render the player-visible impact",
        "player_visible_impact, causal_link, and any until_condition boundary.description are rendered verbatim in the mechanics block; keep all of them in the campaign's active play_language",
    ]

def register_operations(registry) -> None:
    global TOOLS
    TOOLS = registry.legacy_tools
    registry.tool(
    "state.set_flag",
    "Set or clear a structured world flag (feeds flag_set unlock conditions).",
    {
        "flag_id": {"type": "string", "required": True, "desc": "flag identifier"},
        "value": {"type": "boolean", "desc": "true (default) or false"},
        "reason": {"type": "string", "desc": "why (logged)"},
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)(_tool_state_set_flag)
    registry.tool(
    "state.clear_transient_condition",
    "Clear one combat-only positional condition after the fiction ends it; injury, dying, and death conditions are intentionally unsupported.",
    {
        "investigator": {"type": "string", "desc": "investigator id"},
        "condition": {
            "type": "string",
            "required": True,
            "desc": "prone | grappled | surprised | outnumbered | fled",
        },
        "reason": {
            "type": "string",
            "required": True,
            "desc": "the narrated action or transition that ended the condition",
        },
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)(_tool_state_clear_transient_condition)
    registry.tool(
    "state.time_marker",
    "Set, reset, or clear a persistent in-fiction deadline marker. Bookkeeping only; it never auto-fires narrative effects.",
    {
        "action": {"type": "string", "required": True, "desc": "set | reset | clear"},
        "marker_id": {"type": "string", "required": True, "desc": "stable deadline/agreement id"},
        "minutes_from_now": {
            "type": "integer",
            "desc": "minutes until due; required for set/reset and must be >= 0",
        },
        "label": {"type": "string", "desc": "short keeper-facing label"},
        "reason": {"type": "string", "desc": "why the marker changed (logged)"},
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)(_tool_state_time_marker)
    registry.tool(
    "state.time_appearance",
    "Set the broad player-perceived light/time appearance without changing the "
    "authoritative elapsed or civil clock. Use for polar day/night, inverted cycles, "
    "or source-/fiction-established supernatural distortion.",
    {
        "mode": {
            "type": "string", "required": True,
            "enum": [
                "normal", "perpetual_daylight", "perpetual_darkness",
                "inverted", "distorted",
            ],
            "desc": "structured presentation mode chosen semantically by the KP",
        },
        "display_label": {
            "type": "string",
            "desc": "optional active-play-language label overriding the mode default",
        },
        "reason": {
            "type": "string", "required": True,
            "desc": "source- or fiction-established reason for the presentation change",
        },
        "source_ref": {
            "type": "string",
            "desc": "optional module/campaign evidence reference",
        },
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)(_tool_state_time_appearance)
    registry.tool(
    "state.advance_time",
    "Advance the in-fiction clock (monotonic). Fires due triggers; an imprecise civil clock may also record a source- or fiction-established broad phase reached after the elapsed interval.",
    {
        "minutes": {"type": "integer", "required": True, "desc": "minutes to advance (>= 0)"},
        "reason": {"type": "string", "required": True, "desc": "what consumed the time"},
        "day_phase_after": {
            "type": "string",
            "enum": ["morning", "afternoon", "evening", "night"],
            "desc": "optional broad phase established after this interval for an imprecise civil clock; requires display_after",
        },
        "display_after": {
            "type": "string",
            "desc": "localized imprecise civil-time display paired with day_phase_after",
        },
        "decision_id": {"type": "string", "required": True, "desc": "idempotency key"},
    },
)(_tool_state_advance_time)
    registry.tool(
    "state.clock_discontinuity",
    "Replace the in-fiction civil-calendar anchor for an explicit time shift, loop reset, dream transition, or correction while preserving monotonic elapsed time and relative deadlines.",
    {
        "discontinuity_kind": {
            "type": "string",
            "required": True,
            "enum": [
                "time_shift",
                "loop_reset",
                "dream_transition",
                "calendar_correction",
                "other",
            ],
            "desc": "structured semantic kind chosen by the KP; never inferred from prose",
        },
        "calendar_mode": {
            "type": "string",
            "required": True,
            "enum": [
                "relative",
                "gregorian",
                "julian",
                "proleptic_gregorian",
                "fictional",
            ],
            "desc": "calendar used by the target civil-time anchor",
        },
        "precision": {
            "type": "string",
            "required": True,
            "enum": ["exact", "minute", "hour", "date", "day_phase", "unknown"],
            "desc": "source-supported precision; day_phase/date avoid inventing an exact clock time",
        },
        "display": {
            "type": "string",
            "required": True,
            "desc": "faithful campaign-language rendering of the target civil time",
        },
        "local_datetime": {
            "type": "string",
            "desc": "ISO local datetime when precision is exact/minute/hour",
        },
        "local_date": {
            "type": "string",
            "desc": "ISO local date when the source establishes a date without an exact time",
        },
        "timezone": {
            "type": "string",
            "desc": "target timezone when meaningful; omission clears a stale prior timezone",
        },
        "day_phase": {
            "type": "string",
            "enum": ["morning", "afternoon", "evening", "night", "unknown"],
            "desc": "broad source-supported phase when no exact time is known",
        },
        "source_ref": {
            "type": "string",
            "desc": "optional module or campaign-canon provenance reference",
        },
        "civil_anchor_elapsed": {
            "type": "integer",
            "minimum": 0,
            "desc": "optional prior monotonic elapsed position where this civil anchor became true; use only for delayed recovery/correction from authoritative evidence",
        },
        "reason": {
            "type": "string",
            "required": True,
            "desc": "why the civil clock changed in the fiction",
        },
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
    write_domains=("time",),
)(_tool_state_clock_discontinuity)
    registry.tool(
    "state.mark_safe_rest",
    "Record that one investigator completed a full sleep in a safe place after its elapsed time was advanced. Resets the canonical rest anchor read by Director continuity; never inferred from prose.",
    {
        "investigator": {"type": "string", "desc": "investigator id (optional when party has one member)"},
        "rest_kind": {"type": "string", "required": True, "enum": ["full_sleep"], "desc": "currently exactly full_sleep; a structured KP assertion, not text classification"},
        "decision_id": {"type": "string", "required": True, "desc": "idempotency key"},
    },
)(_tool_state_mark_safe_rest)
    registry.tool(
    "state.exceptional_effect",
    "Apply or consume one source-bound substantive consequence/reward for a critical, fumble, failed pushed check, or exceptional first-impression check. This is canonical state, not prose advice.",
    {
        "action": {"type": "string", "required": True, "enum": ["apply", "consume", "resolve"], "desc": "apply | consume | resolve"},
        "source_roll_id": {"type": "string", "desc": "critical/fumble/pushed-failure/first-impression roll_id (apply)"},
        "effect_id": {"type": "string", "desc": "active bonus/penalty effect id (consume)"},
        "consuming_roll_id": {"type": "string", "desc": "later roll that actually used the modifier (consume)"},
        "resolution_roll_id": {"type": "string", "desc": "successful canonical check that satisfied an until_condition boundary (resolve)"},
        "resolution_event_ids": {"type": "array", "desc": "canonical event_id/decision_id evidence that satisfied a non-roll until_condition boundary (resolve)"},
        "resolution_reason": {"type": "string", "desc": "semantic reason the successful check satisfies the recorded boundary (resolve)"},
        "direction": {"type": "string", "enum": sorted(coc_exceptional_effects.DIRECTIONS), "desc": "benefit | cost (apply)"},
        "effect_kind": {"type": "string", "enum": sorted(coc_exceptional_effects.EFFECT_KINDS), "desc": "bonus_die | penalty_die | condition | restriction | relationship_or_clock | scene_event | resource_delta"},
        "player_visible_impact": {"type": "string", "desc": "exact concise mechanical/fictional impact rendered verbatim to the player; write it in the campaign's active play_language"},
        "causal_link": {"type": "string", "desc": "exact player-visible causal wording rendered verbatim; write it in the campaign's active play_language, not as internal audit reasoning"},
        "boundary": {"type": "object", "properties": {"kind": {"type": "string", "enum": sorted(coc_exceptional_effects.BOUNDARY_KINDS)}}, "desc": "exactly one of {kind:immediate}; {kind:until_consumed,uses:1}; {kind:until_scene_end,scene_id}; {kind:until_time_marker,marker_id}; {kind:until_condition,description}. The legal kind depends on effect_kind: bonus/penalty require until_consumed with uses=1; resource_delta requires immediate; scene_event, condition, and restriction require a continuing until_scene_end/until_time_marker/until_condition boundary (immediate and until_consumed are rejected). until_condition.description is rendered verbatim to the player and must use the campaign's active play_language"},
        "mechanics": {"type": "object", "properties": {"change_kind": {"type": "string", "enum": sorted(_EXCEPTIONAL_CHANGE_KINDS)}}, "desc": "bonus/penalty={dice,investigator_id,skill,scene_id:null|string,target_id:null|npc_id}; non-null target_id also requires localized target_display_name; NPC-scoped relationship bonus additionally requires source_decision_ids linking state.npc_update; condition={target_id,condition_id,scene_id}; restriction={subject_id,restriction_id,scope,scene_id}; scene_event={scene_id,event_id,change_kind} where change_kind is exactly one of arrival|escalation|hazard|loss|opening|reversal (a closed set — never invent a free-form value); resource_delta={source_decision_ids}; relationship_or_clock={source_decision_ids,affected_id,change_summary}"},
        "visibility": {"type": "string", "enum": sorted(coc_exceptional_effects.VISIBILITIES), "desc": "player_visible | concealed_observable | keeper_only"},
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)(_tool_state_exceptional_effect)


OPERATION_EXPORTS = (
    '_EXCEPTIONAL_CHANGE_KINDS',
    '_deadline_due_at',
    '_exceptional_resolution_source',
    '_exceptional_roll_source',
    '_flag_head_is_source_anchored',
    '_ledger_roll_owner',
    '_marker_head_is_source_anchored',
    '_next_flag_source_sequence',
    '_next_marker_source_sequence',
    '_positive_source_sequence',
    '_project_active_time_markers',
    '_repair_flag_live_head',
    '_repair_marker_live_head',
    '_successful_call_by_decision',
    '_tool_state_advance_time',
    '_tool_state_clear_transient_condition',
    '_tool_state_clock_discontinuity',
    '_tool_state_exceptional_effect',
    '_tool_state_mark_safe_rest',
    '_tool_state_set_flag',
    '_tool_state_time_appearance',
    '_tool_state_time_marker',
    '_validated_exceptional_mechanics',
)
