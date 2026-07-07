"""Tests for coc_storylets: deterministic storylet selection and anti-repeat ledger."""
import importlib.util
import random
from pathlib import Path


def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, rel)
    m = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(m)
    return m


coc_storylets = _load("coc_storylets", "plugins/coc-keeper/scripts/coc_storylets.py")


def _ctx(tmp_path, horror_stage="wrongness", tension="medium", scene_type="investigation"):
    camp = tmp_path / "campaigns" / "storylet-test"
    (camp / "save").mkdir(parents=True)
    return {
        "campaign_dir": camp,
        "active_scene_id": "scene-1",
        "active_scene": {
            "scene_id": "scene-1",
            "scene_type": scene_type,
            "available_clues": ["clue-a", "clue-b"],
            "npc_ids": ["npc-witness"],
            "tone": ["damp", "quiet"],
        },
        "world_state": {"discovered_clue_ids": []},
        "rule_signals": {
            "last_roll_fumble": False,
            "stalled_turns": 0,
            "tension_clock": {"tension_level": tension},
        },
        "pacing_map": {"pacing_curve": [
            {"scene_id": "scene-1", "tension_target": tension, "horror_stage": horror_stage}
        ]},
        "threat_fronts": {"fronts": [{
            "front_id": "front-cult",
            "clocks": [{"clock_id": "cult-alert", "segments": 6, "current_segments": 1}],
        }]},
    }


def test_storylet_library_has_many_conflict_leveled_events():
    library = coc_storylets.load_storylet_library()
    storylets = library["storylets"]
    assert len(storylets) >= 50
    assert {"color", "low", "medium", "high", "climax"} <= {s["conflict_level"] for s in storylets}
    assert all(any(s.get("serves", {}).get(k) for k in coc_storylets.SERVICE_KEYS) for s in storylets)


def test_select_storylet_is_seed_deterministic(tmp_path):
    ctx = _ctx(tmp_path, horror_stage="pattern", tension="high")
    clue_policy = {"reveal": ["clue-a"], "fallback_routes": [], "leads": []}
    a = coc_storylets.select_storylet(ctx, "PRESSURE", clue_policy, rng=random.Random(7))
    b = coc_storylets.select_storylet(ctx, "PRESSURE", clue_policy, rng=random.Random(7))
    assert a == b
    assert a["selected_storylet_id"]


def test_ordinary_stage_blocks_high_and_climax(tmp_path):
    ctx = _ctx(tmp_path, horror_stage="ordinary", tension="climax")
    selected = [
        coc_storylets.select_storylet(ctx, "PRESSURE", {"reveal": ["clue-a"]}, rng=random.Random(i))
        for i in range(25)
    ]
    assert selected
    assert all(coc_storylets.CONFLICT_RANK[s["conflict_level"]] <= coc_storylets.CONFLICT_RANK["low"] for s in selected)


def test_ledger_prevents_exact_storylet_repeat(tmp_path):
    ctx = _ctx(tmp_path, horror_stage="pattern", tension="high")
    first = coc_storylets.select_storylet(ctx, "PRESSURE", {"reveal": ["clue-a"]}, rng=random.Random(11))
    ledger = coc_storylets.record_storylet_use(coc_storylets.read_storylet_ledger(ctx["campaign_dir"]), first, turn_number=1)
    second = coc_storylets.select_storylet(ctx, "PRESSURE", {"reveal": ["clue-a"]}, rng=random.Random(11), ledger=ledger)
    assert first["selected_storylet_id"] != second["selected_storylet_id"]


def test_storylet_binding_uses_scene_entities_only(tmp_path):
    ctx = _ctx(tmp_path, horror_stage="pattern", tension="high")
    s = coc_storylets.select_storylet(ctx, "CHARACTER", {"reveal": ["clue-a"]}, rng=random.Random(3))
    bound = s["bound_entities"]
    assert bound["location_id"] == "scene-1"
    assert bound["npc_id"] in (None, "npc-witness")
    assert bound["clue_id"] in (None, "clue-a", "clue-b")
    assert bound["front_id"] in (None, "front-cult")


def test_enrich_director_plan_adds_storylet_contract(tmp_path):
    ctx = _ctx(tmp_path, horror_stage="wrongness", tension="medium")
    plan = {
        "scene_action": "PRESSURE",
        "clue_policy": {"reveal": ["clue-a"], "fallback_routes": [], "leads": []},
        "narrative_directives": {"must_include": []},
    }
    enriched = coc_storylets.enrich_director_plan(ctx, plan, rng=random.Random(5))
    assert enriched["storylet"]["selected_storylet_id"]
    assert "storylet_contract" in enriched["narrative_directives"]
    assert "storylet_conflict_level" in enriched["narrative_directives"]
