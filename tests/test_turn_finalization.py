"""First-aid pushed-failure obligations can close through turn.finalize."""
from __future__ import annotations

import json

import pytest

from test_coc_toolbox import (
    _apply_first_aid_cost,
    _fail_pushed_first_aid,
    _first_aid_roll_id,
)
from test_toolbox import _finalize_pending_turn_for_test, _run, campaign_ws


@pytest.mark.parametrize(
    "profile",
    [
        pytest.param(None, id="production-profile-absent"),
        pytest.param("unknown-profile", id="production-profile-unknown"),
        pytest.param("rules-director-single-draft", id="legacy-profile-alias"),
        pytest.param("rules-all-single-draft", id="legacy-all-profile-alias"),
    ],
)
def test_pi_play_is_direct_single_draft_and_finalizes_once_without_review(
    campaign_ws,
    monkeypatch,
    profile,
):
    monkeypatch.setenv("COC_PI_SESSION_ROLE", "play")
    if profile is None:
        monkeypatch.delenv("COC_PI_ACCEPTANCE_PROFILE", raising=False)
    else:
        monkeypatch.setenv("COC_PI_ACCEPTANCE_PROFILE", profile)

    journal = _run(
        campaign_ws,
        "state.journal",
        {
            "summary": "调查员检查完书桌，将本轮发现记入案卷。",
            "player_text": "我检查书桌，把找到的东西收好。",
            "decision_id": "single-draft-profile-journal",
        },
    )
    assert journal["ok"] is True, journal

    output = _run(campaign_ws, "turn.output_context")
    assert output["ok"] is True, output
    data = output["data"]
    assert data["contract_projection"]["agency_review_required"] is False

    serialized = json.dumps(data, ensure_ascii=False, sort_keys=True)
    assert "agency_review_operation" not in data
    assert "host_state_claim_compiler_required" not in serialized
    assert "state_claim_compilation" not in serialized
    finalize = data["finalize_operation"]
    assert finalize["operation"] == "turn.finalize"
    assert finalize["invoke_via"] == "coc_turn_finalize"
    assert finalize["missing_arguments"] == ["draft"]
    assert finalize["prefilled_arguments"]["revision"] == 1
    assert finalize["prefilled_arguments"]["coverage"] == []

    draft = "书桌抽屉在轻响中滑开，里面的纸页沾着陈年的灰。"
    finalized = _run(
        campaign_ws,
        "turn.finalize",
        {
            **finalize["prefilled_arguments"],
            "draft": draft,
        },
    )
    assert finalized["ok"] is True, finalized
    assert finalized["data"]["accepted_revision"] == 1
    assert finalized["data"]["rendered_text"] == draft
    assert finalized["data"]["narration_review"] is None
    assert not (
        campaign_ws["campaign_dir"] / "logs" / "narration-reviews.jsonl"
    ).exists()


def test_first_aid_pushed_failure_can_finalize_after_authoritative_effect(
    campaign_ws,
):
    settled = _fail_pushed_first_aid(campaign_ws)
    roll_id = _first_aid_roll_id(campaign_ws, "t20-first-aid-push-001")
    assert settled["pushed"]["data"]["event"]["outcome"] == "failure"

    campaign_dir = campaign_ws["campaign_dir"]

    def durable_state() -> dict[str, bytes]:
        return {
            str(path.relative_to(campaign_dir)): path.read_bytes()
            for path in campaign_dir.rglob("*")
            if path.is_file()
            and path.relative_to(campaign_dir).as_posix() not in {
                "logs/toolbox-calls.jsonl",
                "logs/.recorder.lock",
            }
        }

    before = durable_state()
    blocked = _run(
        campaign_ws,
        "state.journal",
        {
            "summary": "二次急救仍失败，伤口没有稳住。",
            "player_action": "改用加压包扎再试一次急救",
            "player_text": "我改用衣襟勒紧伤口再试一次。",
            "intent_class": "assist",
            "decision_id": "t20-journal-001",
        },
    )
    assert blocked["ok"] is False, blocked
    assert blocked["error"]["code"] == "substantive_exceptional_effect_required"
    assert blocked["error"]["details"] == {
        "journal_committed": False,
        "missing_substantive_effects": [{
            "obligation_id": f"roll:{roll_id}",
            "source_roll_id": roll_id,
            "required_direction": "cost",
        }],
        "pending_modifier_consumptions": [],
        # The gate names the operation that clears it. Without this the
        # Keeper only learns which obligation is unmet, not what to call.
        "remedy": {
            "operation": "state.exceptional_effect",
            "action": "apply",
            "source_roll_id": [f"roll:{roll_id}"],
            "also_required": ["decision_id", "effect_kind"],
        },
    }
    assert "state.exceptional_effect" in blocked["error"]["message"]
    assert durable_state() == before
    assert not (
        campaign_ws["campaign_dir"] / "save" / "pending-turn.json"
    ).exists()

    assert blocked["error"]["details"]["missing_substantive_effects"] == [{
        "obligation_id": f"roll:{roll_id}",
        "source_roll_id": roll_id,
        "required_direction": "cost",
    }]

    applied = _apply_first_aid_cost(
        campaign_ws,
        source_roll_id=roll_id,
        decision_id="t20-push-fail-cost-001",
    )
    assert applied["ok"] is True, applied

    journaled = _run(
        campaign_ws,
        "state.journal",
        {
            "summary": "二次急救仍失败，伤口没有稳住。",
            "player_action": "改用加压包扎再试一次急救",
            "player_text": "我改用衣襟勒紧伤口再试一次。",
            "intent_class": "assist",
            "decision_id": "t20-journal-001",
        },
    )
    assert journaled["ok"] is True, journaled

    context = _run(campaign_ws, "turn.output_context")
    assert context["ok"] is True, context
    assert context["data"]["missing_substantive_effects"] == []

    finalized = _finalize_pending_turn_for_test(
        campaign_ws, decision_id="t20-finalize-001"
    )
    assert finalized["ok"] is True, finalized
    manifest_path = (
        campaign_ws["campaign_dir"]
        / "save"
        / "turn-manifests"
        / f"{context['data']['turn_id']}.json"
    )
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert manifest["status"] == "finalized"
    assert manifest["finalization_id"] == finalized["data"]["finalization_id"]


