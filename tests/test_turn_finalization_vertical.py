"""One thin, real-toolbox vertical smoke for causal turn finalization."""
from __future__ import annotations

import json
from pathlib import Path
import sys


SCRIPTS = Path(__file__).resolve().parents[1] / "plugins" / "coc-keeper" / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import coc_starter
import coc_toolbox


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def test_real_toolbox_turn_finalizes_causal_fiction_and_exact_player_receipts(
    tmp_path: Path,
) -> None:
    workspace = tmp_path / "workspace"
    coc_root = workspace / ".coc"
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
        campaign_id="causal-vertical",
        title="Causal Vertical",
    )
    campaign_id = "causal-vertical"
    investigator_id = str(quick["investigator_id"])
    run_id = "experience-probe-1"

    def call(tool: str, args: dict | None = None) -> dict:
        result = coc_toolbox.run_tool(
            tool, workspace, campaign_id, dict(args or {})
        )
        assert result["ok"] is True, result
        return result

    # A neutral improvised clerk rolls once; a second decision cannot shop for
    # a different public result.  The first engagement binds that source.
    reaction = call(
        "npc.reaction",
        {
            "npc_id": "npc-archive-clerk",
            "npc_display_name": "档案员",
            "investigator": investigator_id,
            "run_id": run_id,
            "context": {
                "player_conduct": "托马斯先收起笔记本，清楚说明来意",
                "scene_constraints": "档案员仍须遵守借阅与保密职责",
                "authored_or_relationship_boundary": "初次见面，没有既有私交或特别授权",
                "semantic_reason": "外表与社会身份只调节起初的耐心与语气",
            },
            "seed": 7,
            "decision_id": "reaction-clerk",
        },
    )
    frozen = call(
        "npc.reaction",
        {
            "npc_id": "npc-archive-clerk",
            "investigator": investigator_id,
            "run_id": run_id,
            "seed": 23,
            "decision_id": "reaction-clerk-shopping-attempt",
        },
    )
    assert frozen["data"]["receipt_id"] == reaction["data"]["receipt_id"]
    assert frozen["data"]["roll_record"]["roll"] == reaction["data"]["roll_record"]["roll"]
    first_engagement = call(
        "state.record_npc_engagement",
        {
            "npc_id": "npc-archive-clerk",
            "investigator": investigator_id,
            "interaction_kind": "dialogue",
            "first_impression_ref": reaction["data"]["first_impression_ref"],
            "first_impression_realization": {
                "observable_manner": "档案员先看了一眼托马斯的证件，再把椅子向柜台前推了半步",
                "causal_explanation": "托马斯的体面举止和清楚身份影响了档案员的起初判断",
                "boundary_preserved": "档案员仍坚持借阅手续和保密职责",
                "opportunity_or_friction": "她愿意先听完托马斯的请求",
            },
            "run_id": run_id,
            "decision_id": "engage-clerk-first",
        },
    )
    public_context = first_engagement["data"]["context_effect"]
    assert first_engagement["data"]["first_contact"] is True
    assert "concealed_roll" not in public_context
    assert "disposition" not in public_context
    advised = call(
        "director.advise",
        {
            "player_text": "我先看档案员的反应，再决定怎么开口。",
            "intent_evidence": {
                "primary_intent": "social",
                "reason": "玩家在已发生首见后观察当前 NPC，再准备交谈。",
            },
            "investigator": investigator_id,
            "seed": 11,
            "decision_id": "advise-after-first-impression",
        },
    )
    assert advised["data"]["authority"] == "advisory"
    later_engagement = call(
        "state.record_npc_engagement",
        {
            "npc_id": "npc-archive-clerk",
            "investigator": investigator_id,
            "interaction_kind": "witness",
            "run_id": run_id,
            "decision_id": "engage-clerk-later",
        },
    )
    assert later_engagement["data"]["first_contact"] is False
    assert later_engagement["data"]["context_effect"] is None

    # Existing authoritative mechanics feed one shared bundle.  Combat spends
    # only current loaded-magazine ammunition; enemy HP/resources never become
    # player state deltas.
    call(
        "state.move_scene",
        {"scene_id": "corbitt-confrontation", "decision_id": "move-final"},
    )
    call(
        "combat.resolve",
        {
            "affordance_id": "conventional-assault",
            "investigator": investigator_id,
            "weapon_id": "revolver_38_or_9mm",
            "seed": 7,
            "decision_id": "combat-shot",
        },
    )
    call(
        "rules.damage",
        {
            "investigator": investigator_id,
            "amount": "1",
            "kind": "damage",
            "source": "falling plaster",
            "decision_id": "self-damage",
        },
    )
    call(
        "rules.sanity_check",
        {
            "investigator": investigator_id,
            "source": "Corbitt rises",
            "loss_success": "0",
            "loss_failure": "1",
            "seed": 5,
            "decision_id": "san-check",
        },
    )
    failed = call(
        "rules.roll",
        {
            "investigator": investigator_id,
            "skill": "Fast Talk",
            "target": 50,
            "difficulty": "regular",
            "goal": "keep the clerk from summoning security",
            "stakes": {
                "on_success": "the clerk delays the alarm",
                "on_failure": "the clerk summons security",
            },
            "difficulty_basis": "keeper_judgment",
            "seed": 5,
            "decision_id": "fast-talk-luck-source",
        },
    )
    assert failed["data"]["roll"] == 80
    call(
        "rules.luck_spend",
        {
            "investigator": investigator_id,
            "source_roll_id": failed["data"]["roll_id"],
            "points": 30,
            "decision_id": "spend-luck",
        },
    )
    fumble = call(
        "rules.roll",
        {
            "investigator": investigator_id,
            "skill": "Fast Talk",
            "target": 50,
            "difficulty": "regular",
            "goal": "make the cover story withstand a second question",
            "stakes": {
                "on_success": "the story holds",
                "on_failure": "the lie is exposed",
            },
            "difficulty_basis": "keeper_judgment",
            "fumble_consequence": "the clerk reaches the alarm first",
            "seed": 23,
            "decision_id": "fast-talk-fumble",
        },
    )
    exceptional = call(
        "state.exceptional_effect",
        {
            "action": "apply",
            "source_roll_id": fumble["data"]["roll_id"],
            "direction": "cost",
            "effect_kind": "scene_event",
            "player_visible_impact": "档案员按响警铃，安保开始封锁这间档案室",
            "causal_link": "托马斯借口里的第二处破绽让档案员确认现场存在欺骗",
            "boundary": {
                "kind": "until_scene_end",
                "scene_id": "corbitt-confrontation",
            },
            "mechanics": {
                "scene_id": "corbitt-confrontation",
                "event_id": "archive-security-lockdown",
                "change_kind": "escalation",
            },
            "visibility": "player_visible",
            "decision_id": "fast-talk-fumble-effect",
        },
    )
    assert exceptional["data"]["effect"]["source_roll"]["roll_id"] == fumble["data"]["roll_id"]
    call(
        "state.item_grant",
        {
            "investigator": investigator_id,
            "kind": "gear",
            "item_id": "archive-pass",
            "label": "档案室访客证",
            "decision_id": "grant-pass",
        },
    )
    call(
        "state.advance_time",
        {
            "minutes": 10,
            "reason": "the confrontation and argument",
            "decision_id": "advance-ten",
        },
    )
    call(
        "state.journal",
        {
            "summary": "托马斯开枪后又试图用借口拖住赶来的档案员。",
            "player_action": "开枪，再用临场借口稳住对方",
            "intent_class": "combat-social",
            "decision_id": "journal-turn-one",
        },
    )

    output_context = call("turn.output_context")["data"]
    bundle = output_context["mechanics_bundle"]
    scalar_resources = [
        row["resource"]
        for row in bundle["state_delta"]
        if row["effect_kind"] == "scalar"
    ]
    assert scalar_resources.count("HP") == 1
    assert scalar_resources.count("SAN") == 1
    assert scalar_resources.count("Luck") == 1
    assert len([
        row for row in bundle["state_delta"]
        if row["effect_kind"] == "loaded_ammunition"
    ]) == 1
    assert len([
        row for row in bundle["state_delta"] if row["effect_kind"] == "item"
    ]) == 1
    assert len([
        row for row in bundle["state_delta"] if row["effect_kind"] == "time"
    ]) == 1
    assert all(
        row.get("investigator_id") in (None, investigator_id)
        for row in bundle["state_delta"]
    )
    assert len(bundle["context_effect"]) == 1
    assert len(bundle["exceptional_effect"]) == 1
    assert output_context["missing_substantive_effects"] == []
    assert "concealed_roll" not in json.dumps(
        bundle["context_effect"], ensure_ascii=False
    )

    excerpt = (
        "托马斯压低枪口，把临时拼出的查档理由一字不差地递过去；"
        "档案员先被他的体面外表稳住，听到第二处破绽时却猛地伸手按向警铃。"
    )
    draft = (
        excerpt
        + "枪声留下的硝烟还贴在天花板下，一块灰泥砸上他的肩头；"
        "他攥住刚拿到的访客证，十分钟已经从钟面上溜走。"
    )

    def coverage_rows() -> list[dict]:
        return [
            {
                "obligation_id": obligation["obligation_id"],
                "realization": "fictional_beat",
                "action_realization": "托马斯开枪并把临场借口完整说出口",
                "response": "目标承受枪击，档案员先迟疑后伸手按警铃",
                "causal_explanation": "射击结果改变目标状态；借口的破绽令档案员转为警觉",
                "persona_fit": "符合托马斯依赖记者身份、临场编故事的行事方式",
                "player_input_handling": "abstract_completed",
                "exact_excerpt": excerpt,
                "exceptional_beat": (
                    "档案员抢先按向警铃，临时打开新的安保压力"
                    if obligation["exceptional_required"] else ""
                ),
            }
            for obligation in output_context["obligations"]
        ]

    coverage = coverage_rows()
    missing = coc_toolbox.run_tool(
        "turn.finalize",
        workspace,
        campaign_id,
        {"draft": draft, "coverage": coverage[:-1], "decision_id": "missing"},
    )
    assert missing["ok"] is False
    assert missing["error"]["code"] == "missing_obligation"
    exceptional_index = next(
        index
        for index, obligation in enumerate(output_context["obligations"])
        if obligation["exceptional_required"]
    )
    no_exception = coverage_rows()
    no_exception[exceptional_index]["exceptional_beat"] = ""
    exceptional = coc_toolbox.run_tool(
        "turn.finalize",
        workspace,
        campaign_id,
        {
            "draft": draft,
            "coverage": no_exception,
            "decision_id": "missing-exception",
        },
    )
    assert exceptional["ok"] is False
    assert exceptional["error"]["code"] == "exceptional_beat_required"

    finalized = call(
        "turn.finalize",
        {"draft": draft, "coverage": coverage, "decision_id": "final-turn-one"},
    )
    replay = call(
        "turn.finalize",
        {"draft": draft, "coverage": coverage, "decision_id": "final-turn-one"},
    )
    assert replay["data"] == finalized["data"]
    rendered = finalized["data"]["rendered_text"]
    fiction_at = rendered.index(draft)
    roll_at = rendered.index("【明骰】")
    delta_at = rendered.index("【变化】")
    exceptional_at = rendered.index("【特殊影响】")
    context_at = rendered.index("【初次反应】")
    assert fiction_at == 0
    assert fiction_at < roll_at < delta_at < exceptional_at < context_at
    assert "【明骰】话术" in rendered
    assert "【明骰】Fast Talk" not in rendered
    assert "｜因果：" in rendered
    assert "对方最初表现：" not in rendered
    assert "原始：80；幸运 -30；调整：50" in rendered
    assert "不含未建账的备用弹药" in rendered
    assert finalized["data"]["rendered_sha256"].startswith("sha256:")


