import importlib.util
import json
import re
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


def test_format_roll_recap_displays_bonus_die_components():
    event = {
        "type": "roll",
        "actor": "ada-king",
        "payload": {
            "skill": "Spot Hidden",
            "target": 37,
            "effective_target": 37,
            "roll": 11,
            "outcome": "hard_success",
            "bonus": 1,
            "penalty": 0,
            "tens_values": [4, 1],
            "units": 1,
        },
    }

    recap = coc_playtest_report._format_roll_recap(
        event,
        {"ada-king": "艾达·金"},
        {"Spot Hidden": "侦查"},
        "zh-Hans",
        {
            "report_labels": {
                "roll_sentence": "- {skill}：{actor}掷出 {roll} / {target}，结果{outcome}。",
            },
            "outcome_labels": {"hard_success": "困难成功"},
        },
    )

    assert "奖励骰：个位 1，十位 4/1，取 1 -> 11/37，困难成功" in recap


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


def visible_markdown_text(markdown: str) -> str:
    return re.sub(r"<!--.*?-->", "", markdown, flags=re.DOTALL)


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
        "simulation_method": "transcript_driven_virtual_table",
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
    assert "Campaign ID: run-1" in battle_text
    assert "Campaign: The Haunting Test" in battle_text
    assert "Audit Profile: haunting_module" in battle_text
    assert "Simulation Method: transcript_driven_virtual_table" in battle_text
    assert "Era: 1920s" in battle_text
    assert "Dice Mode: codex" in battle_text
    assert "Spoiler Policy: warn_before_reveal" in battle_text
    assert "## Module" in battle_text
    assert "scenario-id: the-haunting" in battle_text
    assert "Scenario ID: the-haunting" in visible_markdown_text(battle_text)
    assert "Source: pdf/the-haunting.pdf" in battle_text
    assert "## Character Dossier" in battle_text
    assert "Ada King" in battle_text
    assert "investigator-id: ada-king" in battle_text
    assert "Ada King (ada-king)" not in visible_markdown_text(battle_text)
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


