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
    order = ("DEX", "INT", "POW", "EDU", "CON", "SIZ", "APP", "STR")
    characteristics = dict(zip(
        order, (80, 70, 60, 60, 50, 50, 50, 40), strict=True,
    ))
    occupation_allocations = {
        "Credit Rating": 20, "Spot Hidden": 40, "Library Use": 40,
        "Psychology": 30, "Fast Talk": 30, "History": 40,
    }
    interest_allocations = {
        "Listen": 40, "Stealth": 40, "Occult": 30, "First Aid": 30,
    }
    skills = {}
    skill_rules = coc_runtime_ops.coc_character.coc_rules.load_rule_table(
        "skills"
    )
    required = set(
        skill_rules["standard_sheet"]["1920s"]["default_skill_ids"]
    ) | set(occupation_allocations) | set(interest_allocations)
    for skill_id, spec in skill_rules["skills"].items():
        if skill_id not in required:
            continue
        base = spec["base_chance"]
        if base == "half_DEX":
            base = characteristics["DEX"] // 2
        elif base == "EDU":
            base = characteristics["EDU"]
        skills[skill_id] = (
            int(base)
            + occupation_allocations.get(skill_id, 0)
            + interest_allocations.get(skill_id, 0)
        )
    return {
        "campaign_id": "contract-campaign",
        "investigator_id": investigator_id,
        "sheet": {
            "id": investigator_id,
            "name": "Quick Fire Investigator",
            "age": 29,
            "skills": skills,
            "player_facing_sheet_zh": {
                "display_name": "速建调查员",
                "skills": [],
            },
        },
        "creation": {
            "input_mode": "guided_quick_fire",
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
            "luck_roll_receipt": {
                "campaign_id": "contract-campaign",
                "decision_id": "contract-quick-fire-luck",
                "roll_id": "toolbox-contract-campaign-000001",
            },
            "skill_budget": {
                "occupation_points": {
                    "budget": 200,
                    "spent": 200,
                    "allocations": occupation_allocations,
                },
                "personal_interest_points": {
                    "budget": 140,
                    "spent": 140,
                    "allocations": interest_allocations,
                },
            },
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
        "creation": {"input_mode": "import_complete_sheet"},
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
    assert contract["investigator_schema_version"] == 2
    assert contract["runtime_authority"]["schema_role"] == (
        "upfront machine-readable construction guidance"
    )
    assert contract["guided_quick_fire_skill_catalog"]["source"] == (
        "rules-json/skills.json"
    )
    compact_catalog = contract["guided_quick_fire_skill_catalog"]
    assert compact_catalog["columns"] == [
        "skill_id", "base_chance", "zh-Hans", "modern_only", "uncommon",
        "standard_sheet_1920s",
    ]
    assert next(
        row for row in compact_catalog["rows"] if row[0] == "Dodge"
    )[1:3] == ["half_DEX", "闪避"]
    assert compact_catalog["starting_skill_cap"] == 75
    assert next(
        row for row in compact_catalog["rows"]
        if row[0] == "Fighting (Brawl)"
    )[-1] is True
    assert next(
        row for row in compact_catalog["rows"]
        if row[0] == "Fighting (Axe)"
    )[-1] is False

    schema = contract["payload_schema"]
    assert [branch["title"] for branch in schema["oneOf"]] == [
        "Deterministic Quick Fire input",
        "Explicit complete-sheet import",
    ]
    assert schema["oneOf"][0]["required"] == [
        "campaign_id",
        "investigator_id",
        "sheet",
        "creation",
    ]
    assert "campaign_id" not in schema["oneOf"][1]["properties"]
    defs = schema["$defs"]
    assert defs["quick_fire_sheet"]["not"]["anyOf"] == [
        {"required": ["characteristics"]},
        {"required": ["derived"]},
    ]
    assert defs["quick_fire_creation"]["properties"]["luck_roll_total"] == {
        "type": "integer",
        "minimum": 3,
        "maximum": 18,
        "description": (
            "Authoritative 3D6 total. The runtime binds it to "
            "luck_roll_receipt and multiplies it by five."
        ),
    }
    assert defs["quick_fire_creation"]["required"] == [
        "input_mode",
        "method",
        "characteristic_assignment_order",
        "luck_roll_total",
        "luck_roll_receipt",
        "skill_budget",
    ]
    assert defs["complete_sheet"]["required"] == [
        "id",
        "name",
        "characteristics",
        "derived",
        "skills",
    ]
    assert defs["skills"]["required"] == ["Credit Rating"]
    assert "standard 1920s sheet classification" in defs["skills"]["description"]
    assert defs["skill_budget_account"]["required"] == [
        "budget", "spent", "allocations",
    ]
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

    luck = coc_toolbox.run_tool(
        "rules.roll_dice",
        tmp_path,
        "contract-campaign",
        {
            "expression": "3D6",
            "decision_id": "contract-quick-fire-luck",
            "purpose": "investigator_creation_luck",
            "reason": "Quick-Fire investigator Luck",
            "seed": 17,
        },
    )
    assert luck["ok"] is True
    payload = _quick_fire_payload()
    payload["creation"]["luck_roll_total"] = luck["data"]["total"]
    payload["creation"]["luck_roll_receipt"]["roll_id"] = (
        luck["data"]["roll_id"]
    )
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


def test_quick_fire_create_rejects_unreceipted_or_mismatched_luck(
    tmp_path: Path,
) -> None:
    _create_campaign(tmp_path)
    luck = coc_toolbox.run_tool(
        "rules.roll_dice",
        tmp_path,
        "contract-campaign",
        {
            "expression": "3D6",
            "decision_id": "bound-quick-fire-luck",
            "purpose": "investigator_creation_luck",
            "reason": "Quick-Fire investigator Luck",
            "seed": 23,
        },
    )
    assert luck["ok"] is True

    ordinary = coc_toolbox.run_tool(
        "rules.roll_dice",
        tmp_path,
        "contract-campaign",
        {
            "expression": "3D6",
            "decision_id": "ordinary-random-3d6",
            "reason": "ordinary random event",
            "seed": 29,
        },
    )
    assert ordinary["ok"] is True

    unreceipted = _quick_fire_payload("unreceipted-luck")
    unreceipted["creation"].pop("luck_roll_receipt")
    with pytest.raises(
        coc_runtime_ops.RuntimeOperationError,
        match="requires luck_roll_receipt",
    ):
        coc_runtime_ops.execute_setup_operation(
            tmp_path,
            operation={
                "schema_version": 1,
                "kind": "investigator.create",
                "payload": unreceipted,
            },
        )

    mismatched = _quick_fire_payload("mismatched-luck")
    mismatched["creation"]["luck_roll_total"] = luck["data"]["total"] + 1
    mismatched["creation"]["luck_roll_receipt"] = {
        "campaign_id": "contract-campaign",
        "decision_id": "bound-quick-fire-luck",
        "roll_id": luck["data"]["roll_id"],
    }
    with pytest.raises(
        coc_runtime_ops.RuntimeOperationError,
        match="does not match the exact campaign",
    ):
        coc_runtime_ops.execute_setup_operation(
            tmp_path,
            operation={
                "schema_version": 1,
                "kind": "investigator.create",
                "payload": mismatched,
            },
        )
    wrong_recipe = _quick_fire_payload("wrong-recipe-luck")
    wrong_recipe["creation"]["luck_roll_total"] = ordinary["data"]["total"]
    wrong_recipe["creation"]["luck_roll_receipt"] = {
        "campaign_id": "contract-campaign",
        "decision_id": "ordinary-random-3d6",
        "roll_id": ordinary["data"]["roll_id"],
    }
    with pytest.raises(
        coc_runtime_ops.RuntimeOperationError,
        match="does not match the exact campaign",
    ):
        coc_runtime_ops.execute_setup_operation(
            tmp_path,
            operation={
                "schema_version": 1,
                "kind": "investigator.create",
                "payload": wrong_recipe,
            },
        )

    wrong_campaign = _quick_fire_payload("wrong-campaign-luck")
    wrong_campaign["creation"]["luck_roll_total"] = luck["data"]["total"]
    wrong_campaign["creation"]["luck_roll_receipt"] = {
        "campaign_id": "different-campaign",
        "decision_id": "bound-quick-fire-luck",
        "roll_id": luck["data"]["roll_id"],
    }
    rejected = coc_toolbox.run_tool(
        "setup.invoke",
        tmp_path,
        "contract-campaign",
        {"kind": "investigator.create", "payload": wrong_campaign},
    )
    assert rejected["error"]["code"] == "invalid_param"
    assert not (tmp_path / ".coc" / "investigators" / "unreceipted-luck").exists()
    assert not (tmp_path / ".coc" / "investigators" / "mismatched-luck").exists()
    assert not (tmp_path / ".coc" / "investigators" / "wrong-recipe-luck").exists()
    assert not (tmp_path / ".coc" / "investigators" / "wrong-campaign-luck").exists()


def test_quick_fire_create_binds_declared_current_campaign_at_runtime_gateway(
    tmp_path: Path,
) -> None:
    from runtime.engine import session as runtime_session

    _create_campaign(tmp_path, campaign_id="receipt-campaign-a")
    _create_campaign(tmp_path, campaign_id="declared-campaign-b")
    luck = coc_toolbox.run_tool(
        "rules.roll_dice",
        tmp_path,
        "receipt-campaign-a",
        {
            "expression": "3D6",
            "decision_id": "cross-campaign-quick-fire-luck",
            "purpose": "investigator_creation_luck",
            "reason": "Quick-Fire investigator Luck",
            "seed": 31,
        },
    )
    assert luck["ok"] is True

    missing_declaration = _quick_fire_payload("missing-campaign-declaration")
    missing_declaration.pop("campaign_id")
    missing_declaration["creation"]["luck_roll_total"] = luck["data"]["total"]
    missing_declaration["creation"]["luck_roll_receipt"] = {
        "campaign_id": "receipt-campaign-a",
        "decision_id": "cross-campaign-quick-fire-luck",
        "roll_id": luck["data"]["roll_id"],
    }
    with pytest.raises(
        coc_runtime_ops.RuntimeOperationError,
        match="campaign_id must be a stable safe id",
    ):
        coc_runtime_ops.execute_setup_operation(
            tmp_path,
            operation={
                "schema_version": 1,
                "kind": "investigator.create",
                "payload": missing_declaration,
            },
        )

    cross_campaign = _quick_fire_payload("cross-campaign-direct")
    cross_campaign["campaign_id"] = "declared-campaign-b"
    cross_campaign["creation"]["luck_roll_total"] = luck["data"]["total"]
    cross_campaign["creation"]["luck_roll_receipt"] = {
        "campaign_id": "receipt-campaign-a",
        "decision_id": "cross-campaign-quick-fire-luck",
        "roll_id": luck["data"]["roll_id"],
    }
    operation = {
        "schema_version": 1,
        "kind": "investigator.create",
        "payload": cross_campaign,
    }
    with pytest.raises(
        coc_runtime_ops.RuntimeOperationError,
        match="must equal the declared current campaign_id",
    ):
        coc_runtime_ops.execute_setup_operation(tmp_path, operation=operation)
    with pytest.raises(
        ValueError,
        match="must equal the declared current campaign_id",
    ):
        runtime_session.setup_workspace_operation(tmp_path, operation)

    matching = _quick_fire_payload("matching-campaign-session")
    matching["campaign_id"] = "receipt-campaign-a"
    matching["creation"]["luck_roll_total"] = luck["data"]["total"]
    matching["creation"]["luck_roll_receipt"] = {
        "campaign_id": "receipt-campaign-a",
        "decision_id": "cross-campaign-quick-fire-luck",
        "roll_id": luck["data"]["roll_id"],
    }
    passed = runtime_session.setup_workspace_operation(
        tmp_path,
        {
            "schema_version": 1,
            "kind": "investigator.create",
            "payload": matching,
        },
    )
    assert passed["status"] == "PASS"
    assert not (
        tmp_path / ".coc" / "investigators" / "cross-campaign-direct"
    ).exists()
    assert not (
        tmp_path / ".coc" / "investigators" / "missing-campaign-declaration"
    ).exists()
    assert (
        tmp_path / ".coc" / "investigators" / "matching-campaign-session"
        / "character.json"
    ).is_file()
