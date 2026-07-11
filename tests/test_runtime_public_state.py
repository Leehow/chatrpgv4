import importlib.util
import json
import random
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator


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
    assert state["state_health"]["status"] == "degraded"
    assert {issue["code"] for issue in state["state_health"]["issues"]} == {"missing"}


@pytest.mark.parametrize("payload,code", [
    (b"{not-json", "invalid_json"), (b"\xff\xfe", "invalid_utf8"),
    (b"[]", "non_object"),
])
def test_public_state_corruption_is_backed_up_and_reported_once(tmp_path, payload, code):
    campaign = _seed_campaign(tmp_path)
    world_path = campaign / "save" / "world-state.json"
    world_path.write_bytes(payload)

    first = _load().build_public_state(tmp_path, "camp-1")
    second = _load().build_public_state(tmp_path, "camp-1")

    assert first["active_scene_id"] is None
    assert first["state_health"]["status"] == "error"
    assert {"state": "world", "code": code} in first["state_health"]["issues"]
    assert first["state_health"] == second["state_health"]
    assert "path" not in json.dumps(first["state_health"])
    assert str(tmp_path) not in json.dumps(first["state_health"])
    assert len(list(world_path.parent.glob("world-state.json.corrupt-*"))) == 1
    warnings = list(campaign.rglob("state-warnings.jsonl"))
    assert len(warnings) == 1
    assert len(warnings[0].read_text(encoding="utf-8").splitlines()) == 1


def test_public_state_forward_schema_is_an_error_without_corrupt_backup(tmp_path):
    campaign = _seed_campaign(tmp_path)
    world_path = campaign / "save" / "world-state.json"
    world_path.write_text(
        json.dumps({"schema_version": 3, "active_scene_id": "future-private-scene"}),
        encoding="utf-8",
    )

    state = _load().build_public_state(tmp_path, "camp-1")

    assert state["active_scene_id"] is None
    assert state["state_health"]["status"] == "error"
    assert {"state": "world", "code": "forward_version"} in state["state_health"]["issues"]
    assert list(world_path.parent.glob("world-state.json.corrupt-*")) == []
    assert "future-private-scene" not in json.dumps(state)


@pytest.mark.parametrize("bad_version", [True, False, "1", None, 1.0, "nope"])
def test_public_state_schema_version_requires_non_bool_integer(tmp_path, bad_version):
    campaign = _seed_campaign(tmp_path)
    world_path = campaign / "save" / "world-state.json"
    world_path.write_text(json.dumps({
        "schema_version": bad_version,
        "active_scene_id": "PRIVATE_INVALID_SCHEMA_SCENE",
        "discovered_clue_ids": ["PRIVATE_INVALID_SCHEMA_CLUE"],
    }))
    state = _load().build_public_state(tmp_path, "camp-1")
    assert state["active_scene_id"] is None
    assert state["discovered_clue_ids"] == []
    assert {"state": "world", "code": "invalid_schema"} in state["state_health"]["issues"]
    assert "PRIVATE_INVALID_SCHEMA" not in json.dumps(state)


def test_specified_missing_investigator_never_falls_back_to_another(tmp_path):
    _seed_campaign(tmp_path)
    state = _load().build_public_state(tmp_path, "camp-1", "inv-missing")
    assert state["investigators"] == []
    assert {"state": "investigator", "code": "missing"} in state["state_health"]["issues"]


@pytest.mark.parametrize("filename", [
    "subsystem-state.json", "combat.json", "sanity.json", "chase.json",
])
def test_direct_public_state_rejects_consumed_state_symlink_escape(tmp_path, filename):
    campaign = _seed_campaign(tmp_path)
    outside = tmp_path / f"outside-{filename}"
    outside.write_text("{}")
    path = campaign / "save" / filename
    path.symlink_to(outside)
    with pytest.raises(ValueError, match="escapes containment"):
        _load().build_public_state(tmp_path, "camp-1", "inv-alice")


def test_public_state_drops_untyped_fields_and_raw_legacy_pending_choice(tmp_path):
    campaign = _seed_campaign(tmp_path)
    world_path = campaign / "save" / "world-state.json"
    world_path.write_text(
        json.dumps({
            "schema_version": 1,
            "active_scene_id": {"private": "not a scene ID"},
            "discovered_clue_ids": ["safe", {"keeper_secret": "no"}],
            "pending_choice": {
                "choice_id": "legacy",
                "private_effect": {"keeper_secret": "must not leak"},
            },
        }),
        encoding="utf-8",
    )
    (campaign / "campaign.json").write_text(
        json.dumps({"schema_version": 1, "play_language": ["not", "a", "string"]}),
        encoding="utf-8",
    )
    (campaign / "save" / "pacing-state.json").write_text(
        json.dumps({"schema_version": 1, "tension_level": {"secret": True}, "turn_number": "7"}),
        encoding="utf-8",
    )

    state = _load().build_public_state(tmp_path, "camp-1")

    assert state["active_scene_id"] is None
    assert state["play_language"] is None
    assert state["tension_level"] is None
    assert state["turn_number"] == 0
    assert state["discovered_clue_ids"] == ["safe"]
    assert state["pending_choice"] is None
    assert state["state_health"]["status"] == "degraded"
    assert "keeper_secret" not in json.dumps(state)


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
    subsystem_path = campaign / "save" / "subsystem-state.json"
    subsystem_path.write_text(json.dumps({
        "pending_choices": {choice["choice_id"]: choice},
        "pending_contexts": {
            choice["choice_id"]: {"keeper_secret": "do not expose this"},
        },
    }))
    before = subsystem_path.read_bytes()

    state = _load().build_public_state(tmp_path, campaign_id)

    assert state["pending_choice"] is None
    assert "keeper_secret" not in json.dumps(state)
    assert subsystem_path.read_bytes() == before


def test_public_state_reports_bool_subsystem_schema_without_projecting_contents(tmp_path):
    campaign = _seed_campaign(tmp_path)
    path = campaign / "save" / "subsystem-state.json"
    path.write_text(json.dumps({
        "schema_version": True,
        "pending_choices": {"secret": {"responder": "player"}},
        "keeper_secret": "DO NOT PROJECT",
    }))
    state = _load().build_public_state(tmp_path, "camp-1", "inv-alice")
    assert state["pending_choice"] is None
    assert {"state": "subsystem", "code": "invalid_schema"} in state["state_health"]["issues"]
    assert "DO NOT PROJECT" not in json.dumps(state)


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
        "state_health",
    }.issubset(required)
    assert schema["additionalProperties"] is False
    health = schema["properties"]["state_health"]
    assert health["additionalProperties"] is False
    assert health["properties"]["status"]["enum"] == ["ok", "degraded", "error"]


@pytest.mark.parametrize("filename,state_name", [
    ("subsystem-state.json", "subsystem"),
    ("combat.json", "combat"),
    ("sanity.json", "sanity"),
    ("chase.json", "chase"),
])
def test_public_state_json_schema_accepts_all_auxiliary_health_states(
    tmp_path, filename, state_name,
):
    campaign = _seed_campaign(tmp_path)
    (campaign / "save" / filename).write_text(json.dumps({"schema_version": True}))
    state = _load().build_public_state(tmp_path, "camp-1", "inv-alice")
    assert {"state": state_name, "code": "invalid_schema"} in state["state_health"]["issues"]
    schema = json.loads(Path("runtime/protocol/public_state.schema.json").read_text())
    Draft202012Validator(schema).validate(state)
