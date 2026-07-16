"""Contract tests for the keeper toolbox CLI/registry (coc_toolbox.py)."""
from __future__ import annotations

import hashlib
import importlib.util
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
    return coc_toolbox.run_tool(
        tool,
        ws["workspace"],
        ws["campaign_id"],
        args or {},
    )


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


def _as_real_rev3_roll_receipt(receipt: dict) -> dict:
    legacy = deepcopy(receipt)
    operation = legacy["operation"]
    resolution = legacy.pop("resolution")
    if legacy["tool"] != "rules.roll_dice":
        operation = {
            "investigator_id": resolution["investigator_id"],
            "skill": (
                resolution["resolved_label"]
                if operation.get("skill") is not None
                else None
            ),
            "characteristic": operation.get("characteristic"),
            "resolved_label": resolution["resolved_label"],
            "target": resolution["resolved_target"],
            "target_source": resolution["target_source"],
            "difficulty": operation["difficulty"],
            "bonus": operation["bonus"],
            "penalty": operation["penalty"],
            "reason": operation["reason"],
            "fumble_consequence": operation["fumble_consequence"],
            "pushed": operation["pushed"],
            "method_changed": operation["method_changed"],
            "failure_consequence": operation["failure_consequence"],
        }
    legacy["schema_version"] = coc_toolbox._ROLL_RECEIPT_LEGACY_SCHEMA_VERSION
    legacy["operation"] = operation
    legacy["fingerprint"] = coc_toolbox._operation_fingerprint(
        legacy["tool"], operation
    )
    legacy[coc_toolbox._SOURCE_RECEIPT_INTEGRITY_KEY] = (
        coc_toolbox._source_receipt_integrity(legacy)
    )
    return legacy


