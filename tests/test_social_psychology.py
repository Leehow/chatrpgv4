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
    event_rows = [
        {
            "event_id": f"event-public-{index}",
            "event_type": "player_visible_evidence",
            "visibility": "public",
        }
        for index in range(1, 5)
    ]
    (campaign_dir / "logs" / "events.jsonl").write_text(
        "".join(json.dumps(row) + "\n" for row in event_rows),
        encoding="utf-8",
    )
    clue_ids = [
        "clue-house-built-1835",
        "clue-neighbor-lawsuit-1852",
        "clue-second-lawsuit-outcome-unrecorded",
        "clue-basement-burial-lawsuit",
    ]
    world_path = campaign_dir / "save" / "world-state.json"
    world = json.loads(world_path.read_text(encoding="utf-8"))
    world["discovered_clue_ids"] = clue_ids
    _write_json(world_path, world)
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
        "conversation_window_id": "conv-main",
        "commitment_id": decision_id,
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
        motive={"direction": "oppose", "intensity": 1, "evidence_refs": [f"npc_agenda:{campaign_ws['npc_id']}"]},
    )
    assert opposed["data"]["final_difficulty"] == "hard"
    assert opposed["data"]["motive_delta"] == 1

    supported = _adjudicate(
        campaign_ws,
        "adj-supported",
        npc_defense_value=55,
        motive={"direction": "support", "intensity": 1, "evidence_refs": [f"npc_agenda:{campaign_ws['npc_id']}"]},
    )
    assert supported["data"]["final_difficulty"] == "regular"
    assert supported["data"]["motive_delta"] == -1

    automatic = _adjudicate(
        campaign_ws,
        "adj-automatic",
        npc_defense_value=45,
        motive={"direction": "support", "intensity": 1, "evidence_refs": [f"npc_agenda:{campaign_ws['npc_id']}"]},
    )
    assert automatic["data"]["feasibility"] == "automatic"


def test_social_adjudicate_leverage_cap_and_conditional(campaign_ws):
    leveraged = _adjudicate(
        campaign_ws,
        "adj-leverage",
        npc_defense_value=55,
        motive={"direction": "oppose", "intensity": 1, "evidence_refs": [f"npc_agenda:{campaign_ws['npc_id']}"]},
        leverage=[
            {"leverage_id": "film-sample", "type": "evidence", "source_ref": "clue:clue-house-built-1835", "independence_group": "film", "credibility": "verified", "relevance": "direct", "reason": "实体证据"},
            {"leverage_id": "protection-offer", "type": "promise", "source_ref": "clue:clue-neighbor-lawsuit-1852", "independence_group": "protection", "credibility": "verified", "relevance": "direct", "reason": "保护方案"},
            {"leverage_id": "ignored-third", "type": "evidence", "source_ref": "clue:clue-second-lawsuit-outcome-unrecorded", "independence_group": "third", "credibility": "verified", "relevance": "direct", "reason": "第三项"},
        ],
        tactical={"bonus": 1, "penalty": 0},
    )
    assert leveraged["ok"] is True, leveraged
    assert leveraged["data"]["leverage_delta"] == 2
    # hard(1) + oppose(1) - leverage(2) = 0 -> regular
    assert leveraged["data"]["final_difficulty"] == "regular"
    assert leveraged["data"]["bonus_dice"] == 1
    assert any("more than two" in warning for warning in leveraged["warnings"])

    conditional = _adjudicate(
        campaign_ws,
        "adj-conditional",
        npc_defense_value=30,
        motive={"direction": "oppose", "intensity": 2, "evidence_refs": [f"npc_agenda:{campaign_ws['npc_id']}"]},
    )
    assert conditional["data"]["feasibility"] == "conditional"
    assert any("requirements" in warning for warning in conditional["warnings"])

    beyond = _adjudicate(
        campaign_ws,
        "adj-beyond",
        npc_defense_value=92,
        motive={"direction": "oppose", "intensity": 1, "evidence_refs": [f"npc_agenda:{campaign_ws['npc_id']}"]},
    )
    assert beyond["data"]["feasibility"] == "conditional"


