"""Catalog consumers: search → KP-chosen id → fail-closed grant/combat/spell/creature."""
from __future__ import annotations

import importlib.util
import json
import random
import sys
from copy import deepcopy
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))


def _load(name: str, rel: Path):
    spec = importlib.util.spec_from_file_location(name, rel)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_catalog = _load("coc_catalog_consumer_val", SCRIPTS / "coc_catalog.py")
coc_combat = _load("coc_combat_consumer_val", SCRIPTS / "coc_combat.py")
coc_magic = _load("coc_magic_consumer_val", SCRIPTS / "coc_magic.py")
coc_rules = _load("coc_rules_consumer_val", SCRIPTS / "coc_rules.py")
coc_starter = _load("coc_starter_consumer_val", SCRIPTS / "coc_starter.py")
coc_toolbox = _load("coc_toolbox_consumer_val", SCRIPTS / "coc_toolbox.py")


def _write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


@pytest.fixture
def campaign_ws(tmp_path: Path):
    workspace = tmp_path / "workspace"
    coc_root = workspace / ".coc"
    campaign_id = "catalog-consumer"
    _write_json(
        coc_root / "runtime.json",
        {
            "schema_version": 2,
            "planner": {"kind": "deterministic"},
            "rules": {"kind": "deterministic"},
            "narrator": {"kind": "template"},
            "player": {"kind": "human"},
        },
    )
    quick = coc_starter.quick_start(
        coc_root,
        "the-haunting",
        "thomas-hayes",
        campaign_id=campaign_id,
        title="Catalog Consumer",
    )
    return {
        "workspace": workspace,
        "campaign_id": campaign_id,
        "campaign_dir": Path(quick["campaign_dir"]),
        "investigator_id": quick["investigator_id"],
    }


def _run(ws, tool: str, args: dict | None = None) -> dict:
    return coc_toolbox.run_tool(tool, ws["workspace"], ws["campaign_id"], args or {})


def test_dot38_search_then_grant_revolver_38_or_9mm_then_combat_profile(campaign_ws):
    search = _run(
        campaign_ws,
        "rules.catalog_search",
        {"query": ".38", "kinds": ["weapon"]},
    )
    assert search["ok"] is True
    assert search["data"]["selected"] is None
    ids = {row["entity_id"] for row in search["data"]["candidates"]}
    assert {"revolver_38", "revolver_38_or_9mm"} <= ids

    chosen = "revolver_38_or_9mm"
    granted = _run(
        campaign_ws,
        "state.item_grant",
        {
            "investigator": campaign_ws["investigator_id"],
            "kind": "weapon",
            "weapon_id": chosen,
            "label": ".38 or 9mm Revolver",
            "decision_id": "grant-38-or-9mm",
        },
    )
    assert granted["ok"] is True, granted
    assert granted["data"]["weapon"]["weapon_id"] == chosen

    session = coc_combat.CombatSession("cat", "scene", 1, rng=random.Random(1))
    session.add_participant(
        "hero",
        "investigator",
        dex=60,
        combat_skill=50,
        build=0,
        hp_max=10,
        weapons=[{"weapon_id": chosen}],
    )
    weapon = session._weapon("hero", chosen)
    assert weapon["damage"] == "1D10"
    assert weapon["base_range_yards"] == 15
    assert weapon["magazine"] == 6
    assert weapon["malfunction"] == 100
    assert weapon["skill"] == "Firearms (Handgun)"


def test_unknown_weapon_grant_fails_closed_without_write(campaign_ws):
    inv = campaign_ws["investigator_id"]
    before = _run(campaign_ws, "state.inventory_list", {"investigator": inv})
    assert before["ok"]
    snapshot = deepcopy(before["data"])

    failed = _run(
        campaign_ws,
        "state.item_grant",
        {
            "investigator": inv,
            "kind": "weapon",
            "weapon_id": "not_a_real_weapon_id",
            "label": "Mystery stick",
            "decision_id": "grant-unknown-weapon",
        },
    )
    assert failed["ok"] is False
    assert failed["error"]["code"] == "unknown_weapon"

    after = _run(campaign_ws, "state.inventory_list", {"investigator": inv})
    assert after["ok"]
    assert after["data"] == snapshot


