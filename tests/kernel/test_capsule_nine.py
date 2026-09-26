"""Slice 3, kernel side: the nine-section capsule (contract §13.1), the structural sources
of `pressures` / `obligations` (§13.2), `style` (§13.6, §137) and the per-section budgets."""

import json
import re
import shutil

from conftest import CAMPAIGN, RpcClient, WORKTREE, campaign_dir, create_campaign, narrate, narrate_opening, open_turn, read_json
from test_rules_families import first_failure, resolve, seed_wound, walk_to_confrontation

SECTIONS = ("where", "present", "known", "pressures", "obligations", "director", "situations", "memory", "style",
            "recent", "warnings", "voices")
BUDGETS = {"where": 4096, "present": 3072, "known": 3072, "pressures": 1024, "obligations": 1024, "director": 3072,  # 3072 since the recovery (contract §40)
           "situations": 1024, "memory": 1536, "style": 1536, "recent": 2048, "warnings": 1024,  # style 1536 since the turn floor
           "voices": 3072}  # §40.7: the masks and exchanges of everyone present
# Contract §137: the craft lines come from the one enabled `context.style.v1` package; the shipped one is narration-craft.
PROVIDER = read_json(WORKTREE / "mods" / "narration-craft" / "mod.json")
STYLE = read_json(WORKTREE / "mods" / "narration-craft" / PROVIDER["contributes"]["style"])
ALL_DIRECTIVES = list(STYLE["directives"])
FIXTURES = WORKTREE / "tests" / "fixtures" / "mods"


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
    # lines shortened to its own 2KB, and the book's navigation (§14.16: the Haunting reads its
    # window) is cut to its 512 bytes, and both say so
    assert capsule.get("truncated", []) == ["reading", "module"]
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


def test_continuation_has_one_base_projection_until_answered(tmp_path):
    client = RpcClient(tmp_path / "ws", env={"COC_KERNEL_SEED": "7"})
    try:
        open_turn(client, "我翻抽屉。")
        call_id, failed = first_failure(client, "t1-c", intent="investigate", goal="找线索", method="用侦查", skill="Spot Hidden")
        offered = [c["decision"] for c in failed["continuations"]]
        assert "push-luck:pushed-roll" in offered
        n = int(call_id.rsplit("-c", 1)[1]) + 1
        narrate(client, f"t1-c{n}", "没找到。")
        capsule = client.table("player_input", text="我再试试。")["capsule"]
        assert [p for p in capsule["pressures"] if p["kind"] == "rule"] == []
        owed = [o for o in capsule["obligations"] if o["kind"] == "continuation"]
        assert [o["name"] for o in owed] == offered and all(o["who"] == "player" for o in owed)
        assert all(o["state"] == "left by last turn, unanswered" and o["cue"].startswith("needs action.") for o in owed)
        # Answering the push closes the single canonical projection.
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


# ---- style (§13.6, §137: context.style.v1) ------------------------------------------------------

def lines(style):
    return {row["id"]: row["line"] for row in style["directives"]}


def test_the_style_provider_sends_every_directive_on_the_first_turn_and_the_beats_after(kernel):
    first = open_turn(kernel, "我仔细观察诺特。")["capsule"]
    style = first["style"]
    assert PROVIDER["version"] and "context.style.v1" in PROVIDER["requires"]
    assert list(style) == ["language", "register", "axes", "directives", "floor"]
    assert style["language"] == "zh-Hans" and style["register"] == "purist"
    assert style["axes"] == STYLE["axes"] and style["floor"] == STYLE["floor"]
    # the first turn of a process: every directive the package defines, in its order, with the full line
    assert [d["id"] for d in style["directives"]] == ALL_DIRECTIVES
    assert lines(style) == {id_: entry["full"] for id_, entry in STYLE["directives"].items()}
    assert "style" not in first.get("truncated", []) and size(style) <= 2048
    assert kernel.table("capsule")["style"] == style  # same turn, same process: still the full list
    narrate(kernel, "t1-c1", "……")
    later = kernel.table("player_input", text="继续。")["capsule"]
    beat = later["director"]["beat"]
    # later turns: the beat's own ids, in the package's order for that beat, with the brief line
    assert [d["id"] for d in later["style"]["directives"]] == STYLE["beats"][beat]
    assert lines(later["style"]) == {id_: STYLE["directives"][id_]["brief"] for id_ in STYLE["beats"][beat]}
    assert later["style"]["axes"] == STYLE["axes"] and later["style"]["floor"] == STYLE["floor"]
    assert "style" not in later.get("truncated", []) and size(later["style"]) <= 1536


def test_without_a_provider_style_is_the_language_and_the_register(kernel):
    create_campaign(kernel)
    listed = kernel.ok("mods.configure", {"campaign": CAMPAIGN, "id": "narration-craft", "enabled": False})
    assert not next(row for row in listed["mods"] if row["id"] == "narration-craft" and row["active"])["active"]["enabled"]
    narrate_opening(kernel)
    first = kernel.table("player_input", text="我看看。")["capsule"]
    assert first["style"] == {"language": "zh-Hans", "register": "purist"}
    assert "style" not in first.get("truncated", [])
    narrate(kernel, "t1-c1", "……")
    later = kernel.table("player_input", text="继续。")["capsule"]
    assert later["style"] == {"language": "zh-Hans", "register": "purist"}
    assert "style" not in later.get("truncated", [])


