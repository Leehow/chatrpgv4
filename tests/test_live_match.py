"""Tests for coc_live_match: bridged player LLM vs KP match harness (N5)."""
from __future__ import annotations

import importlib.util
import json
import stat
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPT = REPO / "plugins" / "coc-keeper" / "scripts" / "coc_live_match.py"

# Distinct keeper-side prose that must never appear in player-brain requests.
SECRET_PROSE_FRAGMENTS = [
    "STR 100 CON 100 DEX 15 INT 25 POW 30; HP 100; tentacle slash",
    "probes and discards humans out of curiosity about these fragile successors",
    "White Friday disaster kills ~10,000; only the attribution of blame varies",
    "keeper-only shaft map coordinates 46.5N 12.1E under the ice seal",
]


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


match = _load("coc_live_match", SCRIPT)


def _write_scripted_player_runner(path: Path, lines: list[str]) -> None:
    """Stateful fake runner: emit scripted player_text lines in order."""
    lines_literal = json.dumps(lines, ensure_ascii=False)
    script = f"""#!/usr/bin/env python3
import json, sys
from pathlib import Path
state_path = Path(__file__).with_suffix(".state")
lines = {lines_literal}
idx = int(state_path.read_text()) if state_path.exists() else 0
req = json.loads(sys.stdin.read())
assert "public_state" in req and "character_card" in req
text = lines[min(idx, len(lines) - 1)]
state_path.write_text(str(idx + 1))
out = {{"ok": True, "player_text": text, "player_notes": f"note-for-turn-{{idx+1}}"}}
sys.stdout.write(json.dumps(out, ensure_ascii=False) + "\\n")
"""
    path.write_text(script, encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def _build_workspace(tmp_path: Path, *, with_secrets: bool = False) -> tuple[Path, str, str]:
    """Workspace layout matching runtime (.coc/campaigns + investigators)."""
    workspace = tmp_path / "ws"
    campaign_id = "match-drive"
    investigator_id = "inv1"
    camp = workspace / ".coc" / "campaigns" / campaign_id
    scn = camp / "scenario"
    save = camp / "save"
    save.mkdir(parents=True)
    (save / "investigator-state").mkdir()
    scn.mkdir(parents=True)
    (camp / "logs").mkdir(parents=True)
    (workspace / ".coc" / "runtime.json").write_text(
        json.dumps({"schema_version": 1, "brain": "debug"}),
        encoding="utf-8",
    )
    (camp / "campaign.json").write_text(
        json.dumps(
            {
                "campaign_id": campaign_id,
                "title": "Match Drive Campaign",
                "scenario_id": "match-drive",
                "era": "1920s",
                "dice_mode": "codex",
                "spoiler_policy": "warn_before_reveal",
                "play_language": "zh-Hans",
            }
        ),
        encoding="utf-8",
    )
    (save / "world-state.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "campaign_id": campaign_id,
                "active_scene_id": "scene-1",
                "discovered_clue_ids": [],
                "major_decisions": [],
            }
        ),
        encoding="utf-8",
    )
    (save / "pacing-state.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "tension_level": "low",
                "lethal_chances_used": 0,
                "recent_intent_classes": [],
                "turn_number": 0,
                "luck_spent_last": 0,
            }
        ),
        encoding="utf-8",
    )
    (save / "flags.json").write_text(
        json.dumps({"schema_version": 1, "clues_found": {}, "decisions": []}),
        encoding="utf-8",
    )
    (save / "investigator-state" / f"{investigator_id}.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "campaign_id": campaign_id,
                "investigator_id": investigator_id,
                "current_hp": 12,
                "current_san": 55,
                "current_mp": 11,
                "conditions": [],
                "skill_checks_earned": [],
            }
        ),
        encoding="utf-8",
    )
    char_dir = workspace / ".coc" / "investigators" / investigator_id
    char_dir.mkdir(parents=True)
    (char_dir / "character.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "id": investigator_id,
                "occupation": "Antiquarian",
                "era": "1920s",
                "characteristics": {"APP": 45, "LUCK": 55},
                "derived": {"HP": 12, "SAN": 55},
                "skills": {
                    "Credit Rating": 50,
                    "Spot Hidden": 60,
                    "Library Use": 55,
                },
                "backstory": {},
            }
        ),
        encoding="utf-8",
    )
    (scn / "story-graph.json").write_text(
        json.dumps(
            {
                "scenes": [
                    {
                        "scene_id": "scene-1",
                        "available_clues": ["c1"],
                        "dramatic_question": "q1",
                        "entry_conditions": [],
                        "exit_conditions": [],
                        "tone": ["tense"],
                        "allowed_improvisation": [],
                    },
                    {
                        "scene_id": "scene-2",
                        "available_clues": ["c2"],
                        "dramatic_question": "q2",
                        "entry_conditions": [],
                        "exit_conditions": [],
                        "tone": ["tense"],
                        "allowed_improvisation": [],
                    },
                    {
                        "scene_id": "scene-3",
                        "available_clues": ["c3"],
                        "dramatic_question": "q3",
                        "entry_conditions": [],
                        "exit_conditions": [],
                        "tone": ["tense"],
                        "allowed_improvisation": [],
                    },
                ]
            }
        ),
        encoding="utf-8",
    )
    (scn / "clue-graph.json").write_text(
        json.dumps(
            {
                "conclusions": [
                    {
                        "conclusion_id": "cc1",
                        "importance": "critical",
                        "minimum_routes": 3,
                        "clues": [
                            {
                                "clue_id": "c1",
                                "delivery": "x",
                                "delivery_kind": "environmental",
                                "visibility": "player-safe",
                            },
                            {
                                "clue_id": "c2",
                                "delivery": "y",
                                "delivery_kind": "environmental",
                                "visibility": "player-safe",
                            },
                            {
                                "clue_id": "c3",
                                "delivery": "z",
                                "delivery_kind": "environmental",
                                "visibility": "player-safe",
                            },
                        ],
                        "fallback_policy": "",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    secrets = []
    if with_secrets:
        secrets = [
            (
                "secret-polyp-horror-full-stat-block: STR 100 CON 100 DEX 15 INT 25 POW 30; "
                "HP 100; tentacle slash 60% Lethality 50%."
            ),
            (
                "secret-entity-motive-is-curiosity: the Polyp Horror probes and discards "
                "humans out of curiosity about these fragile successors to the Great Race."
            ),
            (
                "secret-white-friday-is-inevitable: regardless of the patrol's choices, on "
                "13 December 1916 the White Friday disaster kills ~10,000; only the "
                "attribution of blame varies."
            ),
            (
                "secret-shaft-map: keeper-only shaft map coordinates 46.5N 12.1E under the ice seal"
            ),
        ]
    (scn / "npc-agendas.json").write_text(
        json.dumps(
            {
                "npcs": [
                    {
                        "npc_id": "npc-guide",
                        "name": "向导",
                        "agenda": "hide the shaft",
                        "secret": secrets[0] if secrets else "",
                        "keeper_notes": secrets[3] if len(secrets) > 3 else "",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    (scn / "threat-fronts.json").write_text(json.dumps({"fronts": []}), encoding="utf-8")
    (scn / "pacing-map.json").write_text(
        json.dumps(
            {
                "pacing_curve": [
                    {"scene_id": "scene-1", "tension_target": "low", "horror_stage": "ordinary"},
                    {"scene_id": "scene-2", "tension_target": "medium", "horror_stage": "wrongness"},
                    {"scene_id": "scene-3", "tension_target": "high", "horror_stage": "revelation"},
                ]
            }
        ),
        encoding="utf-8",
    )
    (scn / "improvisation-boundaries.json").write_text(
        json.dumps(
            {
                "invent_allowed": [],
                "never_invent": [],
                "keeper_secrets": secrets or ["secret-1"],
            }
        ),
        encoding="utf-8",
    )
    (scn / "module-meta.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "scenario_id": "match-drive",
                "structure_type": "linear_acts",
                "era": "1920s",
                "content_flags": [],
                "win_condition": "x",
            }
        ),
        encoding="utf-8",
    )
    if with_secrets and secrets:
        # Also bury secret prose in story-graph summary (keeper-facing).
        story = json.loads((scn / "story-graph.json").read_text(encoding="utf-8"))
        story["scenes"][0]["keeper_summary"] = secrets[1]
        story["scenes"][0]["secret_outcome"] = secrets[2]
        (scn / "story-graph.json").write_text(json.dumps(story), encoding="utf-8")
    return workspace, campaign_id, investigator_id


def test_scripted_match_runs_three_plus_turns_end_to_end(tmp_path):
    workspace, campaign_id, investigator_id = _build_workspace(tmp_path)
    runner = tmp_path / "scripted_player"
    _write_scripted_player_runner(
        runner,
        [
            "我搜查场景一的痕迹。",
            "我继续跟进刚才发现的线索。",
            "我检查下一个可调查的方向。",
            "我再仔细看一遍现场。",
        ],
    )
    result = match.run_live_match(
        workspace,
        campaign_id,
        investigator_id,
        player_runner=runner,
        max_turns=3,
        rng_seed=42,
        live=False,
        intent_class="investigate",
    )
    assert len(result["turns"]) >= 3
    assert result["metadata"]["runner_kind"] == "scripted_fake"
    assert result["metadata"]["simulation_method"] == "bridged_scripted_player_not_live_llm"
    assert result["battle_report_path"]
    battle = Path(result["battle_report_path"]).read_text(encoding="utf-8")
    assert "我搜查场景一的痕迹" in battle or "实际跑团" in battle
    # player_notes captured for the report path
    assert any(t.get("player_notes") for t in result["player_turns"])


def test_metadata_honesty_live_false_is_not_gameplay_evidence(tmp_path):
    workspace, campaign_id, investigator_id = _build_workspace(tmp_path)
    runner = tmp_path / "scripted_player"
    _write_scripted_player_runner(runner, ["我环顾四周。"])
    result = match.run_live_match(
        workspace,
        campaign_id,
        investigator_id,
        player_runner=runner,
        max_turns=1,
        rng_seed=7,
        live=False,
        intent_class="investigate",
    )
    meta = result["metadata"]
    assert meta["live"] is False
    assert meta["runner_kind"] == "scripted_fake"
    assert meta["simulation_method"] == "bridged_scripted_player_not_live_llm"
    assert meta["player_profile"] != "external_llm_bridge"
    assert "never gameplay evidence" in meta["evidence_disclaimer"].lower()
    playtest = json.loads(
        (Path(result["run_dir"]) / "playtest.json").read_text(encoding="utf-8")
    )
    assert playtest["simulation_method"] == "bridged_scripted_player_not_live_llm"
    assert playtest["runner_kind"] == "scripted_fake"


def test_metadata_honesty_live_true_marks_external_bridge(tmp_path):
    workspace, campaign_id, investigator_id = _build_workspace(tmp_path)
    runner = tmp_path / "scripted_player"
    _write_scripted_player_runner(runner, ["我环顾四周。"])
    result = match.run_live_match(
        workspace,
        campaign_id,
        investigator_id,
        player_runner=runner,
        max_turns=1,
        rng_seed=7,
        live=True,
        intent_class="investigate",
    )
    meta = result["metadata"]
    assert meta["live"] is True
    assert meta["runner_kind"] == "live_bridge"
    assert meta["simulation_method"] == "live_llm_player_vs_kp"
    assert meta["player_profile"] == "external_llm_bridge"


def test_spoiler_isolation_player_requests_exclude_keeper_secret_prose(tmp_path):
    workspace, campaign_id, investigator_id = _build_workspace(tmp_path, with_secrets=True)
    runner = tmp_path / "scripted_player"
    _write_scripted_player_runner(
        runner,
        ["我搜查现场。", "我继续调查。", "我再看一眼。"],
    )
    result = match.run_live_match(
        workspace,
        campaign_id,
        investigator_id,
        player_runner=runner,
        max_turns=3,
        rng_seed=11,
        live=False,
        intent_class="investigate",
    )
    assert result["player_requests"], "expected captured player requests"
    for req in result["player_requests"]:
        blob = json.dumps(req, ensure_ascii=False)
        for fragment in SECRET_PROSE_FRAGMENTS:
            assert fragment not in blob, f"secret prose leaked into player request: {fragment!r}"
        # Structural spoiler sources must not be present as top-level keys.
        assert "keeper_secrets" not in req
        assert "story_graph" not in req
        assert "clue_graph" not in req
        assert "npc_agendas" not in req
        assert "director_plan" not in req
        assert "narrative_directives" not in req
