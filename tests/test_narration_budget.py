"""Narration budget + control-override ownership surface (phase 4)."""
from __future__ import annotations

import importlib.util
import hashlib
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
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))
# coc_toolbox's import registered the shared kernel runtime under the exact
# module name the operation cells import; only then is the cell loadable.
assert "coc_operation_kernel_runtime" in sys.modules
coc_turn_output = _load(
    "coc_turn_output_narration_budget", SCRIPTS / "coc_operation_turn_output.py"
)


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


def _digest(value) -> str:
    return "sha256:" + hashlib.sha256(
        json.dumps(
            value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        ).encode("utf-8")
    ).hexdigest()


def _paragraphs(draft: str) -> list[str]:
    rows, lines = [], []
    for line in draft.split("\n"):
        if line.strip():
            lines.append(line)
        elif lines:
            rows.append("\n".join(lines))
            lines = []
    if lines:
        rows.append("\n".join(lines))
    return rows


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


def test_settled_multi_stage_public_checks_fit_budget_and_finalize_first_try(
    campaign_ws,
):
    investigator = campaign_ws["investigator_id"]
    run_id = "multi-stage-budget-run"
    reaction_context = {
        "player_conduct": "调查员出示记者证，礼貌说明查档来意",
        "scene_constraints": "工作人员仍受档案借阅职责约束",
        "authored_or_relationship_boundary": "初次见面，没有既有私交",
        "semantic_reason": "外表与社会身份只影响最初耐心，不越过职责边界",
    }

    arty = _run(campaign_ws, "npc.reaction", {
        "npc_id": "npc-arty-wilmot",
        "npc_display_name": "阿蒂·威尔莫特",
        "investigator": investigator,
        "run_id": run_id,
        "context": reaction_context,
        "seed": 5,
        "decision_id": "budget-arty-reaction",
    })
    assert arty["ok"] is True, arty
    assert arty["data"]["achieved_level"] == "failure"
    arty_engagement = _run(campaign_ws, "state.record_npc_engagement", {
        "npc_id": "npc-arty-wilmot",
        "investigator": investigator,
        "interaction_kind": "dialogue",
        "first_impression_ref": arty["data"]["first_impression_ref"],
        "first_impression_realization": {
            "observable_manner": "阿蒂把登记簿按在手下，先审视记者证",
            "causal_explanation": "调查员的初次露面没有立刻消除他的戒心",
            "boundary_preserved": "阿蒂仍坚持查档手续",
            "opportunity_or_friction": "调查员需要进一步说明来意",
        },
        "run_id": run_id,
        "decision_id": "budget-arty-engagement",
    })
    assert arty_engagement["ok"] is True, arty_engagement

    adjudicated = _run(campaign_ws, "rules.social_adjudicate", {
        "investigator": investigator,
        "npc_id": "npc-arty-wilmot",
        "conversation_window_id": "budget-globe-counter",
        "commitment_id": "budget-request-clippings",
        "approach": "charm",
        "goal_summary": "获准查阅旧剪报",
        "decision_id": "budget-social-adjudication",
    })
    assert adjudicated["ok"] is True, adjudicated
    social = _run(campaign_ws, "rules.roll", {
        "investigator": investigator,
        "npc_id": "npc-arty-wilmot",
        "skill": adjudicated["data"]["approach_skill"],
        "difficulty": adjudicated["data"]["final_difficulty"],
        "bonus": adjudicated["data"]["bonus_dice"],
        "penalty": adjudicated["data"]["penalty_dice"],
        "goal": "获准查阅旧剪报",
        "stakes": {
            "on_success": "阿蒂准许调查员进入剪报库",
            "on_failure": "阿蒂拒绝开放剪报库",
        },
        "difficulty_basis": "opponent_skill",
        "social_adjudication_ref": adjudicated["data"]["goal_key"],
        "seed": 11,
        "decision_id": "budget-social-roll",
    })
    assert social["ok"] is True, social
    assert social["data"]["outcome"] not in {"critical", "fumble"}

    ruth = _run(campaign_ws, "npc.reaction", {
        "npc_id": "npc-ruth-blake",
        "npc_display_name": "露丝·布莱克",
        "investigator": investigator,
        "run_id": run_id,
        "context": reaction_context,
        "seed": 3,
        "decision_id": "budget-ruth-reaction",
    })
    assert ruth["ok"] is True, ruth
    assert ruth["data"]["achieved_level"] == "regular"
    ruth_engagement = _run(campaign_ws, "state.record_npc_engagement", {
        "npc_id": "npc-ruth-blake",
        "investigator": investigator,
        "interaction_kind": "dialogue",
        "first_impression_ref": ruth["data"]["first_impression_ref"],
        "first_impression_realization": {
            "observable_manner": "露丝看过记者证后把索引卡推到柜台边",
            "causal_explanation": "调查员清楚的身份说明让她愿意提供下一步指引",
            "boundary_preserved": "露丝仍不替调查员绕过借阅规定",
            "opportunity_or_friction": "她指出了可申请的剪报卷宗",
        },
        "run_id": run_id,
        "decision_id": "budget-ruth-engagement",
    })
    assert ruth_engagement["ok"] is True, ruth_engagement

    journal = _run(campaign_ws, "state.journal", {
        "summary": "调查员在剪报库柜台先后与阿蒂和露丝交涉。",
        "player_action": "出示记者证并申请查阅旧剪报",
        "player_text": "我出示记者证，请他们让我查阅旧剪报。",
        "intent_class": "social",
        "run_id": run_id,
        "decision_id": "budget-multi-stage-journal",
    })
    assert journal["ok"] is True, journal
    output = _run(campaign_ws, "turn.output_context")
    assert output["ok"] is True, output
    data = output["data"]
    public_checks = data["mechanics_bundle"]["public_check"]
    assert len(public_checks) == 3
    assert data["contract_projection"]["narration_budget"]["max_paragraphs"] >= 4
    assert data["contract_projection"]["narration_budget"]["max_chars"] >= 700

    setup = "你把记者证平放在柜台上，先向阿蒂说明要查的年份和地址。"
    arty_result = "阿蒂仍按着登记簿，初见的戒心让他先把你的记者证翻来覆去看了两遍。"
    social_result = "你把查档来意说清楚后，他终于把通往剪报库的门推开。"
    ruth_result = "门后的露丝看过记者证，把对应年份的索引卡推到你手边。"
    draft = "\n\n".join((setup, arty_result, social_result, ruth_result))
    coverage = []
    for obligation in data["obligations"]:
        if obligation["source_id"] in {
            arty["data"]["roll_id"],
            arty["data"]["receipt_id"],
        }:
            excerpt = arty_result
        elif obligation["source_id"] == social["data"]["roll_id"]:
            excerpt = social_result
        else:
            excerpt = ruth_result
        coverage.append({
            "obligation_id": obligation["obligation_id"],
            "realization": "fictional_beat",
            "action_realization": "调查员出示记者证并清楚说明查档来意",
            "response": "工作人员按各自职责回应调查员",
            "causal_explanation": "首见印象和社交检定共同决定工作人员如何放行",
            "persona_fit": "符合记者以证件和清楚请求交涉的方式",
            "player_input_handling": "specific_preserved",
            "exact_excerpt": excerpt,
            "exceptional_beat": "",
        })

    finalized = _run(campaign_ws, "turn.finalize", {
        "draft": draft,
        "coverage": coverage,
        "revision": 1,
        "decision_id": "budget-multi-stage-finalize",
    })
    assert finalized["ok"] is True, finalized
    assert finalized["data"]["accepted_revision"] == 1


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
    assert reviewed["data"]["state_authority_review"] is None
    assert reviewed["data"]["state_authority_gate"] == "advisory"

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
        "draft_sha256": reviewed["data"]["draft_sha256"],
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
    state_authority_review: dict | None = None,
    compiled_claims: list[dict] | None = None,
    compiler_receipt_mutator=None,
) -> dict:
    args = {
        "draft_text": draft,
        "turn_id": context["turn_id"],
        "source_digest": context["source_digest"],
        "revision": revision,
        "findings": findings or [],
        "decision_id": decision_id,
    }
    args["state_authority_review"] = (
        state_authority_review
        if state_authority_review is not None
        else {
            "disposition": "no_player_state_change_claimed",
            "reason": "草稿没有声称当前调查员的权威状态发生变化。",
            "claims": [],
        }
    )
    raw_declared_claims = (
        args["state_authority_review"].get("claims")
        if isinstance(args["state_authority_review"], dict) else None
    )
    declared_claims = (
        raw_declared_claims if isinstance(raw_declared_claims, list) else []
    )
    compiler_source = (
        compiled_claims
        if compiled_claims is not None
        else [dict(claim) for claim in declared_claims]
    )
    candidates = sorted(
        [
            {
                "claim_id": claim["claim_id"],
                "subject_ref": claim["subject_ref"],
                "claim_kind": claim["claim_kind"],
                "exact_excerpt": claim["exact_excerpt"],
            }
            for claim in declared_claims
        ],
        key=lambda value: json.dumps(
            value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        ),
    )
    result_claims = []
    for claim in compiler_source:
        matched = next((
            candidate["claim_id"] for candidate in declared_claims
            if candidate["subject_ref"] == claim["subject_ref"]
            and candidate["claim_kind"] == claim["claim_kind"]
            and candidate.get("source_effect_id") == claim.get("source_effect_id")
        ), None)
        identity = [
            claim["subject_ref"], claim["claim_kind"],
            claim["exact_excerpt"], matched,
        ]
        result_claims.append({
            "compiler_claim_id": "compiled:" + _digest(identity)[7:47],
            "subject_ref": claim["subject_ref"],
            "claim_kind": claim["claim_kind"],
            "exact_excerpt": claim["exact_excerpt"],
            "matched_review_claim_id": matched,
            "reason": claim["reason"],
        })
    paragraphs = _paragraphs(draft)
    semantic_input = {
        "schema_version": 1,
        "contract_id": "coc.pi-state-claim-compiler-input.v1",
        "draft_text": draft,
        "pc_subject_refs": [f"pc:{ws['investigator_id']}"],
        "candidate_claims": candidates,
        "paragraphs": [
            {"paragraph_index": index, "paragraph_sha256": _digest(text)}
            for index, text in enumerate(paragraphs)
        ],
    }
    result = {
        "schema_version": 1,
        "contract_id": "coc.pi-state-claim-compiler-result.v1",
        "disposition": (
            "claims_detected" if result_claims else "no_claims_detected"
        ),
        "reason": "Independent semantic fixture reviewed every paragraph.",
        "claims": result_claims,
        "paragraph_coverage": [
            {
                "paragraph_index": index,
                "paragraph_sha256": _digest(text),
                "claim_indices": [
                    claim_index
                    for claim_index, claim in enumerate(result_claims)
                    if claim["exact_excerpt"] in text
                ],
            }
            for index, text in enumerate(paragraphs)
        ],
    }
    binding = {
        "turn_id": context["turn_id"],
        "source_digest": context["source_digest"],
        "revision": revision,
        "draft_sha256": _digest(draft),
        "kp_review_digest": _digest(args["state_authority_review"]),
        "settlement_snapshot_id": context["settlement_snapshot_id"],
        "mechanics_bundle_sha256": context["mechanics_bundle_sha256"],
    }
    receipt = {
        "schema_version": 1,
        "contract_id": "coc.pi-state-claim-compilation-receipt.v1",
        "status": "completed",
        "compiler_contract_id": "coc.pi-state-claim-compiler.v1",
        "requested_model": {"provider": "fixture", "id": "semantic", "api": "fixture"},
        "response_model": {"provider": "fixture", "id": "semantic", "api": "fixture"},
        "semantic_input_digest": _digest(semantic_input),
        "semantic_result_digest": _digest(result),
        "binding": binding,
        "result": result,
    }
    if compiler_receipt_mutator is not None:
        compiler_receipt_mutator(receipt)
    receipt["semantic_result_digest"] = _digest(receipt["result"])
    receipt["binding_digest"] = _digest(receipt)
    args["state_claim_compilation"] = receipt
    return _run(ws, "narration.review", args)


