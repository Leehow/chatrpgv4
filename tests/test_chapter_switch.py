from __future__ import annotations

import hashlib
import importlib.util
import json
import shutil
from pathlib import Path

import pytest


SCRIPTS = Path("plugins/coc-keeper/scripts")


def _load(name: str, rel: str):
    spec = importlib.util.spec_from_file_location(name, rel)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


coc_chapter_switch = _load("coc_chapter_switch", str(SCRIPTS / "coc_chapter_switch.py"))
coc_module_registry = _load("coc_module_registry", str(SCRIPTS / "coc_module_registry.py"))
coc_state = _load("coc_state", str(SCRIPTS / "coc_state.py"))
coc_live_turn_runner = _load(
    "coc_live_turn_runner_chapter_test", str(SCRIPTS / "coc_live_turn_runner.py")
)


def _write_chapter_package(
    root: Path,
    *,
    chapter: str,
    module_id: str,
    scene_id: str,
    clue_prefix: str,
    npc_id: str,
    parent: str = "masks-of-nyarlathotep",
    title: str | None = None,
) -> Path:
    package = root / f"pkg-{chapter}"
    sc = package / "scenario"
    sc.mkdir(parents=True, exist_ok=True)
    title = title or f"Masks of Nyarlathotep — {chapter.title()}"
    meta = {
        "schema_version": 1,
        "scenario_id": module_id,
        "title": title,
        "structure_type": "branching_investigation",
        "era": "1920s",
        "content_flags": [],
        "win_condition": "survive",
        "module_identity": {
            "canonical_module_id": module_id,
            "canonical_title": title,
            "rules_edition": "7e",
            "module_edition": "5th",
            "parent_module_id": parent,
            "chapter": chapter,
            "locale": "en",
        },
    }
    (sc / "module-meta.json").write_text(json.dumps(meta), encoding="utf-8")
    (sc / "story-graph.json").write_text(
        json.dumps(
            {
                "scenes": [
                    {
                        "scene_id": scene_id,
                        "is_start": True,
                        "dramatic_question": f"Will they finish {chapter}?",
                        "entry_conditions": [],
                        "exit_conditions": [],
                        "available_clues": [f"{clue_prefix}-a"],
                        "npc_ids": [npc_id],
                        "pressure_moves": [],
                        "tone": [],
                        "allowed_improvisation": [],
                    },
                    {
                        "scene_id": f"{scene_id}-end",
                        "is_final": True,
                        "dramatic_question": "Resolved?",
                        "entry_conditions": [],
                        "exit_conditions": [],
                        "available_clues": [],
                        "npc_ids": [],
                        "pressure_moves": [],
                        "tone": [],
                        "allowed_improvisation": [],
                    },
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
                        "conclusion_id": f"{clue_prefix}-c1",
                        "importance": "critical",
                        "minimum_routes": 3,
                        "fallback_policy": "RECOVER public notice",
                        "clues": [
                            {
                                "clue_id": f"{clue_prefix}-a",
                                "delivery": "handout",
                                "delivery_kind": "handout",
                                "visibility": "player-safe",
                            },
                            {
                                "clue_id": f"{clue_prefix}-b",
                                "delivery": "npc",
                                "delivery_kind": "npc_dialogue",
                                "source_npc_ids": [npc_id],
                                "visibility": "player-safe",
                            },
                            {
                                "clue_id": f"{clue_prefix}-c",
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
        json.dumps({"npcs": [{"npc_id": npc_id, "agenda": f"guide {chapter}"}]}),
        encoding="utf-8",
    )
    (sc / "threat-fronts.json").write_text(json.dumps({"fronts": []}), encoding="utf-8")
    (sc / "pacing-map.json").write_text(json.dumps({"pacing_curve": []}), encoding="utf-8")
    (sc / "improvisation-boundaries.json").write_text(
        json.dumps(
            {
                "invent_allowed": [],
                "never_invent": [],
                "keeper_secrets": [
                    {"id": f"secret-{chapter}", "category": "keeper_secret", "prose": "x"}
                ],
            }
        ),
        encoding="utf-8",
    )
    return sc


def _register(root: Path, scenario_dir: Path, module_id: str, chapter: str, parent: str) -> None:
    title = json.loads((scenario_dir / "module-meta.json").read_text(encoding="utf-8"))[
        "title"
    ]
    coc_module_registry.register_module(
        root,
        scenario_dir,
        {
            "canonical_module_id": module_id,
            "canonical_title": title,
            "rules_edition": "7e",
            "module_edition": "5th",
            "parent_module_id": parent,
            "chapter": chapter,
            "locale": "en",
        },
    )


def _seed_campaign(root: Path, campaign_id: str, module_id: str) -> Path:
    coc_state.create_campaign(root, campaign_id, "Masks Run", era="1920s")
    result = coc_module_registry.install_to_campaign(root, module_id, campaign_id)
    campaign = root / "campaigns" / campaign_id
    (campaign / "memory").mkdir(exist_ok=True)
    (campaign / "memory" / "session-summaries.jsonl").write_text(
        json.dumps({"summary": "kept across chapters"}) + "\n",
        encoding="utf-8",
    )
    (campaign / "logs" / "rolls.jsonl").write_text(
        json.dumps({"roll": 42, "skill": "Spot Hidden"}) + "\n",
        encoding="utf-8",
    )
    (campaign / "save" / "belief-state.json").write_text(
        json.dumps({"beliefs": [{"id": "b1", "text": "something odd"}]}),
        encoding="utf-8",
    )
    (campaign / "save" / "npc-state.json").write_text(
        json.dumps({"npcs": {"npc-peru-guide": {"disposition": "friendly"}}}),
        encoding="utf-8",
    )
    inv = root / "investigators" / "inv-1"
    inv.mkdir(parents=True, exist_ok=True)
    (inv / "character.json").write_text(
        json.dumps({"investigator_id": "inv-1", "name": "Ada", "hp": 11, "san": 60}),
        encoding="utf-8",
    )
    party = {
        "party_id": "party-1",
        "investigator_ids": ["inv-1"],
        "members": [{"investigator_id": "inv-1"}],
    }
    (campaign / "party.json").write_text(json.dumps(party), encoding="utf-8")
    return Path(result["scenario_dir"]).parent


def test_switch_requires_structured_terminal_evidence(tmp_path: Path):
    root = tmp_path / ".coc"
    coc_state.ensure_workspace(root)
    peru = _write_chapter_package(
        tmp_path,
        chapter="peru",
        module_id="masks-of-nyarlathotep-ch-peru",
        scene_id="lima-dock",
        clue_prefix="peru",
        npc_id="npc-peru-guide",
    )
    america = _write_chapter_package(
        tmp_path,
        chapter="america",
        module_id="masks-of-nyarlathotep-ch-america",
        scene_id="ny-harbor",
        clue_prefix="america",
        npc_id="npc-america-contact",
    )
    _register(root, peru, "masks-of-nyarlathotep-ch-peru", "peru", "masks-of-nyarlathotep")
    _register(
        root, america, "masks-of-nyarlathotep-ch-america", "america", "masks-of-nyarlathotep"
    )
    _seed_campaign(root, "camp-1", "masks-of-nyarlathotep-ch-peru")

    with pytest.raises(ValueError, match="terminal evidence"):
        coc_chapter_switch.switch_chapter(
            root,
            "camp-1",
            "masks-of-nyarlathotep-ch-america",
            {
                "reached_terminal": False,
                "active_scene_id": "lima-dock-end",
                "graph_terminal": False,
                "session_ending": False,
            },
        )


def test_live_runtime_auto_handoff_uses_authored_target_and_terminal_graph(tmp_path: Path):
    root = tmp_path / ".coc"
    coc_state.ensure_workspace(root)
    peru = _write_chapter_package(
        tmp_path, chapter="peru",
        module_id="masks-of-nyarlathotep-ch-peru",
        scene_id="lima-dock", clue_prefix="peru", npc_id="npc-peru-guide",
    )
    america = _write_chapter_package(
        tmp_path, chapter="america",
        module_id="masks-of-nyarlathotep-ch-america",
        scene_id="ny-harbor", clue_prefix="america", npc_id="npc-america-contact",
    )
    meta_path = peru / "module-meta.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    meta["chapter_handoff"] = {
        "mode": "auto_on_terminal",
        "target_module_id": "masks-of-nyarlathotep-ch-america",
    }
    meta_path.write_text(json.dumps(meta), encoding="utf-8")
    _register(root, peru, "masks-of-nyarlathotep-ch-peru", "peru", "masks-of-nyarlathotep")
    _register(root, america, "masks-of-nyarlathotep-ch-america", "america", "masks-of-nyarlathotep")
    campaign = _seed_campaign(root, "camp-auto", "masks-of-nyarlathotep-ch-peru")
    world_path = campaign / "save" / "world-state.json"
    world = json.loads(world_path.read_text(encoding="utf-8"))
    world["active_scene_id"] = "lima-dock-end"
    world_path.write_text(json.dumps(world), encoding="utf-8")

    # reached_terminal requires a structured session_ending event; graph leaf alone is NOT_RUN.
    transition = coc_live_turn_runner._automatic_chapter_handoff(
        campaign, {"turns": [{"event_types": ["session_ending"]}]}
    )

    assert transition["status"] == "PASS"
    assert transition["target_module_id"] == "masks-of-nyarlathotep-ch-america"
    assert transition["entry_scene_id"] == "ny-harbor"


def test_switch_rejects_mismatched_parent(tmp_path: Path):
    root = tmp_path / ".coc"
    coc_state.ensure_workspace(root)
    peru = _write_chapter_package(
        tmp_path,
        chapter="peru",
        module_id="masks-of-nyarlathotep-ch-peru",
        scene_id="lima-dock",
        clue_prefix="peru",
        npc_id="npc-peru-guide",
    )
    other = _write_chapter_package(
        tmp_path,
        chapter="england",
        module_id="other-campaign-ch-england",
        scene_id="london-dock",
        clue_prefix="england",
        npc_id="npc-england-contact",
        parent="other-campaign",
        title="Other Campaign — England",
    )
    _register(root, peru, "masks-of-nyarlathotep-ch-peru", "peru", "masks-of-nyarlathotep")
    _register(root, other, "other-campaign-ch-england", "england", "other-campaign")
    _seed_campaign(root, "camp-1", "masks-of-nyarlathotep-ch-peru")

    with pytest.raises(ValueError, match="parent_module_id"):
        coc_chapter_switch.switch_chapter(
            root,
            "camp-1",
            "other-campaign-ch-england",
            {
                "reached_terminal": True,
                "active_scene_id": "lima-dock-end",
                "graph_terminal": True,
                "session_ending": False,
            },
        )


def test_successful_switch_preserves_state_and_activates_entry(tmp_path: Path):
    root = tmp_path / ".coc"
    coc_state.ensure_workspace(root)
    peru = _write_chapter_package(
        tmp_path,
        chapter="peru",
        module_id="masks-of-nyarlathotep-ch-peru",
        scene_id="lima-dock",
        clue_prefix="peru",
        npc_id="npc-peru-guide",
    )
    america = _write_chapter_package(
        tmp_path,
        chapter="america",
        module_id="masks-of-nyarlathotep-ch-america",
        scene_id="ny-harbor",
        clue_prefix="america",
        npc_id="npc-america-contact",
    )
    _register(root, peru, "masks-of-nyarlathotep-ch-peru", "peru", "masks-of-nyarlathotep")
    _register(
        root, america, "masks-of-nyarlathotep-ch-america", "america", "masks-of-nyarlathotep"
    )
    campaign = _seed_campaign(root, "camp-1", "masks-of-nyarlathotep-ch-peru")

    memory_before = (campaign / "memory" / "session-summaries.jsonl").read_bytes()
    rolls_before = (campaign / "logs" / "rolls.jsonl").read_bytes()
    belief_before = (campaign / "save" / "belief-state.json").read_bytes()
    npc_before = (campaign / "save" / "npc-state.json").read_bytes()
    inv_before = (root / "investigators" / "inv-1" / "character.json").read_bytes()
    peru_scene = (campaign / "scenario" / "story-graph.json").read_text(encoding="utf-8")

    result = coc_chapter_switch.switch_chapter(
        root,
        "camp-1",
        "masks-of-nyarlathotep-ch-america",
        {
            "reached_terminal": True,
            "active_scene_id": "lima-dock-end",
            "graph_terminal": True,
            "session_ending": True,
        },
    )
    assert result["ok"] is True
    assert result["entry_scene_id"] == "ny-harbor"
    assert result["target_module_id"] == "masks-of-nyarlathotep-ch-america"

    assert (campaign / "memory" / "session-summaries.jsonl").read_bytes() == memory_before
    assert (campaign / "logs" / "rolls.jsonl").read_bytes() == rolls_before
    assert (campaign / "save" / "belief-state.json").read_bytes() == belief_before
    assert (campaign / "save" / "npc-state.json").read_bytes() == npc_before
    assert (root / "investigators" / "inv-1" / "character.json").read_bytes() == inv_before
    assert "ny-harbor" in (campaign / "scenario" / "story-graph.json").read_text(
        encoding="utf-8"
    )
    assert "lima-dock" not in (campaign / "scenario" / "story-graph.json").read_text(
        encoding="utf-8"
    )
    assert peru_scene != (campaign / "scenario" / "story-graph.json").read_text(
        encoding="utf-8"
    )

    world = json.loads((campaign / "save" / "world-state.json").read_text(encoding="utf-8"))
    assert world["active_scene_id"] == "ny-harbor"
    assert world["scenario_id"] == "masks-of-nyarlathotep-ch-america"

    history = [
        json.loads(line)
        for line in (campaign / "logs" / "chapter-history.jsonl").read_text().splitlines()
        if line.strip()
    ]
    assert len(history) == 1
    assert history[0]["source_module_id"] == "masks-of-nyarlathotep-ch-peru"
    assert history[0]["target_module_id"] == "masks-of-nyarlathotep-ch-america"


def test_id_collision_rejected(tmp_path: Path):
    root = tmp_path / ".coc"
    coc_state.ensure_workspace(root)
    peru = _write_chapter_package(
        tmp_path,
        chapter="peru",
        module_id="masks-of-nyarlathotep-ch-peru",
        scene_id="shared-scene",
        clue_prefix="shared",
        npc_id="npc-shared",
    )
    america = _write_chapter_package(
        tmp_path,
        chapter="america",
        module_id="masks-of-nyarlathotep-ch-america",
        scene_id="shared-scene",
        clue_prefix="shared",
        npc_id="npc-shared",
    )
    _register(root, peru, "masks-of-nyarlathotep-ch-peru", "peru", "masks-of-nyarlathotep")
    _register(
        root, america, "masks-of-nyarlathotep-ch-america", "america", "masks-of-nyarlathotep"
    )
    _seed_campaign(root, "camp-1", "masks-of-nyarlathotep-ch-peru")
    with pytest.raises(ValueError, match="id collision"):
        coc_chapter_switch.switch_chapter(
            root,
            "camp-1",
            "masks-of-nyarlathotep-ch-america",
            {
                "reached_terminal": True,
                "active_scene_id": "shared-scene-end",
                "graph_terminal": True,
                "session_ending": False,
            },
        )


def test_failed_write_rolls_back_byte_for_byte(tmp_path: Path, monkeypatch):
    root = tmp_path / ".coc"
    coc_state.ensure_workspace(root)
    peru = _write_chapter_package(
        tmp_path,
        chapter="peru",
        module_id="masks-of-nyarlathotep-ch-peru",
        scene_id="lima-dock",
        clue_prefix="peru",
        npc_id="npc-peru-guide",
    )
    america = _write_chapter_package(
        tmp_path,
        chapter="america",
        module_id="masks-of-nyarlathotep-ch-america",
        scene_id="ny-harbor",
        clue_prefix="america",
        npc_id="npc-america-contact",
    )
    _register(root, peru, "masks-of-nyarlathotep-ch-peru", "peru", "masks-of-nyarlathotep")
    _register(
        root, america, "masks-of-nyarlathotep-ch-america", "america", "masks-of-nyarlathotep"
    )
    campaign = _seed_campaign(root, "camp-1", "masks-of-nyarlathotep-ch-peru")
    before = {
        path.relative_to(campaign).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in campaign.rglob("*")
        if path.is_file()
    }

    def boom(*args, **kwargs):
        raise RuntimeError("forced write failure")

    monkeypatch.setattr(coc_chapter_switch, "_activate_entry_scene", boom)
    with pytest.raises(RuntimeError, match="forced write failure"):
        coc_chapter_switch.switch_chapter(
            root,
            "camp-1",
            "masks-of-nyarlathotep-ch-america",
            {
                "reached_terminal": True,
                "active_scene_id": "lima-dock-end",
                "graph_terminal": True,
                "session_ending": False,
            },
        )

    after = {
        path.relative_to(campaign).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in campaign.rglob("*")
        if path.is_file()
    }
    assert after == before
    assert "lima-dock" in (campaign / "scenario" / "story-graph.json").read_text(
        encoding="utf-8"
    )
    assert not (campaign / "logs" / "chapter-history.jsonl").exists()


def test_symlink_module_scenario_rejected(tmp_path: Path):
    root = tmp_path / ".coc"
    coc_state.ensure_workspace(root)
    peru = _write_chapter_package(
        tmp_path,
        chapter="peru",
        module_id="masks-of-nyarlathotep-ch-peru",
        scene_id="lima-dock",
        clue_prefix="peru",
        npc_id="npc-peru-guide",
    )
    america = _write_chapter_package(
        tmp_path,
        chapter="america",
        module_id="masks-of-nyarlathotep-ch-america",
        scene_id="ny-harbor",
        clue_prefix="america",
        npc_id="npc-america-contact",
    )
    _register(root, peru, "masks-of-nyarlathotep-ch-peru", "peru", "masks-of-nyarlathotep")
    _register(
        root, america, "masks-of-nyarlathotep-ch-america", "america", "masks-of-nyarlathotep"
    )
    _seed_campaign(root, "camp-1", "masks-of-nyarlathotep-ch-peru")

    entry_dir = root / "module-library" / "masks-of-nyarlathotep-ch-america"
    real_scenario = entry_dir / "scenario"
    outside = tmp_path / "outside-scenario"
    shutil.move(str(real_scenario), str(outside))
    real_scenario.symlink_to(outside)

    with pytest.raises(ValueError, match="real directory"):
        coc_chapter_switch.switch_chapter(
            root,
            "camp-1",
            "masks-of-nyarlathotep-ch-america",
            {
                "reached_terminal": True,
                "active_scene_id": "lima-dock-end",
                "graph_terminal": True,
                "session_ending": False,
            },
        )


def test_switch_preserves_target_epistemic_sidecars(tmp_path: Path):
    root = tmp_path / ".coc"
    coc_state.ensure_workspace(root)
    peru = _write_chapter_package(
        tmp_path,
        chapter="peru",
        module_id="masks-of-nyarlathotep-ch-peru",
        scene_id="lima-dock",
        clue_prefix="peru",
        npc_id="npc-peru-guide",
    )
    america = _write_chapter_package(
        tmp_path,
        chapter="america",
        module_id="masks-of-nyarlathotep-ch-america",
        scene_id="ny-harbor",
        clue_prefix="america",
        npc_id="npc-america-contact",
    )
    america_sc = america  # _write_chapter_package returns scenario dir
    marker = "america-sidecar-marker"
    (america_sc / "epistemic-graph.json").write_text(
        json.dumps({"schema_version": 1, "questions": [], "evidence_links": []}),
        encoding="utf-8",
    )
    (america_sc / "reveal-contracts.json").write_text(
        json.dumps({"schema_version": 1, "contracts": []}),
        encoding="utf-8",
    )
    (america_sc / "compile-confidence.json").write_text(
        json.dumps({
            "schema_version": 1,
            "overall": 0.91,
            "nodes": [],
            "note": marker,
        }),
        encoding="utf-8",
    )
    _register(root, peru, "masks-of-nyarlathotep-ch-peru", "peru", "masks-of-nyarlathotep")
    _register(
        root, america, "masks-of-nyarlathotep-ch-america", "america", "masks-of-nyarlathotep"
    )
    campaign = _seed_campaign(root, "camp-1", "masks-of-nyarlathotep-ch-peru")

    result = coc_chapter_switch.switch_chapter(
        root,
        "camp-1",
        "masks-of-nyarlathotep-ch-america",
        {
            "reached_terminal": True,
            "active_scene_id": "lima-dock-end",
            "graph_terminal": True,
            "session_ending": True,
        },
    )
    assert result["ok"] is True
    for name in coc_module_registry.OPTIONAL_SCENARIO_SIDECAR_FILES:
        assert (campaign / "scenario" / name).is_file()
    assert marker in (campaign / "scenario" / "compile-confidence.json").read_text(
        encoding="utf-8"
    )
