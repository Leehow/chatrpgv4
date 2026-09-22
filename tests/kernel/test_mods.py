"""Mod behavior through the public kernel RPC seam; fixtures are not playtest evidence."""
import json
import hashlib
from pathlib import Path

from conftest import CAMPAIGN, RpcClient, campaign_dir, create_campaign, narrate, open_turn, read_json
from test_rules_families import walk_to_confrontation


def weapon(name="Workshop launcher"):
    return {"name":name, "category":"weapon", "description":"An improvised single-shot launcher.",
            "basis":"Fixture: a single-shot firearm profile; numbers are test data.",
            "parameters":{"skill":"Firearms (Rifle/Shotgun)", "damage":"1D6", "base_range_yards":30,
                          "uses_per_round":1, "magazine":1, "malfunction":95, "impale":False, "adds_damage_bonus":False},
            "player_view":{"description":"An improvised launcher.", "fields":["damage", "magazine"]}}


def prepared(kernel, draft):
    request = {"name":draft["name"], "category":draft["category"], "description":draft["description"]}
    job = kernel.ok("mods.job", {"campaign":CAMPAIGN, "role":"create", "input":request})
    Path(job["cwd"], "result.json").write_text(json.dumps(draft))
    accepted = kernel.ok("mods.accept", {"campaign":CAMPAIGN, "job":job["job"]})
    return {"kind":"define", **request, "_definition":accepted["definition"], "_provenance":accepted["provenance"]}


def prefetch_object(kernel, call_id="t1-c1"):
    draft = {"name":"Wooden rod", "category":"item", "description":"A solid wooden rod.",
             "basis":"Fixture physical facts", "parameters":{"effects":[]},
             "player_view":{"description":"A wooden rod.", "fields":[]}}
    kernel.table("apply", call_id=call_id, effects=[prepared(kernel, draft),
        {"kind":"object", "name":"My rod", "definition":draft["name"], "to":"Thomas Hayes"}])


def prefetch_usage(name="Swing"):
    return {"name":name, "description":"Swing the solid rod as a club.", "basis":"Fixture club profile",
            "mode":"melee", "parameters":{"skill":"Fighting (Brawl)", "damage":"1D6", "uses_per_round":1,
                                             "impale":False, "adds_damage_bonus":True},
            "player_view":{"description":"A club swing.", "fields":["damage"]}}


def proposal_job(kernel):
    return kernel.ok("mods.job", {"campaign":CAMPAIGN, "role":"usage", "input":{"object":"My rod", "propose":True}})


def accept_proposal(kernel, job, draft):
    Path(job["cwd"], "result.json").write_text(json.dumps(draft))
    return kernel.ok("mods.prefetch.accept", {"campaign":CAMPAIGN, "job":job["job"]})


def test_prefetch_accept_outside_turn_is_idempotent_without_action_side_effects(kernel):
    open_turn(kernel)
    prefetch_object(kernel)
    narrate(kernel, "t1-c2", "The rod rests beside the desk.")
    folder = campaign_dir(kernel.workspace)
    before_world = read_json(folder / "world.json")
    before_turn = (folder / "turn.json").read_bytes()
    before_events = (folder / "events.jsonl").read_bytes()
    job = proposal_job(kernel)
    identity = read_json(Path(job["cwd"], "identity.json"))
    assert "turn" not in identity and identity["prefetch"] is True
    assert read_json(Path(job["cwd"], "request.json"))["receipts"] == []
    accepted = accept_proposal(kernel, job, prefetch_usage())
    assert accepted["provenance"]["prefetched"] is True
    assert kernel.ok("mods.prefetch.accept", {"campaign":CAMPAIGN, "job":job["job"]}) == accepted
    after = read_json(folder / "world.json")
    records = after["objects"].pop("usages")
    before_world["objects"].pop("usages", None)
    assert after == before_world
    assert len(records) == 1 and next(iter(records.values()))["provenance"] == accepted["provenance"]
    assert (folder / "turn.json").read_bytes() == before_turn
    assert (folder / "events.jsonl").read_bytes() == before_events
    kernel.table("player_input", text="I inspect the rod.")
    again = proposal_job(kernel)
    assert again["job"] == job["job"] and again["accepted"] is True
    assert kernel.ok("mods.prefetch.accept", {"campaign":CAMPAIGN, "job":job["job"]}) == accepted


def test_prefetch_resolve_reuses_record_without_new_creator_job(seeded_kernel):
    kernel = seeded_kernel
    open_turn(kernel)
    n = walk_to_confrontation(kernel)
    prefetch_object(kernel, f"t1-c{n}")
    job = proposal_job(kernel)
    narrate(kernel, f"t1-c{n+1}", "I hold the rod ready.")
    kernel.table("player_input", text="I swing the rod at Walter Corbitt.")
    accepted = accept_proposal(kernel, job, prefetch_usage())
    folder = campaign_dir(kernel.workspace)
    usage = next(iter(read_json(folder / "world.json")["objects"]["usages"].values()))
    jobs_before = sorted(Path(job["cwd"]).parent.iterdir())
    result = kernel.table("resolve", call_id="t2-c1", action={"intent":"combat", "object":"My rod", "usage":"Swing",
        "target":"Walter Corbitt", "defense":"none"})
    assert result["outcome"]
    assert sorted(Path(job["cwd"]).parent.iterdir()) == jobs_before
    combat = read_json(folder / "save/combat.json")
    assert usage["id"] in combat["weapon_catalog"]
    assert combat["weapon_catalog"][usage["id"]]["object_id"] == usage["object_id"]
    assert combat["weapon_catalog"][usage["id"]]["damage"] == accepted["usage"]["parameters"]["damage"]
    replay = kernel.ok("mods.job", {"campaign":CAMPAIGN, "role":"usage",
        "input":{"object":"My rod", "name":"Swing", "description":"Reuse the known swing."}})
    assert replay["accepted"] is True
    ordinary = kernel.ok("mods.accept", {"campaign":CAMPAIGN, "job":replay["job"]})
    assert ordinary["provenance"]["reused_usage"] == usage["id"]
    assert "prefetched" not in ordinary["provenance"]


