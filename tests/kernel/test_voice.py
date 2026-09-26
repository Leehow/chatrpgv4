"""Contract §40.7: the npc-voice lane. A closed job packet per person the source leaves silent, a
shape-only check of a mask and three exchanges, the write into the package's own §28.7 namespace (so
the book is never touched and the words die with the package), the capsule's `voices` seat, and the
Keeper's `apply dossier` kept out of a `shape: "lines"` word. Through the RPC seam."""

import json
import shutil

import pytest

from conftest import (CAMPAIGN, PREGEN, WORKTREE, campaign_dir, create_campaign, narrate, narrate_opening, open_turn,
                      read_json, read_jsonl)

KNOTT = "Steven Knott"
KNOTT_HANDLE = "steven-knott"
KNOTT_ID = "npc-steven-knott"
MOD = "npc-voice"
EXPRESSION = "narration-craft"
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
    """Legacy lane only: turn the unified package off before an enabled voice lock. A change during a turn stays pending until commit."""
    enabled = change.get("enabled", True)
    if enabled:
        client.ok("mods.configure", {"campaign": CAMPAIGN, "id": EXPRESSION, "enabled": False})
    return client.ok("mods.configure", {"campaign": CAMPAIGN, "id": MOD, "version": VERSION, "enabled": True, **change})


def on(client):
    """Explicit legacy owner, unified package off, with turn 1 open; returns the turn's capsule."""
    create_campaign(client)
    configure(client)
    narrate_opening(client)
    return client.table("player_input", text="我仔细观察诺特。")["capsule"]


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
    assert manifest["default_enabled"] is False and manifest["superseded_by"] == "narration-craft"
    assert manifest["settings"] == {"coarse_language": True}
    assert manifest["contributes"]["vocabulary"]["actor_profile_keys"] == [MASK, EXCHANGES]


def test_nobody_needs_a_voice_while_the_package_is_off(kernel):
    create_campaign(kernel)
    narrate_opening(kernel)
    kernel.ok("mods.configure", {"campaign": CAMPAIGN, "id": EXPRESSION, "enabled": False})  # 2.0.0 owns the lane by default
    configure(kernel, enabled=False)
    kernel.table("player_input", text="我仔细观察诺特。")
    assert job(kernel) == {"job_id": None}


def test_the_packet_is_closed_and_names_the_person_by_handle(kernel):
    on(kernel)
    packet = job(kernel)
    lock = read_json(campaign_dir(kernel.workspace) / "world.json")["mods"]["active"][MOD]
    assert packet["generation"] == {key: lock[key] for key in ("version", "digest", "state_version")}
    assert packet["job_id"] == f"voice:{CAMPAIGN}:{packet['npc']['handle']}@{lock['digest']}"
    assert set(packet) == {"job_id", "generation", "play_language", "module", "coarse_language", "npc", "documents", "taken_masks", "said", "budget", "instruction", "investigator"}
    assert packet["said"] == []
    assert packet["play_language"] == "zh-Hans" and packet["coarse_language"] is True
    assert packet["budget"] == {"mask_chars": 200, "exchanges": 3, "max_chars": 200}
    assert packet["taken_masks"] == []
    assert packet["npc"]["name"] and KNOTT_ID not in json.dumps(packet)
    assert "taken_masks" in packet["instruction"]
    # The setting rides in the packet: turned off, the lane is told so.
    settle(kernel)
    configure(kernel, settings={"coarse_language": False})
    assert job(kernel)["coarse_language"] is False


def test_the_packet_carries_the_investigator_the_mask_has_to_fit(kernel):
    """§118: a mask is written for a listener. Until this, the lane was blind to who that was, so a mask
    invented its own address term -- campaign game-ca56ce50 had 内特·帕特森 call a woman 小伙子 all game."""
    on(kernel)
    sheet = read_json(campaign_dir(kernel.workspace) / "party" / f"{PREGEN}.json")
    packet = job(kernel)
    assert packet["investigator"] == {"sex": sheet["sex"]}, "the sheet's own free text, the value §117 makes the Keeper owe"
    assert sheet["name"] not in json.dumps(packet["investigator"]), "no name travels with the listener"
    # The other half is the word this table has settled on for them to their face (§79).
    kernel.ok("table.apply", {"campaign": CAMPAIGN, "call_id": "t1-c1", "effects": [
        {"kind": "person", "who": sheet["name"], "address": "汤米"}]})
    assert job(kernel)["investigator"] == {"sex": sheet["sex"], "address": "汤米"}


