"""Tests for persistent player belief state."""
import importlib.util
import json
from pathlib import Path


def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, rel)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_belief_state = _load(
    "coc_belief_state",
    "plugins/coc-keeper/scripts/coc_belief_state.py",
)


def _campaign(tmp_path: Path) -> Path:
    campaign = tmp_path / "campaign"
    (campaign / "save").mkdir(parents=True)
    (campaign / "logs").mkdir(parents=True)
    return campaign


def _plan(*, hypothesis=None, contract=None, decision_id="turn-1", turn_number=1):
    rich = {"primary_intent": "investigate"}
    if hypothesis is not None:
        rich["player_hypothesis"] = hypothesis
    return {
        "decision_id": decision_id,
        "turn_input": {
            "turn_number": turn_number,
            "player_intent_rich": rich,
        },
        "epistemic_contract": contract or {"schema_version": 1, "mode": "NONE"},
    }


def _events(campaign: Path):
    path = campaign / "logs" / "belief-events.jsonl"
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def test_structured_hypothesis_is_asserted(tmp_path):
    campaign = _campaign(tmp_path)
    hypothesis = {
        "claim": "The archivist belongs to the cult.",
        "question_id": "q-motive",
        "hypothesis_kind": "archivist-is-cultist",
        "confidence": 0.78,
    }

    events = coc_belief_state.apply_belief_turn(
        campaign,
        _plan(hypothesis=hypothesis),
        [],
        "inv1",
        "2026-07-11T00:00:00Z",
    )

    state = coc_belief_state.read_belief_state(campaign)
    assert len(state["hypotheses"]) == 1
    record = state["hypotheses"][0]
    assert record["hypothesis_id"] == "hyp-000001"
    assert record["question_id"] == "q-motive"
    assert record["hypothesis_kind"] == "archivist-is-cultist"
    assert record["confidence"] == 0.78
    assert events[0]["event_type"] == "hypothesis_asserted"


def test_legacy_hypothesis_is_persisted_unbound(tmp_path):
    campaign = _campaign(tmp_path)

    coc_belief_state.apply_belief_turn(
        campaign,
        _plan(hypothesis="The archivist is hiding something."),
        [],
        "inv1",
        "2026-07-11T00:00:00Z",
    )

    record = coc_belief_state.read_belief_state(campaign)["hypotheses"][0]
    assert record["claim"] == "The archivist is hiding something."
    assert record["question_id"] is None
    assert record["hypothesis_kind"] is None
    assert record["confidence"] == 0.5


def test_repeated_hypothesis_updates_existing_record(tmp_path):
    campaign = _campaign(tmp_path)
    hypothesis = {
        "claim": "The archivist belongs to the cult.",
        "question_id": "q-motive",
        "hypothesis_kind": "archivist-is-cultist",
        "confidence": 0.6,
    }
    coc_belief_state.apply_belief_turn(
        campaign,
        _plan(hypothesis=hypothesis, decision_id="turn-1", turn_number=1),
        [],
        "inv1",
        "2026-07-11T00:00:00Z",
    )
    hypothesis["confidence"] = 0.82
    events = coc_belief_state.apply_belief_turn(
        campaign,
        _plan(hypothesis=hypothesis, decision_id="turn-2", turn_number=2),
        [],
        "inv1",
        "2026-07-11T00:01:00Z",
    )

    state = coc_belief_state.read_belief_state(campaign)
    assert len(state["hypotheses"]) == 1
    assert state["hypotheses"][0]["confidence"] == 0.82
    assert state["hypotheses"][0]["updated_turn"] == 2
    assert any(event["event_type"] == "hypothesis_repeated" for event in events)


