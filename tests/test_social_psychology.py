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
    assert plain["data"]["roll_operation"] == {
        "operation": "rules.roll",
        "invoke_via": "coc_rules_roll",
        "prefilled_arguments": {
            "investigator": campaign_ws["investigator_id"],
            "npc_id": campaign_ws["npc_id"],
            "skill": plain["data"]["approach_skill"],
            "difficulty": "regular",
            "bonus": 0,
            "penalty": 0,
            "goal": "承认篡改了档案",
            "difficulty_basis": "opponent_skill",
            "social_adjudication_ref": plain["data"]["goal_key"],
        },
        "missing_arguments": ["stakes", "decision_id"],
        "argument_boundary": {
            "submission_shape": "prefilled_plus_missing_only",
            "forbidden_arguments": ["target", "reason"],
        },
    }

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
    assert supported["data"]["feasibility"] == "automatic"
    assert "roll_operation" not in supported["data"]
    assert supported["data"]["motive_delta"] == -1

    automatic = _adjudicate(
        campaign_ws,
        "adj-automatic",
        npc_defense_value=45,
        motive={"direction": "support", "intensity": 1, "evidence_refs": [f"npc_agenda:{campaign_ws['npc_id']}"]},
    )
    assert automatic["data"]["feasibility"] == "automatic"
    assert "roll_operation" not in automatic["data"]


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
    # KP envelope keeps pre-slice fields; one-level flag lives on the resolver.
    assert "leverage_one_level" not in leveraged["data"]
    assert leveraged["data"]["leverage_delta"] == 1
    # hard(1) + oppose(1) - one-level leverage(1) = 1 -> hard (pdf 104 block 88)
    assert leveraged["data"]["final_difficulty"] == "hard"
    assert leveraged["data"]["bonus_dice"] == 1
    assert any("only one difficulty level" in warning for warning in leveraged["warnings"])
    host = _invoke_social_host_internal(
        approach="persuade",
        motive_direction="oppose",
        motive_intensity=1,
        bonus=1,
        leverage_one_level=True,
    )
    assert host["leverage_one_level"] is True
    assert host["strategic_adjustment"] == -1
    assert host["final_difficulty"] == "hard"

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

    keeper_fact = _adjudicate(
        campaign_ws,
        "adj-keeper-fact-source",
        leverage=[
            {
                "leverage_id": "keeper-fact",
                "source_ref": f"npc_fact:{campaign_ws['npc_id']}/fact-knott-commission",
                "independence_group": "keeper-fact",
                "credibility": "verified",
                "relevance": "direct",
                "reason": "undiscovered Keeper fact",
            },
        ],
    )
    assert keeper_fact["ok"] is False
    assert keeper_fact["error"]["code"] == "leverage_source_invalid"

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
        "observable_fact_refs": [
            f"npc_fact:{ws['npc_id']}/fact-knott-commission"
        ],
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
    assert first["data"]["observable_fact_refs"][0]["kind"] == "npc_fact"
    assert first["data"]["observable_fact_refs"][0]["player_known"] is False
    assert (
        first["data"]["observable_fact_refs"][0]["grounding_scope"]
        == "keeper_target_truth"
    )
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
    assert realized["data"]["player_projection"] == {
        "external_behavior": "他说到区里检查时，先看了门口。"
    }
    assert realized["data"]["visible_observation"] == "他说到区里检查时，先看了门口。"
    concealed = realized["data"]["concealed_result"]
    assert concealed["conversation_window_id"] == "conv-psych"
    assert concealed["observation_revision"] == 0
    assert concealed["question"] == first["data"]["question"]
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
    assert wrong_identity["error"]["code"] == "invalid_param"

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

    with (campaign_ws["campaign_dir"] / "logs" / "events.jsonl").open(
        "a", encoding="utf-8"
    ) as handle:
        handle.write(
            json.dumps(
                {
                    "event_id": "event-decisive",
                    "event_type": "decisive_evidence_presented",
                    "visibility": "public",
                }
            )
            + "\n"
        )
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


