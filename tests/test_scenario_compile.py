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
HAUNTING_STORY = Path(
    "plugins/coc-keeper/references/starter-scenarios/the-haunting/story-graph.json"
)
HAUNTING_CLUES = Path(
    "plugins/coc-keeper/references/starter-scenarios/the-haunting/clue-graph.json"
)


def test_haunting_research_affordance_is_action_only_not_the_clue_answer():
    story = json.loads(HAUNTING_STORY.read_text(encoding="utf-8"))
    briefing = next(
        scene for scene in story["scenes"]
        if scene.get("scene_id") == "commission-briefing"
    )
    route = next(
        row for row in briefing["affordances"]
        if row.get("id") == "ask-research-options"
    )
    assert route["cue"] == "追问这栋宅子的旧账可以从哪些公开记录或知情人查起。"


def test_haunting_globe_clue_has_canonical_zh_hans_player_summary():
    graph = json.loads(HAUNTING_CLUES.read_text(encoding="utf-8"))
    clue = next(
        clue
        for conclusion in graph["conclusions"]
        for clue in conclusion.get("clues", [])
        if clue.get("clue_id") == "clue-globe-unpublished-story"
    )

    summary = clue["localized_text"]["zh-Hans"]["player_safe_summary"]
    assert "1918 年专题" in summary
    assert "马卡里奥一家" in summary


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


def test_validate_mechanics_rejects_authored_npc_without_source_page(tmp_path):
    sc = _make_valid_scenario(tmp_path)
    path = sc / "npc-agendas.json"
    data = json.loads(path.read_text())
    data["npcs"][0]["mechanics"] = {
        "status": "authored",
        "profile": {
            "profile_kind": "actor",
            "characteristic_scale": "percentile",
            "characteristics": {
                "STR": 50, "CON": 50, "SIZ": 50, "DEX": 50, "POW": 50,
            },
        },
    }
    path.write_text(json.dumps(data))

    result = coc_scenario_compile.validate_scenario(sc)

    assert any("authored mechanics requires source_refs" in row for row in result["errors"])


def test_validate_mechanics_accepts_sparse_unresolved_locator(tmp_path):
    sc = _make_valid_scenario(tmp_path)
    path = sc / "npc-agendas.json"
    data = json.loads(path.read_text())
    data["npcs"][0]["mechanics"] = {"status": "unresolved"}
    path.write_text(json.dumps(data))

    result = coc_scenario_compile.validate_scenario(sc)

    assert not any("mechanics_contract_invalid" in row for row in result["errors"])


def test_npc_presence_requirement_requires_scene_npc_and_scene_route(tmp_path):
    sc = _make_valid_scenario(tmp_path)
    story_path = sc / "story-graph.json"
    story = json.loads(story_path.read_text())
    story["scenes"][0].update({
        "npc_ids": ["n1"],
        "affordances": [{"id": "open-door", "cue": "Open the door."}],
        "npc_presence_requirements": [{
            "npc_id": "n1",
            "requires_completed_route_ids": ["missing-route"],
        }],
    })
    story_path.write_text(json.dumps(story))

    findings = coc_scenario_compile.validate_compiled_scenario(
        coc_scenario_compile.load_compiled_from_dir(sc)
    )

    assert any(
        row["code"] == "invalid_npc_presence_requirement"
        for row in findings
    )


def test_haunting_ruth_presence_gate_is_structurally_valid():
    story = json.loads(HAUNTING_STORY.read_text(encoding="utf-8"))
    newspaper = next(
        scene for scene in story["scenes"]
        if scene.get("scene_id") == "newspaper-morgue"
    )

    assert newspaper["npc_presence_requirements"] == [{
        "npc_id": "npc-ruth-blake",
        "requires_completed_route_ids": ["persuade-arty"],
    }]