def test_planted_bad_weapon_id_combat_fails_not_unarmed(campaign_ws):
    inv = campaign_ws["investigator_id"]
    state_path = (
        campaign_ws["campaign_dir"] / "save" / "investigator-state" / f"{inv}.json"
    )
    state = json.loads(state_path.read_text(encoding="utf-8"))
    inventory = state.setdefault("inventory", {"entries": [], "lost_weapon_ids": []})
    inventory.setdefault("entries", []).append(
        {
            "item_id": "broken-pipe",
            "kind": "weapon",
            "label": "Broken pipe",
            "weapon": {"weapon_id": "broken-pipe"},
        }
    )
    state_path.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n")

    session = coc_combat.CombatSession("bad", "scene", 1, rng=random.Random(2))
    session.add_participant(
        "hero",
        "investigator",
        dex=60,
        combat_skill=50,
        build=0,
        hp_max=10,
        weapons=[{"weapon_id": "broken-pipe"}],
    )
    session.add_participant(
        "foe", "npc", dex=40, combat_skill=30, build=0, hp_max=8,
        weapons=[{"weapon_id": "unarmed"}],
    )
    with pytest.raises(coc_combat.UnknownWeaponError) as caught:
        session._weapon("hero", "broken-pipe")
    assert "broken-pipe" in str(caught.value)
    # Must not collapse to unarmed 1D3/Brawl.
    assert "1D3" not in str(caught.value)

    moved = _run(
        campaign_ws,
        "state.move_scene",
        {"scene_id": "corbitt-confrontation", "decision_id": "move-bad-weapon"},
    )
    assert moved["ok"] is True, moved
    resolved = _run(
        campaign_ws,
        "combat.resolve",
        {
            "affordance_id": "conventional-assault",
            "investigator": inv,
            "weapon_id": "broken-pipe",
            "decision_id": "combat-bad-weapon",
            "seed": 3,
        },
    )
    assert resolved["ok"] is False
    assert resolved["error"]["code"] == "unknown_weapon"


def test_explicit_unarmed_resolves(campaign_ws):
    session = coc_combat.CombatSession("ua", "scene", 1, rng=random.Random(4))
    session.add_participant(
        "hero",
        "investigator",
        dex=60,
        combat_skill=50,
        build=0,
        hp_max=10,
        weapons=[{"weapon_id": "unarmed"}],
    )
    weapon = session._weapon("hero", "unarmed")
    assert weapon["weapon_id"] == "unarmed"
    assert weapon["damage"] == "1D3"
    assert weapon["skill"] == "Fighting (Brawl)"

    empty = coc_combat.CombatSession("ua2", "scene", 1, rng=random.Random(5))
    empty.add_participant(
        "hero", "investigator", dex=60, combat_skill=50, build=0, hp_max=10,
        weapons=[],
    )
    implicit = empty._weapon("hero", None)
    assert implicit["weapon_id"] == "unarmed"


def test_canonical_but_unowned_weapon_is_rejected(campaign_ws):
    inv = campaign_ws["investigator_id"]
    chosen = "revolver_38_or_9mm"
    search = _run(
        campaign_ws,
        "rules.catalog_search",
        {"query": ".38", "kinds": ["weapon"]},
    )
    assert search["ok"] is True
    assert any(row["entity_id"] == chosen for row in search["data"]["candidates"])

    listed = _run(campaign_ws, "state.inventory_list", {"investigator": inv})
    assert listed["ok"]
    owned = {row["weapon_id"] for row in listed["data"]["weapons"]}
    if chosen in owned:
        removed = _run(
            campaign_ws,
            "state.item_remove",
            {
                "investigator": inv,
                "item_id": chosen,
                "reason": "test strip catalog weapon",
                "decision_id": "strip-38-or-9mm",
            },
        )
        assert removed["ok"] is True, removed
    listed = _run(campaign_ws, "state.inventory_list", {"investigator": inv})
    assert chosen not in {row["weapon_id"] for row in listed["data"]["weapons"]}

    moved = _run(
        campaign_ws,
        "state.move_scene",
        {"scene_id": "corbitt-confrontation", "decision_id": "move-unowned-38"},
    )
    assert moved["ok"] is True, moved
    rejected = _run(
        campaign_ws,
        "combat.resolve",
        {
            "affordance_id": "conventional-assault",
            "investigator": inv,
            "weapon_id": chosen,
            "decision_id": "combat-unowned-38",
            "seed": 11,
        },
    )
    assert rejected["ok"] is False
    assert rejected["error"]["code"] == "unowned_weapon"

    granted = _run(
        campaign_ws,
        "state.item_grant",
        {
            "investigator": inv,
            "kind": "weapon",
            "weapon_id": chosen,
            "label": ".38 or 9mm Revolver",
            "decision_id": "grant-owned-38",
        },
    )
    assert granted["ok"] is True, granted
    resolved = _run(
        campaign_ws,
        "combat.resolve",
        {
            "affordance_id": "conventional-assault",
            "investigator": inv,
            "weapon_id": chosen,
            "decision_id": "combat-owned-38",
            "seed": 12,
        },
    )
    assert resolved["ok"] is True, resolved
    attack_events = [
        event
        for event in resolved["data"]["events"]
        if event.get("event_type") == "combat_turn_resolved"
        and (event.get("turn") or {}).get("actor_id") == inv
    ]
    assert attack_events
    turn = attack_events[0]["turn"]
    assert turn.get("resolution_hint") == "firearm_attack"
    hero = next(
        row
        for row in resolved["data"]["combat"]["participants"]
        if row["actor_id"] == inv
    )
    hero_ids = {
        (w.get("weapon_id") if isinstance(w, dict) else w)
        for w in (hero.get("weapons") or [])
    }
    assert chosen in hero_ids
    chain_ids = {
        row.get("weapon_id")
        for row in (resolved["data"]["combat"].get("damage_chain") or [])
        if row.get("weapon_id")
    }
    assert not chain_ids or chosen in chain_ids
    weapon = coc_combat.resolve_module_weapons(None)[chosen]
    assert weapon["damage"] == "1D10"
    assert weapon["base_range_yards"] == 15
    assert weapon["magazine"] == 6
    assert weapon["malfunction"] == 100