def test_prefetch_and_action_records_share_physical_invalidation(kernel):
    open_turn(kernel)
    prefetch_object(kernel)
    job = proposal_job(kernel)
    accept_proposal(kernel, job, prefetch_usage())
    request = {"object":"My rod", "name":"Strike", "description":"Strike with the rod."}
    action_job = kernel.ok("mods.job", {"campaign":CAMPAIGN, "role":"usage", "input":request})
    Path(action_job["cwd"], "result.json").write_text(json.dumps(prefetch_usage("Strike")))
    action_usage = kernel.ok("mods.accept", {"campaign":CAMPAIGN, "job":action_job["job"]})
    kernel.table("apply", call_id="t1-c2", effects=[{"kind":"usage", **request, "_usage":action_usage}])
    kernel.table("apply", call_id="t1-c3", effects=[{"kind":"object", "name":"My rod", "from":"Thomas Hayes", "to":"Thomas Hayes", "condition":"broken", "why":"The rod snapped against the stone wall."}])
    look = kernel.table("look", focus="object", name="My rod")
    assert len(look["instance"]["usages"]) == 2 and all(not usage["applicable"] for usage in look["instance"]["usages"])
    for usage in ("Swing", "Strike"):
        error = kernel.table_err("resolve", call_id="t1-c4", action={"intent":"combat", "object":"My rod", "usage":usage,
            "target":"Steven Knott", "defense":"none"})
        assert error["details"]["reason"] == "usage_required"
    assert kernel.err("mods.prefetch.accept", {"campaign":CAMPAIGN, "job":job["job"]})["details"]["reason"] == "usage_stale"
    assert proposal_job(kernel)["job"] != job["job"]


def test_prefetch_negative_result_is_retained_and_deduplicated(kernel):
    open_turn(kernel)
    prefetch_object(kernel)
    job = proposal_job(kernel)
    folder = campaign_dir(kernel.workspace)
    before = (folder / "world.json").read_bytes()
    accepted = accept_proposal(kernel, job, None)
    assert accepted["usage"] is None and accepted["provenance"]["prefetched"] is True
    assert read_json(Path(job["cwd"], "accepted.json")) == accepted
    assert (folder / "world.json").read_bytes() == before
    narrate(kernel, "t1-c2", "I put the rod aside.")
    kernel.table("player_input", text="I wait.")
    assert proposal_job(kernel)["job"] == job["job"]
    assert proposal_job(kernel)["accepted"] is True
    assert kernel.ok("mods.prefetch.accept", {"campaign":CAMPAIGN, "job":job["job"]}) == accepted
    telemetry = [json.loads(line) for line in (folder / "telemetry.jsonl").read_text().splitlines()]
    assert any(r.get("event") == "usage_prefetch_accepted" and r.get("negative") is True for r in telemetry)


def test_prefetch_entry_does_not_relax_action_turn_binding(kernel):
    open_turn(kernel)
    prefetch_object(kernel)
    proposal = proposal_job(kernel)
    assert kernel.err("mods.accept", {"campaign":CAMPAIGN, "job":proposal["job"]})["details"]["reason"] == "prefetch_accept_required"
    action_job = kernel.ok("mods.job", {"campaign":CAMPAIGN, "role":"usage",
        "input":{"object":"My rod", "name":"Swing", "description":"Swing the rod."}})
    Path(action_job["cwd"], "result.json").write_text(json.dumps(prefetch_usage()))
    assert kernel.err("mods.prefetch.accept", {"campaign":CAMPAIGN, "job":action_job["job"]})["details"]["reason"] == "action_accept_required"
    narrate(kernel, "t1-c2", "I wait with the rod.")
    kernel.table("player_input", text="I change my mind.")
    error = kernel.err("mods.accept", {"campaign":CAMPAIGN, "job":action_job["job"]})
    assert error["code"] == "invalid_params" and "another turn" in error["message"]
    assert not Path(action_job["cwd"], "accepted.json").exists()


def test_prefetch_rejects_changed_request_without_registering(kernel):
    open_turn(kernel)
    prefetch_object(kernel)
    job = proposal_job(kernel)
    request_path = Path(job["cwd"], "request.json")
    request = read_json(request_path)
    request["usage_object"]["state"]["condition"] = "broken"
    request_path.write_text(json.dumps(request))
    Path(job["cwd"], "result.json").write_text(json.dumps(prefetch_usage()))
    error = kernel.err("mods.prefetch.accept", {"campaign":CAMPAIGN, "job":job["job"]})
    assert error["details"]["reason"] == "usage_request_changed"
    assert not Path(job["cwd"], "accepted.json").exists()
    assert not read_json(campaign_dir(kernel.workspace) / "world.json")["objects"].get("usages")


def test_prefetch_records_survive_generator_disable(kernel):
    open_turn(kernel)
    prefetch_object(kernel)
    accept_proposal(kernel, proposal_job(kernel), prefetch_usage())
    narrate(kernel, "t1-c2", "I keep the rod.")
    kernel.ok("mods.configure", {"campaign":CAMPAIGN, "id":"enhanced-items", "enabled":False})
    kernel.table("player_input", text="I examine the rod.")
    assert proposal_job(kernel)["enabled"] is False
    look = kernel.table("look", focus="object", name="My rod")
    assert look["instance"]["usages"][0]["applicable"] is True
    assert any(w.get("usage") == "Swing" for w in kernel.table("view")["investigators"][0]["weapons"])


def test_prefetch_worldline_snapshot_keeps_records_but_jobs_cannot_cross(kernel):
    from test_worldline import fork
    open_turn(kernel)
    prefetch_object(kernel)
    job = proposal_job(kernel)
    accepted = accept_proposal(kernel, job, prefetch_usage())
    narrate(kernel, "t1-c2", "I keep the rod ready.")
    records = read_json(campaign_dir(kernel.workspace) / "world.json")["objects"]["usages"]
    fork(kernel, 2, "side")
    assert read_json(campaign_dir(kernel.workspace) / "world.json")["objects"]["usages"] == records
    assert next(iter(records.values()))["provenance"] == accepted["provenance"]
    error = kernel.err("mods.prefetch.accept", {"campaign":CAMPAIGN, "job":job["job"]})
    assert "worldline" in error["message"]
    assert proposal_job(kernel)["job"] != job["job"]


def prefetch_targets(kernel):
    return kernel.ok("mods.prefetch.targets", {"campaign":CAMPAIGN})


def retained_tree(path):
    paths = [path, *path.rglob("*")] if path.exists() else []
    return {str(p.relative_to(path)): (p.stat().st_mtime_ns, p.read_bytes() if p.is_file() else None)
            for p in paths}


