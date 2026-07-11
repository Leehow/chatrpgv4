"""G3: persistent NPC psychological state (trust/fear/suspicion + memory records).

State lives under save/npc-state.json["psych"] (namespaced beside persona cards,
which the apply layer overwrites wholesale under "npcs"). Disposition derives
from numeric thresholds — structured fields only, never agenda prose.
"""
from __future__ import annotations

import importlib.util
import json
import random


def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, rel)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


coc_npc_state = _load("coc_npc_state", "plugins/coc-keeper/scripts/coc_npc_state.py")
coc_director_apply = _load(
    "coc_director_apply", "plugins/coc-keeper/scripts/coc_director_apply.py"
)
coc_story_director = _load(
    "coc_story_director", "plugins/coc-keeper/scripts/coc_story_director.py"
)


def _campaign(tmp_path):
    camp = tmp_path / "campaigns" / "npcstate"
    (camp / "save").mkdir(parents=True)
    (camp / "logs").mkdir(parents=True)
    (camp / "save" / "world-state.json").write_text(json.dumps({
        "schema_version": 1, "campaign_id": "npcstate",
        "discovered_clue_ids": [], "active_scene_id": "scene-1"}))
    (camp / "save" / "pacing-state.json").write_text(json.dumps({
        "schema_version": 1, "tension_level": "low", "lethal_chances_used": 0,
        "recent_intent_classes": [], "turn_number": 0, "luck_spent_last": 0}))
    (camp / "logs" / "events.jsonl").write_text("")
    return camp


# --------------------------------------------------------------------------- #
# Persistence round-trip + clamping
# --------------------------------------------------------------------------- #

def test_adjust_persists_and_round_trips(tmp_path):
    camp = _campaign(tmp_path)
    value = coc_npc_state.adjust(camp, "npc-a", "trust", 2)
    assert value == 2
    # reload from disk
    entry = coc_npc_state.get_npc_entry(camp, "npc-a")
    assert entry["trust"] == 2
    assert entry["fear"] == 0
    assert entry["suspicion"] == 0
    assert entry["known_facts"] == []
    assert entry["lies_told"] == []
    assert entry["promises"] == []


def test_adjust_clamps_to_range(tmp_path):
    camp = _campaign(tmp_path)
    assert coc_npc_state.adjust(camp, "npc-a", "fear", 99) == 5
    assert coc_npc_state.adjust(camp, "npc-a", "fear", -99) == -5
    assert coc_npc_state.adjust(camp, "npc-a", "trust", -3) == -3
    assert coc_npc_state.adjust(camp, "npc-a", "trust", -9) == -5


def test_adjust_rejects_unknown_field(tmp_path):
    camp = _campaign(tmp_path)
    try:
        coc_npc_state.adjust(camp, "npc-a", "anger", 1)
    except ValueError:
        pass
    else:
        raise AssertionError("expected ValueError for unknown field")


def test_psych_state_survives_persona_card_overwrite(tmp_path):
    """Apply layer overwrites npc-state.json['npcs'][id] wholesale; psych must survive."""
    camp = _campaign(tmp_path)
    coc_npc_state.adjust(camp, "npc-a", "suspicion", 3)
    plan = {
        "decision_id": "d-card", "scene_action": "CHARACTER",
        "clue_policy": {"reveal": []}, "pressure_moves": [], "memory_writes": [],
        "rule_signals": {},
        "npc_state_writes": [{"schema_version": 1, "npc_id": "npc-a",
                              "persona": {"tags": []}, "social_role": {}}],
    }
    coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")
    entry = coc_npc_state.get_npc_entry(camp, "npc-a")
    assert entry["suspicion"] == 3


# --------------------------------------------------------------------------- #
# Memory records
# --------------------------------------------------------------------------- #

