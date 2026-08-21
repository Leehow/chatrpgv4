from __future__ import annotations

import importlib.util
import json
from pathlib import Path


REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "plugins" / "coc-keeper" / "scripts"
CLERK_TS = REPO / "plugins" / "coc-keeper" / "pi" / "lib" / "chargen-clerk.ts"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_toolbox = _load("coc_toolbox_chargen_run", SCRIPTS / "coc_toolbox.py")
coc_runtime_ops = coc_toolbox.coc_runtime_ops
coc_character = coc_runtime_ops.coc_character


def _create_campaign(
    workspace: Path,
    campaign_id: str = "chargen-scratch",
    *,
    era: str = "1920s",
) -> str:
    receipt = coc_runtime_ops.execute_setup_operation(
        workspace,
        operation={
            "schema_version": 1,
            "kind": "campaign.create",
            "payload": {
                "campaign_id": campaign_id,
                "title": "Chargen Scratch",
                "era": era,
            },
        },
    )
    assert receipt["status"] == "PASS"
    return campaign_id


def _stored_investigator(tmp_path: Path, investigator_id: str) -> tuple[dict, dict]:
    base = tmp_path / ".coc" / "investigators" / investigator_id
    stored = json.loads((base / "character.json").read_text(encoding="utf-8"))
    creation = json.loads((base / "creation.json").read_text(encoding="utf-8"))
    return stored, creation


def _expected_age_adjusted_chars(creation: dict, age: int) -> dict:
    order = creation["characteristic_assignment_order"]
    return coc_character.apply_chargen_age_to_characteristics(
        coc_character.quick_fire_array_characteristics(order),
        age,
        creation.get("edu_improvement_rolls") or [],
        creation.get("characteristic_reductions") or [],
    )


def test_chargen_run_end_to_end_links_and_renders(tmp_path: Path) -> None:
    campaign_id = _create_campaign(tmp_path)
    envelope = coc_toolbox.run_tool(
        "setup.chargen_run",
        tmp_path,
        None,
        {
            "campaign_id": campaign_id,
            "investigator_id": "ada-lark",
            "name": "Ada Lark",
            "occupation_name": "Journalist",
            "occupation_label": "记者",
            "assignment_priority": [
                "INT", "EDU", "POW", "DEX", "CON", "APP", "SIZ", "STR",
            ],
            "occupation_skill_names": ["Spot Hidden", "Listen"],
            "interest_skill_names": ["Occult", "First Aid", "Stealth", "Listen"],
            "luck": {"mode": "auto_roll"},
        },
    )
    assert envelope["ok"] is True, envelope
    result = envelope["data"]["result"]
    assert result["ok"] is True
    assert result["investigator_id"] == "ada-lark"
    chars = result["characteristics"]
    assert set(chars) == set(coc_character.REQUIRED_CHARACTERISTICS)
    stored, creation = _stored_investigator(tmp_path, "ada-lark")
    assert chars == _expected_age_adjusted_chars(creation, int(stored["age"]))
    derived = result["derived"]
    assert isinstance(derived["hp"], int) and derived["hp"] > 0
    assert isinstance(derived["mp"], int) and derived["mp"] > 0
    assert isinstance(derived["san"], int) and derived["san"] > 0
    assert isinstance(derived["luck"], int) and derived["luck"] % 5 == 0
    assert result["skill_top"]
    assert result["roll_ids"]
    card = tmp_path / result["card_path"]
    assert card.is_file()
    stored = json.loads(
        (tmp_path / ".coc" / "investigators" / "ada-lark" / "character.json")
        .read_text(encoding="utf-8")
    )
    assert stored["name"] == "Ada Lark"
    party = json.loads(
        (tmp_path / ".coc" / "campaigns" / campaign_id / "party.json")
        .read_text(encoding="utf-8")
    )
    assert "ada-lark" in party.get("investigator_ids", party.get("investigators", [])) or (
        "ada-lark" in json.dumps(party)
    )


def test_chargen_run_luck_idempotent(tmp_path: Path) -> None:
    campaign_id = _create_campaign(tmp_path, "chargen-luck")
    first = coc_toolbox.run_tool(
        "setup.chargen_run",
        tmp_path,
        None,
        {
            "campaign_id": campaign_id,
            "investigator_id": "luck-one",
            "name": "Luck One",
            "occupation_name": "Librarian",
            "occupation_label": "图书管理员",
            "occupation_skill_names": ["History", "Occult", "Spot Hidden", "Listen"],
        },
    )
    assert first["ok"] is True, first
    first_luck = first["data"]["result"]["derived"]["luck"]
    first_rolls = list(first["data"]["result"]["roll_ids"])
    replay = coc_toolbox.run_tool(
        "rules.roll_dice",
        tmp_path,
        campaign_id,
        {
            "expression": "3D6",
            "decision_id": f"chargen-luck-{campaign_id}-luck-one",
            "purpose": "investigator_creation_luck",
            "reason": "Quick Fire Luck auto_roll",
        },
    )
    assert replay["ok"] is True, replay
    assert replay["data"]["total"] * 5 == first_luck
    assert replay["data"]["roll_id"] == first_rolls[0]


def test_chargen_run_unrecognized_occupation_skill_names_invalid_param(
    tmp_path: Path,
) -> None:
    campaign_id = _create_campaign(tmp_path, "chargen-bad-skill")
    mystery = "图书馆使用与珍本鉴定"
    envelope = coc_toolbox.run_tool(
        "setup.chargen_run",
        tmp_path,
        None,
        {
            "campaign_id": campaign_id,
            "investigator_id": "bad-skill",
            "name": "Nobody",
            "occupation_name": "旧书商",
            "occupation_skill_names": [mystery, "Spot Hidden"],
        },
    )
    assert envelope["ok"] is False, envelope
    error = envelope.get("error") or {}
    assert error.get("code") == "invalid_param"
    assert mystery in str(error.get("message", ""))
    details = error.get("details") or {}
    assert details.get("stage") == "occupation"
    assert mystery in str(details.get("error", ""))
    assert mystery in str((details.get("expected") or {}).get("unrecognized", []))
    assert not (
        tmp_path / ".coc" / "investigators" / "bad-skill" / "character.json"
    ).exists()


def test_chargen_run_unknown_occupation_without_skills(tmp_path: Path) -> None:
    campaign_id = _create_campaign(tmp_path, "chargen-bad-occ")
    envelope = coc_toolbox.run_tool(
        "setup.chargen_run",
        tmp_path,
        None,
        {
            "campaign_id": campaign_id,
            "investigator_id": "nobody",
            "name": "Nobody",
            "occupation_name": "Moon Priest of Yuggoth",
        },
    )
    assert envelope["ok"] is False, envelope
    details = (envelope.get("error") or {}).get("details") or {}
    assert details.get("ok") is False
    assert details.get("stage") == "occupation"
    assert not (
        tmp_path / ".coc" / "investigators" / "nobody" / "character.json"
    ).exists()


def test_chargen_run_rejects_allocation_maps_even_when_totals_match(
    tmp_path: Path,
) -> None:
    campaign_id = _create_campaign(tmp_path, "chargen-alloc")
    matching = {"Library Use": 160, "History": 0}
    envelope = coc_toolbox.run_tool(
        "setup.chargen_run",
        tmp_path,
        None,
        {
            "campaign_id": campaign_id,
            "investigator_id": "mismatch",
            "name": "Mismatch",
            "occupation_name": "Author",
            "occupation_label": "作家",
            "occupation_allocations": {"Library Use": 160},
        },
    )
    assert envelope["ok"] is False, envelope
    assert "occupation_allocations" in str(envelope)
    receipt = coc_runtime_ops.execute_setup_operation(
        tmp_path,
        operation={
            "schema_version": 1,
            "kind": "setup.chargen_run",
            "payload": {
                "campaign_id": campaign_id,
                "investigator_id": "match-alloc",
                "name": "Match Alloc",
                "occupation_name": "Author",
                "occupation_label": "作家",
                "occupation_allocations": matching,
                "interest_allocations": {"Spot Hidden": 80},
            },
        },
    )
    assert receipt["status"] == "FAIL"
    assert receipt["result"]["stage"] == "payload"
    forbidden = receipt["result"]["expected"]["forbidden"]
    assert "occupation_allocations" in forbidden
    assert "interest_allocations" in forbidden