def test_the_packet_carries_what_is_visible_of_the_listener(kernel):
    """§119: a mask written for someone the speaker has not met names what it can see -- and invents nothing
    when the sheet says nothing."""
    on(kernel)
    path = campaign_dir(kernel.workspace) / "party" / f"{PREGEN}.json"
    sheet = read_json(path)
    assert "appearance" not in job(kernel)["investigator"], "nothing written, nothing invented"
    written = "机车皮夹克，墨镜，一头中长黑发。"
    sheet["backstory"]["personal_description"] = written * 30
    path.write_text(json.dumps(sheet, ensure_ascii=False), encoding="utf-8")
    appearance = job(kernel)["investigator"]["appearance"]
    assert len(appearance) == 200 and appearance == (written * 30)[:200]


def test_a_packet_with_nothing_to_say_about_the_listener_carries_no_investigator(kernel):
    """§118: absent is absent. A sheet with no `sex` and no §79 record yet leaves the mask's writer with no
    listener facts at all, and the packet says nothing rather than filling the blank in."""
    on(kernel)
    path = campaign_dir(kernel.workspace) / "party" / f"{PREGEN}.json"
    sheet = read_json(path)
    sheet.pop("sex", None)
    path.write_text(json.dumps(sheet, ensure_ascii=False), encoding="utf-8")
    assert "investigator" not in job(kernel)


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
    # §40.8: the head names the flexible register, answers-first, exchanges as reference.
    assert "voices" in turn["head"] and "flexible register" in turn["head"]
    assert "Answer the player's words first" in turn["head"] and "Exchanges are reference" in turn["head"]
    assert "never lines to read out or slogans to repeat" in turn["head"]
    assert "Wear the mask on every line" not in turn["head"]
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


def test_the_packet_carries_the_lines_this_person_already_said(kernel):
    """§113 D: the lane is told what this mouth has already said at this table."""
    create_campaign(kernel)
    configure(kernel)
    narrate_opening(kernel, "开场。\n\n{{say:Steven Knott}}「钥匙在这儿，拿去就是。」{{/say}}诺特把钥匙拍在桌上。")
    kernel.table("player_input", text="我仔细观察诺特。")
    packet = job(kernel)
    assert packet["said"] == ["「钥匙在这儿，拿去就是。」"]
    assert "said" in packet["instruction"]
    assert packet["generation"]["state_version"] == 2
    assert "investigator" in packet


def installed_voice(kernel, tmp_path, version, state_version):
    path = tmp_path / version
    shutil.copytree(WORKTREE / "mods" / MOD, path)
    manifest = read_json(path / "mod.json")
    manifest.update(version=version, state_version=state_version)
    if state_version == 1:
        manifest.pop("migrations", None)
    (path / "mod.json").write_text(json.dumps(manifest), encoding="utf-8")
    kernel.ok("mods.install", {"path": str(path)})


def legacy_campaign(kernel, tmp_path):
    installed_voice(kernel, tmp_path, "1.1.2", 1)
    create_campaign(kernel)
    narrate_opening(kernel)
    kernel.ok("mods.configure", {"campaign": CAMPAIGN, "id": EXPRESSION, "enabled": False})  # legacy lane only: 2.0.0 owns it by default
    # Model a save with no enrollment, then use the real activation path for its old lock.
    path = campaign_dir(kernel.workspace) / "world.json"
    world = read_json(path)
    world["mods"]["active"].pop(MOD, None)
    world["mods"]["state"].pop(MOD, None)
    path.write_text(json.dumps(world), encoding="utf-8")
    assert job(kernel) == {"job_id": None}, "a missing lock must not auto-enroll"
    configure(kernel, version="1.1.2")
    return campaign_dir(kernel.workspace)


