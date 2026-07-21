"""Public non-CoC ruleset vertical through setup and canonical toolbox."""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
FIXTURE_RULESETS = ROOT / "tests" / "fixtures" / "rulesets"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import coc_rulesets
import coc_state
import coc_toolbox
import coc_turn_finalization
import ruleset_conformance


@pytest.fixture
def spark_registry(monkeypatch: pytest.MonkeyPatch) -> None:
    registries = {
        coc_rulesets,
        coc_state.coc_rulesets,
        coc_toolbox.coc_rulesets,
        coc_toolbox.coc_state.coc_rulesets,
        coc_toolbox.coc_runtime_ops.coc_state.coc_rulesets,
        coc_turn_finalization.coc_rulesets,
    }
    for registry in registries:
        monkeypatch.setattr(registry, "RULESETS_ROOT", FIXTURE_RULESETS)
        registry._MANIFEST_CACHE.clear()
        registry._RESOLVER_CACHE.clear()
    yield
    for registry in registries:
        registry._MANIFEST_CACHE.clear()
        registry._RESOLVER_CACHE.clear()


def test_spark_fixture_conforms() -> None:
    assert ruleset_conformance.validate_package(FIXTURE_RULESETS / "spark") == []


def test_spark_rules_execute_through_real_toolbox_cli(tmp_path: Path) -> None:
    plugin = tmp_path / "external-plugin"
    shutil.copytree(ROOT / "plugins" / "coc-keeper", plugin)
    shutil.copytree(FIXTURE_RULESETS / "spark", plugin / "rulesets" / "spark")
    workspace = tmp_path / "workspace"
    script = plugin / "scripts" / "coc_toolbox.py"

    def invoke(tool: str, args: dict, *, campaign: str | None = None) -> dict:
        command = [
            sys.executable,
            str(script),
            tool,
            "--root",
            str(workspace),
            "--json",
            json.dumps(args),
        ]
        if campaign is not None:
            command.extend(["--campaign", campaign])
        completed = subprocess.run(
            command,
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        )
        return json.loads(completed.stdout)

    assert invoke("setup.invoke", {
        "kind": "campaign.create",
        "payload": {
            "campaign_id": "spark-cli",
            "title": "Spark CLI",
            "ruleset_id": "spark",
        },
    })["ok"] is True
    assert invoke("setup.invoke", {
        "kind": "actor.create",
        "payload": {
            "campaign_id": "spark-cli",
            "actor_id": "nova",
            "sheet": {"name": "Nova", "energy": 9},
        },
    })["ok"] is True
    checked = invoke(
        "rules.check",
        {
            "actor": "nova",
            "request": {"stat": 4, "skill": 2, "difficulty": 7},
            "seed": 11,
            "decision_id": "cli-check",
        },
        campaign="spark-cli",
    )
    assert checked["ok"] is True
    assert checked["data"]["roll_id"]
    changed = invoke(
        "rules.resource_delta",
        {
            "actor": "nova",
            "request": {
                "resource": "energy",
                "amount": 4,
                "direction": "spend",
            },
            "decision_id": "cli-energy",
        },
        campaign="spark-cli",
    )
    assert changed["ok"] is True
    actor = json.loads(
        (
            workspace
            / ".coc/campaigns/spark-cli/save/actor-state/nova.json"
        ).read_text(encoding="utf-8")
    )
    assert actor["resources"] == {"energy": 5}


def _create_spark_actor(tmp_path: Path) -> Path:
    created = coc_toolbox.run_tool(
        "setup.invoke",
        tmp_path,
        None,
        {
            "kind": "campaign.create",
            "payload": {
                "campaign_id": "spark-recovery",
                "title": "Spark Recovery",
                "ruleset_id": "spark",
            },
        },
    )
    assert created["ok"] is True, created
    actor = coc_toolbox.run_tool(
        "setup.invoke",
        tmp_path,
        None,
        {
            "kind": "actor.create",
            "payload": {
                "campaign_id": "spark-recovery",
                "actor_id": "spark-actor",
                "sheet": {"name": "Ada Spark", "energy": 8},
            },
        },
    )
    assert actor["ok"] is True, actor
    return tmp_path / ".coc" / "campaigns" / "spark-recovery"