def test_state_journal_blocks_unconsumed_exceptional_modifier_before_writing(
    campaign_ws,
):
    investigator = campaign_ws["investigator_id"]
    critical = _run(campaign_ws, "rules.roll", {
        "investigator": investigator,
        "skill": "Fast Talk",
        "target": 50,
        "difficulty": "regular",
        "goal": "发现对方程序上的弱点",
        "stakes": {"on_success": "发现弱点", "on_failure": "没有发现"},
        "difficulty_basis": "keeper_judgment",
        "seed": 139,
        "decision_id": "prejournal-critical-source",
    })
    assert critical["ok"] is True, critical
    assert critical["data"]["outcome"] == "critical"
    applied = _run(campaign_ws, "state.exceptional_effect", {
        "action": "apply",
        "source_roll_id": critical["data"]["roll_id"],
        "direction": "benefit",
        "effect_kind": "bonus_die",
        "player_visible_impact": "下一次话术检定获得 1 枚奖励骰",
        "causal_link": "调查员抓住了对方最在意的程序措辞",
        "boundary": {"kind": "until_consumed", "uses": 1},
        "mechanics": {
            "dice": 1,
            "investigator_id": investigator,
            "skill": "Fast Talk",
            "scene_id": None,
            "target_id": None,
        },
        "visibility": "player_visible",
        "decision_id": "prejournal-critical-bonus",
    })
    assert applied["ok"] is True, applied
    effect_id = applied["data"]["effect"]["effect_id"]
    matching = _run(campaign_ws, "rules.roll", {
        "investigator": investigator,
        "skill": "Fast Talk",
        "target": 50,
        "difficulty": "regular",
        "goal": "利用程序措辞说服对方",
        "stakes": {"on_success": "措辞奏效", "on_failure": "措辞无效"},
        "difficulty_basis": "keeper_judgment",
        "bonus": 1,
        "seed": 5,
        "decision_id": "prejournal-matching-roll",
    })
    assert matching["ok"] is True, matching

    campaign_dir = campaign_ws["campaign_dir"]

    def durable_state() -> dict[str, bytes]:
        return {
            str(path.relative_to(campaign_dir)): path.read_bytes()
            for path in campaign_dir.rglob("*")
            if path.is_file()
            and path.relative_to(campaign_dir).as_posix() not in {
                "logs/toolbox-calls.jsonl",
                "logs/.recorder.lock",
            }
        }

    journal_args = {
        "summary": "调查员利用刚发现的程序弱点继续交涉。",
        "player_text": "我照着她在意的程序措辞继续说服她。",
        "decision_id": "prejournal-modifier-journal",
    }
    before = durable_state()
    blocked = _run(campaign_ws, "state.journal", journal_args)
    assert blocked["ok"] is False, blocked
    assert blocked["error"]["code"] == "exceptional_modifier_unconsumed"
    assert blocked["error"]["details"] == {
        "journal_committed": False,
        "missing_substantive_effects": [],
        "pending_modifier_consumptions": [{
            "effect_id": effect_id,
            "roll_id": matching["data"]["roll_id"],
            "effect_kind": "bonus_die",
            "required_dice": 1,
            "investigator_id": investigator,
            "skill": "Fast Talk",
        }],
    }
    assert durable_state() == before

    consumed = _run(campaign_ws, "state.exceptional_effect", {
        "action": "consume",
        "effect_id": effect_id,
        "consuming_roll_id": matching["data"]["roll_id"],
        "decision_id": "consume-prejournal-critical-bonus",
    })
    assert consumed["ok"] is True, consumed
    journaled = _run(campaign_ws, "state.journal", journal_args)
    assert journaled["ok"] is True, journaled
    context = _run(campaign_ws, "turn.output_context")
    assert context["ok"] is True, context
    assert context["data"]["missing_substantive_effects"] == []
    assert context["data"]["pending_modifier_consumptions"] == []
