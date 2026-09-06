"""Black-box laws for the setup process (contract §14.4, §14.7): the seven-step
table, `table.open` sending an unfinished campaign back to it, and deterministic
investigator creation.

Status at write time (`kernel/coc/setup.py`, `kernel/coc/chargen.py`,
`content/setup/steps.json` all already exist and `setup.steps` / `setup.occupations`
/ `setup.investigator` / `setup.complete` are wired into `kernel/coc/rpc.py`):
this file's "happy path" tests using the `the-haunting` starter (which already has
`content/starters/the-haunting/module-graph.json`) are expected to pass today.
What is genuinely not implemented yet: `campaign.create` refuses any `module` that
is not already a directory under `content/starters/` with a `module-graph.json`
(`kernel/coc/table.py` `self.modules()`), so a campaign against a bound PDF module
(no starter entry) cannot be created before `module.bind`/`module.plan` run --
this blocks the pdf lane's own `create-campaign` step (which the seven-step table
says happens *before* `bind-source`). `mystery-house` and `the-white-war` are not
yet projected to v3 graphs (`content/starters/<id>/module-graph.json` absent;
`scripts/starter_graph.py` from §14.9 has not run) so campaigns against them fail
today for the same "unknown module" reason -- see the parametrized test below.

(An earlier draft of this file found `setup.complete`'s `module.get("opening_ready")`
check reading a key `module.assemble` never wrote -- `kernel/coc/modules/assemble.py`
now writes `meta["opening_ready"]` at the top level, so that shortcut is live; the
campaign.create gate above is the one real blocker left for the pdf lane.)
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

from conftest import CAMPAIGN, KERNEL_DIR, MODULE, PREGEN, RpcClient, campaign_dir, create_campaign, read_json

sys.path.insert(0, str(KERNEL_DIR))

from coc.modules.playability import check as playability_check  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
RULES_DIR = REPO_ROOT / "content" / "rulesets" / "coc7" / "rules-json"
STEPS_PATH = REPO_ROOT / "content" / "setup" / "steps.json"

LANGUAGES = ("zh-Hans", "en")
# §14.5: module.build is the extension's own driver loop, explicitly *not* a kernel
# method ("module.build 是扩展侧的驱动循环（不是内核方法）") -- every other `op` in the
# seven-step table must be a real registered RPC method.
NON_KERNEL_OP_EXCEPTIONS = frozenset({"module.build"})

#: Cross-referenced with tests/kernel/test_starters.py's own `KNOWN_IR_FINDINGS`:
#: pre-existing facts in the projected IR, not defects this ticket's pipeline
#: introduced. Keep in sync if that file's set changes.
KNOWN_STARTER_IR_FINDINGS = {
    "mystery-house": {("actor_in_no_scene", "npc-rat-swarm")},
    "the-white-war": {("clue_nowhere_to_find", "clue-entity-retreats-low-hp"),
                      ("clue_nowhere_to_find", "clue-ice-seal-blasted-away"),
                      ("clue_nowhere_to_find", "clue-survivor-folklore-of-seal")},
}


# ---- helpers ---------------------------------------------------------------------


def registered_methods(client: RpcClient) -> set[str]:
    """RPC method names the kernel actually dispatches, read off the closed-enum
    `unknown_method` error's `details.methods` (contract §1) -- never guessed."""
    return set(client.err("nope.method-does-not-exist", {})["details"]["methods"])


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def setting_up_campaign(client: RpcClient, *, module: str = MODULE, campaign: str = CAMPAIGN,
                        play_language: str = "zh-Hans") -> dict:
    """§14.4's create-campaign op: no `pregen`, so the campaign is `setting_up` with
    an empty party (kernel/coc/table.py campaign_create's docstring)."""
    return client.ok("campaign.create", {"id": campaign, "module": module, "play_language": play_language})


