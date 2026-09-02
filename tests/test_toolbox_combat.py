"""Behavior tests owned by the combat operation cell."""
from toolbox_test_support import *


def _prime_typed_action_combat(campaign_ws, *, npc_first=False):
    investigator_id = campaign_ws["investigator_id"]
    ctx = coc_toolbox.Ctx(campaign_ws["workspace"], campaign_ws["campaign_id"])
    sheet = ctx.sheet(investigator_id)
    profile = coc_toolbox._investigator_combat_profile(
        ctx, investigator_id, character_snapshot=sheet,
    )
    session = coc_combat.CombatSession(
        "combat-typed-actions", "scene/typed-actions", 1, random.Random(1),
    )
    session.add_participant(**{
        key: value for key, value in profile.items()
        if key != "hp_current"
    })
    session.participants[investigator_id]["hp_current"] = profile["hp_current"]
    session.add_participant(
        "npc-typed-target", "npc", dex=99 if npc_first else 1,
        combat_skill=25, dodge_skill=20,
        build=0, hp_max=10, weapons=[{"weapon_id": "unarmed"}],
    )
    session.begin_round()
    session.revision = 1
    session.save(campaign_ws["campaign_dir"])
    return session


@pytest.mark.parametrize(
    ("action_kind", "extra", "expected_hint"),
    [
        ("aim", {"weapon_id": "revolver_38_or_9mm"}, "aim"),
        ("reload", {"weapon_id": "revolver_38_or_9mm"}, "reload"),
        ("maneuver", {
            "target_npc_id": "npc-typed-target",
            "goal": "push",
            "defense_kind": "none",
        }, "maneuver"),
        ("flee", {}, "flee"),
    ],
)
def test_combat_resolve_supports_explicit_non_attack_actions(
    campaign_ws, action_kind, extra, expected_hint,
):
    _prime_typed_action_combat(campaign_ws)
    args = {
        "action_kind": action_kind,
        "investigator": campaign_ws["investigator_id"],
        "combat_revision": 1,
        "decision_id": f"typed-{action_kind}-1",
        **extra,
    }
    first = _run(campaign_ws, "combat.resolve", args)
    assert first["ok"] is True, first
    turn = next(
        event["turn"] for event in first["data"]["events"]
        if event.get("event_type") == "combat_turn_resolved"
    )
    assert turn["resolution_hint"] == expected_hint
    replay = _run(campaign_ws, "combat.resolve", args)
    assert replay["ok"] is True
    assert replay["data"] == first["data"]


def test_combat_resolve_rejects_invalid_action_and_stale_revision(campaign_ws):
    _prime_typed_action_combat(campaign_ws)
    invalid = _run(campaign_ws, "combat.resolve", {
        "action_kind": "wait-for-keyword",
        "investigator": campaign_ws["investigator_id"],
        "decision_id": "typed-invalid-action",
    })
    assert invalid["ok"] is False
    assert invalid["error"]["code"] == "invalid_param"
    stale = _run(campaign_ws, "combat.resolve", {
        "action_kind": "flee",
        "investigator": campaign_ws["investigator_id"],
        "combat_revision": 0,
        "decision_id": "typed-stale-flee",
    })
    assert stale["ok"] is False
    assert stale["error"]["code"] == "stale_combat_revision"


def _move_to_confrontation(campaign_ws):
    """Arrange-only: put the investigator where the fight happens.

    `state.move_scene` belongs to the scene-advisory cell. Keeping the call in
    a helper rather than a test body is what lets this file's tests exercise
    only combat operations, which is the ownership seam the architecture suite
    enforces.
    """
    moved = _run(campaign_ws, "state.move_scene", {
        "scene_id": "corbitt-confrontation",
        "decision_id": "typed-actions-move-to-corbitt",
    })
    assert moved["ok"] is True
    return moved


def test_combat_resolve_explicit_attack_preserves_legacy_route_and_replay(campaign_ws):
    _move_to_confrontation(campaign_ws)
    args = {
        "action_kind": "attack",
        "affordance_id": "conventional-assault",
        "investigator": campaign_ws["investigator_id"],
        "weapon_id": "unarmed",
        "decision_id": "typed-explicit-attack",
        "seed": 7,
    }
    first = _run(campaign_ws, "combat.resolve", args)
    assert first["ok"] is True, first
    assert any(
        event.get("event_type") == "combat_turn_resolved"
        for event in first["data"]["events"]
    )
    replay = _run(campaign_ws, "combat.resolve", args)
    assert replay["data"] == first["data"]


