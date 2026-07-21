"""Contract tests for the keeper toolbox CLI/registry (coc_toolbox.py)."""
from __future__ import annotations

import hashlib
import importlib.util
import io
import json
import random
import subprocess
import sys
import time
from copy import deepcopy
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path
from threading import Event

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
    "turn",
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


def test_initial_authored_start_move_has_no_off_graph_warning(campaign_ws):
    story_graph = json.loads(
        (campaign_ws["campaign_dir"] / "scenario" / "story-graph.json").read_text(
            encoding="utf-8"
        )
    )
    start = next(scene for scene in story_graph["scenes"] if scene.get("is_start"))
    world_path = campaign_ws["campaign_dir"] / "save" / "world-state.json"
    world = json.loads(world_path.read_text(encoding="utf-8"))
    world["active_scene_id"] = None
    world["unlocked_scene_ids"] = []
    _write_json(world_path, world)

    moved = _run(campaign_ws, "state.move_scene", {
        "scene_id": start["scene_id"],
        "decision_id": "enter-authored-start",
    })

    assert moved["ok"] is True
    assert not any("off-graph" in warning for warning in moved["warnings"])
    assert not any("not unlocked" in warning for warning in moved["warnings"])
    assert moved["data"]["next_operation"]["operation"] == "scene.context"


def test_scene_context_softly_redirects_nonactive_preview_to_typed_move(
    campaign_ws,
):
    current = _run(campaign_ws, "scene.context")
    destination = current["data"]["exits"][0]["to"]
    preview = _run(campaign_ws, "scene.context", {"scene_id": destination})
    assert preview["ok"] is True
    assert preview["data"]["active_scene_id"] != destination
    assert any(
        "state.move_scene" in warning and "do not read" in warning
        for warning in preview["warnings"]
    )






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


# --------------------------------------------------------------------------- #
# Registry / CLI self-description
# --------------------------------------------------------------------------- #


def test_list_tools_covers_expected_namespaces():
    tools = coc_toolbox.list_tools()
    names = {entry["name"] for entry in tools}
    assert names == set(coc_toolbox.TOOLS)
    namespaces = {name.split(".", 1)[0] for name in names}
    assert namespaces == EXPECTED_NAMESPACES
    # Hard / advisory / write surfaces all present.
    assert any(n.startswith("rules.") for n in names)
    assert any(n.startswith("scene.") or n.startswith("clues.") for n in names)
    assert any(n.startswith("director.") or n.startswith("storylets.") for n in names)
    assert any(n.startswith("state.") for n in names)
    for entry in tools:
        assert entry["summary"]


def test_describe_known_tool_returns_parameter_schema():
    described = coc_toolbox._describe("rules.roll_dice")
    assert described["name"] == "rules.roll_dice"
    assert described["needs_campaign"] is True
    assert "expression" in described["params"]
    assert described["params"]["expression"]["required"] is True
    assert described["params"]["expression"]["type"] == "string"


def test_cli_json_stdin_accepts_one_object_without_shell_interpolation(
    tmp_path: Path, monkeypatch, capsys,
):
    monkeypatch.setattr(sys, "stdin", io.StringIO("{}"))
    code = coc_toolbox.main([
        "setup.inspect", "--root", str(tmp_path), "--json-stdin",
    ])
    assert code == 0
    envelope = json.loads(capsys.readouterr().out)
    assert envelope["ok"] is True
    assert envelope["tool"] == "setup.inspect"


def test_cli_json_stdin_rejects_non_object(monkeypatch, capsys):
    monkeypatch.setattr(sys, "stdin", io.StringIO("[]"))
    code = coc_toolbox.main(["setup.inspect", "--json-stdin"])
    assert code == 1
    envelope = json.loads(capsys.readouterr().out)
    assert envelope["error"] == {
        "code": "bad_json",
        "message": "--json-stdin must be an object",
    }


def test_setup_tools_reuse_canonical_pre_session_gateway(tmp_path):
    inspected = coc_toolbox.run_tool("setup.inspect", tmp_path, None, {})
    assert inspected["ok"] is True, inspected
    result = inspected["data"]["result"]
    assert result["workspace_ready"] is False
    haunting = next(
        row for row in result["starters"]
        if row["scenario_id"] == "the-haunting"
    )
    assert any(
        row["pregen_id"] == "thomas-hayes"
        for row in haunting["pregens"]
    )

    started = coc_toolbox.run_tool(
        "setup.quick_start",
        tmp_path,
        None,
        {
            "scenario_id": "the-haunting",
            "pregen_id": "thomas-hayes",
            "campaign_id": "typed-setup",
            "title": "Typed Setup",
        },
    )
    assert started["ok"] is True, started
    assert started["data"]["kind"] == "campaign.quick_start"
    assert started["data"]["result"]["campaign_id"] == "typed-setup"
    campaign = json.loads(
        (tmp_path / ".coc" / "campaigns" / "typed-setup" / "campaign.json")
        .read_text(encoding="utf-8")
    )
    assert campaign["play_language"] == "zh-Hans"

    unsupported = coc_toolbox.run_tool(
        "setup.quick_start",
        tmp_path,
        None,
        {
            "scenario_id": "the-haunting",
            "pregen_id": "thomas-hayes",
            "play_language": "en",
        },
    )
    assert unsupported["ok"] is False
    assert unsupported["error"]["code"] == "invalid_param"
    assert "play_language" in unsupported["error"]["message"]


def test_describe_rules_roll_exposes_context_and_push_binding_contract():
    roll = coc_toolbox._describe("rules.roll")
    push = coc_toolbox._describe("rules.push")

    for field in ("difficulty", "goal", "stakes", "difficulty_basis"):
        assert roll["params"][field]["required"] is True
    assert "default regular" not in roll["params"]["difficulty"]["desc"]
    assert push["params"]["original_check_decision_id"]["required"] is True
    for inherited in (
        "investigator",
        "skill",
        "target",
        "difficulty",
        "goal",
        "stakes",
        "difficulty_basis",
    ):
        assert inherited not in push["params"]


def test_rules_skill_describe_returns_interpersonal_catalog_and_selection_policy(tmp_path):
    described = coc_toolbox._describe("rules.skill_describe")
    assert described["name"] == "rules.skill_describe"
    assert described["needs_campaign"] is False

    result = coc_toolbox.run_tool(
        "rules.skill_describe",
        tmp_path,
        None,
        {
            "skills": ["Charm", "Persuade", "Fast Talk", "Intimidate"],
            "include_selection_policy": True,
        },
    )
    assert result["ok"] is True
    data = result["data"]
    assert set(data["skills"]) == {"Charm", "Persuade", "Fast Talk", "Intimidate"}
    assert "befriend or seduce" in json.dumps(data["selection_policy"]).lower() or any(
        rule.get("skill") == "Charm" for rule in data["selection_policy"]["rules"]
    )
    assert "warmth of personality" in data["skills"]["Charm"]["description"]
    assert data["skills"]["Persuade"]["time_note"]
    assert data["missing"] == []

    library = coc_toolbox.run_tool(
        "rules.skill_describe",
        tmp_path,
        None,
        {"skill": "Library Use", "include_selection_policy": False},
    )
    assert library["ok"] is True
    assert library["data"]["missing"] == []
    assert "Library Use" in library["data"]["skills"]
    assert "library" in library["data"]["skills"]["Library Use"]["description"].lower()

    catalog = coc_toolbox.run_tool(
        "rules.skill_describe",
        tmp_path,
        None,
        {"include_selection_policy": False},
    )
    assert catalog["ok"] is True
    assert catalog["data"]["missing"] == []
    assert len(catalog["data"]["catalog_skill_ids"]) == 79
    assert set(catalog["data"]["skills"]) == set(catalog["data"]["catalog_skill_ids"])


def test_run_tool_unknown_name_returns_error_envelope():
    envelope = coc_toolbox.run_tool("no.such.tool", Path("."), None, {})
    assert envelope["ok"] is False
    assert envelope["tool"] == "no.such.tool"
    assert envelope["error"]["code"] == "unknown_tool"
    assert "unknown tool" in envelope["error"]["message"]


def test_describe_cli_unknown_tool_exits_nonzero():
    proc = subprocess.run(
        [PYTHON, str(TOOLBOX_SCRIPT), "describe", "no.such.tool"],
        cwd=REPO,
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode != 0
    payload = json.loads(proc.stdout)
    assert payload["ok"] is False
    assert payload["error"]["code"] == "unknown_tool"


# --------------------------------------------------------------------------- #
# Envelope contract
# --------------------------------------------------------------------------- #


def test_successful_call_returns_unified_envelope(campaign_ws):
    envelope = _run(campaign_ws, "director.advise", {
        "player_text": "我检查房间里刚才异响的来源。",
        "intent_evidence": {
            "primary_intent": "investigate_scene",
            "reason": "玩家明确要寻找当前场景中异响的来源。",
        },
    })
    assert envelope["ok"] is True
    assert envelope["tool"] == "director.advise"
    assert "data" in envelope
    assert isinstance(envelope["warnings"], list)
    assert isinstance(envelope["hints"], list)
    assert "error" not in envelope


def test_clock_discontinuity_is_canonical_idempotent_and_visible_to_scene_context(
    campaign_ws,
):
    before_context = _run(campaign_ws, "scene.context")
    before_location = before_context["data"]["time"]["location_id"]
    advanced = _run(campaign_ws, "state.advance_time", {
        "minutes": 19,
        "reason": "crossing before the temporal displacement",
        "decision_id": "pre-discontinuity-advance",
    })
    assert advanced["ok"] is True

    args = {
        "discontinuity_kind": "time_shift",
        "calendar_mode": "julian",
        "precision": "day_phase",
        "display": "1287年1月1日，上半夜（具体时刻未知）",
        "local_date": "1287-01-01",
        "day_phase": "night",
        "source_ref": "module:page-17#forest-arrival",
        "reason": "the source-authored bell displaced the party into 1287",
        "decision_id": "canonical-clock-discontinuity",
    }
    first = _run(campaign_ws, "state.clock_discontinuity", args)
    replay = _run(campaign_ws, "state.clock_discontinuity", args)

    assert first["ok"] is True, first
    assert first["data"]["elapsed_minutes"] == 19
    assert first["data"]["relative_deadlines_preserved"] is True
    assert first["data"]["civil_time"]["local_datetime"] is None
    assert first["data"]["civil_time"]["local_date"] == "1287-01-01"
    assert replay["data"] == first["data"]
    assert any("duplicate decision_id" in row for row in replay["warnings"])

    context = _run(campaign_ws, "scene.context")
    assert context["ok"] is True
    stamp = context["data"]["time"]
    assert stamp["elapsed_minutes"] == 19
    assert stamp["calendar_mode"] == "julian"
    assert stamp["local_datetime"] is None
    assert stamp["local_date"] == "1287-01-01"
    assert stamp["day_phase"] == "night"
    assert stamp["location_id"] == before_location

    bad = _run(campaign_ws, "state.clock_discontinuity", {
        **args,
        "precision": "minute",
        "decision_id": "canonical-clock-discontinuity-bad",
    })
    assert bad["ok"] is False
    assert bad["error"]["code"] == "invalid_param"

    dawn = _run(campaign_ws, "state.advance_time", {
        "minutes": 180,
        "reason": "wait for the first morning bell",
        "day_phase_after": "morning",
        "display_after": "1287年1月1日，清晨（具体时刻未知）",
        "decision_id": "advance-to-first-bell",
    })
    assert dawn["ok"] is True, dawn
    assert dawn["data"]["current_time"]["local_datetime"] is None
    assert dawn["data"]["current_time"]["day_phase"] == "morning"
    assert dawn["data"]["current_time"]["display"] == (
        "1287年1月1日，清晨（具体时刻未知）"
    )


def test_structured_full_sleep_updates_director_rest_continuity(campaign_ws):
    advanced = _run(campaign_ws, "state.advance_time", {
        "minutes": 600,
        "reason": "structured time passage before a completed sleep",
        "decision_id": "advance-before-full-sleep",
    })
    assert advanced["ok"] is True, advanced
    before = _run(campaign_ws, "director.advise", {
        "player_text": "我整理接下来要查的材料。",
        "intent_evidence": {
            "primary_intent": "prepare",
            "reason": "玩家准备下一步调查。",
        },
        "decision_id": "advise-before-full-sleep",
    })
    assert before["data"]["context_summary"]["time_signals"][
        "hours_since_last_rest"
    ] == 10.0

    rested = _run(campaign_ws, "state.mark_safe_rest", {
        "investigator": campaign_ws["investigator_id"],
        "rest_kind": "full_sleep",
        "decision_id": "record-completed-full-sleep",
    })
    assert rested["ok"] is True, rested
    assert rested["data"]["time_signals"]["hours_since_last_rest"] == 0.0
    assert rested["data"]["at_elapsed"] == 600

    after = _run(campaign_ws, "director.advise", {
        "player_text": "我整理接下来要查的材料。",
        "intent_evidence": {
            "primary_intent": "prepare",
            "reason": "玩家睡醒后准备下一步调查。",
        },
        "decision_id": "advise-after-full-sleep",
    })
    assert after["data"]["context_summary"]["time_signals"][
        "hours_since_last_rest"
    ] == 0.0
    time_state = json.loads(
        (campaign_ws["campaign_dir"] / "save" / "time-state.json").read_text(
            encoding="utf-8"
        )
    )
    assert time_state["anchors"]["last_rest_elapsed"] == 600
    safe_rest_rows = [
        row for row in _read_jsonl(
            campaign_ws["campaign_dir"] / "logs" / "time.jsonl"
        )
        if row.get("event_type") == "safe_rest"
    ]
    assert safe_rest_rows == [{
        "event_type": "safe_rest",
        "investigator_id": campaign_ws["investigator_id"],
        "at_elapsed": 600,
        "rest_kind": "full_sleep",
        "decision_id": "record-completed-full-sleep",
    }]
    journaled = _run(campaign_ws, "state.journal", {
        "summary": "调查员在安全地点完成整夜睡眠。",
        "player_action": "完整休息过夜",
        "intent_class": "rest",
        "decision_id": "journal-completed-full-sleep",
    })
    assert journaled["ok"] is True, journaled
    output = _run(campaign_ws, "turn.output_context")
    assert output["ok"] is True, output
    assert [
        row["effect_kind"]
        for row in output["data"]["mechanics_bundle"]["state_delta"]
    ] == ["time", "rest"]


def test_missing_required_arg_returns_machine_readable_error(campaign_ws):
    envelope = _run(campaign_ws, "rules.roll_dice", {})
    assert envelope["ok"] is False
    assert envelope["tool"] == "rules.roll_dice"
    assert envelope["error"]["code"] == "missing_param"
    assert "expression" in envelope["error"]["message"]


@pytest.mark.parametrize(
    ("tool_name", "args"),
    [
        (
            "rules.luck_spend",
            {"points": 1, "source_roll_id": "missing-decision-source"},
        ),
        ("rules.first_aid", {"skill_value": 50}),
        ("rules.medicine", {"skill_value": 50}),
        (
            "rules.weekly_recovery",
            {"complete_rest": True, "poor_environment": False},
        ),
        ("rules.dying_check", {"clock_kind": "round"}),
        ("state.set_flag", {"flag_id": "missing-id"}),
        (
            "state.clear_transient_condition",
            {"condition": "prone", "reason": "stood up outside combat"},
        ),
        (
            "state.record_npc_engagement",
            {"npc_id": "npc-steven-knott", "interaction_kind": "dialogue"},
        ),
        (
            "state.npc_presence",
            {
                "npc_id": "npc-steven-knott",
                "scene_id": "neighborhood-gossip",
                "status": "present",
                "reason": "Knott is speaking here",
            },
        ),
        ("state.npc_update", {"npc_id": "npc-steven-knott", "trust_delta": 1}),
        (
            "state.time_marker",
            {"action": "set", "marker_id": "police-check-in", "minutes_from_now": 10},
        ),
    ],
)
def test_mutating_tools_require_decision_id(campaign_ws, tool_name, args):
    envelope = _run(campaign_ws, tool_name, args)
    assert envelope["ok"] is False
    assert envelope["error"]["code"] == "missing_param"
    assert "decision_id" in envelope["error"]["message"]


def test_invalid_request_does_not_raise_traceback(campaign_ws):
    # Bad campaign id surfaces as ToolError envelope, not an uncaught exception.
    envelope = coc_toolbox.run_tool(
        "scene.context",
        campaign_ws["workspace"],
        "missing-campaign-id",
        {},
    )
    assert envelope["ok"] is False
    assert envelope["error"]["code"] == "unknown_campaign"


def test_tool_requiring_campaign_without_id_errors():
    envelope = coc_toolbox.run_tool("scene.context", Path("."), None, {})
    assert envelope["ok"] is False
    assert envelope["error"]["code"] == "missing_campaign"


# --------------------------------------------------------------------------- #
# rules.* determinism
# --------------------------------------------------------------------------- #


def test_rules_roll_dice_same_seed_is_deterministic(campaign_ws):
    args = {
        "expression": "2D6+1",
        "seed": 12345,
        "reason": "toolbox-test",
        "decision_id": "deterministic-dice-once",
    }
    first = _run(campaign_ws, "rules.roll_dice", args)
    second = _run(campaign_ws, "rules.roll_dice", args)
    assert first["ok"] is True
    assert second["ok"] is True
    assert first["data"] == second["data"]
    data = first["data"]
    assert data["expression"] == "2D6+1"
    assert data["count"] == 2
    assert data["sides"] == 6
    assert data["modifier"] == 1
    assert isinstance(data["rolls"], list) and len(data["rolls"]) == 2
    assert all(isinstance(v, int) for v in data["rolls"])
    assert isinstance(data["total"], int)
    assert data["total"] == sum(data["rolls"]) + 1
    records = _read_jsonl(campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl")
    matching = [row for row in records if row["roll_id"] == data["roll_id"]]
    assert len(matching) == 1
    assert matching[0]["payload"]["roll_id"] == data["roll_id"]


def test_rules_opposed_requires_explicit_noncombat_domain_and_keeps_generic_tie(
    campaign_ws,
):
    rolls_path = campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl"
    before = _read_jsonl(rolls_path)
    common = {
        "investigator": campaign_ws["investigator_id"],
        "target": 30,
        "opponent_value": 90,
        "opponent_label": "auction rival",
        "reason": "compete for the higher bid",
        "decision_id": "noncombat-opposed-tie",
        "seed": 1,
    }

    omitted = _run(campaign_ws, "rules.opposed", common)
    melee = _run(
        campaign_ws,
        "rules.opposed",
        {**common, "contest_kind": "melee"},
    )

    assert omitted["ok"] is False
    assert omitted["error"]["code"] == "missing_param"
    assert melee["ok"] is False
    assert melee["error"]["code"] == "invalid_param"
    assert _read_jsonl(rolls_path) == before

    settled = _run(
        campaign_ws,
        "rules.opposed",
        {**common, "contest_kind": "noncombat"},
    )

    assert settled["ok"] is True, settled
    assert settled["data"]["investigator_roll"]["outcome"] == "regular"
    assert settled["data"]["opponent_roll"]["outcome"] == "regular"
    assert settled["data"]["winner"] == "opponent"
    assert "NON-COMBAT" in coc_toolbox.TOOLS["rules.opposed"]["summary"]


def test_rules_roll_skill_check_returns_success_level_fields(campaign_ws):
    envelope = _run(
        campaign_ws,
        "rules.roll",
        {
            "investigator": campaign_ws["investigator_id"],
            "skill": "Library Use",
            "seed": 7,
            "reason": "toolbox skill check",
            "decision_id": "skill-check-fields",
        },
    )
    assert envelope["ok"] is True
    data = envelope["data"]
    assert data["investigator_id"] == campaign_ws["investigator_id"]
    assert data["skill"] == "Library Use"
    assert isinstance(data["roll"], int)
    assert isinstance(data["target"], int)
    assert data["outcome"] in {
        "critical",
        "extreme",
        "hard",
        "regular",
        "failure",
        "fumble",
    }
    assert "effective_target" in data
    assert data["base_target"] == data["target"]
    assert data["required_target"] == data["effective_target"]
    assert data["required_level"] == data["difficulty"]
    assert data["passed"] is data["success"]
    assert isinstance(data["surplus_levels"], int)
    assert data["goal"] == "settle the focused toolbox test action"
    assert data["difficulty_basis"] == "keeper_judgment"
    assert data["pushed"] is False


@pytest.mark.parametrize(
    ("omitted", "expected_parameter"),
    [
        ("difficulty", "difficulty"),
        ("goal", "goal"),
        ("stakes", "stakes"),
        ("difficulty_basis", "difficulty_basis"),
    ],
)
def test_rules_roll_rejects_omitted_contextual_contract(
    campaign_ws, omitted, expected_parameter
):
    args = {
        "skill": "Library Use",
        "difficulty": "regular",
        "goal": "find the indexed case file",
        "stakes": {
            "on_success": "the file is located",
            "on_failure": "the search consumes time without finding it",
        },
        "difficulty_basis": "environment",
        "decision_id": f"missing-check-contract-{omitted}",
        "seed": 7,
    }
    del args[omitted]

    result = coc_toolbox.run_tool(
        "rules.roll",
        campaign_ws["workspace"],
        campaign_ws["campaign_id"],
        args,
    )

    assert result["ok"] is False
    assert result["error"]["code"] == "missing_param"
    assert expected_parameter in result["error"]["message"]


def test_rules_roll_reports_required_achieved_and_surplus_levels(campaign_ws):
    result = _run(
        campaign_ws,
        "rules.roll",
        {
            "target": 45,
            "difficulty": "hard",
            "goal": "persuade the clerk to open the archive",
            "stakes": {
                "on_success": "the clerk opens the archive",
                "on_failure": "the clerk refuses access",
            },
            "difficulty_basis": "opponent_skill",
            "decision_id": "hard-check-extreme-achievement",
            "seed": 43,
        },
    )

    assert result["ok"] is True, result
    data = result["data"]
    assert data["roll"] == 5
    assert data["base_target"] == 45
    assert data["required_level"] == "hard"
    assert data["required_target"] == 22
    assert data["achieved_level"] == "extreme"
    assert data["passed"] is True
    assert data["surplus_levels"] == 1


def test_rules_roll_reports_achieved_regular_but_failed_hard_gate(campaign_ws):
    result = _run(
        campaign_ws,
        "rules.roll",
        {
            "target": 45,
            "difficulty": "hard",
            "goal": "force the corroded lock",
            "stakes": {
                "on_success": "the lock opens",
                "on_failure": "the lock remains closed",
            },
            "difficulty_basis": "environment",
            "decision_id": "hard-check-regular-achievement",
            "seed": 8,
        },
    )

    assert result["ok"] is True, result
    data = result["data"]
    assert data["roll"] == 30
    assert data["achieved_level"] == "regular"
    assert data["passed"] is False
    assert data["success"] is False
    assert data["outcome"] == "failure"


def test_rules_roll_logs_canonical_traceable_numeric_payload(campaign_ws):
    before = len(_read_jsonl(campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl"))
    envelope = _run(
        campaign_ws,
        "rules.roll",
        {
            "investigator": campaign_ws["investigator_id"],
            "skill": "Library Use",
            "seed": 7,
            "reason": "canonical roll test",
            "decision_id": "canonical-roll-1",
        },
    )
    assert envelope["ok"] is True
    repeated = _run(
        campaign_ws,
        "rules.roll",
        {
            "investigator": campaign_ws["investigator_id"],
            "skill": "Library Use",
            "seed": 999,
            "reason": "canonical roll test",
            "decision_id": "canonical-roll-1",
        },
    )
    assert repeated["ok"] is True
    assert repeated["data"] == envelope["data"]
    assert any("duplicate decision_id" in warning for warning in repeated["warnings"])
    records = _read_jsonl(campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl")
    assert len(records) == before + 1
    row = records[-1]
    assert row["roll_id"].startswith("toolbox-")
    assert envelope["data"]["roll_id"] == row["roll_id"]
    assert repeated["data"]["roll_id"] == row["roll_id"]
    assert row["visibility"] == "public"
    assert row["source"] == "keeper_toolbox"
    assert row["source_ref"] == f"logs/rolls.jsonl#{row['roll_id']}"
    assert row["actor"] == campaign_ws["investigator_id"]
    payload = row["payload"]
    assert payload["roll_id"] == row["roll_id"]
    assert payload["skill"] == "Library Use"
    assert isinstance(payload["roll"], int)
    assert isinstance(payload["effective_target"], int)
    assert payload["outcome"]


def test_rules_roll_uses_rulebook_base_for_known_unlisted_skill(campaign_ws):
    character_path = (
        campaign_ws["coc_root"]
        / "investigators"
        / campaign_ws["investigator_id"]
        / "character.json"
    )
    character = json.loads(character_path.read_text(encoding="utf-8"))
    character["skills"].pop("Law", None)
    _write_json(character_path, character)

    envelope = _run(
        campaign_ws,
        "rules.roll",
        {
            "investigator": campaign_ws["investigator_id"],
            "skill": "law",
            "seed": 7,
            "decision_id": "rulebook-base-law",
        },
    )

    assert envelope["ok"] is True
    assert envelope["data"]["skill"] == "Law"
    assert envelope["data"]["target"] == 5
    assert envelope["data"]["target_source"] == "rulebook_base"
    assert any("base chance 5%" in hint for hint in envelope["hints"])


def test_rules_roll_dice_logs_non_percentile_faces_and_total(campaign_ws):
    args = {"expression": "2D6+1", "seed": 9, "decision_id": "dice-log-1"}
    envelope = _run(
        campaign_ws,
        "rules.roll_dice",
        args,
    )
    assert envelope["ok"] is True
    repeated = _run(campaign_ws, "rules.roll_dice", args)
    assert repeated["ok"] is True
    assert repeated["data"] == envelope["data"]
    assert any("duplicate decision_id" in warning for warning in repeated["warnings"])
    records = _read_jsonl(campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl")
    row = records[-1]
    payload = row["payload"]
    assert len([record for record in records if record["roll_id"] == row["roll_id"]]) == 1
    assert envelope["data"]["roll_id"] == row["roll_id"]
    assert repeated["data"]["roll_id"] == row["roll_id"]
    assert payload["roll_id"] == row["roll_id"]
    assert payload["die_expression"] == "2D6+1"
    assert payload["individual_faces"] == envelope["data"]["rolls"]
    assert payload["final_total"] == envelope["data"]["total"]
    assert payload["roll"] == envelope["data"]["total"]


@pytest.mark.parametrize(
    ("tool_name", "tool_args"),
    [
        (
            "rules.roll",
            {"skill": "Library Use", "reason": "crash receipt skill check"},
        ),
        (
            "rules.roll_dice",
            {"expression": "2D6+1", "reason": "crash receipt dice"},
        ),
        (
            "rules.push",
            {
                "method_changed": "cross-check the archive by docket number",
                "failure_consequence": "the archive closes before copying finishes",
            },
        ),
    ],
)
@pytest.mark.parametrize(
    "crash_stage", ["after_receipt", "after_materialization", "before_ledger"]
)
def test_roll_source_receipt_recovers_every_crash_window_exactly_once(
    campaign_ws,
    monkeypatch,
    tool_name,
    tool_args,
    crash_stage,
):
    decision_id = f"roll-receipt-{tool_name.replace('.', '-')}-{crash_stage}"
    args = {
        **tool_args,
        "investigator": campaign_ws["investigator_id"],
        "decision_id": decision_id,
        "seed": 17,
    }
    if tool_name == "rules.roll_dice":
        args.pop("investigator")
    elif tool_name == "rules.push":
        args.pop("investigator")
        original_decision_id = f"{decision_id}-original"
        _failed_roll_for_push(campaign_ws, original_decision_id)
        args["original_check_decision_id"] = original_decision_id
    real_ensure = coc_toolbox._ensure_roll_receipt_row
    real_ledger_record = coc_toolbox.Ctx.ledger_record

    def is_target(receipt):
        return (
            receipt.get("tool") == tool_name
            and receipt.get("decision_id") == decision_id
        )

    def crash_after_receipt(ctx, receipt):
        if is_target(receipt):
            raise RuntimeError("synthetic crash after roll receipt")
        return real_ensure(ctx, receipt)

    def crash_after_materialization(ctx, receipt):
        materialized = real_ensure(ctx, receipt)
        if is_target(receipt):
            raise RuntimeError("synthetic crash after roll materialization")
        return materialized

    def crash_before_ledger(
        self, current_decision_id, current_tool_name, data, **kwargs
    ):
        if current_tool_name == tool_name and current_decision_id == decision_id:
            raise RuntimeError("synthetic crash before roll ledger")
        return real_ledger_record(
            self, current_decision_id, current_tool_name, data, **kwargs
        )

    with monkeypatch.context() as crash:
        if crash_stage == "after_receipt":
            crash.setattr(
                coc_toolbox, "_ensure_roll_receipt_row", crash_after_receipt
            )
        elif crash_stage == "after_materialization":
            crash.setattr(
                coc_toolbox,
                "_ensure_roll_receipt_row",
                crash_after_materialization,
            )
        else:
            crash.setattr(coc_toolbox.Ctx, "ledger_record", crash_before_ledger)
        with pytest.raises(RuntimeError, match="synthetic crash"):
            _run(campaign_ws, tool_name, args)

    receipt_path = (
        campaign_ws["campaign_dir"]
        / "save"
        / "roll-operation-receipts.json"
    )
    receipt_doc = json.loads(receipt_path.read_text(encoding="utf-8"))
    receipt = receipt_doc["receipts"][tool_name][decision_id]
    frozen_data = receipt["data"]
    frozen_id = frozen_data["roll_id"]
    rows_after_crash = [
        row
        for row in _read_jsonl(
            campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl"
        )
        if row.get("roll_id") == frozen_id
    ]
    assert len(rows_after_crash) == (0 if crash_stage == "after_receipt" else 1)

    recovered = _run(campaign_ws, tool_name, {**args, "seed": 999})
    assert recovered["ok"] is True
    assert recovered["data"] == frozen_data
    assert any("roll source receipt" in row for row in recovered["warnings"])
    rolls = _read_jsonl(campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl")
    matches = [row for row in rolls if row.get("roll_id") == frozen_id]
    assert matches == [receipt["roll_record"]]
    assert matches[0]["payload"]["roll_id"] == recovered["data"]["roll_id"]

    ledger_path = campaign_ws["campaign_dir"] / "save" / "toolbox-ledger.json"
    ledger = json.loads(ledger_path.read_text(encoding="utf-8"))
    ledger_key = coc_toolbox.Ctx._ledger_key(tool_name, decision_id)
    ledger_entry = ledger["entries"][ledger_key]
    assert ledger_entry["data"] == frozen_data
    assert ledger_entry["source_receipt_required"] is True
    ledger_bytes = ledger_path.read_bytes()
    assert _run(campaign_ws, tool_name, args)["data"] == frozen_data
    assert ledger_path.read_bytes() == ledger_bytes
    assert len([
        row
        for row in _read_jsonl(
            campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl"
        )
        if row.get("roll_id") == frozen_id
    ]) == 1


def test_roll_legacy_ledger_without_roll_id_fails_closed_without_guessing(
    campaign_ws,
):
    decision_id = "legacy-roll-without-canonical-id"
    ctx = coc_toolbox.Ctx(
        campaign_ws["workspace"], campaign_ws["campaign_id"]
    )
    ctx.ledger_record(
        decision_id,
        "rules.roll_dice",
        {"expression": "1D6", "rolls": [4], "total": 4},
    )
    rolls_path = campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl"
    before = rolls_path.read_bytes()

    replay = _run(
        campaign_ws,
        "rules.roll_dice",
        {"expression": "1D6", "decision_id": decision_id, "seed": 99},
    )

    assert replay["ok"] is False
    assert replay["error"]["code"] == "state_corrupt"
    assert rolls_path.read_bytes() == before
    assert not (
        campaign_ws["campaign_dir"]
        / "save"
        / "roll-operation-receipts.json"
    ).exists()


def test_roll_ledger_with_id_but_no_operation_proof_fails_closed(
    campaign_ws,
):
    args = {
        "expression": "1D8+2",
        "decision_id": "pre-source-receipt-with-roll-id",
        "seed": 31,
    }
    settled = _run(campaign_ws, "rules.roll_dice", args)
    assert settled["ok"] is True
    receipt_path = (
        campaign_ws["campaign_dir"]
        / "save"
        / "roll-operation-receipts.json"
    )
    receipt_path.unlink()
    ledger_path = campaign_ws["campaign_dir"] / "save" / "toolbox-ledger.json"
    ledger = json.loads(ledger_path.read_text(encoding="utf-8"))
    ledger_key = coc_toolbox.Ctx._ledger_key(
        "rules.roll_dice", args["decision_id"]
    )
    entry = ledger["entries"][ledger_key]
    entry["entry_schema_version"] = 2
    entry.pop("source_receipt_required")
    entry.pop("source_receipt_manifest")
    _write_json(ledger_path, ledger)

    rejected = _run(campaign_ws, "rules.roll_dice", {**args, "seed": 999})

    assert rejected["ok"] is False
    assert rejected["error"]["code"] == "state_corrupt"
    assert not receipt_path.exists()
    assert len([
        row
        for row in _read_jsonl(
            campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl"
        )
        if row.get("roll_id") == settled["data"]["roll_id"]
    ]) == 1
















@pytest.mark.parametrize(
    "document",
    [
        {"schema_version": 1, "receipts": {}},
        {"schema_version": 2, "receipts": {}, "pending_side_effects": {}},
        {
            "schema_version": 3,
            "receipts": {},
            "legacy_receipts": {},
            "pending_side_effects": {},
        },
    ],
)
def test_noncurrent_roll_receipt_documents_are_rejected_without_rewrite(
    campaign_ws, document,
):
    path = (
        campaign_ws["campaign_dir"] / "save" / "roll-operation-receipts.json"
    )
    _write_json(path, document)
    before = path.read_bytes()

    rejected = _run(
        campaign_ws,
        "state.journal",
        {"summary": "must not migrate", "decision_id": "reject-old-roll-doc"},
    )

    assert rejected["ok"] is False
    assert rejected["error"]["code"] == "state_corrupt"
    assert path.read_bytes() == before


def test_malformed_or_decision_only_ledger_is_never_overwritten(campaign_ws):
    path = campaign_ws["campaign_dir"] / "save" / "toolbox-ledger.json"
    path.write_text("{broken", encoding="utf-8")
    before = path.read_bytes()
    malformed = _run(
        campaign_ws,
        "state.journal",
        {"summary": "must not replace", "decision_id": "bad-ledger-json"},
    )
    assert malformed["ok"] is False
    assert malformed["error"]["code"] == "state_corrupt"
    assert path.read_bytes() == before

    _write_json(path, {
        "schema_version": coc_toolbox._LEDGER_SCHEMA_VERSION,
        "entries": {
            "decision-only": {
                "entry_schema_version": 2,
                "tool": "state.journal",
                "decision_id": "decision-only",
                "ts": "2026-01-01T00:00:00+00:00",
                "data": {},
            },
        },
    })
    before = path.read_bytes()
    rejected = _run(
        campaign_ws,
        "state.journal",
        {"summary": "must use composite key", "decision_id": "another-id"},
    )
    assert rejected["ok"] is False
    assert rejected["error"]["code"] == "state_corrupt"
    assert path.read_bytes() == before


@pytest.mark.parametrize(
    ("tool_name", "base", "changed"),
    [
        (
            "rules.roll_dice",
            {"expression": "1D6", "reason": "semantic dice"},
            {"expression": "3D20+99"},
        ),
        (
            "rules.roll_dice",
            {"expression": "1D6", "reason": "semantic dice"},
            {"reason": "different semantic reason"},
        ),
        (
            "rules.roll",
            {"skill": "Library Use", "reason": "semantic skill"},
            {"skill": "Spot Hidden"},
        ),
        (
            "rules.roll",
            {"skill": "Library Use", "target": 55, "difficulty": "regular"},
            {"target": 56},
        ),
        (
            "rules.roll",
            {"skill": "Library Use", "difficulty": "regular"},
            {"difficulty": "hard"},
        ),
        (
            "rules.push",
            {
                "method_changed": "use the court docket",
                "failure_consequence": "the archive closes",
            },
            {"failure_consequence": "the clerk calls the police"},
        ),
        (
            "rules.push",
            {
                "method_changed": "use the court docket",
                "failure_consequence": "the archive closes",
            },
            {"method_changed": "bribe the clerk"},
        ),
    ],
)
def test_roll_receipt_rejects_semantic_decision_reuse(
    campaign_ws, tool_name, base, changed
):
    decision_id = f"semantic-conflict-{tool_name}-{abs(hash(json.dumps(changed, sort_keys=True)))}"
    args = {**base, "decision_id": decision_id, "seed": 7}
    if tool_name == "rules.roll":
        args["investigator"] = campaign_ws["investigator_id"]
    elif tool_name == "rules.push":
        original_decision_id = f"{decision_id}-original"
        _failed_roll_for_push(campaign_ws, original_decision_id)
        args["original_check_decision_id"] = original_decision_id
    first = _run(campaign_ws, tool_name, args)
    assert first["ok"] is True
    rolls_path = campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl"
    receipts_path = (
        campaign_ws["campaign_dir"] / "save" / "roll-operation-receipts.json"
    )
    before_rolls = rolls_path.read_bytes()
    before_receipts = receipts_path.read_bytes()

    conflict = _run(
        campaign_ws,
        tool_name,
        {**args, **changed, "seed": 999},
    )

    assert conflict["ok"] is False
    assert conflict["error"]["code"] == "idempotency_conflict"
    assert rolls_path.read_bytes() == before_rolls
    assert receipts_path.read_bytes() == before_receipts


def test_roll_receipt_binds_resolved_investigator(campaign_ws):
    other_id = _add_eleanor_to_party(campaign_ws)
    args = {
        "investigator": campaign_ws["investigator_id"],
        "skill": "Library Use",
        "decision_id": "semantic-investigator-conflict",
        "seed": 11,
    }
    assert _run(campaign_ws, "rules.roll", args)["ok"] is True

    conflict = _run(
        campaign_ws,
        "rules.roll",
        {**args, "investigator": other_id, "seed": 999},
    )

    assert conflict["ok"] is False
    assert conflict["error"]["code"] == "idempotency_conflict"


def test_roll_receipt_replays_implicit_investigator_after_party_changes(campaign_ws):
    args = {
        "skill": "Library Use",
        "decision_id": "implicit-investigator-party-drift",
        "seed": 11,
    }
    first = _run(campaign_ws, "rules.roll", args)
    assert first["ok"] is True
    _add_eleanor_to_party(campaign_ws)

    replay = _run(campaign_ws, "rules.roll", {**args, "seed": 999})

    assert replay["ok"] is True
    assert replay["data"] == first["data"]


def test_blank_investigator_canonicalizes_to_sole_party_member(campaign_ws):
    args = {
        "investigator": "",
        "skill": "Spot Hidden",
        "decision_id": "blank-investigator-canonical",
        "seed": 13,
    }
    settled = _run(campaign_ws, "rules.roll", args)

    assert settled["ok"] is True
    receipt = json.loads((
        campaign_ws["campaign_dir"]
        / "save"
        / "roll-operation-receipts.json"
    ).read_text(encoding="utf-8"))["receipts"]["rules.roll"][
        args["decision_id"]
    ]
    assert receipt["operation"]["investigator"] is None
    assert receipt["resolution"]["investigator_id"] == campaign_ws["investigator_id"]


@pytest.mark.parametrize(
    ("selector", "expected_label"),
    [
        ({"skill": " Spot Hidden "}, "Spot Hidden"),
        ({"characteristic": " dex "}, "DEX"),
    ],
)
def test_padded_explicit_target_selector_is_canonical_before_roll(
    campaign_ws, selector, expected_label
):
    args = {
        **selector,
        "target": 50,
        "decision_id": f"padded-explicit-{expected_label}",
        "seed": 17,
    }
    settled = _run(campaign_ws, "rules.roll", args)

    assert settled["ok"] is True
    assert settled["data"]["skill"] == expected_label
    receipt = json.loads((
        campaign_ws["campaign_dir"]
        / "save"
        / "roll-operation-receipts.json"
    ).read_text(encoding="utf-8"))["receipts"]["rules.roll"][
        args["decision_id"]
    ]
    operation_field = "skill" if "skill" in selector else "characteristic"
    assert receipt["operation"][operation_field] == expected_label
    assert receipt["resolution"]["resolved_label"] == expected_label


@pytest.mark.parametrize(
    ("first_selector", "retry_selector", "decision_id"),
    [
        ({"skill": "spot hidden"}, {"skill": "Spot Hidden"}, "case-skill-retry"),
        ({"characteristic": "dex"}, {"characteristic": "DEX"}, "case-char-retry"),
    ],
)
def test_case_only_selector_retry_reuses_one_receipt_and_roll(
    campaign_ws, first_selector, retry_selector, decision_id
):
    first = _run(
        campaign_ws,
        "rules.roll",
        {**first_selector, "decision_id": decision_id, "seed": 3},
    )
    replay = _run(
        campaign_ws,
        "rules.roll",
        {**retry_selector, "decision_id": decision_id, "seed": 999},
    )

    assert first["ok"] is True
    assert replay["ok"] is True
    assert replay["data"] == first["data"]
    document = json.loads((
        campaign_ws["campaign_dir"]
        / "save"
        / "roll-operation-receipts.json"
    ).read_text(encoding="utf-8"))
    assert list(document["receipts"]["rules.roll"]) == [decision_id]
    rows = _read_jsonl(campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl")
    assert [row["roll_id"] for row in rows] == [first["data"]["roll_id"]]




def test_intermediate_schema4_contradiction_fails_before_migration_mutation(
    campaign_ws,
):
    decision_id = "intermediate-schema4-contradiction"
    assert _run(
        campaign_ws,
        "rules.roll",
        {"skill": "Spot Hidden", "decision_id": decision_id, "seed": 5},
    )["ok"] is True
    receipt_path = (
        campaign_ws["campaign_dir"] / "save" / "roll-operation-receipts.json"
    )
    document = json.loads(receipt_path.read_text(encoding="utf-8"))
    receipt = document["receipts"]["rules.roll"][decision_id]
    receipt["operation"]["skill"] = "Stealth"
    receipt["fingerprint"] = coc_toolbox._operation_fingerprint(
        "rules.roll", receipt["operation"]
    )
    receipt[coc_toolbox._SOURCE_RECEIPT_INTEGRITY_KEY] = (
        coc_toolbox._source_receipt_integrity(receipt)
    )
    _write_json(receipt_path, document)
    rolls_path = campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl"
    state_path = (
        campaign_ws["campaign_dir"]
        / "save"
        / "investigator-state"
        / f"{campaign_ws['investigator_id']}.json"
    )
    ledger_path = campaign_ws["campaign_dir"] / "save" / "toolbox-ledger.json"
    before = tuple(
        path.read_bytes()
        for path in (receipt_path, rolls_path, state_path, ledger_path)
    )

    rejected = _run(
        campaign_ws,
        "state.journal",
        {"summary": "ambiguous selector", "decision_id": "after-selector-ambiguity"},
    )

    assert rejected["ok"] is False
    assert rejected["error"]["code"] == "state_corrupt"
    assert tuple(
        path.read_bytes()
        for path in (receipt_path, rolls_path, state_path, ledger_path)
    ) == before


@pytest.mark.parametrize(
    "invalid_args",
    [
        {"skill": "Not A Structured Skill"},
        {"skill": "Spot Hidden", "difficulty": "impossible"},
    ],
)
def test_invalid_percentile_invocation_fails_before_mechanical_roll(
    campaign_ws, monkeypatch, invalid_args
):
    def reject_mechanical_roll(*_args, **_kwargs):
        raise AssertionError("invalid invocation reached mechanical roll")

    monkeypatch.setattr(
        coc_toolbox.coc_roll, "percentile_check", reject_mechanical_roll
    )
    result = _run(
        campaign_ws,
        "rules.roll",
        {
            **invalid_args,
            "decision_id": f"invalid-before-roll-{len(invalid_args)}",
            "seed": 9,
        },
    )

    assert result["ok"] is False
    assert result["error"]["code"] in {"invalid_param", "unknown_skill"}
    assert _read_jsonl(
        campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl"
    ) == []


def test_roll_receipt_replays_after_luck_target_changes(campaign_ws):
    args = {
        "investigator": campaign_ws["investigator_id"],
        "characteristic": "LUCK",
        "reason": "luck before spend",
        "decision_id": "mutable-luck-target-roll",
        "seed": 7,
    }
    first = _run(campaign_ws, "rules.roll", args)
    assert first["ok"] is True
    receipt = json.loads((
        campaign_ws["campaign_dir"]
        / "save"
        / "roll-operation-receipts.json"
    ).read_text(encoding="utf-8"))["receipts"]["rules.roll"][
        args["decision_id"]
    ]
    assert receipt["operation"]["explicit_target"] is None
    assert "resolved_target" not in receipt["operation"]
    assert receipt["resolution"]["resolved_target"] == first["data"]["target"]
    source = _run(campaign_ws, "rules.roll", {
        "investigator": campaign_ws["investigator_id"],
        "skill": "Library Use",
        "target": 50,
        "decision_id": "mutable-luck-spend-source",
        "seed": 88,
    })
    assert source["ok"] is True
    assert source["data"]["roll"] == 51
    assert source["data"]["passed"] is False
    spent = _run(
        campaign_ws,
        "rules.luck_spend",
        {
            "investigator": campaign_ws["investigator_id"],
            "points": 1,
            "source_roll_id": source["data"]["roll_id"],
            "decision_id": "mutable-luck-spend",
        },
    )
    assert spent["ok"] is True, spent

    replay = _run(campaign_ws, "rules.roll", {**args, "seed": 999})

    assert replay["ok"] is True
    assert replay["data"] == first["data"]


def test_roll_receipt_replays_after_san_target_changes(campaign_ws):
    args = {
        "investigator": campaign_ws["investigator_id"],
        "characteristic": "SAN",
        "reason": "san before loss",
        "decision_id": "mutable-san-target-roll",
        "seed": 7,
    }
    first = _run(campaign_ws, "rules.roll", args)
    assert first["ok"] is True
    changed = _run(
        campaign_ws,
        "rules.sanity_check",
        {
            "investigator": campaign_ws["investigator_id"],
            "source": "mutable target regression",
            "loss_success": "1",
            "loss_failure": "1",
            "decision_id": "mutable-san-loss",
            "seed": 19,
        },
    )
    assert changed["ok"] is True
    assert changed["data"]["san_loss"] == 1

    replay = _run(campaign_ws, "rules.roll", {**args, "seed": 999})

    assert replay["ok"] is True
    assert replay["data"] == first["data"]


def test_roll_receipt_replays_after_development_skill_value_changes(campaign_ws):
    args = {
        "investigator": campaign_ws["investigator_id"],
        "skill": "Library Use",
        "reason": "skill before development",
        "decision_id": "mutable-skill-target-roll",
        "seed": 7,
    }
    first = _run(campaign_ws, "rules.roll", args)
    assert first["ok"] is True
    character_path = (
        campaign_ws["coc_root"]
        / "investigators"
        / campaign_ws["investigator_id"]
        / "character.json"
    )
    character = json.loads(character_path.read_text(encoding="utf-8"))
    character["skills"]["Library Use"] += 7
    _write_json(character_path, character)

    replay = _run(campaign_ws, "rules.roll", {**args, "seed": 999})

    assert replay["ok"] is True
    assert replay["data"] == first["data"]


def test_roll_receipt_replays_after_character_file_is_removed(campaign_ws):
    args = {
        "investigator": campaign_ws["investigator_id"],
        "skill": "Library Use",
        "reason": "character deletion retry",
        "decision_id": "deleted-character-roll-replay",
        "seed": 7,
    }
    first = _run(campaign_ws, "rules.roll", args)
    assert first["ok"] is True
    character_path = (
        campaign_ws["coc_root"]
        / "investigators"
        / campaign_ws["investigator_id"]
        / "character.json"
    )
    character_path.unlink()

    replay = _run(campaign_ws, "rules.roll", {**args, "seed": 999})

    assert replay["ok"] is True
    assert replay["data"] == first["data"]


@pytest.mark.parametrize("mutable_environment", ["deleted", "casefold_ambiguous"])
@pytest.mark.parametrize(
    ("tool_name", "changed"),
    [
        ("rules.roll", {"reason": "changed reason"}),
        ("rules.roll", {"difficulty": "hard"}),
        ("rules.roll", {"bonus": 1}),
        ("rules.roll", {"target": 50}),
        ("rules.roll", {"skill": "Spot Hidden"}),
        ("rules.roll", {"characteristic": "DEX"}),
        ("rules.push", {"fumble_consequence": "the shelves collapse"}),
        ("rules.push", {"method_changed": "a third search method"}),
        ("rules.push", {"failure_consequence": "the records burn"}),
    ],
)
def test_owned_decision_conflicts_without_reading_mutable_character_state(
    campaign_ws, mutable_environment, tool_name, changed
):
    decision_id = (
        f"frozen-conflict-{mutable_environment}-{tool_name}-"
        f"{next(iter(changed))}"
    )
    if tool_name == "rules.push":
        original_decision_id = f"{decision_id}-original"
        _failed_roll_for_push(campaign_ws, original_decision_id)
        args = {
            "original_check_decision_id": original_decision_id,
            "method_changed": "search a different archive",
            "failure_consequence": "the archive closes",
            "decision_id": decision_id,
            "seed": 7,
        }
    else:
        args = {
            "investigator": campaign_ws["investigator_id"],
            "skill": "Library Use",
            "reason": "original frozen reason",
            "decision_id": decision_id,
            "seed": 7,
        }
    first = _run(campaign_ws, tool_name, args)
    assert first["ok"] is True
    character_path = (
        campaign_ws["coc_root"]
        / "investigators"
        / campaign_ws["investigator_id"]
        / "character.json"
    )
    if mutable_environment == "deleted":
        character_path.unlink()
    else:
        character = json.loads(character_path.read_text(encoding="utf-8"))
        character["skills"]["library use"] = character["skills"]["Library Use"]
        _write_json(character_path, character)

    exact = _run(campaign_ws, tool_name, {**args, "seed": 999})
    assert exact["ok"] is True
    assert exact["data"] == first["data"]
    receipt_path = (
        campaign_ws["campaign_dir"] / "save" / "roll-operation-receipts.json"
    )
    rolls_path = campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl"
    state_path = (
        campaign_ws["campaign_dir"]
        / "save"
        / "investigator-state"
        / f"{campaign_ws['investigator_id']}.json"
    )
    ledger_path = campaign_ws["campaign_dir"] / "save" / "toolbox-ledger.json"
    before = tuple(
        path.read_bytes()
        for path in (receipt_path, rolls_path, state_path, ledger_path)
    )

    conflict = _run(
        campaign_ws,
        tool_name,
        {**args, **changed, "seed": 1234},
    )

    assert conflict["ok"] is False
    assert conflict["error"]["code"] == "idempotency_conflict"
    assert tuple(
        path.read_bytes()
        for path in (receipt_path, rolls_path, state_path, ledger_path)
    ) == before


def test_owned_decision_exact_and_conflict_paths_are_frozen_only(
    campaign_ws, monkeypatch
):
    args = {
        "skill": "Library Use",
        "reason": "frozen-only operation",
        "decision_id": "frozen-only-owned-decision",
        "seed": 5,
    }
    first = _run(campaign_ws, "rules.roll", args)
    assert first["ok"] is True

    def reject_mutable_read(*_args, **_kwargs):
        raise AssertionError("owned decision consulted mutable resolution state")

    monkeypatch.setattr(coc_toolbox.Ctx, "party_ids", reject_mutable_read)
    monkeypatch.setattr(coc_toolbox.Ctx, "sheet", reject_mutable_read)
    monkeypatch.setattr(coc_toolbox.Ctx, "inv_state", reject_mutable_read)
    monkeypatch.setattr(coc_toolbox, "_canonical_skill_base", reject_mutable_read)
    monkeypatch.setattr(coc_toolbox, "_resolve_target_value", reject_mutable_read)

    exact = _run(campaign_ws, "rules.roll", {**args, "seed": 999})
    conflict = _run(
        campaign_ws,
        "rules.roll",
        {**args, "reason": "changed", "seed": 999},
    )

    assert exact["ok"] is True
    assert exact["data"] == first["data"]
    assert conflict["ok"] is False
    assert conflict["error"]["code"] == "idempotency_conflict"


@pytest.mark.parametrize(
    ("write_mode", "recovers"),
    [
        ("partial", True),
        ("full_without_newline", True),
        ("full_then_later_frame", True),
        ("ambiguous_non_tail", False),
    ],
)
def test_roll_receipt_repairs_only_proven_low_level_append_crashes(
    campaign_ws, monkeypatch, write_mode, recovers
):
    decision_id = f"low-level-roll-tail-{write_mode}"
    args = {
        "expression": "2D6+1",
        "reason": "low-level append crash",
        "decision_id": decision_id,
        "seed": 41,
    }
    real_ensure = coc_toolbox._ensure_roll_receipt_row

    def crash_after_receipt(ctx, receipt):
        if receipt.get("decision_id") == decision_id:
            raise RuntimeError("stop after durable receipt")
        return real_ensure(ctx, receipt)

    with monkeypatch.context() as crash:
        crash.setattr(coc_toolbox, "_ensure_roll_receipt_row", crash_after_receipt)
        with pytest.raises(RuntimeError, match="durable receipt"):
            _run(campaign_ws, "rules.roll_dice", args)

    receipt_path = (
        campaign_ws["campaign_dir"] / "save" / "roll-operation-receipts.json"
    )
    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))["receipts"][
        "rules.roll_dice"
    ][decision_id]
    expected = coc_toolbox._roll_record_frame(receipt["roll_record"])
    later_row = {
        "roll_id": f"later-{write_mode}",
        "event_type": "roll",
        "visibility": "public",
        "payload": {"roll_id": f"later-{write_mode}", "roll": 1},
    }
    later_frame = json.dumps(later_row).encode("utf-8") + b"\n"
    if write_mode == "partial":
        crash_bytes = expected[: len(expected) // 2]
    elif write_mode == "full_without_newline":
        crash_bytes = expected
    elif write_mode == "full_then_later_frame":
        crash_bytes = expected + later_frame
    else:
        crash_bytes = expected[: len(expected) // 2] + later_frame

    rolls_path = campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl"
    low_level_writer = """
import os
import sys
path = sys.argv[1]
payload = bytes.fromhex(sys.argv[2])
fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
os.write(fd, payload)
os.fsync(fd)
os._exit(91)
"""
    crashed = subprocess.run(
        [sys.executable, "-c", low_level_writer, str(rolls_path), crash_bytes.hex()],
        check=False,
    )
    assert crashed.returncode == 91
    crashed_bytes = rolls_path.read_bytes()

    replay = _run(campaign_ws, "rules.roll_dice", {**args, "seed": 999})

    if not recovers:
        assert replay["ok"] is False
        assert replay["error"]["code"] == "state_corrupt"
        assert rolls_path.read_bytes() == crashed_bytes
        return
    assert replay["ok"] is True
    assert replay["data"] == receipt["data"]
    rows = _read_jsonl(rolls_path)
    assert [row for row in rows if row.get("roll_id") == receipt["roll_id"]] == [
        receipt["roll_record"]
    ]
    if write_mode == "full_then_later_frame":
        assert rows[-1] == later_row


def test_roll_receipt_prefix_tamper_fails_closed_without_log_mutation(campaign_ws):
    decision_id = "tampered-roll-prefix"
    settled = _run(
        campaign_ws,
        "rules.roll_dice",
        {"expression": "1D6", "decision_id": decision_id, "seed": 7},
    )
    assert settled["ok"] is True
    receipt_path = (
        campaign_ws["campaign_dir"] / "save" / "roll-operation-receipts.json"
    )
    document = json.loads(receipt_path.read_text(encoding="utf-8"))
    receipt = document["receipts"]["rules.roll_dice"][decision_id]
    receipt["log_prefix_sha256"] = f"sha256:{'0' * 64}"
    receipt[coc_toolbox._SOURCE_RECEIPT_INTEGRITY_KEY] = (
        coc_toolbox._source_receipt_integrity(receipt)
    )
    _write_json(receipt_path, document)
    rolls_path = campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl"
    before = rolls_path.read_bytes()

    rejected = _run(
        campaign_ws,
        "state.journal",
        {"summary": "must not pass tamper", "decision_id": "after-roll-tamper"},
    )

    assert rejected["ok"] is False
    assert rejected["error"]["code"] == "state_corrupt"
    assert rolls_path.read_bytes() == before


@pytest.mark.parametrize(
    ("tool_name", "args", "resolution_field", "tampered_value"),
    [
        (
            "rules.roll_dice",
            {"expression": "1D6", "decision_id": "dice-resolution-tamper"},
            "sides",
            999,
        ),
        (
            "rules.roll",
            {
                "skill": "Library Use",
                "decision_id": "percentile-resolution-tamper",
            },
            "resolved_target",
            999,
        ),
        (
            "rules.roll_dice",
            {"expression": "1D6", "decision_id": "dice-resolution-extra-field"},
            "unexpected",
            1,
        ),
        (
            "rules.roll",
            {
                "skill": "Library Use",
                "decision_id": "percentile-resolution-wrong-type",
            },
            "target_source",
            7,
        ),
    ],
)
def test_coordinated_resolution_tamper_is_rejected_without_evidence_mutation(
    campaign_ws, tool_name, args, resolution_field, tampered_value
):
    if tool_name == "rules.roll":
        args = {**args, "investigator": campaign_ws["investigator_id"]}
    settled = _run(campaign_ws, tool_name, {**args, "seed": 7})
    assert settled["ok"] is True
    receipt_path = (
        campaign_ws["campaign_dir"] / "save" / "roll-operation-receipts.json"
    )
    document = json.loads(receipt_path.read_text(encoding="utf-8"))
    receipt = document["receipts"][tool_name][args["decision_id"]]
    receipt["resolution"][resolution_field] = tampered_value
    receipt[coc_toolbox._SOURCE_RECEIPT_INTEGRITY_KEY] = (
        coc_toolbox._source_receipt_integrity(receipt)
    )
    _write_json(receipt_path, document)
    receipt_bytes = receipt_path.read_bytes()
    rolls_path = campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl"
    roll_bytes = rolls_path.read_bytes()

    rejected = _run(
        campaign_ws,
        "state.journal",
        {
            "summary": "resolution contradiction must fail",
            "decision_id": f"after-{args['decision_id']}",
        },
    )

    assert rejected["ok"] is False
    assert rejected["error"]["code"] == "state_corrupt"
    assert receipt_path.read_bytes() == receipt_bytes
    assert rolls_path.read_bytes() == roll_bytes


def test_coordinated_dice_receipt_and_log_tamper_fails_before_any_mutation(
    campaign_ws,
):
    decision_id = "coordinated-dice-log-tamper"
    assert _run(
        campaign_ws,
        "rules.roll_dice",
        {"expression": "1D6", "decision_id": decision_id, "seed": 7},
    )["ok"] is True
    receipt_path = (
        campaign_ws["campaign_dir"] / "save" / "roll-operation-receipts.json"
    )
    document = json.loads(receipt_path.read_text(encoding="utf-8"))
    receipt = document["receipts"]["rules.roll_dice"][decision_id]
    receipt["resolution"]["sides"] = 999
    receipt["data"]["sides"] = 999
    receipt["roll_record"]["sides"] = 999
    receipt["roll_record"]["payload"]["sides"] = 999
    receipt[coc_toolbox._SOURCE_RECEIPT_INTEGRITY_KEY] = (
        coc_toolbox._source_receipt_integrity(receipt)
    )
    _write_json(receipt_path, document)
    rolls_path = campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl"
    rolls_path.write_text(
        json.dumps(receipt["roll_record"], ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    state_path = (
        campaign_ws["campaign_dir"]
        / "save"
        / "investigator-state"
        / f"{campaign_ws['investigator_id']}.json"
    )
    before = (receipt_path.read_bytes(), rolls_path.read_bytes(), state_path.read_bytes())

    rejected = _run(
        campaign_ws,
        "state.journal",
        {"summary": "mechanical contradiction", "decision_id": "after-dice-log-tamper"},
    )

    assert rejected["ok"] is False
    assert rejected["error"]["code"] == "state_corrupt"
    assert (receipt_path.read_bytes(), rolls_path.read_bytes(), state_path.read_bytes()) == before


@pytest.mark.parametrize(
    "tampered_reason",
    ["a different frozen reason", {"not": "a string"}],
)
def test_current_dice_reason_tamper_fails_global_preflight_without_mutation(
    campaign_ws, tampered_reason
):
    decision_id = "current-dice-reason-contract"
    assert _run(
        campaign_ws,
        "rules.roll_dice",
        {
            "expression": "1D6",
            "reason": "original frozen reason",
            "decision_id": decision_id,
            "seed": 7,
        },
    )["ok"] is True
    receipt_path = (
        campaign_ws["campaign_dir"] / "save" / "roll-operation-receipts.json"
    )
    document = json.loads(receipt_path.read_text(encoding="utf-8"))
    receipt = document["receipts"]["rules.roll_dice"][decision_id]
    receipt["operation"]["reason"] = tampered_reason
    receipt["fingerprint"] = coc_toolbox._operation_fingerprint(
        "rules.roll_dice", receipt["operation"]
    )
    receipt[coc_toolbox._SOURCE_RECEIPT_INTEGRITY_KEY] = (
        coc_toolbox._source_receipt_integrity(receipt)
    )
    _write_json(receipt_path, document)
    rolls_path = campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl"
    state_path = (
        campaign_ws["campaign_dir"]
        / "save"
        / "investigator-state"
        / f"{campaign_ws['investigator_id']}.json"
    )
    ledger_path = campaign_ws["campaign_dir"] / "save" / "toolbox-ledger.json"
    before = tuple(
        path.read_bytes()
        for path in (receipt_path, rolls_path, state_path, ledger_path)
    )

    rejected = _run(
        campaign_ws,
        "state.journal",
        {"summary": "detect dice reason damage", "decision_id": "after-dice-reason"},
    )

    assert rejected["ok"] is False
    assert rejected["error"]["code"] == "state_corrupt"
    assert tuple(
        path.read_bytes()
        for path in (receipt_path, rolls_path, state_path, ledger_path)
    ) == before


@pytest.mark.parametrize(
    ("tool_name", "operation_field", "tampered_value"),
    [
        ("rules.roll", "required_level", "extreme"),
        ("rules.roll", "bonus", 99),
        ("rules.roll", "bonus", True),
        ("rules.roll", "reason", {"bad": "type"}),
        ("rules.roll", "fumble_consequence", "a different fumble"),
        ("rules.push", "method_changed", "a different method"),
        ("rules.push", "failure_consequence", "a different consequence"),
        ("rules.push", "pushed", False),
    ],
)
def test_current_percentile_invocation_tamper_fails_before_mutation(
    campaign_ws, tool_name, operation_field, tampered_value
):
    decision_id = (
        f"current-percentile-{tool_name}-{operation_field}-"
        f"{type(tampered_value).__name__}"
    )
    if tool_name == "rules.push":
        original_decision_id = f"{decision_id}-original"
        _failed_roll_for_push(campaign_ws, original_decision_id)
        args = {
            "original_check_decision_id": original_decision_id,
            "method_changed": "search a different archive",
            "failure_consequence": "the archive closes",
            "fumble_consequence": "the archive shelves collapse",
            "decision_id": decision_id,
            "seed": 4,
        }
    else:
        args = {
            "investigator": campaign_ws["investigator_id"],
            "skill": "Library Use",
            "difficulty": "hard",
            "bonus": 1,
            "reason": "original percentile reason",
            "fumble_consequence": "original fumble consequence",
            "decision_id": decision_id,
            "seed": 4,
        }
    assert _run(campaign_ws, tool_name, args)["ok"] is True
    receipt_path = (
        campaign_ws["campaign_dir"] / "save" / "roll-operation-receipts.json"
    )
    document = json.loads(receipt_path.read_text(encoding="utf-8"))
    receipt = document["receipts"][tool_name][decision_id]
    receipt["operation"][operation_field] = tampered_value
    receipt["fingerprint"] = coc_toolbox._operation_fingerprint(
        tool_name, receipt["operation"]
    )
    receipt[coc_toolbox._SOURCE_RECEIPT_INTEGRITY_KEY] = (
        coc_toolbox._source_receipt_integrity(receipt)
    )
    _write_json(receipt_path, document)
    rolls_path = campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl"
    state_path = (
        campaign_ws["campaign_dir"]
        / "save"
        / "investigator-state"
        / f"{campaign_ws['investigator_id']}.json"
    )
    ledger_path = campaign_ws["campaign_dir"] / "save" / "toolbox-ledger.json"
    before = tuple(
        path.read_bytes()
        for path in (receipt_path, rolls_path, state_path, ledger_path)
    )

    rejected = _run(
        campaign_ws,
        "state.journal",
        {
            "summary": "detect percentile invocation damage",
            "decision_id": f"after-{decision_id}",
        },
    )

    assert rejected["ok"] is False
    assert rejected["error"]["code"] == "state_corrupt"
    assert tuple(
        path.read_bytes()
        for path in (receipt_path, rolls_path, state_path, ledger_path)
    ) == before


def test_roll_receipt_preflight_indexes_301_rows_without_ledger_rewrites(
    campaign_ws, monkeypatch
):
    ctx = coc_toolbox.Ctx(campaign_ws["workspace"], campaign_ws["campaign_id"])
    document = {
        "schema_version": coc_toolbox._ROLL_RECEIPT_DOCUMENT_SCHEMA_VERSION,
        "receipts": {},
        "pending_side_effects": {},
        "luck_spends": {},
    }
    raw = b""
    for ordinal in range(301):
        decision_id = f"bulk-roll-{ordinal:03d}"
        total = (ordinal % 6) + 1
        reason = f"bulk-{ordinal:03d}"
        data = {
            "expression": "1D6",
            "count": 1,
            "sides": 6,
            "modifier": 0,
            "rolls": [total],
            "total": total,
            "reason": reason,
        }
        record = ctx.prepare_roll({
            **data,
            "ts": f"bulk-{ordinal:03d}",
            "payload": {
                **data,
                "die_expression": data["expression"],
                "individual_faces": list(data["rolls"]),
                "final_total": data["total"],
                "roll": data["total"],
            },
        })
        data["roll_id"] = record["roll_id"]
        receipt = coc_toolbox._new_roll_receipt(
            tool_name="rules.roll_dice",
            decision_id=decision_id,
            operation=coc_toolbox._roll_dice_semantic_operation(
                {"expression": "1D6", "reason": reason}
            ),
            resolution={
                "expression": "1D6",
                "count": 1,
                "sides": 6,
                "modifier": 0,
            },
            roll_record=record,
            data=data,
            warnings=[],
            hints=[],
        )
        receipt["log_prefix_size"] = len(raw)
        receipt["log_prefix_sha256"] = f"sha256:{hashlib.sha256(raw).hexdigest()}"
        receipt[coc_toolbox._SOURCE_RECEIPT_INTEGRITY_KEY] = (
            coc_toolbox._source_receipt_integrity(receipt)
        )
        coc_toolbox._put_roll_receipt(document, receipt)
        coc_toolbox._queue_roll_side_effect(document, receipt)
        raw += coc_toolbox._roll_record_frame(record) + b"\n"

    coc_toolbox._save_roll_receipt_document(ctx, document)
    rolls_path = campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl"
    rolls_path.write_bytes(raw)
    reads = 0
    prefix_bytes = 0
    real_read = coc_toolbox._roll_log_bytes
    real_prefix_update = coc_toolbox._roll_prefix_hash_update

    def count_read(current_ctx):
        nonlocal reads
        reads += 1
        return real_read(current_ctx)

    def reject_ledger_write(*_args, **_kwargs):
        raise AssertionError("global receipt preflight must not rewrite the ledger")

    def count_prefix_bytes(digest, chunk):
        nonlocal prefix_bytes
        prefix_bytes += len(chunk)
        return real_prefix_update(digest, chunk)

    monkeypatch.setattr(coc_toolbox, "_roll_log_bytes", count_read)
    monkeypatch.setattr(
        coc_toolbox, "_roll_prefix_hash_update", count_prefix_bytes
    )
    monkeypatch.setattr(coc_toolbox.Ctx, "ledger_record", reject_ledger_write)
    coc_toolbox._reconcile_all_roll_source_receipts(ctx)
    first_prefix_bytes = prefix_bytes
    coc_toolbox._reconcile_all_roll_source_receipts(ctx)

    assert reads == 2
    assert first_prefix_bytes <= len(raw)
    assert prefix_bytes - first_prefix_bytes <= len(raw)
    assert rolls_path.read_bytes() == raw
    ledger_path = campaign_ws["campaign_dir"] / "save" / "toolbox-ledger.json"
    if ledger_path.is_file():
        entries = json.loads(ledger_path.read_text(encoding="utf-8"))["entries"]
        assert len(entries) <= 300


@pytest.mark.parametrize("receipt_count", [40, 120])
def test_settled_skill_receipts_do_not_replay_development_side_effects(
    campaign_ws, monkeypatch, receipt_count
):
    ctx = coc_toolbox.Ctx(campaign_ws["workspace"], campaign_ws["campaign_id"])
    document = {
        "schema_version": coc_toolbox._ROLL_RECEIPT_DOCUMENT_SCHEMA_VERSION,
        "receipts": {},
        "pending_side_effects": {},
        "luck_spends": {},
    }
    raw = b""
    for ordinal in range(receipt_count):
        decision_id = f"settled-skill-{receipt_count}-{ordinal:03d}"
        data = {
            **coc_toolbox.coc_roll.resolve_percentile_roll(
                1, 60, "regular"
            ),
            "roll": 1,
            "bonus": 0,
            "penalty": 0,
            "investigator_id": campaign_ws["investigator_id"],
            "skill": "Spot Hidden",
            "target_source": "sheet",
            "pushed": False,
            "goal": "notice the focused test detail",
            "stakes": {
                "on_success": "the detail is noticed",
                "on_failure": "the detail is not noticed",
            },
            "difficulty_basis": "keeper_judgment",
        }
        record = ctx.prepare_roll({
            "event_type": "roll",
            "kind": "skill_check",
            "actor": campaign_ws["investigator_id"],
            "visibility": "public",
            "payload": dict(data),
            "ts": f"settled-{ordinal:03d}",
            **data,
        })
        data["roll_id"] = record["roll_id"]
        receipt = coc_toolbox._new_roll_receipt(
            tool_name="rules.roll",
            decision_id=decision_id,
            operation={
                "investigator": campaign_ws["investigator_id"],
                "skill": "Spot Hidden",
                "characteristic": None,
                "explicit_target": None,
                "required_level": "regular",
                "bonus": 0,
                "penalty": 0,
                "goal": "notice the focused test detail",
                "stakes": {
                    "on_success": "the detail is noticed",
                    "on_failure": "the detail is not noticed",
                },
                "difficulty_basis": "keeper_judgment",
                "reason": None,
                "fumble_consequence": None,
                "pushed": False,
                "method_changed": None,
                "failure_consequence": None,
                "original_check_decision_id": None,
            },
            resolution={
                "investigator_id": campaign_ws["investigator_id"],
                "resolved_label": "Spot Hidden",
                "resolved_target": 60,
                "target_source": "sheet",
                "original_check_ref": None,
            },
            roll_record=record,
            data=data,
            warnings=[],
            hints=[],
        )
        receipt["log_prefix_size"] = len(raw)
        receipt["log_prefix_sha256"] = f"sha256:{hashlib.sha256(raw).hexdigest()}"
        receipt[coc_toolbox._SOURCE_RECEIPT_INTEGRITY_KEY] = (
            coc_toolbox._source_receipt_integrity(receipt)
        )
        coc_toolbox._put_roll_receipt(document, receipt)
        coc_toolbox._queue_roll_side_effect(document, receipt)
        raw += coc_toolbox._roll_record_frame(record) + b"\n"

    coc_toolbox._save_roll_receipt_document(ctx, document)
    rolls_path = campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl"
    rolls_path.write_bytes(raw)
    side_effect_calls = 0
    document_writes = 0
    real_save = coc_toolbox._save_roll_receipt_document

    def count_side_effect(*_args, **_kwargs):
        nonlocal side_effect_calls
        side_effect_calls += 1
        return True

    def count_save(*args, **kwargs):
        nonlocal document_writes
        document_writes += 1
        return real_save(*args, **kwargs)

    monkeypatch.setattr(
        coc_toolbox, "_apply_roll_receipt_side_effects", count_side_effect
    )
    monkeypatch.setattr(coc_toolbox, "_save_roll_receipt_document", count_save)
    coc_toolbox._reconcile_all_roll_source_receipts(ctx)
    assert side_effect_calls == receipt_count
    assert document_writes == 1
    document_bytes = coc_toolbox._roll_receipt_path(ctx).read_bytes()
    state_path = (
        campaign_ws["campaign_dir"]
        / "save"
        / "investigator-state"
        / f"{campaign_ws['investigator_id']}.json"
    )
    development_path = (
        campaign_ws["coc_root"]
        / "investigators"
        / campaign_ws["investigator_id"]
        / "development.jsonl"
    )
    state_bytes = state_path.read_bytes()
    development_bytes = development_path.read_bytes()

    side_effect_calls = 0
    document_writes = 0

    def reject_side_effect(*_args, **_kwargs):
        raise AssertionError("settled receipt must not re-enter development repair")

    monkeypatch.setattr(
        coc_toolbox, "_apply_roll_receipt_side_effects", reject_side_effect
    )
    coc_toolbox._reconcile_all_roll_source_receipts(ctx)

    assert side_effect_calls == 0
    assert document_writes == 0
    assert coc_toolbox._roll_receipt_path(ctx).read_bytes() == document_bytes
    assert state_path.read_bytes() == state_bytes
    assert development_path.read_bytes() == development_bytes


def test_rules_luck_spend_is_idempotent_and_does_not_fabricate_roll(campaign_ws):
    state_path = (
        campaign_ws["campaign_dir"]
        / "save"
        / "investigator-state"
        / f"{campaign_ws['investigator_id']}.json"
    )
    source = _run(campaign_ws, "rules.roll", {
        "investigator": campaign_ws["investigator_id"],
        "skill": "Library Use",
        "target": 50,
        "decision_id": "luck-source",
        "seed": 88,
    })
    assert source["ok"] is True
    assert source["data"]["roll"] == 51
    assert source["data"]["passed"] is False
    before_luck = json.loads(state_path.read_text(encoding="utf-8"))["current_luck"]
    roll_path = campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl"
    before_rolls = len(_read_jsonl(roll_path))
    args = {
        "investigator": campaign_ws["investigator_id"],
        "points": 1,
        "source_roll_id": source["data"]["roll_id"],
        "decision_id": "luck-once",
    }
    first = _run(campaign_ws, "rules.luck_spend", args)
    second = _run(campaign_ws, "rules.luck_spend", args)
    assert first["ok"] and second["ok"]
    assert second["data"] == first["data"]
    assert any("duplicate decision_id" in warning for warning in second["warnings"])
    assert first["data"]["source_roll_id"] == source["data"]["roll_id"]
    assert first["data"]["source_receipt"]["decision_id"] == "luck-source"
    assert first["data"]["original_roll"] == 51
    assert first["data"]["roll"] == first["data"]["adjusted_roll"] == 50
    assert first["data"]["passed"] is True
    after_luck = json.loads(state_path.read_text(encoding="utf-8"))["current_luck"]
    assert after_luck == before_luck - 1
    assert len(_read_jsonl(roll_path)) == before_rolls
    luck_events = [
        row
        for row in _read_jsonl(campaign_ws["campaign_dir"] / "logs" / "events.jsonl")
        if row.get("event_type") == "luck_spent"
    ]
    assert len(luck_events) == 1


def test_rules_luck_spend_rejects_a_roll_after_turn_finalization(campaign_ws):
    source = _run(campaign_ws, "rules.roll", {
        "investigator": campaign_ws["investigator_id"],
        "skill": "Library Use",
        "target": 50,
        "decision_id": "finalized-luck-source",
        "seed": 88,
    })
    assert source["data"]["roll"] == 51
    journaled = _run(campaign_ws, "state.journal", {
        "summary": "调查员没有在本轮结算前花费幸运，尝试失败。",
        "player_action": "完成一次失败的图书馆使用检定",
        "intent_class": "investigate",
        "decision_id": "finalized-luck-journal",
    })
    assert journaled["ok"] is True
    finalized = _finalize_pending_turn_for_test(
        campaign_ws, decision_id="finalized-luck-finalize"
    )
    assert finalized["ok"] is True

    rejected = _run(campaign_ws, "rules.luck_spend", {
        "investigator": campaign_ws["investigator_id"],
        "source_roll_id": source["data"]["roll_id"],
        "points": 1,
        "decision_id": "too-late-luck-spend",
    })

    assert rejected["ok"] is False
    assert rejected["error"]["code"] == "invalid_state"
    assert "before turn.finalize" in rejected["error"]["message"]


@pytest.mark.parametrize("receipt_state", ["crash_window", "completed"])
@pytest.mark.parametrize("source_tamper", ["delete", "alter"])
def test_rules_luck_spend_existing_receipt_revalidates_public_source_before_writes(
    campaign_ws,
    receipt_state,
    source_tamper,
):
    investigator_id = campaign_ws["investigator_id"]
    source = _run(campaign_ws, "rules.roll", {
        "investigator": investigator_id,
        "skill": "Library Use",
        "target": 50,
        "decision_id": f"luck-replay-source-{receipt_state}-{source_tamper}",
        "seed": 88,
    })
    assert source["ok"] is True
    assert source["data"]["roll"] == 51
    assert source["data"]["passed"] is False
    source_roll_id = source["data"]["roll_id"]
    decision_id = f"luck-replay-{receipt_state}-{source_tamper}"
    args = {
        "investigator": investigator_id,
        "source_roll_id": source_roll_id,
        "points": 1,
        "decision_id": decision_id,
    }
    ctx = coc_toolbox.Ctx(
        campaign_ws["workspace"], campaign_ws["campaign_id"]
    )

    if receipt_state == "completed":
        settled = _run(campaign_ws, "rules.luck_spend", args)
        assert settled["ok"] is True, settled
    else:
        document = coc_toolbox._load_roll_receipt_document(ctx)
        source_receipt = coc_toolbox._luck_source_receipt_by_roll_id(
            ctx, document, source_roll_id
        )
        luck_before = ctx.inv_state(investigator_id)["current_luck"]
        operation = {
            "investigator_id": investigator_id,
            "source_roll_id": source_roll_id,
            "points": 1,
        }
        data = coc_toolbox._luck_spend_data(
            source_receipt,
            points=1,
            luck_before=luck_before,
        )
        receipt = coc_toolbox._new_luck_spend_receipt(
            decision_id=decision_id,
            operation=operation,
            source_receipt=source_receipt,
            data=data,
        )
        document["luck_spends"][decision_id] = receipt
        coc_toolbox._validated_roll_document_collection(document)
        coc_toolbox._save_roll_receipt_document(ctx, document)

    rolls_path = campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl"
    rows = _read_jsonl(rolls_path)
    source_rows = [row for row in rows if row.get("roll_id") == source_roll_id]
    assert len(source_rows) == 1
    if source_tamper == "delete":
        rows = [row for row in rows if row.get("roll_id") != source_roll_id]
    else:
        source_row = next(row for row in rows if row.get("roll_id") == source_roll_id)
        source_row["payload"]["roll"] = 52
    rolls_path.write_text(
        "".join(
            json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n"
            for row in rows
        ),
        encoding="utf-8",
    )

    tracked_paths = (
        ctx.inv_state_path(investigator_id),
        campaign_ws["campaign_dir"] / "logs" / "events.jsonl",
        ctx._ledger_path(),
        coc_toolbox._roll_receipt_path(ctx),
        rolls_path,
    )
    before = {
        path: path.read_bytes() if path.is_file() else None
        for path in tracked_paths
    }

    replay = _run(campaign_ws, "rules.luck_spend", args)

    assert replay["ok"] is False, replay
    assert replay["error"]["code"] == "state_corrupt"
    assert {
        path: path.read_bytes() if path.is_file() else None
        for path in tracked_paths
    } == before


@pytest.mark.parametrize(
    ("difficulty", "seed", "original_roll", "adjusted_roll", "achieved"),
    [
        ("regular", 12, 61, 60, "regular"),
        ("hard", 3, 31, 30, "hard"),
        ("extreme", 164, 13, 12, "extreme"),
    ],
)
def test_rules_luck_spend_uses_bound_contextual_source_facts(
    campaign_ws, difficulty, seed, original_roll, adjusted_roll, achieved,
):
    source = _run(campaign_ws, "rules.roll", {
        "investigator": campaign_ws["investigator_id"],
        "skill": "Library Use",
        "target": 60,
        "difficulty": difficulty,
        "decision_id": f"luck-{difficulty}-source",
        "seed": seed,
    })
    assert source["ok"] is True
    assert source["data"]["roll"] == original_roll
    assert source["data"]["passed"] is False

    spent = _run(campaign_ws, "rules.luck_spend", {
        "investigator": campaign_ws["investigator_id"],
        "source_roll_id": source["data"]["roll_id"],
        "points": 1,
        "decision_id": f"luck-{difficulty}-spend",
    })

    assert spent["ok"] is True, spent
    assert spent["data"]["original_roll"] == original_roll
    assert spent["data"]["roll"] == spent["data"]["adjusted_roll"] == adjusted_roll
    assert spent["data"]["required_level"] == difficulty
    assert spent["data"]["achieved_level"] == achieved
    assert spent["data"]["passed"] is True
    assert spent["data"]["surplus_levels"] == 0


def test_rules_luck_spend_rejects_old_arguments_without_gameplay_writes(campaign_ws):
    ctx = coc_toolbox.Ctx(campaign_ws["workspace"], campaign_ws["campaign_id"])
    tracked = [
        ctx.inv_state_path(campaign_ws["investigator_id"]),
        coc_toolbox._roll_receipt_path(ctx),
        campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl",
        campaign_ws["campaign_dir"] / "logs" / "events.jsonl",
        ctx._ledger_path(),
    ]
    before = {path: path.read_bytes() if path.is_file() else None for path in tracked}

    with pytest.raises(coc_toolbox.ToolError, match="requires only source_roll_id"):
        coc_toolbox._tool_rules_luck_spend(ctx, {
            "investigator": campaign_ws["investigator_id"],
            "points": 1,
            "roll": 51,
            "target": 50,
            "outcome": "failure",
            "decision_id": "old-luck-shape",
        })

    assert {
        path: path.read_bytes() if path.is_file() else None for path in tracked
    } == before


def test_rules_luck_spend_rejects_already_adjusted_source_without_second_spend(
    campaign_ws,
):
    source = _run(campaign_ws, "rules.roll", {
        "investigator": campaign_ws["investigator_id"],
        "skill": "Library Use", "target": 50,
        "decision_id": "luck-single-owner-source", "seed": 88,
    })
    source_roll_id = source["data"]["roll_id"]
    first = _run(campaign_ws, "rules.luck_spend", {
        "investigator": campaign_ws["investigator_id"],
        "source_roll_id": source_roll_id, "points": 1,
        "decision_id": "luck-single-owner-first",
    })
    assert first["ok"] is True
    state_path = (
        campaign_ws["campaign_dir"] / "save" / "investigator-state"
        / f"{campaign_ws['investigator_id']}.json"
    )
    luck_after_first = json.loads(state_path.read_text())["current_luck"]
    roll_count = len(_read_jsonl(campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl"))

    second = _run(campaign_ws, "rules.luck_spend", {
        "investigator": campaign_ws["investigator_id"],
        "source_roll_id": source_roll_id, "points": 1,
        "decision_id": "luck-single-owner-second",
    })

    assert second["ok"] is False
    assert "already adjusted" in second["error"]["message"]
    assert json.loads(state_path.read_text())["current_luck"] == luck_after_first
    assert len(_read_jsonl(campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl")) == roll_count


def test_rules_luck_spend_rejects_foreign_ineligible_and_stale_sources(campaign_ws):
    foreign_id = _add_eleanor_to_party(campaign_ws)
    foreign = _run(campaign_ws, "rules.roll", {
        "investigator": foreign_id,
        "skill": "Library Use", "target": 50,
        "decision_id": "foreign-luck-source", "seed": 88,
    })
    rejected_foreign = _run(campaign_ws, "rules.luck_spend", {
        "investigator": campaign_ws["investigator_id"],
        "source_roll_id": foreign["data"]["roll_id"], "points": 1,
        "decision_id": "foreign-luck-spend",
    })
    assert rejected_foreign["ok"] is False
    assert "another investigator" in rejected_foreign["error"]["message"]

    successful = _run(campaign_ws, "rules.roll", {
        "investigator": campaign_ws["investigator_id"],
        "skill": "Library Use", "target": 99,
        "decision_id": "successful-luck-source", "seed": 1,
    })
    assert successful["data"]["passed"] is True
    rejected_success = _run(campaign_ws, "rules.luck_spend", {
        "investigator": campaign_ws["investigator_id"],
        "source_roll_id": successful["data"]["roll_id"], "points": 1,
        "decision_id": "successful-luck-spend",
    })
    assert rejected_success["ok"] is False
    assert "failed_roll" in rejected_success["error"]["message"]

    stale = _run(campaign_ws, "rules.roll", {
        "investigator": campaign_ws["investigator_id"],
        "skill": "Library Use", "target": 50,
        "decision_id": "stale-luck-source", "seed": 88,
    })
    rolls_path = campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl"
    rows = _read_jsonl(rolls_path)
    rows = [row for row in rows if row.get("roll_id") != stale["data"]["roll_id"]]
    rolls_path.write_text(
        "".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8"
    )
    rejected_stale = _run(campaign_ws, "rules.luck_spend", {
        "investigator": campaign_ws["investigator_id"],
        "source_roll_id": stale["data"]["roll_id"], "points": 1,
        "decision_id": "stale-luck-spend",
    })
    assert rejected_stale["ok"] is False
    assert rejected_stale["error"]["code"] == "state_corrupt"


def test_rules_luck_spend_rejects_hidden_or_tampered_source_receipt(campaign_ws):
    source = _run(campaign_ws, "rules.roll", {
        "investigator": campaign_ws["investigator_id"],
        "skill": "Library Use", "target": 50,
        "decision_id": "hidden-luck-source", "seed": 88,
    })
    assert source["ok"] is True
    ctx = coc_toolbox.Ctx(campaign_ws["workspace"], campaign_ws["campaign_id"])
    receipt_path = coc_toolbox._roll_receipt_path(ctx)
    document = json.loads(receipt_path.read_text())
    receipt = document["receipts"]["rules.roll"]["hidden-luck-source"]
    receipt["roll_record"]["visibility"] = "keeper_only"
    receipt[coc_toolbox._SOURCE_RECEIPT_INTEGRITY_KEY] = (
        coc_toolbox._source_receipt_integrity(receipt)
    )
    receipt_path.write_text(json.dumps(document), encoding="utf-8")
    state_path = ctx.inv_state_path(campaign_ws["investigator_id"])
    state_before = state_path.read_bytes()

    rejected = _run(campaign_ws, "rules.luck_spend", {
        "investigator": campaign_ws["investigator_id"],
        "source_roll_id": source["data"]["roll_id"], "points": 1,
        "decision_id": "hidden-luck-spend",
    })

    assert rejected["ok"] is False
    assert rejected["error"]["code"] == "state_corrupt"
    assert state_path.read_bytes() == state_before


# --------------------------------------------------------------------------- #
# state.* transactionality / idempotency / logging
# --------------------------------------------------------------------------- #


def test_state_record_clue_idempotent_on_decision_id(campaign_ws):
    clue_id = _first_clue_id(campaign_ws["campaign_dir"])
    decision_id = "toolbox-clue-once"
    args = {"clue_id": clue_id, "method": "test", "decision_id": decision_id}

    first = _run(campaign_ws, "state.record_clue", args)
    second = _run(campaign_ws, "state.record_clue", args)

    assert first["ok"] is True
    assert second["ok"] is True
    assert first["data"]["clue_id"] == clue_id
    assert first["data"]["already_discovered"] is False
    assert second["data"] == first["data"]
    assert any("duplicate decision_id" in w for w in second["warnings"])

    world = json.loads(
        (campaign_ws["campaign_dir"] / "save" / "world-state.json").read_text(
            encoding="utf-8"
        )
    )
    assert clue_id in world.get("discovered_clue_ids", [])
    # Exactly one discovery event despite two calls.
    events = _read_jsonl(campaign_ws["campaign_dir"] / "logs" / "events.jsonl")
    discoveries = [
        e for e in events
        if e.get("event_type") == "clue_discovered" and e.get("clue_id") == clue_id
    ]
    assert len(discoveries) == 1


def test_pending_journal_rejects_later_state_mutation_before_it_writes(campaign_ws):
    journal_args = {
        "summary": "本轮到此结算。",
        "player_action": "结束本轮",
        "intent_class": "investigate",
        "decision_id": "journal-before-illegal-move",
    }
    journaled = _run(campaign_ws, "state.journal", journal_args)
    assert journaled["ok"] is True
    before = json.loads(
        (campaign_ws["campaign_dir"] / "save" / "world-state.json").read_text(
            encoding="utf-8"
        )
    )

    rejected = _run(campaign_ws, "state.move_scene", {
        "scene_id": "post-journal-place",
        "decision_id": "illegal-post-journal-move",
    })
    duplicate = _run(campaign_ws, "state.journal", journal_args)

    assert rejected["ok"] is False
    assert rejected["error"]["code"] == "turn_pending_finalization"
    assert duplicate["ok"] is True
    after = json.loads(
        (campaign_ws["campaign_dir"] / "save" / "world-state.json").read_text(
            encoding="utf-8"
        )
    )
    assert after == before


def test_pending_journal_allows_scene_context_before_finalization(campaign_ws):
    journaled = _run(campaign_ws, "state.journal", {
        "summary": "本轮状态已经结算，KP 随后读取场景投影用于组织输出。",
        "player_action": "结束本轮",
        "intent_class": "investigate",
        "decision_id": "journal-before-scene-context",
    })
    assert journaled["ok"] is True

    context = _run(campaign_ws, "scene.context")
    assert context["ok"] is True

    finalized = _finalize_pending_turn_for_test(
        campaign_ws,
        decision_id="finalize-after-scene-context",
    )
    assert finalized["data"]["rendered_text"]


def test_same_decision_id_is_scoped_by_tool_name(campaign_ws):
    decision_id = "shared-across-tools"
    moved = _run(
        campaign_ws,
        "state.move_scene",
        {"scene_id": "improvised-place", "decision_id": decision_id},
    )
    clue_id = _first_clue_id(campaign_ws["campaign_dir"])
    recorded = _run(
        campaign_ws,
        "state.record_clue",
        {"clue_id": clue_id, "method": "test", "decision_id": decision_id},
    )
    marker = _run(
        campaign_ws,
        "state.time_marker",
        {
            "action": "set",
            "marker_id": "shared-decision-marker",
            "minutes_from_now": 5,
            "decision_id": decision_id,
        },
    )
    repeated = _run(
        campaign_ws,
        "state.record_clue",
        {"clue_id": clue_id, "method": "test", "decision_id": decision_id},
    )
    assert moved["ok"] and recorded["ok"] and marker["ok"] and repeated["ok"]
    assert recorded["data"]["clue_id"] == clue_id
    assert "to_scene_id" not in recorded["data"]
    assert marker["data"]["marker"]["marker_id"] == "shared-decision-marker"
    assert repeated["data"] == recorded["data"]
    ledger = json.loads(
        (campaign_ws["campaign_dir"] / "save" / "toolbox-ledger.json").read_text(
            encoding="utf-8"
        )
    )
    scoped = [
        entry
        for entry in ledger["entries"].values()
        if isinstance(entry, dict) and entry.get("decision_id") == decision_id
    ]
    assert {entry["tool"] for entry in scoped} == {
        "state.move_scene",
        "state.record_clue",
        "state.time_marker",
    }


@pytest.mark.parametrize("shared_decision_id", [True, False])
def test_concurrent_cli_transactions_preserve_ledger_state_and_events(
    campaign_ws,
    tmp_path: Path,
    shared_decision_id: bool,
):
    case = "same-id" if shared_decision_id else "different-ids"
    scene_id = f"concurrent-{case}-scene"
    flag_id = f"concurrent-{case}-flag"
    move_decision = f"concurrent-{case}"
    flag_decision = move_decision if shared_decision_id else f"{move_decision}-flag"
    outputs = _run_concurrent_cli(
        campaign_ws,
        [
            (
                "state.move_scene",
                {"scene_id": scene_id, "decision_id": move_decision},
            ),
            (
                "state.set_flag",
                {"flag_id": flag_id, "value": True, "decision_id": flag_decision},
            ),
        ],
        barrier_dir=tmp_path / f"barrier-{case}",
    )
    assert all(output["ok"] is True for output in outputs)

    campaign_dir = campaign_ws["campaign_dir"]
    ledger = json.loads(
        (campaign_dir / "save" / "toolbox-ledger.json").read_text(encoding="utf-8")
    )
    entries = ledger["entries"]
    assert coc_toolbox.Ctx._ledger_key("state.move_scene", move_decision) in entries
    assert coc_toolbox.Ctx._ledger_key("state.set_flag", flag_decision) in entries

    world = json.loads(
        (campaign_dir / "save" / "world-state.json").read_text(encoding="utf-8")
    )
    flags = json.loads(
        (campaign_dir / "save" / "flags.json").read_text(encoding="utf-8")
    )
    assert world["active_scene_id"] == scene_id
    assert flags["flags"][flag_id] is True

    relevant_events = [
        row
        for row in _read_jsonl(campaign_dir / "logs" / "events.jsonl")
        if (
            row.get("event_type") == "scene_transition"
            and row.get("to_scene_id") == scene_id
        ) or (
            row.get("event_type") == "flag_set"
            and row.get("flag_id") == flag_id
        )
    ]
    assert len(relevant_events) == 2
    event_tools = [
        "state.move_scene"
        if row["event_type"] == "scene_transition"
        else "state.set_flag"
        for row in relevant_events
    ]
    relevant_calls = [
        row
        for row in _read_jsonl(campaign_dir / "logs" / "toolbox-calls.jsonl")
        if row.get("tool") in {"state.move_scene", "state.set_flag"}
        and (row.get("args") or {}).get("decision_id") in {move_decision, flag_decision}
    ]
    assert len(relevant_calls) == 2
    assert [row["tool"] for row in relevant_calls] == event_tools


def test_legacy_ledger_entry_matches_only_its_original_tool(campaign_ws):
    ledger_path = campaign_ws["campaign_dir"] / "save" / "toolbox-ledger.json"
    _write_json(
        ledger_path,
        {
            "schema_version": 1,
            "entries": {
                "legacy-id": {
                    "tool": "state.set_flag",
                    "ts": "2026-01-01T00:00:00Z",
                    "data": {"flag_id": "legacy", "value": True, "newly_unlocked_scenes": []},
                }
            },
        },
    )
    same_tool = _run(
        campaign_ws,
        "state.set_flag",
        {"flag_id": "should-not-write", "decision_id": "legacy-id"},
    )
    npc_id = _first_npc_id(campaign_ws["campaign_dir"])
    other_tool = _run(
        campaign_ws,
        "state.npc_update",
        {"npc_id": npc_id, "trust_delta": 1, "decision_id": "legacy-id"},
    )
    assert same_tool["ok"] is False
    assert same_tool["error"]["code"] == "state_corrupt"
    assert "should-not-write" not in coc_toolbox.Ctx(
        campaign_ws["workspace"], campaign_ws["campaign_id"]
    ).flags().get("flags", {})
    assert other_tool["ok"] is False
    assert other_tool["error"]["code"] == "state_corrupt"


def test_state_flag_and_npc_updates_are_idempotent(campaign_ws):
    flag_args = {"flag_id": "one-shot", "value": True, "decision_id": "flag-once"}
    first_flag = _run(campaign_ws, "state.set_flag", flag_args)
    second_flag = _run(campaign_ws, "state.set_flag", flag_args)
    assert first_flag["ok"] and second_flag["ok"]
    assert second_flag["data"] == first_flag["data"]
    flag_events = [
        row
        for row in _read_jsonl(campaign_ws["campaign_dir"] / "logs" / "events.jsonl")
        if row.get("event_type") == "flag_set" and row.get("flag_id") == "one-shot"
    ]
    assert len(flag_events) == 1

    npc_id = _first_npc_id(campaign_ws["campaign_dir"])
    npc_args = {"npc_id": npc_id, "trust_delta": 1, "decision_id": "npc-once"}
    first_npc = _run(campaign_ws, "state.npc_update", npc_args)
    second_npc = _run(campaign_ws, "state.npc_update", npc_args)
    assert first_npc["ok"] and second_npc["ok"]
    assert second_npc["data"] == first_npc["data"]
    assert first_npc["data"]["psych"]["trust"] == 1
    npc_events = [
        row
        for row in _read_jsonl(campaign_ws["campaign_dir"] / "logs" / "events.jsonl")
        if row.get("event_type") == "npc_update" and row.get("npc_id") == npc_id
    ]
    assert len(npc_events) == 1


def test_npc_update_can_resolve_an_existing_promise(campaign_ws):
    npc_id = _first_npc_id(campaign_ws["campaign_dir"])
    made = _run(campaign_ws, "state.npc_update", {
        "npc_id": npc_id,
        "record_promise": "promise-shelter-until-dawn",
        "decision_id": "npc-promise-made",
    })
    assert made["ok"] is True, made

    resolution_args = {
        "npc_id": npc_id,
        "resolve_promise": {
            "promise_id": "promise-shelter-until-dawn",
            "kept": True,
        },
        "decision_id": "npc-promise-kept",
    }
    resolved = _run(campaign_ws, "state.npc_update", resolution_args)
    duplicate = _run(campaign_ws, "state.npc_update", resolution_args)
    assert resolved["ok"] is True, resolved
    assert duplicate["data"] == resolved["data"]
    assert resolved["data"]["applied"]["resolved_promise"] == {
        "promise_id": "promise-shelter-until-dawn",
        "kept": True,
    }
    assert resolved["data"]["psych"]["promises"] == [
        {"promise_id": "promise-shelter-until-dawn", "kept": True}
    ]


def test_npc_update_invalid_availability_has_no_partial_state_mutation(campaign_ws):
    npc_id = _first_npc_id(campaign_ws["campaign_dir"])
    decision_id = "npc-atomic-invalid-then-valid"
    before = coc_toolbox.coc_npc_state.get_npc_entry(
        campaign_ws["campaign_dir"], npc_id
    )

    invalid = _run(campaign_ws, "state.npc_update", {
        "npc_id": npc_id,
        "trust_delta": -1,
        "suspicion_delta": 2,
        "availability": "permission_required",
        "decision_id": decision_id,
    })

    assert invalid["ok"] is False
    assert invalid["error"]["code"] == "invalid_request"
    assert coc_toolbox.coc_npc_state.get_npc_entry(
        campaign_ws["campaign_dir"], npc_id
    ) == before

    valid_args = {
        "npc_id": npc_id,
        "trust_delta": -1,
        "suspicion_delta": 2,
        "availability": "unavailable",
        "decision_id": decision_id,
    }
    first = _run(campaign_ws, "state.npc_update", valid_args)
    duplicate = _run(campaign_ws, "state.npc_update", valid_args)

    assert first["ok"] is True
    assert duplicate["ok"] is True
    assert duplicate["data"] == first["data"]
    assert first["data"]["psych"]["trust"] == before["trust"] - 1
    assert first["data"]["psych"]["suspicion"] == before["suspicion"] + 2
    assert first["data"]["psych"]["availability"] == {"status": "unavailable"}
    assert coc_toolbox.coc_npc_state.get_npc_entry(
        campaign_ws["campaign_dir"], npc_id
    ) == first["data"]["psych"]


def test_npc_update_persists_pair_impression_and_npc_query_projects_it(campaign_ws):
    npc_id = _first_npc_id(campaign_ws["campaign_dir"])
    investigator_id = campaign_ws["investigator_id"]
    args = {
        "npc_id": npc_id,
        "investigator": investigator_id,
        "impression_update": {
            "summary": "他认为托马斯谨慎且值得继续合作。",
            "expectations": ["下次会先说明证据责任。"],
            "reservations": ["仍担心他会独自承担危险。"],
            "memory": {
                "memory_id": "meaningful-action-1",
                "event": "托马斯在证据不足时承认不知道。",
                "interpretation": "他不会为了推进案件编造确定性。",
                "reason": "observed_behavior",
            },
            "reason": "npc_changed_its_view",
        },
        "decision_id": "npc-impression-once",
    }
    first = _run(campaign_ws, "state.npc_update", args)
    duplicate = _run(campaign_ws, "state.npc_update", args)
    assert first["ok"] and duplicate["ok"]
    assert duplicate["data"] == first["data"]
    projected = _run(campaign_ws, "npc.query", {
        "npc_id": npc_id,
        "investigator": investigator_id,
    })
    assert projected["ok"]
    row = projected["data"]["npcs"][0]
    assert row["psych"]["impression"]["summary"].startswith("他认为托马斯")
    assert len(row["psych"]["impression"]["memories"]) == 1


def test_scene_context_projects_pair_impression_for_single_party_member(campaign_ws):
    npc_id = _first_npc_id(campaign_ws["campaign_dir"])
    investigator_id = campaign_ws["investigator_id"]
    updated = _run(campaign_ws, "state.npc_update", {
        "npc_id": npc_id,
        "investigator": investigator_id,
        "impression_update": {
            "expectations": ["下次先说明证据责任。"],
            "reason": "observed_behavior",
        },
        "decision_id": "scene-context-impression",
    })
    assert updated["ok"]
    context = _run(campaign_ws, "scene.context")
    assert context["ok"]
    row = next(item for item in context["data"]["npcs_present"] if item["npc_id"] == npc_id)
    assert row["impression"]["expectations"] == ["下次先说明证据责任。"]
    explicit = _run(campaign_ws, "scene.context", {"investigator": investigator_id})
    assert explicit["data"]["npcs_present"]


def test_scene_context_projects_live_flag_truth_over_stale_authored_description(
    campaign_ws,
):
    campaign_dir = campaign_ws["campaign_dir"]
    story_path = campaign_dir / "scenario" / "story-graph.json"
    story = json.loads(story_path.read_text(encoding="utf-8"))
    world = json.loads(
        (campaign_dir / "save" / "world-state.json").read_text(encoding="utf-8")
    )
    active_scene = next(
        scene
        for scene in story["scenes"]
        if scene.get("scene_id") == world.get("active_scene_id")
    )
    active_scene["pressure_moves"] = ["The side door is still locked (initial description)."]
    _write_json(story_path, story)
    republished = coc_toolbox.coc_compiled_archive.publish_from_campaign(
        campaign_dir
    )
    assert republished["ok"] is True

    flag = _run(
        campaign_ws,
        "state.set_flag",
        {
            "flag_id": "corbitt-house-side-door-unlatched",
            "value": True,
            "reason": "Hayes opened every inside lock and left the door ajar",
            "decision_id": "side-door-unlatched-once",
        },
    )
    assert flag["ok"] is True

    context = _run(campaign_ws, "scene.context")
    assert context["ok"] is True
    assert "still locked" in context["data"]["scene"]["pressure_moves"][0]
    continuity = context["data"]["continuity"]
    assert continuity["keeper_only"] is True
    assert continuity["state_precedence"] == "live_over_authored_initial"
    live = {
        row["flag_id"]: row for row in continuity["live_world_flags"]
    }
    side_door = live["corbitt-house-side-door-unlatched"]
    assert side_door["value"] is True
    assert side_door["provenance"]["decision_id"] == "side-door-unlatched-once"
    assert side_door["provenance"]["reason"].startswith("Hayes opened")
    assert continuity["recent_world_flag_changes"][-1]["flag_id"] == (
        "corbitt-house-side-door-unlatched"
    )
    assert any("live_world_flags" in hint for hint in context["hints"])


def test_time_marker_set_reset_clear_and_advance_projection_are_idempotent(
    campaign_ws,
):
    campaign_dir = campaign_ws["campaign_dir"]
    time_path = campaign_dir / "save" / "time-state.json"
    time_state = json.loads(time_path.read_text(encoding="utf-8"))
    time_state["clock"].update(
        {
            "elapsed_minutes": 93,
            "calendar_mode": "gregorian",
            "local_datetime": "1920-10-15T11:33:00",
            "display": "1920-10-15 11:33",
        }
    )
    _write_json(time_path, time_state)

    set_args = {
        "action": "set",
        "marker_id": "police-check-in",
        "minutes_from_now": 10,
        "label": "Police check-in",
        "reason": "Police enter if Hayes misses the report",
        "decision_id": "police-check-in-set-1",
    }
    first = _run(campaign_ws, "state.time_marker", set_args)
    replay = _run(campaign_ws, "state.time_marker", set_args)
    assert first["ok"] is True
    assert replay["data"] == first["data"]
    assert any("duplicate decision_id" in warning for warning in replay["warnings"])
    marker = first["data"]["marker"]
    assert marker["due_at"]["display"] == "1920-10-15 11:43"
    assert marker["remaining_minutes"] == 10
    assert marker["timing_state"] == "pending"

    advanced = _run(
        campaign_ws,
        "state.advance_time",
        {
            "minutes": 6,
            "reason": "Hayes searches the first basement platform",
            "decision_id": "advance-to-1139",
        },
    )
    assert advanced["ok"] is True
    assert advanced["data"]["current_time"]["display"] == "1920-10-15 11:39"
    active = advanced["data"]["active_time_markers"]
    assert len(active) == 1
    assert active[0]["due_at"]["display"] == "1920-10-15 11:43"
    assert active[0]["remaining_minutes"] == 4
    assert active[0]["overdue"] is False

    context = _run(campaign_ws, "scene.context")
    assert context["data"]["continuity"]["active_time_markers"] == active

    reset = _run(
        campaign_ws,
        "state.time_marker",
        {
            "action": "reset",
            "marker_id": "police-check-in",
            "minutes_from_now": 10,
            "reason": "Hayes reported and renewed the ten-minute agreement",
            "decision_id": "police-check-in-reset-1",
        },
    )
    assert reset["ok"] is True
    assert reset["data"]["marker"]["due_at"]["display"] == "1920-10-15 11:49"
    assert reset["data"]["marker"]["revision"] == 2

    trigger_path = campaign_dir / "save" / "time-triggers.json"
    triggers_before = json.loads(trigger_path.read_text(encoding="utf-8"))
    scene_before = json.loads(
        (campaign_dir / "save" / "world-state.json").read_text(encoding="utf-8")
    )["active_scene_id"]
    overdue = _run(
        campaign_ws,
        "state.advance_time",
        {
            "minutes": 11,
            "reason": "Hayes remains underground past the renewed check-in",
            "decision_id": "advance-past-1149",
        },
    )
    assert overdue["ok"] is True
    overdue_marker = overdue["data"]["active_time_markers"][0]
    assert overdue_marker["remaining_minutes"] == -1
    assert overdue_marker["overdue"] is True
    assert overdue_marker["timing_state"] == "overdue"
    assert json.loads(trigger_path.read_text(encoding="utf-8")) == triggers_before
    assert json.loads(
        (campaign_dir / "save" / "world-state.json").read_text(encoding="utf-8")
    )["active_scene_id"] == scene_before
    assert not any(
        row.get("event_type") == "trigger_fired"
        and row.get("trigger_id") == "police-check-in"
        for row in _read_jsonl(campaign_dir / "logs" / "time.jsonl")
    )

    cleared = _run(
        campaign_ws,
        "state.time_marker",
        {
            "action": "clear",
            "marker_id": "police-check-in",
            "reason": "Hayes returned to the officers",
            "decision_id": "police-check-in-clear-1",
        },
    )
    assert cleared["ok"] is True
    assert cleared["data"]["marker"]["status"] == "cleared"
    assert cleared["data"]["active_time_markers"] == []
    assert _run(campaign_ws, "scene.context")["data"]["continuity"][
        "active_time_markers"
    ] == []

    marker_events = [
        row
        for row in _read_jsonl(campaign_dir / "logs" / "events.jsonl")
        if row.get("event_type") == "time_marker_changed"
        and row.get("marker_id") == "police-check-in"
    ]
    assert [row["action"] for row in marker_events] == ["set", "reset", "clear"]


@pytest.mark.parametrize(
    "crash_stage", ["after_source", "after_event", "before_ledger"]
)
def test_time_marker_source_receipt_recovers_every_crash_window_without_drift(
    campaign_ws,
    monkeypatch,
    crash_stage,
):
    campaign_dir = campaign_ws["campaign_dir"]
    time_path = campaign_dir / "save" / "time-state.json"
    time_state = json.loads(time_path.read_text(encoding="utf-8"))
    time_state["clock"].update(
        {
            "elapsed_minutes": 93,
            "calendar_mode": "gregorian",
            "local_datetime": "1920-10-15T11:33:00",
            "display": "1920-10-15 11:33",
        }
    )
    _write_json(time_path, time_state)
    decision_id = f"marker-crash-{crash_stage}"
    args = {
        "action": "set",
        "marker_id": f"police-check-in-{crash_stage}",
        "minutes_from_now": 10,
        "label": "Police check-in",
        "reason": "SENTINEL_ORIGINAL_MARKER_REASON",
        "decision_id": decision_id,
    }
    real_log_event = coc_toolbox.Ctx.log_event
    real_ledger_record = coc_toolbox.Ctx.ledger_record

    def crash_log_event(self, record):
        if record.get("event_type") != "time_marker_changed":
            return real_log_event(self, record)
        if crash_stage == "after_source":
            raise RuntimeError("synthetic crash after marker source write")
        real_log_event(self, record)
        if crash_stage == "after_event":
            raise RuntimeError("synthetic crash after marker event append")

    def crash_ledger_record(
        self, current_decision_id, tool_name, data, **kwargs
    ):
        if tool_name == "state.time_marker" and crash_stage == "before_ledger":
            raise RuntimeError("synthetic crash before marker ledger write")
        return real_ledger_record(
            self, current_decision_id, tool_name, data, **kwargs
        )

    with monkeypatch.context() as crash:
        crash.setattr(coc_toolbox.Ctx, "log_event", crash_log_event)
        crash.setattr(coc_toolbox.Ctx, "ledger_record", crash_ledger_record)
        with pytest.raises(RuntimeError, match="synthetic crash"):
            _run(campaign_ws, "state.time_marker", args)

    marker_doc = json.loads(
        (campaign_dir / "save" / "time-markers.json").read_text(encoding="utf-8")
    )
    receipt = marker_doc["operation_receipts"]["state.time_marker"][decision_id]
    original_data = receipt["data"]
    assert original_data["marker"]["revision"] == 1
    assert original_data["marker"]["due_at"]["display"] == "1920-10-15 11:43"

    advanced = _run(
        campaign_ws,
        "state.advance_time",
        {
            "minutes": 5,
            "reason": "legitimate work after the crashed marker call",
            "decision_id": f"advance-after-{crash_stage}",
        },
    )
    assert advanced["data"]["current_time"]["display"] == "1920-10-15 11:38"

    replay = _run(campaign_ws, "state.time_marker", args)
    assert replay["ok"] is True
    assert replay["data"] == original_data
    assert replay["data"]["marker"]["revision"] == 1
    assert replay["data"]["marker"]["due_at"]["display"] == "1920-10-15 11:43"
    assert any("source-of-truth receipt" in warning for warning in replay["warnings"])

    live_marker = _run(campaign_ws, "scene.context")["data"]["continuity"][
        "active_time_markers"
    ][0]
    assert live_marker["revision"] == 1
    assert live_marker["due_at"]["display"] == "1920-10-15 11:43"
    assert live_marker["remaining_minutes"] == 5
    events = [
        row
        for row in _read_jsonl(campaign_dir / "logs" / "events.jsonl")
        if row.get("event_id") == receipt["event_id"]
    ]
    assert len(events) == 1
    ledger_path = campaign_dir / "save" / "toolbox-ledger.json"
    ledger_after_repair = ledger_path.read_bytes()
    assert _run(campaign_ws, "state.time_marker", args)["data"] == original_data
    assert ledger_path.read_bytes() == ledger_after_repair
    assert len([
        row
        for row in _read_jsonl(campaign_dir / "logs" / "events.jsonl")
        if row.get("event_id") == receipt["event_id"]
    ]) == 1

    conflict = _run(
        campaign_ws,
        "state.time_marker",
        {**args, "minutes_from_now": 11},
    )
    assert conflict["ok"] is False
    assert conflict["error"]["code"] == "idempotency_conflict"


@pytest.mark.parametrize(
    "crash_stage", ["after_source", "after_event", "before_ledger"]
)
def test_set_flag_source_receipt_preserves_original_provenance_and_unlock_once(
    campaign_ws,
    monkeypatch,
    crash_stage,
):
    campaign_dir = campaign_ws["campaign_dir"]
    story_path = campaign_dir / "scenario" / "story-graph.json"
    story = json.loads(story_path.read_text(encoding="utf-8"))
    source_scene = story["scenes"][0]
    source_scene.setdefault("scene_edges", []).append(
        {
            "to": "receipt-unlock-scene",
            "kind": "unlock",
            "when": {"kind": "flag_set", "flag_id": "receipt-unlock-flag"},
        }
    )
    story["scenes"].append(
        {
            "scene_id": "receipt-unlock-scene",
            "scene_type": "investigation",
            "dramatic_question": "Can the receipt repair this unlock?",
        }
    )
    _write_json(story_path, story)

    decision_id = f"flag-crash-{crash_stage}"
    args = {
        "flag_id": "receipt-unlock-flag",
        "value": True,
        "reason": "SENTINEL_ORIGINAL_FLAG_REASON",
        "decision_id": decision_id,
    }
    real_save_world = coc_toolbox.Ctx.save_world
    real_log_event = coc_toolbox.Ctx.log_event
    real_ledger_record = coc_toolbox.Ctx.ledger_record

    def crash_save_world(self, world):
        if crash_stage == "after_source" and "receipt-unlock-scene" in (
            world.get("unlocked_scene_ids") or []
        ):
            raise RuntimeError("synthetic crash after flag source write")
        return real_save_world(self, world)

    def crash_log_event(self, record):
        if record.get("event_type") != "flag_set":
            return real_log_event(self, record)
        real_log_event(self, record)
        if crash_stage == "after_event":
            raise RuntimeError("synthetic crash after flag event append")

    def crash_ledger_record(
        self, current_decision_id, tool_name, data, **kwargs
    ):
        if tool_name == "state.set_flag" and crash_stage == "before_ledger":
            raise RuntimeError("synthetic crash before flag ledger write")
        return real_ledger_record(
            self, current_decision_id, tool_name, data, **kwargs
        )

    with monkeypatch.context() as crash:
        crash.setattr(coc_toolbox.Ctx, "save_world", crash_save_world)
        crash.setattr(coc_toolbox.Ctx, "log_event", crash_log_event)
        crash.setattr(coc_toolbox.Ctx, "ledger_record", crash_ledger_record)
        with pytest.raises(RuntimeError, match="synthetic crash"):
            _run(campaign_ws, "state.set_flag", args)

    flags_after_crash = json.loads(
        (campaign_dir / "save" / "flags.json").read_text(encoding="utf-8")
    )
    receipt = flags_after_crash["operation_receipts"]["state.set_flag"][
        decision_id
    ]
    original_data = receipt["data"]
    original_provenance = original_data["provenance"]
    assert original_provenance["previous_value"] is None
    assert original_provenance["reason"] == "SENTINEL_ORIGINAL_FLAG_REASON"

    later = _run(
        campaign_ws,
        "state.set_flag",
        {
            "flag_id": "receipt-unlock-flag",
            "value": False,
            "reason": "legitimate later flag transition",
            "decision_id": f"flag-later-{crash_stage}",
        },
    )
    assert later["ok"] is True
    replay = _run(campaign_ws, "state.set_flag", args)
    assert replay["ok"] is True
    assert replay["data"] == original_data
    assert replay["data"]["provenance"] == original_provenance

    current_flags = json.loads(
        (campaign_dir / "save" / "flags.json").read_text(encoding="utf-8")
    )
    assert current_flags["flags"]["receipt-unlock-flag"] is False
    assert current_flags["flag_provenance"]["receipt-unlock-flag"]["reason"] == (
        "legitimate later flag transition"
    )
    continuity = _run(campaign_ws, "scene.context")["data"]["continuity"]
    ordered_changes = [
        row
        for row in continuity["recent_world_flag_changes"]
        if row["flag_id"] == "receipt-unlock-flag"
    ]
    assert [row["value"] for row in ordered_changes] == [True, False]
    assert [
        row["provenance"]["reason"] for row in ordered_changes
    ] == [
        "SENTINEL_ORIGINAL_FLAG_REASON",
        "legitimate later flag transition",
    ]
    assert [
        row["provenance"]["source_sequence"] for row in ordered_changes
    ] == sorted(
        row["provenance"]["source_sequence"] for row in ordered_changes
    )
    world = json.loads(
        (campaign_dir / "save" / "world-state.json").read_text(encoding="utf-8")
    )
    assert world["unlocked_scene_ids"].count("receipt-unlock-scene") == 1
    original_events = [
        row
        for row in _read_jsonl(campaign_dir / "logs" / "events.jsonl")
        if row.get("event_id") == receipt["event_id"]
    ]
    assert len(original_events) == 1
    assert original_events[0]["previous_value"] is None
    assert original_events[0]["reason"] == "SENTINEL_ORIGINAL_FLAG_REASON"
    assert original_events[0]["ts"] == original_provenance["changed_at"]
    ledger_path = campaign_dir / "save" / "toolbox-ledger.json"
    ledger_after_repair = ledger_path.read_bytes()
    assert _run(campaign_ws, "state.set_flag", args)["data"] == original_data
    assert ledger_path.read_bytes() == ledger_after_repair
    assert len([
        row
        for row in _read_jsonl(campaign_dir / "logs" / "events.jsonl")
        if row.get("event_id") == receipt["event_id"]
    ]) == 1

    conflict = _run(
        campaign_ws,
        "state.set_flag",
        {**args, "value": False},
    )
    assert conflict["ok"] is False
    assert conflict["error"]["code"] == "idempotency_conflict"


def test_source_receipt_repairs_secondary_ledger_but_rejects_corrupt_source_or_event(
    campaign_ws,
):
    campaign_dir = campaign_ws["campaign_dir"]
    args = {
        "action": "set",
        "marker_id": "receipt-integrity-probe",
        "minutes_from_now": 7,
        "reason": "integrity probe",
        "decision_id": "receipt-integrity-decision",
    }
    settled = _run(campaign_ws, "state.time_marker", args)
    assert settled["ok"] is True
    original_data = settled["data"]
    marker_path = campaign_dir / "save" / "time-markers.json"
    ledger_path = campaign_dir / "save" / "toolbox-ledger.json"
    events_path = campaign_dir / "logs" / "events.jsonl"
    marker_doc = json.loads(marker_path.read_text(encoding="utf-8"))
    receipt = marker_doc["operation_receipts"]["state.time_marker"][
        args["decision_id"]
    ]

    ledger = json.loads(ledger_path.read_text(encoding="utf-8"))
    ledger_key = coc_toolbox.Ctx._ledger_key(
        "state.time_marker", args["decision_id"]
    )
    ledger["entries"][ledger_key]["data"] = {"corrupt": True}
    _write_json(ledger_path, ledger)
    repaired = _run(campaign_ws, "state.time_marker", args)
    assert repaired["ok"] is True
    assert repaired["data"] == original_data
    repaired_ledger = json.loads(ledger_path.read_text(encoding="utf-8"))
    assert repaired_ledger["entries"][ledger_key]["data"] == original_data

    original_events = _read_jsonl(events_path)
    corrupt_events = [dict(row) for row in original_events]
    target = next(
        row for row in corrupt_events if row.get("event_id") == receipt["event_id"]
    )
    target["reason"] = "corrupt event payload"
    write_text = "\n".join(
        json.dumps(row, ensure_ascii=False) for row in corrupt_events
    ) + "\n"
    events_path.write_text(write_text, encoding="utf-8")
    event_conflict = _run(campaign_ws, "state.time_marker", args)
    assert event_conflict["ok"] is False
    assert event_conflict["error"]["code"] == "state_corrupt"
    assert len([
        row for row in _read_jsonl(events_path)
        if row.get("event_id") == receipt["event_id"]
    ]) == 1

    events_path.write_text(
        "\n".join(json.dumps(row, ensure_ascii=False) for row in original_events)
        + "\n",
        encoding="utf-8",
    )
    marker_doc["operation_receipts"]["state.time_marker"][
        args["decision_id"]
    ]["fingerprint"] = "sha256:corrupt"
    _write_json(marker_path, marker_doc)
    source_conflict = _run(campaign_ws, "state.time_marker", args)
    assert source_conflict["ok"] is False
    assert source_conflict["error"]["code"] == "state_corrupt"


def test_time_marker_receipt_integrity_binds_frozen_result_before_replay_mutation(
    campaign_ws,
):
    campaign_dir = campaign_ws["campaign_dir"]
    args = {
        "action": "set",
        "marker_id": "integrity-body-marker",
        "minutes_from_now": 9,
        "reason": "receipt body integrity",
        "decision_id": "integrity-body-marker-decision",
    }
    assert _run(campaign_ws, "state.time_marker", args)["ok"] is True
    marker_path = campaign_dir / "save" / "time-markers.json"
    ledger_path = campaign_dir / "save" / "toolbox-ledger.json"
    events_path = campaign_dir / "logs" / "events.jsonl"
    marker_doc = json.loads(marker_path.read_text(encoding="utf-8"))
    receipt = marker_doc["operation_receipts"]["state.time_marker"][
        args["decision_id"]
    ]
    assert receipt["schema_version"] == 3
    assert receipt["integrity_digest"].startswith("sha256:")
    receipt["data"]["marker"]["due_at"]["display"] = "CORRUPTED-DUE"
    _write_json(marker_path, marker_doc)
    ledger_before = ledger_path.read_bytes()
    events_before = events_path.read_bytes()

    replay = _run(campaign_ws, "state.time_marker", args)

    assert replay["ok"] is False
    assert replay["error"]["code"] == "state_corrupt"
    assert ledger_path.read_bytes() == ledger_before
    assert events_path.read_bytes() == events_before


def test_flag_receipt_integrity_rejects_forged_unlock_before_world_mutation(
    campaign_ws,
):
    campaign_dir = campaign_ws["campaign_dir"]
    args = {
        "flag_id": "integrity-body-flag",
        "value": True,
        "reason": "receipt body integrity",
        "decision_id": "integrity-body-flag-decision",
    }
    assert _run(campaign_ws, "state.set_flag", args)["ok"] is True
    flags_path = campaign_dir / "save" / "flags.json"
    world_path = campaign_dir / "save" / "world-state.json"
    ledger_path = campaign_dir / "save" / "toolbox-ledger.json"
    events_path = campaign_dir / "logs" / "events.jsonl"
    flags_doc = json.loads(flags_path.read_text(encoding="utf-8"))
    receipt = flags_doc["operation_receipts"]["state.set_flag"][
        args["decision_id"]
    ]
    receipt["data"]["newly_unlocked_scenes"] = ["forged-final-scene"]
    _write_json(flags_path, flags_doc)
    world_before = world_path.read_bytes()
    ledger_before = ledger_path.read_bytes()
    events_before = events_path.read_bytes()

    replay = _run(campaign_ws, "state.set_flag", args)

    assert replay["ok"] is False
    assert replay["error"]["code"] == "state_corrupt"
    assert world_path.read_bytes() == world_before
    assert ledger_path.read_bytes() == ledger_before
    assert events_path.read_bytes() == events_before
    assert "forged-final-scene" not in json.loads(
        world_path.read_text(encoding="utf-8")
    ).get("unlocked_scene_ids", [])


@pytest.mark.parametrize(
    ("tool_name", "source_name", "args"),
    [
        (
            "state.time_marker",
            "time-markers.json",
            {
                "action": "set",
                "marker_id": "corrupt-source-marker",
                "minutes_from_now": 4,
                "decision_id": "corrupt-source-marker-decision",
            },
        ),
        (
            "state.set_flag",
            "flags.json",
            {
                "flag_id": "corrupt-source-flag",
                "value": True,
                "decision_id": "corrupt-source-flag-decision",
            },
        ),
    ],
)
def test_receipt_source_corruption_never_downgrades_to_legacy_or_overwrites(
    campaign_ws,
    tool_name,
    source_name,
    args,
):
    campaign_dir = campaign_ws["campaign_dir"]
    assert _run(campaign_ws, tool_name, args)["ok"] is True
    source_path = campaign_dir / "save" / source_name
    source_path.write_text("{malformed-json", encoding="utf-8")
    corrupt_bytes = source_path.read_bytes()

    replay = _run(campaign_ws, tool_name, args)
    new_decision = _run(
        campaign_ws,
        tool_name,
        {**args, "decision_id": f"{args['decision_id']}-new"},
    )

    assert replay["ok"] is False
    assert replay["error"]["code"] == "state_corrupt"
    assert new_decision["ok"] is False
    assert new_decision["error"]["code"] == "state_corrupt"
    assert source_path.read_bytes() == corrupt_bytes


@pytest.mark.parametrize(
    ("tool_name", "source_name", "args"),
    [
        (
            "state.time_marker",
            "time-markers.json",
            {
                "action": "set",
                "marker_id": "missing-source-marker",
                "minutes_from_now": 4,
                "decision_id": "missing-source-marker-decision",
            },
        ),
        (
            "state.set_flag",
            "flags.json",
            {
                "flag_id": "missing-source-flag",
                "value": True,
                "decision_id": "missing-source-flag-decision",
            },
        ),
    ],
)
def test_receipt_era_ledger_manifest_rejects_missing_canonical_source(
    campaign_ws,
    tool_name,
    source_name,
    args,
):
    campaign_dir = campaign_ws["campaign_dir"]
    assert _run(campaign_ws, tool_name, args)["ok"] is True
    source_path = campaign_dir / "save" / source_name
    source_path.unlink()

    replay = _run(campaign_ws, tool_name, args)

    assert replay["ok"] is False
    assert replay["error"]["code"] == "state_corrupt"
    assert not source_path.exists()


def test_pre_receipt_orphan_ledger_is_non_comparable_and_never_reapplied(campaign_ws):
    campaign_dir = campaign_ws["campaign_dir"]
    marker_path = campaign_dir / "save" / "time-markers.json"
    assert not marker_path.exists()
    args = {
        "action": "set",
        "marker_id": "legacy-marker",
        "minutes_from_now": 5,
        "decision_id": "pre-receipt-legacy-decision",
    }
    legacy_data = {"legacy": "settled-before-source-receipts"}
    coc_toolbox.Ctx(
        campaign_ws["workspace"], campaign_ws["campaign_id"]
    ).ledger_record(args["decision_id"], "state.time_marker", legacy_data)

    replay = _run(campaign_ws, "state.time_marker", args)

    assert replay["ok"] is False
    assert replay["error"]["code"] == "state_corrupt"
    assert not marker_path.exists()


def test_director_and_toolbox_share_flag_mutation_head_and_capsule(campaign_ws):
    campaign_dir = campaign_ws["campaign_dir"]
    unlocked = _run(
        campaign_ws,
        "state.set_flag",
        {
            "flag_id": "side_door_locked",
            "value": False,
            "reason": "toolbox unlocked it",
            "decision_id": "flag-side-door-unlocked",
        },
    )
    assert unlocked["ok"] is True

    events = coc_director_apply.apply_plan(
        campaign_dir,
        {
            "decision_id": "director-relocks-side-door",
            "scene_action": "CHARACTER",
            "turn_input": {
                "active_scene_id": "commission-briefing",
                "turn_number": 2,
            },
            "flags_set": ["side_door_locked"],
            "clue_policy": {"reveal": []},
            "pressure_moves": [],
            "memory_writes": [],
            "rule_signals": {},
        },
        investigator_id=campaign_ws["investigator_id"],
    )
    director_event = next(
        row for row in events
        if row.get("event_type") == "flag_set"
        and row.get("flag_id") == "side_door_locked"
    )
    assert director_event["value"] is True
    assert director_event["previous_value"] is False
    assert director_event["producer"] == "coc_director_apply"
    assert director_event["reason"] == "plan.flags_set"
    assert director_event["source_sequence"] > unlocked["data"]["provenance"][
        "source_sequence"
    ]

    continuity = _run(campaign_ws, "scene.context")["data"]["continuity"]
    live = next(
        row for row in continuity["live_world_flags"]
        if row["flag_id"] == "side_door_locked"
    )
    assert live["value"] is True
    assert live["provenance"]["producer"] == "coc_director_apply"
    assert live["provenance"]["decision_id"] == "director-relocks-side-door"
    history = [
        row for row in continuity["recent_world_flag_changes"]
        if row["flag_id"] == "side_door_locked"
    ]
    assert [row["value"] for row in history] == [False, True]
    assert history[-1]["provenance"]["source"] == "coc_director_apply"






def test_explicit_false_flag_remains_live_after_history_ages_out(campaign_ws):
    assert _run(
        campaign_ws,
        "state.set_flag",
        {
            "flag_id": "side_door_locked",
            "value": False,
            "decision_id": "side-door-explicitly-unlocked",
        },
    )["ok"] is True
    for index in range(13):
        assert _run(
            campaign_ws,
            "state.set_flag",
            {
                "flag_id": f"later-flag-{index}",
                "value": True,
                "decision_id": f"later-flag-decision-{index}",
            },
        )["ok"] is True

    continuity = _run(campaign_ws, "scene.context")["data"]["continuity"]
    assert not any(
        row["flag_id"] == "side_door_locked"
        for row in continuity["recent_world_flag_changes"]
    )
    live = next(
        row for row in continuity["live_world_flags"]
        if row["flag_id"] == "side_door_locked"
    )
    assert live["present"] is True
    assert live["value"] is False
    assert live["provenance"]["integrity_status"] == "source_anchored"


@pytest.mark.parametrize("entity_kind", ["flag", "marker"])
def test_latest_receipt_reconstructs_missing_live_entity_from_bound_head(
    campaign_ws, entity_kind,
):
    campaign_dir = campaign_ws["campaign_dir"]
    if entity_kind == "flag":
        tool_name = "state.set_flag"
        args = {
            "flag_id": "receipt-live-head-flag",
            "value": True,
            "reason": "head repair",
            "decision_id": "receipt-live-head-flag-decision",
        }
        source_path = campaign_dir / "save" / "flags.json"
        settled = _run(campaign_ws, tool_name, args)
        source = json.loads(source_path.read_text(encoding="utf-8"))
        source["flags"].pop(args["flag_id"])
        source["flag_provenance"].pop(args["flag_id"])
    else:
        tool_name = "state.time_marker"
        args = {
            "action": "set",
            "marker_id": "receipt-live-head-marker",
            "minutes_from_now": 8,
            "reason": "head repair",
            "decision_id": "receipt-live-head-marker-decision",
        }
        source_path = campaign_dir / "save" / "time-markers.json"
        settled = _run(campaign_ws, tool_name, args)
        source = json.loads(source_path.read_text(encoding="utf-8"))
        source["markers"].pop(args["marker_id"])
    assert settled["ok"] is True
    _write_json(source_path, source)

    replay = _run(campaign_ws, tool_name, args)

    assert replay["ok"] is True
    repaired = json.loads(source_path.read_text(encoding="utf-8"))
    if entity_kind == "flag":
        assert repaired["flags"][args["flag_id"]] is True
        assert repaired["flag_heads"][args["flag_id"]]["decision_id"] == args[
            "decision_id"
        ]
    else:
        assert repaired["markers"][args["marker_id"]]["decision_id"] == args[
            "decision_id"
        ]
        assert repaired["marker_heads"][args["marker_id"]]["decision_id"] == args[
            "decision_id"
        ]


def test_older_flag_receipt_repairs_later_head_without_restoring_old_value(
    campaign_ws,
):
    campaign_dir = campaign_ws["campaign_dir"]
    original_args = {
        "flag_id": "causal-head-flag",
        "value": True,
        "decision_id": "causal-head-original",
    }
    assert _run(campaign_ws, "state.set_flag", original_args)["ok"] is True
    assert _run(
        campaign_ws,
        "state.set_flag",
        {
            "flag_id": "causal-head-flag",
            "value": False,
            "decision_id": "causal-head-later",
        },
    )["ok"] is True
    flags_path = campaign_dir / "save" / "flags.json"
    flags = json.loads(flags_path.read_text(encoding="utf-8"))
    flags["flags"].pop("causal-head-flag")
    flags["flag_provenance"].pop("causal-head-flag")
    _write_json(flags_path, flags)

    replay = _run(campaign_ws, "state.set_flag", original_args)

    assert replay["ok"] is True
    repaired = json.loads(flags_path.read_text(encoding="utf-8"))
    assert repaired["flags"]["causal-head-flag"] is False
    assert repaired["flag_heads"]["causal-head-flag"]["decision_id"] == (
        "causal-head-later"
    )


def test_older_marker_receipt_never_overwrites_later_reset_head(campaign_ws):
    campaign_dir = campaign_ws["campaign_dir"]
    original_args = {
        "action": "set",
        "marker_id": "causal-head-marker",
        "minutes_from_now": 10,
        "decision_id": "causal-marker-original",
    }
    assert _run(campaign_ws, "state.time_marker", original_args)["ok"] is True
    later = _run(
        campaign_ws,
        "state.time_marker",
        {
            "action": "reset",
            "marker_id": "causal-head-marker",
            "minutes_from_now": 25,
            "decision_id": "causal-marker-later",
        },
    )
    assert later["ok"] is True
    marker_path = campaign_dir / "save" / "time-markers.json"
    doc = json.loads(marker_path.read_text(encoding="utf-8"))
    doc["markers"].pop("causal-head-marker")
    _write_json(marker_path, doc)

    replay = _run(campaign_ws, "state.time_marker", original_args)

    assert replay["ok"] is True
    repaired = json.loads(marker_path.read_text(encoding="utf-8"))
    assert repaired["markers"]["causal-head-marker"]["decision_id"] == (
        "causal-marker-later"
    )
    assert repaired["markers"]["causal-head-marker"]["due_at"] == later[
        "data"
    ]["marker"]["due_at"]


@pytest.mark.parametrize("entity_kind", ["flag", "marker"])
def test_receipt_replay_rejects_conflicting_present_live_record(
    campaign_ws, entity_kind,
):
    campaign_dir = campaign_ws["campaign_dir"]
    if entity_kind == "flag":
        tool_name = "state.set_flag"
        args = {
            "flag_id": "conflicting-live-flag",
            "value": True,
            "decision_id": "conflicting-live-flag-decision",
        }
        source_path = campaign_dir / "save" / "flags.json"
        assert _run(campaign_ws, tool_name, args)["ok"] is True
        doc = json.loads(source_path.read_text(encoding="utf-8"))
        doc["flags"][args["flag_id"]] = False
    else:
        tool_name = "state.time_marker"
        args = {
            "action": "set",
            "marker_id": "conflicting-live-marker",
            "minutes_from_now": 6,
            "decision_id": "conflicting-live-marker-decision",
        }
        source_path = campaign_dir / "save" / "time-markers.json"
        assert _run(campaign_ws, tool_name, args)["ok"] is True
        doc = json.loads(source_path.read_text(encoding="utf-8"))
        doc["markers"][args["marker_id"]]["due_at"]["elapsed_minutes"] += 1
    _write_json(source_path, doc)
    before = source_path.read_bytes()

    replay = _run(campaign_ws, tool_name, args)

    assert replay["ok"] is False
    assert replay["error"]["code"] == "state_corrupt"
    assert source_path.read_bytes() == before


def test_clear_absent_marker_has_explicit_replayable_noop_head(campaign_ws):
    campaign_dir = campaign_ws["campaign_dir"]
    args = {
        "action": "clear",
        "marker_id": "already-absent-marker",
        "reason": "explicit no-op",
        "decision_id": "clear-absent-marker-decision",
    }
    settled = _run(campaign_ws, "state.time_marker", args)
    assert settled["ok"] is True
    assert settled["data"]["marker"] is None
    marker_path = campaign_dir / "save" / "time-markers.json"
    doc = json.loads(marker_path.read_text(encoding="utf-8"))
    head = doc["marker_heads"][args["marker_id"]]
    assert head["live_record"] == {
        "schema_version": 1,
        "marker_id": args["marker_id"],
        "present": False,
        "marker": None,
    }
    assert _run(campaign_ws, "state.time_marker", args)["ok"] is True
    assert args["marker_id"] not in json.loads(
        marker_path.read_text(encoding="utf-8")
    )["markers"]


def test_receipt_era_ledger_schema_survives_manifest_damage(campaign_ws):
    campaign_dir = campaign_ws["campaign_dir"]
    args = {
        "action": "set",
        "marker_id": "receipt-era-discriminator",
        "minutes_from_now": 5,
        "decision_id": "receipt-era-discriminator-decision",
    }
    assert _run(campaign_ws, "state.time_marker", args)["ok"] is True
    (campaign_dir / "save" / "time-markers.json").unlink()
    ledger_path = campaign_dir / "save" / "toolbox-ledger.json"
    ledger = json.loads(ledger_path.read_text(encoding="utf-8"))
    key = coc_toolbox.Ctx._ledger_key("state.time_marker", args["decision_id"])
    entry = ledger["entries"][key]
    assert entry["entry_schema_version"] == 3
    entry.pop("source_receipt_manifest")
    _write_json(ledger_path, ledger)

    replay = _run(campaign_ws, "state.time_marker", args)

    assert replay["ok"] is False
    assert replay["error"]["code"] == "state_corrupt"


@pytest.mark.parametrize("event_damage", ["duplicate", "extra_field"])
def test_stable_operation_event_requires_exactly_one_full_canonical_match(
    campaign_ws,
    event_damage,
):
    campaign_dir = campaign_ws["campaign_dir"]
    args = {
        "action": "set",
        "marker_id": f"event-integrity-{event_damage}",
        "minutes_from_now": 3,
        "decision_id": f"event-integrity-{event_damage}-decision",
    }
    assert _run(campaign_ws, "state.time_marker", args)["ok"] is True
    marker_doc = json.loads(
        (campaign_dir / "save" / "time-markers.json").read_text(
            encoding="utf-8"
        )
    )
    receipt = marker_doc["operation_receipts"]["state.time_marker"][
        args["decision_id"]
    ]
    events_path = campaign_dir / "logs" / "events.jsonl"
    ledger_path = campaign_dir / "save" / "toolbox-ledger.json"
    events = _read_jsonl(events_path)
    target_index = next(
        index
        for index, row in enumerate(events)
        if row.get("event_id") == receipt["event_id"]
    )
    if event_damage == "duplicate":
        events.append(dict(events[target_index]))
    else:
        events[target_index]["unexpected_extra"] = True
    events_path.write_text(
        "\n".join(json.dumps(row, ensure_ascii=False) for row in events) + "\n",
        encoding="utf-8",
    )
    ledger_before = ledger_path.read_bytes()
    damaged_events = events_path.read_bytes()

    replay = _run(campaign_ws, "state.time_marker", args)

    assert replay["ok"] is False
    assert replay["error"]["code"] == "state_corrupt"
    assert ledger_path.read_bytes() == ledger_before
    assert events_path.read_bytes() == damaged_events


def test_state_write_appends_toolbox_calls_log(campaign_ws):
    log_path = campaign_ws["campaign_dir"] / "logs" / "toolbox-calls.jsonl"
    before = len(_read_jsonl(log_path))
    envelope = _run(
        campaign_ws,
        "state.set_flag",
        {
            "flag_id": "toolbox_seen",
            "value": True,
            "reason": "unit-test",
            "decision_id": "toolbox-seen-once",
        },
    )
    assert envelope["ok"] is True

    flags = json.loads(
        (campaign_ws["campaign_dir"] / "save" / "flags.json").read_text(encoding="utf-8")
    )
    assert flags.get("flags", {}).get("toolbox_seen") is True

    records = _read_jsonl(log_path)
    assert len(records) == before + 1
    last = records[-1]
    assert last["tool"] == "state.set_flag"
    assert last["ok"] is True
    assert last["args"]["flag_id"] == "toolbox_seen"
    assert "ts" in last


def test_transient_tool_failure_retries_same_call_and_records_recovery(
    campaign_ws,
    monkeypatch,
):
    name = "state.retry_probe"
    attempts = 0
    contexts = []

    def handler(ctx, args):
        nonlocal attempts
        attempts += 1
        contexts.append(ctx)
        assert "retry-probe" not in ctx._scenario_cache
        ctx._scenario_cache["retry-probe"] = {"attempt": attempts}
        if attempts < 3:
            raise coc_toolbox.ToolError(
                "subsystem_transaction_failed",
                "synthetic transient failure",
            )
        return {"decision_id": args["decision_id"]}, [], []

    coc_toolbox.TOOLS[name] = {
        "name": name,
        "summary": "test-only retry probe",
        "params": {"decision_id": {"type": "string", "required": True}},
        "needs_campaign": True,
        "handler": handler,
    }
    monkeypatch.setattr(coc_toolbox, "_TOOL_TRANSIENT_RETRY_DELAY_SECONDS", 0)
    try:
        envelope = _run(campaign_ws, name, {"decision_id": "retry-probe-once"})
    finally:
        coc_toolbox.TOOLS.pop(name, None)

    assert envelope["ok"] is True
    assert envelope["attempts"] == 3
    assert envelope["recovered_after_retry"] is True
    assert attempts == 3
    assert len({id(ctx) for ctx in contexts}) == 3
    receipts = [
        row
        for row in _read_jsonl(
            campaign_ws["campaign_dir"] / "logs" / "toolbox-calls.jsonl"
        )
        if row.get("tool") == name
    ]
    assert [row["ok"] for row in receipts] == [False, False, True]
    assert [row["attempt"] for row in receipts] == [1, 2, 3]
    assert [row["will_retry"] for row in receipts] == [True, True, False]
    assert receipts[-1]["recovered_after_retry"] is True


def test_campaign_busy_retries_before_handler_and_records_attempts(
    campaign_ws,
    monkeypatch,
):
    lock_attempts = 0
    handler_attempts = 0
    real_lock = coc_toolbox.coc_fileio.campaign_lock

    @contextmanager
    def flaky_lock(campaign_dir, *, wait_seconds):
        nonlocal lock_attempts
        lock_attempts += 1
        if lock_attempts < 3:
            raise coc_toolbox.coc_fileio.CampaignLockError("synthetic busy campaign")
        with real_lock(campaign_dir, wait_seconds=wait_seconds) as lock_path:
            yield lock_path

    name = "state.busy_retry_probe"

    def handler(ctx, args):
        nonlocal handler_attempts
        handler_attempts += 1
        return {"decision_id": args["decision_id"]}, [], []

    coc_toolbox.TOOLS[name] = {
        "name": name,
        "summary": "test-only campaign lock retry probe",
        "params": {"decision_id": {"type": "string", "required": True}},
        "needs_campaign": True,
        "handler": handler,
    }
    monkeypatch.setattr(coc_toolbox.coc_fileio, "campaign_lock", flaky_lock)
    monkeypatch.setattr(coc_toolbox, "_TOOL_TRANSIENT_RETRY_DELAY_SECONDS", 0)
    try:
        envelope = _run(campaign_ws, name, {"decision_id": "busy-retry-once"})
    finally:
        coc_toolbox.TOOLS.pop(name, None)

    assert envelope["ok"] is True
    assert envelope["attempts"] == 3
    assert envelope["recovered_after_retry"] is True
    assert lock_attempts == 3
    assert handler_attempts == 1
    receipts = [
        row
        for row in _read_jsonl(
            campaign_ws["campaign_dir"] / "logs" / "toolbox-calls.jsonl"
        )
        if row.get("tool") == name
    ]
    assert [row.get("error") for row in receipts] == [
        "campaign_busy",
        "campaign_busy",
        None,
    ]
    assert [row["will_retry"] for row in receipts] == [True, True, False]


def test_transient_retry_exhaustion_is_bounded_and_actionable(
    campaign_ws,
    monkeypatch,
):
    name = "state.retry_exhaustion_probe"
    attempts = 0

    def handler(ctx, args):
        nonlocal attempts
        attempts += 1
        raise coc_toolbox.ToolError(
            "subsystem_transaction_failed",
            "synthetic persistent transient failure",
        )

    coc_toolbox.TOOLS[name] = {
        "name": name,
        "summary": "test-only bounded retry probe",
        "params": {"decision_id": {"type": "string", "required": True}},
        "needs_campaign": True,
        "handler": handler,
    }
    monkeypatch.setattr(coc_toolbox, "_TOOL_TRANSIENT_RETRY_DELAY_SECONDS", 0)
    try:
        envelope = _run(campaign_ws, name, {"decision_id": "retry-exhaustion-once"})
    finally:
        coc_toolbox.TOOLS.pop(name, None)

    assert envelope["ok"] is False
    assert envelope["error"]["code"] == "subsystem_transaction_failed"
    assert envelope["attempts"] == 3
    assert envelope["max_attempts"] == 3
    assert envelope["retryable"] is True
    assert envelope["retry_exhausted"] is True
    assert envelope["recovered_after_retry"] is False
    assert attempts == 3
    assert any("same decision_id" in hint for hint in envelope["hints"])
    receipts = [
        row
        for row in _read_jsonl(
            campaign_ws["campaign_dir"] / "logs" / "toolbox-calls.jsonl"
        )
        if row.get("tool") == name
    ]
    assert [row["attempt"] for row in receipts] == [1, 2, 3]
    assert [row["will_retry"] for row in receipts] == [True, True, False]
    assert receipts[-1]["retry_exhausted"] is True


def test_invalid_payload_is_not_retried_and_returns_recovery_hint(
    campaign_ws,
    monkeypatch,
):
    name = "state.invalid_retry_probe"
    attempts = 0

    def handler(ctx, args):
        nonlocal attempts
        attempts += 1
        raise coc_toolbox.ToolError("invalid_param", "synthetic invalid payload")

    coc_toolbox.TOOLS[name] = {
        "name": name,
        "summary": "test-only invalid payload probe",
        "params": {},
        "needs_campaign": True,
        "handler": handler,
    }
    monkeypatch.setattr(coc_toolbox, "_TOOL_TRANSIENT_RETRY_ATTEMPTS", 5)
    try:
        envelope = _run(campaign_ws, name)
    finally:
        coc_toolbox.TOOLS.pop(name, None)

    assert envelope["ok"] is False
    assert envelope["error"]["code"] == "invalid_param"
    assert envelope["attempts"] == 1
    assert envelope["retryable"] is False
    assert envelope["recovered_after_retry"] is False
    assert attempts == 1
    assert any("describe" in hint for hint in envelope["hints"])
    receipts = [
        row
        for row in _read_jsonl(
            campaign_ws["campaign_dir"] / "logs" / "toolbox-calls.jsonl"
        )
        if row.get("tool") == name
    ]
    assert len(receipts) == 1
    assert receipts[0]["retryable"] is False
    assert receipts[0]["will_retry"] is False
    assert receipts[0]["error_message"] == "synthetic invalid payload"


def test_state_end_session_appends_session_ending_event(campaign_ws):
    world = json.loads(
        (campaign_ws["campaign_dir"] / "save" / "world-state.json").read_text(
            encoding="utf-8"
        )
    )
    active = world.get("active_scene_id")
    envelope = _run(
        campaign_ws,
        "state.end_session",
        {
            "kind": "cliffhanger",
            "summary": "session closed by toolbox test",
            "decision_id": "toolbox-end-1",
        },
    )
    assert envelope["ok"] is True
    assert envelope["data"]["session_ending"] is True
    assert envelope["data"]["scene_id"] == active
    assert envelope["data"]["kind"] == "cliffhanger"

    events = _read_jsonl(campaign_ws["campaign_dir"] / "logs" / "events.jsonl")
    endings = [e for e in events if e.get("event_type") == "session_ending"]
    assert endings
    last = endings[-1]
    assert last["scene_id"] == active
    assert last["kind"] == "cliffhanger"
    assert last["summary"] == "session closed by toolbox test"


def test_state_end_session_idempotent_on_decision_id(campaign_ws):
    args = {
        "kind": "conclusion",
        "summary": "once",
        "decision_id": "toolbox-end-dup",
    }
    first = _run(campaign_ws, "state.end_session", args)
    second = _run(campaign_ws, "state.end_session", args)
    assert first["ok"] and second["ok"]
    assert second["data"] == first["data"]
    assert any("duplicate decision_id" in w for w in second["warnings"])
    endings = [
        e
        for e in _read_jsonl(campaign_ws["campaign_dir"] / "logs" / "events.jsonl")
        if e.get("event_type") == "session_ending" and e.get("summary") == "once"
    ]
    assert len(endings) == 1


def test_evicted_roll_replay_does_not_reearn_consumed_development_check(
    campaign_ws,
):
    investigator_id = campaign_ws["investigator_id"]
    roll_args = {
        "investigator": investigator_id,
        "skill": "Spot Hidden",
        "target": 99,
        "seed": 1,
        "decision_id": "old-roll-after-ledger-eviction",
    }
    first = _run(campaign_ws, "rules.roll", roll_args)
    assert first["ok"] is True
    ended = _run(campaign_ws, "state.end_session", {
        "kind": "cliffhanger",
        "summary": "consume the old roll's development event",
        "decision_id": "consume-old-roll-ending",
    })
    assert ended["data"]["development"]["status"] == "PASS"
    assert ended["data"]["development"]["settlements"][0]["receipt"][
        "result"
    ]["skills_checked"] == ["Spot Hidden"]

    for index in range(coc_toolbox._LEDGER_MAX_ENTRIES + 1):
        journaled = _run(campaign_ws, "state.journal", {
            "summary": f"rotate bounded ledger entry {index}",
            "decision_id": f"ledger-rotation-{index}",
        })
        assert journaled["ok"] is True
        _finalize_pending_turn_for_test(
            campaign_ws,
            decision_id=f"ledger-rotation-finalize-{index}",
        )

    replay = _run(campaign_ws, "rules.roll", roll_args)
    assert replay["ok"] is True
    assert replay["data"] == first["data"]
    assert any(
        "duplicate decision_id" in warning
        for warning in replay.get("warnings") or []
    )
    assert len([
        row for row in _read_jsonl(
            campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl"
        )
        if row.get("roll_id") == first["data"]["roll_id"]
    ]) == 1
    state_path = (
        campaign_ws["campaign_dir"] / "save" / "investigator-state"
        / f"{investigator_id}.json"
    )
    state = json.loads(state_path.read_text(encoding="utf-8"))
    assert state["skill_checks_earned"] == []
    assert state["skill_check_events"] == []
    assert (campaign_ws["coc_root"] / "investigators" / investigator_id
            / "development.jsonl").read_text(encoding="utf-8") == ""

    second_ending = _run(campaign_ws, "state.end_session", {
        "kind": "cliffhanger",
        "summary": "replayed source has no second development event",
        "decision_id": "after-old-roll-replay-ending",
    })
    assert second_ending["data"]["development"]["settlements"][0][
        "receipt"
    ]["result"]["skills_checked"] == []


def test_state_end_session_process_retry_reuses_persisted_ending(
    campaign_ws, monkeypatch
):
    original = coc_toolbox.coc_runtime_ops.settle_development

    def crash_before_settlement(*_args, **_kwargs):
        raise SystemExit("simulated host process exit")

    monkeypatch.setattr(
        coc_toolbox.coc_runtime_ops,
        "settle_development",
        crash_before_settlement,
    )
    args = {
        "kind": "cliffhanger",
        "summary": "ending survives a host crash",
        "decision_id": "toolbox-end-crash-retry",
    }
    with pytest.raises(SystemExit, match="simulated host process exit"):
        _run(campaign_ws, "state.end_session", args)

    added_investigator = _add_eleanor_to_party(campaign_ws)
    # Party membership may change while a crashed ending is pending.  The
    # durable ending still owns its original target, even when that actor is
    # no longer in the current party projection.
    coc_state.link_party(
        campaign_ws["workspace"],
        campaign_ws["campaign_id"],
        [added_investigator],
    )

    monkeypatch.setattr(
        coc_toolbox.coc_runtime_ops,
        "settle_development",
        original,
    )
    recovered = _run(campaign_ws, "state.end_session", args)
    assert recovered["ok"] is True
    assert recovered["data"]["development"]["status"] == "PASS"
    assert recovered["data"]["investigator_ids"] == [campaign_ws["investigator_id"]]
    assert recovered["data"]["retry_target_conflict"] == {
        "code": "SETTLEMENT_TARGET_CONFLICT",
        "frozen_investigator_ids": [campaign_ws["investigator_id"]],
        "retry_investigator_ids": [added_investigator],
        "resolution": "frozen_targets_preserved",
    }
    assert any(
        "SETTLEMENT_TARGET_CONFLICT" in warning
        for warning in recovered["warnings"]
    )
    endings = [
        row
        for row in _read_jsonl(
            campaign_ws["campaign_dir"] / "logs" / "events.jsonl"
        )
        if row.get("event_type") == "session_ending"
        and row.get("decision_id") == args["decision_id"]
    ]
    assert len(endings) == 1
    assert endings[0]["investigator_ids"] == [campaign_ws["investigator_id"]]
    assert not (
        campaign_ws["campaign_dir"]
        / "save"
        / "development-settlements"
        / f"{added_investigator}.json"
    ).exists()


def test_state_end_session_keeps_ending_when_settlement_is_pending(
    campaign_ws, monkeypatch
):
    original = coc_toolbox.coc_runtime_ops.settle_development
    attempts = 0

    def unavailable(*_args, **_kwargs):
        nonlocal attempts
        attempts += 1
        raise OSError("synthetic settlement outage")

    monkeypatch.setattr(
        coc_toolbox.coc_runtime_ops,
        "settle_development",
        unavailable,
    )
    args = {
        "kind": "retreat",
        "summary": "the investigation closes despite bookkeeping trouble",
        "decision_id": "toolbox-end-pending-retry",
    }
    pending = _run(campaign_ws, "state.end_session", args)
    assert pending["ok"] is True
    assert pending["data"]["session_ending"] is True
    assert pending["data"]["development"]["status"] == "PENDING"
    assert pending["data"]["investigator_ids"] == [campaign_ws["investigator_id"]]
    assert attempts == coc_toolbox._TOOL_TRANSIENT_RETRY_ATTEMPTS
    assert any("ending is durable" in warning for warning in pending["warnings"])
    ending_event = next(
        row for row in _read_jsonl(
            campaign_ws["campaign_dir"] / "logs" / "events.jsonl"
        )
        if row.get("event_type") == "session_ending"
        and row.get("decision_id") == args["decision_id"]
    )
    assert ending_event["investigator_ids"] == [campaign_ws["investigator_id"]]

    added_investigator = _add_eleanor_to_party(campaign_ws)

    monkeypatch.setattr(
        coc_toolbox.coc_runtime_ops,
        "settle_development",
        original,
    )
    recovered = _run(campaign_ws, "state.end_session", args)
    assert recovered["ok"] is True
    assert recovered["data"]["development"]["status"] == "PASS"
    assert recovered["data"]["investigator_ids"] == [campaign_ws["investigator_id"]]
    assert recovered["data"]["retry_target_conflict"] == {
        "code": "SETTLEMENT_TARGET_CONFLICT",
        "frozen_investigator_ids": [campaign_ws["investigator_id"]],
        "retry_investigator_ids": [campaign_ws["investigator_id"], added_investigator],
        "resolution": "frozen_targets_preserved",
    }
    assert any("pending development settlement completed" in warning
               for warning in recovered["warnings"])
    assert any(
        "SETTLEMENT_TARGET_CONFLICT" in warning
        for warning in recovered["warnings"]
    )
    assert not (
        campaign_ws["campaign_dir"]
        / "save"
        / "development-settlements"
        / f"{added_investigator}.json"
    ).exists()
    incompatible = _run(
        campaign_ws,
        "development.settle",
        {
            "investigator": added_investigator,
            "decision_id": "ending-frozen-target-incompatible",
        },
    )
    assert incompatible["ok"] is False
    assert incompatible["error"]["code"] == "settlement_target_conflict"
    endings = [
        row for row in _read_jsonl(
            campaign_ws["campaign_dir"] / "logs" / "events.jsonl"
        )
        if row.get("event_type") == "session_ending"
        and row.get("decision_id") == args["decision_id"]
    ]
    assert len(endings) == 1


def test_pending_ending_capsule_survives_newer_ending_with_its_own_inputs(
    campaign_ws, monkeypatch
):
    investigator_id = campaign_ws["investigator_id"]
    state_path = (
        campaign_ws["campaign_dir"] / "save" / "investigator-state"
        / f"{investigator_id}.json"
    )
    spot_tick = coc_toolbox.coc_development.record_skill_tick(
        campaign_ws["campaign_dir"],
        investigator_id,
        "Spot Hidden",
        {
            "skill": "Spot Hidden",
            "outcome": "regular_success",
            "success": True,
            "roll": 20,
            "target": 50,
            "kind": "skill_check",
        },
        source_event_id="capsule-pending-spot",
        source_kind="toolbox-test",
    )
    assert spot_tick is not None

    original = coc_toolbox.coc_runtime_ops.settle_development

    def unavailable(*_args, **_kwargs):
        raise OSError("first ending settlement is offline")

    monkeypatch.setattr(
        coc_toolbox.coc_runtime_ops, "settle_development", unavailable
    )
    first_args = {
        "kind": "cliffhanger",
        "summary": "first ending remains pending",
        "decision_id": "ending-capsule-first-pending",
    }
    first = _run(campaign_ws, "state.end_session", first_args)
    assert first["ok"] is True
    assert first["data"]["development"]["status"] == "PENDING"
    first_ending_id = first["data"]["ending_id"]
    first_capsule = coc_toolbox.coc_development.load_ending_settlement_capsule(
        campaign_ws["campaign_dir"], first_ending_id
    )
    assert first_capsule is not None
    assert first_capsule["development_inputs"][investigator_id][
        "skills_checked"
    ] == ["Spot Hidden"]
    first_story_digest = first_capsule["source_digest"]["story_graph"]
    assert first_story_digest["exists"] is True
    assert first_capsule["source_digest"]["combat_snapshot"]["exists"] is False

    # Play continues without a narrative gate.  A later ending sees the old
    # capsule's durable claim and owns only the newly earned Listen check.
    # Even if current scenario/combat inputs change, retrying the first ending
    # must continue to consume its own immutable source/evidence snapshot.
    graph_path = campaign_ws["campaign_dir"] / "scenario" / "story-graph.json"
    graph = json.loads(graph_path.read_text(encoding="utf-8"))
    graph["test_revision"] = "newer-ending-only"
    _write_json(graph_path, graph)
    combat_path = campaign_ws["campaign_dir"] / "save" / "combat.json"
    _write_json(combat_path, {"status": "newer-ending-only"})
    listen_tick = coc_toolbox.coc_development.record_skill_tick(
        campaign_ws["campaign_dir"],
        investigator_id,
        "Listen",
        {
            "skill": "Listen",
            "outcome": "regular_success",
            "success": True,
            "roll": 20,
            "target": 50,
            "kind": "skill_check",
        },
        source_event_id="capsule-pending-listen",
        source_kind="toolbox-test",
    )
    assert listen_tick is not None
    monkeypatch.setattr(
        coc_toolbox.coc_runtime_ops, "settle_development", original
    )
    second = _run(
        campaign_ws,
        "state.end_session",
        {
            "kind": "retreat",
            "summary": "a newer ending settles first",
            "decision_id": "ending-capsule-second",
        },
    )
    assert second["ok"] is True
    assert second["data"]["development"]["status"] == "PASS"
    second_ending_id = second["data"]["ending_id"]
    assert second_ending_id != first_ending_id
    second_capsule = coc_toolbox.coc_development.load_ending_settlement_capsule(
        campaign_ws["campaign_dir"], second_ending_id
    )
    assert second_capsule is not None
    assert second_capsule["source_digest"]["story_graph"] != first_story_digest
    assert second_capsule["source_digest"]["combat_snapshot"]["exists"] is True
    second_result = second["data"]["development"]["settlements"][0][
        "receipt"
    ]["result"]
    assert second_result["ending_evidence"]["ending_id"] == second_ending_id
    assert second_result["skills_checked"] == ["Listen"]
    assert json.loads(state_path.read_text(encoding="utf-8"))[
        "skill_checks_earned"
    ] == []

    recovered = _run(campaign_ws, "state.end_session", first_args)
    assert recovered["ok"] is True
    assert recovered["data"]["ending_id"] == first_ending_id
    first_result = recovered["data"]["development"]["settlements"][0][
        "receipt"
    ]["result"]
    assert first_result["ending_evidence"]["ending_id"] == first_ending_id
    assert first_result["ending_evidence"]["source_digest"] == first_capsule[
        "source_digest"
    ]
    assert first_result["ending_evidence"]["conclusion_evidence"] == (
        first_capsule["conclusion_evidence"]
    )
    assert first_result["skills_checked"] == ["Spot Hidden"]
    assert coc_toolbox.coc_development.ending_settlement_path(
        campaign_ws["campaign_dir"], first_ending_id, investigator_id
    ).is_file()
    assert coc_toolbox.coc_development.ending_settlement_path(
        campaign_ws["campaign_dir"], second_ending_id, investigator_id
    ).is_file()
    assert not (
        campaign_ws["campaign_dir"] / "save" / "development-settlements"
        / f"{investigator_id}.json"
    ).exists()


def test_pending_ending_and_new_same_skill_success_keep_distinct_event_claims(
    campaign_ws, monkeypatch
):
    investigator_id = campaign_ws["investigator_id"]
    first_roll = _run(campaign_ws, "rules.roll", {
        "investigator": investigator_id,
        "skill": "Spot Hidden",
        "target": 99,
        "seed": 1,
        "decision_id": "same-skill-roll-a",
    })
    assert first_roll["ok"] is True
    original = coc_toolbox.coc_runtime_ops.settle_development
    monkeypatch.setattr(
        coc_toolbox.coc_runtime_ops,
        "settle_development",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(OSError("offline")),
    )
    first_args = {
        "kind": "cliffhanger",
        "summary": "first same-skill claim remains pending",
        "decision_id": "same-skill-ending-a",
    }
    first = _run(campaign_ws, "state.end_session", first_args)
    assert first["data"]["development"]["status"] == "PENDING"
    first_capsule = coc_toolbox.coc_development.load_ending_settlement_capsule(
        campaign_ws["campaign_dir"], first["data"]["ending_id"]
    )
    assert first_capsule is not None
    token_a = first_capsule["development_inputs"][investigator_id][
        "input_tokens"
    ][0]

    second_roll = _run(campaign_ws, "rules.roll", {
        "investigator": investigator_id,
        "skill": "Spot Hidden",
        "target": 99,
        "seed": 2,
        "decision_id": "same-skill-roll-b",
    })
    assert second_roll["ok"] is True
    monkeypatch.setattr(
        coc_toolbox.coc_runtime_ops, "settle_development", original
    )
    second = _run(campaign_ws, "state.end_session", {
        "kind": "retreat",
        "summary": "second same-skill claim settles independently",
        "decision_id": "same-skill-ending-b",
    })
    assert second["data"]["development"]["status"] == "PASS"
    second_capsule = coc_toolbox.coc_development.load_ending_settlement_capsule(
        campaign_ws["campaign_dir"], second["data"]["ending_id"]
    )
    assert second_capsule is not None
    token_b = second_capsule["development_inputs"][investigator_id][
        "input_tokens"
    ][0]
    assert token_b != token_a
    assert second_capsule["development_inputs"][investigator_id][
        "skills_checked"
    ] == ["Spot Hidden"]

    retried = _run(campaign_ws, "state.end_session", first_args)
    assert retried["data"]["development"]["status"] == "PASS"
    state_path = (
        campaign_ws["campaign_dir"] / "save" / "investigator-state"
        / f"{investigator_id}.json"
    )
    state = json.loads(state_path.read_text(encoding="utf-8"))
    assert state["skill_checks_earned"] == []
    assert state["skill_check_events"] == []
    claims_path = (
        campaign_ws["coc_root"] / "investigators" / investigator_id
        / "development-claims.json"
    )
    claims = json.loads(claims_path.read_text(encoding="utf-8"))["claims"]
    assert claims[token_a]["ending_id"] == first["data"]["ending_id"]
    assert claims[token_b]["ending_id"] == second["data"]["ending_id"]


def test_frozen_mechanical_plan_merges_without_recomputing_later_state(
    campaign_ws, monkeypatch
):
    investigator_id = campaign_ws["investigator_id"]
    rolled = _run(campaign_ws, "rules.roll", {
        "investigator": investigator_id,
        "skill": "Frozen Custom Skill",
        "target": 99,
        "seed": 3,
        "decision_id": "frozen-plan-roll",
    })
    assert rolled["ok"] is True
    state_path = (
        campaign_ws["campaign_dir"] / "save" / "investigator-state"
        / f"{investigator_id}.json"
    )
    state = json.loads(state_path.read_text(encoding="utf-8"))
    state["current_luck"] = 0
    _write_json(state_path, state)
    original = coc_toolbox.coc_runtime_ops.settle_development
    monkeypatch.setattr(
        coc_toolbox.coc_runtime_ops,
        "settle_development",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(OSError("offline")),
    )
    end_args = {
        "kind": "cliffhanger",
        "summary": "freeze mechanics before delayed retry",
        "decision_id": "frozen-plan-ending",
    }
    first = _run(campaign_ws, "state.end_session", end_args)
    ending_id = first["data"]["ending_id"]
    capsule = coc_toolbox.coc_development.load_ending_settlement_capsule(
        campaign_ws["campaign_dir"], ending_id
    )
    assert capsule is not None
    frozen = capsule["development_inputs"][investigator_id]
    plan_check = frozen["deterministic_plan"]["improvement_checks"][0]
    assert plan_check["improved"] is True
    character_path = (
        campaign_ws["coc_root"] / "investigators" / investigator_id
        / "character.json"
    )
    character = json.loads(character_path.read_text(encoding="utf-8"))
    character.setdefault("skills", {})["Frozen Custom Skill"] = 99
    _write_json(character_path, character)
    state = json.loads(state_path.read_text(encoding="utf-8"))
    state["current_luck"] = 80
    _write_json(state_path, state)

    monkeypatch.setattr(
        coc_toolbox.coc_runtime_ops, "settle_development", original
    )
    retried = _run(campaign_ws, "state.end_session", end_args)
    result = retried["data"]["development"]["settlements"][0][
        "receipt"
    ]["result"]
    check = result["improvement_checks"][0]
    assert check["check_roll"] == plan_check["check_roll"]
    assert check["gain"] == plan_check["gain"]
    assert check["value_before"] == 0
    assert check["current_value_before_apply"] == 99
    assert check["value_after"] == 99 + plan_check["gain"]
    assert result["luck_recovery"]["planned_luck_before"] == 0
    assert result["luck_recovery"]["current_luck_before_apply"] == 80
    assert result["settlement_plan_sha256"] == frozen[
        "deterministic_plan"
    ]["plan_sha256"]


def test_base_layout_settlement_receipt_is_rejected_without_reapplying(
    campaign_ws,
):
    ended = _run(campaign_ws, "state.end_session", {
        "kind": "cliffhanger",
        "summary": "create a receipt to reshape as the base layout",
        "decision_id": "base-layout-rejection-ending",
    })
    assert ended["data"]["development"]["status"] == "PASS"
    investigator_id = campaign_ws["investigator_id"]
    ending_id = ended["data"]["ending_id"]
    exact = coc_toolbox.coc_development.ending_settlement_path(
        campaign_ws["campaign_dir"], ending_id, investigator_id
    )
    base_layout = (
        campaign_ws["campaign_dir"] / "save" / "development-settlements"
        / f"{investigator_id}.json"
    )
    base_layout.write_bytes(exact.read_bytes())
    exact.unlink()
    character = (
        campaign_ws["coc_root"] / "investigators" / investigator_id
        / "character.json"
    )
    rolls = campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl"
    before = {
        character: character.read_bytes(),
        rolls: rolls.read_bytes(),
    }

    replay = _run(campaign_ws, "development.settle", {
        "investigator": investigator_id,
        "ending_id": ending_id,
        "decision_id": "base-layout-rejection-replay",
    })

    assert replay["ok"] is False
    assert replay["error"]["code"] == "development_settlement_failed"
    assert "unsupported base-layout" in replay["error"]["message"]
    assert {path: path.read_bytes() for path in before} == before
    assert not exact.exists()
    assert base_layout.is_file()


def test_current_settlement_writes_only_exact_ending_receipt(campaign_ws):
    investigator_id = campaign_ws["investigator_id"]
    base_layout = (
        campaign_ws["campaign_dir"] / "save" / "development-settlements"
        / f"{investigator_id}.json"
    )
    ended = _run(campaign_ws, "state.end_session", {
        "kind": "cliffhanger",
        "summary": "only the exact ending receipt is current state",
        "decision_id": "exact-only-ending",
    })

    assert ended["ok"] is True
    assert ended["data"]["development"]["status"] == "PASS"
    receipt = ended["data"]["development"]["settlements"][0]["receipt"]
    assert receipt["status"] == "PASS"
    assert "projection_repair_needed" not in receipt
    assert "warnings" not in receipt
    exact = coc_toolbox.coc_development.ending_settlement_path(
        campaign_ws["campaign_dir"], ended["data"]["ending_id"], investigator_id
    )
    assert exact.is_file()
    assert not base_layout.exists()


def test_end_session_rejects_unsafe_target_before_lock_path_creation(campaign_ws):
    outside = campaign_ws["workspace"] / "escaped-lock-target"
    escaped_lock = outside / ".investigator.lock"
    result = _run(campaign_ws, "state.end_session", {
        "kind": "cliffhanger",
        "investigator": "../../../escaped-lock-target",
        "decision_id": "unsafe-ending-target",
    })

    assert result["ok"] is False
    assert result["error"]["code"] == "invalid_param"
    assert not outside.exists()
    assert not escaped_lock.exists()


def test_versioned_ending_does_not_recompile_when_capsule_is_missing(
    campaign_ws, monkeypatch
):
    original = coc_toolbox.coc_runtime_ops.settle_development

    def unavailable(*_args, **_kwargs):
        raise OSError("settlement temporarily offline")

    monkeypatch.setattr(
        coc_toolbox.coc_runtime_ops, "settle_development", unavailable
    )
    args = {
        "kind": "cliffhanger",
        "summary": "capsule loss must fail closed",
        "decision_id": "ending-capsule-missing",
    }
    first = _run(campaign_ws, "state.end_session", args)
    assert first["ok"] is True
    assert first["data"]["development"]["status"] == "PENDING"
    ending_id = first["data"]["ending_id"]
    capsule_path = coc_toolbox.coc_development.ending_settlement_capsule_path(
        campaign_ws["campaign_dir"], ending_id
    )
    capsule_path.unlink()
    monkeypatch.setattr(
        coc_toolbox.coc_runtime_ops, "settle_development", original
    )

    retried = _run(campaign_ws, "state.end_session", args)

    assert retried["ok"] is True
    assert retried["data"]["development"]["status"] == "PENDING"
    assert retried["data"]["development"]["error"] == (
        "persisted ending evidence is unavailable"
    )
    assert not coc_toolbox.coc_development.ending_settlement_path(
        campaign_ws["campaign_dir"], ending_id, campaign_ws["investigator_id"]
    ).exists()


def test_capsule_event_identity_survives_preappend_crash_and_interleaving(
    campaign_ws, monkeypatch
):
    original_log_event = coc_toolbox.Ctx.log_event

    def crash_before_ending_append(self, record):
        if (
            record.get("event_type") == "session_ending"
            and record.get("decision_id") == "ending-preappend-crash"
        ):
            raise SystemExit("crash after capsule before ending append")
        return original_log_event(self, record)

    monkeypatch.setattr(
        coc_toolbox.Ctx, "log_event", crash_before_ending_append
    )
    args = {
        "kind": "cliffhanger",
        "summary": "stable event identity",
        "decision_id": "ending-preappend-crash",
    }
    with pytest.raises(SystemExit, match="after capsule before ending append"):
        _run(campaign_ws, "state.end_session", args)

    monkeypatch.setattr(coc_toolbox.Ctx, "log_event", original_log_event)
    capsule_paths = list((
        campaign_ws["campaign_dir"]
        / "save" / "development-settlements" / "endings"
    ).glob("*/capsule.json"))
    assert len(capsule_paths) == 1
    capsule = json.loads(capsule_paths[0].read_text(encoding="utf-8"))

    # New state must land before state.journal.  The journal then closes and is
    # finalized before the interrupted ending is replayed in the next turn.
    moved = _run(
        campaign_ws,
        "state.move_scene",
        {
            "scene_id": "post-capsule-improvised-scene",
            "decision_id": "ending-preappend-scene-change",
        },
    )
    assert moved["ok"] is True
    interleaved = _run(
        campaign_ws,
        "state.journal",
        {
            "summary": "unrelated events land before the ending retry",
            "decision_id": "ending-preappend-interleave",
        },
    )
    assert interleaved["ok"] is True
    _finalize_pending_turn_for_test(
        campaign_ws,
        decision_id="ending-preappend-interleave-finalize",
    )
    coc_state.link_party(
        campaign_ws["workspace"], campaign_ws["campaign_id"], []
    )
    replay = _run(campaign_ws, "state.end_session", args)
    assert replay["ok"] is True
    assert replay["data"]["scene_id"] == capsule["scene_id"]
    assert replay["data"]["investigator_ids"] == [
        campaign_ws["investigator_id"]
    ]
    assert replay["data"]["retry_target_conflict"] == {
        "code": "SETTLEMENT_TARGET_CONFLICT",
        "frozen_investigator_ids": [campaign_ws["investigator_id"]],
        "retry_investigator_ids": [],
        "resolution": "frozen_targets_preserved",
    }
    events = _read_jsonl(
        campaign_ws["campaign_dir"] / "logs" / "events.jsonl"
    )
    actual_line, ending_event = next(
        (index, row)
        for index, row in enumerate(events, start=1)
        if row.get("decision_id") == args["decision_id"]
        and row.get("event_type") == "session_ending"
    )
    assert actual_line != capsule["event_line_at_capture"]
    assert ending_event["event_id"] == capsule["event_id"]
    assert capsule["event_ref"] == (
        f"logs/events.jsonl#{ending_event['event_id']}"
    )
    assert replay["data"]["development"]["settlements"][0]["receipt"][
        "result"
    ]["ending_evidence"]["event_id"] == ending_event["event_id"]


def test_event_only_retry_preserves_explicit_empty_ending_targets(
    campaign_ws, monkeypatch
):
    coc_state.link_party(
        campaign_ws["workspace"], campaign_ws["campaign_id"], []
    )
    original_record = coc_toolbox.Ctx.ledger_record

    def crash_before_ledger(self, decision_id, tool, data):
        if tool == "state.end_session" and decision_id == "ending-empty-crash":
            raise SystemExit("crash after empty ending event")
        return original_record(self, decision_id, tool, data)

    monkeypatch.setattr(coc_toolbox.Ctx, "ledger_record", crash_before_ledger)
    args = {
        "kind": "cliffhanger",
        "summary": "no investigators are linked",
        "decision_id": "ending-empty-crash",
    }
    with pytest.raises(SystemExit, match="empty ending event"):
        _run(campaign_ws, "state.end_session", args)

    monkeypatch.setattr(coc_toolbox.Ctx, "ledger_record", original_record)
    coc_state.link_party(
        campaign_ws["workspace"],
        campaign_ws["campaign_id"],
        [campaign_ws["investigator_id"]],
    )
    replay = _run(campaign_ws, "state.end_session", args)
    assert replay["ok"] is True
    assert replay["data"]["investigator_ids"] == []
    assert replay["data"]["development"] == {
        "status": "PASS",
        "ending_id": replay["data"]["ending_id"],
        "settlements": [],
    }
    assert replay["data"]["retry_target_conflict"] == {
        "code": "SETTLEMENT_TARGET_CONFLICT",
        "frozen_investigator_ids": [],
        "retry_investigator_ids": [campaign_ws["investigator_id"]],
        "resolution": "frozen_targets_preserved",
    }
    endings = [
        row for row in _read_jsonl(
            campaign_ws["campaign_dir"] / "logs" / "events.jsonl"
        )
        if row.get("decision_id") == args["decision_id"]
        and row.get("event_type") == "session_ending"
    ]
    assert len(endings) == 1
    assert endings[0]["investigator_ids"] == []


def test_state_end_session_rejects_unknown_ending_kind(campaign_ws):
    envelope = _run(
        campaign_ws,
        "state.end_session",
        {
            "kind": "combat_finished",
            "summary": "not a canonical session boundary",
            "decision_id": "toolbox-end-invalid-kind",
        },
    )
    assert envelope["ok"] is False
    assert envelope["error"]["code"] == "invalid_param"


def test_toolbox_returns_typed_recovery_conflict_without_touching_foreign_state(
    campaign_ws, monkeypatch
):
    runtime_ops = coc_toolbox.coc_runtime_ops
    character_path = (
        campaign_ws["coc_root"]
        / "investigators"
        / campaign_ws["investigator_id"]
        / "character.json"
    )
    original_write = runtime_ops.coc_fileio.write_text_atomic
    crashed = False

    def crash_after_character(path, text):
        nonlocal crashed
        original_write(path, text)
        if Path(path) == character_path and not crashed:
            crashed = True
            raise SystemExit("toolbox settlement process crash")

    monkeypatch.setattr(
        runtime_ops.coc_fileio, "write_text_atomic", crash_after_character
    )
    with pytest.raises(SystemExit, match="toolbox settlement process crash"):
        _run(
            campaign_ws,
            "state.end_session",
            {
                "kind": "cliffhanger",
                "summary": "durable ending before recovery conflict",
                "decision_id": "toolbox-recovery-conflict-ending",
            },
        )
    monkeypatch.setattr(
        runtime_ops.coc_fileio, "write_text_atomic", original_write
    )

    inv_path = (
        campaign_ws["campaign_dir"]
        / "save"
        / "investigator-state"
        / f"{campaign_ws['investigator_id']}.json"
    )
    foreign = json.loads(inv_path.read_text(encoding="utf-8"))
    foreign["foreign_integrity_receipt"] = "preserve-exactly"
    _write_json(inv_path, foreign)
    bytes_before = inv_path.read_bytes()
    event_path = campaign_ws["campaign_dir"] / "logs" / "events.jsonl"
    turns_before = len([
        row for row in _read_jsonl(event_path)
        if row.get("event_type") == "turn"
    ])

    blocked = _run(
        campaign_ws,
        "state.journal",
        {
            "summary": "must not commit while integrity is unresolved",
            "decision_id": "journal-after-recovery-conflict",
        },
    )
    assert blocked["ok"] is False
    assert blocked["error"]["code"] == "recovery_conflict"
    assert blocked["recovery"]["status"] == "RECOVERY_CONFLICT"
    assert (
        f"campaigns/{campaign_ws['campaign_id']}/save/investigator-state/"
        f"{campaign_ws['investigator_id']}.json"
    ) in blocked["recovery"]["conflicting_paths"]
    assert inv_path.read_bytes() == bytes_before
    assert json.loads(inv_path.read_text(encoding="utf-8"))[
        "foreign_integrity_receipt"
    ] == "preserve-exactly"
    assert len([
        row for row in _read_jsonl(event_path)
        if row.get("event_type") == "turn"
    ]) == turns_before


def test_unlinked_subsystem_tool_returns_typed_recovery_conflict_with_zero_writes(
    campaign_ws,
):
    investigator_id = "unlinked-guarded-investigator"
    sheet = {
        "schema_version": 1,
        "id": investigator_id,
        "investigator_id": investigator_id,
        "name": "Unlinked Guarded Investigator",
        "characteristics": {"POW": 50, "INT": 60, "LUCK": 40},
        "derived": {"HP": 10, "SAN": 50, "MP": 10},
        "skills": {"First Aid": 60},
    }
    coc_state.create_investigator(
        campaign_ws["workspace"], investigator_id, sheet
    )
    foreign_campaign = (
        campaign_ws["coc_root"] / "campaigns" / "foreign-campaign"
    )
    inflight = (
        foreign_campaign / "save" / "development-settlements" / "endings"
        / "ending-unlinked-guard" / f"{investigator_id}.inflight.json"
    )
    marker = coc_toolbox.coc_runtime_ops._claim_development_active_marker(
        campaign_dir=foreign_campaign,
        investigator_id=investigator_id,
        ending_id="ending-unlinked-guard",
        inflight_path=inflight,
    )
    marker_path = (
        campaign_ws["coc_root"] / "investigators" / investigator_id
        / "development-active-transaction.json"
    )
    assert marker["phase"] == "creating" and marker_path.is_file()
    before = _game_file_bytes(campaign_ws["workspace"])

    blocked = _run(
        campaign_ws,
        "rules.first_aid",
        {
            "investigator": investigator_id,
            "skill_value": 60,
            "decision_id": "unlinked-first-aid-guard",
            "seed": 2,
        },
    )

    assert blocked["ok"] is False
    assert blocked["error"]["code"] == "recovery_conflict"
    assert blocked["recovery"]["status"] == "RECOVERY_CONFLICT"
    assert blocked["recovery"]["transaction_id"] == marker["transaction_id"]
    assert _game_file_bytes(campaign_ws["workspace"]) == before


def test_combat_conclusion_synchronously_settles_development_once(
    campaign_ws, monkeypatch
):
    monkeypatch.setattr(
        coc_toolbox,
        "_ending_rng",
        lambda _ctx, _investigator_id: random.Random(5),
    )
    investigator_id = campaign_ws["investigator_id"]
    clue = _run(
        campaign_ws,
        "state.record_clue",
        {
            "clue_id": "clue-own-dagger-ends-him",
            "method": "structured fixture discovery",
            "decision_id": "settle-own-dagger-clue",
        },
    )
    assert clue["ok"] is True
    moved = _run(
        campaign_ws,
        "state.move_scene",
        {"scene_id": "corbitt-confrontation", "decision_id": "settle-move"},
    )
    assert moved["ok"] is True

    character_path = (
        campaign_ws["coc_root"] / "investigators" / investigator_id
        / "character.json"
    )
    brawl_before = json.loads(character_path.read_text(encoding="utf-8"))[
        "skills"
    ]["Fighting (Brawl)"]
    combat = _run(
        campaign_ws,
        "combat.resolve",
        {
            "affordance_id": "strike-with-his-dagger",
            "investigator": investigator_id,
            "decision_id": "settle-combat",
            "seed": 0,
        },
    )
    assert combat["ok"] is True, combat
    assert combat["data"]["combat"]["status"] == "concluded"
    assert combat["data"]["combat"]["outcome"] == "investigators_win"
    assert combat["data"]["improvement_ticks_recorded"] == [
        "Fighting (Brawl)"
    ]
    state_path = (
        campaign_ws["campaign_dir"] / "save" / "investigator-state"
        / f"{investigator_id}.json"
    )
    assert json.loads(state_path.read_text(encoding="utf-8"))[
        "skill_checks_earned"
    ] == ["Fighting (Brawl)"]
    combat_roll_path = campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl"
    combat_rolls_before_replay = combat_roll_path.read_text(encoding="utf-8")
    replayed_combat = _run(
        campaign_ws,
        "combat.resolve",
        {
            "affordance_id": "strike-with-his-dagger",
            "investigator": investigator_id,
            "decision_id": "settle-combat",
            "seed": 999,
        },
    )
    assert replayed_combat["ok"] is True
    assert replayed_combat["data"] == combat["data"]
    assert combat_roll_path.read_text(encoding="utf-8") == combat_rolls_before_replay
    assert json.loads(state_path.read_text(encoding="utf-8"))[
        "skill_checks_earned"
    ] == ["Fighting (Brawl)"]

    end_args = {
        "kind": "conclusion",
        "summary": "Corbitt is destroyed.",
        "decision_id": "settle-ending",
    }
    ended = _run(campaign_ws, "state.end_session", end_args)
    assert ended["ok"] is True, ended
    assert ended["data"]["development"]["status"] == "PASS"
    settlement = ended["data"]["development"]["settlements"][0]
    assert settlement["status"] == "PASS"
    receipt = settlement["receipt"]
    result = receipt["result"]
    ending_id = ended["data"]["ending_id"]
    capsule = coc_toolbox.coc_development.load_ending_settlement_capsule(
        campaign_ws["campaign_dir"], ending_id
    )
    assert capsule is not None
    assert capsule["ending_id"] == ending_id
    assert capsule["event_id"] == (
        coc_toolbox.coc_development.ending_event_id(ending_id)
    )
    assert capsule["event_ref"] == f"logs/events.jsonl#{capsule['event_id']}"
    assert capsule["decision_id"] == end_args["decision_id"]
    assert capsule["conclusion_id"] == "corbitt-destroyed"
    assert capsule["development_inputs"][investigator_id][
        "skills_checked"
    ] == ["Fighting (Brawl)"]
    assert capsule["rng_identity"][investigator_id] == {
        "algorithm": "python-random-seed-v1",
        "seed_material": (
            f"{ending_id}:{investigator_id}:development.settle"
        ),
    }
    assert capsule["source_digest"]["combat_snapshot"]["exists"] is True
    assert len(capsule["source_digest"]["combat_snapshot"]["sha256"]) == 64
    assert capsule["source_digest"]["story_graph"]["exists"] is True
    assert len(capsule["source_digest"]["story_graph"]["sha256"]) == 64
    assert result["skills_checked"] == ["Fighting (Brawl)"]
    assert result["ending_evidence"]["conclusion_id"] == "corbitt-destroyed"
    conclusion_evidence = result["ending_evidence"]["conclusion_evidence"]
    assert conclusion_evidence == {
        "kind": "combat_outcome",
        "combat_id": "combat-corbitt-confrontation",
        "combat_outcome": "investigators_win",
        "scene_ref": "scene/corbitt-confrontation",
        "event_type": "combat_ended",
        "event_ref": conclusion_evidence["event_ref"],
        "event_sha256": conclusion_evidence["event_sha256"],
    }
    assert conclusion_evidence["event_ref"].startswith("logs/events.jsonl#")
    assert len(conclusion_evidence["event_sha256"]) == 64
    assert result["scenario_san_reward_expr"] == "1D6"
    assert result["scenario_san_reward"]["expression"] == "1D6"
    improvement_check = result["improvement_checks"][0]
    assert improvement_check["skill"] == "Fighting (Brawl)"
    assert improvement_check["value_before"] == brawl_before
    assert json.loads(character_path.read_text(encoding="utf-8"))["skills"][
        "Fighting (Brawl)"
    ] == improvement_check["value_after"]
    assert result["skills_improved"] == (
        [improvement_check] if improvement_check["improved"] else []
    )
    assert json.loads(state_path.read_text(encoding="utf-8"))[
        "skill_checks_earned"
    ] == []

    roll_path = campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl"
    rolls = _read_jsonl(roll_path)
    kinds = [row.get("payload", {}).get("kind") for row in rolls]
    assert kinds.count("development_check") == 1
    assert kinds.count("development_gain") == int(improvement_check["improved"])
    assert kinds.count("luck_recovery") == 1
    assert kinds.count("scenario_san_reward") == 1
    scenario_roll = next(
        row for row in rolls
        if row.get("payload", {}).get("kind") == "scenario_san_reward"
    )
    assert scenario_roll["visibility"] == "public"
    assert scenario_roll["payload"]["die"] == "1D6"
    roll_ids = [row["roll_id"] for row in rolls]
    assert len(roll_ids) == len(set(roll_ids))
    assert all(row.get("source_ref") == f"logs/rolls.jsonl#{row['roll_id']}"
               for row in rolls)
    assert all(row.get("payload", {}).get("roll_id") == row["roll_id"]
               for row in rolls)

    rolls_before_retry = roll_path.read_text(encoding="utf-8")
    replay = _run(
        campaign_ws,
        "development.settle",
        {
            "investigator": investigator_id,
            "decision_id": "settle-explicit-replay",
            "seed": 999,
        },
    )
    duplicate_replay = _run(
        campaign_ws,
        "development.settle",
        {
            "investigator": investigator_id,
            "decision_id": "settle-explicit-replay",
            "seed": 1,
        },
    )
    duplicate_ending = _run(campaign_ws, "state.end_session", end_args)
    assert replay["ok"] and duplicate_replay["ok"] and duplicate_ending["ok"]
    assert replay["data"]["receipt"] == receipt
    assert duplicate_replay["data"] == replay["data"]
    assert duplicate_ending["data"] == ended["data"]
    assert roll_path.read_text(encoding="utf-8") == rolls_before_retry
    events = _read_jsonl(campaign_ws["campaign_dir"] / "logs" / "events.jsonl")
    ending_event = next(
        row for row in events
        if row.get("event_type") == "session_ending"
        and row.get("decision_id") == "settle-ending"
    )
    assert ending_event["ending_id"] == ending_id
    assert ending_event["event_id"] == capsule["event_id"]
    assert ending_event["settlement_capsule_sha256"] == capsule[
        "capsule_sha256"
    ]
    assert ending_event["settlement_capsule_ref"] == (
        f"save/development-settlements/endings/{ending_id}/capsule.json"
    )
    assert len([
        row for row in events
        if row.get("event_type") == "session_ending"
        and row.get("decision_id") == "settle-ending"
    ]) == 1
    assert len([
        row for row in events
        if row.get("event_type") == "reward"
        and row.get("source") == "conclusion_rewards"
    ]) == 1


def test_party_conclusion_rewards_both_and_migrates_legacy_sanity_once(
    campaign_ws, monkeypatch
):
    monkeypatch.setattr(
        coc_toolbox,
        "_ending_rng",
        lambda _ctx, investigator_id: random.Random(
            5 if investigator_id == campaign_ws["investigator_id"] else 7
        ),
    )
    thomas_id = campaign_ws["investigator_id"]
    eleanor_id = _add_eleanor_to_party(campaign_ws)
    sanity_engine = coc_toolbox.coc_runtime_ops.coc_sanity
    legacy_session = sanity_engine.SanitySession(
        thomas_id,
        san_max=99,
        int_value=70,
        rng=random.Random(1),
        campaign_dir=campaign_ws["campaign_dir"],
    )
    legacy_session.san_current = 40
    legacy_session.day_start_san = 40
    legacy_path = campaign_ws["campaign_dir"] / "save" / "sanity.json"
    _write_json(legacy_path, legacy_session.snapshot())
    per_sanity_dir = campaign_ws["campaign_dir"] / "save" / "sanity-state"
    assert not per_sanity_dir.exists()

    assert _run(
        campaign_ws,
        "state.record_clue",
        {
            "clue_id": "clue-own-dagger-ends-him",
            "method": "party settlement fixture",
            "decision_id": "party-settle-clue",
        },
    )["ok"]
    assert _run(
        campaign_ws,
        "state.move_scene",
        {
            "scene_id": "corbitt-confrontation",
            "decision_id": "party-settle-move",
        },
    )["ok"]
    combat = _run(
        campaign_ws,
        "combat.resolve",
        {
            "affordance_id": "strike-with-his-dagger",
            "investigator": thomas_id,
            "decision_id": "party-settle-combat",
            "seed": 0,
        },
    )
    assert combat["ok"] is True
    assert combat["data"]["combat"]["outcome"] == "investigators_win"

    end_args = {
        "kind": "conclusion",
        "summary": "Both investigators survive Corbitt's destruction.",
        "decision_id": "party-settle-ending",
    }
    ended = _run(campaign_ws, "state.end_session", end_args)
    assert ended["ok"] is True, ended
    assert ended["data"]["investigator_ids"] == [thomas_id, eleanor_id]
    assert ended["data"]["development"]["status"] == "PASS"
    settlements = ended["data"]["development"]["settlements"]
    assert [row["investigator_id"] for row in settlements] == [
        thomas_id, eleanor_id
    ]
    assert all(row["status"] == "PASS" for row in settlements)
    assert all(
        row["receipt"]["result"]["scenario_san_reward_applied"] is True
        for row in settlements
    )

    ending_event = next(
        row for row in _read_jsonl(
            campaign_ws["campaign_dir"] / "logs" / "events.jsonl"
        )
        if row.get("event_type") == "session_ending"
        and row.get("decision_id") == end_args["decision_id"]
    )
    assert ending_event["investigator_ids"] == [thomas_id, eleanor_id]
    sanity_paths = {
        investigator_id: sanity_engine.sanity_snapshot_path(
            campaign_ws["campaign_dir"], investigator_id
        )
        for investigator_id in [thomas_id, eleanor_id]
    }
    assert all(path.is_file() for path in sanity_paths.values())
    assert len(list(per_sanity_dir.glob("*.json"))) == 2
    legacy = json.loads(legacy_path.read_text(encoding="utf-8"))
    thomas_sanity = json.loads(
        sanity_paths[thomas_id].read_text(encoding="utf-8")
    )
    eleanor_sanity = json.loads(
        sanity_paths[eleanor_id].read_text(encoding="utf-8")
    )
    assert legacy["investigator_id"] == thomas_id
    assert legacy == thomas_sanity
    assert eleanor_sanity["investigator_id"] == eleanor_id
    assert thomas_sanity["san_current"] != eleanor_sanity["san_current"]

    rolls_path = campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl"
    events_path = campaign_ws["campaign_dir"] / "logs" / "events.jsonl"
    rolls_before_replay = rolls_path.read_bytes()
    events_before_replay = events_path.read_bytes()
    replay = _run(campaign_ws, "state.end_session", end_args)
    assert replay["ok"] is True
    assert replay["data"] == ended["data"]
    assert rolls_path.read_bytes() == rolls_before_replay
    assert events_path.read_bytes() == events_before_replay
    rolls = _read_jsonl(rolls_path)
    scenario_rolls = [
        row for row in rolls
        if row.get("payload", {}).get("kind") == "scenario_san_reward"
    ]
    assert {row["actor"] for row in scenario_rolls} == {thomas_id, eleanor_id}
    assert len(scenario_rolls) == 2
    assert len({row["roll_id"] for row in rolls}) == len(rolls)
    reward_events = [
        row for row in _read_jsonl(events_path)
        if row.get("event_type") == "reward"
        and row.get("source") == "conclusion_rewards"
    ]
    assert {row["actor_id"] for row in reward_events} == {thomas_id, eleanor_id}
    assert len(reward_events) == 2
    assert all(len(list((
        campaign_ws["campaign_dir"]
        / "save"
        / "development-settlements"
        / "conclusion-rewards"
        / investigator_id
    ).glob("*.json"))) == 1 for investigator_id in [thomas_id, eleanor_id])

    # Migration is one-way: once Thomas has a canonical per-investigator file,
    # a stale legacy singleton cannot supersede it on a later load.
    canonical_thomas_san = json.loads(
        sanity_paths[thomas_id].read_text(encoding="utf-8")
    )["san_current"]
    stale_legacy = json.loads(legacy_path.read_text(encoding="utf-8"))
    stale_legacy["san_current"] = 1
    _write_json(legacy_path, stale_legacy)
    migrated_thomas = sanity_engine.SanitySession.load(
        campaign_ws["campaign_dir"], thomas_id, rng=random.Random(30)
    )
    assert migrated_thomas.san_current == canonical_thomas_san
    migrated_thomas.save(campaign_ws["campaign_dir"], strict_mirror=True)

    # The migrated singleton remains Thomas's compatibility mirror.  Eleanor
    # subsequently writes only her canonical file; Thomas then writes his own
    # file and mirror without altering Eleanor's state.
    thomas_bytes_before = sanity_paths[thomas_id].read_bytes()
    legacy_bytes_before = legacy_path.read_bytes()
    eleanor_session = sanity_engine.SanitySession.load(
        campaign_ws["campaign_dir"], eleanor_id, rng=random.Random(31)
    )
    eleanor_session.gain_san(1, source="independence-test")
    eleanor_session.save(campaign_ws["campaign_dir"], strict_mirror=True)
    eleanor_bytes_after = sanity_paths[eleanor_id].read_bytes()
    assert sanity_paths[thomas_id].read_bytes() == thomas_bytes_before
    assert legacy_path.read_bytes() == legacy_bytes_before
    thomas_session = sanity_engine.SanitySession.load(
        campaign_ws["campaign_dir"], thomas_id, rng=random.Random(32)
    )
    thomas_session.gain_san(1, source="independence-test")
    thomas_session.save(campaign_ws["campaign_dir"], strict_mirror=True)
    assert sanity_paths[eleanor_id].read_bytes() == eleanor_bytes_after
    assert json.loads(legacy_path.read_text(encoding="utf-8")) == json.loads(
        sanity_paths[thomas_id].read_text(encoding="utf-8")
    )


def test_bonus_die_only_combat_success_preserves_06_66_evidence_without_tick(
    campaign_ws,
):
    investigator_id = campaign_ws["investigator_id"]
    session = coc_combat.CombatSession(
        "combat-bonus-tick",
        "scene/bonus-tick",
        0,
        random.Random(0),
    )
    session.add_participant(
        investigator_id,
        "investigator",
        dex=50,
        combat_skill=50,
        build=0,
        hp_max=10,
    )
    outcome, record = session._percentile(
        investigator_id,
        "Spot Hidden",
        50,
        "notice the hidden attacker",
        bonus=1,
    )
    assert outcome == "extreme"
    assert record["roll"] == 6
    assert record["tens_values"] == [6, 0]
    assert record["units"] == 6
    assert record["effective_modifier"] == {
        "bonus": 1,
        "penalty": 0,
        "net": 1,
    }
    assert record["bonus_die_only_success"] is True
    assert record["excluded_outcome"] == "bonus_die_only_success"
    assert record["unmodified_roll"] == 66
    pending_rolls, pending_events = session.drain_pending()
    assert pending_rolls == [record]
    assert pending_events == []

    state_path = (
        campaign_ws["campaign_dir"]
        / "save"
        / "investigator-state"
        / f"{investigator_id}.json"
    )
    legacy_tick_path = (
        campaign_ws["coc_root"]
        / "investigators"
        / investigator_id
        / "development.jsonl"
    )
    state_before = state_path.read_bytes()
    legacy_before = legacy_tick_path.read_bytes()
    ctx = coc_toolbox.Ctx(campaign_ws["workspace"], campaign_ws["campaign_id"])
    recorded = coc_toolbox._record_combat_improvement_ticks(
        ctx,
        investigator_id=investigator_id,
        events=[{"event_type": "combat_roll", **pending_rolls[0]}],
    )
    assert recorded == []
    assert state_path.read_bytes() == state_before
    assert legacy_tick_path.read_bytes() == legacy_before

    natural = coc_combat.CombatSession(
        "combat-natural-bonus-order",
        "scene/bonus-tick",
        0,
        random.Random(5),
    )
    natural.add_participant(
        investigator_id,
        "investigator",
        dex=50,
        combat_skill=50,
        build=0,
        hp_max=10,
    )
    natural_outcome, natural_record = natural._percentile(
        investigator_id,
        "Spot Hidden",
        50,
        "notice without needing the bonus die",
        bonus=1,
    )
    assert natural_outcome == "regular"
    assert natural_record["tens_values"] == [4, 5]
    assert natural_record["units"] == 9
    assert natural_record["roll"] == 49
    assert natural_record["unmodified_roll"] == 49
    assert natural_record["bonus_die_only_success"] is False
    assert natural_record["excluded_outcome"] is None
    assert coc_toolbox.coc_development.skill_tick_eligible(
        "Spot Hidden", natural_record
    ) is True


# --------------------------------------------------------------------------- #
# Soft-rule advisory behavior
# --------------------------------------------------------------------------- #


def _activate_newspaper_morgue(campaign_ws: dict) -> None:
    world_path = campaign_ws["campaign_dir"] / "save" / "world-state.json"
    world = json.loads(world_path.read_text(encoding="utf-8"))
    world["active_scene_id"] = "newspaper-morgue"
    _write_json(world_path, world)


def test_contextual_authored_routes_prevent_false_rolls_and_settle_direct_handouts(
    campaign_ws,
):
    _activate_newspaper_morgue(campaign_ws)
    access = _run(campaign_ws, "rules.roll", {
        "investigator": campaign_ws["investigator_id"],
        "skill": "Persuade",
        "target": 100,
        "difficulty": "regular",
        "goal": "说服 Arty 允许进入剪报库",
        "stakes": {
            "on_success": "Arty 允许进入剪报库",
            "on_failure": "Arty 拒绝开放剪报库",
        },
        "difficulty_basis": "authored_gate",
        "resolution_context": {
            "attempt_id": "route:newspaper-morgue:persuade-arty",
            "scene_id": "newspaper-morgue",
            "route_id": "persuade-arty",
            "roll_density_group": "route:newspaper-morgue:persuade-arty",
        },
        "decision_id": "persuade-arty-success",
        "seed": 2,
    })
    assert access["ok"] is True, access
    assert access["data"]["success"] is True

    hot_context = _run(campaign_ws, "scene.context")
    direct_summary = next(
        row for row in hot_context["data"]["action_routes"]
        if row["route_id"] == "search-clippings"
    )
    assert direct_summary["resolution_kind"] == "direct_delivery"
    assert "operation_opportunities" not in direct_summary

    advised = _run(campaign_ws, "actions.advise", {
        "investigator": campaign_ws["investigator_id"],
        "intent_evidence": {
            "primary_intent": "investigate",
            "reason": "调查员已获准进入剪报库并按地址翻找旧稿。",
            "matched_affordance_ids": ["search-clippings"],
        },
    })
    assert advised["ok"] is True, advised
    resolution = advised["data"]["resolution_advice"]
    assert resolution["route_id"] == "search-clippings"
    assert resolution["resolution_kind"] == "direct_delivery"
    operations = resolution["operation_opportunities"]
    assert [row["operation"] for row in operations] == [
        "state.record_clue", "state.record_clue",
    ]
    assert all(row["hard_gate"] is False for row in advised["data"]["action_routes"])

    results = []
    for index, operation in enumerate(operations, start=1):
        results.append(_run(
            campaign_ws,
            operation["operation"],
            {
                **operation["prefilled_arguments"],
                "decision_id": f"direct-clipping-{index}",
            },
        ))
    assert all(row["ok"] is True for row in results)
    assert results[0]["data"]["route_completion"] is None
    assert results[1]["data"]["route_completion"]["route_id"] == "search-clippings"
    world = json.loads((
        campaign_ws["campaign_dir"] / "save" / "world-state.json"
    ).read_text(encoding="utf-8"))
    consumed = {
        row["route_id"] for row in world.get("route_completion_receipts") or []
        if row.get("status") == "consumed"
    }
    assert {"persuade-arty", "search-clippings"}.issubset(consumed)
    roll_rows = _read_jsonl(campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl")
    assert len(roll_rows) == 1


def test_npc_engagement_semantically_completes_access_route_without_extra_roll(
    campaign_ws,
):
    _activate_newspaper_morgue(campaign_ws)
    reaction = _run(campaign_ws, "npc.reaction", {
        "npc_id": "npc-arty-wilmot",
        "npc_display_name": "阿尔蒂·威尔莫特",
        "investigator": campaign_ws["investigator_id"],
        "context": {
            "player_conduct": "调查员专业说明来意并尊重编辑室边界",
            "scene_constraints": "阿尔蒂掌握地下剪报库的准入",
            "authored_or_relationship_boundary": "放行不改变其守门人议程",
            "semantic_reason": "首次接触决定即时准入摩擦",
        },
        "seed": 2,
        "decision_id": "arty-alternate-access-reaction",
    })
    assert reaction["ok"] is True, reaction
    engagement_card = reaction["data"]["record_engagement_operation"]
    engagement = _run(campaign_ws, engagement_card["operation"], {
        **engagement_card["prefilled_arguments"],
        "interaction_kind": "assistance",
        "decision_id": "arty-alternate-access-engagement",
        "first_impression_realization": {
            "observable_manner": "阿尔蒂收起拒人的架势，朝地下室门一抬下巴",
            "causal_explanation": "专业而克制的初见让他把调查员当成可放行的正经访客",
            "boundary_preserved": "他仍守着编辑室与未刊材料的权限边界",
            "opportunity_or_friction": "他允许进入剪报库并指名露丝按名调档",
        },
        "route_completion": {
            "scene_id": "newspaper-morgue",
            "route_id": "persuade-arty",
            "semantic_reason": "阿尔蒂已在本次有来源的首次接触中明确放行",
        },
    })
    assert engagement["ok"] is True, engagement
    assert any("persuade-arty" in hint for hint in engagement["hints"])

    world = json.loads((
        campaign_ws["campaign_dir"] / "save" / "world-state.json"
    ).read_text(encoding="utf-8"))
    route_receipt = next(
        row for row in world["route_completion_receipts"]
        if row["route_id"] == "persuade-arty"
    )
    assert route_receipt["status"] == "consumed"
    assert route_receipt["completion_quality"] == "keeper_judgment"
    assert route_receipt["hard_gate"] is False
    assert route_receipt["semantic_reason"].startswith("阿尔蒂已")

    context = _run(campaign_ws, "scene.context")
    routes = {row["route_id"]: row for row in context["data"]["action_routes"]}
    assert "persuade-arty" not in routes
    assert routes["search-clippings"]["resolution_kind"] == "direct_delivery"
    advised = _run(campaign_ws, "actions.advise", {
        "intent_evidence": {
            "primary_intent": "search_clippings",
            "reason": "玩家已获准入并明确按地址翻查剪报",
            "matched_affordance_ids": ["search-clippings"],
        },
    })
    assert advised["ok"] is True, advised
    assert [
        row["operation"]
        for row in advised["data"]["resolution_advice"]["operation_opportunities"]
    ] == ["state.record_clue", "state.record_clue"]


def test_route_completion_repairs_older_structured_evidence_without_save_edit(
    campaign_ws,
):
    _activate_newspaper_morgue(campaign_ws)
    reaction = _run(campaign_ws, "npc.reaction", {
        "npc_id": "npc-arty-wilmot",
        "npc_display_name": "阿尔蒂·威尔莫特",
        "investigator": campaign_ws["investigator_id"],
        "context": {
            "player_conduct": "调查员清楚说明来意",
            "scene_constraints": "阿尔蒂掌握剪报库准入",
            "authored_or_relationship_boundary": "准入不等于交出编辑室秘密",
            "semantic_reason": "首次接触影响当场放行机会",
        },
        "seed": 2,
        "decision_id": "legacy-arty-reaction",
    })
    assert reaction["ok"] is True, reaction
    repaired = _run(campaign_ws, "state.record_route_completion", {
        "scene_id": "newspaper-morgue",
        "route_id": "persuade-arty",
        "semantic_reason": "既有初印象收据已由 KP 在桌面实现为阿尔蒂明确放行",
        "evidence_ref": reaction["data"]["first_impression_ref"],
        "decision_id": "repair-legacy-arty-access-route",
    })
    assert repaired["ok"] is True, repaired
    assert repaired["data"]["completed"] is True
    receipt = repaired["data"]["route_completion"]
    assert receipt["route_id"] == "persuade-arty"
    assert receipt["completion_quality"] == "keeper_judgment"
    assert receipt["evidence_ref"] == reaction["data"]["first_impression_ref"]
    assert repaired["data"]["next_operation"] == {
        "operation": "scene.context",
        "invoke_via": "coc_invoke",
        "prefilled_arguments": {},
        "missing_arguments": [],
        "reason": (
            "Refresh the bounded active-scene route index after recording "
            "this campaign-local semantic completion."
        ),
        "hard_gate": False,
    }
    assert _run(campaign_ws, "state.record_route_completion", {
        "scene_id": "newspaper-morgue",
        "route_id": "persuade-arty",
        "semantic_reason": "既有初印象收据已由 KP 在桌面实现为阿尔蒂明确放行",
        "evidence_ref": reaction["data"]["first_impression_ref"],
        "decision_id": "repair-legacy-arty-access-route",
    })["data"] == repaired["data"]


def test_same_attempt_retry_is_soft_advice_and_survives_resume(campaign_ws):
    _activate_newspaper_morgue(campaign_ws)
    story_path = campaign_ws["campaign_dir"] / "scenario" / "story-graph.json"
    story = json.loads(story_path.read_text(encoding="utf-8"))
    morgue = next(
        row for row in story["scenes"] if row["scene_id"] == "newspaper-morgue"
    )
    persuade = next(
        row for row in morgue["affordances"] if row["id"] == "persuade-arty"
    )
    persuade["roll_gate"]["retry_policy"] = {
        "mode": "elapsed_time_reset",
        "minimum_elapsed_minutes": 60,
    }
    _write_json(story_path, story)
    context = {
        "attempt_id": "archive-index-attempt",
        "scene_id": "newspaper-morgue",
        "route_id": "persuade-arty",
        "roll_density_group": "archive-index",
    }
    first = _run(campaign_ws, "rules.roll", {
        "target": 1,
        "resolution_context": context,
        "decision_id": "soft-attempt-one",
        "seed": 2,
    })
    assert first["ok"] is True
    assert first["data"]["success"] is False
    opportunity = first["data"]["operation_opportunities"][0]
    assert opportunity["hard_gate"] is False
    assert opportunity["suggested_operation"]["operation"] == "rules.push"
    assert opportunity["attempt_pressure"]["same_goal_no_progress_count"] == 1
    assert opportunity["retry_status"]["status"] == "waiting"

    second = _run(campaign_ws, "rules.roll", {
        "target": 1,
        "resolution_context": context,
        "decision_id": "soft-attempt-two",
        "seed": 2,
    })
    assert second["ok"] is True
    assert second["data"]["attempt_advisory"]["hard_gate"] is False
    assert second["data"]["attempt_pressure"]["same_goal_no_progress_count"] == 2
    assert any("soft advice only" in warning for warning in second["warnings"])

    resumed = _run(campaign_ws, "session.resume")
    assert resumed["ok"] is True, resumed
    open_attempts = resumed["data"]["operation_opportunities"]
    assert open_attempts[-1]["source"]["decision_id"] == "soft-attempt-two"
    assert open_attempts[-1]["hard_gate"] is False
    assert open_attempts[-1]["attempt_pressure"]["same_goal_no_progress_count"] == 2

    advanced = _run(campaign_ws, "state.advance_time", {
        "minutes": 60,
        "reason": "等待作者声明的重新尝试窗口",
        "decision_id": "soft-attempt-wait",
    })
    assert advanced["ok"] is True
    advised = _run(campaign_ws, "actions.advise", {
        "intent_evidence": {
            "primary_intent": "retry_editor_access",
            "reason": "作者结构化等待窗口已经由权威时间记录满足。",
            "matched_affordance_ids": ["persuade-arty"],
        },
    })
    reset_retry = advised["data"]["resolution_advice"]
    assert reset_retry["resolution_kind"] == "reset_retry"
    assert reset_retry["hard_gate"] is False
    assert reset_retry["operation_opportunities"]
    reset_context = reset_retry["operation_opportunities"][0][
        "prefilled_arguments"
    ]["resolution_context"]
    assert reset_context["reset_evidence"]["policy_mode"] == "elapsed_time_reset"
    assert reset_context["reset_evidence"]["elapsed_minutes"] == 60


def test_actions_advise_combines_stable_storylet_and_adoption_updates_ledger(
    campaign_ws, monkeypatch,
):
    candidate = {
        "storylet_id": "test-longrun-pressure",
        "family_id": "longrun",
        "trope_id": "world_moves",
        "title": "世界不会干等",
        "cue": "调查员核对资料时，窗外报童突然喊出一条与旧宅有关的新消息。",
        "beat": "pressure",
        "conflict_level": "rising",
        "target_conflict_level": "rising",
        "bound_entities": {"location_id": "campaign-opening"},
        "rolled_variants": {},
        "presentation_mode": "fictional_beat",
        "grounding_contract": {"status": "authorized"},
        "serves": ["pacing"],
    }
    monkeypatch.setattr(
        coc_toolbox.coc_storylets,
        "select_storylet_moves",
        lambda *args, **kwargs: [deepcopy(candidate)],
    )
    args = {
        "player_text": "我继续核对眼前的资料，同时留意房间里的动静。",
        "intent_evidence": {
            "primary_intent": "investigate",
            "reason": "玩家继续调查，但也明确关注环境变化。",
            "matched_affordance_ids": [],
        },
    }
    first = _run(campaign_ws, "actions.advise", args)
    second = _run(campaign_ws, "actions.advise", args)
    assert first["ok"] is True, first
    assert second["ok"] is True, second
    opportunity = first["data"]["narrative_opportunity"]
    assert opportunity is not None
    assert opportunity["hard_gate"] is False
    assert opportunity["candidate_ref"].startswith("storylet-candidate-v1:")
    assert opportunity["adoption_operation"]["prefilled_arguments"] == {
        "advice_id": opportunity["advice_id"],
        "candidate_ref": opportunity["candidate_ref"],
    }
    assert opportunity == second["data"]["narrative_opportunity"]

    ctx = coc_toolbox.Ctx(campaign_ws["workspace"], campaign_ws["campaign_id"])
    legacy = coc_toolbox._normalize_finalized_advisory_uptake(
        ctx,
        {
            "advice_id": opportunity["advice_id"],
            "disposition": "modified",
            "reason": "兼容旧宿主的完整候选输入。",
            "adopted_fields": ["candidate.cue"],
            "storylet_candidate": opportunity["candidate"],
            "exact_excerpt": "兼容候选",
        },
        draft="兼容候选",
    )
    assert legacy["candidate_ref"] == opportunity["candidate_ref"]

    journal = _run(campaign_ws, "state.journal", {
        "summary": "调查员继续核对资料，同时留意环境变化。",
        "player_action": "核对资料并留意周围动静",
        "player_text": args["player_text"],
        "decision_id": "journal-longrun-pressure",
    })
    assert journal["ok"] is True, journal
    output = _run(campaign_ws, "turn.output_context")
    assert output["ok"] is True, output
    assert output["data"]["narrative_opportunity"] == opportunity
    excerpt = "窗外报童忽然扯开嗓子，喊出一条与旧宅有关的新消息。"
    finalized = _run(campaign_ws, "turn.finalize", {
        "draft": "纸页在指间沙沙作响。\n\n" + excerpt,
        "coverage": [],
        "mechanics_placements": [],
        "decision_id": "finalize-longrun-pressure",
        "advisory_uptake": {
            "advice_id": opportunity["advice_id"],
            "disposition": "modified",
            "reason": "保留世界主动变化的功能，并改写成当前场景可直接听见的报童叫卖。",
            "adopted_fields": ["candidate.cue", "candidate.beat"],
            "candidate_ref": opportunity["candidate_ref"],
            "exact_excerpt": excerpt,
        },
    })
    assert finalized["ok"] is True, finalized
    ledger = json.loads((
        campaign_ws["campaign_dir"] / "save" / "storylet-ledger.json"
    ).read_text(encoding="utf-8"))
    assert ledger["last_storylet_id"] == "test-longrun-pressure"
    adoption_rows = [
        json.loads(line)
        for line in (
            campaign_ws["campaign_dir"] / "logs" / "advisory-adoptions.jsonl"
        ).read_text(encoding="utf-8").splitlines()
    ]
    assert adoption_rows[-1]["finalization_id"] == finalized["data"]["finalization_id"]
    assert adoption_rows[-1]["exact_excerpt"] == excerpt


def test_director_advise_is_advisory_not_blocking(campaign_ws):
    envelope = _run(campaign_ws, "director.advise", {
        "player_text": "我检查房间里刚才异响的来源。",
        "intent_evidence": {
            "primary_intent": "investigate_scene",
            "reason": "玩家明确要寻找当前场景中异响的来源。",
        },
    })
    assert envelope["ok"] is True
    data = envelope["data"]
    assert data["authority"] == "advisory"
    assert data["advice_id"].startswith("director:")
    assert isinstance(data["candidate_plan"], dict)
    assert data["intent_evidence"]["primary_intent"] == "investigate_scene"
    # Advisory channel: hints/warnings, never a hard failure for normal play.
    assert isinstance(envelope["warnings"], list)
    assert any("candidate" in h for h in envelope["hints"])


def test_rich_advice_storylets_and_narration_are_canonically_reachable(campaign_ws):
    intent = {
        "primary_intent": "investigate_scene",
        "reason": "The player explicitly searches the active room for the source of a sound.",
    }
    player_text = "我检查房间里刚才异响的来源。"
    advised = _run(campaign_ws, "director.advise", {
        "player_text": player_text,
        "intent_evidence": intent,
        "seed": 7,
    })
    assert advised["ok"] is True
    plan = advised["data"]["candidate_plan"]

    storylets = _run(campaign_ws, "storylets.suggest", {
        "candidate_plan": plan,
        "player_text": player_text,
        "intent_evidence": intent,
        "seed": 7,
    })
    assert storylets["ok"] is True
    assert storylets["data"]["authority"] == "advisory"

    npc = _run(campaign_ws, "npc.advise", {"intent_evidence": intent, "seed": 7})
    assert npc["ok"] is True
    assert npc["data"]["authority"] == "advisory"

    narration = _run(campaign_ws, "narration.brief", {
        "candidate_plan": plan,
        "applied_events": [],
    })
    assert narration["ok"] is True
    assert narration["data"]["authority"] == "drafting_brief"
    assert narration["data"]["style_contract"]["register"] == "natural_tabletop_narration"
    uptake = narration["data"]["narration_envelope"]["action_uptake"]
    assert uptake["player_text"] == player_text
    assert uptake["primary_intent"] == "investigate_scene"
    assert uptake["authority"] == "player_message"
    assert uptake["render_policy"]["hard_gate"] is False
    assert "treat_current_action_uptake_as_semantic_repetition" in uptake["render_policy"]["do_not"]
    assert any("naturally enact" in hint for hint in narration["hints"])

    # The natural agent order may decide on a roll after consulting the
    # Director.  narration.brief must consume that settled toolbox receipt;
    # callers must not edit the advisory plan just to make the text layer see it.
    settled_roll = _run(campaign_ws, "rules.roll", {
        "skill": "Spot Hidden",
        "reason": "check the active room for the source of the sound",
        "seed": 29,
        "decision_id": "narration-applied-roll-1",
    })
    assert settled_roll["ok"] is True
    narration_after_roll = _run(campaign_ws, "narration.brief", {
        "candidate_plan": plan,
        "applied_events": [settled_roll["data"]],
    })
    projected_rolls = narration_after_roll["data"]["narration_envelope"]["rule_results"]
    assert len(projected_rolls) == 1
    assert projected_rolls[0]["roll_id"] == settled_roll["data"]["roll_id"]
    assert projected_rolls[0]["outcome"] == settled_roll["data"]["outcome"]
    assert projected_rolls[0]["success"] is (
        settled_roll["data"]["outcome"]
        in {"critical", "extreme", "hard", "regular", "success"}
    )

    # The canonical state remains authoritative even when a host omits the
    # state.move_scene receipt from applied_events.  The active scene anchor
    # and state grounding must never disagree about the investigator's
    # location merely because the agent assembled an incomplete receipt list.
    moved = _run(campaign_ws, "state.move_scene", {
        "scene_id": "central-library",
        "reason": "continue research at the public library",
        "decision_id": "narration-canonical-scene-1",
    })
    assert moved["ok"] is True
    narration_after_move = _run(campaign_ws, "narration.brief", {
        "candidate_plan": plan,
        "applied_events": [],
    })
    moved_envelope = narration_after_move["data"]["narration_envelope"]
    assert moved_envelope["scene_anchor"]["scene_id"] == "central-library"
    grounding = moved_envelope["state_grounding"]
    assert grounding["active_scene_before_id"] == plan["turn_input"]["active_scene_id"]
    assert grounding["active_scene_after_id"] == "central-library"
    assert grounding["scene_transition_committed"] is True
    assert grounding["recovery_required"] is False

    narration_with_stale_receipt = _run(campaign_ws, "narration.brief", {
        "candidate_plan": plan,
        "applied_events": [{
            "event_type": "scene_transition",
            "to_scene": plan["turn_input"]["active_scene_id"],
        }],
    })
    stale_grounding = (
        narration_with_stale_receipt["data"]["narration_envelope"]["state_grounding"]
    )
    assert stale_grounding["active_scene_after_id"] == "central-library"
    review = _run(campaign_ws, "narration.review", {
        "decision_id": "semantic-review-1",
        "draft_text": "店员已经彻底被恐惧支配，无法理性思考。",
        "findings": [{
            "rule_id": "observable_before_interpretation",
            "reason": "The draft asserts an NPC's hidden mental state without observable behavior or established evidence.",
        }],
    })
    assert review["ok"] is True
    assert review["data"]["hard_gate"] is False
    assert review["data"]["findings"][0]["reason"].startswith("The draft")


def test_personal_horror_and_adoption_receipts_prove_actual_use(campaign_ws):
    added = _run(campaign_ws, "state.personal_horror_add", {
        "hook_id": "hook-editor",
        "backstory_field": "significant_people",
        "summary": "The editor who buried the investigator's first story.",
        "decision_id": "hook-add-1",
    })
    assert added["ok"] is True
    queried = _run(campaign_ws, "personal_horror.query")
    assert queried["ok"] is True
    assert queried["data"]["personal_horror_hooks"][0]["woven"] is False

    woven = _run(campaign_ws, "state.personal_horror_mark_woven", {
        "hook_id": "hook-editor",
        "decision_id": "hook-woven-1",
    })
    assert woven["ok"] is True
    adoption = _run(campaign_ws, "evidence.record_adoption", {
        "decision_id": "turn-adoption-1",
        "advice_id": "director:1:example",
        "disposition": "modified",
        "reason": "The pressure fit, but the NPC move contradicted the live conversation.",
        "adopted_fields": ["candidate_plan.beat", "candidate_plan.tone"],
    })
    assert adoption["ok"] is True
    rows = _read_jsonl(campaign_ws["campaign_dir"] / "logs" / "advisory-adoptions.jsonl")
    assert rows[-1]["visibility"] == "keeper_internal"
    assert rows[-1]["disposition"] == "modified"


def test_adoption_receipt_records_emotional_tone_follow_through(campaign_ws):
    adoption = _run(campaign_ws, "evidence.record_adoption", {
        "decision_id": "turn-adoption-tone-1",
        "advice_id": "director:2:toneexample",
        "disposition": "modified",
        "reason": "Played Knott cold per the reaction roll; softened Arty's refusal.",
        "emotional_tone_adoption": [
            {"npc_id": "npc-steven-knott", "emotional_tone": "cold and suspicious", "adoption": "adopted"},
            {"npc_id": "npc-arty-wilmot", "emotional_tone": "guarded but civil", "adoption": "modified"},
        ],
    })
    assert adoption["ok"] is True
    tones = adoption["data"]["emotional_tone_adoption"]
    assert tones == [
        {"npc_id": "npc-steven-knott", "emotional_tone": "cold and suspicious", "adoption": "adopted"},
        {"npc_id": "npc-arty-wilmot", "emotional_tone": "guarded but civil", "adoption": "modified"},
    ]
    rows = _read_jsonl(campaign_ws["campaign_dir"] / "logs" / "advisory-adoptions.jsonl")
    assert rows[-1]["emotional_tone_adoption"] == tones

    # Absent param keeps the receipt shape unchanged (backward compatible).
    plain = _run(campaign_ws, "evidence.record_adoption", {
        "decision_id": "turn-adoption-tone-2",
        "advice_id": "director:2:plain",
        "disposition": "ignored",
        "reason": "No plan elements fit the live conversation.",
    })
    assert plain["ok"] is True
    assert "emotional_tone_adoption" not in plain["data"]

    bad_status = _run(campaign_ws, "evidence.record_adoption", {
        "decision_id": "turn-adoption-tone-3",
        "advice_id": "director:2:bad",
        "disposition": "adopted",
        "reason": "test",
        "emotional_tone_adoption": [
            {"npc_id": "npc-x", "emotional_tone": "warm", "adoption": "played"},
        ],
    })
    assert bad_status["ok"] is False
    assert bad_status["error"]["code"] == "invalid_param"

    missing_fields = _run(campaign_ws, "evidence.record_adoption", {
        "decision_id": "turn-adoption-tone-4",
        "advice_id": "director:2:missing",
        "disposition": "adopted",
        "reason": "test",
        "emotional_tone_adoption": [{"npc_id": "npc-x"}],
    })
    assert missing_fields["ok"] is False
    assert missing_fields["error"]["code"] == "invalid_param"


def test_full_sanity_session_is_reachable_through_shared_executor(campaign_ws):
    decision_id = "full-san-check-1"
    command = {
        "command_id": decision_id,
        "kind": "sanity_check",
        "phase": "resolve",
        "payload": {
            "decision_id": decision_id,
            "roll_id": decision_id,
            "skill": "SAN",
            "difficulty": "regular",
            "san_loss_success": 0,
            "san_loss_fail_expr": "1",
            "source": "A structured unnatural encounter",
        },
    }
    resolved = _run(campaign_ws, "sanity.execute", {
        "decision_id": decision_id,
        "command": command,
        "seed": 9,
    })
    assert resolved["ok"] is True
    assert resolved["data"]["authority"] == "deterministic_subsystem"
    context = _run(campaign_ws, "sanity.context")
    assert context["ok"] is True
    assert context["data"]["active"] is True


def test_full_sanity_session_consumes_authored_scene_trigger(campaign_ws):
    moved = _run(
        campaign_ws,
        "state.move_scene",
        {"scene_id": "upper-floor-bedroom", "decision_id": "full-san-move-bedroom"},
    )
    assert moved["ok"] is True
    trigger = _run(campaign_ws, "scene.context")["data"]["pending_san_triggers"][0]
    decision_id = "full-san-authored-trigger"
    command = {
        "command_id": decision_id,
        "kind": "sanity_check",
        "phase": "resolve",
        "payload": {
            "decision_id": decision_id,
            "roll_id": decision_id,
            "skill": "SAN",
            "difficulty": "regular",
            "san_loss_success": trigger["san_loss_success"],
            "san_loss_fail_expr": trigger["san_loss_fail_expr"],
            "source": trigger["source"],
            "trigger_id": trigger["trigger_id"],
        },
    }

    resolved = _run(
        campaign_ws,
        "sanity.execute",
        {"decision_id": decision_id, "command": command, "seed": 9},
    )

    assert resolved["ok"] is True
    check = resolved["data"]["results"][0]["events"][0]
    assert check["san_trigger_id"] == trigger["trigger_id"]
    assert _run(campaign_ws, "scene.context")["data"]["pending_san_triggers"] == []


def test_full_chase_session_is_reachable_through_shared_executor(campaign_ws):
    investigator_id = campaign_ws["investigator_id"]
    state = coc_state.load_investigator_state(campaign_ws["campaign_dir"], investigator_id)
    decision_id = "full-chase-start-1"
    participant = {
        "actor_id": investigator_id,
        "side": "quarry",
        "mov": 8,
        "dex": 60,
        "con": 50,
        "hp": int(state["current_hp"]),
        "fight": 50,
        "dodge": 30,
        "build": 0,
        "current_position": 1,
        "conditions": list(state.get("conditions") or []),
    }
    command = {
        "command_id": decision_id,
        "kind": "chase_start",
        "phase": "start",
        "payload": {
            "decision_id": decision_id,
            "chase_id": "chase-alley",
            "participants": [
                participant,
                {**participant, "actor_id": "pursuer-1", "side": "pursuer", "dex": 45, "current_position": 0},
            ],
            "locations": [
                {"label": "alley-mouth", "hazard": None, "barrier": None},
                {"label": "wet-stairs", "hazard": None, "barrier": None},
                {"label": "market", "hazard": None, "barrier": None},
            ],
        },
    }
    started = _run(campaign_ws, "chase.execute", {
        "decision_id": decision_id,
        "command": command,
        "seed": 4,
    })
    assert started["ok"] is True
    context = _run(campaign_ws, "chase.context")
    assert context["ok"] is True
    assert context["data"]["active"] is True
    assert context["data"]["snapshot"]["chase_id"] == "chase-alley"


def test_clues_query_returns_discovery_state_without_blocking(campaign_ws):
    envelope = _run(campaign_ws, "clues.query", {"undiscovered_only": True})
    assert envelope["ok"] is True
    assert isinstance(envelope["warnings"], list)
    assert isinstance(envelope["data"]["clues"], list)
    assert envelope["data"]["clues"]
    # Undiscovered clues remain marked secret for the keeper.
    assert all(c.get("secret") is True for c in envelope["data"]["clues"])
    assert all(c.get("discovered") is False for c in envelope["data"]["clues"])
    assert all(c.get("player_safe_summary") is None for c in envelope["data"]["clues"])
    assert all(c.get("localized_text") is None for c in envelope["data"]["clues"])
    assert all(
        "description" not in conclusion and "fallback_policy" not in conclusion
        for conclusion in envelope["data"]["conclusions"]
    )


def test_clues_query_cache_reuses_revision_and_invalidates_on_discovery(campaign_ws):
    first = _run(campaign_ws, "clues.query", {"undiscovered_only": True})
    revision = first["data"]["working_set"]["revision"]
    assert first["cache"]["status"] == "miss"

    cached = _run(campaign_ws, "clues.query", {"undiscovered_only": True})
    assert cached["cache"]["status"] == "hit"
    assert cached["data"] == first["data"]
    assert (campaign_ws["campaign_dir"] / cached["cache"]["ref"]).is_file()

    compact = _run(
        campaign_ws,
        "clues.query",
        {"undiscovered_only": True, "since_revision": revision},
    )
    assert compact["cache"]["status"] == "not_modified"
    assert compact["data"] == {
        "working_set": {
            "mode": "not_modified",
            "revision": revision,
            "read_domains": first["data"]["working_set"]["read_domains"],
        }
    }

    clue_id = _first_clue_id(campaign_ws["campaign_dir"])
    different_scope = _run(
        campaign_ws,
        "clues.query",
        {"clue_id": clue_id, "since_revision": revision},
    )
    assert different_scope["cache"]["status"] == "miss"
    assert different_scope["data"]["working_set"]["mode"] == "full"
    assert different_scope["data"]["working_set"]["revision"] != revision
    discovered = _run(
        campaign_ws,
        "state.record_clue",
        {
            "clue_id": clue_id,
            "method": "cache invalidation probe",
            "decision_id": "cache-discover-clue",
        },
    )
    assert discovered["ok"] is True
    refreshed = _run(
        campaign_ws,
        "clues.query",
        {"undiscovered_only": True, "since_revision": revision},
    )
    assert refreshed["cache"]["status"] == "miss"
    assert refreshed["data"]["working_set"]["mode"] == "full"
    assert refreshed["data"]["working_set"]["revision"] != revision
    assert clue_id not in {row["clue_id"] for row in refreshed["data"]["clues"]}
    query_receipts = [
        row
        for row in _read_jsonl(
            campaign_ws["campaign_dir"] / "logs" / "toolbox-calls.jsonl"
        )
        if row.get("tool") == "clues.query"
    ]
    assert query_receipts
    assert all("clues" not in (row.get("data") or {}) for row in query_receipts)
    assert any((row.get("data") or {}).get("projection_ref") for row in query_receipts)


def test_npc_query_preserves_authored_identity_contract(campaign_ws):
    envelope = _run(campaign_ws, "npc.query", {"npc_id": "npc-kim-debrun"})

    assert envelope["ok"] is True
    kim = envelope["data"]["npcs"][0]
    assert kim["origin"] == "source"
    assert kim["relationship_to_investigators"] == "court_contact"
    assert kim["social_role"]["authority_scope"] == ["specialist_knowledge"]
    assert kim["identity_ref"].startswith("npc-identity-v2:")
    assert kim["profile_revision_ref"].startswith("npc-profile-v2:")
    contract = kim["identity_contract"]
    assert contract["keeper_only"] is True
    assert contract["npc_id"] == "npc-kim-debrun"
    assert contract["role"]["relationship_to_investigators"] == "court_contact"
    assert contract["agenda"] == kim["agenda"]
    assert contract["voice"] == kim["voice"]
    assert contract["schedule"] == kim["schedule"]
    assert contract["location_provenance"]["authored_scene_ids"] == [
        "higher-courts-central-police"
    ]
    assert any("identity contract" in hint for hint in envelope["hints"])
    assert any("never invent a gendered pronoun" in hint for hint in envelope["hints"])


def test_npc_query_projects_campaign_local_npc_and_invalidates_on_first_impression(
    campaign_ws,
):
    npc_id = "npc-invented-port-clerk"
    updated = _run(campaign_ws, "state.npc_update", {
        "npc_id": npc_id,
        "trust_delta": 1,
        "decision_id": "campaign-local-query-state",
    })
    assert updated["ok"] is True

    before_reaction = _run(campaign_ws, "npc.query", {"npc_id": npc_id})
    assert before_reaction["ok"] is True
    revision = before_reaction["data"]["working_set"]["revision"]
    row = before_reaction["data"]["npcs"][0]
    assert row["origin"] == "improvised"
    assert row["name"] is None
    assert row["identity_ref"] is None
    assert row["profile_revision_ref"] is None
    assert row["identity_contract"] is None
    assert row["psych"]["trust"] == 1
    assert any("npc.reaction" in hint for hint in before_reaction["hints"])

    binding = _first_contact_binding(
        campaign_ws,
        npc_id,
        key="campaign-local-query",
    )
    after_reaction = _run(campaign_ws, "npc.query", {
        "npc_id": npc_id,
        "since_revision": revision,
    })
    assert after_reaction["ok"] is True
    assert after_reaction["data"].get("not_modified") is not True
    assert after_reaction["data"]["working_set"]["revision"] != revision
    assert after_reaction["data"]["npcs"][0]["name"] == (
        "测试 NPC campaign-local-query"
    )
    assert not any("npc.reaction" in hint for hint in after_reaction["hints"])

    recorded = _run(campaign_ws, "state.record_npc_engagement", {
        "npc_id": npc_id,
        "interaction_kind": "dialogue",
        "decision_id": "campaign-local-query-engagement",
        **binding,
    })
    assert recorded["ok"] is True

    queried = _run(campaign_ws, "npc.query", {"npc_id": npc_id})
    assert queried["ok"] is True
    row = queried["data"]["npcs"][0]
    assert row["psych"]["trust"] == 1
    assert row["psych"]["impression"]["initialized_from_first_impression"] is True
    all_npcs = _run(campaign_ws, "npc.query")
    assert npc_id in {item["npc_id"] for item in all_npcs["data"]["npcs"]}


def test_single_npc_query_projects_unrolled_first_contact_readiness(campaign_ws):
    npc_id = "npc-steven-knott"
    rolls_path = campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl"
    rolls_before = rolls_path.read_bytes() if rolls_path.is_file() else b""

    queried = _run(campaign_ws, "npc.query", {"npc_id": npc_id})
    assert queried["ok"] is True, queried
    readiness = queried["data"]["npcs"][0]["first_contact_readiness"]
    assert readiness["npc_id"] == npc_id
    assert readiness["identity_ready"] is True
    assert readiness["agenda_ready"] is True
    assert readiness["persona_ready"] is True
    assert readiness["persona"]["source_status"] == "authored"
    assert readiness["persona"]["voice"] == queried["data"]["npcs"][0]["voice"]
    assert readiness["mechanics_ready"] is False
    assert readiness["mechanics_source_status"] == "source_unresolved"
    assert readiness["pending_source_dependency"]["consumer"] == "mechanics.ensure"
    pair = readiness["requested_pair_first_impression"]
    assert pair == {
        "status": "missing",
        "investigator_id": campaign_ws["investigator_id"],
        "receipt_exists": False,
        "first_impression_ref": None,
    }
    reaction = next(
        card for card in readiness["next_operation_cards"]
        if card["operation"] == "npc.reaction"
    )
    assert reaction["roll_created"] is False
    assert reaction["fresh_decision_id_required"] is True
    assert reaction["missing_arguments"] == [
        "npc_display_name", "run_id", "context", "decision_id",
    ]
    assert (rolls_path.read_bytes() if rolls_path.is_file() else b"") == rolls_before
    bulk = _run(campaign_ws, "npc.query")
    assert all("first_contact_readiness" not in row for row in bulk["data"]["npcs"])


def test_first_contact_readiness_projects_only_requested_investigator(campaign_ws):
    other_id = _add_eleanor_to_party(campaign_ws)
    npc_id = "npc-steven-knott"

    scoped = _run(campaign_ws, "npc.query", {
        "npc_id": npc_id,
        "investigator": campaign_ws["investigator_id"],
    })
    readiness = scoped["data"]["npcs"][0]["first_contact_readiness"]
    assert readiness["requested_pair_first_impression"]["investigator_id"] == (
        campaign_ws["investigator_id"]
    )
    reaction_cards = [
        card for card in readiness["next_operation_cards"]
        if card["operation"] == "npc.reaction"
    ]
    assert len(reaction_cards) == 1
    assert reaction_cards[0]["prefilled_arguments"]["investigator"] == (
        campaign_ws["investigator_id"]
    )
    assert other_id not in json.dumps(reaction_cards)

    unscoped = _run(campaign_ws, "npc.query", {"npc_id": npc_id})
    unscoped_ready = unscoped["data"]["npcs"][0]["first_contact_readiness"]
    assert unscoped_ready["requested_pair_first_impression"] == {
        "status": "investigator_selection_required",
        "investigator_id": None,
        "receipt_exists": None,
        "first_impression_ref": None,
    }
    assert not any(
        card["operation"] == "npc.reaction"
        for card in unscoped_ready["next_operation_cards"]
    )
    bulk = _run(campaign_ws, "npc.query")
    assert all("first_contact_readiness" not in row for row in bulk["data"]["npcs"])


def test_first_contact_readiness_reuses_receipt_and_seed_stable_persona(campaign_ws):
    improvised_id = "npc-improvised-readiness"
    seeded = _run(campaign_ws, "state.npc_update", {
        "npc_id": improvised_id,
        "trust_delta": 1,
        "decision_id": "seed-improvised-readiness",
    })
    assert seeded["ok"] is True
    state_path = campaign_ws["campaign_dir"] / "save" / "npc-state.json"
    state_before = state_path.read_bytes()
    first = _run(campaign_ws, "npc.query", {"npc_id": improvised_id})
    second = _run(campaign_ws, "npc.query", {"npc_id": improvised_id})
    assert state_path.read_bytes() == state_before
    first_ready = first["data"]["npcs"][0]["first_contact_readiness"]
    second_ready = second["data"]["npcs"][0]["first_contact_readiness"]
    assert first_ready["persona_ready"] is False
    assert first_ready["persona_candidate_ready"] is True
    assert first_ready["persona"]["source_status"] == "seed_stable_proposal"
    assert first_ready["persona"]["authority"] == "advisory"
    assert first_ready["persona"]["keeper_only"] is True
    assert first_ready["persona"]["seed"] == second_ready["persona"]["seed"]
    assert first_ready["persona"]["tags"] == second_ready["persona"]["tags"]
    assert first_ready["mechanics_source_status"] == "campaign_fallback_eligible"
    mechanics = next(
        card for card in first_ready["next_operation_cards"]
        if card["operation"] == "mechanics.ensure"
    )
    assert "fallback_archetype_id" in mechanics["missing_arguments"]

    binding = _first_contact_binding(
        campaign_ws, improvised_id, key="improvised-readiness",
    )
    after = _run(campaign_ws, "npc.query", {"npc_id": improvised_id})
    after_ready = after["data"]["npcs"][0]["first_contact_readiness"]
    assert after_ready["requested_pair_first_impression"]["receipt_exists"] is True
    assert after_ready["requested_pair_first_impression"]["first_impression_ref"] == (
        binding["first_impression_ref"]
    )
    assert not any(
        card["operation"] == "npc.reaction"
        for card in after_ready["next_operation_cards"]
    )


def test_npc_advise_preserves_authored_truth_over_canonical_support(campaign_ws):
    npc_id = "npc-steven-knott"
    agendas_path = campaign_ws["campaign_dir"] / "scenario" / "npc-agendas.json"
    agendas = json.loads(agendas_path.read_text(encoding="utf-8"))
    authored = next(
        npc for npc in agendas["npcs"]
        if npc["npc_id"] == npc_id
    )
    story_path = campaign_ws["campaign_dir"] / "scenario" / "story-graph.json"
    story = json.loads(story_path.read_text(encoding="utf-8"))
    active_scene = next(
        scene for scene in story["scenes"]
        if scene["scene_id"] == "commission-briefing"
    )
    active_scene["scene_tags"] = ["public_pressure"]
    active_scene["authority_demands"] = ["scene_safety"]
    _write_json(story_path, story)
    canonical = coc_toolbox.coc_npc_state.load_npc_state(
        campaign_ws["campaign_dir"]
    )
    canonical["npcs"][npc_id] = {
        "npc_id": npc_id,
        "name": {"status": "generated", "value": "Wrong Name"},
        "origin": "improvised",
        "agenda": "Replace the authored commission with a generic agenda.",
        "voice": "Replace the authored voice.",
        "social_role": {"authority_scope": ["wrong_scope"]},
        "persona": {
            "tags": ["stress_response.panic", "temperament.secretive"],
        },
    }
    coc_toolbox.coc_npc_state.save_npc_state(campaign_ws["campaign_dir"], canonical)
    stale_path = campaign_ws["campaign_dir"] / "save" / "npc-persona-state.json"
    stale_path.write_text(json.dumps({
        "npcs": {npc_id: {
            "npc_id": npc_id,
            "persona": {"tags": ["stress_response.freeze"]},
        }},
    }), encoding="utf-8")

    advised = _run(campaign_ws, "npc.advise", {
        "intent_evidence": {
            "primary_intent": "talk",
            "secondary_intents": [],
            "risk_posture": "careful",
            "target_entities": [npc_id],
            "intent_tags": [],
            "reason": "test canonical persona state",
        },
        "seed": 7,
    })
    assert advised["ok"] is True, advised
    card = advised["data"]["candidate_agency"]["by_npc"][npc_id]["persona_card"]
    assert card["name"]["value"] == authored["name"]
    assert card["origin"] == authored["origin"]
    assert card["agenda"] == authored["agenda"]
    assert card["voice"] == authored["voice"]
    assert card["social_role"] == authored["social_role"]
    assert card["persona"] == {}
    assert "generation" not in card
    assert advised["data"]["candidate_agency"]["npc_state_writes"] == []
    move_ids = {
        move["move_id"]
        for move in advised["data"]["candidate_agency"]["by_npc"][npc_id][
            "agency_moves"
        ]
    }
    assert "take_command" in move_ids
    assert not {"panic", "withhold"} & move_ids

    authored["persona"] = {"tags": ["temperament.secretive"]}
    _write_json(agendas_path, agendas)
    authored_secretive = _run(campaign_ws, "npc.advise", {
        "intent_evidence": {
            "primary_intent": "talk",
            "secondary_intents": [],
            "risk_posture": "careful",
            "target_entities": [npc_id],
            "intent_tags": [],
            "reason": "test explicit authored temperament",
        },
        "seed": 8,
    })
    secretive_row = authored_secretive["data"]["candidate_agency"]["by_npc"][
        npc_id
    ]
    assert secretive_row["persona_card"]["persona"]["tags"] == [
        "temperament.secretive"
    ]
    assert "withhold" in {
        move["move_id"] for move in secretive_row["agency_moves"]
    }

    authored["persona"] = {"tags": ["stress_response.panic"]}
    _write_json(agendas_path, agendas)
    authored_panic = _run(campaign_ws, "npc.advise", {
        "intent_evidence": {
            "primary_intent": "talk",
            "secondary_intents": [],
            "risk_posture": "careful",
            "target_entities": [npc_id],
            "intent_tags": [],
            "reason": "test explicit authored stress response",
        },
        "seed": 9,
    })
    panic_row = authored_panic["data"]["candidate_agency"]["by_npc"][npc_id]
    assert panic_row["persona_card"]["persona"]["tags"] == [
        "stress_response.panic"
    ]
    assert [move["move_id"] for move in panic_row["agency_moves"]] == ["panic"]


@pytest.mark.parametrize("play_language", ["zh-Hans", "en"])
def test_authored_stored_raw_name_is_not_localized_without_provenance(
    campaign_ws, play_language,
):
    npc_id = "npc-steven-knott"
    campaign_path = campaign_ws["campaign_dir"] / "campaign.json"
    campaign = json.loads(campaign_path.read_text(encoding="utf-8"))
    campaign["play_language"] = play_language
    _write_json(campaign_path, campaign)
    canonical = coc_toolbox.coc_npc_state.load_npc_state(
        campaign_ws["campaign_dir"]
    )
    canonical["npcs"][npc_id] = {
        "npc_id": npc_id,
        "name": {
            "status": "provided",
            "value": "Steven Knott",
            "source": "scenario_data",
        },
        "persona": {"tags": ["temperament.cautious"]},
    }
    coc_toolbox.coc_npc_state.save_npc_state(campaign_ws["campaign_dir"], canonical)

    before = _run(campaign_ws, "npc.query", {"npc_id": npc_id})
    readiness = before["data"]["npcs"][0]["first_contact_readiness"]
    assert readiness["localized_name_ready"] is False
    reaction_card = next(
        card for card in readiness["next_operation_cards"]
        if card["operation"] == "npc.reaction"
    )
    assert "npc_display_name" in reaction_card["missing_arguments"]


def test_first_impression_receipt_accepts_authored_table_name(campaign_ws):
    npc_id = "npc-steven-knott"
    canonical = coc_toolbox.coc_npc_state.load_npc_state(
        campaign_ws["campaign_dir"]
    )
    canonical["npcs"][npc_id] = {
        "npc_id": npc_id,
        "name": {
            "status": "provided",
            "value": "Steven Knott",
            "source": "scenario_data",
        },
        "persona": {"tags": ["temperament.cautious"]},
    }
    coc_toolbox.coc_npc_state.save_npc_state(campaign_ws["campaign_dir"], canonical)

    accepted_name = "测试史蒂文"
    reaction = _run(campaign_ws, "npc.reaction", {
        "npc_id": npc_id,
        "npc_display_name": accepted_name,
        "investigator": campaign_ws["investigator_id"],
        "context": {
            "player_conduct": "the investigator introduces themself",
            "scene_constraints": "the authored commission remains in force",
            "authored_or_relationship_boundary": "identity and agenda do not change",
            "semantic_reason": "this is the actual first substantive contact",
        },
        "decision_id": "localized-name-receipt",
        "seed": 1,
    })
    assert reaction["ok"] is True, reaction
    after = _run(campaign_ws, "npc.query", {"npc_id": npc_id})
    after_ready = after["data"]["npcs"][0]["first_contact_readiness"]
    assert after_ready["localized_name_ready"] is True
    assert after_ready["localized_name"] == accepted_name


def test_explicit_campaign_local_npc_presence_reaches_scene_context_and_replays(
    campaign_ws,
):
    npc_id = "npc-improvised-door-attendant"
    seeded = _run(campaign_ws, "state.npc_update", {
        "npc_id": npc_id,
        "suspicion_delta": 1,
        "decision_id": "presence-seed-psych",
    })
    assert seeded["ok"] is True

    before = _run(campaign_ws, "scene.context")
    assert before["ok"] is True
    revision = before["data"]["working_set"]["revision"]
    assert npc_id not in {
        row["npc_id"] for row in before["data"]["npcs_present"]
    }
    scene_id = before["data"]["active_scene_id"]
    args = {
        "npc_id": npc_id,
        "scene_id": scene_id,
        "status": "present",
        "reason": "the attendant opened the door and remained at the threshold",
        "decision_id": "presence-door-attendant-arrives",
    }
    placed = _run(campaign_ws, "state.npc_presence", args)
    replay = _run(campaign_ws, "state.npc_presence", args)
    assert placed["ok"] is True, placed
    assert replay["ok"] is True, replay
    assert replay["data"] == placed["data"]
    assert any("duplicate decision_id" in warning for warning in replay["warnings"])

    after = _run(campaign_ws, "scene.context", {"since_revision": revision})
    assert after["ok"] is True
    assert after["data"].get("not_modified") is not True
    row = next(
        row for row in after["data"]["npcs_present"] if row["npc_id"] == npc_id
    )
    assert row["origin"] == "improvised"
    assert row["presence_source"] == "live"
    assert row["presence"]["scene_id"] == scene_id
    assert row["presence"]["status"] == "present"
    assert row["suspicion"] == 1

    conflict = _run(campaign_ws, "state.npc_presence", {
        **args,
        "status": "absent",
    })
    assert conflict["ok"] is False
    assert conflict["error"]["code"] == "idempotency_conflict"

    removed = _run(campaign_ws, "state.npc_presence", {
        "npc_id": npc_id,
        "scene_id": scene_id,
        "status": "absent",
        "reason": "the attendant left the threshold",
        "decision_id": "presence-door-attendant-leaves",
    })
    assert removed["ok"] is True
    final_context = _run(campaign_ws, "scene.context")
    assert npc_id not in {
        row["npc_id"] for row in final_context["data"]["npcs_present"]
    }

    state = json.loads(
        (campaign_ws["campaign_dir"] / "save" / "npc-state.json").read_text(
            encoding="utf-8"
        )
    )
    receipt = state["operation_receipts"]["state.npc_presence"][
        "presence-door-attendant-arrives"
    ]
    assert receipt["entity_head"]["entity_kind"] == "npc_presence"
    assert state["presence_heads"][npc_id]["decision_id"] == (
        "presence-door-attendant-leaves"
    )


def test_actions_list_gives_noncombat_choices_equal_structured_semantics(campaign_ws):
    moved = _run(
        campaign_ws,
        "state.move_scene",
        {"scene_id": "corbitt-confrontation", "decision_id": "move-actions-final"},
    )
    assert moved["ok"] is True

    envelope = _run(campaign_ws, "actions.list")
    by_id = {row["id"]: row for row in envelope["data"]["affordances"]}
    assert by_id["conventional-assault"]["action_kind"] == "attack"
    assert by_id["conventional-assault"]["resolution_mode"] == "typed_tool"
    assert by_id["flee-and-seal"]["action_kind"] == "retreat"
    assert by_id["flee-and-seal"]["resolution_mode"] == "keeper_adjudication"
    assert any("must not be replaced" in hint for hint in envelope["hints"])


def test_record_npc_engagement_is_idempotent_with_first_impression_state(campaign_ws):
    moved = _run(
        campaign_ws,
        "state.move_scene",
        {
            "scene_id": "higher-courts-central-police",
            "decision_id": "move-kim-engagement",
        },
    )
    assert moved["ok"] is True
    queried = _run(campaign_ws, "npc.query", {"npc_id": "npc-kim-debrun"})
    identity_ref = queried["data"]["npcs"][0]["identity_ref"]
    args = {
        "npc_id": "npc-kim-debrun",
        "interaction_kind": "dialogue",
        "identity_ref": identity_ref,
        "run_id": "toolbox-live-segment",
        "decision_id": "kim-engagement-once",
        **_first_contact_binding(
            campaign_ws,
            "npc-kim-debrun",
            key="kim-engagement",
            run_id="toolbox-live-segment",
        ),
    }
    state_path = campaign_ws["campaign_dir"] / "save" / "npc-state.json"
    before = state_path.read_bytes() if state_path.is_file() else None

    first = _run(campaign_ws, "state.record_npc_engagement", args)
    after_first = state_path.read_bytes()
    replay = _run(campaign_ws, "state.record_npc_engagement", args)
    after_replay = state_path.read_bytes()
    cross_run = _run(
        campaign_ws,
        "state.record_npc_engagement",
        {**args, "run_id": "different-live-segment"},
    )

    assert first["ok"] is True
    assert replay["data"] == first["data"]
    assert cross_run["ok"] is False
    assert cross_run["error"]["code"] == "idempotency_conflict"
    assert first["data"]["event_type"] == "npc_engagement"
    assert first["data"]["run_id"] == "toolbox-live-segment"
    assert first["data"]["interaction_kind"] == "dialogue"
    assert first["data"]["identity_binding"]["status"] == "authored_bound"
    assert first["data"]["identity_binding"]["authored_identity_attested"] is True
    assert first["data"]["identity_binding"]["coverage_eligible"] is True
    assert after_first != before
    assert after_replay == after_first
    matching = [
        row
        for row in _read_jsonl(campaign_ws["campaign_dir"] / "logs" / "events.jsonl")
        if row.get("event_type") == "npc_engagement"
        and row.get("npc_id") == "npc-kim-debrun"
    ]
    assert len(matching) == 1


@pytest.mark.parametrize("crash_stage", ["after_source", "before_ledger"])
def test_npc_engagement_receipt_recovers_before_a_different_next_decision(
    campaign_ws, monkeypatch, crash_stage
):
    args = {
        "npc_id": "npc-crash-window",
        "interaction_kind": "witness",
        "decision_id": f"npc-crash-{crash_stage}",
        **_first_contact_binding(
            campaign_ws,
            "npc-crash-window",
            key=f"npc-crash-{crash_stage}",
        ),
    }
    real_log_event = coc_toolbox.Ctx.log_event
    real_ledger_record = coc_toolbox.Ctx.ledger_record

    def crash_log_event(self, record):
        if (
            crash_stage == "after_source"
            and record.get("event_type") == "npc_engagement"
        ):
            raise RuntimeError("synthetic NPC crash after source receipt")
        return real_log_event(self, record)

    def crash_ledger_record(self, decision_id, tool_name, data, **kwargs):
        if crash_stage == "before_ledger" and tool_name == (
            "state.record_npc_engagement"
        ):
            raise RuntimeError("synthetic NPC crash before ledger")
        return real_ledger_record(
            self, decision_id, tool_name, data, **kwargs
        )

    with monkeypatch.context() as crash:
        crash.setattr(coc_toolbox.Ctx, "log_event", crash_log_event)
        crash.setattr(coc_toolbox.Ctx, "ledger_record", crash_ledger_record)
        with pytest.raises(RuntimeError, match="synthetic NPC crash"):
            _run(campaign_ws, "state.record_npc_engagement", args)

    # The host deliberately chooses a different valid tool instead of retrying
    # the failed operation.  Global source preflight must finish it first.
    later = _run(
        campaign_ws,
        "state.journal",
        {
            "summary": "continued after NPC recorder interruption",
            "decision_id": f"later-after-{crash_stage}",
        },
    )
    assert later["ok"] is True
    replay = _run(campaign_ws, "state.record_npc_engagement", args)
    assert replay["ok"] is True
    assert replay["idempotent_replay"] is True
    context = _run(campaign_ws, "turn.output_context")
    assert context["ok"] is True
    events = [
        row for row in _read_jsonl(
            campaign_ws["campaign_dir"] / "logs" / "events.jsonl"
        )
        if row.get("event_type") == "npc_engagement"
        and row.get("decision_id") == args["decision_id"]
    ]
    assert len(events) == 1
    receipt_doc = json.loads((
        campaign_ws["campaign_dir"]
        / "save"
        / "npc-engagement-receipts.json"
    ).read_text(encoding="utf-8"))
    assert len([
        row for row in receipt_doc["receipts"].values()
        if row["decision_id"] == args["decision_id"]
    ]) == 1

    # Exact replay is the only post-journal exception.  A changed payload and
    # a new decision remain non-mutating failures, and neither can append a
    # source receipt or event outside the pending turn manifest.
    before_receipts = (campaign_ws["campaign_dir"] / "save" /
                       "npc-engagement-receipts.json").read_bytes()
    before_events = (campaign_ws["campaign_dir"] / "logs" /
                     "events.jsonl").read_bytes()
    changed = _run(
        campaign_ws,
        "state.record_npc_engagement",
        {**args, "interaction_kind": "dialogue"},
    )
    unbound = _run(
        campaign_ws,
        "state.record_npc_engagement",
        {
            "npc_id": args["npc_id"],
            "interaction_kind": "witness",
            "decision_id": f"new-after-{crash_stage}",
        },
    )
    assert changed["ok"] is False
    assert changed["error"]["code"] == "idempotency_conflict"
    assert unbound["ok"] is False
    assert unbound["error"]["code"] == "turn_pending_finalization"
    assert (campaign_ws["campaign_dir"] / "save" /
            "npc-engagement-receipts.json").read_bytes() == before_receipts
    assert (campaign_ws["campaign_dir"] / "logs" /
            "events.jsonl").read_bytes() == before_events


def test_background_flusher_and_toolbox_recovery_share_stable_event_lock(
    campaign_ws, monkeypatch
):
    decision_id = "flag-recovery-vs-background-flush"
    assert _run(
        campaign_ws,
        "state.set_flag",
        {
            "flag_id": "stable-event-lock-domain",
            "value": True,
            "decision_id": decision_id,
        },
    )["ok"] is True
    campaign_dir = campaign_ws["campaign_dir"]
    flags = json.loads(
        (campaign_dir / "save" / "flags.json").read_text(encoding="utf-8")
    )
    receipt = flags["operation_receipts"]["state.set_flag"][decision_id]
    events_path = campaign_dir / "logs" / "events.jsonl"
    remaining = [
        row for row in _read_jsonl(events_path)
        if row.get("event_id") != receipt["event_id"]
    ]
    events_path.write_text(
        "".join(json.dumps(row) + "\n" for row in remaining),
        encoding="utf-8",
    )
    recorder = coc_toolbox.coc_async_recorder.JsonlRecorder(
        campaign_dir,
        mode="fast",
        decision_id=decision_id,
    )
    recorder.append_jsonl(events_path, receipt["event"])
    assert recorder.commit() is not None

    flusher_at_append = Event()
    release_flusher = Event()
    recovery_started = Event()
    real_append = coc_toolbox.coc_async_recorder._append_jsonl_sync
    real_ensure = coc_toolbox._ensure_operation_event

    def pause_flusher(path, record):
        if record.get("event_id") == receipt["event_id"]:
            flusher_at_append.set()
            assert release_flusher.wait(timeout=5)
        return real_append(path, record)

    def observe_recovery(ctx, current_receipt, **kwargs):
        if current_receipt.get("event_id") == receipt["event_id"]:
            recovery_started.set()
        return real_ensure(ctx, current_receipt, **kwargs)

    monkeypatch.setattr(
        coc_toolbox.coc_async_recorder, "_append_jsonl_sync", pause_flusher
    )
    monkeypatch.setattr(coc_toolbox, "_ensure_operation_event", observe_recovery)
    with ThreadPoolExecutor(max_workers=2) as pool:
        flush_future = pool.submit(
            coc_toolbox.coc_async_recorder.flush_pending_records, campaign_dir
        )
        assert flusher_at_append.wait(timeout=5)
        recovery_future = pool.submit(
            _run,
            campaign_ws,
            "state.journal",
            {
                "summary": "continue while a stable event flush is active",
                "decision_id": "later-after-stable-event-lock-race",
            },
        )
        assert recovery_started.wait(timeout=5)
        release_flusher.set()
        assert flush_future.result(timeout=5)["flushed_files"] == 1
        assert recovery_future.result(timeout=5)["ok"] is True

    matches = [
        row for row in _read_jsonl(events_path)
        if row.get("event_id") == receipt["event_id"]
    ]
    assert matches == [receipt["event"]]


def test_background_flusher_and_director_flag_recovery_share_stable_event_lock(
    campaign_ws, monkeypatch,
):
    decision_id = "director-flag-recovery-vs-background-flush"
    campaign_dir = campaign_ws["campaign_dir"]
    coc_director_apply.apply_plan(
        campaign_dir,
        {
            "decision_id": decision_id,
            "scene_action": "CHARACTER",
            "flags_set": ["director-stable-event-lock-domain"],
            "clue_policy": {"reveal": []},
            "pressure_moves": [],
            "memory_writes": [],
            "rule_signals": {},
        },
        investigator_id=campaign_ws["investigator_id"],
    )
    flags = json.loads(
        (campaign_dir / "save" / "flags.json").read_text(encoding="utf-8")
    )
    receipt = next(
        row for row in flags[
            coc_toolbox.coc_flag_state.DIRECTOR_FLAG_RECEIPTS_KEY
        ].values()
        if row["decision_id"] == decision_id
    )
    events_path = campaign_dir / "logs" / "events.jsonl"
    events_path.write_text(
        "".join(
            json.dumps(row) + "\n"
            for row in _read_jsonl(events_path)
            if row.get("event_id") != receipt["event_id"]
        ),
        encoding="utf-8",
    )
    recorder = coc_toolbox.coc_async_recorder.JsonlRecorder(
        campaign_dir,
        mode="fast",
        decision_id=decision_id,
    )
    recorder.append_jsonl(events_path, receipt["event"])
    assert recorder.commit() is not None

    flusher_at_append = Event()
    release_flusher = Event()
    recovery_started = Event()
    real_append = coc_toolbox.coc_async_recorder._append_jsonl_sync
    real_materialize = coc_toolbox._materialize_stable_receipt_event

    def pause_flusher(path, record):
        if record.get("event_id") == receipt["event_id"]:
            flusher_at_append.set()
            assert release_flusher.wait(timeout=5)
        return real_append(path, record)

    def observe_recovery(ctx, **kwargs):
        if kwargs.get("event_id") == receipt["event_id"]:
            recovery_started.set()
        return real_materialize(ctx, **kwargs)

    monkeypatch.setattr(
        coc_toolbox.coc_async_recorder, "_append_jsonl_sync", pause_flusher
    )
    monkeypatch.setattr(
        coc_toolbox, "_materialize_stable_receipt_event", observe_recovery
    )
    with ThreadPoolExecutor(max_workers=2) as pool:
        flush_future = pool.submit(
            coc_toolbox.coc_async_recorder.flush_pending_records, campaign_dir
        )
        assert flusher_at_append.wait(timeout=5)
        recovery_future = pool.submit(_run, campaign_ws, "scene.context", {})
        assert recovery_started.wait(timeout=5)
        release_flusher.set()
        assert flush_future.result(timeout=5)["flushed_files"] == 1
        assert recovery_future.result(timeout=5)["ok"] is True

    matches = [
        row for row in _read_jsonl(events_path)
        if row.get("event_id") == receipt["event_id"]
    ]
    assert matches == [receipt["event"]]


def test_common_preflight_repairs_source_receipts_before_context_and_director(
    campaign_ws, monkeypatch,
):
    campaign_dir = campaign_ws["campaign_dir"]
    real_log_event = coc_toolbox.Ctx.log_event

    def crash_flag(self, record):
        if (
            record.get("event_type") == "flag_set"
            and record.get("decision_id") == "flag-before-context"
        ):
            raise RuntimeError("synthetic flag source-before-context crash")
        return real_log_event(self, record)

    with monkeypatch.context() as crash:
        crash.setattr(coc_toolbox.Ctx, "log_event", crash_flag)
        with pytest.raises(RuntimeError, match="source-before-context"):
            _run(
                campaign_ws,
                "state.set_flag",
                {
                    "flag_id": "context-repair-flag",
                    "value": False,
                    "decision_id": "flag-before-context",
                },
            )

    context = _run(campaign_ws, "scene.context", {})
    assert context["ok"] is True
    repaired_flag = next(
        row for row in context["data"]["continuity"]["live_world_flags"]
        if row["flag_id"] == "context-repair-flag"
    )
    assert repaired_flag["value"] is False
    assert repaired_flag["provenance"]["integrity_status"] == "source_anchored"

    def crash_marker(self, record):
        if (
            record.get("event_type") == "time_marker_changed"
            and record.get("decision_id") == "marker-before-director"
        ):
            raise RuntimeError("synthetic marker source-before-director crash")
        return real_log_event(self, record)

    with monkeypatch.context() as crash:
        crash.setattr(coc_toolbox.Ctx, "log_event", crash_marker)
        with pytest.raises(RuntimeError, match="source-before-director"):
            _run(
                campaign_ws,
                "state.time_marker",
                {
                    "action": "set",
                    "marker_id": "director-repair-marker",
                    "minutes_from_now": 5,
                    "decision_id": "marker-before-director",
                },
            )

    coc_director_apply.apply_plan(
        campaign_dir,
        {
            "decision_id": "director-after-marker-source",
            "scene_action": "PRESSURE",
            "clue_policy": {"reveal": []},
            "pressure_moves": [],
            "memory_writes": [],
            "rule_signals": {},
        },
        investigator_id=campaign_ws["investigator_id"],
    )
    marker_events = [
        row for row in _read_jsonl(campaign_dir / "logs" / "events.jsonl")
        if row.get("event_type") == "time_marker_changed"
        and row.get("decision_id") == "marker-before-director"
    ]
    assert len(marker_events) == 1
    marker_ledger = json.loads(
        (campaign_dir / "save" / "toolbox-ledger.json").read_text(
            encoding="utf-8"
        )
    )
    marker_key = coc_toolbox.Ctx._ledger_key(
        "state.time_marker", "marker-before-director"
    )
    assert marker_key in marker_ledger["entries"]


@pytest.mark.parametrize("source_kind", ["flag", "npc"])
def test_director_preflight_repairs_interrupted_toolbox_source(
    campaign_ws, monkeypatch, source_kind
):
    decision_id = f"toolbox-before-director-{source_kind}"
    npc_binding = (
        _first_contact_binding(
            campaign_ws,
            "npc-before-director",
            key="npc-before-director",
        )
        if source_kind == "npc"
        else {}
    )
    real_log_event = coc_toolbox.Ctx.log_event

    def crash_before_event(self, record):
        expected_type = "flag_set" if source_kind == "flag" else "npc_engagement"
        if (
            record.get("event_type") == expected_type
            and record.get("decision_id") == decision_id
        ):
            raise RuntimeError("synthetic toolbox source-before-event crash")
        return real_log_event(self, record)

    with monkeypatch.context() as crash:
        crash.setattr(coc_toolbox.Ctx, "log_event", crash_before_event)
        with pytest.raises(RuntimeError, match="source-before-event"):
            if source_kind == "flag":
                _run(
                    campaign_ws,
                    "state.set_flag",
                    {
                        "flag_id": "toolbox-flag-before-director",
                        "value": True,
                        "decision_id": decision_id,
                    },
                )
            else:
                _run(
                    campaign_ws,
                    "state.record_npc_engagement",
                    {
                        "npc_id": "npc-before-director",
                        "interaction_kind": "witness",
                        "decision_id": decision_id,
                        **npc_binding,
                    },
                )

    coc_director_apply.apply_plan(
        campaign_ws["campaign_dir"],
        {
            "decision_id": f"director-after-{source_kind}",
            "scene_action": "PRESSURE",
            "clue_policy": {"reveal": []},
            "pressure_moves": [],
            "memory_writes": [],
            "rule_signals": {},
        },
        investigator_id=campaign_ws["investigator_id"],
    )
    expected_type = "flag_set" if source_kind == "flag" else "npc_engagement"
    events = [
        row for row in _read_jsonl(
            campaign_ws["campaign_dir"] / "logs" / "events.jsonl"
        )
        if row.get("event_type") == expected_type
        and row.get("decision_id") == decision_id
    ]
    assert len(events) == 1


def test_npc_engagement_identity_binding_degrades_to_warnings_not_a_gate(
    campaign_ws,
):
    moved = _run(
        campaign_ws,
        "state.move_scene",
        {"scene_id": "neighborhood-gossip", "decision_id": "move-dooley-binding"},
    )
    assert moved["ok"] is True
    query = _run(campaign_ws, "npc.query", {"npc_id": "npc-dooley"})
    dooley_ref = query["data"]["npcs"][0]["identity_ref"]

    unverified = _run(
        campaign_ws,
        "state.record_npc_engagement",
        {
            "npc_id": "npc-dooley",
            "interaction_kind": "dialogue",
            "decision_id": "dooley-unverified",
            **_first_contact_binding(
                campaign_ws,
                "npc-dooley",
                key="dooley-first-contact",
            ),
        },
    )
    mismatched = _run(
        campaign_ws,
        "state.record_npc_engagement",
        {
            "npc_id": "npc-dooley",
            "interaction_kind": "dialogue",
            "identity_ref": "npc-identity-v1:not-dooley",
            "decision_id": "dooley-mismatched",
        },
    )
    improvised = _run(
        campaign_ws,
        "state.record_npc_engagement",
        {
            "npc_id": "npc-neighbor-white-hair",
            "interaction_kind": "dialogue",
            "identity_ref": dooley_ref,
            "decision_id": "neighbor-improvised",
            **_first_contact_binding(
                campaign_ws,
                "npc-neighbor-white-hair",
                key="neighbor-first-contact",
            ),
        },
    )
    bound = _run(
        campaign_ws,
        "state.record_npc_engagement",
        {
            "npc_id": "npc-dooley",
            "interaction_kind": "dialogue",
            "identity_ref": dooley_ref,
            "decision_id": "dooley-bound",
        },
    )

    assert all(row["ok"] is True for row in [unverified, mismatched, improvised, bound])
    assert unverified["data"]["identity_binding"]["status"] == "unverified"
    assert mismatched["data"]["identity_binding"]["status"] == "mismatch"
    assert improvised["data"]["identity_binding"]["status"] == "improvised"
    assert bound["data"]["identity_binding"]["status"] == "authored_bound"
    assert not unverified["data"]["identity_binding"]["coverage_eligible"]
    assert not mismatched["data"]["identity_binding"]["coverage_eligible"]
    assert not improvised["data"]["identity_binding"]["coverage_eligible"]
    assert bound["data"]["identity_binding"]["coverage_eligible"] is True
    assert any("coverage" in warning for warning in unverified["warnings"])
    assert any("does not match" in warning for warning in mismatched["warnings"])
    assert any("improvised NPC" in warning for warning in improvised["warnings"])

    context = _run(campaign_ws, "scene.context")
    dooley = next(
        npc for npc in context["data"]["npcs_present"] if npc["npc_id"] == "npc-dooley"
    )
    assert dooley["identity_ref"] == dooley_ref
    assert dooley["agenda"]
    assert "identity_contract" not in dooley


def test_npc_short_name_and_open_interaction_label_degrade_without_blocking(campaign_ws):
    query = _run(campaign_ws, "npc.query", {"npc_id": "knott"})
    assert query["ok"] is True
    assert query["data"]["npcs"][0]["npc_id"] == "npc-steven-knott"
    assert any("resolved NPC alias" in hint for hint in query["hints"])

    engagement = _run(
        campaign_ws,
        "state.record_npc_engagement",
        {
            "npc_id": "knott",
            "interaction_kind": "request_access",
            "decision_id": "knott-access-soft-label",
            **_first_contact_binding(
                campaign_ws,
                "knott",
                key="knott-first-contact",
            ),
        },
    )
    assert engagement["ok"] is True
    assert engagement["data"]["npc_id"] == "npc-steven-knott"
    assert engagement["data"]["interaction_kind"] == "other"
    assert engagement["data"]["interaction_label"] == "request_access"
    assert any("normalized to 'other'" in warning for warning in engagement["warnings"])


def test_npc_structured_alias_normalization_is_unicode_safe_and_unambiguous():
    agendas = {
        "npcs": [
            {
                "npc_id": "npc-elise-zhou",
                "name": "Élise 周",
                "aliases": ["周女士"],
            },
            {
                "npc_id": "npc-zhou-ming",
                "name": "Ming 周",
                "aliases": ["周先生"],
            },
        ]
    }

    assert coc_toolbox._npc_by_id(agendas, "ÉLISE")["npc_id"] == "npc-elise-zhou"
    assert coc_toolbox._npc_by_id(agendas, "周女士")["npc_id"] == "npc-elise-zhou"
    # The shared structured token stays unresolved instead of selecting one NPC.
    assert coc_toolbox._npc_by_id(agendas, "周") is None


def test_scene_context_projects_and_sanity_check_consumes_authored_trigger(campaign_ws):
    moved = _run(
        campaign_ws,
        "state.move_scene",
        {"scene_id": "upper-floor-bedroom", "decision_id": "move-to-bedroom"},
    )
    assert moved["ok"] is True
    context = _run(campaign_ws, "scene.context")
    assert context["ok"] is True
    triggers = context["data"]["pending_san_triggers"]
    assert [trigger["trigger_id"] for trigger in triggers] == ["bed-moves"]
    trigger = triggers[0]

    settled = _run(
        campaign_ws,
        "rules.sanity_check",
        {
            "investigator": campaign_ws["investigator_id"],
            "source": trigger["source"],
            "loss_success": str(trigger["san_loss_success"]),
            "loss_failure": trigger["san_loss_fail_expr"],
            "trigger_id": trigger["trigger_id"],
            "decision_id": "bed-san-once",
            "seed": 3,
        },
    )
    assert settled["ok"] is True
    assert settled["data"]["trigger_id"] == "bed-moves"
    after = _run(campaign_ws, "scene.context")
    assert after["data"]["pending_san_triggers"] == []


def test_sanity_fumble_records_the_structured_authored_loss_consequence(campaign_ws):
    settled = _run(
        campaign_ws,
        "rules.sanity_check",
        {
            "investigator": campaign_ws["investigator_id"],
            "source": "structured horror",
            "loss_success": "0",
            "loss_failure": "1D4",
            "decision_id": "san-fumble-evidence",
            "seed": 23,
        },
    )
    assert settled["ok"] is True
    assert settled["data"]["check"]["outcome"] == "fumble"
    check_roll_id = settled["data"]["check_roll_id"]
    roll = next(
        row
        for row in _read_jsonl(
            campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl"
        )
        if row.get("roll_id") == check_roll_id
    )
    consequence = roll["payload"]["fumble_consequence"]
    assert consequence["effect"]["kind"] == "san_loss"
    assert consequence["effect"]["amount"] == settled["data"]["san_loss"]


def test_rules_push_records_announced_failure_consequence(campaign_ws):
    original_decision_id = "push-with-consequence-original"
    original = _failed_roll_for_push(campaign_ws, original_decision_id)
    args = {
        "original_check_decision_id": original_decision_id,
        "method_changed": "cross-check the index against the court docket",
        "failure_consequence": "the archive closes before the trail is copied",
        "decision_id": "push-with-consequence",
        "seed": 2,
    }
    result = _run(
        campaign_ws,
        "rules.push",
        args,
    )
    assert result["ok"] is True
    assert result["data"]["original_check"] == {
        "tool": "rules.roll",
        "decision_id": original_decision_id,
        "roll_id": original["data"]["roll_id"],
        "integrity_digest": result["data"]["original_check"][
            "integrity_digest"
        ],
    }
    assert result["data"]["goal"] == original["data"]["goal"]
    assert result["data"]["required_level"] == original["data"][
        "required_level"
    ]
    assert result["data"]["required_target"] == original["data"][
        "required_target"
    ]
    assert result["data"]["failure_consequence"]["summary"].startswith(
        "the archive closes"
    )
    repeated = _run(campaign_ws, "rules.push", {**args, "seed": 999})
    assert repeated["ok"] is True
    assert repeated["data"] == result["data"]
    assert any("duplicate decision_id" in row for row in repeated["warnings"])
    rolls = _read_jsonl(campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl")
    matching = [row for row in rolls if row["roll_id"] == result["data"]["roll_id"]]
    assert len(matching) == 1
    roll = matching[0]
    assert roll["payload"]["roll_id"] == result["data"]["roll_id"]
    assert roll["payload"]["announced_consequence"] == result["data"][
        "failure_consequence"
    ]


def test_rules_push_requires_and_inherits_original_check_contract(campaign_ws):
    missing = _run(
        campaign_ws,
        "rules.push",
        {
            "method_changed": "try the docket index",
            "failure_consequence": "the archive closes",
            "decision_id": "push-missing-original",
        },
    )
    assert missing["ok"] is False
    assert missing["error"]["code"] == "missing_param"

    original_decision_id = "push-inherits-original"
    original = _run(
        campaign_ws,
        "rules.roll",
        {
            "target": 45,
            "difficulty": "hard",
            "goal": "convince the clerk to open the restricted archive",
            "stakes": {
                "on_success": "the clerk opens the archive",
                "on_failure": "the clerk refuses access",
            },
            "difficulty_basis": "opponent_skill",
            "decision_id": original_decision_id,
            "seed": 8,
        },
    )
    assert original["data"]["success"] is False

    pushed = _run(
        campaign_ws,
        "rules.push",
        {
            "original_check_decision_id": original_decision_id,
            "method_changed": "show the clerk the matching court docket",
            "failure_consequence": "the clerk calls security",
            "decision_id": "push-inherits-original-attempt",
            "seed": 43,
        },
    )
    assert pushed["ok"] is True, pushed
    for field in (
        "base_target",
        "required_level",
        "required_target",
        "goal",
        "stakes",
        "difficulty_basis",
    ):
        assert pushed["data"][field] == original["data"][field]

    override_original_id = "push-attempted-override-original"
    _failed_roll_for_push(campaign_ws, override_original_id)
    attempted_override = _run(
        campaign_ws,
        "rules.push",
        {
            "original_check_decision_id": override_original_id,
            "difficulty": "regular",
            "goal": "a substituted easier goal",
            "method_changed": "ask again",
            "failure_consequence": "the clerk calls security",
            "decision_id": "push-attempted-contract-override",
            "seed": 43,
        },
    )
    assert attempted_override["ok"] is False
    assert attempted_override["error"]["code"] == "invalid_param"
    assert "inherits the original check contract" in attempted_override[
        "error"
    ]["message"]


def test_rules_push_rejects_successful_or_already_pushed_original(campaign_ws):
    successful = _run(
        campaign_ws,
        "rules.roll",
        {
            "target": 99,
            "difficulty": "regular",
            "decision_id": "successful-original-cannot-push",
            "seed": 43,
        },
    )
    assert successful["data"]["success"] is True
    rejected_success = _run(
        campaign_ws,
        "rules.push",
        {
            "original_check_decision_id": "successful-original-cannot-push",
            "method_changed": "try again",
            "failure_consequence": "time is lost",
            "decision_id": "push-successful-original",
        },
    )
    assert rejected_success["ok"] is False
    assert rejected_success["error"]["code"] == "invalid_push"

    original_decision_id = "single-push-original"
    _failed_roll_for_push(campaign_ws, original_decision_id)
    first = _run(
        campaign_ws,
        "rules.push",
        {
            "original_check_decision_id": original_decision_id,
            "method_changed": "use the docket",
            "failure_consequence": "the archive closes",
            "decision_id": "single-push-first",
            "seed": 7,
        },
    )
    assert first["ok"] is True
    second = _run(
        campaign_ws,
        "rules.push",
        {
            "original_check_decision_id": original_decision_id,
            "method_changed": "bribe the clerk",
            "failure_consequence": "the police are called",
            "decision_id": "single-push-second",
            "seed": 9,
        },
    )
    assert second["ok"] is False
    assert second["error"]["code"] == "invalid_push"


def test_rules_push_rejects_fumble_before_reroll_or_persistent_writes(
    campaign_ws,
    monkeypatch,
):
    original_decision_id = "fumbled-original-cannot-push"
    original = _run(
        campaign_ws,
        "rules.roll",
        {
            "target": 1,
            "difficulty": "regular",
            "goal": "open the swollen archive door",
            "stakes": {
                "on_success": "the archive door opens",
                "on_failure": "the attempt draws the night watchman's attention",
            },
            "difficulty_basis": "environment",
            "decision_id": original_decision_id,
            "seed": 23,
        },
    )
    assert original["ok"] is True, original
    assert original["data"]["roll"] == 100
    assert original["data"]["achieved_level"] == "fumble"
    assert original["data"]["outcome"] == "fumble"
    assert not any("may push" in hint for hint in original["hints"])

    campaign_dir = campaign_ws["campaign_dir"]
    receipt_path = campaign_dir / "save" / "roll-operation-receipts.json"
    rolls_path = campaign_dir / "logs" / "rolls.jsonl"
    ledger_path = campaign_dir / "save" / "toolbox-ledger.json"
    before = {
        path: path.read_bytes()
        for path in (receipt_path, rolls_path, ledger_path)
    }
    reroll_calls = 0

    def unexpected_reroll(*args, **kwargs):
        nonlocal reroll_calls
        reroll_calls += 1
        raise AssertionError("a fumbled original must be rejected before reroll")

    monkeypatch.setattr(
        coc_toolbox.coc_roll,
        "percentile_check",
        unexpected_reroll,
    )
    pushed = _run(
        campaign_ws,
        "rules.push",
        {
            "original_check_decision_id": original_decision_id,
            "method_changed": "drive a pry bar into the doorframe",
            "failure_consequence": "the night watchman arrives with the police",
            "decision_id": "push-fumbled-original",
            "seed": 43,
        },
    )

    assert pushed["ok"] is False
    assert pushed["error"]["code"] == "invalid_push"
    assert "fumbles are final" in pushed["error"]["message"]
    assert reroll_calls == 0
    for path, expected in before.items():
        assert path.read_bytes() == expected

    receipt_doc = json.loads(receipt_path.read_text(encoding="utf-8"))
    assert not (receipt_doc["receipts"].get("rules.push") or {})
    ledger = json.loads(ledger_path.read_text(encoding="utf-8"))
    push_key = coc_toolbox.Ctx._ledger_key(
        "rules.push", "push-fumbled-original"
    )
    assert push_key not in ledger["entries"]
    assert [row["roll_id"] for row in _read_jsonl(rolls_path)] == [
        original["data"]["roll_id"]
    ]


def test_dying_check_is_idempotent_and_writes_canonical_roll(campaign_ws):
    investigator_id = campaign_ws["investigator_id"]
    state_path = (
        campaign_ws["campaign_dir"]
        / "save"
        / "investigator-state"
        / f"{investigator_id}.json"
    )
    state = json.loads(state_path.read_text(encoding="utf-8"))
    state.update({
        "current_hp": 0,
        "conditions": ["major_wound", "unconscious", "dying"],
    })
    _write_json(state_path, state)

    args = {
        "investigator": investigator_id,
        "clock_kind": "round",
        "decision_id": "dying-clock-round-1",
        "seed": 1,
    }
    before = len(_read_jsonl(campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl"))
    first = _run(campaign_ws, "rules.dying_check", args)
    repeated = _run(campaign_ws, "rules.dying_check", {**args, "seed": 999})
    assert first["ok"] is True, first
    assert repeated["ok"] is True
    assert repeated["data"] == first["data"]
    assert first["data"]["event"]["event_type"] == "dying_con_roll"
    assert "dying" in first["data"]["conditions"]
    rolls = _read_jsonl(campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl")
    assert len(rolls) == before + 1
    assert rolls[-1]["actor"] == investigator_id
    assert rolls[-1]["payload"]["event_type"] == "combat_rescue_roll"


def test_failed_first_aid_allows_one_evidenced_push(campaign_ws):
    investigator_id = campaign_ws["investigator_id"]
    state_path = (
        campaign_ws["campaign_dir"]
        / "save"
        / "investigator-state"
        / f"{investigator_id}.json"
    )
    state = json.loads(state_path.read_text(encoding="utf-8"))
    state.update({
        "current_hp": 0,
        "conditions": ["major_wound", "unconscious", "dying"],
    })
    _write_json(state_path, state)

    failed = _run(
        campaign_ws,
        "rules.first_aid",
        {
            "investigator": investigator_id,
            "skill_value": 1,
            "rescuer_id": "npc-paramedic",
            "decision_id": "first-aid-origin",
            "seed": 1,
        },
    )
    assert failed["ok"] is True, failed
    assert failed["data"]["event"]["outcome"] == "failure"

    pushed_args = {
        "investigator": investigator_id,
        "skill_value": 99,
        "rescuer_id": "npc-paramedic",
        "pushed": True,
        "changed_method": "open the field kit and use a pressure dressing",
        "failure_consequence": "the dying clock immediately resumes",
        "decision_id": "first-aid-push",
        "seed": 1,
    }
    pushed = _run(campaign_ws, "rules.first_aid", pushed_args)
    assert pushed["ok"] is True, pushed
    assert pushed["data"]["event"]["event_type"] == "first_aid_stabilize"
    assert pushed["data"]["event"]["pushed"] is True
    push_roll = _read_jsonl(
        campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl"
    )[-1]
    assert push_roll["actor"] == "npc-paramedic"
    assert push_roll["payload"]["pushed"] is True
    assert push_roll["payload"]["changed_method"].startswith("open the field kit")
    assert push_roll["payload"]["announced_consequence"] == {
        "summary": "the dying clock immediately resumes"
    }

    second_push = _run(
        campaign_ws,
        "rules.first_aid",
        {**pushed_args, "decision_id": "first-aid-push-again", "seed": 2},
    )
    assert second_push["ok"] is False
    assert second_push["error"]["code"] == "treatment_already_used"


def test_first_aid_wakes_non_dying_major_wound_for_resume(campaign_ws):
    investigator_id = campaign_ws["investigator_id"]
    state_path = (
        campaign_ws["campaign_dir"]
        / "save"
        / "investigator-state"
        / f"{investigator_id}.json"
    )
    state = json.loads(state_path.read_text(encoding="utf-8"))
    state.update({
        "current_hp": 1,
        "conditions": ["major_wound", "prone", "unconscious"],
    })
    _write_json(state_path, state)

    aid = _run(
        campaign_ws,
        "rules.first_aid",
        {
            "investigator": investigator_id,
            "skill_value": 99,
            "rescuer_id": "npc-ambulance-attendant",
            "decision_id": "wake-major-wound-first-aid",
            "seed": 1,
        },
    )

    assert aid["ok"] is True, aid
    assert aid["data"]["current_hp"] == 2
    assert "unconscious" not in aid["data"]["conditions"]
    assert "major_wound" in aid["data"]["conditions"]
    receipt = aid["data"]["player_state_receipt"]
    assert receipt["investigator_id"] == investigator_id
    assert receipt["hp"] == {"before": 1, "after": 2}
    assert "unconscious" in receipt["conditions_before"]
    assert "unconscious" not in receipt["conditions_after"]


def test_first_aid_then_medicine_closes_dying_consumer_chain(campaign_ws):
    investigator_id = campaign_ws["investigator_id"]
    state_path = (
        campaign_ws["campaign_dir"]
        / "save"
        / "investigator-state"
        / f"{investigator_id}.json"
    )
    state = json.loads(state_path.read_text(encoding="utf-8"))
    state.update({
        "current_hp": 0,
        "conditions": ["major_wound", "unconscious", "dying"],
    })
    _write_json(state_path, state)
    rescuer_id = "npc-paramedic"
    before = len(_read_jsonl(campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl"))

    aid_args = {
        "investigator": investigator_id,
        "skill_value": 99,
        "rescuer_id": rescuer_id,
        "decision_id": "rescue-first-aid-1",
        "seed": 1,
    }
    aid = _run(campaign_ws, "rules.first_aid", aid_args)
    replay = _run(campaign_ws, "rules.first_aid", {**aid_args, "seed": 999})
    assert aid["ok"] is True, aid
    assert replay["data"] == aid["data"]
    assert aid["data"]["event"]["event_type"] == "first_aid_stabilize"
    assert aid["data"]["current_hp"] == 1
    assert {"dying", "stabilized", "unconscious"} <= set(
        aid["data"]["conditions"]
    )

    medicine = _run(
        campaign_ws,
        "rules.medicine",
        {
            "investigator": investigator_id,
            "skill_value": 99,
            "rescuer_id": rescuer_id,
            "decision_id": "rescue-medicine-1",
            "seed": 1,
        },
    )
    assert medicine["ok"] is True, medicine
    assert medicine["data"]["event"]["event_type"] == "medicine"
    assert medicine["data"]["current_hp"] >= 2
    assert not {"dying", "stabilized", "unconscious"} & set(
        medicine["data"]["conditions"]
    )

    rolls = _read_jsonl(campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl")
    new_rolls = rolls[before:]
    assert len(new_rolls) == 3
    assert all(row["actor"] == rescuer_id for row in new_rolls)
    assert all(row["source"] == "subsystem_executor" for row in new_rolls)
    assert all(row["payload"]["roll_id"] == row["roll_id"] for row in new_rolls)


def test_weekly_recovery_uses_authoritative_time_and_is_dice_complete(campaign_ws):
    investigator_id = campaign_ws["investigator_id"]
    campaign_dir = campaign_ws["campaign_dir"]
    state_path = (
        campaign_dir / "save" / "investigator-state" / f"{investigator_id}.json"
    )
    time_state = json.loads(
        (campaign_dir / "save" / "time-state.json").read_text(encoding="utf-8")
    )
    elapsed = int(time_state["clock"]["elapsed_minutes"])
    state = json.loads(state_path.read_text(encoding="utf-8"))
    state.update({
        "current_hp": 2,
        "conditions": ["major_wound"],
        "wound_ledger": [{
            "wound_id": "wound-weekly-test",
            "source_damage_roll_id": "damage-weekly-test",
            "occurred_elapsed_minutes": elapsed,
            "status": "active",
        }],
    })
    _write_json(state_path, state)

    recovery_args = {
        "investigator": investigator_id,
        "complete_rest": True,
        "poor_environment": False,
        "medicine_skill_value": 99,
        "caregiver_id": "npc-hospital-doctor",
        "decision_id": "major-wound-week-1",
        "seed": 1,
    }
    early = _run(campaign_ws, "rules.weekly_recovery", recovery_args)
    assert early["ok"] is False
    assert early["error"]["code"] == "weekly_recovery_not_due"

    advanced = _run(
        campaign_ws,
        "state.advance_time",
        {
            "minutes": 7 * 24 * 60,
            "reason": "one complete week of hospital rest",
            "decision_id": "advance-major-wound-week-1",
        },
    )
    assert advanced["ok"] is True
    before_rolls = len(_read_jsonl(campaign_dir / "logs" / "rolls.jsonl"))
    settled = _run(campaign_ws, "rules.weekly_recovery", recovery_args)
    replay = _run(
        campaign_ws,
        "rules.weekly_recovery",
        {**recovery_args, "seed": 999},
    )
    assert settled["ok"] is True, settled
    assert replay["ok"] is True
    assert replay["data"] == settled["data"]
    event = settled["data"]["event"]
    assert event["event_type"] == "major_wound_recovery"
    assert event["elapsed_minutes_since_prior_attempt"] == 7 * 24 * 60
    assert event["roll"] is not None
    assert event["target"] > 0
    assert len(settled["data"]["major_wound_recovery_ledger"]) == 1

    new_rolls = _read_jsonl(campaign_dir / "logs" / "rolls.jsonl")[before_rolls:]
    expected_roll_count = 2 + int(event.get("healing_dice") is not None)
    assert len(new_rolls) == expected_roll_count
    assert len({row["roll_id"] for row in new_rolls}) == expected_roll_count
    assert new_rolls[0]["payload"]["event_type"] == "major_wound_recovery_roll"
    assert new_rolls[0]["actor"] == investigator_id
    assert new_rolls[1]["payload"]["event_type"] == "weekly_medical_care_roll"
    assert new_rolls[1]["actor"] == "npc-hospital-doctor"
    if event.get("healing_dice") is not None:
        assert new_rolls[2]["payload"]["dice"] == event["healing_dice"]

    too_soon = _run(
        campaign_ws,
        "rules.weekly_recovery",
        {**recovery_args, "decision_id": "major-wound-week-2", "seed": 2},
    )
    assert too_soon["ok"] is False
    if "major_wound" in settled["data"]["conditions"]:
        assert too_soon["error"]["code"] == "weekly_recovery_not_due"
    else:
        assert too_soon["error"]["code"] == "major_wound_not_active"
    assert len(_read_jsonl(campaign_dir / "logs" / "rolls.jsonl")) == (
        before_rolls + expected_roll_count
    )


def test_clear_transient_condition_preserves_injury_state_and_replays(campaign_ws):
    investigator_id = campaign_ws["investigator_id"]
    state_path = (
        campaign_ws["campaign_dir"]
        / "save"
        / "investigator-state"
        / f"{investigator_id}.json"
    )
    state = json.loads(state_path.read_text(encoding="utf-8"))
    state["conditions"] = ["major_wound", "prone"]
    _write_json(state_path, state)
    args = {
        "investigator": investigator_id,
        "condition": "prone",
        "reason": "the investigator carefully stood after bed rest",
        "decision_id": "stand-after-recovery",
    }

    cleared = _run(campaign_ws, "state.clear_transient_condition", args)
    replay = _run(campaign_ws, "state.clear_transient_condition", args)

    assert cleared["ok"] is True
    assert replay["data"] == cleared["data"]
    assert cleared["data"]["changed"] is True
    assert cleared["data"]["conditions"] == ["major_wound"]
    persisted = json.loads(state_path.read_text(encoding="utf-8"))
    assert persisted["conditions"] == ["major_wound"]


def test_clear_transient_condition_rejects_injury_conditions(campaign_ws):
    rejected = _run(
        campaign_ws,
        "state.clear_transient_condition",
        {
            "investigator": campaign_ws["investigator_id"],
            "condition": "major_wound",
            "reason": "generic narration must not erase a wound",
            "decision_id": "forged-major-wound-clear",
        },
    )
    assert rejected["ok"] is False
    assert rejected["error"]["code"] == "invalid_param"


def test_combat_tool_persists_reloadable_session_and_public_rolls(campaign_ws):
    moved = _run(
        campaign_ws,
        "state.move_scene",
        {"scene_id": "corbitt-confrontation", "decision_id": "move-to-combat"},
    )
    assert moved["ok"] is True
    args = {
        "affordance_id": "conventional-assault",
        "investigator": campaign_ws["investigator_id"],
        "weapon_id": "unarmed",
        "luck_spend_max": 50,
        "decision_id": "combat-beat-1",
        "seed": 7,
    }
    before_rolls = len(_read_jsonl(campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl"))
    first = _run(campaign_ws, "combat.resolve", args)
    assert first["ok"] is True, first
    repeated = _run(campaign_ws, "combat.resolve", {**args, "seed": 999})
    assert repeated["ok"] is True
    assert repeated["data"] == first["data"]

    combat_path = campaign_ws["campaign_dir"] / "save" / "combat.json"
    saved = json.loads(combat_path.read_text(encoding="utf-8"))
    assert saved["schema_version"] == 2
    reloaded = coc_toolbox.coc_subsystem_executor.coc_combat.CombatSession.load(
        campaign_ws["campaign_dir"],
        rng=random.Random(99),
        damage_evidence=coc_toolbox.coc_subsystem_executor.load_combat_damage_evidence(
            campaign_ws["campaign_dir"]
        ),
        damage_evidence_actor=campaign_ws["investigator_id"],
    )
    assert reloaded.combat_id == saved["combat_id"]
    rolls = _read_jsonl(campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl")
    assert len(rolls) > before_rolls
    combat_rolls = rolls[before_rolls:]
    assert all(row.get("event_type") == "roll" for row in combat_rolls)
    assert all(row.get("actor") for row in combat_rolls)
    assert all(row.get("roll_id") for row in combat_rolls)
    assert all(row.get("visibility") in {"public", "consequence_public"}
               for row in combat_rolls)
    assert all(row.get("source") == "subsystem_executor" for row in combat_rolls)
    assert all(row.get("source_ref") == f"logs/rolls.jsonl#{row['roll_id']}"
               for row in combat_rolls)
    assert all(row.get("payload", {}).get("roll_id") == row["roll_id"]
               for row in combat_rolls)
    assert all(
        row["actor"] == row["payload"].get("actor_id", campaign_ws["investigator_id"])
        for row in combat_rolls
    )
    assert any(row["actor"] == "walter-corbitt" for row in combat_rolls)

    outcome = reloaded.outcome if reloaded.status == "concluded" else "fled"
    ended = _run(
        campaign_ws,
        "combat.end",
        {
            "investigator": campaign_ws["investigator_id"],
            "outcome": outcome,
            "decision_id": "combat-end-1",
        },
    )
    assert ended["ok"] is True, ended
    assert any(
        event.get("event_type") == "combat_ended"
        for event in _read_jsonl(
            campaign_ws["campaign_dir"] / "logs" / "events.jsonl"
        )
    )

    prior_combat_id = reloaded.combat_id
    prior_roll_ids = {row["roll_id"] for row in rolls}
    rematch = _run(
        campaign_ws,
        "combat.resolve",
        {
            "affordance_id": "conventional-assault",
            "investigator": campaign_ws["investigator_id"],
            "weapon_id": "unarmed",
            "decision_id": "combat-rematch-1",
            "seed": 17,
        },
    )
    assert rematch["ok"] is True, rematch
    assert rematch["data"]["combat"]["combat_id"] != prior_combat_id
    assert "-restart-t" in rematch["data"]["combat"]["combat_id"]
    assert any("fresh combat/command/roll identity" in row
               for row in rematch["warnings"])
    all_rolls = _read_jsonl(campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl")
    all_roll_ids = [row["roll_id"] for row in all_rolls]
    assert len(all_roll_ids) == len(set(all_roll_ids))
    assert any(row["roll_id"] not in prior_roll_ids for row in all_rolls)


def test_attack_present_improvised_npc_uses_frozen_mechanics(campaign_ws):
    context = _run(campaign_ws, "scene.context")
    scene_id = context["data"]["active_scene_id"]
    npc_id = "npc-improvised-enforcer"
    placed = _run(campaign_ws, "state.npc_presence", {
        "npc_id": npc_id,
        "scene_id": scene_id,
        "status": "present",
        "reason": "the enforcer stepped into the room",
        "decision_id": "place-improvised-enforcer",
    })
    assert placed["ok"] is True, placed
    generated = _run(campaign_ws, "mechanics.ensure", {
        "subject_kind": "npc",
        "subject_id": npc_id,
        "purpose": "combat",
        "fallback_archetype_id": "dangerous_actor",
        "label": "打手",
        "decision_id": "generate-improvised-enforcer",
    })
    assert generated["ok"] is True, generated
    assert generated["data"]["authority"] == "campaign_generated"

    result = _run(campaign_ws, "combat.resolve", {
        "target_npc_id": npc_id,
        "investigator": campaign_ws["investigator_id"],
        "weapon_id": "unarmed",
        "decision_id": "attack-improvised-enforcer",
        "seed": 73,
    })

    assert result["ok"] is True, result
    actors = {
        row["actor_id"] for row in result["data"]["combat"]["participants"]
    }
    assert npc_id in actors


def test_authored_weapon_effect_reaches_deterministic_combat_damage(campaign_ws):
    granted = _run(campaign_ws, "state.item_grant", {
        "investigator": campaign_ws["investigator_id"],
        "kind": "weapon",
        "label": "受祝仪式刀",
        "weapon": {
            "weapon_id": "module:blessed-knife",
            "extends": "knife_medium",
            "effects": [{
                "effect_id": "double-vs-corbitt",
                "resolution": "combat_damage_multiplier",
                "applicability": {"target_ids": ["walter-corbitt"]},
                "multiplier": 2,
            }],
        },
        "decision_id": "grant-blessed-knife",
    })
    assert granted["ok"] is True, granted
    moved = _run(campaign_ws, "state.move_scene", {
        "scene_id": "corbitt-confrontation",
        "decision_id": "move-special-weapon-combat",
    })
    assert moved["ok"] is True, moved

    resolved = _run(campaign_ws, "combat.resolve", {
        "affordance_id": "conventional-assault",
        "investigator": campaign_ws["investigator_id"],
        "weapon_id": "module:blessed-knife",
        "weapon_effect_ids": ["double-vs-corbitt"],
        "decision_id": "special-weapon-combat",
        "seed": 0,
    })

    assert resolved["ok"] is True, resolved
    affected = [
        row for row in resolved["data"]["combat"]["damage_chain"]
        if "double-vs-corbitt" in row.get("weapon_effect_ids", [])
    ]
    assert affected
    assert affected[0]["damage_multiplier"] == 2
    assert affected[0]["raw_damage"] >= affected[0]["rolled_total"] * 2
    reloaded = coc_toolbox.coc_subsystem_executor.coc_combat.CombatSession.load(
        campaign_ws["campaign_dir"], rng=random.Random(99),
        damage_evidence=coc_toolbox.coc_subsystem_executor.load_combat_damage_evidence(
            campaign_ws["campaign_dir"]
        ),
        damage_evidence_actor=campaign_ws["investigator_id"],
    )
    assert reloaded.damage_chain[-1]["weapon_effect_ids"] == [
        "double-vs-corbitt"
    ]


def test_combat_tool_routes_owned_firearm_without_illegal_melee_defense(campaign_ws):
    moved = _run(
        campaign_ws,
        "state.move_scene",
        {"scene_id": "corbitt-confrontation", "decision_id": "move-firearm-combat"},
    )
    assert moved["ok"] is True

    resolved = _run(
        campaign_ws,
        "combat.resolve",
        {
            "affordance_id": "conventional-assault",
            "investigator": campaign_ws["investigator_id"],
            "weapon_id": "revolver_38_or_9mm",
            "decision_id": "combat-firearm-beat",
            "seed": 7,
        },
    )

    assert resolved["ok"] is True, resolved
    attack_events = [
        event
        for event in resolved["data"]["events"]
        if event.get("event_type") == "combat_turn_resolved"
        and (event.get("turn") or {}).get("actor_id")
        == campaign_ws["investigator_id"]
    ]
    assert attack_events
    assert attack_events[0]["turn"]["resolution_hint"] == "firearm_attack"
    assert attack_events[0]["turn"]["defense_kind"] == "none"


def test_combat_resolve_uses_one_guarded_character_snapshot_for_all_consumers(
    campaign_ws, monkeypatch
):
    investigator_id = campaign_ws["investigator_id"]
    moved = _run(
        campaign_ws,
        "state.move_scene",
        {"scene_id": "corbitt-confrontation", "decision_id": "move-snapshot-combat"},
    )
    assert moved["ok"] is True

    character_path = (
        campaign_ws["coc_root"]
        / "investigators"
        / investigator_id
        / "character.json"
    )
    version_one = json.loads(character_path.read_text(encoding="utf-8"))
    version_one["snapshot_version"] = "v1"
    version_one["characteristics"]["DEX"] = 88
    version_one["skills"]["Fighting (Brawl)"] = 99
    _write_json(character_path, version_one)
    version_two = json.loads(json.dumps(version_one))
    version_two["snapshot_version"] = "v2"
    version_two["characteristics"]["DEX"] = 22
    version_two["skills"]["Fighting (Brawl)"] = 1

    real_sheet = coc_toolbox.Ctx.sheet
    sheet_reads: list[str] = []

    def swap_after_first_guarded_read(self, requested_id):
        sheet = real_sheet(self, requested_id)
        sheet_reads.append(str(sheet.get("snapshot_version")))
        if len(sheet_reads) == 1:
            _write_json(character_path, version_two)
        return sheet

    monkeypatch.setattr(coc_toolbox.Ctx, "sheet", swap_after_first_guarded_read)
    captured: dict[str, object] = {}

    real_profile = coc_toolbox._investigator_combat_profile

    def capture_profile(ctx, requested_id, *args, **kwargs):
        captured["profile_snapshot"] = kwargs.get("character_snapshot")
        if captured["profile_snapshot"] is None and args:
            captured["profile_snapshot"] = args[0]
        return real_profile(ctx, requested_id, *args, **kwargs)

    monkeypatch.setattr(
        coc_toolbox, "_investigator_combat_profile", capture_profile
    )
    real_route = (
        coc_toolbox.coc_narrative_enrichment.build_route_operation_requests
    )

    def capture_route(payload):
        captured["profile"] = payload["investigator_combat_profile"]
        captured["route_character"] = payload["character"]
        return real_route(payload)

    monkeypatch.setattr(
        coc_toolbox.coc_narrative_enrichment,
        "build_route_operation_requests",
        capture_route,
    )
    real_execute = coc_toolbox.coc_subsystem_executor.execute_commands

    def capture_execute(*args, **kwargs):
        captured["executor_snapshot"] = kwargs.get("character_snapshot")
        return real_execute(*args, **kwargs)

    monkeypatch.setattr(
        coc_toolbox.coc_subsystem_executor, "execute_commands", capture_execute
    )
    real_ticks = coc_toolbox._record_combat_improvement_ticks

    def capture_ticks(ctx, **kwargs):
        captured["tick_snapshot"] = kwargs.get("character_snapshot")
        return real_ticks(ctx, **kwargs)

    monkeypatch.setattr(
        coc_toolbox, "_record_combat_improvement_ticks", capture_ticks
    )

    resolved = _run(
        campaign_ws,
        "combat.resolve",
        {
            "affordance_id": "conventional-assault",
            "investigator": investigator_id,
            "weapon_id": "unarmed",
            "decision_id": "combat-one-character-snapshot",
            "seed": 7,
        },
    )

    assert resolved["ok"] is True, resolved
    assert sheet_reads == ["v1"]
    snapshot = captured["route_character"]
    assert captured["profile_snapshot"] is snapshot
    assert captured["executor_snapshot"] is snapshot
    assert captured["tick_snapshot"] is snapshot
    assert snapshot["snapshot_version"] == "v1"
    assert captured["profile"]["dex"] == 88
    assert captured["profile"]["combat_skill"] == 99
    assert resolved["data"]["improvement_ticks_recorded"] == [
        "Fighting (Brawl)"
    ]
    assert json.loads(character_path.read_text(encoding="utf-8"))[
        "snapshot_version"
    ] == "v2"


def test_floating_knife_roll_keeps_authored_pow_semantics(campaign_ws):
    moved = _run(
        campaign_ws,
        "state.move_scene",
        {"scene_id": "corbitt-confrontation", "decision_id": "move-pow-combat"},
    )
    assert moved["ok"] is True
    common = {
        "affordance_id": "conventional-assault",
        "investigator": campaign_ws["investigator_id"],
        "weapon_id": "unarmed",
    }

    opened = _run(
        campaign_ws,
        "combat.resolve",
        {**common, "decision_id": "pow-combat-open", "seed": 7},
    )
    assert opened["ok"] is True, opened
    assert opened["data"]["combat"]["status"] == "active"

    declared = _run(
        campaign_ws,
        "combat.resolve",
        {**common, "decision_id": "pow-knife-declare", "seed": 8},
    )
    assert declared["ok"] is True, declared
    pending = declared["data"]["pending_defense"]
    assert pending["actor_id"] == "walter-corbitt"
    assert pending["weapon_id"] == "floating-knife"

    resolved = _run(
        campaign_ws,
        "combat.resolve",
        {
            **common,
            "defense_kind": "dodge",
            "decision_id": "pow-knife-defend",
            "seed": 33,
        },
    )
    assert resolved["ok"] is True, resolved
    turn_event = next(
        row
        for row in resolved["data"]["events"]
        if row.get("event_type") == "combat_turn_resolved"
    )
    turn = turn_event["turn"]
    assert turn["defense_kind"] == "dodge"
    assert turn["opposed_outcome"] == "tie_defender_wins"
    assert turn["outcome"] == "miss"
    assert turn["damage_roll_id"] is None
    assert resolved["data"]["player_state_receipt"]["hp"] == {
        "before": 12,
        "after": 12,
    }
    percentile_rolls = turn_event["roll_evidence"]
    assert [row["achieved_level"] for row in percentile_rolls] == [
        "regular", "regular",
    ]
    assert [row["roll"] for row in percentile_rolls] == [74, 22]
    knife_rolls = [
        row
        for row in _read_jsonl(campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl")
        if row.get("actor") == "walter-corbitt"
        and row.get("payload", {}).get("skill") == "POW"
    ]
    assert len(knife_rolls) == 1
    assert knife_rolls[0]["payload"]["target"] == 90


def test_off_design_clue_records_with_warning_not_exception(campaign_ws):
    envelope = _run(
        campaign_ws,
        "state.record_clue",
        {
            "clue_id": "improvised-toolbox-clue",
            "method": "improvisation",
            "decision_id": "toolbox-improv-clue",
        },
    )
    assert envelope["ok"] is True
    assert envelope["data"]["clue_id"] == "improvised-toolbox-clue"
    assert any("not in the clue graph" in w for w in envelope["warnings"])


# --------------------------------------------------------------------------- #
# CLI smoke (subprocess)
# --------------------------------------------------------------------------- #


def test_cli_list_prints_parseable_json():
    proc = subprocess.run(
        [PYTHON, str(TOOLBOX_SCRIPT), "list"],
        cwd=REPO,
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0
    payload = json.loads(proc.stdout)
    names = {entry["name"] for entry in payload["tools"]}
    assert "rules.roll_dice" in names
    assert "state.record_clue" in names
    assert "director.advise" in names


def test_cli_tool_call_with_root_and_campaign(campaign_ws):
    proc = subprocess.run(
        [
            PYTHON,
            str(TOOLBOX_SCRIPT),
            "rules.roll_dice",
            "--root",
            str(campaign_ws["workspace"]),
            "--campaign",
            campaign_ws["campaign_id"],
            "--json",
            json.dumps({
                "expression": "1D4",
                "seed": 99,
                "decision_id": "cli-dice-once",
            }),
        ],
        cwd=REPO,
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr or proc.stdout
    envelope = json.loads(proc.stdout)
    assert envelope["ok"] is True
    assert envelope["tool"] == "rules.roll_dice"
    assert isinstance(envelope["data"]["total"], int)
    assert envelope["data"]["rolls"]


def test_cli_failed_tool_exits_nonzero(campaign_ws):
    proc = subprocess.run(
        [
            PYTHON,
            str(TOOLBOX_SCRIPT),
            "rules.roll_dice",
            "--root",
            str(campaign_ws["workspace"]),
            "--campaign",
            campaign_ws["campaign_id"],
            "--json",
            "{}",
        ],
        cwd=REPO,
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode != 0
    envelope = json.loads(proc.stdout)
    assert envelope["ok"] is False
    assert envelope["error"]["code"] == "missing_param"


def test_cli_describe_known_tool():
    proc = subprocess.run(
        [PYTHON, str(TOOLBOX_SCRIPT), "describe", "state.record_clue"],
        cwd=REPO,
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0
    payload = json.loads(proc.stdout)
    assert payload["name"] == "state.record_clue"
    assert payload["params"]["clue_id"]["required"] is True
    assert payload["params"]["decision_id"]["required"] is True


@pytest.mark.parametrize("entity_kind", ["flag", "marker"])
def test_schema_v2_receipt_with_missing_live_entity_is_never_success(
    campaign_ws, entity_kind,
):
    campaign_dir = campaign_ws["campaign_dir"]
    if entity_kind == "flag":
        tool_name = "state.set_flag"
        args = {
            "flag_id": "v2-missing-flag",
            "value": True,
            "decision_id": "v2-missing-flag-decision",
        }
        source_path = campaign_dir / "save" / "flags.json"
    else:
        tool_name = "state.time_marker"
        args = {
            "action": "set",
            "marker_id": "v2-missing-marker",
            "minutes_from_now": 7,
            "decision_id": "v2-missing-marker-decision",
        }
        source_path = campaign_dir / "save" / "time-markers.json"
    assert _run(campaign_ws, tool_name, args)["ok"] is True
    source = json.loads(source_path.read_text(encoding="utf-8"))
    receipt = source["operation_receipts"][tool_name][args["decision_id"]]
    receipt.pop("entity_head")
    receipt["schema_version"] = 2
    receipt["integrity_digest"] = coc_toolbox._source_receipt_integrity(receipt)
    if entity_kind == "flag":
        source["flags"].pop(args["flag_id"])
        source["flag_provenance"].pop(args["flag_id"])
        source["flag_heads"].pop(args["flag_id"])
    else:
        source["markers"].pop(args["marker_id"])
        source["marker_heads"].pop(args["marker_id"])
    _write_json(source_path, source)
    before = source_path.read_bytes()

    replay = _run(campaign_ws, tool_name, args)

    assert replay["ok"] is False
    assert replay["error"]["code"] == "state_corrupt"
    assert source_path.read_bytes() == before




@pytest.mark.parametrize("source_kind", ["flags", "markers"])
def test_noncurrent_flag_and_marker_documents_are_rejected_without_rewrite(
    campaign_ws, source_kind,
):
    campaign_dir = campaign_ws["campaign_dir"]
    if source_kind == "flags":
        path = campaign_dir / "save" / "flags.json"
        document = json.loads(path.read_text(encoding="utf-8"))
        document["schema_version"] = 2
        tool_name = "scene.context"
        args = {}
    else:
        path = campaign_dir / "save" / "time-markers.json"
        document = {
            "schema_version": 2,
            "markers": {},
            "marker_heads": {},
            "marker_source_sequence": 0,
            "operation_receipts": {},
        }
        tool_name = "state.time_marker"
        args = {
            "action": "set",
            "marker_id": "old-document",
            "minutes_from_now": 5,
            "decision_id": "reject-old-marker-document",
        }
    _write_json(path, document)
    before = path.read_bytes()

    rejected = _run(campaign_ws, tool_name, args)

    assert rejected["ok"] is False
    assert rejected["error"]["code"] == "state_corrupt"
    assert path.read_bytes() == before


@pytest.mark.parametrize("entity_kind", ["flag", "marker"])
def test_schema_v2_source_receipt_is_rejected_even_with_complete_live_evidence(
    campaign_ws, entity_kind,
):
    campaign_dir = campaign_ws["campaign_dir"]
    if entity_kind == "flag":
        tool_name = "state.set_flag"
        args = {
            "flag_id": "old-receipt-live-flag",
            "value": True,
            "decision_id": "old-receipt-live-flag-decision",
        }
        path = campaign_dir / "save" / "flags.json"
    else:
        tool_name = "state.time_marker"
        args = {
            "action": "set",
            "marker_id": "old-receipt-live-marker",
            "minutes_from_now": 9,
            "decision_id": "old-receipt-live-marker-decision",
        }
        path = campaign_dir / "save" / "time-markers.json"
    assert _run(campaign_ws, tool_name, args)["ok"] is True
    document = json.loads(path.read_text(encoding="utf-8"))
    receipt = document["operation_receipts"][tool_name][args["decision_id"]]
    receipt.pop("entity_head")
    receipt["schema_version"] = 2
    receipt["integrity_digest"] = coc_toolbox._source_receipt_integrity(receipt)
    _write_json(path, document)
    before = path.read_bytes()

    rejected = _run(campaign_ws, tool_name, args)

    assert rejected["ok"] is False
    assert rejected["error"]["code"] == "state_corrupt"
    assert path.read_bytes() == before


def test_extra_legacy_flag_cutover_field_is_rejected(campaign_ws):
    path = campaign_ws["campaign_dir"] / "save" / "flags.json"
    document = json.loads(path.read_text(encoding="utf-8"))
    document["flag_event_cutover"] = {"schema_version": 1}
    _write_json(path, document)
    before = path.read_bytes()

    rejected = _run(campaign_ws, "scene.context", {})

    assert rejected["ok"] is False
    assert rejected["error"]["code"] == "state_corrupt"
    assert path.read_bytes() == before


@pytest.mark.parametrize("entity_kind", ["flag", "marker"])
def test_current_document_rejects_live_entity_without_current_receipt(
    campaign_ws, entity_kind,
):
    campaign_dir = campaign_ws["campaign_dir"]
    if entity_kind == "flag":
        tool_name = "state.set_flag"
        entity_id = "orphan-current-flag"
        args = {
            "flag_id": entity_id,
            "value": True,
            "decision_id": "orphan-current-flag-decision",
        }
        path = campaign_dir / "save" / "flags.json"
        document_key = "flags"
        head_key = "flag_heads"
    else:
        tool_name = "state.time_marker"
        entity_id = "orphan-current-marker"
        args = {
            "action": "set",
            "marker_id": entity_id,
            "minutes_from_now": 5,
            "decision_id": "orphan-current-marker-decision",
        }
        path = campaign_dir / "save" / "time-markers.json"
        document_key = "markers"
        head_key = "marker_heads"
    assert _run(campaign_ws, tool_name, args)["ok"] is True
    document = json.loads(path.read_text(encoding="utf-8"))
    document["operation_receipts"] = {}
    _write_json(path, document)
    before = path.read_bytes()

    unrelated = (
        _run(campaign_ws, "scene.context", {})
        if entity_kind == "flag"
        else _run(
            campaign_ws,
            "state.time_marker",
            {
                "action": "set",
                "marker_id": "unrelated-marker",
                "minutes_from_now": 1,
                "decision_id": "unrelated-marker-decision",
            },
        )
    )

    assert document[document_key][entity_id]
    assert document[head_key][entity_id]
    assert unrelated["ok"] is False
    assert unrelated["error"]["code"] == "state_corrupt"
    assert path.read_bytes() == before


def test_unanchored_flag_head_is_not_authoritative_provenance(campaign_ws):
    campaign_dir = campaign_ws["campaign_dir"]
    args = {
        "flag_id": "unanchored-head-flag",
        "value": True,
        "decision_id": "anchored-flag-decision",
    }
    assert _run(campaign_ws, "state.set_flag", args)["ok"] is True
    flags_path = campaign_dir / "save" / "flags.json"
    flags = json.loads(flags_path.read_text(encoding="utf-8"))
    anchored_sequence = flags["flag_heads"][args["flag_id"]]["source_sequence"]
    provenance = dict(flags["flag_provenance"][args["flag_id"]])
    provenance.update({
        "source": "forged",
        "producer": "forged",
        "decision_id": "forged-decision",
        "source_sequence": anchored_sequence,
    })
    flags["flag_provenance"][args["flag_id"]] = provenance
    live_record = coc_toolbox.coc_flag_state.flag_live_record(
        flags, args["flag_id"]
    )
    flags["flag_heads"][args["flag_id"]] = (
        coc_toolbox.coc_flag_state.entity_head(
            entity_kind="flag",
            entity_id=args["flag_id"],
            decision_id="forged-decision",
            source_sequence=anchored_sequence,
            producer="forged",
            live_record=live_record,
        )
    )
    _write_json(flags_path, flags)

    context = _run(campaign_ws, "scene.context")
    assert context["ok"] is False
    assert context["error"]["code"] == "state_corrupt"
    unrelated = _run(
        campaign_ws,
        "state.set_flag",
        {
            "flag_id": "unrelated-after-forged-head",
            "value": True,
            "decision_id": "unrelated-after-forged-head-decision",
        },
    )
    assert unrelated["ok"] is False
    assert unrelated["error"]["code"] == "state_corrupt"
    replay = _run(campaign_ws, "state.set_flag", args)
    assert replay["ok"] is False
    assert replay["error"]["code"] == "state_corrupt"


def test_unanchored_time_marker_head_is_rejected(campaign_ws):
    campaign_dir = campaign_ws["campaign_dir"]
    args = {
        "action": "set",
        "marker_id": "unanchored-head-marker",
        "minutes_from_now": 5,
        "decision_id": "anchored-marker-decision",
    }
    assert _run(campaign_ws, "state.time_marker", args)["ok"] is True
    marker_path = campaign_dir / "save" / "time-markers.json"
    payload = json.loads(marker_path.read_text(encoding="utf-8"))
    anchored_sequence = payload["marker_heads"][args["marker_id"]][
        "source_sequence"
    ]
    marker = dict(payload["markers"][args["marker_id"]])
    marker.update({
        "decision_id": "forged-marker",
        "source_sequence": anchored_sequence,
        "producer": "forged",
    })
    payload["markers"][args["marker_id"]] = marker
    live_record = coc_toolbox._marker_live_record(payload, args["marker_id"])
    payload["marker_heads"][args["marker_id"]] = (
        coc_toolbox.coc_flag_state.entity_head(
            entity_kind="time_marker",
            entity_id=args["marker_id"],
            decision_id="forged-marker",
            source_sequence=anchored_sequence,
            producer="forged",
            live_record=live_record,
        )
    )
    _write_json(marker_path, payload)

    context = _run(campaign_ws, "scene.context")
    assert context["ok"] is False
    assert context["error"]["code"] == "state_corrupt"
    unrelated = _run(
        campaign_ws,
        "state.time_marker",
        {
            "action": "set",
            "marker_id": "unrelated-after-forged-marker",
            "minutes_from_now": 3,
            "decision_id": "unrelated-after-forged-marker-decision",
        },
    )
    assert unrelated["ok"] is False
    assert unrelated["error"]["code"] == "state_corrupt"
    replay = _run(campaign_ws, "state.time_marker", args)
    assert replay["ok"] is False
    assert replay["error"]["code"] == "state_corrupt"


@pytest.mark.parametrize(
    ("field", "bad_value"),
    [
        ("revision", True),
        ("created_at", "not-an-iso-timestamp"),
        ("updated_at", None),
        ("due_at", {"elapsed_minutes": "soon"}),
        ("status", "mystery"),
    ],
)
def test_time_marker_payload_schema_binds_complete_typed_state(
    campaign_ws, field, bad_value
):
    args = {
        "action": "set",
        "marker_id": f"typed-marker-{field}",
        "minutes_from_now": 7,
        "decision_id": f"typed-marker-decision-{field}",
    }
    assert _run(campaign_ws, "state.time_marker", args)["ok"] is True
    payload = json.loads((
        campaign_ws["campaign_dir"] / "save" / "time-markers.json"
    ).read_text(encoding="utf-8"))
    head = payload["marker_heads"][args["marker_id"]]
    marker = dict(head["live_record"]["marker"])
    assert coc_toolbox.coc_flag_state.valid_time_marker_payload(
        marker,
        marker_id=args["marker_id"],
        decision_id=args["decision_id"],
        producer="state.time_marker",
        source_sequence=head["source_sequence"],
    )
    marker[field] = bad_value
    assert not coc_toolbox.coc_flag_state.valid_time_marker_payload(
        marker,
        marker_id=args["marker_id"],
        decision_id=args["decision_id"],
        producer="state.time_marker",
        source_sequence=head["source_sequence"],
    )


def test_new_structured_flag_remains_recent_after_many_legacy_rows(campaign_ws):
    campaign_dir = campaign_ws["campaign_dir"]
    events_path = campaign_dir / "logs" / "events.jsonl"
    with events_path.open("a", encoding="utf-8") as handle:
        for index in range(20):
            handle.write(json.dumps({
                "event_type": "flag_set",
                "flag_id": f"legacy-{index}",
                "decision_id": f"legacy-decision-{index}",
                "ts": f"1920-01-01T00:{index:02d}:00Z",
            }) + "\n")
    assert _run(
        campaign_ws,
        "state.set_flag",
        {
            "flag_id": "new-sequenced-transition",
            "value": True,
            "decision_id": "new-sequenced-decision",
        },
    )["ok"] is True

    recent = _run(campaign_ws, "scene.context")["data"]["continuity"][
        "recent_world_flag_changes"
    ]
    assert recent[-1]["flag_id"] == "new-sequenced-transition"
    assert recent[-1]["provenance"]["order_epoch"] == "sequenced-v1"
    assert recent[-1]["provenance"]["integrity_status"] == "source_anchored"






def test_toolbox_npc_engagement_producer_emits_exact_current_event_schema(
    campaign_ws,
):
    npc_id = _first_npc_id(campaign_ws["campaign_dir"])
    result = _run(
        campaign_ws,
        "state.record_npc_engagement",
        {
            "npc_id": npc_id,
            "interaction_kind": "dialogue",
            "decision_id": "npc-schema-producer",
            **_first_contact_binding(
                campaign_ws,
                npc_id,
                key="npc-schema-producer",
            ),
        },
    )
    assert result["ok"] is True
    assert type(result["data"]["schema_version"]) is int
    assert result["data"]["schema_version"] == (
        coc_toolbox.coc_npc_identity.ENGAGEMENT_EVENT_SCHEMA_VERSION
    )
    assert result["data"]["event_id"].startswith("npc-engagement-v1:")
    assert result["data"]["producer"] == "state.record_npc_engagement"
    assert result["data"]["campaign_id"] == campaign_ws["campaign_id"]
    assert result["data"]["decision_id"] == "npc-schema-producer"
    receipt_doc = coc_toolbox.coc_npc_event_chain.load_receipt_document(
        campaign_ws["campaign_dir"]
    )
    receipt = receipt_doc["receipts"][result["data"]["event_id"]]
    assert coc_toolbox.coc_npc_event_chain.valid_receipt(receipt)


# --------------------------------------------------------------------------- #
# rules.cash_assets / npc.reaction / scene.context party_investigators
# --------------------------------------------------------------------------- #


def test_rules_cash_assets_lookup_and_validation(tmp_path):
    described = coc_toolbox._describe("rules.cash_assets")
    assert described["needs_campaign"] is False
    assert described["params"]["credit_rating"]["required"] is True

    result = coc_toolbox.run_tool(
        "rules.cash_assets", tmp_path, None, {"credit_rating": 41}
    )
    assert result["ok"] is True
    data = result["data"]
    assert data["living_standard"] == "Average"
    assert data["cash"]["amount"] == 82  # CR x 2 (Table II, p.45-47)
    assert data["assets"]["amount"] == 2050  # CR x 50
    assert data["period"] == "1920s"

    penniless = coc_toolbox.run_tool(
        "rules.cash_assets", tmp_path, None, {"credit_rating": 0}
    )
    assert penniless["ok"] is True
    assert penniless["data"]["living_standard"] == "Penniless"

    bad_period = coc_toolbox.run_tool(
        "rules.cash_assets",
        tmp_path,
        None,
        {"credit_rating": 41, "period": "1870s"},
    )
    assert bad_period["ok"] is False
    assert bad_period["error"]["code"] == "invalid_param"


def test_npc_reaction_is_public_deterministic_and_npc_bound(campaign_ws):
    args = {
        "npc_id": "npc-test-clerk",
        "npc_display_name": "测试档案员",
        "investigator": campaign_ws["investigator_id"],
        "context": {
            "player_conduct": "调查员清楚说明来意并保持礼貌",
            "scene_constraints": "档案室仍有正常借阅和保密边界",
            "authored_or_relationship_boundary": "双方第一次见面且没有既有私交",
            "semantic_reason": "外表与信用只调节起初态度",
        },
        "seed": 7,
        "decision_id": "npc-reaction-deterministic",
    }
    first = _run(campaign_ws, "npc.reaction", args)
    second = _run(campaign_ws, "npc.reaction", args)
    assert first["ok"] is True
    assert first["data"] == second["data"]
    data = first["data"]
    assert data["schema_version"] == 2
    assert data["rule_ref"].startswith("keeper-rulebook p.191")
    assert data["governing_attribute"] in ("app", "credit_rating")
    assert data["governing_value"] == max(data["app"], data["credit_rating"])
    assert data["roll_record"]["visibility"] == "public"
    assert data["reaction_tier"]
    engagement = data["record_engagement_operation"]
    assert engagement["operation"] == "state.record_npc_engagement"
    assert engagement["prefilled_arguments"] == {
        "npc_id": "npc-test-clerk",
        "investigator": campaign_ws["investigator_id"],
        "first_impression_ref": data["receipt_id"],
        "run_id": data["run_id"],
    }
    assert engagement["missing_arguments"] == [
        "interaction_kind",
        "decision_id",
        "first_impression_realization",
    ]
    assert engagement["hard_gate"] is False
    # The public first-impression die is written exactly once.
    rolls_log = campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl"
    matching = [
        row for row in _read_jsonl(rolls_log)
        if row.get("payload", {}).get("roll_id") == data["roll_id"]
    ]
    assert len(matching) == 1

    npc_id = _first_npc_id(campaign_ws["campaign_dir"])
    bound = _run(campaign_ws, "npc.reaction", {
        **args,
        "npc_id": npc_id,
        "npc_display_name": "另一位测试 NPC",
        "decision_id": "npc-reaction-authored-bound",
    })
    assert bound["ok"] is True
    assert bound["data"]["npc_id"] == npc_id


def test_table_opening_accepts_empty_presented_roll_ids(campaign_ws):
    narrative = "[in_game]\n没有初见 NPC 的自由开场。\n[/in_game]"
    opening = _run(
        campaign_ws,
        "evidence.table_opening",
        {
            "text": narrative,
            "run_id": "empty-opening-run",
            "presented_roll_ids": [],
            "decision_id": "empty-opening-evidence",
        },
    )

    assert opening["ok"] is True, opening
    assert opening["data"]["text"] == narrative
    assert opening["data"]["presented_roll_ids"] == []


def test_table_opening_boundary_recovers_earliest_logged_row_after_interruption(
    campaign_ws, monkeypatch
):
    original_complete = (
        coc_toolbox.coc_turn_manifest.complete_table_opening_boundary
    )
    interrupted = False

    def interrupt_once(*args, **kwargs):
        nonlocal interrupted
        if not interrupted:
            interrupted = True
            raise coc_toolbox.coc_turn_manifest.TurnManifestError(
                "simulated_interruption", "simulated post-log interruption"
            )
        return original_complete(*args, **kwargs)

    monkeypatch.setattr(
        coc_toolbox.coc_turn_manifest,
        "complete_table_opening_boundary",
        interrupt_once,
    )
    opening_args = {
        "text": "[in_game]\n恢复测试开场。\n[/in_game]",
        "run_id": "opening-recovery-run",
        "presented_roll_ids": [],
        "decision_id": "opening-recovery-evidence",
    }
    opening = _run(campaign_ws, "evidence.table_opening", opening_args)
    assert opening["ok"] is True, opening
    assert any("pre-turn source boundary" in warning for warning in opening["warnings"])
    cursor_path = (
        campaign_ws["campaign_dir"] / "save" / "turn-source-cursor.json"
    )
    assert not cursor_path.exists()

    monkeypatch.setattr(
        coc_toolbox.coc_turn_manifest,
        "complete_table_opening_boundary",
        original_complete,
    )
    later_roll = _run(
        campaign_ws,
        "rules.roll_dice",
        {
            "expression": "1D6",
            "seed": 23,
            "decision_id": "post-interruption-player-roll",
        },
    )
    assert later_roll["ok"] is True, later_roll
    calls = _read_jsonl(
        campaign_ws["campaign_dir"] / "logs" / "toolbox-calls.jsonl"
    )
    earliest_opening_index = next(
        index
        for index, row in enumerate(calls)
        if row.get("tool") == "evidence.table_opening" and row.get("ok") is True
    )
    cursor = json.loads(cursor_path.read_text(encoding="utf-8"))
    assert cursor["next_source_index"] == earliest_opening_index + 1

    cursor_before_replay = cursor_path.read_bytes()
    replay = _run(campaign_ws, "evidence.table_opening", opening_args)
    assert replay["ok"] is True, replay
    assert replay["data"] == opening["data"]
    assert cursor_path.read_bytes() == cursor_before_replay


def test_table_opening_renders_bound_rolls_and_closes_setup_source_prefix(
    campaign_ws,
):
    investigator_id = "credit-focused-investigator"
    source_sheet = coc_toolbox.Ctx(
        campaign_ws["workspace"], campaign_ws["campaign_id"]
    ).sheet(campaign_ws["investigator_id"])
    sheet = deepcopy(source_sheet)
    sheet["id"] = investigator_id
    sheet["name"] = "信用调查员"
    sheet["characteristics"]["APP"] = 40
    sheet["skills"]["Credit Rating"] = 70
    sheet["credit_rating"] = 70
    coc_state.create_investigator(campaign_ws["workspace"], investigator_id, sheet)
    coc_state.link_party(
        campaign_ws["workspace"],
        campaign_ws["campaign_id"],
        [campaign_ws["investigator_id"], investigator_id],
    )

    setup_roll_ids = []
    for index, (expression, seed) in enumerate(
        (("3D6", 1), ("1D100", 2), ("1D10", 3)), start=1
    ):
        setup = _run(
            campaign_ws,
            "rules.roll_dice",
            {
                "expression": expression,
                "reason": f"pre-table source {index}",
                "seed": seed,
                "decision_id": f"pre-table-roll-{index}",
            },
        )
        assert setup["ok"] is True, setup
        setup_roll_ids.append(setup["data"]["roll_id"])

    run_id = "canonical-opening-run"

    def first_impression(npc_id: str, display_name: str, seed: int) -> dict:
        reaction = _run(
            campaign_ws,
            "npc.reaction",
            {
                "npc_id": npc_id,
                "npc_display_name": display_name,
                "investigator": investigator_id,
                "run_id": run_id,
                "context": {
                    "player_conduct": "调查员平静说明来意",
                    "scene_constraints": "对方仍保有自己的职责与边界",
                    "authored_or_relationship_boundary": "双方初次见面且没有既有关系",
                    "semantic_reason": "外表与信用只影响最初接纳方式",
                },
                "seed": seed,
                "decision_id": f"opening-reaction-{npc_id}",
            },
        )
        assert reaction["ok"] is True, reaction
        assert reaction["data"]["app"] == 40
        assert reaction["data"]["credit_rating"] == 70
        assert reaction["data"]["governing_attribute"] == "credit_rating"
        return reaction

    first = first_impression("npc-opening-one", "开场人物甲", 7)
    second = first_impression("npc-opening-two", "开场人物乙", 11)
    opening_roll_ids = [first["data"]["roll_id"], second["data"]["roll_id"]]
    narrative = "[in_game]\n开场叙事仍由 KP 自由书写。\n\n你要做什么？\n[/in_game]"
    opening_args = {
        "text": narrative,
        "run_id": run_id,
        "presented_roll_ids": opening_roll_ids,
        "decision_id": "canonical-opening-evidence",
    }
    opening = _run(campaign_ws, "evidence.table_opening", opening_args)
    assert opening["ok"] is True, opening
    exact_text = opening["data"]["text"]
    expected_lines = [
        coc_toolbox.coc_turn_finalization._render_public_roll(
            reaction["data"]["roll_record"], play_language="zh-Hans"
        )
        for reaction in (first, second)
    ]
    assert opening["data"]["presented_roll_ids"] == opening_roll_ids
    assert "开场叙事仍由 KP 自由书写。" in exact_text
    assert "[roll]" in exact_text and "[/roll]" in exact_text
    for expected in expected_lines:
        assert exact_text.count(expected) == 1
        assert exact_text.index(expected) < exact_text.index("[/in_game]")
    assert "外貌 40 / 信用评级 70；采用信用评级 70" in expected_lines[0]

    calls = _read_jsonl(
        campaign_ws["campaign_dir"] / "logs" / "toolbox-calls.jsonl"
    )
    opening_index = next(
        index
        for index, row in enumerate(calls)
        if row.get("tool") == "evidence.table_opening" and row.get("ok") is True
    )
    cursor_path = (
        campaign_ws["campaign_dir"] / "save" / "turn-source-cursor.json"
    )
    cursor_after_opening = json.loads(cursor_path.read_text(encoding="utf-8"))
    assert cursor_after_opening["next_source_index"] == opening_index + 1
    assert cursor_after_opening["last_finalization_id"] is None

    new_roll = _run(
        campaign_ws,
        "rules.roll_dice",
        {
            "expression": "1D6",
            "reason": "the first genuine player turn",
            "seed": 19,
            "decision_id": "first-player-turn-roll",
        },
    )
    assert new_roll["ok"] is True, new_roll
    cursor_before_replay = cursor_path.read_bytes()
    replay = _run(campaign_ws, "evidence.table_opening", opening_args)
    assert replay["ok"] is True, replay
    assert replay["data"] == opening["data"]
    assert cursor_path.read_bytes() == cursor_before_replay

    journal = _run(
        campaign_ws,
        "state.journal",
        {
            "summary": "首个真实玩家回合完成。",
            "player_text": "我开始行动。",
            "decision_id": "first-player-turn-journal",
        },
    )
    assert journal["ok"] is True, journal
    context = _run(campaign_ws, "turn.output_context")
    assert context["ok"] is True, context
    assert context["data"]["source_roll_ids"] == [new_roll["data"]["roll_id"]]
    public_ids = {
        row["roll_id"]
        for row in context["data"]["mechanics_bundle"]["public_check"]
    }
    assert public_ids == {new_roll["data"]["roll_id"]}
    assert not (set(setup_roll_ids) | set(opening_roll_ids)) & public_ids


def test_scene_context_exposes_party_investigator_briefs(campaign_ws):
    ctx = coc_toolbox.Ctx(
        campaign_ws["workspace"], campaign_ws["campaign_id"]
    )
    state = ctx.inv_state(campaign_ws["investigator_id"])
    state["current_luck"] = 17
    ctx.save_inv_state(campaign_ws["investigator_id"], state)
    context = _run(campaign_ws, "scene.context")
    assert context["ok"] is True
    data = context["data"]
    assert data["party"] == [campaign_ws["investigator_id"]]
    briefs = data["party_investigators"]
    assert len(briefs) == 1
    brief = briefs[0]
    assert brief["investigator_id"] == campaign_ws["investigator_id"]
    assert brief["occupation"]
    assert isinstance(brief["age"], int)
    assert isinstance(brief["app"], int)
    assert isinstance(brief["credit_rating"], int)
    assert brief["credit_tier"] in {
        "penniless", "poor", "average", "wealthy", "rich", "super_rich",
    }
    assert "build" in brief
    assert "mov" in brief
    assert brief["luck"] == 17
    assert set(brief["madness"]) >= {
        "bout_active", "temporary_insane", "indefinite_insane", "delusion_active",
    }
    assert brief["madness"]["bout_active"] is False


def test_rules_build_scale_lookup_and_comparison(tmp_path):
    described = coc_toolbox._describe("rules.build_scale")
    assert described["needs_campaign"] is False

    scale = coc_toolbox.run_tool("rules.build_scale", tmp_path, None, {"build": 5})
    assert scale["ok"] is True
    assert scale["data"]["scale"]["listed"] is True
    assert scale["data"]["scale"]["mythos"] == ["dark young"]
    assert scale["data"]["scale"]["inanimate"] == ["standard car"]

    unlisted = coc_toolbox.run_tool("rules.build_scale", tmp_path, None, {"build": 8})
    assert unlisted["ok"] is True
    assert unlisted["data"]["scale"]["listed"] is False
    assert unlisted["data"]["scale"]["nearest_below"]["build"] == 7
    assert unlisted["data"]["scale"]["nearest_above"]["build"] == 9

    comparison = coc_toolbox.run_tool(
        "rules.build_scale", tmp_path, None, {"actor_build": 0, "target_build": 1}
    )
    assert comparison["ok"] is True
    verdict = comparison["data"]["comparison"]
    assert verdict["lift_throw"]["verdict"] == "barely_lifted"
    assert verdict["maneuver"]["penalty_dice"] == 1
    assert verdict["maneuver"]["impossible"] is False

    impossible = coc_toolbox.run_tool(
        "rules.build_scale", tmp_path, None, {"actor_build": 0, "target_build": 3}
    )
    assert impossible["ok"] is True
    assert impossible["data"]["comparison"]["maneuver"]["impossible"] is True

    missing = coc_toolbox.run_tool("rules.build_scale", tmp_path, None, {})
    assert missing["ok"] is False
    assert missing["error"]["code"] == "invalid_param"

    half_pair = coc_toolbox.run_tool(
        "rules.build_scale", tmp_path, None, {"actor_build": 0}
    )
    assert half_pair["ok"] is False
    assert half_pair["error"]["code"] == "invalid_param"

    bad_type = coc_toolbox.run_tool(
        "rules.build_scale", tmp_path, None, {"build": True}
    )
    assert bad_type["ok"] is False
    assert bad_type["error"]["code"] == "invalid_param"


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


def test_first_impression_hint_on_npc_query_and_engagement(campaign_ws):
    npc_id = _first_neutral_npc_id(campaign_ws["campaign_dir"])

    queried = _run(campaign_ws, "npc.query", {"npc_id": npc_id})
    assert queried["ok"] is True
    assert any(
        "first impression" in hint and "npc.reaction" in hint
        for hint in queried["hints"]
    )

    recorded = _run(campaign_ws, "state.record_npc_engagement", {
        "npc_id": npc_id,
        "interaction_kind": "dialogue",
        "decision_id": "first-impression-hint-1",
        **_first_contact_binding(
            campaign_ws,
            npc_id,
            key="first-impression-hint",
        ),
    })
    assert recorded["ok"] is True
    assert any(
        "first contact settled exactly once" in hint
        for hint in recorded["hints"]
    )

    # The pair receipt itself suppresses the first-contact advisory; later
    # relationship state can then evolve without another first-impression roll.
    queried_after_contact = _run(campaign_ws, "npc.query", {"npc_id": npc_id})
    assert queried_after_contact["ok"] is True
    assert not any("first impression" in hint for hint in queried_after_contact["hints"])
    updated = _run(campaign_ws, "state.npc_update", {
        "npc_id": npc_id,
        "trust_delta": 2,
        "decision_id": "first-impression-hint-2",
    })
    assert updated["ok"] is True
    queried_after = _run(campaign_ws, "npc.query", {"npc_id": npc_id})
    assert queried_after["ok"] is True
    assert not any("first impression" in hint for hint in queried_after["hints"])


# --- progressive semantic contract (opening-bridge) ---


def test_progressive_clue_roll_gate_uses_discovery_mode_not_skill_presence():
    """Automatic discovery is never roll-gated; check mode is; starters remain."""
    automatic = {
        "clue_id": "archive-history",
        "delivery_kind": "obvious",
        "skill": "Library Use",
        "discovery": {"mode": "automatic", "skill": None, "difficulty": None},
    }
    check = {
        "clue_id": "locked-diary",
        "delivery_kind": "obvious",
        "discovery": {
            "mode": "check",
            "skill": "Spot Hidden",
            "difficulty": "regular",
        },
    }
    starter = {
        "clue_id": "starter-check",
        "delivery_kind": "skill_check",
        "skill": "Library Use",
        "difficulty": "regular",
    }
    assert coc_toolbox._clue_is_roll_gated(automatic) is False
    assert coc_toolbox._clue_is_roll_gated(check) is True
    assert coc_toolbox._clue_is_roll_gated(starter) is True
    assert coc_toolbox._clue_roll_gate_skills(check) == ["Spot Hidden"]
    assert coc_toolbox._clue_roll_gate_skills(starter) == ["Library Use"]


def test_progressive_fulfill_resolve_mechanics_preserves_narrative_depth(tmp_path: Path):
    """resolve_* fulfillment merges mechanics only and does not force deep."""
    from datetime import datetime, timedelta, timezone

    assets = _load("coc_module_assets_toolbox_prog", SCRIPTS / "coc_module_assets.py")
    project = _load("coc_module_project_toolbox_prog", SCRIPTS / "coc_module_project.py")
    mechanics = _load("coc_mechanics_toolbox_prog", SCRIPTS / "coc_mechanics.py")
    workspace = tmp_path / "ws"
    workspace.mkdir()
    asset_root = "prog-mech"
    pdf = workspace / "prog-mech.pdf"
    pdf.write_bytes(b"%PDF mechanics fulfillment fixture")
    file_sha = hashlib.sha256(pdf.read_bytes()).hexdigest()
    bundle = workspace / "prog-mech-source"
    bundle.mkdir()
    page_bytes = b"# Appendix\n\nAuthored subject mechanics.\n"
    (bundle / "page-0003.md").write_bytes(page_bytes)
    (bundle / "manifest.json").write_text(json.dumps({
        "schema_version": 1,
        "producer": "codex-pdf-skill",
        "source": {
            "source_id": "pdf:prog-mech",
            "title": "Progressive Mechanics",
            "path": str(pdf),
            "file_sha256": file_sha,
            "page_count": 4,
        },
        "pages": [{
            "pdf_index": 3,
            "markdown_path": "page-0003.md",
            "text_sha256": hashlib.sha256(page_bytes).hexdigest(),
            "review_state": "manual_accepted",
            "parse_confidence": 0.99,
            "grep_anchors": ["Authored subject mechanics."],
        }],
    }), encoding="utf-8")
    assets.register_source_bundle(
        workspace,
        bundle,
        asset_root_id=asset_root,
        module_identity={"canonical_module_id": asset_root},
    )
    assets.put_entity(workspace, asset_root, "npc", "npc-subject", {
        "npc_id": "npc-subject",
        "name": "Subject",
        "display_name": "Subject",
        "parse_state": "body_parsed",
        "source_page_indices": [3],
        "agenda": "Keeps watch over the archive.",
        "origin": "source",
        "mechanics": {"status": "unresolved"},
    })
    now = datetime.now(timezone.utc)
    job_id = "job-resolve-npc-subject"
    host_dir = workspace / ".coc" / "module-assets" / asset_root / "host-work"
    host_dir.mkdir(parents=True, exist_ok=True)
    (host_dir / f"{job_id}.json").write_text(json.dumps({
        "schema_version": assets.HOST_WORK_SCHEMA_VERSION,
        "job_id": job_id,
        "kind": "resolve_npc_mechanics",
        "target_id": "npc-subject",
        "status": "open",
        "dispatch_state": "leased",
        "leased_at": now.isoformat(),
        "lease_expires_at": (now + timedelta(minutes=10)).isoformat(),
        "requested_pdf_indices": [3],
        "cached_page_refs": [{
            "source_id": "pdf:prog-mech",
            "pdf_index": 3,
            "text_sha256": hashlib.sha256(page_bytes).hexdigest(),
        }],
        "batch_subjects": [],
        "work_level": "near_term",
    }, ensure_ascii=False, indent=2), encoding="utf-8")

    campaign_id = "prog-camp"
    camp = workspace / ".coc" / "campaigns" / campaign_id
    camp.mkdir(parents=True)
    (camp / "campaign.json").write_text(json.dumps({
        "schema_version": 1,
        "campaign_id": campaign_id,
        "title": "Prog",
        "status": "active",
        "play_language": "zh-Hans",
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    scenario = camp / "scenario"
    scenario.mkdir(exist_ok=True)
    (scenario / "scenario.json").write_text(json.dumps({
        "schema_version": 1,
        "progressive_asset_root_id": asset_root,
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    for name, payload in {
        "module-meta.json": {
            "schema_version": 1,
            "progressive": True,
            "scenario_id": asset_root,
            "module_identity": {"canonical_module_id": asset_root},
        },
        "story-graph.json": {"schema_version": 1, "scenes": []},
        "clue-graph.json": {"schema_version": 1, "conclusions": []},
        "npc-agendas.json": {"schema_version": 1, "npcs": []},
        "timeline.json": {"schema_version": 1},
        "threat-clocks.json": {"schema_version": 1},
        "handouts.json": {"schema_version": 1},
    }.items():
        (scenario / name).write_text(
            json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8",
        )
    assert project.campaign_asset_root_id(camp) == asset_root

    extracted = {
        "characteristics.STR", "characteristics.CON", "characteristics.SIZ",
        "characteristics.DEX", "characteristics.POW",
        "derived.HP", "derived.MP", "derived.SAN", "derived.MOV", "derived.Build",
        "skills", "weapons",
    }
    observed = sorted(extracted)
    not_authored = sorted(mechanics.ACTOR_FIELD_IDS - extracted)
    pack = {
        "mechanics": {
            "status": "authored",
            "source_refs": [{
                "source_id": "pdf:prog-mech",
                "pdf_index": 3,
                "text_sha256": hashlib.sha256(page_bytes).hexdigest(),
            }],
            "fields_observed": observed,
            "fields_extracted": observed,
            "fields_not_authored": not_authored,
            "provenance": {"authority": "source_authored"},
            "profile": {
                "profile_kind": "actor",
                "characteristic_scale": "percentile",
                "characteristics": {
                    "STR": 60, "CON": 55, "SIZ": 60, "DEX": 50, "POW": 45,
                },
                "derived": {"HP": 11, "MP": 9, "SAN": 45, "MOV": 8, "Build": 1},
                "skills": {"Fighting (Brawl)": 45, "Dodge": 25},
                "weapons": [{"weapon_id": "unarmed", "extends": "unarmed"}],
            },
        }
    }
    result = coc_toolbox.run_tool(
        "progressive.fulfill_host_work",
        workspace,
        campaign_id,
        {"job_id": job_id, "pack": pack},
    )
    assert result["ok"] is True, result
    stored = assets.get_entity(workspace, asset_root, "npc", "npc-subject")
    assert stored is not None
    assert stored["parse_state"] == "body_parsed"
    assert stored["mechanics"]["status"] == "authored"
    assert stored.get("agenda") == "Keeps watch over the archive."


def _opening_component_workspace(
    tmp_path: Path,
    *,
    extra_pdf_indices: tuple[int, ...] = (),
) -> dict:
    workspace = tmp_path / "opening-workspace"
    campaign_id = "opening-component"
    coc_state.create_campaign(
        workspace, campaign_id, "Opening Component", play_language="zh-Hans",
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
            else f"# Appendix {pdf_index}\n\nAccepted extra source page.\n"
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
                if pdf_index == 0 else "Accepted extra source page."
            ],
        })
    (bundle / "manifest.json").write_text(json.dumps({
        "schema_version": 1,
        "producer": "codex-pdf-skill",
        "source": {
            "source_id": "pdf:opening-component",
            "title": "Opening Component",
            "path": str(pdf),
            "file_sha256": file_sha,
            "page_count": max(page_indices) + 1,
        },
        "pages": pages,
    }), encoding="utf-8")
    assets = coc_toolbox.coc_module_project.coc_module_assets
    registration = assets.register_source_bundle(
        workspace,
        bundle,
        asset_root_id="opening-component",
        module_identity={"canonical_module_id": "opening-component"},
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


def test_source_coordinator_dispatch_is_closed_deterministic_and_advisory():
    ready = [
        {
            "job_id": "job-b-2",
            "work_group_id": "group-b",
            "requested_pdf_indices": [2],
        },
        {
            "job_id": "job-a-1",
            "work_group_id": "group-a",
            "requested_pdf_indices": [0],
        },
        {
            "job_id": "job-b-1",
            "work_group_id": "group-b",
            "requested_pdf_indices": [1],
        },
    ]
    first = coc_toolbox._source_coordinator_dispatch(
        workspace_root="/workspace",
        campaign_id="campaign-a",
        asset_root_id="asset-a",
        ready_background=ready,
    )
    second = coc_toolbox._source_coordinator_dispatch(
        workspace_root="/workspace",
        campaign_id="campaign-a",
        asset_root_id="asset-a",
        ready_background=list(reversed(ready)),
    )
    assert first == second
    assert set(first) == {
        "agent_type", "run_in_background", "task_prompt", "packet",
        "codex_task",
    }
    assert first["agent_type"] == "coc-source-coordinator"
    assert first["run_in_background"] is True
    packet = first["packet"]
    assert set(packet) == {
        "schema_version",
        "contract_id",
        "packet_id",
        "adapter_mode",
        "workspace_root",
        "python_executable",
        "toolbox_script",
        "campaign_id",
        "asset_root_id",
        "claim_operation",
        "fulfill_operation",
        "max_leaves",
        "leaf_worker",
        "failure_policy",
    }
    assert packet["contract_id"] == "coc.source-coordinator.v1"
    assert packet["adapter_mode"] == "manager_exact_forward"
    assert packet["workspace_root"] == "/workspace"
    assert Path(packet["python_executable"]).is_absolute()
    assert packet["python_executable"] == sys.executable
    assert Path(packet["toolbox_script"]).is_absolute()
    assert Path(packet["toolbox_script"]) == TOOLBOX_SCRIPT.resolve()
    assert packet["campaign_id"] == "campaign-a"
    assert packet["asset_root_id"] == "asset-a"
    assert packet["max_leaves"] == 2
    claim = packet["claim_operation"]
    assert claim["operation"] == "progressive.claim_host_work"
    assert claim["invoke_via"] == "canonical_typed_operation_gateway"
    assert claim["missing_arguments"] == []
    assert claim["prefilled_arguments"]["limit"] == 2
    assert claim["prefilled_arguments"]["result_delivery"] == (
        "return_to_parent"
    )
    assert claim["prefilled_arguments"]["executor_id"].startswith(
        "source-coordinator:"
    )
    assert packet["fulfill_operation"] == {
        "operation": "progressive.fulfill_host_work",
        "invoke_via": "canonical_typed_operation_gateway",
        "fixed_arguments": {},
        "missing_arguments": ["worker_result"],
        "exact_forward_binding": (
            "worker_result=one exact leaf results[] value"
        ),
        "authority": "source_fulfillment",
        "hard_gate": False,
    }
    assert packet["leaf_worker"] == {
        "agent_type": "coc-source-pack-worker",
        "instruction_ref": str(
            (REPO / "plugins/coc-keeper/agents/coc-source-pack-worker.md").resolve()
        ),
        "run_in_background": False,
        "prompt_binding": "one exact returned packets[] value",
        "result_binding": (
            "forward every exact usable results[] value once through "
            "progressive.fulfill_host_work"
        ),
    }
    failure = packet["failure_policy"]
    assert failure["authority"] == "prompt_first_advisory"
    assert failure["single_failure"] == "transient_allowed"
    assert failure["same_failure_escalation_threshold"] == 3
    assert failure["threshold_outcome"] == "design_issue"
    assert failure["same_task_retry"] is False
    assert failure["player_action_gate"] is False
    assert failure["narrative_gate"] is False
    assert failure["output_gate"] is False
    serialized = json.dumps(first, ensure_ascii=False, sort_keys=True)
    for forbidden in (
        "player_transcript", "source_page_text", "campaign_state",
    ):
        assert forbidden not in serialized
    codex_task = first["codex_task"]
    assert codex_task["contract_id"] == (
        "coc.codex-source-coordinator-task.v1"
    )
    assert Path(codex_task["instruction_ref"]) == (
        REPO / "plugins/coc-keeper/agents/coc-source-coordinator.md"
    ).resolve()
    assert codex_task["packet"] == packet


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


def test_prepare_opening_is_strict_read_only_and_skips_recovery(
    tmp_path: Path, monkeypatch,
):
    ws = _opening_component_workspace(tmp_path)
    spec = coc_toolbox.TOOLS["progressive.prepare_opening"]
    assert spec["access"] == "query"
    assert spec["write_domains"] == ()
    assert spec["recovery_domains"] == ()
    assert spec["response_mode"] == "full"
    assert spec["audit_mode"] == "reference"
    assert spec["strict_read_only"] is True
    with pytest.raises(ValueError, match="strict_read_only requires"):
        coc_toolbox.tool(
            "test.invalid_strict_query",
            "invalid",
            {},
            access="query",
            write_domains=(),
            recovery_domains=None,
            response_mode="full",
            audit_mode="reference",
            strict_read_only=True,
        )

    ctx = coc_toolbox.Ctx(ws["workspace"], ws["campaign_id"])
    before = _game_file_bytes(ws["workspace"])
    data, _warnings, _hints = spec["handler"](ctx, {})
    assert data["opening_ready"] is False
    assert data["skeleton_ready"] is False
    assert data["mutation_cards"][0]["operation"] == (
        "progressive.publish_skeleton"
    )
    assert data["blocking"] == [{
        "code": "opening_skeleton_missing",
        "entity_id": ws["asset_root_id"],
    }]
    assert data["hard_work"] == []
    assert data["opening_page_candidates"] == [{
        "pdf_index": 0,
        "review_state": "manual_accepted",
        "parse_confidence": 0.99,
        "grep_anchor_preview": "A bounded authored opening.",
    }]
    assert data["opening_page_candidate_total"] == 1
    assert data["opening_page_candidate_complete"] is True
    assert data["opening_page_candidate_role"] == (
        "selection_hint_only_not_provenance"
    )
    skeleton_contract = data["mutation_cards"][0][
        "skeleton_argument_contract"
    ]
    assert skeleton_contract["contract_id"] == (
        "coc.progressive-opening-skeleton-argument.v1"
    )
    assert skeleton_contract["closed"] is True
    template = skeleton_contract["prefilled_template"]
    assert template == {
        "schema_version": 1,
        "parse_tier": 1,
        "source": {
            "source_id": "pdf:opening-component",
            "file_sha256": ws["file_sha256"],
            "page_count": 1,
            "producer": "codex-pdf-skill",
        },
        "start_candidates": ["<source-grounded-location-id>"],
        "locations": [{
            "location_id": "<same-start-location-id>",
            "title": "<source-grounded-title>",
            "parse_state": "toc_only",
        }],
        "mechanics_locator_pass_status": "pending",
        "mechanics_index": [],
        "start_clock_status": "unresolved",
    }
    assert skeleton_contract["first_submission_guidance"] == {
        "authority": "advisory",
        "hard_gate": False,
        "copy_prefilled_template": True,
        "replace_placeholders_only": True,
        "omit_optional_source_evidenced_fields": True,
    }
    assert skeleton_contract["required_fields"] == [
        "schema_version",
        "parse_tier",
        "source",
        "start_candidates",
        "locations",
        "mechanics_locator_pass_status",
        "start_clock_status",
    ]
    assert set(skeleton_contract["location_parse_state_enum"]) == (
        coc_toolbox.coc_module_project.coc_module_assets.PARSE_STATES
    )
    assert "mechanics_index" not in skeleton_contract[
        "optional_source_evidenced_fields"
    ]
    selected_data, _warnings, _hints = spec["handler"](
        ctx, {"opening_pdf_indices": [0]},
    )
    assert selected_data["skeleton_ready"] is False
    assert selected_data["source_window_ready"] is True
    assert selected_data["source_window"] == [0]
    assert selected_data["window_origin"] == "host_selected_pre_skeleton"
    assert "opening_page_candidates" not in selected_data
    assert selected_data["blocking"] == [{
        "code": "opening_skeleton_missing",
        "entity_id": ws["asset_root_id"],
    }]
    assert selected_data["ownership"]["semantic_model"] is False
    assert selected_data["ownership"]["player_action_gate"] is False
    assert len(selected_data["cached_page_refs"]) == 1
    selected_ref = selected_data["cached_page_refs"][0]
    assert selected_ref["source_id"] == "pdf:opening-component"
    assert selected_ref["pdf_index"] == 0
    assert len(selected_ref["text_sha256"]) == 64
    assert selected_ref["review_state"] == "manual_accepted"
    assert selected_ref["parse_confidence"] == 0.99
    assert selected_ref["path"] == str(
        ws["workspace"] / ".coc" / "module-assets"
        / ws["asset_root_id"] / "pages" / "0000.md"
    )
    assert selected_data["mutation_cards"][0]["operation"] == (
        "progressive.publish_skeleton"
    )
    assert _game_file_bytes(ws["workspace"]) == before

    recovery_calls = []
    monkeypatch.setattr(
        coc_toolbox.coc_runtime_ops,
        "recover_development_transactions",
        lambda *_args, **_kwargs: recovery_calls.append(True),
    )
    module_root = (
        ws["workspace"] / ".coc" / "module-assets" / ws["asset_root_id"]
    )
    module_before = {
        path.relative_to(module_root): path.read_bytes()
        for path in module_root.rglob("*") if path.is_file()
    }
    result = _run(ws, "progressive.prepare_opening")
    assert result["ok"] is True
    assert recovery_calls == []
    module_after = {
        path.relative_to(module_root): path.read_bytes()
        for path in module_root.rglob("*") if path.is_file()
    }
    assert module_after == module_before
    assert not list(ws["campaign_dir"].rglob("*.lock"))


def test_missing_skeleton_page_catalog_is_complete_bounded_and_fail_closed(
    tmp_path: Path,
):
    ws = _opening_component_workspace(
        tmp_path, extra_pdf_indices=tuple(range(1, 32)),
    )
    prepared = _run(ws, "progressive.prepare_opening")
    assert prepared["ok"] is True, prepared
    data = prepared["data"]
    assert data["opening_page_candidate_total"] == 32
    assert data["opening_page_candidate_complete"] is True
    assert len(data["opening_page_candidates"]) == 32
    assert [
        row["pdf_index"] for row in data["opening_page_candidates"]
    ] == list(range(32))
    candidate_preview_limit = (
        coc_toolbox.coc_module_project.coc_module_assets
        .OPENING_PAGE_CANDIDATE_PREVIEW_MAX_BYTES
    )
    assert all(
        len(row["grep_anchor_preview"].encode("utf-8"))
        <= candidate_preview_limit
        for row in data["opening_page_candidates"]
    )
    assert data["encoded_data_bytes"] <= data["encoded_data_budget_bytes"]
    assert any(
        card["operation"] == "progressive.publish_skeleton"
        for card in data["mutation_cards"]
    )
    assert data["blocking"] == [{
        "code": "opening_skeleton_missing",
        "entity_id": ws["asset_root_id"],
    }]

    invalid = _run(ws, "progressive.prepare_opening", {
        "opening_pdf_indices": [0, 2],
    })
    assert invalid["ok"] is False
    assert invalid["error"]["code"] == "opening_source_window_invalid"
    assert "contiguous" in invalid["error"]["message"]

    published = _run(ws, "progressive.publish_skeleton", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "skeleton": ws["skeleton"],
    })
    assert published["ok"] is True, published
    locator_planned = _run(ws, "progressive.prepare_opening")
    assert locator_planned["ok"] is True, locator_planned
    locator_data = locator_planned["data"]
    assert locator_data["mechanics_locator_page_candidate_total"] == 32
    assert len(locator_data["mechanics_locator_page_candidates"]) == 32
    assert locator_data["encoded_data_bytes"] <= locator_data[
        "encoded_data_budget_bytes"
    ]


def test_opening_component_publish_project_prepare_and_initial_defer(
    tmp_path: Path, monkeypatch,
):
    monkeypatch.setenv("COC_DISABLE_QUEUE_WORKER", "1")
    ws = _opening_component_workspace(tmp_path)
    published = _run(ws, "progressive.publish_skeleton", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "skeleton": ws["skeleton"],
    })
    assert published["ok"] is True, published
    assert published["data"]["status"] == "complete"
    assert published["data"]["stored"] is True
    assert published["data"]["projected"] is True

    assets = coc_toolbox.coc_module_project.coc_module_assets
    assets.put_entity(
        ws["workspace"], ws["asset_root_id"], "location", "opening", {
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
        },
    )
    projected = _run(ws, "progressive.project_opening", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "start_location_id": "opening",
    })
    assert projected["ok"] is True, projected
    assert projected["data"]["status"] == "complete"
    assert projected["data"]["activation_operation"] == {
        "operation": "state.move_scene",
        "invoke_via": "coc_invoke",
        "prefilled_arguments": {
            "scene_id": "opening",
            "defer_initial_progressive_on_enter": True,
        },
        "missing_arguments": ["decision_id"],
        "authority": "advisory",
        "hard_gate": False,
    }

    prepared = _run(ws, "progressive.prepare_opening")
    assert prepared["ok"] is True
    assert prepared["data"]["ready_to_activate"] is True
    assert prepared["data"]["opening_ready"] is False
    assert prepared["data"]["encoded_data_bytes"] <= (
        prepared["data"]["encoded_data_budget_bytes"]
    )
    activation = next(
        card for card in prepared["data"]["mutation_cards"]
        if card["operation"] == "state.move_scene"
    )
    assert activation["prefilled_arguments"] == {
        "scene_id": "opening",
        "defer_initial_progressive_on_enter": True,
    }
    assert activation == projected["data"]["activation_operation"]

    on_enter_calls = []
    monkeypatch.setattr(
        coc_toolbox.coc_module_project,
        "on_enter_scene",
        lambda *_args, **_kwargs: on_enter_calls.append(True),
    )
    moved = _run(ws, "state.move_scene", {
        "scene_id": "opening",
        "reason": "begin authored opening",
        "decision_id": "opening-initial-move",
        "defer_initial_progressive_on_enter": True,
    })
    assert moved["ok"] is True, moved
    assert moved["data"]["progressive"] == {
        "on_enter_deferred": True,
        "deferred_operation": "progressive.on_enter_scene",
        "resume_available": False,
        "scope": "entire_initial_progressive_on_enter_hook",
    }
    assert on_enter_calls == []
    late_projection = _run(ws, "progressive.project_opening", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "start_location_id": "opening",
    })
    assert late_projection["ok"] is True, late_projection
    assert late_projection["data"]["status"] == "current"
    assert "activation_operation" not in late_projection["data"]
    replay = _run(ws, "state.move_scene", {
        "scene_id": "opening",
        "reason": "begin authored opening",
        "decision_id": "opening-initial-move",
        "defer_initial_progressive_on_enter": True,
    })
    assert replay["ok"] is True
    assert replay["data"] == moved["data"]
    assert on_enter_calls == []


def test_mechanics_locator_vertical_is_exact_nonblocking_and_reused(
    tmp_path: Path, monkeypatch,
):
    monkeypatch.setenv("COC_DISABLE_QUEUE_WORKER", "1")
    ws = _opening_component_workspace(tmp_path, extra_pdf_indices=(1, 2))
    appendix_page = coc_toolbox.coc_module_project.coc_module_assets.get_page(
        ws["workspace"], ws["asset_root_id"], 2,
    )
    appendix_meta = appendix_page["meta"]
    appendix_ref = {
        "source_id": appendix_meta["source_id"],
        "pdf_index": 2,
        "text_sha256": appendix_meta["text_sha256"],
    }
    ws["skeleton"]["npc_roster"] = [{
        "npc_id": "lucas-strong",
        "names": ["Lucas Strong"],
        "parse_state": "partial",
        "agenda": "Protect Jane without losing face.",
        # A narrative roster row and its mechanics locator may legitimately
        # bind the same accepted page; the aggregate scope must carry it once.
        "source_page_indices": [2],
        "source_refs": [appendix_ref],
    }]
    published = _run(ws, "progressive.publish_skeleton", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "skeleton": ws["skeleton"],
    })
    assert published["ok"] is True, published
    assets = coc_toolbox.coc_module_project.coc_module_assets
    real_get_page = assets.get_page
    page_body_reads: list[int] = []

    def observe_page_read(workspace, asset_root_id, pdf_index):
        page_body_reads.append(pdf_index)
        return real_get_page(workspace, asset_root_id, pdf_index)

    monkeypatch.setattr(assets, "get_page", observe_page_read)
    planned = _run(ws, "progressive.prepare_opening")
    assert planned["ok"] is True, planned
    data = planned["data"]
    assert {row["pdf_index"] for row in data["mechanics_locator_page_candidates"]} == {
        0, 1, 2,
    }
    # Opening binding may verify its own page; the locator catalog must not
    # read candidate appendix bodies 1 or 2.
    assert set(page_body_reads) <= {0}
    locator_card = next(
        card for card in data["mutation_cards"]
        if card["operation"] == "progressive.request_locator_pass"
    )
    assert locator_card["missing_arguments"] == [
        "mechanics_locator_pdf_indices",
    ]
    assert locator_card["required_for_opening"] is False
    assert locator_card["hard_gate"] is False
    baseline_readiness = {
        key: data[key] for key in (
            "blocking", "hard_work", "ready_to_activate", "opening_ready",
        )
    }
    monkeypatch.setattr(assets, "get_page", real_get_page)
    selected = _run(ws, "progressive.prepare_opening", {
        "mechanics_locator_pdf_indices": [1, 2],
    })
    assert selected["ok"] is True, selected
    assert {
        key: selected["data"][key] for key in baseline_readiness
    } == baseline_readiness
    selected_card = next(
        card for card in selected["data"]["mutation_cards"]
        if card["operation"] == "progressive.request_locator_pass"
    )
    assert selected_card["prefilled_arguments"][
        "mechanics_locator_pdf_indices"
    ] == [1, 2]

    foreign = _run(ws, "progressive.request_locator_pass", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "mechanics_locator_pdf_indices": [3],
        "request_purpose": "mechanics_locator_pass",
    })
    assert foreign["ok"] is False
    assert foreign["error"]["code"] == "mechanics_locator_source_window_invalid"
    requested = _run(ws, "progressive.request_locator_pass", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "mechanics_locator_pdf_indices": [1, 2],
        "request_purpose": "mechanics_locator_pass",
    })
    repeated = _run(ws, "progressive.request_locator_pass", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "mechanics_locator_pdf_indices": [1, 2],
        "request_purpose": "mechanics_locator_pass",
    })
    assert requested["ok"] is True, requested
    assert repeated["ok"] is True, repeated
    assert repeated["data"]["status"] == "coalesced"
    assert repeated["data"]["job_id"] == requested["data"]["job_id"]
    worker = coc_toolbox.coc_module_project._load_sibling(
        "coc_module_queue_worker_locator_vertical",
        "coc_module_queue_worker.py",
    )
    materialized = worker.run_worker_once(ws["workspace"], parallel=1)
    assert materialized["claimed"] == 1
    host_request = assets.list_host_work_requests(
        ws["workspace"], ws["asset_root_id"], include_closed=True, limit=None,
    )[0]
    assert host_request["kind"] == "locate_mechanics_index"
    assert host_request["requested_pdf_indices"] == [1, 2]
    assert host_request["source_aspect"] == "mechanics"
    assert host_request["deadline_class"] == "idle_warm"
    claimed = _run(ws, "progressive.claim_host_work", {
        "executor_id": "locator-test-host", "limit": 1,
    })
    assert claimed["ok"] is True, claimed
    packet = claimed["data"]["packets"][0]
    assert packet["contract_id"] == "coc.source-pack-worker.v1"
    assert packet["requested_pdf_indices"] == [1, 2]
    assert packet["source_aspect"] == "mechanics"
    assert packet["deadline_class"] == "idle_warm"
    assert packet["result_delivery"] == "named_submit"
    request = packet["requests"][0]
    assert request["result_contract"]["contract_id"] == (
        "coc.mechanics-locator-pack.v1"
    )
    result_pack_contract = request["result_contract"]["pack"]
    assert result_pack_contract["required_fields"] == (
        result_pack_contract["allowed_fields"]
    )
    assert result_pack_contract["npc_roster_row"]["allowed_fields"] == [
        "npc_id", "names", "parse_state", "source_page_indices", "source_refs",
    ]
    assert result_pack_contract["npc_roster_row"]["required_fields"] == (
        result_pack_contract["npc_roster_row"]["allowed_fields"]
    )
    assert result_pack_contract["npc_roster_row"]["names_semantics"] == (
        "aliases_for_one_subject_only"
    )
    assert result_pack_contract["npc_roster_row"][
        "shared_stat_block_policy"
    ] == {
        "distinct_named_people": "separate_stable_npc_ids",
        "required_rows_per_person": ["npc_roster", "mechanics_index"],
        "may_reuse_exact_fields": [
            "source_page_indices", "source_refs", "locator_scope",
        ],
        "merge_identity_into_compound_subject": False,
    }
    instruction = request["instruction"]
    for phrase in (
        "every distinct named person",
        "separate stable npc_id",
        "exact source_page_indices, source_refs, and locator_scope",
        "names holds aliases for one subject only",
        "never forms a compound identity",
    ):
        assert phrase in instruction, phrase
    assert result_pack_contract["mechanics_index_row"]["required_fields"] == (
        result_pack_contract["mechanics_index_row"]["allowed_fields"]
    )
    assert any(
        "dramatis_personae_entry_only" in reason
        for reason in result_pack_contract["mechanics_index_row"][
            "does_not_establish_located"
        ]
    )
    assert request["result_contract"]["no_located_subject_result"] == {
        "status": "usable",
        "copy_pack_fixed_fields": True,
        "npc_roster": [],
        "item_roster": [],
        "mechanics_index": [],
        "related_packs": [],
    }
    locator_rules = request["result_contract"]["rules"]
    assert any("every distinct named person" in rule for rule in locator_rules)
    assert any("aliases for one subject only" in rule for rule in locator_rules)
    refs = {
        int(ref["pdf_index"]): {
            "source_id": ref["source_id"],
            "pdf_index": int(ref["pdf_index"]),
            "text_sha256": ref["text_sha256"],
        }
        for ref in request["cached_page_refs"]
    }
    locator_scope = {
        "scope_kind": "explicit_pdf_indices",
        "pdf_indices": [1, 2],
        "source_file_sha256": ws["file_sha256"],
    }

    def npc_row(npc_id: str, names: str | list[str]) -> dict:
        return {
            "npc_id": npc_id,
            "names": [names] if isinstance(names, str) else list(names),
            "parse_state": "named_only",
            "source_page_indices": [2],
            "source_refs": [refs[2]],
        }

    def locator_row(npc_id: str) -> dict:
        return {
            "subject_kind": "npc",
            "subject_id": npc_id,
            "status": "located",
            "locator_pass_status": "complete",
            "locator_scope": locator_scope,
            "source_page_indices": [2],
            "source_refs": [refs[2]],
        }

    locator_pack = {
        "mechanics_locator_pass_status": "pending",
        "mechanics_locator_scope": locator_scope,
        "npc_roster": [
            npc_row("lucas-strong", "Lucas Strong"),
            npc_row("jane-strong", "Jane Strong"),
            npc_row("joseph-turner", "Joseph Turner"),
            npc_row("shared-block-one", "First Distinct Person"),
            npc_row("shared-block-two", "Second Distinct Person"),
            npc_row(
                "one-person-with-aliases",
                ["One Person", "The Same Person's Alias"],
            ),
            npc_row("appendix-person-seven", "Seventh Person"),
            npc_row("appendix-person-eight", "Eighth Person"),
            npc_row("appendix-person-nine", "Ninth Person"),
        ],
        "item_roster": [],
        "mechanics_index": [
            locator_row("lucas-strong"),
            locator_row("jane-strong"),
            locator_row("joseph-turner"),
            locator_row("shared-block-one"),
            locator_row("shared-block-two"),
            locator_row("one-person-with-aliases"),
            locator_row("appendix-person-seven"),
            locator_row("appendix-person-eight"),
            locator_row("appendix-person-nine"),
        ],
    }
    skeleton_path = (
        ws["workspace"] / ".coc" / "module-assets" / ws["asset_root_id"]
        / "skeleton.json"
    )
    before_invalid = skeleton_path.read_bytes()
    invalid_pack = deepcopy(locator_pack)
    invalid_pack["npc_roster"][0]["name"] = invalid_pack[
        "npc_roster"
    ][0].pop("names")[0]
    invalid_pack["npc_roster"][0].pop("source_refs")
    rejected = _run(ws, "progressive.fulfill_host_work", {
        "job_id": request["job_id"],
        "pack": invalid_pack,
        "related_packs": [],
    })
    assert rejected["ok"] is False
    assert rejected["error"]["code"] == "invalid_source_worker_pack"
    assert len(rejected["hints"]) == 1
    assert "must not repair or rewrite" in rejected["hints"][0]
    assert "leave the request unfulfilled" in rejected["hints"][0]
    assert "call describe for the tool schema" not in rejected["hints"][0]
    assert skeleton_path.read_bytes() == before_invalid
    still_open = next(
        row for row in assets.list_host_work_requests(
            ws["workspace"], ws["asset_root_id"], include_closed=True, limit=None,
        )
        if row["job_id"] == request["job_id"]
    )
    assert still_open["status"] != "fulfilled"

    roster_without_locator = deepcopy(locator_pack)
    roster_without_locator["npc_roster"].append(
        npc_row("dramatis-personae-only", "Dramatis Personae Only")
    )
    rejected_roster = _run(ws, "progressive.fulfill_host_work", {
        "job_id": request["job_id"],
        "pack": roster_without_locator,
        "related_packs": [],
    })
    assert rejected_roster["error"]["code"] == "invalid_source_worker_pack"
    assert skeleton_path.read_bytes() == before_invalid

    scope_mismatch = deepcopy(locator_pack)
    scope_mismatch["mechanics_index"][0]["source_page_indices"] = [0]
    scope_mismatch["mechanics_index"][0]["source_refs"] = [refs[2]]
    rejected_scope = _run(ws, "progressive.fulfill_host_work", {
        "job_id": request["job_id"],
        "pack": scope_mismatch,
        "related_packs": [],
    })
    assert rejected_scope["error"]["code"] == "invalid_source_worker_pack"
    assert skeleton_path.read_bytes() == before_invalid

    # The host forwards the complete child item as one exact envelope.  A
    # historically observed parent copy error that nests related_packs inside
    # pack remains a strict child-pack failure; the receiver does not repair it.
    polluted_pack = deepcopy(locator_pack)
    polluted_pack["related_packs"] = []
    polluted_result = {
        "job_id": request["job_id"],
        "pack": polluted_pack,
        "related_packs": [],
    }
    polluted_before = deepcopy(polluted_result)
    direct_base = {
        "schema_version": 1,
        "contract_id": "coc.source-pack-worker.v1",
        "packet_id": packet["packet_id"],
        "work_group_id": packet["work_group_id"],
        "status": "usable",
        "results": [polluted_result],
    }
    with pytest.raises(coc_toolbox.ToolError) as wrong_packet:
        coc_toolbox.submit_source_worker_result(ws["workspace"], {
            **deepcopy(direct_base), "packet_id": "not-the-leased-packet",
        })
    assert wrong_packet.value.code == "invalid_source_lease"
    with pytest.raises(coc_toolbox.ToolError) as wrong_group:
        coc_toolbox.submit_source_worker_result(ws["workspace"], {
            **deepcopy(direct_base), "work_group_id": "not-the-leased-group",
        })
    assert wrong_group.value.code == "invalid_source_lease"
    wrong_jobs = deepcopy(direct_base)
    wrong_jobs["results"][0]["job_id"] = "not-the-leased-job"
    with pytest.raises(coc_toolbox.ToolError) as wrong_job_set:
        coc_toolbox.submit_source_worker_result(ws["workspace"], wrong_jobs)
    assert wrong_job_set.value.code == "invalid_source_lease"
    with monkeypatch.context() as expired_lease:
        expired_lease.setattr(assets, "_lease_is_expired", lambda *_args: True)
        with pytest.raises(coc_toolbox.ToolError) as expired_packet:
            coc_toolbox.submit_source_worker_result(
                ws["workspace"], deepcopy(direct_base),
            )
    assert expired_packet.value.code == "invalid_source_lease"

    rejected_polluted = coc_toolbox.submit_source_worker_result(
        ws["workspace"], direct_base,
    )
    assert rejected_polluted["ok"] is False
    assert rejected_polluted["error"]["code"] == "invalid_source_worker_pack"
    assert "unsupported fields" in rejected_polluted["error"]["message"]
    assert polluted_result == polluted_before
    assert skeleton_path.read_bytes() == before_invalid

    canonical_result = {
        "job_id": request["job_id"],
        "pack": locator_pack,
        "related_packs": [],
    }
    mixed = _run(ws, "progressive.fulfill_host_work", {
        "worker_result": canonical_result,
        "pack": locator_pack,
    })
    assert mixed["ok"] is False
    assert mixed["error"]["code"] == "invalid_param"
    assert "mutually exclusive" in mixed["error"]["message"]
    assert skeleton_path.read_bytes() == before_invalid

    canonical_before = deepcopy(canonical_result)
    fulfilled = coc_toolbox.submit_source_worker_result(ws["workspace"], {
        **deepcopy(direct_base), "results": [canonical_result],
    })
    assert fulfilled["ok"] is True, fulfilled
    assert fulfilled["contract_id"] == "coc.source-submit-receipt.v1"
    assert fulfilled["packet_id"] == packet["packet_id"]
    assert fulfilled["lease_id"] == packet["packet_id"]
    assert fulfilled["work_group_id"] == packet["work_group_id"]
    assert fulfilled["asset_root_id"] == ws["asset_root_id"]
    assert fulfilled["submission_digest"]
    assert fulfilled["job_receipts"] == [{
        "job_id": request["job_id"],
        "ok": True,
        "request_status": "fulfilled",
        "fulfillment_digest": fulfilled["job_receipts"][0][
            "fulfillment_digest"
        ],
    }]
    assert fulfilled["job_receipts"][0]["fulfillment_digest"]
    assert canonical_result == canonical_before
    stored = assets.get_skeleton(ws["workspace"], ws["asset_root_id"])
    assert stored["locations"] == ws["skeleton"]["locations"]
    assert stored["npc_roster"][0] == ws["skeleton"]["npc_roster"][0]
    assert {row["npc_id"] for row in stored["npc_roster"]} == {
        "lucas-strong", "jane-strong", "joseph-turner",
        "shared-block-one", "shared-block-two", "one-person-with-aliases",
        "appendix-person-seven", "appendix-person-eight", "appendix-person-nine",
    }
    stored_roster = {
        row["npc_id"]: row for row in stored["npc_roster"]
    }
    assert stored_roster["shared-block-one"]["source_refs"] == (
        stored_roster["shared-block-two"]["source_refs"]
    )
    assert stored_roster["one-person-with-aliases"]["names"] == [
        "One Person", "The Same Person's Alias",
    ]
    assert stored["mechanics_locator_pass_status"] == "pending"
    assert {
        (row["subject_kind"], row["subject_id"])
        for row in stored["mechanics_index"]
    } == {
        ("npc", "lucas-strong"),
        ("npc", "jane-strong"),
        ("npc", "joseph-turner"),
        ("npc", "shared-block-one"),
        ("npc", "shared-block-two"),
        ("npc", "one-person-with-aliases"),
        ("npc", "appendix-person-seven"),
        ("npc", "appendix-person-eight"),
        ("npc", "appendix-person-nine"),
    }
    stored_index = {
        row["subject_id"]: row for row in stored["mechanics_index"]
    }
    assert stored_index["shared-block-one"]["locator_scope"] == (
        stored_index["shared-block-two"]["locator_scope"]
    )
    closed_request = next(
        row for row in assets.list_host_work_requests(
            ws["workspace"], ws["asset_root_id"], include_closed=True, limit=None,
        )
        if row["job_id"] == request["job_id"]
    )
    assert closed_request["status"] == "fulfilled"

    first_mechanics = _run(ws, "mechanics.ensure", {
        "subject_kind": "npc",
        "subject_id": "lucas-strong",
        "purpose": "check",
        "decision_id": "locator-lucas-first",
    })
    repeated_mechanics = _run(ws, "mechanics.ensure", {
        "subject_kind": "npc",
        "subject_id": "lucas-strong",
        "purpose": "check",
        "decision_id": "locator-lucas-repeat",
    })
    assert first_mechanics["ok"] is True, first_mechanics
    assert first_mechanics["data"]["status"] == "source_work_required"
    assert first_mechanics["data"]["source_work"]["stub"]["entity"][
        "source_page_indices"
    ] == [2]
    assert repeated_mechanics["data"]["source_work"]["enqueue"]["enqueued"] is False
    mechanics_materialized = worker.run_worker_once(ws["workspace"], parallel=1)
    mechanics_request = json.loads(Path(
        mechanics_materialized["results"][0]["host_work_request"]
    ).read_text(encoding="utf-8"))
    assert mechanics_request["requested_pdf_indices"] == [2]
    assert {
        (row["subject_kind"], row["subject_id"])
        for row in mechanics_request["batch_subjects"]
    } == {
        ("npc", "lucas-strong"),
        ("npc", "jane-strong"),
        ("npc", "joseph-turner"),
        ("npc", "shared-block-one"),
        ("npc", "shared-block-two"),
        ("npc", "one-person-with-aliases"),
        ("npc", "appendix-person-seven"),
        ("npc", "appendix-person-eight"),
        ("npc", "appendix-person-nine"),
    }


def test_missing_mechanics_locator_returns_read_only_discovery_card(
    tmp_path: Path, monkeypatch,
):
    monkeypatch.setenv("COC_DISABLE_QUEUE_WORKER", "1")
    ws = _opening_component_workspace(tmp_path)
    ws["skeleton"]["npc_roster"] = [{
        "npc_id": "lucas-strong",
        "names": ["Lucas Strong"],
        "parse_state": "partial",
        "agenda": "Protect Jane without losing face.",
        "source_page_indices": [0],
    }]
    published = _run(ws, "progressive.publish_skeleton", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "skeleton": ws["skeleton"],
    })
    assert published["ok"] is True, published

    requested = _run(ws, "progressive.request_mechanics", {
        "kind": "npc",
        "target_id": "lucas-strong",
        "title": "Lucas Strong",
        "reason": "opposed_strength_check",
    })
    assert requested["ok"] is True, requested
    request_data = requested["data"]
    assert request_data["mechanics_locator_state"] == {
        "global_pass_status": "pending",
        "subject_locator_status": "missing",
        "narrative_body_refs_present": True,
        "narrative_body_refs_are_mechanics_locator": False,
    }
    locator_card = request_data["locator_discovery_operation"]
    assert locator_card == {
        "operation": "progressive.prepare_opening",
        "invoke_via": "coc_invoke",
        "prefilled_arguments": {},
        "missing_arguments": [],
        "authority": "advisory",
        "hard_gate": False,
        "read_only": True,
        "required_for_opening": False,
        "purpose": "discover_mechanics_locator_window",
    }
    assert "mechanics_locator_pdf_indices" not in locator_card[
        "prefilled_arguments"
    ]

    ensured = _run(ws, "mechanics.ensure", {
        "subject_kind": "npc",
        "subject_id": "lucas-strong",
        "purpose": "check",
        "decision_id": "lucas-missing-locator",
    })
    assert ensured["ok"] is True, ensured
    assert ensured["data"]["status"] == "source_work_required"
    assert ensured["data"]["source_work"][
        "mechanics_locator_state"
    ] == request_data["mechanics_locator_state"]
    assert ensured["data"]["next_operation"] == locator_card
    assert ensured["data"]["source_work"][
        "locator_discovery_operation"
    ] == locator_card


def test_empty_locator_window_closes_and_only_new_window_requeues(
    tmp_path: Path, monkeypatch,
):
    monkeypatch.setenv("COC_DISABLE_QUEUE_WORKER", "1")
    ws = _opening_component_workspace(tmp_path, extra_pdf_indices=(1, 2))
    published = _run(ws, "progressive.publish_skeleton", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "skeleton": ws["skeleton"],
    })
    assert published["ok"] is True, published
    first = _run(ws, "progressive.request_locator_pass", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "mechanics_locator_pdf_indices": [1],
        "request_purpose": "mechanics_locator_pass",
    })
    assert first["ok"] is True, first
    worker = coc_toolbox.coc_module_project._load_sibling(
        "coc_module_queue_worker_empty_locator_vertical",
        "coc_module_queue_worker.py",
    )
    materialized = worker.run_worker_once(ws["workspace"], parallel=1)
    assert materialized["claimed"] == 1
    claimed = _run(ws, "progressive.claim_host_work", {
        "executor_id": "empty-locator-test-host", "limit": 1,
    })
    request = claimed["data"]["packets"][0]["requests"][0]
    empty_scope = {
        "scope_kind": "explicit_pdf_indices",
        "pdf_indices": [1],
        "source_file_sha256": ws["file_sha256"],
    }
    fulfilled = _run(ws, "progressive.fulfill_host_work", {
        "job_id": request["job_id"],
        "pack": {
            "mechanics_locator_pass_status": "pending",
            "mechanics_locator_scope": empty_scope,
            "npc_roster": [],
            "item_roster": [],
            "mechanics_index": [],
        },
        "related_packs": [],
    })
    assert fulfilled["ok"] is True, fulfilled
    assert fulfilled["data"]["locator_rows_merged"] == 0
    same_window = _run(ws, "progressive.request_locator_pass", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "mechanics_locator_pdf_indices": [1],
        "request_purpose": "mechanics_locator_pass",
    })
    assert same_window["ok"] is True, same_window
    assert same_window["data"]["status"] == "current"
    assert same_window["data"]["idempotent"] is True
    assert same_window["data"]["worker_kick"]["reason"] == (
        "locator_window_already_reviewed"
    )
    second = _run(ws, "progressive.request_locator_pass", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "mechanics_locator_pdf_indices": [2],
        "request_purpose": "mechanics_locator_pass",
    })
    assert second["ok"] is True, second
    assert second["data"]["status"] == "queued"
    assert second["data"]["job_id"] != first["data"]["job_id"]


@pytest.mark.parametrize(
    "defer_arguments",
    [{}, {"defer_initial_progressive_on_enter": False}],
)
def test_state_move_scene_absent_or_false_deferral_keeps_normal_on_enter(
    tmp_path: Path, monkeypatch, defer_arguments: dict,
):
    ws = _opening_component_workspace(tmp_path)
    published = _run(ws, "progressive.publish_skeleton", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "skeleton": ws["skeleton"],
    })
    assert published["ok"] is True, published
    on_enter_calls: list[tuple[str, str]] = []

    def record_on_enter(_root, campaign_id, scene_id):
        on_enter_calls.append((campaign_id, scene_id))
        return None

    monkeypatch.setattr(
        coc_toolbox.coc_module_project,
        "on_enter_scene",
        record_on_enter,
    )
    moved = _run(ws, "state.move_scene", {
        "scene_id": "opening",
        "reason": "ordinary opening movement",
        "decision_id": "ordinary-opening-move",
        **defer_arguments,
    })

    assert moved["ok"] is True, moved
    assert on_enter_calls == [(ws["campaign_id"], "opening")]
    assert moved["data"].get("progressive", {}).get(
        "on_enter_deferred"
    ) is not True


def test_publish_skeleton_reports_all_three_write_phases_truthfully(
    tmp_path: Path, monkeypatch,
):
    ws = _opening_component_workspace(tmp_path)
    skeleton_path = (
        ws["workspace"] / ".coc" / "module-assets" / ws["asset_root_id"]
        / "skeleton.json"
    )
    invalid = deepcopy(ws["skeleton"])
    invalid["parse_tier"] = 99
    rejected = _run(ws, "progressive.publish_skeleton", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "skeleton": invalid,
    })
    assert rejected["ok"] is False
    assert rejected["error"]["details"] == {
        "status": "validation_failed",
        "complete": False,
        "stored": False,
        "projected": False,
    }
    assert not skeleton_path.exists()

    assets = coc_toolbox.coc_module_project.coc_module_assets
    real_bump = assets._bump_parse_tier
    calls = 0

    def fail_metadata_once(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise assets.ModuleAssetsError("injected registry identity failure")
        return real_bump(*args, **kwargs)

    monkeypatch.setattr(assets, "_bump_parse_tier", fail_metadata_once)
    queue_path = skeleton_path.parent / "parse-queue.json"
    queue_before = queue_path.read_bytes()
    partial = _run(ws, "progressive.publish_skeleton", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "skeleton": ws["skeleton"],
    })
    assert partial["ok"] is True, partial
    assert partial["data"] == {
        "status": "stored_metadata_failed",
        "complete": False,
        "stored": True,
        "projected": False,
        "asset_root_id": ws["asset_root_id"],
        "store": partial["data"]["store"],
        "pending_phase": "parse_tier_registry_identity",
        "metadata_error": {
            "type": "ModuleAssetsError",
            "message": "injected registry identity failure",
        },
        "retry_card": partial["data"]["retry_card"],
    }
    assert skeleton_path.is_file()
    assert queue_path.read_bytes() == queue_before
    retry = _run(ws, "progressive.publish_skeleton", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "skeleton": ws["skeleton"],
    })
    assert retry["ok"] is True, retry
    assert retry["data"]["status"] == "complete"
    assert retry["data"]["stored"] is True
    assert retry["data"]["projected"] is True
    assert queue_path.read_bytes() == queue_before
    registry = assets.load_registry(ws["workspace"])
    assert registry["modules"][ws["asset_root_id"]]["parse_tier_max"] == 1

    projection_ws = _opening_component_workspace(tmp_path / "projection")
    monkeypatch.setattr(
        coc_toolbox.coc_module_project,
        "project_skeleton_to_campaign",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            RuntimeError("injected sparse projection failure")
        ),
    )
    projection_failed = _run(
        projection_ws,
        "progressive.publish_skeleton",
        {
            "asset_root_id": projection_ws["asset_root_id"],
            "source_file_sha256": projection_ws["file_sha256"],
            "skeleton": projection_ws["skeleton"],
        },
    )
    assert projection_failed["ok"] is True
    assert projection_failed["data"]["status"] == "stored_projection_failed"
    assert projection_failed["data"]["stored"] is True
    assert projection_failed["data"]["projected"] is False
    assert projection_failed["data"]["projection_error"] == {
        "type": "RuntimeError",
        "message": "injected sparse projection failure",
    }


@pytest.mark.parametrize(
    "non_pristine_kind",
    [
        "world_active",
        "visited",
        "history",
        "pacing",
        "active_pointer",
        "scene_transition",
    ],
)
def test_prepare_opening_activation_card_requires_exact_pristine_state(
    tmp_path: Path, non_pristine_kind: str,
):
    ws = _opening_component_workspace(tmp_path)
    _publish_and_project_opening_component(ws)
    camp = ws["campaign_dir"]
    if non_pristine_kind in {"world_active", "visited", "history"}:
        path = camp / "save" / "world-state.json"
        doc = json.loads(path.read_text(encoding="utf-8"))
        if non_pristine_kind == "world_active":
            doc["active_scene_id"] = "opening"
        elif non_pristine_kind == "visited":
            doc["visited_scene_ids"] = ["opening"]
        else:
            doc["scene_history"] = ["opening"]
        _write_json(path, doc)
    elif non_pristine_kind == "pacing":
        path = camp / "save" / "pacing-state.json"
        doc = json.loads(path.read_text(encoding="utf-8"))
        doc["turn_number"] = 1
        _write_json(path, doc)
    elif non_pristine_kind == "active_pointer":
        _write_json(camp / "save" / "active-scene.json", {
            "schema_version": 1,
            "scene_id": "opening",
        })
    else:
        events = camp / "logs" / "events.jsonl"
        events.parent.mkdir(parents=True, exist_ok=True)
        events.write_text(
            json.dumps({"event_type": "scene_transition"}) + "\n",
            encoding="utf-8",
        )

    prepared = _run(ws, "progressive.prepare_opening")
    assert prepared["ok"] is True, prepared
    assert prepared["data"]["projected_selected_start_ready"] is True
    assert prepared["data"]["ready_to_activate"] is False
    assert all(
        card["operation"] != "state.move_scene"
        for card in prepared["data"]["mutation_cards"]
    )


def test_stale_selected_projection_agrees_across_prepare_defer_and_project(
    tmp_path: Path,
):
    ws = _opening_component_workspace(tmp_path)
    _publish_and_project_opening_component(ws)
    graph_path = ws["campaign_dir"] / "scenario" / "story-graph.json"
    graph = json.loads(graph_path.read_text(encoding="utf-8"))
    opening = next(row for row in graph["scenes"] if row["scene_id"] == "opening")
    opening["player_safe_summary"] = "TAMPERED NON-SOURCE OPENING"
    _write_json(graph_path, graph)

    assets = coc_toolbox.coc_module_project.coc_module_assets
    root_info = coc_toolbox.coc_module_project.resolve_opening_preparation_root(
        ws["workspace"], ws["campaign_id"],
    )
    skeleton = assets.get_skeleton(ws["workspace"], ws["asset_root_id"])
    binding_result = coc_toolbox.coc_module_project.resolve_selected_opening_binding(
        ws["workspace"], root_info, skeleton, "opening", None,
    )
    assert binding_result["readiness"]["ready"] is True
    payload = coc_toolbox.coc_module_project.build_opening_projection_payload(
        ws["workspace"],
        ws["asset_root_id"],
        "opening",
        binding_result["scope"],
    )
    assert coc_toolbox.coc_module_project.opening_projection_state_is_fresh(
        ws["workspace"], ws["campaign_dir"], ws["asset_root_id"],
        "opening", binding_result["scope"],
    ) is False

    prepared = _run(ws, "progressive.prepare_opening")
    assert prepared["ok"] is True
    assert prepared["data"]["projected_selected_start_ready"] is False
    assert prepared["data"]["ready_to_activate"] is False
    assert any(
        row["code"] == "opening_projection_required"
        for row in prepared["data"]["blocking"]
    )
    assert all(
        card["operation"] != "state.move_scene"
        for card in prepared["data"]["mutation_cards"]
    )

    world_path = ws["campaign_dir"] / "save" / "world-state.json"
    world_before = world_path.read_bytes()
    deferred = _run(ws, "state.move_scene", {
        "scene_id": "opening",
        "decision_id": "stale-opening-defer",
        "defer_initial_progressive_on_enter": True,
    })
    assert deferred["ok"] is False
    assert deferred["error"]["code"] == "initial_progressive_deferral_invalid"
    assert world_path.read_bytes() == world_before

    repaired = _run(ws, "progressive.project_opening", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "start_location_id": "opening",
    })
    assert repaired["ok"] is True, repaired
    assert repaired["data"]["status"] == "complete"
    assert coc_toolbox.coc_module_project.opening_projection_state_is_fresh(
        ws["workspace"], ws["campaign_dir"], ws["asset_root_id"],
        "opening", binding_result["scope"],
    ) is True


def test_prepare_required_npc_does_not_inject_unreferenced_durable_npc(
    tmp_path: Path,
):
    ws = _opening_component_workspace(tmp_path)
    published = _run(ws, "progressive.publish_skeleton", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "skeleton": ws["skeleton"],
    })
    assert published["ok"] is True
    assets = coc_toolbox.coc_module_project.coc_module_assets
    assets.put_entity(
        ws["workspace"], ws["asset_root_id"], "location", "opening",
        _opening_component_pack(),
    )
    assets.put_entity(
        ws["workspace"], ws["asset_root_id"], "npc", "npc-unreferenced", {
            "npc_id": "npc-unreferenced",
            "name": "Unreferenced Witness",
            "parse_state": "deep",
            "source_page_indices": [0],
            "agenda": "Wait outside the selected pack.",
        },
    )

    prepared = _run(ws, "progressive.prepare_opening", {
        "opening_required_npc_ids": ["npc-unreferenced"],
    })
    assert prepared["ok"] is True
    assert prepared["data"]["selected_start_pack_ready"] is False
    assert prepared["data"]["present_npc_ids"] == []
    assert any(
        row["code"] == "opening_required_npc_not_present"
        for row in prepared["data"]["blocking"]
    )
    assert all(
        card["operation"] not in {
            "progressive.project_opening", "state.move_scene",
        }
        for card in prepared["data"]["mutation_cards"]
    )


def test_prepare_opening_dynamically_bounds_long_start_catalog(
    tmp_path: Path,
):
    ws = _opening_component_workspace(tmp_path)
    start_ids = [f"start-{index:03d}" for index in range(100)]
    ws["skeleton"]["start_candidates"] = start_ids
    ws["skeleton"]["locations"] = [
        {
            "location_id": start_id,
            "title": f"{index:03d}-" + ("长标题" * 80),
            "parse_state": "toc_only",
            "source_span": {"pdf_index_start": 0, "pdf_index_end": 0},
        }
        for index, start_id in enumerate(start_ids)
    ]
    published = _run(ws, "progressive.publish_skeleton", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "skeleton": ws["skeleton"],
    })
    assert published["ok"] is True, published

    prepared = _run(ws, "progressive.prepare_opening", {
        "start_location_id": "start-099",
    })
    assert prepared["ok"] is True, prepared
    data = prepared["data"]
    assert data["encoded_data_bytes"] <= data["encoded_data_budget_bytes"] == 12 * 1024
    assert data["start_candidate_total"] == 100
    assert data["start_candidate_returned_count"] == len(data["start_candidates"])
    assert data["start_candidate_omitted_count"] == (
        100 - data["start_candidate_returned_count"]
    )
    assert data["start_candidate_returned_count"] < 64
    assert data["start_candidates"][-1]["location_id"] == "start-099"
    assert [row["location_id"] for row in data["start_candidates"][:-1]] == (
        start_ids[: data["start_candidate_returned_count"] - 1]
    )


def test_prepare_opening_reports_typed_error_when_selected_row_cannot_fit():
    data = {
        "start_candidates": [
            {"location_id": "selected", "title": "x" * (20 * 1024)},
        ],
        "start_candidate_total": 1,
        "deferred": [],
        "deferred_total": 0,
        "soft_work": [],
        "soft_work_total": 0,
        "hard_work": [],
        "hard_work_total": 0,
        "blocking": [],
        "blocking_total": 0,
        "mutation_cards": [],
        "mutation_cards_total": 0,
        "encoded_data_budget_bytes": 12 * 1024,
        "encoded_data_bytes": 0,
    }

    with pytest.raises(coc_toolbox.ToolError) as exc_info:
        coc_toolbox._fit_opening_data_budget(
            data,
            selected_start_location_id="selected",
        )

    assert exc_info.value.code == "opening_selected_candidate_too_large"
    assert exc_info.value.message == (
        "mandatory opening preparation data exceeds the 12 KiB budget"
    )


@pytest.mark.parametrize("raw_id", [True, 7, {"id": "npc"}])
def test_prepare_opening_required_id_selectors_reject_non_strings_every_gateway(
    tmp_path: Path, raw_id,
):
    ws = _opening_component_workspace(tmp_path)
    ctx = coc_toolbox.Ctx(ws["workspace"], ws["campaign_id"])
    handler = coc_toolbox.TOOLS["progressive.prepare_opening"]["handler"]
    with pytest.raises(coc_toolbox.ToolError) as direct:
        handler(ctx, {"opening_required_npc_ids": [raw_id]})
    assert direct.value.code == "invalid_param"
    assert "non-empty string" in direct.value.message

    gateway = _run(ws, "progressive.prepare_opening", {
        "opening_required_secret_ids": [raw_id],
    })
    assert gateway["ok"] is False
    assert gateway["error"]["code"] == "invalid_param"
    assert "non-empty string" in gateway["error"]["message"]


@pytest.mark.parametrize(
    ("raw_start", "matching_candidate"),
    [
        (True, "True"),
        (7, "7"),
        (["opening"], "opening"),
        ({"id": "opening"}, "opening"),
    ],
)
def test_prepare_opening_start_selector_rejects_non_strings_before_coercion(
    tmp_path: Path, raw_start, matching_candidate: str,
):
    ws = _opening_component_workspace(tmp_path)
    ws["skeleton"]["start_candidates"] = [matching_candidate]
    ws["skeleton"]["locations"] = [{
        "location_id": matching_candidate,
        "title": f"Start {matching_candidate}",
        "parse_state": "toc_only",
        "source_span": {"pdf_index_start": 0, "pdf_index_end": 0},
    }]
    published = _run(ws, "progressive.publish_skeleton", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "skeleton": ws["skeleton"],
    })
    assert published["ok"] is True, published
    ctx = coc_toolbox.Ctx(ws["workspace"], ws["campaign_id"])
    handler = coc_toolbox.TOOLS["progressive.prepare_opening"]["handler"]

    with pytest.raises(coc_toolbox.ToolError) as direct:
        handler(ctx, {"start_location_id": raw_start})
    assert direct.value.code == "invalid_param"
    assert direct.value.message == (
        "start_location_id must be a string when provided"
    )

    gateway = _run(ws, "progressive.prepare_opening", {
        "start_location_id": raw_start,
    })
    assert gateway["ok"] is False
    assert gateway["error"] == {
        "code": "invalid_param",
        "message": "start_location_id must be a string when provided",
    }


@pytest.mark.parametrize(
    "args",
    [{}, {"start_location_id": None}, {"start_location_id": "   "}],
)
def test_prepare_opening_start_selector_preserves_omission_semantics(
    tmp_path: Path, args: dict,
):
    ws = _opening_component_workspace(tmp_path)
    published = _run(ws, "progressive.publish_skeleton", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "skeleton": ws["skeleton"],
    })
    assert published["ok"] is True, published
    ctx = coc_toolbox.Ctx(ws["workspace"], ws["campaign_id"])
    handler = coc_toolbox.TOOLS["progressive.prepare_opening"]["handler"]

    direct_data, _, _ = handler(ctx, args)
    assert direct_data["selected_start_location_id"] == "opening"
    gateway = _run(ws, "progressive.prepare_opening", args)
    assert gateway["ok"] is True, gateway
    assert gateway["data"]["selected_start_location_id"] == "opening"


@pytest.mark.parametrize(
    ("operation", "raw_start", "matching_candidate"),
    [
        ("progressive.request_opening_pack", True, "True"),
        ("progressive.request_opening_pack", 7, "7"),
        ("progressive.request_opening_pack", ["opening"], "opening"),
        ("progressive.request_opening_pack", {"id": "opening"}, "opening"),
        ("progressive.project_opening", True, "True"),
        ("progressive.project_opening", 7, "7"),
        ("progressive.project_opening", ["opening"], "opening"),
        ("progressive.project_opening", {"id": "opening"}, "opening"),
    ],
)
def test_opening_mutation_selectors_reject_non_strings_before_coercion(
    tmp_path: Path,
    operation: str,
    raw_start,
    matching_candidate: str,
):
    ws = _opening_component_workspace(tmp_path)
    ws["skeleton"]["start_candidates"] = [matching_candidate]
    ws["skeleton"]["locations"] = [{
        "location_id": matching_candidate,
        "title": f"Start {matching_candidate}",
        "parse_state": "toc_only",
        "source_span": {"pdf_index_start": 0, "pdf_index_end": 0},
    }]
    published = _run(ws, "progressive.publish_skeleton", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "skeleton": ws["skeleton"],
    })
    assert published["ok"] is True, published
    args = {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "start_location_id": raw_start,
    }
    if operation == "progressive.request_opening_pack":
        args.update({
            "opening_pdf_indices": [0],
            "request_purpose": "foreground_opening_slice",
        })
    ctx = coc_toolbox.Ctx(ws["workspace"], ws["campaign_id"])
    handler = coc_toolbox.TOOLS[operation]["handler"]
    with pytest.raises(coc_toolbox.ToolError) as direct:
        handler(ctx, args)
    assert direct.value.code == "invalid_param"
    assert direct.value.message == (
        "start_location_id must be a string when provided"
    )
    gateway = _run(ws, operation, args)
    assert gateway["ok"] is False
    assert gateway["error"] == {
        "code": "invalid_param",
        "message": "start_location_id must be a string when provided",
    }


@pytest.mark.parametrize(
    ("operation", "raw_start"),
    [
        ("progressive.request_opening_pack", None),
        ("progressive.request_opening_pack", "   "),
        ("progressive.project_opening", None),
        ("progressive.project_opening", "   "),
    ],
)
def test_opening_mutation_selectors_require_nonempty_strings(
    tmp_path: Path,
    operation: str,
    raw_start,
):
    ws = _opening_component_workspace(tmp_path)
    args = {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "start_location_id": raw_start,
    }
    if operation == "progressive.request_opening_pack":
        args.update({
            "opening_pdf_indices": [0],
            "request_purpose": "foreground_opening_slice",
        })
    ctx = coc_toolbox.Ctx(ws["workspace"], ws["campaign_id"])
    with pytest.raises(coc_toolbox.ToolError) as direct:
        coc_toolbox.TOOLS[operation]["handler"](ctx, args)
    assert direct.value.code == "invalid_param"
    assert direct.value.message == "start_location_id must be a nonempty string"
    gateway = _run(ws, operation, args)
    assert gateway["ok"] is False
    assert gateway["error"]["code"] == (
        "missing_param" if raw_start is None else "invalid_param"
    )


def test_derived_external_npc_tamper_agrees_across_all_opening_consumers(
    tmp_path: Path,
):
    ws = _opening_component_workspace(tmp_path)
    published = _run(ws, "progressive.publish_skeleton", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "skeleton": ws["skeleton"],
    })
    assert published["ok"] is True, published
    assets = coc_toolbox.coc_module_project.coc_module_assets
    assets.put_entity(
        ws["workspace"], ws["asset_root_id"], "npc", "npc-external", {
            "npc_id": "npc-external",
            "name": "Source Name",
            "agenda": "Deliver the source-authored opening warning.",
            "parse_state": "deep",
            "source_page_indices": [0],
        },
    )
    assets.put_entity(
        ws["workspace"], ws["asset_root_id"], "location", "opening",
        _opening_component_pack(npc_ids=["npc-external"], npcs=[]),
    )
    projected = _run(ws, "progressive.project_opening", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "start_location_id": "opening",
    })
    assert projected["ok"] is True, projected
    npc_path = ws["campaign_dir"] / "scenario" / "npc-agendas.json"
    npc_doc = json.loads(npc_path.read_text(encoding="utf-8"))
    npc = next(
        row for row in npc_doc["npcs"] if row["npc_id"] == "npc-external"
    )
    assert npc["display_name"] == "Source Name"
    npc["display_name"] = "TAMPERED CURRENT DISPLAY"
    _write_json(npc_path, npc_doc)

    prepared = _run(ws, "progressive.prepare_opening")
    assert prepared["ok"] is True, prepared
    assert prepared["data"]["projected_selected_start_ready"] is False
    assert prepared["data"]["ready_to_activate"] is False
    assert any(
        row["code"] == "opening_projection_required"
        for row in prepared["data"]["blocking"]
    )
    assert all(
        card["operation"] != "state.move_scene"
        for card in prepared["data"]["mutation_cards"]
    )

    world_path = ws["campaign_dir"] / "save" / "world-state.json"
    world_before = world_path.read_bytes()
    deferred = _run(ws, "state.move_scene", {
        "scene_id": "opening",
        "decision_id": "derived-npc-stale-defer",
        "defer_initial_progressive_on_enter": True,
    })
    assert deferred["ok"] is False
    assert deferred["error"]["code"] == "initial_progressive_deferral_invalid"
    assert world_path.read_bytes() == world_before

    repaired = _run(ws, "progressive.project_opening", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "start_location_id": "opening",
    })
    assert repaired["ok"] is True, repaired
    assert repaired["data"]["status"] == "complete"
    repaired_doc = json.loads(npc_path.read_text(encoding="utf-8"))
    repaired_npc = next(
        row for row in repaired_doc["npcs"]
        if row["npc_id"] == "npc-external"
    )
    assert repaired_npc["display_name"] == "Source Name"


def test_partial_opening_fulfill_hint_claims_only_explicit_projection(
    tmp_path: Path, monkeypatch,
):
    monkeypatch.setenv("COC_DISABLE_QUEUE_WORKER", "1")
    ws = _opening_component_workspace(tmp_path)
    published = _run(ws, "progressive.publish_skeleton", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "skeleton": ws["skeleton"],
    })
    assert published["ok"] is True
    requested = _run(ws, "progressive.request_opening_pack", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "start_location_id": "opening",
        "opening_pdf_indices": [0],
        "request_purpose": "foreground_opening_slice",
    })
    assert requested["ok"] is True, requested
    worker = coc_toolbox.coc_module_project._load_sibling(
        "coc_module_queue_worker_partial_hint_test",
        "coc_module_queue_worker.py",
    )
    materialized = worker.run_worker_once(ws["workspace"], parallel=1)
    assert materialized["claimed"] == 1

    fulfilled = _run(ws, "progressive.fulfill_host_work", {
        "job_id": requested["data"]["job_id"],
        "pack": _opening_component_pack(parse_state="partial"),
    })
    assert fulfilled["ok"] is True, fulfilled
    assert len(fulfilled["hints"]) == 1
    assert "exact reusable partial opening pack is durable" in fulfilled["hints"][0]
    assert "progressive.prepare_opening" in fulfilled["hints"][0]
    assert "ready for" not in fulfilled["hints"][0]
    assert "re-enqueued" not in fulfilled["hints"][0]
    prepared = _run(ws, "progressive.prepare_opening")
    assert prepared["ok"] is True, prepared
    assert prepared["data"]["window_origin"] == "fulfilled_foreground_request"
    assert prepared["data"]["selected_start_pack_ready"] is True
    current_request = _run(ws, "progressive.request_opening_pack", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "start_location_id": "opening",
        "opening_pdf_indices": [0],
        "request_purpose": "foreground_opening_slice",
    })
    assert current_request["ok"] is True, current_request
    assert current_request["data"]["status"] == "current"
    projected = _run(ws, "progressive.project_opening", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "start_location_id": "opening",
    })
    assert projected["ok"] is True, projected
    assert projected["data"]["status"] == "complete"


def test_partial_opening_missing_npc_agenda_projects_without_repack(
    tmp_path: Path, monkeypatch,
):
    monkeypatch.setenv("COC_DISABLE_QUEUE_WORKER", "1")
    ws = _opening_component_workspace(tmp_path)
    ws["skeleton"]["npc_roster"] = [{
        "npc_id": "npc-witness",
        "names": ["Witness"],
        "parse_state": "named_only",
    }]
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
        "coc_module_queue_worker_soft_agenda_test",
        "coc_module_queue_worker.py",
    )
    materialized = worker.run_worker_once(ws["workspace"], parallel=1)
    assert materialized["claimed"] == 1

    pack = _opening_component_pack(
        parse_state="partial",
        npc_ids=["npc-witness"],
        npcs=[{
            "npc_id": "npc-witness",
            "name": "Witness",
            "parse_state": "partial",
            "player_safe_summary": "A witness is present at the briefing.",
        }],
    )
    fulfilled = _run(ws, "progressive.fulfill_host_work", {
        "job_id": requested["data"]["job_id"],
        "pack": pack,
    })
    assert fulfilled["ok"] is True, fulfilled

    prepared = _run(ws, "progressive.prepare_opening")
    assert prepared["ok"] is True, prepared
    assert prepared["data"]["selected_start_pack_ready"] is True
    assert {
        row["code"] for row in prepared["data"]["blocking"]
    } == {"opening_projection_required"}
    assert prepared["data"]["soft_work"] == [
        {
            "code": "opening_npc_agenda_missing",
            "entity_id": "npc-witness",
        },
        {
            "code": "mechanics_locator_pass_pending",
            "required_for_opening": False,
            "hard_gate": False,
        },
    ]
    assert prepared["data"]["deferred"] == [
        {
            "code": "opening_npc_agenda_deferred",
            "entity_id": "npc-witness",
            "reason": "not_required_for_opening",
        },
        {
            "code": "mechanics_locator_pass_deferred",
            "reason": "idle_warm_not_required_for_opening",
        },
    ]
    project_card = next(
        row for row in prepared["data"]["mutation_cards"]
        if row["operation"] == "progressive.project_opening"
    )

    current = _run(ws, "progressive.request_opening_pack", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "start_location_id": "opening",
        "opening_pdf_indices": [0],
        "request_purpose": "foreground_opening_slice",
    })
    assert current["ok"] is True, current
    assert current["data"]["status"] == "current"
    assert current["data"]["job_id"] == requested["data"]["job_id"]

    projected = _run(
        ws,
        project_card["operation"],
        project_card["prefilled_arguments"],
    )
    assert projected["ok"] is True, projected
    assert projected["data"]["status"] == "complete"
    agendas = json.loads(
        (
            ws["campaign_dir"] / "scenario" / "npc-agendas.json"
        ).read_text(encoding="utf-8")
    )
    witness = next(
        row for row in agendas["npcs"] if row["npc_id"] == "npc-witness"
    )
    assert witness["agenda"] == "npc-witness agenda"

    queue = json.loads(
        (
            ws["workspace"] / ".coc" / "module-assets" / ws["asset_root_id"]
            / "parse-queue.json"
        ).read_text(encoding="utf-8")
    )
    jobs = [
        row
        for state in ("pending", "in_flight", "done")
        for row in queue.get(state) or []
    ]
    assert sum(row.get("kind") == "partial_opening" for row in jobs) == 1
    assert all(row.get("kind") != "deepen_npc" for row in jobs)


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
        "job_id": job_id,
        "pack": _opening_component_pack(parse_state="partial"),
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


def test_changed_partial_pack_cannot_reuse_old_fulfillment_and_replacement_can(
    tmp_path: Path,
    monkeypatch,
):
    ws, old_job_id, _request_path, entity_path = (
        _fulfilled_partial_opening_workspace(tmp_path, monkeypatch)
    )
    assets = coc_toolbox.coc_module_project.coc_module_assets
    changed = json.loads(entity_path.read_text(encoding="utf-8"))
    changed["player_safe_summary"] = "Changed after the first fulfillment."
    changed["host_work_job_id"] = old_job_id
    assets.put_entity(
        ws["workspace"], ws["asset_root_id"], "location", "opening", changed,
    )
    rewritten = assets.get_entity(
        ws["workspace"], ws["asset_root_id"], "location", "opening",
    )
    assert "host_work_job_id" not in rewritten
    assert "host_work_job_id" not in rewritten["ingest_timing"]
    assert assets.current_ingest_fulfillment_receipt(rewritten) is None

    scenario_before = {
        path.name: path.read_bytes()
        for path in (ws["campaign_dir"] / "scenario").glob("*.json")
    }
    prepared = _run(ws, "progressive.prepare_opening", {
        "opening_pdf_indices": [0],
    })
    assert prepared["ok"] is True, prepared
    assert prepared["data"]["selected_start_pack_ready"] is False
    assert "opening_partial_binding_invalid" in {
        row["code"] for row in prepared["data"]["blocking"]
    }
    projected = _run(ws, "progressive.project_opening", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "start_location_id": "opening",
        "opening_pdf_indices": [0],
    })
    assert projected["ok"] is False
    assert projected["error"]["code"] == "opening_partial_binding_invalid"
    assert {
        path.name: path.read_bytes()
        for path in (ws["campaign_dir"] / "scenario").glob("*.json")
    } == scenario_before

    replacement_request = _run(ws, "progressive.request_opening_pack", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "start_location_id": "opening",
        "opening_pdf_indices": [0],
        "request_purpose": "foreground_opening_slice",
    })
    assert replacement_request["ok"] is True, replacement_request
    assert replacement_request["data"]["status"] in {"queued", "coalesced"}
    assert replacement_request["data"]["job_id"] != old_job_id
    worker = coc_toolbox.coc_module_project._load_sibling(
        "coc_module_queue_worker_revision4_partial_replacement",
        "coc_module_queue_worker.py",
    )
    materialized = worker.run_worker_once(ws["workspace"], parallel=1)
    assert materialized["claimed"] == 1
    replacement_pack = json.loads(entity_path.read_text(encoding="utf-8"))
    fulfilled = _run(ws, "progressive.fulfill_host_work", {
        "job_id": replacement_request["data"]["job_id"],
        "pack": replacement_pack,
    })
    assert fulfilled["ok"] is True, fulfilled
    rebound = assets.get_entity(
        ws["workspace"], ws["asset_root_id"], "location", "opening",
    )
    assert assets.current_ingest_fulfillment_receipt(rebound)["job_id"] == (
        replacement_request["data"]["job_id"]
    )
    prepared_after = _run(ws, "progressive.prepare_opening", {
        "opening_pdf_indices": [0],
    })
    assert prepared_after["ok"] is True, prepared_after
    assert prepared_after["data"]["selected_start_pack_ready"] is True
    projected_after = _run(ws, "progressive.project_opening", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "start_location_id": "opening",
        "opening_pdf_indices": [0],
    })
    assert projected_after["ok"] is True, projected_after
    assert projected_after["data"]["status"] == "complete"


@pytest.mark.parametrize(
    "tamper",
    [
        "request_kind",
        "request_entity",
        "request_pack_digest",
        "request_evidence_digest",
        "current_ingest_digest",
    ],
)
def test_partial_receipt_mismatch_refuses_prepare_request_and_project(
    tmp_path: Path,
    monkeypatch,
    tamper: str,
):
    ws, _job_id, request_path, entity_path = (
        _fulfilled_partial_opening_workspace(tmp_path, monkeypatch)
    )
    if tamper.startswith("request_"):
        request = json.loads(request_path.read_text(encoding="utf-8"))
        field, replacement = {
            "request_kind": ("kind", "npc"),
            "request_entity": ("entity_id", "other"),
            "request_pack_digest": ("fulfilled_pack_sha256", "1" * 64),
            "request_evidence_digest": ("source_evidence_sha256", "2" * 64),
        }[tamper]
        request["fulfilled_entity"][field] = replacement
        _write_json(request_path, request)
    else:
        entity = json.loads(entity_path.read_text(encoding="utf-8"))
        receipt_field = (
            coc_toolbox.coc_module_project.coc_module_assets
            .FULFILLED_PACK_INGEST_FIELD
        )
        entity["ingest_timing"][receipt_field]["fulfilled_pack_sha256"] = (
            "3" * 64
        )
        _write_json(entity_path, entity)

    scenario_before = {
        path.name: path.read_bytes()
        for path in (ws["campaign_dir"] / "scenario").glob("*.json")
    }
    prepared = _run(ws, "progressive.prepare_opening", {
        "opening_pdf_indices": [0],
    })
    assert prepared["ok"] is True, prepared
    assert prepared["data"]["selected_start_pack_ready"] is False
    assert "opening_partial_binding_invalid" in {
        row["code"] for row in prepared["data"]["blocking"]
    }
    requested = _run(ws, "progressive.request_opening_pack", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "start_location_id": "opening",
        "opening_pdf_indices": [0],
        "request_purpose": "foreground_opening_slice",
    })
    assert requested["ok"] is True, requested
    assert requested["data"]["status"] != "current"
    projected = _run(ws, "progressive.project_opening", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "start_location_id": "opening",
        "opening_pdf_indices": [0],
    })
    assert projected["ok"] is False
    assert projected["error"]["code"] == "opening_partial_binding_invalid"
    assert {
        path.name: path.read_bytes()
        for path in (ws["campaign_dir"] / "scenario").glob("*.json")
    } == scenario_before


def test_wrong_page_pack_blocks_source_projection_not_ordinary_play(
    tmp_path: Path,
):
    ws = _opening_component_workspace(tmp_path, extra_pdf_indices=(9,))
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
        _opening_component_pack(source_page_indices=[9]),
    )
    scenario_before = {
        path.name: path.read_bytes()
        for path in (ws["campaign_dir"] / "scenario").glob("*.json")
    }
    prepared = _run(ws, "progressive.prepare_opening")
    assert prepared["ok"] is True, prepared
    assert prepared["data"]["ownership"]["player_action_gate"] is False
    assert prepared["data"]["selected_start_pack_ready"] is False
    assert "opening_pack_source_scope_mismatch" in {
        row["code"] for row in prepared["data"]["blocking"]
    }
    assert all(
        card["operation"] != "state.move_scene"
        for card in prepared["data"]["mutation_cards"]
    )
    projected = _run(ws, "progressive.project_opening", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "start_location_id": "opening",
    })
    assert projected["ok"] is False
    assert projected["error"]["code"] == "opening_pack_source_scope_mismatch"
    assert {
        path.name: path.read_bytes()
        for path in (ws["campaign_dir"] / "scenario").glob("*.json")
    } == scenario_before
    world_path = ws["campaign_dir"] / "save" / "world-state.json"
    world_before = world_path.read_bytes()
    deferred = _run(ws, "state.move_scene", {
        "scene_id": "opening",
        "decision_id": "wrong-page-explicit-defer",
        "defer_initial_progressive_on_enter": True,
    })
    assert deferred["ok"] is False
    assert deferred["error"]["code"] == "initial_progressive_deferral_invalid"
    assert world_path.read_bytes() == world_before

    ordinary = _run(ws, "state.move_scene", {
        "scene_id": "opening",
        "decision_id": "wrong-page-ordinary-move",
    })
    assert ordinary["ok"] is True, ordinary
    assert ordinary["data"]["to_scene_id"] == "opening"


def test_covering_extra_page_pack_is_current_for_request_and_can_activate(
    tmp_path: Path,
):
    ws = _opening_component_workspace(tmp_path, extra_pdf_indices=(9,))
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
        _opening_component_pack(source_page_indices=[0, 9]),
    )
    current_request = _run(ws, "progressive.request_opening_pack", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "start_location_id": "opening",
        "opening_pdf_indices": [0],
        "request_purpose": "foreground_opening_slice",
    })
    assert current_request["ok"] is True, current_request
    assert current_request["data"]["status"] == "current"
    prepared = _run(ws, "progressive.prepare_opening")
    assert prepared["ok"] is True, prepared
    assert prepared["data"]["selected_start_pack_ready"] is True
    projected = _run(ws, "progressive.project_opening", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "start_location_id": "opening",
    })
    assert projected["ok"] is True, projected
    activated = _run(ws, "state.move_scene", {
        "scene_id": "opening",
        "decision_id": "covering-extra-page-defer",
        "defer_initial_progressive_on_enter": True,
    })
    assert activated["ok"] is True, activated
    assert activated["data"]["progressive"]["on_enter_deferred"] is True


def test_explicit_page_one_scope_survives_prepare_project_and_disk_defer(
    tmp_path: Path,
):
    ws = _opening_component_workspace(
        tmp_path, extra_pdf_indices=(1, 2),
    )
    ws["skeleton"]["locations"][0]["source_span"] = {
        "pdf_index_start": 0,
        "pdf_index_end": 2,
    }
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
        _opening_component_pack(source_page_indices=[1]),
    )

    prepared = _run(ws, "progressive.prepare_opening", {
        "opening_pdf_indices": [1],
    })
    assert prepared["ok"] is True, prepared
    assert prepared["data"]["source_window"] == [1]
    assert prepared["data"]["window_origin"] == "host_selected"
    assert prepared["data"]["selected_start_pack_ready"] is True
    project_card = next(
        row for row in prepared["data"]["mutation_cards"]
        if row["operation"] == "progressive.project_opening"
    )
    assert project_card["prefilled_arguments"]["opening_pdf_indices"] == [1]

    current_request = _run(ws, "progressive.request_opening_pack", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "start_location_id": "opening",
        "opening_pdf_indices": [1],
        "request_purpose": "foreground_opening_slice",
    })
    assert current_request["ok"] is True, current_request
    assert current_request["data"]["status"] == "current"
    assert current_request["data"]["job_id"] is None

    projected = _run(
        ws,
        project_card["operation"],
        project_card["prefilled_arguments"],
    )
    assert projected["ok"] is True, projected
    assert projected["data"]["status"] == "complete"
    scenario = json.loads(
        (
            ws["campaign_dir"] / "scenario" / "scenario.json"
        ).read_text(encoding="utf-8")
    )
    assert scenario["opening_projection_source_binding"]["source_scope"][
        "pdf_indices"
    ] == [1]
    assert set(scenario["opening_projection_receipt"]) == {
        "schema_version",
        "asset_root_id",
        "start_location_id",
        "source_evidence_sha256",
        "projection_input_sha256",
    }

    prepared_after_reload = _run(ws, "progressive.prepare_opening", {
        "opening_pdf_indices": [1],
    })
    assert prepared_after_reload["ok"] is True, prepared_after_reload
    assert prepared_after_reload["data"]["projected_selected_start_ready"] is True
    assert prepared_after_reload["data"]["ready_to_activate"] is True
    second_project = _run(ws, "progressive.project_opening", {
        **project_card["prefilled_arguments"],
    })
    assert second_project["ok"] is True, second_project
    assert second_project["data"]["status"] == "current"
    assert second_project["data"]["idempotent"] is True

    # No prior prepare response is consulted here: explicit defer reloads the
    # persisted page-1 binding and revalidates current module evidence.
    activated = _run(ws, "state.move_scene", {
        "scene_id": "opening",
        "decision_id": "explicit-page-one-opening",
        "defer_initial_progressive_on_enter": True,
    })
    assert activated["ok"] is True, activated
    assert activated["data"]["to_scene_id"] == "opening"
    assert activated["data"]["progressive"]["on_enter_deferred"] is True


def test_persisted_opening_binding_tamper_blocks_only_authored_activation(
    tmp_path: Path,
):
    ws = _opening_component_workspace(tmp_path)
    _publish_and_project_opening_component(ws)
    scenario_path = ws["campaign_dir"] / "scenario" / "scenario.json"
    scenario = json.loads(scenario_path.read_text(encoding="utf-8"))
    scenario["opening_projection_source_binding"][
        "source_scope_signature"
    ] = "0" * 64
    _write_json(scenario_path, scenario)

    prepared = _run(ws, "progressive.prepare_opening", {
        "opening_pdf_indices": [0],
    })
    assert prepared["ok"] is True, prepared
    assert prepared["data"]["ownership"]["player_action_gate"] is False
    assert prepared["data"]["projected_selected_start_ready"] is False
    assert prepared["data"]["ready_to_activate"] is False

    world_path = ws["campaign_dir"] / "save" / "world-state.json"
    world_before = world_path.read_bytes()
    explicit_defer = _run(ws, "state.move_scene", {
        "scene_id": "opening",
        "decision_id": "tampered-binding-explicit-defer",
        "defer_initial_progressive_on_enter": True,
    })
    assert explicit_defer["ok"] is False
    assert explicit_defer["error"]["code"] == (
        "initial_progressive_deferral_invalid"
    )
    assert world_path.read_bytes() == world_before

    # The source-classification prerequisite is not a player-action gate.
    ordinary = _run(ws, "state.move_scene", {
        "scene_id": "opening",
        "decision_id": "tampered-binding-ordinary-move",
    })
    assert ordinary["ok"] is True, ordinary
    assert ordinary["data"]["to_scene_id"] == "opening"

    scenario_before_project = {
        path.name: path.read_bytes()
        for path in (ws["campaign_dir"] / "scenario").glob("*.json")
    }
    refused_repair_after_play = _run(ws, "progressive.project_opening", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "start_location_id": "opening",
        "opening_pdf_indices": [0],
    })
    assert refused_repair_after_play["ok"] is False
    assert refused_repair_after_play["error"]["code"] == (
        "opening_projection_non_pristine"
    )
    assert {
        path.name: path.read_bytes()
        for path in (ws["campaign_dir"] / "scenario").glob("*.json")
    } == scenario_before_project


def test_campaign_local_pack_stays_local_across_prepare_project_and_defer(
    tmp_path: Path,
):
    ws = _opening_component_workspace(tmp_path)
    published = _run(ws, "progressive.publish_skeleton", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "skeleton": ws["skeleton"],
    })
    assert published["ok"] is True, published
    assets = coc_toolbox.coc_module_project.coc_module_assets
    local_pack = _opening_component_pack(
        origin="campaign_improvised",
        provenance={"authority": "campaign_improvised"},
    )
    local_pack.pop("source_page_indices", None)
    assets.put_entity(
        ws["workspace"], ws["asset_root_id"], "location", "opening", local_pack,
    )
    entity_path = (
        ws["workspace"] / ".coc" / "module-assets" / ws["asset_root_id"]
        / "entities" / "location-opening.json"
    )
    entity_before = entity_path.read_bytes()
    prepared = _run(ws, "progressive.prepare_opening")
    assert prepared["ok"] is True, prepared
    assert prepared["data"]["ownership"]["player_action_gate"] is False
    codes = {row["code"] for row in prepared["data"]["blocking"]}
    assert "opening_pack_source_authority_invalid" in codes
    assert "opening_pack_source_evidence_missing" in codes
    projected = _run(ws, "progressive.project_opening", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "start_location_id": "opening",
    })
    assert projected["ok"] is False
    assert projected["error"]["code"] == "opening_pack_source_authority_invalid"
    world_path = ws["campaign_dir"] / "save" / "world-state.json"
    world_before = world_path.read_bytes()
    deferred = _run(ws, "state.move_scene", {
        "scene_id": "opening",
        "decision_id": "local-pack-explicit-defer",
        "defer_initial_progressive_on_enter": True,
    })
    assert deferred["ok"] is False
    assert deferred["error"]["code"] == "initial_progressive_deferral_invalid"
    assert world_path.read_bytes() == world_before
    assert entity_path.read_bytes() == entity_before