@pytest.mark.parametrize(
    "source_ref",
    [
        "fact-knott-commission",
        "clue-knott-commission",
        "npc_fact:npc-steven-knott/fact-does-not-exist",
        "npc_fact:npc-dooley/fact-dooley-macario",
    ],
)
def test_psychology_grounding_rejects_bare_unknown_and_other_npc_refs(
    campaign_ws, source_ref
):
    rejected = _observe(
        campaign_ws,
        f"psych-bad-grounding-{source_ref}",
        observable_fact_refs=[source_ref],
    )
    assert rejected["ok"] is False
    assert rejected["error"]["code"] == "psychology_grounding_invalid"
    assert "npc_fact:<npc_id>/<fact_id>" in rejected["hints"][0]


def test_psychology_can_still_use_a_canonical_player_known_clue(campaign_ws):
    observed = _observe(
        campaign_ws,
        "psych-player-known-clue",
        conversation_window_id="conv-player-known-clue",
        observable_fact_refs=["clue:clue-basement-burial-lawsuit"],
    )
    assert observed["ok"] is True, observed
    assert observed["data"]["observable_fact_refs"][0]["kind"] == "clue"
    assert observed["data"]["observable_fact_refs"][0]["player_known"] is True
    assert (
        observed["data"]["observable_fact_refs"][0]["grounding_scope"]
        == "player_known_observation"
    )

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


