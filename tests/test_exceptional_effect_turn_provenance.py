"""Current-turn provenance for exceptional-effect finalization."""
from __future__ import annotations

import json
from pathlib import Path
import sys

import pytest


SCRIPTS = Path(__file__).resolve().parents[1] / "plugins" / "coc-keeper" / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import coc_exceptional_effects
import coc_starter
import coc_toolbox
import coc_turn_finalization


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def _make_effect(
    *,
    created_decision_id: str,
    source_roll_id: str,
    status: str = "active",
    consumed_decision_id: str | None = None,
    consumed_by_roll_id: str | None = None,
    condition_id: str = "wound_pressure_failed",
) -> dict:
    effect = {
        "schema_version": 1,
        "effect_id": coc_exceptional_effects.stable_effect_id(
            created_decision_id, source_roll_id
        ),
        "source_roll": {
            "tool": "rules.roll",
            "decision_id": f"{created_decision_id}-source",
            "roll_id": source_roll_id,
            "integrity_digest": "sha256:source",
            "outcome": "fumble",
            "pushed": False,
            "visibility": "public",
        },
        "direction": "cost",
        "effect_kind": "condition",
        "player_visible_impact": "伤口压迫让下一次行动更痛",
        "causal_link": "失败的压迫让伤口裂开",
        "boundary": {"kind": "until_condition", "description": "包扎完成"},
        "mechanics": {
            "target_id": "hero",
            "condition_id": condition_id,
            "scene_id": "corbitt-confrontation",
        },
        "visibility": "player_visible",
        "status": status,
        "created_at": "2026-01-01T00:00:00Z",
        "created_decision_id": created_decision_id,
        "consumed_at": "2026-01-01T00:01:00Z" if consumed_decision_id else None,
        "consumed_decision_id": consumed_decision_id,
        "consumed_by_roll_id": consumed_by_roll_id,
        "integrity_digest": "",
    }
    effect["integrity_digest"] = coc_exceptional_effects.canonical_digest({
        key: value for key, value in effect.items() if key != "integrity_digest"
    })
    assert coc_exceptional_effects.valid_effect(effect)
    return effect


def _effect_call(action: str, effect: dict, decision_id: str) -> dict:
    return {
        "ok": True,
        "tool": "state.exceptional_effect",
        "args": {"action": action, "decision_id": decision_id},
        "data": {
            "action": action,
            "effect": effect,
            "player_effect": coc_exceptional_effects.project_player_effect(effect),
        },
    }


def _project(window, *, current_roll_ids, prior_event_ids=None, prior_effect_ids=None):
    return coc_turn_finalization._project_exceptional_effects(
        window,
        current_roll_ids=set(current_roll_ids),
        prior_event_ids=set(prior_event_ids or ()),
        prior_effect_ids=set(prior_effect_ids or ()),
    )


def test_stale_cross_turn_apply_is_rejected() -> None:
    stale = _make_effect(
        created_decision_id="t18-apply",
        source_roll_id="roll-t18",
        condition_id="wound_pressure_failed",
    )
    current = _make_effect(
        created_decision_id="t20-apply",
        source_roll_id="roll-t20",
        condition_id="wound_pressure_failed_t20",
    )
    with pytest.raises(coc_turn_finalization.TurnContractError) as exc:
        _project(
            [_effect_call("apply", stale, "t18-apply"), _effect_call("apply", current, "t20-apply")],
            current_roll_ids={"roll-t18", "roll-t20"},
            prior_effect_ids={stale["effect_id"]},
            prior_event_ids={coc_exceptional_effects.project_player_effect(stale)["event_id"]},
        )
    assert exc.value.code == "state_corrupt"
    assert "already finalized" in str(exc.value)


def test_current_turn_apply_projects_once() -> None:
    current = _make_effect(
        created_decision_id="t20-apply",
        source_roll_id="roll-t20",
        condition_id="wound_pressure_failed_t20",
    )
    events, applies = _project(
        [_effect_call("apply", current, "t20-apply")],
        current_roll_ids={"roll-t20"},
    )
    assert [row["effect_id"] for row in applies] == [current["effect_id"]]
    assert [row["event_id"] for row in events] == [
        coc_exceptional_effects.project_player_effect(current)["event_id"]
    ]


def test_prior_event_id_fails_closed() -> None:
    current = _make_effect(
        created_decision_id="t20-apply",
        source_roll_id="roll-t20",
    )
    event_id = coc_exceptional_effects.project_player_effect(current)["event_id"]
    with pytest.raises(coc_turn_finalization.TurnContractError) as exc:
        _project(
            [_effect_call("apply", current, "t20-apply")],
            current_roll_ids={"roll-t20"},
            prior_event_ids={event_id},
        )
    assert exc.value.code == "state_corrupt"
    assert "already finalized" in str(exc.value)


