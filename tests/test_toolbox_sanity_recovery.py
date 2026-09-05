"""Behavior tests owned by the sanity-recovery operation cell."""
from toolbox_test_support import *

def test_full_sanity_session_is_reachable_through_shared_executor(campaign_ws):
    decision_id = "full-san-check-1"
    command = {
        "command_id": decision_id,
        "kind": "sanity_check",
        "phase": "resolve",
        "payload": {
            "decision_id": decision_id,
            "roll_id": decision_id,
            "skill": "SAN",
            "difficulty": "regular",
            "san_loss_success": 0,
            "san_loss_fail_expr": "1",
            "source": "A structured unnatural encounter",
        },
    }
    resolved = _run(campaign_ws, "sanity.execute", {
        "decision_id": decision_id,
        "command": command,
        "seed": 9,
    })
    assert resolved["ok"] is True
    assert resolved["data"]["authority"] == "deterministic_subsystem"
    context = _run(campaign_ws, "sanity.context")
    assert context["ok"] is True
    assert context["data"]["active"] is True

def test_sanity_fumble_records_the_structured_authored_loss_consequence(campaign_ws):
    settled = _run(
        campaign_ws,
        "rules.sanity_check",
        {
            "investigator": campaign_ws["investigator_id"],
            "source": "structured horror",
            "loss_success": "0",
            "loss_failure": "1D4",
            "involuntary_action": {
                "kind": "freeze",
                "summary": "调查员因突如其来的恐怖僵住片刻。",
            },
            "decision_id": "san-fumble-evidence",
            "seed": 23,
        },
    )
    assert settled["ok"] is True
    assert settled["data"]["check"]["outcome"] == "fumble"
    check_roll_id = settled["data"]["check_roll_id"]
    roll = next(
        row
        for row in _read_jsonl(
            campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl"
        )
        if row.get("roll_id") == check_roll_id
    )
    consequence = roll["payload"]["fumble_consequence"]
    assert consequence["effect"]["kind"] == "san_loss"
    assert consequence["effect"]["amount"] == settled["data"]["san_loss"]


def _sanity_command(kind, phase, decision_id, **payload):
    return {
        "command_id": f"{decision_id}:command",
        "kind": kind,
        "phase": phase,
        "payload": {"decision_id": decision_id, **payload},
    }


