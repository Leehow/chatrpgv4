#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import sys
import threading
from pathlib import Path
from typing import Any

import pytest

PLUGIN_ROOT = Path(__file__).resolve().parent.parent / "plugins" / "coc-keeper"
SCRIPTS_DIR = PLUGIN_ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import coc_starter  # noqa: E402


def test_starter_investigation_affordances_bind_exact_clues_structurally():
    def scene(scenario_id, scene_id):
        graph = json.loads((
            PLUGIN_ROOT / "references" / "starter-scenarios" / scenario_id
            / "story-graph.json"
        ).read_text("utf-8"))
        return next(row for row in graph["scenes"] if row["scene_id"] == scene_id)

    ground = scene("the-haunting", "corbitt-house-ground")
    ground_routes = {row["id"]: row for row in ground["affordances"]}
    assert ground_routes["force-cupboard"]["clue_id"] == "clue-corbitt-diaries"
    assert ground_routes["survey-locks-bolts"]["clue_id"] == "clue-nailed-windows"
    assert ground_routes["listen-upstairs"]["clue_id"] == "clue-upstairs-disturbance"
    assert ground_routes["inspect-catholic-wards"]["clue_id"] == "clue-catholic-wards"

    newspaper = scene("the-haunting", "newspaper-morgue")
    newspaper_routes = {row["id"]: row for row in newspaper["affordances"]}
    assert newspaper_routes["search-clippings"]["grants_clue_ids"] == [
        "clue-globe-unpublished-story", "clue-macario-tragedy",
    ]
    assert newspaper_routes["persuade-arty"]["target_entities"] == ["Arty Wilmot"]
    assert newspaper_routes["befriend-ruth"]["clue_id"] == "clue-globe-fire-cutoff"
    assert newspaper_routes["befriend-ruth"]["requires_completed_route_ids"] == [
        "persuade-arty"
    ]

    blast = scene("the-white-war", "blast-chamber")
    blast_routes = {row["id"]: row for row in blast["affordances"]}
    assert blast_routes["examine-blast-carnage"]["grants_clue_ids"] == [
        "clue-massacred-austrians", "clue-superhuman-strength-wounds",
    ]
    assert blast_routes["map-tunnel-and-shaft"]["grants_clue_ids"] == [
        "clue-basalt-shaft-no-echo", "clue-drag-marks-into-shaft",
    ]


def test_haunting_canonical_clues_do_not_launder_invented_bonus_facts():
    graph = json.loads((
        PLUGIN_ROOT / "references" / "starter-scenarios" / "the-haunting"
        / "clue-graph.json"
    ).read_text("utf-8"))
    clues = [
        clue for conclusion in graph["conclusions"]
        for clue in conclusion.get("clues", [])
    ]
    assert all("bonus" not in clue for clue in clues)
    serialized = json.dumps(graph, ensure_ascii=False)
    assert "landlord pressure" not in serialized
    assert "not for print" not in serialized


def test_basement_dagger_discovery_preserves_player_knowledge_boundary():
    scenario_dir = (
        PLUGIN_ROOT / "references" / "starter-scenarios" / "the-haunting"
    )
    graph = json.loads((scenario_dir / "story-graph.json").read_text("utf-8"))
    basement = next(scene for scene in graph["scenes"] if scene["scene_id"] == "basement-rites")
    search = next(row for row in basement["affordances"] if row["id"] == "search-tool-pile")
    assert search["grants_clue_ids"] == ["clue-rusted-basement-dagger"]

    clue_graph = json.loads((scenario_dir / "clue-graph.json").read_text("utf-8"))
    clues = {
        clue["clue_id"]: clue
        for conclusion in clue_graph["conclusions"]
        for clue in conclusion.get("clues", [])
    }
    physical = clues["clue-rusted-basement-dagger"]["player_safe_summary"]
    assert "float" not in physical.lower()
    assert "spell" not in physical.lower()
    assert "ash" not in physical.lower()
    physical_zh = clues["clue-rusted-basement-dagger"]["localized_text"]["zh-Hans"]["player_safe_summary"]
    assert all(term not in physical_zh for term in ("漂浮", "法术", "灰烬", "破解"))
    finale = next(scene for scene in graph["scenes"] if scene["scene_id"] == "corbitt-confrontation")
    attack = next(row for row in finale["affordances"] if row["id"] == "strike-with-his-dagger")
    assert "法术" not in attack["cue"]


