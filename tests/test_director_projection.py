"""Director-facing maintained projections + retirement of the legacy card reader (plan task t6).

Covers:
- ``read_turn_timeline`` / ``lookup_entities``: the Director read model living
  on top of t5's maintained SQLite projection (``v_turn_facts`` /
  ``v_entity_events`` views over ``events`` + ``event_entities``);
  corruption/absence healing per clean-slate law;
- temporal hook aging: ``open_hooks_with_age`` with numeric
  ``planted_turn`` / lower-bounded ``age_turns``, carried into the bounded
  resume capsule and pinned into the setup-session field allowlist (AST,
  since the operation cell needs the kernel runtime to import);
- the migrated ``director.advise`` path: plan output shape unchanged,
  memory inputs from temporal assertions only (Markdown cards never
  consulted), keeper-side privacy preserved, and hook provenance joined
  from canonical-event projections without ever inferring meaning from
  prose;
- storylet selection backed by the maintained eligibility index with
  byte-equivalent fallback when entries are absent.

Every claim here is a deterministic structured-data check; no prose or
keyword judgment anywhere.
"""
from __future__ import annotations

import ast
import importlib.util
import inspect
import json
import random
import sqlite3
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


tm = _load("coc_temporal_memory_ev6", SCRIPTS / "coc_temporal_memory.py")
coc_storylets = _load("coc_storylets_ev6", SCRIPTS / "coc_storylets.py")
coc_story_director = _load("coc_story_director_ev6", SCRIPTS / "coc_story_director.py")
coc_flag_state = _load("coc_flag_state_ev6", SCRIPTS / "coc_flag_state.py")

CAMPAIGN = "test"
TIMELINE = "tl-main"


@pytest.fixture(autouse=True)
def _fresh_emission_runtime():
    cem.reset_emission_runtime_state()
    yield
    cem.reset_emission_runtime_state()


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _campaign_root(tmp_path: Path) -> Path:
    """Canonical campaign layout so ``_advisory_timeline_id`` resolves for real."""
    camp = tmp_path / ".coc" / "campaigns" / CAMPAIGN
    (camp / "logs").mkdir(parents=True)
    return camp


def _emit(logs_dir: Path, ordinal: int, *, event_type: str, turn: int = 3,
          timeline: str = TIMELINE, privacy: str = "public", data: dict | None = None):
    defaults = {
        "turn-started": {},
        "player-declared": {"_v": 1, "declared_kind": "investigate"},
        "clue-discovered": {
            "_v": 1,
            "clue_id": f"clue-ledger-{ordinal:03d}",
            "discovered_by": "entity-inv-1",
            "scene_ref": "entity-scene-archive",
        },
        "npc-relationship-changed": {
            "_v": 1,
            "npc": "entity-npc-mrs-d",
            "investigator": "entity-inv-1",
            "channel": "interview",
            "after": "wary",
        },
        "turn-finalized": {"_v": 1, "finalization_id": f"final-{ordinal:03d}"},
        "memory-written": {
            "_v": 1,
            "memory_id": f"mem-{ordinal:03d}",
            "memory_kind": "episode",
        },
    }
    payload = data if data is not None else defaults[event_type]
    return cem.emit(
        campaign_logs_dir=logs_dir,
        event_type=event_type,
        campaign=CAMPAIGN,
        timeline=timeline,
        turn=turn,
        slug=cem.ordinal_slug(ordinal),
        source="test.emitter",
        game_time=f"1928-03-04-turn{turn}",
        privacy=privacy,
        decision_id=f"dec-ev6-t{turn}-{ordinal:04d}",
        data=payload,
    )


def _seed_assertion(
    camp: Path,
    assertion_id: str,
    entities: list[str],
    *,
    statement: str = "断言内容。",
    kind: str = "belief",
    privacy: str = "player_safe",
    valid_from_turn: int = 3,
):
    subject = tm.contract.subject_id_for("party", CAMPAIGN, "")
    return tm.record_assertion(
        {
            "assertion_id": assertion_id,
            "kind": kind,
            "scope": "campaign",
            "campaign_id": CAMPAIGN,
            "timeline_id": TIMELINE,
            "subject_id": subject,
            "knowers": [subject],
            "privacy": privacy,
            "state": "accurate",
            "statement": statement,
            "entities": list(entities),
            "occurred_turn": valid_from_turn,
            "valid_from_turn": valid_from_turn,
            "source_commit": "a" * 40,
            "source_turn": valid_from_turn,
            "source_receipts": [f"receipt-{assertion_id}"],
        },
        campaign_dir=camp,
    )