def legacy_craft(kernel, tmp_path):
    """A narration-craft version frozen before context.style.v1: the package without its style contribution."""
    path = tmp_path / "narration-craft-legacy"
    shutil.copytree(WORKTREE / "mods" / "narration-craft", path)
    manifest = read_json(path / "mod.json")
    manifest["version"] = "1.99.0"
    manifest["requires"] = [req for req in manifest["requires"] if req != "context.style.v1"]
    manifest["package_files"] = [name for name in manifest["package_files"] if name != manifest["contributes"]["style"]]
    (path / manifest["contributes"].pop("style")).unlink()
    (path / "mod.json").write_text(json.dumps(manifest), encoding="utf-8")
    kernel.ok("mods.install", {"path": str(path)})
    return manifest["version"]


def test_a_legacy_narration_craft_lock_keeps_the_base_lines_it_was_played_with(kernel, tmp_path):
    """Contract §137.9 (2026-09-26): 51 saved App campaigns lock narration-craft 1.x, which never carried the
    lines because the base did. They keep the frozen table; disabling the package still leaves a clean base."""
    legacy = read_json(WORKTREE / "content" / "craft" / "legacy-style.json")
    version = legacy_craft(kernel, tmp_path)
    create_campaign(kernel)
    kernel.ok("mods.configure", {"campaign": CAMPAIGN, "id": "narration-craft", "version": version, "enabled": True})
    narrate_opening(kernel)
    first = kernel.table("player_input", text="我仔细观察诺特。")["capsule"]
    style = first["style"]
    assert list(style) == ["language", "register", "axes", "directives", "floor"]
    assert style["axes"] == [axis["line"] for axis in legacy["axes"] if axis["language"] in ("all", "zh-Hans")]
    assert [d["id"] for d in style["directives"]] == list(legacy["directives"])
    assert lines(style) == legacy["directives"] and style["floor"] == legacy["floor"]
    assert "style" not in first.get("truncated", []) and size(style) <= 2048
    narrate(kernel, "t1-c1", "……")
    later = kernel.table("player_input", text="继续。")["capsule"]
    beat = later["director"]["beat"]
    assert [d["id"] for d in later["style"]["directives"]] == legacy["beats"][beat]
    assert "style" not in later.get("truncated", []) and size(later["style"]) <= 1536
    kernel.ok("mods.configure", {"campaign": CAMPAIGN, "id": "narration-craft", "enabled": False})
    narrate(kernel, "t2-c1", "……")
    bare = kernel.table("player_input", text="再看看。")["capsule"]
    assert bare["style"] == {"language": "zh-Hans", "register": "purist"}


def test_the_legacy_table_keeps_its_language_only_axis_to_that_language(tmp_path):
    client = RpcClient(tmp_path / "ws")
    try:
        legacy = read_json(WORKTREE / "content" / "craft" / "legacy-style.json")
        version = legacy_craft(client, tmp_path)
        client.ok("campaign.create", {"id": CAMPAIGN, "module": "the-haunting", "pregen": "thomas-hayes", "play_language": "en"})
        client.ok("mods.configure", {"campaign": CAMPAIGN, "id": "narration-craft", "version": version, "enabled": True})
        narrate_opening(client)
        style = client.table("player_input", text="I look around.")["capsule"]["style"]
        assert style["axes"] == [axis["line"] for axis in legacy["axes"] if axis["language"] == "all"]
        assert len(style["axes"]) == len(legacy["axes"]) - 1
    finally:
        client.close()


def test_a_style_package_that_would_not_fit_is_refused_when_the_catalog_loads(kernel, tmp_path):
    fixture = FIXTURES / "style-overflow"
    manifest = read_json(fixture / "mod.json")
    # installing it: refused before it is published, naming the beat and the overflow
    error = kernel.err("mods.install", {"path": str(fixture)})
    assert error["code"] == "invalid_params"
    assert "REVEAL" in error["message"] and "1536" in error["message"] and "over" in error["message"]
    assert "PRESSURE" not in error["message"]  # only the beat that overflows is named
    assert error["details"]["over"]["REVEAL"] > 0
    # the same bytes on disk without an install: the catalog refuses that version as its own problem (§41.2)
    placed = kernel.workspace / ".coc" / "mods" / "packages" / manifest["id"] / manifest["version"]
    shutil.copytree(fixture, placed)
    listed = kernel.ok("mods.list", {})
    assert manifest["id"] not in {row["id"] for row in listed["mods"]}
    refused = next(row for row in listed["unavailable"] if row["id"] == manifest["id"])
    assert refused["version"] == manifest["version"] and "REVEAL" in refused["reason"]
    # a beat table naming a directive the package does not define fails closed too
    broken = tmp_path / "style-unknown"
    shutil.copytree(fixture, broken)
    style = read_json(broken / "style.json")
    style["beats"]["REVEAL"] = ["plain", "write-purple-prose"]
    (broken / "style.json").write_text(json.dumps(style), encoding="utf-8")
    manifest["id"] = "style-unknown"
    (broken / "mod.json").write_text(json.dumps(manifest), encoding="utf-8")
    error = kernel.err("mods.install", {"path": str(broken)})
    assert error["code"] == "invalid_params" and "write-purple-prose" in error["message"]
    # the table that locks neither plays on with the shipped provider
    capsule = open_turn(kernel, "我看看。")["capsule"]
    assert [d["id"] for d in capsule["style"]["directives"]] == ALL_DIRECTIVES