def test_public_second_ruleset_create_check_and_resource_receipts(
    tmp_path: Path,
    spark_registry: None,
) -> None:
    created = coc_toolbox.run_tool(
        "setup.invoke",
        tmp_path,
        None,
        {
            "kind": "campaign.create",
            "payload": {
                "campaign_id": "spark-campaign",
                "title": "Spark Campaign",
                "ruleset_id": "spark",
                "play_language": "en-US",
            },
        },
    )
    assert created["ok"] is True
    assert created["data"]["result"] == {
        "campaign_id": "spark-campaign",
        "ruleset_id": "spark",
    }
    campaign_dir = tmp_path / ".coc" / "campaigns" / "spark-campaign"
    campaign = json.loads((campaign_dir / "campaign.json").read_text(encoding="utf-8"))
    assert campaign["ruleset_id"] == "spark"
    assert (campaign_dir / "save" / "actor-state").is_dir()
    assert not (campaign_dir / "save" / "investigator-state").exists()
    generation = coc_state.validate_campaign_generation(campaign_dir)
    assert generation["campaign"]["ruleset_id"] == "spark"
    assert generation["investigators"] == {}
    actor_created = coc_toolbox.run_tool(
        "setup.invoke",
        tmp_path,
        None,
        {
            "kind": "actor.create",
            "payload": {
                "campaign_id": "spark-campaign",
                "actor_id": "spark-actor",
                "sheet": {"name": "Ada Spark", "energy": 8},
            },
        },
    )
    assert actor_created["ok"] is True
    actor_path = campaign_dir / "save" / "actor-state" / "spark-actor.json"
    assert actor_path.is_file()
    generation = coc_state.validate_campaign_generation(
        campaign_dir, actor_id="spark-actor"
    )
    assert generation["actors"]["spark-actor"]["resources"] == {"energy": 8}

    check_args = {
        "actor": "spark-actor",
        "request": {"stat": 4, "skill": 2, "difficulty": 7},
        "seed": 11,
        "decision_id": "spark-check-1",
    }
    checked = coc_toolbox.run_tool(
        "rules.check", tmp_path, "spark-campaign", check_args
    )
    assert checked["ok"] is True
    assert checked["data"]["ruleset_id"] == "spark"
    assert checked["data"]["ruleset_version"] == "0.1.0"
    assert checked["data"]["result"] == {
        "label": "Spark check",
        "stat": 4,
        "skill": 2,
        "difficulty": 7,
        "target": 7,
        "outcome": "success",
        "success": True,
        "roll": {"expression": "1D10+6", "faces": [8], "total": 14},
    }
    assert checked["data"]["roll_id"]
    roll_rows = [
        json.loads(line)
        for line in (campaign_dir / "logs" / "rolls.jsonl")
        .read_text(encoding="utf-8")
        .splitlines()
    ]
    assert [row["roll_id"] for row in roll_rows] == [checked["data"]["roll_id"]]
    replay = coc_toolbox.run_tool(
        "rules.check", tmp_path, "spark-campaign", check_args
    )
    assert replay["ok"] is True
    assert replay["data"] == checked["data"]
    assert replay["warnings"] == [
        "duplicate decision_id: recovered the original roll source receipt"
    ]
    conflict = coc_toolbox.run_tool(
        "rules.check",
        tmp_path,
        "spark-campaign",
        {
            **check_args,
            "request": {"stat": 9, "skill": 2, "difficulty": 7},
        },
    )
    assert conflict["error"]["code"] == "idempotency_conflict"

    delta_args = {
        "actor": "spark-actor",
        "request": {
            "resource": "energy",
            "amount": 3,
            "direction": "spend",
        },
        "decision_id": "spark-energy-1",
    }
    delta = coc_toolbox.run_tool(
        "rules.resource_delta", tmp_path, "spark-campaign", delta_args
    )
    assert delta["ok"] is True
    assert delta["data"]["ruleset_id"] == "spark"
    assert delta["data"]["result"] == {
        "resource": "energy",
        "direction": "spend",
        "amount": 3,
        "before": 8,
        "after": 5,
        "delta": -3,
        "maximum": None,
    }
    assert coc_toolbox.run_tool(
        "rules.resource_delta", tmp_path, "spark-campaign", delta_args
    )["data"] == delta["data"]
    actor = json.loads(actor_path.read_text(encoding="utf-8"))
    assert actor["resources"] == {"energy": 5}
    assert actor["decisions"]["spark-energy-1"] == delta["data"]

    ledger = json.loads(
        (campaign_dir / "save" / "toolbox-ledger.json").read_text(encoding="utf-8")
    )
    durable = [entry["data"] for entry in ledger["entries"].values()]
    assert {row["ruleset_id"] for row in durable} == {"spark"}
    assert {row["operation"] for row in durable} == {"check", "resource_delta"}

    unsupported = coc_toolbox.run_tool(
        "rules.damage",
        tmp_path,
        "spark-campaign",
        {"amount": "1", "decision_id": "spark-damage-unsupported"},
    )
    assert unsupported["error"]["code"] == "unsupported_ruleset_operation"

    journal = coc_toolbox.run_tool(
        "state.journal",
        tmp_path,
        "spark-campaign",
        {
            "summary": "Ada succeeded and spent energy.",
            "player_action": "Make the Spark attempt.",
            "decision_id": "spark-journal-1",
        },
    )
    assert journal["ok"] is True
    context = coc_toolbox.run_tool(
        "turn.output_context", tmp_path, "spark-campaign", {}
    )
    assert context["ok"] is True
    output = context["data"]
    assert output["source_roll_ids"] == [checked["data"]["roll_id"]]
    assert output["mechanics_bundle"]["public_check"][0]["ruleset_id"] == "spark"
    projected = output["mechanics_bundle"]["state_delta"]
    assert len(projected) == 1
    assert projected[0]["resource"] == "Energy"
    assert projected[0]["investigator_id"] == "spark-actor"
    assert projected[0]["before"] == 8
    assert projected[0]["after"] == 5

    excerpt = "The Spark answers Ada's attempt, and the effort leaves her breathing hard."
    obligation = output["obligations"][0]
    finalized = coc_toolbox.run_tool(
        "turn.finalize",
        tmp_path,
        "spark-campaign",
        {
            "draft": "Ada commits to the attempt.\n\n" + excerpt,
            "coverage": [{
                "obligation_id": obligation["obligation_id"],
                "realization": "fictional_beat",
                "action_realization": "Ada commits to the Spark attempt.",
                "response": "The Spark answers and the attempt succeeds.",
                "causal_explanation": "The successful check settles the attempt.",
                "persona_fit": "Ada follows the declared approach.",
                "player_input_handling": "abstract_completed",
                "exact_excerpt": excerpt,
                "exceptional_beat": "",
            }],
            "mechanics_placements": [
                {
                    "after_paragraph": 0,
                    "segment_type": "public_check",
                    "source_ids": [checked["data"]["roll_id"]],
                },
                {
                    "after_paragraph": 1,
                    "segment_type": "state_delta",
                    "source_ids": [projected[0]["effect_id"]],
                },
            ],
            "decision_id": "spark-finalize-1",
        },
    )
    assert finalized["ok"] is True, finalized
    assert "Spark check" in finalized["data"]["rendered_text"]
    assert "Energy" in finalized["data"]["rendered_text"]


