import importlib.util
import json
from pathlib import Path


def load_module(name: str, relative_path: str):
    path = Path(relative_path)
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_playtest_report = load_module("coc_playtest_report", "plugins/coc-keeper/scripts/coc_playtest_report.py")


def test_localized_text_uses_cjk_sentence_punctuation_after_glossary_replacement():
    localized = coc_playtest_report._localize_text(
        "The Haunting does not include a required chase sequence.",
        {
            "The Haunting does not include a required chase sequence": "本模组不包含必需追逐场景",
        },
    )

    assert localized == "本模组不包含必需追逐场景。"


def write_jsonl(path: Path, events: list[dict]):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(json.dumps(event) for event in events) + "\n")


def write_json(path: Path, payload: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload))


def section_text(markdown: str, heading_anchor: str) -> str:
    start = markdown.index(f"report-anchor: {heading_anchor}")
    next_heading = markdown.find("\n## ", start + 1)
    if next_heading == -1:
        return markdown[start:]
    return markdown[start:next_heading]


def test_generate_battle_and_evaluation_reports(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "run-1"
    campaign_dir = run_dir / "sandbox" / ".coc" / "campaigns" / "run-1"
    investigator_dir = run_dir / "sandbox" / ".coc" / "investigators" / "ada-king"

    write_json(campaign_dir / "campaign.json", {
        "campaign_id": "run-1",
        "title": "The Haunting Test",
        "scenario_id": "the-haunting",
        "era": "1920s",
        "dice_mode": "codex",
        "spoiler_policy": "warn_before_reveal",
        "status": "active",
    })
    write_json(campaign_dir / "party.json", {
        "investigator_ids": ["ada-king"],
    })
    write_json(campaign_dir / "scenario" / "scenario.json", {
        "scenario_id": "the-haunting",
        "title": "The Haunting",
        "module_source": "pdf/the-haunting.pdf",
        "opening_scene": "The investigators arrive at the old Corbitt house.",
    })
    write_json(investigator_dir / "character.json", {
        "id": "ada-king",
        "name": "Ada King",
        "player_name": "Virtual Player A",
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
            "Dodge": 25,
            "Library Use": 60,
            "Spot Hidden": 55,
        },
        "backstory": {
            "description": "A careful antiquarian who keeps old house keys sorted by address.",
            "ideology_beliefs": ["Every house keeps a memory of the people who used it."],
            "significant_people": ["Her late mentor Professor Leland Hart."],
            "meaningful_locations": ["A cramped bookshop near Scollay Square."],
            "treasured_possessions": ["A brass magnifier with a cracked handle."],
            "traits": ["Patient", "Keeps notes before acting"],
        },
    })
    write_jsonl(investigator_dir / "history.jsonl", [
        {
            "schema_version": 1,
            "type": "scenario_experience",
            "campaign_id": "run-1",
            "scenario_id": "the-haunting",
            "summary": "Ada survived the cold-room investigation and kept the disturbed desk clue.",
            "final_hp": 12,
            "final_san": 55,
        }
    ])
    write_jsonl(investigator_dir / "development.jsonl", [
        {
            "schema_version": 1,
            "type": "development_phase_summary",
            "campaign_id": "run-1",
            "status": "pending_player_rolls",
            "skill_checks_earned": ["Library Use"],
            "rewards": ["No SAN reward yet"],
            "carryover_notes": "Resolve skill improvement before importing Ada into another scenario.",
        }
    ])
    write_jsonl(run_dir / "transcript.jsonl", [
        {
            "turn": 1,
            "role": "keeper_under_test",
            "speaker": "KP",
            "mode": "play",
            "text": "The room is cold.",
        },
        {
            "turn": 2,
            "role": "player_simulator",
            "speaker": "Ada King",
            "mode": "play",
            "intent": "search desk",
            "text": "I search the desk.",
        },
    ])
    write_jsonl(campaign_dir / "logs" / "rolls.jsonl", [
        {
            "type": "roll",
            "actor": "ada-king",
            "payload": {
                "skill": "Library Use",
                "target": 60,
                "effective_target": 60,
                "roll": 80,
                "outcome": "failure",
            },
        }
    ])
    write_jsonl(campaign_dir / "logs" / "events.jsonl", [
        {
            "type": "scene",
            "actor": "keeper_under_test",
            "payload": {"scene_id": "intro", "summary": "Smoke-test scene opened."},
        }
    ])
    write_jsonl(campaign_dir / "memory" / "session-summaries.jsonl", [
        {
            "session_id": "session-1",
            "summary": "Ada searched the cold room, found that the desk had been disturbed, and stayed cautious.",
        }
    ])
    write_jsonl(run_dir / "player-feedback.jsonl", [
        {"category": "kp_clarity", "score": 4, "text": "KP gave clear choices."},
        {"category": "immersion", "score": 5, "text": "The opening felt tense without spoiling secrets."},
    ])
    write_jsonl(run_dir / "evaluator-notes.jsonl", [
        {"severity": "low", "category": "immersion", "text": "Good opening."},
        {
            "severity": "low",
            "category": "state_integrity",
            "text": "Campaign validation returned no errors.",
            "evidence": {
                "transcript_turns": [1, 2, 3],
                "log_paths": ["sandbox/.coc/campaigns/run-1/logs/rolls.jsonl"],
                "state_files": ["sandbox/.coc/campaigns/run-1/campaign.json"],
            },
        },
        {"severity": "low", "category": "spoiler_safety", "text": "No leaks observed."},
        {"severity": "low", "category": "meta_quality", "text": "Meta question paused play and returned cleanly."},
    ])
    write_json(run_dir / "playtest.json", {
        "run_id": "run-1",
        "campaign_id": "run-1",
        "campaign_title": "The Haunting Test",
        "scenario": "The Haunting",
        "scenario_id": "the-haunting",
        "module_source": "pdf/the-haunting.pdf",
        "era": "1920s",
        "dice_mode": "codex",
        "spoiler_policy": "warn_before_reveal",
        "player_profile": "careful_investigator",
        "audit_profile": "haunting_module",
        "module_coverage": ["knott_hiring", "bed_attack"],
        "subsystems_covered": ["investigation", "sanity"],
        "scores": {"immersion": 4, "rules_accuracy": 3},
        "passed_test_cases": ["activation_resume", "basic_roll"],
        "failed_test_cases": ["spoiler_warning"],
        "recommended_fixes": ["Populate spoiler warning transcript checks."],
        "future_enhancements": ["Replace scripted baseline with a live LLM-vs-KP probe when subagents are available."],
    })

    battle_path = coc_playtest_report.generate_battle_report(run_dir)
    evaluation_path = coc_playtest_report.generate_evaluation_report(run_dir)

    battle_text = battle_path.read_text()
    evaluation_text = evaluation_path.read_text()

    assert "## Run Setup" in battle_text
    assert "Campaign: The Haunting Test" in battle_text
    assert "Era: 1920s" in battle_text
    assert "Dice Mode: codex" in battle_text
    assert "Spoiler Policy: warn_before_reveal" in battle_text
    assert "## Module" in battle_text
    assert "Scenario ID: the-haunting" in battle_text
    assert "Source: pdf/the-haunting.pdf" in battle_text
    assert "## Character Dossier" in battle_text
    assert "Ada King" in battle_text
    assert "Ada King (ada-king)" in battle_text
    assert "STR: 60" in battle_text
    assert "HP: 12" in battle_text
    assert "Library Use: 60" in battle_text
    assert "Backstory:" in battle_text
    assert "Description: A careful antiquarian" in battle_text
    assert "Ideology/Beliefs: Every house keeps a memory" in battle_text
    assert "Significant People: Her late mentor Professor Leland Hart." in battle_text
    assert "Meaningful Locations: A cramped bookshop near Scollay Square." in battle_text
    assert "Treasured Possessions: A brass magnifier with a cracked handle." in battle_text
    assert "Traits: Patient; Keeps notes before acting" in battle_text
    assert "## Investigator Chronicle" in battle_text
    assert "History:" in battle_text
    assert "Ada survived the cold-room investigation" in battle_text
    assert "Development:" in battle_text
    assert "Development Phase Summary" in battle_text
    assert "development_phase_summary" not in battle_text
    assert "Status: pending_player_rolls" in battle_text
    assert "Skill Checks Earned: Library Use" in battle_text
    assert "Carryover Notes: Resolve skill improvement before importing Ada into another scenario." in battle_text
    assert "## Session Transcript" in battle_text
    assert "KP: The room is cold." in battle_text
    assert "Player: I search the desk." in battle_text
    assert "Intent: search desk" in battle_text
    assert "## Mechanical Log" in battle_text
    assert "Library Use: ada-king rolled 80 vs 60 -> failure" in battle_text
    assert "scene: intro - Smoke-test scene opened." in battle_text
    assert "## Story Recap" in battle_text
    assert "Ada searched the cold room" in battle_text
    assert "## Player Feedback On KP" in battle_text
    assert 'kp_clarity 4/5: Player feedback: "KP gave clear choices."' in battle_text
    assert "No roll extraction in V1 report" not in battle_text
    assert "No state diff extraction in V1 report" not in battle_text

    assert "V1 report generated" not in evaluation_text
    assert "## Overall Result\nFAIL" in evaluation_text
    assert "## Playtest Profile" in evaluation_text
    assert "Audit Profile: haunting_module" in evaluation_text
    assert "Player Profile: careful_investigator" in evaluation_text
    assert "Module Coverage: knott_hiring, bed_attack" in evaluation_text
    assert "Subsystems Covered: investigation, sanity" in evaluation_text
    assert "## Scorecard" in evaluation_text
    assert "rules_accuracy: 3" in evaluation_text
    assert "- activation_resume" in evaluation_text
    assert "- spoiler_warning" in evaluation_text
    assert "[low] state_integrity: Campaign validation returned no errors." in evaluation_text
    assert "Evidence: transcript turns 1, 2, 3; logs sandbox/.coc/campaigns/run-1/logs/rolls.jsonl; state sandbox/.coc/campaigns/run-1/campaign.json" in evaluation_text
    assert "[low] spoiler_safety: No leaks observed." in evaluation_text
    assert "[low] meta_quality: Meta question paused play and returned cleanly." in evaluation_text
    assert "- Populate spoiler warning transcript checks." in evaluation_text
    assert "## Future Enhancements" in evaluation_text
    assert "- Replace scripted baseline with a live LLM-vs-KP probe when subagents are available." in evaluation_text