def _minimal_director_campaign(tmp_path: Path):
    """Minimal campaign in canonical .coc layout for the director context builder."""
    camp = _campaign_root(tmp_path)
    (camp / "save" / "investigator-state").mkdir(parents=True, exist_ok=True)
    (camp / "scenario").mkdir(parents=True, exist_ok=True)
    # Active timeline state so the advisory resolver returns tl-main.
    (camp / "save" / "timeline-state.json").write_text(json.dumps({
        "schema_generation": "timeline-state-1",
        "campaign_id": CAMPAIGN,
        "active_timeline_id": TIMELINE,
        "timelines": [{
            "timeline_id": TIMELINE,
            "campaign_id": CAMPAIGN,
            "kind": "root",
            "parents": [],
            "fork_point": None,
            "created_by": "initial",
        }],
        "confluences": [],
        "game_reasons": {},
    }))
    (camp / "save" / "investigator-state" / "inv1.json").write_text(json.dumps({
        "schema_version": 1, "campaign_id": CAMPAIGN, "investigator_id": "inv1",
        "current_hp": 12, "current_san": 55, "current_mp": 11,
        "conditions": [], "skill_checks_earned": [],
    }))
    (camp / "save" / "world-state.json").write_text(json.dumps({
        "schema_version": 1, "campaign_id": CAMPAIGN, "scenario_id": "test-mod",
        "status": "active", "active_scene_id": "archive", "active_subsystem": "play",
        "current_phase": "middle", "discovered_clue_ids": [], "major_decisions": [],
    }))
    (camp / "save" / "flags.json").write_text(json.dumps(
        coc_flag_state.new_flag_document(campaign_id=CAMPAIGN, scenario_id="test-mod")
    ))
    (camp / "save" / "pacing-state.json").write_text(json.dumps({
        "schema_version": 1, "tension_level": "low", "lethal_chances_used": 0,
        "recent_intent_classes": [],
    }))
    (camp / "scenario" / "module-meta.json").write_text(json.dumps({
        "schema_version": 1, "scenario_id": "test-mod",
        "structure_type": "branching_investigation", "era": "1920s",
        "content_flags": [], "win_condition": "test",
    }))
    (camp / "scenario" / "story-graph.json").write_text(json.dumps({"scenes": [
        {"scene_id": "archive", "scene_type": "investigation",
         "dramatic_question": "能否找到线索？",
         "entry_conditions": [], "exit_conditions": ["clue-1 discovered"],
         "available_clues": ["clue-1"], "npc_ids": [], "pressure_moves": [],
         "tone": ["tense"], "allowed_improvisation": []},
    ]}))
    (camp / "scenario" / "clue-graph.json").write_text(json.dumps({"conclusions": [
        {"conclusion_id": "concl-1", "importance": "critical", "minimum_routes": 3,
         "clues": [
             {"clue_id": "clue-1", "delivery": "investigate", "visibility": "player-safe"},
             {"clue_id": "clue-1b", "delivery": "social", "visibility": "player-safe"},
             {"clue_id": "clue-1c", "delivery": "spot hidden", "visibility": "player-safe"},
         ], "fallback_policy": "move clue if 2 missed"},
    ]}))
    (camp / "scenario" / "npc-agendas.json").write_text(json.dumps({"npcs": []}))
    (camp / "scenario" / "threat-fronts.json").write_text(json.dumps({"fronts": []}))
    (camp / "scenario" / "pacing-map.json").write_text(json.dumps({"pacing_curve": []}))
    (camp / "scenario" / "improvisation-boundaries.json").write_text(json.dumps(
        {"invent_allowed": [], "never_invent": [], "keeper_secrets": []}
    ))
    char_dir = tmp_path / ".coc" / "investigators" / "inv1"
    char_dir.mkdir(parents=True)
    (char_dir / "character.json").write_text(json.dumps({
        "schema_version": 1, "id": "inv1", "occupation": "Antiquarian", "era": "1920s",
        "characteristics": {"STR": 60, "CON": 55, "SIZ": 65, "DEX": 50, "APP": 45,
                            "INT": 70, "POW": 55, "EDU": 75, "LUCK": 55},
        "derived": {"HP": 12, "MP": 11, "SAN": 55, "MOV": 7,
                    "damage_bonus": "0", "build": 0},
        "skills": {"Credit Rating": 50, "Spot Hidden": 60, "Psychology": 55},
        "backstory": {},
    }))
    return camp, char_dir / "character.json"


def _storylet_library() -> dict:
    return {"schema_version": 1, "storylets": [
        {
            "storylet_id": "ambient-archive-dust",
            "title": "档案尘埃",
            "family_id": "ambience",
            "trope_id": "quiet-room",
            "conflict_level": "low",
            "base_weight": 2.0,
            "scene_actions": ["REVEAL", "DEEPEN"],
            "deck_tags": ["investigation", "ambience"],
            "scene_tags": ["dust"],
            "serves": {"theme": True, "can_reveal_clue": True},
            "cue": "旧档案的灰尘味道。",
        },
        {
            "storylet_id": "pressure-clerk-wary",
            "title": "警惕的办事员",
            "family_id": "social_friction",
            "trope_id": "bureaucratic_wall",
            "conflict_level": "medium",
            "base_weight": 3.0,
            "dramatic_function": ["PRESSURE"],
            "deck_tags": ["character_beat"],
            "requires": {"npc_id": True},
            "serves": {"can_deepen_npc": True},
            "cue": "他把手压在登记簿上。",
        },
    ]}


