#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

PLUGIN_ROOT = Path(__file__).resolve().parent.parent / "plugins" / "coc-keeper"
SCRIPTS_DIR = PLUGIN_ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import coc_starter  # noqa: E402


def test_list_starter_scenarios_returns_white_war():
    starters = coc_starter.list_starter_scenarios()
    assert len(starters) >= 1
    ww = next(s for s in starters if s["scenario_id"] == "the-white-war")
    assert ww["title"] == "The White War"
    assert ww["structure_type"] == "linear_acts"
    assert ww["era"] == "ww1"
    assert isinstance(ww["content_flags"], list)
    assert "one_liner" in ww and ww["one_liner"]


def test_install_starter_copies_seven_files(tmp_path):
    root = tmp_path / ".coc"
    # 用 coc_state 建一个真 campaign
    sys.path.insert(0, str(SCRIPTS_DIR))
    import coc_state  # noqa: E402
    coc_state.ensure_workspace(root)
    campaign_path = coc_state.create_campaign(root, "test-camp", "Test", era="ww1")
    campaign_dir = campaign_path.parent

    scenario_dir = coc_starter.install_starter(root, "test-camp", "the-white-war")

    for fname in coc_starter.STARTER_SCENARIO_FILES:
        assert (scenario_dir / fname).exists(), f"{fname} 未拷贝"
    # pregen 也拷贝
    assert (scenario_dir / "pregen-investigators.json").exists()


def test_install_starter_writes_campaign_fields(tmp_path):
    root = tmp_path / ".coc"
    sys.path.insert(0, str(SCRIPTS_DIR))
    import coc_state  # noqa: E402
    coc_state.ensure_workspace(root)
    coc_state.create_campaign(root, "test-camp", "Test", era="ww1")

    coc_starter.install_starter(root, "test-camp", "the-white-war")

    campaign = json.loads(
        ((root / "campaigns" / "test-camp" / "campaign.json")).read_text("utf-8")
    )
    assert campaign["active_scenario_id"] == "the-white-war"
    assert campaign["era"] == "ww1"


def test_install_starter_resets_time_state_when_scenario_era_changes(tmp_path):
    root = tmp_path / ".coc"
    sys.path.insert(0, str(SCRIPTS_DIR))
    import coc_state  # noqa: E402
    coc_state.ensure_workspace(root)
    coc_state.create_campaign(root, "test-camp", "Test")

    before = json.loads((root / "campaigns" / "test-camp" / "save" / "time-state.json").read_text("utf-8"))
    coc_starter.install_starter(root, "test-camp", "the-white-war")
    after = json.loads((root / "campaigns" / "test-camp" / "save" / "time-state.json").read_text("utf-8"))

    assert before["clock"]["local_datetime"].startswith("1925-01-15")
    assert after["clock"]["local_datetime"].startswith("1916-12-12")
    assert after["clock"]["timezone"] == "Europe/Rome"


def test_install_starter_is_idempotent_error(tmp_path):
    """重复 install 同 scenario 应报错而非覆盖。"""
    root = tmp_path / ".coc"
    sys.path.insert(0, str(SCRIPTS_DIR))
    import coc_state  # noqa: E402
    coc_state.ensure_workspace(root)
    coc_state.create_campaign(root, "test-camp", "Test", era="ww1")
    coc_starter.install_starter(root, "test-camp", "the-white-war")

    with pytest.raises((FileExistsError, ValueError)):
        coc_starter.install_starter(root, "test-camp", "the-white-war")


def test_install_staller_unknown_scenario_errors(tmp_path):
    root = tmp_path / ".coc"
    sys.path.insert(0, str(SCRIPTS_DIR))
    import coc_state  # noqa: E402
    coc_state.ensure_workspace(root)
    coc_state.create_campaign(root, "test-camp", "Test", era="ww1")

    with pytest.raises((FileNotFoundError, ValueError)):
        coc_starter.install_starter(root, "test-camp", "nonexistent-scenario")


def test_ww1_era_registered_in_state_clocks():
    """coc_state 的 _ERA_CLOCKS 必须含 ww1，否则 install 后 campaign era 不匹配。"""
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "coc_state", PLUGIN_ROOT / "scripts" / "coc_state.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    # _ERA_CLOCKS 是 _initialize_campaign_runtime_files 内的局部字典；
    # 通过创建一个 ww1 campaign 检查 time-state 来间接验证。
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        root = Path(td) / ".coc"
        mod.ensure_workspace(root)
        mod.create_campaign(root, "era-test", "Test", era="ww1")
        ts = json.loads((root / "campaigns" / "era-test" / "save" / "time-state.json").read_text("utf-8"))
        assert ts["clock"]["local_datetime"].startswith("1916-12"), f"ww1 era 时钟未指向 1916-12: {ts['clock']['local_datetime']}"