def test_only_one_style_provider_is_enabled_at_a_time(kernel, tmp_path):
    second = read_json(FIXTURES / "style-second" / "mod.json")
    second_style = read_json(FIXTURES / "style-second" / "style.json")
    kernel.ok("mods.install", {"path": str(FIXTURES / "style-second")})
    create_campaign(kernel)
    error = kernel.err("mods.configure", {"campaign": CAMPAIGN, "id": second["id"], "enabled": True})
    assert error["code"] == "invalid_params" and "narration-craft" in error["message"]
    assert error["details"]["provider"]["mod"] == "narration-craft"
    # a catalog whose defaults would enable two providers is refused the same way, by default or by install
    error = kernel.err("mods.defaults", {"id": second["id"], "enabled": True})
    assert error["code"] == "invalid_params" and "narration-craft" in error["message"]
    third = tmp_path / "style-third"
    shutil.copytree(FIXTURES / "style-second", third)
    (third / "mod.json").write_text(json.dumps({**second, "id": "style-third", "default_enabled": True}), encoding="utf-8")
    error = kernel.err("mods.install", {"path": str(third)})
    assert error["code"] == "invalid_params" and error["details"]["provider"]["mod"] == "narration-craft"
    # one at a time: turn the shipped provider off, and the second one's lines are the section
    kernel.ok("mods.configure", {"campaign": CAMPAIGN, "id": "narration-craft", "enabled": False})
    kernel.ok("mods.configure", {"campaign": CAMPAIGN, "id": second["id"], "enabled": True})
    narrate_opening(kernel)
    style = kernel.table("player_input", text="我看看。")["capsule"]["style"]
    assert [d["id"] for d in style["directives"]] == list(second_style["directives"])
    assert style["axes"] == second_style["axes"] and style["floor"] == second_style["floor"]
    error = kernel.err("mods.configure", {"campaign": CAMPAIGN, "id": "narration-craft", "enabled": True})
    assert error["code"] == "invalid_params" and error["details"]["provider"]["mod"] == second["id"]  # the one already enabled


def test_a_new_process_starts_over_with_the_full_directives(tmp_path):
    first = RpcClient(tmp_path / "ws")
    try:
        open_turn(first, "我看看。")
        narrate(first, "t1-c1", "……")
        later = first.table("player_input", text="继续。")["capsule"]
        assert [d["id"] for d in later["style"]["directives"]] == STYLE["beats"][later["director"]["beat"]]
    finally:
        first.close()
    second = RpcClient(tmp_path / "ws")
    try:
        assert second.table("open")["turn"]["number"] == 2
        narrate(second, "t2-c1", "……")
        assert [d["id"] for d in second.table("player_input", text="再来。")["capsule"]["style"]["directives"]] == ALL_DIRECTIVES
    finally:
        second.close()


def test_register_is_a_campaign_setting_from_the_text_graph(kernel):
    kernel.ok("campaign.create", {"id": CAMPAIGN, "module": "the-haunting", "pregen": "thomas-hayes", "register": "pulp"})
    assert kernel.table("open")["campaign"]["register"] == "pulp"
    narrate_opening(kernel)
    assert kernel.table("player_input", text="上。")["capsule"]["style"]["register"] == "pulp"
    error = kernel.err("campaign.create", {"id": "c2", "module": "the-haunting", "pregen": "thomas-hayes", "register": "gonzo"})
    assert error["code"] == "invalid_params" and "purist" in error["fix"]


def test_the_provider_lines_are_the_same_for_every_play_language(tmp_path):
    client = RpcClient(tmp_path / "ws")
    try:
        client.ok("campaign.create", {"id": CAMPAIGN, "module": "the-haunting", "pregen": "thomas-hayes", "play_language": "en"})
        narrate_opening(client)
        capsule = client.table("player_input", text="I look around.")["capsule"]
        style = capsule["style"]
        # the kernel detects no language (§16.1, §137.1): an English table gets the same lines as any other
        assert style["language"] == "en" and style["axes"] == STYLE["axes"] and style["floor"] == STYLE["floor"]
        assert size(style) <= 2048 and "style" not in capsule.get("truncated", [])
        assert [d["id"] for d in style["directives"]] == ALL_DIRECTIVES
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