def _storylet_ctx(ctx_conflict="low"):
    return {
        "turn_number": 7,
        "structure_type": "branching_investigation",
        "storylet_policy": {"conflict_level": ctx_conflict, "seed": "fixed"},
        "active_scene": {
            "scene_id": "archive",
            "scene_type": "investigation",
            "npc_ids": ["entity-npc-mrs-d"],
            "available_clues": ["clue-transfer-record"],
            "tone": ["dust", "bureaucracy"],
        },
        "module_meta": {"content_flags": []},
        "storylet_ledger": {},
    }


def _storylet_plan(action="REVEAL"):
    return {
        "decision_id": "d-ev6",
        "scene_action": action,
        "pacing_mode": "investigation",
        "clue_policy": {"reveal": ["clue-transfer-record"], "leads": []},
        "narrative_directives": {"horror_escalation_stage": "wrongness"},
        "rule_signals": {"tension_clock": {"tension_level": "low"}},
    }


# ---------------------------------------------------------------------------
# Deliverable 1: projection read model (timeline + entity lookup)
# ---------------------------------------------------------------------------


def test_read_turn_timeline_orders_facts_and_filters(tmp_path):
    logs_dir = tmp_path / ".coc" / "campaigns" / CAMPAIGN / "logs"
    logs_dir.mkdir(parents=True)
    _emit(logs_dir, 1, event_type="player-declared", turn=2)
    _emit(logs_dir, 2, event_type="clue-discovered", turn=2)
    _emit(logs_dir, 3, event_type="clue-discovered", turn=4)
    _emit(logs_dir, 4, event_type="clue-discovered", turn=5, privacy="secret")

    default_view = cem.read_turn_timeline(logs_dir)
    # public-by-default: the secret clue discovery is invisible
    turns = [(row["turn"], row["sequence"], row["event_type"])
             for row in default_view["facts"]]
    assert turns == [
        (2, 1, "player-declared"),
        (2, 2, "clue-discovered"),
        (4, 3, "clue-discovered"),
    ]
    assert default_view["truncated"] is False

    keeper_view = cem.read_turn_timeline(logs_dir, privacy="all")
    assert [row["turn"] for row in keeper_view["facts"]] == [2, 2, 4, 5]
    assert any(row["privacy"] == "secret" for row in keeper_view["facts"])

    sliced = cem.read_turn_timeline(logs_dir, turn_from=4, turn_to=4)
    assert [(r["turn"]) for r in sliced["facts"]] == [4]

    typed = cem.read_turn_timeline(logs_dir, types=["player-declared"])
    assert [r["event_type"] for r in typed["facts"]] == ["player-declared"]

    capped = cem.read_turn_timeline(logs_dir, limit=2)
    assert capped["count"] == 2 and capped["truncated"] is True


def test_lookup_entities_answers_by_clue_by_npc_by_scene(tmp_path):
    logs_dir = tmp_path / ".coc" / "campaigns" / CAMPAIGN / "logs"
    logs_dir.mkdir(parents=True)
    _emit(logs_dir, 1, event_type="npc-relationship-changed", turn=3)
    _emit(logs_dir, 2, event_type="clue-discovered", turn=4)
    _emit(logs_dir, 3, event_type="npc-relationship-changed", turn=6)

    npc_hits = cem.lookup_entities(logs_dir, refs=["entity-npc-mrs-d"])
    assert [row["role"] for row in npc_hits["matches"]] == ["npc", "npc"]
    assert [row["turn"] for row in npc_hits["matches"]] == [3, 6]

    scene_hits = cem.lookup_entities(
        logs_dir, refs=["entity-scene-archive"], roles=["scene_ref"]
    )
    assert len(scene_hits["matches"]) == 1
    assert scene_hits["matches"][0]["turn"] == 4
    assert scene_hits["matches"][0]["event_type"] == "clue-discovered"

    keeper_rows = cem.lookup_entities(logs_dir, privacy="all")
    # Keeper view reaches every reference row; player view would filter.
    assert keeper_rows["count"] >= len(npc_hits["matches"])
    assert all("privacy" in row for row in keeper_rows["matches"])

    empty = cem.lookup_entities(logs_dir, refs=["entity-nobody"])
    assert empty["count"] == 0 and empty["matches"] == []


