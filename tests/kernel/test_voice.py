"""Contract §40.7: the npc-voice lane. A closed job packet per person the source leaves silent, a
shape-only check of a mask and three exchanges, the write into the package's own §28.7 namespace (so
the book is never touched and the words die with the package), the capsule's `voices` seat, and the
Keeper's `apply dossier` kept out of a `shape: "lines"` word. Through the RPC seam."""

import json
import shutil

from conftest import CAMPAIGN, WORKTREE, campaign_dir, create_campaign, narrate, narrate_opening, open_turn, read_json, read_jsonl

KNOTT = "Steven Knott"
KNOTT_HANDLE = "steven-knott"
KNOTT_ID = "npc-steven-knott"
MOD = "npc-voice"
VERSION = read_json(WORKTREE / "mods" / "npc-voice" / "mod.json")["version"]
SHIPPED = read_json(WORKTREE / "mods" / "npc-voice" / "mod.json")["contributes"]["vocabulary"]["actor_profile_keys"]
MASK = {"key": "voice_mask", "label": "mask", "shape": "lines", "ask": SHIPPED[0]["ask"]}
EXCHANGES = {"key": "exchanges", "label": "in exchange", "shape": "lines", "ask": SHIPPED[1]["ask"]}
VOICE = {"mask": "自称「鄙人」，管人叫「先生」，句尾爱带「这个嘛」。",
         "exchanges": ["你是房东？ → 鄙人正是，先生找房子？", "雨真大。 → 这个嘛，雨大房子更难租，先生您说是不是。",
                       "那房子闹鬼？ → 先生，鄙人只管收租，这个嘛……先看纸再说。"]}


def package(tmp_path, *, vocabulary=MASK, name="voice-fixture"):
    """A real installable package under a fixture id: Natural NPC's files with the given contribution."""
    path = tmp_path / f"package-{name}"
    shutil.copytree(WORKTREE / "mods" / "natural-npc", path)
    manifest = read_json(path / "mod.json")
    manifest["id"] = name
    manifest["version"] = "0.0.1"
    manifest["default_enabled"] = False
    manifest["contributes"]["vocabulary"] = {"actor_profile_keys": [vocabulary]}
    for check in manifest["contributes"]["checks"]:
        check["name"] = f"{name}:first-impression"
    manifest["contributes"]["audit_on_decisions"] = [f"{name}:first-impression"]
    (path / "mod.json").write_text(json.dumps(manifest))
    return path


def configure(client, **change):
    """The shipped package is on by default; configuration lands only between turns (a change during a turn is pending until commit)."""
    return client.ok("mods.configure", {"campaign": CAMPAIGN, "id": MOD, "version": VERSION, "enabled": True, **change})


def on(client):
    """The shipped npc-voice package, on by default, with turn 1 open; returns the turn's capsule."""
    return open_turn(client)["capsule"]


def settle(client, call_id="t1-c1"):
    return narrate(client, call_id, "诺特没有说话。")


def job(client, **params):
    return client.ok("voice.job", {"campaign": CAMPAIGN, **params})


def submit(client, job_id, voice):
    return client.ok("voice.submit", {"campaign": CAMPAIGN, "job_id": job_id, "voice": voice})


def submit_err(client, job_id, voice):
    return client.err("voice.submit", {"campaign": CAMPAIGN, "job_id": job_id, "voice": voice})


def present(client):
    return {p["name"]: p for p in client.table("look", focus="npc")["present"]}



def test_the_shape_is_checked_at_install(kernel, tmp_path):
    error = kernel.err("mods.install", {"path": str(package(tmp_path, vocabulary={**MASK, "key": "verses", "shape": "poem"}))})
    assert error["code"] == "invalid_params" and "shape" in error["message"]


def test_the_shipped_package_declares_the_two_words_the_lane_writes(kernel):
    manifest = read_json(WORKTREE / "mods" / "npc-voice" / "mod.json")
    assert manifest["default_enabled"] is True and manifest["settings"] == {"coarse_language": True}
    assert manifest["contributes"]["vocabulary"]["actor_profile_keys"] == [MASK, EXCHANGES]


def test_nobody_needs_a_voice_while_the_package_is_off(kernel):
    create_campaign(kernel)
    narrate_opening(kernel)
    configure(kernel, enabled=False)
    kernel.table("player_input", text="我仔细观察诺特。")
    assert job(kernel) == {"job_id": None}


