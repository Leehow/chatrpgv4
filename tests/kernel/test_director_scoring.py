"""Slice 3, kernel side: the Director's three layers (contract §13.3) and adoption (§13.7),
through the RPC seam. Every expected number is read from the shipped graph file, never
typed here: the test proves the kernel scored what the graph says."""

import json

from conftest import CONTENT_DIR, RpcClient, campaign_dir, open_turn, read_json, read_jsonl
from test_rules_families import first_failure, resolve, seed_wound, walk_to_confrontation

DIRECTOR_GRAPH = json.loads((CONTENT_DIR / "director" / "director-graph.json").read_text(encoding="utf-8"))
ONTOLOGY = json.loads((CONTENT_DIR / "ontology" / "system-ontology.json").read_text(encoding="utf-8"))
STRUCTURE = "branching_investigation"  # the-haunting's module node declares none (§13.3 default)
GROUND_FLOOR_CLUES = ["corbitt-diaries", "upstairs-disturbance", "catholic-wards", "nailed-windows"]
BRIEFING_CLUES = ["knott-commission", "knott-research-leads", "knott-macario-summary", "knott-keys"]
DOCUMENTARY_HISTORY_CLUES = ["house-built-1835", "neighbor-lawsuit-1852", "second-lawsuit-outcome-unrecorded"]


# ---- the graph, read the way the kernel reads it -----------------------------------------

def _legacy():
    return {n["node_id"]: n["properties"]["legacy_key"] for n in DIRECTOR_GRAPH["nodes"]
            if n.get("plane") == "vocabulary" and "legacy_key" in n.get("properties", {})}


def rule(action, condition):
    legacy = _legacy()
    for node in DIRECTOR_GRAPH["nodes"]:
        props = node.get("properties") or {}
        if node["node_kind"] == "scoring-rule" and legacy[props["action_ref"]] == action and props["condition_id"] == condition:
            return props["value"]
    raise KeyError((action, condition))


def weight(action, structure=STRUCTURE):
    legacy = _legacy()
    for node in DIRECTOR_GRAPH["nodes"]:
        props = node.get("properties") or {}
        if (node["node_kind"] == "structure-weight" and legacy[props["structure_ref"]] == structure
                and legacy[props["action_ref"]] == action):
            return props["value"]
    raise KeyError((structure, action))


def threshold(name):
    for node in DIRECTOR_GRAPH["nodes"]:
        if node["node_kind"] == "threshold" and node["properties"]["threshold_id"] == name:
            return node["properties"]["value"]
    raise KeyError(name)


def tiebreak():
    return next(n["properties"]["order"] for n in DIRECTOR_GRAPH["nodes"] if n["node_kind"] == "tiebreak-order")


def weighted(action, condition, structure=STRUCTURE):
    return round(rule(action, condition) * weight(action, structure), threshold("score-precision-digits"))


def capped_linear(action, condition, steps, structure=STRUCTURE):
    base, per_turn, cap = rule(action, condition)
    return round(min(cap, base + per_turn * steps) * weight(action, structure), threshold("score-precision-digits"))


def grounded_names(*director_node_ids):
    """What §13.4 lets `grounded_by` say for these Director nodes: decisions by their
    semantic name, rules by id, then the effects those decisions may emit."""
    refs = {r["ref_id"]: r for r in ONTOLOGY["references"]}
    sources = {r["ref_id"] for r in ONTOLOGY["references"] if r["semantic_id"] in director_node_ids}
    targets = sorted({refs[rel["to_ref"]]["semantic_id"] for rel in ONTOLOGY["relations"]
                      if rel["relation_kind"] == "grounded-by" and rel["from_ref"] in sources})
    decisions = [t for t in targets if t.startswith("decision:")]
    names = [":".join(t.split(":")[2:]) if t.startswith("decision:") else t for t in targets]
    decision_refs = {r["ref_id"] for r in ONTOLOGY["references"] if r["semantic_id"] in decisions}
    names.extend(sorted({refs[rel["to_ref"]]["semantic_id"] for rel in ONTOLOGY["relations"]
                         if rel["relation_kind"] == "may-emit-effect" and rel["from_ref"] in decision_refs}))
    return names


