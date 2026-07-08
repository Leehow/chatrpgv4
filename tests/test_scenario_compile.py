"""Tests for coc_scenario_compile: story-graph structure validator."""
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest

def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, rel)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m

coc_scenario_compile = _load("coc_scenario_compile", "plugins/coc-keeper/scripts/coc_scenario_compile.py")


def _make_valid_scenario(tmp_path):
    sc = tmp_path / "scenario"
    sc.mkdir()
    (sc / "module-meta.json").write_text(json.dumps({
        "schema_version": 1, "scenario_id": "m", "structure_type": "branching_investigation",
        "era": "1920s", "content_flags": [], "win_condition": "x",
    }))
    (sc / "story-graph.json").write_text(json.dumps({"scenes": [
        {"scene_id": "s1", "dramatic_question": "q", "entry_conditions": [], "exit_conditions": [],
         "available_clues": [], "npc_ids": [], "pressure_moves": [], "tone": [], "allowed_improvisation": []},
    ]}))
    (sc / "clue-graph.json").write_text(json.dumps({"conclusions": [
        {"conclusion_id": "c1", "importance": "critical", "minimum_routes": 3,
         "clues": [{"clue_id":"a","delivery":"","visibility":"player-safe"},
                   {"clue_id":"b","delivery":"","visibility":"player-safe"},
                   {"clue_id":"c","delivery":"","visibility":"player-safe"}],
         "fallback_policy": "RECOVER can surface a public alternate route"},
    ]}))
    (sc / "npc-agendas.json").write_text(json.dumps({"npcs": [
        {"npc_id": "n1", "agenda": "spy on investigators"},
    ]}))
    (sc / "threat-fronts.json").write_text(json.dumps({"fronts": []}))
    (sc / "pacing-map.json").write_text(json.dumps({"pacing_curve": []}))
    (sc / "improvisation-boundaries.json").write_text(json.dumps(
        {"invent_allowed": [], "never_invent": [], "keeper_secrets": ["secret-1"]}))
    return sc

def test_validate_valid_scenario_no_errors(tmp_path):
    sc = _make_valid_scenario(tmp_path)
    result = coc_scenario_compile.validate_scenario(sc)
    assert result["errors"] == []

def test_validate_missing_dramatic_question(tmp_path):
    sc = _make_valid_scenario(tmp_path)
    g = json.loads((sc/"story-graph.json").read_text())
    g["scenes"][0]["dramatic_question"] = ""
    (sc/"story-graph.json").write_text(json.dumps(g))
    result = coc_scenario_compile.validate_scenario(sc)
    assert any("dramatic_question" in e for e in result["errors"])

def test_validate_critical_conclusion_needs_3_routes(tmp_path):
    sc = _make_valid_scenario(tmp_path)
    g = json.loads((sc/"clue-graph.json").read_text())
    g["conclusions"][0]["clues"] = g["conclusions"][0]["clues"][:2]  # only 2
    (sc/"clue-graph.json").write_text(json.dumps(g))
    result = coc_scenario_compile.validate_scenario(sc)
    assert any("minimum_routes" in e or "routes" in e for e in result["errors"])

def test_validate_npc_without_agenda(tmp_path):
    sc = _make_valid_scenario(tmp_path)
    g = json.loads((sc/"npc-agendas.json").read_text())
    g["npcs"][0]["agenda"] = ""
    (sc/"npc-agendas.json").write_text(json.dumps(g))
    result = coc_scenario_compile.validate_scenario(sc)
    assert any("agenda" in e for e in result["errors"])

def test_validate_bad_structure_type(tmp_path):
    sc = _make_valid_scenario(tmp_path)
    m = json.loads((sc/"module-meta.json").read_text())
    m["structure_type"] = "bogus_type"
    (sc/"module-meta.json").write_text(json.dumps(m))
    result = coc_scenario_compile.validate_scenario(sc)
    assert any("structure_type" in e for e in result["errors"])


def _scenario_script_path() -> Path:
    return Path("plugins/coc-keeper/scripts/coc_scenario_compile.py")


