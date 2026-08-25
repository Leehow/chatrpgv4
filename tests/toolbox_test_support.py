"""Shared fixtures for operation-cell tests; ordinary behavior tests stay in their cell."""
from __future__ import annotations

"""Contract tests for the keeper toolbox CLI/registry (coc_toolbox.py)."""

import hashlib

import importlib.util

import io

import json

import os

import random

import shutil

import subprocess

import sys

import time

import uuid

from copy import deepcopy

from concurrent.futures import ThreadPoolExecutor

from contextlib import contextmanager

from pathlib import Path

from threading import Barrier, Event, Lock

import pytest

REPO = Path(__file__).resolve().parents[1]

SCRIPTS = REPO / "plugins" / "coc-keeper" / "scripts"

TOOLBOX_SCRIPT = SCRIPTS / "coc_toolbox.py"

PYTHON = sys.executable

def _load(name: str, rel: str | Path):
    path = Path(rel)
    if not path.is_absolute():
        path = REPO / path
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module

coc_toolbox = _load("coc_toolbox_under_test", TOOLBOX_SCRIPT)

coc_starter = _load("coc_starter_for_toolbox", SCRIPTS / "coc_starter.py")

coc_state = _load("coc_state_for_toolbox", SCRIPTS / "coc_state.py")

coc_combat = _load("coc_combat_for_toolbox", SCRIPTS / "coc_combat.py")

coc_director_apply = _load(
    "coc_director_apply_for_toolbox", SCRIPTS / "coc_director_apply.py"
)

EXPECTED_NAMESPACES = {
    "setup",
    "rules",
    "combat",
    "chase",
    "sanity",
    "development",
    "scene",
    "clues",
    "npc",
    "actions",
    "director",
    "storylets",
    "personal_horror",
    "threat",
    "epistemic",
    "narration",
    "evidence",
    "secrets",
    "session",
    "state",
    "progressive",
    "mechanics",
    "steward",
    "turn",
    "memory",
}

def _write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

def _game_file_bytes(root: Path) -> dict[Path, bytes]:
    return {
        path.relative_to(root): path.read_bytes()
        for path in root.rglob("*")
        if path.is_file()
        and "locks" not in path.relative_to(root).parts
        and not path.name.endswith(".lock")
    }

def _write_current_imported_investigator(
    coc_root: Path, investigator_id: str,
) -> None:
    """Materialize exact current imported state for legacy focused fixtures."""
    investigator_dir = coc_root / "investigators" / investigator_id
    character_path = investigator_dir / "character.json"
    if character_path.is_file():
        character = json.loads(character_path.read_text(encoding="utf-8"))
    else:
        character = {
            "id": investigator_id,
            "name": investigator_id,
            "characteristics": {
                "STR": 50, "CON": 50, "SIZ": 50, "DEX": 50,
                "APP": 50, "INT": 50, "POW": 50, "EDU": 50,
            },
            "derived": {
                "HP": 10, "MP": 10, "SAN": 50,
                "DB": "none", "MOV": 8,
            },
            "skills": {"Credit Rating": 20},
        }
    derived = coc_toolbox.coc_runtime_ops.coc_character.derive_values(
        character["characteristics"],
        luck=character["characteristics"]["POW"],
    )
    character["derived"]["Luck"] = derived["Luck"]
    character["derived"]["Build"] = derived["Build"]
    _write_json(character_path, character)
    creation_path = investigator_dir / "creation.json"
    creation = (
        json.loads(creation_path.read_text(encoding="utf-8"))
        if creation_path.is_file()
        else {
            "schema_version": 1,
            "investigator_id": investigator_id,
            "method": "imported_character_sheet",
        }
    )
    creation["input_mode"] = "import_complete_sheet"
    _write_json(creation_path, creation)

@pytest.fixture
def campaign_ws(tmp_path: Path):
    """Fresh workspace with a the-haunting / thomas-hayes quick-start campaign."""
    workspace = tmp_path / "workspace"
    coc_root = workspace / ".coc"
    campaign_id = "toolbox-test"
    _write_json(
        coc_root / "runtime.json",
        {
            "schema_version": 2,
            "planner": {"kind": "deterministic"},
            "rules": {"kind": "deterministic"},
            "narrator": {"kind": "template"},
            "player": {"kind": "human"},
        },
    )
    quick = coc_starter.quick_start(
        coc_root,
        "the-haunting",
        "thomas-hayes",
        campaign_id=campaign_id,
        title="Toolbox Test",
    )
    campaign_dir = Path(quick["campaign_dir"])
    return {
        "workspace": workspace,
        "coc_root": coc_root,
        "campaign_id": campaign_id,
        "campaign_dir": campaign_dir,
        "investigator_id": quick["investigator_id"],
        "quick": quick,
    }

def _run(ws, tool: str, args: dict | None = None) -> dict:
    args = dict(args or {})
    if tool == "rules.roll":
        # Most tests in this module exercise receipt/transaction behavior, not
        # contextual adjudication.  Supply an explicit neutral contract so the
        # production API itself never falls back to an implicit Regular check.
        args.setdefault("difficulty", "regular")
        args.setdefault("goal", "settle the focused toolbox test action")
        args.setdefault(
            "stakes",
            {
                "on_success": "the focused test action succeeds",
                "on_failure": "the focused test action does not succeed",
            },
        )
        args.setdefault("difficulty_basis", "keeper_judgment")
    return coc_toolbox.run_tool(
        tool,
        ws["workspace"],
        ws["campaign_id"],
        args,
    )

