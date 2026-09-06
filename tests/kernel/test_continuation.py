"""Slice 2, 12.2: the continuation checkpoint is written after the commit, follows HEAD,
and rebuilds a lost turn.json. All through the RPC seam; the files asserted on are the
ones the contract names."""

import hashlib
import json
import subprocess

import pytest

from conftest import (RpcClient, campaign_dir, create_campaign, narrate_opening, open_turn, read_json,
                      repo_dir)


def checkpoint_path(workspace):
    return campaign_dir(workspace) / "save" / "continuation" / "latest.json"


def git_show(workspace, path):
    return subprocess.run(["git", f"--git-dir={repo_dir(workspace)}", "show", f"HEAD:{path}"],
                          capture_output=True, text=True, check=False)


def head_short(workspace):
    return subprocess.run(["git", f"--git-dir={repo_dir(workspace)}", "rev-parse", "--short", "HEAD"],
                          capture_output=True, text=True, check=True).stdout.strip()


def canonical_sha(payload):
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
                          .encode("utf-8")).hexdigest()


def test_checkpoint_is_written_after_the_commit(kernel):
    open_turn(kernel)
    kernel.table("apply", call_id="t1-c1", effects=[{"kind": "move", "to": "hall-of-records", "travel_minutes": 20}])
    result = kernel.table("narrate", call_id="t1-c2", text="你到了档案馆。\n\n灰尘很厚。")
    record = read_json(campaign_dir(kernel.workspace) / "turns" / "0001.json")
    checkpoint = read_json(checkpoint_path(kernel.workspace))
    assert checkpoint == {
        **checkpoint, "schema": 1, "campaign": "c1", "turn": 1, "commit": result["commit"],
        "scene": {"name": "hall-of-records", "display_name": "hall-of-records"}, "clock": {"minutes": 20},
        "session": None, "pending_choice": None,
        "receipts_digest": canonical_sha(record["receipts"]),
        "one_line": "Turn 1: hall-of-records, clock 20 min, no session; last turn: 你到了档案馆。 灰尘很厚。",
    }
    assert checkpoint["at"]
    assert [set(i) for i in checkpoint["investigators"]] == [{"id", "name", "hp", "san", "mp", "luck"}]
    assert checkpoint["investigators"][0]["id"] == "thomas-hayes"
    # Written after the commit: HEAD's tree still holds the previous turn's checkpoint.
    shown = git_show(kernel.workspace, "save/continuation/latest.json")
    assert shown.returncode == 0 and json.loads(shown.stdout)["turn"] == 0
    # The turn record carries the snapshot the checkpoint was built from.
    assert record["world"]["scene"] == checkpoint["scene"] and record["world"]["clock"] == checkpoint["clock"]


def test_open_returns_resume_and_the_first_capsule_carries_it_once(kernel):
    create_campaign(kernel)
    fresh = kernel.table("open")
    assert fresh["opening_needed"] is True and fresh["resume"] is None
    narrate_opening(kernel)
    kernel.table("player_input", text="第一回合。")
    kernel.table("narrate", call_id="t1-c1", text="第一回合的交付。")

    opened = kernel.table("open")
    assert opened["opening_needed"] is False
    assert opened["resume"] == {
        # §15.6: the checkpoint names the line the next turn will be played on.
        "worldline": "main",
        "turn": 1, "commit": read_json(checkpoint_path(kernel.workspace))["commit"],
        "scene": {"name": "commission-briefing", "display_name": "Knott's Office"}, "clock": {"minutes": 0},
        "session": None, "one_line": "Turn 1: Knott's Office, clock 0 min, no session; last turn: 第一回合的交付。",
        "rebuilt": False,
    }
    first = kernel.table("player_input", text="第二回合。")
    assert first["capsule"]["resume"] == opened["resume"]
    kernel.table("narrate", call_id="t2-c1", text="第二回合的交付。")
    second = kernel.table("player_input", text="第三回合。")
    assert "resume" not in second["capsule"]
    assert "resume" not in kernel.table("capsule")


def test_head_ahead_of_checkpoint_rebuilds_it_from_head(tmp_path):
    ws = tmp_path / "ws"
    client = RpcClient(ws)
    try:
        open_turn(client)
        client.table("narrate", call_id="t1-c1", text="第一回合。")
        stale = read_json(checkpoint_path(ws))
        client.table("player_input", text="继续。")
        client.table("apply", call_id="t2-c1", effects=[{"kind": "clue", "clue": "knott-keys"}])
        client.table("narrate", call_id="t2-c2", text="第二回合。")
    finally:
        client.close()
    # Died after turn 2's commit, before the checkpoint and the record's sha were written.
    checkpoint_path(ws).write_text(json.dumps(stale), encoding="utf-8")
    record_path = campaign_dir(ws) / "turns" / "0002.json"
    record = read_json(record_path)
    record["commit"] = None
    record_path.write_text(json.dumps(record, ensure_ascii=False), encoding="utf-8")

    client = RpcClient(ws)
    try:
        opened = client.table("open")
        assert opened["resume"]["rebuilt"] is True
        assert opened["resume"]["turn"] == 2 and opened["resume"]["commit"] == head_short(ws)
        assert opened["resume"]["one_line"].startswith("Turn 2: ")
        assert opened["turn"] == {"number": 3, "state": "awaiting_player"} and opened["pending_turn"] is None
        rebuilt = read_json(checkpoint_path(ws))
        assert rebuilt["turn"] == 2 and rebuilt["commit"] == head_short(ws)
        assert rebuilt["receipts_digest"] == canonical_sha(read_json(record_path)["receipts"])
        assert read_json(record_path)["commit"] == head_short(ws)
        # Steady state again: a second open is not a rebuild.
        assert client.table("open")["resume"]["rebuilt"] is False
    finally:
        client.close()


