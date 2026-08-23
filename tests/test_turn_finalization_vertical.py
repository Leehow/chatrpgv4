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
import coc_turn_finalization


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def test_time_delta_renders_only_broad_player_phase() -> None:
    effect = {
        "effect_kind": "time",
        "before": 35,
        "delta_minutes": 197,
        "after": 232,
        "player_time_after": {
            "phase": "afternoon",
            "appearance_mode": "normal",
            "display_label": None,
        },
    }
    rendered = coc_turn_finalization._render_state_delta(
        effect, play_language="zh-Hans",
    )
    assert rendered == "【变化】时段：下午"
    assert "197" not in rendered
    assert "232" not in rendered
    assert "分钟" not in rendered


def test_time_delta_honors_supernatural_appearance() -> None:
    rendered = coc_turn_finalization._render_state_delta({
        "effect_kind": "time_appearance",
        "player_time_after": {
            "phase": "morning",
            "appearance_mode": "distorted",
            "display_label": "凝固的血色黄昏",
        },
    }, play_language="zh-Hans")
    assert rendered == "【变化】时段：凝固的血色黄昏"


def test_luck_delta_uses_play_language() -> None:
    effect = {
        "effect_kind": "scalar",
        "resource": "Luck",
        "before": 55,
        "after": 46,
        "delta": -9,
    }

    assert coc_turn_finalization._render_state_delta(
        effect, play_language="zh-Hans",
    ) == "【变化】幸运：55 → 46（-9）"


def test_item_use_projects_count_and_remaining_once() -> None:
    rows = coc_turn_finalization._project_state_deltas([{
        "ok": True,
        "tool": "state.item_use",
        "args": {"decision_id": "use-bandage", "investigator": "hero"},
        "data": {
            "investigator_id": "hero",
            "item_id": "bandage",
            "label": "绷带",
            "count": 1,
            "remaining": 2,
            "outcome": "decremented",
            "changed": True,
        },
    }])
    assert len(rows) == 1
    effect = rows[0]
    assert effect["effect_kind"] == "item"
    assert effect["action"] == "used"
    assert effect["count"] == 1
    assert effect["remaining"] == 2
    rendered = coc_turn_finalization._render_state_delta(
        effect, play_language="zh-Hans",
    )
    assert rendered == "【变化】物品：使用「绷带」×1（剩余 2）"
    consumed = coc_turn_finalization._project_state_deltas([{
        "ok": True,
        "tool": "state.item_use",
        "args": {"decision_id": "use-last", "investigator": "hero"},
        "data": {
            "investigator_id": "hero",
            "item_id": "bandage",
            "label": "绷带",
            "count": 1,
            "remaining": 0,
            "outcome": "consumed",
            "changed": True,
        },
    }])
    assert len(consumed) == 1
    assert consumed[0]["remaining"] == 0
    assert coc_turn_finalization._render_state_delta(
        consumed[0], play_language="zh-Hans",
    ) == "【变化】物品：用尽「绷带」×1（剩余 0）"


def test_cash_deltas_are_per_currency_and_player_safe() -> None:
    game_time = {
        "elapsed_minutes": 30,
        "display": "1920-08-15 10:30",
        "player_time": {
            "phase": "morning",
            "appearance_mode": "normal",
            "display_label": None,
        },
    }
    rows = coc_turn_finalization._project_state_deltas([
        {
            "ok": True,
            "tool": "state.cash_grant",
            "args": {"decision_id": "cash-usd", "investigator": "hero"},
            "data": {
                "investigator_id": "hero",
                "changed": True,
                "op": "grant",
                "amount": "20.00",
                "currency": "USD",
                "balance_before": "0.00",
                "balance_after": "20.00",
                "reason": "audit-advance-from-knott",
                "localized_reason": "预付调查费",
                "recorded_at": "2026-04-08T12:00:00+00:00",
                "game_time": game_time,
            },
        },
        {
            "ok": True,
            "tool": "state.cash_grant",
            "args": {"decision_id": "cash-gbp", "investigator": "hero"},
            "data": {
                "investigator_id": "hero",
                "changed": True,
                "op": "grant",
                "amount": "5.00",
                "currency": "GBP",
                "unit": "pound",
                "balance_before": "0.00",
                "balance_after": "5.00",
                "reason": "audit-sterling-tip",
                "localized_reason": "伦敦线人酬金",
                "recorded_at": "2026-04-08T12:01:00+00:00",
                "game_time": game_time,
            },
        },
        {
            "ok": True,
            "tool": "state.cash_spend",
            "args": {"decision_id": "cash-usd-cab", "investigator": "hero"},
            "data": {
                "investigator_id": "hero",
                "changed": True,
                "op": "spend",
                "amount": "1.50",
                "currency": "USD",
                "balance_before": "20.00",
                "balance_after": "18.50",
                "reason": "audit-taxi-fare",
                "localized_reason": "去波士顿街的车费",
                "recorded_at": "2026-04-08T12:02:00+00:00",
                "game_time": game_time,
            },
        },
    ])
    assert [row["currency"] for row in rows] == ["USD", "GBP", "USD"]
    assert [row["balance_before"] for row in rows] == ["0.00", "0.00", "20.00"]
    assert [row["balance_after"] for row in rows] == ["20.00", "5.00", "18.50"]
    assert rows[0]["localized_reason"] == "预付调查费"
    assert rows[0]["game_time"]["elapsed_minutes"] == 30
    assert rows[0]["player_time"]["phase"] == "morning"
    for row in rows:
        assert "reason" not in row
        assert "recorded_at" not in row
        dumped = json.dumps(row, ensure_ascii=False)
        assert "audit-" not in dumped
        assert "2026-04-08T12" not in dumped
    rendered = coc_turn_finalization._render_state_delta(
        rows[0], play_language="zh-Hans",
    )
    assert rendered == "【变化】现金：+20.00 USD（0.00 → 20.00）；预付调查费；时段：早上"
    assert "audit-advance-from-knott" not in rendered
    assert "2026-04-08" not in rendered
    spend = coc_turn_finalization._render_state_delta(
        rows[2], play_language="zh-Hans",
    )
    assert spend == "【变化】现金：-1.50 USD（20.00 → 18.50）；去波士顿街的车费；时段：早上"