def test_social_adjudicate_goal_key_replay(campaign_ws):
    agendas_path = campaign_ws["campaign_dir"] / "scenario" / "npc-agendas.json"
    agendas = json.loads(agendas_path.read_text(encoding="utf-8"))
    for npc in agendas.get("npcs") or []:
        if npc.get("npc_id") == campaign_ws["npc_id"]:
            npc["skills"] = {"Psychology": 10, "Persuade": 55, "Charm": 90}
    _write_json(agendas_path, agendas)
    shared = {
        "conversation_window_id": "conv-replay",
        "commitment_id": "admit-tampering",
    }
    first = _adjudicate(
        campaign_ws,
        "adj-goal-1",
        motive={"direction": "oppose", "intensity": 1, "evidence_refs": [f"npc_agenda:{campaign_ws['npc_id']}"]},
        **shared,
    )
    assert first["data"]["replayed"] is False

    same = _adjudicate(
        campaign_ws,
        "adj-goal-2",
        approach="charm",
        motive={"direction": "oppose", "intensity": 1, "evidence_refs": [f"npc_agenda:{campaign_ws['npc_id']}"]},
        **shared,
    )
    assert same["data"]["replayed"] is True
    assert same["data"]["goal_key"] == first["data"]["goal_key"]
    assert any("does not reopen" in warning for warning in same["warnings"])

    changed = _adjudicate(
        campaign_ws,
        "adj-goal-3",
        motive={"direction": "oppose", "intensity": 1, "evidence_refs": [f"npc_agenda:{campaign_ws['npc_id']}"]},
        leverage=[
            {"leverage_id": "film-sample", "type": "evidence", "source_ref": "clue:clue-house-built-1835", "independence_group": "film", "credibility": "verified", "relevance": "direct", "reason": "实体证据"},
        ],
        **shared,
    )
    assert changed["data"]["replayed"] is False
    # hard(1) + oppose(1) - leverage(1) = 1 -> hard
    assert changed["data"]["final_difficulty"] == "hard"


def test_social_adjudicate_conflicting_decision_and_duplicate_provenance(campaign_ws):
    motive = {"direction": "oppose", "intensity": 1, "evidence_refs": [f"npc_agenda:{campaign_ws['npc_id']}"]}
    first = _adjudicate(campaign_ws, "adj-bound", npc_defense_value=55, motive=motive)
    assert first["ok"] is True
    replay = _adjudicate(campaign_ws, "adj-bound", npc_defense_value=55, motive=motive)
    assert replay["ok"] is True
    assert replay["data"] == first["data"]
    conflict = _adjudicate(campaign_ws, "adj-bound", npc_defense_value=90, motive=motive)
    assert conflict["ok"] is False
    assert conflict["error"]["code"] == "idempotency_conflict"

    duplicate = _adjudicate(
        campaign_ws,
        "adj-duplicate-source",
        npc_defense_value=55,
        leverage=[
            {"leverage_id": "one", "source_ref": "clue:clue-house-built-1835", "independence_group": "physical", "credibility": "verified", "relevance": "direct", "reason": "same sample"},
            {"leverage_id": "two", "source_ref": "clue:clue-house-built-1835", "independence_group": "copy", "credibility": "verified", "relevance": "direct", "reason": "duplicate description"},
            {"leverage_id": "three", "source_ref": "clue:clue-neighbor-lawsuit-1852", "independence_group": "physical", "credibility": "verified", "relevance": "direct", "reason": "same independence group"},
        ],
    )
    assert duplicate["ok"] is True
    assert duplicate["data"]["leverage_delta"] == 1
    assert len(duplicate["data"]["leverage"]) == 1

    secret = _adjudicate(
        campaign_ws,
        "adj-secret-source",
        leverage=[
            {"leverage_id": "secret", "source_ref": f"npc_agenda:{campaign_ws['npc_id']}", "independence_group": "secret", "credibility": "verified", "relevance": "direct", "reason": "keeper-only agenda"},
        ],
    )
    assert secret["ok"] is False
    assert secret["error"]["code"] == "leverage_source_invalid"

    bare_public = _adjudicate(
        campaign_ws,
        "adj-undelivered-event",
        leverage=[
            {"leverage_id": "undelivered", "source_ref": "event:event-public-1", "independence_group": "bare", "credibility": "verified", "relevance": "direct", "reason": "visibility label only"},
        ],
    )
    assert bare_public["ok"] is False
    assert bare_public["error"]["code"] == "leverage_source_invalid"