def test_haunting_player_safe_clues_have_simplified_chinese_summaries():
    graph = json.loads((
        PLUGIN_ROOT / "references" / "starter-scenarios" / "the-haunting"
        / "clue-graph.json"
    ).read_text("utf-8"))
    clues = [
        clue
        for conclusion in graph["conclusions"]
        for clue in conclusion.get("clues", [])
        if clue.get("visibility") == "player-safe"
    ]

    assert clues
    assert all(
        str(
            clue.get("localized_text", {})
            .get("zh-Hans", {})
            .get("player_safe_summary", "")
        ).strip()
        for clue in clues
    )


def test_haunting_location5_and_chapel_are_source_bound_module_locations():
    scenario_dir = (
        PLUGIN_ROOT / "references" / "starter-scenarios" / "the-haunting"
    )
    story = json.loads((scenario_dir / "story-graph.json").read_text("utf-8"))
    clues = json.loads((scenario_dir / "clue-graph.json").read_text("utf-8"))
    scenes = {row["scene_id"]: row for row in story["scenes"]}
    clue_rows = {
        clue["clue_id"]: clue
        for conclusion in clues["conclusions"]
        for clue in conclusion.get("clues", [])
    }

    hall = scenes["hall-of-records"]
    public_direct = {
        "schema_version": 1,
        "discoverability": "public",
        "direct_entry": "independent",
    }
    assert scenes["newspaper-morgue"]["destination_access"] == public_direct
    assert scenes["central-library"]["destination_access"] == public_direct
    assert hall["destination_access"] == public_direct
    redirect = next(
        row for row in hall["affordances"] if row["id"] == "ask-clerk-redirect"
    )
    assert redirect["completion_policy"] == "matched_no_roll"
    assert redirect["sets_flags"] == ["records-serious-crime-destination-known"]
    assert any(
        edge["to"] == "higher-courts-central-police"
        and edge["when"] == {
            "kind": "flag_set",
            "flag_id": "records-serious-crime-destination-known",
        }
        for edge in hall["scene_edges"]
    )

    location5 = scenes["higher-courts-central-police"]
    assert location5["destination_identity"]["canonical_name"] == (
        "Higher Courts; Central Police Station"
    )
    assert location5["destination_access"] == {
        "schema_version": 1,
        "discoverability": "evidence_gated",
        "direct_entry": "requires_unlock",
    }
    assert location5["available_clues"] == ["clue-police-raid-chapel"]
    routes = {row["id"]: row for row in location5["affordances"]}
    assert routes["use-law-contact-for-raid-file"]["skills"] == ["Law"]
    assert routes["petition-for-raid-file"]["skill_minimums"] == {
        "Credit Rating": 75,
    }
    assert location5["source_refs"] == [{
        "path": "Call of Cthulhu 7e Keeper Rulebook",
        "page": 438,
        "grep_anchor": "Higher Courts; Central Police Station",
    }]

    raid = clue_rows["clue-police-raid-chapel"]
    assert raid["presentation_kind"] == "handout"
    assert raid["handout_number"] == 8
    assert raid["source_refs"][0]["page"] == 438

    chapel = scenes["chapel-of-contemplation-ruins"]
    assert chapel["destination_identity"]["canonical_name"] == (
        "The Chapel of Contemplation"
    )
    assert chapel["destination_access"] == {
        "schema_version": 1,
        "discoverability": "hidden",
        "direct_entry": "requires_unlock",
    }
    assert set(chapel["available_clues"]) == {
        "clue-chapel-eye-symbol",
        "clue-chapel-cellar-remains",
        "clue-chapel-journal-burial",
        "clue-liber-ivonis-tome",
    }
    chapel_routes = {row["id"]: row for row in chapel["affordances"]}
    assert chapel_routes["descend-ruined-chapel-cellar"]["authored_operation"]["kind"] == (
        "environmental_hazard"
    )
    tome_payload = chapel_routes["study-liber-ivonis"]["authored_operation"]["payload"]
    assert tome_payload["duration_minutes"] == 180
    assert tome_payload["mythos_gain"] == 2
    assert tome_payload["max_san_reduction"] == 2
    assert chapel["optional_rules"]["weakened_floor"]["push_runtime_status"] == (
        "NOT_IMPLEMENTED"
    )
    assert chapel["source_refs"] == [
        {
            "path": "Call of Cthulhu 7e Keeper Rulebook",
            "page": 439,
            "grep_anchor": "The Chapel of Contemplation",
        },
        {
            "path": "Call of Cthulhu 7e Keeper Rulebook",
            "page": 440,
            "grep_anchor": "moldering church records",
        },
    ]


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