def test_combat_resolve_explicit_defend_binds_pending_attack_and_replays(campaign_ws):
    session = _prime_typed_action_combat(campaign_ws, npc_first=True)
    investigator_id = campaign_ws["investigator_id"]
    session.pending_attack = {
        "attack_command_id": "typed-pending-attack",
        "actor_id": "npc-typed-target",
        "target_actor_id": investigator_id,
        "declared_intent": "structured incoming attack",
        "resolution_hint": "opposed_melee",
        "weapon_id": "unarmed",
        "rulebook_exception": None,
        "on_success": None,
        "victory_outcome": None,
        "defeat_outcome": None,
        "allowed_defenses": ["dodge", "fight_back"],
    }
    session.revision = 2
    session.save(campaign_ws["campaign_dir"])
    args = {
        "action_kind": "defend",
        "defense_kind": "dodge",
        "combat_revision": 2,
        "investigator": investigator_id,
        "decision_id": "typed-explicit-defend",
        "seed": 3,
    }
    first = _run(campaign_ws, "combat.resolve", args)
    assert first["ok"] is True, first
    turn = next(
        event["turn"] for event in first["data"]["events"]
        if event.get("event_type") == "combat_turn_resolved"
    )
    assert turn["defense_kind"] == "dodge"
    replay = _run(campaign_ws, "combat.resolve", args)
    assert replay["data"] == first["data"]

def test_bonus_die_only_combat_success_preserves_06_66_evidence_without_tick(
    campaign_ws,
):
    investigator_id = campaign_ws["investigator_id"]
    session = coc_combat.CombatSession(
        "combat-bonus-tick",
        "scene/bonus-tick",
        0,
        random.Random(0),
    )
    session.add_participant(
        investigator_id,
        "investigator",
        dex=50,
        combat_skill=50,
        build=0,
        hp_max=10,
    )
    outcome, record = session._percentile(
        investigator_id,
        "Spot Hidden",
        50,
        "notice the hidden attacker",
        bonus=1,
    )
    assert outcome == "extreme"
    assert record["roll"] == 6
    assert record["tens_values"] == [6, 0]
    assert record["units"] == 6
    assert record["effective_modifier"] == {
        "bonus": 1,
        "penalty": 0,
        "net": 1,
    }
    assert record["bonus_die_only_success"] is True
    assert record["excluded_outcome"] == "bonus_die_only_success"
    assert record["unmodified_roll"] == 66
    pending_rolls, pending_events = session.drain_pending()
    assert pending_rolls == [record]
    assert pending_events == []

    state_path = (
        campaign_ws["campaign_dir"]
        / "save"
        / "investigator-state"
        / f"{investigator_id}.json"
    )
    legacy_tick_path = (
        campaign_ws["coc_root"]
        / "investigators"
        / investigator_id
        / "development.jsonl"
    )
    state_before = state_path.read_bytes()
    legacy_before = legacy_tick_path.read_bytes()
    ctx = coc_toolbox.Ctx(campaign_ws["workspace"], campaign_ws["campaign_id"])
    recorded = coc_toolbox._record_combat_improvement_ticks(
        ctx,
        investigator_id=investigator_id,
        events=[{"event_type": "combat_roll", **pending_rolls[0]}],
    )
    assert recorded == []
    assert state_path.read_bytes() == state_before
    assert legacy_tick_path.read_bytes() == legacy_before

    natural = coc_combat.CombatSession(
        "combat-natural-bonus-order",
        "scene/bonus-tick",
        0,
        random.Random(5),
    )
    natural.add_participant(
        investigator_id,
        "investigator",
        dex=50,
        combat_skill=50,
        build=0,
        hp_max=10,
    )
    natural_outcome, natural_record = natural._percentile(
        investigator_id,
        "Spot Hidden",
        50,
        "notice without needing the bonus die",
        bonus=1,
    )
    assert natural_outcome == "regular"
    assert natural_record["tens_values"] == [4, 5]
    assert natural_record["units"] == 9
    assert natural_record["roll"] == 49
    assert natural_record["unmodified_roll"] == 49
    assert natural_record["bonus_die_only_success"] is False
    assert natural_record["excluded_outcome"] is None
    assert coc_toolbox.coc_development.skill_tick_eligible(
        "Spot Hidden", natural_record
    ) is True