def _finalize_pending_turn_for_test(
    ws: dict, *, decision_id: str
) -> dict:
    """Close a journaled component-test turn through the current contract."""
    output = _run(ws, "turn.output_context")
    assert output["ok"] is True, output
    context = output["data"]
    finalize_card = context["finalize_operation"]
    assert finalize_card["operation"] == "turn.finalize"
    assert finalize_card["discovery_required"] is False
    assert finalize_card["prefilled_arguments"]["decision_id"] == (
        f"{context['journal_decision_id']}:finalize"
    )
    assert "draft" in finalize_card["missing_arguments"]
    result_paragraph = "已结算的测试结果按其原有因果关系发生。"
    draft = "测试中的行动继续推进。\n\n" + result_paragraph
    coverage = [
        {
            "obligation_id": obligation["obligation_id"],
            "realization": "fictional_beat",
            "action_realization": "调查员完成了这项已结算的测试行动",
            "response": "场景按权威结算结果作出对应反应",
            "causal_explanation": "该反应直接来自本轮已经结算的行动结果",
            "persona_fit": "这项行动保持调查员既有的测试角色设定",
            "player_input_handling": "abstract_completed",
            "exact_excerpt": result_paragraph,
            "exceptional_beat": (
                "特殊结果已经产生与该行动直接相连的实质影响"
                if obligation["exceptional_required"]
                else ""
            ),
        }
        for obligation in context["obligations"]
    ]
    mechanics_placements = []
    for segment_type, source_key, after_paragraph in (
        ("public_check", "roll_id", 0),
        ("state_delta", "effect_id", 1),
        ("exceptional_effect", "event_id", 1),
    ):
        rows = context["mechanics_bundle"].get(segment_type) or []
        if rows:
            mechanics_placements.append({
                "after_paragraph": after_paragraph,
                "segment_type": segment_type,
                "source_ids": [str(row[source_key]) for row in rows],
            })
    finalized = _run(
        ws,
        "turn.finalize",
        {
            "draft": draft,
            "coverage": coverage,
            "mechanics_placements": mechanics_placements,
            "revision": 1,
            "decision_id": decision_id,
        },
    )
    assert finalized["ok"] is True, finalized
    return finalized

def _first_contact_binding(
    ws: dict,
    npc_id: str,
    *,
    key: str,
    run_id: str | None = None,
) -> dict:
    """Settle the mandatory public first impression for one test NPC pair."""
    reaction_args = {
        "npc_id": npc_id,
        "npc_display_name": f"测试 NPC {key}",
        "investigator": ws["investigator_id"],
        "context": {
            "player_conduct": "调查员清楚说明来意并尊重对方的工作边界",
            "scene_constraints": "当前场景的职责与安全边界仍然有效",
            "authored_or_relationship_boundary": "初次见面不会改写 NPC 的身份、立场或权限",
            "semantic_reason": "外表与信用只影响对方起初的接纳方式",
        },
        "seed": 0,
        "decision_id": f"{key}-reaction",
    }
    if run_id is not None:
        reaction_args["run_id"] = run_id
    reaction = _run(ws, "npc.reaction", reaction_args)
    assert reaction["ok"] is True, reaction
    binding = {
        "first_impression_ref": reaction["data"]["first_impression_ref"],
        "first_impression_realization": {
            "observable_manner": "对方先打量调查员，再稍微放松姿势",
            "causal_explanation": "调查员的外表与社会身份影响了这次起初判断",
            "boundary_preserved": "NPC 仍保留原有职责、立场和安全边界",
            "opportunity_or_friction": "这份起初判断会影响接下来的语气与耐心",
        },
    }
    if run_id is not None:
        binding["run_id"] = run_id
    return binding

def _failed_roll_for_push(
    ws: dict,
    decision_id: str,
    *,
    skill: str = "Library Use",
) -> dict:
    result = _run(
        ws,
        "rules.roll",
        {
            "investigator": ws["investigator_id"],
            "skill": skill,
            "target": 1,
            "goal": "complete the original approach",
            "stakes": {
                "on_success": "the original approach succeeds",
                "on_failure": "the original approach fails and may be pushed",
            },
            "difficulty_basis": "keeper_judgment",
            "decision_id": decision_id,
            "seed": 2,
        },
    )
    assert result["ok"] is True, result
    assert result["data"]["success"] is False, result
    return result

def _add_eleanor_to_party(ws: dict) -> str:
    investigator_id = "eleanor-reed"
    sheet = json.loads((
        REPO
        / "plugins"
        / "coc-keeper"
        / "references"
        / "starter-scenarios"
        / "the-haunting"
        / "pregens"
        / investigator_id
        / "character.json"
    ).read_text(encoding="utf-8"))
    coc_state.create_investigator(ws["workspace"], investigator_id, sheet)
    coc_state.link_party(
        ws["workspace"],
        ws["campaign_id"],
        [ws["investigator_id"], investigator_id],
    )
    return investigator_id

def _first_clue_id(campaign_dir: Path) -> str:
    clue_graph = json.loads(
        (campaign_dir / "scenario" / "clue-graph.json").read_text(encoding="utf-8")
    )
    for conclusion in clue_graph.get("conclusions") or []:
        for clue in conclusion.get("clues") or []:
            if isinstance(clue, dict) and clue.get("clue_id"):
                return str(clue["clue_id"])
    raise AssertionError("starter clue-graph has no clue_id")

def _first_npc_id(campaign_dir: Path) -> str:
    agendas = json.loads(
        (campaign_dir / "scenario" / "npc-agendas.json").read_text(encoding="utf-8")
    )
    for npc in agendas.get("npcs") or []:
        if isinstance(npc, dict) and npc.get("npc_id"):
            return str(npc["npc_id"])
    raise AssertionError("starter npc-agendas has no npc_id")

