import importlib.util
import json
import random
from pathlib import Path


def _load():
    path = Path("runtime/engine/public_state.py")
    spec = importlib.util.spec_from_file_location("runtime_public_state", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _seed_campaign(workspace: Path, campaign_id: str = "camp-1") -> Path:
    coc = workspace / ".coc"
    campaign = coc / "campaigns" / campaign_id
    save = campaign / "save"
    inv_dir = save / "investigator-state"
    inv_dir.mkdir(parents=True)

    (coc / "runtime.json").write_text(
        json.dumps({"schema_version": 1, "brain": "pi"}),
        encoding="utf-8",
    )
    (campaign / "campaign.json").write_text(
        json.dumps({
            "schema_version": 1,
            "campaign_id": campaign_id,
            "play_language": "zh-CN",
        }),
        encoding="utf-8",
    )
    (save / "world-state.json").write_text(
        json.dumps({
            "schema_version": 1,
            "campaign_id": campaign_id,
            "active_scene_id": "dock-warehouse",
            "discovered_clue_ids": ["ledger-mark", "wet-footprints"],
        }),
        encoding="utf-8",
    )
    (save / "pacing-state.json").write_text(
        json.dumps({
            "schema_version": 1,
            "campaign_id": campaign_id,
            "tension_level": "rising",
            "turn_number": 7,
        }),
        encoding="utf-8",
    )
    (inv_dir / "inv-alice.json").write_text(
        json.dumps({
            "schema_version": 1,
            "investigator_id": "inv-alice",
            "current_hp": 11,
            "current_san": 55,
            "current_mp": 10,
            "conditions": ["shaken"],
        }),
        encoding="utf-8",
    )
    return campaign


def test_build_public_state_round_trips_hp_san_and_scene(tmp_path):
    campaign_id = "camp-1"
    _seed_campaign(tmp_path, campaign_id)

    state = _load().build_public_state(tmp_path, campaign_id)

    assert state["schema_version"] == 1
    assert state["campaign_id"] == campaign_id
    assert state["play_language"] == "zh-CN"
    assert state["active_scene_id"] == "dock-warehouse"
    assert state["tension_level"] == "rising"
    assert state["turn_number"] == 7
    assert state["discovered_clue_ids"] == ["ledger-mark", "wet-footprints"]
    assert state["brain"] == "pi"
    assert state["pending_choice"] is None

    assert len(state["investigators"]) == 1
    inv = state["investigators"][0]
    assert inv["id"] == "inv-alice"
    assert inv["current_hp"] == 11
    assert inv["current_san"] == 55
    assert inv["current_mp"] == 10
    assert inv["conditions"] == ["shaken"]


def test_public_state_projects_player_safe_combat_defense(tmp_path):
    campaign = _seed_campaign(tmp_path)
    path = Path("plugins/coc-keeper/scripts/coc_combat.py")
    spec = importlib.util.spec_from_file_location("public_state_combat", path)
    combat_mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(combat_mod)
    session = combat_mod.CombatSession("fight-1", "dock", 7, rng=random.Random(1))
    session.add_participant("cultist", "npc", 70, 50, 0, 9)
    session.add_participant("inv-alice", "investigator", 60, 50, 0, 11)
    session.begin_round()
    session.revision = 4
    session.pending_attack = {
        "attack_command_id": "attack-1", "actor_id": "cultist",
        "target_actor_id": "inv-alice", "declared_intent": "hidden",
        "resolution_hint": "opposed_melee", "weapon_id": "knife",
        "allowed_defenses": ["dodge", "fight_back"],
    }
    session.save(campaign)
    choice = _load().build_public_state(tmp_path, "camp-1")["pending_choice"]
    assert choice == {
        "choice_id": "combat-defense:attack-1", "kind": "combat_defense",
        "command_id": "attack-1", "responder": "player", "revision": 4,
        "prompt": "Choose a legal combat defense.",
        "options": [
            {"action": "dodge", "label": "Dodge"},
            {"action": "fight_back", "label": "Fight Back"},
        ],
        "attack_id": "attack-1", "audience": "player",
    }
    assert "declared_intent" not in json.dumps(choice)


def test_public_state_only_projects_defense_for_current_investigator(tmp_path):
    campaign = _seed_campaign(tmp_path)
    path = Path("plugins/coc-keeper/scripts/coc_combat.py")
    spec = importlib.util.spec_from_file_location("public_state_npc_combat", path)
    combat_mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(combat_mod)
    session = combat_mod.CombatSession("fight-npc", "dock", 7, rng=random.Random(1))
    session.add_participant("inv-alice", "investigator", 70, 50, 0, 11)
    session.add_participant("cultist", "npc", 60, 50, 0, 9)
    session.begin_round()
    session.revision = 2
    session.pending_attack = {
        "attack_command_id": "attack-npc", "actor_id": "inv-alice",
        "target_actor_id": "cultist", "declared_intent": "private keeper context",
        "resolution_hint": "opposed_melee", "weapon_id": "unarmed",
        "allowed_defenses": ["dodge", "fight_back"],
    }
    session.save(campaign)
    assert _load().build_public_state(tmp_path, "camp-1")["pending_choice"] is None


def test_build_public_state_brain_reflects_runtime_json(tmp_path):
    campaign_id = "camp-debug"
    _seed_campaign(tmp_path, campaign_id)
    (tmp_path / ".coc" / "runtime.json").write_text(
        json.dumps({"schema_version": 1, "brain": "debug"}),
        encoding="utf-8",
    )

    state = _load().build_public_state(tmp_path, campaign_id)
    assert state["brain"] == "debug"


def test_build_public_state_missing_files_use_safe_defaults(tmp_path):
    campaign_id = "empty-camp"
    (tmp_path / ".coc" / "campaigns" / campaign_id).mkdir(parents=True)

    state = _load().build_public_state(tmp_path, campaign_id)

    assert state["campaign_id"] == campaign_id
    assert state["brain"] == "debug"
    assert state["play_language"] is None or state["play_language"] == ""
    assert state["active_scene_id"] is None
    assert state["tension_level"] is None
    assert state["turn_number"] == 0
    assert state["discovered_clue_ids"] == []
    assert state["investigators"] == []
    assert state["pending_choice"] is None


def test_public_state_rejects_partial_forged_subsystem_state(tmp_path):
    campaign_id = "camp-choice"
    campaign = _seed_campaign(tmp_path, campaign_id)
    choice = {
        "choice_id": "push-offer:confirm",
        "kind": "push_confirm",
        "command_id": "push-offer",
        "responder": "player",
        "revision": 0,
        "prompt": "Accept the announced consequence?",
        "options": [{"action": "cancel", "label": "Keep the failure"}],
    }
    (campaign / "save" / "subsystem-state.json").write_text(json.dumps({
        "pending_choices": {choice["choice_id"]: choice},
        "pending_contexts": {
            choice["choice_id"]: {"keeper_secret": "do not expose this"},
        },
    }))

    state = _load().build_public_state(tmp_path, campaign_id)

    assert state["pending_choice"] is None
    assert "keeper_secret" not in json.dumps(state)


def test_public_state_hides_keeper_pending_choice_from_player_audience(tmp_path):
    campaign_id = "camp-keeper-choice"
    campaign = _seed_campaign(tmp_path, campaign_id)
    choice = {
        "choice_id": "san:bout",
        "kind": "bout_keeper_action",
        "command_id": "san",
        "responder": "keeper",
        "revision": 0,
        "prompt": "Advance the bout?",
        "options": [{"action": "tick", "label": "Advance"}],
    }
    (campaign / "save" / "subsystem-state.json").write_text(json.dumps({
        "pending_choices": {choice["choice_id"]: choice},
        "pending_contexts": {choice["choice_id"]: {"bout_result": "secret"}},
    }))

    assert _load().build_public_state(tmp_path, campaign_id)["pending_choice"] is None


def test_public_state_fails_closed_when_public_choice_contains_extra_private_field(tmp_path):
    campaign_id = "camp-forged-choice"
    campaign = _seed_campaign(tmp_path, campaign_id)
    choice = {
        "choice_id": "push-offer:confirm",
        "kind": "push_confirm",
        "command_id": "push-offer",
        "responder": "player",
        "revision": 0,
        "prompt": "Accept the announced consequence?",
        "options": [{"action": "cancel", "label": "Keep the failure"}],
        "private_effect": {"keeper_secret": "must not cross audience boundary"},
    }
    (campaign / "save" / "subsystem-state.json").write_text(json.dumps({
        "pending_choices": {choice["choice_id"]: choice},
        "pending_contexts": {},
    }))

    state = _load().build_public_state(tmp_path, campaign_id)

    assert state["pending_choice"] is None
    assert "keeper_secret" not in json.dumps(state)


def test_public_state_schema_lists_required_keys():
    schema = json.loads(Path("runtime/protocol/public_state.schema.json").read_text())
    required = set(schema["required"])
    assert {
        "schema_version",
        "campaign_id",
        "play_language",
        "active_scene_id",
        "tension_level",
        "turn_number",
        "discovered_clue_ids",
        "investigators",
        "brain",
        "pending_choice",
    }.issubset(required)
