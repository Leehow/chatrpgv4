"""Turn floor (docs/specs/turn-floor.md), kernel side, through the RPC seam: the four floor lines
ride in `style.floor` on every turn; an empty turn and a repeated input are structural RECOVER
signs with the recovery ladder in `director.offer`; how a turn closed is recorded and surfaces in
`recent`; taking an offered route is recorded as adoption; and the combat refusal for a person
with no stat block names the lawful route, never "narrate without dice"."""

import json

from conftest import CONTENT_DIR, campaign_dir, narrate, open_turn, read_json
from test_director_scoring import rule, threshold, weighted
from test_rules_families import first_failure, first_success, resolve_err

FLOOR_LINES = json.loads((CONTENT_DIR / "craft" / "beat-directives.json").read_text(encoding="utf-8"))["floor_lines"]
DIRECTOR_GRAPH = json.loads((CONTENT_DIR / "director" / "director-graph.json").read_text(encoding="utf-8"))


def director_of(client):
    return client.table("capsule")["director"]


# ---- style.floor: every turn, full form and brief form alike -----------------------------------

def test_style_carries_the_four_floor_lines_on_every_turn(kernel):
    first = open_turn(kernel, "我打量诺特。")["capsule"]
    assert first["style"]["floor"] == FLOOR_LINES and len(FLOOR_LINES) == 4
    assert all(line.split(":")[0] in {"uptake", "answer", "voice", "handoff"} for line in FLOOR_LINES)
    narrate(kernel, "t1-c1", "诺特抬起头。")
    second = kernel.table("player_input", text="我坐下。")["capsule"]
    assert second["style"]["floor"] == FLOOR_LINES, "the brief turns keep the floor; only the directive list shrinks"
    assert len(second["style"]["directives"]) <= 4 < len(first["style"]["directives"])
    assert "director.offer" in second["head"] and "Director signals and offers remain advice" in second["head"]


# ---- structural signals: empty turn, repeated input, how the last turn closed -------------------

def test_first_player_turn_has_no_previous_turn_to_read(kernel):
    director = open_turn(kernel, "然后呢")["capsule"]["director"]
    assert "empty_turns = 0" in director["because"]
    assert "repeat_input = False" in director["because"]
    assert "previous_close = none" in director["because"]


def test_an_empty_turn_and_a_repeated_input_score_recover_from_the_graph(kernel):
    open_turn(kernel, "然后呢")
    narrate(kernel, "t1-c1", "诺特靠回椅背，等着你。")  # nothing rolled, nothing applied: an empty turn
    director = kernel.table("player_input", text="然后呢")["capsule"]["director"]
    assert "empty_turns = 1" in director["because"] and 1 >= threshold("recover-empty-turns")
    assert "repeat_input = True" in director["because"]
    assert "previous_close = explicit" in director["because"]
    assert director["beat"] == "RECOVER"
    # base = the larger of the two constant hits, weighted by the structure (test_director_scoring reads the graph the kernel reads)
    assert director["scores"]["RECOVER"] == max(weighted("RECOVER", "empty-turn"), weighted("RECOVER", "repeated-input"))
    assert rule("RECOVER", "repeated-input") > rule("RECOVER", "empty-turn") > 0
    assert "empty-turn" in director["reason"] and "repeated-input" in director["reason"]


def test_a_different_line_after_an_empty_turn_is_not_a_repeat(kernel):
    open_turn(kernel, "然后呢")
    narrate(kernel, "t1-c1", "诺特靠回椅背，等着你。")
    director = kernel.table("player_input", text="我接下这活。")["capsule"]["director"]
    assert "empty_turns = 1" in director["because"] and "repeat_input = False" in director["because"]
    # one empty turn puts RECOVER on the board under the stalled PRESSURE band; it does not overturn the doctrine
    assert rule("RECOVER", "empty-turn") < rule("PRESSURE", "clock-near-full-or-stalled")
    assert director["scores"].get("RECOVER", weighted("RECOVER", "empty-turn")) == weighted("RECOVER", "empty-turn")
    assert director["beat"] != "RECOVER"


def test_a_turn_that_landed_a_receipt_is_not_empty(kernel):
    open_turn(kernel, "我接下这活。")
    kernel.table("apply", call_id="t1-c1", effects=[{"kind": "clue", "clue": "knott-commission"}])
    narrate(kernel, "t1-c2", "诺特点头。")
    director = kernel.table("player_input", text="然后呢")["capsule"]["director"]
    assert "empty_turns = 0" in director["because"]
    assert "RECOVER" not in director["scores"]


# ---- director.offer: material in the Keeper's hand, in the ladder's order -----------------------

