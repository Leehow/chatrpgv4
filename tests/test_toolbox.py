"""Contract tests for the keeper toolbox CLI/registry (coc_toolbox.py)."""
from __future__ import annotations

import importlib.util
import json
import random
import subprocess
import sys
import time
from contextlib import contextmanager
from pathlib import Path

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
coc_director_apply = _load(
    "coc_director_apply_for_toolbox", SCRIPTS / "coc_director_apply.py"
)

EXPECTED_NAMESPACES = {
    "rules",
    "combat",
    "development",
    "scene",
    "clues",
    "npc",
    "actions",
    "director",
    "storylets",
    "secrets",
    "state",
}


def _write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


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
    return coc_toolbox.run_tool(
        tool,
        ws["workspace"],
        ws["campaign_id"],
        args or {},
    )


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
    envelope = _run(campaign_ws, "director.advise", {})
    assert envelope["ok"] is True
    assert envelope["tool"] == "director.advise"
    assert "data" in envelope
    assert isinstance(envelope["warnings"], list)
    assert isinstance(envelope["hints"], list)
    assert "error" not in envelope


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
            {"points": 1, "roll": 51, "target": 50, "outcome": "failure"},
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
    assert data["pushed"] is False


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
            "reason": "retry must not roll again",
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
    envelope = _run(
        campaign_ws,
        "rules.roll_dice",
        {"expression": "2D6+1", "seed": 9, "decision_id": "dice-log-1"},
    )
    assert envelope["ok"] is True
    row = _read_jsonl(campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl")[-1]
    payload = row["payload"]
    assert payload["die_expression"] == "2D6+1"
    assert payload["individual_faces"] == envelope["data"]["rolls"]
    assert payload["final_total"] == envelope["data"]["total"]
    assert payload["roll"] == envelope["data"]["total"]


def test_rules_luck_spend_is_idempotent_and_does_not_fabricate_roll(campaign_ws):
    state_path = (
        campaign_ws["campaign_dir"]
        / "save"
        / "investigator-state"
        / f"{campaign_ws['investigator_id']}.json"
    )
    before_luck = json.loads(state_path.read_text(encoding="utf-8"))["current_luck"]
    roll_path = campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl"
    before_rolls = len(_read_jsonl(roll_path))
    args = {
        "investigator": campaign_ws["investigator_id"],
        "points": 1,
        "roll": 51,
        "target": 50,
        "outcome": "failure",
        "roll_kind": "skill",
        "decision_id": "luck-once",
    }
    first = _run(campaign_ws, "rules.luck_spend", args)
    second = _run(campaign_ws, "rules.luck_spend", args)
    assert first["ok"] and second["ok"]
    assert second["data"] == first["data"]
    assert any("duplicate decision_id" in warning for warning in second["warnings"])
    after_luck = json.loads(state_path.read_text(encoding="utf-8"))["current_luck"]
    assert after_luck == before_luck - 1
    assert len(_read_jsonl(roll_path)) == before_rolls
    luck_events = [
        row
        for row in _read_jsonl(campaign_ws["campaign_dir"] / "logs" / "events.jsonl")
        if row.get("event_type") == "luck_spent"
    ]
    assert len(luck_events) == 1


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
    assert same_tool["error"]["code"] == "legacy_recovery_unverifiable"
    assert "should-not-write" not in coc_toolbox.Ctx(
        campaign_ws["workspace"], campaign_ws["campaign_id"]
    ).flags().get("flags", {})
    assert other_tool["ok"] is True
    assert other_tool["data"]["npc_id"] == npc_id
    assert other_tool["data"]["applied"]["trust"] == 1


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
    assert replay["error"]["code"] == "legacy_recovery_unverifiable"
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


def test_legacy_flag_set_without_value_projects_structured_true(campaign_ws):
    campaign_dir = campaign_ws["campaign_dir"]
    flags_path = campaign_dir / "save" / "flags.json"
    flags = json.loads(flags_path.read_text(encoding="utf-8"))
    flags.setdefault("flags", {})["legacy-locked-door"] = True
    flags.get("flag_provenance", {}).pop("legacy-locked-door", None)
    flags.get("flag_heads", {}).pop("legacy-locked-door", None)
    _write_json(flags_path, flags)
    with (campaign_dir / "logs" / "events.jsonl").open(
        "a", encoding="utf-8"
    ) as handle:
        handle.write(json.dumps({
            "event_type": "flag_set",
            "flag_id": "legacy-locked-door",
            "decision_id": "legacy-director-flag",
            "ts": "1920-01-01T00:00:00Z",
        }) + "\n")

    continuity = _run(campaign_ws, "scene.context")["data"]["continuity"]

    recent = next(
        row for row in continuity["recent_world_flag_changes"]
        if row["flag_id"] == "legacy-locked-door"
    )
    live = next(
        row for row in continuity["live_world_flags"]
        if row["flag_id"] == "legacy-locked-door"
    )
    assert recent["value"] is True
    assert recent["provenance"]["source"] == "legacy.flag_set"
    assert live["provenance"]["decision_id"] == "legacy-director-flag"


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

    monkeypatch.setattr(
        coc_toolbox.coc_runtime_ops,
        "settle_development",
        original,
    )
    recovered = _run(campaign_ws, "state.end_session", args)
    assert recovered["ok"] is True
    assert recovered["data"]["development"]["status"] == "PASS"
    endings = [
        row
        for row in _read_jsonl(
            campaign_ws["campaign_dir"] / "logs" / "events.jsonl"
        )
        if row.get("event_type") == "session_ending"
        and row.get("decision_id") == args["decision_id"]
    ]
    assert len(endings) == 1


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
    assert attempts == coc_toolbox._TOOL_TRANSIENT_RETRY_ATTEMPTS
    assert any("ending is durable" in warning for warning in pending["warnings"])

    monkeypatch.setattr(
        coc_toolbox.coc_runtime_ops,
        "settle_development",
        original,
    )
    recovered = _run(campaign_ws, "state.end_session", args)
    assert recovered["ok"] is True
    assert recovered["data"]["development"]["status"] == "PASS"
    assert any("pending development settlement completed" in warning
               for warning in recovered["warnings"])
    endings = [
        row for row in _read_jsonl(
            campaign_ws["campaign_dir"] / "logs" / "events.jsonl"
        )
        if row.get("event_type") == "session_ending"
        and row.get("decision_id") == args["decision_id"]
    ]
    assert len(endings) == 1


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
    assert result["skills_checked"] == ["Fighting (Brawl)"]
    assert result["ending_evidence"]["conclusion_id"] == "corbitt-destroyed"
    assert result["ending_evidence"]["conclusion_evidence"] == {
        "kind": "combat_outcome",
        "combat_id": "combat-corbitt-confrontation",
        "combat_outcome": "investigators_win",
        "scene_ref": "scene/corbitt-confrontation",
        "event_type": "combat_ended",
    }
    assert result["scenario_san_reward_expr"] == "1D6"
    assert result["scenario_san_reward"]["expression"] == "1D6"
    improvement = result["skills_improved"][0]
    assert improvement["skill"] == "Fighting (Brawl)"
    assert improvement["value_before"] == brawl_before
    assert json.loads(character_path.read_text(encoding="utf-8"))["skills"][
        "Fighting (Brawl)"
    ] == improvement["value_after"]
    assert json.loads(state_path.read_text(encoding="utf-8"))[
        "skill_checks_earned"
    ] == []

    roll_path = campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl"
    rolls = _read_jsonl(roll_path)
    kinds = [row.get("payload", {}).get("kind") for row in rolls]
    assert kinds.count("development_check") == 1
    assert kinds.count("development_gain") == 1
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


# --------------------------------------------------------------------------- #
# Soft-rule advisory behavior
# --------------------------------------------------------------------------- #


def test_director_advise_is_advisory_not_blocking(campaign_ws):
    envelope = _run(campaign_ws, "director.advise", {})
    assert envelope["ok"] is True
    data = envelope["data"]
    assert "suggestions" in data
    assert isinstance(data["suggestions"], list)
    assert data["suggestions"]
    assert "beat" in data["suggestions"][0]
    # Advisory channel: hints/warnings, never a hard failure for normal play.
    assert isinstance(envelope["warnings"], list)
    assert any("advisory" in h for h in envelope["hints"])


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


def test_npc_query_preserves_authored_identity_contract(campaign_ws):
    envelope = _run(campaign_ws, "npc.query", {"npc_id": "npc-kim-debrun"})

    assert envelope["ok"] is True
    kim = envelope["data"]["npcs"][0]
    assert kim["origin"] == "source"
    assert kim["relationship_to_investigators"] == "court_contact"
    assert kim["social_role"]["authority_scope"] == ["specialist_knowledge"]
    assert kim["identity_ref"].startswith("npc-identity-v1:")
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


def test_record_npc_engagement_is_idempotent_without_psych_mutation(campaign_ws):
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
        "decision_id": "kim-engagement-once",
    }
    state_path = campaign_ws["campaign_dir"] / "save" / "npc-state.json"
    before = state_path.read_bytes() if state_path.is_file() else None

    first = _run(campaign_ws, "state.record_npc_engagement", args)
    replay = _run(campaign_ws, "state.record_npc_engagement", args)

    assert first["ok"] is True
    assert replay["data"] == first["data"]
    assert first["data"]["event_type"] == "npc_engagement"
    assert first["data"]["interaction_kind"] == "dialogue"
    assert first["data"]["identity_binding"]["status"] == "authored_bound"
    assert first["data"]["identity_binding"]["authored_identity_attested"] is True
    assert first["data"]["identity_binding"]["coverage_eligible"] is True
    after = state_path.read_bytes() if state_path.is_file() else None
    assert after == before
    matching = [
        row
        for row in _read_jsonl(campaign_ws["campaign_dir"] / "logs" / "events.jsonl")
        if row.get("event_type") == "npc_engagement"
        and row.get("npc_id") == "npc-kim-debrun"
    ]
    assert len(matching) == 1


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
    assert dooley["identity_contract"]["identity_ref"] == dooley_ref
    assert dooley["identity_contract"]["location_provenance"] == {
        "active_scene_id": "neighborhood-gossip",
        "authored_scene_ids": ["neighborhood-gossip"],
        "active_scene_matches_schedule": True,
    }


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
    result = _run(
        campaign_ws,
        "rules.push",
        {
            "investigator": campaign_ws["investigator_id"],
            "skill": "Library Use",
            "method_changed": "cross-check the index against the court docket",
            "failure_consequence": "the archive closes before the trail is copied",
            "decision_id": "push-with-consequence",
            "seed": 2,
        },
    )
    assert result["ok"] is True
    assert result["data"]["failure_consequence"]["summary"].startswith(
        "the archive closes"
    )
    roll = _read_jsonl(campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl")[-1]
    assert roll["payload"]["announced_consequence"] == result["data"][
        "failure_consequence"
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
            "seed": 9,
        },
    )
    assert resolved["ok"] is True, resolved
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
    assert replay["error"]["code"] == "legacy_recovery_unverifiable"
    assert source_path.read_bytes() == before


