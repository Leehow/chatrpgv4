"""Vertical contract for core.combined_roll through canonical rules.roll."""

import pytest

from toolbox_test_support import (
    _finalize_pending_turn_for_test,
    _read_jsonl,
    _run,
    campaign_ws as _campaign_ws_fixture,
)


@pytest.fixture
def campaign_ws(tmp_path):
    return _campaign_ws_fixture.__wrapped__(tmp_path)


def _combined_args(ws, decision_id: str, **overrides):
    args = {
        "investigator": ws["investigator_id"],
        "combined_targets": [
            {"label": "Mechanical Repair", "value": 20},
            {"label": "Electrical Repair", "value": 90},
        ],
        "combined_mode": "any",
        "difficulty": "regular",
        "goal": "restore the disabled generator with either discipline",
        "stakes": {
            "on_success": "the generator starts",
            "on_failure": "the generator remains silent",
        },
        "difficulty_basis": "keeper_judgment",
        "decision_id": decision_id,
        "seed": 5,
    }
    args.update(overrides)
    return args


def test_combined_roll_does_not_require_ordinary_check_difficulty_basis(
    campaign_ws,
):
    """r85 cmb5: combined-check does not declare difficulty_basis."""
    args = _combined_args(campaign_ws, "combined-no-basis")
    args.pop("difficulty_basis")
    result = _run(campaign_ws, "rules.roll", args)
    assert result["ok"] is True, result
    assert result["data"].get("kind") == "combined_skill_check"


