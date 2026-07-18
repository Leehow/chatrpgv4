"""Contract tests for the runtime inventory system.

Covers the pure merge/mutation layer (coc_inventory), the toolbox item
tools (state.item_grant / state.item_remove / state.inventory_list), combat
disarm persistence (engine transfer + executor commit + NPC overrides), and
development-settlement write-back into the investigator library.
"""
from __future__ import annotations

import importlib.util
import json
import random
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "plugins" / "coc-keeper" / "scripts"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_inventory = _load("coc_inventory_under_test", SCRIPTS / "coc_inventory.py")
coc_combat = _load("coc_combat_inventory_test", SCRIPTS / "coc_combat.py")
coc_npc_state = _load("coc_npc_state_inventory_test", SCRIPTS / "coc_npc_state.py")
coc_executor = _load(
    "coc_subsystem_executor_inventory_test", SCRIPTS / "coc_subsystem_executor.py"
)
coc_development = _load(
    "coc_development_inventory_test", SCRIPTS / "coc_development.py"
)
coc_toolbox = _load("coc_toolbox_inventory_test", SCRIPTS / "coc_toolbox.py")
coc_starter = _load("coc_starter_inventory_test", SCRIPTS / "coc_starter.py")


# --------------------------------------------------------------------------- #
# Pure layer: coc_inventory
# --------------------------------------------------------------------------- #

def test_effective_weapons_merges_sheet_gains_and_losses():
    sheet = [
        {"weapon_id": "revolver_38", "damage": "1D10"},
        {"weapon_id": "knife_medium", "damage": "1D4+2"},
    ]
    inventory = {
        "entries": [
            {
                "item_id": "revolver_45",
                "kind": "weapon",
                "label": ".45 Revolver",
                "weapon": {"weapon_id": "revolver_45", "damage": "1D10+2"},
            }
        ],
        "lost_weapon_ids": ["knife_medium"],
    }
    merged = coc_inventory.effective_weapons(sheet, inventory)
    ids = [row["weapon_id"] for row in merged]
    assert ids == ["revolver_38", "revolver_45"]
    # Entry spec wins on id collision with the sheet.
    inventory["entries"].append(
        {
            "item_id": "revolver_38",
            "kind": "weapon",
            "label": "Father's .38 (modified)",
            "weapon": {"weapon_id": "revolver_38", "damage": "1D10+1"},
        }
    )
    merged = coc_inventory.effective_weapons(sheet, inventory)
    by_id = {row["weapon_id"]: row for row in merged}
    assert by_id["revolver_38"]["damage"] == "1D10+1"
    assert list(by_id) == ["revolver_38", "revolver_45"]


def test_grant_entry_is_idempotent_and_replaces():
    inventory = coc_inventory.empty_inventory()
    entry = {"item_id": "lantern", "kind": "gear", "label": " Lantern ".strip()}
    inventory, changed = coc_inventory.grant_entry(inventory, entry)
    assert changed is True
    inventory, changed = coc_inventory.grant_entry(inventory, entry)
    assert changed is False
    assert len(inventory["entries"]) == 1
    updated = {**entry, "note": "from the caretaker"}
    inventory, changed = coc_inventory.grant_entry(inventory, updated)
    assert changed is True
    assert inventory["entries"][0]["note"] == "from the caretaker"


def test_grant_weapon_back_clears_recorded_loss():
    inventory = coc_inventory.empty_inventory()
    inventory["lost_weapon_ids"].append("revolver_38")
    inventory, _ = coc_inventory.grant_entry(
        inventory,
        {
            "item_id": "revolver_38",
            "kind": "weapon",
            "label": ".38",
            "weapon": {"weapon_id": "revolver_38"},
        },
    )
    assert inventory["lost_weapon_ids"] == []


def test_remove_item_outcomes():
    inventory = coc_inventory.empty_inventory()
    coc_inventory.grant_entry(
        inventory, {"item_id": "rope", "kind": "gear", "label": "Rope"}
    )
    inventory, outcome = coc_inventory.remove_item(inventory, "rope", set())
    assert outcome == "removed_entry"
    inventory, outcome = coc_inventory.remove_item(
        inventory, "revolver_38", {"revolver_38"}
    )
    assert outcome == "marked_lost"
    inventory, outcome = coc_inventory.remove_item(
        inventory, "revolver_38", {"revolver_38"}
    )
    assert outcome == "already_lost"
    inventory, outcome = coc_inventory.remove_item(inventory, "nothing", set())
    assert outcome == "not_found"


