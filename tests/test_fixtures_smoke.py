"""Smoke test using sanitized fixtures — verifies director works against real module structure.
Replaces the .coc/-based v7 smoke for CI (fixtures are git-tracked, no copyright content)."""
import importlib.util
import json
import random
from pathlib import Path

import pytest

FIXTURE_DIR = Path(__file__).parent / "fixtures" / "story-director" / "haunting"


def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, rel)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


director = _load("director", "plugins/coc-keeper/scripts/coc_story_director.py")
harness = _load("harness", "plugins/coc-keeper/scripts/coc_story_harness.py")


def _build_campaign_from_fixture(tmp_path):
    """Copy fixture scenario into a temp campaign dir + minimal save state."""
    camp = tmp_path / "campaigns" / "fixture-test"
    scn = camp / "scenario"
    save = camp / "save"
    scn.mkdir(parents=True)
    save.mkdir()
    (save / "investigator-state").mkdir()
    # copy 7 scenario files
    for f in FIXTURE_DIR.glob("*.json"):
        (scn / f.name).write_text(f.read_text())
    # minimal save state
    (save / "world-state.json").write_text(json.dumps({
        "schema_version": 1, "campaign_id": "fixture-test", "scenario_id": "haunting-fixture",
        "active_scene_id": "client-briefing", "discovered_clue_ids": [], "major_decisions": []}))
    (save / "pacing-state.json").write_text(json.dumps({
        "schema_version": 1, "tension_level": "low", "lethal_chances_used": 0,
        "recent_intent_classes": [], "turn_number": 1, "luck_spent_last": 0}))
    (save / "flags.json").write_text(json.dumps({"schema_version": 1, "clues_found": {}, "decisions": []}))
    (save / "investigator-state" / "inv1.json").write_text(json.dumps({
        "schema_version": 1, "campaign_id": "fixture-test", "investigator_id": "inv1",
        "current_hp": 12, "current_san": 55, "current_mp": 11, "conditions": [], "skill_checks_earned": []}))
    # character
    char_dir = tmp_path / "investigators" / "inv1"
    char_dir.mkdir(parents=True)
    (char_dir / "character.json").write_text(json.dumps({
        "schema_version": 1, "id": "inv1", "occupation": "Antiquarian", "era": "1920s",
        "characteristics": {"STR": 60, "CON": 55, "SIZ": 65, "DEX": 50, "APP": 45, "INT": 70, "POW": 55, "EDU": 75, "LUCK": 55},
        "derived": {"HP": 12, "MP": 11, "SAN": 55, "MOV": 7, "damage_bonus": "0", "build": 0},
        "skills": {"Credit Rating": 50, "Spot Hidden": 60, "Library Use": 55, "Psychology": 55},
        "backstory": {}}))
    return camp, char_dir / "character.json"


@pytest.mark.parametrize("profile_name", ["01-investigate", "02-stuck", "03-fumble"])
def test_fixture_profile_produces_valid_plan(tmp_path, profile_name):
    """Each fixture profile produces a valid DirectorPlan through the director."""
    camp, char_path = _build_campaign_from_fixture(tmp_path)
    profile = json.loads((FIXTURE_DIR / "profiles" / f"{profile_name}.json").read_text())
    rng = random.Random(profile.get("rng_seed", 42))
    ctx = director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent=profile["player_intent"],
        player_intent_class=profile.get("player_intent_class", "investigate"),
        rng=rng)
    for k, v in profile.get("signal_overrides", {}).items():
        ctx["rule_signals"][k] = v
    plan = director.generate_director_plan(ctx, decision_id=profile_name)
    # assertions
    assert plan["scene_action"] in director.ACTIONS
    assert plan["narrative_directives"]["must_not_reveal"]  # secrets populated
    # keeper secrets not leaked into reveal (must_not_reveal is {id, category})
    reveal = set(plan["clue_policy"].get("reveal", []))
    secrets = {
        item["id"] if isinstance(item, dict) else item
        for item in plan["narrative_directives"]["must_not_reveal"]
    }
    assert reveal.isdisjoint(secrets)
    # harness assertions pass
    findings = harness.assert_plan(plan)
    hard_failures = [k for k, f in findings.items() if not f["passed"]]
    assert hard_failures == [], f"{profile_name} failed: {hard_failures}"


def test_fixture_investigate_reveals_clue(tmp_path):
    """Investigation profile should produce REVEAL with a clue from the scene."""
    camp, char_path = _build_campaign_from_fixture(tmp_path)
    # active scene is client-briefing which has clue-job-briefing
    ctx = director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="查档案", player_intent_class="investigate", rng=random.Random(42))
    plan = director.generate_director_plan(ctx, "fixture-investigate")
    assert plan["scene_action"] == "REVEAL"
    assert len(plan["clue_policy"]["reveal"]) >= 1


def test_fixture_stuck_recovers(tmp_path):
    """Stuck profile (stalled_turns=3) should trigger RECOVER."""
    camp, char_path = _build_campaign_from_fixture(tmp_path)
    ctx = director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="不知道", player_intent_class="stuck", rng=random.Random(42))
    ctx["rule_signals"]["stalled_turns"] = 3
    plan = director.generate_director_plan(ctx, "fixture-stuck")
    assert plan["scene_action"] == "RECOVER"
