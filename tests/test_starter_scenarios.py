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


def test_install_starter_copies_scenario_files_and_character_creation_briefing(tmp_path):
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
    assert not (scenario_dir / "pregen-investigators.json").exists()

    campaign = json.loads((campaign_dir / "campaign.json").read_text("utf-8"))
    briefing_path = campaign["character_creation"]["briefing_path"]
    briefing = (root.parent / briefing_path).read_text("utf-8")
    assert "开卡序章" in briefing
    assert "意大利阿尔卑斯" in briefing
    assert "玩家可以自己创建调查员" in briefing
    assert "不要使用内置预设调查员" in briefing


def test_white_war_starter_does_not_ship_pregen_investigators():
    assert not (PLUGIN_ROOT / "references" / "starter-scenarios" / "the-white-war" / "pregen-investigators.json").exists()


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


# ---------------------------------------------------------------------------
# N2: the-haunting starter
# ---------------------------------------------------------------------------


def test_list_starter_scenarios_includes_the_haunting():
    starters = coc_starter.list_starter_scenarios()
    assert len(starters) >= 2
    haunting = next(s for s in starters if s["scenario_id"] == "the-haunting")
    assert haunting["title"] == "The Haunting"
    assert haunting["structure_type"] == "branching_investigation"
    assert haunting["era"] == "1920s"
    assert haunting["one_liner"]


def test_install_starter_the_haunting_copies_scenario_files(tmp_path):
    root = tmp_path / ".coc"
    import coc_state  # noqa: E402

    coc_state.ensure_workspace(root)
    coc_state.create_campaign(root, "haunt-camp", "Haunting Test", era="1920s")

    scenario_dir = coc_starter.install_starter(root, "haunt-camp", "the-haunting")
    for fname in coc_starter.STARTER_SCENARIO_FILES:
        assert (scenario_dir / fname).exists(), f"{fname} 未拷贝"

    campaign = json.loads((root / "campaigns" / "haunt-camp" / "campaign.json").read_text("utf-8"))
    assert campaign["active_scenario_id"] == "the-haunting"
    assert campaign["era"] == "1920s"

    story = json.loads((scenario_dir / "story-graph.json").read_text("utf-8"))
    assert any(s.get("is_start") for s in story["scenes"])
    assert any("scene_edges" in s for s in story["scenes"])
    starts = [s for s in story["scenes"] if s.get("is_start")]
    assert len(starts) == 1
    assert starts[0]["scene_edges"], "start scene must declare real scene_edges"


def test_the_haunting_passes_r5_validator_with_zero_errors():
    import coc_scenario_compile  # noqa: E402

    scenario_dir = (
        PLUGIN_ROOT / "references" / "starter-scenarios" / "the-haunting"
    )
    compiled = coc_scenario_compile.load_compiled_from_dir(scenario_dir)
    findings = coc_scenario_compile.validate_compiled_scenario(compiled)
    errors = [f for f in findings if f.get("severity") == "error"]
    assert errors == [], f"R-5 errors: {errors}"

    legacy = coc_scenario_compile.validate_scenario(scenario_dir)
    assert legacy["errors"] == [], f"legacy validate errors: {legacy['errors']}"


def test_the_haunting_critical_conclusions_have_multi_routes():
    clue_graph = json.loads(
        (
            PLUGIN_ROOT
            / "references"
            / "starter-scenarios"
            / "the-haunting"
            / "clue-graph.json"
        ).read_text("utf-8")
    )
    critical = [c for c in clue_graph["conclusions"] if c.get("importance") == "critical"]
    assert len(critical) >= 2
    for concl in critical:
        min_routes = int(concl.get("minimum_routes") or 3)
        distinct = {c["clue_id"] for c in concl.get("clues") or [] if c.get("clue_id")}
        assert len(distinct) >= min_routes, (
            f"{concl.get('conclusion_id')} has {len(distinct)} routes, need >={min_routes}"
        )


# ---------------------------------------------------------------------------
# N7: pregen investigators + quick_start
# ---------------------------------------------------------------------------


def test_the_haunting_ships_two_pregen_investigators():
    pregens = coc_starter.list_pregens("the-haunting")
    ids = {p["pregen_id"] for p in pregens}
    assert "thomas-hayes" in ids
    assert "eleanor-reed" in ids
    for pregen in pregens:
        sheet = json.loads(Path(pregen["character_path"]).read_text("utf-8"))
        assert sheet.get("id") == pregen["pregen_id"]
        assert sheet.get("era") == "1920s"
        assert "characteristics" in sheet
        assert "skills" in sheet
        assert "backstory" in sheet


def test_quick_start_installs_campaign_and_pregen(tmp_path):
    root = tmp_path / ".coc"
    result = coc_starter.quick_start(root, "the-haunting", "thomas-hayes")

    assert result["scenario_id"] == "the-haunting"
    assert result["investigator_id"] == "thomas-hayes"
    campaign_id = result["campaign_id"]
    campaign_dir = root / "campaigns" / campaign_id

    for fname in coc_starter.STARTER_SCENARIO_FILES:
        assert (campaign_dir / "scenario" / fname).exists()

    ws_char = root / "investigators" / "thomas-hayes" / "character.json"
    camp_char = campaign_dir / "investigators" / "thomas-hayes" / "character.json"
    assert ws_char.is_file()
    assert camp_char.is_file()
    assert result["character_path"] == str(ws_char)

    inv_state = campaign_dir / "save" / "investigator-state" / "thomas-hayes.json"
    assert inv_state.is_file()
    world = json.loads((campaign_dir / "save" / "world-state.json").read_text("utf-8"))
    assert world["status"] == "active"
    assert world["active_scene_id"]


def test_quick_start_then_run_live_turn_succeeds(tmp_path):
    import importlib.util

    root = tmp_path / ".coc"
    result = coc_starter.quick_start(root, "the-haunting", "eleanor-reed")
    campaign_dir = root / "campaigns" / result["campaign_id"]
    char_path = Path(result["character_path"])

    spec = importlib.util.spec_from_file_location(
        "coc_live_turn_runner",
        PLUGIN_ROOT / "scripts" / "coc_live_turn_runner.py",
    )
    live_runner = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(live_runner)

    turn_result = live_runner.run_live_turn(
        campaign_dir,
        char_path,
        result["investigator_id"],
        "我向房东确认委托细节，并询问还能去哪里查资料。",
        intent_class="investigate",
        rng_seed=42,
        recording_mode="fast",
        recording_flush="manual",
    )
    assert turn_result.get("turns"), "expected at least one applied turn"
    assert any(
        t.get("apply_path") == "coc_director_apply.apply_plan" for t in turn_result["turns"]
    )