def test_pushed_failure_rejects_prose_time_and_flag_without_bound_effect(
    tmp_path: Path,
) -> None:
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
        campaign_id="exceptional-missing",
        title="Exceptional Missing",
    )
    investigator_id = str(quick["investigator_id"])

    def call(tool: str, args: dict | None = None) -> dict:
        result = coc_toolbox.run_tool(
            tool, workspace, "exceptional-missing", dict(args or {})
        )
        assert result["ok"] is True, result
        return result

    original = call(
        "rules.roll",
        {
            "investigator": investigator_id,
            "skill": "Fast Talk",
            "target": 50,
            "difficulty": "regular",
            "goal": "keep the archive open",
            "stakes": {"on_success": "access continues", "on_failure": "access ends"},
            "difficulty_basis": "keeper_judgment",
            "seed": 5,
            "decision_id": "push-source",
        },
    )
    assert original["data"]["outcome"] == "failure"
    pushed = call(
        "rules.push",
        {
            "original_check_decision_id": "push-source",
            "method_changed": "rebuild the index by witness name",
            "failure_consequence": "the archive closes and the false chain attracts attention",
            "seed": 5,
            "decision_id": "failed-push-without-effect",
        },
    )
    assert pushed["data"]["outcome"] == "failure"
    assert pushed["data"]["pushed"] is True
    call(
        "state.advance_time",
        {"minutes": 60, "reason": "fruitless search", "decision_id": "time-only"},
    )
    call(
        "state.set_flag",
        {
            "flag_id": "named-like-a-consequence",
            "value": True,
            "reason": "a label is not a substantive effect",
            "decision_id": "flag-only",
        },
    )
    call(
        "state.journal",
        {"summary": "The attempt fumbled.", "decision_id": "missing-effect-journal"},
    )
    context = call("turn.output_context")["data"]
    assert context["missing_substantive_effects"] == [{
        "obligation_id": f"roll:{pushed['data']['roll_id']}",
        "source_roll_id": pushed["data"]["roll_id"],
        "required_direction": "cost",
    }]
    result = coc_toolbox.run_tool(
        "turn.finalize",
        workspace,
        "exceptional-missing",
        {"draft": "失败带来了麻烦。", "coverage": [], "decision_id": "must-fail"},
    )
    assert result["ok"] is False
    assert result["error"]["code"] == "substantive_exceptional_effect_required"