def test_cli_valid_scenario_exits_zero(tmp_path):
    sc = _make_valid_scenario(tmp_path)
    proc = subprocess.run(
        [sys.executable, str(_scenario_script_path()), str(sc)],
        capture_output=True, text=True,
    )
    assert proc.returncode == 0, proc.stderr or proc.stdout
    assert "OK" in proc.stdout


def test_cli_invalid_scenario_exits_nonzero(tmp_path):
    sc = _make_valid_scenario(tmp_path)
    g = json.loads((sc/"story-graph.json").read_text())
    g["scenes"][0]["dramatic_question"] = ""
    (sc/"story-graph.json").write_text(json.dumps(g))
    proc = subprocess.run(
        [sys.executable, str(_scenario_script_path()), str(sc)],
        capture_output=True, text=True,
    )
    assert proc.returncode == 1
    assert any(line.startswith("ERROR:") for line in proc.stdout.splitlines())


def test_horror_stage_regression_errors(tmp_path):
    sc = _make_valid_scenario(tmp_path)
    g = json.loads((sc/"pacing-map.json").read_text())
    g["pacing_curve"] = [
        {"scene_id": "late", "horror_stage": "revelation"},
        {"scene_id": "after", "horror_stage": "ordinary"},
    ]
    (sc/"pacing-map.json").write_text(json.dumps(g))
    result = coc_scenario_compile.validate_scenario(sc)
    assert any("horror_stage" in e for e in result["errors"])


def test_horror_stage_minor_dip_ok(tmp_path):
    sc = _make_valid_scenario(tmp_path)
    g = json.loads((sc/"pacing-map.json").read_text())
    g["pacing_curve"] = [
        {"scene_id": "s1", "horror_stage": "pattern"},
        {"scene_id": "s2", "horror_stage": "wrongness"},  # dip of 1: allowed
    ]
    (sc/"pacing-map.json").write_text(json.dumps(g))
    result = coc_scenario_compile.validate_scenario(sc)
    assert not any("horror_stage" in e for e in result["errors"])


def test_validate_warns_skill_check_without_skill(tmp_path):
    """delivery_kind=skill_check but no skill -> warning (not error)."""
    sc = _make_valid_scenario(tmp_path)
    g = json.loads((sc/"clue-graph.json").read_text())
    g["conclusions"][0]["clues"][0]["delivery_kind"] = "skill_check"
    # no skill field
    (sc/"clue-graph.json").write_text(json.dumps(g))
    result = coc_scenario_compile.validate_scenario(sc)
    assert result["errors"] == []
    assert any("clue 'a'" in w and "skill_check" in w and "no skill" in w for w in result["warnings"])


def test_validate_warns_clue_source_ref_missing_page(tmp_path):
    """clue source_ref missing integer page -> warning."""
    sc = _make_valid_scenario(tmp_path)
    g = json.loads((sc/"clue-graph.json").read_text())
    g["conclusions"][0]["clues"][0]["source_refs"] = [
        {"path": "pdf/foo.pdf"}  # missing page
    ]
    (sc/"clue-graph.json").write_text(json.dumps(g))
    result = coc_scenario_compile.validate_scenario(sc)
    assert result["errors"] == []
    assert any("clue 'a'" in w and "source_ref" in w for w in result["warnings"])


def test_validate_warns_clue_source_ref_non_integer_page(tmp_path):
    """clue source_ref with string page -> warning."""
    sc = _make_valid_scenario(tmp_path)
    g = json.loads((sc/"clue-graph.json").read_text())
    g["conclusions"][0]["clues"][0]["source_refs"] = [
        {"path": "pdf/foo.pdf", "page": "12"}  # non-int page
    ]
    (sc/"clue-graph.json").write_text(json.dumps(g))
    result = coc_scenario_compile.validate_scenario(sc)
    assert result["errors"] == []
    assert any("clue 'a'" in w and "source_ref" in w for w in result["warnings"])


def test_validate_warns_scene_source_ref_missing_path(tmp_path):
    """scene source_ref missing path -> warning."""
    sc = _make_valid_scenario(tmp_path)
    g = json.loads((sc/"story-graph.json").read_text())
    g["scenes"][0]["source_refs"] = [{"page": 5}]  # missing path
    (sc/"story-graph.json").write_text(json.dumps(g))
    result = coc_scenario_compile.validate_scenario(sc)
    assert result["errors"] == []
    assert any("scene 's1'" in w and "source_ref" in w for w in result["warnings"])