def age_bracket(age: int) -> dict:
    table = load_json(RULES_DIR / "age-adjustments.json")
    for row in table["brackets"]:
        if int(row["min_age"]) <= age <= int(row["max_age"]):
            return row
    raise AssertionError(f"no age bracket covers age {age}")


def movement_base(str_value: int, dex_value: int, siz_value: int) -> int:
    table = load_json(RULES_DIR / "movement-rate.json")

    def relation(value: int) -> str:
        return "less_than" if value < siz_value else ("greater_than" if value > siz_value else "equal")

    str_rel, dex_rel = relation(str_value), relation(dex_value)
    for row in table["rules"]:
        if row["str_relation_to_siz"] not in ("any", str_rel):
            continue
        if row["dex_relation_to_siz"] not in ("any", dex_rel):
            continue
        return int(row["base_mov"])
    raise AssertionError(f"no movement-rate rule matches STR={str_value} DEX={dex_value} SIZ={siz_value}")


def damage_bonus_build(total: int) -> tuple[str, int | str]:
    table = load_json(RULES_DIR / "damage-bonus-build.json")
    for row in table:
        if int(row["min"]) <= total <= int(row["max"]):
            return row["damage_bonus"], row["build"]
    raise AssertionError(f"no damage-bonus-build row covers STR+SIZ={total}")


def occupation_row(occupation_id: str) -> dict:
    table = load_json(RULES_DIR / "occupations.json")["occupations"]
    return table[occupation_id]


# ---- setup.steps: the DAG, its ops, its texts -----------------------------------


def test_setup_steps_table_matches_the_committed_content_file(kernel):
    """`setup.steps` (kernel/coc/setup.py `steps_method`) returns a deep copy of
    `content/setup/steps.json` verbatim -- the file both the onboarding extension and
    the kernel read, per the ticket's "order, available actions ... written here once"."""
    from_rpc = kernel.ok("setup.steps", {})
    from_disk = load_json(STEPS_PATH)
    assert from_rpc == from_disk
    assert from_rpc["contract"] == "coc.setup-steps.v1"


def test_setup_steps_is_a_dag_and_start_is_a_step(kernel):
    steps = kernel.ok("setup.steps", {})["steps"]
    by_id = {row["id"]: row for row in steps}
    assert len(by_id) == len(steps), "duplicate step ids"

    visiting: set[str] = set()
    done: set[str] = set()

    def visit(step_id: str, chain: list[str]) -> None:
        if step_id in done:
            return
        assert step_id not in visiting, f"cycle through {step_id}: {chain}"
        visiting.add(step_id)
        for need in by_id[step_id].get("needs") or []:
            assert need in by_id, f"{step_id} needs unknown step {need!r}"
            visit(need, [*chain, need])
        visiting.discard(step_id)
        done.add(step_id)

    for step_id in by_id:
        visit(step_id, [step_id])


def test_setup_steps_ops_are_registered_rpc_methods_with_one_documented_exception(kernel):
    steps = kernel.ok("setup.steps", {})["steps"]
    registered = registered_methods(kernel)
    op_steps = [row for row in steps if row.get("kind") == "op"]
    assert op_steps, "expected at least one kind:op step"
    for row in op_steps:
        op = row["op"]
        assert isinstance(op, str) and op, f"step {row['id']} has no op"
        if op in NON_KERNEL_OP_EXCEPTIONS:
            continue
        assert op in registered, (
            f"step {row['id']}'s op {op!r} is not a registered RPC method "
            f"(registered: {sorted(registered)})"
        )


def test_setup_steps_rejection_and_next_texts_are_nonempty_in_every_language(kernel):
    steps = kernel.ok("setup.steps", {})
    for language in LANGUAGES:
        templates = steps["templates"][language]
        for key in ("unknown_step", "needs_unmet", "already_done", "all_done"):
            assert isinstance(templates[key], str) and templates[key].strip(), (language, key)
    for row in steps["steps"]:
        for language in LANGUAGES:
            lines = row["lines"][language]
            assert isinstance(lines["do"], str) and lines["do"].strip(), (row["id"], language, "do")
            assert isinstance(lines["next"], str) and lines["next"].strip(), (row["id"], language, "next")