def test_recover_offer_leads_with_the_present_person_when_nothing_is_owed(kernel):
    open_turn(kernel, "然后呢")
    narrate(kernel, "t1-c1", "诺特靠回椅背，等着你。")
    director = kernel.table("player_input", text="然后呢")["capsule"]["director"]
    offer = director["offer"]
    assert 1 <= len(offer) <= 3 and all({"kind", "line", "from"} <= set(row) for row in offer)
    assert all(len(row["line"]) <= 120 for row in offer)
    # no receipt last turn, so no consequence row; the ladder falls to the person with a want
    assert offer[0]["kind"] == "person" and offer[0]["who"] == "Steven Knott" and offer[0]["from"] == "present"
    assert "wants:" in offer[0]["line"]
    assert not any(row["kind"] == "consequence" for row in offer)


def test_a_failed_check_last_turn_is_the_consequence_still_owed(seeded_kernel):
    from test_rules_families import first_failure
    open_turn(seeded_kernel, "我打量诺特。")
    call_id, result = first_failure(seeded_kernel, "t1-c", intent="social", goal="让诺特多说点", method="套话", skill="Persuade", target="Steven Knott")
    narrate(seeded_kernel, "t1-c99", "诺特把嘴闭紧了。")
    director = seeded_kernel.table("player_input", text="然后呢")["capsule"]["director"]
    # a roll landed, so the turn was not empty and RECOVER need not win; the owed consequence still gets a seat
    owed = [row for row in director["offer"] if row["kind"] == "consequence"]
    assert len(owed) == 1 and owed[0]["from"] == "recent.receipts"
    assert "failed last turn" in owed[0]["line"]


def test_an_open_exit_someone_present_knows_becomes_a_route_row(kernel):
    open_turn(kernel, "我接下这活。")
    kernel.table("apply", call_id="t1-c1", effects=[{"kind": "clue", "clue": "knott-research-leads"}])
    capsule = kernel.table("capsule")
    routes = [row for row in capsule["director"]["offer"] if row["kind"] == "route"]
    open_exits = {exit["to"] for exit in capsule["where"]["exits"] if exit.get("unlock_when", {}).get("met") is not False}
    assert routes, capsule["director"]
    assert all(row["where"] in open_exits for row in routes)
    assert routes[0]["from"] in {"mods.thread", "where.exits"}
    assert routes[0].get("who") in {None, "Steven Knott"}


def test_walking_the_offered_route_is_recorded_as_offer_taken(kernel):
    open_turn(kernel, "我接下这活。")
    kernel.table("apply", call_id="t1-c1", effects=[{"kind": "clue", "clue": "knott-research-leads"}])
    narrate(kernel, "t1-c2", "诺特把地址写给你。")
    capsule = kernel.table("player_input", text="我去查档案。")["capsule"]
    route = next(row for row in capsule["director"]["offer"] if row["kind"] == "route")
    kernel.table("apply", call_id="t2-c1", effects=[{"kind": "move", "to": route["where"]}])
    narrate(kernel, "t2-c2", "你出了门。")
    record = read_json(campaign_dir(kernel.workspace) / "turns" / "0002.json")
    adoption = record["director_adoption"]
    assert adoption["offer_taken"] == [f"route:{route['where']}"]


def test_offer_stays_inside_the_director_budget(kernel):
    capsule = open_turn(kernel, "我打量诺特。")["capsule"]
    assert len(json.dumps(capsule["director"], ensure_ascii=False).encode("utf-8")) <= 2048
    assert capsule["director"]["offer"], "the offer survived the fit"
    assert "director" not in capsule.get("truncated", [])


# ---- how a turn closed is recorded and read back ------------------------------------------------

def test_an_implicit_close_is_recorded_and_surfaces_in_recent_and_the_signals(kernel):
    open_turn(kernel, "然后呢")
    narrate(kernel, "t1-c1", "诺特靠回椅背，等着你。", implicit=True)
    record = read_json(campaign_dir(kernel.workspace) / "turns" / "0001.json")
    assert record["closed_by"] == "narrate" and record["closed_how"] == "implicit"
    capsule = kernel.table("player_input", text="继续")["capsule"]
    assert capsule["recent"][-1] == {"turn": 1, "player": "然后呢", "keeper": "诺特靠回椅背，等着你。", "closed": "implicit", "receipts": 0}
    assert "previous_close = implicit" in capsule["director"]["because"]


def test_an_explicit_close_is_the_default(kernel):
    open_turn(kernel, "我打量诺特。")
    narrate(kernel, "t1-c1", "诺特抬起头。")
    record = read_json(campaign_dir(kernel.workspace) / "turns" / "0001.json")
    assert record["closed_how"] == "explicit"


