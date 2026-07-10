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


def test_validate_warns_when_social_scene_lacks_affordances(tmp_path):
    sc = _make_valid_scenario(tmp_path)
    story = json.loads((sc / "story-graph.json").read_text())
    story["scenes"][0]["scene_id"] = "briefing"
    story["scenes"][0]["scene_type"] = "social"
    # no affordances field
    (sc / "story-graph.json").write_text(json.dumps(story))
    result = coc_scenario_compile.validate_scenario(sc)
    warnings_text = " ".join(result["warnings"])
    assert "briefing" in warnings_text
    assert "affordances" in warnings_text


def test_validate_no_warning_when_social_scene_has_two_affordances(tmp_path):
    sc = _make_valid_scenario(tmp_path)
    story = json.loads((sc / "story-graph.json").read_text())
    story["scenes"][0].update({
        "scene_id": "briefing", "scene_type": "social",
        "affordances": [
            {"id": "ask-cmdr", "cue": "追问指挥官", "route_type": "npc_question", "status": "open"},
            {"id": "check-gear", "cue": "检查装备", "route_type": "environment", "status": "open"},
        ],
    })
    (sc / "story-graph.json").write_text(json.dumps(story))
    result = coc_scenario_compile.validate_scenario(sc)
    assert not any("briefing" in w and "affordances" in w for w in result["warnings"])


def test_validate_no_warning_for_combat_scene_without_affordances(tmp_path):
    sc = _make_valid_scenario(tmp_path)
    story = json.loads((sc / "story-graph.json").read_text())
    story["scenes"][0].update({"scene_id": "fight", "scene_type": "combat"})
    (sc / "story-graph.json").write_text(json.dumps(story))
    result = coc_scenario_compile.validate_scenario(sc)
    assert not any("fight" in w and "affordances" in w for w in result["warnings"])


# ---------------------------------------------------------------------------
# R-5: validate_compiled_scenario — structured findings
# ---------------------------------------------------------------------------

def _finding_codes(findings):
    return {f["code"] for f in findings}


def _findings_by_code(findings, code):
    return [f for f in findings if f["code"] == code]


def _minimal_compiled(**overrides):
    """Inline compiled fixture with one start, one finale, linked by leads_to."""
    compiled = {
        "story_graph": {
            "scenes": [
                {
                    "scene_id": "start",
                    "is_start": True,
                    "dramatic_question": "begin?",
                    "available_clues": ["clue-a"],
                    "npc_ids": ["npc-1"],
                    "exit_targets": ["finale"],
                    "origin": "source",
                },
                {
                    "scene_id": "finale",
                    "is_final": True,
                    "scene_type": "resolution",
                    "dramatic_question": "end?",
                    "available_clues": [],
                    "npc_ids": [],
                    "origin": "source",
                },
            ]
        },
        "clue_graph": {
            "conclusions": [
                {
                    "conclusion_id": "concl-1",
                    "importance": "critical",
                    "minimum_routes": 2,
                    "origin": "source",
                    "clues": [
                        {
                            "clue_id": "clue-a",
                            "delivery_kind": "obvious",
                            "visibility": "player-safe",
                            "leads_to": ["finale"],
                            "origin": "source",
                        },
                        {
                            "clue_id": "clue-b",
                            "delivery_kind": "handout",
                            "visibility": "player-safe",
                            "leads_to": ["finale"],
                            "origin": "source",
                        },
                    ],
                }
            ]
        },
        "npc_agendas": {
            "npcs": [
                {"npc_id": "npc-1", "agenda": "watch", "origin": "source"},
            ]
        },
        "threat_fronts": {
            "fronts": [
                {"front_id": "front-1", "scope": "scenario", "clocks": [], "origin": "source"},
            ]
        },
    }
    compiled.update(overrides)
    return compiled


def test_validate_compiled_duplicate_scene_ids():
    compiled = _minimal_compiled()
    compiled["story_graph"]["scenes"].append(
        {**compiled["story_graph"]["scenes"][0], "scene_id": "start", "is_start": False}
    )
    findings = coc_scenario_compile.validate_compiled_scenario(compiled)
    dupes = _findings_by_code(findings, "duplicate_id")
    assert dupes
    assert all(f["severity"] == "error" for f in dupes)
    assert any("start" in f["message"] for f in dupes)