def test_social_clue_requires_registered_source_npc_in_both_validators(tmp_path):
    sc = _make_valid_scenario(tmp_path)
    graph = json.loads((sc / "clue-graph.json").read_text())
    graph["conclusions"][0]["clues"][0].update({
        "delivery_kind": "npc_dialogue", "source_npc_ids": ["missing-npc"],
    })
    (sc / "clue-graph.json").write_text(json.dumps(graph))
    disk = coc_scenario_compile.validate_scenario(sc)
    compiled = coc_scenario_compile.load_compiled_from_dir(sc)
    findings = coc_scenario_compile.validate_compiled_scenario(compiled)
    assert any("unknown source NPC" in error for error in disk["errors"])
    assert any(f["code"] == "social_clue_source_unknown" for f in findings)


def test_npc_fact_requires_registered_clue_in_both_validators(tmp_path):
    sc = _make_valid_scenario(tmp_path)
    npcs = json.loads((sc / "npc-agendas.json").read_text())
    npcs["npcs"][0]["facts"] = [{"fact_id": "fact-a", "clue_id": "missing"}]
    (sc / "npc-agendas.json").write_text(json.dumps(npcs))
    compiled = coc_scenario_compile.load_compiled_from_dir(sc)
    findings = coc_scenario_compile.validate_compiled_scenario(compiled)
    assert any(f["code"] == "npc_fact_reference_invalid" for f in findings)


@pytest.mark.parametrize("mutate", [
    lambda npc: npc.update({"known_fact_ids": "fact-a"}),
    lambda npc: npc.update({"revealable_fact_ids": ["missing"]}),
    lambda npc: npc.update({"disclosure_order": ["missing"]}),
    lambda npc: npc.update({"leverage_ids": [1]}),
    lambda npc: npc.update({"active_reactions": [{"reaction_id": "r", "blocks_disclosure": "yes"}]}),
    lambda npc: npc.update({"availability": {"status": "maybe"}}),
    lambda npc: npc.update({"schedule": [{"schedule_id": "s", "scene_ids": "s1", "status": "available"}]}),
    lambda npc: npc.update({"facts": [{"fact_id": "fact-a", "clue_id": "a", "min_trust": True}]}),
    lambda npc: npc.update({"lie_options": [{"lie_id": "l", "fact_id": "missing"}]}),
    lambda npc: npc.update({"deflect_options": [{"deflect_id": "d", "player_safe_line": 3}]}),
])
def test_complete_a21_contract_fails_closed_in_disk_and_compiled_validators(tmp_path, mutate):
    sc = _make_valid_scenario(tmp_path)
    doc = json.loads((sc / "npc-agendas.json").read_text())
    npc = doc["npcs"][0]
    npc.update({
        "known_fact_ids": ["fact-a"], "revealable_fact_ids": ["fact-a"],
        "disclosure_order": ["fact-a"],
        "facts": [{"fact_id": "fact-a", "clue_id": "a", "min_trust": 0}],
        "leverage_ids": [], "active_reactions": [], "lie_options": [],
        "deflect_options": [], "availability": {"status": "available"}, "schedule": [],
    })
    mutate(npc)
    (sc / "npc-agendas.json").write_text(json.dumps(doc))
    disk = coc_scenario_compile.validate_scenario(sc)
    compiled = coc_scenario_compile.validate_compiled_scenario(
        coc_scenario_compile.load_compiled_from_dir(sc)
    )
    assert any("A21" in error for error in disk["errors"])
    assert any(f.get("severity") == "error" and "A21" in f["message"] for f in compiled)


def test_runtime_context_rejects_invalid_a21_contract(tmp_path):
    # The same canonical validator used by compile must reject runtime payloads.
    findings = coc_scenario_compile.validate_npc_a21_contract(
        {"npcs": [{"npc_id": "n1", "agenda": "x", "known_fact_ids": "bad"}]},
        {"conclusions": []},
    )
    assert findings and findings[0]["code"] == "npc_a21_contract_invalid"