def director_of(client):
    return client.table("capsule")["director"]


def next_turn(client, turn, text="继续。", narration="……"):
    """Close `turn` with a narrate and open the next; returns the new capsule's director."""
    client.table("narrate", call_id=f"t{turn}-c9", text=narration)
    return client.table("player_input", text=text)["capsule"]["director"]


# ---- layer 1 and 2: every condition, scored from the graph ------------------------------

def test_first_turn_character_scores_the_graph_value_times_the_structure_weight(kernel):
    director = open_turn(kernel, "我打量诺特。")["capsule"]["director"]
    assert director["beat"] == "CHARACTER"
    assert director["scores"]["CHARACTER"] == weighted("CHARACTER", "agenda-npc-in-scene")
    assert director["scores"]["PRESSURE"] == weighted("PRESSURE", "baseline")
    assert "agenda_npc_present = 1" in director["because"] and f"structure_type = {STRUCTURE}" in director["because"]
    assert director["grounded_by"] == []  # the registry grounds no CHARACTER rule; nothing is invented
    assert "override" not in director and "reveal" not in director
    assert director["reason"].startswith("CHARACTER")


def test_reveal_on_investigate_intent_with_gates_and_registry_grounding(seeded_kernel):
    kernel = seeded_kernel  # a fumble would be a legitimate override; the seed keeps the roll ordinary
    open_turn(kernel, "我仔细观察诺特。")
    resolve(kernel, "t1-c1", intent="investigate", goal="看他有没有隐瞒", method="用侦查", skill="Spot Hidden")
    kernel.table("apply", call_id="t1-c2", effects=[{"kind": "clue", "clue": "knott-keys"}])  # a change: no stall
    director = next_turn(kernel, 1)
    assert director["beat"] == "REVEAL"
    assert director["scores"]["REVEAL"] == weighted("REVEAL", "investigate-intent")
    assert director["scores"]["DEEPEN"] == weighted("DEEPEN", "dramatic-question-present")
    assert "intent = investigate" in director["because"] and "undiscovered_here = 3" in director["because"]
    reveal = director["reveal"]
    assert 0 < len(reveal) <= 5 and {r["clue"] for r in reveal} == set(BRIEFING_CLUES) - {"knott-keys"}
    gates = {r["clue"]: r["gate"] for r in reveal}
    assert gates["knott-commission"] == "npc_dialogue" and gates["knott-research-leads"] == "npc_dialogue"
    assert director["grounded_by"] == grounded_names("scoring-rule:reveal:investigate-intent")
    assert "core-check:ordinary-check" in director["grounded_by"]
    assert "effect:coc7:magic:learn-spell-spell-learned" in director["grounded_by"]


def test_reveal_on_social_intent_scores_lower_than_investigate(seeded_kernel):
    kernel = seeded_kernel  # a fumble would be a legitimate override; the seed keeps the roll ordinary
    open_turn(kernel, "我恭维诺特。")
    resolve(kernel, "t1-c1", intent="social", goal="让他多说点", method="用魅惑套话", target="Steven Knott")
    director = next_turn(kernel, 1)
    assert director["beat"] == "REVEAL"
    assert director["scores"]["REVEAL"] == weighted("REVEAL", "social-intent")
    assert director["grounded_by"] == grounded_names("scoring-rule:reveal:social-intent")


def test_choice_on_idle_intent_with_two_undiscovered_clues(kernel):
    open_turn(kernel, "我发呆。")
    resolve(kernel, "t1-c1", intent="idle", goal="", method="")
    director = next_turn(kernel, 1)
    assert director["beat"] == "CHOICE"
    assert director["scores"]["CHOICE"] == weighted("CHOICE", "two-undiscovered-clues")
    assert 4 >= threshold("choice-undiscovered-clue-count")
    assert director["grounded_by"] == []


