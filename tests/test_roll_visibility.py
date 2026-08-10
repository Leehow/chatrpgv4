"""Roll visibility contract: keeper_only rolls are recorded, replayable, and
closeable through the concealed-finalize path — never rendered to the player.
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


coc_toolbox = _load("coc_toolbox_roll_visibility", SCRIPTS / "coc_toolbox.py")
coc_starter = _load("coc_starter_roll_visibility", SCRIPTS / "coc_starter.py")
coc_turn_finalization = _load(
    "coc_turn_finalization_visibility", SCRIPTS / "coc_turn_finalization.py"
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


@pytest.fixture()
def campaign_ws(tmp_path: Path):
    workspace = tmp_path / "workspace"
    coc_root = workspace / ".coc"
    campaign_id = "roll-visibility-test"
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
        title="Roll Visibility Test",
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
    args = dict(args or {})
    if tool == "rules.roll":
        args.setdefault("difficulty", "regular")
        args.setdefault("difficulty_basis", "keeper_judgment")
        args.setdefault("goal", "observe the suspect quietly")
        args.setdefault(
            "stakes",
            {
                "on_success": "the focused test action succeeds",
                "on_failure": "the focused test action does not succeed",
            },
        )
    result = coc_toolbox.run_tool(
        tool, ws["workspace"], ws["campaign_id"], dict(args)
    )
    assert isinstance(result, dict)
    return result


def _concealed_roll(ws, decision_id: str) -> dict:
    return _run(
        ws,
        "rules.roll",
        {
            "investigator": ws["investigator_id"],
            "skill": "Psychology",
            "visibility": "keeper_only",
            "seed": 7,
            "decision_id": decision_id,
        },
    )


def test_keeper_only_roll_is_recorded_but_not_player_facing(campaign_ws):
    rolled = _concealed_roll(campaign_ws, "concealed-psych-1")
    assert rolled["ok"] is True, rolled
    roll_id = rolled["data"]["roll_id"]

    rows = {
        row["roll_id"]: row
        for row in _read_jsonl(campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl")
    }
    assert rows[roll_id]["visibility"] == "keeper_only"
    assert not coc_turn_finalization.is_player_facing_roll(rows[roll_id])

    public = _run(
        campaign_ws,
        "rules.roll",
        {
            "investigator": campaign_ws["investigator_id"],
            "skill": "Spot Hidden",
            "seed": 7,
            "decision_id": "public-spot-1",
        },
    )
    assert public["ok"] is True
    public_rows = {
        row["roll_id"]: row
        for row in _read_jsonl(campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl")
    }
    assert public_rows[public["data"]["roll_id"]]["visibility"] == "public"

    replay = _concealed_roll(campaign_ws, "concealed-psych-1")
    assert replay["ok"] is True
    assert replay["data"] == rolled["data"]
    assert any(
        "duplicate decision_id" in warning for warning in replay["warnings"]
    )

    invalid = _run(
        campaign_ws,
        "rules.roll",
        {
            "investigator": campaign_ws["investigator_id"],
            "skill": "Psychology",
            "visibility": "concealed",
            "seed": 7,
            "decision_id": "invalid-visibility",
        },
    )
    assert invalid["ok"] is False
    assert invalid["error"]["code"] == "invalid_param"


def test_finalize_closes_concealed_roll_without_visible_beat(campaign_ws):
    rolled = _concealed_roll(campaign_ws, "concealed-psych-finalize")
    assert rolled["ok"] is True, rolled
    journaled = _run(
        campaign_ws,
        "state.journal",
        {"summary": "调查员暗中打量对方", "player_text": "我暗中打量对方。", "decision_id": "concealed-journal"},
    )
    assert journaled["ok"] is True, journaled
    output = _run(campaign_ws, "turn.output_context")
    assert output["ok"] is True, output
    context = output["data"]
    concealed_obligation = next(
        row
        for row in context["obligations"]
        if row["source_kind"] == "concealed_roll"
    )
    # The concealed die is never in the public mechanics bundle.
    public_check_ids = [
        str(row.get("roll_id"))
        for row in context["mechanics_bundle"].get("public_check") or []
    ]
    assert rolled["data"]["roll_id"] not in public_check_ids

    result_paragraph = "已结算的测试结果按其原有因果关系发生。"
    draft = "测试中的行动继续推进。\n\n" + result_paragraph

    coverage = []
    for obligation in context["obligations"]:
        if obligation["obligation_id"] == concealed_obligation["obligation_id"]:
            coverage.append({
                "obligation_id": obligation["obligation_id"],
                "realization": "concealed_no_player_visible_beat",
                "action_realization": None,
                "response": None,
                "causal_explanation": None,
                "persona_fit": None,
                "player_input_handling": "abstract_completed",
                "exact_excerpt": None,
                "exceptional_beat": "",
            })
        else:
            coverage.append({
                "obligation_id": obligation["obligation_id"],
                "realization": "fictional_beat",
                "action_realization": "调查员完成了这项已结算的测试行动",
                "response": "场景按权威结算结果作出对应反应",
                "causal_explanation": "该反应直接来自本轮已经结算的行动结果",
                "persona_fit": "这项行动保持调查员既有的测试角色设定",
                "player_input_handling": "abstract_completed",
                "exact_excerpt": result_paragraph,
                "exceptional_beat": "",
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

    finalized = _run(
        campaign_ws,
        "turn.finalize",
        {
            "draft": draft,
            "coverage": coverage,
            "mechanics_placements": mechanics_placements,
            "decision_id": "concealed-finalize",
        },
    )
    assert finalized["ok"] is True, finalized
    rendered = json.dumps(
        finalized["data"].get("rendered_text") or "", ensure_ascii=False
    )
    assert rolled["data"]["roll_id"] not in rendered