def test_prefetch_targets_scope_owner_and_unbounded_read_only_projection(kernel):
    open_turn(kernel)
    folder = campaign_dir(kernel.workspace)
    jobs = kernel.workspace / ".coc" / "mods" / "jobs"
    before = (retained_tree(folder), retained_tree(jobs))
    assert prefetch_targets(kernel)["instances"] == []
    assert (retained_tree(folder), retained_tree(jobs)) == before
    prefetch_object(kernel)
    placements = [("Scene rod", "here"), ("NPC rod", "Steven Knott"),
                  ("Remote rod", "corbitt-house-ground"), ("Nested rod", "My rod"),
                  ("Remote nested rod", "Remote rod")]
    placements.extend((f"Scene rod {index}", "here") for index in range(25))
    kernel.table("apply", call_id="t1-c2", effects=[
        {"kind":"object", "name":name, "definition":"Wooden rod", "to":owner}
        for name, owner in placements])
    before = (retained_tree(folder), retained_tree(jobs))
    result = prefetch_targets(kernel)
    assert (retained_tree(folder), retained_tree(jobs)) == before
    instances = {item["name"]:item for item in result["instances"]}
    assert set(instances) == {"My rod", "Scene rod", "NPC rod", "Nested rod", *[f"Scene rod {i}" for i in range(25)]}
    world = read_json(folder / "world.json")
    assert instances["My rod"]["owner"] == world["objects"]["instances"][instances["My rod"]["id"]]["owner"]
    assert instances["My rod"]["owner"]["kind"] == "investigator"
    assert instances["NPC rod"]["owner"]["kind"] == "npc"
    assert instances["Scene rod"]["owner"]["id"] == result["active_scene"]
    assert instances["Nested rod"]["owner"] == {"kind":"other", "id":instances["My rod"]["id"], "name":"My rod"}
    for item in instances.values():
        physical = world["objects"]["instances"][item["id"]]
        assert item["definition_digest"] == world["objects"]["definitions"][physical["definition"]]["digest"]
        assert item["condition"] == "intact"
        assert item["has_any_usage"] is False and item["covered"] is False


def test_prefetch_targets_positive_and_action_records_are_marked_even_when_stale(kernel):
    open_turn(kernel)
    prefetch_object(kernel)
    job = proposal_job(kernel)
    assert prefetch_targets(kernel)["instances"][0]["covered"] is False
    accept_proposal(kernel, job, prefetch_usage())
    item = prefetch_targets(kernel)["instances"][0]
    assert item["has_any_usage"] is True and item["covered"] is True
    kernel.table("apply", call_id="t1-c2", effects=[{"kind":"object", "name":"My rod", "from":"Thomas Hayes",
        "to":"Thomas Hayes", "condition":"broken", "why":"The rod snapped."}])
    item = prefetch_targets(kernel)["instances"][0]
    assert item["condition"] == "broken"
    assert item["has_any_usage"] is True and item["covered"] is False
    kernel.table("apply", call_id="t1-c3", effects=[{"kind":"object", "name":"Action rod", "definition":"Wooden rod", "to":"here"}])
    request = {"object":"Action rod", "name":"Swing", "description":"Swing the rod."}
    action = kernel.ok("mods.job", {"campaign":CAMPAIGN, "role":"usage", "input":request})
    Path(action["cwd"], "result.json").write_text(json.dumps(prefetch_usage()))
    accepted = kernel.ok("mods.accept", {"campaign":CAMPAIGN, "job":action["job"]})
    kernel.table("apply", call_id="t1-c4", effects=[{"kind":"usage", **request, "_usage":accepted}])
    item = next(item for item in prefetch_targets(kernel)["instances"] if item["name"] == "Action rod")
    assert item["has_any_usage"] is True and item["covered"] is False


def test_prefetch_targets_negative_coverage_worldline_and_state_are_read_only(kernel):
    from test_worldline import fork
    open_turn(kernel)
    prefetch_object(kernel)
    accept_proposal(kernel, proposal_job(kernel), None)
    folder = campaign_dir(kernel.workspace)
    jobs = kernel.workspace / ".coc" / "mods" / "jobs"
    def check():
        before = (retained_tree(folder), retained_tree(jobs))
        result = prefetch_targets(kernel)
        assert (retained_tree(folder), retained_tree(jobs)) == before
        meta, turn, world = (read_json(folder / name) for name in ("campaign.json", "turn.json", "world.json"))
        assert {key:result[key] for key in ("campaign", "worldline", "turn", "state", "pending_choice", "active_scene")} == {
            "campaign":CAMPAIGN, "worldline":meta["active_worldline"], "turn":turn["turn"],
            "state":turn["state"], "pending_choice":turn["pending_choice"], "active_scene":world["active_scene"]}
        return result["instances"][0]
    item = check()
    assert item["has_any_usage"] is False and item["covered"] is True
    narrate(kernel, "t1-c2", "I leave the rod alone.")
    assert check()["covered"] is True
    fork(kernel, 2, "side")
    assert check()["covered"] is False
    turn_path = folder / "turn.json"
    turn = read_json(turn_path)
    turn["pending_choice"] = {"kind":"fixture-choice", "options":["wait", "leave"]}
    turn_path.write_text(json.dumps(turn))
    check()


def test_initial_inventory_is_audited_without_being_mentioned_and_adopted_once(kernel):
    create_campaign(kernel)
    folder = campaign_dir(kernel.workspace)
    before = read_json(folder / "party" / "thomas-hayes.json")
    context = kernel.ok("mods.context", {"campaign":CAMPAIGN})
    assert any(r["name"] == "flashlight" for r in context["unregistered_equipment"])
    job = kernel.ok("mods.job", {"campaign":CAMPAIGN, "role":"audit", "input":{"text":"The landlord welcomes you."}})
    request = read_json(Path(job["cwd"]) / "request.json")
    assert any(r["name"] == "flashlight" for r in request["unregistered_equipment"])
    definition = prepared(kernel, weapon("flashlight"))
    result = kernel.table("apply", call_id="t0-c1", effects=[definition,
        {"kind":"object", "name":"flashlight", "to":"Thomas Hayes", "adopt":"flashlight"}])
    after = read_json(folder / "party" / "thomas-hayes.json")
    assert {k:v for k,v in before.items() if k not in {"equipment","weapons"}} == {k:v for k,v in after.items() if k not in {"equipment","weapons"}}
    assert len(after["equipment"]) == len(before["equipment"])
    assert "flashlight" not in after["equipment"]
    assert len([r for r in after["equipment"] if isinstance(r,dict) and r.get("name") == "flashlight"]) == 1
    assert next(r for r in after["weapons"] if r.get("object_id"))["damage"] == "1D6"
    receipts = kernel.table("status")["receipts"]
    assert any(r.get("adopted") == "flashlight" for r in receipts)
    assert not any(r.get("kind") == "item" for r in receipts)
    narrate(kernel, "t0-c2", "诺特坐在书桌后面。")
    kernel.table("open")
    assert not any(r["name"] == "flashlight" for r in kernel.ok("mods.context", {"campaign":CAMPAIGN})["unregistered_equipment"])
    kernel.table("player_input", text="我把手电交给诺特。")
    kernel.table("apply", call_id="t1-c1", effects=[{"kind":"object", "name":"flashlight", "from":"Thomas Hayes", "to":"Steven Knott",
        "handover":"given"}])
    final = read_json(folder / "party" / "thomas-hayes.json")
    assert not any((r if isinstance(r,str) else r.get("name")) == "flashlight" for r in final["equipment"])