def _finalize_agency_turn(
    ws, *, draft: str, revision: int, decision_id: str,
    review_id: str | None = None, agency_claims: list[dict] | None = None,
    mechanics_placements=(),
) -> dict:
    args = {
        "draft": draft,
        "coverage": [],
        "revision": revision,
        "agency_claims": agency_claims or [],
        "decision_id": decision_id,
    }
    if mechanics_placements is not None:
        args["mechanics_placements"] = list(mechanics_placements)
    if review_id is not None:
        args["narration_review_id"] = review_id
    return _run(ws, "turn.finalize", args)


def test_pi_state_authority_blocks_captured_cash_key_and_address_without_receipts(
    campaign_ws, monkeypatch
):
    monkeypatch.setenv("COC_PI_SESSION_ROLE", "play")
    context = _open_agency_turn(
        campaign_ws,
        player_text="我接受委托。请把预付定金、钥匙和地址便签现在交给我。",
        decision_id="journal-state-authority-unbound",
    )
    assert context["mechanics_bundle"]["state_delta"] == []
    draft = (
        "诺特把那串黄铜钥匙推过桌面。"
        "预付的钞票压到你手边，写着科比特宅地址的便签也一并交给了你。"
    )
    review = _agency_review(
        campaign_ws,
        context,
        draft=draft,
        revision=1,
        decision_id="review-state-authority-unbound",
        state_authority_review={
            "disposition": "no_player_state_change_claimed",
            "reason": "桌面交付动作没有改变调查员的账本或物品栏。",
            "claims": [],
        },
        compiled_claims=[
                {
                    "claim_id": "compiled-prepayment",
                    "subject_ref": f"pc:{campaign_ws['investigator_id']}",
                    "claim_kind": "cash",
                    "exact_excerpt": "预付的钞票压到你手边",
                    "source_effect_id": None,
                    "reason": "NPC 将预付款交给调查员。",
                },
                {
                    "claim_id": "compiled-brass-key",
                    "subject_ref": f"pc:{campaign_ws['investigator_id']}",
                    "claim_kind": "item",
                    "exact_excerpt": "诺特把那串黄铜钥匙推过桌面",
                    "source_effect_id": None,
                    "reason": "NPC 将钥匙交给调查员。",
                },
                {
                    "claim_id": "compiled-address-note",
                    "subject_ref": f"pc:{campaign_ws['investigator_id']}",
                    "claim_kind": "item",
                    "exact_excerpt": "写着科比特宅地址的便签也一并交给了你",
                    "source_effect_id": None,
                    "reason": "NPC 将写有委托地址的信息卡交给调查员。",
                },
        ],
    )
    assert review["ok"] is True, review
    assert review["data"]["state_authority_hard_gate"] is True
    assert review["data"]["state_authority_gate"] == "rewrite_required"
    assert review["data"]["recommendation"] == "revision_required"

    blocked = _finalize_agency_turn(
        campaign_ws,
        draft=draft,
        revision=1,
        review_id=review["data"]["review_id"],
        decision_id="finalize-state-authority-unbound",
    )
    assert blocked["ok"] is False
    assert blocked["error"]["code"] == "state_authority_review_blocked"
    assert _read_jsonl(
        campaign_ws["campaign_dir"] / "logs" / "turn-finalizations.jsonl"
    ) == []


def test_pi_state_authority_accepts_grounded_cash_key_address_and_separate_clue(
    campaign_ws, monkeypatch
):
    monkeypatch.setenv("COC_PI_SESSION_ROLE", "play")
    investigator = campaign_ws["investigator_id"]
    cash = _run(campaign_ws, "state.cash_grant", {
        "investigator": investigator,
        "amount": 20,
        "currency": "USD",
        "source": "npc-thomas-notte",
        "reason": "commission advance",
        "localized_reason": "委托预付定金",
        "decision_id": "grant-grounded-prepayment",
    })
    assert cash["ok"] is True, cash
    key = _run(campaign_ws, "state.item_grant", {
        "investigator": investigator,
        "kind": "gear",
        "label": "黄铜钥匙",
        "item_id": "corbitt-house-key",
        "note": "托马斯·诺特交付的科比特宅钥匙",
        "decision_id": "grant-grounded-key",
    })
    assert key["ok"] is True, key
    address = _run(campaign_ws, "state.item_grant", {
        "investigator": investigator,
        "kind": "gear",
        "label": "科比特宅地址便签",
        "item_id": "corbitt-house-address-note",
        "note": "托马斯·诺特写下的委托地址",
        "decision_id": "grant-grounded-address-note",
    })
    assert address["ok"] is True, address
    clue = _run(campaign_ws, "state.record_clue", {
        "clue_id": "clue-knott-keys",
        "method": "accepted the commission and received its materials",
        "decision_id": "record-grounded-knott-keys-clue",
    })
    assert clue["ok"] is True, clue
    context = _open_agency_turn(
        campaign_ws,
        player_text="我接过二十美元预付款、钥匙和地址便签。",
        decision_id="journal-state-authority-grounded",
    )
    cash_effects = [
        row
        for row in context["mechanics_bundle"]["state_delta"]
        if row["effect_kind"] == "cash"
    ]
    item_effects = {
        row["item_id"]: row
        for row in context["mechanics_bundle"]["state_delta"]
        if row["effect_kind"] == "item"
    }
    assert len(cash_effects) == 1
    assert set(item_effects) == {
        "corbitt-house-key", "corbitt-house-address-note",
    }
    assert all(
        row["effect_kind"] != "clue"
        for row in context["mechanics_bundle"]["state_delta"]
    )
    draft = "诺特把二十美元预付款、黄铜钥匙和写着科比特宅地址的便签一并交到你手里。"
    state_review = {
        "disposition": "claims_listed",
        "reason": "草稿明确声称当前调查员取得现金、钥匙与地址便签。",
        "claims": [
            {
                "claim_id": "claim-grounded-prepayment",
                "subject_ref": f"pc:{investigator}",
                "claim_kind": "cash",
                "exact_excerpt": "二十美元预付款",
                "source_effect_id": cash_effects[0]["effect_id"],
                "reason": "NPC 将预付款交给调查员。",
            },
            {
                "claim_id": "claim-grounded-key",
                "subject_ref": f"pc:{investigator}",
                "claim_kind": "item",
                "exact_excerpt": "黄铜钥匙",
                "source_effect_id": item_effects["corbitt-house-key"]["effect_id"],
                "reason": "NPC 将钥匙交给调查员。",
            },
            {
                "claim_id": "claim-grounded-address-note",
                "subject_ref": f"pc:{investigator}",
                "claim_kind": "item",
                "exact_excerpt": "写着科比特宅地址的便签",
                "source_effect_id": item_effects[
                    "corbitt-house-address-note"
                ]["effect_id"],
                "reason": "NPC 将地址便签交给调查员。",
            },
        ],
    }
    review = _agency_review(
        campaign_ws,
        context,
        draft=draft,
        revision=1,
        decision_id="review-state-authority-grounded",
        state_authority_review=state_review,
    )
    assert review["ok"] is True, review
    assert review["data"]["state_authority_gate"] == "clear"
    replay = _agency_review(
        campaign_ws,
        context,
        draft=draft,
        revision=1,
        decision_id="review-state-authority-grounded",
        state_authority_review=state_review,
    )
    assert replay["ok"] is True, replay
    assert replay["data"] == review["data"]

    finalized = _finalize_agency_turn(
        campaign_ws,
        draft=draft,
        revision=1,
        review_id=review["data"]["review_id"],
        decision_id="finalize-state-authority-grounded",
        mechanics_placements=None,
    )
    assert finalized["ok"] is True, finalized
    assert finalized["data"]["rendered_text"].count("委托预付定金") == 1
    assert finalized["data"]["rendered_text"].count("黄铜钥匙") == 2
    assert finalized["data"]["rendered_text"].count("科比特宅地址便签") == 1
    reloaded_world = json.loads(
        (campaign_ws["campaign_dir"] / "save" / "world-state.json").read_text(
            encoding="utf-8"
        )
    )
    assert "clue-knott-keys" in reloaded_world["discovered_clue_ids"]


def test_pi_state_authority_rewrites_when_kp_omits_grounded_compiled_claim(
    campaign_ws, monkeypatch
):
    monkeypatch.setenv("COC_PI_SESSION_ROLE", "play")
    investigator = campaign_ws["investigator_id"]
    granted = _run(campaign_ws, "state.cash_grant", {
        "investigator": investigator,
        "amount": 20,
        "currency": "USD",
        "source": "npc-thomas-knott",
        "reason": "captured commission prepayment",
        "localized_reason": "一天预付调查费",
        "decision_id": "grant-compiled-omission",
    })
    assert granted["ok"] is True, granted
    context = _open_agency_turn(
        campaign_ws,
        player_text="我接受委托并接过预付款。",
        decision_id="journal-compiled-omission",
    )
    cash_effect = next(
        row for row in context["mechanics_bundle"]["state_delta"]
        if row["effect_kind"] == "cash"
    )
    draft = "诺特把二十美元预付款推到你手中。"
    review = _agency_review(
        campaign_ws,
        context,
        draft=draft,
        revision=1,
        decision_id="review-compiled-omission",
        state_authority_review={
            "disposition": "no_player_state_change_claimed",
            "reason": "KP 漏列了草稿中的现金交付。",
            "claims": [],
        },
        compiled_claims=[{
            "claim_id": "compiled-cash-prepayment",
            "subject_ref": f"pc:{investigator}",
            "claim_kind": "cash",
            "exact_excerpt": "二十美元预付款推到你手中",
            "source_effect_id": cash_effect["effect_id"],
            "reason": "草稿把权威现金交到调查员控制中。",
        }],
    )
    assert review["ok"] is True, review
    assert review["data"]["state_authority_gate"] == "rewrite_required"
    assert review["data"]["state_claim_review_disagreement"] is True