def test_the_packet_is_closed_and_names_the_person_by_handle(kernel):
    on(kernel)
    packet = job(kernel)
    assert packet["job_id"] == f"voice:{CAMPAIGN}:{packet['npc']['handle']}"
    assert set(packet) == {"job_id", "play_language", "module", "coarse_language", "npc", "documents", "taken_masks", "budget", "instruction"}
    assert packet["play_language"] == "zh-Hans" and packet["coarse_language"] is True
    assert packet["budget"] == {"mask_chars": 200, "exchanges": 3, "max_chars": 200}
    assert packet["taken_masks"] == []
    assert packet["npc"]["name"] and KNOTT_ID not in json.dumps(packet)
    assert "two mouths" in packet["instruction"] and "taken_masks" in packet["instruction"]
    # The setting rides in the packet: turned off, the lane is told so.
    settle(kernel)
    configure(kernel, settings={"coarse_language": False})
    assert job(kernel)["coarse_language"] is False


def test_the_write_lands_in_the_package_namespace_and_reaches_the_capsule_as_voices(kernel):
    on(kernel)
    # Knott is on stage on the opening turn; he is the first person offered.
    packet = job(kernel)
    assert packet["npc"] == {**packet["npc"], "handle": KNOTT_HANDLE, "name": KNOTT}
    result = submit(kernel, packet["job_id"], VOICE)
    assert result == {"job_id": packet["job_id"], "npc": KNOTT_HANDLE, "name": KNOTT, "voice": VOICE}
    world = read_json(campaign_dir(kernel.workspace) / "world.json")
    recorded = world["mods"]["state"][MOD]["dossier"][KNOTT_ID]
    assert recorded["voice_mask"] == {**recorded["voice_mask"], "value": [VOICE["mask"]], "label": "mask", "mod": MOD, "shape": "lines"}
    assert recorded["exchanges"] == {**recorded["exchanges"], "value": VOICE["exchanges"], "label": "in exchange", "mod": MOD, "shape": "lines"}
    assert [e for e in read_jsonl(campaign_dir(kernel.workspace) / "events.jsonl") if e["type"] == "dossier-established"][-1]["data"] == {"npc": KNOTT_HANDLE, "keys": ["voice_mask", "exchanges"]}
    # look focus=npc shows the words on the person, as lists under the package's labels.
    assert present(kernel)[KNOTT]["mask"] == [VOICE["mask"]] and present(kernel)[KNOTT]["in exchange"] == VOICE["exchanges"]
    # The capsule seats them in `voices` (§40.7), the mask as its line, and keeps them out of present[].
    settle(kernel)
    turn = kernel.table("player_input", text="我问诺特房子的事。")["capsule"]
    knott = next(p for p in turn["present"] if p["name"] == KNOTT)
    assert "mask" not in knott and "in exchange" not in knott
    assert turn["voices"] == [{"name": KNOTT, "mask": VOICE["mask"], "in exchange": VOICE["exchanges"]}]
    assert "voices" in turn["head"] and "never read an exchange out" in turn["head"]
    # ... and only while the package is on.
    narrate(kernel, "t2-c1", "诺特点了点头。")
    configure(kernel, enabled=False)
    assert "mask" not in present(kernel)[KNOTT]
    assert kernel.table("player_input", text="我再看看。")["capsule"]["voices"] == []
    # Done is done: the same voice replays, a different one conflicts, and he is not offered again.
    narrate(kernel, "t3-c1", "诺特没有说话。")
    configure(kernel)
    assert submit(kernel, packet["job_id"], VOICE)["replayed"] is True
    assert submit_err(kernel, packet["job_id"], {**VOICE, "mask": "别的。"})["code"] == "idempotency_conflict"
    assert job(kernel).get("npc", {}).get("handle") != KNOTT_HANDLE


def test_only_the_shape_is_checked(kernel):
    on(kernel)
    job_id = job(kernel)["job_id"]
    for bad, field in (
        ("不是对象", "voice"),
        ({"mask": VOICE["mask"]}, "voice.exchanges"),
        ({"mask": "", "exchanges": VOICE["exchanges"]}, "voice.mask"),
        ({"mask": "x" * 201, "exchanges": VOICE["exchanges"]}, "voice.mask"),
        ({"mask": "带{{记号}}", "exchanges": VOICE["exchanges"]}, "voice.mask"),
        ({"mask": VOICE["mask"], "exchanges": VOICE["exchanges"][:2]}, "voice.exchanges"),
        ({"mask": VOICE["mask"], "exchanges": ["一句", "一句", "一句"]}, "voice.exchanges"),
        ({"mask": VOICE["mask"], "exchanges": ["一句", "两\n行", "三句"]}, "voice.exchanges"),
        ({"mask": VOICE["mask"], "exchanges": VOICE["exchanges"], "extra": 1}, "voice"),
    ):
        error = submit_err(kernel, job_id, bad)
        assert error["code"] == "invalid_params" and error["details"]["field"] == field, bad