def test_record_fact_lie_promise_round_trip(tmp_path):
    camp = _campaign(tmp_path)
    coc_npc_state.record_fact(camp, "npc-a", "fact-saw-symbol")
    coc_npc_state.record_fact(camp, "npc-a", "fact-saw-symbol")  # dedupe
    coc_npc_state.record_lie(camp, "npc-a", "lie-alibi", about="whereabouts-tuesday")
    coc_npc_state.record_promise(camp, "npc-a", "promise-meet-at-dock")
    entry = coc_npc_state.get_npc_entry(camp, "npc-a")
    assert entry["known_facts"] == ["fact-saw-symbol"]
    assert entry["lies_told"] == [{"lie_id": "lie-alibi", "about": "whereabouts-tuesday"}]
    assert entry["promises"] == [{"promise_id": "promise-meet-at-dock", "kept": None}]


def test_record_promise_kept_update(tmp_path):
    camp = _campaign(tmp_path)
    coc_npc_state.record_promise(camp, "npc-a", "promise-1")
    coc_npc_state.record_promise(camp, "npc-a", "promise-1", kept=True)
    entry = coc_npc_state.get_npc_entry(camp, "npc-a")
    assert entry["promises"] == [{"promise_id": "promise-1", "kept": True}]


# --------------------------------------------------------------------------- #
# Disposition (pure, threshold-based)
# --------------------------------------------------------------------------- #

def _entry(**overrides):
    base = {"trust": 0, "fear": 0, "suspicion": 0,
            "known_facts": [], "lies_told": [], "promises": []}
    base.update(overrides)
    return base


def test_disposition_neutral_at_zero():
    d = coc_npc_state.npc_disposition(_entry())
    assert d["stance"] == "neutral"
    assert d["drivers"] == []


def test_disposition_hostile_on_low_trust():
    d = coc_npc_state.npc_disposition(_entry(trust=-3))
    assert d["stance"] == "hostile"
    assert any(drv["field"] == "trust" for drv in d["drivers"])


def test_disposition_hostile_on_high_suspicion():
    d = coc_npc_state.npc_disposition(_entry(suspicion=3))
    assert d["stance"] == "hostile"
    assert any(drv["field"] == "suspicion" for drv in d["drivers"])


def test_disposition_wary_on_moderate_fear():
    d = coc_npc_state.npc_disposition(_entry(fear=2))
    assert d["stance"] == "wary"
    assert any(drv["field"] == "fear" for drv in d["drivers"])


def test_disposition_wary_on_mild_suspicion():
    assert coc_npc_state.npc_disposition(_entry(suspicion=1))["stance"] == "wary"
    assert coc_npc_state.npc_disposition(_entry(trust=-1))["stance"] == "wary"


def test_disposition_warm_on_high_trust():
    d = coc_npc_state.npc_disposition(_entry(trust=3))
    assert d["stance"] == "warm"
    assert any(drv["field"] == "trust" for drv in d["drivers"])


def test_disposition_high_trust_but_high_suspicion_not_warm():
    d = coc_npc_state.npc_disposition(_entry(trust=3, suspicion=3))
    assert d["stance"] == "hostile"


# --------------------------------------------------------------------------- #
# Apply layer: plan npc_effects land idempotently
# --------------------------------------------------------------------------- #

def _effects_plan(decision_id="d-eff"):
    return {
        "decision_id": decision_id, "scene_action": "CHARACTER",
        "clue_policy": {"reveal": []}, "pressure_moves": [], "memory_writes": [],
        "rule_signals": {},
        "npc_effects": [
            {"npc_id": "npc-a", "field": "trust", "delta": 2},
            {"npc_id": "npc-a", "kind": "record_fact", "fact_id": "fact-x"},
            {"npc_id": "npc-b", "field": "fear", "delta": 1},
            {"npc_id": "npc-b", "kind": "record_lie",
             "lie_id": "lie-1", "about": "the-cellar"},
            {"npc_id": "npc-b", "kind": "record_promise", "promise_id": "p-1"},
        ],
    }


def test_apply_npc_effects_adjusts_state(tmp_path):
    camp = _campaign(tmp_path)
    events = coc_director_apply.apply_plan(camp, _effects_plan(), investigator_id="inv1")
    a = coc_npc_state.get_npc_entry(camp, "npc-a")
    b = coc_npc_state.get_npc_entry(camp, "npc-b")
    assert a["trust"] == 2
    assert a["known_facts"] == ["fact-x"]
    assert b["fear"] == 1
    assert b["lies_told"] == [{"lie_id": "lie-1", "about": "the-cellar"}]
    assert b["promises"] == [{"promise_id": "p-1", "kept": None}]
    assert any(e.get("event_type") == "npc_effect" for e in events)


