"""NPC reaction openings — the hook that points at the moment banter belongs."""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "plugins" / "coc-keeper" / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))


def _load(name: str, rel: Path):
    spec = importlib.util.spec_from_file_location(name, rel)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


nc = _load("coc_narration_contract_npc", SCRIPTS / "coc_narration_contract.py")

_FAILED = {
    "roll_id": "r1", "skill": "Listen", "kind": "skill", "outcome": "failure",
    "passed": False, "base_target": 44, "roll": 75,
    "required_level": "regular", "visibility": "public",
}


def test_a_failed_public_check_in_front_of_an_npc_is_an_opening():
    """`style_commitments` told the Keeper banter was allowed and never when.

    Every turn already carries "情境允许时保留桌边调侃" -- verified live, 276
    times across the preserved corpus. What it never did was point at the
    situation, leaving the Keeper to notice the moment unaided while also
    composing the turn.
    """
    openings = nc._failed_public_check_reactions([dict(_FAILED)], ["npc:kauffman"])
    assert len(openings) == 1
    assert openings[0]["skill"] == "Listen"
    assert openings[0]["witness_npc_ids"] == ["npc:kauffman"]


def test_it_stays_shut_when_nothing_was_watched():
    """Three ways there is no moment, and each has to be checked separately."""
    passed = {**_FAILED, "outcome": "regular_success", "passed": True, "roll": 20}
    assert nc._failed_public_check_reactions([passed], ["npc:kauffman"]) == [], (
        "a success is not a moment for ribbing"
    )
    concealed = {**_FAILED, "visibility": "keeper_only", "hidden": True}
    assert nc._failed_public_check_reactions([concealed], ["npc:kauffman"]) == [], (
        "a concealed roll is not something anyone at the table watched"
    )
    assert nc._failed_public_check_reactions([dict(_FAILED)], []) == [], (
        "an empty room has nobody to react"
    )


def test_the_hook_supplies_no_line_tone_or_phrase():
    """Advisory means naming the moment, not writing the reaction.

    A phrase list here would be the matcher T4 deleted, wearing a new name, and
    it would make every NPC in the game mock the same way.
    """
    opening = nc._failed_public_check_reactions([dict(_FAILED)], ["npc:kauffman"])[0]
    assert set(opening) == {"roll_id", "skill", "outcome", "witness_npc_ids"}, (
        f"the hook grew a field that suggests what to say: {sorted(opening)}"
    )


def test_every_present_npc_is_offered_not_one_chosen():
    """Which NPC reacts, or whether any does, is the Keeper's judgment."""
    openings = nc._failed_public_check_reactions(
        [dict(_FAILED)], ["npc:kauffman", "npc:corbitt"],
    )
    assert openings[0]["witness_npc_ids"] == ["npc:kauffman", "npc:corbitt"]
