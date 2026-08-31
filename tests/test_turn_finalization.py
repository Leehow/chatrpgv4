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
    ("profile", "review_required"),
    [
        pytest.param(None, True, id="profile-absent"),
        pytest.param("unknown-profile", True, id="profile-unknown"),
        pytest.param(
            "rules-director-single-draft",
            False,
            id="rules-director-single-draft",
        ),
    ],
)
def test_pi_play_single_draft_profile_is_exact_opt_in_and_finalizes_once(
    campaign_ws,
    monkeypatch,
    profile,
    review_required,
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
    assert data["contract_projection"]["agency_review_required"] is review_required

    if review_required:
        assert data["agency_review_operation"]["operation"] == "narration.review"
        assert data["agency_review_operation"][
            "host_state_claim_compiler_required"
        ] is True
        return

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
    assert context["data"]["missing_substantive_effects"] == [{
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

    repaired = _run(campaign_ws, "turn.output_context")
    assert repaired["ok"] is True, repaired
    assert repaired["data"]["missing_substantive_effects"] == []

    finalized = _finalize_pending_turn_for_test(
        campaign_ws, decision_id="t20-finalize-001"
    )
    assert finalized["ok"] is True, finalized
    manifest_path = (
        campaign_ws["campaign_dir"]
        / "save"
        / "turn-manifests"
        / f"{repaired['data']['turn_id']}.json"
    )
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert manifest["status"] == "finalized"
    assert manifest["finalization_id"] == finalized["data"]["finalization_id"]