@pytest.mark.parametrize("effect_kind", ["cash", "item"])
def test_pi_state_authority_excludes_prior_state_replay_from_next_turn(
    campaign_ws, monkeypatch, effect_kind
):
    monkeypatch.setenv("COC_PI_SESSION_ROLE", "play")
    investigator = campaign_ws["investigator_id"]
    if effect_kind == "cash":
        tool = "state.cash_grant"
        mutation = {
            "investigator": investigator,
            "amount": 5,
            "currency": "USD",
            "source": "npc-thomas-notte",
            "reason": "two-turn replay fixture",
            "localized_reason": "首轮预付",
            "decision_id": "grant-once-cash",
        }
        first_draft = "诺特把五美元交到你手里。"
        first_excerpt = "五美元交到你手里"
    else:
        tool = "state.item_grant"
        mutation = {
            "investigator": investigator,
            "kind": "gear",
            "label": "黄铜钥匙",
            "item_id": "two-turn-replay-key",
            "note": "two-turn replay fixture",
            "decision_id": "grant-once-item",
        }
        first_draft = "诺特把黄铜钥匙交到你手里。"
        first_excerpt = "黄铜钥匙交到你手里"

    granted = _run(campaign_ws, tool, mutation)
    assert granted["ok"] is True, granted
    first_context = _open_agency_turn(
        campaign_ws,
        player_text="我接过这次交付。",
        decision_id=f"journal-replay-first-{effect_kind}",
    )
    first_effect = next(
        row for row in first_context["mechanics_bundle"]["state_delta"]
        if row["effect_kind"] == effect_kind
    )
    first_review = _agency_review(
        campaign_ws,
        first_context,
        draft=first_draft,
        revision=1,
        decision_id=f"review-replay-first-{effect_kind}",
        state_authority_review={
            "disposition": "claims_listed",
            "reason": "首轮草稿声称调查员取得权威状态中的交付物。",
            "claims": [{
                "claim_id": f"claim-replay-first-{effect_kind}",
                "subject_ref": f"pc:{investigator}",
                "claim_kind": effect_kind,
                "exact_excerpt": first_excerpt,
                "source_effect_id": first_effect["effect_id"],
                "reason": "绑定首轮真实状态写入。",
            }],
        },
    )
    assert first_review["ok"] is True, first_review
    first_finalized = _finalize_agency_turn(
        campaign_ws,
        draft=first_draft,
        revision=1,
        review_id=first_review["data"]["review_id"],
        decision_id=f"finalize-replay-first-{effect_kind}",
        mechanics_placements=None,
    )
    assert first_finalized["ok"] is True, first_finalized

    replayed = _run(campaign_ws, tool, mutation)
    assert replayed["ok"] is True, replayed
    assert replayed["idempotent_replay"] is True
    replay_rows = [
        row
        for row in _read_jsonl(
            campaign_ws["campaign_dir"] / "logs" / "toolbox-calls.jsonl"
        )
        if row.get("tool") == tool
        and (row.get("args") or {}).get("decision_id") == mutation["decision_id"]
    ]
    assert len(replay_rows) == 2
    assert replay_rows[-1]["idempotent_replay"] is True

    second_context = _open_agency_turn(
        campaign_ws,
        player_text="我继续等候。",
        decision_id=f"journal-replay-second-{effect_kind}",
    )
    assert second_context["mechanics_bundle"]["state_delta"] == []
    stale_claim = _agency_review(
        campaign_ws,
        second_context,
        draft=first_draft,
        revision=1,
        decision_id=f"review-replay-stale-{effect_kind}",
        state_authority_review={
            "disposition": "claims_listed",
            "reason": "尝试把首轮效果错误地绑定到第二轮草稿。",
            "claims": [{
                "claim_id": f"claim-replay-stale-{effect_kind}",
                "subject_ref": f"pc:{investigator}",
                "claim_kind": effect_kind,
                "exact_excerpt": first_excerpt,
                "source_effect_id": first_effect["effect_id"],
                "reason": "这个效果只属于首轮。",
            }],
        },
    )
    assert stale_claim["ok"] is False
    assert stale_claim["error"]["code"] == "state_authority_source_unknown"

    clean_draft = "诺特仍坐在桌后，没有作出新的交付。"
    clean_review = _agency_review(
        campaign_ws,
        second_context,
        draft=clean_draft,
        revision=1,
        decision_id=f"review-replay-clean-{effect_kind}",
    )
    assert clean_review["ok"] is True, clean_review
    second_finalized = _finalize_agency_turn(
        campaign_ws,
        draft=clean_draft,
        revision=1,
        review_id=clean_review["data"]["review_id"],
        decision_id=f"finalize-replay-second-{effect_kind}",
    )
    assert second_finalized["ok"] is True, second_finalized
    assert len(_read_jsonl(
        campaign_ws["campaign_dir"] / "logs" / "turn-finalizations.jsonl"
    )) == 2

    replayed_again = _run(campaign_ws, tool, mutation)
    assert replayed_again["ok"] is True, replayed_again
    assert replayed_again["idempotent_replay"] is True
    fresh_mutation = dict(mutation)
    fresh_mutation["decision_id"] = f"grant-fresh-{effect_kind}"
    if effect_kind == "cash":
        fresh_mutation.update({
            "amount": 2,
            "reason": "fresh write after prior replay",
            "localized_reason": "新一轮预付",
        })
    else:
        fresh_mutation.update({
            "item_id": "fresh-replay-key",
            "label": "银色钥匙",
            "note": "fresh write after prior replay",
        })
    fresh = _run(campaign_ws, tool, fresh_mutation)
    assert fresh["ok"] is True, fresh
    assert fresh.get("idempotent_replay") is not True
    mixed_context = _open_agency_turn(
        campaign_ws,
        player_text="我接过这一次的新交付。",
        decision_id=f"journal-replay-mixed-{effect_kind}",
    )
    assert [
        row["source_decision_id"]
        for row in mixed_context["mechanics_bundle"]["state_delta"]
    ] == [fresh_mutation["decision_id"]]


def test_exact_journal_replay_keeps_pending_turn_identity_and_audit(
    campaign_ws,
):
    journal_args = {
        "summary": "调查员继续等待。",
        "player_action": "等待",
        "player_text": "我继续等待。",
        "run_id": "journal-replay-identity-run",
        "decision_id": "journal-replay-identity",
    }
    first = _run(campaign_ws, "state.journal", journal_args)
    assert first["ok"] is True, first
    before = _run(campaign_ws, "turn.output_context")["data"]

    replayed = _run(campaign_ws, "state.journal", journal_args)
    assert replayed["ok"] is True, replayed
    assert replayed["idempotent_replay"] is True
    after = _run(campaign_ws, "turn.output_context")
    assert after["ok"] is True, after
    after_data = after["data"]

    for key in (
        "turn_id",
        "journal_call_index",
        "source_end_index",
        "source_digest",
        "mechanics_bundle_sha256",
        "settlement_snapshot_id",
    ):
        assert after_data[key] == before[key], key
    rows = _read_jsonl(
        campaign_ws["campaign_dir"] / "logs" / "toolbox-calls.jsonl"
    )
    journal_rows = [
        row for row in rows
        if row.get("tool") == "state.journal"
        and (row.get("args") or {}).get("decision_id")
        == journal_args["decision_id"]
    ]
    assert len(journal_rows) == 2
    assert journal_rows[-1]["idempotent_replay"] is True


def test_first_durable_journal_recovery_receipt_owns_pending_turn(
    campaign_ws,
):
    journal_args = {
        "summary": "调查员继续等待。",
        "player_action": "等待",
        "player_text": "我继续等待。",
        "run_id": "journal-recovery-run",
        "decision_id": "journal-recovery-first-durable",
    }
    first = _run(campaign_ws, "state.journal", journal_args)
    assert first["ok"] is True, first
    log_path = campaign_ws["campaign_dir"] / "logs" / "toolbox-calls.jsonl"
    assert len(_read_jsonl(log_path)) == 1
    # Simulate interruption after the journal/ledger/manifest commit but before
    # its generic toolbox-call audit receipt became durable.
    log_path.write_text("", encoding="utf-8")

    recovered = _run(campaign_ws, "state.journal", journal_args)
    assert recovered["ok"] is True, recovered
    assert recovered.get("idempotent_replay") is not True
    context = _run(campaign_ws, "turn.output_context")
    assert context["ok"] is True, context
    assert context["data"]["journal_decision_id"] == journal_args["decision_id"]
    rows = _read_jsonl(log_path)
    journal_rows = [row for row in rows if row.get("tool") == "state.journal"]
    assert len(journal_rows) == 1
    assert journal_rows[0].get("idempotent_replay") is not True


def test_exact_exceptional_effect_replay_after_journal_stays_audit_only(
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
        "decision_id": "journal-replay-critical-source",
    })
    assert critical["ok"] is True, critical
    assert critical["data"]["outcome"] == "critical"
    effect_args = {
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
        "decision_id": "journal-replay-exceptional-effect",
    }
    applied = _run(campaign_ws, "state.exceptional_effect", effect_args)
    assert applied["ok"] is True, applied
    context = _open_agency_turn(
        campaign_ws,
        player_text="我记住这个程序弱点。",
        decision_id="journal-before-exceptional-replay",
    )

    replayed = _run(campaign_ws, "state.exceptional_effect", effect_args)
    assert replayed["ok"] is True, replayed
    assert replayed["idempotent_replay"] is True
    after = _run(campaign_ws, "turn.output_context")
    assert after["ok"] is True, after
    assert after["data"]["source_digest"] == context["source_digest"]
    assert after["data"]["settlement_snapshot_id"] == context[
        "settlement_snapshot_id"
    ]
    rows = _read_jsonl(
        campaign_ws["campaign_dir"] / "logs" / "toolbox-calls.jsonl"
    )
    replay_rows = [
        row for row in rows
        if row.get("tool") == "state.exceptional_effect"
        and (row.get("args") or {}).get("decision_id")
        == effect_args["decision_id"]
    ]
    assert len(replay_rows) == 2
    assert replay_rows[-1]["idempotent_replay"] is True


