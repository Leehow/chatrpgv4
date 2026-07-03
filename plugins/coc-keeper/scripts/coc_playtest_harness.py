#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from coc_playtest_audit import generate_rulebook_audit
from coc_playtest_report import generate_battle_report, generate_evaluation_report


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def _write_jsonl(path: Path, events: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(json.dumps(event) for event in events) + "\n", encoding="utf-8")


def create_rulebook_smoke_run(root: Path, run_id: str = "v1-rulebook-smoke") -> Path:
    run_dir = root / ".coc" / "playtests" / run_id
    campaign_dir = run_dir / "sandbox" / ".coc" / "campaigns" / run_id
    scenario_dir = campaign_dir / "scenario"
    investigator_id = "ada-king-rulebook"
    investigator_dir = run_dir / "sandbox" / ".coc" / "investigators" / investigator_id

    _write_json(run_dir / "playtest.json", {
        "run_id": run_id,
        "campaign_id": run_id,
        "campaign_title": "The Haunting Rulebook Smoke",
        "scenario": "The Haunting",
        "scenario_id": "the-haunting",
        "era": "1920s",
        "dice_mode": "codex",
        "spoiler_policy": "warn_before_reveal",
        "player_profile": "careful_investigator",
        "subsystems_covered": ["investigation", "sanity"],
        "scores": {
            "immersion": 4,
            "rules_accuracy": 4,
            "state_integrity": 4,
            "spoiler_safety": 4,
            "meta_quality": 4,
            "pacing": 4,
            "recovery": 4,
        },
        "passed_test_cases": [
            "rulebook_conversation_loop",
            "roll_protocol",
            "pushed_roll",
            "clue_flow",
            "sanity_prompt",
            "session_ending",
        ],
        "failed_test_cases": [],
        "recommended_fixes": [],
        "regression_tests": ["Rulebook audit must pass for the rulebook smoke harness."],
    })
    _write_json(campaign_dir / "campaign.json", {
        "schema_version": 1,
        "campaign_id": run_id,
        "title": "The Haunting Rulebook Smoke",
        "mode": "keeper",
        "status": "active",
        "era": "1920s",
        "active_scenario_id": "the-haunting",
        "active_scene_id": "knott-hiring",
        "dice_mode": "codex",
        "spoiler_policy": "warn_before_reveal",
        "active_subsystem": "investigation",
    })
    _write_json(campaign_dir / "party.json", {
        "campaign_id": run_id,
        "investigator_ids": [investigator_id],
        "active_investigator_ids": [investigator_id],
    })
    _write_json(scenario_dir / "scenario.json", {
        "schema_version": 1,
        "scenario_id": "the-haunting",
        "title": "The Haunting",
        "module_source": "pdf/Call Of Cthulhu Keeper Rulebook 40th Anniversary (Sandy Petersen).pdf",
        "summary": "A landlord hires investigators to learn why tenants keep fleeing the Corbitt House.",
        "player_safe_summary": "Mr. Knott asks Ada King to inspect a supposedly haunted Boston house.",
        "opening_scene": "Mr. Knott meets Ada in his office and asks her to investigate the Corbitt House.",
        "current_phase": "opening_investigation",
    })
    _write_json(scenario_dir / "clues.json", [
        {
            "id": "clue-chapel",
            "summary": "Newspaper research links Walter Corbitt to the Chapel of Contemplation.",
            "route": "Library Use at the clipping files.",
        },
        {
            "id": "clue-lawsuit",
            "summary": "Neighbors sued Walter Corbitt before his death.",
            "route": "Public records or newspaper archives.",
        },
    ])
    _write_json(scenario_dir / "locations.json", [
        {"id": "location-knott-office", "name": "Mr. Knott's office", "purpose": "opening hook"},
        {"id": "location-clipping-files", "name": "Boston Globe clipping files", "purpose": "early research"},
    ])
    _write_json(scenario_dir / "npcs.json", [
        {"id": "npc-knott", "name": "Mr. Knott", "role": "landlord and client"},
    ])
    _write_json(scenario_dir / "timeline.json", [
        {"id": "past-lawsuit", "summary": "Neighbors sued Walter Corbitt over disturbing events."},
        {"id": "past-chapel", "summary": "The Chapel of Contemplation was closed after a police raid."},
    ])
    _write_json(scenario_dir / "handouts.json", [])
    _write_json(scenario_dir / "keeper-secrets.json", [])

    _write_json(investigator_dir / "character.json", {
        "schema_version": 1,
        "id": investigator_id,
        "name": "Ada King",
        "occupation": "Antiquarian",
        "era": "1920s",
        "characteristics": {
            "STR": 60,
            "CON": 55,
            "SIZ": 65,
            "DEX": 50,
            "APP": 45,
            "INT": 70,
            "POW": 55,
            "EDU": 75,
        },
        "derived": {
            "HP": 12,
            "MP": 11,
            "SAN": 55,
            "MOV": 8,
            "damage_bonus": "0",
            "build": 0,
        },
        "skills": {
            "Library Use": 60,
            "Spot Hidden": 55,
            "Psychology": 40,
        },
    })

    _write_jsonl(run_dir / "transcript.jsonl", [
        {
            "turn": 1,
            "role": "keeper_under_test",
            "speaker": "KP",
            "mode": "play",
            "text": "Mr. Knott says the Corbitt House has a reputation, but he wants facts before losing more tenants.",
        },
        {
            "turn": 2,
            "role": "player_simulator",
            "speaker": "Ada King",
            "mode": "play",
            "intent": "ask terms and recent incidents",
            "text": "I ask Mr. Knott what happened to the last tenants and what he expects me to prove.",
        },
        {
            "turn": 3,
            "role": "keeper_under_test",
            "speaker": "KP",
            "mode": "play",
            "ruling": "no_roll_needed",
            "text": "No roll is needed for that. Knott explains the tenants reported bad dreams, illness, and a presence in the house.",
        },
        {
            "turn": 4,
            "role": "player_simulator",
            "speaker": "Ada King",
            "mode": "play",
            "intent": "research public history before entering the house",
            "text": "Before visiting the house, I search newspaper clippings for Walter Corbitt and the address.",
        },
        {
            "turn": 5,
            "role": "keeper_under_test",
            "speaker": "KP",
            "mode": "play",
            "ruling": "library_use_regular",
            "text": "That is a Library Use roll at Regular difficulty because the archives are public but poorly indexed.",
        },
        {
            "turn": 6,
            "role": "system",
            "speaker": "system",
            "mode": "roll",
            "text": "Library Use 42 vs 60 -> regular_success.",
        },
        {
            "turn": 7,
            "role": "keeper_under_test",
            "speaker": "KP",
            "mode": "play",
            "text": "You find a clipping about lawsuits against Walter Corbitt and another about the Chapel of Contemplation.",
        },
        {
            "turn": 8,
            "role": "player_simulator",
            "speaker": "Ada King",
            "mode": "play",
            "intent": "find any hidden symbol before leaving",
            "text": "Before I leave the archive desk, I check the underside and drawer edges for marks or symbols.",
        },
        {
            "turn": 9,
            "role": "keeper_under_test",
            "speaker": "KP",
            "mode": "play",
            "ruling": "spot_hidden_regular",
            "text": "Make a Spot Hidden roll at Regular difficulty. The desk is cluttered, but the marks would be visible if you are thorough.",
        },
        {
            "turn": 10,
            "role": "system",
            "speaker": "system",
            "mode": "roll",
            "text": "Spot Hidden 83 vs 55 -> failure.",
        },
        {
            "turn": 11,
            "role": "player_simulator",
            "speaker": "Ada King",
            "mode": "play",
            "intent": "push failed search",
            "text": "I want to push it. I spend ten more minutes checking the desk underside and accept that someone may return.",
        },
        {
            "turn": 12,
            "role": "keeper_under_test",
            "speaker": "KP",
            "mode": "play",
            "ruling": "pushed_spot_hidden",
            "text": "That justifies a pushed roll. If you fail, you hear footsteps and lose the chance to search quietly.",
        },
        {
            "turn": 13,
            "role": "system",
            "speaker": "system",
            "mode": "roll",
            "text": "Pushed Spot Hidden 34 vs 55 -> regular_success.",
        },
        {
            "turn": 14,
            "role": "keeper_under_test",
            "speaker": "KP",
            "mode": "play",
            "text": "You find a faint chapel sigil scratched under the desk, confirming the newspaper clue is worth pursuing.",
        },
        {
            "turn": 15,
            "role": "player_simulator",
            "speaker": "Ada King",
            "mode": "play",
            "intent": "inspect disturbing stain at archive table",
            "text": "The name gives me a chill. I look closer at the brown stain on the archive table.",
        },
        {
            "turn": 16,
            "role": "keeper_under_test",
            "speaker": "KP",
            "mode": "play",
            "ruling": "san_roll",
            "text": "The stain looks disturbingly fresh and evokes a sudden image of a cellar. Make a SAN roll.",
        },
        {
            "turn": 17,
            "role": "system",
            "speaker": "system",
            "mode": "roll",
            "text": "SAN 31 vs 55 -> success, lose 0 SAN.",
        },
        {
            "turn": 18,
            "role": "keeper_under_test",
            "speaker": "KP",
            "mode": "play",
            "text": "We end with Ada holding two leads: the Chapel of Contemplation and the Corbitt House itself.",
        },
    ])

    _write_jsonl(campaign_dir / "logs" / "rolls.jsonl", [
        {
            "type": "roll",
            "actor": investigator_id,
            "payload": {
                "skill": "Library Use",
                "goal": "find an early public clue about Walter Corbitt and the house",
                "target": 60,
                "effective_target": 60,
                "difficulty": "regular",
                "difficulty_rationale": "The clipping files are public but poorly indexed.",
                "roll": 42,
                "outcome": "regular_success",
                "push_eligible": False,
                "failure_consequence": "Ada would lose time and need another route to the Chapel clue.",
                "skill_check_earned": True,
            },
        },
        {
            "type": "roll",
            "actor": investigator_id,
            "payload": {
                "skill": "Spot Hidden",
                "goal": "notice a hidden chapel sigil before leaving the archive desk",
                "target": 55,
                "effective_target": 55,
                "difficulty": "regular",
                "difficulty_rationale": "The desk is cluttered, but the sigil is visible with a careful search.",
                "roll": 83,
                "outcome": "failure",
                "push_eligible": True,
                "failure_consequence": "Ada leaves without confirming the Chapel lead from physical evidence.",
                "skill_check_earned": False,
            },
        },
        {
            "type": "roll",
            "actor": investigator_id,
            "payload": {
                "skill": "Spot Hidden",
                "goal": "notice a hidden chapel sigil before leaving the archive desk",
                "target": 55,
                "effective_target": 55,
                "difficulty": "regular",
                "difficulty_rationale": "The pushed roll keeps the same difficulty after Ada spends more time.",
                "roll": 34,
                "outcome": "regular_success",
                "pushed": True,
                "push_justification": "Ada spends ten more minutes checking the desk underside and accepts that someone may return.",
                "foreshadowed_failure": "If this fails, Ada hears footsteps and loses the chance to search quietly.",
                "failure_consequence": "Ada would be interrupted by footsteps from the hall.",
                "skill_check_earned": True,
            },
        },
        {
            "type": "sanity",
            "actor": investigator_id,
            "payload": {
                "skill": "SAN",
                "goal": "test Ada's reaction to a disturbing omen",
                "target": 55,
                "effective_target": 55,
                "difficulty": "sanity",
                "difficulty_rationale": "SAN rolls use current SAN and no bonus or penalty dice.",
                "roll": 31,
                "outcome": "success",
                "failure_consequence": "Ada would lose 1D3 SAN and freeze for a moment.",
                "san_loss": 0,
            },
        },
    ])
    _write_jsonl(campaign_dir / "logs" / "events.jsonl", [
        {
            "type": "scene",
            "actor": "keeper_under_test",
            "payload": {"scene_id": "knott-hiring", "summary": "Mr. Knott hired Ada to investigate the Corbitt House."},
        },
        {
            "type": "decision",
            "actor": investigator_id,
            "payload": {"summary": "Ada chose to research public history before entering the house."},
        },
        {
            "type": "decision",
            "actor": investigator_id,
            "payload": {"summary": "Ada chose to push the failed Spot Hidden roll by spending extra time at the archive desk."},
        },
        {
            "type": "clue",
            "actor": investigator_id,
            "payload": {"clue_id": "clue-chapel", "summary": "Ada found the Chapel of Contemplation lead."},
        },
        {
            "type": "clue",
            "actor": investigator_id,
            "payload": {"clue_id": "clue-chapel-sigil", "summary": "Ada confirmed the Chapel lead by finding a hidden sigil under the archive desk."},
        },
        {
            "type": "sanity",
            "actor": investigator_id,
            "payload": {"summary": "Ada passed the SAN roll and lost no SAN."},
        },
        {
            "type": "session_ending",
            "actor": "keeper_under_test",
            "payload": {"summary": "Session ended with Ada planning to visit the Corbitt House next."},
        },
    ])
    _write_jsonl(campaign_dir / "memory" / "session-summaries.jsonl", [
        {
            "session_id": "session-1",
            "summary": "Ada accepted Mr. Knott's job, researched Walter Corbitt, pushed a careful search to confirm the Chapel lead, and plans to visit the Corbitt House next.",
        },
    ])
    _write_jsonl(run_dir / "player-feedback.jsonl", [
        {
            "category": "kp_clarity",
            "score": 5,
            "text": "KP explained when rolls were needed and what changed in the fiction.",
        },
        {
            "category": "immersion",
            "score": 4,
            "text": "The scene felt like investigation first, not a mechanics checklist.",
        },
    ])
    _write_jsonl(run_dir / "evaluator-notes.jsonl", [
        {"severity": "low", "category": "rules_accuracy", "text": "Rolls include goals and difficulty rationale."},
        {"severity": "low", "category": "state_integrity", "text": "Clue, decision, sanity, memory, and feedback logs are present."},
    ])

    generate_battle_report(run_dir)
    generate_evaluation_report(run_dir)
    generate_rulebook_audit(run_dir)
    return run_dir