# ---- table.open on an unfinished campaign ----------------------------------------


def test_table_open_on_setting_up_campaign_sends_back_to_setup(kernel):
    created = setting_up_campaign(kernel)["campaign"]
    assert created["status"] == "setting_up"
    assert created["investigators"] == []

    error = kernel.table_err("open")
    assert error["code"] == "campaign_not_ready"
    assert error["fix"] == f"bin/pi-coc setup --campaign {CAMPAIGN}"
    assert error["details"]["status"] == "setting_up"


def test_setup_methods_refuse_a_campaign_that_is_already_active(kernel):
    """A pregen-created campaign is `active` immediately (the old, still-supported
    shortcut); setup.* methods only operate on `setting_up` campaigns."""
    create_campaign(kernel)  # conftest's helper: MODULE + PREGEN -> status active
    error = kernel.err("setup.investigator", {"campaign": CAMPAIGN, "name": "X", "occupation": "Antiquarian"})
    assert error["code"] == "campaign_not_ready"
    assert error["details"]["status"] == "active"

    error2 = kernel.err("setup.complete", {"campaign": CAMPAIGN})
    assert error2["code"] == "campaign_not_ready"
    assert error2["details"]["status"] == "active"


# ---- setup.investigator: deterministic under a seed, matches the rulebook -------


ANTIQUARIAN_FORMULA_CHARS = 1  # EDU*4 has one characteristic term


def test_setup_occupations_lists_antiquarian_with_its_book_numbers(kernel):
    created = setting_up_campaign(kernel)
    occupations = {row["id"]: row for row in kernel.ok("setup.occupations", {"campaign": CAMPAIGN})["occupations"]}
    assert "Antiquarian" in occupations
    row = occupations["Antiquarian"]
    book = occupation_row("Antiquarian")
    assert row["skill_point_formula"] == book["skill_point_formula"] == "EDU*4"
    assert row["credit_rating_range"] == book["credit_rating_range"] == [30, 70]


def test_setup_investigator_derived_values_match_rulebook_arithmetic(kernel):
    setting_up_campaign(kernel)
    result = kernel.ok("setup.investigator", {
        "campaign": CAMPAIGN, "name": "陈墨", "occupation": "Antiquarian", "concept": "爱书的旧货商",
        "age": 27, "method": "quick_fire", "seed": "h5-fixed-seed-1",
    })
    sheet = result["sheet"]
    chars = sheet["characteristics"]
    derived = sheet["derived"]

    # HP = (CON+SIZ)//10, MP = POW//5, SAN = POW (derived-attributes.json).
    assert derived["HP"] == (chars["CON"] + chars["SIZ"]) // 10
    assert derived["MP"] == chars["POW"] // 5
    assert derived["SAN"] == chars["POW"]

    # MOV: movement-rate.json's STR/DEX-vs-SIZ rule, minus the age bracket's mov_penalty,
    # floored at 0 (age-adjustments.json + movement-rate.json).
    bracket = age_bracket(sheet["age"])
    base_mov = movement_base(chars["STR"], chars["DEX"], chars["SIZ"])
    assert derived["MOV"] == max(0, base_mov - int(bracket["mov_penalty"]))

    # DB/BUILD from the STR+SIZ damage-bonus-build.json table.
    expected_db, expected_build = damage_bonus_build(chars["STR"] + chars["SIZ"])
    assert derived["DB"] == expected_db
    assert derived["BUILD"] == expected_build

    # Luck is rolled (3D6 x5), independent of POW -- a plausible roll, not a literal.
    assert chars["LUCK"] % 5 == 0
    assert 15 <= chars["LUCK"] <= 90

    # Occupation skill points equal the occupation's formula (EDU*4 for Antiquarian),
    # and credit rating sits at the occupation's range floor.
    occ = sheet["creation"]["skills"]["occupation"]
    book = occupation_row("Antiquarian")
    assert occ["budget"]["total"] == chars["EDU"] * 4
    assert occ["credit_rating"]["value"] == book["credit_rating_range"][0] == sheet["credit_rating"]
    assert book["credit_rating_range"][0] <= sheet["credit_rating"] <= book["credit_rating_range"][1]
    assert occ["points"] == occ["budget"]["total"] - occ["credit_rating"]["value"]
    assert occ["spent"] + occ["unspent"] == occ["points"]

    # Personal interest points = INT*2 (Keeper Rulebook ch.3, content/setup/steps.json
    # create-investigator.formulas.personal_interest_points).
    interest = sheet["creation"]["skills"]["interest"]
    assert interest["budget"]["total"] == chars["INT"] * 2
    assert interest["spent"] + interest["unspent"] == interest["budget"]["total"]