@pytest.mark.parametrize(
    ("case", "expected_code"),
    [
        ("unknown", "state_authority_source_unknown"),
        ("wrong_kind", "state_authority_kind_mismatch"),
        ("wrong_pc", "state_authority_subject_mismatch"),
        ("excerpt", "state_authority_excerpt_mismatch"),
        ("disposition", "state_authority_disposition_mismatch"),
        ("duplicate", "state_authority_claim_duplicate"),
        ("closed_schema", "invalid_param"),
    ],
)
def test_pi_state_authority_rejects_invalid_claim_bindings(
    campaign_ws, monkeypatch, case, expected_code
):
    monkeypatch.setenv("COC_PI_SESSION_ROLE", "play")
    investigator = campaign_ws["investigator_id"]
    granted = _run(campaign_ws, "state.cash_grant", {
        "investigator": investigator,
        "amount": 3,
        "currency": "USD",
        "source": "npc-thomas-notte",
        "reason": "claim validation fixture",
        "localized_reason": "测试预付",
        "decision_id": f"grant-claim-validation-{case}",
    })
    assert granted["ok"] is True, granted
    context = _open_agency_turn(
        campaign_ws,
        player_text="我接过三美元。",
        decision_id=f"journal-claim-validation-{case}",
    )
    cash_effect = next(
        row for row in context["mechanics_bundle"]["state_delta"]
        if row["effect_kind"] == "cash"
    )
    draft = "诺特把三美元交到你手里。"
    claim = {
        "claim_id": "claim-payment",
        "subject_ref": f"pc:{investigator}",
        "claim_kind": "cash",
        "exact_excerpt": "三美元交到你手里",
        "source_effect_id": cash_effect["effect_id"],
        "reason": "草稿声称调查员收到现金。",
    }
    disposition = "claims_listed"
    claims = [claim]
    if case == "unknown":
        claim["source_effect_id"] = "turn-effect-v1:unknown"
    elif case == "wrong_kind":
        claim["claim_kind"] = "item"
    elif case == "wrong_pc":
        claim["subject_ref"] = "pc:not-in-party"
    elif case == "excerpt":
        claim["exact_excerpt"] = "这段文字不在草稿里"
    elif case == "disposition":
        disposition = "no_player_state_change_claimed"
    elif case == "duplicate":
        claims.append({**claim})
    state_review = {
        "disposition": disposition,
        "reason": "逐项审查当前调查员状态声明。",
        "claims": claims,
    }
    if case == "closed_schema":
        state_review = {}
    review = _agency_review(
        campaign_ws,
        context,
        draft=draft,
        revision=1,
        decision_id=f"review-claim-validation-{case}",
        state_authority_review=state_review,
    )
    assert review["ok"] is False
    assert review["error"]["code"] == expected_code
    assert _read_jsonl(
        campaign_ws["campaign_dir"] / "logs" / "narration-reviews.jsonl"
    ) == []


def test_pi_state_authority_review_is_idempotency_bound(campaign_ws, monkeypatch):
    monkeypatch.setenv("COC_PI_SESSION_ROLE", "play")
    context = _open_agency_turn(
        campaign_ws,
        player_text="我留在原地。",
        decision_id="journal-state-review-idempotency",
    )
    draft = "诺特仍坐在桌后。"
    first = _agency_review(
        campaign_ws,
        context,
        draft=draft,
        revision=1,
        decision_id="review-state-idempotency",
    )
    assert first["ok"] is True, first
    conflict = _agency_review(
        campaign_ws,
        context,
        draft=draft,
        revision=1,
        decision_id="review-state-idempotency",
        state_authority_review={
            "disposition": "no_player_state_change_claimed",
            "reason": "同一 decision id 下改动了语义审查理由。",
            "claims": [],
        },
    )
    assert conflict["ok"] is False
    assert conflict["error"]["code"] == "idempotency_conflict"


@pytest.mark.parametrize(
    ("field", "stale_value"),
    [
        ("settlement_snapshot_id", "turn-settlement-v1:stale"),
        ("mechanics_bundle_sha256", "sha256:stale-mechanics"),
        ("draft_sha256", "sha256:stale-draft"),
    ],
)
def test_pi_state_claim_compiler_rejects_stale_binding_identity(
    campaign_ws, monkeypatch, field, stale_value
):
    monkeypatch.setenv("COC_PI_SESSION_ROLE", "play")
    context = _open_agency_turn(
        campaign_ws,
        player_text="我继续听。",
        decision_id=f"journal-compiler-stale-{field}",
    )
    review = _agency_review(
        campaign_ws,
        context,
        draft="诺特仍坐在桌后。",
        revision=1,
        decision_id=f"review-compiler-stale-{field}",
        compiler_receipt_mutator=lambda receipt: receipt["binding"].__setitem__(
            field, stale_value
        ),
    )
    assert review["ok"] is False
    assert review["error"]["code"] == "state_claim_compiler_stale"
    assert _read_jsonl(
        campaign_ws["campaign_dir"] / "logs" / "narration-reviews.jsonl"
    ) == []


def test_pi_state_claim_compiler_rejects_malformed_model_identity(
    campaign_ws, monkeypatch
):
    monkeypatch.setenv("COC_PI_SESSION_ROLE", "play")
    context = _open_agency_turn(
        campaign_ws,
        player_text="我继续听。",
        decision_id="journal-compiler-model-invalid",
    )
    review = _agency_review(
        campaign_ws,
        context,
        draft="诺特仍坐在桌后。",
        revision=1,
        decision_id="review-compiler-model-invalid",
        compiler_receipt_mutator=lambda receipt: receipt["response_model"].update(
            {"id": ""}
        ),
    )
    assert review["ok"] is False
    assert review["error"]["code"] == "state_claim_compiler_malformed"
    assert _read_jsonl(
        campaign_ws["campaign_dir"] / "logs" / "narration-reviews.jsonl"
    ) == []


def test_pi_state_claim_compiler_rejects_duplicate_compiler_identity(
    campaign_ws, monkeypatch
):
    monkeypatch.setenv("COC_PI_SESSION_ROLE", "play")
    investigator = campaign_ws["investigator_id"]
    context = _open_agency_turn(
        campaign_ws,
        player_text="我接过钥匙。",
        decision_id="journal-compiler-duplicate-identity",
    )
    draft = "诺特把黄铜钥匙交到你手中。"
    compiled = {
        "claim_id": "compiled-duplicate-key",
        "subject_ref": f"pc:{investigator}",
        "claim_kind": "item",
        "exact_excerpt": "黄铜钥匙交到你手中",
        "source_effect_id": "not-authoritative-to-the-compiler",
        "reason": "草稿声称调查员取得钥匙。",
    }
    review = _agency_review(
        campaign_ws,
        context,
        draft=draft,
        revision=1,
        decision_id="review-compiler-duplicate-identity",
        compiled_claims=[compiled, dict(compiled)],
    )
    assert review["ok"] is False
    assert review["error"]["code"] == "state_claim_compiler_malformed"
    assert _read_jsonl(
        campaign_ws["campaign_dir"] / "logs" / "narration-reviews.jsonl"
    ) == []


def test_pi_state_claim_compiler_rejects_duplicate_kp_match(
    campaign_ws, monkeypatch
):
    monkeypatch.setenv("COC_PI_SESSION_ROLE", "play")
    investigator = campaign_ws["investigator_id"]
    granted = _run(campaign_ws, "state.item_grant", {
        "investigator": investigator,
        "kind": "gear",
        "label": "黄铜钥匙",
        "item_id": "compiler-duplicate-match-key",
        "note": "duplicate match fixture",
        "decision_id": "grant-compiler-duplicate-match-key",
    })
    assert granted["ok"] is True, granted
    context = _open_agency_turn(
        campaign_ws,
        player_text="我接过钥匙。",
        decision_id="journal-compiler-duplicate-match",
    )
    effect = next(
        row for row in context["mechanics_bundle"]["state_delta"]
        if row.get("item_id") == "compiler-duplicate-match-key"
    )
    draft = "诺特把黄铜钥匙交到你手中；这把钥匙现在归你保管。"
    kp_claim = {
        "claim_id": "claim-compiler-duplicate-match-key",
        "subject_ref": f"pc:{investigator}",
        "claim_kind": "item",
        "exact_excerpt": "黄铜钥匙交到你手中",
        "source_effect_id": effect["effect_id"],
        "reason": "草稿声称调查员取得钥匙。",
    }
    compiled_claims = [
        dict(kp_claim),
        {
            **kp_claim,
            "claim_id": "compiled-same-key-second-mention",
            "exact_excerpt": "这把钥匙现在归你保管",
        },
    ]
    review = _agency_review(
        campaign_ws,
        context,
        draft=draft,
        revision=1,
        decision_id="review-compiler-duplicate-match",
        state_authority_review={
            "disposition": "claims_listed",
            "reason": "KP 声明一个权威钥匙变化。",
            "claims": [kp_claim],
        },
        compiled_claims=compiled_claims,
    )
    assert review["ok"] is False
    assert review["error"]["code"] == "state_claim_compiler_malformed"
    assert _read_jsonl(
        campaign_ws["campaign_dir"] / "logs" / "narration-reviews.jsonl"
    ) == []


def test_pi_state_claim_compiler_allows_extra_grounded_kp_claims(
    campaign_ws, monkeypatch
):
    monkeypatch.setenv("COC_PI_SESSION_ROLE", "play")
    investigator = campaign_ws["investigator_id"]
    for suffix, label in (("key", "黄铜钥匙"), ("note", "地址便签")):
        granted = _run(campaign_ws, "state.item_grant", {
            "investigator": investigator,
            "kind": "gear",
            "label": label,
            "item_id": f"compiler-uncovered-{suffix}",
            "note": "uncovered KP claim fixture",
            "decision_id": f"grant-compiler-uncovered-{suffix}",
        })
        assert granted["ok"] is True, granted
    context = _open_agency_turn(
        campaign_ws,
        player_text="我接过钥匙和便签。",
        decision_id="journal-compiler-uncovered-kp-claim",
    )
    effects = {
        row["item_id"]: row
        for row in context["mechanics_bundle"]["state_delta"]
        if row.get("item_id", "").startswith("compiler-uncovered-")
    }
    draft = "诺特把黄铜钥匙和地址便签交到你手中。"
    claims = [
        {
            "claim_id": f"claim-compiler-uncovered-{suffix}",
            "subject_ref": f"pc:{investigator}",
            "claim_kind": "item",
            "exact_excerpt": excerpt,
            "source_effect_id": effects[f"compiler-uncovered-{suffix}"]["effect_id"],
            "reason": f"草稿声称调查员取得{label}。",
        }
        for suffix, label, excerpt in (
            ("key", "钥匙", "黄铜钥匙"),
            ("note", "便签", "地址便签"),
        )
    ]
    review = _agency_review(
        campaign_ws,
        context,
        draft=draft,
        revision=1,
        decision_id="review-compiler-uncovered-kp-claim",
        state_authority_review={
            "disposition": "claims_listed",
            "reason": "KP 声明两个权威物品变化。",
            "claims": claims,
        },
        compiled_claims=[claims[0]],
    )
    assert review["ok"] is True, review
    assert review["data"]["state_authority_gate"] == "clear"
    assert review["data"]["state_claim_review_disagreement"] is False
    finalized = _finalize_agency_turn(
        campaign_ws,
        draft=draft,
        revision=1,
        review_id=review["data"]["review_id"],
        decision_id="finalize-compiler-extra-grounded-kp",
        mechanics_placements=None,
    )
    assert finalized["ok"] is True, finalized


