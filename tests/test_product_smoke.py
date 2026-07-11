"""Replayable whole-product verification journey.

This is deterministic NON-GAMEPLAY verification evidence.  It deliberately
does not claim to be a live player/Keeper battle report.
"""
from __future__ import annotations

import copy
import importlib.util
import json
import random
import sys
from pathlib import Path


REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "plugins" / "coc-keeper" / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import coc_belief_state
import coc_epistemic_compile
import coc_epistemic_metrics
import coc_epistemic_policy
import coc_epistemic_resolve
import coc_live_turn_runner
import coc_narration_contract
import coc_pdf_source
import coc_playtest_evidence
import coc_playtest_report
import coc_scene_graph
import coc_starter
import coc_state
import coc_storylets


FIXTURE = REPO / "tests" / "fixtures" / "epistemic" / "branching-investigation.json"
SOURCE_FIXTURE = REPO / "tests" / "fixtures" / "epistemic" / "large-chapter-page-offset.json"


def _write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _character() -> dict:
    return {
        "schema_version": 1, "id": "inv-smoke", "name": "Smoke Investigator",
        "occupation": "Journalist", "era": "ww1",
        "characteristics": {"STR": 60, "CON": 60, "SIZ": 60, "DEX": 70,
                            "APP": 50, "INT": 70, "POW": 60, "EDU": 70, "LUCK": 60},
        "derived": {"HP": 12, "MP": 12, "SAN": 60, "MOV": 8},
        "skills": {"Spot Hidden": 60, "Library Use": 60, "Persuade": 50},
        "backstory": {},
    }


