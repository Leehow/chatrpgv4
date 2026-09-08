"""#19 `apply {kind: item}` / `apply {kind: cash}`: what the narration hands an investigator
reaches the sheet (equipment, a weapon row from the rules' profile, finance.cash), the
receipts and the mechanics projection say so, the events land, a loss needs the item on the sheet,
and a weapon given this way is one `resolve` can fire — with its own skill and its own
magazine. Through the RPC seam; the skill lookup is also pinned in process."""

from __future__ import annotations

import sys

from conftest import CAMPAIGN, CONTENT_DIR, KERNEL_DIR, RpcClient, campaign_dir, narrate_opening, open_turn, read_json, read_jsonl
from test_rules_families import CONFRONTATION_PATH, resolve, resolve_err

sys.path.insert(0, str(KERNEL_DIR))

from coc.rules import RuleTables  # noqa: E402
from coc.sessions import (investigator_combat_participant, resolve_investigator_weapon, sheet_skill_value,  # noqa: E402
                          weapon_options as options_of)

INVESTIGATOR = "thomas-hayes"
INV_NAME = "托马斯·海斯"
RULES = CONTENT_DIR / "rulesets" / "coc7" / "rules-json"
SHOTGUN = "shotgun_12g"


def sheet(client):
    return read_json(campaign_dir(client.workspace) / "party" / f"{INVESTIGATOR}.json")


def events_of(client, event_type):
    return [e for e in read_jsonl(campaign_dir(client.workspace) / "events.jsonl") if e["type"] == event_type]


def receipts_of(client):
    return {r["id"]: r for r in client.table("status")["receipts"]}


def give_shotgun(client, call_id="t1-c1", **extra):
    return client.table("apply", call_id=call_id, effects=[
        {"kind": "item", "name": "Winchester shotgun", "from": "Knott", "weapon": SHOTGUN, "label": "温彻斯特霰弹枪",
         "why": "诺特从柜子里取出来", **extra}])


# ---- item: gain, sheet, receipt, line, event ---------------------------------------------------

def test_item_with_a_weapon_profile_reaches_the_sheet_the_line_and_the_event(kernel):
    open_turn(kernel, "我接过枪。")
    result = give_shotgun(kernel)
    assert result["receipts"] == ["item:winchester-shotgun-t1-c1"]
    assert result["world"]["clock"] == {"minutes": 0}

    weapons = json_weapons()
    profile = weapons[SHOTGUN]
    after = sheet(kernel)
    entry = after["equipment"][-1]
    assert entry == {"name": "Winchester shotgun", "quantity": 1, "turn": 1, "from": "Steven Knott",
                     "label": "温彻斯特霰弹枪", "weapon": SHOTGUN}
    # the pregen's own kit (bare strings) is untouched
    assert after["equipment"][:-1] == read_json(CONTENT_DIR / "starters" / "the-haunting" / "pregens" / INVESTIGATOR / "character.json")["equipment"]
    row = after["weapons"][-1]
    assert row["weapon_id"] == SHOTGUN and row["name"] == "Winchester shotgun" and row["label"] == "温彻斯特霰弹枪"
    # every number on the row is the rules profile's, not a literal
    assert row["skill"] == profile["skill"] and row["damage"] == profile["damage_die"]
    assert row["ammo"] == profile["magazine"] and row["malfunction"] == profile["malfunction"]
    assert row["range"] == f"{profile['base_range_yards']} yards" and row["attacks"] == profile["uses_per_round"]
    assert row["profile"] == profile["display_name"] and row["turn"] == 1

    receipt = receipts_of(kernel)["item:winchester-shotgun-t1-c1"]
    assert receipt == {**receipt, "kind": "item", "name": "Winchester shotgun", "label": "温彻斯特霰弹枪",
                       "subject": INVESTIGATOR, "subject_label": INV_NAME, "from": "Steven Knott", "weapon": SHOTGUN,
                       "quantity": 1, "before": 0, "after": 1, "why": "诺特从柜子里取出来"}
    event = events_of(kernel, "item-transferred")[-1]
    assert event["receipt"] == "item:winchester-shotgun-t1-c1"
    assert event["data"] == {"name": "Winchester shotgun", "to": INVESTIGATOR, "quantity": 1, "from": "Steven Knott",
                             "weapon": SHOTGUN}

    narrated = kernel.table("narrate", call_id="t1-c2", text="诺特把枪递过来。\n\n枪很沉。")
    assert narrated["rendered_text"] == "诺特把枪递过来。\n\n枪很沉。"
    assert narrated["mechanics"] == [{"kind": "item", "receipt": "item:winchester-shotgun-t1-c1", "name": "Winchester shotgun",
                                      "quantity": 1, "to": INVESTIGATOR, "label": "温彻斯特霰弹枪", "to_label": INV_NAME,
                                      "from": "Steven Knott", "weapon": SHOTGUN, "call": "t1-c1"}]
    assert f"Item: {INV_NAME} gains 温彻斯特霰弹枪" in narrated["facts"]["committed"]


