"""A parse that lands after the party has left may add, and may not rewrite.

The reader runs in the background while play goes on, so a section finishing
late is the normal case rather than the exceptional one. Everything a pack
carries is additive -- a clue, an NPC, a route -- except four fields, and those
four are exactly what a rewrite would take back from the table: the boxed text
was already read out, the Keeper has been working from those notes, that
summary is what the players heard, and a sanity trigger the party already went
through would be re-armed and fire a second time on a horror they finished.

This is the shape of a failure already on record here, where deep packs from an
older parse overwrote scene topology on every entry and quietly took the map
apart while people were playing on it.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
sys.path.insert(0, str(SCRIPTS))
_spec = importlib.util.spec_from_file_location(
    "coc_module_project_played", SCRIPTS / "coc_module_project.py"
)
project = importlib.util.module_from_spec(_spec)
sys.modules["coc_module_project_played"] = project
_spec.loader.exec_module(project)


def _ir(**scene):
    base = {"scene_id": "cellar", "display_name": "地窖"}
    base.update(scene)
    # Every IR file the merge upserts across, so the fixture exercises the
    # real path rather than the first branch that happens to run.
    return {
        "story-graph.json": {"scenes": [base]},
        "clue-graph.json": {"conclusions": [], "clues": []},
        "npc-agendas.json": {"npcs": []},
        "pacing-map.json": {"beats": []},
        "improvisation-boundaries.json": {"boundaries": []},
        # The graph owns the map, so a pack cannot rewrite topology either.
        "module-meta.json": {"topology_authority": "module_graph"},
    }


def _pack(**over):
    pack = {
        "location_id": "cellar", "title": "地窖",
        "read_aloud": [{"text": "后来解析出来的引导文", "trigger": "进入地窖时",
                        "source_refs": [{"pdf_index": 7}]}],
        "keeper_only": [{"note": "后来解析出来的守密人注记"}],
        "player_safe_summary": "后来解析出来的摘要",
        "san_triggers": [{"trigger_id": "san-cellar", "trigger": "看见地窖里的东西",
                          "loss": "1/1D4"}],
    }
    pack.update(over)
    return pack


def test_a_scene_the_party_has_played_keeps_what_the_table_heard():
    played = _ir(
        read_aloud=[{"text": "KP 当时念的那段", "trigger": "进入地窖时"}],
        keeper_only=[{"note": "KP 当时用的注记"}],
        player_safe_summary="玩家听到的是这句",
        on_enter={"san_triggers": [{"trigger_id": "san-cellar", "resolved": True}]},
    )
    out = project.merge_deep_location_into_ir(played, _pack(), played={"cellar"})
    scene = out["story-graph.json"]["scenes"][0]
    assert scene["read_aloud"] == [{"text": "KP 当时念的那段", "trigger": "进入地窖时"}]
    assert scene["keeper_only"] == [{"note": "KP 当时用的注记"}]
    assert scene["player_safe_summary"] == "玩家听到的是这句"
    assert scene["on_enter"]["san_triggers"][0]["resolved"] is True, (
        "a horror the party already went through was re-armed"
    )


def test_a_scene_nobody_has_entered_takes_the_parse():
    out = project.merge_deep_location_into_ir(
        _ir(read_aloud=[{"text": "占位"}]), _pack(), played=set(),
    )
    scene = out["story-graph.json"]["scenes"][0]
    assert scene["read_aloud"][0]["text"] == "后来解析出来的引导文"
    assert scene["player_safe_summary"] == "后来解析出来的摘要"
    assert scene["on_enter"]["san_triggers"][0]["trigger_id"] == "san-cellar"


def test_a_played_scene_still_takes_what_it_was_missing():
    """Protecting what happened is not refusing what was never there."""
    out = project.merge_deep_location_into_ir(
        _ir(read_aloud=[{"text": "KP 当时念的那段", "trigger": "进入地窖时"}]),
        _pack(), played={"cellar"},
    )
    scene = out["story-graph.json"]["scenes"][0]
    assert scene["read_aloud"] == [{"text": "KP 当时念的那段", "trigger": "进入地窖时"}]
    assert scene["keeper_only"] == [{"note": "后来解析出来的守密人注记"}]
    assert scene["player_safe_summary"] == "后来解析出来的摘要"


def test_played_scenes_are_read_from_the_campaigns_own_record(tmp_path: Path):
    save = tmp_path / "save"
    save.mkdir()
    (save / "world-state.json").write_text(json.dumps({
        "active_scene_id": "library",
        "visited_scene_ids": ["opening", "cellar"],
        "scene_history": [{"scene_id": "attic"}, "roof"],
    }), encoding="utf-8")
    assert project.played_scene_ids(tmp_path) == {
        "opening", "cellar", "library", "attic", "roof"}


def test_a_campaign_with_no_record_yet_has_played_nothing(tmp_path: Path):
    assert project.played_scene_ids(tmp_path) == set()


def test_the_scene_the_party_is_standing_in_counts_as_played():
    """Landing while they are in the room is the worst moment to rewrite it."""
    played = _ir(player_safe_summary="他们正在听的这句")
    out = project.merge_deep_location_into_ir(played, _pack(), played={"cellar"})
    assert out["story-graph.json"]["scenes"][0][
        "player_safe_summary"] == "他们正在听的这句"


def test_the_field_list_is_declared_where_it_can_be_read():
    assert set(project.PLAYED_SCENE_FIELDS) == {
        "read_aloud", "keeper_only", "player_safe_summary"}
    assert set(project.PLAYED_ON_ENTER_FIELDS) == {"san_triggers"}