def _downgrade_roll_document_to_real_rev3(path: Path) -> dict:
    current = json.loads(path.read_text(encoding="utf-8"))
    legacy = {"schema_version": 1, "receipts": {}}
    for tool_name, by_tool in current["receipts"].items():
        legacy["receipts"][tool_name] = {
            decision_id: _as_real_rev3_roll_receipt(receipt)
            for decision_id, receipt in by_tool.items()
        }
    _write_json(path, legacy)
    return legacy


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
    records = _read_jsonl(campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl")
    matching = [row for row in records if row["roll_id"] == data["roll_id"]]
    assert len(matching) == 1
    assert matching[0]["payload"]["roll_id"] == data["roll_id"]


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
                "skill": "Library Use",
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
    assert replay["error"]["code"] == "legacy_recovery_unverifiable"
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
    assert rejected["error"]["code"] == "legacy_recovery_unverifiable"
    assert not receipt_path.exists()
    assert len([
        row
        for row in _read_jsonl(
            campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl"
        )
        if row.get("roll_id") == settled["data"]["roll_id"]
    ]) == 1


def test_real_rev3_document_migrates_without_bricking_unrelated_tools(
    campaign_ws,
):
    dice_args = {
        "expression": "1D8+2",
        "reason": "rev3 migration dice",
        "decision_id": "rev3-dice-replay",
        "seed": 31,
    }
    roll_args = {
        "investigator": campaign_ws["investigator_id"],
        "skill": "Spot Hidden",
        "target": 99,
        "reason": "rev3 percentile audit",
        "decision_id": "rev3-percentile-unverifiable",
        "seed": 1,
    }
    dice = _run(campaign_ws, "rules.roll_dice", dice_args)
    percentile = _run(campaign_ws, "rules.roll", roll_args)
    assert dice["ok"] is True and percentile["ok"] is True
    receipt_path = (
        campaign_ws["campaign_dir"] / "save" / "roll-operation-receipts.json"
    )
    _downgrade_roll_document_to_real_rev3(receipt_path)
    rolls_path = campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl"
    before_rolls = rolls_path.read_bytes()

    unrelated = _run(
        campaign_ws,
        "state.journal",
        {"summary": "rev3 migration continues", "decision_id": "after-rev3-doc"},
    )

    assert unrelated["ok"] is True
    migrated = json.loads(receipt_path.read_text(encoding="utf-8"))
    assert migrated["schema_version"] == (
        coc_toolbox._ROLL_RECEIPT_DOCUMENT_SCHEMA_VERSION
    )
    assert migrated["pending_side_effects"] == {}
    assert migrated["receipts"]["rules.roll_dice"][
        dice_args["decision_id"]
    ]["schema_version"] == coc_toolbox._ROLL_RECEIPT_SCHEMA_VERSION
    assert migrated["legacy_receipts"]["rules.roll"][
        roll_args["decision_id"]
    ]["schema_version"] == coc_toolbox._ROLL_RECEIPT_LEGACY_SCHEMA_VERSION
    assert rolls_path.read_bytes() == before_rolls

    dice_replay = _run(
        campaign_ws, "rules.roll_dice", {**dice_args, "seed": 999}
    )
    assert dice_replay["ok"] is True
    assert dice_replay["data"] == dice["data"]
    percentile_replay = _run(
        campaign_ws, "rules.roll", {**roll_args, "seed": 999}
    )
    assert percentile_replay["ok"] is False
    assert percentile_replay["error"]["code"] == "legacy_recovery_unverifiable"
    assert _run(
        campaign_ws,
        "state.journal",
        {"summary": "still usable", "decision_id": "after-legacy-replay"},
    )["ok"] is True


def test_rev3_document_migration_is_idempotent_after_post_commit_interruption(
    campaign_ws, monkeypatch
):
    args = {
        "expression": "2D6+1",
        "decision_id": "rev3-interrupted-migration",
        "seed": 17,
    }
    settled = _run(campaign_ws, "rules.roll_dice", args)
    assert settled["ok"] is True
    legacy_roll_decision = "rev3-interrupted-percentile"
    assert _run(
        campaign_ws,
        "rules.roll",
        {
            "investigator": campaign_ws["investigator_id"],
            "skill": "Spot Hidden",
            "target": 99,
            "decision_id": legacy_roll_decision,
            "seed": 1,
        },
    )["ok"] is True
    receipt_path = (
        campaign_ws["campaign_dir"] / "save" / "roll-operation-receipts.json"
    )
    _downgrade_roll_document_to_real_rev3(receipt_path)
    real_save = coc_toolbox._save_roll_receipt_document
    crashed = False

    def save_then_interrupt(ctx, document):
        nonlocal crashed
        real_save(ctx, document)
        if not crashed:
            crashed = True
            raise RuntimeError("synthetic migration interruption")

    with monkeypatch.context() as interruption:
        interruption.setattr(
            coc_toolbox, "_save_roll_receipt_document", save_then_interrupt
        )
        with pytest.raises(RuntimeError, match="migration interruption"):
            _run(
                campaign_ws,
                "state.journal",
                {"summary": "interrupt migration", "decision_id": "migration-cut"},
            )

    after_interruption = receipt_path.read_bytes()
    assert json.loads(after_interruption)["schema_version"] == (
        coc_toolbox._ROLL_RECEIPT_DOCUMENT_SCHEMA_VERSION
    )
    recovered = _run(
        campaign_ws,
        "state.journal",
        {"summary": "interrupt migration", "decision_id": "migration-cut"},
    )
    assert recovered["ok"] is True
    recovered_document = json.loads(receipt_path.read_text(encoding="utf-8"))
    assert recovered_document["pending_side_effects"] == {}
    assert receipt_path.read_bytes() != after_interruption
    replay = _run(campaign_ws, "rules.roll_dice", {**args, "seed": 999})
    assert replay["ok"] is True
    assert replay["data"] == settled["data"]
    assert len([
        row
        for row in _read_jsonl(
            campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl"
        )
        if row.get("roll_id") == settled["data"]["roll_id"]
    ]) == 1
    state = json.loads((
        campaign_ws["campaign_dir"]
        / "save"
        / "investigator-state"
        / f"{campaign_ws['investigator_id']}.json"
    ).read_text(encoding="utf-8"))
    assert len([
        event
        for event in state.get("skill_check_events", [])
        if event.get("source_event_id") == f"rules.roll:{legacy_roll_decision}"
    ]) == 1


def test_real_rev4_document_migrates_to_legacy_archive_shape(campaign_ws):
    args = {
        "expression": "1D10",
        "decision_id": "rev4-document-migration",
        "seed": 13,
    }
    settled = _run(campaign_ws, "rules.roll_dice", args)
    assert settled["ok"] is True
    receipt_path = (
        campaign_ws["campaign_dir"] / "save" / "roll-operation-receipts.json"
    )
    document = json.loads(receipt_path.read_text(encoding="utf-8"))
    document["schema_version"] = 2
    document.pop("legacy_receipts")
    _write_json(receipt_path, document)

    unrelated = _run(
        campaign_ws,
        "state.journal",
        {"summary": "rev4 migration continues", "decision_id": "after-rev4-doc"},
    )

    assert unrelated["ok"] is True
    migrated = json.loads(receipt_path.read_text(encoding="utf-8"))
    assert migrated["schema_version"] == (
        coc_toolbox._ROLL_RECEIPT_DOCUMENT_SCHEMA_VERSION
    )
    assert migrated["legacy_receipts"] == {}
    replay = _run(campaign_ws, "rules.roll_dice", {**args, "seed": 999})
    assert replay["ok"] is True
    assert replay["data"] == settled["data"]


def test_rev3_document_precommit_interruption_preserves_original_bytes(
    campaign_ws, monkeypatch
):
    args = {
        "expression": "1D4",
        "decision_id": "rev3-precommit-interruption",
        "seed": 5,
    }
    assert _run(campaign_ws, "rules.roll_dice", args)["ok"] is True
    receipt_path = (
        campaign_ws["campaign_dir"] / "save" / "roll-operation-receipts.json"
    )
    _downgrade_roll_document_to_real_rev3(receipt_path)
    legacy_bytes = receipt_path.read_bytes()

    def interrupt_before_save(*_args, **_kwargs):
        raise RuntimeError("synthetic precommit interruption")

    with monkeypatch.context() as interruption:
        interruption.setattr(
            coc_toolbox,
            "_save_roll_receipt_document",
            interrupt_before_save,
        )
        with pytest.raises(RuntimeError, match="precommit interruption"):
            _run(
                campaign_ws,
                "state.journal",
                {"summary": "before publish", "decision_id": "precommit-cut"},
            )

    assert receipt_path.read_bytes() == legacy_bytes
    recovered = _run(
        campaign_ws,
        "state.journal",
        {"summary": "before publish", "decision_id": "precommit-cut"},
    )
    assert recovered["ok"] is True
    assert json.loads(receipt_path.read_text(encoding="utf-8"))["schema_version"] == (
        coc_toolbox._ROLL_RECEIPT_DOCUMENT_SCHEMA_VERSION
    )


def test_rev3_duplicate_roll_id_batch_fails_before_any_migration_or_append(
    campaign_ws,
):
    for ordinal, expression in enumerate(("1D6", "1D8")):
        assert _run(
            campaign_ws,
            "rules.roll_dice",
            {
                "expression": expression,
                "decision_id": f"duplicate-rev3-roll-{ordinal}",
                "seed": ordinal + 1,
            },
        )["ok"] is True
    receipt_path = (
        campaign_ws["campaign_dir"] / "save" / "roll-operation-receipts.json"
    )
    legacy = _downgrade_roll_document_to_real_rev3(receipt_path)
    by_dice = legacy["receipts"]["rules.roll_dice"]
    first = by_dice["duplicate-rev3-roll-0"]
    second = by_dice["duplicate-rev3-roll-1"]
    duplicate_id = first["roll_id"]
    second["roll_id"] = duplicate_id
    second["data"]["roll_id"] = duplicate_id
    second["roll_record"]["roll_id"] = duplicate_id
    second["roll_record"]["payload"]["roll_id"] = duplicate_id
    second["roll_record"]["source_ref"] = f"logs/rolls.jsonl#{duplicate_id}"
    for receipt in (first, second):
        receipt["log_prefix_size"] = 0
        receipt["log_prefix_sha256"] = (
            f"sha256:{hashlib.sha256(b'').hexdigest()}"
        )
        receipt[coc_toolbox._SOURCE_RECEIPT_INTEGRITY_KEY] = (
            coc_toolbox._source_receipt_integrity(receipt)
        )
    _write_json(receipt_path, legacy)
    rolls_path = campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl"
    rolls_path.write_text("", encoding="utf-8")
    state_path = (
        campaign_ws["campaign_dir"]
        / "save"
        / "investigator-state"
        / f"{campaign_ws['investigator_id']}.json"
    )
    before = (receipt_path.read_bytes(), rolls_path.read_bytes(), state_path.read_bytes())

    for _attempt in range(2):
        rejected = _run(
            campaign_ws,
            "state.journal",
            {"summary": "duplicate must not mutate", "decision_id": "duplicate-cut"},
        )
        assert rejected["ok"] is False
        assert rejected["error"]["code"] == "state_corrupt"
        assert (
            receipt_path.read_bytes(), rolls_path.read_bytes(), state_path.read_bytes()
        ) == before


def test_rev4_ghost_pending_fails_before_document_publication_or_state_change(
    campaign_ws,
):
    assert _run(
        campaign_ws,
        "rules.roll_dice",
        {"expression": "1D6", "decision_id": "ghost-pending-source", "seed": 7},
    )["ok"] is True
    receipt_path = (
        campaign_ws["campaign_dir"] / "save" / "roll-operation-receipts.json"
    )
    document = json.loads(receipt_path.read_text(encoding="utf-8"))
    document["schema_version"] = 2
    document.pop("legacy_receipts")
    document["pending_side_effects"] = {"ghost-effect": "ghost-roll"}
    _write_json(receipt_path, document)
    rolls_path = campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl"
    state_path = (
        campaign_ws["campaign_dir"]
        / "save"
        / "investigator-state"
        / f"{campaign_ws['investigator_id']}.json"
    )
    before = (receipt_path.read_bytes(), rolls_path.read_bytes(), state_path.read_bytes())

    for _attempt in range(2):
        rejected = _run(
            campaign_ws,
            "state.journal",
            {"summary": "ghost pending must not mutate", "decision_id": "ghost-cut"},
        )
        assert rejected["ok"] is False
        assert rejected["error"]["code"] == "state_corrupt"
        assert (
            receipt_path.read_bytes(), rolls_path.read_bytes(), state_path.read_bytes()
        ) == before


@pytest.mark.parametrize(
    ("tool_name", "operation_field", "tampered_value"),
    [
        ("rules.roll", "resolved_label", "Stealth"),
        ("rules.roll", "target", 1),
        ("rules.roll", "skill", "Stealth"),
        ("rules.push", "pushed", False),
    ],
)
def test_legacy_percentile_cross_field_tamper_fails_before_migration_or_state(
    campaign_ws, tool_name, operation_field, tampered_value
):
    decision_id = f"legacy-cross-{tool_name}-{operation_field}"
    args = {
        "investigator": campaign_ws["investigator_id"],
        "skill": "Library Use",
        "target": 99,
        "decision_id": decision_id,
        "seed": 1,
    }
    if tool_name == "rules.push":
        args.update({
            "method_changed": "cross-check another archive",
            "failure_consequence": "the archive closes",
        })
    assert _run(campaign_ws, tool_name, args)["ok"] is True
    receipt_path = (
        campaign_ws["campaign_dir"] / "save" / "roll-operation-receipts.json"
    )
    legacy = _downgrade_roll_document_to_real_rev3(receipt_path)
    receipt = legacy["receipts"][tool_name][decision_id]
    receipt["operation"][operation_field] = tampered_value
    receipt["fingerprint"] = coc_toolbox._operation_fingerprint(
        tool_name, receipt["operation"]
    )
    receipt[coc_toolbox._SOURCE_RECEIPT_INTEGRITY_KEY] = (
        coc_toolbox._source_receipt_integrity(receipt)
    )
    _write_json(receipt_path, legacy)
    rolls_path = campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl"
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
        {"summary": "legacy contradiction", "decision_id": f"after-{decision_id}"},
    )

    assert rejected["ok"] is False
    assert rejected["error"]["code"] == "state_corrupt"
    assert (receipt_path.read_bytes(), rolls_path.read_bytes(), state_path.read_bytes()) == before


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
                "skill": "Library Use",
                "method_changed": "use the court docket",
                "failure_consequence": "the archive closes",
                "reason": "semantic push",
            },
            {"failure_consequence": "the clerk calls the police"},
        ),
        (
            "rules.push",
            {
                "skill": "Library Use",
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
    if tool_name != "rules.roll_dice":
        args["investigator"] = campaign_ws["investigator_id"]
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
    spent = _run(
        campaign_ws,
        "rules.luck_spend",
        {
            "investigator": campaign_ws["investigator_id"],
            "points": 1,
            "roll": 51,
            "target": 50,
            "outcome": "failure",
            "roll_kind": "skill",
            "decision_id": "mutable-luck-spend",
        },
    )
    assert spent["ok"] is True

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
        ("rules.roll", "difficulty", "extreme"),
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
    if tool_name == "rules.push":
        args.update({
            "method_changed": "search a different archive",
            "failure_consequence": "the archive closes",
        })
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
        "legacy_receipts": {},
        "pending_side_effects": {},
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
        "legacy_receipts": {},
        "pending_side_effects": {},
    }
    raw = b""
    for ordinal in range(receipt_count):
        decision_id = f"settled-skill-{receipt_count}-{ordinal:03d}"
        data = {
            "roll": 1,
            "target": 60,
            "effective_target": 60,
            "difficulty": "regular",
            "bonus": 0,
            "penalty": 0,
            "outcome": "critical",
            "investigator_id": campaign_ws["investigator_id"],
            "skill": "Spot Hidden",
            "target_source": "sheet",
            "pushed": False,
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
                "difficulty": "regular",
                "bonus": 0,
                "penalty": 0,
                "reason": None,
                "fumble_consequence": None,
                "pushed": False,
                "method_changed": None,
                "failure_consequence": None,
            },
            resolution={
                "investigator_id": campaign_ws["investigator_id"],
                "resolved_label": "Spot Hidden",
                "resolved_target": 60,
                "target_source": "sheet",
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


def test_pre_cutover_structured_flag_survives_interleaved_nonflag_history(
    campaign_ws,
):
    campaign_dir = campaign_ws["campaign_dir"]
    flags_path = campaign_dir / "save" / "flags.json"
    flags = json.loads(flags_path.read_text(encoding="utf-8"))
    flags.setdefault("flags", {})["historical-structured-flag"] = False
    flags.get("flag_provenance", {}).pop("historical-structured-flag", None)
    flags.get("flag_heads", {}).pop("historical-structured-flag", None)
    flags.pop("flag_event_cutover", None)
    _write_json(flags_path, flags)
    with (campaign_dir / "logs" / "events.jsonl").open(
        "a", encoding="utf-8"
    ) as handle:
        for index in range(3):
            handle.write(json.dumps({
                "event_type": "scene_transition",
                "to_scene_id": f"historical-scene-{index}",
            }) + "\n")
        handle.write(json.dumps({
            "flag_mutation_schema_version": 1,
            "event_type": "flag_set",
            "flag_id": "historical-structured-flag",
            "value": False,
            "producer": "historical.structured-producer",
            "decision_id": "historical-structured-decision",
            "source_sequence": 4,
            "ts": "1920-01-01T00:04:00Z",
        }) + "\n")

    continuity = _run(campaign_ws, "scene.context")["data"]["continuity"]
    recent = next(
        row for row in continuity["recent_world_flag_changes"]
        if row["flag_id"] == "historical-structured-flag"
    )
    live = next(
        row for row in continuity["live_world_flags"]
        if row["flag_id"] == "historical-structured-flag"
    )
    assert recent["provenance"]["order_epoch"] == "legacy-pre-cutover"
    assert recent["provenance"]["integrity_status"] == "legacy_unverifiable"
    assert live["present"] is True
    assert live["value"] is False
    assert live["provenance"]["decision_id"] == "historical-structured-decision"


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
    state_value = json.loads(state_path.read_text(encoding="utf-8"))
    state_value["skill_checks_earned"] = ["Spot Hidden"]
    _write_json(state_path, state_value)

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
    state_value = json.loads(state_path.read_text(encoding="utf-8"))
    state_value["skill_checks_earned"] = ["Spot Hidden", "Listen"]
    _write_json(state_path, state_value)
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
    ] == ["Spot Hidden"]

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
    latest = json.loads((
        campaign_ws["campaign_dir"] / "save" / "development-settlements"
        / f"{investigator_id}.json"
    ).read_text(encoding="utf-8"))
    assert latest["ending_id"] == second_ending_id
    # Exercise the actual rev2 projection shape (derived source, no order).
    latest.pop("ending_order")
    latest_path = (
        campaign_ws["campaign_dir"] / "save" / "development-settlements"
        / f"{investigator_id}.json"
    )
    _write_json(latest_path, latest)
    warning = coc_toolbox.coc_runtime_ops._write_latest_settlement_mirror(
        campaign_ws["campaign_dir"],
        investigator_id,
        first_capsule,
        recovered["data"]["development"]["settlements"][0]["receipt"],
    )
    assert warning is None
    assert json.loads(latest_path.read_text(encoding="utf-8"))[
        "ending_id"
    ] == second_ending_id


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


def test_legacy_top_level_pass_is_adopted_without_reapplying(campaign_ws):
    ended = _run(campaign_ws, "state.end_session", {
        "kind": "cliffhanger",
        "summary": "create a receipt to reshape as the base layout",
        "decision_id": "legacy-adoption-ending",
    })
    assert ended["data"]["development"]["status"] == "PASS"
    investigator_id = campaign_ws["investigator_id"]
    ending_id = ended["data"]["ending_id"]
    exact = coc_toolbox.coc_development.ending_settlement_path(
        campaign_ws["campaign_dir"], ending_id, investigator_id
    )
    legacy = (
        campaign_ws["campaign_dir"] / "save" / "development-settlements"
        / f"{investigator_id}.json"
    )
    legacy.write_bytes(exact.read_bytes())
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
        "decision_id": "legacy-adoption-replay",
    })

    assert replay["ok"] is True
    assert {path: path.read_bytes() for path in before} == before
    adopted = json.loads(exact.read_text(encoding="utf-8"))
    assert adopted["migration"]["adopted_from"] == (
        f"save/development-settlements/{investigator_id}.json"
    )


