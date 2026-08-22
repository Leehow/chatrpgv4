"""Narration budget + control-override ownership surface (phase 4)."""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "plugins" / "coc-keeper" / "scripts"
PYTHON = sys.executable


def _load(name: str, rel: str | Path):
    path = Path(rel)
    if not path.is_absolute():
        path = REPO / path
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_toolbox = _load("coc_toolbox_narration_budget", SCRIPTS / "coc_toolbox.py")
coc_starter = _load("coc_starter_narration_budget", SCRIPTS / "coc_starter.py")
coc_mcp_wire = _load("coc_mcp_wire_narration_budget", SCRIPTS / "coc_mcp_wire.py")


def _write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _read_jsonl(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    return [
        json.loads(raw)
        for raw in path.read_text(encoding="utf-8").splitlines()
        if raw.strip()
    ]


@pytest.fixture()
def campaign_ws(tmp_path: Path):
    workspace = tmp_path / "workspace"
    coc_root = workspace / ".coc"
    campaign_id = "narration-budget-test"
    _write_json(
        coc_root / "runtime.json",
        {
            "schema_version": 2,
            "planner": {"kind": "deterministic"},
            "rules": {"kind": "deterministic"},
            "narrator": {"kind": "template"},
            "player": {"kind": "human"},
        },
    )
    quick = coc_starter.quick_start(
        coc_root,
        "the-haunting",
        "thomas-hayes",
        campaign_id=campaign_id,
        title="Narration Budget Test",
    )
    return {
        "workspace": workspace,
        "coc_root": coc_root,
        "campaign_id": campaign_id,
        "campaign_dir": Path(quick["campaign_dir"]),
        "investigator_id": quick["investigator_id"],
        "quick": quick,
    }


def _run(ws, tool: str, args: dict | None = None) -> dict:
    result = coc_toolbox.run_tool(
        tool, ws["workspace"], ws["campaign_id"], dict(args or {})
    )
    assert isinstance(result, dict)
    return result


def _brief(ws, applied_events: list[dict] | None = None) -> dict:
    return _run(
        ws,
        "narration.brief",
        {
            "candidate_plan": {},
            "investigator": ws["investigator_id"],
            "applied_events": applied_events or [],
        },
    )


def test_budget_modes_from_turn_signals(campaign_ws):
    routine = _brief(campaign_ws)
    assert routine["ok"] is True, routine
    assert routine["data"]["budget"] == {
        "mode": "routine_resolution",
        "max_chars": 350,
        "max_paragraphs": 2,
    }

    costly = _brief(campaign_ws, [{"event_type": "hp_change"}])
    assert costly["data"]["budget"]["mode"] == "costly_result"
    assert costly["data"]["budget"]["max_chars"] == 550

    reveal = _brief(campaign_ws, [{"event_type": "scene_transition"}])
    assert reveal["data"]["budget"]["mode"] == "reveal_or_transition"
    assert reveal["data"]["budget"]["max_chars"] == 900

    ending = _brief(campaign_ws, [{"event_type": "session_ending"}])
    assert ending["data"]["budget"]["mode"] == "climax_or_madness"
    assert ending["data"]["budget"]["max_chars"] == 1500


def _trigger_bout(ws) -> None:
    result = _run(
        ws,
        "rules.sanity_check",
        {
            "investigator": ws["investigator_id"],
            "source": "the thing in the dark lunges",
            "loss_success": "0",
            "loss_failure": "5",
            "decision_id": "san-bout-for-budget",
            "seed": 10,
        },
    )
    assert result["ok"] is True, result
    assert result["data"]["bout_active"] is True


def test_control_overrides_reflect_active_bout_and_unconscious(campaign_ws):
    plain = _brief(campaign_ws)
    assert plain["data"]["control_overrides"] == []
    assert any("no active control override" in hint for hint in plain["hints"])

    _trigger_bout(campaign_ws)
    bout = _brief(campaign_ws)
    overrides = bout["data"]["control_overrides"]
    assert len(overrides) == 1
    assert overrides[0]["override_type"] == "bout_of_madness"
    assert overrides[0]["bout_rounds_remaining"] == 10
    assert overrides[0]["override_id"]
    assert overrides[0]["subject_ref"] == f"pc:{campaign_ws['investigator_id']}"
    assert overrides[0]["source_ref"].startswith("sanity_bout:")
    assert overrides[0]["active"] is True
    assert overrides[0]["expiry"] == {"kind": "rounds_remaining", "value": 10}
    assert bout["data"]["budget"]["mode"] == "climax_or_madness"
    assert any("ONLY within the listed control_overrides" in hint for hint in bout["hints"])

    state_path = (
        campaign_ws["campaign_dir"]
        / "save"
        / "investigator-state"
        / f"{campaign_ws['investigator_id']}.json"
    )
    state = json.loads(state_path.read_text(encoding="utf-8"))
    state["bout_active"] = False
    state["conditions"] = ["unconscious"]
    _write_json(state_path, state)
    # Drop the sanity snapshot's bout flag too so only the condition drives it.
    sanity_path = (
        campaign_ws["campaign_dir"]
        / "save"
        / "sanity-state"
        / f"{campaign_ws['investigator_id']}.json"
    )
    snapshot = json.loads(sanity_path.read_text(encoding="utf-8"))
    snapshot["bout_active"] = False
    _write_json(sanity_path, snapshot)

    unconscious = _brief(campaign_ws)
    types = {row["override_type"] for row in unconscious["data"]["control_overrides"]}
    assert types == {"unconscious"}
    assert unconscious["data"]["control_overrides"][0]["expiry"]["kind"] == "condition_cleared"


def test_review_records_deterministic_over_length(campaign_ws):
    assert coc_toolbox.TOOLS["narration.review"]["access"] == "mutation"
    assert coc_toolbox.TOOLS["narration.review"]["execution_class"] == "serial_campaign"
    journal = _run(
        campaign_ws,
        "state.journal",
        {
            "summary": "调查员等待门外的动静。",
            "player_action": "等待",
            "player_text": "我在门边等待。",
            "run_id": "review-run",
            "decision_id": "journal-review",
        },
    )
    assert journal["ok"] is True, journal
    context = _run(campaign_ws, "turn.output_context")["data"]
    long_draft = "雨敲着窗。" * 200  # 1000 chars, far beyond 2x routine budget
    reviewed = _run(
        campaign_ws,
        "narration.review",
        {
            "draft_text": long_draft,
            "turn_id": context["turn_id"],
            "source_digest": context["source_digest"],
            "revision": 1,
            "decision_id": "review-long",
        },
    )
    assert reviewed["ok"] is True, reviewed
    findings = reviewed["data"]["findings"]
    assert any(row["rule_id"] == "over_length" for row in findings)
    assert reviewed["data"]["recommendation"] == "consider_revision"
    assert reviewed["data"]["draft_sha256"].startswith("sha256:")
    assert reviewed["data"]["review_id"].startswith("narration-review-v1:")

    reviews = _read_jsonl(
        campaign_ws["campaign_dir"] / "logs" / "narration-reviews.jsonl"
    )
    assert len(reviews) == 1
    assert reviews[0]["findings"][-1]["rule_id"] == "over_length"

    short = _run(
        campaign_ws,
        "narration.review",
        {
            "draft_text": "门缝里渗进一线灯光。",
            "turn_id": context["turn_id"],
            "source_digest": context["source_digest"],
            "revision": 1,
            "decision_id": "review-short",
        },
    )
    assert short["ok"] is True
    assert short["data"]["findings"] == []
    assert short["data"]["recommendation"] == "no_revision_suggested"

    conflict = _run(
        campaign_ws,
        "narration.review",
        {
            "draft_text": "另一份草稿。",
            "turn_id": context["turn_id"],
            "source_digest": context["source_digest"],
            "revision": 1,
            "decision_id": "review-short",
        },
    )
    assert conflict["ok"] is False
    assert conflict["error"]["code"] == "idempotency_conflict"

    wrong_source = _run(
        campaign_ws,
        "narration.review",
        {
            "draft_text": "错误来源。",
            "turn_id": context["turn_id"],
            "source_digest": "sha256:wrong",
            "revision": 1,
            "decision_id": "review-wrong-source",
        },
    )
    assert wrong_source["ok"] is False
    assert wrong_source["error"]["code"] == "turn_source_changed"

    finalized = _run(
        campaign_ws,
        "turn.finalize",
        {
            "draft": long_draft,
            "coverage": [],
            "mechanics_placements": [],
            "revision": 1,
            "narration_review_id": reviewed["data"]["review_id"],
            "decision_id": "finalize-reviewed",
        },
    )
    assert finalized["ok"] is True, finalized
    assert finalized["data"]["narration_review"] == {
        "review_id": reviewed["data"]["review_id"],
        "review_digest": reviewed["data"]["review_digest"],
    }


def _open_agency_turn(ws, *, player_text: str, decision_id: str) -> dict:
    journal = _run(
        ws,
        "state.journal",
        {
            "summary": "调查员继续当前交谈。",
            "player_action": player_text,
            "player_text": player_text,
            "run_id": "pi-agency-review-run",
            "decision_id": decision_id,
        },
    )
    assert journal["ok"] is True, journal
    context = _run(ws, "turn.output_context")
    assert context["ok"] is True, context
    return context["data"]


def _agency_review(
    ws, context: dict, *, draft: str, revision: int, decision_id: str,
    findings: list[dict] | None = None,
) -> dict:
    return _run(
        ws,
        "narration.review",
        {
            "draft_text": draft,
            "turn_id": context["turn_id"],
            "source_digest": context["source_digest"],
            "revision": revision,
            "findings": findings or [],
            "decision_id": decision_id,
        },
    )


def _finalize_agency_turn(
    ws, *, draft: str, revision: int, decision_id: str,
    review_id: str | None = None, agency_claims: list[dict] | None = None,
) -> dict:
    args = {
        "draft": draft,
        "coverage": [],
        "mechanics_placements": [],
        "revision": revision,
        "agency_claims": agency_claims or [],
        "decision_id": decision_id,
    }
    if review_id is not None:
        args["narration_review_id"] = review_id
    return _run(ws, "turn.finalize", args)


def test_pi_agency_violation_requires_prose_only_revision_two(
    campaign_ws, monkeypatch
):
    monkeypatch.setenv("COC_PI_SESSION_ROLE", "play")
    context = _open_agency_turn(
        campaign_ws,
        player_text="我继续观察诺特，但不采取新的动作。",
        decision_id="journal-agency-block",
    )
    assert context["agency_review_operation"]["operation"] == "narration.review"
    assert context["agency_review_operation"]["prefilled_arguments"]["revision"] == 1
    assert {"narration_review_id", "agency_claims"} <= set(
        context["finalize_operation"]["missing_arguments"]
    )
    projected = coc_mcp_wire.project_envelope(
        "turn.output_context",
        {"ok": True, "tool": "turn.output_context", "data": context},
        contract_digest="sha256:agency-review-contract",
    )["data"]
    assert projected["agency_review_operation"]["operation"] == "narration.review"
    assert projected["agency_review_operation"]["prefilled_arguments"] == {
        "turn_id": context["turn_id"],
        "source_digest": context["source_digest"],
        "revision": 1,
    }
    assert {"narration_review_id", "agency_claims"} <= set(
        projected["finalize_operation"]["missing_arguments"]
    )
    bad_draft = "海斯意识到这次没有新收获。诺特仍坐在桌后。"
    rejected_review = _agency_review(
        campaign_ws,
        context,
        draft=bad_draft,
        revision=1,
        decision_id="review-agency-block-r1",
        findings=[{
            "rule_id": "agency_violation",
            "subject_ref": f"pc:{campaign_ws['investigator_id']}",
            "source_ref": None,
            "reason": "草稿替调查员确定了内心结论，玩家没有声明这一信念。",
        }],
    )
    assert rejected_review["ok"] is True, rejected_review
    assert rejected_review["data"]["agency_gate"] == "rewrite_required"

    blocked = _finalize_agency_turn(
        campaign_ws,
        draft=bad_draft,
        revision=1,
        review_id=rejected_review["data"]["review_id"],
        decision_id="finalize-agency-block-r1",
    )
    assert blocked["ok"] is False
    assert blocked["error"]["code"] == "agency_review_blocked"
    assert _read_jsonl(
        campaign_ws["campaign_dir"] / "logs" / "turn-finalizations.jsonl"
    ) == []

    reroll = _run(
        campaign_ws,
        "rules.roll",
        {
            "investigator": campaign_ws["investigator_id"],
            "skill": "Listen",
            "difficulty": "regular",
            "goal": "listen again during a frozen narration rewrite",
            "stakes": {
                "on_success": "hear more",
                "on_failure": "hear nothing new",
            },
            "difficulty_basis": "keeper_judgment",
            "decision_id": "must-not-reroll-during-agency-rewrite",
            "seed": 11,
        },
    )
    assert reroll["ok"] is False
    assert reroll["error"]["code"] == "turn_pending_finalization"

    rewrite_context = _run(campaign_ws, "turn.output_context")
    assert rewrite_context["ok"] is True, rewrite_context
    assert (
        rewrite_context["data"]["agency_review_operation"]
        ["prefilled_arguments"]["revision"]
        == 2
    )
    assert rewrite_context["data"]["settlement_snapshot_id"] == context[
        "settlement_snapshot_id"
    ]

    clean_draft = "诺特仍坐在桌后，表情和方才没有区别。"
    clean_review = _agency_review(
        campaign_ws,
        rewrite_context["data"],
        draft=clean_draft,
        revision=2,
        decision_id="review-agency-clean-r2",
    )
    assert clean_review["ok"] is True, clean_review
    accepted = _finalize_agency_turn(
        campaign_ws,
        draft=clean_draft,
        revision=2,
        review_id=clean_review["data"]["review_id"],
        decision_id="finalize-agency-clean-r2",
    )
    assert accepted["ok"] is True, accepted
    assert accepted["data"]["accepted_revision"] == 2
    assert accepted["data"]["settlement_snapshot_id"] == context["settlement_snapshot_id"]
    assert len(_read_jsonl(
        campaign_ws["campaign_dir"] / "logs" / "turn-finalizations.jsonl"
    )) == 1


def test_pi_agency_review_allows_player_declared_action(campaign_ws, monkeypatch):
    monkeypatch.setenv("COC_PI_SESSION_ROLE", "play")
    context = _open_agency_turn(
        campaign_ws,
        player_text="我靠回椅背，继续听诺特说。",
        decision_id="journal-player-action",
    )
    draft = "海斯靠回椅背。诺特把纸条推到桌沿。"
    review = _agency_review(
        campaign_ws,
        context,
        draft=draft,
        revision=1,
        decision_id="review-player-action",
    )
    claim = {
        "claim_id": "claim-player-action",
        "subject_ref": f"pc:{campaign_ws['investigator_id']}",
        "claim_type": "voluntary_action",
        "exact_excerpt": "海斯靠回椅背",
        "source_ref": context["contract_projection"]["player_input"]["source_ref"],
        "override_id": None,
    }
    finalized = _finalize_agency_turn(
        campaign_ws,
        draft=draft,
        revision=1,
        review_id=review["data"]["review_id"],
        agency_claims=[claim],
        decision_id="finalize-player-action",
    )
    assert finalized["ok"] is True, finalized


def test_pi_agency_review_allows_physiology_and_frozen_override(
    campaign_ws, monkeypatch
):
    monkeypatch.setenv("COC_PI_SESSION_ROLE", "play")
    state_path = (
        campaign_ws["campaign_dir"] / "save" / "investigator-state"
        / f"{campaign_ws['investigator_id']}.json"
    )
    state = json.loads(state_path.read_text(encoding="utf-8"))
    state["conditions"] = ["unconscious"]
    _write_json(state_path, state)
    context = _open_agency_turn(
        campaign_ws,
        player_text="我等待外界变化。",
        decision_id="journal-forced-action",
    )
    override = context["contract_projection"]["control_overrides"][0]
    draft = "海斯的手心发冷，随后失去意识，无法继续行动。"
    review = _agency_review(
        campaign_ws,
        context,
        draft=draft,
        revision=1,
        decision_id="review-forced-action",
    )
    claims = [
        {
            "claim_id": "claim-physiology",
            "subject_ref": f"pc:{campaign_ws['investigator_id']}",
            "claim_type": "involuntary_physiology",
            "exact_excerpt": "海斯的手心发冷",
            "source_ref": "narration_contract:involuntary_physiology",
            "override_id": None,
        },
        {
            "claim_id": "claim-forced",
            "subject_ref": override["subject_ref"],
            "claim_type": "forced_behavior",
            "exact_excerpt": "失去意识，无法继续行动",
            "source_ref": override["source_ref"],
            "override_id": override["override_id"],
        },
    ]
    finalized = _finalize_agency_turn(
        campaign_ws,
        draft=draft,
        revision=1,
        review_id=review["data"]["review_id"],
        agency_claims=claims,
        decision_id="finalize-forced-action",
    )
    assert finalized["ok"] is True, finalized


def test_pi_finalization_requires_exact_bound_agency_review(campaign_ws, monkeypatch):
    monkeypatch.setenv("COC_PI_SESSION_ROLE", "play")
    context = _open_agency_turn(
        campaign_ws,
        player_text="我留在原地。",
        decision_id="journal-review-required",
    )
    draft = "诺特仍坐在桌后。"
    missing = _finalize_agency_turn(
        campaign_ws,
        draft=draft,
        revision=1,
        decision_id="finalize-review-missing",
    )
    assert missing["ok"] is False
    assert missing["error"]["code"] == "narration_review_required"

    review = _agency_review(
        campaign_ws,
        context,
        draft="诺特站在窗边。",
        revision=1,
        decision_id="review-wrong-draft",
    )
    wrong = _finalize_agency_turn(
        campaign_ws,
        draft=draft,
        revision=1,
        review_id=review["data"]["review_id"],
        decision_id="finalize-review-wrong",
    )
    assert wrong["ok"] is False
    assert wrong["error"]["code"] == "narration_review_mismatch"

    soft_review = _agency_review(
        campaign_ws,
        context,
        draft=draft,
        revision=1,
        decision_id="review-soft-finding",
        findings=[{
            "rule_id": "semantic_repetition",
            "subject_ref": None,
            "source_ref": None,
            "reason": "这句可以更短，但没有侵犯调查员控制权。",
        }],
    )
    accepted = _finalize_agency_turn(
        campaign_ws,
        draft=draft,
        revision=1,
        review_id=soft_review["data"]["review_id"],
        decision_id="finalize-soft-finding",
    )
    assert accepted["ok"] is True, accepted
