#!/usr/bin/env python3
"""Operation adapter cell: sanity-recovery."""
from __future__ import annotations

from coc_operation_kernel_runtime import (
    register_context_enricher,
    Any,
    Ctx,
    ToolError,
    _active_scene,
    _execute_subsystem_command,
    _load_sibling,
    emit_core_canonical_event,
    _player_mechanical_snapshot,
    _player_state_receipt,
    _read_optional_json,
    _resolve_investigator,
    _rng,
    _rules_resolver,
    _scene_by_id,
    coc_subsystem_executor,
    coc_time,
    deepcopy,
    tool,
)

coc_sanity = _load_sibling("coc_sanity_sanity_execute", "coc_sanity.py")

_EXTENDED_SANITY_COMMAND_PHASES = {
    "reality_check": "resolve",
    "gain_current_san": "resolve",
    "insane_insight": "advise",
    "apply_psychoanalysis_treatment": "due-trigger",
    "recover_temporary_insanity": "due-trigger",
}

def _bout_active_hint(session: Any) -> str:
    return (
        f"bout of madness active ({session.active_bout_id}, "
        f"{int(session.bout_rounds_remaining)} round(s) remaining): the Keeper controls "
        "the investigator — realize the forced behavior in this turn's output; further "
        "SAN checks are blocked while the bout is active (p.157)"
    )

