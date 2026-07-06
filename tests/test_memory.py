"""Tests for coc_memory: grep-native Markdown memory cards."""
import importlib.util
from pathlib import Path

import pytest


def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, rel)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


coc_memory = _load("coc_memory", "plugins/coc-keeper/scripts/coc_memory.py")


def _campaign(tmp_path):
    camp = tmp_path / "campaigns" / "test"
    (camp / "memory" / "cards" / "player-safe").mkdir(parents=True)
    (camp / "memory" / "cards" / "keeper-only").mkdir(parents=True)
    return camp


def test_create_memory_card_writes_markdown_with_frontmatter(tmp_path):
    camp = _campaign(tmp_path)
    path = coc_memory.create_memory_card(
        campaign_dir=camp,
        memory_id="mem-001-door-scratches",
        privacy="player_safe",
        salience=0.82,
        summary="玩家对门闩划痕非常在意，偏好近距离检查。",
        entities=["ada-king", "corbitt-house", "front-door"],
        tags=["player_interest", "physical_clue"],
        reactivation_cues=["door", "lock", "scratch"],
        source_events=["event-042"],
    )
    assert path.exists()
    text = path.read_text(encoding="utf-8")
    assert text.startswith("---\n")
    assert "memory_id: mem-001-door-scratches" in text
    assert "ada-king" in text
    assert "玩家对门闩划痕非常在意" in text  # body
    assert "player-safe" in str(path)  # privacy dir routing


def test_create_memory_card_keeper_only_routes_to_separate_dir(tmp_path):
    camp = _campaign(tmp_path)
    path = coc_memory.create_memory_card(
        campaign_dir=camp, memory_id="mem-002-corbitt-secret",
        privacy="keeper_only", salience=0.9,
        summary="Corbitt 埋在地下室（keeper only）。",
        entities=["corbitt"], tags=["secret"],
        reactivation_cues=["basement"], source_events=[],
    )
    assert "keeper-only" in str(path)
    assert "player-safe" not in str(path)


def test_retrieve_memory_cards_scores_by_entity_overlap(tmp_path):
    camp = _campaign(tmp_path)
    coc_memory.create_memory_card(
        campaign_dir=camp, memory_id="mem-door", privacy="player_safe",
        salience=0.8, summary="door interest",
        entities=["front-door", "corbitt-house"], tags=["player_interest"],
        reactivation_cues=["door"], source_events=[])
    coc_memory.create_memory_card(
        campaign_dir=camp, memory_id="mem-npc", privacy="player_safe",
        salience=0.5, summary="npc relation",
        entities=["npc-knott"], tags=["npc_relationship"],
        reactivation_cues=["knott"], source_events=[])
    results = coc_memory.retrieve_memory_cards(
        campaign_dir=camp,
        query_entities=["front-door", "corbitt-house"],
        query_cues=["door"], query_tags=[],
        privacy_filter="player_safe", limit=5,
    )
    assert len(results) >= 1
    assert results[0]["memory_id"] == "mem-door"  # highest entity overlap


def test_retrieve_excludes_wrong_privacy(tmp_path):
    camp = _campaign(tmp_path)
    coc_memory.create_memory_card(
        campaign_dir=camp, memory_id="mem-secret", privacy="keeper_only",
        salience=0.95, summary="secret", entities=["front-door"],
        tags=["x"], reactivation_cues=["door"], source_events=[])
    results = coc_memory.retrieve_memory_cards(
        campaign_dir=camp, query_entities=["front-door"],
        query_cues=["door"], query_tags=[], privacy_filter="player_safe", limit=5)
    assert all(r["privacy"] != "keeper_only" for r in results)


def test_build_context_pack_writes_markdown(tmp_path):
    camp = _campaign(tmp_path)
    coc_memory.create_memory_card(
        campaign_dir=camp, memory_id="mem-door", privacy="player_safe",
        salience=0.8, summary="door interest", entities=["front-door"],
        tags=["player_interest"], reactivation_cues=["door"], source_events=[])
    cards = coc_memory.retrieve_memory_cards(
        campaign_dir=camp, query_entities=["front-door"],
        query_cues=["door"], query_tags=[], privacy_filter="player_safe", limit=5)
    pack_path = coc_memory.build_context_pack(
        campaign_dir=camp, turn=42,
        active_scene_id="house-entry", dramatic_question="x?",
        player_intent="检查门", cards=cards,
        keeper_constraints=["不透露 corbitt-buried"])
    assert pack_path.exists()
    text = pack_path.read_text(encoding="utf-8")
    assert "turn-42" in str(pack_path) or "turn 42" in text.lower() or "42" in text
    assert "检查门" in text
    assert "mem-door" in text