def test_cut_on_explicit_move_intent(kernel):
    open_turn(kernel, "我们出发去档案馆。")
    resolve(kernel, "t1-c1", intent="move", goal="去档案馆", method="走过去")
    kernel.table("apply", call_id="t1-c2", effects=[{"kind": "clue", "clue": "knott-keys"}])  # a change: no stall
    director = next_turn(kernel, 1)
    assert director["beat"] == "CUT"
    assert director["scores"]["CUT"] == weighted("CUT", "explicit-move-intent")
    assert director["grounded_by"] == grounded_names("scoring-rule:cut:explicit-move-intent")


def test_cut_on_a_met_exit_condition_beats_character(kernel):
    open_turn(kernel, "我问他线索。")
    kernel.table("apply", call_id="t1-c1", effects=[{"kind": "clue", "clue": "knott-research-leads"}])
    director = next_turn(kernel, 1)
    assert "exit_condition_met = True" in director["because"] and "intent = none" in director["because"]
    assert director["beat"] == "CUT"
    assert director["scores"]["CUT"] == weighted("CUT", "exit-condition-met")
    assert director["scores"]["CHARACTER"] == weighted("CHARACTER", "agenda-npc-in-scene")


def test_cut_on_main_line_complete_from_a_reachable_conclusion(kernel):
    open_turn(kernel, "我们把图书馆翻遍了。")
    world_path = campaign_dir(kernel.workspace) / "world.json"
    world = read_json(world_path)
    world["discovered_clues"] = list(DOCUMENTARY_HISTORY_CLUES)
    world_path.write_text(json.dumps(world, ensure_ascii=False), encoding="utf-8")
    director = director_of(kernel)
    assert "main_line_complete = True" in director["because"]
    assert director["scores"]["CUT"] == weighted("CUT", "main-line-complete")


def test_montage_intent_scores_but_loses_to_an_agenda_npc(kernel):
    open_turn(kernel, "我们花一下午翻报纸。")
    resolve(kernel, "t1-c1", intent="montage", goal="翻报纸", method="")
    kernel.table("apply", call_id="t1-c2", effects=[{"kind": "clue", "clue": "knott-keys"}])
    director = next_turn(kernel, 1)
    assert director["scores"]["MONTAGE"] == weighted("MONTAGE", "montage-intent")
    assert director["beat"] == "CHARACTER"


def test_pressure_on_a_stalled_turn_ties_with_cut_and_the_tiebreak_order_decides(kernel):
    open_turn(kernel, "我们走吧。")
    resolve(kernel, "t1-c1", intent="move", goal="离开", method="走")  # no receipts: the turn stalls
    director = next_turn(kernel, 1)
    assert "stalled_turns = 1" in director["because"] and 1 >= threshold("pressure-stalled-turns")
    pressure = weighted("PRESSURE", "clock-near-full-or-stalled")
    cut = weighted("CUT", "explicit-move-intent")
    assert pressure == cut, "the fixture relies on the graph tying these two"
    assert director["scores"]["PRESSURE"] == pressure and director["scores"]["CUT"] == cut
    order = tiebreak()
    assert director["beat"] == ("PRESSURE" if order.index("PRESSURE") < order.index("CUT") else "CUT")


def test_recover_yielded_scene_and_stalled_transition_after_two_stalled_turns(kernel):
    open_turn(kernel, "我把办公室翻了个遍。")
    kernel.table("apply", call_id="t1-c1", effects=[{"kind": "clue", "clue": c} for c in BRIEFING_CLUES])
    kernel.table("narrate", call_id="t1-c2", text="都找到了。")
    for turn in (2, 3):
        kernel.table("player_input", text="我等着。")
        resolve(kernel, f"t{turn}-c1", intent="idle", goal="", method="")
        kernel.table("narrate", call_id=f"t{turn}-c2", text="没有别的。")
    director = kernel.table("player_input", text="还是等。")["capsule"]["director"]
    assert "stalled_turns = 2" in director["because"] and "turns_in_scene = 4" in director["because"]
    assert "undiscovered_here = 0" in director["because"]
    assert 2 >= threshold("recover-stalled-turns") and 2 >= threshold("cut-stalled-transition-turns")
    assert director["beat"] == "RECOVER"
    assert director["scores"]["RECOVER"] == weighted("RECOVER", "stalled-turns")
    assert director["scores"]["PRESSURE"] == weighted("PRESSURE", "yielded-scene")
    # CUT holds two conditions; the higher one (the met exit condition) is its base
    assert director["scores"]["CUT"] == max(weighted("CUT", "exit-condition-met"),
                                            capped_linear("CUT", "stalled-transition-pressure", 2))