def test_validate_warns_npc_source_ref_malformed(tmp_path):
    """npc source_ref malformed -> warning."""
    sc = _make_valid_scenario(tmp_path)
    g = json.loads((sc/"npc-agendas.json").read_text())
    g["npcs"][0]["source_refs"] = [{"path": "", "page": 5}]  # empty path
    (sc/"npc-agendas.json").write_text(json.dumps(g))
    result = coc_scenario_compile.validate_scenario(sc)
    assert result["errors"] == []
    assert any("npc 'n1'" in w and "source_ref" in w for w in result["warnings"])


def test_validate_warns_front_source_ref_malformed(tmp_path):
    """front source_ref missing integer page -> warning."""
    sc = _make_valid_scenario(tmp_path)
    g = json.loads((sc/"threat-fronts.json").read_text())
    g["fronts"] = [{"front_id": "f1", "scope": "scenario", "clocks": [],
                    "source_refs": [{"path": "pdf/x.pdf"}]}]  # missing page
    (sc/"threat-fronts.json").write_text(json.dumps(g))
    result = coc_scenario_compile.validate_scenario(sc)
    assert result["errors"] == []
    assert any("front 'f1'" in w and "source_ref" in w for w in result["warnings"])


def test_validate_errors_when_critical_conclusion_all_routes_are_fragile(tmp_path):
    sc = _make_valid_scenario(tmp_path)
    graph = json.loads((sc / "clue-graph.json").read_text())
    for clue in graph["conclusions"][0]["clues"]:
        clue["delivery_kind"] = "skill_check"
        clue["skill"] = "Spot Hidden"
    graph["conclusions"][0]["fallback_policy"] = ""
    (sc / "clue-graph.json").write_text(json.dumps(graph))

    result = coc_scenario_compile.validate_scenario(sc)

    assert any("non-fragile route" in error for error in result["errors"])


def test_validate_all_skill_gated_critical_conclusion_passes_with_fallback_policy(tmp_path):
    sc = _make_valid_scenario(tmp_path)
    graph = json.loads((sc / "clue-graph.json").read_text())
    for clue in graph["conclusions"][0]["clues"]:
        clue["delivery_kind"] = "skill_check"
        clue["skill"] = "Spot Hidden"
    graph["conclusions"][0]["fallback_policy"] = "RECOVER can surface a public alternate route"
    (sc / "clue-graph.json").write_text(json.dumps(graph))

    result = coc_scenario_compile.validate_scenario(sc)

    assert result["errors"] == []


def test_validate_warns_critical_clue_uses_legacy_delivery_without_kind(tmp_path):
    sc = _make_valid_scenario(tmp_path)

    result = coc_scenario_compile.validate_scenario(sc)

    assert any("legacy delivery" in warning for warning in result["warnings"])


def test_validate_no_warnings_for_well_formed_source_refs(tmp_path):
    """Well-formed source_refs (path + int page) produce no source_ref warnings."""
    sc = _make_valid_scenario(tmp_path)
    g = json.loads((sc/"clue-graph.json").read_text())
    g["conclusions"][0]["clues"][0]["delivery_kind"] = "skill_check"
    g["conclusions"][0]["clues"][0]["skill"] = "Spot Hidden"
    g["conclusions"][0]["clues"][0]["source_refs"] = [
        {"path": "pdf/foo.pdf", "page": 12}
    ]
    (sc/"clue-graph.json").write_text(json.dumps(g))
    result = coc_scenario_compile.validate_scenario(sc)
    assert result["errors"] == []
    assert not any("source_ref" in warning for warning in result["warnings"])
    assert any("legacy delivery" in warning for warning in result["warnings"])


def test_validate_no_warnings_without_structured_fields(tmp_path):
    """Old clue-graph without structured delivery fields now warns on critical legacy delivery."""
    sc = _make_valid_scenario(tmp_path)
    result = coc_scenario_compile.validate_scenario(sc)
    assert result["errors"] == []
    assert any("legacy delivery" in warning for warning in result["warnings"])