def test_item_without_a_weapon_is_kit_and_quantities_merge(kernel):
    open_turn(kernel)
    first = kernel.table("apply", call_id="t1-c1", effects=[{"kind": "item", "name": "shotgun shells", "quantity": 6}])
    assert first["receipts"] == ["item:shotgun-shells-t1-c1"]
    again = kernel.table("apply", call_id="t1-c2", effects=[{"kind": "item", "name": "Shotgun Shells", "quantity": 4}])
    assert again["receipts"] == ["item:shotgun-shells-t1-c2"]
    entries = [e for e in sheet(kernel)["equipment"] if isinstance(e, dict)]
    assert entries == [{"name": "shotgun shells", "quantity": 10, "turn": 1}]
    assert len(sheet(kernel)["weapons"]) == 1  # no profile, no weapon row
    logged = receipts_of(kernel)
    assert (logged["item:shotgun-shells-t1-c1"]["before"], logged["item:shotgun-shells-t1-c1"]["after"]) == (0, 6)
    assert (logged["item:shotgun-shells-t1-c2"]["before"], logged["item:shotgun-shells-t1-c2"]["after"]) == (6, 10)
    narrated = kernel.table("narrate", call_id="t1-c3", text="他数了数子弹。")
    assert narrated["rendered_text"] == "他数了数子弹。"
    # each projection says what that call said
    assert [(m["name"], m["quantity"]) for m in narrated["mechanics"]] == [("shotgun shells", 6), ("Shotgun Shells", 4)]


def test_unknown_weapon_profile_is_needs_with_the_eras_ids_and_the_batch_does_not_write(kernel):
    open_turn(kernel)
    error = kernel.table_err("apply", call_id="t1-c1", effects=[
        {"kind": "time", "minutes": 5},
        {"kind": "item", "name": "Winchester shotgun", "weapon": "winchester"}])
    assert error["code"] == "needs" and error["details"]["index"] == 1
    needs = error["details"]["needs"]
    assert needs["field"] == "weapon" and needs["source"].endswith("weapons.json")
    weapons = json_weapons()
    assert SHOTGUN in needs["options"]
    # the sheet's era filters the list: a modern-only pump gun is not on a 1920s table
    assert "shotgun_12g_pump" in weapons and "shotgun_12g_pump" not in needs["options"]
    # the options are the merged table a combat session reads: the rulebook plus the module's own rows
    module_rows = {w["weapon_id"] for w in read_json(RULES / "the-haunting.json")["weapons"]}
    assert set(needs["options"]) <= set(weapons) | module_rows and set(needs["options"]) & module_rows
    assert set(needs["close"]) <= set(needs["options"]) | set(weapons)
    # nothing wrote: neither the clock nor the sheet
    assert read_json(campaign_dir(kernel.workspace) / "world.json")["clock"] == {"minutes": 0}
    assert not any(isinstance(e, dict) for e in sheet(kernel)["equipment"])
    assert kernel.table("status")["receipts"] == []
    # a profile is also found by its display name
    by_name = kernel.table("apply", call_id="t1-c1", effects=[
        {"kind": "item", "name": "sawn-off", "weapon": weapons["shotgun_12g_sawed_off"]["display_name"]}])
    assert by_name["receipts"] == ["item:sawn-off-t1-c1"]
    assert sheet(kernel)["weapons"][-1]["weapon_id"] == "shotgun_12g_sawed_off"
    assert kernel.table_err("apply", call_id="t1-c2", effects=[{"kind": "item", "name": "x", "quantity": 0}])["code"] == "invalid_params"
    assert kernel.table_err("apply", call_id="t1-c2", effects=[{"kind": "item", "name": "x", "to": "nobody"}])["code"] == "unknown_entity"