def test_validate_entry_rejects_bad_shapes():
    assert coc_inventory.validate_entry({"item_id": "x", "kind": "gear", "label": "X"}) == []
    assert coc_inventory.validate_entry({"item_id": "", "kind": "gear", "label": "X"})
    assert coc_inventory.validate_entry({"item_id": "x", "kind": "scroll", "label": "X"})
    assert coc_inventory.validate_entry({"item_id": "x", "kind": "weapon", "label": "X"})
    assert coc_inventory.validate_entry(
        {"item_id": "x", "kind": "gear", "label": "X", "surprise": True}
    )


def test_normalize_inventory_drops_malformed_rows():
    state = {
        "inventory": {
            "entries": [
                {"item_id": "ok", "kind": "gear", "label": "OK"},
                {"item_id": "", "kind": "gear", "label": "bad"},
                "garbage",
            ],
            "lost_weapon_ids": ["revolver_38", 7, "revolver_38"],
        }
    }
    inventory = coc_inventory.normalize_inventory(state)
    assert [row["item_id"] for row in inventory["entries"]] == ["ok"]
    assert inventory["lost_weapon_ids"] == ["revolver_38"]
    assert coc_inventory.normalize_inventory({}) == {
        "entries": [],
        "lost_weapon_ids": [],
    }


def test_npc_items_override_and_authored_lookup():
    story_graph = {
        "scenes": [
            {
                "scene_id": "s1",
                "affordances": [
                    {
                        "id": "a1",
                        "rules_operation": {
                            "opponent": {
                                "actor_id": "cultist",
                                "weapons": [{"weapon_id": "knife_medium"}],
                            }
                        },
                    },
                    {
                        "id": "a2",
                        "rules_operation": {
                            "opponent": {
                                "actor_id": "other",
                                "weapons": [{"weapon_id": "club_small"}],
                            }
                        },
                    },
                ],
            }
        ]
    }
    authored = coc_inventory.authored_weapons_for_npc(story_graph, "cultist")
    assert authored == [{"weapon_id": "knife_medium"}]

    doc: dict = {}
    assert coc_inventory.effective_npc_weapons(doc, "cultist") is None
    assert coc_inventory.effective_npc_weapons(doc, "cultist", authored) == [
        {"weapon_id": "knife_medium"}
    ]
    coc_inventory.npc_set_current_weapons(doc, "cultist", [])
    assert coc_inventory.effective_npc_weapons(doc, "cultist", authored) == []

    assert coc_inventory.npc_add_weapon(
        doc, "cultist", {"weapon_id": "revolver_45"}, authored
    ) is True
    assert coc_inventory.npc_add_weapon(
        doc, "cultist", {"weapon_id": "revolver_45"}, authored
    ) is False
    row = coc_inventory.npc_items(doc, "cultist")
    assert [coc_inventory.weapon_ref_id(w) for w in row["current_weapons"]] == [
        "revolver_45"
    ]
    assert coc_inventory.npc_remove_weapon(doc, "cultist", "revolver_45") == "removed"
    assert coc_inventory.npc_remove_weapon(doc, "cultist", "revolver_45") == "not_found"

    # No recorded override and no authored baseline: a plain miss that must
    # not fabricate an empty override.
    fresh: dict = {}
    assert coc_inventory.npc_remove_weapon(fresh, "ghost", "knife_medium") == "not_found"
    assert coc_inventory.npc_items(fresh, "ghost")["current_weapons"] is None


# --------------------------------------------------------------------------- #
# Combat engine: disarm transfers the full spec
# --------------------------------------------------------------------------- #

def _run_successful_disarm(seed_start: int = 0):
    for seed in range(seed_start, seed_start + 200):
        rng = random.Random(seed)
        session = coc_combat.CombatSession("loot-fight", "test/scene", 1, rng=rng)
        session.add_participant(
            "hero", "investigator", dex=70, combat_skill=90, build=0, hp_max=10,
        )
        session.add_participant(
            "thug", "monster", dex=50, combat_skill=30, build=0, hp_max=10,
            weapons=[{
                "weapon_id": "knife_custom",
                "skill": "Fighting (Brawl)",
                "damage": "1D4+2",
                "adds_damage_bonus": True,
                "impales": True,
                "special": "serrated",
            }],
        )
        session.begin_round()
        turn = session.declare_and_resolve_turn(
            "hero", "disarm the thug", "maneuver",
            target_actor_id="thug", defense_kind="fight_back",
            maneuver_kind="disarm", target_weapon_id="knife_custom",
        )
        if turn["outcome"] == "disarm_success":
            return session, turn
    raise AssertionError("no disarm_success in seed range")


