"""Focused contract tests for ruleset-owned investigator creation discovery."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
FIXTURE_RULESETS = ROOT / "tests" / "fixtures" / "rulesets"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import coc_runtime_ops
import coc_toolbox


def _create_campaign(
    workspace: Path,
    *,
    campaign_id: str = "contract-campaign",
    ruleset_id: str = "coc7",
) -> None:
    receipt = coc_runtime_ops.execute_setup_operation(
        workspace,
        operation={
            "schema_version": 1,
            "kind": "campaign.create",
            "payload": {
                "campaign_id": campaign_id,
                "title": "Investigator Contract",
                "ruleset_id": ruleset_id,
            },
        },
    )
    assert receipt["status"] == "PASS"


def _query(workspace: Path, campaign_id: str = "contract-campaign") -> dict:
    return coc_runtime_ops.execute_setup_operation(
        workspace,
        operation={
            "schema_version": 1,
            "kind": "investigator.contract",
            "payload": {"campaign_id": campaign_id},
        },
    )


def _quick_fire_payload(investigator_id: str = "quick-fire-inv") -> dict:
    return {
        "investigator_id": investigator_id,
        "sheet": {
            "id": investigator_id,
            "name": "Quick Fire Investigator",
            "age": 29,
            "skills": {"Credit Rating": 20, "Spot Hidden": 60},
        },
        "creation": {
            "method": "quick_fire_array",
            "characteristic_assignment_order": [
                "DEX",
                "INT",
                "POW",
                "EDU",
                "CON",
                "SIZ",
                "APP",
                "STR",
            ],
            "luck_roll_total": 12,
        },
    }


def _complete_payload(investigator_id: str = "complete-inv") -> dict:
    return {
        "investigator_id": investigator_id,
        "sheet": {
            "id": investigator_id,
            "name": "Complete Investigator",
            "age": 29,
            "characteristics": {
                "STR": 50,
                "CON": 50,
                "SIZ": 50,
                "DEX": 50,
                "APP": 50,
                "INT": 50,
                "POW": 50,
                "EDU": 50,
            },
            "derived": {
                "HP": 10,
                "MP": 10,
                "SAN": 50,
                "Luck": 60,
                "DB": "none",
                "Build": 0,
                "MOV": 8,
            },
            "skills": {"Credit Rating": 20},
        },
    }


def test_coc7_contract_query_returns_identity_and_independent_branch_schema(
    tmp_path: Path,
) -> None:
    _create_campaign(tmp_path)

    receipt = _query(tmp_path)
    assert receipt["kind"] == "investigator.contract"
    contract = receipt["result"]
    assert contract["schema_version"] == 1
    assert contract["kind"] == "investigator_create_payload_contract"
    assert contract["ruleset_id"] == "coc7"
    assert contract["ruleset_version"] == "1.0.0"
    assert contract["investigator_schema_version"] == 1
    assert contract["runtime_authority"]["schema_role"] == (
        "upfront machine-readable construction guidance"
    )

    schema = contract["payload_schema"]
    assert [branch["title"] for branch in schema["oneOf"]] == [
        "Deterministic Quick Fire input",
        "Complete legacy sheet input",
    ]
    defs = schema["$defs"]
    assert defs["quick_fire_sheet"]["not"]["anyOf"] == [
        {"required": ["characteristics"]},
        {"required": ["derived"]},
    ]
    assert defs["quick_fire_creation"]["properties"]["luck_roll_total"] == {
        "type": "integer",
        "minimum": 3,
        "maximum": 18,
        "description": "Authoritative 3D6 total. The runtime multiplies it by five.",
    }
    assert defs["complete_sheet"]["required"] == [
        "id",
        "name",
        "characteristics",
        "derived",
        "skills",
    ]
    assert defs["skills"]["required"] == ["Credit Rating"]
    assert "does not prove every key" in defs["skills"]["description"]
    assert defs["age"]["minimum"] == 15
    assert defs["age"]["maximum"] == 89

    Draft202012Validator.check_schema(schema)
    validator = Draft202012Validator(schema)
    validator.validate(_quick_fire_payload())
    validator.validate(_complete_payload())
    invalid_quick = _quick_fire_payload("invalid-quick")
    invalid_quick["sheet"]["characteristics"] = {}
    assert list(validator.iter_errors(invalid_quick))

    contract["payload_schema"]["title"] = "caller mutation"
    assert _query(tmp_path)["result"]["payload_schema"]["title"] == (
        "COC7 investigator.create payload"
    )


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"campaign_id": "contract-campaign", "extra": True},
    ],
)
def test_runtime_contract_query_requires_exact_campaign_id(
    tmp_path: Path,
    payload: dict,
) -> None:
    _create_campaign(tmp_path)
    with pytest.raises(
        coc_runtime_ops.RuntimeOperationError,
        match="requires exactly campaign_id",
    ):
        coc_runtime_ops.execute_setup_operation(
            tmp_path,
            operation={
                "schema_version": 1,
                "kind": "investigator.contract",
                "payload": payload,
            },
        )


def test_toolbox_contract_query_is_small_read_only_and_exact(tmp_path: Path) -> None:
    _create_campaign(tmp_path)
    spec = coc_toolbox.TOOLS["setup.investigator_contract"]
    assert set(spec["params"]) == {"campaign_id"}
    assert spec["params"]["campaign_id"]["required"] is True
    assert spec["access"] == "query"
    assert spec["write_domains"] == ()
    assert spec["recovery_domains"] == ()
    assert spec["strict_read_only"] is True

    result = coc_toolbox.run_tool(
        "setup.investigator_contract",
        tmp_path,
        None,
        {"campaign_id": "contract-campaign"},
    )
    assert result["ok"] is True, result
    assert result["data"]["result"]["ruleset_id"] == "coc7"

    extra = coc_toolbox.run_tool(
        "setup.investigator_contract",
        tmp_path,
        None,
        {"campaign_id": "contract-campaign", "extra": True},
    )
    assert extra["error"]["code"] == "invalid_param"
    missing = coc_toolbox.run_tool(
        "setup.investigator_contract",
        tmp_path,
        None,
        {},
    )
    assert missing["error"]["code"] == "missing_param"


def test_ruleset_without_contract_capability_fails_closed(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    registries = {
        coc_runtime_ops.coc_state.coc_rulesets,
        coc_toolbox.coc_runtime_ops.coc_state.coc_rulesets,
    }
    for registry in registries:
        monkeypatch.setattr(registry, "RULESETS_ROOT", FIXTURE_RULESETS)
        registry._MANIFEST_CACHE.clear()
        registry._RESOLVER_CACHE.clear()

    _create_campaign(tmp_path, campaign_id="spark-contract", ruleset_id="spark")
    result = coc_toolbox.run_tool(
        "setup.investigator_contract",
        tmp_path,
        None,
        {"campaign_id": "spark-contract"},
    )
    assert result["ok"] is False
    assert result["error"] == {
        "code": "setup_failed",
        "message": "ruleset 'spark' does not support investigator contracts",
    }


def test_coc7_actor_create_stays_unsupported_and_quick_fire_still_creates(
    tmp_path: Path,
) -> None:
    _create_campaign(tmp_path)
    with pytest.raises(
        coc_runtime_ops.RuntimeOperationError,
        match=r"ruleset 'coc7' does not support actor.create",
    ):
        coc_runtime_ops.execute_setup_operation(
            tmp_path,
            operation={
                "schema_version": 1,
                "kind": "actor.create",
                "payload": {
                    "campaign_id": "contract-campaign",
                    "actor_id": "must-not-create",
                    "sheet": {"name": "Wrong path"},
                },
            },
        )

    payload = _quick_fire_payload()
    receipt = coc_runtime_ops.execute_setup_operation(
        tmp_path,
        operation={
            "schema_version": 1,
            "kind": "investigator.create",
            "payload": payload,
        },
    )
    assert receipt["status"] == "PASS"
    stored = json.loads(
        (
            tmp_path
            / ".coc"
            / "investigators"
            / payload["investigator_id"]
            / "character.json"
        ).read_text(encoding="utf-8")
    )
    assert stored["derived"]["Luck"] == 60
    assert sorted(stored["characteristics"].values()) == [
        40,
        50,
        50,
        50,
        60,
        60,
        70,
        80,
    ]