def test_setup_investigator_is_deterministic_under_the_same_seed(kernel):
    setting_up_campaign(kernel)
    common = {"campaign": CAMPAIGN, "occupation": "Antiquarian", "concept": "旧书店主",
             "age": 34, "method": "quick_fire", "seed": "h5-repeat-seed"}
    first = kernel.ok("setup.investigator", {**common, "name": "甲"})["sheet"]
    second = kernel.ok("setup.investigator", {**common, "name": "乙", "id": "inv-2"})["sheet"]

    for key in ("characteristics", "derived", "skills", "credit_rating"):
        assert first[key] == second[key], key


def test_setup_investigator_unknown_occupation_asks_for_one_of_the_options(kernel):
    setting_up_campaign(kernel)
    error = kernel.err("setup.investigator", {"campaign": CAMPAIGN, "name": "X", "occupation": "not-a-real-job"})
    assert error["code"] == "needs"
    assert error["details"]["needs"]["field"] == "occupation"
    assert "Antiquarian" in error["details"]["needs"]["options"]


# ---- setup.complete -------------------------------------------------------------


def test_setup_complete_needs_an_investigator_first(kernel):
    setting_up_campaign(kernel)
    error = kernel.err("setup.complete", {"campaign": CAMPAIGN})
    assert error["code"] == "needs"
    assert error["details"]["needs"]["field"] == "investigator"


def test_setup_complete_writes_handoff_and_flips_status_then_opens(kernel):
    setting_up_campaign(kernel)
    created = kernel.ok("setup.investigator", {
        "campaign": CAMPAIGN, "name": "沈静", "occupation": "Antiquarian",
        "age": 30, "method": "quick_fire", "seed": "h5-complete-seed",
    })
    investigator_id = created["investigator"]["id"]

    handoff = kernel.ok("setup.complete", {"campaign": CAMPAIGN})
    assert handoff["status"] == "ready_for_table"
    assert handoff["receipt"] == "setup:handoff"
    assert handoff["module_id"] == MODULE
    assert handoff["investigators"] == [investigator_id]
    assert handoff["launch"] == f"bin/pi-coc --campaign {CAMPAIGN}"

    meta = read_json(campaign_dir(kernel.workspace) / "campaign.json")
    assert meta["status"] == "ready_for_table"
    assert meta["setup"]["handoff"] == handoff or meta["setup"]["handoff"]["receipt"] == "setup:handoff"

    replay = kernel.ok("setup.complete", {"campaign": CAMPAIGN})
    assert replay["replayed"] is True
    assert replay["status"] == "ready_for_table"

    opened = kernel.table("open")
    assert opened["opening_needed"] is True
    reopened_meta = read_json(campaign_dir(kernel.workspace) / "campaign.json")
    assert reopened_meta["status"] == "active"