def test_apply_npc_effects_idempotent_per_decision_id(tmp_path):
    camp = _campaign(tmp_path)
    coc_director_apply.apply_plan(camp, _effects_plan("d-once"), investigator_id="inv1")
    events2 = coc_director_apply.apply_plan(camp, _effects_plan("d-once"), investigator_id="inv1")
    assert any(e.get("skipped") == "duplicate_decision_id" for e in events2)
    a = coc_npc_state.get_npc_entry(camp, "npc-a")
    assert a["trust"] == 2  # not 4
    assert a["known_facts"] == ["fact-x"]


# --------------------------------------------------------------------------- #
# Director consumes stance
# --------------------------------------------------------------------------- #

def test_build_npc_moves_consumes_persisted_stance():
    """A persisted hostile psych stance drives the move's tone/stance —
    structured fields, not agenda prose, and no fresh reaction roll override."""
    npc_state_doc = {
        "schema_version": 1,
        "npcs": {},
        "psych": {"npc-clerk": {"trust": -4, "fear": 0, "suspicion": 2,
                                "known_facts": [], "lies_told": [], "promises": []}},
    }
    ctx = {
        "active_scene": {"npc_ids": ["npc-clerk"]},
        "npc_agendas": {"npcs": [{
            "npc_id": "npc-clerk",
            "agenda": "keep the archive orderly",
        }]},
        "npc_state": npc_state_doc,
        "rule_signals": {"app": 80, "credit_rating": 80, "npc_reaction_roll": None},
        "rng": random.Random(42),
    }
    moves = coc_story_director._build_npc_moves(ctx, "CHARACTER")
    assert moves[0]["psych_stance"] == "hostile"
    assert moves[0]["emotional_tone"] == "cold and suspicious"
    assert moves[0]["disposition_source"] == "npc_state:psych"
    assert any(d["field"] == "trust" for d in moves[0]["stance_drivers"])


def test_build_npc_moves_warm_stance_softens():
    npc_state_doc = {
        "schema_version": 1,
        "npcs": {},
        "psych": {"npc-clerk": {"trust": 4, "fear": 0, "suspicion": 0,
                                "known_facts": [], "lies_told": [], "promises": []}},
    }
    ctx = {
        "active_scene": {"npc_ids": ["npc-clerk"]},
        "npc_agendas": {"npcs": [{"npc_id": "npc-clerk", "agenda": "help"}]},
        "npc_state": npc_state_doc,
        "rule_signals": {"app": 80, "credit_rating": 80, "npc_reaction_roll": None},
        "rng": random.Random(42),
    }
    moves = coc_story_director._build_npc_moves(ctx, "CHARACTER")
    assert moves[0]["psych_stance"] == "warm"
    assert moves[0]["emotional_tone"] == "warm and cooperative"


def test_build_npc_moves_neutral_psych_falls_back_to_reaction_roll():
    """Zeroed psych entry (or none) keeps the legacy APP/CR reaction path."""
    ctx = {
        "active_scene": {"npc_ids": ["npc-clerk"]},
        "npc_agendas": {"npcs": [{"npc_id": "npc-clerk", "agenda": "work"}]},
        "npc_state": {"schema_version": 1, "npcs": {}, "psych": {}},
        "rule_signals": {"app": 80, "credit_rating": 80, "npc_reaction_roll": None},
        "rng": random.Random(42),
    }
    moves = coc_story_director._build_npc_moves(ctx, "CHARACTER")
    assert moves[0].get("psych_stance") is None
    assert moves[0]["disposition_source"] == "rule_signal:npc_reaction_roll"


