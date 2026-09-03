"""A weapon refusal must name what the investigator is carrying.

The refusal named only the id that failed. A Keeper reading ".38 Revolver" off
the sheet and writing `weapon:38-revolver` had no way to learn the canonical
`revolver_38_or_9mm` short of a catalog search -- while the owned set sat in
scope at the point of refusal.

Measured 2026-09-02: in r55 the Keeper recovered by searching the catalog, so
this looked like a self-corrected model slip. In r56 it did not recover -- two
refusals, then eight `nonretryable_repeat_blocked`, and that lane never fired
a shot. The same defect, once cheap and once fatal.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import coc_starter  # noqa: E402
import coc_toolbox  # noqa: E402


@pytest.fixture
def campaign_ws(tmp_path: Path):
    workspace = tmp_path / "workspace"
    coc_root = workspace / ".coc"
    coc_root.mkdir(parents=True)
    (coc_root / "runtime.json").write_text(
        json.dumps({
            "schema_version": 2,
            "planner": {"kind": "deterministic"},
            "rules": {"kind": "deterministic"},
            "narrator": {"kind": "template"},
            "player": {"kind": "human"},
        }),
        encoding="utf-8",
    )
    campaign_id = "weapon-refusal-test"
    coc_starter.quick_start(
        coc_root, "the-haunting", "thomas-hayes",
        campaign_id=campaign_id, title="Weapon Refusal",
    )
    return {"workspace": workspace, "campaign_id": campaign_id}


def _owned_weapon_ids(campaign_ws):
    sheet = json.loads(
        (campaign_ws["workspace"] / ".coc" / "investigators" / "thomas-hayes"
         / "character.json").read_text(encoding="utf-8")
    )
    return [
        str(weapon["weapon_id"]) for weapon in (sheet.get("weapons") or [])
        if weapon.get("weapon_id")
    ]


def test_the_refusal_names_the_weapons_the_investigator_carries(campaign_ws):
    """Driven through a real fight. The weapon check sits behind a target
    check, so a probe fired at an empty room is answered by
    `unknown_combat_target` and proves nothing -- the first version of this
    test skipped for exactly that reason.
    """
    ws, cid = campaign_ws["workspace"], campaign_ws["campaign_id"]
    owned = _owned_weapon_ids(campaign_ws)
    assert owned, "the starter investigator must carry a weapon for this test"

    coc_toolbox.run_tool("state.move_scene", ws, cid, {
        "scene_id": "corbitt-house-ground",
        "reason": "weapon refusal probe",
        "decision_id": "weapon-refusal-scene",
    })
    coc_toolbox.run_tool("state.npc_presence", ws, cid, {
        "npc_id": "npc-walter-corbitt",
        "scene_id": "corbitt-house-ground",
        "status": "present",
        "reason": "weapon refusal probe",
        "decision_id": "weapon-refusal-npc",
    })
    opened = coc_toolbox.run_tool("combat.resolve", ws, cid, {
        "decision_id": "weapon-refusal-open",
        "investigator": "thomas-hayes",
        "action_kind": "attack",
        "weapon_id": owned[0],
        "target_npc_id": "npc-walter-corbitt",
    })
    if not opened.get("ok"):
        pytest.skip(
            f"could not open a fight to reach the weapon check: "
            f"{(opened.get('error') or {}).get('code')}"
        )

    refused = coc_toolbox.run_tool("combat.resolve", ws, cid, {
        "decision_id": "weapon-refusal-0001",
        "investigator": "thomas-hayes",
        "action_kind": "attack",
        # The shape a Keeper writes from the sheet's display name.
        "weapon_id": "38-revolver",
        "target_npc_id": "npc-walter-corbitt",
    })
    error = refused.get("error") or {}
    assert error.get("code") in {"unknown_weapon", "unowned_weapon"}, refused
    message = error.get("message", "")
    for weapon_id in owned:
        assert weapon_id in message, (weapon_id, message)
