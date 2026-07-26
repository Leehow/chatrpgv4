"""Social adjudication + concealed Psychology observation contracts (phase 2)."""
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


coc_toolbox = _load("coc_toolbox_social_psych", SCRIPTS / "coc_toolbox.py")
coc_starter = _load("coc_starter_social_psych", SCRIPTS / "coc_starter.py")


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
    campaign_id = "social-psych-test"
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
        title="Social Psych Test",
    )
    campaign_dir = Path(quick["campaign_dir"])
    npcs = json.loads(
        (campaign_dir / "scenario" / "npc-agendas.json").read_text(encoding="utf-8")
    ).get("npcs") or []
    return {
        "workspace": workspace,
        "coc_root": coc_root,
        "campaign_id": campaign_id,
        "campaign_dir": campaign_dir,
        "investigator_id": quick["investigator_id"],
        "quick": quick,
        "npc_id": str(npcs[0]["npc_id"]) if npcs else "npc-test",
    }


def _run(ws, tool: str, args: dict | None = None) -> dict:
    result = coc_toolbox.run_tool(
        tool, ws["workspace"], ws["campaign_id"], dict(args or {})
    )
    assert isinstance(result, dict)
    return result


def _adjudicate(ws, decision_id: str, **overrides) -> dict:
    args = {
        "investigator": ws["investigator_id"],
        "npc_id": ws["npc_id"],
        "approach": "persuade",
        "goal_summary": "承认篡改了档案",
        "decision_id": decision_id,
    }
    args.update(overrides)
    return _run(ws, "rules.social_adjudicate", args)


def test_social_adjudicate_difficulty_ladder_and_motive(campaign_ws):
    plain = _adjudicate(campaign_ws, "adj-plain", npc_defense_value=45)
    assert plain["ok"] is True, plain
    assert plain["data"]["base_difficulty"] == "regular"
    assert plain["data"]["final_difficulty"] == "regular"
    assert plain["data"]["feasibility"] == "roll"

    hard = _adjudicate(campaign_ws, "adj-hard", npc_defense_value=55)
    assert hard["data"]["base_difficulty"] == "hard"

    extreme = _adjudicate(campaign_ws, "adj-extreme", npc_defense_value=92)
    assert extreme["data"]["base_difficulty"] == "extreme"

    opposed = _adjudicate(
        campaign_ws,
        "adj-opposed",
        npc_defense_value=45,
        motive={"direction": "oppose", "intensity": 1, "evidence": ["npc_state:fear"]},
    )
    assert opposed["data"]["final_difficulty"] == "hard"
    assert opposed["data"]["motive_delta"] == 1

    supported = _adjudicate(
        campaign_ws,
        "adj-supported",
        npc_defense_value=55,
        motive={"direction": "support", "intensity": 1, "evidence": ["clue:shared-goal"]},
    )
    assert supported["data"]["final_difficulty"] == "regular"
    assert supported["data"]["motive_delta"] == -1

    automatic = _adjudicate(
        campaign_ws,
        "adj-automatic",
        npc_defense_value=45,
        motive={"direction": "support", "intensity": 1, "evidence": ["clue:shared-goal"]},
    )
    assert automatic["data"]["feasibility"] == "automatic"


def test_social_adjudicate_leverage_cap_and_conditional(campaign_ws):
    leveraged = _adjudicate(
        campaign_ws,
        "adj-leverage",
        npc_defense_value=55,
        motive={"direction": "oppose", "intensity": 1, "evidence": ["npc_state:fear"]},
        leverage=[
            {"leverage_id": "film-sample", "type": "evidence", "source_ref": "event-1"},
            {"leverage_id": "protection-offer", "type": "promise", "source_ref": "event-2"},
            {"leverage_id": "ignored-third", "type": "evidence", "source_ref": "event-3"},
        ],
        tactical={"bonus": 1, "penalty": 0},
    )
    assert leveraged["ok"] is True, leveraged
    assert leveraged["data"]["leverage_delta"] == 2
    # hard(1) + oppose(1) - leverage(2) = 0 -> regular
    assert leveraged["data"]["final_difficulty"] == "regular"
    assert leveraged["data"]["bonus_dice"] == 1
    assert any("first two" in warning for warning in leveraged["warnings"])

    conditional = _adjudicate(
        campaign_ws,
        "adj-conditional",
        npc_defense_value=30,
        motive={"direction": "oppose", "intensity": 2, "evidence": ["npc_state:red-line"]},
    )
    assert conditional["data"]["feasibility"] == "conditional"
    assert any("requirements" in warning for warning in conditional["warnings"])

    beyond = _adjudicate(
        campaign_ws,
        "adj-beyond",
        npc_defense_value=92,
        motive={"direction": "oppose", "intensity": 1, "evidence": ["npc_state:fear"]},
    )
    assert beyond["data"]["feasibility"] == "conditional"


