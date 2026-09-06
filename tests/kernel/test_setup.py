"""§14.4 / §14.7: the status ladder, the open gate, the seven-step table and setup.*."""

from __future__ import annotations

import json

from conftest import CAMPAIGN, CONTENT_DIR, MODULE, PREGEN, campaign_dir, git_log, read_json, read_jsonl

STEPS_PATH = CONTENT_DIR / "setup" / "steps.json"
STEP_IDS = ["choose-source", "build-bundle", "create-campaign", "bind-source", "build-opening",
            "create-investigator", "complete"]


def create_setting_up(kernel, campaign_id: str = CAMPAIGN, module: str = MODULE):
    return kernel.ok("campaign.create", {"id": campaign_id, "module": module, "play_language": "zh-Hans"})["campaign"]


# ---- status ladder ------------------------------------------------------------------------

def test_create_without_pregen_is_setting_up_with_an_empty_party(kernel):
    created = create_setting_up(kernel)
    assert created["status"] == "setting_up"
    assert created["investigators"] == []
    assert created["module_generation"] == 1 and len(created["module_digest"]) == 64
    assert not list((campaign_dir(kernel.workspace) / "party").glob("*.json"))
    assert kernel.ok("campaign.list")["campaigns"][0]["status"] == "setting_up"
    # the starter went into the module store at creation (§14.1)
    module = read_json(kernel.workspace / ".coc" / "modules" / MODULE / "module.json")
    assert module["status"] == "installed" and module["source"] == "starter" and module["generation"] == 1
    assert (kernel.workspace / ".coc" / "modules" / MODULE / "module-graph.json").exists()


def test_create_with_pregen_stays_active_as_before(kernel):
    created = kernel.ok("campaign.create", {"id": CAMPAIGN, "module": MODULE, "pregen": PREGEN})["campaign"]
    assert created["status"] == "active" and created["investigators"] == [PREGEN]
    assert kernel.table("open")["opening_needed"] is True


def test_open_refuses_a_campaign_that_is_setting_up_with_the_table_fix(kernel):
    create_setting_up(kernel)
    steps = json.loads(STEPS_PATH.read_text(encoding="utf-8"))
    error = kernel.table_err("open")
    assert error["code"] == "campaign_not_ready"
    assert error["fix"] == steps["table_open_fix"].format(campaign=CAMPAIGN) == f"bin/pi-coc setup --campaign {CAMPAIGN}"
    for method, params in (("look", {}), ("capsule", {}), ("player_input", {"text": "x"})):
        assert kernel.table_err(method, **params)["code"] == "campaign_not_ready"


def test_first_open_of_a_ready_campaign_makes_it_active(kernel):
    create_setting_up(kernel)
    kernel.ok("setup.investigator", {"campaign": CAMPAIGN, "name": "Ada", "occupation": "Journalist"})
    done = kernel.ok("setup.complete", {"campaign": CAMPAIGN})
    assert done["status"] == "ready_for_table"
    assert read_json(campaign_dir(kernel.workspace) / "campaign.json")["status"] == "ready_for_table"
    opened = kernel.table("open")
    assert opened["campaign"]["status"] == "active"
    assert opened["investigators"][0]["id"] == "ada"
    assert opened["opening_needed"] is True
    assert read_json(campaign_dir(kernel.workspace) / "campaign.json")["status"] == "active"
    assert kernel.table("open")["campaign"]["status"] == "active"
    # setup is over: its methods no longer apply
    assert kernel.err("setup.investigator", {"campaign": CAMPAIGN, "name": "B", "occupation": "Artist"})["code"] == "campaign_not_ready"
    # and the table plays
    kernel.table("narrate", call_id="t0-c1", text="开场。")
    assert kernel.table("player_input", text="我看看。")["turn"] == 1


# ---- the seven-step table ------------------------------------------------------------------

def test_steps_table_is_the_seven_steps_in_order_and_a_dag(kernel):
    table = kernel.ok("setup.steps", {})
    assert table == json.loads(STEPS_PATH.read_text(encoding="utf-8"))
    assert [s["id"] for s in table["steps"]] == STEP_IDS
    assert table["start"] == "choose-source"
    by_id = {s["id"]: s for s in table["steps"]}
    for step in table["steps"]:
        assert step["kind"] in ("ask", "external", "op")
        assert (step["op"] is not None) == (step["kind"] == "op")
        assert step["only_for"] in (None, "starter", "pdf")
        for need in step["needs"]:
            assert need in by_id and STEP_IDS.index(need) < STEP_IDS.index(step["id"])
        for language in ("zh-Hans", "en"):
            assert step["lines"][language]["next"] and step["lines"][language]["do"]
    assert by_id["build-bundle"]["needs"] == ["choose-source"] and by_id["build-bundle"]["only_for"] == "pdf"
    assert by_id["create-investigator"]["needs"] == ["create-campaign", "build-opening"]
    assert by_id["complete"]["needs"] == ["create-investigator"]
    for language in ("zh-Hans", "en"):
        assert set(table["templates"][language]) == {"unknown_step", "needs_unmet", "already_done", "all_done"}


def test_kernel_side_ops_in_the_table_exist(kernel):
    table = kernel.ok("setup.steps", {})
    methods = set(kernel.err("no.such.method")["details"]["methods"])
    for step in table["steps"]:
        if step["kind"] != "op":
            continue
        if step.get("side") == "extension":
            assert step["op"] == "module.build"  # §14.5: the extension's driver loop, not a kernel method
            continue
        assert step["op"] in methods, step["op"]