def test_missing_checkpoint_is_rebuilt_from_head(tmp_path):
    ws = tmp_path / "ws"
    client = RpcClient(ws)
    try:
        open_turn(client)
        client.table("narrate", call_id="t1-c1", text="第一回合。")
    finally:
        client.close()
    checkpoint_path(ws).unlink()
    client = RpcClient(ws)
    try:
        resume = client.table("open")["resume"]
        assert resume["rebuilt"] is True and resume["turn"] == 1 and resume["commit"] == head_short(ws)
        assert checkpoint_path(ws).exists()
    finally:
        client.close()


@pytest.mark.parametrize("damage", ["delete", "corrupt"])
def test_lost_turn_json_is_rebuilt_from_the_checkpoint(tmp_path, damage):
    ws = tmp_path / "ws"
    client = RpcClient(ws)
    try:
        open_turn(client)
        client.table("narrate", call_id="t1-c1", text="第一回合。")
    finally:
        client.close()
    turn_json = campaign_dir(ws) / "turn.json"
    if damage == "delete":
        turn_json.unlink()
    else:
        turn_json.write_text("{not json", encoding="utf-8")
    client = RpcClient(ws)
    try:
        opened = client.table("open")
        assert opened["turn"] == {"number": 2, "state": "awaiting_player"}
        assert opened["resume"]["rebuilt"] is True and opened["resume"]["turn"] == 1
        assert opened["pending_turn"] is None and opened["opening_needed"] is False
        rebuilt = read_json(turn_json)
        assert rebuilt["turn"] == 2 and rebuilt["state"] == "awaiting_player" and rebuilt["calls"] == {}
        assert client.table("player_input", text="继续。")["turn"] == 2
        assert client.table("narrate", call_id="t2-c1", text="第二回合。")["turn"] == 2
        assert read_json(checkpoint_path(ws))["turn"] == 2
    finally:
        client.close()


def test_lost_turn_json_after_an_ask_restores_the_pending_choice(tmp_path):
    ws = tmp_path / "ws"
    client = RpcClient(ws)
    try:
        open_turn(client)
        client.table("narrate", call_id="t1-c1", text="第一回合。")
        client.table("player_input", text="我推门。")
        asked = client.table("ask", call_id="t2-c1", prompt="进还是不进？", options=["进", "不进"])
    finally:
        client.close()
    (campaign_dir(ws) / "turn.json").unlink()
    client = RpcClient(ws)
    try:
        opened = client.table("open")
        assert opened["turn"] == {"number": 2, "state": "asked"} and opened["resume"]["rebuilt"] is True
        answered = client.table("player_input", text="进。")
        assert answered["turn"] == 3
        assert answered["capsule"]["turn"]["pending_choice"] == asked["pending_choice"]
    finally:
        client.close()


def test_lost_turn_json_before_any_narrate_is_turn_zero(tmp_path):
    ws = tmp_path / "ws"
    client = RpcClient(ws)
    try:
        create_campaign(client)
    finally:
        client.close()
    (campaign_dir(ws) / "turn.json").unlink()
    client = RpcClient(ws)
    try:
        opened = client.table("open")
        assert opened["turn"] == {"number": 0, "state": "awaiting_player"}
        assert opened["opening_needed"] is True and opened["resume"] is None
        assert narrate_opening(client)["turn"] == 0
    finally:
        client.close()


def test_pending_turn_keeps_the_last_checkpoint_as_resume(tmp_path):
    ws = tmp_path / "ws"
    client = RpcClient(ws)
    try:
        open_turn(client)
        client.table("resolve", call_id="t1-c1", action={"intent": "investigate", "goal": "x", "method": "y",
                                                         "skill": "Spot Hidden"})
    finally:
        client.close()
    client = RpcClient(ws)
    try:
        opened = client.table("open")
        assert opened["pending_turn"]["last_call_ordinal"] == 1
        assert [r["id"] for r in opened["pending_turn"]["receipts"]] == ["roll:spot-hidden-t1-c1"]
        assert opened["resume"]["turn"] == 0 and opened["resume"]["rebuilt"] is False
        assert opened["resume"]["one_line"].startswith("Turn 0: Knott's Office")
        # The stored receipt is not re-rolled: the same call_id replays.
        replay = client.table("resolve", call_id="t1-c1", action={"intent": "investigate", "goal": "x", "method": "y",
                                                                  "skill": "Spot Hidden"})
        assert replay["replayed"] is True and replay["receipt"] == "roll:spot-hidden-t1-c1"
    finally:
        client.close()