# ---- item: loss ---------------------------------------------------------------------------------

def test_loss_needs_the_item_on_the_sheet_and_takes_the_weapon_row_with_it(kernel):
    open_turn(kernel)
    missing = kernel.table_err("apply", call_id="t1-c1", effects=[{"kind": "item", "name": "lantern", "quantity": -1}])
    assert missing["code"] == "invalid_params" and missing["details"] == {"index": 0, "name": "lantern", "held": 0, "quantity": -1}

    kernel.table("apply", call_id="t1-c1", effects=[{"kind": "item", "name": "shotgun shells", "quantity": 6}])
    lost = kernel.table("apply", call_id="t1-c2", effects=[{"kind": "item", "name": "shotgun shells", "quantity": -2, "why": "打空两发"}])
    assert lost["receipts"] == ["item:shotgun-shells-t1-c2"]
    receipt = receipts_of(kernel)["item:shotgun-shells-t1-c2"]
    assert (receipt["quantity"], receipt["before"], receipt["after"]) == (-2, 6, 4)
    assert [e for e in sheet(kernel)["equipment"] if isinstance(e, dict)] == [{"name": "shotgun shells", "quantity": 4, "turn": 1}]
    too_many = kernel.table_err("apply", call_id="t1-c3", effects=[{"kind": "item", "name": "shotgun shells", "quantity": -5}])
    assert too_many["code"] == "invalid_params" and too_many["details"]["held"] == 4

    give_shotgun(kernel, call_id="t1-c3")
    assert weapon_options(kernel) == [".38 Revolver", "Winchester shotgun", "unarmed"]
    # the loss may name it by the label the keeper gave it
    gone = kernel.table("apply", call_id="t1-c4", effects=[{"kind": "item", "name": "温彻斯特霰弹枪", "quantity": -1}])
    assert gone["receipts"] == ["item:t1-c4"]  # no Latin slug in the name: the ordinal alone (§16 ids are ASCII)
    assert receipts_of(kernel)["item:t1-c4"]["name"] == "温彻斯特霰弹枪"
    after = sheet(kernel)
    assert not any(isinstance(e, dict) and e["name"] == "Winchester shotgun" for e in after["equipment"])
    assert [w["weapon_id"] for w in after["weapons"]] == ["revolver_38_or_9mm"]
    assert weapon_options(kernel) == [".38 Revolver", "unarmed"]
    narrated = kernel.table("narrate", call_id="t1-c5", text="枪掉进了河里。")
    assert narrated["rendered_text"] == "枪掉进了河里。"
    assert {"kind": "item", "receipt": "item:t1-c4", "name": "温彻斯特霰弹枪", "label": "温彻斯特霰弹枪", "quantity": -1,
            "to": INVESTIGATOR, "to_label": INV_NAME, "call": "t1-c4"} in narrated["mechanics"]
    assert f"Item: {INV_NAME} loses shotgun shells x2" in narrated["facts"]["committed"]

    # the pregen's own pistol has no equipment entry: it is held as its weapon row
    kernel.table("player_input", text="继续。")
    kernel.table("apply", call_id="t2-c1", effects=[{"kind": "item", "name": ".38 Revolver", "quantity": -1}])
    assert sheet(kernel)["weapons"] == [] and weapon_options(kernel) == ["unarmed"]


# ---- item: the keeper fires it ----------------------------------------------------------------

