"""Behavior tests owned by the rules-core operation cell."""
from toolbox_test_support import *

def test_describe_known_tool_returns_parameter_schema():
    described = coc_toolbox._describe("rules.roll_dice")
    assert described["name"] == "rules.roll_dice"
    assert described["needs_campaign"] is True
    assert "expression" in described["params"]
    assert described["params"]["expression"]["required"] is True
    assert described["params"]["expression"]["type"] == "string"

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

def test_missing_required_arg_returns_machine_readable_error(campaign_ws):
    envelope = _run(campaign_ws, "rules.roll_dice", {})
    assert envelope["ok"] is False
    assert envelope["tool"] == "rules.roll_dice"
    assert envelope["error"]["code"] == "missing_param"
    assert "expression" in envelope["error"]["message"]
    assert envelope["error"]["details"]["missing_parameters"] == [
        "expression", "decision_id",
    ]

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

def test_parallel_chargen_roll_dice_receipts_are_isolated_by_decision_id(
    campaign_ws,
):
    specs = [
        ("qs-luck-eleanor", "investigator_creation_luck"),
        ("qs-str-eleanor", "investigator_creation_characteristic"),
        ("qs-con-eleanor", "investigator_creation_characteristic"),
        ("qs-siz-eleanor", "investigator_creation_characteristic"),
        ("qs-dex-eleanor", "investigator_creation_characteristic"),
        ("qs-app-eleanor", "investigator_creation_characteristic"),
        ("qs-int-eleanor", "investigator_creation_characteristic"),
        ("qs-edu-eleanor", "investigator_creation_characteristic"),
    ]

    # Same-PID campaign_lock refuses nested wait; live KP bursts are sequential
    # processes. The production failure was purpose-whitelisting, not lock loss.
    results = [
        _run(
            campaign_ws,
            "rules.roll_dice",
            {
                "expression": "3D6",
                "decision_id": decision_id,
                "purpose": purpose,
                "reason": f"chargen {decision_id}",
            },
        )
        for decision_id, purpose in specs
    ]

    assert all(row["ok"] is True for row in results), results
    assert len({row["data"]["roll_id"] for row in results}) == 8
    document = json.loads(
        (
            campaign_ws["campaign_dir"]
            / "save"
            / "roll-operation-receipts.json"
        ).read_text(encoding="utf-8")
    )
    by_id = document["receipts"]["rules.roll_dice"]
    assert set(by_id) >= {decision_id for decision_id, _purpose in specs}
    for decision_id, purpose in specs:
        receipt = by_id[decision_id]
        assert receipt["decision_id"] == decision_id
        assert receipt["operation"]["purpose"] == purpose
        assert receipt["data"]["purpose"] == purpose

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