def test_battle_report_renders_storylet_moves_as_readable_scene_beats(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "storylet-run"
    campaign_dir = run_dir / "sandbox" / ".coc" / "campaigns" / "storylet-run"

    write_json(campaign_dir / "campaign.json", {
        "campaign_id": "storylet-run",
        "title": "Masks Probe",
        "scenario_id": "peru-prologue",
        "era": "1920s",
        "dice_mode": "codex",
        "spoiler_policy": "warn_before_reveal",
        "play_language": "zh-Hans",
    })
    write_json(campaign_dir / "party.json", {"investigator_ids": []})
    write_json(campaign_dir / "scenario" / "scenario.json", {
        "scenario_id": "peru-prologue",
        "title": "Masks Probe",
        "module_source": "pdf/masks.pdf",
        "opening_scene": "利马的档案馆气味潮湿。",
    })
    write_json(campaign_dir / "scenario" / "clue-graph.json", {
        "conclusions": [{
            "conclusion_id": "archive-thread",
            "clues": [{
                "clue_id": "ledger-mark",
                "delivery": "登记簿边缘的灰尘断痕",
                "visibility": "player-safe",
            }],
        }],
    })
    write_jsonl(run_dir / "transcript.jsonl", [])
    write_jsonl(campaign_dir / "logs" / "rolls.jsonl", [])
    write_jsonl(campaign_dir / "logs" / "events.jsonl", [
        {
            "event_type": "clue_reveal",
            "actor": "keeper_under_test",
            "decision_id": "turn-001",
            "clue_id": "ledger-mark",
            "summary": "clue revealed: ledger-mark",
        },
        {
            "event_type": "storylet_move",
            "actor": "keeper_under_test",
            "storylet_id": "low-paper-wrong-date",
            "title": "错误日期的纸张",
            "family_id": "ambient_anomaly",
            "trope_id": "impossible_admin_detail",
            "conflict_level": "low",
            "target_conflict_level": "low",
            "cue": "一张文件、票据或收据的日期与玩家刚刚确认的时间差了一天。",
            "beat": "把一个可调查的细节轻轻推到台前，让玩家主动追问它为什么不对。",
            "rolled_variants": {
                "sensory_detail_1d6": "空气里有一丝金属、海盐或冷灰的味道。",
                "complication_1d6": "档案员看见警卫后停顿了一瞬。",
            },
            "bound_entities": {
                "scene_id": "archive-room",
                "clue_id": "ledger-mark",
                "front_id": "cult-watch",
                "clock_id": "cult-alert",
            },
            "serves": ["mainline", "can_reveal_clue", "can_surface_choice"],
        },
        {
            "event_type": "scene_transition",
            "actor": "keeper_under_test",
            "decision_id": "turn-001",
            "from_scene": "archive-room",
            "to_scene": "street-exit",
        },
    ])
    write_jsonl(campaign_dir / "memory" / "session-summaries.jsonl", [])
    write_jsonl(run_dir / "player-feedback.jsonl", [])
    write_json(run_dir / "playtest.json", {
        "run_id": "storylet-run",
        "campaign_id": "storylet-run",
        "scenario": "Masks Probe",
        "play_language": "zh-Hans",
    })

    battle_path = coc_playtest_report.generate_battle_report(run_dir)
    battle_text = battle_path.read_text()
    scene_replay = section_text(battle_text, "Scene-by-Scene Replay")
    state_changes = section_text(battle_text, "State Changes")
    clues_found = section_text(battle_text, "Clues Found")
    visible_scene = visible_markdown_text(scene_replay)
    visible_state = visible_markdown_text(state_changes)
    visible_clues = visible_markdown_text(clues_found)

    assert "调查员确认了线索：登记簿边缘的灰尘断痕。" in scene_replay
    assert "剧情片段：一张文件、票据或收据的日期与玩家刚刚确认的时间差了一天。" in scene_replay
    assert "空气里有一丝金属、海盐或冷灰的味道。" in scene_replay
    assert "档案员看见警卫后停顿了一瞬。" in scene_replay
    assert "场景推进。" in scene_replay
    assert "线索已记录：登记簿边缘的灰尘断痕。" in state_changes
    assert "场景推进。" in state_changes
    assert "线索：登记簿边缘的灰尘断痕。" in clues_found
    assert "No clues recorded" not in clues_found
    assert "storylet-id: low-paper-wrong-date" in scene_replay
    assert "clue-id: ledger-mark" in clues_found
    for leaked in (
        "low-paper-wrong-date",
        "archive-room",
        "street-exit",
        "cult-watch",
        "cult-alert",
        "ledger-mark",
        "storylet move",
        "event: unknown",
    ):
        assert leaked not in visible_scene
        assert leaked not in visible_state
    assert "ledger-mark" not in visible_clues


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
    write_json(campaign_dir / "scenario" / "handouts.json", [
        {
            "id": "front-door-note",
            "label": "Handout A",
            "title": "Door note",
            "summary": "The note points to fresh scratches.",
            "content": "Ask Mr. Knott about fresh scratches before entering Corbitt House.",
            "localized_text": {
                "ja-JP": {
                    "label": "ハンドアウトA",
                    "title": "扉のメモ",
                    "summary": "メモは新しい傷を示している。",
                    "content": "コービット屋敷に入る前に、扉の新しい傷についてノット氏に尋ねる。",
                }
            },
        }
    ])
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
    assert "ハンドアウトA: 扉のメモ" in battle_text
    assert "メモは新しい傷を示している。" in battle_text
    assert "コービット屋敷に入る前に、扉の新しい傷についてノット氏に尋ねる。" in battle_text
    assert "Ask Mr. Knott about fresh scratches before entering Corbitt House." not in battle_text
    assert "エイダ・キングはコービット屋敷に到着する。" in battle_text
    assert "玄関の扉を調べます。" in battle_text
    assert "狙い：コービット屋敷の扉についた傷に気づく" in battle_text
    assert "エイダ・キングは急いで入らず、扉を調べる。" in battle_text
    assert "エイダ・キングはコービット屋敷に着き、入口を調べた。" in battle_text
    assert "KP は緊張感を保ってくれた。" in battle_text
    assert "Ada King arrives at Corbitt House." not in battle_text


def test_actual_play_renders_player_notes_as_sub_bullet(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "notes-run"
    campaign_dir = run_dir / "sandbox" / ".coc" / "campaigns" / "notes-run"
    (campaign_dir / "logs").mkdir(parents=True)
    (campaign_dir / "memory").mkdir(parents=True)
    (campaign_dir / "scenario").mkdir(parents=True)
    (run_dir / "artifacts").mkdir(parents=True)
    write_json(run_dir / "playtest.json", {
        "run_id": "notes-run",
        "campaign_id": "notes-run",
        "scenario": "Notes",
        "play_language": "zh-Hans",
    })
    write_json(campaign_dir / "campaign.json", {
        "campaign_id": "notes-run",
        "title": "Notes",
        "play_language": "zh-Hans",
    })
    write_jsonl(run_dir / "transcript.jsonl", [
        {
            "turn": 1,
            "role": "player_simulator",
            "speaker": "Investigator",
            "mode": "play",
            "intent": "我检查门框。",
            "text": "我检查门框。",
            "player_notes": "turn 1: look for tool marks",
        },
        {
            "turn": 2,
            "role": "keeper_under_test",
            "speaker": "KP",
            "mode": "play",
            "ruling": "揭示线索",
            "text": "你确认了线索：门框划痕。",
        },
    ])
    write_jsonl(campaign_dir / "logs" / "events.jsonl", [])
    write_jsonl(campaign_dir / "logs" / "rolls.jsonl", [])
    write_jsonl(campaign_dir / "memory" / "session-summaries.jsonl", [])
    write_jsonl(run_dir / "player-feedback.jsonl", [])

    battle_path = coc_playtest_report.generate_battle_report(run_dir)
    battle_text = battle_path.read_text(encoding="utf-8")
    assert "[player_notes]" not in battle_text
    assert "玩家笔记" in battle_text or "player notes" in battle_text.lower()
    assert "turn 1: look for tool marks" in battle_text


def test_state_changes_include_scene_unlock_and_game_time_payload(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "state-payload"
    campaign_dir = run_dir / "sandbox" / ".coc" / "campaigns" / "state-payload"
    (campaign_dir / "logs").mkdir(parents=True)
    (campaign_dir / "memory").mkdir(parents=True)
    (campaign_dir / "scenario").mkdir(parents=True)
    (run_dir / "artifacts").mkdir(parents=True)
    write_json(run_dir / "playtest.json", {
        "run_id": "state-payload",
        "campaign_id": "state-payload",
        "scenario": "State",
        "play_language": "zh-Hans",
    })
    write_json(campaign_dir / "campaign.json", {
        "campaign_id": "state-payload",
        "title": "State",
        "play_language": "zh-Hans",
    })
    write_jsonl(run_dir / "transcript.jsonl", [])
    write_jsonl(campaign_dir / "logs" / "events.jsonl", [
        {
            "event_type": "scene_unlocked",
            "decision_id": "turn-001",
            "to_scene": "crossing-saddle",
            "investigator_id": "inv1",
            "ts": "2026-07-10T05:47:16Z",
        },
        {
            "event_type": "game_time",
            "investigator_id": "inv1",
            "decision_id": "turn-001",
            "from_elapsed": 0,
            "to_elapsed": 30,
            "delta_minutes": 30,
            "mode": "elapsed",
            "category": "local_travel",
            "reason": "director proposal for CUT",
            "player_visible": "",
            "fired_triggers": [],
        },
    ])
    write_jsonl(campaign_dir / "logs" / "rolls.jsonl", [])
    write_jsonl(campaign_dir / "memory" / "session-summaries.jsonl", [])
    write_jsonl(run_dir / "player-feedback.jsonl", [])

    battle_path = coc_playtest_report.generate_battle_report(run_dir)
    battle_text = battle_path.read_text(encoding="utf-8")
    assert "scene unlocked recorded" not in battle_text
    assert "game time recorded" not in battle_text
    assert "crossing-saddle" in battle_text
    assert "+30" in battle_text or "30m" in battle_text


def test_battle_report_uses_module_meta_title_not_campaign_title(tmp_path):
    """Module section should prefer module-meta.json title over campaign title."""
    run_dir = tmp_path / ".coc" / "playtests" / "masks-title"
    campaign_dir = run_dir / "sandbox" / ".coc" / "campaigns" / "masks-peru-live"
    investigator_dir = run_dir / "sandbox" / ".coc" / "investigators" / "thomas-hayes"
    for path in (run_dir, campaign_dir / "scenario", campaign_dir / "logs", campaign_dir / "memory", investigator_dir):
        path.mkdir(parents=True, exist_ok=True)

    write_json(campaign_dir / "campaign.json", {
        "campaign_id": "masks-peru-live",
        "title": "Masks Peru Live",
        "era": "1920s",
        "dice_mode": "codex",
        "spoiler_policy": "warn_before_reveal",
    })
    write_json(campaign_dir / "party.json", {"investigator_ids": ["thomas-hayes"]})
    # No scenario.json — compiled packages ship module-meta.json only.
    write_json(campaign_dir / "scenario" / "module-meta.json", {
        "schema_version": 1,
        "scenario_id": "masks-of-nyarlathotep-ch-peru",
        "title": "Masks of Nyarlathotep — Prologue: Peru",
        "structure_type": "hub_sandbox",
        "era": "1920s",
        "content_flags": [],
        "win_condition": "survive",
    })
    write_json(investigator_dir / "character.json", {
        "id": "thomas-hayes",
        "name": "托马斯·海斯",
        "occupation": "私家侦探",
        "era": "1920s",
        "characteristics": {"STR": 60, "CON": 55, "SIZ": 65, "DEX": 60, "APP": 50, "INT": 70, "POW": 55, "EDU": 65},
        "derived": {"HP": 12, "MP": 11, "SAN": 55, "MOV": 7, "damage_bonus": "0", "build": 1},
        "skills": {"Library Use": 40},
        "backstory": {
            "scenario_id": "the-haunting",
            "scenario_bound": {
                "description": "Knott 的委托听起来像又一次清清恶名。",
                "significant_people": "前搭档失踪。",
                "meaningful_locations": "克莱恩街附近的办公室。",
            },
            "traits": ["先查纸再上门"],
            "ideology": "真相值钱。",
            "treasured_possessions": "父亲留下的 .38。",
        },
    })
    write_jsonl(run_dir / "transcript.jsonl", [])
    write_jsonl(campaign_dir / "logs" / "rolls.jsonl", [])
    write_jsonl(campaign_dir / "logs" / "events.jsonl", [])
    write_jsonl(campaign_dir / "memory" / "session-summaries.jsonl", [])
    write_jsonl(run_dir / "player-feedback.jsonl", [])
    write_json(run_dir / "playtest.json", {
        "run_id": "masks-title",
        "campaign_id": "masks-peru-live",
        "campaign_title": "Masks Peru Live",
        # Live-match historically stamped campaign title here — report must not prefer it.
        "scenario": "Masks Peru Live",
        "scenario_id": "masks-peru-live",
        "era": "1920s",
        "dice_mode": "codex",
        "spoiler_policy": "warn_before_reveal",
        "simulation_method": "live_llm_player_vs_kp",
    })

    battle_text = coc_playtest_report.generate_battle_report(run_dir).read_text(encoding="utf-8")
    visible = visible_markdown_text(battle_text)
    assert "Campaign: Masks Peru Live" in visible or "战役: Masks Peru Live" in battle_text
    assert "Masks of Nyarlathotep — Prologue: Peru" in battle_text
    assert "Scenario ID: masks-of-nyarlathotep-ch-peru" in visible or "模组 ID: masks-of-nyarlathotep-ch-peru" in battle_text
    # Campaign title must not leak into the Module/Scenario field.
    module_section = battle_text.split("## Module")[-1] if "## Module" in battle_text else battle_text.split("## 模组")[-1]
    module_header = module_section.split("## ")[0]
    assert "Masks of Nyarlathotep — Prologue: Peru" in module_header
    assert "Scenario: Masks Peru Live" not in visible_markdown_text(module_header)
    # Scenario-bound Haunting prose omitted when campaign scenario differs.
    assert "Knott" not in battle_text
    assert "克莱恩街" not in battle_text
    assert "先查纸再上门" in battle_text
    assert "真相值钱" in battle_text


def test_battle_report_keeps_scenario_bound_backstory_when_scenario_matches(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "haunting-bound"
    campaign_dir = run_dir / "sandbox" / ".coc" / "campaigns" / "haunting-run"
    investigator_dir = run_dir / "sandbox" / ".coc" / "investigators" / "thomas-hayes"
    for path in (run_dir, campaign_dir / "scenario", campaign_dir / "logs", campaign_dir / "memory", investigator_dir):
        path.mkdir(parents=True, exist_ok=True)

    write_json(campaign_dir / "campaign.json", {
        "campaign_id": "haunting-run",
        "title": "Haunting Run",
        "scenario_id": "the-haunting",
        "era": "1920s",
        "dice_mode": "codex",
        "spoiler_policy": "warn_before_reveal",
    })
    write_json(campaign_dir / "party.json", {"investigator_ids": ["thomas-hayes"]})
    write_json(campaign_dir / "scenario" / "module-meta.json", {
        "schema_version": 1,
        "scenario_id": "the-haunting",
        "title": "The Haunting",
        "structure_type": "branching_investigation",
        "era": "1920s",
        "content_flags": [],
        "win_condition": "survive",
    })
    write_json(investigator_dir / "character.json", {
        "id": "thomas-hayes",
        "name": "托马斯·海斯",
        "occupation": "私家侦探",
        "era": "1920s",
        "characteristics": {"STR": 60, "CON": 55, "SIZ": 65, "DEX": 60, "APP": 50, "INT": 70, "POW": 55, "EDU": 65},
        "derived": {"HP": 12, "MP": 11, "SAN": 55, "MOV": 7, "damage_bonus": "0", "build": 1},
        "skills": {"Library Use": 40},
        "backstory": {
            "scenario_id": "the-haunting",
            "scenario_bound": {
                "description": "Knott 的委托听起来像又一次清清恶名。",
                "meaningful_locations": "克莱恩街附近的办公室。",
            },
            "traits": ["先查纸再上门"],
        },
    })
    write_jsonl(run_dir / "transcript.jsonl", [])
    write_jsonl(campaign_dir / "logs" / "rolls.jsonl", [])
    write_jsonl(campaign_dir / "logs" / "events.jsonl", [])
    write_jsonl(campaign_dir / "memory" / "session-summaries.jsonl", [])
    write_jsonl(run_dir / "player-feedback.jsonl", [])
    write_json(run_dir / "playtest.json", {
        "run_id": "haunting-bound",
        "campaign_id": "haunting-run",
        "campaign_title": "Haunting Run",
        "scenario": "The Haunting",
        "scenario_id": "the-haunting",
        "era": "1920s",
        "dice_mode": "codex",
        "spoiler_policy": "warn_before_reveal",
        "simulation_method": "transcript_driven_virtual_table",
    })

    battle_text = coc_playtest_report.generate_battle_report(run_dir).read_text(encoding="utf-8")
    assert "Knott" in battle_text
    assert "克莱恩街" in battle_text
    assert "先查纸再上门" in battle_text


def test_battle_report_renders_narrative_adherence_section(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "adherence-run"
    campaign_dir = run_dir / "sandbox" / ".coc" / "campaigns" / "adherence-run"
    investigator_dir = run_dir / "sandbox" / ".coc" / "investigators" / "ada-king"
    write_json(campaign_dir / "campaign.json", {
        "campaign_id": "adherence-run",
        "title": "Adherence Fixture",
        "scenario_id": "the-haunting",
        "era": "1920s",
        "dice_mode": "codex",
        "spoiler_policy": "warn_before_reveal",
        "status": "active",
    })
    write_json(campaign_dir / "party.json", {"investigator_ids": ["ada-king"]})
    write_json(campaign_dir / "scenario" / "scenario.json", {
        "scenario_id": "the-haunting",
        "title": "The Haunting",
    })
    write_json(investigator_dir / "character.json", {
        "id": "ada-king",
        "name": "Ada King",
        "occupation": "Antiquarian",
        "era": "1920s",
        "characteristics": {"STR": 50, "CON": 50, "SIZ": 50, "DEX": 50, "APP": 50, "INT": 50, "POW": 50, "EDU": 50},
        "derived": {"HP": 10, "MP": 10, "SAN": 50, "MOV": 8, "damage_bonus": "0", "build": 0},
        "skills": {},
        "backstory": {},
    })
    write_json(run_dir / "playtest.json", {
        "run_id": "adherence-run",
        "campaign_id": "adherence-run",
        "player_profile": "balanced",
        "narrative_adherence": {
            "required_coverage": 0.5,
            "statements": [
                {
                    "statement_id": "conclusion:c1",
                    "kind": "required",
                    "description": "Reach basement burial conclusion",
                    "criterion": {"conclusion_id": "c1"},
                    "satisfied": True,
                },
                {
                    "statement_id": "terminal:end",
                    "kind": "required",
                    "description": "Reach final confrontation",
                    "criterion": {"scene_id": "end"},
                    "satisfied": False,
                },
                {
                    "statement_id": "npc:npc-1",
                    "kind": "optional",
                    "description": "Engage Knott",
                    "criterion": {"npc_id": "npc-1"},
                    "satisfied": True,
                },
            ],
        },
    })
    write_jsonl(run_dir / "transcript.jsonl", [])
    write_jsonl(run_dir / "player-feedback.jsonl", [])
    (campaign_dir / "logs").mkdir(parents=True, exist_ok=True)
    (campaign_dir / "memory").mkdir(parents=True, exist_ok=True)
    write_jsonl(campaign_dir / "logs" / "rolls.jsonl", [])
    write_jsonl(campaign_dir / "logs" / "events.jsonl", [])
    write_jsonl(campaign_dir / "memory" / "session-summaries.jsonl", [])

    battle_path = coc_playtest_report.generate_battle_report(run_dir)
    text = battle_path.read_text(encoding="utf-8")
    assert "Narrative Adherence" in text or "叙事贴合" in text
    assert "50%" in text or "0.5" in text
    assert "✓" in text
    assert "✗" in text
    assert "Reach basement burial conclusion" in text
    assert "Reach final confrontation" in text