# ---- the graph carries the two rules and the threshold, as data --------------------------------

def test_the_director_graph_declares_the_two_recover_rules_and_their_threshold():
    ids = {node["node_id"] for node in DIRECTOR_GRAPH["nodes"]}
    assert {"scoring-rule:recover:empty-turn", "scoring-rule:recover:repeated-input", "threshold:recover-empty-turns"} <= ids
    relations = {(r["from_node_id"], r["to_node_id"]) for r in DIRECTOR_GRAPH["relations"] if r["relation_kind"] == "scores"}
    assert ("scoring-rule:recover:empty-turn", "director-action:recover") in relations
    assert ("scoring-rule:recover:repeated-input", "director-action:recover") in relations
    manifest = read_json(CONTENT_DIR / "director" / "director-graph-manifest.json")
    counts = {}
    for node in DIRECTOR_GRAPH["nodes"]:
        counts[node["node_kind"]] = counts.get(node["node_kind"], 0) + 1
    assert manifest["node_counts"] == counts


# ---- D5: the refusal names the lawful route -----------------------------------------------------

def test_attacking_a_person_with_no_stat_block_is_refused_toward_a_receipt_not_toward_prose(kernel):
    open_turn(kernel, "我想把你打一顿")
    error = resolve_err(kernel, "t1-c1", intent="combat", goal="打诺特", method="挥拳", actor="Thomas Hayes", target="Steven Knott")
    assert error["code"] == "needs"
    assert "no stat block" in error["message"]
    fix = error["fix"]
    assert "Nothing without a receipt has happened" in fix
    assert "do not narrate a blow as landed" in fix
    assert "without dice" not in fix


# ---- advisory obstacle signals without recovery debt (contract §122, #99 D4) --------------------

def _fail_the_same_check(client, turn_no, text):
    """One played turn that fails STR against a Keeper-set target, then closes."""
    call_id, _ = first_failure(client, f"t{turn_no}-c", intent="investigate", goal="撬开钉死的柜门",
                               method="拿铁条一颗一颗撬", skill="STR", target="nailed cupboard")
    narrate(client, f"t{turn_no}-c99", "钉子纹丝不动。")
    return client.table("player_input", text=text)["capsule"]["director"]


def test_failed_checks_keep_obstacle_signals_without_recovery_debt(seeded_kernel):
    """`blocked_attempts` is the case `stalled_turns` cannot see (campaign game-83177d61 turns 34, 41,
    60 and 62: the same nailed cupboard, STR against 40, four failures, `stalled_turns` at 4, 0 and 2
    because a clue or a move reset it each time). Both failures remain advisory signals; neither
    creates a mandatory effect or receipt before delivery."""
    open_turn(seeded_kernel, "我打量那口钉死的柜子。")
    after_one = _fail_the_same_check(seeded_kernel, 1, "再撬一次")
    assert after_one["because"].count("blocked_attempts = 1") == 1, after_one["because"]
    assert "recovery" not in after_one, "one failed check is play: the risk was real and it cost"

    after_two = _fail_the_same_check(seeded_kernel, 2, "还是撬不动，我换个角度")
    assert after_two["because"].count("blocked_attempts = 2") == 1, after_two["because"]
    assert "recovery" not in after_two
    assert after_two["scores"]["RECOVER"] > 0
    assert after_two["offer"], "Useful options remain available without making one mandatory"
    narrate(seeded_kernel, "t3-c1", "你停下手，重新想了想已经知道的事。")
    assert read_json(campaign_dir(seeded_kernel.workspace) / "turns" / "0003.json")["receipts"] == []


def test_passing_the_obstacle_clears_its_advisory_count(seeded_kernel):
    open_turn(seeded_kernel, "我打量那口钉死的柜子。")
    _fail_the_same_check(seeded_kernel, 1, "再撬一次")
    after_two = _fail_the_same_check(seeded_kernel, 2, "还是撬不动")
    assert "blocked_attempts = 2" in after_two["because"] and "recovery" not in after_two
    first_success(seeded_kernel, "t3-c", intent="investigate", goal="撬开钉死的柜门",
                  method="拿铁条一颗一颗撬", skill="STR", target="nailed cupboard")
    narrate(seeded_kernel, "t3-c99", "钉子终于松了。")
    after_pass = seeded_kernel.table("player_input", text="我把柜门拉开")["capsule"]["director"]
    assert after_pass["because"].count("blocked_attempts = 0") == 1, after_pass["because"]
    assert "recovery" not in after_pass