def test_cash_game_time_projection_redacts_private_fields() -> None:
    game_time = {
        "elapsed_minutes": 45,
        "display": "1920-08-15 10:45",
        "display_sub": "上午",
        "local_datetime": "1920-08-15T10:45:00",
        "location_id": "secret-house-basement",
        "civil_segment_id": "civil-hidden-anchor",
        "provenance": {
            "kind": "cash-gt-malicious-provenance",
            "source_ref": "prov:cash-gt-source-ref-zx9",
            "secret": "prov-cash-gt-nested-secret-qw7",
        },
        "player_time": {
            "phase": "morning",
            "appearance_mode": "normal",
            "display_label": None,
            "source_ref": "module:haunting/page-12",
            "secret": "hidden-phase-token",
            "provenance": {
                "kind": "cash-pt-malicious-provenance",
                "source_ref": "prov:cash-pt-source-ref-lm4",
                "secret": "prov-cash-pt-nested-secret-vb2",
            },
        },
    }
    rows = coc_turn_finalization._project_state_deltas([{
        "ok": True,
        "tool": "state.cash_grant",
        "args": {"decision_id": "cash-redact", "investigator": "hero"},
        "data": {
            "investigator_id": "hero",
            "changed": True,
            "op": "grant",
            "amount": "20.00",
            "currency": "USD",
            "balance_before": "0.00",
            "balance_after": "20.00",
            "reason": "audit-private",
            "localized_reason": "预付调查费",
            "recorded_at": "2026-04-08T12:00:00+00:00",
            "game_time": game_time,
        },
    }])
    assert len(rows) == 1
    effect = rows[0]
    assert effect["localized_reason"] == "预付调查费"
    assert effect["game_time"]["elapsed_minutes"] == 45
    assert effect["game_time"]["display"] == "1920-08-15 10:45"
    assert effect["game_time"]["display_sub"] == "上午"
    assert effect["game_time"]["local_datetime"] == "1920-08-15T10:45:00"
    assert effect["player_time"]["phase"] == "morning"
    assert "location_id" not in effect["game_time"]
    assert "provenance" not in effect["game_time"]
    assert "source_ref" not in effect["game_time"].get("player_time", {})
    assert "provenance" not in effect["game_time"].get("player_time", {})
    assert "source_ref" not in effect["player_time"]
    assert "secret" not in effect["player_time"]
    assert "provenance" not in effect["player_time"]
    rendered = coc_turn_finalization._render_state_delta(
        effect, play_language="zh-Hans",
    )
    assert "预付调查费" in rendered
    bundle = {"public_check": [], "state_delta": rows, "exceptional_effect": []}
    segments, rendered_text, _ = coc_turn_finalization.compose_segments(
        "他收下信封。",
        bundle,
        [{
            "after_paragraph": 0,
            "segment_type": "state_delta",
            "source_ids": [effect["effect_id"]],
        }],
        play_language="zh-Hans",
    )
    receipt = {
        "bundle": bundle,
        "segments": segments,
        "rendered_text": rendered_text,
    }
    dumped = json.dumps({"effect": effect, **receipt}, ensure_ascii=False)
    for leaked in (
        "secret-house-basement",
        "civil-hidden-anchor",
        "module:haunting/page-12",
        "hidden-phase-token",
        "location_id",
        "source_ref",
        "audit-private",
        "provenance",
        "cash-gt-malicious-provenance",
        "prov:cash-gt-source-ref-zx9",
        "prov-cash-gt-nested-secret-qw7",
        "cash-pt-malicious-provenance",
        "prov:cash-pt-source-ref-lm4",
        "prov-cash-pt-nested-secret-vb2",
    ):
        assert leaked not in dumped
        assert leaked not in rendered
        assert leaked not in rendered_text
        assert leaked not in json.dumps(effect, ensure_ascii=False)
        assert leaked not in json.dumps(segments, ensure_ascii=False)
    assert "预付调查费" in dumped
    assert "45" in dumped
    assert "1920-08-15 10:45" in dumped
    assert any(seg["segment_type"] == "asset_delta" for seg in segments)
    assert not any(
        seg["segment_type"] == "state_delta" for seg in segments
    )


def _cash_call(decision_id: str, *, action: str, amount: str, before: str, after: str, reason: str) -> dict:
    game_time = {
        "elapsed_minutes": 30,
        "display": "1920-08-15 10:30",
        "player_time": {
            "phase": "morning",
            "appearance_mode": "normal",
            "display_label": None,
        },
    }
    return {
        "ok": True,
        "tool": f"state.cash_{action}",
        "args": {"decision_id": decision_id, "investigator": "hero"},
        "data": {
            "investigator_id": "hero",
            "changed": True,
            "op": action,
            "amount": amount,
            "currency": "USD",
            "balance_before": before,
            "balance_after": after,
            "reason": f"audit-{decision_id}",
            "localized_reason": reason,
            "game_time": game_time,
        },
    }


def test_unlinked_cash_and_item_compose_as_asset_delta() -> None:
    rows = coc_turn_finalization._project_state_deltas([
        _cash_call("cash-grant", action="grant", amount="20.00", before="0.00", after="20.00", reason="预付调查费"),
        _cash_call("cash-spend", action="spend", amount="1.50", before="20.00", after="18.50", reason="车费"),
        {
            "ok": True,
            "tool": "state.item_grant",
            "args": {"decision_id": "item-key", "investigator": "hero"},
            "data": {
                "investigator_id": "hero",
                "changed": True,
                "item_id": "house-key",
                "label": "钥匙",
                "present_before": False,
                "present_after": True,
                "quantity": 1,
            },
        },
    ])
    assert [row["effect_kind"] for row in rows] == ["cash", "cash", "item"]
    assert rows[2]["action"] == "acquired"
    assert rows[2]["quantity"] == 1
    assert "reason" not in rows[2]
    bundle = {"public_check": [], "state_delta": rows, "exceptional_effect": []}
    segments, rendered, placements = coc_turn_finalization.compose_segments(
        "他收下信封和钥匙。",
        bundle,
        [{
            "after_paragraph": 0,
            "segment_type": "state_delta",
            "source_ids": [row["effect_id"] for row in rows],
        }],
        play_language="zh-Hans",
    )
    asset_segs = [seg for seg in segments if seg["segment_type"] == "asset_delta"]
    other_delta = [seg for seg in segments if seg["segment_type"] == "state_delta"]
    assert len(asset_segs) == 1
    assert other_delta == []
    assert [row["segment_type"] for row in placements] == ["asset_delta"]
    fiction = "\n".join(seg["text"] for seg in segments if seg["segment_type"] == "fiction")
    assert "【变化】" not in fiction
    assert "【变化】" in asset_segs[0]["text"]
    assert "钥匙" in asset_segs[0]["text"]
    assert "audit-cash-grant" not in rendered