def test_build_npc_moves_forced_adversary_stays_hostile_despite_warm_psych():
    """Structured adversary relationship outranks accumulated warmth."""
    npc_state_doc = {
        "schema_version": 1, "npcs": {},
        "psych": {"npc-cultist": {"trust": 5, "fear": 0, "suspicion": 0,
                                  "known_facts": [], "lies_told": [], "promises": []}},
    }
    ctx = {
        "active_scene": {"npc_ids": ["npc-cultist"]},
        "npc_agendas": {"npcs": [{
            "npc_id": "npc-cultist", "agenda": "the rite must finish",
            "relationship_to_investigators": "adversary",
        }]},
        "npc_state": npc_state_doc,
        "rule_signals": {"app": 80, "credit_rating": 80, "npc_reaction_roll": None},
        "rng": random.Random(42),
    }
    moves = coc_story_director._build_npc_moves(ctx, "CHARACTER")
    assert moves[0]["emotional_tone"] == "hostile"


# --------------------------------------------------------------------------- #
# A20/A21: live interactions, disclosure, and availability
# --------------------------------------------------------------------------- #

def test_load_normalizes_legacy_malformed_npc_psych_fields(tmp_path):
    camp = _campaign(tmp_path)
    (camp / "save" / "npc-state.json").write_text(json.dumps({
        "psych": {"npc-a": {
            "trust": "2", "fear": None, "suspicion": 99,
            "known_facts": "fact-a", "revealable_facts": ["fact-a", "fact-a", 3],
            "lie_options": None, "deflect_options": "nope", "leverage": "token",
            "active_reactions": [{"reaction_id": "r-open", "blocks_disclosure": False}, None],
            "availability": "available", "schedule": None,
        }}
    }))
    entry = coc_npc_state.get_npc_entry(camp, "npc-a")
    assert entry["trust"] == 2
    assert entry["fear"] == 0
    assert entry["suspicion"] == 5
    assert entry["known_facts"] == ["fact-a"]
    assert entry["revealable_facts"] == ["fact-a"]
    assert entry["lie_options"] == []
    assert entry["leverage"] == ["token"]
    assert entry["availability"] == {"status": "available"}


def test_disclosure_decision_uses_strict_gate_order():
    base = {
        "trust": 2,
        "known_facts": ["fact-a"],
        "revealable_facts": ["fact-a"],
        "availability": {"status": "available"},
        "active_reactions": [],
        "leverage": [],
    }
    assert coc_npc_state.disclosure_decision(
        {**base, "availability": {"status": "unavailable"}}, "fact-a"
    )["reason_code"] == "npc_unavailable"
    assert coc_npc_state.disclosure_decision(base, "fact-missing")["reason_code"] == "fact_not_known"
    assert coc_npc_state.disclosure_decision(
        {**base, "revealable_facts": []}, "fact-a"
    )["reason_code"] == "fact_not_revealable"
    assert coc_npc_state.disclosure_decision(
        {**base, "active_reactions": [{"reaction_id": "r", "blocks_disclosure": True}]},
        "fact-a",
    )["reason_code"] == "active_reaction_blocks"
    assert coc_npc_state.disclosure_decision(
        base, "fact-a", min_trust=3, required_leverage_ids=["badge"]
    )["reason_code"] == "willingness_insufficient"
    reveal = coc_npc_state.disclosure_decision(
        {**base, "leverage": ["badge"]}, "fact-a", min_trust=3,
        required_leverage_ids=["badge"], clue_id="clue-a",
    )
    assert reveal == {
        "outcome": "reveal", "reason_code": "approved_reveal",
        "fact_id": "fact-a", "clue_id": "clue-a",
    }


def test_derive_interaction_effects_is_bounded_exact_and_fail_closed():
    interactions = [
        {"npc_id": "npc-a", "tactic": "build_rapport", "request_id": "r1"},
        {"npc_id": "npc-b", "tactic": "intimidate", "request_id": "r2"},
        {"npc_id": "npc-c", "tactic": "unknown", "request_id": "r3"},
    ]
    effects = coc_npc_state.derive_interaction_effects(interactions, [
        {"request_id": "r1", "success": True},
        {"request_id": "r2", "success": False},
        {"request_id": "r3", "success": True},
    ])
    assert effects == [
        {"npc_id": "npc-a", "kind": "adjust", "field": "trust", "delta": 1,
         "interaction_request_id": "r1"},
        {"npc_id": "npc-b", "kind": "adjust", "field": "suspicion", "delta": 1,
         "interaction_request_id": "r2"},
    ]