def test_adoption_cannot_duplicate_or_change_existing_inventory_and_bad_batch_is_atomic(kernel):
    open_turn(kernel)
    folder = campaign_dir(kernel.workspace)
    before_sheet = (folder / "party" / "thomas-hayes.json").read_bytes()
    before_world = (folder / "world.json").read_bytes()
    definition = prepared(kernel, weapon("flashlight"))
    for effect in (
        {"kind":"object", "name":"flashlight", "to":"Thomas Hayes"},
        {"kind":"object", "name":"flashlight", "to":"Thomas Hayes", "adopt":"flashlight", "condition":"broken"},
        {"kind":"object", "name":"flashlight", "to":"Steven Knott", "adopt":"flashlight"},
    ):
        assert kernel.table_err("apply", call_id="t1-c1", effects=[definition,effect])["code"] == "invalid_params"
        assert (folder / "party" / "thomas-hayes.json").read_bytes() == before_sheet
        assert (folder / "world.json").read_bytes() == before_world
    error = kernel.table_err("apply", call_id="t1-c1", effects=[definition,
        {"kind":"object", "name":"flashlight", "to":"Thomas Hayes", "adopt":"flashlight"},
        {"kind":"object", "name":"another", "definition":"flashlight", "to":"No such owner"}])
    assert error["code"] == "unknown_entity"
    assert (folder / "party" / "thomas-hayes.json").read_bytes() == before_sheet
    assert (folder / "world.json").read_bytes() == before_world


def test_existing_equipment_state_is_preserved_and_executable_weapons_are_not_candidates(kernel):
    open_turn(kernel)
    path = campaign_dir(kernel.workspace) / "party" / "thomas-hayes.json"
    sheet = read_json(path)
    sheet["equipment"] = [{"name":"medical kit", "quantity":2, "charges":3, "condition":"damaged"}, ".38 Revolver"]
    path.write_text(json.dumps(sheet))
    pending = kernel.ok("mods.context", {"campaign":CAMPAIGN})["unregistered_equipment"]
    assert [r["name"] for r in pending] == ["medical kit"]
    draft = {"name":"medical kit", "category":"item", "description":"A partially spent medical kit.",
             "basis":"Fixture inventory state", "parameters":{"charges":8,"effects":[]},
             "player_view":{"description":"A used kit.", "fields":["charges"]}}
    kernel.table("apply", call_id="t1-c1", effects=[prepared(kernel,draft),
        {"kind":"object", "name":"medical kit", "to":"Thomas Hayes", "adopt":"medical kit"}])
    item = next(iter(read_json(campaign_dir(kernel.workspace) / "world.json")["objects"]["instances"].values()))
    assert item["quantity"] == 2 and item["state"]["charges"] == 3 and item["state"]["condition"] == "damaged"
    assert not kernel.ok("mods.context", {"campaign":CAMPAIGN})["unregistered_equipment"]


def test_first_impression_refusal_names_who_is_here_and_how_to_stage_the_target(seeded_kernel):
    """An impression needs a meeting, and the refusal has to be one the Keeper can act on.

    It used to be the bare sentence "The first-impression target must be present", with no `fix`
    and no `details`. A live table opened Masks in Bar Cordano and asked for three impressions in
    one message; every one was refused, because on an imported book the people are staged in the
    very turn they are met. The Keeper was told what was wrong and never what to do, and the empty
    `details` collapsed all three into one refusal class, which shut `resolve` for the turn.
    """
    kernel = seeded_kernel
    open_turn(kernel)
    kernel.table("apply", call_id="t1-c1", effects=[{"kind":"npc","name":"Steven Knott","to":"away","why":"他先走了"}])
    error = kernel.table_err("resolve", call_id="t1-c2",
        action={"intent":"social", "decision":"natural-npc:first-impression", "target":"Steven Knott", "goal":"Introduce myself"})
    assert error["code"] == "not_here"
    assert "Steven Knott" in error["message"]
    # The fix is executed literally, so it has to name the call that makes the meeting happen.
    assert 'apply {kind: "npc"' in error["fix"] and '"here"' in error["fix"]
    details = error["details"]
    assert details["field"] == "target" and details["npc"] == "steven-knott"
    # Who IS here, so a Keeper handed this can roll against someone present instead.
    assert isinstance(details["present"], list) and "Steven Knott" not in details["present"]


def test_first_impression_uses_higher_value_and_reuses_pair(seeded_kernel):
    kernel = seeded_kernel
    open_turn(kernel)
    action = {"intent":"social", "decision":"natural-npc:first-impression", "target":"Steven Knott", "goal":"Introduce myself"}
    first = kernel.table("resolve", call_id="t1-c1", action=action)
    values = first["outcome"]["attribute_snapshot"]
    assert first["outcome"]["target"] == max(values.values())
    assert first["outcome"]["impression"]["reaction"]
    second = kernel.table("resolve", call_id="t1-c2", action=action)
    assert second["reused"] is True
    assert second["outcome"] == first["outcome"]
    assert len([r for r in kernel.table("status")["receipts"] if r.get("mod")]) == 1
    narrate(kernel, "t1-c3", "诺特审视了我一眼，拉开椅子。")
    kernel.table("open")
    kernel.table("player_input", text="我继续和诺特交谈。")
    again = kernel.table("resolve", call_id="t2-c1", action=action)
    assert again["outcome"] == first["outcome"]
    assert again["reused"] is True


def test_mod_toggle_waits_for_safe_boundary(kernel):
    open_turn(kernel)
    view = kernel.ok("mods.configure", {"campaign":CAMPAIGN, "id":"natural-npc", "enabled":False})
    row = next(r for r in view["mods"] if r["id"] == "natural-npc")
    assert row["active"]["enabled"] is True
    assert row["pending"]["enabled"] is False
    narrate(kernel, "t1-c1", "我们稍作停顿。")
    kernel.table("player_input", text="我们继续。")
    view = kernel.ok("mods.list", {"campaign":CAMPAIGN})
    row = next(r for r in view["mods"] if r["id"] == "natural-npc")
    assert row["active"]["enabled"] is False
    assert not row["pending"]


def test_generated_instance_transfer_preserves_identity_and_state(kernel):
    open_turn(kernel)
    definition = prepared(kernel, weapon())
    kernel.table("apply", call_id="t1-c1", effects=[definition,
        {"kind":"object", "name":"Knott's launcher", "definition":"Workshop launcher", "to":"Steven Knott"}])
    world_path = campaign_dir(kernel.workspace) / "world.json"
    before = read_json(world_path)["objects"]["instances"]
    assert len(before) == 1
    item = next(iter(before.values()))
    assert item["owner"]["kind"] == "npc"
    kernel.table("apply", call_id="t1-c2", effects=[{"kind":"object", "name":"Knott's launcher", "from":"Steven Knott", "to":"Thomas Hayes",
        "handover":"given"}])
    after = read_json(world_path)["objects"]["instances"]
    assert set(after) == set(before)
    assert after[item["id"]]["state"] == item["state"]
    view = kernel.table("view")
    assert view["investigators"][0]["objects"][0]["name"] == "Knott's launcher"
    assert view["investigators"][0]["objects"][0]["parameters"] == {"damage":"1D6", "magazine":1}
    projected_weapon = next(w for w in view["investigators"][0]["weapons"] if w.get("object_id"))
    assert "malfunction" not in projected_weapon
    narrate(kernel, "t1-c3", "诺特把发射器交到了我手里。")
    kernel.table("open")
    assert read_json(world_path)["objects"]["instances"] == after