def test_combined_roll_uses_one_die_projects_each_target_and_replays(
    campaign_ws,
):
    development_path = (
        campaign_ws["campaign_dir"].parents[1]
        / "investigators"
        / campaign_ws["investigator_id"]
        / "development.jsonl"
    )
    development_before = development_path.read_bytes()

    first = _run(
        campaign_ws,
        "rules.roll",
        _combined_args(campaign_ws, "combined-one-die"),
    )

    assert first["ok"] is True, first
    data = first["data"]
    assert data["roll"] == 80
    assert data["bonus"] == 0
    assert data["penalty"] == 0
    assert data["kind"] == "combined_skill_check"
    assert data["improvement_tick_eligible"] is False
    assert data["combined_roll"] == {
        "rule_ref": "core.combined_roll",
        "roll_count": 1,
        "comparison_mode": "any",
        "targets": [
            {
                "label": "Mechanical Repair",
                "value": 20,
                "required_target": 20,
                "achieved_level": "failure",
                "outcome": "failure",
                "success": False,
            },
            {
                "label": "Electrical Repair",
                "value": 90,
                "required_target": 90,
                "achieved_level": "regular",
                "outcome": "regular",
                "success": True,
            },
        ],
        "overall_success": True,
        "development_tick_eligible": False,
        "push_eligible": False,
        "luck_spend_eligible": False,
    }
    assert data["success"] is True
    assert data["player_projection"]["combined_roll"] == data["combined_roll"]
    assert development_path.read_bytes() == development_before
    rows = _read_jsonl(campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl")
    assert len(rows) == 1
    assert rows[0]["roll_id"] == data["roll_id"]

    replay = _run(
        campaign_ws,
        "rules.roll",
        _combined_args(campaign_ws, "combined-one-die", seed=999),
    )
    assert replay["ok"] is True, replay
    assert replay["data"] == data
    assert len(_read_jsonl(campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl")) == 1
    assert development_path.read_bytes() == development_before


def test_combined_roll_is_public_finalization_evidence(campaign_ws):
    rolled = _run(
        campaign_ws,
        "rules.roll",
        _combined_args(campaign_ws, "combined-finalize"),
    )
    assert rolled["ok"] is True, rolled
    journaled = _run(
        campaign_ws,
        "state.journal",
        {
            "summary": "The generator repair was settled by one combined roll.",
            "player_text": "I try both repair disciplines while the others help.",
            "decision_id": "combined-finalize-journal",
        },
    )
    assert journaled["ok"] is True, journaled
    context = _run(campaign_ws, "turn.output_context")
    assert context["ok"] is True, context
    public = context["data"]["mechanics_bundle"]["public_check"]
    assert len(public) == 1
    assert public[0]["roll_id"] == rolled["data"]["roll_id"]
    assert public[0]["combined_roll"] == rolled["data"]["combined_roll"]

    finalized = _finalize_pending_turn_for_test(
        campaign_ws,
        decision_id="combined-finalize-receipt",
        result_paragraph="The generator catches and its lights come on.",
    )
    assert finalized["data"]["rendered_text"]


def test_combined_roll_all_mode_requires_every_named_skill(campaign_ws):
    # Keeper Rulebook PDF index 103-104 / printed p.92: the Keeper declares
    # whether all named skills or only one named skill must succeed.
    settled = _run(
        campaign_ws,
        "rules.roll",
        _combined_args(
            campaign_ws,
            "combined-all-mode",
            combined_mode="all",
        ),
    )
    assert settled["ok"] is True, settled
    combined = settled["data"]["combined_roll"]
    assert combined["comparison_mode"] == "all"
    assert [row["success"] for row in combined["targets"]] == [False, True]
    assert combined["overall_success"] is False
    assert settled["data"]["success"] is False


def test_combined_roll_rejects_push_and_luck_without_new_dice(campaign_ws):
    failed = _run(
        campaign_ws,
        "rules.roll",
        _combined_args(
            campaign_ws,
            "combined-no-followups",
            combined_targets=[
                {"label": "Mechanical Repair", "value": 10},
                {"label": "Electrical Repair", "value": 20},
            ],
        ),
    )
    assert failed["ok"] is True, failed
    assert failed["data"]["success"] is False
    rolls_before = _read_jsonl(campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl")

    pushed = _run(
        campaign_ws,
        "rules.push",
        {
            "original_check_decision_id": "combined-no-followups",
            "method_changed": "rewire the circuit from the other side",
            "failure_consequence": "the damaged line burns out",
            "decision_id": "combined-push-forbidden",
        },
    )
    assert pushed["ok"] is False
    assert pushed["error"]["code"] == "invalid_push"

    luck = _run(
        campaign_ws,
        "rules.luck_spend",
        {
            "investigator": campaign_ws["investigator_id"],
            "source_roll_id": failed["data"]["roll_id"],
            "points": 1,
            "decision_id": "combined-luck-forbidden",
        },
    )
    assert luck["ok"] is False
    assert luck["error"]["code"] == "invalid_param"
    assert _read_jsonl(campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl") == rolls_before


@pytest.mark.parametrize(
    "override",
    [
        {"combined_targets": [{"label": "Listen", "value": 50}]},
        {"combined_targets": [
            {"label": "Listen", "value": 50},
            {"label": " listen ", "value": 40},
        ]},
        {"combined_targets": [
            {"label": "Listen", "value": 50, "extra": True},
            {"label": "Spot Hidden", "value": 40},
        ]},
        {"combined_targets": [
            {"label": "Listen", "value": True},
            {"label": "Spot Hidden", "value": 40},
        ]},
        {"combined_targets": [
            {"label": "Psychology", "value": 50},
            {"label": "Listen", "value": 40},
        ]},
        {"combined_targets": [
            {"label": "Firearms (Handgun)", "value": 50},
            {"label": "Listen", "value": 40},
        ]},
        {"skill": "Listen"},
        {"bonus": 1},
        {"visibility": "keeper_only"},
        {"helper_count": 0},
        {"combined_mode": "neither"},
        {"combined_mode": None},
    ],
)
def test_combined_roll_rejects_invalid_or_misrouted_inputs(campaign_ws, override):
    rejected = _run(
        campaign_ws,
        "rules.roll",
        _combined_args(campaign_ws, "combined-invalid", **override),
    )
    assert rejected["ok"] is False, rejected
    assert rejected["error"]["code"] == "invalid_param"
    assert _read_jsonl(campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl") == []


def test_ordinary_rules_roll_remains_unchanged(campaign_ws):
    ordinary = _run(
        campaign_ws,
        "rules.roll",
        {
            "investigator": campaign_ws["investigator_id"],
            "skill": "Library Use",
            "difficulty": "regular",
            "goal": "find the indexed deed",
            "stakes": {
                "on_success": "the deed is found",
                "on_failure": "the deed remains buried",
            },
            "difficulty_basis": "keeper_judgment",
            "decision_id": "ordinary-after-combined",
            "seed": 1,
        },
    )
    assert ordinary["ok"] is True, ordinary
    assert ordinary["data"].get("kind") != "combined_skill_check"
    assert "combined_roll" not in ordinary["data"]
    assert "combined_targets" not in ordinary["data"]

    stray_helper = _run(
        campaign_ws,
        "rules.roll",
        {
            "investigator": campaign_ws["investigator_id"],
            "skill": "Library Use",
            "helper_count": 1,
            "combined_mode": "any",
            "difficulty": "regular",
            "goal": "find another deed",
            "stakes": {
                "on_success": "the deed is found",
                "on_failure": "the deed remains buried",
            },
            "difficulty_basis": "keeper_judgment",
            "decision_id": "ordinary-stray-helper",
        },
    )
    assert stray_helper["ok"] is False
    assert stray_helper["error"]["code"] == "invalid_param"