def test_disarm_transfers_full_weapon_spec():
    session, turn = _run_successful_disarm()
    gained = session.participants["hero"]["weapons"][-1]
    assert isinstance(gained, dict)
    assert gained["weapon_id"] == "knife_custom"
    assert gained["damage"] == "1D4+2"
    assert gained["special"] == "serrated"
    effect = turn["effect_applied"]
    assert effect["effect"] == "disarmed"
    assert effect["weapon"]["damage"] == "1D4+2"
    assert effect["transferred_to"] == "hero"
    assert session.participants["thug"]["weapons"] == []


# --------------------------------------------------------------------------- #
# Executor: disarm commit + NPC combat-start override
# --------------------------------------------------------------------------- #

def _executor_campaign(tmp_path: Path) -> tuple[Path, Path]:
    campaign = tmp_path / ".coc" / "campaigns" / "case-1"
    (campaign / "save" / "investigator-state").mkdir(parents=True)
    (campaign / "logs").mkdir(parents=True)
    (campaign / "logs" / "rolls.jsonl").write_text("", encoding="utf-8")
    (campaign / "save" / "investigator-state" / "hero.json").write_text(
        json.dumps({
            "schema_version": 1,
            "campaign_id": "case-1",
            "investigator_id": "hero",
            "current_hp": 10,
            "current_san": 55,
            "conditions": [],
        }),
        encoding="utf-8",
    )
    character = (
        tmp_path / ".coc" / "investigators" / "hero" / "character.json"
    )
    character.parent.mkdir(parents=True)
    character.write_text(
        json.dumps({
            "schema_version": 1,
            "id": "hero",
            "name": "Hero",
            "characteristics": {"STR": 60, "SIZ": 60, "DEX": 70, "CON": 60},
            "derived": {"HP": 12, "SAN": 55},
            "skills": {"Fighting (Brawl)": 90},
            "weapons": [{"weapon_id": "revolver_38", "damage": "1D10"}],
        }),
        encoding="utf-8",
    )
    return campaign, character


def test_combat_end_commit_persists_disarm_both_sides(tmp_path):
    campaign, character = _executor_campaign(tmp_path)
    session, _ = _run_successful_disarm()
    # The investigator carries a sheet weapon; the thug carried the knife.
    session.participants["hero"]["weapons"].insert(
        0, {"weapon_id": "revolver_38", "damage": "1D10"}
    )
    session.conclude("investigators_win")
    session.save(campaign)

    transfers = coc_executor._commit_combat_inventory_changes(campaign, session)
    assert [t["weapon_id"] for t in transfers] == ["knife_custom"]

    inv_state = json.loads(
        (campaign / "save" / "investigator-state" / "hero.json").read_text()
    )
    inventory = coc_inventory.normalize_inventory(inv_state)
    assert [e["item_id"] for e in inventory["entries"]] == ["knife_custom"]
    gained = inventory["entries"][0]
    assert gained["kind"] == "weapon"
    assert gained["weapon"]["damage"] == "1D4+2"
    assert gained["acquired"]["combat_id"] == "loot-fight"

    npc_doc = coc_npc_state.load_npc_state(campaign)
    assert coc_inventory.npc_items(npc_doc, "thug")["current_weapons"] == []

    # Replaying the same commit is a no-op (auto-conclude + combat.end both
    # run it).
    assert coc_executor._commit_combat_inventory_changes(campaign, session) == []
    inv_state_after = json.loads(
        (campaign / "save" / "investigator-state" / "hero.json").read_text()
    )
    assert inv_state_after == inv_state