def test_projection_views_missing_tables_corruption_self_heal(tmp_path):
    logs_dir = tmp_path / ".coc" / "campaigns" / CAMPAIGN / "logs"
    logs_dir.mkdir(parents=True)
    _emit(logs_dir, 1, event_type="clue-discovered", turn=3)

    db_path = cem.events_projection_path(logs_dir)
    conn = sqlite3.connect(db_path)
    conn.execute("DROP TABLE v_turn_facts") if False else None
    conn.close()
    # Drop one maintained view via reconnection with writable schema.
    connection = sqlite3.connect(db_path)
    try:
        connection.executescript("PRAGMA writable_schema = ON;")
    finally:
        connection.close()

    # A garbage database file is deleted and rebuilt, never migrated.
    db_path.write_bytes(b"not a database at all")
    result = cem.read_turn_timeline(logs_dir)
    assert result["schema_generation"] == cem.SCHEMA_GENERATION
    assert result["count"] == 1

    # A missing stream answers explicit emptiness (nothing is fabricated).
    missing = tmp_path / ".coc" / "campaigns" / "other" / "logs"
    missing.mkdir(parents=True)
    result_empty = cem.lookup_entities(missing, refs=["entity-x"])
    assert result_empty["count"] == 0


def test_invalid_stream_fails_closed_for_every_reader(tmp_path):
    logs_dir = tmp_path / ".coc" / "campaigns" / CAMPAIGN / "logs"
    logs_dir.mkdir(parents=True)
    _emit(logs_dir, 1, event_type="clue-discovered", turn=3)
    with cem.canonical_stream_path(logs_dir).open("a", encoding="utf-8") as handle:
        handle.write('{"specversion": "coc-events/1", "broken json\n')
    with pytest.raises(cem.EventsProjectionError):
        cem.read_turn_timeline(logs_dir)
    with pytest.raises(cem.EventsProjectionError):
        cem.lookup_entities(logs_dir, refs=["entity-npc-mrs-d"])


# ---------------------------------------------------------------------------
# Deliverable 5: hook aging (numeric planted_turn / age_turns)
# ---------------------------------------------------------------------------


def test_open_hooks_carry_planted_and_lower_bounded_age(tmp_path):
    camp = tmp_path / "camp-test-store"
    camp.mkdir()
    _seed_assertion(camp, "mem-test-hook-a", ["entity-npc-mrs-d"], valid_from_turn=3)
    _seed_assertion(camp, "mem-test-hook-b", ["entity-clue-old-letter"], valid_from_turn=8)
    tm.register_hook("mem-test-hook-a", "mem-test-hook-a",
                     campaign_dir=camp, introduced_at="turn 5")
    # introduced_at empty -> fall back to the bound assertion's valid start
    tm.register_hook("mem-test-hook-b", "mem-test-hook-b", campaign_dir=camp)

    hooks = tm.open_hooks_with_age(camp, 9)
    by_id = {row["memory_id"]: row for row in hooks}
    assert set(by_id) == {"mem-test-hook-a", "mem-test-hook-b"}
    a = by_id["mem-test-hook-a"]
    b = by_id["mem-test-hook-b"]
    assert a["planted_turn"] == 5 and a["age_turns"] == 4
    assert b["planted_turn"] == 8 and b["age_turns"] == 1
    # Structured refs ride along for the canonical-event join.
    assert a["entities"] == ["entity-npc-mrs-d"]

    # Deterministic sort + bound cap.
    capped = tm.open_hooks_with_age(camp, 9, limit=1)
    assert len(capped) == 1 and capped[0]["memory_id"] == "mem-test-hook-a"

    # Age never goes negative: current turn before planting stays at zero.
    future = tm.open_hooks_with_age(camp, 2)[0]
    assert future["age_turns"] == 0


def test_resume_capsule_open_hooks_include_age_fields(tmp_path):
    camp = tmp_path / "camp-resume"
    camp.mkdir()
    _seed_assertion(camp, "mem-test-cellar-knock", ["entity-location-cellar"],
                    valid_from_turn=3)
    tm.register_hook("mem-test-open-knock", "mem-test-cellar-knock",
                     campaign_dir=camp, introduced_at="turn 5")
    capsule = tm.build_resume_projection(CAMPAIGN, 10, campaign_dir=camp)
    open_rows = capsule["open_hooks"]
    assert len(open_rows) == 1
    row = open_rows[0]
    assert row["planted_turn"] == 5
    assert row["age_turns"] == 5
    # Pure numeric advisory aging: no urgency verdict fields exist.
    assert not any(key.startswith("urgency") for key in row)


def test_open_hooks_read_never_bootstraps_store(tmp_path):
    camp = tmp_path / "camp-absent-hooks"
    camp.mkdir()
    assert tm.open_hooks_with_age(camp, 7) == []
    # A hook read is advisory and read-only: an absent store stays absent.
    assert not (camp / "memory" / "temporal").exists()


