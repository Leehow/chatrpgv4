"""R-2 NarrationEnvelope: narrator material must never carry keeper secret prose."""
from __future__ import annotations

import importlib.util
import json
import random
from pathlib import Path

SCRIPT_DIR = Path("plugins/coc-keeper/scripts")


def _load(name: str, rel: str):
    spec = importlib.util.spec_from_file_location(name, rel)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


cnc = _load("coc_narration_contract", str(SCRIPT_DIR / "coc_narration_contract.py"))
director = _load("coc_story_director", str(SCRIPT_DIR / "coc_story_director.py"))

# Distinct prose fragments that must never appear in narrator-facing JSON.
SECRET_PROSE_FRAGMENTS = [
    "STR 100 CON 100 DEX 15 INT 25 POW 30; HP 100; tentacle slash",
    "probes and discards humans out of curiosity about these fragile successors",
    "White Friday disaster kills ~10,000; only the attribution of blame varies",
    "in daylight the entity suffers -20% to all skills",
    "10D6 damage of a triggered avalanche",
    "Austrian demolition work blew away the ice seal over the shaft",
    "at 20 HP or below the entity withdraws to the shaft to heal",
    "high command will not believe them; they will be separated",
]

PROSE_SECRETS = [
    (
        "secret-polyp-horror-full-stat-block: STR 100 CON 100 DEX 15 INT 25 POW 30; "
        "HP 100; tentacle slash 60% Lethality 50% + knock down; wind blast 99%; "
        "ignores armor; SAN 1D6/1D12; retreats at 20 HP. Full OGC data in "
        "rules-json/the-white-war.json."
    ),
    (
        "secret-entity-motive-is-curiosity: the Polyp Horror probes and discards "
        "humans out of curiosity about these fragile successors to the Great Race, "
        "not hunger — but its examination is as lethal as malice."
    ),
    (
        "secret-white-friday-is-inevitable: regardless of the patrol's choices, on "
        "13 December 1916 the White Friday disaster kills ~10,000; only the "
        "attribution of blame varies."
    ),
    (
        "secret-entity-fears-daylight: in daylight the entity suffers -20% to all "
        "skills, holds shadow, and needs 1 round to reactivate wind — this is the "
        "key to any dawn counterstroke."
    ),
    (
        "secret-avalanche-is-lethal-to-entity: the entity's semi-material nature "
        "does not protect it from the 10D6 damage of a triggered avalanche; the "
        "snow overhang above the shelter is the obvious environmental weapon."
    ),
    (
        "secret-austrians-triggered-release: the Austrian demolition work blew "
        "away the ice seal over the shaft and released the entity; their "
        "subsequent fate is evidence of what they awoke."
    ),
    (
        "secret-entity-retreats-at-20hp: at 20 HP or below the entity withdraws "
        "to the shaft to heal, killing only those in its direct path out."
    ),
    (
        "secret-truth-unbelieved: if survivors insist on the truth, high command "
        "will not believe them; they will be separated and quietly transferred "
        "to logistics roles."
    ),
]


def _assert_no_secret_prose(payload: object) -> None:
    blob = json.dumps(payload, ensure_ascii=False)
    for fragment in SECRET_PROSE_FRAGMENTS:
        assert fragment not in blob, f"secret prose leaked into narrator material: {fragment!r}"


def _make_campaign(tmp_path: Path, secrets: list) -> tuple[Path, Path]:
    camp = tmp_path / "campaigns" / "envelope-r2"
    (camp / "save" / "investigator-state").mkdir(parents=True)
    (camp / "scenario").mkdir(parents=True)
    (camp / "save" / "investigator-state" / "inv1.json").write_text(json.dumps({
        "schema_version": 1,
        "investigator_id": "inv1",
        "hp": 12,
        "san": 55,
        "mp": 11,
        "luck": 55,
        "conditions": [],
        "indefinite_insanity": False,
        "temp_insanity_active": False,
        "bout_active": False,
    }))
    (camp / "save" / "world-state.json").write_text(json.dumps({
        "schema_version": 1,
        "campaign_id": "envelope-r2",
        "active_scene_id": "scene-1",
        "discovered_clue_ids": [],
        "scene_history": [],
        "flags": {},
    }))
    (camp / "save" / "pacing-state.json").write_text(json.dumps({
        "schema_version": 1,
        "tension_level": 2,
        "turns_in_scene": 0,
        "stalled_turns": 0,
    }))
    (camp / "scenario" / "module-meta.json").write_text(json.dumps({
        "schema_version": 1,
        "scenario_id": "envelope-r2",
        "content_flags": [],
    }))
    (camp / "scenario" / "story-graph.json").write_text(json.dumps({
        "scenes": [{
            "scene_id": "scene-1",
            "scene_type": "investigation",
            "dramatic_question": "能否找到线索？",
            "entry_conditions": [],
            "exit_conditions": ["clue-1 discovered"],
            "available_clues": ["clue-1"],
            "npc_ids": [],
            "pressure_moves": [],
            "tone": ["tense"],
            "allowed_improvisation": [],
        }],
    }))
    (camp / "scenario" / "clue-graph.json").write_text(json.dumps({
        "conclusions": [{
            "conclusion_id": "concl-1",
            "importance": "critical",
            "minimum_routes": 3,
            "clues": [
                {
                    "clue_id": "clue-1",
                    "delivery": "investigate",
                    "visibility": "player-safe",
                    "player_safe_summary": "门框上有新鲜刮痕",
                },
                {"clue_id": "clue-1b", "delivery": "social", "visibility": "player-safe"},
                {"clue_id": "clue-1c", "delivery": "spot hidden", "visibility": "player-safe"},
            ],
            "fallback_policy": "move clue if 2 missed",
        }],
    }))
    (camp / "scenario" / "npc-agendas.json").write_text(json.dumps({"npcs": []}))
    (camp / "scenario" / "threat-fronts.json").write_text(json.dumps({"fronts": []}))
    (camp / "scenario" / "pacing-map.json").write_text(json.dumps({"pacing_curve": []}))
    (camp / "scenario" / "improvisation-boundaries.json").write_text(json.dumps({
        "invent_allowed": ["minor weather"],
        "never_invent": ["new Mythos entities"],
        "keeper_secrets": secrets,
    }))
    char_dir = tmp_path / "investigators" / "inv1"
    char_dir.mkdir(parents=True)
    (char_dir / "character.json").write_text(json.dumps({
        "schema_version": 1,
        "id": "inv1",
        "occupation": "Antiquarian",
        "era": "1920s",
        "characteristics": {
            "STR": 60, "CON": 55, "SIZ": 65, "DEX": 50, "APP": 45,
            "INT": 70, "POW": 55, "EDU": 75, "LUCK": 55,
        },
        "derived": {"HP": 12, "MP": 11, "SAN": 55, "MOV": 7, "damage_bonus": "0", "build": 0},
        "skills": {"Credit Rating": 50, "Spot Hidden": 60, "Psychology": 55},
        "backstory": {},
    }))
    return camp, char_dir / "character.json"