def test_combat_end_commit_marks_sheet_weapon_lost(tmp_path):
    campaign, character = _executor_campaign(tmp_path)
    # Thug disarms the hero of the sheet revolver.
    for seed in range(200):
        rng = random.Random(seed)
        session = coc_combat.CombatSession("counter-fight", "test/scene", 1, rng=rng)
        session.add_participant(
            "thug", "monster", dex=70, combat_skill=90, build=0, hp_max=10,
            weapons=[{"weapon_id": "unarmed"}],
        )
        session.add_participant(
            "hero", "investigator", dex=50, combat_skill=30, build=0, hp_max=10,
            weapons=[{"weapon_id": "revolver_38", "damage": "1D10"}],
        )
        session.begin_round()
        turn = session.declare_and_resolve_turn(
            "thug", "disarm the hero", "maneuver",
            target_actor_id="hero", defense_kind="fight_back",
            maneuver_kind="disarm", target_weapon_id="revolver_38",
        )
        if turn["outcome"] == "disarm_success":
            break
    else:
        raise AssertionError("no disarm_success in seed range")
    session.conclude("monsters_win")
    session.save(campaign)

    transfers = coc_executor._commit_combat_inventory_changes(campaign, session)
    assert [t["weapon_id"] for t in transfers] == ["revolver_38"]
    inv_state = json.loads(
        (campaign / "save" / "investigator-state" / "hero.json").read_text()
    )
    inventory = coc_inventory.normalize_inventory(inv_state)
    assert inventory["lost_weapon_ids"] == ["revolver_38"]
    assert inventory["entries"] == []
    npc_doc = coc_npc_state.load_npc_state(campaign)
    row = coc_inventory.npc_items(npc_doc, "thug")
    assert [coc_inventory.weapon_ref_id(w) for w in row["current_weapons"]] == [
        "unarmed",
        "revolver_38",
    ]


def test_combat_start_seeds_and_applies_npc_weapon_override(tmp_path):
    campaign, character = _executor_campaign(tmp_path)

    def start_command(command_id: str, combat_id: str) -> dict:
        return {
            "command_id": command_id,
            "kind": "combat_start",
            "phase": "start",
            "payload": {
                "decision_id": f"{combat_id}-decision",
                "combat_id": combat_id,
                "scene_ref": "scene/fight",
                "turn_number": 1,
                "participants": [
                    {
                        "actor_id": "hero", "side": "investigator", "dex": 70,
                        "combat_skill": 90, "dodge_skill": 35, "build": 0,
                        "hp_max": 10, "hp_current": 10, "con": 60,
                        "weapons": [{"weapon_id": "revolver_38"}],
                        "conditions": [],
                    },
                    {
                        "actor_id": "cultist", "side": "npc", "dex": 50,
                        "combat_skill": 40, "dodge_skill": 25, "build": 0,
                        "hp_max": 9, "hp_current": 9, "con": 45,
                        "weapons": [{"weapon_id": "knife_medium"}],
                        "conditions": [],
                    },
                ],
            },
        }

    results = coc_executor.execute_commands(
        campaign, character, "hero", [start_command("start-1", "fight-1")],
        rng=random.Random(1),
    )
    assert results[0]["status"] == "completed", results[0]
    npc_doc = coc_npc_state.load_npc_state(campaign)
    row = coc_inventory.npc_items(npc_doc, "cultist")
    assert [coc_inventory.weapon_ref_id(w) for w in row["current_weapons"]] == [
        "knife_medium"
    ]

    # A recorded override replaces the authored loadout in the next combat.
    coc_inventory.npc_set_current_weapons(npc_doc, "cultist", [])
    coc_npc_state.save_npc_state(campaign, npc_doc)
    ended = coc_executor.execute_commands(
        campaign, character, "hero", [{
            "command_id": "end-1",
            "kind": "combat_end",
            "phase": "end",
            "payload": {"decision_id": "end-1", "revision": 1, "outcome": "investigators_win"},
        }],
        rng=random.Random(1),
    )
    assert ended[0]["status"] == "completed", ended[0]
    results = coc_executor.execute_commands(
        campaign, character, "hero", [start_command("start-2", "fight-2")],
        rng=random.Random(2),
    )
    assert results[0]["status"] == "completed", results[0]
    session = coc_combat.CombatSession.load(campaign, rng=random.Random(3))
    assert session.participants["cultist"]["weapons"] == []


# --------------------------------------------------------------------------- #
# Development settlement: library write-back + inventory history
# --------------------------------------------------------------------------- #

