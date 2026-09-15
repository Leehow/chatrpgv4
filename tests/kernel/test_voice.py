"""Contract §40.5: the npc-voice lane. A closed job packet per person the source leaves silent, a
shape-only check of two lines, the write into the package's own §28.7 namespace (so the book is
never touched and the word dies with the package), and the Keeper's `apply dossier` kept out of a
`shape: "lines"` word. Through the RPC seam, with a package of this fixture's own."""

import json
import shutil

from conftest import CAMPAIGN, WORKTREE, campaign_dir, create_campaign, narrate, narrate_opening, open_turn, read_json, read_jsonl

KNOTT = "Steven Knott"
KNOTT_HANDLE = "steven-knott"
KNOTT_ID = "npc-steven-knott"
MOD = "npc-voice"
VERSION = "0.0.1"
SAMPLE = {"key": "sample_lines", "label": "sounds like", "shape": "lines",
          "ask": "two short lines in this person's own words when the book prints their speech, one at ease and one under strain"}


def package(tmp_path, *, vocabulary=SAMPLE):
    """A real installable package: Natural NPC's files under this fixture's id and contribution."""
    path = tmp_path / f"package-{MOD}"
    shutil.copytree(WORKTREE / "mods" / "natural-npc", path)
    manifest = read_json(path / "mod.json")
    manifest["id"] = MOD
    manifest["version"] = VERSION
    manifest["default_enabled"] = False
    manifest["settings"] = {"coarse_language": True}
    manifest["settings_schema"] = {"coarse_language": {"title": {"en": "Coarse language", "zh-Hans": "粗口"}}}
    manifest["contributes"]["vocabulary"] = {"actor_profile_keys": [vocabulary]}
    for check in manifest["contributes"]["checks"]:
        check["name"] = f"{MOD}:first-impression"
    manifest["contributes"]["audit_on_decisions"] = [f"{MOD}:first-impression"]
    (path / "mod.json").write_text(json.dumps(manifest))
    return path


def configure(client, **change):
    """Mod configuration lands only between turns (a change during a turn is pending until commit)."""
    return client.ok("mods.configure", {"campaign": CAMPAIGN, "id": MOD, "version": VERSION, "enabled": True, **change})


def on(client, tmp_path):
    client.ok("mods.install", {"path": str(package(tmp_path))})
    create_campaign(client)
    narrate_opening(client)
    configure(client)
    client.table("player_input", text="我仔细观察诺特。")


def settle(client, call_id="t1-c1"):
    return narrate(client, call_id, "诺特没有说话。")


def job(client, **params):
    return client.ok("voice.job", {"campaign": CAMPAIGN, **params})


def submit(client, job_id, lines):
    return client.ok("voice.submit", {"campaign": CAMPAIGN, "job_id": job_id, "sample_lines": lines})


def submit_err(client, job_id, lines):
    return client.err("voice.submit", {"campaign": CAMPAIGN, "job_id": job_id, "sample_lines": lines})


def present(client):
    return {p["name"]: p for p in client.table("look", focus="npc")["present"]}


def test_the_shape_is_checked_at_install(kernel, tmp_path):
    error = kernel.err("mods.install", {"path": str(package(tmp_path, vocabulary={**SAMPLE, "shape": "poem"}))})
    assert error["code"] == "invalid_params" and "shape" in error["message"]


def test_nobody_needs_lines_while_the_package_is_off(kernel, tmp_path):
    kernel.ok("mods.install", {"path": str(package(tmp_path))})
    open_turn(kernel)
    assert job(kernel) == {"job_id": None}


def test_the_packet_is_closed_and_names_the_person_by_handle(kernel, tmp_path):
    on(kernel, tmp_path)
    packet = job(kernel)
    assert packet["job_id"] == f"voice:{CAMPAIGN}:{packet['npc']['handle']}"
    assert set(packet) == {"job_id", "play_language", "module", "coarse_language", "npc", "documents", "budget", "instruction"}
    assert packet["play_language"] == "zh-Hans" and packet["coarse_language"] is True
    assert packet["budget"] == {"lines": 2, "max_chars": 120}
    assert packet["npc"]["name"] and KNOTT_ID not in json.dumps(packet)
    assert "two mouths" in packet["instruction"]
    # The setting rides in the packet: turned off, the lane is told so.
    settle(kernel)
    configure(kernel, settings={"coarse_language": False})
    assert job(kernel)["coarse_language"] is False