def test_explicit_current_turn_resolve_is_accepted_once() -> None:
    resolved = _make_effect(
        created_decision_id="t18-apply",
        source_roll_id="roll-t18",
        status="resolved",
        consumed_decision_id="t20-resolve",
        consumed_by_roll_id="roll-t20-resolve",
    )
    events, applies = _project(
        [_effect_call("resolve", resolved, "t20-resolve")],
        current_roll_ids={"roll-t20-resolve"},
    )
    assert applies == []
    assert [row["status"] for row in events] == ["resolved"]
    assert [row["effect_id"] for row in events] == [resolved["effect_id"]]


def test_same_turn_apply_and_resolve_render_once() -> None:
    applied = _make_effect(
        created_decision_id="t20-apply",
        source_roll_id="roll-t20",
    )
    resolved = _make_effect(
        created_decision_id="t20-apply",
        source_roll_id="roll-t20",
        status="resolved",
        consumed_decision_id="t20-resolve",
        consumed_by_roll_id="roll-t20-resolve",
    )
    events, applies = _project(
        [
            _effect_call("apply", applied, "t20-apply"),
            _effect_call("resolve", resolved, "t20-resolve"),
        ],
        current_roll_ids={"roll-t20", "roll-t20-resolve"},
    )
    assert [row["effect_id"] for row in applies] == [applied["effect_id"]]
    assert [row["status"] for row in events] == ["resolved"]


def test_duplicate_effect_events_fail_closed() -> None:
    first = _make_effect(
        created_decision_id="t20-apply-a",
        source_roll_id="roll-t20",
        condition_id="wound_pressure_failed",
    )
    second = dict(first)
    second["created_decision_id"] = "t20-apply-b"
    second["integrity_digest"] = ""
    second["integrity_digest"] = coc_exceptional_effects.canonical_digest({
        key: value for key, value in second.items() if key != "integrity_digest"
    })
    first_player = coc_exceptional_effects.project_player_effect(first)
    second_player = dict(first_player)
    second_player["event_id"] = f"{first['effect_id']}:active:t20-apply-b"
    window = [
        _effect_call("apply", first, "t20-apply-a"),
        {
            "ok": True,
            "tool": "state.exceptional_effect",
            "args": {"action": "apply", "decision_id": "t20-apply-a"},
            "data": {
                "action": "apply",
                "effect": first,
                "player_effect": second_player,
            },
        },
    ]
    with pytest.raises(coc_turn_finalization.TurnContractError) as exc:
        _project(window, current_roll_ids={"roll-t20"})
    assert exc.value.code == "state_corrupt"


def test_missing_decision_provenance_fails_closed() -> None:
    current = _make_effect(
        created_decision_id="t20-apply",
        source_roll_id="roll-t20",
    )
    call = _effect_call("apply", current, "t20-apply")
    call["args"] = {"action": "apply"}
    with pytest.raises(coc_turn_finalization.TurnContractError) as exc:
        _project([call], current_roll_ids={"roll-t20"})
    assert exc.value.code == "state_corrupt"
    assert "decision provenance" in str(exc.value)


def test_one_effect_renders_one_exceptional_segment() -> None:
    current = _make_effect(
        created_decision_id="t20-apply",
        source_roll_id="roll-t20",
    )
    player = coc_exceptional_effects.project_player_effect(current)
    bundle = {"public_check": [], "state_delta": [], "exceptional_effect": [player]}
    segments, rendered, _placements = coc_turn_finalization.compose_segments(
        "托马斯撑住门框。\n\n伤口又一次裂开。",
        bundle,
        [{
            "after_paragraph": 1,
            "segment_type": "exceptional_effect",
            "source_ids": [player["event_id"]],
        }],
        coverage=[],
        play_language="zh-Hans",
    )
    exceptional = [
        row for row in segments if row.get("segment_type") == "exceptional_effect"
    ]
    assert len(exceptional) == 1
    assert rendered.count(player["player_visible_impact"]) == 1


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