def test_bad_batch_does_not_register_definition(kernel):
    open_turn(kernel)
    definition = prepared(kernel, weapon())
    error = kernel.table_err("apply", call_id="t1-c1", effects=[definition,
        {"kind":"object", "name":"Launcher", "definition":"Workshop launcher", "to":"Nobody here"}])
    assert error["code"] == "unknown_entity"
    assert not read_json(campaign_dir(kernel.workspace) / "world.json").get("objects")


def test_definition_rejects_unsupported_mechanics(kernel):
    open_turn(kernel)
    draft = weapon()
    draft["parameters"]["teleport_radius"] = 10
    job = kernel.ok("mods.job", {"campaign":CAMPAIGN, "role":"create", "input":draft})
    Path(job["cwd"], "result.json").write_text(json.dumps(draft))
    assert kernel.err("mods.accept", {"campaign":CAMPAIGN, "job":job["job"]})["code"] == "invalid_params"


def test_melee_definition_preserves_damage_bonus_without_dummy_gun_fields(kernel):
    open_turn(kernel)
    draft=weapon("Solid club")
    draft["parameters"].update(skill="Fighting (Brawl)",magazine=None,malfunction=None,base_range_yards=None,adds_damage_bonus=True)
    kernel.table("apply",call_id="t1-c1",effects=[prepared(kernel,draft),
        {"kind":"object","name":"My club","definition":draft["name"],"to":"Thomas Hayes"}])
    definition=kernel.table("look",focus="object",name="My club")["definition"]
    assert definition["parameters"]["adds_damage_bonus"] is True
    assert definition["parameters"]["malfunction"] is None


def test_npc_fires_generated_weapon_then_player_takes_remaining_ammo(seeded_kernel):
    kernel = seeded_kernel
    open_turn(kernel)
    n = walk_to_confrontation(kernel)
    draft = weapon("Corbitt's launcher profile")
    draft["parameters"].update(damage="0", magazine=3)
    kernel.table("apply", call_id=f"t1-c{n}", effects=[prepared(kernel, draft),
        {"kind":"object", "name":"Corbitt's launcher", "definition":draft["name"], "to":"Walter Corbitt"}])
    kernel.table("resolve", call_id=f"t1-c{n+1}", action={"intent":"combat", "target":"Walter Corbitt", "weapon":"unarmed", "defense":"none"})
    kernel.table("resolve", call_id=f"t1-c{n+2}", action={"intent":"combat", "actor":"Walter Corbitt", "target":"Thomas Hayes", "weapon":"Corbitt's launcher", "defense":"none"})
    world_path = campaign_dir(kernel.workspace) / "world.json"
    item = next(iter(read_json(world_path)["objects"]["instances"].values()))
    assert item["state"]["ammo"] == 2
    kernel.table("apply", call_id=f"t1-c{n+3}", effects=[{"kind":"object", "name":"Corbitt's launcher", "from":"Walter Corbitt", "to":"Thomas Hayes",
        "handover":"taken"}])
    kernel.table("resolve", call_id=f"t1-c{n+4}", action={"intent":"combat", "target":"Walter Corbitt", "weapon":"Corbitt's launcher", "defense":"none"})
    item = next(iter(read_json(world_path)["objects"]["instances"].values()))
    assert item["state"]["ammo"] == 1
    assert item["owner"]["id"] == "thomas-hayes"


def test_consumable_effect_and_charge_are_persisted_together(kernel):
    open_turn(kernel)
    draft = {"name":"Soothing balm", "category":"item", "description":"A calming fictional balm", "basis":"Fixture",
             "parameters":{"charges":1, "effects":[{"kind":"condition", "value":"calm"}]},
             "player_view":{"description":"A soothing balm", "fields":["charges"]}}
    kernel.table("apply", call_id="t1-c1", effects=[prepared(kernel, draft),
        {"kind":"object", "name":"My balm", "definition":draft["name"], "to":"Thomas Hayes"}])
    action = {"intent":"investigate", "decision":"objects:use", "object":"My balm", "target":"Thomas Hayes"}
    used = kernel.table("resolve", call_id="t1-c2", action=action)
    assert used["outcome"]["charges"] == 0
    assert "calm" in kernel.table("look", focus="investigator")["conditions"]
    repeated = kernel.table("resolve", call_id="t1-c2", action=action)
    assert repeated["replayed"] is True
    assert kernel.table_err("resolve", call_id="t1-c3", action=action)["code"] == "needs"


def test_generated_spell_is_priced_and_npc_can_cast_it(seeded_kernel):
    kernel = seeded_kernel
    open_turn(kernel)
    n = walk_to_confrontation(kernel)
    draft = {"name":"Cold touch", "category":"spell", "description":"A fictional chill that drains one magic point.", "basis":"Fixture",
             "parameters":{"cost_mp":"1D2+1D2", "cost_sanity":0, "casting_time":"one action",
                           "effects":[{"kind":"mp", "amount":1, "direction":"loss"}]},
             "player_view":{"description":"A chilling touch", "fields":[]}}
    kernel.table("apply", call_id=f"t1-c{n}", effects=[prepared(kernel, draft),
        {"kind":"ability", "name":draft["name"], "to":"Walter Corbitt", "source":"Established sorcerous knowledge"}])
    before = kernel.table("look", focus="investigator")["mp"]
    result = kernel.table("resolve", call_id=f"t1-c{n+1}", action={"intent":"cast", "actor":"Walter Corbitt",
        "target":"Thomas Hayes", "spell":"Cold touch", "goal":"Chill the intruder", "method":"Cast"})
    assert result["outcome"]["status"] == "cast"
    assert 2 <= result["outcome"]["mp_spent"] <= 4
    assert kernel.table("look", focus="investigator")["mp"] == before - 1
    assert {e["subject"] for e in result["effects"] if e["kind"] == "mp"} == {"walter-corbitt", "thomas-hayes"}


def test_restart_and_disabled_generator_keep_existing_items_usable(kernel):
    open_turn(kernel)
    draft = {"name":"Restoring tonic", "category":"item", "description":"A fictional tonic", "basis":"Fixture",
             "parameters":{"charges":2,"effects":[{"kind":"mp","direction":"gain","amount":1}]},
             "player_view":{"description":"A tonic", "fields":["charges"]}}
    kernel.table("apply",call_id="t1-c1",effects=[prepared(kernel,draft),
        {"kind":"object","name":"My tonic","definition":draft["name"],"to":"Thomas Hayes"}])
    narrate(kernel,"t1-c2","我把药瓶收进包里。")
    kernel.ok("mods.configure",{"campaign":CAMPAIGN,"id":"enhanced-items","enabled":False})
    workspace = kernel.workspace
    kernel.close()
    other = RpcClient(workspace)
    try:
        other.table("open")
        other.table("player_input",text="我喝一口药剂。")
        result = other.table("resolve",call_id="t2-c1",action={"intent":"investigate","decision":"objects:use","object":"My tonic"})
        assert result["outcome"]["charges"] == 1
        assert other.table("view")["investigators"][0]["objects"][0]["state"]["charges"] == 1
    finally:
        other.close()