def test_payoff_rises_with_structured_memory_overlap(kernel):
    open_turn(kernel, "我和诺特谈。")
    kernel.table("apply", call_id="t1-c1", effects=[{"kind": "clue", "clue": "knott-keys"}])  # a change: no stall
    narrated = kernel.table("narrate", call_id="t1-c2", text="诺特答应了。")
    kernel.ok("memory.submit", {"campaign": "c1", "job_id": narrated["extraction"]["job_id"], "candidates": [
        {"kind": "knowledge", "subject": "Steven Knott", "statement": "诺特知道马卡里奥一家的下落。"}]})
    director = kernel.table("player_input", text="继续。")["capsule"]["director"]
    assert director["scores"]["PAYOFF"] == capped_linear("PAYOFF", "structured-entity-overlap", 1)
    assert director["beat"] == "CHARACTER"


def test_subsystem_scores_from_combat_intent_after_the_fight_ended(tmp_path):
    client = RpcClient(tmp_path / "ws", env={"COC_KERNEL_SEED": "9"})
    try:
        open_turn(client, "我举枪对准棺材里的东西。")
        n = walk_to_confrontation(client)
        resolve(client, f"t1-c{n}", intent="combat", goal="朝科比特开枪", method="用左轮射击",
                target="Walter Corbitt", weapon=".38 Revolver")
        resolve(client, f"t1-c{n + 1}", intent="combat", goal="他迎着子弹", method="", actor="Walter Corbitt", defense="none")
        resolve(client, f"t1-c{n + 2}", intent="combat", goal="双方僵持", method="", decision="combat:end", outcome="stalemate")
        assert client.table("look")["where"]["session"] is None
        client.table("narrate", call_id=f"t1-c{n + 3}", text="枪声停了。")
        record = read_json(campaign_dir(client.workspace) / "turns" / "0001.json")
        assert record["intents"][-1] == "combat"
        director = client.table("player_input", text="我盯着他。")["capsule"]["director"]
        assert "session = none" in director["because"] and "intent = combat" in director["because"]
        if "override" not in director:  # a fumbled last roll would legitimately pre-empt scoring
            assert director["beat"] == "SUBSYSTEM"
            assert director["scores"]["SUBSYSTEM"] == weighted("SUBSYSTEM", "combat-flee-cast-intent")
            assert director["grounded_by"] == grounded_names("scoring-rule:subsystem:combat-flee-cast-intent")
            assert "combat:attack" in director["grounded_by"] and "magic:cast-spell" in director["grounded_by"]
    finally:
        client.close()


def test_advance_is_the_default_and_grounds_nothing(kernel):
    open_turn(kernel, "我们去房子。")
    kernel.table("apply", call_id="t1-c1", effects=[{"kind": "move", "to": "corbitt-house-ground"},
                                                    *({"kind": "clue", "clue": c} for c in GROUND_FLOOR_CLUES)])
    resolve(kernel, "t1-c2", intent="idle", goal="", method="")
    director = next_turn(kernel, 1)
    assert director["beat"] == "ADVANCE" and director["scores"] == {} and director["grounded_by"] == []
    assert "override" not in director and "reveal" not in director
    assert director["reason"]


# ---- layer 3: overrides -------------------------------------------------------------------

def test_pending_choice_overrides_to_choice(kernel):
    open_turn(kernel, "我问他。")
    kernel.table("ask", call_id="t1-c1", prompt="你要收下钥匙吗？", options=["收下", "拒绝"])
    director = kernel.table("player_input", text="收下。")["capsule"]["director"]
    assert director["beat"] == "CHOICE" and director["override"] == "pending_choice"
    assert director["scores"] == {"CHOICE": 1.0} and director["grounded_by"] == []
    assert "pending_choice = True" in director["because"]


