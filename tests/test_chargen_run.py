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
    assert sorted(chars.values()) == [40, 50, 50, 50, 60, 60, 70, 80]
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


def test_chargen_run_explicit_allocation_mismatch(tmp_path: Path) -> None:
    campaign_id = _create_campaign(tmp_path, "chargen-alloc")
    envelope = coc_toolbox.run_tool(
        "setup.chargen_run",
        tmp_path,
        None,
        {
            "campaign_id": campaign_id,
            "investigator_id": "mismatch",
            "name": "Mismatch",
            "occupation_name": "Author",
            "occupation_allocations": {"Library Use": 1},
        },
    )
    assert envelope["ok"] is False, envelope
    details = (envelope.get("error") or {}).get("details") or {}
    assert details.get("stage") == "occupation_allocations"
    assert details.get("expected", {}).get("got") == 1
    assert details.get("expected", {}).get("expected") != 1


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
    assert chars["EDU"] == 70
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
    assert result["roll_ids"] == first_rolls
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
    assert sorted(chars.values()) == [40, 50, 50, 50, 60, 60, 70, 80]
    stored = json.loads(
        (tmp_path / ".coc" / "investigators" / "ww1-ada" / "character.json")
        .read_text(encoding="utf-8")
    )
    creation = json.loads(
        (tmp_path / ".coc" / "investigators" / "ww1-ada" / "creation.json")
        .read_text(encoding="utf-8")
    )
    assert creation["input_mode"] == coc_character.ERA_ADAPTIVE_INPUT_MODE
    assert stored["era_adaptive"] is True
    assert stored["characteristics"] == chars
    assert isinstance(stored["derived"]["Luck"], int)
    budget = creation["skill_budget"]["occupation_points"]
    assert budget["budget"] == budget["spent"] == sum(budget["allocations"].values())
    assert budget["budget"] > 0


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