def test_schedule_conflicts_fail_disk_and_compiled_validation(tmp_path):
    sc = _make_valid_scenario(tmp_path)
    doc = json.loads((sc / "npc-agendas.json").read_text())
    doc["npcs"][0].update({
        "known_fact_ids": [], "revealable_fact_ids": [], "facts": [],
        "availability": {"status": "available"},
        "schedule": [
            {"schedule_id": "a", "scene_ids": ["s1"], "status": "available"},
            {"schedule_id": "b", "time_categories": ["overnight"], "status": "unavailable"},
        ],
    })
    (sc / "npc-agendas.json").write_text(json.dumps(doc))
    disk = coc_scenario_compile.validate_scenario(sc)
    compiled = coc_scenario_compile.validate_compiled_scenario(
        coc_scenario_compile.load_compiled_from_dir(sc)
    )
    assert any("overlapping" in error for error in disk["errors"])
    assert any("overlapping" in finding["message"] for finding in compiled)


def test_time_loop_scene_signals_fail_disk_and_compiled_validation(tmp_path):
    sc = _make_valid_scenario(tmp_path)
    story = json.loads((sc / "story-graph.json").read_text())
    story["scenes"][0].update({
        "loop_boundary": "yes", "player_retained_memory_ids": ["memory-a", "memory-a"],
    })
    (sc / "story-graph.json").write_text(json.dumps(story))
    disk = coc_scenario_compile.validate_scenario(sc)
    compiled = coc_scenario_compile.validate_compiled_scenario(
        coc_scenario_compile.load_compiled_from_dir(sc)
    )
    assert any("time-loop strategy signals" in error for error in disk["errors"])
    assert any(f["code"] == "strategy_signals_invalid" for f in compiled)

def test_validate_bad_structure_type(tmp_path):
    sc = _make_valid_scenario(tmp_path)
    m = json.loads((sc/"module-meta.json").read_text())
    m["structure_type"] = "bogus_type"
    (sc/"module-meta.json").write_text(json.dumps(m))
    result = coc_scenario_compile.validate_scenario(sc)
    assert any("structure_type" in e for e in result["errors"])


def test_normalize_scene_function_has_exact_six_field_contract():
    normalized = coc_scenario_compile.normalize_scene_function({
        "scene_type": " social ", "dramatic_question": " Will she talk? ",
        "unknown_extension": {"preserve_on_scene": True},
    })
    assert normalized == {
        "scene_function": "social",
        "goals": ["Will she talk?"],
        "required_reveals": [],
        "failure_modes": [],
        "exit_options": [],
        "mode_affinity": [],
    }


@pytest.mark.parametrize("bad_field,bad_value", [
    ("scene_function", ""), ("goals", "not-a-list"),
    ("required_reveals", [""]), ("failure_modes", [1]),
    ("exit_options", None), ("mode_affinity", {"mode": "x"}),
])
def test_scene_function_contract_fails_closed_in_both_validators(
    tmp_path, bad_field, bad_value,
):
    sc = _make_valid_scenario(tmp_path)
    story = json.loads((sc / "story-graph.json").read_text())
    story["scenes"][0].update(coc_scenario_compile.normalize_scene_function(story["scenes"][0]))
    story["scenes"][0][bad_field] = bad_value
    (sc / "story-graph.json").write_text(json.dumps(story))

    disk = coc_scenario_compile.validate_scenario(sc)
    compiled = coc_scenario_compile.load_compiled_from_dir(sc)
    findings = coc_scenario_compile.validate_compiled_scenario(compiled)

    assert any("scene function" in error for error in disk["errors"])
    assert any(f["code"] == "scene_function_contract_invalid" for f in findings)


