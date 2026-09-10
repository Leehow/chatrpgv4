"""Slice 3, kernel side: the nine-section capsule (contract §13.1), the structural sources
of `pressures` / `obligations` (§13.2), `style` (§13.6) and the per-section budgets."""

import json
import re

from conftest import CAMPAIGN, CONTENT_DIR, RpcClient, campaign_dir, narrate, narrate_opening, open_turn, read_json
from test_rules_families import first_failure, resolve, seed_wound, walk_to_confrontation

SECTIONS = ("where", "present", "known", "pressures", "obligations", "director", "situations", "memory", "style",
            "recent", "warnings")
BUDGETS = {"where": 4096, "present": 3072, "known": 3072, "pressures": 1024, "obligations": 1024, "director": 1536,
           "situations": 1024, "memory": 1536, "style": 1024, "recent": 2048, "warnings": 1024}
BEAT_TABLE = json.loads((CONTENT_DIR / "craft" / "beat-directives.json").read_text(encoding="utf-8"))
TEXT_GRAPH = json.loads((CONTENT_DIR / "craft" / "text-graph.json").read_text(encoding="utf-8"))
ALL_DIRECTIVES = {n["properties"]["directive_id"] for n in TEXT_GRAPH["nodes"] if n["node_kind"] == "craft-directive"}


def size(payload):
    return len(json.dumps(payload, ensure_ascii=False).encode("utf-8"))


# ---- shape ---------------------------------------------------------------------------------

def test_the_capsule_has_nine_sections_a_head_and_the_clock(kernel):
    capsule = open_turn(kernel, "我仔细观察诺特。")["capsule"]
    for name in SECTIONS:
        assert name in capsule, name
    assert "look/lookup" in capsule["head"] and "director" in capsule["head"]
    # §23: The Haunting's module-meta declares `start_clock.local_datetime`, so the table knows
    # the date and hour it is in the fiction, not only how long it has been playing.
    assert capsule["where"]["clock"] == {"minutes": 0, "elapsed": "0 h 0 min",
                                         "at": "1920-10-12T10:00", "day_part": "morning"}
    assert capsule["where"]["session"] is None
    knott = capsule["present"][0]
    # §17.4 renamed these: keeper-only material, same law as `wants`
    assert knott["hides"] and knott["fears"]
    assert capsule["situations"] == [] and capsule["situations"] == kernel.table("look")["where"]["situations"]
    # the nine sections fit untouched; only the first-turn briefing (#22) had its roster
    # lines shortened to its own 2KB, and says so
    assert capsule.get("truncated", []) == ["module"]
    for name, budget in BUDGETS.items():
        if name == "style":
            continue  # the first turn of the process doubles it (§13.6)
        assert size(capsule[name]) <= budget, name
    assert size(capsule["style"]) <= 2048 and size(capsule["module"]) <= 2048


def test_the_clock_and_elapsed_follow_the_world_minutes(kernel):
    open_turn(kernel, "等一会儿。")
    kernel.table("apply", call_id="t1-c1", effects=[{"kind": "time", "minutes": 95}])
    # Elapsed counts from the campaign's own start; `at` counts from the module's declared one,
    # so the same 95 minutes read as an hour and a half played and as 11:35 in 1920 Boston.
    assert kernel.table("capsule")["where"]["clock"] == {"minutes": 95, "elapsed": "1 h 35 min",
                                                        "at": "1920-10-12T11:35", "day_part": "morning"}


def test_situations_ride_in_the_capsule_and_stay_in_look(kernel):
    open_turn(kernel, "我受了伤。")
    seed_wound(kernel.workspace, 9, minutes_ago=10)
    capsule = kernel.table("capsule")
    assert [s["decision"] for s in capsule["situations"]] == ["healing:first-aid-ordinary"]
    assert capsule["situations"] == kernel.table("look")["where"]["situations"]


# ---- pressures (§13.2) ---------------------------------------------------------------------

def test_clock_pressure_from_the_wound_hour(kernel):
    open_turn(kernel, "我受了伤。")
    kernel.table("apply", call_id="t1-c1", effects=[{"kind": "time", "minutes": 30}])
    seed_wound(kernel.workspace, 9, minutes_ago=10)
    pressures = kernel.table("capsule")["pressures"]
    assert pressures == [{"kind": "clock", "cue": "healing:first-aid-ordinary", "name": "the hour after the wound",
                          "state": "10/60 minutes gone", "due": "first-aid window closes in 50 min"}]
    assert "clock_near_full = False" in kernel.table("capsule")["director"]["because"]
    kernel.table("apply", call_id="t1-c2", effects=[{"kind": "time", "minutes": 35}])  # 45/60 >= 2/3: the graph's fraction
    capsule = kernel.table("capsule")
    assert capsule["pressures"][0]["state"] == "45/60 minutes gone"
    assert "clock_near_full = True" in capsule["director"]["because"]