@pytest.mark.parametrize("bound", ["result_reason", "claim_reason", "claims"])
def test_pi_state_claim_compiler_enforces_local_result_bounds(
    campaign_ws, monkeypatch, bound
):
    monkeypatch.setenv("COC_PI_SESSION_ROLE", "play")
    investigator = campaign_ws["investigator_id"]
    draft = " ".join(f"状态声明{index}" for index in range(65))
    context = _open_agency_turn(
        campaign_ws,
        player_text="我继续听。",
        decision_id=f"journal-compiler-bound-{bound}",
    )
    compiled_claims = []
    mutator = None
    if bound == "result_reason":
        mutator = lambda receipt: receipt["result"].__setitem__("reason", "x" * 601)
    elif bound == "claim_reason":
        compiled_claims = [{
            "claim_id": "compiled-long-reason",
            "subject_ref": f"pc:{investigator}",
            "claim_kind": "item",
            "exact_excerpt": "状态声明0",
            "source_effect_id": "compiler-does-not-bind-effects",
            "reason": "x" * 601,
        }]
    else:
        compiled_claims = [
            {
                "claim_id": f"compiled-bound-{index}",
                "subject_ref": f"pc:{investigator}",
                "claim_kind": "item",
                "exact_excerpt": f"状态声明{index}",
                "source_effect_id": f"compiler-effect-{index}",
                "reason": "独立编译器识别到玩家状态声明。",
            }
            for index in range(65)
        ]
    review = _agency_review(
        campaign_ws,
        context,
        draft=draft,
        revision=1,
        decision_id=f"review-compiler-bound-{bound}",
        compiled_claims=compiled_claims,
        compiler_receipt_mutator=mutator,
    )
    assert review["ok"] is False
    assert review["error"]["code"] == "state_claim_compiler_malformed"
    assert _read_jsonl(
        campaign_ws["campaign_dir"] / "logs" / "narration-reviews.jsonl"
    ) == []


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
    assert context["agency_review_operation"]["invoke_via"] == "coc_narration_review"
    assert context["agency_review_operation"]["prefilled_arguments"]["revision"] == 1
    assert "state_authority_review" in context["agency_review_operation"][
        "missing_arguments"
    ]
    assert context["agency_review_operation"]["hard_gate_scope"] == (
        "agency_and_player_state_authority_only"
    )
    assert {"narration_review_id", "agency_claims"} <= set(
        context["finalize_operation"]["missing_arguments"]
    )
    assert context["finalize_operation"]["invoke_via"] == "coc_turn_finalize"
    projected = coc_mcp_wire.project_envelope(
        "turn.output_context",
        {"ok": True, "tool": "turn.output_context", "data": context},
        contract_digest="sha256:agency-review-contract",
    )["data"]
    assert projected["agency_review_operation"]["operation"] == "narration.review"
    assert projected["agency_review_operation"]["invoke_via"] == "coc_narration_review"
    assert projected["agency_review_operation"]["prefilled_arguments"] == {
        "turn_id": context["turn_id"],
        "source_digest": context["source_digest"],
        "revision": 1,
    }
    assert "state_authority_review" in projected["agency_review_operation"][
        "missing_arguments"
    ]
    assert {"narration_review_id", "agency_claims"} <= set(
        projected["finalize_operation"]["missing_arguments"]
    )
    assert projected["finalize_operation"]["invoke_via"] == "coc_turn_finalize"
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


def test_pi_agency_and_state_rejection_share_one_frozen_revision_two(
    campaign_ws, monkeypatch
):
    monkeypatch.setenv("COC_PI_SESSION_ROLE", "play")
    context = _open_agency_turn(
        campaign_ws,
        player_text="我继续观察，但不接受任何东西。",
        decision_id="journal-combined-authority-block",
    )
    draft = "海斯决定相信诺特。诺特把钥匙交到他手里。"
    review = _agency_review(
        campaign_ws,
        context,
        draft=draft,
        revision=1,
        decision_id="review-combined-authority-block",
        findings=[{
            "rule_id": "agency_violation",
            "subject_ref": f"pc:{campaign_ws['investigator_id']}",
            "source_ref": None,
            "reason": "草稿替玩家决定调查员信任诺特。",
        }],
        state_authority_review={
            "disposition": "claims_listed",
            "reason": "草稿还声称调查员取得钥匙。",
            "claims": [{
                "claim_id": "claim-combined-key",
                "subject_ref": f"pc:{campaign_ws['investigator_id']}",
                "claim_kind": "item",
                "exact_excerpt": "诺特把钥匙交到他手里",
                "source_effect_id": None,
                "reason": "未落账的钥匙交付。",
            }],
        },
    )
    assert review["ok"] is True, review
    assert review["data"]["agency_gate"] == "rewrite_required"
    assert review["data"]["state_authority_gate"] == "rewrite_required"
    blocked = _finalize_agency_turn(
        campaign_ws,
        draft=draft,
        revision=1,
        review_id=review["data"]["review_id"],
        decision_id="finalize-combined-authority-block",
    )
    assert blocked["ok"] is False
    assert blocked["error"]["code"] == "state_authority_review_blocked"
    rewrite = _run(campaign_ws, "turn.output_context")
    assert rewrite["ok"] is True, rewrite
    assert rewrite["data"]["agency_review_operation"]["prefilled_arguments"][
        "revision"
    ] == 2
    assert rewrite["data"]["settlement_snapshot_id"] == context[
        "settlement_snapshot_id"
    ]
    clean_draft = "诺特仍坐在桌后，钥匙和钱都没有离开他的口袋。"
    clean = _agency_review(
        campaign_ws,
        rewrite["data"],
        draft=clean_draft,
        revision=2,
        decision_id="review-combined-authority-clean-r2",
    )
    assert clean["ok"] is True, clean
    accepted = _finalize_agency_turn(
        campaign_ws,
        draft=clean_draft,
        revision=2,
        review_id=clean["data"]["review_id"],
        decision_id="finalize-combined-authority-clean-r2",
    )
    assert accepted["ok"] is True, accepted
    assert accepted["data"]["accepted_revision"] == 2


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


def test_output_context_lists_finalize_injections_before_drafting(
    campaign_ws, monkeypatch
):
    monkeypatch.setenv("COC_PI_SESSION_ROLE", "play")
    investigator = campaign_ws["investigator_id"]
    granted = _run(campaign_ws, "state.item_grant", {
        "investigator": investigator,
        "kind": "gear",
        "label": "黄铜钥匙",
        "item_id": "corbitt-house-key",
        "note": "托马斯·诺特交付的科比特宅钥匙",
        "decision_id": "grant-drafting-brief-key",
    })
    assert granted["ok"] is True, granted
    opened = _run(
        campaign_ws,
        "state.journal",
        {
            "summary": "调查员接过钥匙。",
            "player_action": "我接过钥匙。",
            "player_text": "我接过钥匙。",
            "run_id": "pi-agency-review-run",
            "decision_id": "journal-drafting-brief",
        },
    )
    assert opened["ok"] is True, opened
    context = _run(campaign_ws, "turn.output_context")
    assert context["ok"] is True, context
    data = context["data"]
    item = next(
        row
        for row in data["mechanics_bundle"]["state_delta"]
        if row["effect_kind"] == "item" and row["item_id"] == "corbitt-house-key"
    )
    brief = data["drafting_injection_brief"]
    assert brief["contract_id"] == "coc.drafting-injection-brief.v1"
    injection = next(
        row for row in brief["injections"] if row["effect_id"] == item["effect_id"]
    )
    assert injection["effect_kind"] == "item"
    assert injection["label"] == "黄铜钥匙"
    assert injection["action"] == "acquired"
    assert "effect_id" in brief["drafting_rule"]
    assert any(
        "drafting_injection_brief" in hint for hint in context.get("hints") or []
    )


def test_clear_review_replays_same_draft_without_recompile(
    campaign_ws, monkeypatch
):
    monkeypatch.setenv("COC_PI_SESSION_ROLE", "play")
    context = _open_agency_turn(
        campaign_ws,
        player_text="我留在原地。",
        decision_id="journal-clear-replay",
    )
    draft = "诺特仍坐在桌后，没有把任何东西交到你手里。"
    first = _agency_review(
        campaign_ws,
        context,
        draft=draft,
        revision=1,
        decision_id="review-clear-replay-first",
    )
    assert first["ok"] is True, first
    assert first["data"]["agency_gate"] == "clear"
    assert first["data"]["state_authority_gate"] == "clear"
    replay = _agency_review(
        campaign_ws,
        context,
        draft=draft,
        revision=1,
        decision_id="review-clear-replay-second",
        compiler_receipt_mutator=lambda receipt: receipt.__setitem__(
            "status", "broken-must-be-ignored"
        ),
    )
    assert replay["ok"] is True, replay
    assert replay["data"]["review_id"] == first["data"]["review_id"]
    assert replay["data"]["review_digest"] == first["data"]["review_digest"]
    assert any("replay" in hint.lower() for hint in replay.get("hints") or [])
    rows = _read_jsonl(
        campaign_ws["campaign_dir"] / "logs" / "narration-reviews.jsonl"
    )
    assert [row["review_id"] for row in rows] == [first["data"]["review_id"]]
    finalized = _finalize_agency_turn(
        campaign_ws,
        draft=draft,
        revision=1,
        review_id=replay["data"]["review_id"],
        decision_id="finalize-clear-replay",
    )
    assert finalized["ok"] is True, finalized


def test_changed_kp_review_does_not_replay_clear_draft(
    campaign_ws, monkeypatch
):
    monkeypatch.setenv("COC_PI_SESSION_ROLE", "play")
    context = _open_agency_turn(
        campaign_ws,
        player_text="我留在原地。",
        decision_id="journal-no-replay-reason",
    )
    draft = "诺特仍坐在桌后，没有把任何东西交到你手里。"
    first = _agency_review(
        campaign_ws,
        context,
        draft=draft,
        revision=1,
        decision_id="review-no-replay-first",
        state_authority_review={
            "disposition": "no_player_state_change_claimed",
            "reason": "草稿没有声称当前调查员的权威状态发生变化。",
            "claims": [],
        },
    )
    assert first["ok"] is True, first
    assert first["data"]["state_authority_gate"] == "clear"
    changed = _agency_review(
        campaign_ws,
        context,
        draft=draft,
        revision=1,
        decision_id="review-no-replay-second",
        state_authority_review={
            "disposition": "no_player_state_change_claimed",
            "reason": "KP 改写了审查理由，因此不能复用上一份 clear 回执。",
            "claims": [],
        },
        compiler_receipt_mutator=lambda receipt: receipt.__setitem__(
            "status", "broken-must-not-replay"
        ),
    )
    assert changed["ok"] is False
    assert changed["error"]["code"] == "state_claim_compiler_malformed"
    rows = _read_jsonl(
        campaign_ws["campaign_dir"] / "logs" / "narration-reviews.jsonl"
    )
    assert [row["review_id"] for row in rows] == [first["data"]["review_id"]]