def test_fumble_overrides_to_pressure(kernel):
    open_turn(kernel, "我翻抽屉。")
    resolve(kernel, "t1-c1", intent="investigate", goal="找线索", method="用侦查", skill="Spot Hidden")
    kernel.table("narrate", call_id="t1-c2", text="手一滑。")
    record_path = campaign_dir(kernel.workspace) / "turns" / "0001.json"
    record = read_json(record_path)
    record["receipts"][-1].update({"level": "fumble", "passed": False})
    record_path.write_text(json.dumps(record, ensure_ascii=False), encoding="utf-8")
    director = kernel.table("player_input", text="糟了。")["capsule"]["director"]
    assert "last_roll = fumble" in director["because"]
    assert director["beat"] == "PRESSURE" and director["override"] == "fumble"


def test_dying_overrides_to_subsystem_with_pressure_and_the_registered_grounding(kernel):
    open_turn(kernel, "我倒在地上。")
    seed_wound(kernel.workspace, 0, conditions=["major_wound", "dying"], minutes_ago=5)
    director = director_of(kernel)
    assert "hp_state = dying" in director["because"] and "extra = PRESSURE" in director["because"]
    assert director["beat"] == "SUBSYSTEM" and director["override"] == "dying"
    assert director["grounded_by"] == grounded_names("craft-directive:dying-forces-rescue-subsystem",
                                                     "craft-directive:dying-clock-kind")
    assert {"healing:dying-hour-clock", "healing:dying-round-clock", "rule:coc7:healing:dying-entry"} <= set(director["grounded_by"])


def test_live_session_overrides_to_subsystem_grounded_by_the_session_rule(tmp_path):
    client = RpcClient(tmp_path / "ws", env={"COC_KERNEL_SEED": "9"})
    try:
        open_turn(client, "我举枪。")
        n = walk_to_confrontation(client)
        resolve(client, f"t1-c{n}", intent="combat", goal="开枪", method="用左轮射击", target="Walter Corbitt", weapon=".38 Revolver")
        director = director_of(client)
        assert director["beat"] == "SUBSYSTEM" and director["override"] == "session"
        assert "session = combat" in director["because"]
        assert director["grounded_by"] == grounded_names("scoring-rule:subsystem:combat-flee-cast-intent")
    finally:
        client.close()


def test_hp_state_reads_the_rulebook_thresholds(kernel):
    open_turn(kernel, "我受了伤。")
    seed_wound(kernel.workspace, 9, minutes_ago=10)
    assert "hp_state = wounded" in director_of(kernel)["because"]
    seed_wound(kernel.workspace, 3, conditions=["major_wound"], minutes_ago=10)
    assert "hp_state = major_wound" in director_of(kernel)["because"]


# ---- adoption (§13.7) ----------------------------------------------------------------------

def adoption_of(client, turn):
    return read_json(campaign_dir(client.workspace) / "turns" / f"{turn:04d}.json")["director_adoption"]


def director_telemetry(client):
    return [row for row in read_jsonl(campaign_dir(client.workspace) / "telemetry.jsonl") if row.get("lane") == "director"]


def test_character_adoption_needs_someone_present_and_no_move(kernel):
    open_turn(kernel, "我和诺特聊。")
    kernel.table("narrate", call_id="t1-c1", text="他说了很多。")
    adoption = adoption_of(kernel, 1)
    assert adoption == {"beat": "CHARACTER", "adopted": True, "evidence": []}
    rows = director_telemetry(kernel)
    assert rows[-1]["turn"] == 1 and rows[-1]["beat"] == "CHARACTER" and rows[-1]["adopted"] is True
    kernel.table("player_input", text="我走了。")
    kernel.table("apply", call_id="t2-c1", effects=[{"kind": "move", "to": "central-library"}])
    kernel.table("narrate", call_id="t2-c2", text="你离开了。")
    assert adoption_of(kernel, 2)["adopted"] is False