def test_mixed_hp_and_assets_split_asset_delta() -> None:
    rows = coc_turn_finalization._project_state_deltas([
        {
            "ok": True,
            "tool": "rules.damage",
            "args": {"decision_id": "hp-hit", "investigator": "hero"},
            "data": {
                "investigator_id": "hero",
                "hp_before": 12,
                "hp_after": 9,
                "player_facing": True,
            },
        },
        _cash_call("cash-grant", action="grant", amount="5.00", before="0.00", after="5.00", reason="打赏"),
        {
            "ok": True,
            "tool": "state.item_grant",
            "args": {"decision_id": "item-key", "investigator": "hero"},
            "data": {
                "investigator_id": "hero",
                "changed": True,
                "item_id": "house-key",
                "label": "钥匙",
            },
        },
    ])
    kinds = [row["effect_kind"] for row in rows]
    assert "scalar" in kinds and "cash" in kinds and "item" in kinds
    bundle = {"public_check": [], "state_delta": rows, "exceptional_effect": []}
    hp_id = next(row["effect_id"] for row in rows if row["effect_kind"] == "scalar")
    asset_ids = [row["effect_id"] for row in rows if row["effect_kind"] in {"cash", "item"}]
    segments, _rendered, _placements = coc_turn_finalization.compose_segments(
        "他擦去血迹。",
        bundle,
        [{
            "after_paragraph": 0,
            "segment_type": "state_delta",
            "source_ids": [row["effect_id"] for row in rows],
        }],
        play_language="zh-Hans",
    )
    state_segs = [seg for seg in segments if seg["segment_type"] == "state_delta"]
    asset_segs = [seg for seg in segments if seg["segment_type"] == "asset_delta"]
    assert len(state_segs) == 1
    assert state_segs[0]["source_ids"] == [hp_id]
    assert "HP" in state_segs[0]["text"] or "生命" in state_segs[0]["text"]
    assert "现金" not in state_segs[0]["text"]
    assert "钥匙" not in state_segs[0]["text"]
    assert len(asset_segs) == 1
    assert set(asset_segs[0]["source_ids"]) == set(asset_ids)
    assert "现金" in asset_segs[0]["text"]
    assert "钥匙" in asset_segs[0]["text"]


def test_roll_linked_asset_stays_out_of_unlinked_asset_repeat() -> None:
    cash_rows = coc_turn_finalization._project_state_deltas([
        _cash_call("cash-linked", action="spend", amount="1.50", before="20.00", after="18.50", reason="赌注"),
    ])
    hp_rows = coc_turn_finalization._project_state_deltas([
        {
            "ok": True,
            "tool": "rules.damage",
            "args": {"decision_id": "hp-hit", "investigator": "hero"},
            "data": {
                "investigator_id": "hero",
                "hp_before": 12,
                "hp_after": 9,
                "player_facing": True,
            },
        },
    ])
    cash_id = cash_rows[0]["effect_id"]
    hp_id = hp_rows[0]["effect_id"]
    bundle = {
        "public_check": [],
        "state_delta": hp_rows + cash_rows,
        "exceptional_effect": [],
    }
    sources = coc_turn_finalization._mechanic_source_lines(bundle, play_language="zh-Hans")
    assert cash_id in sources["asset_delta"]
    assert cash_id not in sources["state_delta"]
    assert hp_id in sources["state_delta"]
    segments, rendered, _ = coc_turn_finalization.compose_segments(
        "他擦去血迹。",
        bundle,
        [{
            "after_paragraph": 0,
            "segment_type": "state_delta",
            "source_ids": [hp_id, cash_id],
        }],
        play_language="zh-Hans",
    )
    asset_ids = [
        sid
        for seg in segments
        if seg["segment_type"] == "asset_delta"
        for sid in seg["source_ids"]
    ]
    assert asset_ids.count(cash_id) == 1
    assert rendered.count("1.50") == 1


def test_same_broad_phase_keeps_exact_advance_out_of_player_delta() -> None:
    rows = coc_turn_finalization._project_state_deltas([{
        "ok": True,
        "tool": "state.advance_time",
        "args": {"decision_id": "brief-conversation"},
        "data": {
            "from_elapsed": 0,
            "to_elapsed": 5,
            "previous_time": {"player_time": {
                "phase": "morning", "appearance_mode": "normal",
                "display_label": None,
            }},
            "current_time": {"player_time": {
                "phase": "morning", "appearance_mode": "normal",
                "display_label": None,
            }},
        },
    }])
    assert rows == []


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