def _read_jsonl(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            out.append(json.loads(line))
    return out

def _install_same_destination_travel_edges(campaign_ws) -> tuple[str, str]:
    world = json.loads(
        (campaign_ws["campaign_dir"] / "save" / "world-state.json").read_text(
            encoding="utf-8"
        )
    )
    active_id = world["active_scene_id"]
    graph_path = campaign_ws["campaign_dir"] / "scenario" / "story-graph.json"
    story_graph = json.loads(graph_path.read_text(encoding="utf-8"))
    active_scene = next(
        scene for scene in story_graph["scenes"]
        if scene["scene_id"] == active_id
    )
    destination = active_scene["scene_edges"][0]["to"]
    active_scene["scene_edges"] = [
        {
            "to": destination,
            "kind": "travel",
            "when": {"kind": "always"},
            "travel_minutes": 60,
        },
        {
            "to": destination,
            "kind": "travel",
            "when": {
                "kind": "narrative",
                "description": "the party chooses the slower source-authored route",
            },
            "travel_minutes": 120,
        },
    ]
    _write_json(graph_path, story_graph)
    coc_toolbox.coc_compiled_archive.publish_from_campaign(
        campaign_ws["campaign_dir"]
    )
    return active_id, destination

def _run_concurrent_cli(
    ws: dict,
    calls: list[tuple[str, dict]],
    *,
    barrier_dir: Path,
) -> list[dict]:
    """Release real CLI subprocesses through one start barrier."""
    barrier_dir.mkdir(parents=True, exist_ok=True)
    gate = barrier_dir / "go"
    wrapper = """
import os
import sys
import time
from pathlib import Path

ready = Path(sys.argv[1])
gate = Path(sys.argv[2])
ready.write_text("ready", encoding="utf-8")
deadline = time.monotonic() + 10.0
while not gate.exists():
    if time.monotonic() >= deadline:
        raise SystemExit("barrier timeout")
    time.sleep(0.001)
os.execv(sys.executable, [sys.executable, *sys.argv[3:]])
"""
    processes: list[subprocess.Popen[str]] = []
    ready_paths: list[Path] = []
    try:
        for index, (tool_name, args) in enumerate(calls):
            ready = barrier_dir / f"ready-{index}"
            ready_paths.append(ready)
            processes.append(
                subprocess.Popen(
                    [
                        PYTHON,
                        "-c",
                        wrapper,
                        str(ready),
                        str(gate),
                        str(TOOLBOX_SCRIPT),
                        tool_name,
                        "--root",
                        str(ws["workspace"]),
                        "--campaign",
                        ws["campaign_id"],
                        "--json",
                        json.dumps(args),
                    ],
                    cwd=REPO,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                )
            )
        deadline = time.monotonic() + 10.0
        while not all(path.is_file() for path in ready_paths):
            if time.monotonic() >= deadline:
                raise AssertionError("concurrent toolbox workers did not reach barrier")
            time.sleep(0.001)
        gate.touch()
        outputs: list[dict] = []
        for process in processes:
            stdout, stderr = process.communicate(timeout=30)
            assert process.returncode == 0, stderr or stdout
            outputs.append(json.loads(stdout))
        return outputs
    finally:
        for process in processes:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=5)

def _activate_newspaper_morgue(campaign_ws: dict) -> None:
    world_path = campaign_ws["campaign_dir"] / "save" / "world-state.json"
    world = json.loads(world_path.read_text(encoding="utf-8"))
    world["active_scene_id"] = "newspaper-morgue"
    _write_json(world_path, world)

def _first_neutral_npc_id(campaign_dir: Path) -> str:
    agendas = json.loads(
        (campaign_dir / "scenario" / "npc-agendas.json").read_text(encoding="utf-8")
    )
    for npc in agendas.get("npcs") or []:
        if (
            isinstance(npc, dict)
            and npc.get("npc_id")
            and not coc_toolbox.coc_story_director._npc_is_forced_adversary(npc)
        ):
            return str(npc["npc_id"])
    raise AssertionError("starter npc-agendas has no neutral npc_id")

def _opening_component_workspace(
    tmp_path: Path,
    *,
    extra_pdf_indices: tuple[int, ...] = (),
    page_body: str | None = None,
    source_page_count: int | None = None,
    source_id: str = "pdf:opening-component",
    source_title: str = "Opening Component",
    canonical_title: str | None = None,
    source_assets: dict[str, tuple[bytes, int]] | None = None,
) -> dict:
    workspace = tmp_path / "opening-workspace"
    campaign_id = "opening-component"
    coc_state.create_campaign(
        workspace, campaign_id, "Opening Component", era="1920s",
        play_language="zh-Hans",
    )
    pdf = workspace / "opening-module.pdf"
    pdf.parent.mkdir(parents=True, exist_ok=True)
    pdf.write_bytes(b"%PDF opening component fixture")
    file_sha = hashlib.sha256(pdf.read_bytes()).hexdigest()
    bundle = workspace / "opening-source"
    bundle.mkdir()
    page_indices = [0, *extra_pdf_indices]
    pages = []
    for pdf_index in page_indices:
        page = (
            "# Opening\n\nA bounded authored opening.\n"
            if pdf_index == 0
            else f"# Appendix {pdf_index}\n\n{page_body or 'Accepted extra source page.'}\n"
        ).encode()
        markdown_path = f"page-{pdf_index:04d}.md"
        (bundle / markdown_path).write_bytes(page)
        pages.append({
            "pdf_index": pdf_index,
            "markdown_path": markdown_path,
            "text_sha256": hashlib.sha256(page).hexdigest(),
            "review_state": "manual_accepted",
            "parse_confidence": 0.99,
            "grep_anchors": [
                "A bounded authored opening."
                if pdf_index == 0
                else (page_body or "Accepted extra source page.").split("，")[0]
            ],
        })
    manifest_assets = []
    for relative, (payload, pdf_index) in (source_assets or {}).items():
        asset_path = bundle / relative
        asset_path.parent.mkdir(parents=True, exist_ok=True)
        asset_path.write_bytes(payload)
        manifest_assets.append({
            "path": relative,
            "sha256": hashlib.sha256(payload).hexdigest(),
            "pdf_index": pdf_index,
        })
    (bundle / "manifest.json").write_text(json.dumps({
        "schema_version": 1,
        "producer": "codex-pdf-skill",
        "source": {
            "source_id": source_id,
            "title": source_title,
            "path": str(pdf),
            "file_sha256": file_sha,
            "page_count": source_page_count or max(page_indices) + 1,
        },
        "pages": pages,
        "assets": manifest_assets,
    }), encoding="utf-8")
    assets = coc_toolbox.coc_module_project.coc_module_assets
    registration = assets.register_source_bundle(
        workspace,
        bundle,
        asset_root_id="opening-component",
        module_identity={
            "canonical_module_id": "opening-component",
            **(
                {"canonical_title": canonical_title}
                if canonical_title is not None
                else {}
            ),
        },
    )
    identity = json.loads(
        (
            workspace / ".coc" / "module-assets" / "opening-component"
            / "identity.json"
        ).read_text(encoding="utf-8")
    )
    campaign_dir = workspace / ".coc" / "campaigns" / campaign_id
    scenario_path = campaign_dir / "scenario" / "scenario.json"
    scenario = (
        json.loads(scenario_path.read_text(encoding="utf-8"))
        if scenario_path.is_file() else {"schema_version": 1}
    )
    scenario.update({
        "source_cache_asset_root_id": "opening-component",
        "source": {
            **identity["source"],
            "bundle_sha256": registration["bundle_sha256"],
        },
    })
    _write_json(scenario_path, scenario)
    skeleton = {
        "schema_version": 1,
        "parse_tier": 1,
        "module_identity": {
            "canonical_module_id": "opening-component",
            "canonical_title": "Opening Component",
        },
        "structure_type": "branching_investigation",
        "source": identity["source"],
        "start_candidates": ["opening"],
        "finale_buckets": [
            {"id": "end", "title": "End", "importance": "critical"},
        ],
        "locations": [{
            "location_id": "opening",
            "title": "Opening",
            "parse_state": "toc_only",
            "source_span": {"pdf_index_start": 0, "pdf_index_end": 0},
        }],
        "edges_provisional": [],
        "npc_roster": [],
        "handouts": [],
        "threats": [],
        "conclusion_buckets": [],
        "mechanics_locator_pass_status": "pending",
        "start_clock_status": "unresolved",
    }
    return {
        "workspace": workspace,
        "campaign_id": campaign_id,
        "campaign_dir": campaign_dir,
        "asset_root_id": "opening-component",
        "file_sha256": file_sha,
        "skeleton": skeleton,
    }