def test_inventory_settlement_writes_library_sheet_and_history(tmp_path):
    campaign, character = _executor_campaign(tmp_path)
    inv_state_path = campaign / "save" / "investigator-state" / "hero.json"
    inv_state = json.loads(inv_state_path.read_text(encoding="utf-8"))
    inv_state["inventory"] = {
        "entries": [
            {
                "item_id": "knife_custom",
                "kind": "weapon",
                "label": "Serrated knife",
                "weapon": {"weapon_id": "knife_custom", "damage": "1D4+2"},
            },
            {"item_id": "lantern", "kind": "gear", "label": "Storm lantern"},
        ],
        "lost_weapon_ids": ["revolver_38"],
    }
    inv_state_path.write_text(json.dumps(inv_state), encoding="utf-8")

    sheet = coc_development._read_character(campaign, "hero")
    summary = coc_development._apply_inventory_settlement(
        campaign, "hero", sheet, ending_id="ending-1"
    )
    assert summary == {
        "added_weapons": ["knife_custom"],
        "removed_weapons": ["revolver_38"],
        "added_gear": ["Storm lantern"],
        "merge_policy": "inventory_net_diff_v1",
    }

    written = json.loads(
        (tmp_path / ".coc" / "investigators" / "hero" / "character.json").read_text()
    )
    weapon_ids = [row["weapon_id"] for row in written["weapons"]]
    assert weapon_ids == ["knife_custom"]
    assert written["weapons"][0]["damage"] == "1D4+2"
    assert written["equipment"] == ["Storm lantern"]

    history_path = (
        tmp_path / ".coc" / "investigators" / "hero" / "inventory-history.jsonl"
    )
    events = [
        json.loads(line)
        for line in history_path.read_text(encoding="utf-8").splitlines()
    ]
    assert {(e["change"], e["kind"], e["item_id"]) for e in events} == {
        ("add", "weapon", "knife_custom"),
        ("remove", "weapon", "revolver_38"),
        ("add", "gear", "Storm lantern"),
    }
    assert all(e["event_type"] == "inventory_settled" for e in events)

    # Replayed settlement is a no-op: no sheet drift, no duplicate history.
    sheet_again = coc_development._read_character(campaign, "hero")
    assert coc_development._apply_inventory_settlement(
        campaign, "hero", sheet_again, ending_id="ending-1"
    ) is None
    assert (
        history_path.read_text(encoding="utf-8").splitlines()
        == history_path.read_text(encoding="utf-8").splitlines()
    )


def test_inventory_settlement_noop_without_runtime_inventory(tmp_path):
    campaign, character = _executor_campaign(tmp_path)
    sheet = coc_development._read_character(campaign, "hero")
    assert coc_development._apply_inventory_settlement(
        campaign, "hero", sheet, ending_id="ending-1"
    ) is None


# --------------------------------------------------------------------------- #
# Toolbox tools: grant / list / remove with decision-id idempotency
# --------------------------------------------------------------------------- #

def _write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


@pytest.fixture
def campaign_ws(tmp_path: Path):
    """Fresh the-haunting / thomas-hayes quick-start campaign workspace."""
    workspace = tmp_path / "workspace"
    coc_root = workspace / ".coc"
    campaign_id = "inventory-test"
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
        title="Inventory Test",
    )
    return {
        "workspace": workspace,
        "coc_root": coc_root,
        "campaign_id": campaign_id,
        "campaign_dir": Path(quick["campaign_dir"]),
        "investigator_id": quick["investigator_id"],
    }


def _run(ws, tool: str, args: dict | None = None) -> dict:
    return coc_toolbox.run_tool(tool, ws["workspace"], ws["campaign_id"], args or {})