def test_valid_scene_function_contract_passes_both_validators(tmp_path):
    sc = _make_valid_scenario(tmp_path)
    story = json.loads((sc / "story-graph.json").read_text())
    story["scenes"][0].update({
        "scene_function": "investigation", "goals": ["find-record"],
        "required_reveals": ["a"], "failure_modes": ["clock-tick"],
        "exit_options": ["s2"], "mode_affinity": ["careful"],
    })
    (sc / "story-graph.json").write_text(json.dumps(story))
    assert not [e for e in coc_scenario_compile.validate_scenario(sc)["errors"]
                if "scene function" in e]
    assert not [f for f in coc_scenario_compile.validate_compiled_scenario(
        coc_scenario_compile.load_compiled_from_dir(sc)
    ) if f["code"] == "scene_function_contract_invalid"]


def test_partial_scene_function_contract_fails_at_runtime(tmp_path):
    sc = _make_valid_scenario(tmp_path)
    story = json.loads((sc / "story-graph.json").read_text())
    story["scenes"][0]["goals"] = ["partial-is-not-legacy"]

    with pytest.raises(ValueError, match="all six fields"):
        coc_scenario_compile.normalize_scene_function(story["scenes"][0])


@pytest.mark.parametrize("owner,field,value", [
    ("front", "severity", "high"),
    ("front", "scene_tags_any", "archive"),
    ("clock", "scene_ids", [""]),
    ("clock", "faction_ids", [1]),
])
def test_threat_affinity_contract_fails_closed_in_both_validators(
    tmp_path, owner, field, value,
):
    sc = _make_valid_scenario(tmp_path)
    front = {"front_id": "cult", "clocks": [{"clock_id": "doom", "segments": 6}]}
    target = front if owner == "front" else front["clocks"][0]
    target[field] = value
    (sc / "threat-fronts.json").write_text(json.dumps({"fronts": [front]}))
    disk = coc_scenario_compile.validate_scenario(sc)
    findings = coc_scenario_compile.validate_compiled_scenario(
        coc_scenario_compile.load_compiled_from_dir(sc)
    )
    assert any("threat affinity" in error for error in disk["errors"])
    assert any(f["code"] == "threat_affinity_contract_invalid" for f in findings)


@pytest.mark.parametrize("field,value", [
    ("scene_tags", "archive"),
    ("faction_ids", [""]),
    ("threat_front_ids", [1]),
    ("front_ids", ["cult"]),
])
def test_scene_affinity_contract_fails_closed_in_both_validators(
    tmp_path, field, value,
):
    sc = _make_valid_scenario(tmp_path)
    story = json.loads((sc / "story-graph.json").read_text())
    story["scenes"][0][field] = value
    (sc / "story-graph.json").write_text(json.dumps(story))

    disk = coc_scenario_compile.validate_scenario(sc)
    findings = coc_scenario_compile.validate_compiled_scenario(
        coc_scenario_compile.load_compiled_from_dir(sc)
    )

    assert any("scene affinity" in error for error in disk["errors"])
    assert any(f["code"] == "scene_affinity_contract_invalid" for f in findings)


@pytest.mark.parametrize("clock_ids", [
    ["same", "same"],
    ["same", " same "],
    ["", "other"],
])
def test_clock_identity_is_global_nonempty_and_canonical_in_both_validators(
    tmp_path, clock_ids,
):
    sc = _make_valid_scenario(tmp_path)
    fronts = {"fronts": [
        {"front_id": "one", "clocks": [{"clock_id": clock_ids[0], "segments": 6}]},
        {"front_id": "two", "clocks": [{"clock_id": clock_ids[1], "segments": 6}]},
    ]}
    (sc / "threat-fronts.json").write_text(json.dumps(fronts))

    disk = coc_scenario_compile.validate_scenario(sc)
    findings = coc_scenario_compile.validate_compiled_scenario(
        coc_scenario_compile.load_compiled_from_dir(sc)
    )

    assert any("clock_id" in error for error in disk["errors"])
    assert any(f["code"] == "threat_clock_identity_invalid" for f in findings)


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
# setting_tags + clue bonus shape checks (storylet-schema.md)
# ---------------------------------------------------------------------------