def test_committed_confirm_updates_support_and_treatment(tmp_path):
    campaign = _campaign(tmp_path)
    hypothesis = {
        "claim": "The archivist altered the records.",
        "question_id": "q-fact",
        "hypothesis_kind": "records-altered",
        "confidence": 0.7,
    }
    coc_belief_state.apply_belief_turn(
        campaign,
        _plan(hypothesis=hypothesis, decision_id="turn-1", turn_number=1),
        [],
        "inv1",
        "2026-07-11T00:00:00Z",
    )
    contract = {
        "schema_version": 1,
        "mode": "CONFIRM",
        "target_question_id": "q-fact",
        "belief_refs": ["hyp-000001"],
        "deliver_clue_ids": ["clue-ledger"],
        "open_question_ids": ["q-motive"],
    }

    events = coc_belief_state.apply_belief_turn(
        campaign,
        _plan(contract=contract, decision_id="turn-2", turn_number=2),
        ["clue-ledger"],
        "inv1",
        "2026-07-11T00:01:00Z",
    )

    record = coc_belief_state.read_belief_state(campaign)["hypotheses"][0]
    assert record["supporting_clue_ids"] == ["clue-ledger"]
    assert record["recent_treatments"] == ["confirm"]
    assert record["status"] == "confirmed"
    assert "q-motive" in coc_belief_state.read_belief_state(campaign)["active_question_ids"]
    assert any(event["event_type"] == "belief_confirmed" for event in events)


def test_uncommitted_epistemic_clue_does_not_update_treatment(tmp_path):
    campaign = _campaign(tmp_path)
    hypothesis = {
        "claim": "The archivist altered the records.",
        "question_id": "q-fact",
        "hypothesis_kind": "records-altered",
        "confidence": 0.7,
    }
    coc_belief_state.apply_belief_turn(
        campaign,
        _plan(hypothesis=hypothesis),
        [],
        "inv1",
        "2026-07-11T00:00:00Z",
    )
    contract = {
        "schema_version": 1,
        "mode": "CONFIRM",
        "target_question_id": "q-fact",
        "belief_refs": ["hyp-000001"],
        "deliver_clue_ids": ["clue-ledger"],
    }

    events = coc_belief_state.apply_belief_turn(
        campaign,
        _plan(contract=contract, decision_id="turn-2", turn_number=2),
        [],
        "inv1",
        "2026-07-11T00:01:00Z",
    )

    record = coc_belief_state.read_belief_state(campaign)["hypotheses"][0]
    assert record["supporting_clue_ids"] == []
    assert record["recent_treatments"] == []
    assert not any(event["event_type"].startswith("belief_") for event in events)


def test_reframe_updates_status_and_opens_question(tmp_path):
    campaign = _campaign(tmp_path)
    hypothesis = {
        "claim": "The archivist belongs to the cult.",
        "question_id": "q-motive",
        "hypothesis_kind": "archivist-is-cultist",
        "confidence": 0.8,
    }
    coc_belief_state.apply_belief_turn(
        campaign,
        _plan(hypothesis=hypothesis),
        [],
        "inv1",
        "2026-07-11T00:00:00Z",
    )
    contract = {
        "schema_version": 1,
        "mode": "REFRAME",
        "target_question_id": "q-motive",
        "belief_refs": ["hyp-000001"],
        "deliver_clue_ids": ["clue-survivor"],
        "open_question_ids": ["q-structure"],
        "preserve_fact_refs": ["truth-archivist-lied"],
        "revise_hypothesis_refs": ["hyp-000001"],
    }

    events = coc_belief_state.apply_belief_turn(
        campaign,
        _plan(contract=contract, decision_id="turn-2", turn_number=2),
        ["clue-survivor"],
        "inv1",
        "2026-07-11T00:01:00Z",
    )

    state = coc_belief_state.read_belief_state(campaign)
    record = state["hypotheses"][0]
    assert record["status"] == "reframed"
    assert record["challenging_clue_ids"] == ["clue-survivor"]
    assert record["recent_treatments"] == ["reframe"]
    assert state["active_question_ids"] == ["q-structure"]
    assert any(event["event_type"] == "belief_reframed" for event in events)
    assert [event["event_type"] for event in _events(campaign)].count("belief_reframed") == 1