def test_the_write_lands_in_the_package_namespace_and_reaches_the_table(kernel, tmp_path):
    on(kernel, tmp_path)
    # Knott is on stage on the opening turn; he is the first person offered.
    packet = job(kernel)
    assert packet["npc"] == {**packet["npc"], "handle": KNOTT_HANDLE, "name": KNOTT}
    result = submit(kernel, packet["job_id"], ["活儿是活儿，先付定金再谈。", "……那房子的事我不清楚，谁跟你说的？"])
    assert result == {"job_id": packet["job_id"], "npc": KNOTT_HANDLE, "name": KNOTT,
                      "sample_lines": ["活儿是活儿，先付定金再谈。", "……那房子的事我不清楚，谁跟你说的？"]}
    world = read_json(campaign_dir(kernel.workspace) / "world.json")
    recorded = world["mods"]["state"][MOD]["dossier"][KNOTT_ID]["sample_lines"]
    assert recorded["value"] == result["sample_lines"] and recorded["label"] == "sounds like" and recorded["mod"] == MOD
    assert [e for e in read_jsonl(campaign_dir(kernel.workspace) / "events.jsonl") if e["type"] == "dossier-established"][-1]["data"] == {"npc": KNOTT_HANDLE, "keys": ["sample_lines"]}
    # It arrives on the person as a list under the package's label, and only while the package is on.
    assert present(kernel)[KNOTT]["sounds like"] == result["sample_lines"]
    settle(kernel)
    configure(kernel, enabled=False)
    assert "sounds like" not in present(kernel)[KNOTT]
    # Done is done: the same lines replay, different lines conflict, and he is not offered again.
    configure(kernel)
    assert submit(kernel, packet["job_id"], result["sample_lines"])["replayed"] is True
    assert submit_err(kernel, packet["job_id"], ["别的。", "另一句。"])["code"] == "idempotency_conflict"
    assert job(kernel).get("npc", {}).get("handle") != KNOTT_HANDLE


def test_only_the_shape_is_checked(kernel, tmp_path):
    on(kernel, tmp_path)
    job_id = job(kernel)["job_id"]
    for bad in (["一句"], ["一句", "一句"], ["一句", "x" * 121], ["一句", "带{{记号}}"], ["一句", "两\n行"], "不是列表"):
        error = submit_err(kernel, job_id, bad)
        assert error["code"] == "invalid_params" and error["details"]["field"] == "sample_lines", bad


def test_a_failed_job_is_offered_again(kernel, tmp_path):
    on(kernel, tmp_path)
    job_id = job(kernel)["job_id"]
    assert kernel.err("voice.fail", {"campaign": CAMPAIGN, "job_id": job_id, "reason": "bad_output"})["code"] == "invalid_params"
    failed = kernel.ok("voice.fail", {"campaign": CAMPAIGN, "job_id": job_id, "reason": "model_error", "detail": "no json"})
    assert failed["status"] == "failed"
    assert job(kernel)["job_id"] == job_id


def test_the_keeper_does_not_author_sample_lines_at_the_table(kernel, tmp_path):
    on(kernel, tmp_path)
    error = kernel.table_err("apply", call_id="t1-c1", effects=[
        {"kind": "dossier", "name": KNOTT, "values": {"sample_lines": "先付定金再谈。"}, "why": "他开口了"}])
    assert error["code"] == "invalid_params" and "lane" in error["fix"]


def test_backfill_reaches_people_the_table_has_not_met(kernel, tmp_path):
    on(kernel, tmp_path)
    offered = set()
    while True:
        packet = job(kernel, backfill=True)
        if packet["job_id"] is None:
            break
        offered.add(packet["npc"]["handle"])
        submit(kernel, packet["job_id"], [f"{packet['npc']['name']}一句。", f"{packet['npc']['name']}另一句。"])
    assert "walter-corbitt" in offered and KNOTT_HANDLE in offered