def test_cut_adoption_is_a_move_receipt(kernel):
    open_turn(kernel, "我们出发。")
    resolve(kernel, "t1-c1", intent="move", goal="去图书馆", method="走")
    kernel.table("apply", call_id="t1-c2", effects=[{"kind": "clue", "clue": "knott-keys"}])
    assert next_turn(kernel, 1)["beat"] == "CUT"
    kernel.table("apply", call_id="t2-c1", effects=[{"kind": "move", "to": "central-library"}])
    kernel.table("narrate", call_id="t2-c2", text="到了。")
    adoption = adoption_of(kernel, 2)
    assert adoption["beat"] == "CUT" and adoption["adopted"] is True and adoption["evidence"] == ["move:central-library-t2-c1"]


def test_choice_adoption_is_a_turn_closed_by_ask(kernel):
    open_turn(kernel, "我发呆。")
    resolve(kernel, "t1-c1", intent="idle", goal="", method="")
    assert next_turn(kernel, 1)["beat"] == "CHOICE"
    kernel.table("ask", call_id="t2-c1", prompt="先做哪件？", options=["问诺特", "翻抽屉"])
    adoption = adoption_of(kernel, 2)
    assert adoption == {"beat": "CHOICE", "adopted": True, "evidence": []}
    assert director_telemetry(kernel)[-1]["closed_by"] == "ask"


def test_pressure_adoption_is_time_damage_or_a_negative_delta(kernel):
    open_turn(kernel, "我们走吧。")
    resolve(kernel, "t1-c1", intent="move", goal="离开", method="走")
    director = next_turn(kernel, 1)
    if director["beat"] != "PRESSURE":  # the tiebreak order decides between PRESSURE and CUT
        return
    kernel.table("apply", call_id="t2-c1", effects=[{"kind": "time", "minutes": 20}])
    kernel.table("narrate", call_id="t2-c2", text="时间流逝。")
    adoption = adoption_of(kernel, 2)
    assert adoption["beat"] == "PRESSURE" and adoption["adopted"] is True and adoption["evidence"] == ["time:t2-c1"]


def test_reveal_adoption_only_counts_a_listed_clue(seeded_kernel):
    kernel = seeded_kernel  # a fumble would be a legitimate override; the seed keeps the roll ordinary
    open_turn(kernel, "我仔细观察诺特。")
    resolve(kernel, "t1-c1", intent="investigate", goal="看他", method="用侦查", skill="Spot Hidden")
    director = next_turn(kernel, 1)
    assert director["beat"] == "REVEAL"
    kernel.table("apply", call_id="t2-c1", effects=[{"kind": "clue", "clue": director["reveal"][0]["clue"]}])
    kernel.table("narrate", call_id="t2-c2", text="找到了。")
    adoption = adoption_of(kernel, 2)
    assert adoption["adopted"] is True and adoption["evidence"] == [f"clue:{director['reveal'][0]['clue']}-t2"]


def test_a_pushed_failure_without_consequence_nudges_pressure(tmp_path):
    client = RpcClient(tmp_path / "ws", env={"COC_KERNEL_SEED": "7"})
    try:
        open_turn(client, "我翻抽屉。")
        call_id, _ = first_failure(client, "t1-c", intent="investigate", goal="找线索", method="用侦查", skill="Spot Hidden")
        n = int(call_id.rsplit("-c", 1)[1]) + 1
        pushed = resolve(client, f"t1-c{n}", intent="investigate", goal="找线索", method="用侦查", skill="Spot Hidden",
                         push=True, stakes="抽屉会卡住")
        if pushed["outcome"].get("passed"):
            return  # the seed pushed through; the nudge needs a failed push
        client.table("narrate", call_id=f"t1-c{n + 1}", text="还是没找到。")
        director = client.table("player_input", text="继续。")["capsule"]["director"]
        assert "pushed_fail_pending = True" in director["because"]
        if "override" in director:
            return
        digits = threshold("score-precision-digits")
        # rolls alone leave the turn stalled (no clue, move or session): the stalled value is the base
        assert "stalled_turns = 1" in director["because"]
        base = min(float(threshold("pressure-posture-ceiling")),
                   round(rule("PRESSURE", "clock-near-full-or-stalled") + rule("PRESSURE", "pushed-fail-nudge"), digits))
        assert director["scores"]["PRESSURE"] == round(base * weight("PRESSURE"), digits)
    finally:
        client.close()