def test_apply_social_clue_requires_approved_disclosure(tmp_path):
    camp = _campaign(tmp_path)
    scenario = camp / "scenario"
    scenario.mkdir()
    (scenario / "npc-agendas.json").write_text(json.dumps({"npcs": [{
        "npc_id": "npc-a", "agenda": "structured",
        "known_fact_ids": ["fact-a"], "revealable_fact_ids": ["fact-a"],
        "disclosure_order": ["fact-a"],
        "facts": [{"fact_id": "fact-a", "clue_id": "clue-social", "min_trust": 0}],
        "availability": {"status": "available"}, "schedule": [],
    }]}))
    (scenario / "clue-graph.json").write_text(json.dumps({"conclusions": [{
        "clues": [{"clue_id": "clue-social", "delivery_kind": "npc_dialogue",
                   "source_npc_ids": ["npc-a"]}]
    }]}))
    denied = {
        "decision_id": "d-denied", "scene_action": "CHARACTER",
        "clue_policy": {"reveal": ["clue-social"], "delivery_kind": "npc_dialogue"},
        "pressure_moves": [], "memory_writes": [], "rule_signals": {},
        "disclosure_decisions": [{"outcome": "deflect", "npc_id": "npc-a",
                                  "fact_id": "fact-a", "clue_id": "clue-social"}],
    }
    events = coc_director_apply.apply_plan(camp, denied, investigator_id="inv1")
    assert not any(e.get("event_type") == "clue_reveal" for e in events)
    assert any(e.get("event_type") == "npc_disclosure_withheld" for e in events)

    approved = dict(denied)
    approved["decision_id"] = "d-approved"
    approved["disclosure_decisions"] = [{"outcome": "reveal", "npc_id": "npc-a",
                                         "fact_id": "fact-a", "clue_id": "clue-social"}]
    events = coc_director_apply.apply_plan(camp, approved, investigator_id="inv1")
    assert any(e.get("event_type") == "clue_reveal" for e in events)


def test_apply_lie_and_deflect_persist_without_revealing_clue(tmp_path):
    camp = _campaign(tmp_path)
    plan = {
        "decision_id": "d-lie", "scene_action": "CHARACTER",
        "clue_policy": {"reveal": ["clue-social"], "delivery_kind": "npc_dialogue"},
        "pressure_moves": [], "memory_writes": [], "rule_signals": {},
        "disclosure_decisions": [{
            "outcome": "lie", "npc_id": "npc-a", "fact_id": "fact-a",
            "clue_id": "clue-social", "lie_id": "lie-a", "about": "fact-a",
        }],
    }
    coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")
    assert coc_npc_state.get_npc_entry(camp, "npc-a")["lies_told"] == [
        {"lie_id": "lie-a", "about": "fact-a"}
    ]
    world = json.loads((camp / "save" / "world-state.json").read_text())
    assert "clue-social" not in world["discovered_clue_ids"]
    deflect = dict(plan)
    deflect["decision_id"] = "d-deflect"
    deflect["disclosure_decisions"] = [{
        "outcome": "deflect", "npc_id": "npc-a", "fact_id": "fact-a",
        "clue_id": "clue-social", "deflect_id": "deflect-a",
    }]
    coc_director_apply.apply_plan(camp, deflect, investigator_id="inv1")
    assert coc_npc_state.get_npc_entry(camp, "npc-a")["deflections"] == [
        {"deflect_id": "deflect-a", "about": "fact-a"}
    ]


