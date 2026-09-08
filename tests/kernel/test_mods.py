"""Mod behavior through the public kernel RPC seam; fixtures are not playtest evidence."""
import json
import hashlib
from pathlib import Path

from conftest import CAMPAIGN, RpcClient, campaign_dir, narrate, open_turn, read_json
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
    kernel.table("apply", call_id="t1-c2", effects=[{"kind":"object", "name":"Knott's launcher", "from":"Steven Knott", "to":"Thomas Hayes"}])
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
    kernel.table("apply", call_id=f"t1-c{n+3}", effects=[{"kind":"object", "name":"Corbitt's launcher", "from":"Walter Corbitt", "to":"Thomas Hayes"}])
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
    kernel.table("apply",call_id=f"t{n}-c1",effects=[{"kind":"object","name":"The launcher","from":"Steven Knott","to":"Thomas Hayes"}])
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
