"""Finalize coverage binding: semantic aliases, opaque-free errors, fail-closed."""
from __future__ import annotations

import json
import os
import re
from pathlib import Path
import subprocess
import sys

import pytest


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import coc_starter
import coc_toolbox
import coc_turn_finalization


HEX_RUN = re.compile(r"[0-9a-fA-F]{16,}")

ROLL_SOURCE = "npc-first-impression-roll-v2:" + "c" * 40
FI_SOURCE = "npc-first-impression-v2:" + "d" * 40
DRAFT = "他走进停尸房，先向值守的人说明来意。\n\n档案员抬眼看了他一下，没有让开。"
EXCERPT = "档案员抬眼看了他一下，没有让开。"


def _pi_test_env() -> dict[str, str]:
    env = dict(os.environ)
    env.pop("PI_SUBAGENT_CHILD", None)
    marker = Path("runtime/adapters/keeper/node_modules/@earendil-works")
    if (ROOT / marker).exists():
        return env
    for parent in ROOT.parents:
        if (parent / marker).exists():
            env["PI_TEST_REPO_ROOT"] = str(parent)
            return env
    return env


def _node(script: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["node", "--experimental-strip-types", str(script), str(ROOT), *args],
        cwd=ROOT,
        env=_pi_test_env(),
        check=True,
        capture_output=True,
        text=True,
    )


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
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


def _coverage_row(obligation_id: str) -> dict:
    return {
        "obligation_id": obligation_id,
        "realization": "fictional_beat",
        "action_realization": "调查员走进停尸房并说明来意",
        "response": "档案员抬眼打量，没有让开",
        "causal_explanation": "初见反应和社交结果决定对方是否让路",
        "persona_fit": "符合调查员先礼后兵的作风",
        "player_input_handling": "specific_preserved",
        "exact_excerpt": EXCERPT,
        "exceptional_beat": "",
    }


def _sample_obligations() -> list[dict]:
    return [
        {
            "obligation_id": f"roll:{ROLL_SOURCE}",
            "source_kind": "check",
            "source_id": ROLL_SOURCE,
            "npc_display_name": "档案员",
            "skill": "APP",
            "exceptional_required": False,
        },
        {
            "obligation_id": f"first-impression:{FI_SOURCE}",
            "source_kind": "first_impression",
            "source_id": FI_SOURCE,
            "npc_display_name": "档案员",
            "skill": None,
            "exceptional_required": False,
        },
    ]


def test_zero_obligation_turn_accepts_empty_coverage() -> None:
    """Campaign 09 canonical absence: zero obligations close with coverage=[]."""
    assert coc_turn_finalization.validate_coverage([], [], DRAFT) == []


def test_zero_obligation_sentinel_row_fails_closed_without_normalization() -> None:
    """Campaign 09: a "none" placeholder row never normalizes into absence."""
    with pytest.raises(coc_turn_finalization.TurnContractError) as caught:
        coc_turn_finalization.validate_coverage(
            [], [_coverage_row("none")], DRAFT,
        )
    assert caught.value.code == "unknown_obligation"
    # Actionable, non-copyable correction: where valid handles come from.
    assert "turn.output_context" in str(caught.value)


def test_validate_coverage_accepts_bare_source_id_aliases() -> None:
    """Live restore bug: host rewrote roll handles to the bare source_id."""
    bound = coc_turn_finalization.validate_coverage(
        _sample_obligations(),
        [_coverage_row(ROLL_SOURCE), _coverage_row(FI_SOURCE)],
        DRAFT,
    )
    assert {row["obligation_id"] for row in bound} == {
        f"roll:{ROLL_SOURCE}",
        f"first-impression:{FI_SOURCE}",
    }


def test_validate_coverage_accepts_kind_prefixed_roll_alias() -> None:
    bound = coc_turn_finalization.validate_coverage(
        _sample_obligations(),
        [
            _coverage_row(f"roll:{ROLL_SOURCE}"),
            _coverage_row(f"first-impression:{FI_SOURCE}"),
        ],
        DRAFT,
    )
    assert [row["obligation_id"] for row in bound] == sorted({
        f"roll:{ROLL_SOURCE}",
        f"first-impression:{FI_SOURCE}",
    })


def test_missing_obligation_fails_closed_without_hash_echo() -> None:
    with pytest.raises(coc_turn_finalization.TurnContractError) as caught:
        coc_turn_finalization.validate_coverage(
            _sample_obligations(),
            [_coverage_row(ROLL_SOURCE)],
            DRAFT,
        )
    assert caught.value.code == "missing_obligation"
    assert HEX_RUN.search(str(caught.value)) is None
    assert "first-impression" in str(caught.value)