def job_file(root, packet, owner=MOD):
    generation = packet.get("generation")
    folder = root / owner / "jobs"
    if generation:
        folder = folder / "v2" / generation["digest"]
    return folder / f"{packet['npc']['handle']}.json"


def test_explicit_upgrade_archives_cards_and_preserves_jobs_and_turns(kernel, tmp_path):
    root = legacy_campaign(kernel, tmp_path)
    old = job(kernel)
    assert old["job_id"] == f"voice:{CAMPAIGN}:{KNOTT_HANDLE}"
    assert "generation" not in old
    submit(kernel, old["job_id"], VOICE)
    assert submit(kernel, old["job_id"], VOICE)["replayed"] is True
    old_bytes = job_file(root, old).read_bytes()
    old_dossier = read_json(root / "world.json")["mods"]["state"][MOD]["dossier"]
    turns = {path: path.read_bytes() for path in (root / "turns").rglob("*") if path.is_file()}
    assert turns, "retention must check actual historical files"
    configure(kernel)
    state = read_json(root / "world.json")["mods"]["state"][MOD]
    assert state["legacy_voice_dossier"] == old_dossier
    assert state["dossier"] == {}
    new = job(kernel)
    assert new["npc"]["handle"] == KNOTT_HANDLE, "old done must not suppress regeneration"
    assert new["job_id"] != old["job_id"]
    assert read_json(job_file(root, new))["generation"] == new["generation"]
    assert submit_err(kernel, old["job_id"], VOICE)["code"] == "invalid_params"
    kernel.err("voice.fail", {"campaign": CAMPAIGN, "job_id": old["job_id"], "reason": "model_error"})
    submit(kernel, new["job_id"], VOICE)
    assert submit(kernel, new["job_id"], VOICE)["replayed"] is True
    assert job_file(root, old).read_bytes() == old_bytes
    assert all(path.read_bytes() == data for path, data in turns.items())
    assert read_json(root / "world.json")["mods"]["state"][MOD]["legacy_voice_dossier"] == old_dossier


def test_upgrade_stays_pending_and_preserves_explicit_disable(kernel, tmp_path):
    root = legacy_campaign(kernel, tmp_path)
    configure(kernel, version="1.1.2", enabled=False)
    kernel.table("player_input", text="I look around.")
    kernel.ok("mods.configure", {"campaign": CAMPAIGN, "id": MOD, "version": VERSION})
    world = read_json(root / "world.json")
    assert world["mods"]["active"][MOD]["version"] == "1.1.2"
    assert world["mods"]["pending"][MOD]["enabled"] is False
    assert job(kernel) == {"job_id": None}
    settle(kernel)
    kernel.table("player_input", text="I wait.")
    lock = read_json(root / "world.json")["mods"]["active"][MOD]
    assert lock["state_version"] == 2 and lock["enabled"] is False
    assert job(kernel) == {"job_id": None}


def test_current_generation_is_unique_and_stale_submit_and_fail_are_read_only(kernel, tmp_path):
    create_campaign(kernel)
    configure(kernel)
    narrate_opening(kernel)
    root = campaign_dir(kernel.workspace)
    old = job(kernel)
    installed_voice(kernel, tmp_path, "1.2.1", 2)
    configure(kernel, version="1.2.1")
    current = job(kernel)
    assert current["job_id"] != old["job_id"]
    assert current["generation"]["digest"] != old["generation"]["digest"]
    before = {path: path.read_bytes() for path in [root / "world.json", job_file(root, old), job_file(root, current)]}
    assert submit_err(kernel, old["job_id"], VOICE)["code"] == "invalid_params"
    kernel.err("voice.fail", {"campaign": CAMPAIGN, "job_id": old["job_id"], "reason": "model_error"})
    assert all(path.read_bytes() == data for path, data in before.items())
    submit(kernel, current["job_id"], VOICE)
    assert submit(kernel, current["job_id"], VOICE)["replayed"] is True
    configure(kernel, version="1.2.1", enabled=False)
    assert submit_err(kernel, current["job_id"], VOICE)["code"] == "invalid_params"