def test_rewrite_required_returns_excerpt_only_span_repairs(
    campaign_ws, monkeypatch
):
    monkeypatch.setenv("COC_PI_SESSION_ROLE", "play")
    context = _open_agency_turn(
        campaign_ws,
        player_text="我接受委托。请把预付定金、钥匙和地址便签现在交给我。",
        decision_id="journal-span-repairs",
    )
    draft = (
        "诺特把那串黄铜钥匙推过桌面。"
        "预付的钞票压到你手边，写着科比特宅地址的便签也一并交给了你。"
    )
    excerpts = [
        "预付的钞票压到你手边",
        "诺特把那串黄铜钥匙推过桌面",
        "写着科比特宅地址的便签也一并交给了你",
    ]
    review = _agency_review(
        campaign_ws,
        context,
        draft=draft,
        revision=1,
        decision_id="review-span-repairs",
        state_authority_review={
            "disposition": "no_player_state_change_claimed",
            "reason": "桌面交付动作没有改变调查员的账本或物品栏。",
            "claims": [],
        },
        compiled_claims=[
            {
                "claim_id": "compiled-prepayment",
                "subject_ref": f"pc:{campaign_ws['investigator_id']}",
                "claim_kind": "cash",
                "exact_excerpt": excerpts[0],
                "source_effect_id": None,
                "reason": "NPC 将预付款交给调查员。",
            },
            {
                "claim_id": "compiled-brass-key",
                "subject_ref": f"pc:{campaign_ws['investigator_id']}",
                "claim_kind": "item",
                "exact_excerpt": excerpts[1],
                "source_effect_id": None,
                "reason": "NPC 将钥匙交给调查员。",
            },
            {
                "claim_id": "compiled-address-note",
                "subject_ref": f"pc:{campaign_ws['investigator_id']}",
                "claim_kind": "item",
                "exact_excerpt": excerpts[2],
                "source_effect_id": None,
                "reason": "NPC 将写有委托地址的信息卡交给调查员。",
            },
        ],
    )
    assert review["ok"] is True, review
    assert review["data"]["state_authority_gate"] == "rewrite_required"
    repairs = review["data"]["span_repairs"]
    assert repairs["contract_id"] == "coc.span-repairs.v1"
    assert repairs["mode"] == "excerpt_only"
    assert {row["exact_excerpt"] for row in repairs["spans"]} == set(excerpts)
    assert all(row["repair"] == "rephrase_or_remove" for row in repairs["spans"])
    assert "byte-stable" in repairs["instruction"]
    assert any(
        "span" in hint.lower() or "excerpt" in hint.lower()
        for hint in review.get("hints") or []
    )
    resume = _run(campaign_ws, "turn.output_context")
    assert resume["ok"] is True, resume
    operation = resume["data"]["agency_review_operation"]
    assert operation["prefilled_arguments"]["revision"] == 2
    assert operation["span_repairs"]["spans"] == repairs["spans"]


def test_pending_draft_receipt_is_exact_idempotent_and_keeper_only(
    campaign_ws, monkeypatch
):
    monkeypatch.setenv("COC_PI_SESSION_ROLE", "play")
    context = _open_agency_turn(
        campaign_ws,
        player_text="我继续观察门缝。",
        decision_id="journal-pending-draft-exact",
    )
    draft = "门缝后的灯影停住了，雨声仍贴着玻璃滑落。"
    kwargs = {
        "draft": draft,
        "revision": 1,
        "decision_id": "review-pending-draft-exact",
        "state_authority_review": {
            "disposition": "no_player_state_change_claimed",
            "reason": "草稿没有宣告玩家状态变化。",
            "claims": [],
        },
        "compiled_claims": [],
    }
    first = _agency_review(campaign_ws, context, **kwargs)
    assert first["ok"] is True, first
    second = _agency_review(campaign_ws, context, **kwargs)
    assert second["ok"] is True, second
    receipts = _read_jsonl(
        campaign_ws["campaign_dir"] / "logs" / "pending-narration-drafts.jsonl"
    )
    assert len(receipts) == 1
    receipt = receipts[0]
    assert receipt["schema_version"] == 1
    assert receipt["kind"] == "pending_narration_draft"
    assert receipt["secrecy"] == "keeper_only"
    assert receipt["draft_text"] == draft
    assert receipt["draft_sha256"] == _digest(draft)
    assert receipt["review_id"] == first["data"]["review_id"]
    refreshed = _run(campaign_ws, "turn.output_context")
    assert refreshed["ok"] is True, refreshed
    assert refreshed["data"]["frozen_narration_draft"]["draft_text"] == draft
    assert refreshed["data"]["pending_narration_draft_status"] == {
        "schema_version": 1,
        "secrecy": "keeper_only",
        "status": "available",
        "actionable": True,
    }
    transcript = json.dumps(
        _read_jsonl(campaign_ws["campaign_dir"] / "logs" / "table-transcript.jsonl"),
        ensure_ascii=False,
    )
    assert draft not in transcript


def test_explicit_pending_draft_recovery_uses_only_structured_review_audit(
    campaign_ws, monkeypatch
):
    monkeypatch.setenv("COC_PI_SESSION_ROLE", "play")
    context = _open_agency_turn(
        campaign_ws,
        player_text="我留在门边。",
        decision_id="journal-pending-draft-recovery",
    )
    draft = "灯影从门缝后退开半步，旧木板发出一声轻响。"
    review = _agency_review(
        campaign_ws,
        context,
        draft=draft,
        revision=1,
        decision_id="review-pending-draft-recovery",
        state_authority_review={
            "disposition": "no_player_state_change_claimed",
            "reason": "草稿没有宣告玩家状态变化。",
            "claims": [],
        },
        compiled_claims=[],
    )
    assert review["ok"] is True, review
    receipt_path = (
        campaign_ws["campaign_dir"] / "logs" / "pending-narration-drafts.jsonl"
    )
    receipt_path.unlink()
    audit_path = campaign_ws["campaign_dir"] / "logs" / "toolbox-calls.jsonl"
    audit_rows = _read_jsonl(audit_path)
    review_rows = [
        row for row in audit_rows
        if row.get("tool") == "narration.review"
        and (row.get("args") or {}).get("decision_id")
        == "review-pending-draft-recovery"
    ]
    assert len(review_rows) == 1
    with audit_path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(review_rows[0], ensure_ascii=False) + "\n")
    blocked = _run(campaign_ws, "turn.output_context")
    assert blocked["ok"] is True, blocked
    assert "frozen_narration_draft" not in blocked["data"]
    assert "agency_review_operation" not in blocked["data"]
    assert "finalize_operation" not in blocked["data"]
    assert blocked["data"]["pending_narration_draft_status"]["status"] == "missing"
    recovered = _run(
        campaign_ws,
        "state.recover_pending_narration_draft",
        {
            "decision_id": "recover-pending-draft:review-recovery:1",
            "review_decision_id": "review-pending-draft-recovery",
        },
    )
    assert recovered["ok"] is True, recovered
    assert recovered["data"]["draft_text"] == draft
    assert recovered["data"]["producer_kind"] == "toolbox_audit_recovery"
    provenance = recovered["data"]["provenance"]
    assert set(provenance) == {
        "kind", "source_path", "source_row_count",
        "primary_row_digest", "corroboration_digest",
    }
    assert provenance["kind"] == "verified_toolbox_audit_recovery"
    assert provenance["source_path"] == "logs/toolbox-calls.jsonl"
    assert provenance["source_row_count"] == 2  # the retry row coalesces
    assert provenance["primary_row_digest"].startswith("sha256:")
    assert provenance["corroboration_digest"].startswith("sha256:")
    replay = _run(
        campaign_ws,
        "state.recover_pending_narration_draft",
        {
            "decision_id": "recover-pending-draft:review-recovery:1",
            "review_decision_id": "review-pending-draft-recovery",
        },
    )
    assert replay["ok"] is True, replay
    assert replay["data"] == recovered["data"]
    assert len(_read_jsonl(receipt_path)) == 1
    refreshed = _run(campaign_ws, "turn.output_context")
    assert refreshed["data"]["frozen_narration_draft"]["draft_text"] == draft


def test_pending_draft_recovery_rejects_missing_finalize_only_and_oversize(
    campaign_ws, monkeypatch
):
    monkeypatch.setenv("COC_PI_SESSION_ROLE", "play")
    context = _open_agency_turn(
        campaign_ws,
        player_text="我再等一会。",
        decision_id="journal-pending-draft-reject",
    )
    review = _agency_review(
        campaign_ws,
        context,
        draft="门后无人应声。",
        revision=1,
        decision_id="review-pending-draft-reject",
        state_authority_review={
            "disposition": "no_player_state_change_claimed",
            "reason": "草稿没有宣告玩家状态变化。",
            "claims": [],
        },
        compiled_claims=[],
    )
    assert review["ok"] is True, review
    (campaign_ws["campaign_dir"] / "logs" / "pending-narration-drafts.jsonl").unlink()
    audit_path = campaign_ws["campaign_dir"] / "logs" / "toolbox-calls.jsonl"
    original = _read_jsonl(audit_path)
    base_rows = [
        row for row in original
        if not (
            row.get("tool") == "narration.review"
            and (row.get("args") or {}).get("decision_id")
            == "review-pending-draft-reject"
        )
    ]
    audit_path.write_text(
        "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in base_rows),
        encoding="utf-8",
    )
    missing = _run(campaign_ws, "state.recover_pending_narration_draft", {
        "decision_id": "recover-reject:missing",
        "review_decision_id": "review-pending-draft-reject",
    })
    assert missing["error"]["code"] == "pending_draft_recovery_evidence_missing"
    finalize_only = {
        "schema_version": 2,
        "tool": "turn.finalize",
        "ok": False,
        "args": {"decision_id": "review-pending-draft-reject", "draft": "门后无人应声。"},
        "data": None,
    }
    audit_path.write_text(
        "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in [*base_rows, finalize_only]),
        encoding="utf-8",
    )
    finalize_rejected = _run(campaign_ws, "state.recover_pending_narration_draft", {
        "decision_id": "recover-reject:finalize-only",
        "review_decision_id": "review-pending-draft-reject",
    })
    assert finalize_rejected["error"]["code"] == "pending_draft_recovery_evidence_missing"
    review_row = next(row for row in original if row.get("tool") == "narration.review")
    review_row["args"]["draft_text"] = "界" * 8193
    audit_path.write_text(
        "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in [*base_rows, review_row]),
        encoding="utf-8",
    )
    oversize = _run(campaign_ws, "state.recover_pending_narration_draft", {
        "decision_id": "recover-reject:oversize",
        "review_decision_id": "review-pending-draft-reject",
    })
    assert oversize["error"]["code"] == "pending_draft_recovery_evidence_mismatch"


def _pending_draft_negative_setup(campaign_ws, monkeypatch, *, review_decision_id):
    """Open a play turn, submit one clear revision-1 review, return helpers."""
    monkeypatch.setenv("COC_PI_SESSION_ROLE", "play")
    context = _open_agency_turn(
        campaign_ws,
        player_text="我在门边听着。",
        decision_id=f"journal-{review_decision_id}",
    )
    review = _agency_review(
        campaign_ws,
        context,
        draft="门外的脚步声停了。",
        revision=1,
        decision_id=review_decision_id,
        state_authority_review={
            "disposition": "no_player_state_change_claimed",
            "reason": "草稿没有宣告玩家状态变化。",
            "claims": [],
        },
        compiled_claims=[],
    )
    assert review["ok"] is True, review
    return context, review


def _receipt_path(campaign_ws) -> Path:
    return campaign_ws["campaign_dir"] / "logs" / "pending-narration-drafts.jsonl"