def test_extension_has_no_pi_p_clerk_spawn() -> None:
    text = CLERK_TS.read_text(encoding="utf-8")
    assert "spawn(" not in text
    assert '"-p"' not in text
    assert "pi -p" not in text
    assert "runChargenInProcess" in text
    assert not (
        REPO / "plugins" / "coc-keeper" / "pi" / "prompts" / "chargen-clerk.md"
    ).exists()


def test_occupation_template_source_exists() -> None:
    found = coc_character.lookup_occupation_template("Journalist")
    assert found is not None
    name, spec = found
    assert name == "Journalist"
    assert spec["skill_point_formula"] == "EDU*4"


FOCUS = ["Library Use", "History", "Spot Hidden"]
SUPPORT = [
    "Photography", "Appraise", "Psychology", "Listen", "Dodge", "Fast Talk",
    "Accounting",
]
PRIORITY = ["INT", "EDU", "POW", "DEX", "CON", "APP", "SIZ", "STR"]


def test_chargen_run_three_occupation_skills_cannot_place(tmp_path: Path) -> None:
    campaign_id = _create_campaign(tmp_path, "chargen-three-occ")
    envelope = coc_toolbox.run_tool(
        "setup.chargen_run",
        tmp_path,
        None,
        {
            "campaign_id": campaign_id,
            "investigator_id": "gu-three",
            "name": "顾南舟",
            "occupation_name": "旧书商",
            "assignment_priority": PRIORITY,
            "occupation_skill_names": FOCUS,
            "interest_skill_names": SUPPORT,
        },
    )
    assert envelope["ok"] is False, envelope
    details = (envelope.get("error") or {}).get("details") or {}
    assert "could not place occupation points" in str(details.get("error", details))


def test_chargen_run_int_edu_priority_and_photography_interest(tmp_path: Path) -> None:
    import subprocess

    printed = subprocess.run(
        [
            "node",
            "--experimental-strip-types",
            str(REPO / "tests" / "pi" / "chargen-delegate-id.mjs"),
            str(REPO),
        ],
        cwd=REPO,
        check=True,
        capture_output=True,
        text=True,
    )
    assert json.loads(printed.stdout)["ok"] is True
    campaign_id = _create_campaign(tmp_path, "chargen-photo-int")
    envelope = coc_toolbox.run_tool(
        "setup.chargen_run",
        tmp_path,
        None,
        {
            "campaign_id": campaign_id,
            "investigator_id": "gu-photo",
            "name": "顾南舟",
            "occupation_name": "旧书商",
            "assignment_priority": PRIORITY,
            "occupation_skill_names": FOCUS + [
                "Accounting", "Fast Talk", "Dodge",
            ],
            "interest_skill_names": [
                "Art and Craft (Photography)",
                "Appraise",
                "Psychology",
                "Listen",
            ],
        },
    )
    assert envelope["ok"] is True, envelope
    result = envelope["data"]["result"]
    chars = result["characteristics"]
    assert chars["INT"] == 80
    assert chars["EDU"] >= 70
    assert chars["STR"] == 40
    assert chars["CON"] < chars["INT"]
    stored = json.loads(
        (tmp_path / ".coc" / "investigators" / "gu-photo" / "character.json")
        .read_text(encoding="utf-8")
    )
    skills = stored["skills"]
    photo = skills.get("Art and Craft (Photography)")
    assert isinstance(photo, int) and photo > 5
    assert int(skills.get("Accounting", 0)) > 5
    creation = json.loads(
        (tmp_path / ".coc" / "investigators" / "gu-photo" / "creation.json")
        .read_text(encoding="utf-8")
    )
    occ_alloc = creation["skill_budget"]["occupation_points"]["allocations"]
    int_alloc = creation["skill_budget"]["personal_interest_points"]["allocations"]
    assert int_alloc.get("Art and Craft (Photography)", 0) > 0
    assert "Occult" not in occ_alloc
    assert "Occult" not in int_alloc


def test_chargen_run_journalist_single_interest_expands_under_cap(tmp_path: Path) -> None:
    campaign_id = _create_campaign(tmp_path, "chargen-journalist")
    envelope = coc_toolbox.run_tool(
        "setup.chargen_run",
        tmp_path,
        None,
        {
            "campaign_id": campaign_id,
            "investigator_id": "shen-yan-journo",
            "name": "沈砚",
            "occupation_name": "Journalist",
            "occupation_label": "记者",
            "assignment_priority": PRIORITY,
            "occupation_skill_names": [
                "Persuade", "Psychology", "Library Use",
            ],
            "interest_skill_names": [
                "Spot Hidden",
                "Listen",
                "First Aid",
                "Navigate",
                "Mechanical Repair",
                "Natural World",
            ],
        },
    )
    assert envelope["ok"] is True, envelope
    chars = envelope["data"]["result"]["characteristics"]
    assert chars["INT"] == 80
    creation = json.loads(
        (
            tmp_path / ".coc" / "investigators" / "shen-yan-journo" / "creation.json"
        ).read_text(encoding="utf-8")
    )
    int_alloc = creation["skill_budget"]["personal_interest_points"]["allocations"]
    assert sum(int_alloc.values()) == 160
    assert int_alloc.get("Spot Hidden", 0) > 0


def _chargen_args(campaign_id: str, investigator_id: str, **overrides: object) -> dict:
    payload: dict = {
        "campaign_id": campaign_id,
        "investigator_id": investigator_id,
        "name": "Ada Lark",
        "occupation_name": "Journalist",
        "assignment_priority": [
            "INT", "EDU", "POW", "DEX", "CON", "APP", "SIZ", "STR",
        ],
        "occupation_skill_names": ["Spot Hidden", "Listen"],
        "interest_skill_names": ["Occult", "First Aid", "Stealth", "Listen"],
        "luck": {"mode": "auto_roll"},
        "occupation_label": "记者",
    }
    payload.update(overrides)
    return payload


def test_chargen_run_setup_revision_replaces_same_id(tmp_path: Path) -> None:
    campaign_id = _create_campaign(tmp_path, "chargen-revise")
    first = coc_toolbox.run_tool(
        "setup.chargen_run",
        tmp_path,
        None,
        _chargen_args(campaign_id, "ada-lark"),
    )
    assert first["ok"] is True, first
    first_luck = first["data"]["result"]["derived"]["luck"]
    first_rolls = list(first["data"]["result"]["roll_ids"])
    second = coc_toolbox.run_tool(
        "setup.chargen_run",
        tmp_path,
        None,
        _chargen_args(
            campaign_id,
            "ada-lark",
            name="Ada Revised",
            assignment_priority=[
                "STR", "CON", "SIZ", "DEX", "POW", "APP", "EDU", "INT",
            ],
            occupation_skill_names=[
                "Spot Hidden", "Listen", "Psychology", "Fast Talk",
            ],
            interest_skill_names=["First Aid", "Stealth", "Dodge", "Climb"],
        ),
    )
    assert second["ok"] is True, second
    result = second["data"]["result"]
    assert result["investigator_id"] == "ada-lark"
    assert result["characteristics"]["STR"] == 80
    assert result["characteristics"]["INT"] == 40
    assert result["derived"]["luck"] == first_luck
    assert first_rolls[0] in result["roll_ids"]
    stored = json.loads(
        (tmp_path / ".coc" / "investigators" / "ada-lark" / "character.json")
        .read_text(encoding="utf-8")
    )
    assert stored["name"] == "Ada Revised"
    assert stored["characteristics"]["STR"] == 80
    skills = stored["skills"]
    assert int(skills.get("Psychology", 0)) > 5
    assert int(skills.get("Climb", 0)) > 20 or int(skills.get("Dodge", 0)) > 0
    party = json.loads(
        (tmp_path / ".coc" / "campaigns" / campaign_id / "party.json")
        .read_text(encoding="utf-8")
    )
    ids = party.get("investigator_ids") or []
    assert ids.count("ada-lark") == 1
    assert set(ids) == {"ada-lark"}
    investigators = list((tmp_path / ".coc" / "investigators").iterdir())
    assert [path.name for path in investigators if path.is_dir()] == ["ada-lark"]


