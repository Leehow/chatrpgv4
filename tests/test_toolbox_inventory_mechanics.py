"""Behavior tests owned by the inventory-mechanics operation cell."""
from toolbox_test_support import *

def test_inventory_list_remains_a_query_but_is_campaign_serial():
    spec = coc_toolbox.TOOLS["state.inventory_list"]
    assert spec["access"] == "query"
    assert spec["write_domains"] == ()
    assert spec["recovery_domains"] == ()
    assert spec["strict_read_only"] is True
    assert spec["execution_class"] == "serial_campaign"
    assert "state.inventory_list" not in coc_toolbox._MUTATING_TOOLS
    assert coc_toolbox.coc_turn_manifest.is_post_journal_read_tool(
        "state.inventory_list"
    )
    query_tools = {
        name
        for name, row in coc_toolbox.TOOLS.items()
        if row.get("access") == "query"
    }
    assert query_tools
    assert all(
        coc_toolbox.coc_turn_manifest.is_post_journal_read_tool(name)
        for name in query_tools
    )

def test_inventory_list_missing_state_uses_exclusive_campaign_lock(
    campaign_ws, monkeypatch,
):
    """The query seeds missing investigator state, so it must never share a lock."""
    lock_modes: list[str] = []

    @contextmanager
    def recorded_lock(_campaign_dir, **kwargs):
        lock_modes.append(str(kwargs.get("mode", "exclusive")))
        yield campaign_ws["campaign_dir"] / ".campaign.lock"

    state_path = (
        campaign_ws["campaign_dir"] / "save" / "investigator-state"
        / f"{campaign_ws['investigator_id']}.json"
    )
    state_path.unlink(missing_ok=True)
    monkeypatch.setattr(coc_toolbox.coc_fileio, "campaign_lock", recorded_lock)

    listed = _run(
        campaign_ws,
        "state.inventory_list",
        {"investigator": campaign_ws["investigator_id"]},
    )

    assert listed["ok"] is True, listed
    assert state_path.is_file()
    assert lock_modes == ["exclusive"]

def test_compiled_module_npc_mechanics_ready_via_ensure(campaign_ws):
    ensured = _run(campaign_ws, "mechanics.ensure", {
        "subject_kind": "npc",
        "subject_id": "npc-walter-corbitt",
        "purpose": "combat",
        "decision_id": "ensure-compiled-corbitt",
    })

    assert ensured["ok"] is True, ensured
    data = ensured["data"]
    assert data["status"] == "ready"
    assert data["authority"] == "compiled_module"
    assert data["monster_ref"] == "Walter Corbitt"
    assert data["affordance_id"] == "strike-with-his-dagger"
    profile = data["profile"]
    assert profile["authority"] == "source_authored"
    assert profile["characteristics"] == {
        "STR": 90, "CON": 115, "SIZ": 55, "DEX": 35, "POW": 90, "INT": 80,
    }
    assert profile["derived"] == {
        "HP": 16, "MP": 18, "MOV": 8, "Build": 1, "DB": "+1D4",
    }
    assert profile["skills"] == {"Fighting (Brawl)": 90, "Dodge": 17}
    assert profile["spells"] == ["Dominate", "Flesh Ward"]
    assert profile["weapons"][0]["weapon_id"] == "floating-knife"
    assert profile["weapons"][0]["extends"] == "knife_medium"
    revision_ref = data["mechanics_revision_ref"]
    assert revision_ref["authority"] == "source_authored"
    assert revision_ref["stable_id"] == "npc:npc-walter-corbitt:mechanics"
    assert revision_ref["revision"] == 1
    participant = data["combat_participant"]
    assert participant["actor_id"] == "npc-walter-corbitt"
    assert participant["combat_skill"] == 90
    assert participant["dodge_skill"] == 17
    assert {"path": "Call of Cthulhu 7e Keeper Rulebook", "page": 448} in (
        data["source_refs"]
    )
    assert {"path": "module:the-haunting"} in data["source_refs"]

def test_mechanics_ensure_source_npc_without_any_mechanics_fails_closed(
    campaign_ws,
):
    ensured = _run(campaign_ws, "mechanics.ensure", {
        "subject_kind": "npc",
        "subject_id": "npc-steven-knott",
        "purpose": "combat",
        "decision_id": "ensure-unsourceable-knott",
    })

    assert ensured["ok"] is False, ensured
    assert ensured["error"]["code"] == "mechanics_source_unavailable"