def _tool_rules_sanity_check(ctx: Ctx, args: dict[str, Any]):
    investigator_id = _resolve_investigator(ctx, args)
    prior = ctx.ledger_lookup("rules.sanity_check", args.get("decision_id"))
    if prior is not None:
        return prior.get("data"), ["duplicate decision_id: returning the previously settled result"], []
    rng = _rng(args)
    loss_success = args.get("loss_success", "0")
    loss_failure = str(args["loss_failure"])
    for label, expression in (("loss_success", loss_success), ("loss_failure", loss_failure)):
        if str(expression).strip() in ("0", ""):
            continue
        try:
            _rules_resolver(ctx, "validate_san_loss_expression").validate_san_loss_expression(expression)
        except ValueError as exc:
            raise ToolError("invalid_param", f"{label}: {exc}") from exc
    sheet = ctx.sheet(investigator_id)
    characteristics = (
        sheet.get("characteristics") if isinstance(sheet.get("characteristics"), dict) else {}
    )
    int_value = int(characteristics.get("INT", 50))
    derived = sheet.get("derived") if isinstance(sheet.get("derived"), dict) else {}
    sheet_skills = sheet.get("skills") if isinstance(sheet.get("skills"), dict) else {}
    cm_value = int(sheet_skills.get("Cthulhu Mythos", 0))
    had_snapshot = _rules_resolver(ctx, "sanity_snapshot_exists").sanity_snapshot_exists(
        ctx.campaign_dir, investigator_id
    )
    session = _rules_resolver(ctx, "sanity_session_load").sanity_session_load(
        ctx.campaign_dir,
        investigator_id,
        int_value=int_value,
        rng=rng,
        cm_value=cm_value,
    )
    if not had_snapshot:
        sheet_san = int(derived.get("SAN", characteristics.get("POW", 50)))
        inv_state = ctx.inv_state(investigator_id)
        current_san = int(inv_state.get("current_san", sheet_san))
        session.san_max = sheet_san
        session.san_current = current_san
        session.day_start_san = current_san
    san_before = int(session.san_current)
    rolls_start = len(session.pending_rolls)
    events_start = len(session.events)
    source = str(args["source"])
    trigger_id = str(args.get("trigger_id") or "").strip()
    involuntary_action = args.get("involuntary_action")
    if not isinstance(involuntary_action, dict):
        raise ToolError("invalid_param", "involuntary_action must be an object")
    involuntary_kind = str(involuntary_action.get("kind") or "").strip()
    if involuntary_kind not in {
        "jump_in_fright",
        "cry_out",
        "involuntary_movement",
        "involuntary_combat_action",
        "freeze",
    }:
        raise ToolError(
            "invalid_param",
            "involuntary_action.kind must be one of the five rulebook kinds",
        )
    involuntary_summary = str(involuntary_action.get("summary") or "").strip()
    if not involuntary_summary:
        raise ToolError(
            "invalid_param", "involuntary_action.summary must be a non-empty string"
        )
    event = session.sanity_check(
        source=source,
        san_loss_success=loss_success,
        san_loss_fail_expr=loss_failure,
        involuntary_kind=involuntary_kind,
        involuntary_summary=involuntary_summary,
    )
    session.save(ctx.campaign_dir, strict_mirror=True)
    new_rolls = list(session.pending_rolls[rolls_start:])
    new_events = list(session.events[events_start:])
    event_payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}

    if event.get("type") == "sanity_check_skipped":
        skip_reason = str(event_payload.get("summary") or "")
        data = {
            "investigator_id": investigator_id,
            "source": source,
            "sanity_check_skipped": True,
            "skip_reason": skip_reason,
            "check": None,
            "success": False,
            "san_loss": 0,
            "loss_detail": {"rolls": []},
            "san_before": san_before,
            "san_after": int(session.san_current),
            "trigger_id": trigger_id or None,
            "bout_triggered": False,
            "bout_active": bool(session.bout_active),
            "active_bout_id": session.active_bout_id,
            "bout_rounds_remaining": int(session.bout_rounds_remaining),
            "temporary_insane": bool(session.temporary_insane),
            "indefinite_insane": bool(session.indefinite_insane),
            "permanently_insane": bool(session.permanently_insane),
            "daily_san_lost": int(session.daily_san_lost),
            "day_start_san": int(session.day_start_san),
            "session_roll_ids": [],
            "session_events": [],
        }
        warnings = [f"SAN check skipped: {skip_reason}"]
        if trigger_id:
            warnings.append(
                f"SAN trigger '{trigger_id}' was NOT marked fired because the check "
                "was skipped; re-resolve it once the bout of madness has ended"
            )
        hints = []
        if session.bout_active:
            hints.append(_bout_active_hint(session))
        ctx.ledger_record(args.get("decision_id"), "rules.sanity_check", data)
        return data, warnings, hints

    san_loss = int(event_payload.get("san_loss", 0))
    san_after = int(event_payload.get("san_after", session.san_current))
    outcome = str(event_payload.get("roll_outcome") or "regular")
    success = outcome not in ("failure", "fumble")

    extra_roll_id_keys = {
        "bout_duration_hours": "bout_duration_roll_id",
        "bout_of_madness_table": "bout_table_roll_id",
        "bout_duration_rounds": "bout_rounds_roll_id",
        "phobia_table": "phobia_roll_id",
        "mania_table": "mania_roll_id",
    }
    roll_ids: dict[str, str] = {}
    session_roll_ids: list[str] = []
    san_roll_record: dict[str, Any] = {}
    for record in new_rolls:
        engine_roll_id = str(record.get("roll_id") or "")
        record_payload = {
            **record,
            "sanity_session_roll_id": engine_roll_id,
            "source": source,
            "trigger_id": trigger_id or None,
        }
        record_payload.pop("roll_id", None)
        skill = str(record.get("skill") or "")
        if skill == "SAN":
            kind = "sanity_check"
        elif skill == "INT":
            kind = "skill_check"
        else:
            kind = str(record.get("kind") or "sanity_table_roll")
        if skill == "SAN":
            san_roll_record = record
        if skill == "SAN" and outcome == "fumble":
            record_payload["fumble_consequence"] = {
                "summary": (
                    "SAN fumble resolves through the authored failed-check maximum loss: "
                    f"{san_loss} SAN lost from {loss_failure}."
                ),
                "effect": {
                    "kind": "san_loss",
                    "amount": san_loss,
                    "san_before": san_before,
                    "san_after": san_after,
                },
            }
        logged = ctx.log_roll({
            "event_type": "roll",
            "kind": kind,
            "actor": investigator_id,
            "visibility": "consequence_public",
            "payload": record_payload,
            **record_payload,
        })
        session_roll_ids.append(logged["roll_id"])
        if skill == "SAN":
            roll_ids["check_roll_id"] = logged["roll_id"]
        elif skill == "INT":
            roll_ids["int_roll_id"] = logged["roll_id"]
        else:
            extra_key = extra_roll_id_keys.get(str(record.get("kind") or ""))
            if extra_key:
                roll_ids[extra_key] = logged["roll_id"]

    loss_faces = list(san_roll_record.get("san_loss_rolls") or [])
    loss_roll_id = None
    if loss_faces:
        loss_expression = str(
            san_roll_record.get("san_loss_expression")
            or (loss_success if success else loss_failure)
        )
        loss_payload = {
            "rolls": loss_faces,
            "die_expression": loss_expression,
            "individual_faces": loss_faces,
            "final_total": san_loss,
            "roll": san_loss,
            "san_before": san_before,
            "san_after": san_after,
            "source": source,
        }
        loss_record = ctx.log_roll({
            "event_type": "roll",
            "type": "san_loss",
            "kind": "san_loss",
            "actor": investigator_id,
            "visibility": "consequence_public",
            "payload": loss_payload,
            **loss_payload,
        })
        loss_roll_id = loss_record["roll_id"]

    settled_involuntary_action = san_roll_record.get("involuntary_action")
    sanity_loss_event = {
        "event_type": "sanity_loss",
        "investigator_id": investigator_id,
        "loss": san_loss,
        "source": source,
        "trigger_id": trigger_id or None,
    }
    if isinstance(settled_involuntary_action, dict):
        sanity_loss_event["involuntary_action"] = dict(settled_involuntary_action)
    ctx.log_event(sanity_loss_event)
    _san_delta = int(san_after) - int(san_before)
    if _san_delta != 0:
        _san_payload: dict[str, Any] = {
            "_v": 1,
            "investigator": investigator_id,
            "delta": _san_delta,
            "cause": source,
            "before": int(san_before),
            "after": int(san_after),
        }
        _san_source_roll = loss_roll_id or roll_ids.get("check_roll_id")
        if _san_source_roll:
            _san_payload["source_roll_id"] = str(_san_source_roll)
        emit_core_canonical_event(
            ctx,
            event_type="sanity-changed",
            source="coc_operation_sanity_recovery.sanity_check",
            decision_id=str(args.get("decision_id") or ""),
            data=_san_payload,
        )
    session_events: list[dict[str, Any]] = []
    for row in new_events:
        row_payload = (
            row.get("payload")
            if isinstance(row.get("payload"), dict)
            else {"summary": str(row.get("payload") or "")}
        )
        row_type = str(row.get("type") or "")
        session_events.append({
            "event_id": row.get("event_id"),
            "event_type": row_type,
            **row_payload,
        })
        if row_type == "sanity":
            # Already mirrored by the compatibility sanity_loss event above.
            continue
        ctx.log_event({
            "event_type": row_type or "sanity_event",
            "investigator_id": investigator_id,
            "sanity_event_id": row.get("event_id"),
            **row_payload,
        })

    warnings: list[str] = []
    if trigger_id:
        world = ctx.world()
        active_scene = _scene_by_id(ctx.story_graph, world.get("active_scene_id"))
        authored_ids = {
            str(trigger.get("trigger_id"))
            for trigger in ((active_scene or {}).get("on_enter") or {}).get(
                "san_triggers", []
            )
            if isinstance(trigger, dict) and trigger.get("trigger_id")
        }
        if trigger_id not in authored_ids:
            warnings.append(
                f"SAN trigger '{trigger_id}' is not authored for the active scene — "
                "the check remains valid but the trigger was recorded as improvised"
            )
        fired = [str(value) for value in (world.get("san_triggers_fired") or [])]
        if trigger_id not in fired:
            fired.append(trigger_id)
            world["san_triggers_fired"] = fired
            ctx.save_world(world)

    check = {
        "skill": "SAN",
        "target": san_before,
        "roll": int(san_roll_record.get("roll", 0)),
        "outcome": outcome,
        "source": source,
        "trigger_id": trigger_id or None,
        "san_loss": san_loss,
        "san_before": san_before,
        "san_after": san_after,
    }
    if isinstance(settled_involuntary_action, dict):
        check["involuntary_action"] = dict(settled_involuntary_action)
    data = {
        "investigator_id": investigator_id,
        "source": source,
        "check": check,
        "success": success,
        "san_loss": san_loss,
        "loss_detail": {
            "rolls": loss_faces,
            "resolution": san_roll_record.get("san_loss_resolution"),
            "raw_total": san_roll_record.get("san_loss_raw_total"),
            "expression": san_roll_record.get("san_loss_expression"),
        },
        "san_before": san_before,
        "san_after": san_after,
        "trigger_id": trigger_id or None,
        "sanity_check_skipped": False,
        "bout_triggered": bool(session.bout_active or session.temporary_insane),
        "bout_active": bool(session.bout_active),
        "active_bout_id": session.active_bout_id,
        "bout_rounds_remaining": int(session.bout_rounds_remaining),
        "temporary_insane": bool(session.temporary_insane),
        "indefinite_insane": bool(session.indefinite_insane),
        "permanently_insane": bool(session.permanently_insane),
        "daily_san_lost": int(session.daily_san_lost),
        "day_start_san": int(session.day_start_san),
        "session_roll_ids": session_roll_ids,
        "session_events": session_events,
        **roll_ids,
    }
    if isinstance(settled_involuntary_action, dict):
        data["involuntary_action"] = dict(settled_involuntary_action)
    if loss_roll_id:
        data["loss_roll_id"] = loss_roll_id
    hints: list[str] = []
    if session.bout_active:
        hints.append(_bout_active_hint(session))
    elif session.temporary_insane or session.indefinite_insane:
        hints.append(
            "underlying insanity: any further SAN loss of 1+ triggers another bout "
            "of madness (p.158); everyday behavior can look normal between bouts"
        )
    if session.indefinite_insane:
        hints.append(
            "indefinite insanity (1/5+ of day-start SAN lost in one game day): "
            "the investigator needs treatment and a safe place"
        )
    if session.permanently_insane:
        hints.append("SAN reached 0: permanent insanity — this investigator is lost to the Mythos")
    ctx.ledger_record(args.get("decision_id"), "rules.sanity_check", data)
    return data, warnings, hints