def test_social_adjudicate_goal_key_replay(campaign_ws):
    first = _adjudicate(
        campaign_ws,
        "adj-goal-1",
        npc_defense_value=55,
        motive={"direction": "oppose", "intensity": 1, "evidence": ["npc_state:fear"]},
    )
    assert first["data"]["replayed"] is False

    same = _adjudicate(
        campaign_ws,
        "adj-goal-2",
        npc_defense_value=55,
        motive={"direction": "oppose", "intensity": 1, "evidence": ["npc_state:fear"]},
    )
    assert same["data"]["replayed"] is True
    assert same["data"]["goal_key"] == first["data"]["goal_key"]
    assert any("does not reopen" in warning for warning in same["warnings"])

    changed = _adjudicate(
        campaign_ws,
        "adj-goal-3",
        npc_defense_value=55,
        motive={"direction": "oppose", "intensity": 1, "evidence": ["npc_state:fear"]},
        leverage=[
            {"leverage_id": "film-sample", "type": "evidence", "source_ref": "event-1"},
        ],
    )
    assert changed["data"]["replayed"] is False
    # hard(1) + oppose(1) - leverage(1) = 1 -> hard
    assert changed["data"]["final_difficulty"] == "hard"


def test_social_adjudicate_authored_defense_and_validation(campaign_ws):
    agendas_path = campaign_ws["campaign_dir"] / "scenario" / "npc-agendas.json"
    agendas = json.loads(agendas_path.read_text(encoding="utf-8"))
    for npc in agendas.get("npcs") or []:
        if npc.get("npc_id") == campaign_ws["npc_id"]:
            npc["skills"] = {"Psychology": 62, "Persuade": 40}
    _write_json(agendas_path, agendas)

    authored = _adjudicate(campaign_ws, "adj-authored")
    assert authored["ok"] is True, authored
    assert authored["data"]["defense_value"] == 62
    assert authored["data"]["defense_source"] == "authored"
    assert authored["data"]["base_difficulty"] == "hard"

    invalid = _adjudicate(
        campaign_ws,
        "adj-invalid-motive",
        motive={"direction": "oppose", "intensity": 2},
    )
    assert invalid["ok"] is False
    assert invalid["error"]["code"] == "invalid_param"


def _observe(ws, decision_id: str, **overrides) -> dict:
    args = {
        "investigator": ws["investigator_id"],
        "npc_id": ws["npc_id"],
        "question": "他在害怕谁？",
        "visible_observation": "他回答前先看了门口，右手始终压着抽屉。",
        "seed": 7,
        "decision_id": decision_id,
    }
    args.update(overrides)
    return _run(ws, "rules.psychology_observe", args)


def test_psychology_observe_concealed_and_window_reuse(campaign_ws):
    first = _observe(campaign_ws, "psych-1")
    assert first["ok"] is True, first
    assert first["data"]["resolution"] == "settled"
    roll_id = first["data"]["roll_id"]

    rows = {
        row["roll_id"]: row
        for row in _read_jsonl(campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl")
    }
    assert rows[roll_id]["visibility"] == "keeper_only"

    again = _observe(campaign_ws, "psych-2")
    assert again["ok"] is True
    assert again["data"]["resolution"] == "reuse"
    assert again["data"]["insight_id"] == first["data"]["insight_id"]
    assert "outcome" not in again["data"]
    assert "roll_id" not in again["data"]
    row_count = len(_read_jsonl(campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl"))
    assert row_count == 1

    updated = _run(
        campaign_ws,
        "state.npc_update",
        {
            "npc_id": campaign_ws["npc_id"],
            "trust_delta": 1,
            "decision_id": "npc-trust-shift",
        },
    )
    assert updated["ok"] is True, updated
    reopened = _observe(campaign_ws, "psych-3")
    assert reopened["ok"] is True
    assert reopened["data"]["resolution"] == "settled"
    assert reopened["data"]["insight_id"] != first["data"]["insight_id"]
    assert len(_read_jsonl(campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl")) == 2