def test_setup_complete_module_not_ready_is_unreachable_for_a_starter(kernel):
    """A starter is `register_starter`-ed to `installed` status the moment
    `campaign.create` runs (kernel/coc/table.py), so for the starter lane
    setup.complete's "module not installed"/"opening_ready" branch cannot be
    exercised with only the-haunting; see test_module_laws.py for the bound-module
    (pdf lane) path where that branch is actually reachable (today blocked by the
    campaign.create gate documented at the top of this file)."""
    setting_up_campaign(kernel)
    module_meta = read_json(kernel.workspace / ".coc" / "modules" / MODULE / "module.json")
    assert module_meta["status"] == "installed"


# ---- the two new starters ---------------------------------------------------------


@pytest.mark.parametrize("starter_id", ["mystery-house", "the-white-war"])
def test_new_starter_creates_a_campaign_opens_and_passes_the_ten_invariants(starter_id, kernel):
    """§14.9: `mystery-house` and `the-white-war` are projected to v3 graphs by
    `scripts/starter_graph.py` and register through the same starter lane as any
    other module. Neither ships a pregen, so this drives the full setting_up ->
    setup.investigator -> setup.complete -> table.open chain (same as the
    handoff test above) rather than the `pregen` shortcut.

    `module.status` (contract §14.3) is not yet wired into `kernel/coc/rpc.py`'s
    `build_methods` (it lives, complete, in `kernel/coc/modules/rpc.py`), so there
    is no RPC surface today to ask "does this graph pass the ten invariants". This
    test therefore checks the shipped graph directly with the same pure checker
    `module.status` will call (`coc.modules.playability.check`) -- swap this for
    `kernel.ok("module.status", ...)["playability"]` once that method is wired,
    per the ticket's "via whatever module.* method exposes the playability
    report".

    The pass bar mirrors `tests/kernel/test_starters.py::test_playability_findings_are_accounted_for`
    (K5b's own test for these same two graphs) rather than a bare "zero findings":
    `node_without_page` fires on every node for a starter with no source document
    (the checker has no "no pages to cite" concept yet, and the reference starter
    the-haunting gets it too), and mystery-house/the-white-war each carry a small,
    named set of pre-existing IR facts (`npc-rat-swarm` genuinely present in no
    scene; three white-war clues genuinely undiscoverable) that K5b's test already
    pins by name. What must never appear is one of the seven *hard* invariants --
    dangling relations, no declared entrance/ending, a fragmented or unreachable
    scene graph, or a conclusion/clue with no support between them."""
    graph_path = REPO_ROOT / "content" / "starters" / starter_id / "module-graph.json"
    assert graph_path.exists(), f"{starter_id} has no module-graph.json yet (scripts/starter_graph.py §14.9)"

    setting_up_campaign(kernel, module=starter_id)
    created = kernel.ok("setup.investigator", {
        "campaign": CAMPAIGN, "name": "调查员", "occupation": "Antiquarian",
        "age": 29, "method": "quick_fire", "seed": f"h5-{starter_id}-seed",
    })
    assert created["investigator"]["id"]
    handoff = kernel.ok("setup.complete", {"campaign": CAMPAIGN})
    assert handoff["status"] == "ready_for_table"

    opened = kernel.table("open")
    assert opened["opening_needed"] is True
    assert opened["scene"]["name"]

    graph = load_json(graph_path)
    report = playability_check(graph)
    hard_invariants = {"dangling_relation", "no_entrance_declared", "no_ending_declared",
                       "scene_graph_fragmented", "scene_unreachable_from_entrance",
                       "conclusion_without_support", "clue_supports_nothing"}
    assert not (set(report["finding_counts"]) & hard_invariants), report["finding_counts"]
    other_findings = {(f["code"], f["subject"]) for f in report["findings"] if f["code"] != "node_without_page"}
    assert other_findings == KNOWN_STARTER_IR_FINDINGS[starter_id]
    assert report["finding_counts"].get("node_without_page", 0) == len(graph["nodes"])