@pytest.mark.parametrize("location", ["job", "packet"])
@pytest.mark.parametrize("field,value", [("version", "9.9.9"), ("state_version", 1), ("state_version", "2"), ("digest", "0" * 64)])
def test_submit_checks_all_generation_fields_before_any_write(kernel, location, field, value):
    on(kernel)
    packet = job(kernel)
    root = campaign_dir(kernel.workspace)
    path = job_file(root, packet)
    stored = read_json(path)
    (stored if location == "job" else stored["packet"])["generation"][field] = value
    path.write_text(json.dumps(stored), encoding="utf-8")
    before = path.read_bytes(), (root / "world.json").read_bytes()
    assert submit_err(kernel, packet["job_id"], VOICE)["code"] == "invalid_params"
    assert (path.read_bytes(), (root / "world.json").read_bytes()) == before


def test_old_inflight_result_cannot_write_after_pending_upgrade_applies(kernel, tmp_path):
    root = legacy_campaign(kernel, tmp_path)
    old = job(kernel)
    kernel.table("player_input", text="I wait.")
    configure(kernel)
    assert job(kernel)["job_id"] == old["job_id"], "pending is not active"
    settle(kernel)
    kernel.table("player_input", text="I look around.")
    current = job(kernel)
    assert current["job_id"] != old["job_id"]
    paths = [root / "world.json", job_file(root, old), job_file(root, current)]
    before = [path.read_bytes() for path in paths]
    assert submit_err(kernel, old["job_id"], VOICE)["code"] == "invalid_params"
    kernel.err("voice.fail", {"campaign": CAMPAIGN, "job_id": old["job_id"], "reason": "model_error"})
    assert [path.read_bytes() for path in paths] == before


def test_source_authored_words_survive_real_package_upgrade(kernel, tmp_path):
    from test_mod_vocabulary import built_module, played, table_npcs

    installed_voice(kernel, tmp_path, "1.1.2", 1)
    mid, _ = built_module(kernel, tmp_path, {"voice_mask": ["Measured, courteous speech."], "exchanges": ["Good morning. -> Good morning to you."]})
    campaign = played(kernel, tmp_path, mid)
    kernel.ok("table.narrate", {"campaign": campaign, "call_id": "t0-c1", "text": "The tenant waits."})
    root = campaign_dir(kernel.workspace, campaign)
    world = read_json(root / "world.json")
    world["mods"]["active"].pop(MOD)
    (root / "world.json").write_text(json.dumps(world), encoding="utf-8")
    kernel.ok("mods.configure", {"campaign": campaign, "id": EXPRESSION, "enabled": False})
    kernel.ok("mods.configure", {"campaign": campaign, "id": MOD, "version": "1.1.2", "enabled": True})
    before = table_npcs(kernel, campaign)["Tenant"]
    module_root = kernel.workspace / ".coc" / "modules" / mid
    evidence = {path: path.read_bytes() for path in module_root.rglob("*") if path.is_file()}
    kernel.ok("mods.configure", {"campaign": campaign, "id": MOD, "version": VERSION})
    after = table_npcs(kernel, campaign)["Tenant"]
    assert after["mask"] == before["mask"] == ["Measured, courteous speech."]
    assert after["in exchange"] == before["in exchange"]
    assert kernel.ok("voice.job", {"campaign": campaign, "backfill": True}) == {"job_id": None}
    assert all(path.read_bytes() == data for path, data in evidence.items())


def test_v2_identity_parser_rejects_invalid_suffixes(kernel):
    on(kernel)
    packet = job(kernel)
    for identity in [packet["job_id"].split("@")[0], packet["job_id"] + "extra", packet["job_id"] + "/../x"]:
        assert submit_err(kernel, identity, VOICE)["code"] == "invalid_params"


