"""Behavior tests for canonical-events wiring into MEMORY and NPC modules
(plan task t4: belief-asserted / belief-reframed / memory-written /
npc-relationship-changed).

Public paths under test:
- ``coc_belief_state.apply_belief_turn`` → belief-asserted (+mode), belief-reframed;
- ``coc_temporal_memory.record_assertion`` / ``record_episode`` → memory-written
  (semantic refs only: memory_id, memory_kind, subject/knower refs);
- ``npc.reaction`` / ``state.npc_update`` toolbox tools → npc-relationship-changed.

Contract invariants asserted per site: emit strictly AFTER the authoritative
write, secret mirrors source privacy, decision_id-keyed idempotency collapses
byte-equal replays without appending, and rejected/failed writes leave no
canonical event behind.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "plugins" / "coc-keeper" / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import coc_canonical_events as cem


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_belief_state = _load(
    "coc_belief_state_wiring_under_test",
    SCRIPTS / "coc_belief_state.py",
)
tm = _load(
    "coc_temporal_memory_wiring_under_test",
    SCRIPTS / "coc_temporal_memory.py",
)
contract = tm.contract

COMMIT_A = "a" * 40


@pytest.fixture(autouse=True)
def _fresh_emission_runtime():
    cem.reset_emission_runtime_state()
    yield
    cem.reset_emission_runtime_state()


def read_stream(campaign_dir: Path) -> list[dict]:
    path = Path(campaign_dir) / "logs" / cem.CANONICAL_STREAM_NAME
    if not path.is_file():
        return []
    return [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def stream_types(rows: list[dict]) -> list[str]:
    return [row["type"] for row in rows]


# ---------------------------------------------------------------------------
# Belief wiring (apply_belief_turn)
# ---------------------------------------------------------------------------


def _belief_campaign(tmp_path: Path) -> Path:
    campaign = tmp_path / "belief-campaign"
    (campaign / "save").mkdir(parents=True)
    (campaign / "logs").mkdir(parents=True)
    return campaign


def _belief_plan(*, hypothesis=None, contract_effects=None, decision_id="turn-decision-1", turn_number=3):
    rich: dict = {"primary_intent": "investigate"}
    if hypothesis is not None:
        rich["player_hypothesis"] = hypothesis
    plan: dict = {
        "decision_id": decision_id,
        "turn_input": {"turn_number": turn_number, "player_intent_rich": rich},
    }
    if contract_effects is not None:
        plan["epistemic_contract"] = {"resolved_effects": contract_effects}
    return plan


def test_new_then_repeated_hypothesis_emit_belief_asserted(tmp_path):
    campaign = _belief_campaign(tmp_path)

    first = coc_belief_state.apply_belief_turn(
        campaign,
        _belief_plan(hypothesis="地下室里藏着仪式用品"),
        [],
        "thomas-hayes",
        "2026-01-01T00:00:00Z",
    )
    assert first, "the candidate should reduce into a legacy belief event"

    rows = read_stream(campaign)
    assert stream_types(rows) == ["belief-asserted"]
    row = rows[0]
    cem.validate_event(row)
    assert row["privacy"] == "public"
    assert row["source"] == "coc_belief_state.apply_belief_turn"
    assert row["campaign"] == "belief-campaign"
    assert row["timeline"] == "tl-main"
    assert row["turn"] == 3
    assert row["decision_id"] == "turn-decision-1:belief-assert:hyp-000001"
    assert row["id"].startswith("belief-asserted-belief-campaign-tl-main-t3-")
    assert row["data"]["hypothesis_id"] == "hyp-000001"
    assert row["data"]["holder"] == "thomas-hayes"
    assert row["data"]["mode"] == "asserted"
    assert row["data"]["statement"] == "地下室里藏着仪式用品"

    replay = coc_belief_state.apply_belief_turn(
        campaign,
        _belief_plan(hypothesis="地下室里藏着仪式用品"),
        [],
        "thomas-hayes",
        "2026-01-01T00:00:00Z",
    )
    assert replay
    # Byte-equal replay of the settled write collapses onto the stored event.
    assert len(read_stream(campaign)) == 1

    repeated_plan = _belief_plan(
        hypothesis="地下室里藏着仪式用品",
        decision_id="turn-decision-2",
    )
    coc_belief_state.apply_belief_turn(
        campaign, repeated_plan, [], "thomas-hayes", "2026-01-01T00:00:00Z"
    )
    rows = read_stream(campaign)
    assert len(rows) == 2
    assert rows[1]["data"]["mode"] == "repeated"
    assert rows[1]["sequence"] == 2


def test_reframe_effect_emits_belief_reframed_per_target(tmp_path):
    campaign = _belief_campaign(tmp_path)
    coc_belief_state.apply_belief_turn(
        campaign,
        _belief_plan(hypothesis="教堂地下有密道"),
        [],
        "thomas-hayes",
        "2026-01-01T00:00:00Z",
    )

    coc_belief_state.apply_belief_turn(
        campaign,
        _belief_plan(
            contract_effects=[
                {
                    "effect_id": "effect-reframe-1",
                    "mode": "REFRAME",
                    "deliver_clue_ids": ["clue-diary-page-13"],
                    "belief_refs": ["hyp-000001"],
                }
            ],
            decision_id="turn-decision-reframe",
        ),
        ["clue-diary-page-13"],
        "thomas-hayes",
        "2026-01-02T00:00:00Z",
    )
    rows = [
        row for row in read_stream(campaign)
        if row["type"] == "belief-reframed"
    ]
    assert len(rows) == 1
    row = rows[0]
    cem.validate_event(row)
    assert row["decision_id"] == "turn-decision-reframe:belief-reframe:hyp-000001"
    assert row["data"]["hypothesis_id"] == "hyp-000001"
    assert row["data"]["change"]
    assert row["data"]["evidence_refs"] == ["clue-diary-page-13"]
    assert row["privacy"] == "public"


def test_failed_belief_candidate_writes_leave_no_canonical_event(tmp_path):
    campaign = _belief_campaign(tmp_path)
    empty_plan = _belief_plan(decision_id="no-candidate-decision")
    assert coc_belief_state.apply_belief_turn(
        campaign, empty_plan, [], "thomas-hayes", "ts"
    ) == []
    assert read_stream(campaign) == []


# ---------------------------------------------------------------------------
# Temporal-memory wiring (record_assertion / record_episode)
# ---------------------------------------------------------------------------


def _assertion_payload(**overrides) -> dict:
    base = {
        "assertion_id": "mem-memory-wiring-camp-cellar-knock",
        "kind": "knowledge",
        "scope": "campaign",
        "campaign_id": "memory-wiring-camp",
        "timeline_id": "tl-main",
        "subject_id": contract.subject_id_for("party", "memory-wiring-camp", ""),
        "knowers": [contract.subject_id_for("party", "memory-wiring-camp", "")],
        "privacy": "player_safe",
        "state": "accurate",
        "statement": "地窖里有敲击声。",
        "occurred_turn": 3,
        "valid_from_turn": 3,
        "source_commit": COMMIT_A,
        "source_turn": 3,
        "source_receipts": ["receipt-turn-3"],
    }
    base.update(overrides)
    return base


def test_record_assertion_emits_memory_written_with_subject_refs(tmp_path):
    camp = tmp_path / "campaigns" / "memory-wiring-camp"
    camp.mkdir(parents=True)
    written = tm.record_assertion(_assertion_payload(), campaign_dir=camp)

    rows = read_stream(camp)
    assert stream_types(rows) == ["memory-written"]
    row = rows[0]
    cem.validate_event(row)
    assert row["source"] == "coc_temporal_memory.record_assertion"
    assert row["campaign"] == "memory-wiring-camp"
    assert row["timeline"] == "tl-main"
    assert row["turn"] == 3
    assert row["privacy"] == "public"  # player_safe mirrors to public
    assert row["decision_id"] == (
        "memwrite-memory-wiring-camp-tl-main-mem-memory-wiring-camp-cellar-knock"
    )
    assert row["data"]["memory_id"] == written["assertion_id"]
    assert row["data"]["memory_kind"] == "assertion"
    assert row["data"]["subject_refs"] == [written["subject_id"]]
    assert "statement" not in row["data"]  # refs, never a duplicate payload

    # byte-equal replay returns prior early and appends nothing new
    tm.record_assertion(_assertion_payload(), campaign_dir=camp)
    assert len(read_stream(camp)) == 1


def test_keeper_only_assertion_mirrors_secret_privacy(tmp_path):
    camp = tmp_path / "campaigns" / "memory-wiring-camp"
    camp.mkdir(parents=True)
    tm.record_assertion(
        _assertion_payload(privacy="keeper_only"), campaign_dir=camp
    )
    rows = read_stream(camp)
    assert len(rows) == 1
    assert rows[0]["privacy"] == "secret"
    # Secret rows stay Keeper-side: player projection drops them entirely.
    assert cem.project_player_view([rows[0]]) == []


def test_supersession_close_row_appends_but_does_not_duplicate_event(tmp_path):
    camp = tmp_path / "campaigns" / "memory-wiring-camp"
    camp.mkdir(parents=True)
    first = tm.record_assertion(_assertion_payload(), campaign_dir=camp)

    successor_payload = dict(
        first,
        valid_until_turn=5,
        superseded_by=["mem-memory-wiring-camp-cellar-knock-successor"],
    )
    assert contract.is_sanctioned_supersession(first, successor_payload)
    tm.record_assertion(successor_payload, campaign_dir=camp)

    # The close row landed in the store, but produced no second event.
    assert len(tm.load_assertions(camp)) >= 1
    rows = read_stream(camp)
    assert stream_types(rows) == ["memory-written"]
    assert len(rows) == 1


def test_record_episode_emits_one_memory_written_despite_multiple_appends(tmp_path):
    camp = tmp_path / "campaigns" / "episode-wiring-camp"
    camp.mkdir(parents=True)
    episode = tm.record_episode(
        COMMIT_A,
        "tl-main",
        2,
        ["receipt-final-turn-2"],
        "我检查地窖门。",
        "门闩上有新的划痕。",
        campaign_dir=camp,
        subjects_present=["subject-party-episode-wiring-camp"],
    )
    rows = read_stream(camp)
    # episodes + episode-evidence + backlog all appended; exactly one event.
    assert stream_types(rows) == ["memory-written"]
    row = rows[0]
    cem.validate_event(row)
    assert row["source"] == "coc_temporal_memory.record_episode"
    assert row["campaign"] == "episode-wiring-camp"
    assert row["turn"] == 2
    assert row["privacy"] == "public"
    expected_decision = (
        "memwrite-episode-wiring-camp-tl-main-"
        "episode-episode-wiring-camp-tl-main-turn-2"
    )
    assert row["decision_id"] == expected_decision
    assert row["data"]["memory_id"] == episode["episode_id"]
    assert row["data"]["memory_kind"] == "episode"
    assert row["data"]["subject_refs"] == ["subject-party-episode-wiring-camp"]

    # Episode replay is immutable and stays a single canonical event.
    tm.record_episode(
        COMMIT_A,
        "tl-main",
        2,
        ["receipt-final-turn-2"],
        "我检查地窖门。",
        "门闩上有新的划痕。",
        campaign_dir=camp,
        subjects_present=["subject-party-episode-wiring-camp"],
    )
    assert len(read_stream(camp)) == 1


def test_invalid_assertion_write_leaves_no_canonical_event(tmp_path):
    camp = tmp_path / "campaigns" / "rejected-camp"
    camp.mkdir(parents=True)
    bad = _assertion_payload(statement="x" * 3000)  # exceeds MAX_STATEMENT_CHARS
    with pytest.raises(contract.TemporalMemoryContractError):
        tm.record_assertion(bad, campaign_dir=camp)
    assert read_stream(camp) == []
    assert not (camp / "memory" / "temporal" / "assertions.jsonl").exists()


# ---------------------------------------------------------------------------
# NPC wiring (npc.reaction / state.npc_update through the toolbox)
# ---------------------------------------------------------------------------


def _canonical_rows(ws: dict, type_filter: str | None = None) -> list[dict]:
    rows = read_stream(ws["campaign_dir"])
    if type_filter is None:
        return rows
    return [row for row in rows if row["type"] == type_filter]


from toolbox_test_support import _first_npc_id, _run, campaign_ws  # noqa: E402,F401


def test_npc_reaction_first_contact_emits_public_relationship_changed(campaign_ws):
    ws = campaign_ws
    npc_id = _first_npc_id(ws["campaign_dir"])
    reaction = _run(ws, "npc.reaction", {
        "npc_id": npc_id,
        "npc_display_name": "测试联系人",
        "investigator": ws["investigator_id"],
        "context": {
            "player_conduct": "调查员清楚说明来意并尊重对方的工作边界",
            "scene_constraints": "当前场景的职责与安全边界仍然有效",
            "authored_or_relationship_boundary": "初次见面不会改写 NPC 的身份、立场或权限",
            "semantic_reason": "外表与信用只影响对方起初的接纳方式",
        },
        "seed": 7,
        "decision_id": "wiring-first-reaction",
    })
    assert reaction["ok"] is True, reaction
    tier = reaction["data"]["reaction_tier"]

    rows = _canonical_rows(ws, "npc-relationship-changed")
    assert len(rows) == 1
    row = rows[0]
    cem.validate_event(row)
    assert row["privacy"] == "public"
    assert row["source"] == "coc_operation_npc_world.npc_reaction"
    assert row["campaign"] == ws["campaign_id"]
    assert row["decision_id"] == "wiring-first-reaction:npc-first-impression"
    assert row["id"].startswith("npc-relationship-changed-")
    assert row["data"]["channel"] == "first-impression"
    assert row["data"]["after"] == tier
    assert "before" not in row["data"]
    assert row["data"]["reason"] == "外表与信用只影响对方起初的接纳方式"
    assert row["data"]["source_roll_id"] == reaction["data"]["roll_id"]

    # Frozen-pair replay rerolls are refused before any write: no new event.
    frozen = _run(ws, "npc.reaction", {
        "npc_id": npc_id,
        "investigator": ws["investigator_id"],
        "seed": 11,
        "decision_id": "wiring-first-reaction-reroll",
    })
    assert frozen["ok"] is True, frozen
    assert len(_canonical_rows(ws, "npc-relationship-changed")) == 1


def test_state_npc_update_trust_delta_emits_before_after_event(campaign_ws):
    ws = campaign_ws
    npc_id = _first_npc_id(ws["campaign_dir"])
    made = _run(ws, "state.npc_update", {
        "npc_id": npc_id,
        "investigator": ws["investigator_id"],
        "trust_delta": 2,
        "fear_delta": -1,
        "decision_id": "wiring-npc-update-1",
    })
    assert made["ok"] is True, made
    after_trust = int(made["data"]["psych"]["trust"])

    rows = _canonical_rows(ws, "npc-relationship-changed")
    assert [row["data"]["channel"] for row in rows] == ["trust", "fear"]
    trust_row = rows[0]
    cem.validate_event(trust_row)
    assert trust_row["source"] == "coc_operation_npc_world.state_npc_update"
    assert trust_row["decision_id"] == "wiring-npc-update-1:npc-trust"
    assert trust_row["data"]["npc"]
    assert trust_row["data"]["investigator"] == ws["investigator_id"]
    assert trust_row["data"]["before"] == max(-5, min(5, after_trust - 2))
    assert trust_row["data"]["after"] == after_trust
    fear_row = rows[1]
    assert fear_row["data"]["after"] == int(made["data"]["psych"]["fear"])
    assert fear_row["decision_id"] == "wiring-npc-update-1:npc-fear"

    # duplicate decision replays collapse: the ledger returns the prior
    # result before any state write, so no new canonical events appear.
    dup = _run(ws, "state.npc_update", {
        "npc_id": npc_id,
        "investigator": ws["investigator_id"],
        "trust_delta": 2,
        "fear_delta": -1,
        "decision_id": "wiring-npc-update-1",
    })
    assert dup["ok"] is True
    assert len(_canonical_rows(ws, "npc-relationship-changed")) == 2


def test_state_npc_update_pair_scope_and_atomic_failure_emit_rules(campaign_ws):
    ws = campaign_ws
    npc_id = _first_npc_id(ws["campaign_dir"])

    # No investigator scope: relationship movement cannot be attributed to a
    # pair, so nothing is emitted even though the psych write succeeded.
    scoped_off = _run(ws, "state.npc_update", {
        "npc_id": npc_id,
        "trust_delta": 1,
        "decision_id": "wiring-npc-update-unscoped",
    })
    assert scoped_off["ok"] is True, scoped_off
    assert _canonical_rows(ws, "npc-relationship-changed") == []

    # Rejected update fails atomically and leaves no canonical event behind.
    rejected = _run(ws, "state.npc_update", {
        "npc_id": npc_id,
        "investigator": ws["investigator_id"],
        "trust_delta": 1,
        "availability": "permission_required",
        "decision_id": "wiring-npc-update-rejected",
    })
    assert rejected["ok"] is False
    assert _canonical_rows(ws, "npc-relationship-changed") == []

    # Record-only updates move no relationship value and emit nothing.
    facts_only = _run(ws, "state.npc_update", {
        "npc_id": npc_id,
        "investigator": ws["investigator_id"],
        "record_fact": "fact-sealed-letter",
        "decision_id": "wiring-npc-update-facts",
    })
    assert facts_only["ok"] is True, facts_only
    assert _canonical_rows(ws, "npc-relationship-changed") == []