def _isolated_coc_workspace(label: str) -> Path:
    """Create a durable probe root outside the repository tree.

    Live/adapter probes must not touch the repo-local ``.coc`` tree. Paths live
    under ``/tmp/coc-isolated/<label>-<id>/`` so operators can inspect leftovers.
    """
    root = Path("/tmp/coc-isolated") / f"{label}-{uuid.uuid4().hex[:10]}"
    root.mkdir(parents=True, exist_ok=False)
    (root / "README.md").write_text(
        "# Isolated COC probe workspace\n\n"
        f"label: `{label}`\n\n"
        "This directory is outside the repository. Progressive campaign state "
        "lives only under `workspace/.coc/` here. It is not a live Grok KP "
        "session and not acceptance play evidence.\n",
        encoding="utf-8",
    )
    workspace = root / "workspace"
    workspace.mkdir()
    return root

def _grok_multi_location_isolated_workspace(iso_root: Path) -> dict:
    """Build a progressive campaign with two independent ready host-work groups."""
    workspace = iso_root / "workspace"
    campaign_id = "grok-parent-fanout"
    asset_root_id = "fanout-asset"
    coc_state.create_campaign(
        workspace,
        campaign_id,
        "Grok Parent Fanout Isolation",
        play_language="zh-Hans",
    )
    pdf = workspace / "module.pdf"
    pdf.write_bytes(b"%PDF grok parent flat fanout isolation fixture")
    file_sha = hashlib.sha256(pdf.read_bytes()).hexdigest()
    bundle = workspace / "source-bundle"
    bundle.mkdir()
    page_bodies = {
        0: "# Opening\n\nLobby and desk.\n",
        1: "# Alley\n\nSide alley and crates.\n",
        2: "# Cellar\n\nDamp cellar steps.\n",
    }
    pages = []
    for pdf_index, text in page_bodies.items():
        markdown_path = f"page-{pdf_index:04d}.md"
        body = text.encode("utf-8")
        (bundle / markdown_path).write_bytes(body)
        pages.append({
            "pdf_index": pdf_index,
            "markdown_path": markdown_path,
            "text_sha256": hashlib.sha256(body).hexdigest(),
            "review_state": "manual_accepted",
            "parse_confidence": 0.99,
            "grep_anchors": [text.strip().splitlines()[-1]],
        })
    (bundle / "manifest.json").write_text(json.dumps({
        "schema_version": 1,
        "producer": "codex-pdf-skill",
        "source": {
            "source_id": "pdf:fanout-asset",
            "title": "Fanout Isolation Module",
            "path": str(pdf),
            "file_sha256": file_sha,
            "page_count": 3,
        },
        "pages": pages,
    }), encoding="utf-8")
    assets = coc_toolbox.coc_module_project.coc_module_assets
    registration = assets.register_source_bundle(
        workspace,
        bundle,
        asset_root_id=asset_root_id,
        module_identity={"canonical_module_id": asset_root_id},
    )
    identity = json.loads(
        (
            workspace / ".coc" / "module-assets" / asset_root_id
            / "identity.json"
        ).read_text(encoding="utf-8")
    )
    campaign_dir = workspace / ".coc" / "campaigns" / campaign_id
    scenario_path = campaign_dir / "scenario" / "scenario.json"
    scenario = (
        json.loads(scenario_path.read_text(encoding="utf-8"))
        if scenario_path.is_file() else {"schema_version": 1}
    )
    scenario.update({
        "source_cache_asset_root_id": asset_root_id,
        "source": {
            **identity["source"],
            "bundle_sha256": registration["bundle_sha256"],
        },
    })
    _write_json(scenario_path, scenario)
    skeleton = {
        "schema_version": 1,
        "parse_tier": 1,
        "module_identity": {
            "canonical_module_id": asset_root_id,
            "canonical_title": "Fanout Isolation Module",
        },
        "structure_type": "branching_investigation",
        "source": identity["source"],
        "start_candidates": ["opening"],
        "finale_buckets": [
            {"id": "end", "title": "End", "importance": "critical"},
        ],
        "locations": [
            {
                "location_id": "opening",
                "title": "Opening",
                "parse_state": "toc_only",
                "source_span": {"pdf_index_start": 0, "pdf_index_end": 0},
            },
            {
                "location_id": "alley",
                "title": "Alley",
                "parse_state": "toc_only",
                "source_span": {"pdf_index_start": 1, "pdf_index_end": 1},
            },
            {
                "location_id": "cellar",
                "title": "Cellar",
                "parse_state": "toc_only",
                "source_span": {"pdf_index_start": 2, "pdf_index_end": 2},
            },
        ],
        "edges_provisional": [],
        "npc_roster": [],
        "handouts": [],
        "threats": [],
        "conclusion_buckets": [],
        "mechanics_locator_pass_status": "pending",
        "start_clock_status": "unresolved",
    }
    return {
        "iso_root": iso_root,
        "workspace": workspace,
        "campaign_id": campaign_id,
        "campaign_dir": campaign_dir,
        "asset_root_id": asset_root_id,
        "file_sha256": file_sha,
        "skeleton": skeleton,
    }

