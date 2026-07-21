"""Thin vertical for public, multi-NPC first impressions."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import shutil
import sys


REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "plugins" / "coc-keeper" / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import coc_starter
import coc_toolbox
import coc_first_impression


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def _placements(bundle: dict, *, roll_after: int = 0, other_after: int = 1) -> list[dict]:
    specs = (
        ("public_check", "roll_id", roll_after),
        ("state_delta", "effect_id", other_after),
        ("exceptional_effect", "event_id", other_after),
    )
    return [
        {
            "after_paragraph": after,
            "segment_type": segment_type,
            "source_ids": [str(row[source_key]) for row in bundle.get(segment_type, [])],
        }
        for segment_type, source_key, after in specs
        if bundle.get(segment_type)
    ]


def _load_exporter():
    path = (
        REPO / "plugins" / "coc-keeper" / "skills"
        / "coc-export-battle-report" / "scripts" / "export_battle_report.py"
    )
    spec = importlib.util.spec_from_file_location("first_impression_exporter", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_legacy_first_impression_receipt_remains_readable_and_player_safe(
    tmp_path: Path,
) -> None:
    campaign_dir = tmp_path / "campaign"
    campaign_id = "legacy-first-impression"
    receipt = {
        "schema_version": 1,
        "receipt_id": coc_first_impression.receipt_id(
            campaign_id, "investigator-a", "npc-legacy"
        ),
        "campaign_id": campaign_id,
        "run_id": "legacy-run",
        "decision_id": "legacy-decision",
        "investigator_id": "investigator-a",
        "npc_id": "npc-legacy",
        "app": 40,
        "credit_rating": 50,
        "governing_attribute": "credit_rating",
        "governing_value": 50,
        "settlement_mode": "concealed_roll",
        "override_type": None,
        "concealed_roll": 37,
        "disposition": "neutral",
        "observable_manner": "对方礼貌而审慎地看了过来",
        "rule_ref": "keeper-rulebook p.191",
        "integrity_digest": "",
    }
    receipt["integrity_digest"] = coc_first_impression.canonical_digest({
        key: value for key, value in receipt.items() if key != "integrity_digest"
    })
    document = coc_first_impression.empty_document(campaign_id)
    document["receipts"][coc_first_impression.pair_key(
        "investigator-a", "npc-legacy"
    )] = receipt
    _write_json(coc_first_impression.document_path(campaign_dir), document)

    loaded = coc_first_impression.load_document(campaign_dir, campaign_id)
    assert coc_first_impression.find_by_pair(
        loaded, "investigator-a", "npc-legacy"
    ) == receipt
    projected = _load_exporter()._first_impression_projection(loaded, None)
    assert projected[0]["legacy_contract"] is True
    assert "concealed_roll" not in json.dumps(projected, ensure_ascii=False)


def test_two_first_contacts_finalize_and_export_without_overwrite(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    _write_json(
        workspace / ".coc" / "runtime.json",
        {
            "schema_version": 2,
            "planner": {"kind": "deterministic"},
            "rules": {"kind": "deterministic"},
            "narrator": {"kind": "template"},
            "player": {"kind": "human"},
        },
    )
    quick = coc_starter.quick_start(
        workspace / ".coc",
        "the-haunting",
        "thomas-hayes",
        campaign_id="multi-first-impression",
        title="Multi First Impression",
    )
    campaign_id = "multi-first-impression"
    investigator_id = str(quick["investigator_id"])
    run_id = "experience-probe-first-impression"

    def call(tool: str, args: dict | None = None) -> dict:
        result = coc_toolbox.run_tool(
            tool, workspace, campaign_id, dict(args or {})
        )
        assert result["ok"] is True, result
        return result

    base_context = {
        "player_conduct": "托马斯进门后先收起笔记本，清楚说明自己的来意",
        "scene_constraints": "这是办公场所，工作人员仍须遵守档案借阅职责",
        "authored_or_relationship_boundary": "初次见面，没有既有私交；职责不会因好感消失",
        "semantic_reason": "外表与社会身份只调节对方愿意听多久以及第一句话的温度",
    }
    first = call("npc.reaction", {
        "npc_id": "npc-ruth-blake",
        "npc_display_name": "露丝·布莱克",
        "investigator": investigator_id,
        "run_id": run_id,
        "context": base_context,
        "seed": 139,
        "decision_id": "first-impression-ruth",
    })
    assert first["data"]["achieved_level"] == "critical"
    replay = call("npc.reaction", {
        "npc_id": "npc-ruth-blake",
        "investigator": investigator_id,
        "run_id": run_id,
        "seed": 23,
        "decision_id": "first-impression-ruth-reroll-attempt",
    })
    assert replay["data"]["roll_id"] == first["data"]["roll_id"]
    assert replay["data"]["roll_record"]["roll"] == 1

    second = call("npc.reaction", {
        "npc_id": "npc-arty-wilmot",
        "npc_display_name": "阿蒂·威尔莫特",
        "investigator": investigator_id,
        "run_id": run_id,
        "context": {
            **base_context,
            "player_conduct": "托马斯给两人都留出说话余地，没有越过柜台",
        },
        "seed": 23,
        "decision_id": "first-impression-arty",
    })
    assert second["data"]["roll_id"] != first["data"]["roll_id"]
    assert second["data"]["achieved_level"] == "fumble"
    assert any(
        "boundary.description" in hint and "active play_language" in hint
        for hint in second["hints"]
    )

    reward = call("state.exceptional_effect", {
        "action": "apply",
        "source_roll_id": first["data"]["roll_id"],
        "direction": "benefit",
        "effect_kind": "bonus_die",
        "player_visible_impact": "露丝愿意记住这次得体的初见；下一次与她交涉时获得一枚奖励骰",
        "causal_link": "托马斯极其得体地兼顾了身份说明和露丝的工作边界",
        "boundary": {"kind": "until_consumed", "uses": 1},
        "mechanics": {
            "dice": 1,
            "investigator_id": investigator_id,
            "skill": "Persuade",
            "scene_id": None,
            "target_id": "npc-ruth-blake",
            "target_display_name": "露丝·布莱克",
        },
        "visibility": "player_visible",
        "decision_id": "first-impression-ruth-critical-benefit",
    })
    assert reward["data"]["effect"]["source_roll"]["tool"] == "npc.reaction"
    cost = call("state.exceptional_effect", {
        "action": "apply",
        "source_roll_id": second["data"]["roll_id"],
        "direction": "cost",
        "effect_kind": "restriction",
        "player_visible_impact": "阿蒂把托马斯列为需要主管在场才能接待的访客",
        "causal_link": "托马斯第一句话恰好触到了阿蒂对越权查档的警惕",
        "boundary": {
            "kind": "until_condition",
            "description": "主管明确批准托马斯继续接触这份登记",
        },
        "mechanics": {
            "subject_id": investigator_id,
            "restriction_id": "arty-supervisor-required",
            "scope": "与阿蒂继续讨论受限登记",
            "scene_id": None,
        },
        "visibility": "player_visible",
        "decision_id": "first-impression-arty-fumble-cost",
    })
    assert cost["data"]["effect"]["source_roll"]["roll_id"] == second["data"]["roll_id"]

    realization_rows = {
        "npc-ruth-blake": {
            "observable_manner": "露丝先看了一眼记者证，随后把椅子向柜台外推了半步",
            "causal_explanation": "托马斯的体面举止和清楚身份让她愿意先完整听完请求",
            "boundary_preserved": "她仍坚持所有借阅手续和保密职责",
            "opportunity_or_friction": "她主动说明了正确的申请顺序，并愿意回答一个补充问题",
        },
        "npc-arty-wilmot": {
            "observable_manner": "阿蒂按住登记簿，叫来主管后才肯继续听托马斯说明",
            "causal_explanation": "托马斯第一句话恰好触到了阿蒂对越权查档的警惕",
            "boundary_preserved": "阿蒂不会绕过主管或替调查员伪造登记",
            "opportunity_or_friction": "主管明确批准前，托马斯不能再从阿蒂这里接触受限登记",
        },
    }
    for npc_id, impression in (
        ("npc-ruth-blake", first),
        ("npc-arty-wilmot", second),
    ):
        call("state.record_npc_engagement", {
            "npc_id": npc_id,
            "investigator": investigator_id,
            "interaction_kind": "dialogue",
            "first_impression_ref": impression["data"]["first_impression_ref"],
            "first_impression_realization": realization_rows[npc_id],
            "run_id": run_id,
            "decision_id": f"engage-{npc_id}",
        })

    call("state.journal", {
        "summary": "托马斯第一次与露丝和阿蒂实质交谈。",
        "player_action": "向柜台后的两名工作人员说明来意",
        "intent_class": "social",
        "decision_id": "journal-multi-first-impression",
    })
    output = call("turn.output_context")["data"]
    assert "context_effect" not in output["mechanics_bundle"]
    context_effects = output["npc_performance_constraints"]
    assert [row["npc_id"] for row in context_effects] == [
        "npc-arty-wilmot", "npc-ruth-blake",
    ]
    assert len(output["mechanics_bundle"]["public_check"]) == 2
    assert len(output["mechanics_bundle"]["exceptional_effect"]) == 2
    assert output["missing_substantive_effects"] == []

    setup = "托马斯收起笔记本，先向两人亮明身份，再把请求说得清清楚楚。"
    result = (
        "露丝把椅子推近柜台，阿蒂却按住登记簿，叫来主管后才肯继续听；"
        "同一番开场，在两人那里引出了截然不同的反应。"
    )
    draft = setup + "\n\n" + result
    coverage = [
        {
            "obligation_id": row["obligation_id"],
            "realization": "fictional_beat",
            "action_realization": "托马斯向两名工作人员完整说明身份和请求",
            "response": "露丝主动说明申请顺序，阿蒂则要求主管在场后才继续接待",
            "causal_explanation": "两次独立初印象骰与各自 persona/职责共同塑造不同反应",
            "persona_fit": "符合两名 NPC 各自的办公职责，也保留托马斯记者式的得体表达",
            "player_input_handling": "abstract_completed",
            "exact_excerpt": result,
            "exceptional_beat": (
                "这次极端结果形成了与对应 NPC 和源骰绑定的独立后续影响"
                if row["exceptional_required"] else ""
            ),
        }
        for row in output["obligations"]
    ]
    finalized = call("turn.finalize", {
        "draft": draft,
        "coverage": coverage,
        "mechanics_placements": _placements(output["mechanics_bundle"]),
        "decision_id": "finalize-multi-first-impression",
    })
    rendered = finalized["data"]["rendered_text"]
    assert "露丝·布莱克" in rendered
    assert "阿蒂·威尔莫特" in rendered
    assert "npc-ruth-blake" not in rendered
    assert "npc-arty-wilmot" not in rendered
    assert rendered.count("【明骰】初印象·") == 2
    assert "【初次反应】" not in rendered
    assert "causal_explanation" not in rendered
    assert rendered.count("【关系/印象奖励】") == 1
    assert rendered.count("【特殊影响】") == 1

    run_dir = tmp_path / "run"
    shutil.copytree(workspace / ".coc", run_dir / "sandbox" / ".coc")
    _write_json(run_dir / "run.json", {
        "campaign_id": campaign_id,
        "run_id": run_id,
        "play_language": "zh-Hans",
        "status": "experience-probe",
    })
    (run_dir / "transcript.jsonl").write_text(
        "".join([
            json.dumps({"role": "player", "turn": 1, "text": "我向两个人说明来意。"}, ensure_ascii=False) + "\n",
            json.dumps({"role": "keeper", "turn": 1, "text": rendered}, ensure_ascii=False) + "\n",
        ]),
        encoding="utf-8",
    )
    report = _load_exporter().export_battle_report(run_dir)
    assert [row["npc_id"] for row in report["first_impressions"]] == [
        "npc-arty-wilmot", "npc-ruth-blake",
    ]
    assert {row["npc_display_name"] for row in report["first_impressions"]} == {
        "阿蒂·威尔莫特", "露丝·布莱克",
    }
    assert all(
        set(row.get("realization") or {}) <= {"observable_manner"}
        for row in report["first_impressions"]
    )
    assert len(report["relationship_rewards"]) == 1
    assert len(report["exceptional_effects"]) == 1
    markdown = (run_dir / "artifacts" / "battle-report.md").read_text(encoding="utf-8")
    assert "露丝·布莱克" in markdown and "阿蒂·威尔莫特" in markdown


def test_npc_scoped_relationship_bonus_matches_and_consumes_once(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    _write_json(
        workspace / ".coc" / "runtime.json",
        {
            "schema_version": 2,
            "planner": {"kind": "deterministic"},
            "rules": {"kind": "deterministic"},
            "narrator": {"kind": "template"},
            "player": {"kind": "human"},
        },
    )
    quick = coc_starter.quick_start(
        workspace / ".coc",
        "the-haunting",
        "thomas-hayes",
        campaign_id="relationship-reward",
        title="Relationship Reward",
    )
    campaign_id = "relationship-reward"
    investigator_id = str(quick["investigator_id"])

    def raw(tool: str, args: dict | None = None) -> dict:
        return coc_toolbox.run_tool(tool, workspace, campaign_id, dict(args or {}))

    def call(tool: str, args: dict | None = None) -> dict:
        result = raw(tool, args)
        assert result["ok"] is True, result
        return result

    helped = call("rules.roll", {
        "investigator": investigator_id,
        "skill": "Persuade",
        "target": 50,
        "npc_id": "npc-ruth-blake",
        "difficulty": "regular",
        "goal": "替露丝澄清一项会让她承担责任的登记错误",
        "stakes": {
            "on_success": "错误被澄清，露丝免于承担不属于她的责任",
            "on_failure": "登记错误仍悬在露丝名下",
        },
        "difficulty_basis": "keeper_judgment",
        "seed": 1,
        "decision_id": "help-ruth-source-roll",
    })
    assert helped["data"]["passed"] is True
    assert helped["data"]["outcome"] != "critical"

    relationship = call("state.npc_update", {
        "npc_id": "npc-ruth-blake",
        "investigator": investigator_id,
        "trust_delta": 1,
        "suspicion_delta": -1,
        "decision_id": "help-ruth-live-relationship",
    })
    assert relationship["data"]["psych"]["trust"] == 1
    reward = call("state.exceptional_effect", {
        "action": "apply",
        "source_roll_id": helped["data"]["roll_id"],
        "direction": "benefit",
        "effect_kind": "bonus_die",
        "player_visible_impact": "露丝记得托马斯替她澄清了登记错误；下一次与她进行说服检定时获得一枚奖励骰",
        "causal_link": "托马斯实际解决了会伤害露丝职业信誉的问题，她因此愿意认真回报这份帮助",
        "boundary": {"kind": "until_consumed", "uses": 1},
        "mechanics": {
            "dice": 1,
            "investigator_id": investigator_id,
            "skill": "Persuade",
            "scene_id": None,
            "target_id": "npc-ruth-blake",
            "target_display_name": "露丝·布莱克",
            "source_decision_ids": ["help-ruth-live-relationship"],
        },
        "visibility": "player_visible",
        "decision_id": "reward-help-ruth",
    })
    effect_id = reward["data"]["effect"]["effect_id"]

    unrelated = call("rules.roll", {
        "investigator": investigator_id,
        "skill": "Persuade",
        "target": 50,
        "npc_id": "npc-arty-wilmot",
        "difficulty": "regular",
        "goal": "请阿蒂核对另一页登记",
        "stakes": {"on_success": "阿蒂核对登记", "on_failure": "阿蒂拒绝额外工作"},
        "difficulty_basis": "keeper_judgment",
        "seed": 1,
        "decision_id": "persuade-unrelated-arty",
    })
    assert unrelated["data"]["bonus"] == 0
    active = call("scene.context")["data"]["continuity"][
        "active_exceptional_effects"
    ]
    assert [row["effect_id"] for row in active] == [effect_id]

    call("state.journal", {
        "summary": "托马斯替露丝澄清登记错误，随后请阿蒂核对另一页登记。",
        "player_action": "帮助露丝后与阿蒂交涉",
        "intent_class": "social",
        "decision_id": "journal-unrelated-npc-does-not-consume-reward",
    })
    unrelated_output = call("turn.output_context")["data"]
    assert unrelated_output["pending_modifier_consumptions"] == []
    unrelated_setup = "托马斯找出登记错误的来源，替露丝洗清了本不该由她承担的责任。"
    unrelated_result = (
        "稍后他请阿蒂核对另一页登记；这件事与露丝欠下的人情无关。"
    )
    unrelated_draft = unrelated_setup + "\n\n" + unrelated_result
    unrelated_coverage = [{
        "obligation_id": row["obligation_id"],
        "realization": "fictional_beat",
        "action_realization": "托马斯先帮助露丝，随后向阿蒂提出独立请求",
        "response": "露丝的关系变化被保留，阿蒂的检定独立结算",
        "causal_explanation": "NPC 专属奖励只适用于露丝，不能因技能相同而套到阿蒂身上",
        "persona_fit": "两名 NPC 各自回应与自己有关的行为",
        "player_input_handling": "specific_preserved",
        "exact_excerpt": unrelated_result,
        "exceptional_beat": "",
    } for row in unrelated_output["obligations"]]
    unrelated_finalized = call("turn.finalize", {
        "draft": unrelated_draft,
        "coverage": unrelated_coverage,
        "mechanics_placements": _placements(unrelated_output["mechanics_bundle"]),
        "decision_id": "finalize-unrelated-npc-does-not-consume-reward",
    })
    assert unrelated_finalized["data"]["rendered_text"].count(
        "【关系/印象奖励】"
    ) == 1
    assert [
        row["effect_id"]
        for row in call("scene.context")["data"]["continuity"][
            "active_exceptional_effects"
        ]
    ] == [effect_id]

    omitted = raw("rules.roll", {
        "investigator": investigator_id,
        "skill": "Persuade",
        "target": 50,
        "npc_id": "npc-ruth-blake",
        "difficulty": "regular",
        "goal": "请露丝延长查档时间",
        "stakes": {"on_success": "露丝延长时间", "on_failure": "露丝按时收回卷宗"},
        "difficulty_basis": "keeper_judgment",
        "seed": 5,
        "decision_id": "persuade-ruth-without-earned-die",
    })
    assert omitted["ok"] is False
    assert omitted["error"]["code"] == "exceptional_modifier_required"

    matching = call("rules.roll", {
        "investigator": investigator_id,
        "skill": "Persuade",
        "target": 50,
        "npc_id": "npc-ruth-blake",
        "difficulty": "regular",
        "goal": "请露丝延长查档时间",
        "stakes": {"on_success": "露丝延长时间", "on_failure": "露丝按时收回卷宗"},
        "difficulty_basis": "keeper_judgment",
        "bonus": 1,
        "seed": 5,
        "decision_id": "persuade-ruth-with-earned-die",
    })
    consumed = call("state.exceptional_effect", {
        "action": "consume",
        "effect_id": effect_id,
        "consuming_roll_id": matching["data"]["roll_id"],
        "decision_id": "consume-help-ruth-reward",
    })
    assert consumed["data"]["effect"]["status"] == "consumed"
    assert call("scene.context")["data"]["continuity"][
        "active_exceptional_effects"
    ] == []

    call("state.journal", {
        "summary": "托马斯帮助露丝后，在下一次对她的说服中用掉了这份人情。",
        "player_action": "先替露丝解决登记错误，再请求延长查档",
        "intent_class": "social",
        "decision_id": "journal-relationship-reward",
    })
    output = call("turn.output_context")["data"]
    assert output["pending_modifier_consumptions"] == []
    assert len(output["mechanics_bundle"]["exceptional_effect"]) == 1
    setup = "托马斯找出登记错误的来源，替露丝洗清了本不该由她承担的责任。"
    result = (
        "当他随后请求多留一会儿时，露丝记起这份实际帮助，重新把卷宗推回桌面。"
    )
    draft = setup + "\n\n" + result
    coverage = [{
        "obligation_id": row["obligation_id"],
        "realization": "fictional_beat",
        "action_realization": "托马斯先解决登记错误，再向露丝提出具体请求",
        "response": "露丝因实际受益而认真考虑请求，并兑现一次额外通融",
        "causal_explanation": "成功帮助、live trust 更新和一次性奖励骰共同构成后续关系变化",
        "persona_fit": "露丝回报的是对她职业责任有实际价值的帮助，而非泛化讨好",
        "player_input_handling": "specific_preserved",
        "exact_excerpt": result,
        "exceptional_beat": "",
    } for row in output["obligations"]]
    finalized = call("turn.finalize", {
        "draft": draft,
        "coverage": coverage,
        "mechanics_placements": _placements(output["mechanics_bundle"]),
        "decision_id": "finalize-relationship-reward",
    })
    assert finalized["data"]["rendered_text"].count("【关系/印象奖励】") == 1

    run_dir = tmp_path / "run"
    shutil.copytree(workspace / ".coc", run_dir / "sandbox" / ".coc")
    _write_json(run_dir / "run.json", {
        "campaign_id": campaign_id,
        "run_id": "relationship-reward-probe",
        "play_language": "zh-Hans",
        "status": "experience-probe",
    })
    (run_dir / "transcript.jsonl").write_text(
        "".join([
            json.dumps({"role": "player", "turn": 1, "text": "我先帮露丝，再请阿蒂核对另一页。"}, ensure_ascii=False) + "\n",
            json.dumps({"role": "keeper", "turn": 1, "text": unrelated_finalized["data"]["rendered_text"]}, ensure_ascii=False) + "\n",
            json.dumps({"role": "player", "turn": 2, "text": "我再请露丝延长查档时间。"}, ensure_ascii=False) + "\n",
            json.dumps({"role": "keeper", "turn": 2, "text": finalized["data"]["rendered_text"]}, ensure_ascii=False) + "\n",
        ]),
        encoding="utf-8",
    )
    report = _load_exporter().export_battle_report(run_dir)
    assert len(report["relationship_rewards"]) == 1
    exported = report["relationship_rewards"][0]
    assert exported["status"] == "consumed"
    assert exported["source_roll_id"] == helped["data"]["roll_id"]
    assert exported["mechanics"]["source_decision_ids"] == [
        "help-ruth-live-relationship"
    ]


def test_state_delta_preserves_canonical_tool_call_order(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    _write_json(
        workspace / ".coc" / "runtime.json",
        {
            "schema_version": 2,
            "planner": {"kind": "deterministic"},
            "rules": {"kind": "deterministic"},
            "narrator": {"kind": "template"},
            "player": {"kind": "human"},
        },
    )
    quick = coc_starter.quick_start(
        workspace / ".coc",
        "the-haunting",
        "thomas-hayes",
        campaign_id="state-delta-source-order",
        title="State Delta Source Order",
    )
    campaign_id = "state-delta-source-order"
    investigator_id = str(quick["investigator_id"])

    def call(tool: str, args: dict | None = None) -> dict:
        result = coc_toolbox.run_tool(tool, workspace, campaign_id, dict(args or {}))
        assert result["ok"] is True, result
        return result

    calls = [
        ("state.advance_time", {
            "minutes": 25,
            "reason": "travel and evidence custody",
            "decision_id": "turn25-ada-custody-meal-travel",
        }),
        ("state.advance_time", {
            "minutes": 15,
            "reason": "wait for the licensed fitter",
            "decision_id": "turn25-wait-for-gas-fitter",
        }),
        ("state.item_grant", {
            "investigator": investigator_id,
            "kind": "gear",
            "item_id": "kelleher-report",
            "label": "凯莱赫的限缩检查报告",
            "decision_id": "turn25-grant-kelleher-report",
        }),
        ("state.advance_time", {
            "minutes": 120,
            "reason": "limited gas inspection",
            "decision_id": "turn25-gas-inspection-duration",
        }),
    ]
    for tool, args in calls:
        call(tool, args)
    call("state.journal", {
        "summary": "检修员按约抵达并完成限缩检查。",
        "player_action": "等待检修员并记录检查报告",
        "intent_class": "investigate",
        "decision_id": "turn25-journal-limited-gas-inspection",
    })

    output = call("turn.output_context")["data"]
    deltas = output["mechanics_bundle"]["state_delta"]
    assert [row["source_decision_id"] for row in deltas] == [
        calls[2][1]["decision_id"],
        calls[3][1]["decision_id"],
    ]
    hidden_same_phase = {calls[0][1]["decision_id"], calls[1][1]["decision_id"]}
    assert hidden_same_phase.isdisjoint(
        row["source_decision_id"] for row in deltas
    )
    time_chain = [
        (row["before"], row["after"], row["delta_minutes"])
        for row in deltas if row["effect_kind"] == "time"
    ]
    assert time_chain == [(40, 160, 120)]
    assert output["composition_mode"] == "causal_paragraph_placements"
    assert set(output["placement_segment_types"]) == {
        "public_check", "state_delta", "exceptional_effect",
    }