def test_legacy_healing_event_projects_authoritative_hp_delta() -> None:
    rows = coc_turn_finalization._project_state_deltas([
        {
            "ok": True,
            "tool": "rules.first_aid",
            "args": {
                "investigator": "thomas-reed",
                "decision_id": "aid-before-player-state-receipt",
            },
            "data": {
                "investigator_id": "thomas-reed",
                "event": {"hp_before": 8, "hp_after": 9},
            },
        }
    ])

    assert rows == [{
        "schema_version": 1,
        "category": "state_delta",
        "effect_id": coc_turn_finalization._stable_effect_id(
            "aid-before-player-state-receipt", "scalar", "HP"
        ),
        "effect_kind": "scalar",
        "resource": "HP",
        "investigator_id": "thomas-reed",
        "before": 8,
        "delta": 1,
        "after": 9,
        "source_decision_id": "aid-before-player-state-receipt",
    }]


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
    assert any(
        "boundary.description" in hint and "active play_language" in hint
        for hint in fumble["hints"]
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
    advanced_time = call(
        "state.advance_time",
        {
            "minutes": 10,
            "reason": "the confrontation and argument",
            "decision_id": "advance-ten",
        },
    )
    assert advanced_time["data"]["from_elapsed"] == 0
    assert advanced_time["data"]["to_elapsed"] == 10
    assert advanced_time["data"]["current_time"]["player_time"]["phase"] == (
        "morning"
    )
    call(
        "state.journal",
        {
            "summary": "托马斯开枪后又试图用借口拖住赶来的档案员。",
            "player_action": "开枪，再用临场借口稳住对方",
            "player_text": "我开枪后立刻向档案员解释来意。",
            "run_id": run_id,
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
    assert not [
        row for row in bundle["state_delta"] if row["effect_kind"] == "time"
    ]
    assert all(
        row.get("investigator_id") in (None, investigator_id)
        for row in bundle["state_delta"]
    )
    assert "context_effect" not in bundle
    assert len(output_context["npc_performance_constraints"]) == 1
    assert len(bundle["exceptional_effect"]) == 1
    assert output_context["missing_substantive_effects"] == []
    assert "concealed_roll" not in json.dumps(
        output_context["npc_performance_constraints"], ensure_ascii=False
    )

    setup = "托马斯压低枪口，把临时拼出的查档理由一字不差地递过去。"
    excerpt = (
        "档案员先被他的体面外表稳住，听到第二处破绽时却猛地伸手按向警铃。"
        "枪声留下的硝烟还贴在天花板下，一块灰泥砸上他的肩头；"
        "他攥住刚拿到的访客证，窗外仍是上午的冷白天光。"
    )
    draft = setup + "\n\n" + excerpt
    mechanics_placements = _placements(bundle)

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
        {"draft": draft, "coverage": coverage[:-1], "mechanics_placements": mechanics_placements, "revision": 1, "decision_id": "missing"},
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
            "mechanics_placements": mechanics_placements,
            "revision": 1,
            "decision_id": "missing-exception",
        },
    )
    assert exceptional["ok"] is False
    assert exceptional["error"]["code"] == "exceptional_beat_required"

    late_rolls = [
        {**row, "after_paragraph": 1}
        if row["segment_type"] == "public_check" else row
        for row in mechanics_placements
    ]
    late = coc_toolbox.run_tool(
        "turn.finalize",
        workspace,
        campaign_id,
        {
            "draft": draft,
            "coverage": coverage,
            "mechanics_placements": late_rolls,
            "revision": 1,
            "decision_id": "rolls-after-consequence",
        },
    )
    assert late["ok"] is False
    assert late["error"]["code"] == "roll_after_consequence"

    finalized = call(
        "turn.finalize",
        {"draft": draft, "coverage": coverage, "revision": 1, "decision_id": "final-turn-one"},
    )
    replay = call(
        "turn.finalize",
        {"draft": draft, "coverage": coverage, "revision": 1, "decision_id": "final-turn-one"},
    )
    assert replay["data"] == finalized["data"]
    rendered = finalized["data"]["rendered_text"]
    setup_at = rendered.index(setup)
    roll_at = rendered.index("【明骰】")
    result_at = rendered.index(excerpt)
    delta_at = rendered.index("【变化】")
    exceptional_at = rendered.index("【特殊影响】")
    assert setup_at == 0
    assert setup_at < roll_at < result_at < delta_at < exceptional_at
    assert "【明骰】话术" in rendered
    assert "【明骰】Fast Talk" not in rendered
    assert "【初次反应】" not in rendered
    assert public_context["causal_explanation"] not in rendered
    assert public_context["opportunity_or_friction"] not in rendered
    assert public_context["boundary_preserved"] not in rendered
    assert "对方最初表现：" not in rendered
    assert "原始：80；幸运 -30；调整：50" in rendered
    assert "不含未建账的备用弹药" in rendered
    assert "持续至本场景结束" in rendered
    assert "corbitt-confrontation" not in rendered
    assert finalized["data"]["rendered_text_sha256"].startswith("sha256:")
    assert finalized["data"]["run_segment_id"] == run_id
    assert finalized["data"]["session_id"].startswith("direct-toolbox:")
    assert finalized["data"]["turn_id"] == output_context["turn_id"]
    assert finalized["data"]["accepted_revision"] == 1


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
    scene = call("scene.context")["data"]
    active_scene_id = str(scene["active_scene_id"])
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
        {"summary": "The attempt fumbled.", "player_text": "我孤注一掷地继续搜索。", "decision_id": "missing-effect-journal"},
    )
    context = call("turn.output_context")["data"]
    turn_id = context["turn_id"]
    first_manifest_revision = context["manifest_revision"]
    assert context["missing_substantive_effects"] == [{
        "obligation_id": f"roll:{pushed['data']['roll_id']}",
        "source_roll_id": pushed["data"]["roll_id"],
        "required_direction": "cost",
    }]
    result = coc_toolbox.run_tool(
        "turn.finalize",
        workspace,
        "exceptional-missing",
        {"draft": "失败带来了麻烦。", "coverage": [], "mechanics_placements": [], "revision": 1, "decision_id": "must-fail"},
    )
    assert result["ok"] is False
    assert result["error"]["code"] == "substantive_exceptional_effect_required"

    # A poisoned turn is isolated: it cannot absorb a later journal, but the
    # source-bound exceptional consequence may still repair this same turn.
    blocked = coc_toolbox.run_tool(
        "state.journal",
        workspace,
        "exceptional-missing",
        {"summary": "must not become another turn", "player_text": "我试图开始另一轮行动。", "decision_id": "blocked-journal"},
    )
    assert blocked["ok"] is False
    assert blocked["error"]["code"] == "turn_finalization_pending"

    applied = call(
        "state.exceptional_effect",
        {
            "action": "apply",
            "source_roll_id": pushed["data"]["roll_id"],
            "direction": "cost",
            "effect_kind": "restriction",
            "player_visible_impact": "管理员锁上档案室，并通知警卫核查那条伪造的查阅链",
            "causal_link": "孤注一掷中补造的索引留下了可追查的矛盾",
            "boundary": {"kind": "until_condition", "description": "管理员确认查阅链已经重新核实"},
            "mechanics": {
                "subject_id": investigator_id,
                "restriction_id": "archive-access-locked",
                "scope": "档案室拒绝继续调卷",
                "scene_id": active_scene_id,
            },
            "visibility": "player_visible",
            "decision_id": "repair-pushed-failure",
        },
    )
    repaired = call("turn.output_context")["data"]
    assert repaired["turn_id"] == turn_id
    assert repaired["manifest_revision"] > first_manifest_revision
    assert repaired["repair_call_count"] == 1
    assert repaired["missing_substantive_effects"] == []

    setup = "托马斯把补造的证人索引递到管理员面前。"
    excerpt = "管理员循着伪造索引的矛盾锁上档案室，又抄起电话通知警卫。"
    draft = setup + "\n\n" + excerpt
    coverage = [
        {
            "obligation_id": obligation["obligation_id"],
            "realization": "fictional_beat",
            "action_realization": "托马斯孤注一掷地重编了证人索引",
            "response": "管理员发现矛盾后封锁档案室并通知警卫",
            "causal_explanation": "补造索引留下的可追查矛盾暴露了托马斯的企图",
            "persona_fit": "符合托马斯依赖记者经验临场补造查阅理由的做法",
            "player_input_handling": "abstract_completed",
            "exact_excerpt": excerpt,
            "exceptional_beat": (
                "档案室被封锁，警卫介入，形成持续到离场的新增压力"
                if obligation["exceptional_required"] else ""
            ),
        }
        for obligation in repaired["obligations"]
    ]
    finalized = call(
        "turn.finalize",
        {
            "draft": draft,
            "coverage": coverage,
            "mechanics_placements": _placements(repaired["mechanics_bundle"]),
            "revision": 1,
            "decision_id": "repair-finalize",
        },
    )["data"]
    manifest_path = (
        workspace
        / ".coc"
        / "campaigns"
        / "exceptional-missing"
        / "save"
        / "turn-manifests"
        / f"{turn_id}.json"
    )
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert manifest["status"] == "finalized"
    assert manifest["finalization_id"] == finalized["finalization_id"]

    resolution = call(
        "rules.roll",
        {
            "investigator": investigator_id,
            "skill": "Fast Talk",
            "target": 50,
            "difficulty": "regular",
            "goal": "reconcile the archive chain",
            "stakes": {"on_success": "the chain is verified", "on_failure": "it remains blocked"},
            "difficulty_basis": "keeper_judgment",
            "seed": 88,
            "decision_id": "resolve-archive-restriction-roll",
        },
    )
    assert resolution["data"]["roll"] == 51
    assert resolution["data"]["passed"] is False
    adjusted_resolution = call(
        "rules.luck_spend",
        {
            "investigator": investigator_id,
            "source_roll_id": resolution["data"]["roll_id"],
            "points": 1,
            "decision_id": "resolve-archive-restriction-luck",
        },
    )
    assert adjusted_resolution["data"]["adjusted_roll"] == 50
    assert adjusted_resolution["data"]["passed"] is True
    resolved = call(
        "state.exceptional_effect",
        {
            "action": "resolve",
            "effect_id": applied["data"]["effect"]["effect_id"],
            "resolution_roll_id": resolution["data"]["roll_id"],
            "resolution_reason": "the successful reconciliation satisfies the recorded archive-verification boundary",
            "decision_id": "resolve-archive-restriction",
        },
    )
    assert resolved["data"]["effect"]["status"] == "resolved"
    assert call("scene.context")["data"]["continuity"]["active_exceptional_effects"] == []

    event_backed = call(
        "state.exceptional_effect",
        {
            "action": "apply",
            "source_roll_id": pushed["data"]["roll_id"],
            "direction": "cost",
            "effect_kind": "restriction",
            "player_visible_impact": "警卫要求托马斯离开档案室",
            "causal_link": "同一条伪造查阅链触发了现场驱离",
            "boundary": {
                "kind": "until_condition",
                "description": "托马斯已经离开档案室",
            },
            "mechanics": {
                "subject_id": investigator_id,
                "restriction_id": "leave-archive",
                "scope": "留在档案室会被警卫阻拦",
                "scene_id": active_scene_id,
            },
            "visibility": "player_visible",
            "decision_id": "event-backed-restriction",
        },
    )
    call(
        "state.move_scene",
        {
            "scene_id": "event-resolution-place",
            "reason": "托马斯依要求离开档案室",
            "decision_id": "event-resolution-move",
        },
    )
    event_resolved = call(
        "state.exceptional_effect",
        {
            "action": "resolve",
            "effect_id": event_backed["data"]["effect"]["effect_id"],
            "resolution_event_ids": ["event-resolution-move"],
            "resolution_reason": "权威场景移动记录证明托马斯已经离开档案室",
            "decision_id": "resolve-by-event",
        },
    )
    assert event_resolved["data"]["effect"]["status"] == "resolved"
    assert event_resolved["data"]["effect"]["consumed_by_roll_id"] is None

    second_journal = call(
        "state.journal",
        {"summary": "A genuinely new turn.", "player_text": "我开始一轮新的行动。", "decision_id": "second-journal"},
    )
    second_context = call("turn.output_context")["data"]
    assert second_journal["data"]["turn_id"] != turn_id
    assert second_context["source_start_index"] > repaired["journal_call_index"]
    assert second_context["source_roll_ids"] == [resolution["data"]["roll_id"]]


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


