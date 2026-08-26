#!/usr/bin/env python3
"""Starter install copies optional scenario/quests.json when the source ships it.

tests/test_starter_scenarios.py is dirty on the main tree (other lane), so this
file owns the quests.json install assertion instead of extending that suite.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parent.parent / "plugins" / "coc-keeper"
SCRIPTS_DIR = PLUGIN_ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import coc_starter  # noqa: E402
import coc_state  # noqa: E402

HAUNTING_QUEST_IDS = (
    "quest-knott-commission",
    "quest-retrieve-chapel-journal",
    "quest-end-corbitt-threat",
)


def test_install_starter_the_haunting_copies_optional_quests_store(tmp_path):
    root = tmp_path / ".coc"
    coc_state.ensure_workspace(root)
    coc_state.create_campaign(root, "haunt-quests", "Quest Install Test", era="1920s")

    scenario_dir = coc_starter.install_starter(
        root, "haunt-quests", "the-haunting"
    )

    quests_path = scenario_dir / "quests.json"
    assert quests_path.is_file(), "the-haunting starter must copy quests.json"
    store = json.loads(quests_path.read_text("utf-8"))
    assert store["schema_version"] == 1
    ids = [row["quest_id"] for row in store["quests"]]
    assert ids == list(HAUNTING_QUEST_IDS)


def test_install_starter_white_war_omits_quests_when_source_has_none(tmp_path):
    root = tmp_path / ".coc"
    coc_state.ensure_workspace(root)
    coc_state.create_campaign(root, "ww-quests", "White War Quest Test", era="ww1")

    scenario_dir = coc_starter.install_starter(root, "ww-quests", "the-white-war")

    assert not (scenario_dir / "quests.json").exists()
    for fname in coc_starter.STARTER_SCENARIO_FILES:
        assert (scenario_dir / fname).is_file(), f"{fname} 未拷贝"