def _opening_component_pack(**overrides) -> dict:
    pack = {
        "location_id": "opening",
        "title": "Opening",
        "parse_state": "deep",
        "evidence_gap": False,
        "source_page_indices": [0],
        "player_safe_summary": "A bounded player-safe opening.",
        "dramatic_question": "What will the investigators do?",
        "scene_type": "investigation",
        "available_clue_ids": [],
        "npc_ids": [],
        "clues": [],
        "npcs": [],
        "keeper_secret_refs": [],
        "scene_edges": [],
        "affordances": [{
            "id": "inspect",
            "cue": "Inspect the room",
            "route_type": "investigative_lead",
            "status": "open",
        }],
        "pressure_moves": [],
        "tone": ["quiet"],
    }
    pack.update(overrides)
    return pack

def _opening_setup_unresolved() -> dict:
    return {
        "schema_version": 1,
        "contract_id": "coc.opening-setup-observation.v1",
        "status": "unresolved",
    }

def _requested_body_location(
    tmp_path: Path,
    monkeypatch,
    *,
    job_kind: str,
) -> tuple[dict, str, str]:
    monkeypatch.setenv("COC_DISABLE_QUEUE_WORKER", "1")
    ws = _opening_component_workspace(
        tmp_path,
        extra_pdf_indices=(1, 2),
    )
    published = _run(ws, "progressive.publish_skeleton", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "skeleton": ws["skeleton"],
    })
    assert published["ok"] is True, published
    assets = coc_toolbox.coc_module_project.coc_module_assets
    assets.ensure_stub(
        ws["workspace"],
        ws["asset_root_id"],
        "location",
        "cellar",
        title="Cellar",
        source_scope={"source_page_indices": [0, 1, 2]},
    )
    queued = assets.enqueue_job(
        ws["workspace"],
        ws["asset_root_id"],
        kind=job_kind,
        target_id="cellar",
        priority=50,
        reason="body identity contract regression",
        consumer_refs=[assets.campaign_consumer_ref(
            ws["workspace"],
            ws["campaign_id"],
            ws["asset_root_id"],
            intent_kind="player_dig",
        )],
        kick_worker=False,
    )
    worker = coc_toolbox.coc_module_project._load_sibling(
        f"coc_module_queue_worker_body_alias_{job_kind}",
        "coc_module_queue_worker.py",
    )
    produced = worker.run_worker_once(ws["workspace"], parallel=1)
    assert produced["claimed"] == 1
    request = assets.get_host_work_request(
        ws["workspace"],
        ws["asset_root_id"],
        queued["job"]["job_id"],
    )
    assert request is not None
    assert request["result_contract"]["contract_id"] == (
        "coc.location-body-pack.v1"
    )
    return ws, request["job_id"], (
        "partial" if job_kind == "partial_neighbor" else "deep"
    )

def _materialize_one_r19_host_work(ws: dict) -> None:
    worker = coc_toolbox.coc_module_project._load_sibling(
        "coc_module_queue_worker_r19_tests",
        "coc_module_queue_worker.py",
    )
    materialized = worker.run_worker_once(ws["workspace"], parallel=1)
    assert materialized["claimed"] == 1, materialized

def _l0_direct_opening_l0(*, localized: bool = True) -> dict:
    """L0 with one player hook, one keeper hook, and handout refs."""
    l0 = _minimal_module_init_l0()
    player_hook = {
        "id": "opening-player",
        "audience": "player",
        "text": "A bounded authored opening.",
        "variant_of": None,
    }
    if localized:
        player_hook["localized_title"] = {"zh-Hans": "开场"}
        player_hook["localized_text"] = {"zh-Hans": "一段有明确边界的原作开场。"}
    l0["opening_hooks"] = [
        player_hook,
        {
            "id": "opening-keeper",
            "audience": "keeper",
            "text": "Keeper-only opening note.",
            "variant_of": None,
        },
    ]
    l0["opening_handouts"] = [
        {
            "id": "handout-1", "title": "小卡片#1",
            "when_to_give": "开场简报", "source_refs": ["pdf_index-0"],
        },
    ]
    return l0

def _assert_source_text_not_substituted_as_zh_hans(pack: dict, source_text: str) -> None:
    def walk(node):
        if isinstance(node, dict):
            for key, value in node.items():
                if key == "zh-Hans":
                    assert value != source_text
                walk(value)
        elif isinstance(node, list):
            for item in node:
                walk(item)
    walk(pack)