# ---- The lane's owner (contract §40.7 Owner, 2026-09-25; docs/specs/prose-mod.md §4) -----------------

GENERATION = "npc.voice.generation.v2"
UNIFIED_VERSION = "90.0.0"


def unified_package(kernel, tmp_path, *, generation=True, version=UNIFIED_VERSION):
    """The shipped unified package under a fixture version above every shipped one, so a new world locks it.
    With `generation` its manifest also declares the lane; the shipped `mods/` tree is never touched."""
    path = tmp_path / f"{EXPRESSION}-{version}"
    shutil.copytree(WORKTREE / "mods" / EXPRESSION, path)
    manifest = read_json(path / "mod.json")
    manifest["version"] = version
    requires = [cap for cap in manifest["requires"] if cap != GENERATION]
    manifest["requires"] = [*requires, GENERATION] if generation else requires
    if not generation and "voice_lane" in manifest["contributes"]:
        # §40.7 Instruction: only a lane owner may contribute the lane's words.
        lane = manifest["contributes"].pop("voice_lane")
        manifest["package_files"] = [name for name in manifest["package_files"] if name != lane]
        (path / lane).unlink()
    (path / "mod.json").write_text(json.dumps(manifest), encoding="utf-8")
    kernel.ok("mods.install", {"path": str(path)})


def test_the_lane_instruction_comes_from_the_owning_package(kernel, tmp_path):
    """Contract §40.7 Instruction (2026-09-26): the packet carries the owner package's contributes.voice_lane, frozen
    with its version; the kernel's content no longer holds the lane's words for a current owner."""
    path = tmp_path / f"{EXPRESSION}-lane"
    shutil.copytree(WORKTREE / "mods" / EXPRESSION, path)
    manifest = read_json(path / "mod.json")
    manifest["version"] = UNIFIED_VERSION
    (path / manifest["contributes"]["voice_lane"]).write_text("Package lane instruction: taken_masks, said, and the voice shape.", encoding="utf-8")
    (path / "mod.json").write_text(json.dumps(manifest), encoding="utf-8")
    kernel.ok("mods.install", {"path": str(path)})
    create_campaign(kernel)
    narrate_opening(kernel)
    kernel.table("player_input", text="我仔细观察诺特。")
    packet = job(kernel)
    assert packet["generation"]["version"] == UNIFIED_VERSION
    assert packet["instruction"] == "Package lane instruction: taken_masks, said, and the voice shape."


def test_a_legacy_owner_keeps_the_frozen_lane_instruction(kernel):
    """An owner whose package predates the contribution (npc-voice 1.x here) reads content/compat/npc-voice-lane.md."""
    on(kernel)
    packet = job(kernel)
    assert packet["instruction"] == (WORKTREE / "content" / "compat" / "npc-voice-lane.md").read_text(encoding="utf-8").strip()


def test_voice_lane_without_the_generation_capability_is_refused(kernel, tmp_path):
    path = tmp_path / f"{EXPRESSION}-no-lane"
    shutil.copytree(WORKTREE / "mods" / EXPRESSION, path)
    manifest = read_json(path / "mod.json")
    manifest["version"] = UNIFIED_VERSION
    manifest["requires"] = [cap for cap in manifest["requires"] if cap != GENERATION]
    (path / "mod.json").write_text(json.dumps(manifest), encoding="utf-8")
    error = kernel.err("mods.install", {"path": str(path)})
    assert error["code"] == "invalid_params" and "voice_lane" in error["message"]


def task_world_revision(client):
    return client.table("capsule")["_context"]["task_world_revision"]


