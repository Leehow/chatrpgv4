"""End-to-end structural coverage for the completed epistemic blueprint.

Fixtures contain invented IDs and summaries only.  The tests deliberately cross
module boundaries: source evidence -> semantic artifact -> policy/resolve ->
belief state -> cognitive storylet -> narrator projection -> metrics.
"""
from __future__ import annotations

import copy
import json
import sys
from pathlib import Path


SCRIPTS = Path("plugins/coc-keeper/scripts").resolve()
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import coc_belief_state
import coc_epistemic_compile
import coc_epistemic_metrics
import coc_epistemic_policy
import coc_epistemic_resolve
import coc_pdf_source


FIXTURES = Path("tests/fixtures/epistemic")


def _fixture(name: str) -> dict:
    return json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))


def _write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _campaign(tmp_path: Path, fixture: dict) -> Path:
    campaign = tmp_path / "campaign"
    (campaign / "save").mkdir(parents=True)
    (campaign / "logs").mkdir(parents=True)
    _write_json(campaign / "save" / "belief-state.json", fixture["initial_belief_state"])
    return campaign


def _context(fixture: dict, campaign: Path, discovered: list[str]) -> dict:
    return {
        "epistemic_graph": fixture["epistemic_graph"],
        "reveal_contracts": fixture.get("reveal_contracts", {"contracts": []}),
        "compile_confidence": fixture.get("compile_confidence", {"nodes": []}),
        "belief_state": coc_belief_state.read_belief_state(campaign),
        "world_state": {"discovered_clue_ids": list(discovered)},
    }


def _run_committed_turn(
    fixture: dict,
    campaign: Path,
    discovered: list[str],
    clue_id: str,
    turn_number: int,
):
    planned = coc_epistemic_policy.plan_epistemic_contract(
        _context(fixture, campaign, discovered),
        {"reveal": [clue_id]},
        "REVEAL",
    )
    resolved = coc_epistemic_resolve.resolve_epistemic_contract(planned, [clue_id])
    plan = {
        "decision_id": f"turn-{turn_number}",
        "turn_input": {"turn_number": turn_number, "player_intent_rich": {}},
        "epistemic_contract": resolved,
    }
    events = coc_belief_state.apply_belief_turn(
        campaign,
        plan,
        [clue_id],
        "inv-e2e",
        f"2026-07-11T00:{turn_number:02d}:00Z",
    )
    if clue_id not in discovered:
        discovered.append(clue_id)
    return planned, resolved, events


def test_branching_fixture_builds_confirm_then_complicate_then_reframe(tmp_path: Path):
    fixture = _fixture("branching-investigation")
    campaign = _campaign(tmp_path, fixture)
    discovered: list[str] = []
    modes: list[str] = []
    event_types: list[str] = []

    for turn_number, turn in enumerate(fixture["turns"], start=1):
        _planned, resolved, events = _run_committed_turn(
            fixture, campaign, discovered, turn["clue_id"], turn_number
        )
        modes.append(resolved["mode"])
        event_types.extend(event["event_type"] for event in events)

    assert modes == ["CONFIRM", "COMPLICATE", "REFRAME"]
    assert "belief_confirmed" in event_types
    assert "belief_complicated" in event_types
    assert "belief_reframed" in event_types

    state = coc_belief_state.read_belief_state(campaign)
    by_id = {record["hypothesis_id"]: record for record in state["hypotheses"]}
    assert by_id["hyp-fact"]["status"] == "confirmed"
    assert by_id["hyp-motive"]["status"] == "reframed"
    assert by_id["hyp-motive"]["challenging_clue_ids"] == [
        "clue-motive",
        "clue-reframe",
    ]
    assert "q-structure" in state["active_question_ids"]