def test_public_roll_labels_follow_play_language_not_hardcoded_chinese(
    tmp_path: Path,
) -> None:
    """Public rolls use campaign play_language vocabulary, never forced Chinese."""
    import coc_turn_finalization as tf

    def _camp(lang: str) -> Path:
        workspace = tmp_path / lang
        campaign_dir = workspace / ".coc" / "campaigns" / "c1"
        inv_dir = workspace / ".coc" / "investigators" / "hero"
        campaign_dir.mkdir(parents=True)
        inv_dir.mkdir(parents=True)
        _write_json(
            campaign_dir / "campaign.json",
            {
                "schema_version": 1,
                "campaign_id": "c1",
                "title": "t",
                "mode": "keeper",
                "status": "active",
                "era": "1930s",
                "play_language": lang,
            },
        )
        _write_json(
            inv_dir / "character.json",
            {
                "schema_version": 1,
                "id": "hero",
                "name": "X",
                "occupation": "x",
                "era": "1930s",
                "age": 30,
                "sex": "M",
                "characteristics": {},
                "derived": {},
                "skills": {"Drive Auto": 50},
            },
        )
        return campaign_dir

    zh = _camp("zh-Hans")
    rolls_zh = [{"skill": "Drive Auto", "investigator_id": "hero", "actor": "hero"}]
    tf._attach_structured_skill_labels(zh, rolls_zh)
    assert rolls_zh[0]["display_skill"] == "汽车驾驶"
    line_zh = tf._render_public_roll(
        {
            "display_skill": rolls_zh[0]["display_skill"],
            "skill": "Drive Auto",
            "kind": "skill_check",
            "roll": 52,
            "base_target": 50,
            "required_level": "regular",
            "required_target": 50,
            "achieved_level": "failure",
            "passed": False,
            "surplus_levels": 0,
            "outcome": "failure",
        },
        play_language="zh-Hans",
    )
    assert "【明骰】汽车驾驶｜" in line_zh
    assert "Drive Auto" not in line_zh
    assert "失败" in line_zh

    language_roll_zh = [
        {
            "skill": "Language (Own: English)",
            "investigator_id": "hero",
            "actor": "hero",
        }
    ]
    tf._attach_structured_skill_labels(zh, language_roll_zh)
    assert language_roll_zh[0]["display_skill"] == "母语（英语）"
    language_line_zh = tf._render_public_roll(
        {
            **language_roll_zh[0],
            "kind": "skill_check",
            "roll": 75,
            "base_target": 40,
            "required_level": "regular",
            "required_target": 40,
            "achieved_level": "failure",
            "passed": False,
            "surplus_levels": 0,
            "outcome": "failure",
        },
        play_language="zh-Hans",
    )
    assert "【明骰】母语（英语）｜" in language_line_zh
    assert "Language (Own: English)" not in language_line_zh

    generic_die_zh = tf._render_public_roll(
        {
            "kind": "dice",
            "die_expression": "1D3",
            "individual_faces": [3],
            "final_total": 3,
        },
        play_language="zh-Hans",
    )
    assert generic_die_zh == "【明骰】骰值（1D3）：骰面 3 → 总值 3"
    assert "dice" not in generic_die_zh

    hp_damage_zh = tf._render_public_roll(
        {
            "kind": "hp_damage",
            "die_expression": "1D4",
            "individual_faces": [3],
            "final_total": 3,
        },
        play_language="zh-Hans",
    )
    assert hp_damage_zh == "【明骰】伤害（1D4）：骰面 3 → 总值 3"
    assert "hp_damage" not in hp_damage_zh

    unknown_amount_zh = tf._render_public_roll(
        {
            "kind": "future_amount_enum",
            "roll_role": "amount",
            "die_expression": "1D2",
            "individual_faces": [1],
            "final_total": 1,
        },
        play_language="zh-Hans",
    )
    assert unknown_amount_zh == "【明骰】骰值（1D2）：骰面 1 → 总值 1"
    assert "future_amount_enum" not in unknown_amount_zh

    en = _camp("en-US")
    rolls_en = [{"skill": "Drive Auto", "investigator_id": "hero", "actor": "hero"}]
    tf._attach_structured_skill_labels(en, rolls_en)
    # English table keeps the canonical skill key as the display form.
    assert rolls_en[0]["display_skill"] == "Drive Auto"
    line_en = tf._render_public_roll(
        {
            "display_skill": rolls_en[0]["display_skill"],
            "skill": "Drive Auto",
            "kind": "skill_check",
            "roll": 52,
            "base_target": 50,
            "required_level": "regular",
            "required_target": 50,
            "achieved_level": "failure",
            "passed": False,
            "surplus_levels": 0,
            "outcome": "failure",
        },
        play_language="en-US",
    )
    assert "【Public roll】Drive Auto｜" in line_en
    assert "明骰" not in line_en
    assert "汽车驾驶" not in line_en
    assert "not passed" in line_en

    generic_die_en = tf._render_public_roll(
        {
            "kind": "dice",
            "die_expression": "1D3",
            "individual_faces": [3],
            "final_total": 3,
        },
        play_language="en-US",
    )
    assert generic_die_en == "【Public roll】Die（1D3）：faces 3 → total 3"