def test_validate_compiled_duplicate_clue_and_npc_and_front_ids():
    compiled = _minimal_compiled()
    compiled["clue_graph"]["conclusions"][0]["clues"].append(
        {"clue_id": "clue-a", "delivery_kind": "obvious", "origin": "source"}
    )
    compiled["npc_agendas"]["npcs"].append(
        {"npc_id": "npc-1", "agenda": "other", "origin": "inferred"}
    )
    compiled["threat_fronts"]["fronts"].append(
        {"front_id": "front-1", "scope": "scenario", "clocks": [], "origin": "source"}
    )
    findings = coc_scenario_compile.validate_compiled_scenario(compiled)
    dupes = _findings_by_code(findings, "duplicate_id")
    assert len(dupes) >= 3
    messages = " ".join(f["message"] for f in dupes)
    assert "clue-a" in messages and "npc-1" in messages and "front-1" in messages


def test_validate_compiled_broken_leads_to_and_exit_target():
    compiled = _minimal_compiled()
    compiled["clue_graph"]["conclusions"][0]["clues"][0]["leads_to"] = ["missing-scene"]
    compiled["story_graph"]["scenes"][0]["exit_targets"] = ["no-such-scene"]
    compiled["story_graph"]["scenes"][0]["npc_ids"] = ["ghost-npc"]
    compiled["story_graph"]["scenes"][0]["available_clues"] = ["ghost-clue"]
    findings = coc_scenario_compile.validate_compiled_scenario(compiled)
    refs = _findings_by_code(findings, "broken_reference")
    assert refs
    assert all(f["severity"] == "error" for f in refs)
    joined = " ".join(f["message"] for f in refs)
    assert "missing-scene" in joined
    assert "no-such-scene" in joined
    assert "ghost-npc" in joined
    assert "ghost-clue" in joined


def test_validate_compiled_orphan_scene_is_warning():
    compiled = _minimal_compiled()
    compiled["story_graph"]["scenes"].append(
        {
            "scene_id": "orphan",
            "dramatic_question": "unused?",
            "available_clues": [],
            "npc_ids": [],
            "origin": "source",
        }
    )
    findings = coc_scenario_compile.validate_compiled_scenario(compiled)
    orphans = _findings_by_code(findings, "unreachable_scene")
    assert orphans
    assert all(f["severity"] == "warning" for f in orphans)
    assert any(f.get("path", "").endswith("orphan") or "orphan" in f["message"] for f in orphans)


def test_validate_compiled_multi_route_independence():
    """Critical conclusion must meet minimum_routes with distinct clue_ids."""
    compiled = _minimal_compiled()
    compiled["clue_graph"]["conclusions"][0]["minimum_routes"] = 3
    # only 2 distinct clues present
    findings = coc_scenario_compile.validate_compiled_scenario(compiled)
    routes = _findings_by_code(findings, "insufficient_routes")
    assert routes
    assert all(f["severity"] == "error" for f in routes)

    # Model gap note: no separate alternate_route identity beyond clue list —
    # when minimum_routes is met via distinct clue_ids, no finding.
    compiled["clue_graph"]["conclusions"][0]["clues"].append(
        {
            "clue_id": "clue-c",
            "delivery_kind": "environmental",
            "visibility": "player-safe",
            "leads_to": ["finale"],
            "origin": "source",
        }
    )
    findings_ok = coc_scenario_compile.validate_compiled_scenario(compiled)
    assert not _findings_by_code(findings_ok, "insufficient_routes")


