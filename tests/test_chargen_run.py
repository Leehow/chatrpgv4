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


def _create_campaign(workspace: Path, campaign_id: str = "chargen-scratch") -> str:
    receipt = coc_runtime_ops.execute_setup_operation(
        workspace,
        operation={
            "schema_version": 1,
            "kind": "campaign.create",
            "payload": {
                "campaign_id": campaign_id,
                "title": "Chargen Scratch",
                "era": "1920s",
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