def _gate4_opening_component_pack() -> dict:
    """Deep opening pack with one embedded clue row whose later deepen rewrite
    mirrors the playtest drift: the row loses delivery_kind/visibility/
    parse_state, moving the whole-payload receipt hash while the canonical
    opening slice and the content evidence anchor stay identical."""
    pack = _opening_component_pack()
    pack["clues"] = [{
        "clue_id": "clue-early",
        "delivery_kind": "obvious",
        "visibility": "player-safe",
        "parse_state": "deep",
        "player_safe_summary": "An early clue in the opening room.",
        "source_page_indices": [0],
        "discovery": {"mode": "automatic", "skill": None, "difficulty": None},
        "provenance": {
            "authority": "source_authored",
            "source_refs": [{"pdf_index": 0}],
        },
        "source_refs": [{"pdf_index": 0}],
    }]
    return pack

def _gate4_project_opening_with_completed_watch(ws: dict) -> dict:
    """Publish, store the deep opening pack, project, and persist a completed
    projection watch exactly like the drain leaves after foreground
    fulfillment, so the gate's materialization phase is exercised."""
    published = _run(ws, "progressive.publish_skeleton", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "skeleton": ws["skeleton"],
    })
    assert published["ok"] is True, published
    assets = coc_toolbox.coc_module_project.coc_module_assets
    assets.put_entity(
        ws["workspace"], ws["asset_root_id"], "location", "opening",
        _gate4_opening_component_pack(),
    )
    projected = _run(ws, "progressive.project_opening", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "start_location_id": "opening",
    })
    assert projected["ok"] is True, projected
    scenario_path = ws["campaign_dir"] / "scenario" / "scenario.json"
    scenario = json.loads(scenario_path.read_text(encoding="utf-8"))
    scenario["opening_projection_watch"] = {
        "schema_version": 1,
        "campaign_id": ws["campaign_id"],
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "bundle_sha256": scenario["source"]["bundle_sha256"],
        "start_location_id": "opening",
        "source_scope": scenario[
            "opening_projection_source_binding"]["source_scope"],
        "source_scope_signature": scenario[
            "opening_projection_source_binding"]["source_scope_signature"],
        "created_at": "2026-08-01T00:00:00+00:00",
        "status": "complete",
    }
    _write_json(scenario_path, scenario)
    return scenario

def _gate4_deepen_opening_pack(ws: dict) -> tuple[dict, dict]:
    """Simulate the background deepen lane legally rewriting the durable pack.

    Mirrors the playtest evidence: the embedded clue row loses
    delivery_kind/visibility/parse_state, so the whole-payload receipt hash
    drifts while the canonical opening slice and the content evidence anchor
    stay identical.
    """
    assets = coc_toolbox.coc_module_project.coc_module_assets
    pack = assets.get_entity(
        ws["workspace"], ws["asset_root_id"], "location", "opening",
    )
    for clue in pack.get("clues") or []:
        clue.pop("delivery_kind", None)
        clue.pop("visibility", None)
        clue.pop("parse_state", None)
    assets.put_entity(
        ws["workspace"], ws["asset_root_id"], "location", "opening", pack,
    )
    scenario = json.loads(
        (ws["campaign_dir"] / "scenario" / "scenario.json")
        .read_text(encoding="utf-8")
    )
    stored_receipt = scenario["opening_projection_receipt"]
    payload = coc_toolbox.coc_module_project.build_opening_projection_payload(
        ws["workspace"], ws["asset_root_id"], "opening",
        scenario["opening_projection_source_binding"]["source_scope"],
    )
    recomputed = coc_toolbox.coc_module_project.opening_projection_receipt(
        ws["asset_root_id"], "opening", payload,
    )
    assert recomputed["projection_input_sha256"] != stored_receipt[
        "projection_input_sha256"
    ]
    assert recomputed["source_evidence_sha256"] == stored_receipt[
        "source_evidence_sha256"
    ]
    assert coc_toolbox.coc_module_project._selected_opening_projection_is_fresh_for_payload(
        ws["campaign_dir"], "opening", payload,
    ) is True
    return recomputed, stored_receipt

def _opening_state_bytes_without_audit(workspace: Path) -> dict[Path, bytes]:
    return {
        path.relative_to(workspace): path.read_bytes()
        for path in (workspace / ".coc").rglob("*")
        if path.is_file()
        and not path.name.endswith(".lock")
        and "logs" not in path.relative_to(workspace).parts
    }

def _publish_and_project_opening_component(ws: dict, *, pack: dict | None = None):
    published = _run(ws, "progressive.publish_skeleton", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "skeleton": ws["skeleton"],
    })
    assert published["ok"] is True, published
    assets = coc_toolbox.coc_module_project.coc_module_assets
    assets.put_entity(
        ws["workspace"],
        ws["asset_root_id"],
        "location",
        "opening",
        pack or _opening_component_pack(),
    )
    projected = _run(ws, "progressive.project_opening", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "start_location_id": "opening",
    })
    assert projected["ok"] is True, projected
    return published, projected

def _install_opening_review_task(ws: dict, scenario: dict) -> None:
    scenario["opening_source_review_task"] = (
        coc_toolbox.coc_runtime_ops._new_opening_review_task(
            campaign_id=ws["campaign_id"],
            scenario_id=scenario["scenario_id"],
            source=scenario["source"],
            source_bundle_id=ws["asset_root_id"],
            allowed_pdf_indices=[0],
            generation=1,
        )
    )

def _minimal_opening_source_facts(source_id: str) -> dict:
    refs = [{"source_id": source_id, "pdf_index": 0}]
    source = lambda value: {
        "status": "source", "value": value, "source_refs": refs,
    }
    unresolved = {
        "status": "unresolved", "inspected_source_refs": refs,
    }
    return {
        "schema_version": 1,
        "contract_id": "coc.opening-fast-facts.v1",
        "era": source("1920s"),
        "place": source("Boston"),
        "investigator_hook": unresolved,
        "investigator_constraints": unresolved,
        "player_safe_summary": unresolved,
        "content_flags": source(["haunting"]),
    }