def test_legacy_hidden_first_impression_is_reused_without_disclosing_or_rerolling(kernel):
    open_turn(kernel)
    receipt = {"schema_version":1,"receipt_id":"legacy-first-impression","campaign_id":CAMPAIGN,
               "investigator_id":"thomas-hayes","npc_id":"npc-steven-knott","app":60,"credit_rating":30,
               "governing_value":60,"disposition":"helpful","concealed_roll":7,"rule_ref":"legacy"}
    receipt["integrity_digest"] = "sha256:" + hashlib.sha256(json.dumps(receipt,sort_keys=True,separators=(",", ":")).encode()).hexdigest()
    path = campaign_dir(kernel.workspace) / "save/npc-first-impressions.json"
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps({"receipts":{"pair":receipt}}))
    result = kernel.table("resolve",call_id="t1-c1",action={"intent":"social","decision":"natural-npc:first-impression","target":"Steven Knott"})
    assert result["reused"] is True
    assert result["outcome"]["impression"]["disposition"] == "helpful"
    assert "roll" not in result["outcome"]
    assert not kernel.table("status")["receipts"]


def test_player_learns_generated_spell_and_its_effect_reaches_the_sheet(seeded_kernel):
    kernel = seeded_kernel
    open_turn(kernel)
    n = walk_to_confrontation(kernel)
    draft = {"name":"Steady hands", "category":"spell", "description":"A fictional calming charm", "basis":"Fixture",
             "parameters":{"cost_mp":1,"cost_sanity":0,"casting_time":"one action",
                           "effects":[{"kind":"condition","value":"steady_hands"}]},
             "player_view":{"description":"A calming charm","fields":["cost_mp"]}}
    kernel.table("apply",call_id=f"t1-c{n}",effects=[prepared(kernel,draft),
        {"kind":"ability","name":draft["name"],"to":"Walter Corbitt","source":"Established occult study"}])
    n += 1
    unknown = kernel.table_err("resolve",call_id=f"t1-c{n}",action={"intent":"cast","spell":draft["name"]})
    assert unknown["code"] == "needs"
    for _ in range(24):
        learned = kernel.table("resolve",call_id=f"t1-c{n}",action={"intent":"investigate","spell":draft["name"],
            "target":"Walter Corbitt","method":"Study the spell","goal":"Learn it"})
        n += 1
        if learned["outcome"]["status"] == "studying":
            break
    assert learned["outcome"]["status"] == "studying"
    kernel.table("apply",call_id=f"t1-c{n}",effects=[{"kind":"time","minutes":learned["outcome"]["study_due_minutes"]}])
    n += 1
    for _ in range(10):
        cast = kernel.table("resolve",call_id=f"t1-c{n}",action={"intent":"cast","spell":draft["name"],
            "target":"Thomas Hayes","method":"Cast the charm","goal":"Steady my hands"})
        n += 1
        if cast["outcome"]["status"] == "cast":
            break
    assert cast["outcome"]["status"] == "cast"
    assert "steady_hands" in kernel.table("look",focus="investigator")["conditions"]


def test_worldline_merge_requires_an_explicit_choice_for_different_object_owners(kernel):
    from test_worldline import fork, switch, merge_err, turn_json
    open_turn(kernel)
    draft = weapon()
    kernel.table("apply",call_id="t1-c1",effects=[prepared(kernel,draft),
        {"kind":"object","name":"The launcher","definition":draft["name"],"to":"Steven Knott"}])
    narrate(kernel,"t1-c2","诺特收起了发射器。")
    fork(kernel,2,"side")
    n = turn_json(kernel)["turn"]
    kernel.table("player_input",text="我接过发射器。")
    kernel.table("apply",call_id=f"t{n}-c1",effects=[{"kind":"object","name":"The launcher","from":"Steven Knott","to":"Thomas Hayes",
        "handover":"given"}])
    narrate(kernel,f"t{n}-c2","我收起了发射器。")
    switch(kernel,turn_json(kernel)["turn"],"main")
    n = turn_json(kernel)["turn"]
    kernel.table("player_input",text="让两种可能交汇。")
    error = merge_err(kernel,f"t{n}-c1")
    assert error["code"] == "needs"
    conflicts = error["details"]["conflicts"]
    assert any(row["class"] == "mod_state" and row["modes"] == ["from"] for row in conflicts)
    dispositions = {r["id"]:{"mode":"from","line":"side"} for r in conflicts}
    kernel.table("apply",call_id=f"t{n}-c1",effects=[{"kind":"merge","name":"joined","lines":["main","side"],"dispositions":dispositions}])
    narrate(kernel,f"t{n}-c2","两种可能重合，我握着那件武器。")
    assert kernel.table("view")["investigators"][0]["objects"][0]["name"] == "The launcher"


def test_container_transfer_and_condition_are_preserved(kernel):
    open_turn(kernel)
    box = {"name":"Wooden case", "category":"item", "description":"A carrying case", "basis":"Fixture",
           "parameters":{"charges":None,"effects":[]},"traits":[{"name":"length","value":1.2,"unit":"m"}],
           "player_view":{"description":"A case","fields":[],"traits":["length"]}}
    kernel.table("apply",call_id="t1-c1",effects=[prepared(kernel,box),prepared(kernel,weapon()),
        {"kind":"object","name":"My case","definition":box["name"],"to":"Thomas Hayes"},
        {"kind":"object","name":"Jammed launcher","definition":"Workshop launcher","to":"My case","condition":"jammed"}])
    assert kernel.table("look",focus="object",name="My case")["instance"]["contents"] == ["Jammed launcher"]
    assert kernel.table("view")["investigators"][0]["objects"][0]["traits"] == [{"name":"length","value":1.2,"unit":"m"}]
    error = kernel.table_err("apply",call_id="t1-c2",effects=[{"kind":"object","name":"My case","from":"Thomas Hayes","to":"Jammed launcher"}])
    assert error["code"] == "invalid_params"
    kernel.table("apply",call_id="t1-c2",effects=[{"kind":"object","name":"Jammed launcher","from":"My case","to":"Thomas Hayes"}])
    value = kernel.table("look",focus="object",name="Jammed launcher")
    assert value["instance"]["state"]["condition"] == "jammed"
    assert value["instance"]["state"]["ammo"] == 1
    n = walk_to_confrontation(kernel,start=3)
    error = kernel.table_err("resolve",call_id=f"t1-c{n}",action={"intent":"combat","target":"Walter Corbitt","weapon":"Jammed launcher","defense":"none"})
    assert error["code"] == "needs" and "condition" in error["message"]