def _rewrite_receipt(campaign_ws, mutate) -> dict:
    """Rewrite the single stored receipt through a mutation; return it."""
    path = _receipt_path(campaign_ws)
    rows = _read_jsonl(path)
    assert len(rows) == 1
    mutate(rows[0])
    path.write_text(
        json.dumps(rows[0], ensure_ascii=False) + "\n", encoding="utf-8"
    )
    return rows[0]


def test_pending_draft_materializer_rejects_divergent_and_identity_mismatch(
    campaign_ws, monkeypatch
):
    _context, _review = _pending_draft_negative_setup(
        campaign_ws, monkeypatch, review_decision_id="review-neg-divergent"
    )
    _receipt_path(campaign_ws).unlink()
    audit_path = campaign_ws["campaign_dir"] / "logs" / "toolbox-calls.jsonl"
    rows = _read_jsonl(audit_path)
    base = [
        row for row in rows
        if not (
            row.get("tool") == "narration.review"
            and (row.get("args") or {}).get("decision_id")
            == "review-neg-divergent"
        )
    ]
    review_rows = [
        row for row in rows
        if row.get("tool") == "narration.review"
        and (row.get("args") or {}).get("decision_id") == "review-neg-divergent"
    ]
    assert len(review_rows) == 1

    def write(rows_override):
        audit_path.write_text(
            "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows_override),
            encoding="utf-8",
        )

    # Distinct draft values under the same review identity reject: the
    # forged draft breaks the request/draft identity binding, so the
    # evidence row is rejected fail-closed (identity-bound divergence).
    divergent = json.loads(json.dumps(review_rows[0], ensure_ascii=False))
    divergent["args"]["draft_text"] = "另一份完全不同的草稿。"
    write([*base, review_rows[0], divergent])
    distinct = _run(campaign_ws, "state.recover_pending_narration_draft", {
        "decision_id": "recover-neg:divergent",
        "review_decision_id": "review-neg-divergent",
    })
    assert distinct["ok"] is False
    assert distinct["error"]["code"] in {
        "pending_draft_recovery_evidence_mismatch",
        "pending_draft_recovery_evidence_ambiguous",
    }

    # Nine byte-identical retry rows (distinct ts, identical content
    # identity) exceed the bounded corroboration count and reject.
    inflated = []
    for index in range(9):
        row = json.loads(json.dumps(review_rows[0], ensure_ascii=False))
        row["ts"] = f"2026-08-28T00:00:{index:02d}Z"
        inflated.append(row)
    write([*base, *inflated])
    bounded = _run(campaign_ws, "state.recover_pending_narration_draft", {
        "decision_id": "recover-neg:inflated",
        "review_decision_id": "review-neg-divergent",
    })
    assert bounded["error"]["code"] == "pending_draft_recovery_evidence_ambiguous"

    # Full-identity mismatch (wrong turn binding in the audit row) rejects.
    wrong_identity = json.loads(json.dumps(review_rows[0], ensure_ascii=False))
    wrong_identity["args"]["turn_id"] = "turn-v1-forged"
    write([*base, wrong_identity])
    mismatch = _run(campaign_ws, "state.recover_pending_narration_draft", {
        "decision_id": "recover-neg:mismatch",
        "review_decision_id": "review-neg-divergent",
    })
    assert mismatch["error"]["code"] == "pending_draft_recovery_evidence_mismatch"
    assert not _receipt_path(campaign_ws).is_file()


def test_pending_draft_corrupt_receipt_fails_closed_everywhere(
    campaign_ws, monkeypatch
):
    _context, _review = _pending_draft_negative_setup(
        campaign_ws, monkeypatch, review_decision_id="review-neg-corrupt"
    )
    # Tampered receipt_digest: canonical validation fails, output_context
    # degrades to an explicit non-actionable card-free status, and the
    # materializer refuses to adopt the corrupt row.
    _rewrite_receipt(
        campaign_ws,
        lambda row: row.__setitem__("receipt_digest", "sha256:" + "0" * 64),
    )
    blocked = _run(campaign_ws, "turn.output_context")
    assert blocked["ok"] is True, blocked
    assert "frozen_narration_draft" not in blocked["data"]
    assert "agency_review_operation" not in blocked["data"]
    assert "finalize_operation" not in blocked["data"]
    status = blocked["data"]["pending_narration_draft_status"]
    assert status["status"] == "invalid"
    assert status["actionable"] is False
    corrupt_adopt = _run(campaign_ws, "state.recover_pending_narration_draft", {
        "decision_id": "recover-neg:corrupt",
        "review_decision_id": "review-neg-corrupt",
    })
    assert corrupt_adopt["error"]["code"] == "pending_draft_corrupt"


def test_pending_draft_corrupt_provenance_fails_closed(campaign_ws, monkeypatch):
    # Corrupt provenance (unexpected extra field) invalidates the receipt
    # the same way — closed provenance is part of the canonical schema.
    _pending_draft_negative_setup(
        campaign_ws, monkeypatch, review_decision_id="review-neg-provenance"
    )
    _rewrite_receipt(
        campaign_ws,
        lambda row: row["provenance"].__setitem__("extra_field", "unbounded"),
    )
    blocked_provenance = _run(campaign_ws, "turn.output_context")
    assert blocked_provenance["ok"] is True, blocked_provenance
    assert "frozen_narration_draft" not in blocked_provenance["data"]
    assert (
        blocked_provenance["data"]["pending_narration_draft_status"]["actionable"]
        is False
    )
    assert (
        blocked_provenance["data"]["pending_narration_draft_status"]["status"]
        == "invalid"
    )


def test_pending_draft_non_string_identity_fails_closed(campaign_ws, monkeypatch):
    """A truthy non-string semantic identity is rejected even with the
    integrity digest recomputed around it: the field type itself is the
    single isolated defect."""
    _pending_draft_negative_setup(
        campaign_ws, monkeypatch, review_decision_id="review-neg-nonstring"
    )

    def corrupt(row):
        row["campaign_id"] = ["narration-budget-test"]
        row.pop("receipt_digest")
        row["receipt_digest"] = _digest({
            key: value for key, value in row.items()
            if key != "ts"
        })

    _rewrite_receipt(campaign_ws, corrupt)
    blocked = _run(campaign_ws, "turn.output_context")
    assert blocked["ok"] is True, blocked
    assert "frozen_narration_draft" not in blocked["data"]
    status = blocked["data"]["pending_narration_draft_status"]
    assert status["status"] == "invalid"
    assert status["actionable"] is False


def test_pending_draft_materialization_identity_fails_closed(campaign_ws, monkeypatch):
    """A submission receipt whose materialization decision diverges from the
    review decision is not accepted even with a recomputed digest."""
    _pending_draft_negative_setup(
        campaign_ws, monkeypatch, review_decision_id="review-neg-materialization"
    )

    def corrupt(row):
        assert row["producer_kind"] == "narration_review_submission"
        row["materialization_decision_id"] = "recover-other:divergent:1"
        row.pop("receipt_digest")
        row["receipt_digest"] = _digest({
            key: value for key, value in row.items()
            if key != "ts"
        })

    _rewrite_receipt(campaign_ws, corrupt)
    blocked = _run(campaign_ws, "turn.output_context")
    assert blocked["ok"] is True, blocked
    assert "frozen_narration_draft" not in blocked["data"]
    status = blocked["data"]["pending_narration_draft_status"]
    assert status["status"] == "invalid"
    assert status["actionable"] is False


def _valid_unit_receipt(
    *,
    draft_text: str = "门外的脚步声停了。",
    producer_kind: str = "narration_review_submission",
    materialization_decision_id: str = "review-unit-receipt",
) -> dict:
    """A fully valid receipt per the canonical closed schema, with every
    digest computed — the base for one-defect negative mutations."""
    receipt = {
        "schema_version": 1,
        "kind": coc_turn_output._PENDING_DRAFT_KIND,
        "secrecy": "keeper_only",
        "campaign_id": "narration-budget-test",
        "receipt_id": (
            "pending-narration-draft:review-unit-receipt:revision-1"
        ),
        "review_decision_id": "review-unit-receipt",
        "review_id": "narration-review-v1:unit",
        "turn_id": "turn-v1-unit",
        "source_digest": _digest("unit-source"),
        "revision": 1,
        "draft_sha256": _digest(draft_text),
        "draft_text": draft_text,
        "draft_utf8_bytes": len(draft_text.encode("utf-8")),
        "review_digest": _digest("unit-review"),
        "request_digest": _digest("unit-request"),
        "producer_kind": producer_kind,
        "source_operation": coc_turn_output._PENDING_DRAFT_SOURCE_OPERATION,
        "materialization_decision_id": materialization_decision_id,
        "provenance": {"kind": "direct_review_submission"},
    }
    if producer_kind == "toolbox_audit_recovery":
        receipt["provenance"] = {
            "kind": "verified_toolbox_audit_recovery",
            "source_path": "logs/toolbox-calls.jsonl",
            "source_row_count": 1,
            "primary_row_digest": _digest("row-1"),
            "corroboration_digest": _digest([_digest("row-1")]),
        }
    receipt["receipt_digest"] = _digest(receipt)
    return receipt


def _mutated_receipt(mutate) -> dict:
    """One-defect receipt: start valid, apply the mutation, recompute the
    integrity digest so the only failure is the mutated field itself."""
    receipt = _valid_unit_receipt()
    mutate(receipt)
    receipt.pop("receipt_digest", None)
    receipt["receipt_digest"] = _digest(receipt)
    return receipt


@pytest.mark.parametrize(
    "field, bad_value",
    [
        ("campaign_id", 12345),
        ("campaign_id", ["narration-budget-test"]),
        ("campaign_id", True),
        ("campaign_id", {"id": "narration-budget-test"}),
        ("review_decision_id", 7),
        ("review_decision_id", ["review-unit-receipt"]),
        ("review_decision_id", True),
        ("review_decision_id", {"id": "review-unit-receipt"}),
        ("review_id", 99),
        ("review_id", ["narration-review-v1:unit"]),
        ("review_id", True),
        ("review_id", {"id": "narration-review-v1:unit"}),
        ("turn_id", 41),
        ("turn_id", ["turn-v1-unit"]),
        ("turn_id", True),
        ("turn_id", {"id": "turn-v1-unit"}),
        ("source_digest", 12),
        ("source_digest", ["sha256"]),
        ("source_digest", True),
        ("source_digest", {"digest": "sha256"}),
        ("materialization_decision_id", 5),
        ("materialization_decision_id", ["review-unit-receipt"]),
        ("materialization_decision_id", True),
        ("materialization_decision_id", {"id": "review-unit-receipt"}),
    ],
)
def test_pending_draft_receipt_rejects_non_string_semantic_identities(
    field, bad_value
):
    """Every semantic identity field must be a non-empty string. The digest
    is recomputed around the mutation, so the type defect is isolated."""
    receipt = _mutated_receipt(
        lambda row: row.__setitem__(field, bad_value)
    )
    assert coc_turn_output._valid_pending_draft_receipt(receipt) is False


