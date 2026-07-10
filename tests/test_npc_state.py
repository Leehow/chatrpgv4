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