def test_one_shot_exceptional_modifier_is_discovered_applied_and_consumed(
    tmp_path: Path,
) -> None:
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
        campaign_id="exceptional-modifier",
        title="Exceptional Modifier",
    )
    investigator_id = str(quick["investigator_id"])

    def call(tool: str, args: dict | None = None) -> dict:
        result = coc_toolbox.run_tool(
            tool, workspace, "exceptional-modifier", dict(args or {})
        )
        assert result["ok"] is True, result
        return result

    critical = call(
        "rules.roll",
        {
            "investigator": investigator_id,
            "skill": "Fast Talk",
            "target": 50,
            "difficulty": "regular",
            "goal": "spot the clerk's procedural weakness",
            "stakes": {"on_success": "a weakness is found", "on_failure": "none is found"},
            "difficulty_basis": "keeper_judgment",
            "seed": 139,
            "decision_id": "critical-source",
        },
    )
    assert critical["data"]["outcome"] == "critical"
    applied = call(
        "state.exceptional_effect",
        {
            "action": "apply",
            "source_roll_id": critical["data"]["roll_id"],
            "direction": "benefit",
            "effect_kind": "bonus_die",
            "player_visible_impact": "下一次话术检定获得 1 枚奖励骰",
            "causal_link": "托马斯从档案员的纠正中抓住了她最在意的程序措辞",
            "boundary": {"kind": "until_consumed", "uses": 1},
            "mechanics": {
                "dice": 1,
                "investigator_id": investigator_id,
                "skill": "Fast Talk",
                "scene_id": None,
                "target_id": None,
            },
            "visibility": "player_visible",
            "decision_id": "critical-bonus-effect",
        },
    )
    effect_id = applied["data"]["effect"]["effect_id"]
    scene = call("scene.context")["data"]
    assert [row["effect_id"] for row in scene["continuity"]["active_exceptional_effects"]] == [effect_id]

    missing_die = coc_toolbox.run_tool(
        "rules.roll",
        workspace,
        "exceptional-modifier",
        {
            "investigator": investigator_id,
            "skill": "Fast Talk",
            "target": 50,
            "difficulty": "regular",
            "goal": "use the procedural wording",
            "stakes": {"on_success": "the wording works", "on_failure": "it fails"},
            "difficulty_basis": "keeper_judgment",
            "seed": 5,
            "decision_id": "matching-roll-missing-die",
        },
    )
    assert missing_die["ok"] is False
    assert missing_die["error"]["code"] == "exceptional_modifier_required"

    matching = call(
        "rules.roll",
        {
            "investigator": investigator_id,
            "skill": "Fast Talk",
            "target": 50,
            "difficulty": "regular",
            "goal": "use the procedural wording",
            "stakes": {"on_success": "the wording works", "on_failure": "it fails"},
            "difficulty_basis": "keeper_judgment",
            "bonus": 1,
            "seed": 5,
            "decision_id": "matching-roll-with-die",
        },
    )
    consumed = call(
        "state.exceptional_effect",
        {
            "action": "consume",
            "effect_id": effect_id,
            "consuming_roll_id": matching["data"]["roll_id"],
            "decision_id": "consume-critical-bonus",
        },
    )
    replay = call(
        "state.exceptional_effect",
        {
            "action": "consume",
            "effect_id": effect_id,
            "consuming_roll_id": matching["data"]["roll_id"],
            "decision_id": "consume-critical-bonus",
        },
    )
    assert replay["data"] == consumed["data"]
    assert call("scene.context")["data"]["continuity"]["active_exceptional_effects"] == []