def test_validate_module_meta_setting_tags_good_shape_passes(tmp_path):
    sc = _make_valid_scenario(tmp_path)
    m = json.loads((sc/"module-meta.json").read_text())
    m["setting_tags"] = ["urban-civilian", "domestic", "1920s"]
    (sc/"module-meta.json").write_text(json.dumps(m))
    result = coc_scenario_compile.validate_scenario(sc)
    assert result["errors"] == []


def test_validate_module_meta_setting_tags_bad_shape_errors(tmp_path):
    sc = _make_valid_scenario(tmp_path)
    m = json.loads((sc/"module-meta.json").read_text())
    m["setting_tags"] = "military"  # not a list
    (sc/"module-meta.json").write_text(json.dumps(m))
    result = coc_scenario_compile.validate_scenario(sc)
    assert any("module-meta.setting_tags" in e for e in result["errors"])


def test_validate_module_meta_setting_tags_rejects_non_string_items(tmp_path):
    sc = _make_valid_scenario(tmp_path)
    m = json.loads((sc/"module-meta.json").read_text())
    m["setting_tags"] = ["military", 7, ""]
    (sc/"module-meta.json").write_text(json.dumps(m))
    result = coc_scenario_compile.validate_scenario(sc)
    assert any("module-meta.setting_tags" in e for e in result["errors"])


def test_validate_scene_setting_tags_good_and_bad(tmp_path):
    sc = _make_valid_scenario(tmp_path)
    g = json.loads((sc/"story-graph.json").read_text())
    g["scenes"][0]["setting_tags"] = ["military", "wilderness"]
    (sc/"story-graph.json").write_text(json.dumps(g))
    assert coc_scenario_compile.validate_scenario(sc)["errors"] == []

    g["scenes"][0]["setting_tags"] = {"military": True}  # not a list
    (sc/"story-graph.json").write_text(json.dumps(g))
    result = coc_scenario_compile.validate_scenario(sc)
    assert any("scene 's1' setting_tags" in e for e in result["errors"])


def _set_first_clue_bonus(sc, bonus):
    g = json.loads((sc/"clue-graph.json").read_text())
    g["conclusions"][0]["clues"][0]["bonus"] = bonus
    (sc/"clue-graph.json").write_text(json.dumps(g))


def _valid_clue_bonus(**updates):
    bonus = {
        "schema_version": 1,
        "origin": "improvised",
        "skill": "Library Use",
        "extra_summary": "Extra player-safe detail.",
        "fumble_consequence": {
            "summary": "The search leaves the investigator visibly rattled.",
            "effect": {
                "kind": "condition", "condition_id": "archive-rattled",
            },
        },
    }
    bonus.update(updates)
    return bonus


def test_validate_clue_bonus_good_shape_passes(tmp_path):
    sc = _make_valid_scenario(tmp_path)
    _set_first_clue_bonus(sc, _valid_clue_bonus(
        difficulty="hard",
        on_fail_cost="pressure",
    ))
    result = coc_scenario_compile.validate_scenario(sc)
    assert not any("bonus" in e for e in result["errors"])


def test_validate_clue_bonus_defaults_pass_without_optionals(tmp_path):
    sc = _make_valid_scenario(tmp_path)
    _set_first_clue_bonus(sc, _valid_clue_bonus(
        skill="Spot Hidden", extra_summary="More detail.",
    ))
    result = coc_scenario_compile.validate_scenario(sc)
    assert not any("bonus" in e for e in result["errors"])


def test_validate_clue_bonus_missing_skill_errors(tmp_path):
    sc = _make_valid_scenario(tmp_path)
    bonus = _valid_clue_bonus(extra_summary="Detail.")
    bonus.pop("skill")
    _set_first_clue_bonus(sc, bonus)
    result = coc_scenario_compile.validate_scenario(sc)
    assert any("clue 'a'" in e and "bonus.skill" in e for e in result["errors"])