def test_validate_compiled_requires_exactly_one_start_and_at_least_one_finale():
    compiled = _minimal_compiled()
    compiled["story_graph"]["scenes"][0]["is_start"] = False
    findings = coc_scenario_compile.validate_compiled_scenario(compiled)
    assert _findings_by_code(findings, "missing_start")

    compiled = _minimal_compiled()
    compiled["story_graph"]["scenes"].append(
        {
            "scene_id": "also-start",
            "is_start": True,
            "dramatic_question": "q",
            "available_clues": [],
            "npc_ids": [],
            "exit_targets": ["finale"],
            "origin": "source",
        }
    )
    findings = coc_scenario_compile.validate_compiled_scenario(compiled)
    assert _findings_by_code(findings, "multiple_starts")

    compiled = _minimal_compiled()
    compiled["story_graph"]["scenes"][1]["is_final"] = False
    compiled["story_graph"]["scenes"][1]["scene_type"] = "investigation"
    findings = coc_scenario_compile.validate_compiled_scenario(compiled)
    assert _findings_by_code(findings, "missing_finale")


def test_validate_compiled_source_refs_anchor_against_segments():
    compiled = _minimal_compiled()
    compiled["clue_graph"]["conclusions"][0]["clues"][0]["source_refs"] = [
        {
            "source_id": "pdf:demo",
            "path": "pdf/demo.pdf",
            "page": 2,
            "grep_anchor": "Chapel records were moved",
        }
    ]
    segments = [
        {"page": 2, "text": "Something else entirely on this page."},
    ]
    findings = coc_scenario_compile.validate_compiled_scenario(
        compiled, source_segments=segments
    )
    anchors = _findings_by_code(findings, "missing_source_anchor")
    assert anchors
    assert all(f["severity"] == "error" for f in anchors)

    segments_ok = [
        {"page": 2, "text": "Note: Chapel records were moved to the annex."},
    ]
    findings_ok = coc_scenario_compile.validate_compiled_scenario(
        compiled, source_segments=segments_ok
    )
    assert not _findings_by_code(findings_ok, "missing_source_anchor")


def test_validate_compiled_flags_missing_origin():
    compiled = _minimal_compiled()
    del compiled["story_graph"]["scenes"][0]["origin"]
    del compiled["clue_graph"]["conclusions"][0]["clues"][0]["origin"]
    findings = coc_scenario_compile.validate_compiled_scenario(compiled)
    missing = _findings_by_code(findings, "missing_origin")
    assert len(missing) >= 2
    assert all(f["severity"] == "warning" for f in missing)


def test_annotate_provenance_defaults_origin():
    compiled = _minimal_compiled()
    del compiled["story_graph"]["scenes"][0]["origin"]
    del compiled["npc_agendas"]["npcs"][0]["origin"]
    annotated = coc_scenario_compile.annotate_provenance(compiled)
    assert annotated["story_graph"]["scenes"][0]["origin"] == "source"
    assert annotated["npc_agendas"]["npcs"][0]["origin"] == "source"
    # inferred when explicitly marked derivation
    annotated["clue_graph"]["conclusions"][0]["clues"][0]["derived"] = True
    annotated = coc_scenario_compile.annotate_provenance(annotated)
    assert annotated["clue_graph"]["conclusions"][0]["clues"][0]["origin"] in (
        "source", "inferred", "improvised"
    )


def test_doctor_reports_structured_environment():
    results = coc_scenario_compile.doctor()
    assert isinstance(results, list)
    assert results
    assert all(
        set(r) >= {"code", "severity", "message"} or set(r) >= {"check", "ok", "message"}
        for r in results
    )
    # Accept either shape; normalize via helper if present
    codes = {r.get("code") or r.get("check") for r in results}
    assert any("python" in str(c).lower() for c in codes)
    assert any("rules" in str(c).lower() or "rules_json" in str(c).lower() for c in codes)


def test_cli_doctor_exits_zero():
    proc = subprocess.run(
        [sys.executable, str(_scenario_script_path()), "--doctor"],
        capture_output=True, text=True,
    )
    assert proc.returncode == 0, proc.stderr or proc.stdout
    assert proc.stdout.strip()


def test_validate_compiled_clean_fixture_has_no_errors():
    findings = coc_scenario_compile.validate_compiled_scenario(_minimal_compiled())
    errors = [f for f in findings if f["severity"] == "error"]
    assert errors == []
