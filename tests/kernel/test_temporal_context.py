"""Current TS RPC state, not fictional play: time-sensitive context and actual event precedence."""
from conftest import campaign_dir, create_campaign, open_turn, read_json
from pathlib import Path
import json
import shutil


def activity(**fields):
    return dict(summary="The established local situation.", basis="established", **fields)


def apply(client, ordinal, *effects):
    return client.table("apply", call_id=f"t1-c{ordinal}", effects=list(effects))


def scene(**fields):
    return dict(kind="scene", name="here", activity=activity(**fields), why="The local practice was established.")


def world(client):
    return read_json(campaign_dir(client.workspace) / "world.json")


def person(client):
    return client.table("capsule")["present"][0]["name"]


def npc(name, state, basis="observed"):
    return dict(kind="npc", name=name, activity=dict(summary="The person's actual activity.", basis=basis, wakefulness=state), why="An actual local event changed their activity.")


def test_old_save_projects_need_without_inventing_records(kernel):
    open_turn(kernel, "I look around.")
    capsule = kernel.table("capsule")
    temporal = capsule["where"]["temporal"]
    assert temporal["review_required"] is True
    assert temporal["review_reasons"] == ["unassessed"]
    assert "scene_activity" not in world(kernel)
    assert "npc_activity" not in world(kernel)
    assert "temporal" in kernel.table("look", focus="scene")["where"]
    assert capsule["present"], "The old save has an ordinary person to reassess."
    for entry in capsule["present"]:
        assert entry["activity"] == dict(current=False, review_required=True, review_reasons=["unassessed"])
        assert kernel.table("look", focus="npc", name=entry["name"])["activity"] == entry["activity"]


def test_precise_review_boundary_inside_same_day_part_does_not_auto_close(kernel):
    open_turn(kernel, "I wait until late afternoon.")
    apply(kernel, 1, dict(kind="time", until=dict(days=0, time="16:55"), why="The chosen wait elapsed."))
    apply(kernel, 2, scene(service="open", crowd="active", review_after_minutes=5))
    before = kernel.table("capsule")["where"]["temporal"]
    assert before["current"] is True
    apply(kernel, 3, dict(kind="time", minutes=5, why="Five minutes actually passed."))
    after = kernel.table("capsule")["where"]["temporal"]
    assert after["recorded_clock"]["day_part"] == kernel.table("capsule")["where"]["clock"]["day_part"]
    assert after["review_reasons"] == ["review_boundary_reached"]
    assert after["current"] is False
    assert after["service"] == "open", "An old fact is retained, not a newly invented closure."
    apply(kernel, 4, scene(service="closed", crowd="quiet"))
    assert kernel.table("capsule")["where"]["temporal"]["service"] == "closed"
    assert kernel.table("capsule")["where"]["temporal"]["current"] is True


def test_night_changes_applicability_not_the_recorded_world(kernel):
    open_turn(kernel, "I wait overnight.")
    apply(kernel, 1, scene(service="open", crowd="active"))
    old_scene = world(kernel)["active_scene"]
    apply(kernel, 2, dict(kind="time", until=dict(days=1, time="03:00"), why="The selected interval elapsed."))
    view = kernel.table("capsule")["where"]["temporal"]
    assert {"day_changed", "day_part_changed"} <= set(view["review_reasons"])
    assert view["current"] is False
    assert world(kernel)["active_scene"] == old_scene
    assert view["service"] == "open"


def test_awakened_person_survives_routine_guess_and_five_minutes(kernel):
    open_turn(kernel, "I knock on the door.")
    name = person(kernel)
    apply(kernel, 1, npc(name, "asleep"))
    apply(kernel, 2, npc(name, "awake", "established"))
    refused = kernel.table_err("apply", call_id="t1-c3", effects=[npc(name, "asleep", "inferred")])
    assert refused["details"]["reason"] == "activity_basis"
    apply(kernel, 3, dict(kind="time", minutes=5, why="Five minutes of the encounter passed."))
    card = next(p for p in kernel.table("capsule")["present"] if p["name"] == name)
    assert card["activity"]["wakefulness"] == "awake"
    assert card["activity"]["current"] is True
    named = kernel.table("look", focus="npc", name=name)
    assert named["activity"]["wakefulness"] == "awake"
    assert "unconscious" not in named.get("state", {}).get("conditions", [])


def test_invalid_activity_rolls_back_time_and_scene_atomically(kernel):
    open_turn(kernel, "I look around.")
    before = world(kernel)
    invalid = npc(person(kernel), "impossible_state")
    refused = kernel.table_err("apply", call_id="t1-c1", effects=[dict(kind="time", minutes=7), scene(service="closed"), invalid])
    assert refused["code"] == "invalid_params"
    assert world(kernel) == before


