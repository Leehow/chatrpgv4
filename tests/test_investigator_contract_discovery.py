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

import coc_mcp_wire
import coc_runtime_ops
import coc_toolbox


def _create_campaign(
    workspace: Path,
    *,
    campaign_id: str = "contract-campaign",
    ruleset_id: str = "coc7",
    era: str = "1920s",
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
                "era": era,
            },
        },
    )
    assert receipt["status"] == "PASS"


def test_pi_opening_character_setup_gate_selects_era_contract_route(
    tmp_path: Path,
) -> None:
    _create_campaign(tmp_path, campaign_id="medieval-gate", era="medieval")
    medieval_gate = coc_toolbox._pi_opening_character_setup_gate(
        coc_runtime_ops.coc_state.coc_root(tmp_path) / "campaigns" / "medieval-gate",
        "medieval-gate",
    )
    assert medieval_gate is not None
    assert medieval_gate["character_setup_policy"] == "kp_guided_era_adaptive"
    assert medieval_gate["character_setup_input_mode"] == "kp_guided_era_adaptive"
    assert "KP-guided era-adaptive" in medieval_gate["instruction"]

    _create_campaign(tmp_path, campaign_id="standard-gate", era="1920s")
    standard_gate = coc_toolbox._pi_opening_character_setup_gate(
        coc_runtime_ops.coc_state.coc_root(tmp_path) / "campaigns" / "standard-gate",
        "standard-gate",
    )
    assert standard_gate == {
        "schema_version": 1,
        "status": "blocked",
        "hard_gate": True,
        "activation_allowed": False,
        "phase": "opening_character_setup_required",
        "opening_phase": "character_creation",
        "campaign_id": "standard-gate",
        "character_setup_policy": "guided_quick_fire",
        "next_operation": None,
        "instruction": (
            "complete one guided Quick Fire investigator creation and exact "
            "campaign link before opening play"
        ),
    }


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
            "era": "1920s",
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