def test_npc_profile_weapon_does_not_require_investigator_inventory(campaign_ws):
    inv = campaign_ws["investigator_id"]
    listed = _run(campaign_ws, "state.inventory_list", {"investigator": inv})
    assert listed["ok"]
    assert "floating-knife" not in {
        row["weapon_id"] for row in listed["data"]["weapons"]
    }
    moved = _run(
        campaign_ws,
        "state.move_scene",
        {"scene_id": "corbitt-confrontation", "decision_id": "move-npc-profile"},
    )
    assert moved["ok"] is True, moved
    result = _run(
        campaign_ws,
        "combat.resolve",
        {
            "target_npc_id": "npc-walter-corbitt",
            "investigator": inv,
            "weapon_id": "unarmed",
            "decision_id": "attack-npc-profile-unarmed",
            "seed": 41,
        },
    )
    assert result["ok"] is True, result
    pinned = next(
        row
        for row in result["data"]["combat"]["participants"]
        if row["actor_id"] == "npc-walter-corbitt"
    )
    npc_weapon_ids = {
        (w.get("weapon_id") if isinstance(w, dict) else w)
        for w in (pinned.get("weapons") or [])
    }
    assert "floating-knife" in npc_weapon_ids


def test_unknown_spell_fails_not_zero_cost():
    state = {"pow": 60, "current_mp": 12, "current_hp": 11, "current_san": 55}
    before = dict(state)
    with pytest.raises(KeyError) as caught:
        coc_magic.cast_spell(
            "Totally Fake Spell",
            state,
            is_first_cast=True,
            rng=random.Random(6),
        )
    assert "unknown spell" in str(caught.value).lower()
    assert state == before
    with pytest.raises(KeyError):
        coc_magic.learn_spell(
            "Totally Fake Spell",
            {"int": 60},
            source="tome",
            rng=random.Random(7),
        )


def test_unknown_creature_fail_closed():
    with pytest.raises(KeyError) as caught:
        coc_rules.monster_by_name("not-a-real-creature")
    assert "unknown monster" in str(caught.value).lower()


def test_catalog_search_secret_has_no_player_projection():
    result = coc_catalog.search_catalog(query="ward", kinds=["spell"])
    assert result["ok"] is True
    assert result["candidates"]
    assert all(row["secret"] is True for row in result["candidates"])
    blob = json.dumps(result)
    assert "player" not in result
    assert "player_safe" not in result
    assert "player_projection" not in blob

    tool = coc_toolbox.run_tool(
        "rules.catalog_search",
        Path("."),
        None,
        {"query": "Byakhee", "kinds": ["creature"]},
    )
    assert tool["ok"] is True
    assert tool["data"].get("secret") is True or all(
        row["secret"] is True for row in tool["data"]["candidates"]
    )
    assert "player" not in tool["data"]
    assert coc_toolbox.operation_policy("rules.catalog_search")["audience"] != "player"