def test_clock_pressure_from_the_dying_clock_is_always_near_full(kernel):
    open_turn(kernel, "我倒下了。")
    seed_wound(kernel.workspace, 0, conditions=["major_wound", "dying"], minutes_ago=5)
    capsule = kernel.table("capsule")
    names = {p["name"]: p for p in capsule["pressures"] if p["kind"] == "clock"}
    dying = "dying (unstabilized, CON per round)"
    assert dying in names and names[dying]["state"] == "HP 0"
    assert "clock_near_full = True" in capsule["director"]["because"]


def test_threat_pressure_when_a_danger_names_a_present_npc(kernel):
    open_turn(kernel, "我们冲进地下室。")
    assert [p for p in kernel.table("capsule")["pressures"] if p["kind"] == "threat"] == []
    walk_to_confrontation(kernel)
    capsule = kernel.table("capsule")
    threats = [p for p in capsule["pressures"] if p["kind"] == "threat"]
    assert [t["name"] for t in threats] == ["corbitt-haunting"]
    assert re.fullmatch(r"\d+/\d+", threats[0]["state"])  # the front's authored clock, current/segments
    assert threats[0]["cue"] == "; ".join(capsule["where"]["pressure_moves"])


def test_rule_pressure_and_continuation_obligation_from_an_unanswered_push(tmp_path):
    client = RpcClient(tmp_path / "ws", env={"COC_KERNEL_SEED": "7"})
    try:
        open_turn(client, "我翻抽屉。")
        call_id, failed = first_failure(client, "t1-c", intent="investigate", goal="找线索", method="用侦查", skill="Spot Hidden")
        offered = [c["decision"] for c in failed["continuations"]]
        assert "push-luck:pushed-roll" in offered
        n = int(call_id.rsplit("-c", 1)[1]) + 1
        narrate(client, f"t1-c{n}", "没找到。")
        capsule = client.table("player_input", text="我再试试。")["capsule"]
        rules = [p for p in capsule["pressures"] if p["kind"] == "rule"]
        assert [r["name"] for r in rules] == offered
        assert rules[0]["state"] == "left by last turn, unanswered" and rules[0]["cue"].startswith("needs action.")
        owed = [o for o in capsule["obligations"] if o["kind"] == "continuation"]
        assert [o["name"] for o in owed] == offered and all(o["who"] == "player" for o in owed)
        # answering the push closes both rows
        client.table("resolve", call_id="t2-c1", action={"intent": "investigate", "goal": "找线索", "method": "用侦查",
                                                          "skill": "Spot Hidden", "push": True, "stakes": "抽屉卡住"})
        capsule = client.table("capsule")
        assert [p for p in capsule["pressures"] if p["kind"] == "rule"] == []
        assert [o for o in capsule["obligations"] if o["kind"] == "continuation"] == []
    finally:
        client.close()


# ---- obligations (§13.2) -------------------------------------------------------------------

def test_choice_obligation_from_the_pending_ask(kernel):
    open_turn(kernel, "我问他。")
    kernel.table("ask", call_id="t1-c1", prompt="收下钥匙吗？", options=["收下", "拒绝"])
    obligations = kernel.table("player_input", text="收下。")["capsule"]["obligations"]
    choice = next(o for o in obligations if o["kind"] == "choice")
    assert choice["name"].startswith("ask-") and choice["name"].endswith("-t1")
    assert choice == {"kind": "choice", "name": choice["name"], "who": "player", "state": "pending", "cue": "收下钥匙吗？"}


def test_session_obligation_from_a_live_combat(tmp_path):
    client = RpcClient(tmp_path / "ws", env={"COC_KERNEL_SEED": "9"})
    try:
        open_turn(client, "我举枪。")
        n = walk_to_confrontation(client)
        resolve(client, f"t1-c{n}", intent="combat", goal="开枪", method="用左轮射击", target="Walter Corbitt", weapon=".38 Revolver")
        obligations = client.table("capsule")["obligations"]
        session = next(o for o in obligations if o["kind"] == "session")
        assert session["name"] == "combat" and session["state"].startswith("round 1") and "combat:defend" in session["cue"]
    finally:
        client.close()


def test_quest_obligations_read_the_module_graph_and_the_discovered_clues(kernel):
    open_turn(kernel, "我们到了。")
    quests = {o["name"]: o for o in kernel.table("capsule")["obligations"] if o["kind"] == "quest"}
    assert set(quests) == {"End the Corbitt Threat", "The Corbitt House Commission", "Recover the Chapel Records"}
    assert quests["The Corbitt House Commission"] == {"kind": "quest", "name": "The Corbitt House Commission", "state": "not started",
                                                       "who": "Steven Knott", "cue": "core"}
    world_path = campaign_dir(kernel.workspace) / "world.json"
    world = read_json(world_path)
    world["discovered_clues"] = ["corbitt-body-found"]
    world_path.write_text(json.dumps(world, ensure_ascii=False), encoding="utf-8")
    quests = {o["name"]: o for o in kernel.table("capsule")["obligations"] if o["kind"] == "quest"}
    assert quests["The Corbitt House Commission"]["state"] == "can close (1/1 clues)"
    assert quests["End the Corbitt Threat"]["state"] == "not started"