def _minimal_module_init_l0() -> dict:
    return {
        "schema_version": 1,
        "secrecy": "keeper_only",
        "module_meta": {
            "title_zh": "开场组件",
            "title_en": "Opening Component",
            "authors": [],
            "translator": [],
            "era": "1920s",
            "locale": "Boston",
            "party_size": "1-4",
            "duration_hint": "one session",
            "tone_tags": ["mystery"],
            "mythos_entities": [],
            "campaign_hooks": ["opening"],
            "warnings": [],
            "safety_notes": None,
            "structure_type": "linear_investigation",
        },
        "pregens": [],
        "opening_hooks": [{
            "id": "opening",
            "audience": "player",
            "text": "A bounded authored opening.",
            "variant_of": None,
        }],
        "chargen_deltas": [],
        "opening_handouts": [],
    }

def _stage_reviewed_facts_transport(
    ws: dict, *, module_init_l0: dict | None = None,
) -> tuple[Path, dict]:
    scenario_path = ws["campaign_dir"] / "scenario" / "scenario.json"
    scenario = json.loads(scenario_path.read_text(encoding="utf-8"))
    scenario.update({
        "scenario_id": ws["asset_root_id"],
        "opening_source_provenance": "selection_hint_only_not_provenance",
    })
    scenario["source"]["source_bundle_path"] = str(
        ws["workspace"] / "opening-source"
    )
    _install_opening_review_task(ws, scenario)
    _write_json(scenario_path, scenario)
    receipt = coc_toolbox.coc_runtime_ops._build_opening_source_review_fulfillment(
        ws["workspace"],
        continuation={
            "schema_version": 1,
            "contract_id": "coc.opening-source-continue.v1",
            "campaign_id": ws["campaign_id"],
            "scenario_id": ws["asset_root_id"],
            "selected_opening_pdf_indices": [0],
            "source_bundle_id": ws["asset_root_id"],
            "source_bundle_path": scenario["source"]["source_bundle_path"],
            "result_delivery": "task_return_to_parent",
        },
        status="reviewed",
        selected_opening_pdf_indices=[0],
    )
    facts = _minimal_opening_source_facts("pdf:opening-component")
    coc_toolbox.coc_runtime_ops._apply_opening_source_review_fulfillment(
        ws["workspace"],
        receipt,
        source_facts=facts,
        module_init_l0=module_init_l0
        if module_init_l0 is not None else _minimal_module_init_l0(),
    )
    return scenario_path, facts

def _pi_opening_review_adapter_fixture(
    tmp_path: Path,
    *,
    source_page_count: int | None = None,
) -> tuple[dict, dict, Path]:
    ws = _opening_component_workspace(
        tmp_path, source_page_count=source_page_count,
    )
    scenario_path = ws["campaign_dir"] / "scenario" / "scenario.json"
    scenario = json.loads(scenario_path.read_text(encoding="utf-8"))
    scenario.update({
        "scenario_id": ws["asset_root_id"],
        "title": "Opening Component",
        "opening_source_provenance": "selection_hint_only_not_provenance",
    })
    scenario["source"]["source_bundle_path"] = str(
        ws["workspace"] / "opening-source"
    )
    _install_opening_review_task(ws, scenario)
    _write_json(scenario_path, scenario)
    request = {
        "schema_version": 1,
        "contract_id": "coc.pi-opening-source-review-transport.v1",
        "workspace_root": str(ws["workspace"]),
        "campaign_id": ws["campaign_id"],
        "scenario_id": ws["asset_root_id"],
        "opening_review_generation": 1,
    }
    return ws, request, scenario_path

def _pi_opening_adapter_facts(
    source_id: str, pdf_indices: list[int],
) -> dict:
    """Canonical six-question opening fast facts for the producer-result v1
    contract. All refs point into the declared fact-evidence pages so the
    adapter's fail-closed facts validation accepts them unchanged."""
    refs = [{"source_id": source_id, "pdf_index": pdf_indices[0]}]
    return {
        "schema_version": 1,
        "contract_id": "coc.opening-fast-facts.v1",
        "era": {"status": "source", "value": "1920s", "source_refs": refs},
        "place": {
            "status": "source", "value": "Opening Component",
            "source_refs": refs,
        },
        "investigator_hook": {
            "status": "source", "value": "A sealed letter arrives.",
            "source_refs": refs,
        },
        "investigator_constraints": {
            "status": "source",
            "value": "Answer within the opening room.",
            "source_refs": refs,
        },
        "player_safe_summary": {
            "status": "source", "value": "A bounded player-safe opening.",
            "source_refs": refs,
        },
        "content_flags": {
            "status": "source", "value": ["none"], "source_refs": refs,
        },
    }

def _pi_opening_adapter_l0() -> dict:
    return {
        "schema_version": 1,
        "secrecy": "keeper_only",
        "module_meta": {
            "title_zh": "开场组件",
            "title_en": "Opening Component",
            "authors": [],
            "translator": [],
            "era": "1920s",
            "locale": "Boston",
            "party_size": "1-4",
            "duration_hint": "one session",
            "tone_tags": ["mystery"],
            "mythos_entities": [],
            "campaign_hooks": ["sealed letter"],
            "warnings": [],
            "safety_notes": None,
            "structure_type": "linear_investigation",
        },
        "pregens": [],
        "opening_hooks": [{
            "id": "sealed-letter",
            "audience": "player",
            "text": "A sealed letter arrives.",
            "variant_of": None,
        }],
        "chargen_deltas": [],
        "opening_handouts": [],
    }

