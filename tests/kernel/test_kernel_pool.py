"""Contract §146: a reused kernel process answers exactly as a fresh one would.

The suite hands most clients a pooled `--retargetable` process (`kernel_pool.py`). These tests are
the proof that nothing rides along from one test to the next: a process that already played a
campaign, rolled seeded dice and parsed this very workspace's files is retargeted back onto the same
path and must reproduce, byte for byte and roll for roll, what a process born on that path produced.
Every comparison here is against a fresh process, never against the pooled process's own earlier
answer, so a leak has nothing to hide behind.
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest
from conftest import CONTENT_DIR, RpcClient, campaign_dir, create_campaign, narrate, narrate_opening, read_json
from kernel_pool import POOL
from rpc_support import differences, snapshot

# Seeds no other test uses: the pool keys processes by environment, so each idle list below belongs
# to this file alone and "the same process came back" is a fact, not a likelihood.
PROBE = {"COC_KERNEL_SEED": "pool-leak-probe"}
CONTENT_PROBE = {"COC_KERNEL_SEED": "pool-content-probe"}
ACTION = {"intent": "investigate", "goal": "看桌上有什么", "method": "用侦查扫一眼"}
OTHER_ACTION = {"intent": "investigate", "goal": "翻看壁炉架", "method": "用侦查仔细看"}

pytestmark = pytest.mark.skipif(not POOL.enabled, reason="the kernel pool is off (COC_TEST_KERNEL_POOL=0)")


def play(client: RpcClient) -> list[dict]:
    """A deterministic turn under a seed and a frozen clock: dice, a commit, a second turn opened."""
    create_campaign(client)
    narrate_opening(client)
    client.table("player_input", text="我仔细观察诺特。")
    client.table("resolve", call_id="t1-c1", action=ACTION)
    narrate(client, "t1-c2", "诺特的手在抖。")
    client.table("player_input", text="我问他为什么不安。")
    client.table("look", focus="scene")
    return [row["response"] for row in client.exchanges]


def dirty(client: RpcClient) -> None:
    """Everything a process could carry: seeded rolls spent, files under this path parsed, a turn open."""
    create_campaign(client)
    narrate_opening(client)
    client.table("player_input", text="我推开地窖的门。")
    client.table("resolve", call_id="t1-c1", action=OTHER_ACTION)
    narrate(client, "t1-c2", "门后一片漆黑。")
    client.table("player_input", text="我点亮火柴。")
    client.table("resolve", call_id="t2-c1", action=ACTION)
    client.table("look", focus="scene")
    client.table("look", focus="investigator")


def test_a_reused_process_is_indistinguishable_from_a_fresh_one(tmp_path: Path) -> None:
    workspace = tmp_path / "ws"
    reference = RpcClient(workspace, env=PROBE, frozen_clock=True, fresh=True)
    try:
        assert not reference.pooled
        expected = play(reference)
    finally:
        reference.close()
    expected_state = snapshot(workspace)
    shutil.rmtree(workspace)

    first = RpcClient(workspace, env=PROBE, frozen_clock=True)
    try:
        assert first.pooled
        dirty(first)
    finally:
        first.close()
    pid = first.proc.pid
    shutil.rmtree(workspace)

    second = RpcClient(workspace, env=PROBE, frozen_clock=True)
    try:
        assert second.pooled and second.proc.pid == pid, "the idle process for this key must come back"
        assert second.link.generation >= 2  # parked once, retargeted here once
        actual = play(second)
    finally:
        second.close()
    assert actual == expected
    assert differences(expected_state, snapshot(workspace)) == []


def test_a_rewritten_content_file_is_read_again_after_retarget(tmp_path: Path) -> None:
    """A retarget keeps parsed files under an unchanged content root (§146) -- by file identity,
    so a file rewritten in place between two tests is parsed again, not served from memory."""
    content = tmp_path / "content"
    content.mkdir()
    for child in CONTENT_DIR.iterdir():
        if child.name != "starters":
            (content / child.name).symlink_to(child)
    (content / "starters").mkdir()
    shutil.copytree(CONTENT_DIR / "starters" / "the-haunting", content / "starters" / "the-haunting")
    pregen = content / "starters" / "the-haunting" / "pregens" / "thomas-hayes" / "character.json"

    def rename(name: str) -> None:
        data = read_json(pregen)
        data["name"] = name
        pregen.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    def investigator_name(client: RpcClient) -> str:
        create_campaign(client)
        return read_json(campaign_dir(client.workspace) / "party" / "thomas-hayes.json")["name"]

    rename("第一个名字")
    first = RpcClient(tmp_path / "ws1", env=CONTENT_PROBE, content=content)
    try:
        assert first.pooled
        assert investigator_name(first) == "第一个名字"
    finally:
        first.close()

    rename("换过的第二个名字")
    second = RpcClient(tmp_path / "ws2", env=CONTENT_PROBE, content=content)
    try:
        assert second.proc.pid == first.proc.pid
        assert investigator_name(second) == "换过的第二个名字"
    finally:
        second.close()


def test_retarget_refuses_a_bad_target_and_keeps_serving(tmp_path: Path) -> None:
    client = RpcClient(tmp_path / "ws", env=PROBE)
    try:
        assert client.pooled
        create_campaign(client)
        error = client.err("kernel.retarget", {"workspace": str(tmp_path / "elsewhere"), "content": str(tmp_path / "no-content")})
        assert error["code"] == "invalid_params" and "rulesets/coc7" in error["message"]
        assert client.err("kernel.retarget", {"workspace": "", "content": str(CONTENT_DIR)})["code"] == "invalid_params"
        assert [row["id"] for row in client.ok("campaign.list")["campaigns"]] == ["c1"]
    finally:
        client.close()


def test_a_plain_process_refuses_to_retarget(tmp_path: Path) -> None:
    client = RpcClient(tmp_path / "ws", fresh=True)
    try:
        error = client.err("kernel.retarget", {"workspace": str(tmp_path / "other"), "content": str(CONTENT_DIR)})
        assert error["code"] == "not_implemented" and error["next"] == "stop"
        assert client.ok("kernel.hello")["content"]["rulesets"] == ["coc7"]
    finally:
        client.close()


def test_a_dead_or_wedged_process_is_not_handed_to_the_next_test(tmp_path: Path) -> None:
    killed = RpcClient(tmp_path / "a", env=CONTENT_PROBE)
    assert killed.pooled
    killed.proc.kill()
    killed.proc.wait(timeout=5)
    killed.close()
    replacement = RpcClient(tmp_path / "b", env=CONTENT_PROBE)
    try:
        assert replacement.proc.pid != killed.proc.pid
        assert replacement.ok("kernel.hello")["kernel_version"]
    finally:
        replacement.close()


def test_fresh_clients_and_foreign_commands_spawn_their_own_process(tmp_path: Path) -> None:
    one = RpcClient(tmp_path / "a", fresh=True)
    two = RpcClient(tmp_path / "b", fresh=True)
    try:
        assert not one.pooled and not two.pooled and one.proc.pid != two.proc.pid
    finally:
        one.close()
        two.close()
    assert one.proc.returncode == 0 and two.proc.returncode == 0