def test_prior_active_effect_stays_context_visible_and_is_not_reprojected(
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
        campaign_id="effect-provenance",
        title="Effect Provenance",
    )
    campaign_id = "effect-provenance"
    investigator_id = str(quick["investigator_id"])

    def call(tool: str, args: dict | None = None) -> dict:
        result = coc_toolbox.run_tool(tool, workspace, campaign_id, dict(args or {}))
        assert result["ok"] is True, result
        return result

    scene_id = str(call("scene.context")["data"]["active_scene_id"])
    first_roll = call(
        "rules.roll",
        {
            "investigator": investigator_id,
            "skill": "Fast Talk",
            "target": 50,
            "difficulty": "regular",
            "goal": "press the wound closed",
            "stakes": {"on_success": "it holds", "on_failure": "it tears"},
            "difficulty_basis": "keeper_judgment",
            "fumble_consequence": "the wound tears open",
            "seed": 23,
            "decision_id": "t18-fumble",
        },
    )
    assert first_roll["data"]["outcome"] == "fumble"
    first_effect = call(
        "state.exceptional_effect",
        {
            "action": "apply",
            "source_roll_id": first_roll["data"]["roll_id"],
            "direction": "cost",
            "effect_kind": "condition",
            "player_visible_impact": "伤口压迫失败，裂口持续渗血",
            "causal_link": "拙劣的压迫让伤口裂得更开",
            "boundary": {"kind": "until_condition", "description": "伤口已经被包扎"},
            "mechanics": {
                "target_id": investigator_id,
                "condition_id": "wound_pressure_failed",
                "scene_id": scene_id,
            },
            "visibility": "player_visible",
            "decision_id": "t18-apply",
        },
    )
    first_effect_id = first_effect["data"]["effect"]["effect_id"]
    call(
        "state.journal",
        {
            "summary": "压迫伤口失败。",
            "player_text": "我用力按住伤口。",
            "decision_id": "t18-journal",
        },
    )
    first_context = call("turn.output_context")["data"]
    excerpt = "伤口在他手下裂开，血顺着指缝往下走。"
    draft = "托马斯跪下来按住伤口。\n\n" + excerpt
    coverage = [
        {
            "obligation_id": obligation["obligation_id"],
            "realization": "fictional_beat",
            "action_realization": "托马斯用力按住伤口",
            "response": "伤口裂开并持续渗血",
            "causal_explanation": "拙劣压迫使伤口恶化",
            "persona_fit": "符合托马斯临场处理伤势的方式",
            "player_input_handling": "abstract_completed",
            "exact_excerpt": excerpt,
            "exceptional_beat": (
                "裂口持续渗血，直到包扎完成"
                if obligation["exceptional_required"] else ""
            ),
        }
        for obligation in first_context["obligations"]
    ]
    call(
        "turn.finalize",
        {
            "draft": draft,
            "coverage": coverage,
            "mechanics_placements": _placements(first_context["mechanics_bundle"]),
            "revision": 1,
            "decision_id": "t18-finalize",
        },
    )

    second_roll = call(
        "rules.roll",
        {
            "investigator": investigator_id,
            "skill": "Fast Talk",
            "target": 50,
            "difficulty": "regular",
            "goal": "press the wound a second time",
            "stakes": {"on_success": "it holds", "on_failure": "it tears again"},
            "difficulty_basis": "keeper_judgment",
            "fumble_consequence": "the wound tears again",
            "seed": 23,
            "decision_id": "t20-fumble",
        },
    )
    assert second_roll["data"]["outcome"] == "fumble"
    second_effect = call(
        "state.exceptional_effect",
        {
            "action": "apply",
            "source_roll_id": second_roll["data"]["roll_id"],
            "direction": "cost",
            "effect_kind": "condition",
            "player_visible_impact": "第二次压迫失败，裂口再次扩大",
            "causal_link": "重复的拙劣压迫让伤口继续恶化",
            "boundary": {"kind": "until_condition", "description": "伤口已经被包扎"},
            "mechanics": {
                "target_id": investigator_id,
                "condition_id": "wound_pressure_failed_t20",
                "scene_id": scene_id,
            },
            "visibility": "player_visible",
            "decision_id": "t20-apply",
        },
    )
    second_effect_id = second_effect["data"]["effect"]["effect_id"]
    active = call("scene.context")["data"]["continuity"]["active_exceptional_effects"]
    assert {row["effect_id"] for row in active} == {first_effect_id, second_effect_id}

    call(
        "state.journal",
        {
            "summary": "第二次压迫也失败了。",
            "player_text": "我再次按住伤口。",
            "decision_id": "t20-journal",
        },
    )
    second_context = call("turn.output_context")["data"]
    assert [
        row["effect_id"] for row in second_context["mechanics_bundle"]["exceptional_effect"]
    ] == [second_effect_id]
    assert first_effect_id not in {
        row["effect_id"]
        for row in second_context["mechanics_bundle"]["exceptional_effect"]
    }

    still_active = call("scene.context")["data"]["continuity"]["active_exceptional_effects"]
    assert {row["effect_id"] for row in still_active} == {first_effect_id, second_effect_id}