def test_pending_draft_receipt_rejects_materialization_identity_mismatch():
    # A direct submission materializes under the review's own decision id.
    submission = _mutated_receipt(
        lambda row: row.__setitem__(
            "materialization_decision_id", "recover-unit:other:1"
        )
    )
    assert submission["producer_kind"] == "narration_review_submission"
    assert coc_turn_output._valid_pending_draft_receipt(submission) is False

    # An audit recovery materializes under its own distinct decision id.
    recovered = _valid_unit_receipt(
        producer_kind="toolbox_audit_recovery",
        materialization_decision_id="recover-unit:review-unit-receipt:1",
    )
    assert coc_turn_output._valid_pending_draft_receipt(recovered) is True
    recovered_same = _mutated_receipt(
        lambda row: (
            row.__setitem__("producer_kind", "toolbox_audit_recovery"),
            row.__setitem__(
                "provenance",
                {
                    "kind": "verified_toolbox_audit_recovery",
                    "source_path": "logs/toolbox-calls.jsonl",
                    "source_row_count": 1,
                    "primary_row_digest": _digest("row-1"),
                    "corroboration_digest": _digest([_digest("row-1")]),
                },
            ),
        )[-1]
    )
    assert (
        recovered_same["materialization_decision_id"]
        == recovered_same["review_decision_id"]
    )
    assert coc_turn_output._valid_pending_draft_receipt(recovered_same) is False


def _span_repairs(spans, instruction="只改列出的片段。") -> dict:
    return {
        "schema_version": 1,
        "contract_id": coc_turn_output._SPAN_REPAIRS_CONTRACT_ID,
        "mode": coc_turn_output._SPAN_REPAIRS_MODE,
        "spans": spans,
        "instruction": instruction,
    }


def _span(excerpt, *, claim_kind="item", reason="理由。") -> dict:
    return {
        "exact_excerpt": excerpt,
        "claim_kind": claim_kind,
        "reason": reason,
        "repair": "rephrase_or_remove",
    }


SPAN_BASELINE = "诺特把黄铜钥匙推过桌面，烛火映着未寄出的信。"


@pytest.mark.parametrize(
    "repairs",
    [
        # Non-object and non-array shapes.
        "span repairs",
        ["span repairs"],
        None,
        # Missing/unknown container fields and wrong constants.
        {
            "schema_version": 1,
            "contract_id": "coc.span-repairs.v1",
            "mode": "excerpt_only",
            "spans": [_span("黄铜钥匙")],
        },
        _span_repairs([_span("黄铜钥匙")], instruction=""),
        {
            **_span_repairs([_span("黄铜钥匙")]),
            "extra": True,
        },
        {**_span_repairs([_span("黄铜钥匙")]), "mode": "full_rewrite"},
        {**_span_repairs([_span("黄铜钥匙")]), "schema_version": 2},
        # Empty span list and wrong entry shapes.
        _span_repairs([]),
        _span_repairs(["黄铜钥匙"]),
        _span_repairs([{**_span("黄铜钥匙"), "extra_field": 1}]),
        _span_repairs([{k: v for k, v in _span("黄铜钥匙").items() if k != "reason"}]),
        _span_repairs([{**_span("黄铜钥匙"), "repair": "rewrite_all"}]),
        # Wrong types, empty and oversize strings.
        _span_repairs([_span(123)]),
        _span_repairs([{**_span("黄铜钥匙"), "claim_kind": ["item"]}]),
        _span_repairs([{**_span("黄铜钥匙"), "reason": True}]),
        _span_repairs([_span("   ")]),
        _span_repairs([_span("钥" * 2049)]),
        _span_repairs([_span("黄铜钥匙", claim_kind="k" * 129)]),
        _span_repairs([_span("黄铜钥匙", reason="理" * 1025)]),
        _span_repairs([_span("黄铜钥匙")], instruction="训" * 513),
        # Duplicates and over-cap counts.
        _span_repairs([_span("黄铜钥匙"), _span("黄铜钥匙")]),
        _span_repairs(
            [
                _span(f"片段{index:02d}", claim_kind="item")
                for index in range(17)
            ]
        ),
    ],
)
def test_span_repairs_validator_rejects_non_canonical_shapes(repairs):
    """Structural layer (no baseline): exact field sets, canonical constants,
    strict non-empty bounded strings, duplicate and count caps."""
    assert coc_turn_output._valid_span_repairs(repairs, baseline_text=None) is False


def test_span_repairs_validator_requires_baseline_occurrence():
    missing = _span_repairs([_span("不在此草稿中的句子")])
    assert (
        coc_turn_output._valid_span_repairs(
            missing, baseline_text=SPAN_BASELINE
        )
        is False
    )
    present = _span_repairs([_span("黄铜钥匙")])
    assert (
        coc_turn_output._valid_span_repairs(
            present, baseline_text=SPAN_BASELINE
        )
        is True
    )


def test_span_repairs_validator_enforces_aggregate_excerpt_byte_bound():
    near_cap = "黄铜钥匙推过桌面" * 85  # 2040 UTF-8 bytes, under the 2048 cap
    two = _span_repairs([_span(near_cap), _span(near_cap, claim_kind="cash")])
    assert coc_turn_output._valid_span_repairs(two, baseline_text=None) is True
    three = _span_repairs([
        _span(near_cap),
        _span(near_cap, claim_kind="cash"),
        _span(near_cap, claim_kind="condition"),
    ])
    assert coc_turn_output._valid_span_repairs(three, baseline_text=None) is False


def test_span_repairs_validator_accepts_canonical_shape_and_bounds():
    valid = _span_repairs([
        _span("黄铜钥匙"),
        _span("烛火映着未寄出的信", claim_kind="item"),
    ])
    assert (
        coc_turn_output._valid_span_repairs(valid, baseline_text=SPAN_BASELINE)
        is True
    )
    # Without a baseline (structural-only layer) occurrence is not checked.
    assert coc_turn_output._valid_span_repairs(valid, baseline_text=None) is True
    # Same excerpt twice under distinct claim kinds stays canonical (the
    # producer dedupes on the (excerpt, kind) pair).
    distinct_kinds = _span_repairs([
        _span("黄铜钥匙", claim_kind="item"),
        _span("黄铜钥匙", claim_kind="cash"),
    ])
    assert (
        coc_turn_output._valid_span_repairs(
            distinct_kinds, baseline_text=SPAN_BASELINE
        )
        is True
    )


def test_span_repairs_producer_drops_overbound_evidence_fail_closed(
    campaign_ws, monkeypatch
):
    """Evidence beyond the deterministic span cap is not truncated or
    invented: the producer emits no span_repairs at all and the review is
    recorded without repair evidence."""
    monkeypatch.setenv("COC_PI_SESSION_ROLE", "play")
    context = _open_agency_turn(
        campaign_ws,
        player_text="我接过清单，逐项查看。",
        decision_id="journal-span-overbound",
    )
    draft = "桌上摆着" + "、".join(
        f"物品{index:02d}的清单行" for index in range(17)
    ) + "。"
    review = _agency_review(
        campaign_ws,
        context,
        draft=draft,
        revision=1,
        decision_id="review-span-overbound",
        state_authority_review={
            "disposition": "no_player_state_change_claimed",
            "reason": "草稿只罗列了桌面物件，没有宣告状态变化。",
            "claims": [],
        },
        compiled_claims=[
            {
                "claim_id": f"compiled-overbound-{index:02d}",
                "subject_ref": f"pc:{campaign_ws['investigator_id']}",
                "claim_kind": "item",
                "exact_excerpt": f"物品{index:02d}的清单行",
                "source_effect_id": None,
                "reason": f"未落账的物品{index:02d}。",
            }
            for index in range(17)
        ],
    )
    assert review["ok"] is True, review
    assert review["data"]["state_authority_gate"] == "rewrite_required"
    assert "span_repairs" not in review["data"]


def test_pending_draft_crash_order_is_recoverable_and_orphans_harmless(
    campaign_ws, monkeypatch
):
    monkeypatch.setenv("COC_PI_SESSION_ROLE", "play")
    context = _open_agency_turn(
        campaign_ws,
        player_text="我把耳朵贴在门上。",
        decision_id="journal-neg-crash",
    )
    draft = "门把手上凝着一层薄薄的霜。"
    kwargs = {
        "draft": draft,
        "revision": 1,
        "decision_id": "review-neg-crash",
        "state_authority_review": {
            "disposition": "no_player_state_change_claimed",
            "reason": "草稿没有宣告玩家状态变化。",
            "claims": [],
        },
        "compiled_claims": [],
    }
    review = _agency_review(campaign_ws, context, **kwargs)
    assert review["ok"] is True, review

    # Crash AFTER the receipt append but BEFORE the review evidence append
    # and its ledger entry (the producer writes receipt → review → ledger, so
    # the ledger cannot survive a crash that lost the review row): the
    # orphan receipt is harmless, output_context degrades to revision-1
    # drafting cards, and the retry completes the same decision idempotently.
    reviews_path = (
        campaign_ws["campaign_dir"] / "logs" / "narration-reviews.jsonl"
    )
    review_rows = _read_jsonl(reviews_path)
    reviews_path.write_text(
        "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in review_rows[:-1]),
        encoding="utf-8",
    )
    ledger_path = (
        campaign_ws["campaign_dir"] / "save" / "toolbox-ledger.json"
    )
    ledger = json.loads(ledger_path.read_text(encoding="utf-8"))
    ledger["entries"] = {
        key: value for key, value in ledger["entries"].items()
        if "review-neg-crash" not in key
    }
    ledger_path.write_text(
        json.dumps(ledger, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    orphan = _run(campaign_ws, "turn.output_context")
    assert orphan["ok"] is True, orphan
    assert "frozen_narration_draft" not in orphan["data"]
    assert orphan["data"]["pending_narration_draft_status"]["status"] == "not_submitted"
    assert orphan["data"]["pending_narration_draft_status"]["actionable"] is True
    assert orphan["data"]["agency_review_operation"]["prefilled_arguments"]["revision"] == 1
    retry = _agency_review(campaign_ws, context, **kwargs)
    assert retry["ok"] is True, retry
    assert retry["data"]["review_id"] == review["data"]["review_id"]
    assert len(_read_jsonl(_receipt_path(campaign_ws))) == 1
    assert len(_read_jsonl(reviews_path)) == len(review_rows)

    # Crash AFTER both appends but BEFORE the ledger write: the durable JSONL
    # identities make the retry an exact replay and re-record the ledger.
    ledger2 = json.loads(ledger_path.read_text(encoding="utf-8"))
    ledger2["entries"] = {
        key: value for key, value in ledger2["entries"].items()
        if "review-neg-crash" not in key
    }
    ledger_path.write_text(
        json.dumps(ledger2, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    replay = _agency_review(campaign_ws, context, **kwargs)
    assert replay["ok"] is True, replay
    assert replay["data"]["review_id"] == review["data"]["review_id"]
    assert len(_read_jsonl(_receipt_path(campaign_ws))) == 1
    assert len(_read_jsonl(reviews_path)) == len(review_rows)