def test_generic_resource_recovers_actor_write_before_ledger(
    tmp_path: Path,
    spark_registry: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    campaign_dir = _create_spark_actor(tmp_path)
    original = coc_toolbox.Ctx.ledger_record

    def fail_after_actor_write(self, decision_id, tool, data, **kwargs):
        if tool == "rules.resource_delta":
            raise coc_toolbox.ToolError("injected_failure", "after actor write")
        return original(self, decision_id, tool, data, **kwargs)

    monkeypatch.setattr(coc_toolbox.Ctx, "ledger_record", fail_after_actor_write)
    args = {
        "actor": "spark-actor",
        "request": {"resource": "energy", "amount": 3, "direction": "spend"},
        "decision_id": "resource-crash",
    }
    failed = coc_toolbox.run_tool(
        "rules.resource_delta", tmp_path, "spark-recovery", args
    )
    assert failed["error"]["code"] == "injected_failure"
    state = json.loads(
        (campaign_dir / "save" / "actor-state" / "spark-actor.json")
        .read_text(encoding="utf-8")
    )
    assert state["resources"]["energy"] == 5
    assert "resource-crash" in state["decisions"]

    monkeypatch.setattr(coc_toolbox.Ctx, "ledger_record", original)
    replay = coc_toolbox.run_tool(
        "rules.resource_delta", tmp_path, "spark-recovery", args
    )
    assert replay["ok"] is True, replay
    assert replay["data"]["result"]["before"] == 8
    assert replay["data"]["result"]["after"] == 5
    assert replay["warnings"] == [
        "duplicate decision_id: recovered the state-bound original receipt"
    ]
    ledger = json.loads(
        (campaign_dir / "save" / "toolbox-ledger.json").read_text(encoding="utf-8")
    )
    key = json.dumps(
        ["rules.resource_delta", "resource-crash"], separators=(",", ":")
    )
    assert ledger["entries"][key]["data"] == replay["data"]


def test_generic_check_recovers_frozen_receipt_before_roll_row(
    tmp_path: Path,
    spark_registry: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    campaign_dir = _create_spark_actor(tmp_path)
    original = coc_toolbox._ensure_roll_receipt_row
    calls = 0

    def fail_first_materialization(ctx, receipt):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise coc_toolbox.ToolError("injected_failure", "after source freeze")
        return original(ctx, receipt)

    monkeypatch.setattr(
        coc_toolbox, "_ensure_roll_receipt_row", fail_first_materialization
    )
    args = {
        "actor": "spark-actor",
        "request": {"stat": 4, "skill": 2, "difficulty": 7},
        "seed": 11,
        "decision_id": "check-crash",
    }
    failed = coc_toolbox.run_tool("rules.check", tmp_path, "spark-recovery", args)
    assert failed["error"]["code"] == "injected_failure"
    assert (campaign_dir / "logs" / "rolls.jsonl").read_bytes() == b""
    source = json.loads(
        (campaign_dir / "save" / "roll-operation-receipts.json")
        .read_text(encoding="utf-8")
    )
    assert "check-crash" in source["receipts"]["rules.check"]

    replay = coc_toolbox.run_tool("rules.check", tmp_path, "spark-recovery", args)
    assert replay["ok"] is True, replay
    rows = [
        json.loads(line)
        for line in (campaign_dir / "logs" / "rolls.jsonl")
        .read_text(encoding="utf-8")
        .splitlines()
    ]
    assert [row["roll_id"] for row in rows] == [replay["data"]["roll_id"]]


def test_generic_mutations_reject_reserved_current_and_non_string_decision(
    tmp_path: Path,
    spark_registry: None,
) -> None:
    campaign_dir = _create_spark_actor(tmp_path)
    reserved = coc_toolbox.run_tool(
        "rules.resource_delta",
        tmp_path,
        "spark-recovery",
        {
            "actor": "spark-actor",
            "request": {
                "resource": "energy",
                "current": 999,
                "amount": 1,
                "direction": "spend",
            },
            "decision_id": "must-not-trust-current",
        },
    )
    assert reserved["error"]["code"] == "invalid_param"
    wrong_type = coc_toolbox.run_tool(
        "rules.check",
        tmp_path,
        "spark-recovery",
        {
            "actor": "spark-actor",
            "request": {"stat": 4, "skill": 2, "difficulty": 7},
            "decision_id": 7,
        },
    )
    assert wrong_type["error"]["code"] == "invalid_param"
    state = coc_state.load_ruleset_actor_state(campaign_dir, "spark-actor")
    assert state["resources"] == {"energy": 8}
    assert state["decisions"] == {}


@pytest.mark.parametrize("ruleset_id", ["", "missing"])
def test_public_create_rejects_invalid_ruleset_binding(
    tmp_path: Path,
    spark_registry: None,
    ruleset_id: str,
) -> None:
    result = coc_toolbox.run_tool(
        "setup.invoke",
        tmp_path,
        None,
        {
            "kind": "campaign.create",
            "payload": {
                "campaign_id": "bad-binding",
                "title": "Bad Binding",
                "ruleset_id": ruleset_id,
            },
        },
    )
    assert result["ok"] is False
    assert result["error"]["code"] == "setup_failed"
    assert not (tmp_path / ".coc" / "campaigns" / "bad-binding").exists()


@pytest.mark.parametrize("binding", [None, "missing"])
def test_toolbox_rejects_corrupt_persisted_ruleset_binding(
    tmp_path: Path,
    spark_registry: None,
    binding: str | None,
) -> None:
    path = coc_state.create_campaign(
        tmp_path,
        "corrupt-binding",
        "Corrupt Binding",
        ruleset_id="spark",
    )
    campaign = json.loads(path.read_text(encoding="utf-8"))
    if binding is None:
        campaign.pop("ruleset_id")
    else:
        campaign["ruleset_id"] = binding
    path.write_text(json.dumps(campaign), encoding="utf-8")

    result = coc_toolbox.run_tool(
        "rules.check",
        tmp_path,
        "corrupt-binding",
        {
            "actor": "ghost",
            "request": {"stat": 4, "skill": 2, "difficulty": 7},
            "decision_id": "must-not-settle",
        },
    )
    assert result["ok"] is False
    assert result["error"] == {
        "code": "invalid_request",
        "message": "unsupported_save_schema",
    }
    assert not (
        tmp_path
        / ".coc"
        / "campaigns"
        / "corrupt-binding"
        / "save"
        / "toolbox-ledger.json"
    ).exists()