def test_unknown_hash_obligation_fails_closed_without_echo() -> None:
    forged = "npc-first-impression-roll-v2:" + "a" * 40
    with pytest.raises(coc_turn_finalization.TurnContractError) as caught:
        coc_turn_finalization.validate_coverage(
            _sample_obligations(),
            [_coverage_row(forged), _coverage_row(FI_SOURCE)],
            DRAFT,
        )
    assert caught.value.code == "unknown_obligation"
    assert forged not in str(caught.value)
    assert HEX_RUN.search(str(caught.value)) is None


def test_incomplete_coverage_row_still_fails_closed() -> None:
    row = _coverage_row(ROLL_SOURCE)
    row["exact_excerpt"] = ""
    with pytest.raises(coc_turn_finalization.TurnContractError) as caught:
        coc_turn_finalization.validate_coverage(
            _sample_obligations(),
            [row, _coverage_row(FI_SOURCE)],
            DRAFT,
        )
    assert caught.value.code == "invalid_coverage"


def test_morgue_host_boundary_projects_and_restores_without_extensions() -> None:
    completed = _node(ROOT / "tests/pi/morgue-finalize-host-boundary.mjs")
    assert completed.stdout.strip().endswith(
        "morgue-finalize-host-boundary: all assertions passed"
    )