def test_finalize_collects_all_violations_and_validate_only_preflight(
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
        campaign_id="collect-vertical",
        title="Collect Vertical",
    )
    campaign_id = "collect-vertical"
    investigator_id = str(quick["investigator_id"])

    def call(tool: str, args: dict | None = None) -> dict:
        result = coc_toolbox.run_tool(
            tool, workspace, campaign_id, dict(args or {})
        )
        assert result["ok"] is True, result
        return result

    call(
        "rules.roll",
        {
            "investigator": investigator_id,
            "skill": "Fast Talk",
            "target": 50,
            "difficulty": "regular",
            "goal": "稳住档案员",
            "stakes": {"on_success": "档案员放行", "on_failure": "档案员起疑"},
            "difficulty_basis": "keeper_judgment",
            "seed": 5,
            "decision_id": "collect-roll",
        },
    )
    call(
        "state.journal",
        {
            "summary": "调查员试图稳住档案员。",
            "player_action": "稳住档案员",
            "player_text": "我放缓语气，重新说明来意。",
            "intent_class": "social",
            "decision_id": "journal-collect",
        },
    )
    output_context = call("turn.output_context")["data"]
    obligations = output_context["obligations"]
    assert obligations
    setup = "调查员把语气放缓，向 Macario 把来意又说了一遍。"
    result_par = "档案员盯着他看了几秒，手指悬在警铃上方。"
    draft = setup + "\n\n" + result_par

    def coverage_rows(excerpt: str) -> list[dict]:
        return [
            {
                "obligation_id": obligation["obligation_id"],
                "realization": "fictional_beat",
                "action_realization": "调查员放缓语气重申来意",
                "response": "档案员迟疑不决",
                "causal_explanation": "话术结果决定档案员是否放行",
                "persona_fit": "符合调查员先礼后兵的作风",
                "player_input_handling": "specific_preserved",
                "exact_excerpt": excerpt,
                "exceptional_beat": "",
            }
            for obligation in obligations
        ]

    good_coverage = coverage_rows("档案员盯着他看了几秒")
    bundle = output_context["mechanics_bundle"]
    valid_placements = _placements(bundle)
    campaign_dir = coc_root / "campaigns" / campaign_id

    preflight = coc_toolbox.run_tool(
        "turn.finalize",
        workspace,
        campaign_id,
        {
            "draft": draft,
            "coverage": good_coverage,
            "mechanics_placements": valid_placements,
            "revision": 1,
            "decision_id": "collect-final",
            "validate_only": True,
        },
    )
    assert preflight["ok"] is True
    assert preflight["data"]["would_finalize"] is True
    assert preflight["data"]["violations"] == []
    assert (
        coc_turn_finalization.finalization_by_decision(campaign_dir, "collect-final")
        is None
    )

    first_paragraph_args = {
        "draft": result_par,
        "coverage": coverage_rows("档案员盯着他看了几秒"),
        "revision": 1,
        "decision_id": "collect-first-paragraph",
    }
    first_paragraph_preflight = coc_toolbox.run_tool(
        "turn.finalize",
        workspace,
        campaign_id,
        {**first_paragraph_args, "validate_only": True},
    )
    first_paragraph_commit = coc_toolbox.run_tool(
        "turn.finalize",
        workspace,
        campaign_id,
        first_paragraph_args,
    )
    assert first_paragraph_preflight["ok"] is False
    assert first_paragraph_commit["ok"] is False
    assert (
        first_paragraph_preflight["error"]["code"]
        == first_paragraph_commit["error"]["code"]
        == "default_mechanics_placement_unavailable"
    )
    assert "paragraph zero" in first_paragraph_commit["error"]["message"]
    assert (
        coc_turn_finalization.finalization_by_decision(
            campaign_dir, "collect-first-paragraph"
        )
        is None
    )

    bad_coverage = coverage_rows("这句摘录不在草稿里。")
    bad_placements = [
        {"after_paragraph": 0, "segment_type": "public_check", "source_ids": ["fake-roll-id"]},
        *valid_placements,
        {"after_paragraph": 99, "segment_type": "public_check", "source_ids": ["bogus-roll"]},
    ]
    bad_args = {
        "draft": draft,
        "coverage": bad_coverage,
        "mechanics_placements": bad_placements,
        "revision": 1,
        "decision_id": "collect-bad",
    }
    rejected = coc_toolbox.run_tool(
        "turn.finalize", workspace, campaign_id, bad_args
    )
    assert rejected["ok"] is False
    assert rejected["error"]["code"] == "excerpt_mismatch"
    codes = [row["code"] for row in rejected["error"]["violations"]]
    assert codes.count("excerpt_mismatch") == len(obligations)
    assert "unknown_mechanics_source" in codes
    assert "invalid_mechanics_placement" in codes
    stages = {row["stage"] for row in rejected["error"]["violations"]}
    assert {"coverage", "mechanics_placements"} <= stages
    assert (
        coc_turn_finalization.finalization_by_decision(campaign_dir, "collect-bad")
        is None
    )

    dry_run = coc_toolbox.run_tool(
        "turn.finalize",
        workspace,
        campaign_id,
        {**bad_args, "decision_id": "collect-bad-dry", "validate_only": True},
    )
    assert dry_run["ok"] is False
    assert [row["code"] for row in dry_run["error"]["violations"]] == codes
    assert (
        coc_turn_finalization.finalization_by_decision(campaign_dir, "collect-bad-dry")
        is None
    )

    finalized = call(
        "turn.finalize",
        {
            "draft": draft,
            "coverage": good_coverage,
            "mechanics_placements": valid_placements,
            "revision": 1,
            "decision_id": "collect-final",
        },
    )
    assert "马卡里奥" in finalized["data"]["rendered_text"]
    assert "Macario" not in finalized["data"]["rendered_text"]
    assert coc_turn_finalization.replay_matches(
        finalized["data"],
        draft=draft,
        coverage=good_coverage,
        mechanics_placements=valid_placements,
        revision=1,
        narration_review=None,
        agency_claims=[],
    )