def test_post_rule_enrichment_targets_exact_npc_and_approves_authored_source():
    agenda = {
        "npc_id": "npc-a", "known_fact_ids": ["fact-a"],
        "revealable_fact_ids": ["fact-a"],
        "facts": [{"fact_id": "fact-a", "clue_id": "clue-a", "min_trust": 1}],
        "availability": {"status": "available"},
    }
    ctx = {
        "player_intent_rich": {"npc_interactions": [{
            "npc_id": "npc-a", "tactic": "build_rapport", "request_id": "r1",
            "fact_id": "fact-a",
        }]},
        "active_scene": {"npc_ids": ["npc-a", "npc-b"]},
        "active_scene_id": "scene-a",
        "npc_agendas": {"npcs": [agenda, {"npc_id": "npc-b"}]},
        "npc_state": {"psych": {"npc-a": {"trust": 0}}},
        "clue_graph": {"conclusions": [{"clues": [{
            "clue_id": "clue-a", "source_npc_ids": ["npc-a"],
        }]}]},
    }
    enriched = coc_npc_state.enrich_plan_after_rules(
        {"decision_id": "d1", "clue_policy": {"reveal": ["clue-a"],
         "delivery_kind": "npc_dialogue"}}, ctx,
        [{"request_id": "r1", "success": True}],
    )
    assert enriched["npc_effects"][0]["npc_id"] == "npc-a"
    assert enriched["disclosure_decisions"][0]["outcome"] == "reveal"


def test_post_rule_enrichment_multi_npc_ambiguity_fails_closed():
    ctx = {
        "player_intent_rich": {"npc_interactions": [{
            "npc_id": "", "tactic": "build_rapport", "request_id": "r1",
        }]},
        "active_scene": {"npc_ids": ["npc-a", "npc-b"]},
        "npc_agendas": {"npcs": [{"npc_id": "npc-a"}, {"npc_id": "npc-b"}]},
        "npc_state": {"psych": {}},
    }
    enriched = coc_npc_state.enrich_plan_after_rules(
        {"decision_id": "d1"}, ctx, [{"request_id": "r1", "success": True}]
    )
    assert enriched["npc_effects"] == []
    assert enriched["npc_interactions"] == []
    assert enriched["validation_warnings"][-1]["reason_code"] == "npc_target_missing_or_ambiguous"


def test_schedule_gate_overrides_default_availability():
    entry = coc_npc_state.effective_npc_entry({
        "known_fact_ids": ["fact-a"], "revealable_fact_ids": ["fact-a"],
        "availability": {"status": "available"},
        "schedule": [{"schedule_id": "night-only", "scene_ids": ["scene-a"],
                      "time_categories": ["overnight"], "status": "unavailable"}],
    }, {}, scene_id="scene-a", time_category="overnight")
    assert coc_npc_state.disclosure_decision(entry, "fact-a")["reason_code"] == "npc_unavailable"
    outside = coc_npc_state.effective_npc_entry({
        "known_fact_ids": ["fact-a"], "revealable_fact_ids": ["fact-a"],
        "availability": {"status": "available"},
        "schedule": [{"schedule_id": "scene-only", "scene_ids": ["scene-a"],
                      "status": "available"}],
    }, {}, scene_id="scene-b")
    assert outside["availability"] == {"status": "unavailable"}


def test_fact_metadata_does_not_grant_knowledge_or_revealability():
    authored = {
        "facts": [{"fact_id": "fact-a", "clue_id": "clue-a", "min_trust": 0}],
        "known_fact_ids": [], "revealable_fact_ids": [],
        "availability": {"status": "available"}, "schedule": [],
    }
    entry = coc_npc_state.effective_npc_entry(authored, {})
    assert entry["known_facts"] == []
    assert entry["revealable_facts"] == []
    assert coc_npc_state.disclosure_decision(entry, "fact-a")["reason_code"] == "fact_not_known"