def test_a_given_shotgun_resolves_and_combat_counts_its_own_magazine_and_skill(tmp_path):
    client = RpcClient(tmp_path / "ws", env={"COC_KERNEL_SEED": "9"})
    try:
        open_turn(client, "我举起霰弹枪。")
        give_shotgun(client)
        for n, scene in enumerate(CONFRONTATION_PATH, start=2):
            client.table("apply", call_id=f"t1-c{n}", effects=[{"kind": "move", "to": scene}])
        n = 2 + len(CONFRONTATION_PATH)
        # the item's own name, its label and the rules id all resolve; a name never given does not
        options = resolve_err(client, f"t1-c{n}", intent="combat", goal="开枪", method="射击", target="Walter Corbitt")
        assert options["details"]["needs"]["options"] == [".38 Revolver", "Winchester shotgun", "unarmed"]
        assert resolve_err(client, f"t1-c{n}", intent="combat", goal="开枪", method="射击", target="Walter Corbitt",
                           weapon="Tommy gun")["code"] == "needs"
        attack = resolve(client, f"t1-c{n}", intent="combat", goal="朝科比特开枪", method="用霰弹枪", target="Walter Corbitt",
                         weapon="温彻斯特霰弹枪")
        assert attack["outcome"]["attack_kind"] == "firearm_attack" and attack["outcome"]["started"] is True
        defend = resolve(client, f"t1-c{n + 1}", intent="combat", goal="他迎着枪口", method="", actor="Walter Corbitt",
                         defense="none")
        roll = defend["outcome"]["rolls"][0]
        profile = json_weapons()[SHOTGUN]
        # the shotgun fires with its own skill at the rulebook base (the sheet has no
        # Rifle/Shotgun), not with the sheet's best Firearms (Handgun 55)
        assert roll["skill"] == profile["skill"]
        assert roll["target"] == json_skills()["Firearms (Rifle/Shotgun)"]["base_chance"]
        ammo = [e for e in defend["effects"] if e["kind"] == "ammo"]
        assert ammo == [{"kind": "ammo", "subject": INVESTIGATOR, "before": profile["magazine"],
                         "after": profile["magazine"] - 1, "weapon": SHOTGUN}]
        assert defend["outcome"]["damage"][0]["expression"] == profile["damage_die"]
    finally:
        client.close()


def test_sheet_skill_value_matches_the_weapon_tables_spelling_and_falls_back_to_the_rulebook_base():
    tables = RuleTables(RULES)
    weapons, skills = json_weapons(), json_skills()
    spelled_by_weapons = weapons[SHOTGUN]["skill"]
    assert spelled_by_weapons != "Firearms (Rifle/Shotgun)"  # the drift this lookup absorbs
    on_sheet = {"id": "x", "era": "1920s", "skills": {"Firearms (Rifle/Shotgun)": 40, "Firearms (Handgun)": 70}}
    assert sheet_skill_value(tables, on_sheet, spelled_by_weapons) == 40
    off_sheet = {"id": "x", "era": "1920s", "skills": {"Firearms (Handgun)": 70}}
    assert sheet_skill_value(tables, off_sheet, spelled_by_weapons) == skills["Firearms (Rifle/Shotgun)"]["base_chance"]
    assert sheet_skill_value(tables, off_sheet, "Firearms (Death Ray)") is None
    shotgun = {**weapons[SHOTGUN], "weapon_id": SHOTGUN}
    assert investigator_combat_participant(tables, off_sheet, shotgun)["firearms_skill"] == 25
    assert investigator_combat_participant(tables, on_sheet, shotgun)["firearms_skill"] == 40
    # a label given on `apply item` is a name `resolve` accepts
    labelled = {"id": "x", "skills": {}, "weapons": [{"weapon_id": SHOTGUN, "name": "Winchester shotgun", "label": "温彻斯特霰弹枪"}]}
    assert resolve_investigator_weapon(tables, labelled, "温彻斯特霰弹枪")["weapon_id"] == SHOTGUN
    assert resolve_investigator_weapon(tables, labelled, "winchester-shotgun")["weapon_id"] == SHOTGUN
    assert resolve_investigator_weapon(tables, labelled, "12-gauge Shotgun (2B)")["weapon_id"] == SHOTGUN


# ---- cash --------------------------------------------------------------------------------------