def _tool_sanity_context(ctx: Ctx, args: dict[str, Any]):
    investigator_id = _resolve_investigator(ctx, args)
    snapshot = _read_optional_json(
        ctx.campaign_dir / "save" / "sanity-state" / f"{investigator_id}.json", None
    )
    choices = coc_subsystem_executor.get_current_pending_choices(ctx.campaign_dir)
    return {
        "investigator_id": investigator_id,
        "active": isinstance(snapshot, dict),
        "snapshot": snapshot,
        "pending_choices": choices,
    }, [], ["use sanity.execute for full checks, bouts, and their persisted consequences"]


def _load_live_sanity_session(ctx: Ctx, investigator_id: str, args: dict[str, Any]):
    sheet = ctx.sheet(investigator_id)
    characteristics = (
        sheet.get("characteristics")
        if isinstance(sheet.get("characteristics"), dict) else {}
    )
    skills = sheet.get("skills") if isinstance(sheet.get("skills"), dict) else {}
    derived = sheet.get("derived") if isinstance(sheet.get("derived"), dict) else {}
    had_snapshot = coc_sanity.sanity_snapshot_exists(
        ctx.campaign_dir, investigator_id,
    )
    session = coc_sanity.SanitySession.load(
        ctx.campaign_dir,
        investigator_id,
        int_value=int(characteristics.get("INT", 50)),
        rng=_rng(args),
        cm_value=int(skills.get("Cthulhu Mythos", 0)),
    )
    if not had_snapshot:
        sheet_san = int(derived.get("SAN", characteristics.get("POW", 50)))
        state = ctx.inv_state(investigator_id)
        current_san = int(state.get("current_san", sheet_san))
        session.san_max = sheet_san
        session.san_current = current_san
        session.day_start_san = current_san
    return session