def test_rules_opposed_player_projection_hides_npc_secret_targets(campaign_ws):
    pow_settled = _run(
        campaign_ws,
        "rules.opposed",
        {
            "contest_kind": "noncombat",
            "investigator": campaign_ws["investigator_id"],
            "skill": "POW",
            "target": 40,
            "opponent_value": 90,
            "opponent_label": "a will that is not his own",
            "reason": "resist the unseen pressure",
            "decision_id": "proj-pow-90",
            "seed": 7,
        },
    )
    assert pow_settled["ok"] is True, pow_settled
    con_settled = _run(
        campaign_ws,
        "rules.opposed",
        {
            "contest_kind": "noncombat",
            "investigator": campaign_ws["investigator_id"],
            "characteristic": "CON",
            "target": 55,
            "opponent_value": 99,
            "opponent_label": "a crushing physical presence",
            "reason": "hold against the pressure",
            "decision_id": "proj-con-99",
            "seed": 11,
        },
    )
    assert con_settled["ok"] is True, con_settled

    rolls_path = campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl"
    rows = [
        json.loads(line)
        for line in rolls_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    by_id = {row["roll_id"]: row for row in rows}
    render = coc_toolbox.coc_turn_finalization._render_public_roll

    for settled, secret in ((pow_settled, 90), (con_settled, 99)):
        mine = by_id[settled["data"]["investigator_roll_id"]]
        theirs = by_id[settled["data"]["opponent_roll_id"]]
        mine_flat = {**mine.get("payload", {}), **mine}
        their_flat = {**theirs.get("payload", {}), **theirs}
        assert their_flat["base_target"] == secret
        assert mine_flat["player_projection"]["base_target"] == mine_flat["base_target"]
        assert "base_target" not in their_flat["player_projection"]
        assert their_flat["player_projection"]["contest_winner"] == settled["data"]["winner"]
        npc_line = render(their_flat, play_language="zh-Hans")
        pc_line = render(mine_flat, play_language="zh-Hans")
        assert f"基础值：{secret}" not in npc_line
        assert f"门槛：普通（≤{secret}）" not in npc_line
        assert str(their_flat["roll"]) in npc_line
        assert str(mine_flat["base_target"]) in pc_line
        assert "基础值" in pc_line

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

def test_rules_roll_rejects_psychology_with_lowercase_sheet_key(campaign_ws):
    character_path = (
        campaign_ws["coc_root"]
        / "investigators"
        / campaign_ws["investigator_id"]
        / "character.json"
    )
    character = json.loads(character_path.read_text(encoding="utf-8"))
    character["skills"]["psychology"] = character["skills"].pop("Psychology")
    _write_json(character_path, character)

    envelope = _run(
        campaign_ws,
        "rules.roll",
        {
            "investigator": campaign_ws["investigator_id"],
            "skill": "心理学",
            "seed": 7,
            "decision_id": "zh-alias-sheet-spelling",
        },
    )

    assert envelope["ok"] is False
    assert envelope["error"]["code"] == "psychology_observe_required"

@pytest.mark.parametrize(
    ("selector", "canonical"),
    [
        ("FastTalk", "Fast Talk"),
        ("spot_hidden", "Spot Hidden"),
        ("fast_talk", "Fast Talk"),
        ("fighting(brawl)", "Fighting (Brawl)"),
    ],
)
def test_rules_roll_compact_folds_skill_selector(campaign_ws, selector, canonical):
    envelope = _run(
        campaign_ws,
        "rules.roll",
        {
            "investigator": campaign_ws["investigator_id"],
            "skill": selector,
            "seed": 7,
            "decision_id": f"compact-fold-{selector}",
        },
    )

    assert envelope["ok"] is True
    assert envelope["data"]["skill"] == canonical
    assert envelope["data"]["target_source"] == "sheet"

def test_rules_roll_unknown_zh_skill_fails_closed(campaign_ws):
    envelope = _run(
        campaign_ws,
        "rules.roll",
        {
            "investigator": campaign_ws["investigator_id"],
            "skill": "炼金术",
            "target": 50,
            "seed": 7,
            "decision_id": "unknown-zh-skill",
        },
    )

    assert envelope["ok"] is False
    assert envelope["error"]["code"] == "unknown_skill"
    assert _read_jsonl(
        campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl"
    ) == []

def test_rules_roll_custom_sheet_skill_still_resolves(campaign_ws):
    character_path = (
        campaign_ws["coc_root"]
        / "investigators"
        / campaign_ws["investigator_id"]
        / "character.json"
    )
    character = json.loads(character_path.read_text(encoding="utf-8"))
    character["skills"]["Dowsing"] = 33
    _write_json(character_path, character)

    envelope = _run(
        campaign_ws,
        "rules.roll",
        {
            "investigator": campaign_ws["investigator_id"],
            "skill": "dowsing",
            "seed": 7,
            "decision_id": "custom-sheet-skill",
        },
    )

    assert envelope["ok"] is True
    assert envelope["data"]["skill"] == "Dowsing"
    assert envelope["data"]["target"] == 33
    assert envelope["data"]["target_source"] == "sheet"

def test_rules_roll_zh_alias_records_canonical_improvement_tick(campaign_ws):
    envelope = _run(
        campaign_ws,
        "rules.roll",
        {
            "investigator": campaign_ws["investigator_id"],
            "skill": "侦查",
            "target": 99,
            "seed": 88,
            "decision_id": "zh-alias-canonical-tick",
        },
    )

    assert envelope["ok"] is True
    assert envelope["data"]["success"] is True
    assert envelope["data"]["skill"] == "Spot Hidden"
    state = json.loads(
        (
            campaign_ws["campaign_dir"]
            / "save"
            / "investigator-state"
            / f"{campaign_ws['investigator_id']}.json"
        ).read_text(encoding="utf-8")
    )
    assert state["skill_checks_earned"] == ["Spot Hidden"]

def test_sheet_with_alias_duplicate_skill_fails_closed(campaign_ws):
    character_path = (
        campaign_ws["coc_root"]
        / "investigators"
        / campaign_ws["investigator_id"]
        / "character.json"
    )
    character = json.loads(character_path.read_text(encoding="utf-8"))
    character["skills"]["心理学"] = 10
    _write_json(character_path, character)

    envelope = _run(
        campaign_ws,
        "rules.roll",
        {
            "investigator": campaign_ws["investigator_id"],
            "skill": "Spot Hidden",
            "seed": 7,
            "decision_id": "polluted-sheet-fails-closed",
        },
    )

    assert envelope["ok"] is False
    assert "collide after canonical folding" in envelope["error"]["message"]

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
                coc_toolbox.coc_operation_kernel,
                "_ensure_roll_receipt_row",
                crash_after_receipt,
            )
        elif crash_stage == "after_materialization":
            crash.setattr(
                coc_toolbox.coc_operation_kernel,
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
    operation_kernel = coc_toolbox.coc_operation_kernel
    rules_module = coc_toolbox.OPERATION_MODULES["rules-core"]
    monkeypatch.setattr(operation_kernel, "_canonical_skill_base", reject_mutable_read)
    monkeypatch.setattr(rules_module, "_resolve_target_value", reject_mutable_read)

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
        crash.setattr(
            coc_toolbox.coc_operation_kernel,
            "_ensure_roll_receipt_row",
            crash_after_receipt,
        )
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

    operation_kernel = coc_toolbox.coc_operation_kernel
    monkeypatch.setattr(operation_kernel, "_roll_log_bytes", count_read)
    monkeypatch.setattr(
        operation_kernel, "_roll_prefix_hash_update", count_prefix_bytes
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
        coc_toolbox.coc_operation_kernel,
        "_apply_roll_receipt_side_effects",
        count_side_effect,
    )
    monkeypatch.setattr(
        coc_toolbox.coc_operation_kernel,
        "_save_roll_receipt_document",
        count_save,
    )
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
        coc_toolbox.coc_operation_kernel,
        "_apply_roll_receipt_side_effects",
        reject_side_effect,
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

def test_rules_roll_rejects_firearm_attack_without_generic_skill_alias(campaign_ws):
    blocked = _run(
        campaign_ws,
        "rules.roll",
        {
            "investigator": campaign_ws["investigator_id"],
            "skill": "Firearms",
            "decision_id": "illegal-firearms-alias",
            "difficulty": "regular",
            "goal": "shoot the shadow",
            "stakes": {
                "on_success": "the shot lands",
                "on_failure": "the shot misses",
            },
            "difficulty_basis": "keeper_judgment",
        },
    )
    assert blocked["ok"] is False
    assert blocked["error"]["code"] == "use_combat_resolve"
    blocked_rifle = _run(
        campaign_ws,
        "rules.roll",
        {
            "investigator": campaign_ws["investigator_id"],
            "skill": "Firearms (Rifle)",
            "decision_id": "illegal-firearms-rifle",
            "difficulty": "regular",
            "goal": "shoot the shadow",
            "stakes": {
                "on_success": "the shot lands",
                "on_failure": "the shot misses",
            },
            "difficulty_basis": "keeper_judgment",
        },
    )
    assert blocked_rifle["ok"] is False
    # Specialized names are ordinary-check selectors; "Firearms (Rifle)" is not
    # a catalog skill (the canonical specialization is Firearms (Rifle/Shotgun)).
    assert blocked_rifle["error"]["code"] == "unknown_skill"

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

def test_pi_opening_character_setup_allows_only_canonical_chargen_dice_recipes():
    gate = {"phase": "character_setup_required"}

    for purpose, expressions in {
        "investigator_creation_luck": ("3D6",),
        "investigator_creation_characteristic": (
            "3D6", "2D6+6", "1D100", "1D10",
        ),
    }.items():
        for expression in expressions:
            assert coc_toolbox._pi_opening_setup_operation_allowed(
                "rules.roll_dice",
                {
                    "expression": expression,
                    "decision_id": f"opening-{purpose}-{expression}",
                    "purpose": purpose,
                    "reason": "canonical investigator creation recipe",
                },
                gate,
            ) is True

    for purpose, expression in (
        ("investigator_creation_luck", "1D100"),
        ("investigator_creation_luck", "2D6+6"),
        ("investigator_creation_characteristic", "1D8"),
    ):
        assert coc_toolbox._pi_opening_setup_operation_allowed(
            "rules.roll_dice",
            {
                "expression": expression,
                "decision_id": f"opening-rejected-{purpose}-{expression}",
                "purpose": purpose,
            },
            gate,
        ) is False