def test_cash_builds_the_finance_block_from_the_era_table_and_moves_it(kernel):
    open_turn(kernel, "我收下定金。")
    before = sheet(kernel)
    assert "finance" not in before and before["cash"] == "15 dollars"  # the pregen's prose, never parsed
    table = read_json(RULES / "cash-assets.json")
    tier = next(row for row in table["periods"]["1920s"] if row["credit_rating_min"] <= before["credit_rating"] <= row["credit_rating_max"])
    start = before["credit_rating"] * tier["cash_multiplier"]

    result = kernel.table("apply", call_id="t1-c1", effects=[{"kind": "cash", "delta": 20, "why": "诺特的定金"}])
    assert result["receipts"] == ["cash:t1-c1"]
    after = sheet(kernel)
    assert after["finance"]["cash"] == {"amount": start + 20, "currency": table["currency"], "formula": f"CR x {tier['cash_multiplier']}"}
    assert after["finance"]["living_standard"] == tier["living_standard"] and after["finance"]["source"] == "cash-assets.periods.1920s"
    assert after["cash"] == f"{start + 20} {table['currency']}"
    receipt = receipts_of(kernel)["cash:t1-c1"]
    assert receipt == {**receipt, "kind": "cash", "resource": "cash", "subject": INVESTIGATOR, "subject_label": INV_NAME,
                       "before": start, "after": start + 20, "delta": 20, "currency": table["currency"],
                       "why": "诺特的定金"}
    assert "label" not in receipt  # §16: the resource key is the language-neutral name
    event = events_of(kernel, "resource-changed")[-1]
    assert event["receipt"] == "cash:t1-c1"
    assert event["data"] == {"resource": "cash", "subject": INVESTIGATOR, "before": start, "after": start + 20, "delta": 20,
                             "why": "诺特的定金"}

    both = kernel.table("apply", call_id="t1-c2", effects=[{"kind": "cash", "delta": -5}, {"kind": "cash", "delta": -5}])
    assert both["receipts"] == ["cash:t1-c2", "cash:t1-c2-2"]
    assert sheet(kernel)["finance"]["cash"]["amount"] == start + 10
    broke = kernel.table_err("apply", call_id="t1-c3", effects=[{"kind": "cash", "delta": -(start + 11)}])
    assert broke["code"] == "invalid_params" and broke["details"]["before"] == start + 10
    assert sheet(kernel)["finance"]["cash"]["amount"] == start + 10
    assert kernel.table_err("apply", call_id="t1-c3", effects=[{"kind": "cash", "delta": 0}])["code"] == "invalid_params"
    assert kernel.table_err("apply", call_id="t1-c3", effects=[{"kind": "cash", "delta": 1.5}])["code"] == "invalid_params"

    text = "他数了钱，又付了车费。"
    narrated = kernel.table("narrate", call_id="t1-c3", text=text)
    assert narrated["rendered_text"] == text
    assert [m for m in narrated["mechanics"] if m["kind"] == "cash"] == [
        {"kind": "cash", "receipt": receipt_id, "subject": INVESTIGATOR, "subject_label": INV_NAME, "before": b, "after": a,
         "currency": table["currency"], "call": call_id}
        for receipt_id, call_id, b, a in (("cash:t1-c1", "t1-c1", start, start + 20),
                                          ("cash:t1-c2", "t1-c2", start + 20, start + 15),
                                          ("cash:t1-c2-2", "t1-c2", start + 15, start + 10))]
    assert f"cash: {INV_NAME} {start} -> {start + 20}" in narrated["facts"]["committed"]
    # history's diff accumulates cash like any resource
    kernel.table("player_input", text="继续。")
    diff = kernel.table("recall", what="history", diff=[0, 1])["diff"]
    assert diff["resources"] == [{"subject": INVESTIGATOR, "resource": "cash", "from": start, "to": start + 10}]


def json_weapons():
    return read_json(RULES / "weapons.json")["weapons"]


def json_skills():
    return read_json(RULES / "skills.json")["skills"]


def weapon_options(client):
    """What `resolve` offers for `action.weapon` (the same function the pipeline calls on
    the sheet as written): the sheet's rows plus the fist."""
    return options_of(sheet(client))


def test_improvised_object_keeps_name_and_uses_selected_profile(kernel):
    from test_rules_families import walk_to_confrontation, resolve
    open_turn(kernel)
    kernel.table("apply", call_id="t1-c1", effects=[{"kind": "item", "name": "sledgehammer", "weapon": "club_large"}])
    n = walk_to_confrontation(kernel, start=2)
    result = resolve(kernel, f"t1-c{n}", intent="combat", target="Walter Corbitt", weapon="sledgehammer",
                     defense="none", goal="strike", method="swing the hammer")
    assert result["receipts"]