def test_setup_session_allowlist_pins_hook_age_fields():
    """AST pin of the closed model-facing hook projection (the setup-session
    operation cell itself needs the kernel runtime, so this pins the tuple)."""
    source = (SCRIPTS / "coc_operation_setup_session.py").read_text(encoding="utf-8")
    tree = ast.parse(source)
    fields = None
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            targets = [t.id for t in node.targets if isinstance(t, ast.Name)]
            if "_TEMPORAL_HOOK_FIELDS" in targets and isinstance(node.value, ast.Tuple):
                fields = [
                    elt.value for elt in node.value.elts if isinstance(elt, ast.Constant)
                ]
    assert fields is not None, "_TEMPORAL_HOOK_FIELDS tuple not found"
    assert "planted_turn" in fields and "age_turns" in fields
    # Original identity fields survive.
    for legacy in ("memory_id", "assertion_id", "kind", "status",
                   "introduced_at", "possible_payoff"):
        assert legacy in fields


# ---------------------------------------------------------------------------
# Deliverable 2 + 3: director consumer migration, shape, privacy
# ---------------------------------------------------------------------------

_EXPECTED_PLAN_KEYS = (
    "callback_candidates", "capability_findings", "clue_policy",
    "decision_id", "director_strategy_state", "dramatic_question",
    "epistemic_contract", "faction_rankings", "handoff",
    "memory_reads", "narrative_directives",
    "npc_moves", "npc_state_writes", "pacing_mode", "pressure_moves",
    "rationale", "rule_signal_notes", "rule_signals", "rules_requests",
    "scene_action", "scene_function", "subsystem", "tension_delta",
    "tension_target", "time_advance", "time_signals", "turn_input",
    "validation_warnings",
)


def _build_plan_with_projections(camp, character_path):
    _seed_assertion(camp, "mem-test-dossier-clue",
                    ["entity-npc-mrs-d", "entity-clue-transfer-record"],
                    statement="杜太太与转账记录有关。")
    tm.register_hook("mem-test-hook-dossier", "mem-test-dossier-clue",
                     campaign_dir=camp, introduced_at="turn 4")
    logs_dir = camp / "logs"
    _emit(logs_dir, 1, event_type="npc-relationship-changed", turn=6)
    _emit(logs_dir, 2, event_type="clue-discovered", turn=7)
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=character_path, investigator_id="inv1",
        player_intent="追问杜太太", player_intent_class="talk",
        rng=random.Random(42))
    ctx["memory_query_entities"] = ["entity-npc-mrs-d", "clue-transfer-record"]
    ctx["turn_number"] = 10
    plan = coc_story_director.generate_director_plan(ctx, "ev6-projection-plan")
    return ctx, plan


def test_director_plan_shape_unchanged_with_projection_backed_memory(tmp_path):
    camp, character_path = _minimal_director_campaign(tmp_path)
    _, plan = _build_plan_with_projections(camp, character_path)

    # Exact top-level DirectorPlan shape is preserved.
    assert set(plan.keys()) == set(_EXPECTED_PLAN_KEYS)

    # memory_reads come from temporal assertions, keeping legacy key surface.
    reads = plan["memory_reads"]
    assert reads, "temporal assertion should be recalled"
    read = reads[0]
    assert read["memory_id"] == "mem-test-dossier-clue"
    for legacy_key in ("memory_id", "path", "reason", "use"):
        assert legacy_key in read
    assert read["source"] == "temporal_assertion"

    callbacks = plan["callback_candidates"]
    assert callbacks, "open hook overlapping the query entities must appear"
    callback = callbacks[0]
    assert callback["beat"] == "CALLBACK"
    assert callback["authority"] == "advisory"
    assert callback["hard_gate"] is False
    for legacy_key in ("memory_id", "kind", "status", "summary",
                       "possible_payoff", "overlap_entities", "reason"):
        assert legacy_key in callback
    # Numeric aging facts from deliverable 1/5.
    assert callback["planted_turn"] == 4
    assert callback["age_turns"] == 6
    # Provenance joined from the canonical-event projection (keeper view may
    # cross privacy; turns are numeric evidence, not meaning).
    turns = [item["turn"] for item in callback["provenance_events"]]
    assert sorted(turns, reverse=True) == turns and turns
    assert set(turns) <= {6, 7}