# ---- occupations and investigators ------------------------------------------------------------

def test_occupations_are_the_rules_table(kernel):
    result = kernel.ok("setup.occupations", {})
    occupations = json.loads((CONTENT_DIR / "rulesets" / "coc7" / "rules-json" / "occupations.json").read_text())["occupations"]
    assert [row["id"] for row in result["occupations"]] == list(occupations)
    journalist = next(row for row in result["occupations"] if row["id"] == "Journalist")
    assert journalist["skill_point_formula"] == occupations["Journalist"]["skill_point_formula"]
    assert journalist["credit_rating_range"] == occupations["Journalist"]["credit_rating_range"]


def test_investigator_writes_a_pregen_shaped_sheet_and_a_receipt(kernel):
    create_setting_up(kernel)
    result = kernel.ok("setup.investigator", {"campaign": CAMPAIGN, "name": "艾达·王", "occupation": "Journalist",
                                              "concept": "战地记者", "age": 31, "sex": "F"})
    assert result["receipt"] == "investigator:inv-1"
    row = result["investigator"]
    assert row["id"] == "inv-1" and row["name"] == "艾达·王" and row["occupation"] == "Journalist"
    sheet = read_json(campaign_dir(kernel.workspace) / "party" / "inv-1.json")
    assert sheet["backstory"]["concept"] == "战地记者" and sheet["sex"] == "F" and sheet["age"] == 31
    assert (row["hp"], row["san"], row["mp"], row["luck"]) == (
        sheet["derived"]["HP"], sheet["derived"]["SAN"], sheet["derived"]["MP"], sheet["characteristics"]["LUCK"])
    meta = read_json(campaign_dir(kernel.workspace) / "campaign.json")
    assert meta["investigators"] == ["inv-1"]
    assert meta["setup"]["receipts"][0]["id"] == "investigator:inv-1"
    assert result["next"]
    # a second call is a second investigator
    second = kernel.ok("setup.investigator", {"campaign": CAMPAIGN, "name": "Bob Reed", "occupation": "Artist"})
    assert second["receipt"] == "investigator:bob-reed"
    assert read_json(campaign_dir(kernel.workspace) / "campaign.json")["investigators"] == ["bob-reed", "inv-1"]
    assert kernel.err("setup.investigator", {"campaign": CAMPAIGN, "name": "Bob Reed", "occupation": "Artist"})["code"] == "invalid_params"


def test_investigator_only_accepts_occupation_ids(kernel):
    create_setting_up(kernel)
    error = kernel.err("setup.investigator", {"campaign": CAMPAIGN, "name": "Ada", "occupation": "war correspondent"})
    assert error["code"] == "needs" and error["details"]["needs"]["field"] == "occupation"
    assert "Journalist" in error["details"]["needs"]["options"]
    assert kernel.err("setup.investigator", {"campaign": CAMPAIGN, "name": "", "occupation": "Journalist"})["code"] == "invalid_params"
    assert kernel.err("setup.investigator", {"campaign": CAMPAIGN, "name": "Ada", "occupation": "Journalist", "age": 12})["code"] == "invalid_params"
    assert kernel.err("setup.investigator", {"campaign": CAMPAIGN, "name": "Ada", "occupation": "Journalist", "method": "point_buy"})["code"] == "invalid_params"
    assert not list((campaign_dir(kernel.workspace) / "party").glob("*.json"))


# ---- complete -------------------------------------------------------------------------------------

def test_complete_needs_a_party_then_hands_off(kernel):
    create_setting_up(kernel)
    error = kernel.err("setup.complete", {"campaign": CAMPAIGN})
    assert error["code"] == "needs" and error["details"]["needs"]["step"] == "create-investigator"
    kernel.ok("setup.investigator", {"campaign": CAMPAIGN, "name": "Ada", "occupation": "Journalist"})
    done = kernel.ok("setup.complete", {"campaign": CAMPAIGN})
    assert done["receipt"] == "setup:handoff"
    assert done["module_id"] == MODULE and done["module_generation"] == 1
    assert done["investigators"] == ["ada"] and done["launch"] == f"bin/pi-coc --campaign {CAMPAIGN}"
    meta = read_json(campaign_dir(kernel.workspace) / "campaign.json")
    assert meta["status"] == "ready_for_table" and meta["setup"]["handoff"]["receipt"] == "setup:handoff"
    events = read_jsonl(campaign_dir(kernel.workspace) / "events.jsonl")
    assert [e["type"] for e in events] == ["setup-completed"]
    assert events[0]["receipt"] == "setup:handoff" and events[0]["data"]["investigators"] == ["ada"]
    assert git_log(kernel.workspace)[0] == f"campaign {CAMPAIGN}: setup handoff"
    replay = kernel.ok("setup.complete", {"campaign": CAMPAIGN})
    assert replay["replayed"] is True and replay["receipt"] == "setup:handoff"


def test_complete_is_refused_on_an_unknown_campaign(kernel):
    assert kernel.err("setup.complete", {"campaign": "nope"})["code"] == "campaign_not_found"
    assert kernel.err("setup.investigator", {"campaign": "nope", "name": "A", "occupation": "Artist"})["code"] == "campaign_not_found"
