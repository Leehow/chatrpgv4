#!/usr/bin/env python3
"""Tests for coc_module_registry: identity-keyed compiled module library."""
from __future__ import annotations

import importlib.util
import inspect
import json
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPTS = Path("plugins/coc-keeper/scripts")


def _load(name: str, rel: str):
    spec = importlib.util.spec_from_file_location(name, rel)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


coc_module_registry = _load("coc_module_registry", str(SCRIPTS / "coc_module_registry.py"))
coc_scenario_compile = _load("coc_scenario_compile", str(SCRIPTS / "coc_scenario_compile.py"))
coc_state = _load("coc_state", str(SCRIPTS / "coc_state.py"))


def _make_valid_scenario(tmp_path: Path, *, with_identity: bool = True) -> Path:
    sc = tmp_path / "scenario"
    sc.mkdir()
    meta = {
        "schema_version": 1,
        "scenario_id": "demo-module",
        "title": "Demo Module",
        "structure_type": "branching_investigation",
        "era": "1920s",
        "content_flags": [],
        "win_condition": "survive",
    }
    if with_identity:
        meta["module_identity"] = {
            "canonical_module_id": "demo-module",
            "canonical_title": "Demo Module",
            "edition": "7e",
            "locale": "en",
            "publisher": "Test Press",
        }
    (sc / "module-meta.json").write_text(json.dumps(meta), encoding="utf-8")
    (sc / "story-graph.json").write_text(
        json.dumps(
            {
                "scenes": [
                    {
                        "scene_id": "s1",
                        "dramatic_question": "Will they dig?",
                        "entry_conditions": [],
                        "exit_conditions": [],
                        "available_clues": [],
                        "npc_ids": [],
                        "pressure_moves": [],
                        "tone": [],
                        "allowed_improvisation": [],
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    (sc / "clue-graph.json").write_text(
        json.dumps(
            {
                "conclusions": [
                    {
                        "conclusion_id": "c1",
                        "importance": "critical",
                        "minimum_routes": 3,
                        "fallback_policy": "RECOVER public notice",
                        "clues": [
                            {
                                "clue_id": "a",
                                "delivery": "handout",
                                "delivery_kind": "handout",
                                "visibility": "player-safe",
                            },
                            {
                                "clue_id": "b",
                                "delivery": "npc",
                                "delivery_kind": "npc_dialogue",
                                "visibility": "player-safe",
                            },
                            {
                                "clue_id": "c",
                                "delivery": "env",
                                "delivery_kind": "environmental",
                                "visibility": "player-safe",
                            },
                        ],
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    (sc / "npc-agendas.json").write_text(
        json.dumps({"npcs": [{"npc_id": "n1", "agenda": "watch the party"}]}),
        encoding="utf-8",
    )
    (sc / "threat-fronts.json").write_text(json.dumps({"fronts": []}), encoding="utf-8")
    (sc / "pacing-map.json").write_text(json.dumps({"pacing_curve": []}), encoding="utf-8")
    (sc / "improvisation-boundaries.json").write_text(
        json.dumps(
            {
                "invent_allowed": [],
                "never_invent": [],
                "keeper_secrets": [{"id": "secret-1", "category": "keeper_secret", "prose": "x"}],
            }
        ),
        encoding="utf-8",
    )
    return sc


def test_register_then_lookup_by_canonical_id(tmp_path: Path):
    root = tmp_path / ".coc"
    coc_state.ensure_workspace(root)
    sc = _make_valid_scenario(tmp_path)
    identity = {
        "canonical_module_id": "demo-module",
        "canonical_title": "Demo Module",
        "edition": "7e",
        "locale": "en",
        "publisher": "Test Press",
    }
    entry = coc_module_registry.register_module(root, sc, identity)
    assert entry["canonical_module_id"] == "demo-module"

    hit = coc_module_registry.lookup_module(
        root, {"canonical_module_id": "demo-module"}
    )
    assert hit is not None
    assert hit["canonical_module_id"] == "demo-module"
    assert (Path(hit["scenario_dir"]) / "module-meta.json").is_file()


def test_lookup_by_alias_title_and_edition(tmp_path: Path):
    root = tmp_path / ".coc"
    coc_state.ensure_workspace(root)
    sc = _make_valid_scenario(tmp_path)
    coc_module_registry.register_module(
        root,
        sc,
        {
            "canonical_module_id": "demo-module",
            "canonical_title": "Demo Module",
            "edition": "7e",
            "locale": "en",
        },
    )
    coc_module_registry.add_alias(
        root,
        "demo-module",
        {"title": "尼亚拉托提普的面具", "locale": "zh-Hans"},
    )
    hit = coc_module_registry.lookup_module(
        root,
        {
            "canonical_module_id": None,
            "canonical_title": "尼亚拉托提普的面具",
            "locale": "zh-Hans",
            "edition": "7e",
        },
    )
    assert hit is not None
    assert hit["canonical_module_id"] == "demo-module"


def test_lookup_unknown_title_returns_none_no_fuzzy(tmp_path: Path):
    root = tmp_path / ".coc"
    coc_state.ensure_workspace(root)
    sc = _make_valid_scenario(tmp_path)
    coc_module_registry.register_module(
        root,
        sc,
        {
            "canonical_module_id": "demo-module",
            "canonical_title": "Demo Module",
            "edition": "7e",
        },
    )
    miss = coc_module_registry.lookup_module(
        root,
        {
            "canonical_title": "Demo Modul",  # typo — must NOT fuzzy-hit
            "edition": "7e",
        },
    )
    assert miss is None
    miss2 = coc_module_registry.lookup_module(
        root,
        {"canonical_title": "Completely Unrelated Title", "edition": "7e"},
    )
    assert miss2 is None


def test_register_refuses_invalid_scenario(tmp_path: Path):
    root = tmp_path / ".coc"
    coc_state.ensure_workspace(root)
    sc = tmp_path / "bad-scenario"
    sc.mkdir()
    (sc / "module-meta.json").write_text("{}", encoding="utf-8")
    # missing the other six required files
    with pytest.raises(ValueError, match="refusing to register|missing required"):
        coc_module_registry.register_module(
            root,
            sc,
            {
                "canonical_module_id": "bad-module",
                "canonical_title": "Bad",
                "edition": "7e",
            },
        )


def test_install_to_campaign_validates_and_activates(tmp_path: Path):
    root = tmp_path / ".coc"
    coc_state.ensure_workspace(root)
    coc_state.create_campaign(root, "camp-1", "Camp", era="1920s")
    sc = _make_valid_scenario(tmp_path)
    coc_module_registry.register_module(
        root,
        sc,
        {
            "canonical_module_id": "demo-module",
            "canonical_title": "Demo Module",
            "edition": "7e",
        },
    )
    result = coc_module_registry.install_to_campaign(root, "demo-module", "camp-1")
    scenario_dir = Path(result["scenario_dir"])
    assert coc_scenario_compile.validate_scenario(scenario_dir)["errors"] == []

    campaign = json.loads(
        (root / "campaigns" / "camp-1" / "campaign.json").read_text(encoding="utf-8")
    )
    assert campaign["active_scenario_id"] == "demo-module"

    world = json.loads(
        (root / "campaigns" / "camp-1" / "save" / "world-state.json").read_text(
            encoding="utf-8"
        )
    )
    assert world["status"] == "active"
    assert world["active_scene_id"] == "s1"
    assert world["scenario_id"] == "demo-module"


def test_atomic_write_and_registry_json_shape(tmp_path: Path):
    root = tmp_path / ".coc"
    coc_state.ensure_workspace(root)
    sc = _make_valid_scenario(tmp_path)
    coc_module_registry.register_module(
        root,
        sc,
        {
            "canonical_module_id": "demo-module",
            "canonical_title": "Demo Module",
            "edition": "7e",
            "aliases": [{"title": "演示模组", "locale": "zh-Hans"}],
        },
    )
    reg_path = root / "module-library" / "registry.json"
    assert reg_path.is_file()
    registry = json.loads(reg_path.read_text(encoding="utf-8"))
    assert registry["schema_version"] == 1
    assert "demo-module" in registry["modules"]
    summary = registry["modules"]["demo-module"]
    assert "alias_keys" in summary
    assert isinstance(summary["alias_keys"], list)
    assert "alias_index" in registry
    assert isinstance(registry["alias_index"], dict)
    # Canonical title key present
    key = coc_module_registry.normalize_alias_key("Demo Module", "7e")
    assert registry["alias_index"][key] == "demo-module"
    identity = json.loads(
        (root / "module-library" / "demo-module" / "identity.json").read_text(
            encoding="utf-8"
        )
    )
    assert identity["canonical_module_id"] == "demo-module"
    assert (root / "module-library" / "demo-module" / "scenario" / "story-graph.json").is_file()


def test_lookup_source_has_no_prose_scanning():
    """Constitution guard: lookup must not scan scenario prose / keyword lists."""
    src = inspect.getsource(coc_module_registry.lookup_module)
    src_mod = inspect.getsource(coc_module_registry)
    banned = (
        "in title",
        "fuzzy",
        "difflib",
        "SequenceMatcher",
        "scenario prose",
        "keeper_secret",
        "dramatic_question",
    )
    for token in banned:
        assert token not in src
    # Module-level: no reading of story-graph / clue prose during lookup path helpers
    assert "story-graph" not in src
    assert "clue-graph" not in src
    # normalize_alias_key is orthographic only
    assert "normalize_alias_key" in src_mod


def test_validate_warns_when_module_identity_missing(tmp_path: Path):
    sc = _make_valid_scenario(tmp_path, with_identity=False)
    result = coc_scenario_compile.validate_scenario(sc)
    assert result["errors"] == []
    assert any("module_identity missing" in w for w in result["warnings"])


def test_validate_warns_on_malformed_module_identity(tmp_path: Path):
    sc = _make_valid_scenario(tmp_path)
    meta = json.loads((sc / "module-meta.json").read_text(encoding="utf-8"))
    meta["module_identity"] = {"canonical_module_id": "Not A Slug!!!", "canonical_title": ""}
    (sc / "module-meta.json").write_text(json.dumps(meta), encoding="utf-8")
    result = coc_scenario_compile.validate_scenario(sc)
    assert result["errors"] == []
    assert any("canonical_module_id" in w for w in result["warnings"])
    assert any("canonical_title" in w for w in result["warnings"])


def test_cli_list_lookup_register_install(tmp_path: Path):
    root = tmp_path / ".coc"
    coc_state.ensure_workspace(root)
    coc_state.create_campaign(root, "camp-cli", "CLI Camp", era="1920s")
    sc = _make_valid_scenario(tmp_path)
    script = str(SCRIPTS / "coc_module_registry.py")
    identity = json.dumps(
        {
            "canonical_module_id": "demo-module",
            "canonical_title": "Demo Module",
            "edition": "7e",
        }
    )
    reg = subprocess.run(
        [sys.executable, script, "--root", str(root), "register",
         "--scenario-dir", str(sc), "--identity", identity],
        capture_output=True,
        text=True,
        check=False,
    )
    assert reg.returncode == 0, reg.stderr or reg.stdout
    listed = subprocess.run(
        [sys.executable, script, "--root", str(root), "list"],
        capture_output=True,
        text=True,
        check=False,
    )
    assert listed.returncode == 0
    assert "demo-module" in listed.stdout
    looked = subprocess.run(
        [
            sys.executable,
            script,
            "--root",
            str(root),
            "lookup",
            "--identity",
            json.dumps({"canonical_module_id": "demo-module"}),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert looked.returncode == 0
    payload = json.loads(looked.stdout)
    assert payload["hit"] is True
    installed = subprocess.run(
        [
            sys.executable,
            script,
            "--root",
            str(root),
            "install",
            "--module",
            "demo-module",
            "--campaign",
            "camp-cli",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert installed.returncode == 0, installed.stderr or installed.stdout