def test_pure_request_fact_needs_no_rule_result_and_still_runs_disclosure_gate():
    agenda = {
        "npc_id": "npc-a", "known_fact_ids": ["fact-a"],
        "revealable_fact_ids": ["fact-a"], "disclosure_order": ["fact-a"],
        "facts": [{"fact_id": "fact-a", "clue_id": "clue-a", "min_trust": 0}],
        "availability": {"status": "available"}, "schedule": [],
    }
    ctx = {
        "player_intent_rich": {"npc_interactions": [{
            "npc_id": "npc-a", "tactic": "request_fact", "request_id": "ask-1",
            "fact_id": "fact-a",
        }]},
        "active_scene": {"npc_ids": ["npc-a"]}, "active_scene_id": "scene-a",
        "npc_agendas": {"npcs": [agenda]}, "npc_state": {"psych": {}},
        "clue_graph": {"conclusions": [{"clues": [{
            "clue_id": "clue-a", "delivery_kind": "npc_dialogue",
            "source_npc_ids": ["npc-a"],
        }]}]},
    }
    result = coc_npc_state.enrich_plan_after_rules(
        {"decision_id": "d-ask", "clue_policy": {
            "reveal": ["clue-a"], "delivery_kind": "npc_dialogue",
        }}, ctx, [],
    )
    assert result["npc_interactions"][0]["request_id"] == "ask-1"
    assert result["npc_effects"] == []
    assert result["disclosure_decisions"][0]["outcome"] == "reveal"
    assert not any(w.get("reason_code") == "interaction_request_binding_invalid"
                   for w in result["validation_warnings"])


def test_rule_bound_interaction_still_requires_exact_unique_result():
    interaction = [{
        "npc_id": "npc-a", "tactic": "build_rapport", "request_id": "r1",
        "skill": "Charm",
    }]
    assert coc_npc_state.derive_interaction_effects(interaction, []) == []
    assert coc_npc_state.interaction_result_bindings_valid(interaction, []) is False


def test_conflicting_overlapping_schedule_domains_are_rejected_and_fail_closed():
    agenda = {"npcs": [{
        "npc_id": "npc-a", "known_fact_ids": [], "revealable_fact_ids": [],
        "facts": [], "availability": {"status": "available"},
        "schedule": [
            {"schedule_id": "scene", "scene_ids": ["scene-a"], "status": "available"},
            {"schedule_id": "night", "time_categories": ["overnight"], "status": "unavailable"},
        ],
    }]}
    findings = coc_npc_state.validate_a21_contract(agenda, {"conclusions": []})
    assert any("overlapping" in finding["message"] for finding in findings)
    for schedule in (agenda["npcs"][0]["schedule"], list(reversed(agenda["npcs"][0]["schedule"]))):
        entry = coc_npc_state.effective_npc_entry(
            {**agenda["npcs"][0], "schedule": schedule}, {},
            scene_id="scene-a", time_category="overnight",
        )
        assert entry["availability"] == {"status": "unavailable"}


def test_persisted_availability_override_beats_authored_baseline_but_schedule_is_current_gate():
    authored = {
        "availability": {"status": "available"},
        "schedule": [{"schedule_id": "night", "scene_ids": ["scene-a"],
                      "status": "available"}],
    }
    persisted = {"availability": {"status": "unavailable"}}
    outside = coc_npc_state.effective_npc_entry(
        authored, persisted, scene_id="scene-b"
    )
    assert outside["availability"] == {"status": "unavailable"}
    inside = coc_npc_state.effective_npc_entry(
        authored, persisted, scene_id="scene-a"
    )
    assert inside["availability"] == {"status": "available"}


def test_duplicate_interaction_request_ids_fail_the_whole_interaction_set():
    interactions = [
        {"npc_id": "npc-a", "tactic": "build_rapport", "request_id": "same"},
        {"npc_id": "npc-b", "tactic": "intimidate", "request_id": "same"},
    ]
    results = [{"request_id": "same", "success": True}]
    assert coc_npc_state.derive_interaction_effects(interactions, results) == []


def test_duplicate_rule_result_binding_fails_the_whole_interaction_set():
    interactions = [
        {"npc_id": "npc-a", "tactic": "build_rapport", "request_id": "r1"},
        {"npc_id": "npc-b", "tactic": "intimidate", "request_id": "r2"},
    ]
    results = [
        {"request_id": "r1", "source_request_id": "r2", "success": True},
        {"request_id": "r2", "success": False},
    ]
    assert coc_npc_state.derive_interaction_effects(interactions, results) == []