def test_mod_resolution_obeys_pending_defense_and_preserves_session_projection(kernel):
    open_turn(kernel)
    n = walk_to_confrontation(kernel)
    kernel.table("resolve",call_id=f"t1-c{n}",action={"intent":"combat","target":"Walter Corbitt","weapon":"unarmed"})
    action={"intent":"social","decision":"natural-npc:first-impression","target":"Walter Corbitt"}
    error=kernel.table_err("resolve",call_id=f"t1-c{n+1}",action=action)
    assert error["code"] == "turn_state"
    kernel.table("resolve",call_id=f"t1-c{n+1}",action={"intent":"combat","actor":"Walter Corbitt","defense":"none"})
    result=kernel.table("resolve",call_id=f"t1-c{n+2}",action=action)
    assert result["session"]["kind"] == "combat"
    assert result["session"]["status"] == "active"


def test_same_owner_damage_updates_instance_and_cannot_be_hidden_in_legacy_rows(kernel):
    open_turn(kernel)
    kernel.table("apply",call_id="t1-c1",effects=[prepared(kernel,weapon()),
        {"kind":"object","name":"My launcher","definition":"Workshop launcher","to":"Thomas Hayes"}])
    before=kernel.table("look",focus="object",name="My launcher")["definition"]
    kernel.table("apply",call_id="t1-c2",effects=[{"kind":"object","name":"My launcher","from":"Thomas Hayes", "to":"Thomas Hayes",
        "condition":"broken","why":"An established failed push snapped its frame"}])
    value=kernel.table("look",focus="object",name="My launcher")
    assert value["instance"]["state"]["condition"] == "broken"
    assert value["definition"] == before
    row=next(r for r in kernel.table("status")["mechanics"] if r.get("item")=="My launcher")
    assert row["kind"]=="change" and row["before"]=="intact" and row["after"]=="broken"
    assert kernel.table_err("apply",call_id="t1-c3",effects=[{"kind":"item","name":"My launcher","quantity":-1}])["code"]=="invalid_params"


def test_a_definition_job_carries_only_the_table_its_category_can_use(kernel):
    open_turn(kernel)

    def catalogs(category, name):
        job = kernel.ok("mods.job", {"campaign":CAMPAIGN, "role":"create",
                                     "input":{"name":name, "category":category, "description":"A fixture object."}})
        return read_json(Path(job["cwd"], "request.json"))["catalogs"]

    assert list(catalogs("weapon", "Fixture launcher")) == ["weapons"]
    assert list(catalogs("spell", "Fixture rite")) == ["spells"]
    # The category is pinned before the child starts, so an item can never reach either preset table.
    # It used to carry both anyway, and the packet is a file the child cannot query.
    assert catalogs("item", "Fixture pencil") == {}


def test_a_first_placement_may_name_its_giver_and_the_receipt_keeps_him(kernel):
    open_turn(kernel)
    placement = {"kind":"object", "name":"Given launcher", "definition":"Handover launcher",
                 "to":"Thomas Hayes", "why":"Knott hands it over"}

    # A handover narrated as one transfer: the batch defines the object and gives it away in the same call.
    # Refusing the giver here guarded nothing -- there is no owner below to contradict -- and made the
    # Keeper drop him, so a handover was recorded as though the thing had appeared out of nobody's hands.
    result = kernel.table("apply", call_id="t1-c1",
                          effects=[prepared(kernel, weapon("Handover launcher")),
                                   {**placement, "from":"Steven Knott", "handover":"given"}])
    look = kernel.table("look", focus="object", name="Given launcher")
    assert look["definition"]["name"] == "Handover launcher"
    assert look["instance"]["owner"] == read_json(campaign_dir(kernel.workspace) / "party" / "thomas-hayes.json")["name"]
    # The giver the Keeper named is kept, which is the whole reason to accept him: this handover used to
    # be recorded as though the launcher had come out of nobody's hands.
    assert any(r["id"].startswith("item:") for r in kernel.table("status")["receipts"])
    assert any(r.get("from") for r in kernel.table("status")["receipts"] if r["id"].startswith("item:"))

    # The name that is still missing is still missing, and it still says which ones are on hand.
    absent = kernel.table_err("apply", call_id="t1-c2",
                              effects=[{**placement, "name":"Second launcher", "definition":"No such launcher"}])
    assert absent["code"] == "invalid_params"
    assert "No such launcher" in absent["message"] and "spells" not in absent["message"]

    # And the guarantee that does mean something is untouched: a transfer of an existing instance has to
    # name the owner it actually has.
    wrong = kernel.table_err("apply", call_id="t1-c3",
                             effects=[{**placement, "from":"Steven Knott", "to":"Steven Knott"}])
    assert wrong["code"] == "invalid_params"
    assert "current owner" in wrong["message"]


def test_a_trait_nested_in_parameters_is_told_to_move_it_not_to_drop_it(kernel):
    open_turn(kernel)
    measured = [{"name":"length", "value":91, "unit":"cm", "basis":"Fixture measurement."}]
    draft = weapon()
    draft["parameters"]["traits"] = measured
    request = {"name":draft["name"], "category":draft["category"], "description":draft["description"]}
    job = kernel.ok("mods.job", {"campaign":CAMPAIGN, "role":"create", "input":request})
    Path(job["cwd"], "result.json").write_text(json.dumps(draft))

    refused = kernel.err("mods.accept", {"campaign":CAMPAIGN, "job":job["job"]})
    assert refused["code"] == "invalid_params"
    # Naming neither the key nor where it belonged made deletion the cheapest repair.
    assert "traits" in refused["message"]
    assert "move it beside parameters" in refused["fix"]

    # The repair the refusal names keeps the measurements instead of losing them.
    del draft["parameters"]["traits"]
    draft["traits"] = measured
    Path(job["cwd"], "result.json").write_text(json.dumps(draft))
    assert kernel.ok("mods.accept", {"campaign":CAMPAIGN, "job":job["job"]})["definition"]["traits"] == measured


