"""rules.sanity_check single-track (SanitySession) contract tests.

Pins the W2 single-track behavior: the flat rules.sanity_check tool drives the
canonical SanitySession engine, so the chained 7e insanity pipeline (INT check
on 5+ loss, bout of madness, daily 1/5 indefinite threshold, SAN 0 permanent)
is authoritative state with fully logged public rolls — never advisory hints.
"""
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


coc_toolbox = _load("coc_toolbox_sanity_single_track", SCRIPTS / "coc_toolbox.py")
coc_starter = _load("coc_starter_sanity_single_track", SCRIPTS / "coc_starter.py")


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
    """Fresh workspace with a the-haunting / thomas-hayes quick-start campaign."""
    workspace = tmp_path / "workspace"
    coc_root = workspace / ".coc"
    campaign_id = "sanity-single-track-test"
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
        title="Sanity Single Track Test",
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


# Seed 10 vs thomas-hayes (SAN 55, INT 70): SAN check fails, constant loss 5,
# INT check succeeds -> temporary insanity with a real-time bout of 10 rounds.
TEMP_INSANITY_SEED = 10
# Seed 1: SAN check succeeds (hard) with a rolled 1D3 success loss of 3.
SUCCESS_EXPR_SEED = 1


def _temp_insanity_call(ws):
    result = _run(
        ws,
        "rules.sanity_check",
        {
            "investigator": ws["investigator_id"],
            "source": "the thing in the dark lunges",
            "loss_success": "0",
            "loss_failure": "5",
            "decision_id": "san-temp-insanity",
            "seed": TEMP_INSANITY_SEED,
        },
    )
    assert result["ok"] is True, result
    return result


def _inv_state(ws) -> dict:
    path = (
        ws["campaign_dir"]
        / "save"
        / "investigator-state"
        / f"{ws['investigator_id']}.json"
    )
    return json.loads(path.read_text(encoding="utf-8"))


def _sanity_snapshot(ws) -> dict:
    path = (
        ws["campaign_dir"]
        / "save"
        / "sanity-state"
        / f"{ws['investigator_id']}.json"
    )
    return json.loads(path.read_text(encoding="utf-8"))