def _load_session_module():
    path = REPO / "runtime" / "engine" / "session.py"
    spec = importlib.util.spec_from_file_location("product_smoke_runtime_session", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _load_debug_adapter():
    path = REPO / "runtime" / "adapters" / "debug" / "adapter.py"
    spec = importlib.util.spec_from_file_location("product_smoke_debug_adapter", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_replayable_product_journey_includes_epistemic_blueprint(tmp_path: Path):
    """One artifact crosses starter, live rules, persistence, cognition and report."""
    run_dir = tmp_path / "run"
    workspace = run_dir / "sandbox"
    coc_root = workspace / ".coc"
    campaign_id = "product-smoke"
    _write_json(coc_root / "runtime.json", {"schema_version": 2,
        "planner": {"kind": "deterministic"}, "rules": {"kind": "deterministic"},
        "narrator": {"kind": "template"}, "player": {"kind": "human"}})
    coc_state.create_campaign(coc_root, campaign_id, "Product Smoke", era="ww1")
    character_path = coc_state.create_investigator(coc_root, "inv-smoke", _character())
    scenario_dir = coc_starter.install_starter(coc_root, campaign_id, "the-white-war")
    starter_story = json.loads((scenario_dir / "story-graph.json").read_text(encoding="utf-8"))
    starter_story["scenes"][0]["on_enter"] = {"san_triggers": [{
        "trigger_id": "product-smoke-horror", "source": "structured-horror",
        "san_loss_success": 0, "san_loss_fail_expr": "1", "alone": False}]}
    _write_json(scenario_dir / "story-graph.json", starter_story)
    campaign = coc_root / "campaigns" / campaign_id
    inv_state = campaign / "save" / "investigator-state" / "inv-smoke.json"
    _write_json(inv_state, {"schema_version": 1, "campaign_id": campaign_id,
                           "investigator_id": "inv-smoke", "current_hp": 12,
                           "current_san": 60, "current_mp": 12, "conditions": [],
                           "skill_checks_earned": []})

    # Ordinary investigation and social turns use explicit structured semantic
    # adapter output; no prose keyword matcher participates.
    runtime_session = _load_session_module()
    registry = runtime_session.SessionRegistry()
    runtime_session._REGISTRY = registry
    session_id = runtime_session.create_session(
        workspace, campaign_id=campaign_id, investigator_id="inv-smoke")
    investigation_events = runtime_session.send(session_id, "inspect")
    social_events = runtime_session.send(session_id, "ask")
    assert investigation_events and social_events
    assert runtime_session.get_state(session_id)["campaign_id"] == campaign_id
    subsystem_rows = [json.loads(line) for line in
                      (campaign / "logs" / "subsystem-results.jsonl").read_text(encoding="utf-8").splitlines()
                      if line.strip()]
    assert any(row["result"].get("kind") == "sanity_check" for row in subsystem_rows)

    def send(kind: str, payload: dict, seed: int):
        del seed  # runtime owns production entropy; assertions are state-based.
        return runtime_session.send(
            session_id, "", subsystem_request={"kind": kind, "payload": payload})

    def execute(kind: str, payload: dict, seed: int):
        return coc_live_turn_runner.subsystem_executor.execute_commands(
            campaign, character_path, "inv-smoke",
            [{"command_id": f"{kind}-{seed}", "kind": kind, "phase": "resolve",
              "payload": payload}], rng=random.Random(seed))[0]

    # A failed roll produces a canonical origin, then a typed push offer/cancel.
    origin = execute("skill_check", {"decision_id": "smoke-roll", "roll_id": "smoke-roll-id",
        "skill": "Spot Hidden", "difficulty": "regular",
        "roll_contract": {"push_policy": {"eligible": True,
            "requires_changed_method": True, "keeper_must_foreshadow_failure": True}},
        "resolution_context": {"scene_action": "REVEAL", "clue_policy": {},
            "narrative_directives": {}, "rule_signals": {}}}, 5)
    offered = runtime_session.send(
        session_id, "", subsystem_request={
            "kind": "push_offer", "original_command_id": origin["command_id"],
            "changed_method_evidence": {"changed": True, "source": "player_proposal",
                                        "summary": "use a structured alternate method"},
            "announced_consequence": {"summary": "position worsens",
                                      "effect": {"kind": "fictional_position", "severity": "serious"}}})
    assert offered
    choice = runtime_session.get_state(session_id)["pending_choice"]
    cancelled = runtime_session.send(
        session_id, "", pending_choice_response={
            "choice_id": choice["choice_id"], "responder": "player",
            "revision": choice["revision"], "action": "cancel"})
    assert cancelled
    assert runtime_session.get_state(session_id)["pending_choice"] is None

    combatants = [
        {"actor_id": "inv-smoke", "side": "investigator", "dex": 70,
         "combat_skill": 60, "dodge_skill": 40, "build": 0, "hp_max": 12,
         "hp_current": 12, "con": 60, "weapons": [{"weapon_id": "unarmed"}], "conditions": []},
        {"actor_id": "foe", "side": "npc", "dex": 80, "combat_skill": 40,
         "dodge_skill": 30, "build": 0, "hp_max": 9, "hp_current": 9, "con": 50,
         "weapons": [{"weapon_id": "unarmed"}], "conditions": []},
    ]
    combat = send("combat_start", {"decision_id": "smoke-combat", "combat_id": "smoke-fight",
        "scene_ref": "scene/smoke", "turn_number": 1, "participants": combatants}, 107)
    assert combat
    assert json.loads((campaign / "save" / "combat.json").read_text(encoding="utf-8"))["combat_id"] == "smoke-fight"
    attack_events = send("combat_attack", {"decision_id": "smoke-combat", "revision": 1,
        "actor_id": "foe", "target_actor_id": "inv-smoke", "declared_intent": "structured strike",
        "resolution_hint": "opposed_melee", "weapon_id": "unarmed"}, 1071)
    assert attack_events
    defense = runtime_session.get_state(session_id)["pending_choice"]
    assert defense["kind"] == "combat_defense"
    defended_events = runtime_session.send(session_id, "", pending_choice_response={
        "choice_id": defense["choice_id"], "responder": "player",
        "revision": defense["revision"], "action": "dodge"})
    assert defended_events
    combat_state = json.loads((campaign / "save" / "combat.json").read_text(encoding="utf-8"))
    assert combat_state["revision"] >= 2 and combat_state["pending_attack"] is None
    authoritative_inv = json.loads(inv_state.read_text(encoding="utf-8"))
    chase_people = [
        {"actor_id": "inv-smoke", "side": "quarry", "mov": 8, "dex": 70, "con": 60,
         "hp": authoritative_inv["current_hp"], "fight": 60, "dodge": 40, "build": 0,
         "current_position": 0, "conditions": authoritative_inv["conditions"]},
        {"actor_id": "foe", "side": "pursuer", "mov": 8, "dex": 50, "con": 50,
         "hp": 9, "fight": 40, "dodge": 30, "build": 0, "current_position": 0, "conditions": []},
    ]
    chase = send("chase_start", {"decision_id": "smoke-chase", "chase_id": "smoke-run",
        "participants": chase_people, "locations": [
                {"label": "start", "hazard": None, "barrier": None},
                {"label": "lane", "hazard": None, "barrier": None},
                {"label": "stairs", "hazard": None, "barrier": None},
                {"label": "escape", "hazard": None, "barrier": None}]}, 108)
    assert chase
    chase_revision = json.loads((campaign / "save" / "chase.json").read_text(encoding="utf-8"))["revision"]
    assert send("chase_move", {"decision_id": "smoke-chase", "revision": chase_revision,
        "actor_id": "inv-smoke", "action_id": "move:advance"}, 1081)
    chase_revision = json.loads((campaign / "save" / "chase.json").read_text(encoding="utf-8"))["revision"]
    assert send("chase_move", {"decision_id": "smoke-chase", "revision": chase_revision,
        "actor_id": "foe", "action_id": "move:advance"}, 1082)
    chase_revision = json.loads((campaign / "save" / "chase.json").read_text(encoding="utf-8"))["revision"]
    ended_chase = send("chase_end", {"decision_id": "smoke-chase", "chase_id": "smoke-run",
                                     "revision": chase_revision, "outcome": "escaped"}, 109)
    assert ended_chase
    assert json.loads((campaign / "save" / "chase.json").read_text(encoding="utf-8"))["outcome"] == "escaped"

    # Save/reload campaign state and restore the runtime in a genuinely fresh
    # SessionRegistry, then continue through the canonical session send path.
    coc_state.create_snapshot(coc_root, campaign_id, "mid-journey")
    world_path = campaign / "save" / "world-state.json"
    world = json.loads(world_path.read_text(encoding="utf-8"))
    world["major_decisions"].append("temporary-mutation")
    _write_json(world_path, world)
    coc_state.restore_snapshot(coc_root, campaign_id, "mid-journey")
    registry.snapshot(workspace)
    registry.close(session_id)
    fresh_registry = runtime_session.SessionRegistry()
    assert fresh_registry.restore(workspace) == [session_id]
    runtime_session._REGISTRY = fresh_registry
    continued_events = runtime_session.send(session_id, "continue")
    assert continued_events
    assert fresh_registry.get(session_id)["resolved_config"]["rules"]["kind"] == "deterministic"

    # The merged epistemic blueprint is exercised inside this same run artifact.
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    source_fixture = json.loads(SOURCE_FIXTURE.read_text(encoding="utf-8"))
    source_bundle = source_fixture["source_bundle"]
    locator = coc_pdf_source.resolve_locator(source_fixture["source_ref"], source_bundle["page_map"])
    assert locator == source_fixture["expected_locator"]
    assert coc_pdf_source.critical_source_allowed([source_fixture["source_ref"]],
        source_bundle["parse_manifest"], source_bundle["evidence_segments"],
        page_map=source_bundle["page_map"])["allowed"] is True

    compile_dir = run_dir / "semantic-compile"
    compile_dir.mkdir()
    for name, payload in source_fixture["scenario_files"].items():
        _write_json(compile_dir / name, payload)
    request = coc_epistemic_compile.build_compile_request(compile_dir, source_bundle=source_bundle)
    result = copy.deepcopy(source_fixture["compile_result"])
    result["evaluation_provenance"]["request_sha256"] = coc_epistemic_compile.request_sha256(request)
    assert coc_epistemic_compile.validate_compile_result(request, result) == []
    coc_epistemic_compile.install_compile_result(compile_dir, request, result)
    assert (compile_dir / "compile-confidence.json").exists()

    initial_belief = copy.deepcopy(fixture["initial_belief_state"])
    initial_belief["active_question_ids"] = ["q-motive"]
    _write_json(campaign / "save" / "belief-state.json", initial_belief)
    _write_json(scenario_dir / "epistemic-graph.json", fixture["epistemic_graph"])
    _write_json(scenario_dir / "reveal-contracts.json", fixture["reveal_contracts"])
    _write_json(scenario_dir / "compile-confidence.json", fixture["compile_confidence"])
    world_now = json.loads(world_path.read_text(encoding="utf-8"))
    active_scene_id = world_now["active_scene_id"]
    story = json.loads((scenario_dir / "story-graph.json").read_text(encoding="utf-8"))
    active_scene = next(row for row in story["scenes"] if row["scene_id"] == active_scene_id)
    active_scene["available_clues"] = ["clue-mixed"]
    _write_json(scenario_dir / "story-graph.json", story)
    clue_graph = json.loads((scenario_dir / "clue-graph.json").read_text(encoding="utf-8"))
    clue_graph["conclusions"].append({"conclusion_id": "smoke-epistemic-conclusion",
        "importance": "major", "minimum_routes": 1, "fallback_policy": "RECOVER",
        "clues": [{"clue_id": "clue-mixed", "delivery": "structured smoke evidence",
                   "player_safe_summary": "The record supports two independent questions.",
                   "delivery_kind": "obvious", "visibility": "player-safe"}]})
    _write_json(scenario_dir / "clue-graph.json", clue_graph)
    canonical_debug = _load_debug_adapter()

    class _StructuredSemanticHook:
        @staticmethod
        def debug_send_turn(*args, **kwargs):
            kwargs.update({"intent_class": "investigate", "player_intent_rich": {
                "primary_intent": "investigate", "secondary_intents": [],
                "target_entities": ["clue-mixed"], "risk_posture": "cautious",
                "explicit_roll_request": False, "action_atoms": []}})
            return canonical_debug.debug_send_turn(*args, **kwargs)

    runtime_session._load_debug_adapter = lambda: _StructuredSemanticHook
    live_epistemic_events = runtime_session.send(session_id, "inspect the structured record")
    assert live_epistemic_events
    live_belief = coc_belief_state.read_belief_state(campaign)
    assert any(row.get("supporting_clue_ids") == ["clue-mixed"] or
               "clue-mixed" in row.get("challenging_clue_ids", [])
               for row in live_belief["hypotheses"])
    live_receipts = runtime_session.get_telemetry_receipts(session_id)
    assert live_receipts and live_receipts[-1]["telemetry"]["runner"]["rules"] == "deterministic"

    ctx = {"epistemic_graph": fixture["epistemic_graph"],
           "reveal_contracts": fixture["reveal_contracts"],
           "compile_confidence": fixture["compile_confidence"],
           "belief_state": coc_belief_state.read_belief_state(campaign),
           "world_state": {"discovered_clue_ids": []}}
    planned = coc_epistemic_policy.plan_epistemic_contract(ctx, {"reveal": ["clue-mixed"]}, "REVEAL")
    resolved = coc_epistemic_resolve.resolve_epistemic_contract(planned, ["clue-mixed"])
    assert {effect["mode"] for effect in resolved["resolved_effects"]} == {"CONFIRM", "COMPLICATE"}
    plan = {"decision_id": "smoke-epistemic", "scene_action": "REVEAL",
            "clue_policy": {"reveal": ["clue-mixed"]}, "epistemic_contract": resolved,
            "turn_input": {"turn_number": 9, "player_intent_rich": {}},
            "narrative_directives": {}, "rule_signals": {}}
    events = [json.loads(line) for line in
              (campaign / "logs" / "belief-events.jsonl").read_text(encoding="utf-8").splitlines()
              if line.strip()]
    assert events and "q-motive" in coc_belief_state.read_belief_state(campaign)["active_question_ids"]
    need = coc_storylets.infer_story_need(plan, {"active_scene": {"scene_id": "s", "scene_type": "investigation",
        "available_clues": ["clue-mixed"], "npc_ids": []}, "world_state": {"discovered_clue_ids": []},
        "storylet_policy": {"allow_unanchored_storylets": True}, "structure_type": "branching_investigation",
        "module_meta": {}, "turn_number": 9})
    assert need["need_id"] == "belief_complication"
    envelope = coc_narration_contract.build_narration_envelope(
        plan, clue_graph={"conclusions": []}, epistemic_graph=fixture["epistemic_graph"])
    projection_text = json.dumps(envelope["belief_update"], ensure_ascii=False)
    assert "truth_ref" not in projection_text and "KEEPER" not in projection_text

    metrics = coc_epistemic_metrics.compute_epistemic_metrics(
        events, coc_belief_state.read_belief_state(campaign), fixture["compile_confidence"],
        source_bundle["parse_manifest"])
    assert metrics["belief_gain"]["count"] >= 1

    # Structured terminal evidence must work for a non-last terminal scene.
    graph = {"scenes": [{"scene_id": "ending", "scene_type": "resolution", "edges": []},
                        {"scene_id": "unused", "scene_type": "investigation", "edges": []}]}
    terminal = coc_scene_graph.terminal_evidence(graph, {"active_scene_id": "ending"}, [])
    assert terminal["reached_terminal"] is True and terminal["graph_terminal"] is True

    _write_json(run_dir / "playtest.json", {"run_id": "product-smoke", "campaign_id": campaign_id,
        "play_language": "en-US", "player_profile": "deterministic-fake-adapter",
        "evidence_class": "NON-GAMEPLAY verification evidence"})
    _write_json(campaign / "party.json", {"investigator_ids": ["inv-smoke"]})
    _write_json(campaign / "scenario" / "scenario.json", {"scenario_id": "the-white-war",
        "title": "Product Smoke", "opening_scene": "arrival"})
    (run_dir / "transcript.jsonl").write_text("", encoding="utf-8")
    receipt = coc_playtest_evidence.build_evidence_receipt(run_dir, {
        "started_at": "2026-07-12T00:00:00Z", "ended_at": "2026-07-12T00:01:00Z",
        "user_claimed_live": False, "transcript_path": "transcript.jsonl",
        "event_log_paths": ["sandbox/.coc/campaigns/product-smoke/logs/events.jsonl"]})
    receipt_path = coc_playtest_evidence.write_evidence_receipt(run_dir, receipt)
    assert receipt_path.name == "evidence.json"
    report_path = coc_playtest_report.generate_battle_report(run_dir)
    report_text = report_path.read_text(encoding="utf-8")
    assert report_path.name == "verification-sample.md"
    assert report_text.startswith("# NON-GAMEPLAY Verification Sample")
    assert "# Battle Report" not in report_text
    assert "not an actual-play battle report" in report_text
    assert "Epistemic Experience" in report_text
    assert "NON-GAMEPLAY verification evidence" in json.loads(
        (run_dir / "playtest.json").read_text(encoding="utf-8"))["evidence_class"]

    # A deterministic fake runner is necessarily ineligible as gameplay evidence,
    # but the receipt itself is present and validated rather than silently missing.
    persisted_receipt = coc_playtest_evidence.read_evidence_receipt(run_dir)
    assert persisted_receipt["eligible_as_gameplay_evidence"] is False
    assert "evidence_receipt_missing" not in persisted_receipt["evidence_reasons"]
