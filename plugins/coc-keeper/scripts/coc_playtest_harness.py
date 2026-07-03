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


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=".")
    parser.add_argument("--run-id", default="v1-rulebook-smoke")
    args = parser.parse_args()
    run_dir = create_rulebook_smoke_run(Path(args.root), args.run_id)
    print(run_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