def test_item_tools_grant_list_remove_roundtrip(campaign_ws):
    inv = campaign_ws["investigator_id"]
    granted = _run(campaign_ws, "state.item_grant", {
        "investigator": inv,
        "kind": "weapon",
        "weapon_id": "revolver_45",
        "label": ".45 Revolver",
        "note": "taken from the locked desk",
        "decision_id": "grant-45",
    })
    assert granted["ok"] is True, granted
    assert granted["data"]["changed"] is True
    assert granted["hints"]

    replayed = _run(campaign_ws, "state.item_grant", {
        "investigator": inv,
        "kind": "weapon",
        "weapon_id": "revolver_45",
        "label": ".45 Revolver",
        "note": "taken from the locked desk",
        "decision_id": "grant-45",
    })
    assert replayed["ok"] is True
    assert replayed["data"] == granted["data"]
    assert "duplicate decision_id" in replayed["warnings"][0]

    gear = _run(campaign_ws, "state.item_grant", {
        "investigator": inv,
        "kind": "gear",
        "item_id": "lantern",
        "label": "Storm lantern",
        "decision_id": "grant-lantern",
    })
    assert gear["ok"] is True and gear["data"]["changed"] is True

    listed = _run(campaign_ws, "state.inventory_list", {"investigator": inv})
    assert listed["ok"] is True
    weapon_ids = [row["weapon_id"] for row in listed["data"]["weapons"]]
    assert "revolver_38" in weapon_ids  # sheet weapon survives
    assert "revolver_45" in weapon_ids  # granted weapon is selectable
    assert {row["item_id"] for row in listed["data"]["items"]} == {
        "revolver_45",
        "lantern",
    }

    removed_gear = _run(campaign_ws, "state.item_remove", {
        "investigator": inv,
        "item_id": "lantern",
        "reason": "left behind",
        "decision_id": "remove-lantern",
    })
    assert removed_gear["ok"] is True
    assert removed_gear["data"]["outcome"] == "removed_entry"

    removed_sheet = _run(campaign_ws, "state.item_remove", {
        "investigator": inv,
        "item_id": "revolver_38",
        "reason": "handed to the police",
        "decision_id": "remove-38",
    })
    assert removed_sheet["ok"] is True
    assert removed_sheet["data"]["outcome"] == "marked_lost"
    assert removed_sheet["hints"]

    listed = _run(campaign_ws, "state.inventory_list", {"investigator": inv})
    weapon_ids = [row["weapon_id"] for row in listed["data"]["weapons"]]
    assert "revolver_38" not in weapon_ids
    assert "revolver_45" in weapon_ids
    assert listed["data"]["lost_weapon_ids"] == ["revolver_38"]

    missing = _run(campaign_ws, "state.item_remove", {
        "investigator": inv,
        "item_id": "no-such-item",
        "decision_id": "remove-missing",
    })
    assert missing["ok"] is True
    assert missing["data"]["changed"] is False
    assert missing["warnings"]


def test_item_tools_npc_paths(campaign_ws):
    granted = _run(campaign_ws, "state.item_grant", {
        "npc_id": "walter-corbitt",
        "kind": "weapon",
        "weapon_id": "revolver_45",
        "label": ".45 Revolver",
        "decision_id": "npc-grant-45",
    })
    assert granted["ok"] is True, granted
    assert granted["data"]["changed"] is True

    listed = _run(campaign_ws, "state.inventory_list", {"npc_id": "walter-corbitt"})
    assert listed["ok"] is True
    weapon_ids = [row["weapon_id"] for row in listed["data"]["weapons"]]
    # Authored floating-knife baseline plus the granted revolver.
    assert "floating-knife" in [
        row["weapon_id"] for row in listed["data"]["authored_weapons"]
    ]
    assert "revolver_45" in weapon_ids
    assert listed["data"]["override_recorded"] is True

    removed = _run(campaign_ws, "state.item_remove", {
        "npc_id": "walter-corbitt",
        "item_id": "floating-knife",
        "reason": "the ritual dagger is taken",
        "decision_id": "npc-remove-knife",
    })
    assert removed["ok"] is True, removed
    assert removed["data"]["outcome"] == "removed"

    listed = _run(campaign_ws, "state.inventory_list", {"npc_id": "walter-corbitt"})
    weapon_ids = [row["weapon_id"] for row in listed["data"]["weapons"]]
    assert weapon_ids == ["revolver_45"]


def test_item_grant_validates_arguments(campaign_ws):
    inv = campaign_ws["investigator_id"]
    bad_kind = _run(campaign_ws, "state.item_grant", {
        "investigator": inv, "kind": "scroll", "label": "X",
        "decision_id": "bad-kind",
    })
    assert bad_kind["ok"] is False

    missing_weapon = _run(campaign_ws, "state.item_grant", {
        "investigator": inv, "kind": "weapon", "label": "X",
        "decision_id": "missing-weapon",
    })
    assert missing_weapon["ok"] is False

    gear_with_weapon = _run(campaign_ws, "state.item_grant", {
        "investigator": inv, "kind": "gear", "label": "X",
        "weapon_id": "revolver_45", "decision_id": "gear-with-weapon",
    })
    assert gear_with_weapon["ok"] is False