def test_registration_can_be_queued_past_delivery_and_completed_afterwards(kernel):
    open_turn(kernel)
    rows = [entry["name"] for entry in kernel.ok("mods.context", {"campaign":CAMPAIGN})["unregistered_equipment"]]
    assert rows, "the pregen has to carry unregistered equipment for this to mean anything"
    target = rows[0]

    draft = {"name":"Queued fixture kit", "category":"item", "description":"Fixture gear for a deferred registration."}
    job = kernel.ok("mods.job", {"campaign":CAMPAIGN, "role":"create", "input":draft})
    kernel.table("apply", call_id="t1-c1", effects=[
        {"kind":"define", **draft, "_queued":job["job"], "_provenance":{"mod":job["mod"], "digest":job["digest"]}},
        {"kind":"object", "name":draft["name"], "to":"Thomas Hayes", "adopt":target,
         "definition":draft["name"], "why":"Fixture adoption."}])

    world = read_json(campaign_dir(kernel.workspace) / "world.json")
    # Nothing was invented on the Keeper's behalf: the marker is not a definition.
    assert not world.get("objects", {}).get("definitions")
    # The row is accounted for, so neither the Keeper nor the audit is asked for it a second time.
    assert target not in [e["name"] for e in kernel.ok("mods.context", {"campaign":CAMPAIGN})["unregistered_equipment"]]

    Path(job["cwd"], "result.json").write_text(json.dumps({**draft, "basis":"Fixture basis for the deferred kit.",
        "parameters":{"charges":None, "effects":[]}, "player_view":{"description":"一套夹具装备。", "fields":[]}}))
    kernel.ok("mods.accept", {"campaign":CAMPAIGN, "job":job["job"]})

    # Deferral means not this turn: completing here would put the wait back one tool call later.
    assert kernel.ok("mods.queued", {"campaign":CAMPAIGN}) == {"effects":[], "unfinished":[]}

    delivered = narrate(kernel, "t1-c3", "诺特把条件说完，等你开口。")
    # Contract §129: the card names the belonging at once and says what it waits on, rather than dropping
    # the row as bookkeeping or holding the delivery for its parameters.
    waiting = [row for row in delivered["mechanics"] if row.get("adopted") == target]
    assert waiting == [{"kind":"item", "receipt":waiting[0]["receipt"], "name":draft["name"], "adopted":target,
                        "definition":"pending", "definition_name":draft["name"], "call":"t1-c1"}]
    kernel.table("player_input", text="我接下这单。")
    ready = kernel.ok("mods.queued", {"campaign":CAMPAIGN})
    assert [effect["kind"] for effect in ready["effects"]] == ["define", "object"] and ready["unfinished"] == []
    kernel.table("apply", call_id="t2-c1", effects=ready["effects"])
    # The replayed adoption is the same belonging; the card that named it pending is the one that opens.
    assert not [row for row in kernel.table("status")["mechanics"] if row.get("adopted")]

    assert kernel.table("look", focus="object", name=draft["name"])["definition"]["name"] == draft["name"]
    # The marker stops standing in for a definition that is now real, and the row stays out of the gap list.
    assert kernel.ok("mods.queued", {"campaign":CAMPAIGN}) == {"effects":[], "unfinished":[]}
    assert target not in [e["name"] for e in kernel.ok("mods.context", {"campaign":CAMPAIGN})["unregistered_equipment"]]


def test_a_handed_over_object_opens_into_its_player_view_on_the_card(kernel):
    open_turn(kernel)
    draft = {**weapon("Card launcher"), "traits":[{"name":"length", "value":91, "unit":"cm", "basis":"Fixture."},
                                                 {"name":"serial", "value":"X-7", "basis":"Keeper-only fixture."}]}
    draft["player_view"] = {**draft["player_view"], "traits":["length"]}
    kernel.table("apply", call_id="t1-c1", effects=[prepared(kernel, draft),
        {"kind":"object", "name":"Handed launcher", "definition":"Card launcher", "to":"Thomas Hayes", "from":"Steven Knott", "handover":"given", "why":"Knott hands it over"}])
    delivered = narrate(kernel, "t1-c2", "诺特把它推过桌面。")
    row = next(row for row in delivered["mechanics"] if row["kind"] == "item")
    # Contract §129: the definition is in hand, so the row opens at once -- into the player view only.
    assert row["definition"] == "ready"
    assert row["object"] == {"category":"weapon", "description":"An improvised launcher.",
                             "traits":[{"name":"length", "value":91, "unit":"cm", "basis":"Fixture."}],
                             "parameters":{"damage":"1D6", "magazine":1}}
    assert "Fixture: a single-shot" not in json.dumps(row) and "X-7" not in json.dumps(row)


def test_a_placement_that_omits_its_definition_is_offered_the_names_on_hand(kernel):
    open_turn(kernel)
    target = [entry["name"] for entry in kernel.ok("mods.context", {"campaign":CAMPAIGN})["unregistered_equipment"]][0]
    draft = {"name":"笔记本", "category":"item", "description":"A blank 1920s notebook.", "basis":"Fixture basis.",
             "parameters":{"charges":None, "effects":[]}, "player_view":{"description":"一本空白笔记本。", "fields":[]}}
    placement = {"kind":"object", "name":"大牛皮的笔记本", "to":"Thomas Hayes", "adopt":target, "why":"登记已有笔记本"}

    # The Keeper named the instance after its owner and left the definition out, so the kernel looked the
    # instance name up instead. Telling it to define what it defined at index 0 is what makes it define twice.
    refused = kernel.table_err("apply", call_id="t1-c1", effects=[prepared(kernel, draft), placement])
    assert refused["code"] == "invalid_params"
    assert "大牛皮的笔记本" in refused["message"]
    assert "omitted definition" in refused["fix"]
    assert "set definition to one of: 笔记本" in refused["fix"]

    kernel.table("apply", call_id="t1-c2", effects=[prepared(kernel, draft), {**placement, "definition":"笔记本"}])
    assert kernel.table("look", focus="object", name="大牛皮的笔记本")["definition"]["name"] == "笔记本"


def test_a_queued_registration_answers_look_instead_of_reading_as_unknown(kernel):
    open_turn(kernel)
    target = [entry["name"] for entry in kernel.ok("mods.context", {"campaign":CAMPAIGN})["unregistered_equipment"]][0]
    draft = {"name":"Queued field kit", "category":"item", "description":"Fixture gear for a deferred registration."}
    job = kernel.ok("mods.job", {"campaign":CAMPAIGN, "role":"create", "input":draft})
    kernel.table("apply", call_id="t1-c1", effects=[
        {"kind":"define", **draft, "_queued":job["job"], "_provenance":{"mod":job["mod"], "digest":job["digest"]}},
        {"kind":"object", "name":draft["name"], "to":"Thomas Hayes", "adopt":target,
         "definition":draft["name"], "why":"Fixture adoption."}])

    # Answering "no such thing" is what sent a live Keeper round to define and place it a second time.
    refused = kernel.table_err("look", focus="object", name=draft["name"])
    assert refused["code"] == "needs"
    assert draft["name"] in refused["message"]
    assert "do not define or place it again" in refused["fix"]

    # And it does not have to ask: what it registered is in the context it already reads.
    queued = kernel.ok("mods.context", {"campaign":CAMPAIGN})["objects"]["queued_registrations"]
    assert [entry["name"] for entry in queued] == [draft["name"]]
    assert queued[0]["adopted"] == target

    # A name nobody registered is still unknown, queued or not.
    assert kernel.table_err("look", focus="object", name="Nothing named this")["code"] == "unknown_entity"