def _kp_guided_medieval_payload(
    workspace: Path,
    investigator_id: str = "medieval-retainer",
) -> dict:
    luck = coc_toolbox.run_tool(
        "rules.roll_dice",
        workspace,
        "contract-campaign",
        {
            "expression": "3D6",
            "decision_id": f"{investigator_id}-luck",
            "purpose": "investigator_creation_luck",
            "reason": "中世纪调查员幸运值",
            "seed": 17,
        },
    )
    assert luck["ok"] is True, luck
    characteristics = {
        "STR": 60,
        "CON": 50,
        "SIZ": 60,
        "DEX": 55,
        "APP": 45,
        "INT": 65,
        "POW": 60,
        "EDU": 65,
    }
    occupation_allocations = {
        "Credit Rating": 30,
        "Drive Auto": 20,
        "Fighting (Sword)": 25,
        "Heraldry": 45,
        "Spot Hidden": 50,
        "Persuade": 40,
        "Navigate": 50,
    }
    interest_allocations = {"Stealth": 50, "Ride": 50, "First Aid": 30}
    sources = {
        "Credit Rating": "Credit Rating",
        "Drive Auto": "Drive Auto",
        "Fighting (Sword)": "Fighting (Sword)",
        "Heraldry": "History",
        "Spot Hidden": "Spot Hidden",
        "Persuade": "Persuade",
        "Navigate": "Navigate",
        "Stealth": "Stealth",
        "Ride": "Ride",
        "First Aid": "First Aid",
        "Dodge": "Dodge",
        "Language (Own)": "Language (Own)",
    }
    catalog = coc_runtime_ops.coc_character.coc_rules.skills_table()
    skills: dict[str, int] = {}
    for skill_id, source in sources.items():
        base = catalog[source]["base_chance"]
        if base == "half_DEX":
            base = characteristics["DEX"] // 2
        elif base == "EDU":
            base = characteristics["EDU"]
        skills[skill_id] = (
            int(base)
            + occupation_allocations.get(skill_id, 0)
            + interest_allocations.get(skill_id, 0)
        )
    skill_provenance = {
        "Drive Auto": {
            "original_name": "Drive Auto",
            "reskinned_name": "骑术",
            "era_adaptive": True,
        },
        "Heraldry": {
            "original_name": "History",
            "reskinned_name": "纹章学",
            "era_adaptive": True,
            "custom": True,
        },
    }
    rows = []
    for skill_id, value in skills.items():
        adaptation = skill_provenance.get(skill_id)
        label = (
            adaptation["reskinned_name"]
            if adaptation else catalog[sources[skill_id]]["localized_labels"]["zh-Hans"]
        )
        rows.append({"key": skill_id, "label": label, "value": value})
    occupation = {
        "name": "领主家臣",
        "reason": "为领主处理文书、巡视封地并随行出行。",
        "era_adaptive": True,
        "skill_point_formula": "EDU*4",
        "formula_reason": "该职位的训练重心是读写、礼法与行政教育。",
    }
    return {
        "campaign_id": "contract-campaign",
        "investigator_id": investigator_id,
        "sheet": {
            "id": investigator_id,
            "name": "埃德蒙",
            "age": 29,
            "era": "medieval",
            "era_adaptive": True,
            "kp_guided": True,
            "occupation": dict(occupation),
            "characteristics": characteristics,
            "derived": coc_runtime_ops.coc_character.derive_values(
                characteristics,
                luck=luck["data"]["total"] * 5,
            ),
            "skills": skills,
            "skill_provenance": skill_provenance,
            "player_facing_sheet_zh": {
                "display_name": "埃德蒙",
                "skills": rows,
            },
        },
        "creation": {
            "input_mode": "kp_guided_era_adaptive",
            "era": "medieval",
            "era_adaptive": True,
            "kp_guided": True,
            "method": "point_buy_460",
            "luck_roll_total": luck["data"]["total"],
            "luck_roll_receipt": {
                "campaign_id": "contract-campaign",
                "decision_id": f"{investigator_id}-luck",
                "roll_id": luck["data"]["roll_id"],
            },
            "occupation": occupation,
            "skill_budget": {
                "occupation_points": {
                    "budget": 260,
                    "spent": 260,
                    "allocations": occupation_allocations,
                },
                "personal_interest_points": {
                    "budget": 130,
                    "spent": 130,
                    "allocations": interest_allocations,
                },
            },
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
    assert contract["investigator_schema_version"] == 2
    assert contract["campaign_binding"] == {
        "campaign_id": "contract-campaign",
        "era": "1920s",
    }
    assert contract["guided_quick_fire_campaign_era"] == {
        "status": "standard_quick_fire_available",
        "supported": True,
        "required_sheet_era": "1920s",
        "supported_eras": ["1920s"],
        "failure_code": None,
    }
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
    assert compact_catalog["starting_skill_cap_scope"] == (
        "player_allocated_and_non_characteristic_derived_final_values"
    )
    assert compact_catalog["characteristic_derived_base_policy"] == (
        "authoritative_when_unallocated_even_above_starting_skill_cap"
    )
    assert compact_catalog["default_era"] == "1920s"
    assert compact_catalog["supported_eras"] == ["1920s"]
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
    assert "era" in defs["quick_fire_sheet"]["required"]
    assert defs["quick_fire_sheet"]["properties"]["era"]["const"] == "1920s"
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


def test_module_pregen_complete_sheet_import_needs_no_luck_receipt(
    tmp_path: Path,
) -> None:
    _create_campaign(tmp_path, era="medieval")
    fallback = _query(tmp_path)["result"]["guided_quick_fire_campaign_era"]["fallback"]
    assert fallback["module_pregen_option"]["input_mode"] == "import_complete_sheet"

    payload = _complete_payload("module-pregen")
    receipt = coc_runtime_ops.execute_setup_operation(
        tmp_path,
        operation={
            "schema_version": 1,
            "kind": "investigator.create",
            "payload": payload,
        },
    )

    assert receipt["status"] == "PASS"
    assert "campaign_id" not in payload
    assert not {"luck_roll_total", "luck_roll_receipt"} & set(payload["creation"])


def test_medieval_contract_exposes_kp_guided_fallback_and_creates(
    tmp_path: Path,
) -> None:
    _create_campaign(tmp_path, era="medieval")

    contract = _query(tmp_path)["result"]

    assert contract["campaign_binding"] == {
        "campaign_id": "contract-campaign",
        "era": "medieval",
    }
    era_contract = contract["guided_quick_fire_campaign_era"]
    assert {
        key: era_contract[key]
        for key in ("status", "supported", "required_sheet_era", "supported_eras", "failure_code")
    } == {
        "status": "kp_guided_era_adaptive_available",
        "supported": False,
        "required_sheet_era": "medieval",
        "supported_eras": ["1920s"],
        "failure_code": None,
    }
    assert era_contract["legacy_failure_code"] == (
        "guided_quick_fire_unsupported_campaign_era"
    )
    fallback = era_contract["fallback"]
    assert fallback["available"] is True
    assert fallback["route"] == "kp_guided_era_adaptive"
    assert fallback["input_mode"] == "kp_guided_era_adaptive"
    assert fallback["quick_fire_standard_sheet"] == {
        "available": False,
        "supported_eras": ["1920s"],
        "reason": "no_package_owned_standard_sheet_for_campaign_era",
    }
    assert fallback["cash_assets"]["when_no_authoritative_table"] == {
        "status": "kp_guided_cash_semantic_available",
        "available": True,
        "operation": "state.cash_semantic",
        "campaign_era": "medieval",
        "provenance": {"kp_guided": True, "cash_semantic": True},
        "authority": "KP semantic campaign-local bookkeeping only",
        "rules_table_authority": "unavailable_for_campaign_era",
        "forbids": ["rules_table_mutation", "rule_derived_cash_amount"],
    }
    assert [item["source_ref"] for item in fallback["rulebook_principles"]] == [
        "Keeper Rulebook 7e L790",
        "Keeper Rulebook 7e L1640",
        "Keeper Rulebook 7e L1644",
        "Keeper Rulebook 7e L2299/L2915",
        "Keeper Rulebook 7e L2311",
    ]
    assert fallback["allowed_mechanics"]["occupation"]["catalog_membership_required"] is False
    assert fallback["allowed_mechanics"]["skills"]["period_omission_allowed"] is True
    assert fallback["module_pregen_option"] == {
        "available": True,
        "when": (
            "the player selects an L0 pregen with a source-backed complete "
            "stats_ref"
        ),
        "read_channel": "existing progressive/lookup read-only channel",
        "new_parser": False,
        "validation_route": "import_complete_sheet",
        "input_mode": "import_complete_sheet",
    }
    assert [
        branch["title"] for branch in contract["payload_schema"]["oneOf"]
    ] == [
        "KP-guided era-adaptive creation",
        "Explicit complete-sheet import",
    ]
    quick_sheet = contract["payload_schema"]["$defs"]["quick_fire_sheet"]
    assert quick_sheet["properties"]["era"]["const"] == "medieval"
    assert "era" in quick_sheet["required"]
    Draft202012Validator.check_schema(contract["payload_schema"])

    payload = _quick_fire_payload("medieval-drift")
    with pytest.raises(
        coc_runtime_ops.RuntimeOperationError,
        match=(
            r"sheet\.era must exactly match campaign era 'medieval'; "
            r"got '1920s'"
        ),
    ):
        coc_runtime_ops.execute_setup_operation(
            tmp_path,
            operation={
                "schema_version": 1,
                "kind": "investigator.create",
                "payload": payload,
            },
        )
    assert not (
        tmp_path / ".coc" / "investigators" / "medieval-drift"
    ).exists()

    payload["sheet"].pop("era")
    with pytest.raises(
        coc_runtime_ops.RuntimeOperationError,
        match=(
            r"guided Quick Fire is unavailable for campaign era 'medieval'; "
            r"package-owned standard sheet eras: 1920s"
        ),
    ):
        coc_runtime_ops.execute_setup_operation(
            tmp_path,
            operation={
                "schema_version": 1,
                "kind": "investigator.create",
                "payload": payload,
            },
        )
    assert not (
        tmp_path / ".coc" / "investigators" / "medieval-drift"
    ).exists()

    guided_payload = _kp_guided_medieval_payload(tmp_path)
    Draft202012Validator(contract["payload_schema"]).validate(guided_payload)
    receipt = coc_runtime_ops.execute_setup_operation(
        tmp_path,
        operation={
            "schema_version": 1,
            "kind": "investigator.create",
            "payload": guided_payload,
        },
    )
    assert receipt["status"] == "PASS"
    stored = json.loads(
        (
            tmp_path / ".coc" / "investigators" / "medieval-retainer"
            / "character.json"
        ).read_text(encoding="utf-8")
    )
    creation = json.loads(
        (
            tmp_path / ".coc" / "investigators" / "medieval-retainer"
            / "creation.json"
        ).read_text(encoding="utf-8")
    )
    assert coc_runtime_ops.coc_character.validate_character_create_sheet(
        stored, creation
    ) == []
    assert stored["era"] == "medieval"
    assert stored["era_adaptive"] is True
    assert stored["kp_guided"] is True
    assert stored["occupation"]["name"] == "领主家臣"
    assert stored["skills"]["Drive Auto"] == 40
    assert stored["skills"]["Heraldry"] == 50
    assert stored["skill_provenance"]["Drive Auto"] == {
        "original_name": "Drive Auto",
        "reskinned_name": "骑术",
        "era_adaptive": True,
    }
    assert stored["skill_provenance"]["Heraldry"]["custom"] is True
    assert creation["input_mode"] == "kp_guided_era_adaptive"

    no_default = coc_toolbox.run_tool(
        "rules.cash_assets",
        tmp_path,
        "contract-campaign",
        {"credit_rating": 20},
    )
    assert no_default["ok"] is False
    assert no_default["error"] == {
        "code": "invalid_param",
        "message": (
            "campaign era 'medieval' has no authoritative cash-assets table; "
            "no 1920s fallback was applied"
        ),
        "details": {
            "cash_semantic_disposition": fallback[
                "cash_assets"
            ]["when_no_authoritative_table"],
        },
    }
    semantic_cash = coc_toolbox.run_tool(
        "state.cash_semantic",
        tmp_path,
        "contract-campaign",
        {
            "record_id": "medieval-retainer-starting-assets",
            "investigator_id": "medieval-retainer",
            "cash_description": "领主家臣的差旅银币",
            "assets": ["佩剑", "家臣制服"],
            "basis": "kp_era_adaptation",
            "reason": "按中世纪家臣身份做 campaign-local 开局记账",
            "decision_id": "medieval-retainer-starting-assets-v1",
        },
    )
    assert semantic_cash["ok"] is True, semantic_cash
    assert semantic_cash["data"]["provenance"] == {
        "kp_guided": True,
        "cash_semantic": True,
        "basis": "kp_era_adaptation",
        "reason": "按中世纪家臣身份做 campaign-local 开局记账",
        "rules_table_authority": "unavailable_for_campaign_era",
    }
    assert semantic_cash["data"]["cash_description"] == "领主家臣的差旅银币"
    assert semantic_cash["data"]["assets"] == ["佩剑", "家臣制服"]
    mismatched_period = coc_toolbox.run_tool(
        "rules.cash_assets",
        tmp_path,
        "contract-campaign",
        {"credit_rating": 20, "period": "1920s"},
    )
    assert mismatched_period["ok"] is False
    assert mismatched_period["error"] == {
        "code": "invalid_param",
        "message": (
            "rules.cash_assets period must exactly match canonical campaign "
            "era 'medieval'; got '1920s'"
        ),
    }


def _kp_guided_rolled_medieval_payload(
    workspace: Path,
    investigator_id: str,
) -> tuple[dict, dict[str, int], dict]:
    """Build one valid rolled adaptive payload from real canonical receipts."""
    payload = _kp_guided_medieval_payload(workspace, investigator_id=investigator_id)
    expressions = coc_runtime_ops.coc_character.characteristic_roll_expressions()
    characteristics: dict[str, int] = {}
    references: dict[str, dict[str, str]] = {}
    for index, characteristic in enumerate(
        coc_runtime_ops.coc_character.REQUIRED_CHARACTERISTICS
    ):
        result = coc_toolbox.run_tool(
            "rules.roll_dice",
            workspace,
            "contract-campaign",
            {
                "expression": expressions[characteristic],
                "decision_id": f"{investigator_id}-{characteristic.lower()}",
                "reason": f"rolled {characteristic}",
                "seed": 100 + index,
            },
        )
        assert result["ok"] is True, result
        characteristics[characteristic] = result["data"]["total"] * 5
        references[characteristic] = {
            "campaign_id": "contract-campaign",
            "decision_id": f"{investigator_id}-{characteristic.lower()}",
            "roll_id": result["data"]["roll_id"],
        }
    luck = coc_toolbox.run_tool(
        "rules.roll_dice",
        workspace,
        "contract-campaign",
        {
            "expression": "3D6",
            "decision_id": f"{investigator_id}-authoritative-luck",
            "purpose": "investigator_creation_luck",
            "reason": "rolled Luck",
            "seed": 200,
        },
    )
    assert luck["ok"] is True, luck
    references["Luck"] = {
        "campaign_id": "contract-campaign",
        "decision_id": f"{investigator_id}-authoritative-luck",
        "roll_id": luck["data"]["roll_id"],
    }
    payload["sheet"]["characteristics"] = characteristics
    payload["sheet"]["derived"] = coc_runtime_ops.coc_character.derive_values(
        characteristics, luck=luck["data"]["total"] * 5,
    )
    interest = payload["creation"]["skill_budget"]["personal_interest_points"]
    interest["budget"] = characteristics["INT"] * 2
    interest["spent"] = characteristics["INT"] * 2
    interest["allocations"]["First Aid"] += characteristics["INT"] * 2 - 130
    sources = {
        skill_id: (
            adaptation["original_name"]
            if isinstance(adaptation, dict) else skill_id
        )
        for skill_id, adaptation in (
            (skill_id, payload["sheet"]["skill_provenance"].get(skill_id))
            for skill_id in payload["sheet"]["skills"]
        )
    }
    catalog = coc_runtime_ops.coc_character.coc_rules.skills_table()
    occupation = payload["creation"]["skill_budget"]["occupation_points"]["allocations"]
    for skill_id, source in sources.items():
        base = catalog[source]["base_chance"]
        if base == "half_DEX":
            base = characteristics["DEX"] // 2
        elif base == "EDU":
            base = characteristics["EDU"]
        payload["sheet"]["skills"][skill_id] = (
            int(base)
            + occupation.get(skill_id, 0)
            + interest["allocations"].get(skill_id, 0)
        )
    for row in payload["sheet"]["player_facing_sheet_zh"]["skills"]:
        row["value"] = payload["sheet"]["skills"][row["key"]]
    payload["creation"].update({
        "method": "rolled_in_order",
        "characteristic_roll_receipts": references,
        "luck_roll_total": luck["data"]["total"],
        "luck_roll_receipt": references["Luck"],
    })
    return payload, characteristics, luck


def test_kp_guided_rolled_characteristics_bind_existing_roll_receipts(
    tmp_path: Path,
) -> None:
    _create_campaign(tmp_path, era="medieval")
    payload, characteristics, luck = _kp_guided_rolled_medieval_payload(
        tmp_path, "medieval-rolled",
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
            tmp_path / ".coc" / "investigators" / "medieval-rolled"
            / "character.json"
        ).read_text(encoding="utf-8")
    )
    assert stored["characteristics"] == characteristics
    assert stored["derived"]["Luck"] == luck["data"]["total"] * 5
    assert stored["skill_provenance"]["Drive Auto"]["reskinned_name"] == "骑术"


@pytest.mark.parametrize(
    ("mutation", "match"),
    [
        ("missing_characteristic_receipt", "characteristic_roll_receipts"),
        ("wrong_characteristic_recipe", r"KP-guided SIZ recorded roll operation .* does not match the required .*2D6\+6"),
        ("divergent_luck_receipt", "KP-guided Luck characteristic_roll_receipts entry must equal luck_roll_receipt"),
        ("luck_total_mismatch", "Quick Fire Luck source receipt does not match"),
        ("duplicate_characteristic_roll", "must use distinct authoritative roll_id values"),
        ("unknown_occupation_formula", "pinned 7e formula"),
        ("custom_skill_without_provenance", "requires skill_provenance.custom=true"),
    ],
)
def test_kp_guided_adaptive_mutations_fail_closed_before_write(
    tmp_path: Path,
    mutation: str,
    match: str,
) -> None:
    _create_campaign(tmp_path, era="medieval")
    investigator_id = f"mutated-{mutation}"
    payload, characteristics, _luck = _kp_guided_rolled_medieval_payload(
        tmp_path, investigator_id,
    )
    references = payload["creation"]["characteristic_roll_receipts"]
    if mutation == "missing_characteristic_receipt":
        references.pop("SIZ")
    elif mutation == "wrong_characteristic_recipe":
        wrong_recipe = coc_toolbox.run_tool(
            "rules.roll_dice",
            tmp_path,
            "contract-campaign",
            {
                "expression": "3D6",
                "decision_id": f"{investigator_id}-wrong-siz",
                "reason": "wrong SIZ recipe",
                "seed": 901,
            },
        )
        assert wrong_recipe["ok"] is True, wrong_recipe
        references["SIZ"] = {
            "campaign_id": "contract-campaign",
            "decision_id": f"{investigator_id}-wrong-siz",
            "roll_id": wrong_recipe["data"]["roll_id"],
        }
    elif mutation == "divergent_luck_receipt":
        divergent_luck = coc_toolbox.run_tool(
            "rules.roll_dice",
            tmp_path,
            "contract-campaign",
            {
                "expression": "3D6",
                "decision_id": f"{investigator_id}-divergent-luck",
                "purpose": "investigator_creation_luck",
                "reason": "different Luck receipt",
                "seed": 902,
            },
        )
        assert divergent_luck["ok"] is True, divergent_luck
        references["Luck"] = {
            "campaign_id": "contract-campaign",
            "decision_id": f"{investigator_id}-divergent-luck",
            "roll_id": divergent_luck["data"]["roll_id"],
        }
    elif mutation == "luck_total_mismatch":
        payload["creation"]["luck_roll_total"] += 1
    elif mutation == "duplicate_characteristic_roll":
        references["CON"] = dict(references["STR"])
        payload["sheet"]["characteristics"]["CON"] = characteristics["STR"]
        payload["sheet"]["derived"] = coc_runtime_ops.coc_character.derive_values(
            payload["sheet"]["characteristics"],
            luck=payload["creation"]["luck_roll_total"] * 5,
        )
    elif mutation == "unknown_occupation_formula":
        payload["creation"]["occupation"]["skill_point_formula"] = "INT*99"
    elif mutation == "custom_skill_without_provenance":
        payload["sheet"]["skill_provenance"]["Heraldry"].pop("custom")
    else:
        raise AssertionError(mutation)

    with pytest.raises(coc_runtime_ops.RuntimeOperationError, match=match):
        coc_runtime_ops.execute_setup_operation(
            tmp_path,
            operation={
                "schema_version": 1,
                "kind": "investigator.create",
                "payload": payload,
            },
        )
    assert not (
        tmp_path / ".coc" / "investigators" / investigator_id
    ).exists()


def test_campaign_cash_assets_uses_existing_modern_table_without_1920s_default(
    tmp_path: Path,
) -> None:
    _create_campaign(
        tmp_path,
        campaign_id="modern-contract",
        era="modern",
    )

    result = coc_toolbox.run_tool(
        "rules.cash_assets",
        tmp_path,
        "modern-contract",
        {"credit_rating": 20},
    )

    assert result["ok"] is True, result
    assert result["data"]["period"] == "modern"
    assert result["data"]["cash"] == {
        "amount": 800,
        "currency": "USD",
        "formula": "CR x 40",
    }
    assert result["hints"][0] == (
        "finance period is bound to canonical campaign era 'modern'"
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
    assert any(
        "purpose': 'investigator_creation_luck'" in hint
        and "rules.roll_dice" in hint
        for hint in result["hints"]
    ), result["hints"]

    wrong_key = coc_toolbox.run_tool(
        "setup.investigator_contract",
        tmp_path,
        None,
        {"campaign": "contract-campaign"},
    )
    assert wrong_key["error"]["code"] == "missing_param"
    assert "campaign_id" in wrong_key["error"]["message"]
    both_keys = coc_toolbox.run_tool(
        "setup.investigator_contract",
        tmp_path,
        None,
        {"campaign": "contract-campaign", "campaign_id": "contract-campaign"},
    )
    assert both_keys["error"]["code"] == "invalid_param"
    assert "top-level key is campaign_id, not campaign" in (
        both_keys["error"]["message"]
    )

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


def _project_investigator_contract_envelope(
    workspace: Path,
    *,
    campaign_id: str,
    era: str,
) -> dict:
    _create_campaign(workspace, campaign_id=campaign_id, era=era)
    envelope = coc_toolbox.run_tool(
        "setup.investigator_contract",
        workspace,
        None,
        {"campaign_id": campaign_id},
    )
    assert envelope["ok"] is True, envelope
    return coc_mcp_wire.project_envelope(
        "setup.investigator_contract",
        envelope,
        contract_digest="sha256:" + ("ab" * 32),
    )


def _assert_payload_schema_core(projected: dict, *, input_mode: str) -> None:
    wire = projected["wire"]
    assert wire["profile"] == "keeper_hot_v1"
    assert wire["canonical_operation"] == "setup.investigator_contract"
    assert wire["measured_inline_bytes"] < wire["max_inline_bytes"]
    assert wire.get("identity_only") is not True
    assert projected["ok"] is True

    result = projected["data"]["result"]
    schema = result["payload_schema"]
    assert isinstance(schema, dict)
    definitions = schema["$defs"]
    assert isinstance(definitions, dict)
    branches = schema["oneOf"]
    assert isinstance(branches, list) and branches

    matching = []
    for branch in branches:
        creation_ref = (
            branch.get("properties", {}).get("creation", {}).get("$ref")
        )
        if not isinstance(creation_ref, str) or not creation_ref.startswith(
            "#/$defs/"
        ):
            continue
        definition = definitions.get(creation_ref[len("#/$defs/"):])
        mode = (
            (definition or {}).get("properties", {}).get("input_mode", {}).get(
                "const"
            )
        )
        if mode == input_mode:
            matching.append(branch)
    assert len(matching) == 1, matching
    branch = matching[0]
    for field in ("campaign_id", "investigator_id", "sheet", "creation"):
        assert field in branch["required"]
        ref = branch["properties"][field].get("$ref")
        if isinstance(ref, str) and ref.startswith("#/$defs/"):
            assert ref[len("#/$defs/"):] in definitions

    sheet_ref = branch["properties"]["sheet"]["$ref"]
    sheet_def = definitions[sheet_ref[len("#/$defs/"):]]
    assert "era" in sheet_def.get("required", []) or "era" in (
        sheet_def.get("properties") or {}
    )
    creation_ref = branch["properties"]["creation"]["$ref"]
    creation_def = definitions[creation_ref[len("#/$defs/"):]]
    assert creation_def["properties"]["input_mode"]["const"] == input_mode


def test_keeper_hot_projection_keeps_adaptive_payload_schema_under_budget(
    tmp_path: Path,
) -> None:
    projected = _project_investigator_contract_envelope(
        tmp_path,
        campaign_id="adaptive-wire",
        era="medieval",
    )
    wire = projected["wire"]
    assert wire["full_result_bytes"] > wire["max_inline_bytes"]
    assert wire["payload_projected"] is True
    _assert_payload_schema_core(
        projected,
        input_mode="kp_guided_era_adaptive",
    )
    result = projected["data"]["result"]
    assert [
        branch["title"] for branch in result["payload_schema"]["oneOf"]
    ] == [
        "KP-guided era-adaptive creation",
        "Explicit complete-sheet import",
    ]
    definitions = result["payload_schema"]["$defs"]
    assert "kp_guided_era_adaptive_sheet" in definitions
    assert "kp_guided_era_adaptive_creation" in definitions
    assert "quick_fire_sheet" not in definitions
    assert "quick_fire_creation" not in definitions
    assert "complete_sheet" in definitions
    assert "complete_sheet_creation" in definitions
    catalog = result.get("guided_quick_fire_skill_catalog")
    assert isinstance(catalog, dict)
    assert "rows" not in catalog
    # Full archive still retained the oversized adaptive bulk.
    assert "quick_fire_sheet" in (
        coc_toolbox.run_tool(
            "setup.investigator_contract",
            tmp_path,
            None,
            {"campaign_id": "adaptive-wire"},
        )["data"]["result"]["payload_schema"]["$defs"]
    )


def test_keeper_hot_projection_keeps_quick_fire_payload_schema_under_budget(
    tmp_path: Path,
) -> None:
    projected = _project_investigator_contract_envelope(
        tmp_path,
        campaign_id="quick-fire-wire",
        era="1920s",
    )
    wire = projected["wire"]
    # Pre-fix baseline: 1920s Quick Fire fits without identity collapse.
    assert wire["full_result_bytes"] < wire["max_inline_bytes"]
    _assert_payload_schema_core(
        projected,
        input_mode="guided_quick_fire",
    )
    result = projected["data"]["result"]
    # Quick Fire stays archive-equivalent on the wire when already in budget.
    assert [
        branch["title"] for branch in result["payload_schema"]["oneOf"]
    ] == [
        "Deterministic Quick Fire input",
        "Explicit complete-sheet import",
    ]
    assert "rows" in result["guided_quick_fire_skill_catalog"]
    assert "quick_fire_sheet" in result["payload_schema"]["$defs"]


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