def _exact_due_trigger(
    ctx: Ctx,
    *,
    investigator_id: str,
    trigger_ref: str,
    expected_handler: str,
) -> dict[str, Any]:
    trigger_id = str(trigger_ref or "").strip()
    if not trigger_id:
        raise ToolError("invalid_param", "a canonical due trigger ref is required")
    due = [
        row for row in coc_time.peek_due_triggers(ctx.campaign_dir)
        if isinstance(row, dict) and str(row.get("trigger_id") or "") == trigger_id
    ]
    if len(due) != 1:
        raise ToolError(
            "sanity_trigger_stale",
            "the exact pending due sanity trigger is unavailable",
            details={"trigger_ref": trigger_id},
        )
    trigger = due[0]
    if (
        str(trigger.get("target_id") or "") != investigator_id
        or str(trigger.get("handler") or "") != expected_handler
    ):
        raise ToolError(
            "sanity_trigger_mismatch",
            "the due trigger is not owned by this investigator and phase",
            details={"trigger_ref": trigger_id},
        )
    time_state = coc_time.read_time_state(ctx.campaign_dir)
    if trigger.get("policy") == "auto_apply_if_safe" and not bool(
        time_state.get("safe_place", False)
    ):
        raise ToolError(
            "sanity_trigger_deferred",
            "the due sanity trigger remains deferred until a canonical safe place",
        )
    return trigger