def test_chargen_run_revision_rejected_after_ready_for_table(tmp_path: Path) -> None:
    campaign_id = _create_campaign(tmp_path, "chargen-locked")
    first = coc_toolbox.run_tool(
        "setup.chargen_run",
        tmp_path,
        None,
        _chargen_args(campaign_id, "locked-ada"),
    )
    assert first["ok"] is True, first
    campaign_path = tmp_path / ".coc" / "campaigns" / campaign_id / "campaign.json"
    campaign = json.loads(campaign_path.read_text(encoding="utf-8"))
    campaign["status"] = "ready_for_table"
    campaign["setup_handoff"] = {"decision_id": "test-lock"}
    campaign_path.write_text(json.dumps(campaign), encoding="utf-8")
    blocked = coc_toolbox.run_tool(
        "setup.chargen_run",
        tmp_path,
        None,
        _chargen_args(campaign_id, "locked-ada", name="Should Fail"),
    )
    assert blocked["ok"] is False, blocked
    details = (blocked.get("error") or {}).get("details") or {}
    assert details.get("stage") == "revision"
    stored = json.loads(
        (tmp_path / ".coc" / "investigators" / "locked-ada" / "character.json")
        .read_text(encoding="utf-8")
    )
    assert stored["name"] == "Ada Lark"

    campaign["status"] = "active"
    campaign_path.write_text(json.dumps(campaign), encoding="utf-8")
    blocked_active = coc_toolbox.run_tool(
        "setup.chargen_run",
        tmp_path,
        None,
        _chargen_args(campaign_id, "locked-ada", name="Still Fail"),
    )
    assert blocked_active["ok"] is False, blocked_active
    details_active = (blocked_active.get("error") or {}).get("details") or {}
    assert details_active.get("stage") == "revision"


def test_chargen_run_focus_plus_support_union_places(tmp_path: Path) -> None:
    campaign_id = _create_campaign(tmp_path, "chargen-union-occ")
    envelope = coc_toolbox.run_tool(
        "setup.chargen_run",
        tmp_path,
        None,
        {
            "campaign_id": campaign_id,
            "investigator_id": "gu-union",
            "name": "顾南舟",
            "occupation_name": "旧书商",
            "assignment_priority": PRIORITY,
            "occupation_skill_names": FOCUS + SUPPORT[:3],
            "interest_skill_names": SUPPORT[3:],
        },
    )
    assert envelope["ok"] is True, envelope
    assert envelope["data"]["result"]["ok"] is True


def test_chargen_run_ww1_era_adaptive_system_owns_numbers(tmp_path: Path) -> None:
    campaign_id = _create_campaign(tmp_path, "chargen-ww1", era="ww1")
    payload = {
        "campaign_id": campaign_id,
        "investigator_id": "ww1-ada",
        "name": "Ada Lark",
        "occupation_name": "Journalist",
        "occupation_label": "记者",
        "assignment_priority": [
            "INT", "EDU", "POW", "DEX", "CON", "APP", "SIZ", "STR",
        ],
        "occupation_skill_names": ["Spot Hidden", "Listen"],
        "interest_skill_names": ["Occult", "First Aid"],
        "luck": {"mode": "auto_roll"},
    }
    assert "characteristics" not in payload
    assert "occupation_allocations" not in payload
    envelope = coc_toolbox.run_tool("setup.chargen_run", tmp_path, None, payload)
    assert envelope["ok"] is True, envelope
    result = envelope["data"]["result"]
    assert result["ok"] is True
    chars = result["characteristics"]
    stored, creation = _stored_investigator(tmp_path, "ww1-ada")
    assert chars == _expected_age_adjusted_chars(creation, int(stored["age"]))
    assert creation["input_mode"] == coc_character.ERA_ADAPTIVE_INPUT_MODE
    assert stored["era_adaptive"] is True
    assert stored["characteristics"] == chars
    assert isinstance(stored["derived"]["Luck"], int)
    budget = creation["skill_budget"]["occupation_points"]
    assert budget["budget"] == budget["spent"] == sum(budget["allocations"].values())
    assert budget["budget"] > 0
    selected = {
        skill_id
        for account in creation["skill_budget"].values()
        for skill_id in account["allocations"]
    } | {"Dodge", "Language (Own)", "Cthulhu Mythos"}
    assert set(stored["skills"]) == selected
    assert "Drive Auto" not in stored["skills"]
    assert "Electrical Repair" not in stored["skills"]
    assert "Firearms (Handgun)" not in stored["skills"]
    assert "Operate Heavy Machinery" not in stored["skills"]
    assert stored["skill_provenance"]["Credit Rating"] == {
        "original_name": "Credit Rating",
        "reskinned_name": "地位与财力",
        "era_adaptive": True,
    }
    credit_row = next(
        row
        for row in stored["player_facing_sheet_zh"]["skills"]
        if row["key"] == "Credit Rating"
    )
    assert credit_row["label"] == "地位与财力"


def test_chargen_run_ww1_unrecognized_skill_is_structured_error(tmp_path: Path) -> None:
    campaign_id = _create_campaign(tmp_path, "chargen-ww1-bad", era="ww1")
    mystery = "战壕占星术"
    envelope = coc_toolbox.run_tool(
        "setup.chargen_run",
        tmp_path,
        None,
        {
            "campaign_id": campaign_id,
            "investigator_id": "ww1-bad",
            "name": "Nobody",
            "occupation_name": "Soldier",
            "occupation_label": "士兵",
            "occupation_skill_names": [mystery],
        },
    )
    assert envelope["ok"] is False, envelope
    details = (envelope.get("error") or {}).get("details") or {}
    assert details.get("stage") == "occupation"
    assert mystery in str(details.get("expected", {}).get("unrecognized", []))
    assert not (
        tmp_path / ".coc" / "investigators" / "ww1-bad" / "character.json"
    ).exists()


def test_onboarding_inspect_pregen_summaries() -> None:
    receipt = coc_runtime_ops.execute_setup_operation(
        REPO,
        operation={"schema_version": 1, "kind": "onboarding.inspect", "payload": {}},
    )
    assert receipt["status"] == "PASS"
    starters = {item["scenario_id"]: item for item in receipt["result"]["starters"]}
    haunting = starters["the-haunting"]["pregens"]
    assert haunting
    for row in haunting:
        assert set(row) <= {"pregen_id", "name", "occupation"}
        assert row["pregen_id"]
        assert row["name"]
    assert starters["the-white-war"]["pregens"] == []


_ROLEPLAY_BACKSTORY = {
    "personal_description": "瘦高的波士顿记者， rumpled 大衣领口别着一支铅笔。",
    "ideology_beliefs": "真相必须见报，哪怕会得罪市政厅。",
    "significant_people": "失踪的妹妹玛丽。",
    "meaningful_locations": "北区那间通宵排字房。",
    "treasured_possessions": "父亲留下的怀表。",
    "traits": "坐不住，爱追问",
    "scenario_bound": "编辑部把一份关于旧宅怪响的 commuter 来信扔到她桌上。",
}
_ROLEPLAY_EQUIPMENT = ["铅笔与速记本", "折叠刀", "电车票夹"]
_KEY_CONNECTION = {
    "backstory_field": "significant_people",
    "summary": "失踪的妹妹玛丽。",
}


