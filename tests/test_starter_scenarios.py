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
    finale = next(scene for scene in graph["scenes"] if scene["scene_id"] == "corbitt-confrontation")
    attack = next(row for row in finale["affordances"] if row["id"] == "strike-with-his-dagger")
    assert "法术" not in attack["cue"]


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
    assert coc_starter.player_safe_opening(campaign_dir) == (
        "调查员会接受 Knott 的委托，并决定先从哪里着手调查吗？"
    )


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