def test_psychology_observer_scope_aliases_cannot_reopen_team_window(campaign_ws):
    party_path = campaign_ws["campaign_dir"] / "party.json"
    party = json.loads(party_path.read_text(encoding="utf-8"))
    party["investigator_ids"] = [
        campaign_ws["investigator_id"], "investigator-b", "investigator-c", "investigator-d"
    ]
    _write_json(party_path, party)

    canonical = _observe(campaign_ws, "psych-team-canonical", observer_scope="team:party")
    assert canonical["ok"] is True
    assert canonical["data"]["resolution"] == "settled"
    for alias in ("team:a", "team:b"):
        rejected = _observe(
            campaign_ws,
            f"psych-{alias}",
            observer_scope=alias,
        )
        assert rejected["ok"] is False
        assert rejected["error"]["code"] == "invalid_param"
    assert len(_read_jsonl(campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl")) == 1


def test_psychology_individual_and_team_entries_share_one_window(campaign_ws):
    investigator_id = campaign_ws["investigator_id"]
    individual_first = _observe(
        campaign_ws,
        "psych-individual-first",
        observer_scope=investigator_id,
        conversation_window_id="conv-individual-team",
    )
    team_second = _observe(
        campaign_ws,
        "psych-team-second",
        observer_scope="team:party",
        conversation_window_id="conv-individual-team",
    )
    assert individual_first["data"]["resolution"] == "settled"
    assert team_second["data"]["resolution"] == "reuse"
    assert team_second["data"]["insight_id"] == individual_first["data"]["insight_id"]

    team_first = _observe(
        campaign_ws,
        "psych-team-first",
        observer_scope="team:party",
        conversation_window_id="conv-team-individual",
    )
    individual_second = _observe(
        campaign_ws,
        "psych-individual-second",
        observer_scope=investigator_id,
        conversation_window_id="conv-team-individual",
    )
    assert team_first["data"]["resolution"] == "settled"
    assert individual_second["data"]["resolution"] == "reuse"
    assert individual_second["data"]["insight_id"] == team_first["data"]["insight_id"]
    assert len(_read_jsonl(campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl")) == 2


def test_psychology_four_party_investigators_share_one_team_window(campaign_ws):
    original_id = campaign_ws["investigator_id"]
    member_ids = [original_id, "investigator-b", "investigator-c", "investigator-d"]
    coc_root = campaign_ws["coc_root"]
    original_sheet = json.loads(
        (coc_root / "investigators" / original_id / "character.json").read_text(encoding="utf-8")
    )
    original_state = json.loads(
        (campaign_ws["campaign_dir"] / "save" / "investigator-state" / f"{original_id}.json").read_text(encoding="utf-8")
    )
    for member_id in member_ids[1:]:
        sheet = dict(original_sheet)
        sheet["id"] = member_id
        _write_json(coc_root / "investigators" / member_id / "character.json", sheet)
        state = dict(original_state)
        state["investigator_id"] = member_id
        _write_json(
            campaign_ws["campaign_dir"] / "save" / "investigator-state" / f"{member_id}.json",
            state,
        )
    party_path = campaign_ws["campaign_dir"] / "party.json"
    party = json.loads(party_path.read_text(encoding="utf-8"))
    party["investigator_ids"] = member_ids
    _write_json(party_path, party)

    results = [
        _observe(
            campaign_ws,
            f"psych-party-{member_id}",
            investigator=member_id,
            observer_scope=member_id,
            conversation_window_id="conv-four-party",
        )
        for member_id in member_ids
    ]
    assert results[0]["data"]["resolution"] == "settled"
    assert [result["data"]["resolution"] for result in results[1:]] == ["reuse"] * 3
    assert len({result["data"]["insight_id"] for result in results}) == 1
    assert len(_read_jsonl(campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl")) == 1


def _resolver():
    return _load(
        "coc7_resolver_social_psych_contract",
        REPO / "plugins" / "coc-keeper" / "rulesets" / "coc7" / "resolver.py",
    )


def _social_ops():
    return coc_toolbox.OPERATION_MODULES["social-psychology"]


GOLDEN_PATH = REPO / "tests" / "fixtures" / "social-psychology-pre-slice-golden.json"
_SCENE_HINT_PREFIX = "scene state was updated"
_ENVELOPE_KEYS = ("ok", "data", "warnings", "hints")
# Sole documented source-justified rewrite vs main HEAD (pdf 215 / printed 204 block 96).
_PSYCHOLOGY_FIRST_HINT_REWRITE = (
    "the roll and outcome are keeper-concealed: the player sees only your "
    "observation prose; on failure you may give any unreliable information "
    "including the opposite, but do not automatically invert and do not expose the roll"
)


def _load_pre_slice_golden() -> dict:
    return json.loads(GOLDEN_PATH.read_text(encoding="utf-8"))


def _canonical(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _without_scene_hints(hints: list) -> list:
    if not isinstance(hints, list):
        raise AssertionError(f"hints must be a list, got {type(hints).__name__}")
    return [hint for hint in hints if not str(hint).startswith(_SCENE_HINT_PREFIX)]


def _require_envelope_keys(result: dict) -> None:
    missing = [key for key in _ENVELOPE_KEYS if key not in result]
    if missing:
        raise AssertionError(f"envelope missing keys: {missing}")


def _normalized_tool_envelope(result: dict) -> dict:
    """Complete run_tool envelope minus dynamic scene-revision bookkeeping hints.

    Absent ``warnings``/``hints`` is a failure, distinct from a present empty list.
    """
    _require_envelope_keys(result)
    warnings = result["warnings"]
    hints = result["hints"]
    if not isinstance(warnings, list):
        raise AssertionError(f"warnings must be a list, got {type(warnings).__name__}")
    return {
        "ok": result["ok"],
        "data": result["data"],
        "warnings": list(warnings),
        "hints": _without_scene_hints(hints),
    }


def _invoke_social_host_internal(
    *,
    approach: str = "intimidate",
    motive_direction: str = "oppose",
    motive_intensity: int = 1,
    bonus: int = 0,
    penalty: int = 0,
    npc_defense: int | None = 55,
    **overlay_kwargs,
):
    """The declared host-internal seam: overlay -> request -> resolver."""
    ops = _social_ops()
    overlay = ops.social_host_internal_overlay(**overlay_kwargs)
    request = ops.build_social_difficulty_request(
        approach=approach,
        motive_direction=motive_direction,
        motive_intensity=motive_intensity,
        bonus=bonus,
        penalty=penalty,
        host_internal=overlay,
    )
    return _resolver().social_difficulty(request, npc_defense)


def test_social_difficulty_unit_consumes_supporting_action_as_one_level():
    """Resolver unit test (not the host-internal overlay/request seam)."""
    resolver = _resolver()
    supporting = {
        "description": "holding a crowbar and clearly willing to use it",
        "level": 1,
        "provenance": "player-source",
    }
    stacked = resolver.social_difficulty(
        {
            "approach": "intimidate",
            "described_action": "swings a crowbar near the doctor's head",
            "goal": "name the police contact",
            "motive_direction": "oppose",
            "motive_intensity": 1,
            "motive_evidence": ["npc_agenda:npc-1"],
            "supporting_action": supporting,
            "leverage_one_level": True,
        },
        55,
    )
    assert stacked["leverage_one_level"] is True
    assert stacked["supporting_action"] == supporting
    assert stacked["described_action"]
    assert stacked["goal"] == "name the police contact"
    # hard + oppose(1) - one level = hard; a second supporting item cannot stack.
    assert stacked["final_difficulty"] == "hard"
    assert stacked["feasibility"] == "roll"
    from_action_only = resolver.social_difficulty(
        {
            "approach": "intimidate",
            "motive_direction": "oppose",
            "motive_intensity": 1,
            "supporting_action": supporting,
        },
        55,
    )
    assert from_action_only["leverage_one_level"] is True
    assert from_action_only["strategic_adjustment"] == -1
    assert from_action_only["final_difficulty"] == "hard"
    without = resolver.social_difficulty(
        {
            "approach": "intimidate",
            "motive_direction": "oppose",
            "motive_intensity": 1,
        },
        55,
    )
    assert without["leverage_one_level"] is False
    assert without["final_difficulty"] == "extreme"
    assert without["supporting_action"] == {
        "description": "", "level": 0, "provenance": "",
    }
    with pytest.raises(ValueError, match="supporting_action must be an object"):
        resolver.social_difficulty(
            {
                "approach": "intimidate",
                "supporting_action": "holding a crowbar",
            },
            55,
        )
    with pytest.raises(ValueError, match="supporting_action.level must be 0 or 1"):
        resolver.social_difficulty(
            {
                "approach": "intimidate",
                "supporting_action": {
                    "description": "x", "level": True, "provenance": "",
                },
            },
            55,
        )
    with pytest.raises(ValueError, match="supporting_action.level must be 0 or 1"):
        resolver.social_difficulty(
            {
                "approach": "intimidate",
                "supporting_action": {
                    "description": "x", "level": 0.0, "provenance": "",
                },
            },
            55,
        )
    legacy_two = resolver.social_difficulty(
        {"approach": "intimidate", "strategic_count": 2, "motive_direction": "oppose", "motive_intensity": 1},
        55,
    )
    assert legacy_two["leverage_one_level"] is True
    assert legacy_two["strategic_adjustment"] == -1
    assert legacy_two["final_difficulty"] == "hard"


def test_positive_inclination_is_automatic_even_at_hard_and_extreme():
    resolver = _resolver()
    for defense, base in ((55, "hard"), (92, "extreme")):
        policy = resolver.social_difficulty(
            {"approach": "persuade", "motive_direction": "support", "motive_intensity": 1},
            defense,
        )
        assert policy["base_difficulty"] == base
        assert policy["feasibility"] == "automatic"


def test_social_positive_inclination_produces_no_roll_operation(campaign_ws):
    hard = _adjudicate(
        campaign_ws,
        "adj-inclined-hard",
        npc_defense_value=55,
        motive={
            "direction": "support",
            "intensity": 1,
            "evidence_refs": [f"npc_agenda:{campaign_ws['npc_id']}"],
        },
    )
    extreme = _adjudicate(
        campaign_ws,
        "adj-inclined-extreme",
        npc_defense_value=92,
        motive={
            "direction": "support",
            "intensity": 1,
            "evidence_refs": [f"npc_agenda:{campaign_ws['npc_id']}"],
        },
    )
    for result in (hard, extreme):
        assert result["ok"] is True, result
        assert result["data"]["feasibility"] == "automatic"
        assert "roll_operation" not in result["data"]


def test_social_supporting_action_with_host_provenance_is_one_level():
    # Host-internal overlay/request seam (not the KP schema).
    supporting = {
        "description": "拿出撬棍对准太阳穴",
        "level": 1,
        "provenance": "host",
    }
    result = _invoke_social_host_internal(
        described_action="慢慢靠近并用撬棍威胁",
        supporting_action=supporting,
        leverage_one_level=True,
    )
    assert result["described_action"] == "慢慢靠近并用撬棍威胁"
    assert result["supporting_action"] == supporting
    assert result["leverage_one_level"] is True
    assert result["strategic_adjustment"] == -1
    assert result["final_difficulty"] == "hard"
    assert result["feasibility"] == "roll"
    stacked = _invoke_social_host_internal(
        supporting_action=supporting,
        leverage_one_level=True,
    )
    assert stacked["leverage_one_level"] is True
    assert stacked["strategic_adjustment"] == -1
    assert stacked["final_difficulty"] == "hard"
    from_action_only = _invoke_social_host_internal(
        supporting_action=supporting,
    )
    assert from_action_only["leverage_one_level"] is True
    assert from_action_only["strategic_adjustment"] == -1
    assert from_action_only["final_difficulty"] == "hard"


def test_social_host_internal_seam_break_fails_new_contract(monkeypatch):
    ops = _social_ops()
    monkeypatch.setattr(ops, "social_host_internal_overlay", lambda **_kwargs: {})
    result = _invoke_social_host_internal(
        described_action="慢慢靠近并用撬棍威胁",
        supporting_action="拿出撬棍对准太阳穴",
        leverage_one_level=True,
    )
    with pytest.raises(AssertionError):
        assert result["described_action"] == "慢慢靠近并用撬棍威胁"
        assert result["supporting_action"] == "拿出撬棍对准太阳穴"
        assert result["leverage_one_level"] is True


def test_psychology_policy_realize_consumes_ceiling_and_behavior_without_reroll():
    resolver = _resolver()
    realized = resolver.psychology_policy(
        {
            "inference_ceiling": "immediate_intent",
            "external_behavior": "he glances at the door before answering",
            "outcome": "regular",
        },
        "realize",
    )
    assert realized["player_projection"] == {
        "external_behavior": "he glances at the door before answering"
    }
    assert realized["concealed_result"]["inference_ceiling"] == "immediate_intent"
    assert "reroll" not in realized
    assert "reexecution" not in realized
    assert "inference_depth" not in realized
    assert "external_behavior" not in realized
    assert "inference_ceiling" not in realized


def test_psychology_failure_is_unreliable_not_compelled_invert():
    resolver = _resolver()
    for outcome in ("failure", "fumble"):
        policy = resolver.psychology_policy({"outcome": outcome}, "question")
        assert policy["inference_depth"] == "uncertain"
        assert policy["misread_policy"] == "any_unreliable_including_opposite"
    success = resolver.psychology_policy({"outcome": "regular"}, "question")
    assert success["misread_policy"] == "none"


def test_psychology_check_contract_defaults_observer_to_ten_and_uses_target_social():
    resolver = _resolver()
    assert resolver.PSYCHOLOGY_BASE_CHANCE == 10
    vacant = resolver.psychology_check_contract({})
    assert vacant["observer_skill"] == 10
    assert vacant["observer_skill_base_chance"] == 10
    assert vacant["observer_skill_source"] == "rulebook_base"
    assert vacant["defense_skills"] == ["Charm", "Fast Talk", "Intimidate", "Persuade"]
    assert vacant["difficulty"] == "regular"
    against_social = resolver.psychology_check_contract(
        {
            "observer_skill": 45,
            "target_opposing_social": 70,
            "question": "is he lying?",
            "observable_facts": ["npc_fact:npc-1/fact-a"],
        }
    )
    assert against_social["observer_skill"] == 45
    assert against_social["observer_skill_source"] == "sheet"
    assert against_social["target_opposing_social"] == 70
    assert against_social["difficulty"] == "hard"
    assert against_social["question"] == "is he lying?"
    psychology_sheet_only = resolver.psychology_check_contract(10)
    assert psychology_sheet_only["difficulty"] == "regular"
    extreme = resolver.psychology_check_contract({"target_opposing_social": 90})
    assert extreme["difficulty"] == "extreme"


def test_psychology_observe_uses_target_social_not_psychology_sheet(campaign_ws):
    agendas_path = campaign_ws["campaign_dir"] / "scenario" / "npc-agendas.json"
    agendas = json.loads(agendas_path.read_text(encoding="utf-8"))
    for npc in agendas.get("npcs") or []:
        if npc.get("npc_id") == campaign_ws["npc_id"]:
            npc["skills"] = {"Psychology": 10, "Persuade": 70, "Charm": 20, "Fast Talk": 15, "Intimidate": 25}
    _write_json(agendas_path, agendas)
    # Host-internal contract: difficulty from target Persuade 70, not Psychology 10.
    contract = _resolver().psychology_check_contract({"target_opposing_social": 70})
    assert contract["target_opposing_social"] == 70
    assert contract["difficulty"] == "hard"
    assert contract["defense_skills"] == ["Charm", "Fast Talk", "Intimidate", "Persuade"]
    observed = _observe(
        campaign_ws,
        "psych-target-social",
        conversation_window_id="conv-target-social",
        seed=11,
    )
    assert observed["ok"] is True, observed
    assert "target_opposing_social" not in observed["data"]
    assert "target_opposing_social_key" not in observed["data"]
    assert "difficulty" not in observed["data"]
    rows = {
        row["roll_id"]: row
        for row in _read_jsonl(campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl")
    }
    roll = rows[observed["data"]["roll_id"]]
    payload = roll.get("payload") if isinstance(roll.get("payload"), dict) else roll
    assert payload.get("difficulty") == "hard" or roll.get("difficulty") == "hard"


def test_psychology_observe_defaults_missing_skill_to_ten_percent(campaign_ws):
    investigator_id = campaign_ws["investigator_id"]
    sheet_path = campaign_ws["coc_root"] / "investigators" / investigator_id / "character.json"
    sheet = json.loads(sheet_path.read_text(encoding="utf-8"))
    skills = dict(sheet.get("skills") or {})
    skills.pop("Psychology", None)
    sheet["skills"] = skills
    _write_json(sheet_path, sheet)
    contract = _resolver().psychology_check_contract({})
    assert contract["observer_skill"] == 10
    assert contract["observer_skill_base_chance"] == 10
    assert contract["observer_skill_source"] == "rulebook_base"
    observed = _observe(
        campaign_ws,
        "psych-base-10",
        conversation_window_id="conv-base-10",
        seed=3,
    )
    assert observed["ok"] is True, observed
    assert "observer_skill" not in observed["data"]
    assert "observer_skill_base_chance" not in observed["data"]
    assert "observer_skill_source" not in observed["data"]
    rows = {
        row["roll_id"]: row
        for row in _read_jsonl(campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl")
    }
    roll = rows[observed["data"]["roll_id"]]
    payload = roll.get("payload") if isinstance(roll.get("payload"), dict) else roll
    assert payload.get("target") == 10 or roll.get("target") == 10


def test_psychology_realize_binds_ceiling_without_a_second_roll(campaign_ws):
    first = _observe(
        campaign_ws,
        "psych-realize-contract",
        conversation_window_id="conv-realize-contract",
        seed=7,
    )
    assert first["ok"] is True, first
    rolls_before = _read_jsonl(campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl")
    realized = _observe(
        campaign_ws,
        "psych-realize-contract-bind",
        action="realize",
        conversation_window_id="conv-realize-contract",
        insight_id=first["data"]["insight_id"],
        visible_observation="他说到区里检查时，先看了门口。",
        seed=99,
    )
    assert realized["ok"] is True, realized
    assert realized["data"]["resolution"] == "realized"
    assert realized["data"]["player_projection"] == {
        "external_behavior": "他说到区里检查时，先看了门口。"
    }
    assert realized["data"]["concealed_result"]["inference_ceiling"] == first["data"][
        "inference_depth"
    ]
    assert "reroll" not in realized["data"]
    assert "reexecution" not in realized["data"]
    assert "inference_ceiling" not in realized["data"]
    rolls_after = _read_jsonl(campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl")
    assert len(rolls_after) == len(rolls_before)
    if first["data"]["misread_policy"] != "none":
        assert first["data"]["misread_policy"] == "any_unreliable_including_opposite"


def test_psychology_realization_public_projection_strips_concealed_fields():
    resolver = _resolver()
    stuffed = {
        "external_behavior": "he glances at the door before answering",
        "inference_ceiling": "deep_conflict",
        "question": "is he lying about the cellar?",
        "observable_fact_refs": ["npc_fact:npc-1/secret-motive"],
        "observable_facts": ["the cellar key is in his sleeve"],
        "investigator_id": "inv-ada",
        "observer_scope": "individual:inv-ada",
        "npc_id": "npc-corbitt",
        "insight_id": "psych-insight-deadbeef",
        "conversation_window_id": "conv-secret",
        "observation_revision": 2,
        "window_key": "individual\\x00npc-corbitt\\x00conv-secret\\x000",
        "outcome": "extreme",
        "roll_id": "roll-concealed-99",
        "inference_depth": "deep_conflict",
        "misread_policy": "none",
        "observer_skill": 70,
        "observer_skill_base_chance": 10,
        "target_opposing_social": 90,
        "visible_observation": "should not leak as a second public key",
        "reroll": False,
        "reexecution": False,
    }
    public = resolver.psychology_realization_public_projection(stuffed)
    assert public == {"external_behavior": stuffed["external_behavior"]}
    assert set(public) == resolver.PSYCHOLOGY_REALIZATION_PUBLIC_KEYS
    leaked = set(public) & {
        "inference_ceiling",
        "question",
        "observable_fact_refs",
        "observable_facts",
        "investigator_id",
        "observer_scope",
        "npc_id",
        "insight_id",
        "conversation_window_id",
        "observation_revision",
        "window_key",
        "outcome",
        "roll_id",
        "inference_depth",
        "misread_policy",
        "observer_skill",
        "observer_skill_base_chance",
        "target_opposing_social",
        "visible_observation",
        "reroll",
        "reexecution",
    }
    assert leaked == set()
    dumped = json.dumps(public, ensure_ascii=False)
    for fragment in (
        "deep_conflict",
        "is he lying",
        "secret-motive",
        "inv-ada",
        "npc-corbitt",
        "roll-concealed-99",
        "cellar key",
    ):
        assert fragment not in dumped


def test_psychology_check_contract_rejects_payload_base_chance():
    resolver = _resolver()
    with pytest.raises(ValueError, match="PSYCHOLOGY_BASE_CHANCE"):
        resolver.psychology_check_contract({"observer_skill_base_chance": 10})
    vacant = resolver.psychology_check_contract({})
    assert vacant["observer_skill"] == resolver.PSYCHOLOGY_BASE_CHANCE


def test_psychology_policy_rejects_reroll_payload_constants():
    resolver = _resolver()
    payload = {
        "inference_ceiling": "immediate_intent",
        "external_behavior": "he glances at the door",
        "reroll": False,
        "reexecution": False,
    }
    with pytest.raises(ValueError, match="no roll path"):
        resolver.psychology_policy(payload, "realize")


def test_psychology_realize_public_projection_omits_concealed_fields(campaign_ws):
    first = _observe(
        campaign_ws,
        "psych-realize-secrecy",
        conversation_window_id="conv-realize-secrecy",
        seed=7,
    )
    assert first["ok"] is True, first
    realized = _observe(
        campaign_ws,
        "psych-realize-secrecy-bind",
        action="realize",
        conversation_window_id="conv-realize-secrecy",
        insight_id=first["data"]["insight_id"],
        visible_observation="他说到区里检查时，先看了门口。",
    )
    assert realized["ok"] is True, realized
    public = realized["data"]["player_projection"]
    assert set(public) == {"external_behavior"}
    assert public["external_behavior"] == "他说到区里检查时，先看了门口。"
    concealed = realized["data"]["concealed_result"]
    assert concealed["inference_ceiling"] == first["data"]["inference_depth"]
    assert concealed["question"] == first["data"]["question"]
    assert "observable_fact_refs" in concealed
    dumped = json.dumps(public, ensure_ascii=False)
    for fragment in (
        concealed["inference_ceiling"],
        concealed["question"],
        concealed["investigator_id"],
        concealed["npc_id"],
        first["data"]["roll_id"],
    ):
        assert fragment not in dumped


def test_legacy_social_and_psychology_envelopes_match_pre_slice(campaign_ws):
    # Golden captured from main HEAD (c2090cf9) by overlaying that commit's
    # social operation + coc7 resolver and running these exact calls. See
    # tests/fixtures/generate_social_psychology_pre_slice_golden.py.
    golden = _load_pre_slice_golden()
    assert golden["provenance"]["main_commit"].startswith("c2090cf9")
    assert campaign_ws["investigator_id"] == golden["identities"]["investigator_id"]
    assert campaign_ws["npc_id"] == golden["identities"]["npc_id"]
    schema = coc_toolbox._describe("rules.social_adjudicate")["params"]
    assert sorted(schema) == golden["social_schema_params"]
    args = {
        "investigator": campaign_ws["investigator_id"],
        "npc_id": campaign_ws["npc_id"],
        "conversation_window_id": "conv-main",
        "commitment_id": "adj-legacy-pin",
        "approach": "persuade",
        "goal_summary": "承认篡改了档案",
        "npc_defense_value": 45,
        "decision_id": "adj-legacy-pin",
    }
    first = _run(campaign_ws, "rules.social_adjudicate", args)
    assert _canonical(_normalized_tool_envelope(first)) == _canonical(
        _normalized_tool_envelope(golden["social_first"])
    )
    replay_args = dict(args)
    replay_args["decision_id"] = "adj-legacy-pin-replay"
    replay = _run(campaign_ws, "rules.social_adjudicate", replay_args)
    assert _canonical(_normalized_tool_envelope(replay)) == _canonical(
        _normalized_tool_envelope(golden["social_replay"])
    )
    observed = _observe(
        campaign_ws,
        "psych-legacy-pin",
        conversation_window_id="conv-legacy-pin",
        seed=7,
    )
    live_psych = _normalized_tool_envelope(observed)
    expected_psych = _normalized_tool_envelope(golden["psychology_settle"])
    # Complete envelope pin. The first hint is the sole documented
    # source-justified rewrite (pdf 215 / printed 204 block 96); substitute
    # that exact string, then compare the whole envelope.
    assert expected_psych["hints"], "golden psychology hints must be present"
    expected_psych = {
        **expected_psych,
        "hints": [_PSYCHOLOGY_FIRST_HINT_REWRITE, *expected_psych["hints"][1:]],
    }
    assert _canonical(live_psych) == _canonical(expected_psych)