def test_context_effects_replay_without_moving_or_transferring_objects(kernel):
    open_turn(kernel, "I look through the window.")
    before = world(kernel)
    first = apply(kernel, 1, scene(service="closed", crowd="quiet"))
    replayed = apply(kernel, 1, scene(service="closed", crowd="quiet"))
    assert replayed.pop("replayed") is True
    assert replayed == first
    after = world(kernel)
    assert after["active_scene"] == before["active_scene"]
    assert after.get("npc_presence") == before.get("npc_presence")
    assert after.get("objects") == before.get("objects")
    assert after["clock"] == before["clock"]
    assert {key: value for key, value in after.items() if key != "scene_activity"} == before


def test_effect_order_binds_resulting_clock(kernel):
    open_turn(kernel, "I wait until night.")
    apply(kernel, 1, dict(kind="time", until=dict(days=0, time="23:30")), scene(service="closed", crowd="quiet"))
    view = kernel.table("capsule")["where"]["temporal"]
    assert view["recorded_clock"] == kernel.table("capsule")["where"]["clock"]
    assert view["current"] is True


def test_leaving_person_marks_record_for_review_without_erasing_observation(kernel):
    open_turn(kernel, "I say goodbye.")
    name = person(kernel)
    apply(kernel, 1, npc(name, "awake"))
    apply(kernel, 2, dict(kind="npc", name=name, to="away", why="They left."))
    view = kernel.table("look", focus="npc", name=name)["activity"]
    assert view["wakefulness"] == "awake"
    assert view["current"] is False
    assert "scene_changed" in view["review_reasons"]


def test_opening_context_initializes_only_active_scene(kernel):
    create_campaign(kernel)
    kernel.table("open")
    kernel.table("apply", call_id="t0-c1", effects=[scene(service="limited", crowd="quiet")])
    assert kernel.table("capsule")["where"]["temporal"]["service"] == "limited"
    refused = kernel.table_err("apply", call_id="t0-c2", effects=[dict(scene(service="closed"), name="hall-of-records")])
    assert refused["code"] == "invalid_params"


def test_daily_life_table_is_mod_owned_and_disabled_strategy_keeps_world_facts(kernel):
    open_turn(kernel, "I knock.")
    name = person(kernel)
    apply(kernel, 1, npc(name, "awake", "observed"), scene(service="closed", crowd="quiet"))
    tables = kernel.ok("mods.temporal_context", {"campaign": "c1"})["tables"]
    daily = next(table for table in tables if table["mod"] == "daily-life")
    assert {"residential-rest", "residential-night-street", "night-entertainment"} <= {item["id"] for item in daily["items"]}
    kernel.table("narrate", call_id="t1-c2", text="The resident remains awake, and the public counter is closed.")
    kernel.ok("mods.configure", {"campaign": "c1", "id": "daily-life", "enabled": False})
    kernel.table("player_input", text="I wait a moment.")
    capsule = kernel.table("capsule")
    assert "temporal_context" not in capsule["mods"]
    assert kernel.ok("mods.temporal_context", {"campaign": "c1"})["tables"] == []
    assert capsule["where"]["temporal"]["service"] == "closed"
    assert next(p for p in capsule["present"] if p["name"] == name)["activity"]["wakefulness"] == "awake"


def test_daily_life_guidance_does_not_displace_existing_package_instructions(kernel):
    open_turn(kernel, "I look around.")
    instructions = kernel.table("capsule")["mods"]["instructions"]
    assert not any(item["mod"] == "daily-life" for item in instructions)
    assert all(item["form"] == "full" for item in instructions)
    daily = next(table for table in kernel.ok("mods.temporal_context", {"campaign": "c1"})["tables"] if table["mod"] == "daily-life")
    assert "where.temporal" in daily["guidance"]
    host = kernel.ok("mods.context", {"campaign": "c1"})
    assert all(item["form"] == "full" for item in host["instructions"])


def test_temporal_threshold_uses_the_configured_numeric_setting(kernel):
    create_campaign(kernel)
    kernel.ok("mods.configure", {"campaign": "c1", "id": "daily-life", "settings": {"threshold": 0.8}})
    tables = kernel.ok("mods.temporal_context", {"campaign": "c1"})["tables"]
    assert next(table for table in tables if table["mod"] == "daily-life")["threshold"] == 0.8


def test_temporal_table_validation_rejects_duplicate_items_before_install(kernel, tmp_path):
    source = Path(__file__).resolve().parents[2] / "mods" / "daily-life"
    package = tmp_path / "invalid-life"
    shutil.copytree(source, package)
    manifest = json.loads((package / "mod.json").read_text())
    manifest["id"] = "invalid-life"
    manifest["default_enabled"] = False
    (package / "mod.json").write_text(json.dumps(manifest))
    table = json.loads((package / "contexts.json").read_text())
    table["items"].append(table["items"][0])
    (package / "contexts.json").write_text(json.dumps(table))
    error = kernel.err("mods.install", {"path": str(package)})
    assert error["code"] == "invalid_params"
    assert "distinct semantic slugs" in error["message"]