def test_scene_replay_expands_bout_of_madness_rounds_as_separate_entries(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "bout-run"
    campaign_dir = run_dir / "sandbox" / ".coc" / "campaigns" / "bout-run"
    investigator_dir = run_dir / "sandbox" / ".coc" / "investigators" / "ada-king"

    write_json(campaign_dir / "campaign.json", {
        "campaign_id": "bout-run",
        "title": "The Haunting",
        "scenario_id": "the-haunting",
        "era": "1920s",
        "dice_mode": "codex",
        "spoiler_policy": "warn_before_reveal",
        "play_language": "zh-Hans",
    })
    write_json(campaign_dir / "party.json", {"investigator_ids": ["ada-king"]})
    write_json(campaign_dir / "scenario" / "scenario.json", {
        "scenario_id": "the-haunting",
        "title": "The Haunting",
        "module_source": "pdf/the-haunting.pdf",
        "opening_scene": "Ada King enters the basement.",
    })
    write_json(investigator_dir / "character.json", {
        "id": "ada-king",
        "name": "Ada King",
        "characteristics": {"DEX": 50},
        "derived": {"HP": 3, "SAN": 49},
        "skills": {},
    })
    write_jsonl(run_dir / "transcript.jsonl", [])
    write_jsonl(campaign_dir / "logs" / "rolls.jsonl", [])
    write_jsonl(campaign_dir / "logs" / "events.jsonl", [
        {
            "type": "bout_of_madness",
            "actor": "ada-king",
            "payload": {
                "summary": "疯狂发作：艾达·金短暂失控；持续 1D10 回合；1D10 掷出 2，所以持续 2 回合。",
                "duration_die": "1D10",
                "duration_roll": 2,
                "duration_rounds": 2,
                "rounds": [
                    {"round": 1, "control": "keeper", "summary": "疯狂发作第 1 回合：艾达·金尖叫着后退。"},
                    {"round": 2, "control": "keeper", "summary": "疯狂发作第 2 回合：控制权回到玩家。"},
                ],
                "control_returned": True,
                "recovery_note": "第 2 回合结束后控制权回到玩家。",
            },
        }
    ])
    write_jsonl(campaign_dir / "memory" / "session-summaries.jsonl", [])
    write_jsonl(run_dir / "player-feedback.jsonl", [])
    write_json(run_dir / "playtest.json", {
        "run_id": "bout-run",
        "campaign_id": "bout-run",
        "scenario": "The Haunting",
        "play_language": "zh-Hans",
        "localized_terms": {"zh-Hans": {"Ada King": "艾达·金", "The Haunting": "《鬼屋》"}},
    })

    battle_path = coc_playtest_report.generate_battle_report(run_dir)
    scene_replay = section_text(battle_path.read_text(), "Scene-by-Scene Replay")

    assert "- 疯狂发作：艾达·金短暂失控；持续 1D10 回合；1D10 掷出 2，所以持续 2 回合。" in scene_replay
    assert "- 疯狂发作第 1 回合：艾达·金尖叫着后退。" in scene_replay
    assert "- 疯狂发作第 2 回合：控制权回到玩家。" in scene_replay


def test_evaluation_report_overall_result_passes_without_failed_cases_or_serious_notes(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "run-pass"
    write_json(run_dir / "playtest.json", {
        "run_id": "run-pass",
        "audit_profile": "haunting_module",
        "player_profile": "careful_investigator",
        "module_coverage": ["knott_hiring"],
        "subsystems_covered": ["investigation"],
        "scores": {"rules_accuracy": 4},
        "passed_test_cases": ["opening_contract"],
        "failed_test_cases": [],
    })
    write_jsonl(run_dir / "evaluator-notes.jsonl", [
        {"severity": "low", "category": "rules_accuracy", "text": "Structured rule checks passed."},
    ])

    evaluation_path = coc_playtest_report.generate_evaluation_report(run_dir)
    evaluation_text = evaluation_path.read_text()

    assert "## Overall Result\nPASS" in evaluation_text
    assert "Report generated from available transcript and evaluator notes." not in evaluation_text


def test_battle_report_uses_selected_language_profile_and_localized_text(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "localized-run"
    campaign_dir = run_dir / "sandbox" / ".coc" / "campaigns" / "localized-run"
    investigator_dir = run_dir / "sandbox" / ".coc" / "investigators" / "ada-king"

    write_json(campaign_dir / "campaign.json", {
        "campaign_id": "localized-run",
        "title": "The Haunting",
        "scenario_id": "the-haunting",
        "era": "1920s",
        "dice_mode": "codex",
        "spoiler_policy": "warn_before_reveal",
        "play_language": "ja-JP",
    })
    write_json(campaign_dir / "party.json", {"investigator_ids": ["ada-king"]})
    write_json(campaign_dir / "scenario" / "scenario.json", {
        "scenario_id": "the-haunting",
        "title": "The Haunting",
        "module_source": "pdf/the-haunting.pdf",
        "opening_scene": "Ada King arrives at Corbitt House.",
    })
    write_json(investigator_dir / "character.json", {
        "id": "ada-king",
        "name": "Ada King",
        "characteristics": {"STR": 60, "CON": 55, "SIZ": 65, "DEX": 50, "APP": 45, "INT": 70, "POW": 55, "EDU": 75},
        "derived": {"HP": 12, "MP": 11, "SAN": 55, "MOV": 8},
        "skills": {"Spot Hidden": 55},
    })
    write_jsonl(run_dir / "transcript.jsonl", [
        {
            "turn": 1,
            "role": "keeper_under_test",
            "mode": "play",
            "text": "Ada King arrives at Corbitt House.",
            "localized_text": {"ja-JP": {"text": "エイダ・キングはコービット屋敷に到着する。"}},
        },
        {
            "turn": 2,
            "role": "player_simulator",
            "mode": "play",
            "intent": "inspect entry",
            "text": "I inspect the door.",
            "localized_text": {"ja-JP": {"text": "玄関の扉を調べます。"}},
        },
        {
            "turn": 3,
            "role": "system",
            "mode": "roll",
            "text": "Spot Hidden 22 vs 55 -> hard_success.",
            "roll_count": 1,
        },
    ])
    write_jsonl(campaign_dir / "logs" / "rolls.jsonl", [
        {
            "type": "roll",
            "actor": "ada-king",
            "payload": {
                "skill": "Spot Hidden",
                "goal": "notice the scratches on Corbitt House door",
                "target": 55,
                "effective_target": 55,
                "difficulty": "regular",
                "difficulty_rationale": "The scratches are visible with a careful look.",
                "roll": 22,
                "outcome": "hard_success",
                "failure_consequence": "Ada King misses the warning.",
                "skill_check_earned": True,
                "localized_text": {
                    "ja-JP": {
                        "goal": "コービット屋敷の扉についた傷に気づく",
                        "difficulty_rationale": "注意深く見れば傷は見える。",
                        "failure_consequence": "エイダ・キングは警告を見逃す。",
                    }
                },
            },
        }
    ])
    write_jsonl(campaign_dir / "logs" / "events.jsonl", [
        {
            "type": "scene",
            "actor": "keeper_under_test",
            "payload": {
                "scene_id": "front-door",
                "summary": "Ada King studies Corbitt House before entering.",
                "localized_text": {"ja-JP": {"summary": "エイダ・キングは入る前にコービット屋敷を観察する。"}},
            },
        },
        {
            "type": "decision",
            "actor": "ada-king",
            "payload": {
                "summary": "Ada King inspects the door instead of rushing in.",
                "localized_text": {"ja-JP": {"summary": "エイダ・キングは急いで入らず、扉を調べる。"}},
            },
        },
    ])
    write_jsonl(campaign_dir / "memory" / "session-summaries.jsonl", [
        {
            "session_id": "session-1",
            "summary": "Ada King reached Corbitt House and inspected the entrance.",
            "localized_text": {"ja-JP": {"summary": "エイダ・キングはコービット屋敷に着き、入口を調べた。"}},
        }
    ])
    write_jsonl(run_dir / "player-feedback.jsonl", [
        {
            "category": "immersion",
            "score": 5,
            "text": "KP kept the scene tense.",
            "localized_text": {"ja-JP": {"text": "KP は緊張感を保ってくれた。"}},
        }
    ])
    write_json(run_dir / "playtest.json", {
        "run_id": "localized-run",
        "campaign_id": "localized-run",
        "scenario": "The Haunting",
        "play_language": "ja-JP",
        "language_profile": {
            "language": "ja-JP",
            "display_name": "Table Japanese",
            "report_labels": {"goal": "狙い"},
            "report_value_labels": {"Table Japanese": "卓上日本語"},
        },
        "localized_terms": {
            "ja-JP": {
                "Ada King": "エイダ・キング",
                "The Haunting": "怪異の家",
                "Corbitt House": "コービット屋敷",
            }
        },
    })

    battle_path = coc_playtest_report.generate_battle_report(run_dir)
    battle_text = battle_path.read_text()

    assert "# プレイ報告 <!-- report-anchor: Battle Report -->" in battle_text
    assert "## 実行設定 <!-- report-anchor: Run Setup -->" in battle_text
    assert "プレイ言語: 卓上日本語" in battle_text
    assert "言語プロファイル: 卓上日本語" in battle_text
    assert "# Battle Report / プレイ報告" not in battle_text
    assert "Play Language: ja-JP" not in battle_text
    assert "プレイ言語: ja-JP" not in battle_text
    assert "Language Profile: Table Japanese" not in battle_text
    assert "言語プロファイル: Table Japanese" not in battle_text
    assert "エイダ・キングはコービット屋敷に到着する。" in battle_text
    assert "玄関の扉を調べます。" in battle_text
    assert "狙い：コービット屋敷の扉についた傷に気づく" in battle_text
    assert "エイダ・キングは急いで入らず、扉を調べる。" in battle_text
    assert "エイダ・キングはコービット屋敷に着き、入口を調べた。" in battle_text
    assert "KP は緊張感を保ってくれた。" in battle_text
    assert "Ada King arrives at Corbitt House." not in battle_text