def test_first_impression_line_and_fiction_localize_english_names() -> None:
    line = coc_turn_finalization._render_public_roll(
        {
            "kind": "npc_first_impression",
            "npc_display_name": "Steven Knott",
            "app": 60,
            "credit_rating": 40,
            "governing_attribute": "app",
            "governing_value": 60,
            "roll": 20,
            "base_target": 60,
            "required_level": "regular",
            "required_target": 60,
            "achieved_level": "hard",
            "passed": True,
            "surplus_levels": 1,
            "outcome": "hard",
        },
        play_language="zh-Hans",
    )
    assert "史蒂文·诺特" in line
    assert "Steven Knott" not in line
    segments, rendered, _placements = coc_turn_finalization.compose_segments(
        "Knott stood still.\n\nMacario waited by the door.",
        {"public_check": [], "state_delta": [], "exceptional_effect": []},
        [],
        coverage=[],
        play_language="zh-Hans",
    )
    assert segments[0]["text"] == "诺特 stood still."
    assert "马卡里奥" in rendered
    assert "Knotting" not in rendered


def _collect_roll_ids(value: object) -> set[str]:
    found: set[str] = set()
    if isinstance(value, dict):
        for key, child in value.items():
            if (
                (key == "roll_id" or str(key).endswith("_roll_id"))
                and isinstance(child, str)
                and child
            ):
                found.add(child)
            else:
                found.update(_collect_roll_ids(child))
    elif isinstance(value, list):
        for child in value:
            found.update(_collect_roll_ids(child))
    return found


