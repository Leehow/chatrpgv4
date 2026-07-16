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
coc_epistemic_metrics = _load(
    "coc_epistemic_metrics_belief_state_tests",
    "plugins/coc-keeper/scripts/coc_epistemic_metrics.py",
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


def _install_conclusion_graph(campaign: Path, *, minimum_routes=2):
    (campaign / "scenario").mkdir(parents=True, exist_ok=True)
    (campaign / "scenario" / "clue-graph.json").write_text(json.dumps({
        "conclusions": [{
            "conclusion_id": "house-pattern",
            "minimum_routes": minimum_routes,
            "origin": "source",
            "description": "keeper-only prose must never drive projection",
            "clues": [
                {"clue_id": "clue-newspaper", "origin": "source"},
                {"clue_id": "clue-neighbor", "origin": "source"},
            ],
        }],
    }))
    (campaign / "save" / "world-state.json").write_text(json.dumps({
        "discovered_clue_ids": [],
    }))


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


def test_structured_conclusion_clue_projects_real_style_belief_and_curiosity(tmp_path):
    campaign = _campaign(tmp_path)
    _install_conclusion_graph(campaign, minimum_routes=2)

    events = coc_belief_state.apply_belief_turn(
        campaign,
        _plan(decision_id="turn-newspaper", turn_number=3),
        ["clue-newspaper"],
        "inv1",
        "2026-07-14T00:03:00Z",
    )

    expanded = next(event for event in events if event["event_type"] == "belief_expanded")
    assert expanded["clue_ids"] == ["clue-newspaper"]
    assert expanded["question_id"].startswith("conclusion-ref:")
    assert "house-pattern" not in expanded["question_id"]
    assert expanded["conclusion_id"] == "house-pattern"
    assert expanded["minimum_routes"] == 2
    assert expanded["projection_source"] == "clue_graph_conclusion_link"
    assert expanded["source_origin"] == "source"
    assert expanded["conclusion_origin"] == "source"
    assert "description" not in expanded
    assert any(event["event_type"] == "question_opened" for event in events)

    state = coc_belief_state.read_belief_state(campaign)
    metrics = coc_epistemic_metrics.compute_epistemic_metrics(events, state)
    assert metrics["belief_gain"]["count"] == 1
    assert metrics["belief_gain"]["by_mode"]["expand"] == 1
    assert metrics["curiosity_load"] == {
        "active_count": 1,
        "active_question_ids": [expanded["question_id"]],
        "state": "workable",
    }


def test_the_haunting_globe_clue_projects_from_canonical_conclusion(tmp_path):
    campaign = _campaign(tmp_path)
    (campaign / "scenario").mkdir(parents=True, exist_ok=True)
    canonical = Path(
        "plugins/coc-keeper/references/starter-scenarios/the-haunting/clue-graph.json"
    )
    (campaign / "scenario" / "clue-graph.json").write_text(
        canonical.read_text(encoding="utf-8"), encoding="utf-8"
    )
    (campaign / "save" / "world-state.json").write_text(json.dumps({
        "discovered_clue_ids": [],
    }))

    events = coc_belief_state.apply_belief_turn(
        campaign, _plan(decision_id="turn-globe", turn_number=5),
        ["clue-globe-unpublished-story"],
        "thomas-hayes", "2026-07-14T13:16:32Z",
    )

    expanded = next(event for event in events if event["event_type"] == "belief_expanded")
    assert expanded["question_id"].startswith("conclusion-ref:")
    assert "house-haunted-by-corbitt" not in expanded["question_id"]
    assert expanded["conclusion_id"] == "house-haunted-by-corbitt"
    assert expanded["minimum_routes"] == 3
    assert any(
        event["event_type"] == "question_opened"
        and event["question_id"] == expanded["question_id"]
        for event in events
    )
    assert not [event for event in events if event["event_type"] == "question_answered"]


def test_structured_conclusion_projection_closes_only_at_minimum_routes(tmp_path):
    campaign = _campaign(tmp_path)
    _install_conclusion_graph(campaign, minimum_routes=2)
    coc_belief_state.apply_belief_turn(
        campaign, _plan(decision_id="turn-1", turn_number=1),
        ["clue-newspaper"], "inv1", "2026-07-14T00:01:00Z",
    )
    (campaign / "save" / "world-state.json").write_text(json.dumps({
        "discovered_clue_ids": ["clue-newspaper"],
    }))

    events = coc_belief_state.apply_belief_turn(
        campaign, _plan(decision_id="turn-2", turn_number=2),
        ["clue-neighbor"], "inv1", "2026-07-14T00:02:00Z",
    )

    assert any(event["event_type"] == "belief_expanded" for event in events)
    assert any(event["event_type"] == "question_answered" for event in events)
    state = coc_belief_state.read_belief_state(campaign)
    assert state["active_question_ids"] == []
    assert len(state["answered_question_ids"]) == 1
    assert state["answered_question_ids"][0].startswith("conclusion-ref:")


def test_unrelated_clue_without_structured_conclusion_link_stays_zero(tmp_path):
    campaign = _campaign(tmp_path)
    _install_conclusion_graph(campaign)

    events = coc_belief_state.apply_belief_turn(
        campaign, _plan(decision_id="turn-unrelated", turn_number=4),
        ["clue-unrelated"], "inv1", "2026-07-14T00:04:00Z",
    )

    assert not [event for event in events if event["event_type"].startswith("belief_")]
    metrics = coc_epistemic_metrics.compute_epistemic_metrics(
        events, coc_belief_state.read_belief_state(campaign)
    )
    assert metrics["belief_gain"]["count"] == 0
    assert metrics["curiosity_load"]["state"] == "empty"


def test_explicit_epistemic_link_takes_precedence_over_conclusion_projection(tmp_path):
    campaign = _campaign(tmp_path)
    _install_conclusion_graph(campaign)
    (campaign / "scenario" / "epistemic-graph.json").write_text(json.dumps({
        "questions": [{"question_id": "q-authored"}],
        "evidence_links": [{
            "clue_id": "clue-newspaper",
            "question_id": "q-authored",
            "effect": "confirm",
        }],
    }))

    events = coc_belief_state.apply_belief_turn(
        campaign, _plan(decision_id="turn-explicit", turn_number=5),
        ["clue-newspaper"], "inv1", "2026-07-14T00:05:00Z",
    )

    assert not [event for event in events if event["event_type"] == "belief_expanded"]
    assert not [event for event in events if event["event_type"] == "question_opened"]


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