def test_latest_mirror_failure_returns_pass_with_repair_warning(campaign_ws):
    investigator_id = campaign_ws["investigator_id"]
    mirror = (
        campaign_ws["campaign_dir"] / "save" / "development-settlements"
        / f"{investigator_id}.json"
    )
    mirror.mkdir(parents=True)
    ended = _run(campaign_ws, "state.end_session", {
        "kind": "cliffhanger",
        "summary": "exact receipt must outrank a broken mirror",
        "decision_id": "broken-mirror-ending",
    })

    assert ended["ok"] is True
    assert ended["data"]["development"]["status"] == "PASS"
    receipt = ended["data"]["development"]["settlements"][0]["receipt"]
    assert receipt["status"] == "PASS"
    assert receipt["projection_repair_needed"] is True
    assert any("mirror needs repair" in item for item in receipt["warnings"])
    exact = coc_toolbox.coc_development.ending_settlement_path(
        campaign_ws["campaign_dir"], ended["data"]["ending_id"], investigator_id
    )
    assert exact.is_file()


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

    interleaved = _run(
        campaign_ws,
        "state.journal",
        {
            "summary": "an unrelated event lands before ending retry",
            "decision_id": "ending-preappend-interleave",
        },
    )
    assert interleaved["ok"] is True
    moved = _run(
        campaign_ws,
        "state.move_scene",
        {
            "scene_id": "post-capsule-improvised-scene",
            "decision_id": "ending-preappend-scene-change",
        },
    )
    assert moved["ok"] is True
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
        "run_id": "toolbox-live-segment",
        "decision_id": "kim-engagement-once",
    }
    state_path = campaign_ws["campaign_dir"] / "save" / "npc-state.json"
    before = state_path.read_bytes() if state_path.is_file() else None

    first = _run(campaign_ws, "state.record_npc_engagement", args)
    replay = _run(campaign_ws, "state.record_npc_engagement", args)
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
    after = state_path.read_bytes() if state_path.is_file() else None
    assert after == before
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
    args = {
        "investigator": campaign_ws["investigator_id"],
        "skill": "Library Use",
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


def test_unanchored_flag_event_after_cutover_is_explicitly_unverified(
    campaign_ws,
):
    campaign_dir = campaign_ws["campaign_dir"]
    assert _run(
        campaign_ws,
        "state.set_flag",
        {
            "flag_id": "cutover-anchor",
            "value": True,
            "decision_id": "cutover-anchor-decision",
        },
    )["ok"] is True
    with (campaign_dir / "logs" / "events.jsonl").open(
        "a", encoding="utf-8"
    ) as handle:
        handle.write(json.dumps({
            "event_type": "flag_set",
            "flag_id": "late-old-writer",
            "decision_id": "late-old-writer-decision",
            "value": True,
            "ts": "2099-01-01T00:00:00Z",
        }) + "\n")
    flags_path = campaign_dir / "save" / "flags.json"
    flags = json.loads(flags_path.read_text(encoding="utf-8"))
    flags["flags"]["late-old-writer"] = True
    _write_json(flags_path, flags)

    continuity = _run(campaign_ws, "scene.context")["data"]["continuity"]
    recent = continuity["recent_world_flag_changes"]
    late = next(row for row in recent if row["flag_id"] == "late-old-writer")
    assert late["provenance"]["order_epoch"] == "unverified-post-cutover"
    assert late["provenance"]["integrity_status"] == "unverified"
    assert recent[-1]["flag_id"] == "late-old-writer"
    assert not any(
        row["flag_id"] == "late-old-writer"
        for row in continuity["live_world_flags"]
    )
    unverified = next(
        row for row in continuity["unverified_world_flags"]
        if row["flag_id"] == "late-old-writer"
    )
    assert unverified["provenance"]["integrity_status"] == "unverified"


def test_flag_cutover_boundary_must_match_first_source_receipt(campaign_ws):
    assert _run(
        campaign_ws,
        "state.set_flag",
        {
            "flag_id": "cutover-integrity-anchor",
            "value": True,
            "decision_id": "cutover-integrity-decision",
        },
    )["ok"] is True
    flags_path = campaign_ws["campaign_dir"] / "save" / "flags.json"
    flags = json.loads(flags_path.read_text(encoding="utf-8"))
    flags["flag_event_cutover"]["first_event_id"] = "forged-cutover-event"
    _write_json(flags_path, flags)

    context = _run(campaign_ws, "scene.context")
    assert context["ok"] is False
    assert context["error"]["code"] == "state_corrupt"


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
    assert result["data"]["event_id"].startswith("npc-engagement-v1:")
    assert result["data"]["producer"] == "state.record_npc_engagement"
    assert result["data"]["campaign_id"] == campaign_ws["campaign_id"]
    assert result["data"]["decision_id"] == "npc-schema-producer"
    receipt_doc = coc_toolbox.coc_npc_event_chain.load_receipt_document(
        campaign_ws["campaign_dir"]
    )
    receipt = receipt_doc["receipts"][result["data"]["event_id"]]
    assert coc_toolbox.coc_npc_event_chain.valid_receipt(receipt)