def test_a_new_world_gives_the_lane_to_the_unified_package(kernel, tmp_path):
    unified_package(kernel, tmp_path)
    create_campaign(kernel)
    root = campaign_dir(kernel.workspace)
    locks = read_json(root / "world.json")["mods"]["active"]
    assert (locks[EXPRESSION]["version"], locks[EXPRESSION]["enabled"], locks[MOD]["enabled"]) == (UNIFIED_VERSION, True, False)
    narrate_opening(kernel)
    # The opening committed with Knott on stage: the owner's generation names the job and its folder.
    packet = job(kernel)
    lock = read_json(root / "world.json")["mods"]["active"][EXPRESSION]
    assert packet["npc"]["handle"] == KNOTT_HANDLE
    assert packet["generation"] == {key: lock[key] for key in ("version", "digest", "state_version")}
    assert packet["job_id"] == f"voice:{CAMPAIGN}:{KNOTT_HANDLE}@{lock['digest']}"
    assert packet["coarse_language"] is lock["settings"]["coarse_language"]
    assert read_json(job_file(root, packet, EXPRESSION))["job_id"] == packet["job_id"]
    assert not (root / MOD).exists(), "the unified owner's jobs never share the legacy folder"
    revision = task_world_revision(kernel)
    result = submit(kernel, packet["job_id"], VOICE)
    assert result == {"job_id": packet["job_id"], "npc": KNOTT_HANDLE, "name": KNOTT, "voice": VOICE}
    world = read_json(root / "world.json")
    recorded = world["mods"]["state"][EXPRESSION]["dossier"][KNOTT_ID]
    assert recorded["voice_mask"] == {**recorded["voice_mask"], "value": [VOICE["mask"]], "label": "mask", "mod": EXPRESSION, "shape": "lines"}
    assert recorded["exchanges"] == {**recorded["exchanges"], "value": VOICE["exchanges"], "label": "in exchange", "mod": EXPRESSION, "shape": "lines"}
    assert MOD not in world["mods"]["state"]
    assert read_json(job_file(root, packet, EXPRESSION))["status"] == "done"
    # A record stamped by the unified owner is presentation, not a rule fact: the task view does not move.
    assert task_world_revision(kernel) == revision
    assert [e for e in read_jsonl(root / "events.jsonl") if e["type"] == "dossier-established"][-1]["data"] == {"npc": KNOTT_HANDLE, "keys": ["voice_mask", "exchanges"]}
    # The capsule seats him in `voices`; the lane replays the same answer and does not offer him again.
    turn = kernel.table("player_input", text="我问诺特房子的事。")["capsule"]
    assert turn["voices"] == [{"name": KNOTT, "mask": VOICE["mask"], "in exchange": VOICE["exchanges"]}]
    assert submit(kernel, packet["job_id"], VOICE)["replayed"] is True
    assert job(kernel).get("npc", {}).get("handle") != KNOTT_HANDLE


def test_a_new_unified_generation_reads_who_is_settled_from_the_owners_namespace(kernel, tmp_path):
    """An upgrade of the unified package is a new generation with no done job for anyone, and the old namespace
    of the legacy lane is empty here: only the owner's own dossier can say Knott is settled and whose mask is taken."""
    unified_package(kernel, tmp_path)
    create_campaign(kernel)
    narrate_opening(kernel)
    first = job(kernel)
    submit(kernel, first["job_id"], VOICE)
    unified_package(kernel, tmp_path, version="90.0.1")
    kernel.ok("mods.configure", {"campaign": CAMPAIGN, "id": EXPRESSION, "version": "90.0.1"})
    packet = job(kernel, backfill=True)
    assert packet["generation"]["version"] == "90.0.1" and packet["generation"]["digest"] != first["generation"]["digest"]
    assert packet["npc"]["handle"] != KNOTT_HANDLE, "Knott is on stage and first in line unless the owner's dossier settles him"
    assert VOICE["mask"] in packet["taken_masks"]


