"""§14.4 / §14.7: the status ladder, the open gate, the seven-step table and setup.*."""

from __future__ import annotations

import json
import sys

from conftest import CAMPAIGN, CONTENT_DIR, KERNEL_DIR, MODULE, PREGEN, campaign_dir, git_log, read_json, read_jsonl

sys.path.insert(0, str(KERNEL_DIR))

from coc.setup import SetupSteps  # noqa: E402

STEPS_PATH = CONTENT_DIR / "setup" / "steps.json"
#: The seven original steps plus §21.5's library-source pair (`browse-library`,
#: `load-investigator`), an alternative to `create-investigator` gated on the same
#: `applies`/`order` machinery but on a second, independent axis (`investigator_source`).
STEP_IDS = ["choose-source", "prepare-module", "create-campaign",
            "create-investigator", "browse-library", "load-investigator", "complete"]
#: STEP_IDS as seen from one investigator lane at a time: the other lane's step(s) are
#: not applicable, so they never appear in that lane's `order`.
NEW_LANE_STEP_IDS = [step_id for step_id in STEP_IDS if step_id not in ("browse-library", "load-investigator")]
LIBRARY_LANE_STEP_IDS = [step_id for step_id in STEP_IDS if step_id != "create-investigator"]


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


def test_a_new_card_takes_the_era_the_book_declares(kernel):
    """The module node carries `runtime_projection.documents`, never `.record`: reading the
    record returned None and every card silently became 1920s, the-white-war included."""
    kernel.ok("campaign.create", {"id": "ww1-era", "module": "the-white-war", "play_language": "en"})
    made = kernel.ok("setup.investigator", {"campaign": "ww1-era", "name": "Bea", "occupation": "Journalist"})
    sheet = read_json(kernel.workspace / ".coc" / "campaigns" / "ww1-era" / "party" / f"{made['investigator']['id']}.json")
    assert sheet["era"] == "ww1", "the card takes the book's era, not the rulebook default"
    kernel.ok("campaign.create", {"id": "twenties", "module": MODULE, "play_language": "en"})
    other = kernel.ok("setup.investigator", {"campaign": "twenties", "name": "Cal", "occupation": "Journalist"})
    assert read_json(kernel.workspace / ".coc" / "campaigns" / "twenties" / "party"
                     / f"{other['investigator']['id']}.json")["era"] == "1920s"


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
        assert step.get("investigator_source") in (None, "new", "library")
        for need in step["needs"]:
            assert need in by_id and STEP_IDS.index(need) < STEP_IDS.index(step["id"])
        assert step["lines"]["next"] and step["lines"]["do"]  # one English form (§16.1)
    assert by_id["prepare-module"]["needs"] == ["choose-source"] and by_id["prepare-module"]["only_for"] == "pdf"
    assert by_id["create-investigator"]["needs"] == ["create-campaign", "prepare-module"]
    assert by_id["create-investigator"]["investigator_source"] == "new"
    assert by_id["browse-library"]["investigator_source"] == by_id["load-investigator"]["investigator_source"] == "library"
    assert by_id["load-investigator"]["needs"] == ["browse-library"]
    assert by_id["complete"]["needs"] == ["create-investigator", "load-investigator"]
    assert table["investigator_sources"] == ["new", "library"]
    assert set(table["templates"]) == {"unknown_step", "needs_unmet", "already_done", "all_done"}


def test_module_source_is_declared_and_skips_the_pdf_only_steps_as_not_applicable(kernel):
    """§20.7: the table's own `only_for`/`applies_to` machinery is what excludes a
    step for a source, so a third source needs no new step-level data -- just its
    name added to `sources`. For `module`, `build-bundle`/`bind-source`/`build-opening`
    (each `only_for: "pdf"`) are excluded the same way they already are for `starter`:
    not present in that source's order at all, which is "not applicable", a
    different thing from being present but blocked on an unmet prerequisite
    ("missing"; see `needs_unmet` for that case)."""
    table = kernel.ok("setup.steps", {})
    assert table["sources"] == ["starter", "pdf", "module"]
    steps = SetupSteps(STEPS_PATH)

    for pdf_only in ("prepare-module",):
        assert steps.applies(pdf_only, "pdf") is True
        assert steps.applies(pdf_only, "starter") is False
        assert steps.applies(pdf_only, "module") is False

    # `order` also takes a set of active kinds (§21.5's second axis lives alongside this
    # one): "module" plus "new" is what a resumed module-source, new-investigator setup
    # actually reports.
    assert steps.order({"module", "new"}) == ["choose-source", "create-campaign", "create-investigator", "complete"]
    for pdf_only in ("prepare-module",):
        assert pdf_only not in steps.order({"module", "new"})
    # the full pdf lane still has every step, in table order (unaffected by the third source)
    assert steps.order({"pdf", "new"}) == NEW_LANE_STEP_IDS