def test_morgue_shaped_turn_finalizes_through_host_restore(tmp_path: Path) -> None:
    """Scene move + first impression + social roll + journal; KP handles restore."""
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
        campaign_id="morgue-obligation-bind",
        title="Morgue Obligation Bind",
    )
    campaign_id = "morgue-obligation-bind"
    investigator_id = str(quick["investigator_id"])
    run_id = "morgue-bind-1"

    def call(tool: str, args: dict | None = None) -> dict:
        result = coc_toolbox.run_tool(
            tool, workspace, campaign_id, dict(args or {})
        )
        assert result["ok"] is True, result
        return result

    call("state.move_scene", {
        "scene_id": "corbitt-confrontation",
        "decision_id": "move-morgue",
    })
    reaction = call("npc.reaction", {
        "npc_id": "npc-archive-clerk",
        "npc_display_name": "档案员",
        "investigator": investigator_id,
        "run_id": run_id,
        "context": {
            "player_conduct": "托马斯先收起笔记本，清楚说明来意",
            "scene_constraints": "停尸房值守仍须遵守登记职责",
            "authored_or_relationship_boundary": "初次见面，没有既有私交",
            "semantic_reason": "外表与社会身份只调节起初的耐心与语气",
        },
        "seed": 7,
        "decision_id": "reaction-clerk",
    })
    call("state.record_npc_engagement", {
        "npc_id": "npc-archive-clerk",
        "investigator": investigator_id,
        "interaction_kind": "dialogue",
        "first_impression_ref": reaction["data"]["first_impression_ref"],
        "first_impression_realization": {
            "observable_manner": "档案员先看了一眼证件，再把椅子向柜台前推了半步",
            "causal_explanation": "托马斯的体面举止影响了档案员的起初判断",
            "boundary_preserved": "档案员仍坚持登记手续",
            "opportunity_or_friction": "她愿意先听完托马斯的请求",
        },
        "run_id": run_id,
        "decision_id": "engage-clerk",
    })
    call("rules.roll", {
        "investigator": investigator_id,
        "skill": "Fast Talk",
        "target": 50,
        "difficulty": "regular",
        "goal": "请档案员让开停尸房入口",
        "stakes": {
            "on_success": "档案员让路",
            "on_failure": "档案员拦住去路",
        },
        "difficulty_basis": "keeper_judgment",
        "seed": 5,
        "decision_id": "fast-talk-morgue",
    })
    call("state.journal", {
        "summary": "托马斯走进停尸房并向值守说明来意。",
        "player_action": "走进停尸房并向档案员说明来意",
        "player_text": "我走进停尸房，向值守的人说明来意。",
        "intent_class": "social",
        "decision_id": "journal-morgue",
    })
    output = call("turn.output_context")["data"]
    for index, missing_row in enumerate(list(output.get("missing_substantive_effects") or [])):
        direction = missing_row["required_direction"]
        benefit = direction == "benefit"
        call("state.exceptional_effect", {
            "action": "apply",
            "source_roll_id": missing_row["source_roll_id"],
            "direction": direction,
            "effect_kind": "bonus_die" if benefit else "restriction",
            "player_visible_impact": (
                "值守因此对托马斯多留了一点耐心"
                if benefit else "值守把托马斯列为需要当面核验的访客"
            ),
            "causal_link": "停尸房门口的初见与交涉把极端结果落到了值守身上",
            "boundary": {"kind": "until_consumed", "uses": 1} if benefit else {
                "kind": "until_condition",
                "description": "值守明确允许托马斯继续查看",
            },
            "mechanics": {
                "dice": 1,
                "investigator_id": investigator_id,
                "skill": "Persuade",
                "scene_id": None,
                "target_id": "npc-archive-clerk",
                "target_display_name": "档案员",
            } if benefit else {
                "subject_id": investigator_id,
                "restriction_id": f"morgue-clerk-gate-{index}",
                "scope": "停尸房入口",
                "scene_id": None,
            },
            "visibility": "player_visible",
            "decision_id": f"morgue-exceptional-{index}",
        })
    if output.get("missing_substantive_effects"):
        output = call("turn.output_context")["data"]
    assert output["missing_substantive_effects"] == []
    kinds = {row["source_kind"] for row in output["obligations"]}
    assert "first_impression" in kinds
    assert any(
        row["source_kind"] != "first_impression"
        for row in output["obligations"]
    )
    setup = "托马斯收起笔记本，走进停尸房，把来意说清楚。"
    result = "档案员抬眼打量他，没有立刻让开停尸房入口。"
    draft = setup + "\n\n" + result
    context_path = tmp_path / "output-context.json"
    restored_path = tmp_path / "restored-coverage.json"
    _write_json(context_path, {
        "campaign": campaign_id,
        "output_context": output,
        "coverage_templates": [
            {
                "realization": "fictional_beat",
                "action_realization": "托马斯走进停尸房并说明来意",
                "response": "档案员打量他，没有立刻让开",
                "causal_explanation": "初见反应和话术结果共同决定对方是否让路",
                "persona_fit": "符合托马斯先说明身份再开口的作风",
                "player_input_handling": "specific_preserved",
                "exact_excerpt": result,
                "exceptional_beat": (
                    "这次极端结果已经改变了与该档案员相关的后续机会或阻力"
                    if row["exceptional_required"] else ""
                ),
            }
            for row in output["obligations"]
        ],
    })
    host = json.loads(_node(
        ROOT / "tests/pi/morgue-finalize-host-boundary.mjs",
        str(context_path),
        str(restored_path),
    ).stdout)
    assert host["ok"] is True
    original_ids = [row["obligation_id"] for row in output["obligations"]]
    assert host["projected_handles"]
    assert host["projected_handles"] != original_ids
    for handle, original in zip(
        host["projected_handles"], original_ids, strict=True,
    ):
        assert HEX_RUN.search(handle) is None
        assert handle.startswith("roll:")
        assert handle != original
    coverage = json.loads(restored_path.read_text(encoding="utf-8"))["coverage"]
    assert [row["obligation_id"] for row in coverage] == original_ids
    missing = coc_toolbox.run_tool(
        "turn.finalize",
        workspace,
        campaign_id,
        {
            "draft": draft,
            "coverage": coverage[:-1],
            "mechanics_placements": _placements(output["mechanics_bundle"]),
            "revision": 1,
            "decision_id": "finalize-morgue-missing",
        },
    )
    assert missing["ok"] is False
    assert missing["error"]["code"] == "missing_obligation"
    assert HEX_RUN.search(missing["error"]["message"] or "") is None

    forged = "npc-first-impression-roll-v2:" + "a" * 40
    unknown = coc_toolbox.run_tool(
        "turn.finalize",
        workspace,
        campaign_id,
        {
            "draft": draft,
            "coverage": [
                {**coverage[0], "obligation_id": forged},
                *coverage[1:],
            ],
            "mechanics_placements": _placements(output["mechanics_bundle"]),
            "revision": 1,
            "decision_id": "finalize-morgue-unknown",
        },
    )
    assert unknown["ok"] is False
    assert unknown["error"]["code"] == "unknown_obligation"
    assert forged not in (unknown["error"]["message"] or "")
    assert HEX_RUN.search(unknown["error"]["message"] or "") is None

    finalized = call("turn.finalize", {
        "draft": draft,
        "coverage": coverage,
        "mechanics_placements": _placements(output["mechanics_bundle"]),
        "revision": 1,
        "decision_id": "finalize-morgue",
    })
    assert finalized["data"]["rendered_text"]
    assert finalized["data"]["finalization_id"]
    assert set(finalized["data"]["obligation_ids"]) == {
        row["obligation_id"] for row in output["obligations"]
    }


def test_settled_output_recovery_reaches_finalization_receipt() -> None:
    completed = _node(ROOT / "tests/pi/settled-output-recovery-receipt.mjs")
    result = json.loads(completed.stdout.strip().splitlines()[-1])
    assert result["ok"] is True
    assert result["recoverySends"] == 1
    assert result["transportCampaign"] == "settled-output-recovery-receipt"
    assert result["finalizationId"] == "turn-finalization:morgue-recovery-receipt"
    assert result["status"] == "finalized"
    assert result["hostStageAfterFinalize"] == "finalized"
    assert result["hostStageAfterDelivery"] == "delivered"
    assert result["secondEmptyDidNotRelaunch"] is True
    assert result["secondEmptyDidNotFault"] is True