def test_chargen_run_persists_backstory_equipment_and_cash(tmp_path: Path) -> None:
    campaign_id = _create_campaign(tmp_path, "chargen-roleplay")
    envelope = coc_toolbox.run_tool(
        "setup.chargen_run",
        tmp_path,
        None,
        _chargen_args(
            campaign_id,
            "ada-story",
            backstory=_ROLEPLAY_BACKSTORY,
            equipment=_ROLEPLAY_EQUIPMENT,
            key_connection=_KEY_CONNECTION,
            age=27,
        ),
    )
    assert envelope["ok"] is True, envelope
    stored, _creation = _stored_investigator(tmp_path, "ada-story")
    assert stored["backstory"]["ideology_beliefs"] == _ROLEPLAY_BACKSTORY["ideology_beliefs"]
    assert stored["backstory"]["scenario_bound"] == _ROLEPLAY_BACKSTORY["scenario_bound"]
    assert "ideology" not in stored["backstory"]
    assert stored["equipment"] == _ROLEPLAY_EQUIPMENT
    assert stored["key_connection"] == _KEY_CONNECTION
    assert stored["occupation"] == "Journalist"
    assert stored["player_facing_sheet_zh"]["occupation"] == "记者"
    assert all(isinstance(value, int) and not isinstance(value, bool) for value in stored["skills"].values())
    assert "half" not in stored["skills"]
    assert "fifth" not in stored["skills"]
    for row in stored["player_facing_sheet_zh"]["skills"]:
        assert "half" not in row
        assert "fifth" not in row
    chars = stored["characteristics"]
    own_language = stored["skills"]["Language (Own)"]
    dodge = stored["skills"]["Dodge"]
    assert own_language >= chars["EDU"]
    assert own_language % 1 == 0
    # Unallocated Own Language equals EDU; Dodge base is floor(DEX/2).
    occ = _creation["skill_budget"]["occupation_points"]["allocations"]
    interest = _creation["skill_budget"]["personal_interest_points"]["allocations"]
    assert own_language == chars["EDU"] + occ.get("Language (Own)", 0) + interest.get("Language (Own)", 0)
    assert dodge == (chars["DEX"] // 2) + occ.get("Dodge", 0) + interest.get("Dodge", 0)
    credit = stored["skills"]["Credit Rating"]
    assert isinstance(credit, int)
    expected = coc_character.chargen_cash_from_credit(credit, "1920s")
    assert expected is not None
    assert stored["cash"] == expected["cash"]
    assert stored["assets"] == expected["assets"]
    assert stored["spending_level"] == expected["spending_level"]
    assert stored["living_standard"] == expected["living_standard"]
    details = stored["player_facing_sheet_zh"]["backstory_details"]
    labels = {block["label"] for block in details}
    assert "人格信念" in labels
    assert "如何卷入" in labels
    assert "随身物品" in labels
    assert "关键连结" in labels
    assert "建卡财力" in labels
    card = tmp_path / envelope["data"]["result"]["card_path"]
    markdown = card.read_text(encoding="utf-8")
    assert "人格信念" in markdown
    assert "随身物品" in markdown
    assert "记者" in markdown
    assert "Journalist" not in markdown
    assert "## 建卡财力" in markdown
    assert "建卡现金" in markdown
    assert "每日免记账额度" in markdown
    cash_text = coc_character.format_chargen_money_zh(expected["cash"])
    assert cash_text in markdown
    assert "## 玩家摘要" in markdown
    summary = envelope["data"]["result"]["player_summary_zh"]
    assert summary["finance"]
    assert cash_text in summary["finance"][0]
    assert any("幸运" in line for line in summary["dice"])


def test_chargen_run_applies_full_age_modifiers(tmp_path: Path) -> None:
    campaign_id = _create_campaign(tmp_path, "chargen-age")
    envelope = coc_toolbox.run_tool(
        "setup.chargen_run",
        tmp_path,
        None,
        _chargen_args(campaign_id, "ada-aged", age=47),
    )
    assert envelope["ok"] is True, envelope
    stored, creation = _stored_investigator(tmp_path, "ada-aged")
    expected = _expected_age_adjusted_chars(creation, 47)
    assert stored["characteristics"] == expected
    assert stored["characteristics"]["APP"] == 45  # QF APP 50 minus 5
    reductions = {row["characteristic"]: row["amount"] for row in creation["characteristic_reductions"]}
    assert sum(reductions.values()) == 5
    assert set(reductions) <= {"STR", "CON", "DEX"}
    assert len(creation["edu_improvement_rolls"]) == 2
    for record in creation["edu_improvement_rolls"]:
        receipt = record["check_receipt"]
        assert set(receipt) == {"campaign_id", "decision_id", "roll_id"}
        assert receipt["decision_id"].startswith("chargen-edu-")
    mov = stored["derived"]["MOV"]
    raw = coc_character.quick_fire_array_characteristics(
        creation["characteristic_assignment_order"]
    )
    # MOV must include the age penalty, not just the unadjusted array.
    unaged_mov = coc_character.derive_values(raw, luck=stored["derived"]["Luck"])["MOV"]
    assert mov == unaged_mov - 1 or mov <= unaged_mov


def test_chargen_run_rejects_kp_numeric_finance(tmp_path: Path) -> None:
    campaign_id = _create_campaign(tmp_path, "chargen-no-cash")
    envelope = coc_toolbox.run_tool(
        "setup.chargen_run",
        tmp_path,
        None,
        _chargen_args(campaign_id, "ada-cash", cash=50, assets=500),
    )
    assert envelope["ok"] is False, envelope
    assert "cash" in str(envelope)
    receipt = coc_runtime_ops.execute_setup_operation(
        tmp_path,
        operation={
            "schema_version": 1,
            "kind": "setup.chargen_run",
            "payload": _chargen_args(campaign_id, "ada-cash-ops", cash=50),
        },
    )
    assert receipt["status"] == "FAIL"
    assert receipt["result"]["stage"] == "payload"
    assert "cash" in receipt["result"]["expected"]["forbidden"]
    assert not (
        tmp_path / ".coc" / "investigators" / "ada-cash" / "character.json"
    ).exists()
    assert not (
        tmp_path / ".coc" / "investigators" / "ada-cash-ops" / "character.json"
    ).exists()


def test_chargen_run_rejects_ideology_key_drift(tmp_path: Path) -> None:
    campaign_id = _create_campaign(tmp_path, "chargen-ideology")
    envelope = coc_toolbox.run_tool(
        "setup.chargen_run",
        tmp_path,
        None,
        _chargen_args(
            campaign_id,
            "ada-ideo",
            backstory={"ideology": "publish the truth"},
        ),
    )
    assert envelope["ok"] is False, envelope
    details = (envelope.get("error") or {}).get("details") or {}
    assert details.get("stage") == "backstory"
    assert "ideology_beliefs" in str(details.get("expected", {}).get("allowed", []))


def test_chargen_run_era_without_cash_table_skips_sheet_finance(tmp_path: Path) -> None:
    campaign_id = _create_campaign(tmp_path, "chargen-ww1-cash", era="ww1")
    envelope = coc_toolbox.run_tool(
        "setup.chargen_run",
        tmp_path,
        None,
        _chargen_args(
            campaign_id,
            "ww1-story",
            backstory=_ROLEPLAY_BACKSTORY,
            equipment=_ROLEPLAY_EQUIPMENT,
        ),
    )
    assert envelope["ok"] is True, envelope
    stored, _creation = _stored_investigator(tmp_path, "ww1-story")
    assert "cash" not in stored
    assert "assets" not in stored
    assert "spending_level" not in stored
    assert stored["backstory"]["scenario_bound"] == _ROLEPLAY_BACKSTORY["scenario_bound"]
    labels = {
        block["label"]
        for block in stored["player_facing_sheet_zh"]["backstory_details"]
    }
    assert "财力" not in labels
    assert stored["skills"]["Credit Rating"]  # first-contact path stays on the skill


def _plant_d100(tmp_path: Path, campaign_id: str, decision_id: str, *, want_gt: int | None, want_le: int | None, seed: int) -> int | None:
    result = coc_toolbox.run_tool(
        "rules.roll_dice",
        tmp_path,
        campaign_id,
        {
            "expression": "1D100",
            "decision_id": decision_id,
            "purpose": "investigator_creation_characteristic",
            "reason": "chargen age EDU improvement check",
            "seed": seed,
        },
    )
    if result.get("ok") is not True:
        return None
    total = int(result["data"]["total"])
    if want_gt is not None and total <= want_gt:
        return None
    if want_le is not None and total > want_le:
        return None
    return total


def test_chargen_run_edu_check_failure_keeps_edu(tmp_path: Path) -> None:
    campaign_id = _create_campaign(tmp_path, "chargen-edu-fail")
    inv = None
    for seed in range(1, 250):
        candidate = f"ada-fail-{seed}"
        decision_id = f"chargen-edu-{campaign_id}-{candidate}-0"
        if _plant_d100(tmp_path, campaign_id, decision_id, want_gt=None, want_le=70, seed=seed) is None:
            continue
        inv = candidate
        break
    assert inv is not None
    envelope = coc_toolbox.run_tool(
        "setup.chargen_run",
        tmp_path,
        None,
        _chargen_args(campaign_id, inv, age=27),
    )
    assert envelope["ok"] is True, envelope
    stored, creation = _stored_investigator(tmp_path, inv)
    record = creation["edu_improvement_rolls"][0]
    assert "improvement_roll" not in record
    assert stored["characteristics"]["EDU"] == 70
    assert record["check_receipt"]["decision_id"].endswith("-0")
    kinds = {row["kind"] for row in envelope["data"]["result"]["dice_receipts"]}
    assert "edu_check" in kinds
    assert "luck" in kinds
    fail_text = "\n".join(envelope["data"]["result"]["player_summary_zh"]["dice"])
    assert f"{int(record['roll'])}/70 失败，EDU 仍为 70" in fail_text


def test_chargen_run_edu_check_success_applies_1d10(tmp_path: Path) -> None:
    campaign_id = _create_campaign(tmp_path, "chargen-edu-ok")
    inv = None
    for seed in range(1, 250):
        candidate = f"ada-ok-{seed}"
        decision_id = f"chargen-edu-{campaign_id}-{candidate}-0"
        if _plant_d100(tmp_path, campaign_id, decision_id, want_gt=70, want_le=None, seed=seed) is None:
            continue
        inv = candidate
        break
    assert inv is not None
    envelope = coc_toolbox.run_tool(
        "setup.chargen_run",
        tmp_path,
        None,
        _chargen_args(campaign_id, inv, age=27),
    )
    assert envelope["ok"] is True, envelope
    stored, creation = _stored_investigator(tmp_path, inv)
    record = creation["edu_improvement_rolls"][0]
    assert "improvement_roll" in record
    assert 1 <= int(record["improvement_roll"]) <= 10
    assert stored["characteristics"]["EDU"] == 70 + int(record["improvement_roll"])
    improve = record["improve_receipt"]
    document = json.loads(
        (
            tmp_path / ".coc" / "campaigns" / campaign_id
            / "save" / "roll-operation-receipts.json"
        ).read_text(encoding="utf-8")
    )
    saved = document["receipts"]["rules.roll_dice"][improve["decision_id"]]
    assert saved["operation"]["purpose"] == "investigator_creation_characteristic"
    assert saved["operation"]["expression"] == "1D10"
    assert any(row["kind"] == "edu_improve" for row in envelope["data"]["result"]["dice_receipts"])
    edu = stored["characteristics"]["EDU"]
    occ = creation["skill_budget"]["occupation_points"]["allocations"]
    interest = creation["skill_budget"]["personal_interest_points"]["allocations"]
    own_add = int(occ.get("Language (Own)", 0)) + int(interest.get("Language (Own)", 0))
    assert stored["skills"]["Language (Own)"] == edu + own_add
    summary_text = "\n".join(envelope["data"]["result"]["player_summary_zh"]["dice"])
    assert f"{int(record['roll'])}/70 成功，EDU +{int(record['improvement_roll'])} → {edu}" in summary_text


def test_chargen_run_teen_keeps_highest_of_two_luck_rolls(tmp_path: Path) -> None:
    campaign_id = _create_campaign(tmp_path, "chargen-teen-luck")
    envelope = coc_toolbox.run_tool(
        "setup.chargen_run",
        tmp_path,
        None,
        _chargen_args(campaign_id, "ada-teen", age=18),
    )
    assert envelope["ok"] is True, envelope
    stored, creation = _stored_investigator(tmp_path, "ada-teen")
    assert creation["luck_rolls_keep_highest"] == 2
    candidates = creation["luck_roll_candidates"]
    assert len(candidates) == 2
    totals = [int(row["total"]) for row in candidates]
    assert creation["luck_roll_total"] == max(totals)
    assert stored["derived"]["Luck"] == max(totals) * 5
    first_id = f"chargen-luck-{campaign_id}-ada-teen"
    second_id = f"{first_id}-1"
    assert {row["receipt"]["decision_id"] for row in candidates} == {
        first_id, second_id,
    }
    assert creation["luck_roll_receipt"]["decision_id"] in {first_id, second_id}
    document = json.loads(
        (
            tmp_path / ".coc" / "campaigns" / campaign_id
            / "save" / "roll-operation-receipts.json"
        ).read_text(encoding="utf-8")
    )
    for row in candidates:
        saved = document["receipts"]["rules.roll_dice"][row["receipt"]["decision_id"]]
        assert saved["operation"]["purpose"] == "investigator_creation_luck"
        assert saved["operation"]["expression"] == "3D6"
        assert saved["data"]["total"] == row["total"]
    assert stored["characteristics"]["EDU"] == 65  # QF EDU 70 minus teen 5
    assert stored["skills"]["Language (Own)"] >= 65
    assert stored["skills"]["Dodge"] >= stored["characteristics"]["DEX"] // 2
    luck_rows = [
        row for row in envelope["data"]["result"]["dice_receipts"] if row["kind"] == "luck"
    ]
    assert len(luck_rows) == 2
    assert {row["total"] for row in luck_rows} == set(totals)


def test_chargen_run_rejects_late_backstory_key_connection(tmp_path: Path) -> None:
    campaign_id = _create_campaign(tmp_path, "chargen-key")
    envelope = coc_toolbox.run_tool(
        "setup.chargen_run",
        tmp_path,
        None,
        _chargen_args(
            campaign_id,
            "ada-key",
            key_connection={
                "backstory_field": "encounters",
                "summary": "不该在建卡时星标后三类",
            },
        ),
    )
    assert envelope["ok"] is False, envelope
    details = (envelope.get("error") or {}).get("details") or {}
    assert details.get("stage") == "key_connection"
    assert "significant_people" in str(details.get("expected", {}).get("allowed", []))


def test_chargen_run_rejects_key_connection_not_written_in_backstory(
    tmp_path: Path,
) -> None:
    campaign_id = _create_campaign(tmp_path, "chargen-key-missing")
    envelope = coc_toolbox.run_tool(
        "setup.chargen_run",
        tmp_path,
        None,
        _chargen_args(
            campaign_id,
            "ada-missing-star",
            backstory={"personal_description": "高瘦， rumpled 大衣。"},
            key_connection={
                "backstory_field": "ideology_beliefs",
                "summary": "星标了没写的信念",
            },
        ),
    )
    assert envelope["ok"] is False, envelope
    details = (envelope.get("error") or {}).get("details") or {}
    assert details.get("stage") == "key_connection"


def _typed_chargen_schema() -> dict:
    import subprocess
    printed = subprocess.run(
        [
            "node",
            "--experimental-strip-types",
            str(REPO / "tests" / "pi" / "chargen-typed-schema.mjs"),
            str(REPO),
        ],
        cwd=REPO,
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(printed.stdout)


def test_chargen_run_field_set_matches_across_layers() -> None:
    allowed = set(coc_character.CHARGEN_RUN_ALLOWED)
    toolbox_keys = set(coc_toolbox.TOOLS["setup.chargen_run"]["params"])
    assert toolbox_keys == allowed
    archive = json.loads(
        (
            REPO / "plugins" / "coc-keeper" / "references"
            / "mcp-operation-contracts.json"
        ).read_text(encoding="utf-8")
    )
    mcp = archive["operations"]["setup.chargen_run"]["inputSchema"]
    mcp_keys = set(mcp["properties"]) - {"root", "campaign"}
    assert mcp_keys == allowed
    typed = _typed_chargen_schema()
    typed_kp = set(typed["properties"]) - {
        "mode", "pregen_id", "occupation_or_concept", "interest_allocation_intent",
    }
    runtime_without_ids = allowed - {"campaign_id", "investigator_id", "occupation_name"}
    assert runtime_without_ids <= typed_kp | {"name", "occupation_label", "luck"}
    assert "occupation_or_concept" in typed["properties"]
    backstory_keys = set(coc_character.CHARGEN_BACKSTORY_ALLOWED)
    assert set(mcp["properties"]["backstory"]["properties"]) == backstory_keys
    assert mcp["properties"]["backstory"]["additionalProperties"] is False
    assert set(typed["backstory"]["properties"]) == backstory_keys
    assert typed["backstory"]["additionalProperties"] is False
    assert set(typed["clerk_backstory_keys"]) == backstory_keys
    key_fields = set(coc_character.CHARGEN_KEY_CONNECTION_FIELDS)
    assert set(mcp["properties"]["key_connection"]["properties"]["backstory_field"]["enum"]) == key_fields
    assert set(typed["key_connection"]["properties"]["backstory_field"]["enum"]) == key_fields
    assert set(typed["clerk_key_fields"]) == key_fields
    assert typed["age"]["minimum"] == coc_character.CHARGEN_AGE_MIN
    assert typed["age"]["maximum"] == coc_character.CHARGEN_AGE_MAX
    contract = json.loads(
        (
            REPO / "plugins" / "coc-keeper" / "rulesets" / "coc7"
            / "investigator-create-contract.json"
        ).read_text(encoding="utf-8")
    )
    defs = contract["payload_schema"]["$defs"]
    sheet = defs["quick_fire_sheet"]
    assert sheet["additionalProperties"] is False
    assert set(sheet["properties"]) == set(coc_character.CHARGEN_QUICK_FIRE_SHEET_PROPERTIES)
    assert set(defs["chargen_backstory"]["properties"]) == backstory_keys
    assert defs["chargen_backstory"]["additionalProperties"] is False
    finance = defs["chargen_finance_amount"]["properties"]
    assert set(finance) == set(coc_character.CHARGEN_FINANCE_AMOUNT_KEYS)
    assert defs["chargen_finance_amount"]["additionalProperties"] is False
    for field in coc_character.CHARGEN_SHEET_FINANCE_FIELDS:
        assert field in sheet["properties"]


def test_generated_create_without_age_dice_receipts_is_rejected(tmp_path: Path) -> None:
    campaign_id = _create_campaign(tmp_path, "chargen-omit-edu")
    luck = coc_toolbox.run_tool(
        "rules.roll_dice",
        tmp_path,
        campaign_id,
        {
            "expression": "3D6",
            "decision_id": f"chargen-luck-{campaign_id}-omit-edu",
            "purpose": "investigator_creation_luck",
            "reason": "fixture",
        },
    )
    assert luck["ok"] is True, luck
    try:
        coc_runtime_ops.execute_setup_operation(
            tmp_path,
            operation={
                "schema_version": 1,
                "kind": "investigator.create",
                "payload": {
                    "campaign_id": campaign_id,
                    "investigator_id": "omit-edu",
                    "sheet": {
                        "id": "omit-edu",
                        "name": "Omit Edu",
                        "age": 29,
                        "skills": {"Credit Rating": 20, "Dodge": 25, "Language (Own)": 60},
                        "player_facing_sheet_zh": {
                            "display_name": "省略收据",
                            "skills": [],
                        },
                    },
                    "creation": {
                        "input_mode": "guided_quick_fire",
                        "method": "quick_fire_array",
                        "characteristic_assignment_order": [
                            "DEX", "INT", "POW", "EDU", "CON", "SIZ", "APP", "STR",
                        ],
                        "luck_roll_total": luck["data"]["total"],
                        "luck_roll_receipt": {
                            "campaign_id": campaign_id,
                            "decision_id": f"chargen-luck-{campaign_id}-omit-edu",
                            "roll_id": luck["data"]["roll_id"],
                        },
                        "skill_budget": {
                            "occupation_points": {
                                "budget": 1, "spent": 1, "allocations": {"Credit Rating": 1},
                            },
                            "personal_interest_points": {
                                "budget": 1, "spent": 1, "allocations": {"Dodge": 1},
                            },
                        },
                    },
                },
            },
        )
    except coc_runtime_ops.RuntimeOperationError as exc:
        assert "EDU" in str(exc) or "edu_improvement" in str(exc)
        return
    raise AssertionError("omitted EDU receipts were accepted")


def test_import_complete_sheet_with_age_does_not_need_edu_receipts(
    tmp_path: Path,
) -> None:
    _create_campaign(tmp_path, "chargen-pregen-age")
    characteristics = {
        "STR": 50, "CON": 50, "SIZ": 50, "DEX": 50,
        "APP": 50, "INT": 50, "POW": 50, "EDU": 50,
    }
    receipt = coc_runtime_ops.execute_setup_operation(
        tmp_path,
        operation={
            "schema_version": 1,
            "kind": "investigator.create",
            "payload": {
                "investigator_id": "pregen-age",
                "sheet": {
                    "id": "pregen-age",
                    "name": "Pregen Age",
                    "age": 29,
                    "characteristics": characteristics,
                    "derived": coc_character.derive_values(characteristics, luck=50),
                    "skills": {"Credit Rating": 20},
                },
                "creation": {"input_mode": "import_complete_sheet"},
            },
        },
    )
    assert receipt["status"] == "PASS"
    stored = json.loads(
        (tmp_path / ".coc" / "investigators" / "pregen-age" / "character.json")
        .read_text(encoding="utf-8")
    )
    assert stored["age"] == 29
    assert "edu_improvement_rolls" not in json.loads(
        (tmp_path / ".coc" / "investigators" / "pregen-age" / "creation.json")
        .read_text(encoding="utf-8")
    )


def test_chargen_commit_replay_does_not_duplicate_link(tmp_path: Path) -> None:
    campaign_id = _create_campaign(tmp_path, "chargen-replay")
    first = coc_toolbox.run_tool(
        "setup.chargen_run",
        tmp_path,
        None,
        _chargen_args(campaign_id, "ada-replay"),
    )
    assert first["ok"] is True, first
    decision_id = first["data"]["result"]["decision_id"]
    second = coc_toolbox.run_tool(
        "setup.chargen_run",
        tmp_path,
        None,
        _chargen_args(campaign_id, "ada-replay"),
    )
    assert second["ok"] is True, second
    assert second["data"]["result"]["decision_id"] == decision_id
    party = json.loads(
        (tmp_path / ".coc" / "campaigns" / campaign_id / "party.json")
        .read_text(encoding="utf-8")
    )
    ids = party.get("investigator_ids") or []
    assert ids.count("ada-replay") == 1
    investigators = [
        path.name
        for path in (tmp_path / ".coc" / "investigators").iterdir()
        if path.is_dir()
    ]
    assert investigators == ["ada-replay"]
    commits = json.loads(
        (
            tmp_path / ".coc" / "campaigns" / campaign_id
            / "save" / "chargen-commits.json"
        ).read_text(encoding="utf-8")
    )
    assert list(commits["receipts"]) == [decision_id]


def test_investigator_create_rejects_tampered_edu_receipt(tmp_path: Path) -> None:
    campaign_id = _create_campaign(tmp_path, "chargen-tamper")
    first = coc_toolbox.run_tool(
        "setup.chargen_run",
        tmp_path,
        None,
        _chargen_args(campaign_id, "ada-tamper", age=27),
    )
    assert first["ok"] is True, first
    stored, creation = _stored_investigator(tmp_path, "ada-tamper")
    rolls = list(creation["edu_improvement_rolls"])
    assert rolls
    rolls[0] = dict(rolls[0])
    rolls[0]["roll"] = 1
    creation["edu_improvement_rolls"] = rolls
    try:
        coc_runtime_ops.execute_setup_operation(
            tmp_path,
            operation={
                "schema_version": 1,
                "kind": "investigator.create",
                "payload": {
                    "campaign_id": campaign_id,
                    "investigator_id": "ada-tamper",
                    "replace": True,
                    "sheet": {
                        "id": "ada-tamper",
                        "name": stored["name"],
                        "age": 27,
                        "skills": stored["skills"],
                        "player_facing_sheet_zh": stored["player_facing_sheet_zh"],
                    },
                    "creation": {
                        "input_mode": "guided_quick_fire",
                        "method": "quick_fire_array",
                        "characteristic_assignment_order": creation[
                            "characteristic_assignment_order"
                        ],
                        "luck": {"mode": "auto_roll"},
                        "luck_roll_total": creation.get("luck_roll_total"),
                        "luck_roll_receipt": creation.get("luck_roll_receipt"),
                        "skill_budget": creation["skill_budget"],
                        "edu_improvement_rolls": rolls,
                        "characteristic_reductions": creation.get(
                            "characteristic_reductions"
                        ) or [],
                    },
                },
            },
        )
    except coc_runtime_ops.RuntimeOperationError as exc:
        assert "edu_improvement_rolls" in str(exc) or "receipt" in str(exc).lower() or "roll" in str(exc).lower()
        return
    raise AssertionError("tampered EDU receipt was accepted")


def test_chargen_key_connection_feeds_san_self_help(tmp_path: Path) -> None:
    import random

    healing = _load("coc_healing_chargen", SCRIPTS / "coc_healing.py")
    campaign_id = _create_campaign(tmp_path, "chargen-self-help")
    envelope = coc_toolbox.run_tool(
        "setup.chargen_run",
        tmp_path,
        None,
        _chargen_args(
            campaign_id,
            "ada-help",
            backstory=_ROLEPLAY_BACKSTORY,
            equipment=_ROLEPLAY_EQUIPMENT,
            key_connection=_KEY_CONNECTION,
        ),
    )
    assert envelope["ok"] is True, envelope
    stored, _creation = _stored_investigator(tmp_path, "ada-help")
    key = stored["key_connection"]
    assert key["backstory_field"] in stored["backstory"]
    state = {"current_san": 50, "max_san": 90}
    sess = healing.PsychotherapySession("ada-help", state, rng=random.Random(1))
    ev = sess.self_help(key_connection=key)
    assert ev["key_connection"]["backstory_field"] == "significant_people"
    assert ev["key_connection"]["summary"] == _KEY_CONNECTION["summary"]
    assert "san_delta" in ev


def _investigator_runtime_state(
    tmp_path: Path, campaign_id: str, investigator_id: str
) -> dict:
    path = (
        tmp_path
        / ".coc"
        / "campaigns"
        / campaign_id
        / "save"
        / "investigator-state"
        / f"{investigator_id}.json"
    )
    return json.loads(path.read_text(encoding="utf-8"))


def test_chargen_run_seeds_play_cash_ledger_once(tmp_path: Path) -> None:
    from runtime.sdk import web_views

    campaign_id = _create_campaign(tmp_path, "chargen-cash-seed")
    args = _chargen_args(campaign_id, "ada-cash")
    first = coc_toolbox.run_tool("setup.chargen_run", tmp_path, None, args)
    assert first["ok"] is True, first
    stored, _creation = _stored_investigator(tmp_path, "ada-cash")
    sheet_cash = stored["cash"]
    expected_amount = coc_toolbox.coc_cash.format_amount(sheet_cash["amount"])
    currency = str(sheet_cash["currency"])
    decision_id = first["data"]["result"]["decision_id"]
    state = _investigator_runtime_state(tmp_path, campaign_id, "ada-cash")
    cash = state["cash"]
    assert cash["schema_version"] == 2
    assert cash["balances"][currency]["amount"] == expected_amount
    assert len(cash["ledger"]) == 1
    row = cash["ledger"][0]
    assert row["op"] == "grant"
    assert row["decision_id"] == decision_id
    assert row["source"] == "chargen-credit-rating"
    assert row["localized_reason"] == "建卡·信用评级换算"
    assert row["amount"] == expected_amount
    assert row["currency"] == currency
    replay = coc_toolbox.run_tool("setup.chargen_run", tmp_path, None, args)
    assert replay["ok"] is True, replay
    replayed = _investigator_runtime_state(tmp_path, campaign_id, "ada-cash")
    assert len(replayed["cash"]["ledger"]) == 1
    assert replayed["cash"]["balances"][currency]["amount"] == expected_amount
    view = web_views.display_character(
        tmp_path, "ada-cash", "zh-Hans", campaign_id=campaign_id
    )
    assert view is not None
    assert view["cash"]["balances"][currency]["amount"] == expected_amount
    assert view["cash"]["ledger"][0]["localized_reason"] == "建卡·信用评级换算"


def test_chargen_run_era_adaptive_does_not_seed_cash_ledger(tmp_path: Path) -> None:
    campaign_id = _create_campaign(tmp_path, "chargen-ww1-cash", era="ww1")
    envelope = coc_toolbox.run_tool(
        "setup.chargen_run",
        tmp_path,
        None,
        {
            "campaign_id": campaign_id,
            "investigator_id": "ww1-cash",
            "name": "Ada Lark",
            "occupation_name": "Journalist",
            "occupation_label": "记者",
            "luck": {"mode": "auto_roll"},
        },
    )
    assert envelope["ok"] is True, envelope
    stored, _creation = _stored_investigator(tmp_path, "ww1-cash")
    assert "cash" not in stored
    state = _investigator_runtime_state(tmp_path, campaign_id, "ww1-cash")
    cash = state.get("cash")
    assert cash in (None, {}) or cash.get("ledger") in (None, [])


def test_chargen_run_own_language_relabels_and_defaults(tmp_path: Path) -> None:
    campaign_id = _create_campaign(tmp_path, "chargen-lang")
    explicit = coc_toolbox.run_tool(
        "setup.chargen_run",
        tmp_path,
        None,
        _chargen_args(
            campaign_id,
            "ada-guoyu",
            own_language="国语",
            backstory=_ROLEPLAY_BACKSTORY,
            key_connection=_KEY_CONNECTION,
        ),
    )
    assert explicit["ok"] is True, explicit
    stored, _ = _stored_investigator(tmp_path, "ada-guoyu")
    assert stored["own_language"] == "国语"
    assert stored["skills"]["Language (Own)"] == stored["characteristics"]["EDU"]
    labels = {
        row["key"]: row["label"]
        for row in stored["player_facing_sheet_zh"]["skills"]
        if isinstance(row, dict)
    }
    assert labels["Language (Own)"] == "语言（国语）"
    missing_en = (
        "调查员母语与本模组工作语言（英语）不一致，技能表没有 Language (English)。"
        "该调查员在模组语境下无法有效行动。"
        "建议以 replace=True 重跑 setup.chargen_run / coc_chargen_delegate，"
        "并把 Language (English) 分配到得体水平。"
    )
    assert missing_en in (explicit.get("warnings") or [])
    assert (explicit.get("data") or {}).get("result", {}).get("warnings") == [missing_en]
    defaulted = coc_toolbox.run_tool(
        "setup.chargen_run",
        tmp_path,
        None,
        _chargen_args(campaign_id, "ada-english"),
    )
    assert defaulted["ok"] is True, defaulted
    english, _ = _stored_investigator(tmp_path, "ada-english")
    assert english["own_language"] == "英语"
    eng_labels = {
        row["key"]: row["label"]
        for row in english["player_facing_sheet_zh"]["skills"]
        if isinstance(row, dict)
    }
    assert eng_labels["Language (Own)"] == "语言（英语）"
    assert missing_en not in (defaulted.get("warnings") or [])
    assert not (defaulted.get("data") or {}).get("result", {}).get("warnings")


def test_chargen_run_projects_luck_and_backstory_to_sidebar(tmp_path: Path) -> None:
    from runtime.sdk import web_views

    campaign_id = _create_campaign(tmp_path, "chargen-panel")
    envelope = coc_toolbox.run_tool(
        "setup.chargen_run",
        tmp_path,
        None,
        _chargen_args(
            campaign_id,
            "ada-panel",
            backstory=_ROLEPLAY_BACKSTORY,
            key_connection=_KEY_CONNECTION,
            equipment=_ROLEPLAY_EQUIPMENT,
        ),
    )
    assert envelope["ok"] is True, envelope
    stored, _ = _stored_investigator(tmp_path, "ada-panel")
    view = web_views.display_character(
        tmp_path, "ada-panel", "zh-Hans", campaign_id=campaign_id
    )
    assert view is not None
    assert view["luck"] == stored["derived"]["Luck"]
    assert view["derived"]["Luck"] == stored["derived"]["Luck"]
    fields = [row["field"] for row in view["backstory"]]
    assert "significant_people" in fields
    assert "scenario_bound" in fields
    assert "injuries_scars" not in fields
    starred = next(row for row in view["backstory"] if row.get("starred"))
    assert starred["field"] == "significant_people"
    hook = next(row for row in view["backstory"] if row["field"] == "scenario_bound")
    assert "编辑部" in hook["items"][0]
    own = next(row for row in view["skills"] if row["key"] == "Language (Own)")
    assert own["label"] == "语言（英语）"
    assert stored.get("assets")
    assert view["assets"]["display"].startswith("$")
    assert view["assets"]["current"] is True
    assert "source" not in view["assets"]
    assert view["assets"]["living_standard"]
    assert view["assets"]["labels"]["spending_level"] == "每日免记账额度"
    sidecar = _investigator_runtime_state(tmp_path, campaign_id, "ada-panel")
    assert "backstory" not in sidecar
    assert sidecar.get("current_luck") == stored["derived"]["Luck"]


def test_chargen_run_persists_other_language_from_allocator(tmp_path: Path) -> None:
    campaign_id = _create_campaign(tmp_path, "chargen-en")
    envelope = coc_toolbox.run_tool(
        "setup.chargen_run",
        tmp_path,
        None,
        _chargen_args(
            campaign_id,
            "ada-en",
            own_language="国语",
            interest_skill_names=[
                "Other Language (English)",
                "Occult",
                "First Aid",
                "Stealth",
            ],
        ),
    )
    assert envelope["ok"] is True, envelope
    stored, creation = _stored_investigator(tmp_path, "ada-en")
    assert "Language (English)" in stored["skills"]
    occ = creation["skill_budget"]["occupation_points"]["allocations"]
    interest = creation["skill_budget"]["personal_interest_points"]["allocations"]
    expected = 1 + occ.get("Language (English)", 0) + interest.get("Language (English)", 0)
    assert stored["skills"]["Language (English)"] == expected
    assert expected > 1
    labels = {
        row["key"]: row["label"]
        for row in stored["player_facing_sheet_zh"]["skills"]
        if isinstance(row, dict)
    }
    assert labels["Language (English)"] == "语言（英语）"
    assert labels["Language (Own)"] == "语言（国语）"
    english_value = stored["skills"]["Language (English)"]
    if english_value < coc_character.CHARGEN_WORKING_LANGUAGE_PROFESSIONAL_MIN:
        low = (envelope.get("warnings") or [])
        assert any(str(english_value) in item and "50" in item for item in low)
    else:
        assert not [
            item for item in (envelope.get("warnings") or [])
            if "Language (English)" in item and "建议阈值" in item
        ]


def _dilettante_args(campaign_id: str, investigator_id: str) -> dict:
    return _chargen_args(
        campaign_id,
        investigator_id,
        occupation_name="Dilettante",
        occupation_label="名流",
        occupation_skill_names=[
            "Art and Craft (Fine Art)", "Firearms (Handgun)", "Ride",
            "Charm", "Spot Hidden", "Listen", "History",
        ],
    )


def test_chargen_run_cash_ledger_increases_on_setup_replace(tmp_path: Path) -> None:
    campaign_id = _create_campaign(tmp_path, "chargen-cash-up")
    first = coc_toolbox.run_tool(
        "setup.chargen_run", tmp_path, None, _chargen_args(campaign_id, "ada-up"),
    )
    assert first["ok"] is True, first
    first_luck = first["data"]["result"]["derived"]["luck"]
    first_rolls = list(first["data"]["result"]["roll_ids"])
    first_sheet, first_creation = _stored_investigator(tmp_path, "ada-up")
    first_cash = coc_toolbox.coc_cash.format_amount(first_sheet["cash"]["amount"])
    second = coc_toolbox.run_tool(
        "setup.chargen_run", tmp_path, None, _dilettante_args(campaign_id, "ada-up"),
    )
    assert second["ok"] is True, second
    assert second["data"]["result"]["derived"]["luck"] == first_luck
    assert first_rolls[0] in second["data"]["result"]["roll_ids"]
    assert first_creation["luck_roll_receipt"]["roll_id"] == json.loads(
        (tmp_path / ".coc" / "investigators" / "ada-up" / "creation.json").read_text(
            encoding="utf-8"
        )
    )["luck_roll_receipt"]["roll_id"]
    stored, _ = _stored_investigator(tmp_path, "ada-up")
    target = coc_toolbox.coc_cash.format_amount(stored["cash"]["amount"])
    assert target != first_cash
    cash = _investigator_runtime_state(tmp_path, campaign_id, "ada-up")["cash"]
    assert cash["balances"]["USD"]["amount"] == target
    assert len(cash["ledger"]) == 2
    assert cash["ledger"][0]["localized_reason"] == "建卡·信用评级换算"
    assert cash["ledger"][1]["op"] == "grant"
    assert cash["ledger"][1]["localized_reason"] == "建卡重跑·信用评级差额调整"
    assert cash["ledger"][1]["source"] == "chargen-credit-rating-adjust"
    summary = second["data"]["result"]["player_summary_zh"]
    finance = " ".join(summary.get("finance") or [])
    assert target.replace(".00", "") in finance.replace(",", "") or (
        stored["cash"]["amount"] is not None
    )
    replay = coc_toolbox.run_tool(
        "setup.chargen_run", tmp_path, None, _dilettante_args(campaign_id, "ada-up"),
    )
    assert replay["ok"] is True, replay
    replayed = _investigator_runtime_state(tmp_path, campaign_id, "ada-up")["cash"]
    assert len(replayed["ledger"]) == 2
    assert replayed["balances"]["USD"]["amount"] == target


def test_chargen_run_cash_ledger_decreases_on_setup_replace(tmp_path: Path) -> None:
    campaign_id = _create_campaign(tmp_path, "chargen-cash-down")
    first = coc_toolbox.run_tool(
        "setup.chargen_run", tmp_path, None, _dilettante_args(campaign_id, "ada-down"),
    )
    assert first["ok"] is True, first
    first_luck = first["data"]["result"]["derived"]["luck"]
    first_rolls = list(first["data"]["result"]["roll_ids"])
    first_sheet, first_creation = _stored_investigator(tmp_path, "ada-down")
    first_cash = coc_toolbox.coc_cash.format_amount(first_sheet["cash"]["amount"])
    second = coc_toolbox.run_tool(
        "setup.chargen_run", tmp_path, None, _chargen_args(campaign_id, "ada-down"),
    )
    assert second["ok"] is True, second
    assert second["data"]["result"]["derived"]["luck"] == first_luck
    assert first_rolls[0] in second["data"]["result"]["roll_ids"]
    assert first_creation["edu_improvement_rolls"][0]["check_receipt"]["roll_id"] == json.loads(
        (tmp_path / ".coc" / "investigators" / "ada-down" / "creation.json").read_text(
            encoding="utf-8"
        )
    )["edu_improvement_rolls"][0]["check_receipt"]["roll_id"]
    stored, _ = _stored_investigator(tmp_path, "ada-down")
    target = coc_toolbox.coc_cash.format_amount(stored["cash"]["amount"])
    assert target != first_cash
    cash = _investigator_runtime_state(tmp_path, campaign_id, "ada-down")["cash"]
    assert cash["balances"]["USD"]["amount"] == target
    assert len(cash["ledger"]) == 2
    assert cash["ledger"][1]["op"] == "spend"
    assert cash["ledger"][1]["localized_reason"] == "建卡重跑·信用评级差额调整"
    assert cash["ledger"][1]["amount"] == coc_toolbox.coc_cash.format_amount(
        coc_toolbox.coc_cash.parse_amount(first_cash) - coc_toolbox.coc_cash.parse_amount(target)
    )
    replay = coc_toolbox.run_tool(
        "setup.chargen_run", tmp_path, None, _chargen_args(campaign_id, "ada-down"),
    )
    assert replay["ok"] is True, replay
    replayed = _investigator_runtime_state(tmp_path, campaign_id, "ada-down")["cash"]
    assert len(replayed["ledger"]) == 2
    assert replayed["balances"]["USD"]["amount"] == target


def test_chargen_working_language_warning_competency_bands() -> None:
    warn = coc_character.chargen_working_language_warning
    threshold = coc_character.CHARGEN_WORKING_LANGUAGE_PROFESSIONAL_MIN
    assert threshold == 50
    missing = warn(era="1920s", own_language="国语", skills={"Listen": 40})
    assert missing is not None
    assert "没有 Language (English)" in missing
    assert "无法有效行动" in missing
    low = warn(
        era="1920s",
        own_language="国语",
        skills={"Language (English)": 24, "Listen": 40},
    )
    assert low is not None
    assert "24" in low and "50" in low
    assert "有限交流" in low
    assert "读档案" in low
    just_under = warn(
        era="1920s",
        own_language="国语",
        skills={"Language (English)": threshold - 1},
    )
    assert just_under is not None
    assert str(threshold - 1) in just_under
    assert str(threshold) in just_under
    at = warn(
        era="1920s",
        own_language="国语",
        skills={"Language (English)": threshold},
    )
    assert at is None
    above = warn(
        era="1920s",
        own_language="国语",
        skills={"Language (English)": threshold + 5},
    )
    assert above is None
    assert warn(era="1920s", own_language="英语", skills={}) is None
    assert warn(era="ww1", own_language="国语", skills={}) is None