def test_investigator_source_is_a_second_independent_axis_and_skips_the_other_lane_as_not_applicable(kernel):
    """§21.5: getting an investigator onto the party has its own two-way choice --
    build one (create-investigator) or load one from the library (browse-library,
    then load-investigator) -- expressed with the same `applies`/`order` machinery as
    the module source, but through a separate field (`investigator_source`) so the two
    axes are independent: a step's applicability is never asked to encode both a module
    lane and an investigator lane in the same string."""
    table = kernel.ok("setup.steps", {})
    assert table["investigator_sources"] == ["new", "library"]
    steps = SetupSteps(STEPS_PATH)

    assert steps.applies("create-investigator", "new") is True
    assert steps.applies("create-investigator", "library") is False
    for library_only in ("browse-library", "load-investigator"):
        assert steps.applies(library_only, "library") is True
        assert steps.applies(library_only, "new") is False

    # the "new" lane: the library steps are excluded entirely (not applicable), never
    # merely "missing" a prerequisite.
    new_lane = steps.order({"starter", "new"})
    assert "create-investigator" in new_lane
    assert "browse-library" not in new_lane and "load-investigator" not in new_lane

    # the "library" lane: create-investigator (where occupation and point allocation
    # happen) is excluded the same way.
    library_lane = steps.order({"starter", "library"})
    assert "create-investigator" not in library_lane
    assert "browse-library" in library_lane and "load-investigator" in library_lane

    # the module-source axis is untouched by any of this: a module-source, pdf-source
    # book still shows every pdf-only step regardless of which investigator lane is active.
    assert steps.order({"pdf", "new"}) == NEW_LANE_STEP_IDS
    assert steps.order({"pdf", "library"}) == LIBRARY_LANE_STEP_IDS


def test_kernel_side_ops_in_the_table_exist(kernel):
    table = kernel.ok("setup.steps", {})
    methods = set(kernel.err("no.such.method")["details"]["methods"])
    for step in table["steps"]:
        if step["kind"] != "op":
            continue
        if step.get("side") == "extension":
            assert step["op"] == "module.prepare"  # §14.5: the extension's driver loop, not a kernel method
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


def test_investigator_allocation_policy_is_the_tables_default_or_the_callers_choice(kernel):
    """#21: `sheet.creation.allocation` names the policy; the default is the steps table's;
    `fill` stays available; anything else is refused with the options."""
    create_setting_up(kernel)
    table = kernel.ok("setup.steps", {})
    block = next(s for s in table["steps"] if s["id"] == "create-investigator")["allocation"]
    assert block["default"] == "spread" and block["tiers"] == [50, 70] and "allocation" in next(
        s for s in table["steps"] if s["id"] == "create-investigator")["params"]
    spread = kernel.ok("setup.investigator", {"campaign": CAMPAIGN, "name": "Ada", "occupation": "Military Officer", "seed": "7"})
    creation = spread["sheet"]["creation"]
    assert creation["allocation"] == {"policy": "spread", "tiers": block["tiers"], "source": "steps.json create-investigator.allocation"}
    assert creation["skills"]["occupation"]["reserved"] and {spread["sheet"]["skills"][s] for s in creation["skills"]["occupation"]["resolved"]} == {block["tiers"][0]}
    assert read_json(campaign_dir(kernel.workspace) / "campaign.json")["setup"]["receipts"][0]["allocation"] == "spread"
    filled = kernel.ok("setup.investigator", {"campaign": CAMPAIGN, "name": "Bob", "occupation": "Military Officer", "seed": "7",
                                              "allocation": "fill"})
    assert filled["sheet"]["creation"]["allocation"]["policy"] == "fill"
    assert filled["sheet"]["creation"]["skills"]["occupation"]["reserved"] == []
    error = kernel.err("setup.investigator", {"campaign": CAMPAIGN, "name": "Cy", "occupation": "Military Officer", "allocation": "random"})
    assert error["code"] == "invalid_params" and error["details"]["stage"] == "allocation"
    assert error["details"]["expected"]["options"] == ["spread", "fill"]
    assert kernel.err("setup.investigator", {"campaign": CAMPAIGN, "name": "Cy", "occupation": "Military Officer", "allocation": 3})["code"] == "invalid_params"


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