def test_social_defense_is_immutable_and_one_roll_closes_goal(campaign_ws):
    shared = {"conversation_window_id": "conv-bound", "commitment_id": "admit"}
    adjudicated = _adjudicate(
        campaign_ws, "adj-roll-bound", npc_defense_value=55, **shared
    )
    assert adjudicated["ok"] is True
    conflict = _adjudicate(
        campaign_ws, "adj-roll-defense-change", npc_defense_value=90, **shared
    )
    assert conflict["ok"] is False
    assert conflict["error"]["code"] == "social_goal_already_settled"

    roll_args = {
        "investigator": campaign_ws["investigator_id"],
        "npc_id": campaign_ws["npc_id"],
        "skill": adjudicated["data"]["approach_skill"],
        "difficulty": adjudicated["data"]["final_difficulty"],
        "bonus": adjudicated["data"]["bonus_dice"],
        "penalty": adjudicated["data"]["penalty_dice"],
        "goal": "承认篡改了档案",
        "stakes": {"on_success": "NPC 承认", "on_failure": "NPC 拒绝"},
        "difficulty_basis": "opponent_skill",
        "social_adjudication_ref": adjudicated["data"]["goal_key"],
        "seed": 11,
        "decision_id": "social-roll-1",
    }
    first_roll = _run(campaign_ws, "rules.roll", roll_args)
    assert first_roll["ok"] is True, first_roll
    assert first_roll["data"]["outcome_ceiling"] == adjudicated["data"]["outcome_ceiling"]
    replay = _run(campaign_ws, "rules.roll", roll_args)
    assert replay["ok"] is True
    fresh = _run(campaign_ws, "rules.roll", {**roll_args, "decision_id": "social-roll-2"})
    assert fresh["ok"] is False
    assert fresh["error"]["code"] == "social_goal_already_settled"


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

    impossible = _adjudicate(
        campaign_ws,
        "adj-impossible",
        feasibility="impossible",
        feasibility_refs=[f"npc_agenda:{campaign_ws['npc_id']}"],
        outcome_ceiling={
            "goal_scope": "解释自己并不知道的实体本质",
            "npc_knowledge_refs": [f"npc_fact:{campaign_ws['npc_id']}/fact-knott-commission"],
            "scene_truth_max_tier": 2,
            "forbidden_fact_refs": ["clue:clue-basement-burial-lawsuit"],
        },
    )
    assert impossible["ok"] is True, impossible
    assert impossible["data"]["feasibility"] == "impossible"

    unscoped = _adjudicate(
        campaign_ws,
        "adj-unscoped-ceiling",
        outcome_ceiling={
            "goal_scope": "说明所知",
            "npc_knowledge_refs": [f"npc_agenda:{campaign_ws['npc_id']}"],
            "scene_truth_max_tier": 2,
        },
    )
    assert unscoped["ok"] is False
    assert unscoped["error"]["code"] == "invalid_param"

    invalid_tier = _adjudicate(
        campaign_ws,
        "adj-invalid-tier",
        outcome_ceiling={"goal_scope": "说明所知", "scene_truth_max_tier": 5},
    )
    assert invalid_tier["ok"] is False
    assert invalid_tier["error"]["code"] == "invalid_param"


def _observe(ws, decision_id: str, **overrides) -> dict:
    args = {
        "investigator": ws["investigator_id"],
        "observer_scope": "team:party",
        "npc_id": ws["npc_id"],
        "conversation_window_id": "conv-psych",
        "observation_revision": 0,
        "question": "他在害怕谁？",
        "observable_fact_refs": ["clue:clue-basement-burial-lawsuit"],
        "seed": 7,
        "decision_id": decision_id,
    }
    args.update(overrides)
    return _run(ws, "rules.psychology_observe", args)