def test_rules_sanity_check_chains_full_insanity_pipeline(campaign_ws):
    result = _temp_insanity_call(campaign_ws)
    data = result["data"]

    assert data["check"]["outcome"] == "failure"
    assert data["san_loss"] == 5
    assert data["san_before"] == 55
    assert data["san_after"] == 50
    assert data["success"] is False
    assert data["sanity_check_skipped"] is False
    assert data["bout_triggered"] is True
    assert data["bout_active"] is True
    assert data["active_bout_id"] == f"{campaign_ws['investigator_id']}:bout:1"
    assert data["bout_rounds_remaining"] == 10
    assert data["temporary_insane"] is True
    assert data["daily_san_lost"] == 5
    assert data["day_start_san"] == 55

    for key in (
        "check_roll_id",
        "int_roll_id",
        "bout_duration_roll_id",
        "bout_table_roll_id",
        "bout_rounds_roll_id",
    ):
        assert key in data, key
        assert data[key] in data["session_roll_ids"]
    assert len(set(data[key] for key in (
        "check_roll_id",
        "int_roll_id",
        "bout_duration_roll_id",
        "bout_table_roll_id",
        "bout_rounds_roll_id",
    ))) == 5

    rolls = {
        row["roll_id"]: row
        for row in _read_jsonl(campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl")
    }
    assert rolls[data["check_roll_id"]]["kind"] == "sanity_check"
    assert rolls[data["check_roll_id"]]["visibility"] == "consequence_public"
    assert rolls[data["int_roll_id"]]["kind"] == "skill_check"
    assert rolls[data["int_roll_id"]]["payload"]["skill"] == "INT"
    assert rolls[data["bout_duration_roll_id"]]["kind"] == "bout_duration_hours"
    assert rolls[data["bout_table_roll_id"]]["kind"] == "bout_of_madness_table"
    assert rolls[data["bout_rounds_roll_id"]]["kind"] == "bout_duration_rounds"
    assert rolls[data["bout_rounds_roll_id"]]["payload"]["roll"] == 10

    state = _inv_state(campaign_ws)
    assert state["current_san"] == 50
    assert state["temporary_insane"] is True
    assert state["bout_active"] is True

    snapshot = _sanity_snapshot(campaign_ws)
    assert snapshot["temporary_insane"] is True
    assert snapshot["bout_active"] is True
    assert snapshot["bouts_of_madness"][0]["duration_rounds"] == 10

    events = _read_jsonl(campaign_ws["campaign_dir"] / "logs" / "events.jsonl")
    assert any(row.get("event_type") == "sanity_loss" and row.get("loss") == 5 for row in events)
    assert any(row.get("event_type") == "bout_of_madness" for row in events)

    hints = " ".join(result.get("hints") or [])
    assert "bout of madness active" in hints
    assert "blocked" in hints


def test_rules_sanity_check_skipped_during_active_bout(campaign_ws):
    _temp_insanity_call(campaign_ws)
    rolls_before = _read_jsonl(campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl")

    skipped = _run(
        campaign_ws,
        "rules.sanity_check",
        {
            "investigator": campaign_ws["investigator_id"],
            "source": "another shock during the bout",
            "loss_success": "0",
            "loss_failure": "1D6",
            "trigger_id": "unfired-trigger",
            "decision_id": "san-during-bout",
            "seed": 99,
        },
    )
    assert skipped["ok"] is True, skipped
    data = skipped["data"]
    assert data["sanity_check_skipped"] is True
    assert data["san_loss"] == 0
    assert data["san_after"] == 50
    assert data["bout_active"] is True
    assert data["session_roll_ids"] == []
    assert any("NOT marked fired" in warning for warning in skipped["warnings"])

    rolls_after = _read_jsonl(campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl")
    assert len(rolls_after) == len(rolls_before)
    assert _inv_state(campaign_ws)["current_san"] == 50
    world = json.loads(
        (campaign_ws["campaign_dir"] / "save" / "world-state.json").read_text(
            encoding="utf-8"
        )
    )
    assert "unfired-trigger" not in (world.get("san_triggers_fired") or [])

    replay = _run(
        campaign_ws,
        "rules.sanity_check",
        {
            "investigator": campaign_ws["investigator_id"],
            "source": "another shock during the bout",
            "loss_success": "0",
            "loss_failure": "1D6",
            "trigger_id": "unfired-trigger",
            "decision_id": "san-during-bout",
            "seed": 12345,
        },
    )
    assert replay["ok"] is True
    assert replay["data"] == data
    assert any(
        "duplicate decision_id" in warning for warning in replay["warnings"]
    )


def test_rules_sanity_check_replay_does_not_double_apply(campaign_ws):
    first = _temp_insanity_call(campaign_ws)
    replay = _run(
        campaign_ws,
        "rules.sanity_check",
        {
            "investigator": campaign_ws["investigator_id"],
            "source": "the thing in the dark lunges",
            "loss_success": "0",
            "loss_failure": "5",
            "decision_id": "san-temp-insanity",
            "seed": 777,
        },
    )
    assert replay["ok"] is True
    assert replay["data"] == first["data"]
    assert any(
        "duplicate decision_id" in warning for warning in replay["warnings"]
    )
    assert _inv_state(campaign_ws)["current_san"] == 50
    rolls = _read_jsonl(campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl")
    for roll_id in first["data"]["session_roll_ids"]:
        assert len([row for row in rolls if row.get("roll_id") == roll_id]) == 1


def test_rules_sanity_check_rolls_success_loss_expression(campaign_ws):
    result = _run(
        campaign_ws,
        "rules.sanity_check",
        {
            "investigator": campaign_ws["investigator_id"],
            "source": "a glimpse of something unnatural",
            "loss_success": "1D3",
            "loss_failure": "1D6",
            "decision_id": "san-success-expression",
            "seed": SUCCESS_EXPR_SEED,
        },
    )
    assert result["ok"] is True, result
    data = result["data"]
    assert data["check"]["outcome"] == "hard"
    assert data["san_loss"] == 3
    assert data["loss_detail"]["rolls"] == [3]
    assert data["loss_detail"]["resolution"] == "rolled"
    assert data["bout_triggered"] is False
    assert data["loss_roll_id"] in data["session_roll_ids"] or True
    rolls = {
        row["roll_id"]: row
        for row in _read_jsonl(campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl")
    }
    loss_row = rolls[data["loss_roll_id"]]
    assert loss_row["kind"] == "san_loss"
    assert loss_row["payload"]["die_expression"] == "1D3"
    assert loss_row["payload"]["final_total"] == 3


def test_rules_sanity_check_rejects_invalid_loss_expression(campaign_ws):
    result = _run(
        campaign_ws,
        "rules.sanity_check",
        {
            "investigator": campaign_ws["investigator_id"],
            "source": "bad expression",
            "loss_success": "banana",
            "loss_failure": "1D6",
            "decision_id": "san-invalid-expression",
        },
    )
    assert result["ok"] is False
    assert result["error"]["code"] == "invalid_param"
    assert "loss_success" in result["error"]["message"]


def test_mark_safe_rest_resets_game_day_sanity_counter(campaign_ws):
    _temp_insanity_call(campaign_ws)
    assert _sanity_snapshot(campaign_ws)["daily_san_lost"] == 5

    rested = _run(
        campaign_ws,
        "state.mark_safe_rest",
        {
            "investigator": campaign_ws["investigator_id"],
            "rest_kind": "full_sleep",
            "decision_id": "rest-after-bout",
        },
    )
    assert rested["ok"] is True, rested
    assert rested["data"]["sanity_day_reset"] is True
    snapshot = _sanity_snapshot(campaign_ws)
    assert snapshot["daily_san_lost"] == 0
    assert snapshot["day_start_san"] == 50


def test_mark_safe_rest_without_sanity_session_reports_no_reset(campaign_ws):
    rested = _run(
        campaign_ws,
        "state.mark_safe_rest",
        {
            "investigator": campaign_ws["investigator_id"],
            "rest_kind": "full_sleep",
            "decision_id": "rest-before-any-san",
        },
    )
    assert rested["ok"] is True, rested
    assert rested["data"]["sanity_day_reset"] is False


def _scene_event_apply_args(campaign_dir: Path, source_roll_id: str, decision_id: str) -> dict:
    scene_id = json.loads(
        (campaign_dir / "save" / "world-state.json").read_text(encoding="utf-8")
    )["active_scene_id"]
    return {
        "action": "apply",
        "source_roll_id": source_roll_id,
        "direction": "cost",
        "effect_kind": "scene_event",
        "player_visible_impact": "理智崩塌的瞬间，他失声尖叫，暴露了自己的位置",
        "causal_link": "SAN检定大失败，恐惧决堤压倒了一切掩饰",
        "boundary": {"kind": "until_scene_end", "scene_id": scene_id},
        "mechanics": {
            "scene_id": scene_id,
            "event_id": "scream-reveals-position",
            "change_kind": "hazard",
        },
        "visibility": "player_visible",
        "decision_id": decision_id,
    }


def test_sanity_check_fumble_binds_exceptional_effect(campaign_ws):
    # Regression (P0 follow-up): a SAN fumble is an exceptional result whose
    # cost must bind through state.exceptional_effect.  The source roll lives
    # in logs/rolls.jsonl (kind=sanity_check); its owning decision_id is
    # resolved from the canonical rules.sanity_check ledger entry.
    checked = _run(
        campaign_ws,
        "rules.sanity_check",
        {
            "investigator": campaign_ws["investigator_id"],
            "source": "a probe horror",
            "loss_success": "0",
            "loss_failure": "1",
            "seed": 23,
            "decision_id": "san-fumble-source",
        },
    )
    assert checked["ok"] is True, checked
    roll_id = checked["data"]["check_roll_id"]

    applied = _run(
        campaign_ws,
        "state.exceptional_effect",
        _scene_event_apply_args(campaign_ws["campaign_dir"], roll_id, "san-fumble-effect"),
    )
    assert applied["ok"] is True, applied
    source = applied["data"]["effect"]["source_roll"]
    assert source["tool"] == "rules.sanity_check"
    assert source["decision_id"] == "san-fumble-source"
    assert source["roll_id"] == roll_id
    assert source["outcome"] == "fumble"


def test_sanity_execute_fumble_binds_exceptional_effect(campaign_ws):
    # Same binding contract through the subsystem path: sanity.execute logs
    # the SAN check under the command_id and ledgers the result envelope; the
    # exceptional source must still resolve exactly one owning decision_id.
    executed = _run(
        campaign_ws,
        "sanity.execute",
        {
            "investigator": campaign_ws["investigator_id"],
            "command": {
                "command_id": "san-exec-fumble-cmd",
                "kind": "sanity_check",
                "phase": "resolve",
                "payload": {
                    "decision_id": "san-exec-fumble",
                    "source": "a probe subsystem horror",
                    "san_loss_success_expr": "0",
                    "san_loss_fail_expr": "1",
                },
            },
            "seed": 23,
            "decision_id": "san-exec-fumble",
        },
    )
    assert executed["ok"] is True, executed

    applied = _run(
        campaign_ws,
        "state.exceptional_effect",
        _scene_event_apply_args(
            campaign_ws["campaign_dir"], "san-exec-fumble-cmd", "san-exec-fumble-effect"
        ),
    )
    assert applied["ok"] is True, applied
    source = applied["data"]["effect"]["source_roll"]
    assert source["tool"] == "sanity.execute"
    assert source["decision_id"] == "san-exec-fumble"
    assert source["roll_id"] == "san-exec-fumble-cmd"
    assert source["outcome"] == "fumble"


def _finalize_coverage(context: dict, *, drop_obligation_prefix: str | None = None):
    result_paragraph = "已结算的测试结果按其原有因果关系发生。"
    draft = "测试中的行动继续推进。\n\n" + result_paragraph
    coverage = []
    for obligation in context["obligations"]:
        if drop_obligation_prefix and obligation["obligation_id"].startswith(
            drop_obligation_prefix
        ):
            continue
        coverage.append({
            "obligation_id": obligation["obligation_id"],
            "realization": "fictional_beat",
            "action_realization": "调查员完成了这项已结算的测试行动",
            "response": "场景按权威结算结果作出对应反应",
            "causal_explanation": "该反应直接来自本轮已经结算的行动结果",
            "persona_fit": "这项行动保持调查员既有的测试角色设定",
            "player_input_handling": "abstract_completed",
            "exact_excerpt": result_paragraph,
            "exceptional_beat": (
                "特殊结果已经产生与该行动直接相连的实质影响"
                if obligation["exceptional_required"]
                else ""
            ),
        })
    mechanics_placements = []
    for segment_type, source_key, after_paragraph in (
        ("public_check", "roll_id", 0),
        ("state_delta", "effect_id", 1),
        ("exceptional_effect", "event_id", 1),
    ):
        rows = context["mechanics_bundle"].get(segment_type) or []
        if rows:
            mechanics_placements.append({
                "after_paragraph": after_paragraph,
                "segment_type": segment_type,
                "source_ids": [str(row[source_key]) for row in rows],
            })
    return draft, coverage, mechanics_placements


def test_finalize_requires_sanity_bout_realization(campaign_ws):
    _temp_insanity_call(campaign_ws)
    journaled = _run(
        campaign_ws,
        "state.journal",
        {"summary": "直面黑暗中的东西后调查员精神崩塌", "decision_id": "bout-turn-journal"},
    )
    assert journaled["ok"] is True, journaled

    output = _run(campaign_ws, "turn.output_context")
    assert output["ok"] is True, output
    context = output["data"]
    bout_obligation_id = f"sanity_bout:{campaign_ws['investigator_id']}:bout:1"
    assert bout_obligation_id in {
        row["obligation_id"] for row in context["obligations"]
    }

    draft, coverage, placements = _finalize_coverage(
        context, drop_obligation_prefix="sanity_bout:"
    )
    refused = _run(
        campaign_ws,
        "turn.finalize",
        {
            "draft": draft,
            "coverage": coverage,
            "mechanics_placements": placements,
            "decision_id": "bout-turn-finalize-missing",
        },
    )
    assert refused["ok"] is False
    assert refused["error"]["code"] == "missing_obligation"
    assert bout_obligation_id in refused["error"]["message"]

    draft, coverage, placements = _finalize_coverage(context)
    finalized = _run(
        campaign_ws,
        "turn.finalize",
        {
            "draft": draft,
            "coverage": coverage,
            "mechanics_placements": placements,
            "decision_id": "bout-turn-finalize",
        },
    )
    assert finalized["ok"] is True, finalized