def _fulfilled_partial_opening_workspace(
    tmp_path: Path,
    monkeypatch,
) -> tuple[dict, str, Path, Path]:
    monkeypatch.setenv("COC_DISABLE_QUEUE_WORKER", "1")
    ws = _opening_component_workspace(tmp_path)
    published = _run(ws, "progressive.publish_skeleton", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "skeleton": ws["skeleton"],
    })
    assert published["ok"] is True, published
    requested = _run(ws, "progressive.request_opening_pack", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "start_location_id": "opening",
        "opening_pdf_indices": [0],
        "request_purpose": "foreground_opening_slice",
    })
    assert requested["ok"] is True, requested
    worker = coc_toolbox.coc_module_project._load_sibling(
        "coc_module_queue_worker_revision4_partial_fixture",
        "coc_module_queue_worker.py",
    )
    materialized = worker.run_worker_once(ws["workspace"], parallel=1)
    assert materialized["claimed"] == 1
    job_id = requested["data"]["job_id"]
    fulfilled = _run(ws, "progressive.fulfill_host_work", {
        "worker_result": {
            "job_id": job_id,
            "pack": _opening_component_pack(parse_state="partial"),
            "related_packs": [],
            "opening_setup": _opening_setup_unresolved(),
        },
    })
    assert fulfilled["ok"] is True, fulfilled
    module_root = (
        ws["workspace"] / ".coc" / "module-assets" / ws["asset_root_id"]
    )
    return (
        ws,
        job_id,
        module_root / "host-work" / f"{job_id}.json",
        module_root / "entities" / "location-opening.json",
    )

def _requested_partial_opening(
    tmp_path: Path,
    monkeypatch,
    worker_module_suffix: str,
) -> tuple[dict, str]:
    monkeypatch.setenv("COC_DISABLE_QUEUE_WORKER", "1")
    ws = _opening_component_workspace(tmp_path)
    monkeypatch.setenv("COC_HOST", "codex")
    published = _run(ws, "progressive.publish_skeleton", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "skeleton": ws["skeleton"],
    })
    assert published["ok"] is True, published
    requested = _run(ws, "progressive.request_opening_pack", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "start_location_id": "opening",
        "opening_pdf_indices": [0],
        "request_purpose": "foreground_opening_slice",
    })
    assert requested["ok"] is True, requested
    worker = coc_toolbox.coc_module_project._load_sibling(
        f"coc_module_queue_worker_{worker_module_suffix}",
        "coc_module_queue_worker.py",
    )
    assert worker.run_worker_once(ws["workspace"], parallel=1)["claimed"] == 1
    monkeypatch.setenv("COC_HOST", "pi")
    return ws, requested["data"]["job_id"]

def _bind_progressive_source_for_opening_gate(
    campaign_ws: dict, watch: dict | None
) -> None:
    """Make the campaign look source-bound with an explicit source-lane state."""
    scenario_path = campaign_ws["campaign_dir"] / "scenario" / "scenario.json"
    scenario = (
        json.loads(scenario_path.read_text(encoding="utf-8"))
        if scenario_path.is_file()
        else {}
    )
    scenario["source_cache_asset_root_id"] = "opening-gate-module"
    scenario.pop("opening_projection_receipt", None)
    scenario.pop("opening_projection_watch", None)
    if watch is not None:
        scenario["opening_projection_watch"] = watch
    _write_json(scenario_path, scenario)
    # Cold compilation would exempt the campaign from the progressive lane.
    (campaign_ws["campaign_dir"] / "scenario" / "resolution-receipt.json").unlink(
        missing_ok=True
    )

def _table_opening_error(campaign_ws: dict, decision_id: str) -> dict:
    envelope = _run(
        campaign_ws,
        "evidence.table_opening",
        {
            "text": "[in_game]\n未经来源投影的开场。\n[/in_game]",
            "run_id": "opening-gate-run",
            "presented_roll_ids": [],
            "decision_id": decision_id,
        },
    )
    assert envelope["ok"] is False, envelope
    return envelope["error"]

def _pending_opening_watch(ws: dict, *, age_seconds: float) -> None:
    """Persist a pending opening projection watch of a given age."""
    from datetime import datetime, timedelta, timezone

    path = ws["campaign_dir"] / "scenario" / "scenario.json"
    scenario = json.loads(path.read_text(encoding="utf-8"))
    created = datetime.now(timezone.utc) - timedelta(seconds=age_seconds)
    scenario["opening_projection_watch"] = {
        "schema_version": 1,
        "campaign_id": ws["campaign_id"],
        "asset_root_id": ws["asset_root_id"],
        "start_location_id": "opening",
        "source_scope": {"pdf_indices": [0]},
        "created_at": created.isoformat(),
        "status": "pending",
    }
    _write_json(path, scenario)

def _module_asset_tree_bytes(module_root: Path) -> dict[Path, bytes]:
    """Capture every durable module-asset artifact, including lifecycle metadata."""
    return {
        path.relative_to(module_root): path.read_bytes()
        for path in module_root.rglob("*")
        if path.is_file()
    }

def _project_partial_opening_to_current_receipt(ws: dict) -> str:
    """Build the current receipt whose freshness must inspect host-work."""
    boot = _run(ws, "progressive.opening_bootstrap", {
        "start_location": {"location_id": "opening", "title": "Opening"},
        "opening_pdf_indices": [0],
    })
    assert boot["ok"] is True, boot
    job_id = boot["data"]["source_work"]["job_id"]
    fulfilled = _run(ws, "progressive.fulfill_host_work", {
        "worker_result": {
            "job_id": job_id,
            "pack": _opening_component_pack(parse_state="partial"),
            "related_packs": [],
            "opening_setup": _opening_setup_unresolved(),
        },
    })
    assert fulfilled["ok"] is True, fulfilled
    assert fulfilled["data"]["automatic_projection"][0]["status"] == "complete"
    scenario = json.loads(
        (ws["campaign_dir"] / "scenario" / "scenario.json").read_text(
            encoding="utf-8"
        )
    )
    assert isinstance(scenario.get("opening_projection_receipt"), dict)
    assert isinstance(scenario.get("opening_projection_source_binding"), dict)
    return job_id

__all__ = [name for name in globals() if not name.startswith('__')]