def test_psychology_observe_concealed_and_window_reuse(campaign_ws):
    first = _observe(campaign_ws, "psych-1")
    assert first["ok"] is True, first
    assert first["data"]["resolution"] == "settled"
    assert "visible_observation" not in first["data"]
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

    realized = _observe(
        campaign_ws,
        "psych-realize-1",
        action="realize",
        insight_id=first["data"]["insight_id"],
        visible_observation="他说到区里检查时，先看了门口。",
    )
    assert realized["ok"] is True, realized
    assert realized["data"]["resolution"] == "realized"
    assert realized["data"]["insight_id"] == first["data"]["insight_id"]
    assert realized["data"]["conversation_window_id"] == "conv-psych"
    assert realized["data"]["observation_revision"] == 0
    assert realized["data"]["visible_observation"] == "他说到区里检查时，先看了门口。"
    assert realized["data"]["request_digest"].startswith("sha256:")

    wrong_identity = _observe(
        campaign_ws,
        "psych-realize-wrong-observer",
        action="realize",
        observer_scope="team:other",
        insight_id=first["data"]["insight_id"],
        visible_observation="不应绑定。",
    )
    assert wrong_identity["ok"] is False
    assert wrong_identity["error"]["code"] == "revision_conflict"

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
    assert reopened["data"]["resolution"] == "reuse"
    assert reopened["data"]["insight_id"] == first["data"]["insight_id"]
    assert len(_read_jsonl(campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl")) == 1

    with (campaign_ws["campaign_dir"] / "logs" / "events.jsonl").open("a", encoding="utf-8") as handle:
        handle.write(json.dumps({"event_id": "event-decisive", "event_type": "decisive_evidence_presented", "visibility": "public"}) + "\n")
    decisive = _observe(
        campaign_ws,
        "psych-4",
        observation_revision=1,
        revision_event_ref="event:event-decisive",
    )
    assert decisive["ok"] is True, decisive
    assert decisive["data"]["resolution"] == "settled"
    assert decisive["data"]["insight_id"] != first["data"]["insight_id"]
    assert len(_read_jsonl(campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl")) == 2
    reused_boundary = _observe(
        campaign_ws,
        "psych-5",
        observation_revision=2,
        revision_event_ref="event:event-decisive",
    )
    assert reused_boundary["ok"] is False
    assert reused_boundary["error"]["code"] == "observation_revision_invalid"


def test_psychology_policy_uses_real_coc_outcome_vocabulary():
    resolver = _load(
        "coc7_resolver_psych_policy",
        REPO / "plugins" / "coc-keeper" / "rulesets" / "coc7" / "resolver.py",
    )
    expected = {
        "regular": "immediate_intent",
        "hard": "motive_link",
        "extreme": "deep_conflict",
        "critical": "deep_conflict",
        "failure": "uncertain",
        "fumble": "uncertain",
    }
    for outcome, depth in expected.items():
        assert resolver.psychology_policy({"outcome": outcome}, "question")["inference_depth"] == depth


def test_psychology_observe_decision_conflict_and_invalid_revision(campaign_ws):
    premature = _observe(
        campaign_ws,
        "psych-premature-realization",
        visible_observation="他肯定在撒谎。",
    )
    assert premature["ok"] is False
    assert premature["error"]["code"] == "invalid_param"

    first = _observe(campaign_ws, "psych-bound")
    assert first["ok"] is True
    conflict = _observe(campaign_ws, "psych-bound", question="他准备攻击吗？")
    assert conflict["ok"] is False
    assert conflict["error"]["code"] == "idempotency_conflict"

    invalid = _observe(campaign_ws, "psych-invalid-revision", observation_revision=1)
    assert invalid["ok"] is False
    assert invalid["error"]["code"] == "observation_revision_invalid"