def create_haunting_module_run(root: Path, run_id: str = "v2-haunting-module") -> Path:
    run_dir = root / ".coc" / "playtests" / run_id
    campaign_dir = run_dir / "sandbox" / ".coc" / "campaigns" / run_id
    scenario_dir = campaign_dir / "scenario"
    investigator_id = "ada-king-haunting"
    investigator_dir = run_dir / "sandbox" / ".coc" / "investigators" / investigator_id
    corbitt_id = "walter-corbitt"

    _write_json(run_dir / "playtest.json", {
        "run_id": run_id,
        "campaign_id": run_id,
        "campaign_title": "The Haunting Module Playthrough",
        "scenario": "The Haunting",
        "scenario_id": "the-haunting",
        "audit_profile": "haunting_module",
        "era": "1920s",
        "dice_mode": "codex",
        "spoiler_policy": "warn_before_reveal",
        "player_profile": "careful_investigator",
        "module_coverage": [
            "knott_hiring",
            "research_route",
            "chapel_of_contemplation",
            "old_corbitt_place",
            "bed_attack",
            "basement",
            "floating_knife",
            "corbitt_hiding_place",
            "corbitt_confrontation",
            "conclusion_rewards",
        ],
        "subsystems_covered": [
            "investigation",
            "social",
            "pushed_roll",
            "sanity",
            "damage",
            "combat",
        ],
        "scores": {
            "immersion": 4,
            "rules_accuracy": 4,
            "state_integrity": 5,
            "spoiler_safety": 4,
            "meta_quality": 4,
            "pacing": 4,
            "module_fidelity": 4,
        },
        "passed_test_cases": [
            "module_opening_contract",
            "research_route_choice",
            "social_pushed_roll",
            "chapel_clue_route",
            "house_exploration",
            "bed_attack_damage_and_sanity",
            "basement_pushed_roll_damage",
            "floating_knife_combat",
            "corbitt_final_combat",
            "final_state_and_rewards",
        ],
        "failed_test_cases": [],
        "recommended_fixes": [
            "Future loop should add a chase-specific scenario because The Haunting does not naturally exercise chase rules.",
        ],
        "regression_tests": ["Haunting module audit must pass for the module-level harness."],
    })
    _write_json(campaign_dir / "campaign.json", {
        "schema_version": 1,
        "campaign_id": run_id,
        "title": "The Haunting Module Playthrough",
        "mode": "keeper",
        "status": "complete",
        "era": "1920s",
        "active_scenario_id": "the-haunting",
        "active_scene_id": "conclusion-rewards",
        "dice_mode": "codex",
        "spoiler_policy": "warn_before_reveal",
        "active_subsystem": "aftermath",
    })
    _write_json(campaign_dir / "party.json", {
        "campaign_id": run_id,
        "investigator_ids": [investigator_id],
        "active_investigator_ids": [investigator_id],
    })
    _write_json(scenario_dir / "scenario.json", {
        "schema_version": 1,
        "scenario_id": "the-haunting",
        "title": "The Haunting",
        "module_source": "pdf/Call Of Cthulhu Keeper Rulebook 40th Anniversary (Sandy Petersen).pdf",
        "summary": "Investigators trace Walter Corbitt through Boston records, the Chapel of Contemplation, and the Corbitt House basement.",
        "player_safe_summary": "Mr. Knott hires Ada King to inspect a haunted Boston house and learn why tenants keep fleeing it.",
        "opening_scene": "Mr. Knott meets Ada in 1920 Boston, gives her the keys and an advance, and suggests research before visiting the house.",
        "current_phase": "conclusion_rewards",
    })
    _write_json(scenario_dir / "clues.json", [
        {"id": "handout-1", "summary": "Mr. Knott gives the address, keys, $20 advance, and the research premise.", "route": "opening"},
        {"id": "handout-2", "summary": "Boston Globe files describe violent accidents, illness, suicide, and the Macarios fleeing.", "route": "Arty Wilmot access scene"},
        {"id": "handout-7", "summary": "Hall of Records links Corbitt's will to Reverend Michael Thomas and the Chapel of Contemplation.", "route": "Library Use at Hall of Records"},
        {"id": "chapel-journal", "summary": "The chapel journal says Walter Corbitt was buried in his basement.", "route": "Spot Hidden under the ruined chapel cabinet"},
        {"id": "vittorio-bible", "summary": "Vittorio's phrase hints that Corbitt may be worsted by his own weapon.", "route": "Roxbury Sanitarium interview"},
    ])
    _write_json(scenario_dir / "locations.json", [
        {"id": "location-knott-office", "name": "Mr. Knott's office", "purpose": "opening hook"},
        {"id": "location-boston-globe", "name": "The Boston Globe", "purpose": "social access and Handout 2"},
        {"id": "location-hall-records", "name": "Hall of Records", "purpose": "Chapel lead"},
        {"id": "location-sanitarium", "name": "Roxbury Sanitarium", "purpose": "own-weapon clue"},
        {"id": "location-chapel", "name": "Chapel of Contemplation", "purpose": "burial clue and Mythos tome"},
        {"id": "location-house", "name": "The Old Corbitt Place", "purpose": "haunting exploration"},
        {"id": "location-spare-bedroom", "name": "Spare Bedroom", "purpose": "Bed Attack"},
        {"id": "location-basement", "name": "Basement", "purpose": "The Floating Knife"},
        {"id": "location-hidden-lair", "name": "Corbitt's Hiding Place", "purpose": "final confrontation"},
    ])
    _write_json(scenario_dir / "npcs.json", [
        {"id": "npc-knott", "name": "Mr. Knott", "role": "landlord and client"},
        {"id": "npc-arty", "name": "Arty Wilmot", "role": "Boston Globe editor blocking access to the morgue"},
        {"id": "npc-ruth", "name": "Ruth Blake", "role": "records keeper"},
        {"id": "npc-gabriela", "name": "Gabriela Macario", "role": "survivor at Roxbury Sanitarium"},
        {"id": corbitt_id, "name": "Walter Corbitt", "role": "undead sorcerer antagonist"},
    ])
    _write_json(scenario_dir / "timeline.json", [
        {"id": "past-1835", "summary": "A merchant builds the house and sells it to Walter Corbitt after falling ill."},
        {"id": "past-1852", "summary": "Neighbors sue Corbitt over his strange habits."},
        {"id": "past-1866", "summary": "Corbitt's will asks that he be buried in the basement."},
        {"id": "past-1912", "summary": "Police raid the Chapel of Contemplation."},
        {"id": "past-1918", "summary": "The Macarios flee after illness and madness."},
    ])
    _write_json(scenario_dir / "handouts.json", [
        {"id": "handout-1", "title": "Mr. Knott's job"},
        {"id": "handout-2", "title": "Unpublished Boston Globe story"},
        {"id": "handout-7", "title": "Chapel executor record"},
        {"id": "handout-9", "title": "Chapel symbol"},
    ])
    _write_json(scenario_dir / "keeper-secrets.json", [
        {"id": "secret-corbitt-body", "summary": "Walter Corbitt's body and mind persist in the basement."},
        {"id": "secret-floating-knife", "summary": "Corbitt controls a blood-rusted magic dagger."},
    ])

    _write_json(investigator_dir / "character.json", {
        "schema_version": 1,
        "id": investigator_id,
        "name": "Ada King",
        "occupation": "Antiquarian",
        "era": "1920s",
        "characteristics": {
            "STR": 60,
            "CON": 55,
            "SIZ": 65,
            "DEX": 50,
            "APP": 45,
            "INT": 70,
            "POW": 55,
            "EDU": 75,
            "LUCK": 55,
        },
        "derived": {
            "HP": 12,
            "MP": 11,
            "SAN": 55,
            "MOV": 8,
            "damage_bonus": "0",
            "build": 0,
        },
        "skills": {
            "Charm": 35,
            "Climb": 20,
            "Dodge": 25,
            "Fighting (Brawl)": 40,
            "Library Use": 60,
            "Persuade": 55,
            "Psychology": 40,
            "Spot Hidden": 55,
        },
    })

    _write_jsonl(run_dir / "transcript.jsonl", [
        {"turn": 1, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "text": "Mr. Knott lays a key on the desk and offers $20 per day if Ada can investigate the Corbitt House."},
        {"turn": 2, "role": "player_simulator", "speaker": "Ada King", "mode": "play", "intent": "ask terms and immediate leads", "text": "I ask Mr. Knott what happened to the Macarios and where I should begin."},
        {"turn": 3, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "no_roll_needed", "text": "No roll is needed. He gives Handout 1, the keys, the address, and suggests research before entering the house."},
        {"turn": 4, "role": "player_simulator", "speaker": "Ada King", "mode": "play", "intent": "choose first research route", "text": "I go to The Boston Globe and ask to see the old clipping files."},
        {"turn": 5, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "persuade_regular", "text": "Arty Wilmot blocks access to the morgue. Your stated goal is to gain access; roll Persuade at Regular difficulty."},
        {"turn": 6, "role": "system", "speaker": "system", "mode": "roll", "text": "Persuade 72 vs 55 -> failure."},
        {"turn": 7, "role": "player_simulator", "speaker": "Ada King", "mode": "play", "intent": "push Arty social access", "text": "I push the roll by showing Mr. Knott's keys and arguing this prevents another tragedy; I accept that Arty may call maintenance."},
        {"turn": 8, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "pushed_persuade", "text": "That justifies a pushed Persuade roll. On failure, Arty calls strong-armed maintenance men and you lose access."},
        {"turn": 9, "role": "system", "speaker": "system", "mode": "roll", "text": "Pushed Persuade 38 vs 55 -> regular_success."},
        {"turn": 10, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "text": "Arty relents. Ruth Blake leads you to the dusty morgue, and Handout 2 reveals accidents, illness, suicide, and the Macarios fleeing."},
        {"turn": 11, "role": "player_simulator", "speaker": "Ada King", "mode": "play", "intent": "follow public record trail", "text": "I spend the afternoon at the Hall of Records looking for Walter Corbitt and church records."},
        {"turn": 12, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "library_use_regular", "text": "Roll Library Use. You are looking for legal records connecting Corbitt to any institution or executor."},
        {"turn": 13, "role": "system", "speaker": "system", "mode": "roll", "text": "Library Use 22 vs 60 -> hard_success."},
        {"turn": 14, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "text": "Handout 7 links Corbitt's executor to Reverend Michael Thomas and the Chapel of Contemplation."},
        {"turn": 15, "role": "player_simulator", "speaker": "Ada King", "mode": "play", "intent": "check sanitarium clue", "text": "Before the house, I visit Roxbury Sanitarium and ask Gabriela and Vittorio Macario what they remember."},
        {"turn": 16, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "roleplay_no_roll", "text": "Gabriela describes an evil presence. Vittorio clutches a bible and says the devil is worsted by his own weapon."},
        {"turn": 17, "role": "player_simulator", "speaker": "Ada King", "mode": "play", "intent": "investigate Chapel of Contemplation", "text": "I go to the ruined Chapel of Contemplation and search near the old cabinet."},
        {"turn": 18, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "spot_hidden_regular", "text": "You see the three-Y symbol around an eye. Searching beneath the cabinet calls for Spot Hidden."},
        {"turn": 19, "role": "system", "speaker": "system", "mode": "roll", "text": "Spot Hidden 28 vs 55 -> regular_success."},
        {"turn": 20, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "text": "The journal mentions Walter Corbitt buried in the basement, and the Latin tome is clearly Mythos material."},
        {"turn": 21, "role": "player_simulator", "speaker": "Ada King", "mode": "play", "intent": "enter the Old Corbitt Place", "text": "I unlock The Old Corbitt Place, check the bolted doors, and move upstairs toward the spare bedroom."},
        {"turn": 22, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "haunting_scene", "text": "The house seems to withdraw into shadow. In the spare bedroom, a rattle draws you to the window: Bed Attack is triggered."},
        {"turn": 23, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "bed_attack_spot_hidden", "text": "Roll Spot Hidden to notice the bed lurch before it slams toward you."},
        {"turn": 24, "role": "system", "speaker": "system", "mode": "roll", "text": "Spot Hidden 47 vs 55 -> regular_success."},
        {"turn": 25, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "bed_attack_dodge", "text": "You may attempt Dodge. Failure means the bed throws you through glass for 1D6+2 damage."},
        {"turn": 26, "role": "system", "speaker": "system", "mode": "roll", "text": "Dodge 68 vs 25 -> failure. Damage: 5 HP. HP 12 -> 7."},
        {"turn": 27, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "bed_attack_sanity", "text": "Seeing the bed move by itself requires SAN 1/1D4."},
        {"turn": 28, "role": "system", "speaker": "system", "mode": "roll", "text": "SAN 74 vs 55 -> failure; SAN loss 3. SAN 55 -> 52."},
        {"turn": 29, "role": "player_simulator", "speaker": "Ada King", "mode": "play", "intent": "continue to basement despite injury", "text": "Bandaged and shaken, I go to the basement door and descend carefully."},
        {"turn": 30, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "combined_dex_climb", "text": "The stairs are dark and moving underfoot. Roll DEX or Climb as a combined roll."},
        {"turn": 31, "role": "system", "speaker": "system", "mode": "roll", "text": "DEX/Climb 71 vs DEX 50 and Climb 20 -> failure."},
        {"turn": 32, "role": "player_simulator", "speaker": "Ada King", "mode": "play", "intent": "push basement descent", "text": "I push by sitting low, bracing on the rail, and inching down. I accept a fall if it goes wrong."},
        {"turn": 33, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "pushed_dex_climb", "text": "Pushed roll accepted. On failure you fall for 1D6 HP damage."},
        {"turn": 34, "role": "system", "speaker": "system", "mode": "roll", "text": "Pushed DEX 44 vs 50 -> regular_success."},
        {"turn": 35, "role": "player_simulator", "speaker": "Ada King", "mode": "play", "intent": "search basement clutter", "text": "I search the basement clutter for anything tied to the chapel or Corbitt."},
        {"turn": 36, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "basement_spot_hidden", "text": "This is an Obscure clue. Roll Spot Hidden; on a pushed failure, sharp debris or the knife can hurt you."},
        {"turn": 37, "role": "system", "speaker": "system", "mode": "roll", "text": "Spot Hidden 88 vs 55 -> failure."},
        {"turn": 38, "role": "player_simulator", "speaker": "Ada King", "mode": "play", "intent": "push basement search", "text": "I push by taking off my gloves and searching by touch, knowing the debris can cut me."},
        {"turn": 39, "role": "system", "speaker": "system", "mode": "roll", "text": "Pushed Spot Hidden 91 vs 55 -> failure. Damage: 4 HP. HP 7 -> 3. The Floating Knife stirs."},
        {"turn": 40, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "floating_knife_combat", "text": "The Floating Knife rises. Combat round begins; the knife uses Corbitt's POW and Ada may Dodge."},
        {"turn": 41, "role": "system", "speaker": "system", "mode": "roll", "text": "SAN 29 vs 52 -> success; SAN loss 1. SAN 52 -> 51."},
        {"turn": 42, "role": "system", "speaker": "system", "mode": "roll", "text": "Corbitt POW 34 vs 90 -> hard_success; Ada Dodge 18 vs 25 -> hard_success, so the knife misses."},
        {"turn": 43, "role": "player_simulator", "speaker": "Ada King", "mode": "play", "intent": "grab the floating knife", "text": "I throw my coat over the blade and try to grab the knife out of the air."},
        {"turn": 44, "role": "system", "speaker": "system", "mode": "roll", "text": "Fighting Maneuver 12 vs 40 -> hard_success; Corbitt POW 92 vs 90 -> failure. Ada has the knife."},
        {"turn": 45, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "text": "Behind the boards you find Corbitt's Hiding Place. The words Chapel of Contemplation are carved in the wall."},
        {"turn": 46, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "corbitt_sanity", "text": "Corbitt Attacks: the corpse rises from the pallet. Roll SAN 1/1D8."},
        {"turn": 47, "role": "system", "speaker": "system", "mode": "roll", "text": "SAN 63 vs 51 -> failure; SAN loss 6. INT 35 vs 70 -> success, so temporary insanity occurs."},
        {"turn": 48, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "corbitt_combat_round", "text": "Combat round order is Ada DEX 50, then Corbitt DEX 35. Ada screams and drops her revolver, but still clutches the dagger."},
        {"turn": 49, "role": "player_simulator", "speaker": "Ada King", "mode": "play", "intent": "attack Corbitt with his own weapon", "text": "The clue from Vittorio snaps into place. I stab Corbitt with his own dagger."},
        {"turn": 50, "role": "system", "speaker": "system", "mode": "roll", "text": "Fighting (Brawl) 21 vs 40 -> regular_success. Corbitt is destroyed by his own dagger."},
        {"turn": 51, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "text": "Rewards: Corbitt crumbles to dust, Mr. Knott pays the fee and a $30 bonus, and Ada gains 4 SAN. Final HP: 3. Final SAN: 49."},
    ])

    _write_jsonl(campaign_dir / "logs" / "rolls.jsonl", [
        {"type": "roll", "actor": investigator_id, "payload": {"skill": "Persuade", "goal": "gain access to The Boston Globe clipping files from Arty Wilmot", "target": 55, "effective_target": 55, "difficulty": "regular", "difficulty_rationale": "Arty is an obstructive but ordinary editor, so the social skill check is Regular.", "roll": 72, "outcome": "failure", "push_eligible": True, "failure_consequence": "Arty refuses access unless Ada escalates with a pushed approach.", "skill_check_earned": False}},
        {"type": "roll", "actor": investigator_id, "payload": {"skill": "Persuade", "goal": "gain access to The Boston Globe clipping files from Arty Wilmot", "target": 55, "effective_target": 55, "difficulty": "regular", "difficulty_rationale": "The pushed roll keeps the same social difficulty after Ada changes pressure.", "roll": 38, "outcome": "regular_success", "pushed": True, "push_justification": "Ada shows Mr. Knott's keys and argues that access may prevent another tragedy.", "foreshadowed_failure": "On failure, Arty calls maintenance and Ada loses access to the morgue.", "failure_consequence": "Arty would call strong-armed maintenance men and bar Ada from the files.", "skill_check_earned": True}},
        {"type": "roll", "actor": investigator_id, "payload": {"skill": "Library Use", "goal": "connect Walter Corbitt to an executor and church records", "target": 60, "effective_target": 60, "difficulty": "regular", "difficulty_rationale": "The Hall of Records contains the entry, but it takes focused archive work.", "roll": 22, "outcome": "hard_success", "failure_consequence": "Ada would spend another half day and risk pressure from Mr. Knott.", "skill_check_earned": True}},
        {"type": "roll", "actor": investigator_id, "payload": {"skill": "Spot Hidden", "goal": "find the chapel journal under the ruined cabinet", "target": 55, "effective_target": 55, "difficulty": "regular", "difficulty_rationale": "The journal is hidden under debris but can be found with a careful search.", "roll": 28, "outcome": "regular_success", "failure_consequence": "Ada would miss the explicit basement burial clue.", "skill_check_earned": True}},
        {"type": "roll", "actor": investigator_id, "payload": {"skill": "Spot Hidden", "goal": "notice the Bed Attack before impact", "target": 55, "effective_target": 55, "difficulty": "regular", "difficulty_rationale": "The bed lurches suddenly, but a watchful investigator can react.", "roll": 47, "outcome": "regular_success", "failure_consequence": "Ada would have no chance to Dodge before the bed hit.", "skill_check_earned": True}},
        {"type": "roll", "actor": investigator_id, "payload": {"skill": "Dodge", "goal": "avoid being thrown through the spare bedroom window by the Bed Attack", "target": 25, "effective_target": 25, "difficulty": "regular", "difficulty_rationale": "Bed Attack allows a Dodge after the Spot Hidden success.", "roll": 68, "outcome": "failure", "failure_consequence": "Ada is thrown through glass and takes 1D6+2 damage.", "skill_check_earned": False}},
        {"type": "sanity", "actor": investigator_id, "payload": {"skill": "SAN", "goal": "withstand seeing the bed move of its own accord", "target": 55, "effective_target": 55, "difficulty": "sanity", "difficulty_rationale": "The Bed Attack calls for SAN 1/1D4.", "roll": 74, "outcome": "failure", "failure_consequence": "Ada loses 1D4 SAN.", "san_loss": 3}},
        {"type": "roll", "actor": investigator_id, "payload": {"skill": "DEX/Climb", "goal": "descend the moving basement stairs", "target": 50, "effective_target": 50, "difficulty": "combined", "difficulty_rationale": "The rulebook treats the basement stairs as a combined DEX or Climb roll.", "roll": 71, "outcome": "failure", "push_eligible": True, "failure_consequence": "Ada must stop or push and risk a fall.", "skill_check_earned": False}},
        {"type": "roll", "actor": investigator_id, "payload": {"skill": "DEX", "goal": "push through the dangerous basement descent", "target": 50, "effective_target": 50, "difficulty": "regular", "difficulty_rationale": "Ada changes tactics by sitting low and bracing on the rail.", "roll": 44, "outcome": "regular_success", "pushed": True, "push_justification": "Ada inches down while braced and accepts a fall if it goes wrong.", "foreshadowed_failure": "On failure, Ada falls down the stairs for 1D6 HP damage.", "failure_consequence": "Ada would fall and lose 1D6 HP.", "skill_check_earned": True}},
        {"type": "roll", "actor": investigator_id, "payload": {"skill": "Spot Hidden", "goal": "find Corbitt's blood-rusted dagger in basement clutter", "target": 55, "effective_target": 55, "difficulty": "regular", "difficulty_rationale": "The knife is an Obscure clue hidden among dangerous clutter.", "roll": 88, "outcome": "failure", "push_eligible": True, "failure_consequence": "Ada misses the knife unless she risks a more dangerous search.", "skill_check_earned": False}},
        {"type": "roll", "actor": investigator_id, "payload": {"skill": "Spot Hidden", "goal": "find Corbitt's blood-rusted dagger in basement clutter", "target": 55, "effective_target": 55, "difficulty": "regular", "difficulty_rationale": "The pushed search takes more time and exposes Ada to sharp debris.", "roll": 91, "outcome": "failure", "pushed": True, "push_justification": "Ada removes her gloves and searches by touch despite the risk.", "foreshadowed_failure": "On failure, Ada catches her hand on the possessed knife and takes automatic damage.", "failure_consequence": "Ada takes 1D4+2 HP damage from the knife.", "skill_check_earned": False}},
        {"type": "sanity", "actor": investigator_id, "payload": {"skill": "SAN", "goal": "withstand seeing The Floating Knife attack", "target": 52, "effective_target": 52, "difficulty": "sanity", "difficulty_rationale": "The Floating Knife calls for SAN 1/1D4.", "roll": 29, "outcome": "success", "failure_consequence": "Ada would lose 1D4 SAN.", "san_loss": 1}},
        {"type": "combat", "actor": corbitt_id, "payload": {"skill": "POW", "goal": "drive The Floating Knife into Ada", "target": 90, "effective_target": 90, "difficulty": "opposed", "difficulty_rationale": "The knife attacks using Corbitt's POW against Ada's Dodge.", "roll": 34, "outcome": "hard_success", "failure_consequence": "The knife would miss if Corbitt failed."}},
        {"type": "combat", "actor": investigator_id, "payload": {"skill": "Dodge", "goal": "avoid The Floating Knife", "target": 25, "effective_target": 25, "difficulty": "opposed", "difficulty_rationale": "Ada compares Dodge success level against Corbitt's POW success level.", "roll": 18, "outcome": "hard_success", "failure_consequence": "Ada would take 1D4+2 damage if Corbitt achieved the higher success level.", "skill_check_earned": True}},
        {"type": "combat", "actor": investigator_id, "payload": {"skill": "Fighting (Brawl)", "goal": "grab The Floating Knife with a coat-assisted fighting maneuver", "target": 40, "effective_target": 40, "difficulty": "opposed", "difficulty_rationale": "Grabbing the knife uses Fighting Maneuver rules against Corbitt's POW.", "roll": 12, "outcome": "hard_success", "failure_consequence": "The knife would remain free and continue attacking.", "skill_check_earned": True}},
        {"type": "combat", "actor": corbitt_id, "payload": {"skill": "POW", "goal": "resist Ada grabbing The Floating Knife", "target": 90, "effective_target": 90, "difficulty": "opposed", "difficulty_rationale": "Corbitt contests the maneuver with POW.", "roll": 92, "outcome": "failure", "failure_consequence": "Ada gains hold of the knife."}},
        {"type": "sanity", "actor": investigator_id, "payload": {"skill": "SAN", "goal": "withstand seeing Corbitt rise from the pallet", "target": 51, "effective_target": 51, "difficulty": "sanity", "difficulty_rationale": "Corbitt rising calls for SAN 1/1D8.", "roll": 63, "outcome": "failure", "failure_consequence": "Ada loses 1D8 SAN and may suffer temporary insanity.", "san_loss": 6}},
        {"type": "roll", "actor": investigator_id, "payload": {"skill": "INT", "goal": "determine whether the 5+ SAN loss causes temporary insanity", "target": 70, "effective_target": 70, "difficulty": "regular", "difficulty_rationale": "After losing 5 or more SAN, a successful INT roll means Ada comprehends the horror.", "roll": 35, "outcome": "regular_success", "failure_consequence": "On failure, Ada would be shaken but not temporarily insane.", "skill_check_earned": False}},
        {"type": "combat", "actor": investigator_id, "payload": {"skill": "Fighting (Brawl)", "goal": "stab Corbitt with his own dagger", "target": 40, "effective_target": 40, "difficulty": "regular", "difficulty_rationale": "Ada attacks with the seized dagger before Corbitt's DEX 35 action.", "roll": 21, "outcome": "regular_success", "failure_consequence": "Corbitt would take his action and continue the combat.", "skill_check_earned": True}},
    ])

    _write_jsonl(campaign_dir / "logs" / "events.jsonl", [
        {"type": "scene", "actor": "keeper_under_test", "payload": {"scene_id": "knott-hiring", "summary": "Mr. Knott hired Ada, gave Handout 1, the keys, and $20 advance."}},
        {"type": "decision", "actor": investigator_id, "payload": {"summary": "Ada chose The Boston Globe as her first research route."}},
        {"type": "decision", "actor": investigator_id, "payload": {"summary": "Ada chose to push Arty Wilmot with Mr. Knott's keys after the first Persuade roll failed."}},
        {"type": "clue", "actor": investigator_id, "payload": {"clue_id": "handout-2", "summary": "Ada gained Handout 2 after a pushed social roll with Arty Wilmot."}},
        {"type": "decision", "actor": investigator_id, "payload": {"summary": "Ada chose to follow the legal record trail to the Hall of Records."}},
        {"type": "clue", "actor": investigator_id, "payload": {"clue_id": "handout-7", "summary": "Ada linked Walter Corbitt to Reverend Michael Thomas and the Chapel of Contemplation."}},
        {"type": "decision", "actor": investigator_id, "payload": {"summary": "Ada chose to visit Roxbury Sanitarium before entering the house."}},
        {"type": "scene", "actor": "keeper_under_test", "payload": {"scene_id": "roxbury-sanitarium", "summary": "Gabriela described the evil presence and Vittorio gave the own-weapon clue."}},
        {"type": "decision", "actor": investigator_id, "payload": {"summary": "Ada chose to investigate the ruined Chapel of Contemplation before confronting the house."}},
        {"type": "scene", "actor": "keeper_under_test", "payload": {"scene_id": "chapel-of-contemplation", "summary": "Ada investigated the Chapel of Contemplation and saw the three-Y eye symbol."}},
        {"type": "clue", "actor": investigator_id, "payload": {"clue_id": "chapel-journal", "summary": "Ada found the journal stating Walter Corbitt was buried in his basement."}},
        {"type": "decision", "actor": investigator_id, "payload": {"summary": "Ada chose to enter The Old Corbitt Place after confirming the basement burial clue."}},
        {"type": "scene", "actor": "keeper_under_test", "payload": {"scene_id": "old-corbitt-place", "summary": "Ada entered The Old Corbitt Place and explored the spare bedroom."}},
        {"type": "damage", "actor": investigator_id, "payload": {"summary": "Damage: 5 HP from Bed Attack; HP 12 -> 7."}},
        {"type": "sanity", "actor": investigator_id, "payload": {"summary": "Ada failed SAN 1/1D4 for the Bed Attack and lost 3 SAN; SAN 55 -> 52."}},
        {"type": "decision", "actor": investigator_id, "payload": {"summary": "Ada chose to continue into the basement despite injury from the Bed Attack."}},
        {"type": "scene", "actor": "keeper_under_test", "payload": {"scene_id": "basement", "summary": "Ada descended the moving basement stairs with a pushed DEX roll."}},
        {"type": "decision", "actor": investigator_id, "payload": {"summary": "Ada chose to push the basement search by removing her gloves and searching by touch."}},
        {"type": "damage", "actor": investigator_id, "payload": {"summary": "Damage: 4 HP from failed pushed basement search; HP 7 -> 3."}},
        {"type": "combat", "actor": "keeper_under_test", "payload": {"summary": "The Floating Knife starts a combat round; Corbitt POW hard success ties Ada Dodge hard success, so Ada avoids the attack."}},
        {"type": "decision", "actor": investigator_id, "payload": {"summary": "Ada chose to grab The Floating Knife with her coat instead of fleeing the basement."}},
        {"type": "combat", "actor": investigator_id, "payload": {"summary": "Ada uses a coat-assisted Fighting Maneuver to grab The Floating Knife after Corbitt fails the opposed POW roll."}},
        {"type": "scene", "actor": "keeper_under_test", "payload": {"scene_id": "corbitt-hiding-place", "summary": "Ada finds Corbitt's Hiding Place behind the basement boards."}},
        {"type": "sanity", "actor": investigator_id, "payload": {"summary": "Ada failed SAN 1/1D8 when Corbitt rose, lost 6 SAN, and suffered temporary insanity after a successful INT roll."}},
        {"type": "combat", "actor": "keeper_under_test", "payload": {"summary": "Corbitt Attacks in a combat round; DEX order is Ada 50 before Corbitt 35."}},
        {"type": "decision", "actor": investigator_id, "payload": {"summary": "Ada chose to trust Vittorio's clue and stab Corbitt with his own dagger."}},
        {"type": "combat", "actor": investigator_id, "payload": {"summary": "Ada stabs Corbitt with his own dagger, ending the fight before Corbitt can act."}},
        {"type": "chase", "actor": "keeper_under_test", "payload": {"summary": "The Haunting does not include a required chase sequence; chase subsystem coverage is deferred to a separate scenario."}},
        {"type": "status", "actor": investigator_id, "payload": {"summary": "Final HP: 3; Final SAN: 49; Rewards: +4 SAN, $30 bonus, and the option to keep the worm-eaten book."}},
        {"type": "session_ending", "actor": "keeper_under_test", "payload": {"summary": "Conclusion Rewards: Corbitt is destroyed, Mr. Knott pays Ada, and conspiracy clues remain for future adventures."}},
    ])
    _write_jsonl(campaign_dir / "memory" / "session-summaries.jsonl", [
        {
            "session_id": "session-1",
            "summary": "Ada accepted Mr. Knott's job, pushed past Arty Wilmot, traced the Chapel of Contemplation, found Corbitt's burial clue, survived the Bed Attack and The Floating Knife, destroyed Corbitt with his own dagger, and ended with Final HP: 3 and Final SAN: 49.",
        },
    ])
    _write_jsonl(run_dir / "player-feedback.jsonl", [
        {"category": "kp_clarity", "score": 5, "text": "KP stated goals, stakes, and consequences before important rolls."},
        {"category": "immersion", "score": 4, "text": "The session felt like a sequence of choices and scenes rather than a checklist."},
        {"category": "module_fidelity", "score": 4, "text": "The playtest reached the major The Haunting beats from Mr. Knott through Rewards."},
        {"category": "combat_readability", "score": 4, "text": "Combat round order, opposed rolls, damage, and Corbitt's defeat were understandable."},
    ])
    _write_jsonl(run_dir / "evaluator-notes.jsonl", [
        {"severity": "low", "category": "rules_accuracy", "text": "Pushed rolls state changed tactics and foreshadowed consequences."},
        {"severity": "low", "category": "rules_accuracy", "text": "The Floating Knife uses opposed POW versus Dodge and a Fighting Maneuver to grab it."},
        {"severity": "low", "category": "state_integrity", "text": "HP, SAN, clues, scenes, combat, final status, memory, and feedback are recorded."},
        {"severity": "medium", "category": "immersion", "text": "The scripted test compresses a full scenario and should later be replaced by an LLM-vs-KP interactive transcript."},
    ])

    generate_battle_report(run_dir)
    generate_evaluation_report(run_dir)
    generate_rulebook_audit(run_dir)
    return run_dir


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=".")
    parser.add_argument("--run-id", default="v1-rulebook-smoke")
    parser.add_argument("--profile", choices=["rulebook-smoke", "haunting-module"], default="rulebook-smoke")
    args = parser.parse_args()
    if args.profile == "haunting-module":
        run_dir = create_haunting_module_run(Path(args.root), args.run_id)
    else:
        run_dir = create_rulebook_smoke_run(Path(args.root), args.run_id)
    print(run_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