def test_sanity_execute_reality_check_is_durable_and_replays(campaign_ws):
    module = coc_toolbox.OPERATION_MODULES["sanity-recovery"]
    kernel = coc_toolbox.coc_operation_kernel
    ctx = kernel.Ctx(campaign_ws["workspace"], campaign_ws["campaign_id"])
    session = module._load_live_sanity_session(
        ctx, campaign_ws["investigator_id"], {"seed": 2},
    )
    session.temporary_insane = True
    session.bout_active = False
    session.plant_delusion("墙纸正在呼吸")
    session.save(ctx.campaign_dir, strict_mirror=True)
    args = {
        "investigator": campaign_ws["investigator_id"],
        "decision_id": "sanity-reality-1",
        "seed": 2,
        "command": _sanity_command(
            "reality_check", "resolve", "sanity-reality-1",
            request_reality_check=True,
        ),
    }
    first = _run(campaign_ws, "sanity.execute", args)
    assert first["ok"] is True, first
    assert first["data"]["command_kind"] == "reality_check"
    assert first["data"]["events"][0]["roll_id"]
    roll_count = len(_read_jsonl(campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl"))
    replay = _run(campaign_ws, "sanity.execute", args)
    assert replay["ok"] is True, replay
    assert replay["data"] == first["data"]
    assert len(_read_jsonl(campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl")) == roll_count


def test_sanity_execute_gain_and_insight_validate_live_state(campaign_ws):
    gained = _run(campaign_ws, "sanity.execute", {
        "decision_id": "sanity-gain-1",
        "command": _sanity_command(
            "gain_current_san", "resolve", "sanity-gain-1",
            san_gain=2, gain_source="source-backed conclusion",
        ),
    })
    assert gained["ok"] is True, gained
    assert gained["data"]["result"]["san_gain"] in {0, 1, 2}

    unavailable = _run(campaign_ws, "sanity.execute", {
        "decision_id": "sanity-insight-not-insane",
        "command": _sanity_command(
            "insane_insight", "advise", "sanity-insight-not-insane",
            insight="恐怖逻辑把两条线索联系起来",
        ),
    })
    assert unavailable["ok"] is False
    assert unavailable["error"]["code"] == "insane_insight_unavailable"


def test_sanity_execute_due_recovery_uses_exact_time_trigger(campaign_ws):
    module = coc_toolbox.OPERATION_MODULES["sanity-recovery"]
    kernel = coc_toolbox.coc_operation_kernel
    ctx = kernel.Ctx(campaign_ws["workspace"], campaign_ws["campaign_id"])
    session = module._load_live_sanity_session(
        ctx, campaign_ws["investigator_id"], {"seed": 1},
    )
    session.temporary_insane = True
    session.save(ctx.campaign_dir, strict_mirror=True)
    kernel.coc_time.initialize_time_state(ctx.campaign_dir)
    trigger_id = kernel.coc_time.schedule_trigger(ctx.campaign_dir, {
        "kind": "temporary_insanity_recovery",
        "scope": "investigator",
        "target_id": campaign_ws["investigator_id"],
        "due_elapsed_minutes": 0,
        "policy": "auto_apply_if_safe",
        "handler": "recover_temporary_insanity",
        "payload": {},
    })
    kernel.coc_time.mark_safe_rest(ctx.campaign_dir, campaign_ws["investigator_id"])
    settled = _run(campaign_ws, "sanity.execute", {
        "decision_id": "sanity-recover-1",
        "command": _sanity_command(
            "recover_temporary_insanity", "due-trigger", "sanity-recover-1",
            recovery_trigger_ref=trigger_id,
        ),
    })
    assert settled["ok"] is True, settled
    assert settled["data"]["result"]["dispatch_outcome"]["recovered"] is True

    stale = _run(campaign_ws, "sanity.execute", {
        "decision_id": "sanity-recover-stale",
        "command": _sanity_command(
            "recover_temporary_insanity", "due-trigger", "sanity-recover-stale",
            recovery_trigger_ref=trigger_id,
        ),
    })
    assert stale["ok"] is False
    assert stale["error"]["code"] == "sanity_trigger_stale"


def test_sanity_execute_due_treatment_reuses_existing_handler(campaign_ws):
    kernel = coc_toolbox.coc_operation_kernel
    ctx = kernel.Ctx(campaign_ws["workspace"], campaign_ws["campaign_id"])
    kernel.coc_time.initialize_time_state(ctx.campaign_dir)
    trigger_id = kernel.coc_time.schedule_trigger(ctx.campaign_dir, {
        "kind": "treatment",
        "scope": "investigator",
        "target_id": campaign_ws["investigator_id"],
        "due_elapsed_minutes": 0,
        "policy": "auto_apply_if_safe",
        "handler": "apply_psychoanalysis_treatment",
        "payload": {"condition": "indefinite_insane"},
    })
    kernel.coc_time.mark_safe_rest(ctx.campaign_dir, campaign_ws["investigator_id"])
    settled = _run(campaign_ws, "sanity.execute", {
        "decision_id": "sanity-treatment-1",
        "command": _sanity_command(
            "apply_psychoanalysis_treatment", "due-trigger", "sanity-treatment-1",
            treatment_trigger_ref=trigger_id,
        ),
    })
    assert settled["ok"] is True, settled
    assert "san_after" in settled["data"]["result"]["dispatch_outcome"]


def test_sanity_deferred_trigger_names_safe_rest_and_recovers_after_it(campaign_ws):
    module = coc_toolbox.OPERATION_MODULES["sanity-recovery"]
    kernel = coc_toolbox.coc_operation_kernel
    ctx = kernel.Ctx(campaign_ws["workspace"], campaign_ws["campaign_id"])
    session = module._load_live_sanity_session(
        ctx, campaign_ws["investigator_id"], {"seed": 4},
    )
    session.temporary_insane = True
    session.save(ctx.campaign_dir, strict_mirror=True)
    kernel.coc_time.initialize_time_state(ctx.campaign_dir)
    trigger_id = kernel.coc_time.schedule_trigger(ctx.campaign_dir, {
        "kind": "temporary_insanity_recovery",
        "scope": "investigator",
        "target_id": campaign_ws["investigator_id"],
        "due_elapsed_minutes": 0,
        "policy": "auto_apply_if_safe",
        "handler": "recover_temporary_insanity",
        "payload": {},
    })

    # The context surface states the safe_place gap before any settlement.
    context = _run(campaign_ws, "sanity.context")
    assert context["ok"] is True
    assert context["data"]["safe_place"] is False
    assert context["data"]["safe_rest_required"]["decision_refs"] == [
        "decision:coc7:sanity:recover-temporary"
    ]
    assert (
        context["data"]["safe_rest_required"]["operation"]
        == "state.mark_safe_rest"
    )

    deferred = _run(campaign_ws, "sanity.execute", {
        "decision_id": "sanity-recover-deferred",
        "command": _sanity_command(
            "recover_temporary_insanity", "due-trigger", "sanity-recover-deferred",
            recovery_trigger_ref=trigger_id,
        ),
    })
    assert deferred["ok"] is False
    assert deferred["error"]["code"] == "sanity_trigger_deferred"
    assert "state.mark_safe_rest" in deferred["error"]["message"]

    kernel.coc_time.mark_safe_rest(
        ctx.campaign_dir, campaign_ws["investigator_id"],
    )
    settled = _run(campaign_ws, "sanity.execute", {
        "decision_id": "sanity-recover-after-rest",
        "command": _sanity_command(
            "recover_temporary_insanity", "due-trigger", "sanity-recover-after-rest",
            recovery_trigger_ref=trigger_id,
        ),
    })
    assert settled["ok"] is True, settled
    assert settled["data"]["result"]["dispatch_outcome"]["recovered"] is True

    context_after = _run(campaign_ws, "sanity.context")
    assert context_after["ok"] is True
    assert context_after["data"]["safe_place"] is True
    assert "safe_rest_required" not in context_after["data"]


def test_sanity_execute_extended_kind_rejects_wrong_phase(campaign_ws):
    result = _run(campaign_ws, "sanity.execute", {
        "decision_id": "sanity-phase-forged",
        "command": _sanity_command(
            "gain_current_san", "due-trigger", "sanity-phase-forged",
            san_gain=1, gain_source="forged",
        ),
    })
    assert result["ok"] is False
    assert result["error"]["code"] == "invalid_param"


def _gain_pending_path(ws):
    return (
        ws["campaign_dir"] / "save" / "sanity-gain-pending"
        / f"{ws['investigator_id']}.json"
    )


def _live_sanity_facts(ws):
    kernel = coc_toolbox.coc_operation_kernel
    ctx = kernel.Ctx(ws["workspace"], ws["campaign_id"])
    return dict(kernel._facts_provider_for(
        ctx, ws["investigator_id"], "coc7",
    )())


def _write_gain_pending(ws, *, san_gain=2, gain_source="psychoanalysis"):
    path = _gain_pending_path(ws)
    _write_json(path, {
        "schema_version": 1,
        "investigator_id": ws["investigator_id"],
        "san_gain": san_gain,
        "gain_source": gain_source,
    })
    return path


def _room_for_san_gain(ws, room=5):
    module = coc_toolbox.OPERATION_MODULES["sanity-recovery"]
    kernel = coc_toolbox.coc_operation_kernel
    ctx = kernel.Ctx(ws["workspace"], ws["campaign_id"])
    session = module._load_live_sanity_session(
        ctx, ws["investigator_id"], {"seed": 1},
    )
    session.san_current = max(0, int(session.san_max) - room)
    session.save(ctx.campaign_dir, strict_mirror=True)
    return int(session.san_current), int(session.san_max)


def test_sanity_gain_pending_false_without_receipt_and_settle_refuses(campaign_ws):
    facts = _live_sanity_facts(campaign_ws)
    assert facts["sanity.gain.pending"] is False
    assert not _gain_pending_path(campaign_ws).exists()

    settled = _run(campaign_ws, "rules.settle", {
        "decision_ref": "decision:coc7:sanity:gain-current-san",
        "decision_id": "sanity-gain-no-receipt",
        "investigator": campaign_ws["investigator_id"],
        "semantic_inputs": {"gain_source": "psychoanalysis"},
    })
    assert settled["ok"] is False, settled
    error = settled.get("error") or {}
    assert error.get("code") in {
        "rule_decision_stale", "sanity_gain_receipt_unavailable",
    }, settled


def test_sanity_gain_pending_receipt_settles_and_is_consumed(campaign_ws):
    before, san_max = _room_for_san_gain(campaign_ws, room=5)
    path = _write_gain_pending(
        campaign_ws, san_gain=2, gain_source="psychoanalysis",
    )
    assert _live_sanity_facts(campaign_ws)["sanity.gain.pending"] is True

    held = _run(campaign_ws, "rules.context", {
        "family": "sanity",
        "investigator": campaign_ws["investigator_id"],
        "semantic_inputs": {"gain_source": "psychoanalysis"},
    })
    assert held["ok"] is True, held
    cards = {
        row["decision_ref"]: row
        for row in (held["data"].get("cards") or [])
    }
    gain_card = cards.get("decision:coc7:sanity:gain-current-san") or {}
    assert gain_card.get("applicability") == "applicable", gain_card

    settled = _run(campaign_ws, "rules.settle", {
        "decision_ref": "decision:coc7:sanity:gain-current-san",
        "decision_id": "sanity-gain-with-receipt",
        "investigator": campaign_ws["investigator_id"],
        "semantic_inputs": {"gain_source": "psychoanalysis"},
    })
    assert settled["ok"] is True, settled
    assert not path.exists()
    assert _live_sanity_facts(campaign_ws)["sanity.gain.pending"] is False

    snapshot = json.loads(
        (
            campaign_ws["campaign_dir"] / "save" / "sanity-state"
            / f"{campaign_ws['investigator_id']}.json"
        ).read_text(encoding="utf-8")
    )
    assert snapshot["san_current"] == min(san_max, before + 2)


def test_plant_delusion_command_unlocks_reality_check(campaign_ws):
    module = coc_toolbox.OPERATION_MODULES["sanity-recovery"]
    kernel = coc_toolbox.coc_operation_kernel
    ctx = kernel.Ctx(campaign_ws["workspace"], campaign_ws["campaign_id"])
    session = module._load_live_sanity_session(
        ctx, campaign_ws["investigator_id"], {"seed": 3},
    )
    session.temporary_insane = True
    session.bout_active = False
    session.active_delusion = None
    session.save(ctx.campaign_dir, strict_mirror=True)

    assert _live_sanity_facts(campaign_ws)["sanity.delusion.active"] is False
    context = _run(campaign_ws, "sanity.context")
    assert context["ok"] is True, context
    plantable = context["data"].get("delusion_plantable") or {}
    assert plantable.get("command_kind") == "plant_delusion"
    assert plantable.get("operation") == "sanity.execute"

    planted = _run(campaign_ws, "sanity.execute", {
        "decision_id": "sanity-plant-1",
        "command": _sanity_command(
            "plant_delusion", "resolve", "sanity-plant-1",
            description="墙纸正在呼吸",
            backstory_field="meaningful_locations",
        ),
    })
    assert planted["ok"] is True, planted
    assert planted["data"]["result"]["delusion"]["description"] == "墙纸正在呼吸"
    assert _live_sanity_facts(campaign_ws)["sanity.delusion.active"] is True

    context_after = _run(campaign_ws, "sanity.context")
    assert context_after["ok"] is True, context_after
    assert "delusion_plantable" not in context_after["data"]

    checked = _run(campaign_ws, "sanity.execute", {
        "decision_id": "sanity-reality-after-plant",
        "seed": 2,
        "command": _sanity_command(
            "reality_check", "resolve", "sanity-reality-after-plant",
            request_reality_check=True,
        ),
    })
    assert checked["ok"] is True, checked
    assert checked["data"]["command_kind"] == "reality_check"
    assert (checked.get("error") or {}).get("code") != "reality_check_unavailable"