@pytest.mark.parametrize("entity_kind", ["flag", "marker"])
def test_schema_v2_receipt_migrates_atomically_only_with_complete_live_evidence(
    campaign_ws, entity_kind,
):
    campaign_dir = campaign_ws["campaign_dir"]
    if entity_kind == "flag":
        tool_name = "state.set_flag"
        args = {
            "flag_id": "v2-provable-flag",
            "value": False,
            "decision_id": "v2-provable-flag-decision",
        }
        source_path = campaign_dir / "save" / "flags.json"
    else:
        tool_name = "state.time_marker"
        args = {
            "action": "set",
            "marker_id": "v2-provable-marker",
            "minutes_from_now": 11,
            "decision_id": "v2-provable-marker-decision",
        }
        source_path = campaign_dir / "save" / "time-markers.json"
    original = _run(campaign_ws, tool_name, args)
    assert original["ok"] is True
    source = json.loads(source_path.read_text(encoding="utf-8"))
    receipt = source["operation_receipts"][tool_name][args["decision_id"]]
    receipt.pop("entity_head")
    receipt["schema_version"] = 2
    receipt["integrity_digest"] = coc_toolbox._source_receipt_integrity(receipt)
    _write_json(source_path, source)

    replay = _run(campaign_ws, tool_name, args)

    assert replay["ok"] is True
    migrated = json.loads(source_path.read_text(encoding="utf-8"))[
        "operation_receipts"
    ][tool_name][args["decision_id"]]
    assert migrated["schema_version"] == 3
    assert coc_toolbox.coc_flag_state.valid_entity_head(migrated["entity_head"])


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
    provenance = dict(flags["flag_provenance"][args["flag_id"]])
    provenance.update({
        "source": "forged",
        "producer": "forged",
        "decision_id": "forged-decision",
        "source_sequence": 999,
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
            source_sequence=999,
            producer="forged",
            live_record=live_record,
        )
    )
    flags["flag_source_sequence"] = 999
    _write_json(flags_path, flags)

    continuity = _run(campaign_ws, "scene.context")["data"]["continuity"]
    live = next(
        row for row in continuity["live_world_flags"]
        if row["flag_id"] == args["flag_id"]
    )
    assert live["provenance"]["producer"] == "state.set_flag"
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
    marker = dict(payload["markers"][args["marker_id"]])
    marker.update({"decision_id": "forged-marker", "source_sequence": 999})
    payload["markers"][args["marker_id"]] = marker
    live_record = coc_toolbox._marker_live_record(payload, args["marker_id"])
    payload["marker_heads"][args["marker_id"]] = (
        coc_toolbox.coc_flag_state.entity_head(
            entity_kind="time_marker",
            entity_id=args["marker_id"],
            decision_id="forged-marker",
            source_sequence=999,
            producer="forged",
            live_record=live_record,
        )
    )
    payload["marker_source_sequence"] = 999
    _write_json(marker_path, payload)

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
        },
    )
    assert result["ok"] is True
    assert type(result["data"]["schema_version"]) is int
    assert result["data"]["schema_version"] == (
        coc_toolbox.coc_npc_identity.ENGAGEMENT_EVENT_SCHEMA_VERSION
    )
