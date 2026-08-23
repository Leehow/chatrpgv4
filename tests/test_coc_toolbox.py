"""Focused toolbox contracts for exceptional-effect source identity."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from test_toolbox import _read_jsonl, _run, _write_json, campaign_ws


def _wound_investigator(ws: dict) -> Path:
    investigator_id = ws["investigator_id"]
    state_path = (
        ws["campaign_dir"]
        / "save"
        / "investigator-state"
        / f"{investigator_id}.json"
    )
    state = json.loads(state_path.read_text(encoding="utf-8"))
    state.update({
        "current_hp": 0,
        "conditions": ["major_wound", "unconscious", "dying"],
    })
    _write_json(state_path, state)
    return state_path


def _fail_pushed_first_aid(ws: dict) -> dict:
    """Settle one failed First Aid and its failed push; return both envelopes."""
    investigator_id = ws["investigator_id"]
    _wound_investigator(ws)
    origin = _run(
        ws,
        "rules.first_aid",
        {
            "investigator": investigator_id,
            "skill_value": 1,
            "rescuer_id": investigator_id,
            "decision_id": "t20-first-aid-origin-001",
            "seed": 1,
        },
    )
    assert origin["ok"] is True, origin
    assert origin["data"]["event"]["outcome"] == "failure"
    pushed = _run(
        ws,
        "rules.first_aid",
        {
            "investigator": investigator_id,
            "skill_value": 1,
            "rescuer_id": investigator_id,
            "pushed": True,
            "changed_method": "switch to a pressure dressing",
            "failure_consequence": "the wound keeps bleeding",
            "decision_id": "t20-first-aid-push-001",
            "seed": 1,
        },
    )
    assert pushed["ok"] is True, pushed
    assert pushed["data"]["event"]["outcome"] == "failure"
    assert pushed["data"]["event"]["pushed"] is True
    return {"origin": origin, "pushed": pushed}


def _first_aid_roll_id(ws: dict, decision_id: str) -> str:
    expected = f"{decision_id}-first-aid:roll"
    rows = [
        row
        for row in _read_jsonl(ws["campaign_dir"] / "logs" / "rolls.jsonl")
        if row.get("roll_id") == expected
    ]
    assert len(rows) == 1, expected
    return expected


def _scene_id(ws: dict) -> str:
    world = json.loads(
        (ws["campaign_dir"] / "save" / "world-state.json").read_text(encoding="utf-8")
    )
    return str(world["active_scene_id"])


def _apply_first_aid_cost(
    ws: dict,
    *,
    source_roll_id: str,
    decision_id: str,
    restriction_id: str = "cannot-steady-wound",
) -> dict:
    return _run(
        ws,
        "state.exceptional_effect",
        {
            "action": "apply",
            "source_roll_id": source_roll_id,
            "direction": "cost",
            "effect_kind": "restriction",
            "player_visible_impact": "勒压仍压不住渗血，气更乱，眼前更花",
            "causal_link": "改用加压包扎的二次急救仍失败，伤口与昏沉没有好转",
            "boundary": {
                "kind": "until_condition",
                "description": "得到有效包扎或休息到能稳住呼吸之前",
            },
            "mechanics": {
                "subject_id": ws["investigator_id"],
                "restriction_id": restriction_id,
                "scope": "self",
                "scene_id": _scene_id(ws),
            },
            "visibility": "player_visible",
            "decision_id": decision_id,
        },
    )


def test_first_aid_pushed_roll_binds_exceptional_effect(campaign_ws):
    # Regression: rules.first_aid writes {decision_id}-first-aid:roll into
    # logs/rolls.jsonl.  That exact receipt must own a pushed-failure cost.
    settled = _fail_pushed_first_aid(campaign_ws)
    event_roll_ids = [
        event.get("roll_id")
        for event in settled["pushed"]["data"]["events"]
        if isinstance(event, dict) and event.get("roll_id")
    ]
    roll_id = _first_aid_roll_id(campaign_ws, "t20-first-aid-push-001")
    assert roll_id == "t20-first-aid-push-001-first-aid:roll"
    assert roll_id in event_roll_ids

    applied = _apply_first_aid_cost(
        campaign_ws,
        source_roll_id=roll_id,
        decision_id="t20-push-fail-cost-001",
    )
    assert applied["ok"] is True, applied
    source = applied["data"]["effect"]["source_roll"]
    assert source["tool"] == "rules.first_aid"
    assert source["decision_id"] == "t20-first-aid-push-001"
    assert source["roll_id"] == roll_id
    assert source["outcome"] == "failure"
    assert source["pushed"] is True


def test_first_aid_exceptional_source_accepts_only_authoritative_receipt(
    campaign_ws,
):
    _fail_pushed_first_aid(campaign_ws)
    roll_id = _first_aid_roll_id(campaign_ws, "t20-first-aid-push-001")

    accepted = _apply_first_aid_cost(
        campaign_ws,
        source_roll_id=roll_id,
        decision_id="aid-exact-receipt",
    )
    assert accepted["ok"] is True, accepted

    # Equivalent authoritative stores name the same id.  Do not accept
    # stripped command ids, decision ids, or obligation prefixes.
    for alias, decision_id in (
        ("t20-first-aid-push-001-first-aid", "aid-stripped-command"),
        ("t20-first-aid-push-001", "aid-decision-only"),
        (f"roll:{roll_id}", "aid-obligation-prefix"),
    ):
        rejected = _apply_first_aid_cost(
            campaign_ws,
            source_roll_id=alias,
            decision_id=decision_id,
        )
        assert rejected["ok"] is False, alias
        assert rejected["error"]["code"] == "unknown_source_roll"


def test_first_aid_exceptional_source_rejects_unknown_forged_npc_and_mismatch(
    campaign_ws,
):
    settled = _fail_pushed_first_aid(campaign_ws)
    origin_roll_id = _first_aid_roll_id(campaign_ws, "t20-first-aid-origin-001")
    other = _run(
        campaign_ws,
        "rules.roll",
        {
            "investigator": campaign_ws["investigator_id"],
            "skill": "Library Use",
            "decision_id": "library-mismatch",
            "seed": 7,
        },
    )
    assert other["ok"] is True, other

    cases = (
        ("forged-first-aid:roll", "unknown_source_roll"),
        ("npc-walter-corbitt", "unknown_source_roll"),
        (origin_roll_id, "invalid_source_roll"),
        (other["data"]["roll_id"], "invalid_source_roll"),
    )
    for source_roll_id, code in cases:
        rejected = _apply_first_aid_cost(
            campaign_ws,
            source_roll_id=source_roll_id,
            decision_id=f"reject-{source_roll_id}",
        )
        assert rejected["ok"] is False, source_roll_id
        assert rejected["error"]["code"] == code, (source_roll_id, rejected)
    assert settled["origin"]["data"]["event"]["pushed"] is not True


def test_first_aid_exceptional_effect_same_decision_id_is_idempotent(campaign_ws):
    _fail_pushed_first_aid(campaign_ws)
    roll_id = _first_aid_roll_id(campaign_ws, "t20-first-aid-push-001")
    args_decision = "t20-push-fail-cost-replay"
    first = _apply_first_aid_cost(
        campaign_ws, source_roll_id=roll_id, decision_id=args_decision
    )
    replay = _apply_first_aid_cost(
        campaign_ws, source_roll_id=roll_id, decision_id=args_decision
    )
    assert first["ok"] is True, first
    assert replay["ok"] is True, replay
    assert replay["data"] == first["data"]
    assert any("duplicate decision_id" in warning for warning in replay["warnings"])
    effects = [
        row
        for row in _read_jsonl(campaign_ws["campaign_dir"] / "logs" / "events.jsonl")
        if row.get("event_type") == "exceptional_effect_apply"
        and row.get("decision_id") == args_decision
    ]
    assert len(effects) == 1