def test_validate_clue_bonus_bad_difficulty_errors(tmp_path):
    sc = _make_valid_scenario(tmp_path)
    _set_first_clue_bonus(sc, _valid_clue_bonus(
        skill="Law", extra_summary="x", difficulty="impossible",
    ))
    result = coc_scenario_compile.validate_scenario(sc)
    assert any("clue 'a'" in e and "bonus.difficulty" in e for e in result["errors"])


def test_validate_clue_bonus_bad_on_fail_cost_errors(tmp_path):
    sc = _make_valid_scenario(tmp_path)
    _set_first_clue_bonus(sc, _valid_clue_bonus(
        skill="Law", extra_summary="x", on_fail_cost="sanity",
    ))
    result = coc_scenario_compile.validate_scenario(sc)
    assert any("clue 'a'" in e and "bonus.on_fail_cost" in e for e in result["errors"])


def test_validate_clue_bonus_non_string_extra_summary_errors(tmp_path):
    sc = _make_valid_scenario(tmp_path)
    _set_first_clue_bonus(sc, _valid_clue_bonus(skill="Law", extra_summary=42))
    result = coc_scenario_compile.validate_scenario(sc)
    assert any("clue 'a'" in e and "bonus.extra_summary" in e for e in result["errors"])


def test_validate_clue_bonus_non_object_errors(tmp_path):
    sc = _make_valid_scenario(tmp_path)
    _set_first_clue_bonus(sc, "roll Library Use")
    result = coc_scenario_compile.validate_scenario(sc)
    assert any("clue 'a'" in e and "bonus must be an object" in e for e in result["errors"])


def test_validate_clue_bonus_requires_typed_fumble_consequence(tmp_path):
    sc = _make_valid_scenario(tmp_path)
    bonus = _valid_clue_bonus()
    bonus.pop("fumble_consequence")
    _set_first_clue_bonus(sc, bonus)
    result = coc_scenario_compile.validate_scenario(sc)
    assert any("bonus.fumble_consequence" in e for e in result["errors"])


def test_validate_source_clue_bonus_requires_its_own_source_refs(tmp_path):
    sc = _make_valid_scenario(tmp_path)
    _set_first_clue_bonus(sc, _valid_clue_bonus(origin="source"))
    result = coc_scenario_compile.validate_scenario(sc)
    assert any("source bonus requires its own" in e for e in result["errors"])


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
    compiled["story_graph"]["scenes"][0]["affordances"] = [{
        "id": "broken-route", "cue": "Inspect it.",
        "clue_id": "ghost-route-clue",
    }]
    findings = coc_scenario_compile.validate_compiled_scenario(compiled)
    refs = _findings_by_code(findings, "broken_reference")
    assert refs
    assert all(f["severity"] == "error" for f in refs)
    joined = " ".join(f["message"] for f in refs)
    assert "missing-scene" in joined
    assert "no-such-scene" in joined
    assert "ghost-npc" in joined
    assert "ghost-clue" in joined
    assert "ghost-route-clue" in joined


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


def test_validate_compiled_scene_edges_broken_target():
    compiled = _minimal_compiled()
    compiled["story_graph"]["scenes"][0]["scene_edges"] = [
        {
            "to": "no-such-scene",
            "kind": "unlock",
            "when": {"kind": "clue_discovered", "clue_id": "clue-a"},
        }
    ]
    findings = coc_scenario_compile.validate_compiled_scenario(compiled)
    broken = _findings_by_code(findings, "broken_reference")
    assert any("scene_edges" in f["path"] for f in broken)