def test_large_chapter_fixture_resolves_printed_to_pdf_page_and_gates_confidence(
    tmp_path: Path,
):
    fixture = _fixture("large-chapter-page-offset")
    bundle = fixture["source_bundle"]

    locator = coc_pdf_source.resolve_locator(
        fixture["source_ref"], bundle["page_map"]
    )
    assert locator == fixture["expected_locator"]

    accepted = coc_pdf_source.critical_source_allowed(
        [fixture["source_ref"]],
        bundle["parse_manifest"],
        bundle["evidence_segments"],
        page_map=bundle["page_map"],
    )
    rejected = coc_pdf_source.critical_source_allowed(
        [fixture["low_confidence_source_ref"]],
        bundle["parse_manifest"],
        bundle["evidence_segments"],
        page_map=bundle["page_map"],
    )
    assert accepted["allowed"] is True
    assert accepted["confidence"] == 0.91
    assert rejected["allowed"] is False
    assert {finding["code"] for finding in rejected["findings"]} >= {
        "source_needs_review",
        "low_source_confidence",
    }

    scenario_dir = tmp_path / "scenario"
    scenario_dir.mkdir()
    for filename, payload in fixture["scenario_files"].items():
        _write_json(scenario_dir / filename, payload)

    request = coc_epistemic_compile.build_compile_request(
        scenario_dir, source_bundle=bundle
    )
    serialized = json.dumps(request, ensure_ascii=False)
    assert "LOCAL ONLY EVIDENCE PROSE" not in serialized
    assert request["source_evidence"]["page_map"]["sources"][0]["pages"]

    result = copy.deepcopy(fixture["compile_result"])
    result["evaluation_provenance"]["request_sha256"] = (
        coc_epistemic_compile.request_sha256(request)
    )
    assert coc_epistemic_compile.validate_compile_result(request, result) == []
    installed = coc_epistemic_compile.install_compile_result(
        scenario_dir, request, result
    )
    assert installed["installed"] is True
    assert (scenario_dir / "epistemic-graph.json").exists()
    assert (scenario_dir / "compile-confidence.json").exists()


def test_multi_faction_fixture_updates_only_targeted_hypothesis(tmp_path: Path):
    fixture = _fixture("multi-faction")
    campaign = _campaign(tmp_path, fixture)
    _planned, resolved, events = _run_committed_turn(
        fixture, campaign, [], "clue-faction-a", 1
    )

    assert resolved["mode"] == "CONFIRM"
    state = coc_belief_state.read_belief_state(campaign)
    by_id = {record["hypothesis_id"]: record for record in state["hypotheses"]}
    assert by_id["hyp-faction-a"]["supporting_clue_ids"] == ["clue-faction-a"]
    assert by_id["hyp-faction-a"]["status"] == "confirmed"
    assert by_id["hyp-faction-b"]["supporting_clue_ids"] == []
    assert by_id["hyp-faction-b"]["status"] == "active"
    belief_event = next(event for event in events if event["event_type"] == "belief_confirmed")
    assert belief_event["belief_refs"] == ["hyp-faction-a"]


def test_failed_obscured_clue_produces_hold_and_no_belief_gain(tmp_path: Path):
    fixture = _fixture("branching-investigation")
    campaign = _campaign(tmp_path, fixture)
    before = coc_belief_state.read_belief_state(campaign)

    planned = coc_epistemic_policy.plan_epistemic_contract(
        _context(fixture, campaign, []),
        {"reveal": ["clue-fact"]},
        "REVEAL",
    )
    resolved = coc_epistemic_resolve.resolve_epistemic_contract(planned, [])
    events = coc_belief_state.apply_belief_turn(
        campaign,
        {
            "decision_id": "failed-turn",
            "turn_input": {"turn_number": 1, "player_intent_rich": {}},
            "epistemic_contract": resolved,
        },
        [],
        "inv-e2e",
        "2026-07-11T00:01:00Z",
    )

    assert resolved["mode"] == "HOLD"
    assert resolved["hold_reason"] == "supporting_clue_not_committed"
    assert events == []
    assert coc_belief_state.read_belief_state(campaign) == before
    metrics = coc_epistemic_metrics.compute_epistemic_metrics(events, before)
    assert metrics["belief_gain"]["count"] == 0