def test_disclosure_order_selects_next_only_when_fact_is_omitted():
    agenda = {
        "npc_id": "npc-a", "known_fact_ids": ["fact-a", "fact-b"],
        "revealable_fact_ids": ["fact-a", "fact-b"],
        "disclosure_order": ["fact-b", "fact-a"],
        "facts": [
            {"fact_id": "fact-a", "clue_id": "clue-a", "min_trust": 0},
            {"fact_id": "fact-b", "clue_id": "clue-b", "min_trust": 0},
        ],
        "availability": {"status": "available"}, "schedule": [],
    }
    base_ctx = {
        "active_scene": {"npc_ids": ["npc-a"]}, "active_scene_id": "scene-a",
        "npc_agendas": {"npcs": [agenda]}, "npc_state": {"psych": {}},
        "clue_graph": {"conclusions": [{"clues": [
            {"clue_id": "clue-a", "source_npc_ids": ["npc-a"]},
            {"clue_id": "clue-b", "source_npc_ids": ["npc-a"]},
        ]}]},
    }
    omitted = dict(base_ctx)
    omitted["player_intent_rich"] = {"npc_interactions": [{
        "npc_id": "npc-a", "tactic": "build_rapport", "request_id": "r1",
    }]}
    result = coc_npc_state.enrich_plan_after_rules(
        {"decision_id": "d1"}, omitted, [{"request_id": "r1", "success": True}]
    )
    assert result["disclosure_decisions"][0]["fact_id"] == "fact-b"

    explicit = dict(base_ctx)
    explicit["player_intent_rich"] = {"npc_interactions": [{
        "npc_id": "npc-a", "tactic": "build_rapport", "request_id": "r2",
        "fact_id": "not-authored",
    }]}
    result = coc_npc_state.enrich_plan_after_rules(
        {"decision_id": "d2"}, explicit, [{"request_id": "r2", "success": True}]
    )
    assert result["disclosure_decisions"][0]["reason_code"] == "fact_not_authored"
    assert result["disclosure_decisions"][0]["fact_id"] == "not-authored"


def test_apply_revalidates_social_reveal_against_canonical_disk_contract(tmp_path):
    camp = _campaign(tmp_path)
    scenario = camp / "scenario"
    scenario.mkdir()
    (scenario / "npc-agendas.json").write_text(json.dumps({"npcs": [{
        "npc_id": "npc-a", "agenda": "structured",
        "known_fact_ids": ["fact-a"], "revealable_fact_ids": ["fact-a"],
        "disclosure_order": ["fact-a"],
        "facts": [{"fact_id": "fact-a", "clue_id": "clue-a", "min_trust": 0}],
        "availability": {"status": "available"}, "schedule": [],
    }]}))
    (scenario / "clue-graph.json").write_text(json.dumps({"conclusions": [{
        "clues": [{"clue_id": "clue-a", "delivery_kind": "npc_dialogue",
                   "source_npc_ids": ["npc-a"]}]
    }]}))
    base = {
        "decision_id": "d-forged", "scene_action": "CHARACTER",
        "clue_policy": {"reveal": ["clue-a"], "delivery_kind": "npc_dialogue"},
        "pressure_moves": [], "memory_writes": [], "rule_signals": {},
    }
    for forged in (
        {"outcome": "reveal", "npc_id": "npc-b", "fact_id": "fact-a", "clue_id": "clue-a"},
        {"outcome": "reveal", "npc_id": "npc-a", "fact_id": "fact-x", "clue_id": "clue-a"},
        {"outcome": "reveal", "npc_id": "npc-a", "fact_id": "fact-a", "clue_id": "clue-x"},
    ):
        plan = {**base, "decision_id": base["decision_id"] + forged["npc_id"] + forged["fact_id"],
                "disclosure_decisions": [forged]}
        events = coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")
        assert not any(e.get("event_type") == "clue_reveal" for e in events)

    duplicate = {**base, "decision_id": "d-duplicate", "disclosure_decisions": [
        {"outcome": "reveal", "npc_id": "npc-a", "fact_id": "fact-a", "clue_id": "clue-a"},
        {"outcome": "reveal", "npc_id": "npc-a", "fact_id": "fact-a", "clue_id": "clue-a"},
    ]}
    events = coc_director_apply.apply_plan(camp, duplicate, investigator_id="inv1")
    assert not any(e.get("event_type") == "clue_reveal" for e in events)