def test_normalize_keeper_secret_refs_strips_prose_keeps_ids():
    refs = cnc.normalize_keeper_secret_refs(PROSE_SECRETS)
    assert len(refs) == len(PROSE_SECRETS)
    assert all(set(r.keys()) == {"id", "category"} for r in refs)
    assert refs[0]["id"] == "secret-polyp-horror-full-stat-block"
    assert refs[0]["category"] == "keeper_secret"
    _assert_no_secret_prose(refs)


def test_normalize_assigns_stable_positional_ids_for_bare_prose():
    refs = cnc.normalize_keeper_secret_refs([
        "the body is under the floorboards and the ward fails at dawn",
        "dominate requires a POW contest the player must never hear about",
    ])
    assert [r["id"] for r in refs] == ["secret_001", "secret_002"]
    _assert_no_secret_prose(refs)


def test_director_plan_must_not_reveal_is_id_refs_only(tmp_path):
    camp, char_path = _make_campaign(tmp_path, PROSE_SECRETS)
    ctx = director.build_director_context(
        campaign_dir=camp,
        character_path=char_path,
        investigator_id="inv1",
        player_intent="我检查门框",
        player_intent_class="investigate",
        rng=random.Random(42),
    )
    plan = director.generate_director_plan(ctx, decision_id="r2-plan")
    mnr = plan["narrative_directives"]["must_not_reveal"]
    assert isinstance(mnr, list) and mnr
    assert all(isinstance(item, dict) and set(item.keys()) == {"id", "category"} for item in mnr)
    assert {item["id"] for item in mnr} >= {
        "secret-polyp-horror-full-stat-block",
        "secret-entity-motive-is-curiosity",
    }
    withhold = plan["clue_policy"]["withhold"]
    assert all(isinstance(item, str) for item in withhold)
    assert "secret-polyp-horror-full-stat-block" in withhold
    _assert_no_secret_prose(plan["narrative_directives"])
    _assert_no_secret_prose(plan["clue_policy"])


def test_narration_envelope_never_contains_secret_prose(tmp_path):
    camp, char_path = _make_campaign(tmp_path, PROSE_SECRETS)
    ctx = director.build_director_context(
        campaign_dir=camp,
        character_path=char_path,
        investigator_id="inv1",
        player_intent="我检查门框",
        player_intent_class="investigate",
        rng=random.Random(42),
    )
    plan = director.generate_director_plan(ctx, decision_id="r2-envelope")
    envelope = cnc.build_narration_envelope(plan)
    assert envelope["must_not_reveal"]
    assert all(set(item.keys()) == {"id", "category"} for item in envelope["must_not_reveal"])
    # Approved reveal anchors (player-safe) may appear; secret prose must not.
    assert "门框上有新鲜刮痕" in json.dumps(envelope, ensure_ascii=False) or not plan[
        "narrative_directives"
    ].get("must_include")
    _assert_no_secret_prose(envelope)


def test_assert_narration_ready_accepts_id_ref_must_not_reveal(tmp_path):
    scenario_dir = tmp_path / "scenario"
    scenario_dir.mkdir()
    (scenario_dir / "improvisation-boundaries.json").write_text(json.dumps({
        "invent_allowed": [],
        "never_invent": [],
        "keeper_secrets": PROSE_SECRETS,
    }))
    refs = cnc.normalize_keeper_secret_refs(PROSE_SECRETS)
    plan = {
        "decision_id": "d1",
        "scene_action": "REVEAL",
        "dramatic_question": "Will they learn too much?",
        "narrative_directives": {
            "tone": ["eerie"],
            "must_include": ["a cold draft under the door"],
            "must_not_reveal": refs,
            "improvisation_allowed": [],
            "horror_escalation_stage": "wrongness",
            "player_facing_style": cnc.player_facing_style_contract("zh-Hans"),
        },
        "clue_policy": {
            "reveal": ["clue-public-1"],
            "withhold": [r["id"] for r in refs],
            "fallback_routes": [],
            "clue_type": "obscured",
        },
        "rules_requests": [],
        "handoff": "narration",
        "rationale": "test",
    }
    findings = cnc.assert_narration_ready(plan, scenario_dir)
    assert findings["must_not_reveal_populated"]["passed"] is True
    assert findings["clue_policy_no_secret_leak"]["passed"] is True
    _assert_no_secret_prose(plan["narrative_directives"]["must_not_reveal"])