def test_1590s_era_clock_and_freeform_normalize():
    """Historical eras must not silently fall back to 1925 when labeled 1590s."""
    import importlib.util
    import tempfile

    spec = importlib.util.spec_from_file_location(
        "coc_state", PLUGIN_ROOT / "scripts" / "coc_state.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    assert mod.normalize_era("1590s") == "1590s"
    assert mod.normalize_era("1597 Spain") == "1590s"
    assert mod.normalize_era("gaslight") == "1890s"
    assert mod.normalize_era("unknown-era-xyz") == "1920s"

    clock = mod.initial_clock_for_era("1597 Spain")
    assert str(clock["local_datetime"]).startswith("1597-07"), clock
    assert clock["timezone"] == "Europe/Madrid"

    with tempfile.TemporaryDirectory() as td:
        root = Path(td) / ".coc"
        mod.ensure_workspace(root)
        mod.create_campaign(root, "spain-era", "España", era="1597 Spain")
        camp = json.loads(
            (root / "campaigns" / "spain-era" / "campaign.json").read_text("utf-8")
        )
        ts = json.loads(
            (root / "campaigns" / "spain-era" / "save" / "time-state.json").read_text(
                "utf-8"
            )
        )
        assert camp["era"] == "1590s"
        assert ts["clock"]["local_datetime"].startswith("1597-07"), ts["clock"]


def test_diverse_module_eras_do_not_fall_back_to_1920s():
    import importlib.util

    spec = importlib.util.spec_from_file_location(
        "coc_state_diverse_eras", PLUGIN_ROOT / "scripts" / "coc_state.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    assert mod.normalize_era("40000 BCE") == "prehistoric"
    assert mod.normalize_era("Roman Britain") == "roman"
    assert mod.normalize_era("1287 England") == "medieval"
    assert mod.normalize_era("1603 London") == "early_modern"
    assert mod.normalize_era("1975 Texas") == "1970s"
    assert mod.initial_clock_for_era("1975 Texas")["local_datetime"].startswith(
        "1975-07"
    )


def test_reseed_clock_preserves_live_scene_location(tmp_path: Path):
    import importlib.util

    spec = importlib.util.spec_from_file_location(
        "coc_state_reseed_location", PLUGIN_ROOT / "scripts" / "coc_state.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    mod.ensure_workspace(tmp_path)
    mod.create_campaign(tmp_path, "road", "Road", era="1975 Texas")
    campaign_dir = tmp_path / ".coc" / "campaigns" / "road"
    time_path = campaign_dir / "save" / "time-state.json"
    time_state = json.loads(time_path.read_text(encoding="utf-8"))
    time_state["clock"]["location_id"] = "esso-gas-station"
    mod.write_json_atomic(time_path, time_state)

    mod.reseed_campaign_clock_for_era(
        campaign_dir,
        "road",
        "1975 Texas",
        preserve_elapsed=True,
        start_clock={
            "calendar_mode": "gregorian",
            "local_datetime": "1975-07-01T11:00:00",
            "timezone": "America/Chicago",
            "display": "1975-07-01 11:00",
        },
    )

    reseeded = json.loads(time_path.read_text(encoding="utf-8"))
    assert reseeded["clock"]["location_id"] == "esso-gas-station"


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


@pytest.mark.parametrize("pregen_id", ["thomas-hayes", "eleanor-reed"])
def test_quick_start_pregens_render_complete_zh_hans_cards(tmp_path, pregen_id):
    root = tmp_path / ".coc"
    started = coc_starter.quick_start(
        root, "the-haunting", pregen_id, campaign_id=f"card-{pregen_id}"
    )
    sheet = json.loads(Path(started["character_path"]).read_text(encoding="utf-8"))
    display = sheet["player_facing_sheet_zh"]
    assert display["display_name"] == sheet["name"]
    assert len(display["characteristics"]) == len(sheet["characteristics"])
    assert len(display["skills"]) == len(sheet["skills"])
    assert display["backstory_summary"]
    assert display["backstory_details"]
    assert isinstance(display.get("equipment"), list)
    assert display["equipment"]
    # Display labels must be zh-Hans, not the machine-sheet English strings.
    machine_equipment = {
        str(item).strip()
        for item in (sheet.get("equipment") or [])
        if isinstance(item, str) and item.strip()
    }
    assert not any(label in machine_equipment for label in display["equipment"])
    assert all(any("\u4e00" <= ch <= "\u9fff" for ch in label) for label in display["equipment"])

    import coc_runtime_ops
    receipt = coc_runtime_ops.execute_setup_operation(
        tmp_path,
        operation={
            "schema_version": 1,
            "kind": "investigator.render_card",
            "payload": {
                "campaign_id": started["campaign_id"],
                "investigator_id": pregen_id,
                "language": "zh-Hans",
                "html_mode": "never",
            },
        },
    )
    assert receipt["status"] == "PASS"
    card_path = tmp_path / receipt["state_refs"][0]
    card = card_path.read_text(encoding="utf-8")
    assert sheet["name"] in card
    assert "## 属性" in card
    assert "## 技能" in card
    assert "## 背景" in card


def test_ensure_pregen_fills_missing_equipment_on_existing_player_facing_sheet():
    """Older pregens may already have pf sheets without equipment."""
    sheet = json.loads(
        coc_starter._pregen_character_path(
            "the-haunting", "eleanor-reed"
        ).read_text(encoding="utf-8")
    )
    sheet["player_facing_sheet_zh"] = {
        "display_name": sheet["name"],
        "occupation": sheet["occupation"],
        "skills": [],
        "weapons": [],
        # deliberately omit equipment
    }
    ensured = coc_starter.ensure_pregen_player_facing_sheet(sheet)
    equipment = ensured["player_facing_sheet_zh"]["equipment"]
    assert equipment == [
        "采访本",
        "钢笔",
        "箱式相机与闪光药",
        "致两位城市编辑的介绍信",
    ]
    # Other authored fields stay untouched.
    assert ensured["player_facing_sheet_zh"]["display_name"] == sheet["name"]
    assert ensured["player_facing_sheet_zh"]["skills"] == []


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
    for path in (ws_char, camp_char):
        sheet = json.loads(path.read_text("utf-8"))
        assert sheet["backstory"]["scenario_id"] == "the-haunting"
        assert isinstance(sheet["backstory"].get("scenario_bound"), dict)

    inv_state = campaign_dir / "save" / "investigator-state" / "thomas-hayes.json"
    assert inv_state.is_file()
    world = json.loads((campaign_dir / "save" / "world-state.json").read_text("utf-8"))
    assert world["status"] == "active"
    assert world["active_scene_id"]
    archive = coc_starter.coc_compiled_archive.load_published(campaign_dir)
    assert archive["ok"] is True
    assert archive["archive_revision"]
    assert coc_starter.player_safe_opening(campaign_dir) == (
        "调查员会接受 Knott 的委托，并决定先从哪里着手调查吗？"
    )


def _index_has(root: Path, filename: str, collection: str, item_id: str) -> bool:
    path = root / "indexes" / filename
    if not path.is_file():
        return False
    payload = json.loads(path.read_text(encoding="utf-8"))
    items = payload.get(collection)
    return isinstance(items, dict) and item_id in items


@pytest.mark.parametrize(
    "failure_point",
    [
        "after_create_campaign",
        "during_install_starter",
        "during_investigator_build",
        "after_campaign_local_copy",
        "after_state_seed",
        "after_campaign_link_prep",
        "after_final_campaign_rewrite",
        "before_campaign_publication",
    ],
)
def test_quick_start_failure_is_atomic_and_same_id_retry_succeeds(
    tmp_path, monkeypatch, failure_point
):
    root = tmp_path / ".coc"
    campaign_id = f"quick-start-failure-{failure_point}"
    campaign_dir = root / "campaigns" / campaign_id
    investigator_id = "thomas-hayes"

    with monkeypatch.context() as patch:
        if failure_point == "after_create_campaign":
            real = coc_starter.coc_state._create_campaign_at

            def fail_after_create(*args, **kwargs):
                result = real(*args, **kwargs)
                raise RuntimeError("injected after campaign creation")

            patch.setattr(coc_starter.coc_state, "_create_campaign_at", fail_after_create)
        elif failure_point == "during_install_starter":
            real = coc_starter.shutil.copy2
            copies = 0

            def fail_during_install(*args, **kwargs):
                nonlocal copies
                copies += 1
                if copies == 3:
                    raise RuntimeError("injected during starter installation")
                return real(*args, **kwargs)

            patch.setattr(coc_starter.shutil, "copy2", fail_during_install)
        elif failure_point == "during_investigator_build":
            real = coc_starter.coc_state._create_investigator_at

            def fail_during_investigator_build(*args, **kwargs):
                result = real(*args, **kwargs)
                raise RuntimeError("injected during investigator build")

            patch.setattr(
                coc_starter.coc_state,
                "_create_investigator_at",
                fail_during_investigator_build,
            )
        elif failure_point == "after_campaign_local_copy":
            real = coc_starter._write_campaign_local_character

            def fail_after_local_copy(*args, **kwargs):
                result = real(*args, **kwargs)
                raise RuntimeError("injected after campaign-local copy")

            patch.setattr(
                coc_starter,
                "_write_campaign_local_character",
                fail_after_local_copy,
            )
        elif failure_point == "after_state_seed":
            real = coc_starter.coc_state._seed_investigator_state_at

            def fail_after_state_seed(*args, **kwargs):
                result = real(*args, **kwargs)
                raise RuntimeError("injected after investigator state seed")

            patch.setattr(
                coc_starter.coc_state,
                "_seed_investigator_state_at",
                fail_after_state_seed,
            )
        elif failure_point == "after_campaign_link_prep":
            real = coc_starter.coc_state._link_party_at

            def fail_after_link(*args, **kwargs):
                result = real(*args, **kwargs)
                raise RuntimeError("injected after campaign link preparation")

            patch.setattr(coc_starter.coc_state, "_link_party_at", fail_after_link)
        elif failure_point == "after_final_campaign_rewrite":
            real = coc_starter._finalize_quick_start_campaign

            def fail_after_finalize(*args, **kwargs):
                result = real(*args, **kwargs)
                raise RuntimeError("injected after final campaign rewrite")

            patch.setattr(coc_starter, "_finalize_quick_start_campaign", fail_after_finalize)
        else:
            def fail_publication(*_args, **_kwargs):
                raise RuntimeError("injected before campaign publication")

            patch.setattr(coc_starter, "_publish_campaign_generation", fail_publication)

        with pytest.raises(RuntimeError, match="injected"):
            coc_starter.quick_start(
                root,
                "the-haunting",
                investigator_id,
                campaign_id=campaign_id,
            )

    assert not campaign_dir.exists()
    assert not _index_has(root, "campaigns.json", "campaigns", campaign_id)
    assert not (root / "investigators" / investigator_id).exists()
    assert not _index_has(root, "investigators.json", "investigators", investigator_id)
    assert not list((root / "campaigns").glob(".quick-start-*"))
    assert not list((root / "investigators").glob(".quick-start-*"))

    retried = coc_starter.quick_start(
        root,
        "the-haunting",
        investigator_id,
        campaign_id=campaign_id,
    )
    assert Path(retried["campaign_dir"]) == campaign_dir
    assert (campaign_dir / "campaign.json").is_file()
    assert _index_has(root, "campaigns.json", "campaigns", campaign_id)
    assert _index_has(root, "investigators.json", "investigators", investigator_id)


def test_quick_start_failure_never_changes_or_deletes_preexisting_investigator(
    tmp_path, monkeypatch
):
    root = tmp_path / ".coc"
    first = coc_starter.quick_start(
        root,
        "the-haunting",
        "thomas-hayes",
        campaign_id="quick-start-preexisting-source",
    )
    investigator_dir = root / "investigators" / first["investigator_id"]
    before_files = {
        path.relative_to(investigator_dir).as_posix(): path.read_bytes()
        for path in investigator_dir.rglob("*")
        if path.is_file()
    }
    index_path = root / "indexes" / "investigators.json"
    index_before = index_path.read_bytes()
    failed_campaign_id = "quick-start-preexisting-failure"

    with monkeypatch.context() as patch:
        patch.setattr(
            coc_starter,
            "_publish_campaign_generation",
            lambda *_args, **_kwargs: (_ for _ in ()).throw(
                RuntimeError("injected before campaign publication")
            ),
        )
        with pytest.raises(RuntimeError, match="injected"):
            coc_starter.quick_start(
                root,
                "the-haunting",
                first["investigator_id"],
                campaign_id=failed_campaign_id,
            )

    after_files = {
        path.relative_to(investigator_dir).as_posix(): path.read_bytes()
        for path in investigator_dir.rglob("*")
        if path.is_file()
    }
    assert after_files == before_files
    assert index_path.read_bytes() == index_before
    assert not (root / "campaigns" / failed_campaign_id).exists()
    assert not _index_has(root, "campaigns.json", "campaigns", failed_campaign_id)


def test_quick_start_treats_post_publication_index_failure_as_repairable(
    tmp_path, monkeypatch
):
    root = tmp_path / ".coc"
    campaign_id = "quick-start-index-repair"
    real_campaign_index = coc_starter.coc_state._upsert_campaign_index

    def fail_campaign_index(*_args, **_kwargs):
        raise RuntimeError("injected campaign index failure")

    monkeypatch.setattr(
        coc_starter.coc_state, "_upsert_campaign_index", fail_campaign_index
    )
    started = coc_starter.quick_start(
        root,
        "the-haunting",
        "thomas-hayes",
        campaign_id=campaign_id,
    )

    campaign_dir = Path(started["campaign_dir"])
    campaign = json.loads((campaign_dir / "campaign.json").read_text(encoding="utf-8"))
    assert campaign_dir.is_dir()
    assert not _index_has(root, "campaigns.json", "campaigns", campaign_id)
    assert started["warnings"] == [
        "campaign index repair deferred: RuntimeError"
    ]
    assert ".quick-start-" not in campaign["character_creation"]["briefing_path"]
    assert campaign["character_creation"]["briefing_path"].startswith(
        f".coc/campaigns/{campaign_id}/assets/character-creation/"
    )

    monkeypatch.setattr(
        coc_starter.coc_state, "_upsert_campaign_index", real_campaign_index
    )
    coc_starter.coc_state._upsert_campaign_index(root, campaign_id)
    assert _index_has(root, "campaigns.json", "campaigns", campaign_id)


@pytest.mark.parametrize("existing_kind", ["empty_directory", "broken_symlink"])
def test_quick_start_rejects_any_existing_final_campaign_entry_untouched(
    tmp_path, existing_kind
):
    root = tmp_path / ".coc"
    campaign_id = f"quick-start-existing-{existing_kind}"
    campaign_dir = root / "campaigns" / campaign_id
    campaign_dir.parent.mkdir(parents=True)
    if existing_kind == "empty_directory":
        campaign_dir.mkdir()
        before = campaign_dir.stat()
    else:
        target = tmp_path / "missing-campaign-target"
        campaign_dir.symlink_to(target, target_is_directory=True)
        before = campaign_dir.readlink()

    with pytest.raises(FileExistsError, match="already exists"):
        coc_starter.quick_start(
            root,
            "the-haunting",
            "thomas-hayes",
            campaign_id=campaign_id,
        )

    if existing_kind == "empty_directory":
        assert campaign_dir.is_dir()
        assert campaign_dir.stat().st_ino == before.st_ino
        assert list(campaign_dir.iterdir()) == []
    else:
        assert campaign_dir.is_symlink()
        assert campaign_dir.readlink() == before


def test_quick_start_same_campaign_id_has_one_atomic_winner(tmp_path):
    root = tmp_path / ".coc"
    campaign_id = "quick-start-concurrent-same-id"
    barrier = threading.Barrier(3)
    results: list[dict[str, Any]] = []
    errors: list[BaseException] = []

    def contender():
        barrier.wait()
        try:
            results.append(
                coc_starter.quick_start(
                    root,
                    "the-haunting",
                    "thomas-hayes",
                    campaign_id=campaign_id,
                )
            )
        except BaseException as exc:
            errors.append(exc)

    threads = [threading.Thread(target=contender) for _ in range(2)]
    for thread in threads:
        thread.start()
    barrier.wait()
    for thread in threads:
        thread.join(timeout=5.0)
        assert not thread.is_alive()

    assert len(results) == 1
    assert len(errors) == 1
    assert isinstance(errors[0], FileExistsError)
    assert (root / "campaigns" / campaign_id / "campaign.json").is_file()
    assert not list((root / "campaigns").glob(".quick-start-*"))
    assert not list((root / "investigators").glob(".quick-start-*"))


def test_quick_start_reuses_complete_crash_survivor_and_repairs_index(tmp_path):
    root = tmp_path / ".coc"
    investigator_id = "thomas-hayes"
    sheet = json.loads(
        coc_starter._pregen_character_path(
            "the-haunting", investigator_id
        ).read_text(encoding="utf-8")
    )
    sheet = coc_starter.ensure_pregen_backstory_provenance(sheet)
    sheet = coc_starter.ensure_pregen_player_facing_sheet(sheet)
    coc_starter.coc_state.ensure_workspace(root)
    investigator_dir = root / "investigators" / investigator_id
    coc_starter.coc_state._create_investigator_at(
        investigator_dir,
        investigator_id,
        sheet,
    )
    before = {
        path.name: path.read_bytes()
        for path in investigator_dir.iterdir()
        if path.is_file()
    }
    assert not _index_has(root, "investigators.json", "investigators", investigator_id)

    started = coc_starter.quick_start(
        root,
        "the-haunting",
        investigator_id,
        campaign_id="quick-start-crash-survivor",
    )

    after = {
        path.name: path.read_bytes()
        for path in investigator_dir.iterdir()
        if path.is_file()
    }
    assert after == before
    assert Path(started["campaign_dir"]).is_dir()
    assert _index_has(root, "investigators.json", "investigators", investigator_id)


@pytest.mark.parametrize("stale_shape", ["partial_stage", "orphan_sidecar"])
def test_quick_start_recovers_verified_prepublication_stage_after_crash(
    tmp_path, stale_shape
):
    root = tmp_path / ".coc"
    campaign_id = f"quick-start-stale-{stale_shape}"
    coc_starter.coc_state.ensure_workspace(root)
    prefix = coc_starter._quick_start_stage_prefix("campaign", campaign_id)
    stale = coc_starter._create_private_stage(
        root / "campaigns",
        prefix,
        kind="campaign",
        identity=campaign_id,
    )
    if stale_shape == "partial_stage":
        (stale / "partial.json").write_text("{}", encoding="utf-8")
    else:
        stale.rmdir()

    started = coc_starter.quick_start(
        root,
        "the-haunting",
        "thomas-hayes",
        campaign_id=campaign_id,
    )

    assert Path(started["campaign_dir"]).is_dir()
    assert not os.path.lexists(stale)
    assert not coc_starter._stage_manifest_path(stale).exists()


def test_quick_start_post_commit_callback_failure_remains_success(
    tmp_path, monkeypatch
):
    root = tmp_path / ".coc"
    campaign_id = "quick-start-post-commit-failure"
    real_publish = coc_starter._publish_campaign_generation

    def publish_then_fail(*args, **kwargs):
        real_publish(*args, **kwargs)
        raise RuntimeError("injected after campaign commit")

    monkeypatch.setattr(
        coc_starter,
        "_publish_campaign_generation",
        publish_then_fail,
    )
    started = coc_starter.quick_start(
        root,
        "the-haunting",
        "thomas-hayes",
        campaign_id=campaign_id,
    )

    assert Path(started["campaign_dir"]).is_dir()
    assert _index_has(root, "campaigns.json", "campaigns", campaign_id)
    assert not list((root / "campaigns").glob(".quick-start-*"))


def test_quick_start_serializes_existing_role_validation_with_publication(
    tmp_path, monkeypatch
):
    root = tmp_path / ".coc"
    first = coc_starter.quick_start(
        root,
        "the-haunting",
        "thomas-hayes",
        campaign_id="quick-start-existing-source",
    )
    investigator_id = first["investigator_id"]
    character_path = Path(first["character_path"])
    accepted_snapshot = json.loads(character_path.read_text(encoding="utf-8"))
    developed_snapshot = json.loads(json.dumps(accepted_snapshot))
    developed_snapshot["name"] = "Developed after quick-start publication"
    marker_path = (
        root
        / "investigators"
        / investigator_id
        / "development-active-transaction.json"
    )
    ending_id = "quick-start-interleaving-ending"
    transaction_id = (
        coc_starter.coc_investigator_guard._expected_transaction_id(
            ending_id, investigator_id
        )
    )
    target_campaign_id = "quick-start-stable-boundary"
    target_campaign = root / "campaigns" / target_campaign_id
    contender_started = threading.Event()
    contender_finished = threading.Event()
    contender_errors: list[BaseException] = []

    def development_contender():
        contender_started.set()
        try:
            with coc_starter.coc_investigator_guard.guard_reusable_investigators(
                root, [investigator_id], wait_seconds=2.0
            ):
                coc_starter.coc_fileio.write_json_atomic(
                    marker_path,
                    {
                        "schema_version": 2,
                        "status": "active",
                        "transaction_id": transaction_id,
                        "investigator_id": investigator_id,
                        "campaign_id": "foreign-development-campaign",
                        "ending_id": ending_id,
                        "inflight_ref": (
                            ".coc/campaigns/foreign-development-campaign/save/"
                            "development-settlements/endings/"
                            f"{ending_id}/{investigator_id}.inflight.json"
                        ),
                        "created_at": "2026-07-16T00:00:00Z",
                        "phase": "creating",
                        "journal_sha256": None,
                        "next_journal_sha256": None,
                        "transition_at": None,
                    },
                    trailing_newline=True,
                )
                coc_starter.coc_fileio.write_json_atomic(
                    character_path,
                    developed_snapshot,
                    trailing_newline=True,
                )
        except BaseException as exc:  # pragma: no cover - asserted below
            contender_errors.append(exc)
        finally:
            contender_finished.set()

    real_create_campaign = coc_starter.coc_state._create_campaign_at
    contender: threading.Thread | None = None

    def create_campaign_with_interleaving(*args, **kwargs):
        nonlocal contender
        contender = threading.Thread(target=development_contender)
        contender.start()
        assert contender_started.wait(1.0)
        # If quick-start still owns the investigator guard, the development
        # contender cannot cross this publication callback yet.
        contender_finished.wait(0.1)
        return real_create_campaign(*args, **kwargs)

    monkeypatch.setattr(
        coc_starter.coc_state, "_create_campaign_at", create_campaign_with_interleaving
    )
    failure: BaseException | None = None
    started = None
    try:
        started = coc_starter.quick_start(
            root,
            "the-haunting",
            "thomas-hayes",
            campaign_id=target_campaign_id,
        )
    except BaseException as exc:  # expected only from the broken boundary
        failure = exc
    assert contender is not None
    contender.join(timeout=3.0)
    assert not contender.is_alive()
    assert contender_errors == []

    if failure is not None:
        assert not (target_campaign / "campaign.json").exists()
        raise failure
    assert started is not None
    assert json.loads(
        (
            target_campaign
            / "investigators"
            / investigator_id
            / "character.json"
        ).read_text(encoding="utf-8")
    ) == accepted_snapshot
    state = json.loads(
        (
            target_campaign
            / "save"
            / "investigator-state"
            / f"{investigator_id}.json"
        ).read_text(encoding="utf-8")
    )
    assert state["investigator_id"] == investigator_id
    assert json.loads((target_campaign / "party.json").read_text(encoding="utf-8"))[
        "investigator_ids"
    ] == [investigator_id]


def test_quick_start_never_overwrites_developed_role_or_publishes_on_marker(
    tmp_path,
):
    root = tmp_path / ".coc"
    first = coc_starter.quick_start(
        root,
        "the-haunting",
        "thomas-hayes",
        campaign_id="quick-start-conflict-source",
    )
    investigator_id = first["investigator_id"]
    character_path = Path(first["character_path"])
    accepted_bytes = character_path.read_bytes()
    developed = json.loads(accepted_bytes)
    developed["name"] = "A developed reusable investigator"
    coc_starter.coc_fileio.write_json_atomic(
        character_path, developed, trailing_newline=True
    )
    developed_bytes = character_path.read_bytes()
    mismatch_campaign = root / "campaigns" / "quick-start-content-conflict"

    with pytest.raises(FileExistsError, match="will not replace"):
        coc_starter.quick_start(
            root,
            "the-haunting",
            "thomas-hayes",
            campaign_id=mismatch_campaign.name,
        )

    assert character_path.read_bytes() == developed_bytes
    assert not (mismatch_campaign / "campaign.json").exists()

    character_path.write_bytes(accepted_bytes)
    ending_id = "quick-start-active-marker"
    marker_path = (
        root
        / "investigators"
        / investigator_id
        / "development-active-transaction.json"
    )
    coc_starter.coc_fileio.write_json_atomic(
        marker_path,
        {
            "schema_version": 2,
            "status": "active",
            "transaction_id": (
                coc_starter.coc_investigator_guard._expected_transaction_id(
                    ending_id, investigator_id
                )
            ),
            "investigator_id": investigator_id,
            "campaign_id": "foreign-development-campaign",
            "ending_id": ending_id,
            "inflight_ref": (
                ".coc/campaigns/foreign-development-campaign/save/"
                "development-settlements/endings/"
                f"{ending_id}/{investigator_id}.inflight.json"
            ),
            "created_at": "2026-07-16T00:00:00Z",
            "phase": "creating",
            "journal_sha256": None,
            "next_journal_sha256": None,
            "transition_at": None,
        },
        trailing_newline=True,
    )
    marker_campaign = root / "campaigns" / "quick-start-marker-conflict"

    with pytest.raises(
        coc_starter.coc_investigator_guard.ReusableInvestigatorRecoveryConflict
    ) as exc_info:
        coc_starter.quick_start(
            root,
            "the-haunting",
            "thomas-hayes",
            campaign_id=marker_campaign.name,
        )

    assert exc_info.value.code == "RECOVERY_CONFLICT"
    assert character_path.read_bytes() == accepted_bytes
    assert not (marker_campaign / "campaign.json").exists()


def test_ensure_pregen_backstory_provenance_stamps_known_legacy_sheet():
    """Pre-existing flat pregen sheets get scenario_id + nested scenario_bound."""
    legacy = {
        "id": "thomas-hayes",
        "name": "托马斯·海斯",
        "backstory": {
            "description": "Knott 的委托听起来像又一次清清恶名。",
            "significant_people": "前搭档失踪。",
            "meaningful_locations": "克莱恩街附近的办公室。",
            "traits": ["先查纸再上门"],
            "ideology": "真相值钱。",
        },
    }
    stamped = coc_starter.ensure_pregen_backstory_provenance(legacy)
    assert stamped["backstory"]["scenario_id"] == "the-haunting"
    bound = stamped["backstory"]["scenario_bound"]
    assert "Knott" in bound["description"]
    assert "description" not in stamped["backstory"]
    assert "significant_people" not in stamped["backstory"]
    assert stamped["backstory"]["traits"] == ["先查纸再上门"]
    # Custom / unknown ids untouched.
    custom = {"id": "my-oc", "backstory": {"description": "原创背景"}}
    assert coc_starter.ensure_pregen_backstory_provenance(custom)["backstory"] == {
        "description": "原创背景"
    }


def test_lookup_known_starter_pregen_registry():
    entry = coc_starter.lookup_known_starter_pregen("thomas-hayes")
    assert entry is not None
    assert entry["scenario_id"] == "the-haunting"
    assert "description" in entry.get("scenario_bound_keys", [])
    assert coc_starter.lookup_known_starter_pregen("my-custom-investigator") is None


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