def _execute_extended_sanity_command(
    ctx: Ctx,
    args: dict[str, Any],
    *,
    investigator_id: str,
    command: dict[str, Any],
) -> tuple[dict[str, Any], list[str], list[str]]:
    kind = str(command.get("kind") or "")
    phase = str(command.get("phase") or "")
    if _EXTENDED_SANITY_COMMAND_PHASES.get(kind) != phase:
        raise ToolError(
            "invalid_param",
            f"sanity.execute command {kind!r} requires phase "
            f"{_EXTENDED_SANITY_COMMAND_PHASES.get(kind)!r}",
        )
    payload = command.get("payload")
    if not isinstance(payload, dict):
        raise ToolError("invalid_param", "command.payload must be an object")
    if str(payload.get("decision_id") or "") != str(args.get("decision_id") or ""):
        raise ToolError(
            "invalid_param",
            "command.payload.decision_id must equal the toolbox decision_id",
        )
    state_before = _player_mechanical_snapshot(ctx, investigator_id)
    events: list[dict[str, Any]] = []
    result: dict[str, Any]

    if kind == "reality_check":
        if payload.get("request_reality_check") is not True:
            raise ToolError(
                "invalid_param", "reality_check requires player confirmation",
            )
        session = _load_live_sanity_session(ctx, investigator_id, args)
        if not isinstance(session.active_delusion, dict):
            raise ToolError(
                "reality_check_unavailable",
                "the investigator has no active canonical delusion to test",
            )
        before = int(session.san_current)
        outcome = session.reality_check()
        session.save(ctx.campaign_dir, strict_mirror=True)
        after = int(session.san_current)
        roll = ctx.log_roll({
            "event_type": "roll",
            "kind": "sanity_reality_check",
            "actor": investigator_id,
            "visibility": "consequence_public",
            "payload": {
                "roll": int(outcome["roll"]),
                "target": before,
                "outcome": "success" if outcome["success"] else "failure",
                "san_before": before,
                "san_after": after,
                "rule_ref": outcome["rule_ref"],
            },
        })
        event = {
            "event_type": "reality_check",
            **outcome,
            "roll_id": roll["roll_id"],
            "san_before": before,
            "san_after": after,
        }
        ctx.log_event({"investigator_id": investigator_id, **event})
        events.append(event)
        result = {"outcome": outcome, "roll_id": roll["roll_id"]}
    elif kind == "gain_current_san":
        amount = payload.get("san_gain")
        if isinstance(amount, bool) or not isinstance(amount, int) or amount <= 0:
            raise ToolError("invalid_param", "san_gain must be a positive integer")
        source = str(payload.get("gain_source") or "").strip()
        if not source:
            raise ToolError("invalid_param", "gain_source must be non-empty")
        session = _load_live_sanity_session(ctx, investigator_id, args)
        before = int(session.san_current)
        session.gain_san(amount, source=source)
        session.save(ctx.campaign_dir, strict_mirror=True)
        after = int(session.san_current)
        event = {
            "event_type": "sanity_gain",
            "source": source,
            "requested": amount,
            "san_before": before,
            "san_gain": after - before,
            "san_after": after,
        }
        ctx.log_event({"investigator_id": investigator_id, **event})
        events.append(event)
        result = event
    elif kind == "insane_insight":
        session = _load_live_sanity_session(ctx, investigator_id, args)
        if not (session.temporary_insane or session.indefinite_insane):
            raise ToolError(
                "insane_insight_unavailable",
                "insane insight applies only while temporary or indefinite insanity is active",
            )
        insight = str(payload.get("insight") or "").strip()
        if not insight:
            raise ToolError("invalid_param", "insight must be non-empty")
        result = {
            "insight": insight,
            "insanity_state": (
                "indefinite" if session.indefinite_insane else "temporary"
            ),
            "authority": "keeper-advisory",
        }
    else:
        ref_key = (
            "treatment_trigger_ref"
            if kind == "apply_psychoanalysis_treatment"
            else "recovery_trigger_ref"
        )
        expected_handler = kind
        if kind == "apply_psychoanalysis_treatment":
            sheet = ctx.sheet(investigator_id)
            skills = sheet.get("skills") if isinstance(sheet.get("skills"), dict) else {}
            raw_skill = skills.get("Psychoanalysis", 1)
            skill_value = (
                int(raw_skill)
                if isinstance(raw_skill, int) and not isinstance(raw_skill, bool)
                else 1
            )
            state = ctx.inv_state(investigator_id)
            state["psychoanalysis_skill"] = max(1, min(100, skill_value))
            ctx.save_inv_state(investigator_id, state)
        trigger = _exact_due_trigger(
            ctx,
            investigator_id=investigator_id,
            trigger_ref=str(payload.get(ref_key) or ""),
            expected_handler=expected_handler,
        )
        fired = coc_time.process_due_triggers(ctx.campaign_dir)
        matched = [
            row for row in fired
            if str(row.get("trigger_id") or "") == str(trigger.get("trigger_id") or "")
        ]
        if len(matched) != 1 or matched[0].get("dispatch_error"):
            raise ToolError(
                "sanity_trigger_dispatch_failed",
                "the exact due sanity trigger did not settle cleanly",
                details={"trigger": matched[0] if matched else trigger},
            )
        result = {"trigger": matched[0], "dispatch_outcome": matched[0].get("dispatch_outcome")}
        events.append({
            "event_type": kind,
            "trigger_id": trigger.get("trigger_id"),
            "dispatch_outcome": matched[0].get("dispatch_outcome"),
        })

    data = {
        "schema_version": 1,
        "authority": "deterministic_sanity_session",
        "investigator_id": investigator_id,
        "command_kind": kind,
        "result": result,
        "events": events,
        "player_state_receipt": _player_state_receipt(
            state_before, _player_mechanical_snapshot(ctx, investigator_id),
        ),
    }
    ctx.ledger_record(args.get("decision_id"), "sanity.execute", data)
    return data, [], [
        "the sanity result is authoritative; preserve its state and public roll evidence",
    ]