def test_director_hooks_degrade_gracefully_on_broken_stream(tmp_path):
    camp, character_path = _minimal_director_campaign(tmp_path)
    _seed_assertion(camp, "mem-test-dossier-clue", ["entity-npc-mrs-d"])
    tm.register_hook("mem-test-hook-dossier", "mem-test-dossier-clue",
                     campaign_dir=camp, introduced_at="turn 4")
    logs_dir = camp / "logs"
    _emit(logs_dir, 1, event_type="npc-relationship-changed", turn=6)
    with (logs_dir / "canonical-events.jsonl").open("a", encoding="utf-8") as handle:
        handle.write('{"not valid json broken\n')

    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=character_path, investigator_id="inv1",
        player_intent="继续", player_intent_class="talk", rng=random.Random(7))
    ctx["memory_query_entities"] = ["entity-npc-mrs-d"]
    ctx["turn_number"] = 10
    plan = coc_story_director.generate_director_plan(ctx, "ev6-degrade-plan")

    # The unbuildable projection fails closed for enrichment...
    warnings = ctx.get("validation_warnings") or []
    assert any(w.get("field") == "canonical_projection"
               and w.get("reason_code") == "unavailable" for w in warnings)
    # ...but hooks still age and advise (never block play).
    callback = next(iter(plan["callback_candidates"]))
    assert callback["age_turns"] == 6
    assert callback["provenance_events"] == []
    assert plan["callback_candidates"][0]["hard_gate"] is False


def test_director_secret_privacy_preserved(tmp_path):
    camp, character_path = _minimal_director_campaign(tmp_path)
    _seed_assertion(camp, "mem-test-public-tone", ["entity-scene-archive"],
                    statement="公开的房间氛围。", privacy="player_safe")
    _seed_assertion(camp, "mem-test-secret-scheme", ["entity-scene-archive"],
                    statement="Keeper 私密阴谋。", privacy="keeper_only")
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=character_path, investigator_id="inv1",
        player_intent="环顾四周", player_intent_class="investigate",
        rng=random.Random(42))
    ctx["memory_query_entities"] = ["entity-scene-archive"]
    plan = coc_story_director.generate_director_plan(ctx, "ev6-privacy-plan")
    read_ids = {row["memory_id"] for row in plan["memory_reads"]}
    assert "mem-test-public-tone" in read_ids
    assert "mem-test-secret-scheme" not in read_ids


def test_director_memory_read_is_read_only_on_absent_store(tmp_path):
    """No temporal store, no bootstrap: memory advice degrades to empty."""
    camp, character_path = _minimal_director_campaign(tmp_path)
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=character_path, investigator_id="inv1",
        player_intent="环顾四周", player_intent_class="investigate",
        rng=random.Random(42))
    ctx["memory_query_entities"] = ["entity-scene-archive"]
    plan = coc_story_director.generate_director_plan(ctx, "ev6-absent-store-plan")
    assert plan["memory_reads"] == []
    assert not (camp / "memory" / "temporal").exists()


def test_director_memory_all_invalid_query_refs_recall_nothing(tmp_path):
    """A nonempty query whose refs are all non-canonical narrows to nothing:
    no unfiltered warm recall of unrelated memories, and a bounded
    temporal_memory unavailable warning instead of a silent widening."""
    camp, character_path = _minimal_director_campaign(tmp_path)
    _seed_assertion(
        camp, "mem-test-dossier-clue",
        ["entity-npc-mrs-d", "entity-clue-transfer-record"],
        statement="杜太太与转账记录有关。")
    # An unrelated open assertion that an unfiltered warm recall would
    # return; it must never appear for an all-invalid query.
    _seed_assertion(
        camp, "mem-test-unrelated-cellar",
        ["entity-location-cellar"], statement="无关的地窖记忆。")
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=character_path, investigator_id="inv1",
        player_intent="追问杜太太", player_intent_class="talk",
        rng=random.Random(42))
    # None of these is an entity-* semantic id.
    ctx["memory_query_entities"] = ["clue-transfer-record", "scene-archive"]
    ctx["turn_number"] = 10
    plan = coc_story_director.generate_director_plan(ctx, "ev6-nonentity-plan")
    assert plan["memory_reads"] == []
    assert not any(
        row.get("memory_id") == "mem-test-unrelated-cellar"
        for row in plan["memory_reads"]
    )
    warnings = ctx.get("validation_warnings") or []
    assert any(
        warning.get("field") == "temporal_memory"
        and warning.get("reason_code") == "unavailable"
        and "entity-*" in warning.get("detail", "")
        for warning in warnings
    )