def test_validate_compiled_scene_edges_reachability():
    compiled = _minimal_compiled()
    # Prefer scene_edges over exit_targets for reachability.
    compiled["story_graph"]["scenes"][0].pop("exit_targets", None)
    compiled["story_graph"]["scenes"][0]["scene_edges"] = [
        {"to": "finale", "kind": "travel", "when": {"kind": "always"}}
    ]
    compiled["story_graph"]["scenes"].append(
        {
            "scene_id": "orphan",
            "dramatic_question": "unreachable?",
            "available_clues": [],
            "npc_ids": [],
            "scene_edges": [],
            "origin": "source",
        }
    )
    findings = coc_scenario_compile.validate_compiled_scenario(compiled)
    orphans = _findings_by_code(findings, "unreachable_scene")
    assert any("orphan" in f["message"] for f in orphans)


def test_validate_compiled_location_tags_shape_ok():
    compiled = _minimal_compiled()
    compiled["story_graph"]["scenes"][0]["location_tags"] = [
        "corbitt house", "old house", "科比特老宅"
    ]
    findings = coc_scenario_compile.validate_compiled_scenario(compiled)
    assert not [f for f in findings if f["code"] == "invalid_location_tags"]


def test_validate_compiled_location_tags_rejects_non_list():
    compiled = _minimal_compiled()
    compiled["story_graph"]["scenes"][0]["location_tags"] = "corbitt house"
    findings = coc_scenario_compile.validate_compiled_scenario(compiled)
    bad = [f for f in findings if f["code"] == "invalid_location_tags"]
    assert bad
    assert "location_tags" in bad[0]["message"]


def test_validate_compiled_location_tags_rejects_empty_string():
    compiled = _minimal_compiled()
    compiled["story_graph"]["scenes"][0]["location_tags"] = ["ok", ""]
    findings = coc_scenario_compile.validate_compiled_scenario(compiled)
    bad = [f for f in findings if f["code"] == "invalid_location_tags"]
    assert bad


def test_validate_compiled_location_tags_absent_is_ok():
    compiled = _minimal_compiled()
    compiled["story_graph"]["scenes"][0].pop("location_tags", None)
    findings = coc_scenario_compile.validate_compiled_scenario(compiled)
    assert not [f for f in findings if f["code"] == "invalid_location_tags"]


def test_validate_compiled_destination_access_accepts_public_independent():
    compiled = _minimal_compiled()
    compiled["story_graph"]["scenes"][0]["destination_access"] = {
        "schema_version": 1,
        "discoverability": "public",
        "direct_entry": "independent",
    }
    findings = coc_scenario_compile.validate_compiled_scenario(compiled)
    assert not [
        row for row in findings if row["code"] == "invalid_destination_access"
    ]


@pytest.mark.parametrize("discoverability", ["hidden", "evidence_gated"])
def test_validate_compiled_destination_access_rejects_nonpublic_independent(
    discoverability,
):
    compiled = _minimal_compiled()
    compiled["story_graph"]["scenes"][0]["destination_access"] = {
        "schema_version": 1,
        "discoverability": discoverability,
        "direct_entry": "independent",
    }
    findings = coc_scenario_compile.validate_compiled_scenario(compiled)
    assert [
        row for row in findings if row["code"] == "invalid_destination_access"
    ]