def _tool_sanity_execute(ctx: Ctx, args: dict[str, Any]):
    investigator_id = _resolve_investigator(ctx, args)
    prior = ctx.ledger_lookup("sanity.execute", args.get("decision_id"))
    if prior is not None:
        return prior.get("data"), [
            "duplicate decision_id: returning the previously settled result"
        ], []
    player_state_before = _player_mechanical_snapshot(ctx, investigator_id)
    normalized_args = deepcopy(args)
    command = normalized_args.get("command")
    if not isinstance(command, dict):
        raise ToolError("invalid_param", "command must be an exact subsystem command object")
    if str(command.get("kind") or "") in _EXTENDED_SANITY_COMMAND_PHASES:
        return _execute_extended_sanity_command(
            ctx,
            normalized_args,
            investigator_id=investigator_id,
            command=command,
        )
    payload = command.get("payload") if isinstance(command, dict) else None
    trigger_id = ""
    if isinstance(payload, dict):
        trigger_id = str(
            payload.get("trigger_id") or payload.get("san_trigger_id") or ""
        ).strip()
        if trigger_id:
            payload["san_trigger_id"] = trigger_id

    data, warnings, hints = _execute_subsystem_command(
        ctx,
        normalized_args,
        tool_name="sanity.execute",
        allowed_kinds=frozenset({"sanity_check", "bout_tick", "bout_end"}),
    )
    data["player_state_receipt"] = _player_state_receipt(
        player_state_before,
        _player_mechanical_snapshot(ctx, investigator_id),
    )
    if trigger_id:
        active_scene = _active_scene(ctx)
        authored_ids = {
            str(trigger.get("trigger_id"))
            for trigger in ((active_scene.get("on_enter") or {}).get(
                "san_triggers", []
            ))
            if isinstance(trigger, dict) and trigger.get("trigger_id")
        }
        if trigger_id not in authored_ids:
            warnings.append(
                f"SAN trigger '{trigger_id}' is not authored for the active scene — "
                "the check remains valid but the trigger was recorded as improvised"
            )
        world = ctx.world()
        fired = [str(value) for value in (world.get("san_triggers_fired") or [])]
        if trigger_id not in fired:
            fired.append(trigger_id)
            world["san_triggers_fired"] = fired
            ctx.save_world(world)
        # Preserve the canonical authored identity in the returned/ledgered
        # subsystem evidence, including idempotent replay of pre-fix results.
        for result in data.get("results") or []:
            if not isinstance(result, dict) or result.get("kind") != "sanity_check":
                continue
            for event in result.get("events") or []:
                if isinstance(event, dict) and event.get("kind") == "sanity_check":
                    event["san_trigger_id"] = trigger_id
    ctx.ledger_record(args.get("decision_id"), "sanity.execute", data)
    return data, warnings, hints