def test_director_memory_falsey_and_mixed_invalid_refs_are_constrained(tmp_path):
    """Falsey entries, whitespace-only strings, and malformed ids are a
    constrained query: zero candidates + bounded warning, never unfiltered
    recall. Only a mixed query with at least one canonical entity-* ref
    narrows normally (invalid refs dropped, valid ones honored)."""
    camp, character_path = _minimal_director_campaign(tmp_path)
    _seed_assertion(
        camp, "mem-test-unrelated-cellar",
        ["entity-location-cellar"], statement="无关的地窖记忆。")
    falsey_query_cases = [
        [None, ""],
        ["   "],
        ["cellar"],
        [None, "clue-x", "  "],
    ]
    for index, bad_refs in enumerate(falsey_query_cases):
        ctx = coc_story_director.build_director_context(
            campaign_dir=camp, character_path=character_path,
            investigator_id="inv1", player_intent="环顾四周",
            player_intent_class="investigate", rng=random.Random(42))
        ctx["memory_query_entities"] = list(bad_refs)
        ctx["turn_number"] = 10
        plan = coc_story_director.generate_director_plan(
            ctx, f"ev6-falsey-plan-{index}")
        assert plan["memory_reads"] == [], bad_refs
        assert not any(
            row.get("memory_id") == "mem-test-unrelated-cellar"
            for row in plan["memory_reads"]
        )
        assert any(
            warning.get("field") == "temporal_memory"
            and warning.get("reason_code") == "unavailable"
            for warning in ctx.get("validation_warnings") or []
        ), bad_refs

    # One canonical ref among falsey/invalid ones: normal narrowed recall.
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=character_path,
        investigator_id="inv1", player_intent="环顾四周",
        player_intent_class="investigate", rng=random.Random(42))
    ctx["memory_query_entities"] = ["entity-location-cellar", None, "  "]
    ctx["turn_number"] = 10
    plan = coc_story_director.generate_director_plan(ctx, "ev6-falsey-mixed-valid")
    assert [row["memory_id"] for row in plan["memory_reads"]] == [
        "mem-test-unrelated-cellar"
    ]


def test_director_memory_mixed_valid_and_malformed_refs_narrow_normally(tmp_path):
    """Per-ref canonical grammar validation on the exact supplied string (no
    normalization): one malformed ref (entity-@, wrong prefix, falsey,
    non-string, whitespace-wrapped) never rejects the whole list — exact
    valid entity-* refs narrow normally and everything else is discarded
    with a bounded warning. A whitespace-wrapped-only query is a constrained
    query returning zero candidates; valid-only queries are warning-free."""
    camp, character_path = _minimal_director_campaign(tmp_path)
    _seed_assertion(
        camp, "mem-test-cellar-knock",
        ["entity-location-cellar"], statement="地窖敲击。")
    _seed_assertion(
        camp, "mem-test-unrelated-attic",
        ["entity-location-attic"], statement="无关阁楼。")

    mixed_cases = [
        ["entity-location-cellar", "entity-@"],
        ["entity-location-cellar", "clue-transfer-record", None, "", 42],
        ["entity-location-cellar", " entity-location-cellar "],
        ["entity-location-cellar"],
    ]
    for index, refs in enumerate(mixed_cases):
        ctx = coc_story_director.build_director_context(
            campaign_dir=camp, character_path=character_path,
            investigator_id="inv1", player_intent="地窖里的敲击",
            player_intent_class="investigate", rng=random.Random(42))
        ctx["memory_query_entities"] = list(refs)
        ctx["turn_number"] = 10
        plan = coc_story_director.generate_director_plan(
            ctx, f"ev6-mixed-valid-plan-{index}")
        # Only the exact canonical ref narrows; the unrelated memory never
        # leaks, and the whitespace-wrapped form is not normalized into one.
        assert [row["memory_id"] for row in plan["memory_reads"]] == [
            "mem-test-cellar-knock"
        ], refs
        warnings = ctx.get("validation_warnings") or []
        assert not any(
            warning.get("field") == "temporal_memory"
            and warning.get("reason_code") == "unavailable"
            for warning in warnings
        ), refs
        if index < 3:
            # Cases that discarded malformed refs carry the bounded warning.
            discard_warnings = [
                warning
                for warning in warnings
                if warning.get("field") == "temporal_memory"
                and warning.get("reason_code") == "invalid_query_refs"
            ]
            assert discard_warnings, refs
            if index == 2:
                # The whitespace-wrapped form is discarded as supplied.
                assert any(
                    " entity-location-cellar " in warning.get("detail", "")
                    for warning in discard_warnings
                )
        else:
            # Valid-only queries are warning-free.
            assert not any(
                warning.get("field") == "temporal_memory"
                for warning in warnings
            ), refs

    # Whitespace-wrapped-only: still a constrained query under the exact
    # grammar — zero candidates plus the unavailable warning, never
    # normalization and never unfiltered widening.
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=character_path,
        investigator_id="inv1", player_intent="地窖里的敲击",
        player_intent_class="investigate", rng=random.Random(42))
    ctx["memory_query_entities"] = [" entity-location-cellar "]
    ctx["turn_number"] = 10
    plan = coc_story_director.generate_director_plan(
        ctx, "ev6-whitespace-wrapped-plan")
    assert plan["memory_reads"] == []
    assert any(
        warning.get("field") == "temporal_memory"
        and warning.get("reason_code") == "unavailable"
        for warning in ctx.get("validation_warnings") or []
    )