def test_a_failed_job_is_offered_again(kernel):
    on(kernel)
    job_id = job(kernel)["job_id"]
    assert kernel.err("voice.fail", {"campaign": CAMPAIGN, "job_id": job_id, "reason": "bad_output"})["code"] == "invalid_params"
    failed = kernel.ok("voice.fail", {"campaign": CAMPAIGN, "job_id": job_id, "reason": "model_error", "detail": "no json"})
    assert failed["status"] == "failed"
    assert job(kernel)["job_id"] == job_id


def test_the_keeper_does_not_author_the_mask_at_the_table(kernel):
    on(kernel)
    for key in ("voice_mask", "exchanges"):
        error = kernel.table_err("apply", call_id="t1-c1", effects=[
            {"kind": "dossier", "name": KNOTT, "values": {key: "先付定金再谈。"}, "why": "他开口了"}])
        assert error["code"] == "invalid_params" and "lane" in error["fix"], key


def test_backfill_reaches_people_the_table_has_not_met_and_later_packets_carry_the_masks_taken(kernel):
    on(kernel)
    offered, masks = set(), []
    while True:
        packet = job(kernel, backfill=True)
        if packet["job_id"] is None:
            break
        # §40.7: every mask established so far rides in the next packet, without a name.
        assert packet["taken_masks"] == masks[-12:] and not any(name in json.dumps(packet["taken_masks"]) for name in offered)
        offered.add(packet["npc"]["name"])
        mask = f"自称「{packet['npc']['handle']}」，句尾带「呗」。"
        submit(kernel, packet["job_id"], {"mask": mask, "exchanges": [f"{mask}一", f"{mask}二", f"{mask}三"]})
        masks.append(mask)
    assert "Walter Corbitt" in offered and KNOTT in offered


def test_the_books_silence_is_honoured_and_the_person_is_never_offered_again(kernel):
    """§40.5: a swarm or a haunt the book says does not speak gets no invented voice. The lane answers
    null with the one closed reason, the person is settled without a word reaching the capsule, and
    `voice.job` moves on."""
    on(kernel)
    packet = job(kernel)
    assert kernel.err("voice.submit", {"campaign": CAMPAIGN, "job_id": packet["job_id"], "voice": None})["details"]["field"] == "reason"
    result = kernel.ok("voice.submit", {"campaign": CAMPAIGN, "job_id": packet["job_id"], "voice": None, "reason": "does_not_speak"})
    assert result["voice"] is None and result["reason"] == "does_not_speak"
    recorded = read_json(campaign_dir(kernel.workspace) / "world.json")["mods"]["state"][MOD]["dossier"][KNOTT_ID]
    assert recorded["exchanges"]["value"] is None and recorded["exchanges"]["reason"] == "does_not_speak"
    assert "mask" not in present(kernel)[KNOTT]
    settle(kernel)
    assert kernel.table("player_input", text="我问诺特。")["capsule"]["voices"] == []
    assert job(kernel).get("npc", {}).get("handle") != KNOTT_HANDLE


def test_a_record_left_by_the_two_line_word_is_replaced_not_kept_beside(kernel):
    """1.0.x wrote `sample_lines`; re-establishing the person under the two words deletes it, so the
    Keeper never reads two answers about one mouth."""
    on(kernel)
    settle(kernel)
    path = campaign_dir(kernel.workspace) / "world.json"
    world = read_json(path)
    world["mods"]["state"].setdefault(MOD, {}).setdefault("dossier", {})[KNOTT_ID] = {
        "sample_lines": {"value": ["活儿是活儿。", "谁跟你说的？"], "label": "sounds like", "turn": 1, "mod": MOD}}
    path.write_text(json.dumps(world, ensure_ascii=False))
    kernel.table("player_input", text="我问诺特。")
    assert present(kernel)[KNOTT]["sounds like"] == ["活儿是活儿。", "谁跟你说的？"]
    packet = job(kernel)
    assert packet["npc"]["handle"] == KNOTT_HANDLE, "an old record does not settle the person"
    submit(kernel, packet["job_id"], VOICE)
    knott = present(kernel)[KNOTT]
    assert "sounds like" not in knott and knott["mask"] == [VOICE["mask"]]