@pytest.mark.parametrize(
    ("affordance", "code"),
    [
        (
            {"id": "bad", "cue": "Bad policy", "completion_policy": "automatic"},
            "invalid_affordance_completion",
        ),
        (
            {"id": "bad", "cue": "No durable effect", "completion_policy": "matched_no_roll"},
            "invalid_affordance_completion",
        ),
        (
            {
                "id": "bad", "cue": "Undeclared minimum", "skills": ["Law"],
                "skill_minimums": {"Credit Rating": 75},
            },
            "invalid_affordance_skill_minimum",
        ),
        (
            {
                "id": "bad", "cue": "Out-of-range minimum",
                "skills": ["Credit Rating"],
                "skill_minimums": {"Credit Rating": 101},
            },
            "invalid_affordance_skill_minimum",
        ),
        (
            {"id": "bad", "cue": "Unknown runtime status", "runtime_status": "BLOCKED"},
            "invalid_affordance_runtime_status",
        ),
        (
            {"id": "bad", "cue": "Missing operation", "runtime_status": "NOT_IMPLEMENTED"},
            "invalid_affordance_runtime_status",
        ),
        (
            {
                "id": "bad", "cue": "Gate with an undeclared approach.",
                "verbs": ["persuade"], "skills": ["Persuade"],
                "roll_gate": {
                    "kind": "skill_check", "difficulty": "regular",
                    "stakes": "archive access",
                    "approaches": [{"verb": "charm", "skill": "Charm"}],
                },
            },
            "invalid_affordance_roll_gate",
        ),
        (
            {
                "id": "bad", "cue": "Gate without typed approaches.",
                "verbs": ["persuade"], "skills": ["Persuade"],
                "roll_gate": {
                    "kind": "skill_check", "difficulty": "regular",
                    "stakes": "archive access", "approaches": [],
                },
            },
            "invalid_affordance_roll_gate",
        ),
        (
            {
                "id": "bad", "cue": "Gate with duplicate approaches.",
                "verbs": ["persuade"], "skills": ["Persuade"],
                "roll_gate": {
                    "kind": "skill_check", "difficulty": "regular",
                    "stakes": "archive access",
                    "approaches": [
                        {"verb": "persuade", "skill": "Persuade"},
                        {"verb": "persuade", "skill": "Persuade"},
                    ],
                },
            },
            "invalid_affordance_roll_gate",
        ),
    ],
)
def test_validate_compiled_affordance_completion_and_skill_minimums_fail_closed(
    affordance, code,
):
    compiled = _minimal_compiled()
    compiled["story_graph"]["scenes"][0]["affordances"] = [affordance]
    findings = coc_scenario_compile.validate_compiled_scenario(compiled)
    assert _findings_by_code(findings, code)


def test_validate_compiled_accepts_typed_no_roll_completion_and_skill_minimum():
    compiled = _minimal_compiled()
    compiled["story_graph"]["scenes"][0]["affordances"] = [
        {
            "id": "redirect", "cue": "Ask for the correct office.",
            "completion_policy": "matched_no_roll", "sets_flags": ["office-known"],
        },
        {
            "id": "petition", "cue": "Petition for the file.",
            "skills": ["Persuade", "Credit Rating"],
            "skill_minimums": {"Credit Rating": 75},
        },
        {
            "id": "hazard", "cue": "Cross the weak floor.",
            "runtime_status": "NOT_IMPLEMENTED",
            "required_typed_operations": ["environmental_hazard"],
        },
        {
            "id": "access", "cue": "Convince the editor to allow access.",
            "verbs": ["persuade", "charm"],
            "skills": ["Persuade", "Charm"],
            "roll_gate": {
                "kind": "skill_check", "difficulty": "regular",
                "stakes": "archive access",
                "ordinary_failure": {
                    "mode": "no_progress", "summary": "Access is refused.",
                },
                "fumble_consequence": {
                    "summary": "The petitioner is escorted from the building.",
                    "effect": {"kind": "condition", "condition_id": "barred-access"},
                },
                "push_failure_consequence": {
                    "summary": "The petitioner is permanently barred.",
                    "effect": {"kind": "route_closed", "route_id": "access"},
                },
                "retry_policy": {
                    "mode": "elapsed_time_reset",
                    "minimum_elapsed_minutes": 240,
                },
                "approaches": [
                    {"verb": "persuade", "skill": "Persuade"},
                    {"verb": "charm", "skill": "Charm"},
                ],
            },
        },
    ]
    findings = coc_scenario_compile.validate_compiled_scenario(compiled)
    assert not _findings_by_code(findings, "invalid_affordance_completion")
    assert not _findings_by_code(findings, "invalid_affordance_skill_minimum")
    assert not _findings_by_code(findings, "invalid_affordance_runtime_status")
    assert not _findings_by_code(findings, "invalid_affordance_roll_gate")