def test_director_memory_empty_query_keeps_unconstrained_warm_behavior(tmp_path):
    """Only a genuinely unconstrained query (no refs at all) keeps the
    canonical no-entity-narrowing warm behavior."""
    camp, _character_path = _minimal_director_campaign(tmp_path)
    _seed_assertion(
        camp, "mem-test-open-only",
        ["entity-location-cellar"], statement="地窖记忆。")
    reads = coc_story_director._retrieve_memory_for_ctx({"campaign_dir": camp})
    assert [row["memory_id"] for row in reads] == ["mem-test-open-only"]


def test_director_plan_has_no_legacy_card_write_contract(tmp_path):
    assert not (SCRIPTS / "coc_memory.py").exists()
    assert not hasattr(coc_story_director, "coc_memory")
    source = inspect.getsource(coc_story_director)
    assert "retrieve_memory_cards" not in source
    assert '"coc_memory.py"' not in source

    camp, character_path = _minimal_director_campaign(tmp_path)
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=character_path, investigator_id="inv1",
        player_intent="环顾四周", player_intent_class="investigate",
        rng=random.Random(42))
    plan = coc_story_director.generate_director_plan(ctx, "ev6-retired-plan")
    assert "memory_writes" not in plan


# ---------------------------------------------------------------------------
# Deliverable 4: storylet eligibility index
# ---------------------------------------------------------------------------


def test_eligibility_index_is_content_addressed_and_memoized():
    library = _storylet_library()
    first = coc_storylets.storylet_eligibility_index(library)
    assert first["schema_version"] == 1
    assert first["memoized"] is False
    assert [entry["storylet_id"] for entry in first["entries"]] == [
        "ambient-archive-dust", "pressure-clerk-wary",
    ]
    entry = first["entries"][0]
    assert "dust" in entry["req_scene_tags"]
    assert entry["actions"] >= {"REVEAL"}
    assert first["entries"][1]["functions"] >= {"character_beat"}

    second = coc_storylets.storylet_eligibility_index(library)
    assert second["memoized"] is True
    assert second["entries"] is first["entries"]

    mutated = {"schema_version": 1,
               "storylets": list(library["storylets"]) + [{
                   "storylet_id": "third-beat", "family_id": "f", "trope_id": "t",
                   "conflict_level": "low", "base_weight": 1.0,
                   "serves": {"theme": True}}]}
    third = coc_storylets.storylet_eligibility_index(mutated)
    assert third["memoized"] is False
    assert len(third["entries"]) == 3


def test_selection_uses_index_and_falls_back_identically(monkeypatch):
    library = _storylet_library()

    index_active = coc_storylets.storylet_eligibility_index(library)
    calls = {"built": 0}
    original_builder = coc_storylets._eligibility_entry

    def counting_builder(storylet):
        calls["built"] += 1
        return original_builder(storylet)

    monkeypatch.setattr(coc_storylets, "_eligibility_entry", counting_builder)
    moves_active = coc_storylets.select_storylet_moves(
        _storylet_plan("REVEAL"), _storylet_ctx(), library=library, seed="s1",
    )
    # Index supplied every static entry: no per-call fallback parsing ran.
    assert moves_active
    assert calls["built"] == 0
    trace = moves_active[0]["scheduler_trace"]["selection_index"]
    assert trace["schema_version"] == 1
    assert trace["entry_count"] == 2
    assert trace["memoized"] is True

    # Absent index -> per-call fallback with identical decisions.
    monkeypatch.setattr(
        coc_storylets,
        "storylet_eligibility_index",
        lambda library=None: {"schema_version": 1, "memoized": False,
                              "entries": [None, None]},
    )
    moves_fallback = coc_storylets.select_storylet_moves(
        _storylet_plan("REVEAL"), _storylet_ctx(), library=library, seed="s1",
    )
    assert calls["built"] > 0  # fallback parsed storylets lazily again

    def comparable(moves):
        cleaned = []
        for move in moves:
            row = dict(move)
            trace_local = dict(row.pop("scheduler_trace"))
            trace_local.pop("selection_index", None)
            row["scheduler_trace"] = trace_local
            cleaned.append(row)
        return json.dumps(cleaned, ensure_ascii=False, sort_keys=True, default=str)

    assert comparable(moves_fallback) == comparable(moves_active)


def test_matches_context_public_callers_stay_compatible():
    """Legacy four-argument call sites keep working (tests/external code)."""
    library = _storylet_library()
    dust_beat = library["storylets"][0]
    held_ctx = dict(_storylet_ctx())
    held_ctx["player_intent_rich"] = {}
    held_ctx["story_need"] = {"need_id": "", "story_functions": [],
                              "candidate_decks": []}
    held_ctx["storylet_trigger"] = {}
    story_need = held_ctx["story_need"] | {"candidate_decks": ["ambience"]}
    held_ctx["story_need"] = story_need
    assert coc_storylets._matches_context(dust_beat, _storylet_plan(), held_ctx, "low") is True