# ---- style (§13.6) ---------------------------------------------------------------------------

def test_style_gives_every_directive_on_the_first_turn_and_the_beats_pick_afterwards(kernel):
    first = open_turn(kernel, "我仔细观察诺特。")["capsule"]
    style = first["style"]
    assert style["language"] == "zh-Hans" and style["register"] == "purist"
    assert len(style["axes"]) == 6 and "avoid translationese" in style["axes"]  # English lines (§16.1); zh-Hans keeps the axis
    assert {d["id"] for d in style["directives"]} == ALL_DIRECTIVES and all(d["line"] for d in style["directives"])
    assert kernel.table("capsule")["style"] == style  # same turn, same process: still the full list
    narrate(kernel, "t1-c1", "……")
    later = kernel.table("player_input", text="继续。")["capsule"]
    beat = later["director"]["beat"]
    assert [d["id"] for d in later["style"]["directives"]] == BEAT_TABLE["beats"][beat]
    assert len(later["style"]["directives"]) <= 4 and size(later["style"]) <= 1024


def test_a_new_process_starts_over_with_the_full_directives(tmp_path):
    first = RpcClient(tmp_path / "ws")
    try:
        open_turn(first, "我看看。")
        narrate(first, "t1-c1", "……")
        assert len(first.table("player_input", text="继续。")["capsule"]["style"]["directives"]) <= 4
    finally:
        first.close()
    second = RpcClient(tmp_path / "ws")
    try:
        assert second.table("open")["turn"]["number"] == 2
        narrate(second, "t2-c1", "……")
        assert {d["id"] for d in second.table("player_input", text="再来。")["capsule"]["style"]["directives"]} == ALL_DIRECTIVES
    finally:
        second.close()


def test_register_is_a_campaign_setting_from_the_text_graph(kernel):
    kernel.ok("campaign.create", {"id": CAMPAIGN, "module": "the-haunting", "pregen": "thomas-hayes", "register": "pulp"})
    assert kernel.table("open")["campaign"]["register"] == "pulp"
    narrate_opening(kernel)
    assert kernel.table("player_input", text="上。")["capsule"]["style"]["register"] == "pulp"
    error = kernel.err("campaign.create", {"id": "c2", "module": "the-haunting", "pregen": "thomas-hayes", "register": "gonzo"})
    assert error["code"] == "invalid_params" and "purist" in error["fix"]


def test_axes_follow_the_language_applicability_and_the_style_budget_trims(tmp_path):
    client = RpcClient(tmp_path / "ws")
    try:
        client.ok("campaign.create", {"id": CAMPAIGN, "module": "the-haunting", "pregen": "thomas-hayes", "play_language": "en"})
        narrate_opening(client)
        capsule = client.table("player_input", text="I look around.")["capsule"]
        style = capsule["style"]
        assert style["language"] == "en" and "avoid translationese" not in style["axes"] and len(style["axes"]) == 5
        # §16.1: the lines are English one-liners sized like the zh originals, so the full first-turn
        # set fits the §13.6 budget in every play language and nothing is trimmed
        assert size(style) <= 2048 and "style" not in capsule.get("truncated", [])
        assert {d["id"] for d in style["directives"]} == ALL_DIRECTIVES
        assert capsule["head"].startswith("Everything at the start of this turn")
    finally:
        client.close()


# ---- budgets and truncation -----------------------------------------------------------------

def test_the_memory_section_is_trimmed_from_its_tail_and_named_in_truncated(kernel):
    open_turn(kernel, "我和诺特谈。")
    job_id = narrate(kernel, "t1-c1", "谈了很久。")["extraction"]["job_id"]
    kernel.ok("memory.submit", {"campaign": CAMPAIGN, "job_id": job_id, "candidates": [
        {"kind": "knowledge", "subject": "Steven Knott", "statement": f"{i}" + "诺特说的话很长，" * 40} for i in range(6)]})
    capsule = kernel.table("player_input", text="继续。")["capsule"]
    assert "memory" in capsule["truncated"] and size(capsule["memory"]) <= BUDGETS["memory"]
    assert 0 < len(capsule["memory"]) < 6
    for name, budget in BUDGETS.items():
        if name != "style":
            assert size(capsule[name]) <= budget, name


def test_the_capsule_stays_keeper_only(kernel):
    """Nothing of the capsule reaches the transcript or the player's text (§13 boundary)."""
    result = open_turn(kernel, "我看看四周。")
    narrated = narrate(kernel, "t1-c1", "办公室很安静。")
    transcript = (campaign_dir(kernel.workspace) / "transcript.jsonl").read_text(encoding="utf-8")
    assert result["capsule"]["head"] not in transcript and "grounded_by" not in transcript
    assert "director" not in narrated["rendered_text"]