def test_a_handed_over_card_is_established_under_the_unified_owner(kernel, tmp_path):
    unified_package(kernel, tmp_path)
    create_campaign(kernel)
    configure(kernel)
    narrate_opening(kernel)
    root = campaign_dir(kernel.workspace)
    legacy = job(kernel)
    assert legacy["npc"]["handle"] == KNOTT_HANDLE and job_file(root, legacy).exists()
    submit(kernel, legacy["job_id"], VOICE)
    before = read_json(root / "world.json")["mods"]["state"][MOD]["dossier"]
    kernel.ok("mods.configure", {"campaign": CAMPAIGN, "id": EXPRESSION, "version": UNIFIED_VERSION, "enabled": True})
    world = read_json(root / "world.json")
    assert world["mods"]["active"][MOD]["enabled"] is False
    assert world["mods"]["state"][EXPRESSION]["dossier"][KNOTT_ID] == before[KNOTT_ID]
    assert world["mods"]["state"][EXPRESSION]["voice_handover"]["copied_count"] == 1
    digest = world["mods"]["active"][EXPRESSION]["digest"]
    # The legacy job is no longer the owner's: it cannot even replay.
    assert submit_err(kernel, legacy["job_id"], VOICE)["code"] == "invalid_params"
    # Knott is on stage and would be first in line; backfill widens to everyone else. He is never offered.
    offered = []
    while (packet := job(kernel, backfill=True))["job_id"] is not None:
        assert packet["generation"]["digest"] == digest and VOICE["mask"] in packet["taken_masks"]
        offered.append(packet["npc"]["handle"])
        mask = f"自称「{packet['npc']['handle']}」，句尾带「呗」。"
        submit(kernel, packet["job_id"], {"mask": mask, "exchanges": [f"{mask}一", f"{mask}二", f"{mask}三"]})
    assert offered and KNOTT_HANDLE not in offered
    world = read_json(root / "world.json")
    written = world["mods"]["state"][EXPRESSION]["dossier"]
    assert all(record["exchanges"]["mod"] == EXPRESSION for npc, record in written.items() if npc != KNOTT_ID)
    assert len(written) == len(offered) + 1
    assert world["mods"]["state"][MOD]["dossier"] == before, "the old namespace is kept, not written"
    turn = kernel.table("player_input", text="我问诺特房子的事。")["capsule"]
    assert {"name": KNOTT, "mask": VOICE["mask"], "in exchange": VOICE["exchanges"]} in turn["voices"]


def test_with_neither_package_on_the_lane_has_no_owner_and_no_job(kernel, tmp_path):
    unified_package(kernel, tmp_path)
    create_campaign(kernel)
    narrate_opening(kernel)
    root = campaign_dir(kernel.workspace)
    stale = job(kernel)
    assert stale["job_id"].endswith("@" + read_json(root / "world.json")["mods"]["active"][EXPRESSION]["digest"])
    kernel.ok("mods.configure", {"campaign": CAMPAIGN, "id": EXPRESSION, "enabled": False})
    locks = read_json(root / "world.json")["mods"]["active"]
    assert (locks[EXPRESSION]["enabled"], locks[MOD]["enabled"]) == (False, False)
    kernel.table("player_input", text="我仔细观察诺特。")
    assert job(kernel) == {"job_id": None}
    assert job(kernel, backfill=True) == {"job_id": None}
    # A job the unified package minted while it owned the lane writes nothing once it does not.
    paths = [root / "world.json", job_file(root, stale, EXPRESSION)]
    before = [path.read_bytes() for path in paths]
    assert submit_err(kernel, stale["job_id"], VOICE)["code"] == "invalid_params"
    assert kernel.err("voice.fail", {"campaign": CAMPAIGN, "job_id": stale["job_id"], "reason": "model_error"})["code"] == "invalid_params"
    assert [path.read_bytes() for path in paths] == before


def test_an_enabled_unified_package_that_does_not_declare_generation_owns_nothing(kernel, tmp_path):
    unified_package(kernel, tmp_path, generation=False)
    create_campaign(kernel)
    narrate_opening(kernel)
    root = campaign_dir(kernel.workspace)
    locks = read_json(root / "world.json")["mods"]["active"]
    assert (locks[EXPRESSION]["version"], locks[EXPRESSION]["enabled"], locks[MOD]["enabled"]) == (UNIFIED_VERSION, True, False)
    assert job(kernel, backfill=True) == {"job_id": None}
    assert not (root / EXPRESSION).exists() and not (root / MOD).exists()