def _assert_pi_output_context_contract(envelope: dict) -> None:
    assert envelope["ok"] is True
    assert envelope["tool"] == "turn.output_context"
    data = envelope["data"]
    operation = data["agency_review_operation"]
    assert isinstance(operation, dict)
    prefilled = operation["prefilled_arguments"]
    assert isinstance(prefilled, dict)
    revision = prefilled["revision"]
    assert isinstance(revision, int) and not isinstance(revision, bool)
    assert revision >= 1
    refs = data["contract_projection"]["agency_authority"]["pc_subject_refs"]
    assert isinstance(refs, list) and refs
    assert all(isinstance(ref, str) and ref.strip() for ref in refs)
    for key in (
        "turn_id", "source_digest", "settlement_snapshot_id",
        "mechanics_bundle_sha256",
    ):
        assert isinstance(data.get(key), str) and data[key]


def test_pc_subject_refs_survive_failed_combat_when_party_is_empty(
    tmp_path: Path,
) -> None:
    campaign_dir = tmp_path / "campaign"
    campaign_dir.mkdir()
    _write_json(
        campaign_dir / "party.json",
        {
            "schema_version": 1,
            "campaign_id": "campaign",
            "investigator_ids": [],
            "active_investigator_ids": [],
        },
    )
    window = [
        {
            "ok": True,
            "tool": "combat.resolve",
            "args": {
                "investigator": "thomas-hayes",
                "decision_id": "combat-ok",
            },
            "data": {"investigator_id": "thomas-hayes"},
        },
        {
            "ok": False,
            "tool": "combat.resolve",
            "args": {
                "investigator": "thomas-hayes",
                "decision_id": "combat-fail-1",
            },
            "data": None,
        },
        {
            "ok": False,
            "tool": "combat.resolve",
            "args": {
                "investigator": "thomas-hayes",
                "decision_id": "combat-fail-2",
            },
            "data": None,
        },
    ]
    failed_only = [row for row in window if row.get("ok") is not True]
    refs = coc_turn_finalization._pc_subject_refs(
        campaign_dir,
        window=failed_only,
        journal={"args": {"decision_id": "journal-mixed"}, "data": {}},
    )
    assert refs == ["pc:thomas-hayes"]
    deltas = coc_turn_finalization._project_state_deltas(window)
    assert all(row.get("source_decision_id") != "combat-fail-1" for row in deltas)
    assert all(row.get("source_decision_id") != "combat-fail-2" for row in deltas)


def test_mixed_combat_pending_turn_keeps_pc_subject_refs(
    tmp_path: Path, monkeypatch,
) -> None:
    monkeypatch.setenv("COC_PI_SESSION_ROLE", "play")
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
        campaign_id="mixed-combat-agency",
        title="Mixed Combat Agency",
    )
    campaign_id = "mixed-combat-agency"
    campaign_dir = Path(quick["campaign_dir"])
    investigator_id = str(quick["investigator_id"])

    def invoke(tool: str, args: dict | None = None) -> dict:
        result = coc_toolbox.run_tool(
            tool, workspace, campaign_id, dict(args or {})
        )
        assert isinstance(result, dict)
        return result

    moved = invoke(
        "state.move_scene",
        {"scene_id": "corbitt-confrontation", "decision_id": "move-mixed-combat"},
    )
    assert moved["ok"] is True, moved
    successes = []
    for index in range(2):
        resolved = invoke(
            "combat.resolve",
            {
                "affordance_id": "conventional-assault",
                "investigator": investigator_id,
                "weapon_id": "unarmed",
                "decision_id": f"combat-ok-{index}",
                "seed": 7 + index,
            },
        )
        assert resolved["ok"] is True, resolved
        successes.append(resolved)
    failures = []
    for index in range(2):
        failed = invoke(
            "combat.resolve",
            {
                "affordance_id": "not-a-real-affordance",
                "investigator": investigator_id,
                "weapon_id": "unarmed",
                "decision_id": f"combat-fail-{index}",
            },
        )
        assert failed["ok"] is False, failed
        failures.append(failed)
    journal = invoke(
        "state.journal",
        {
            "summary": "调查员对干尸连刺数次，有的落空有的命中。",
            "player_text": "我抽出匕首刺向那具干尸。",
            "decision_id": "journal-mixed-combat",
        },
    )
    assert journal["ok"] is True, journal

    context = coc_turn_finalization.build_output_context(campaign_dir)
    refs = context["contract_projection"]["agency_authority"]["pc_subject_refs"]
    assert f"pc:{investigator_id}" in refs
    public_ids = {
        str(row.get("roll_id") or "")
        for row in context["mechanics_bundle"]["public_check"]
        if isinstance(row, dict)
    }
    public_ids.discard("")
    failed_roll_ids = set()
    for row in failures:
        failed_roll_ids.update(_collect_roll_ids(row.get("data")))
        failed_roll_ids.update(_collect_roll_ids(row.get("error")))
    assert not failed_roll_ids & public_ids

    first = invoke("turn.output_context")
    _assert_pi_output_context_contract(first)
    assert f"pc:{investigator_id}" in first["data"]["contract_projection"][
        "agency_authority"
    ]["pc_subject_refs"]
    assert first["data"]["agency_review_operation"]["operation"] == "narration.review"
    replay = invoke("turn.output_context")
    assert replay["ok"] is True, replay
    assert replay["data"]["source_digest"] == first["data"]["source_digest"]
    assert replay["data"]["settlement_snapshot_id"] == first["data"][
        "settlement_snapshot_id"
    ]
    assert replay["data"]["source_roll_ids"] == first["data"]["source_roll_ids"]