def register_operations(registry) -> None:
    global TOOLS
    TOOLS = registry.legacy_tools
    # `rules.context` for this family carries the canonical block this
    # handler builds. Registering is what makes that happen; reaching for
    # it through globals() silently did nothing (see the kernel registry).
    register_context_enricher("sanity", _tool_sanity_context)
    registry.tool(
    "rules.sanity_check",
    "SAN check through the canonical SanitySession: success/failure loss expressions (e.g. '0' / '1D6'), with the chained 7e insanity pipeline (5+ loss INT check, bout of madness, daily 1/5 indefinite threshold, SAN 0 permanent) applied as authoritative state, not advisory.",
    {
        "investigator": {"type": "string", "desc": "investigator id"},
        "source": {"type": "string", "required": True, "desc": "what horror caused the check"},
        "loss_success": {"type": "string", "desc": "loss on success (default '0'; int or dice)"},
        "loss_failure": {"type": "string", "required": True, "desc": "loss on failure (int or dice, e.g. '1D6')"},
        "trigger_id": {
            "type": "string",
            "desc": "authored scene SAN trigger id; marks that trigger fired after settlement",
        },
        "involuntary_action": {
            "type": "object",
            "required": True,
            "desc": "Keeper-chosen contingency for a failed SAN roll; persisted only when the check fails",
            "properties": {
                "kind": {
                    "type": "string",
                    "enum": [
                        "jump_in_fright",
                        "cry_out",
                        "involuntary_movement",
                        "involuntary_combat_action",
                        "freeze",
                    ],
                },
                "summary": {
                    "type": "string",
                    "desc": "non-empty player-visible realization in the campaign play language",
                },
            },
            "required_fields": ["kind", "summary"],
        },
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)(_tool_rules_sanity_check)
    registry.tool(
    "sanity.context",
    "Read the full persisted SanitySession snapshot and unresolved subsystem choices.",
    {"investigator": {"type": "string", "desc": "investigator id"}},
)(_tool_sanity_context)
    registry.tool(
    "sanity.execute",
    "Execute one exact sanity check, bout, reality check, SAN gain, insanity insight, or due recovery/treatment command through the existing full SanitySession/time subsystem.",
    {
        "investigator": {"type": "string", "desc": "investigator id"},
        "command": {"type": "object", "required": True, "desc": "exact sanity_check, bout_tick, bout_end, reality_check, gain_current_san, insane_insight, apply_psychoanalysis_treatment, or recover_temporary_insanity command"},
        "decision_id": {"type": "string", "desc": "idempotency key; must match command.payload.decision_id"},
    },
)(_tool_sanity_execute)


OPERATION_EXPORTS = (
    '_bout_active_hint',
    '_tool_rules_sanity_check',
    '_tool_sanity_context',
    '_tool_sanity_execute',
)
