"""Crash recovery and idempotent replay across a killed kernel process (contract §12.2, §12.6).

Every test here kills a real `RpcClient` (a live `python -m coc.rpc` subprocess) with
`.close()` mid-campaign and opens a *new* `RpcClient` on the same workspace, exactly as
the kernel extension does when it respawns after a crash: all state is on disk, the new
process has no memory of the old one, and `table.open` is the only way it learns what
happened.
"""
import json

from conftest import (RpcClient, campaign_dir, create_campaign, git_log, narrate_opening,
                       open_turn, read_json)

ACTION = {"intent": "investigate", "goal": "看桌上有什么", "method": "用侦查扫一眼"}


def test_resume_is_null_before_any_turn_is_committed(kernel):
    """§12.2: `opening_needed` 时 `resume` 为 null -- a brand-new campaign has nothing to resume."""
    create_campaign(kernel)
    opened = kernel.table("open")
    assert opened["opening_needed"] is True
    assert opened["resume"] is None


def test_killed_between_acting_and_committed_reopens_and_finishes_with_one_commit(tmp_path):
    workspace = tmp_path / "ws"
    first = RpcClient(workspace)
    try:
        open_turn(first, "我检查这间办公室。")
        resolved = first.table("resolve", call_id="t1-c1", action=ACTION)
        assert read_json(campaign_dir(workspace) / "turn.json")["state"] == "acting"
    finally:
        first.close()  # the process dies mid-turn; nothing after this line ran

    commits_before = git_log(workspace)

    second = RpcClient(workspace)
    try:
        opened = second.table("open")
        assert opened["opening_needed"] is False
        assert opened["turn"] == {"number": 1, "state": "acting"}
        pending = opened["pending_turn"]
        assert pending["player_text"] == "我检查这间办公室。"
        assert [r["id"] for r in pending["receipts"]] == [resolved["receipt"]]
        assert pending["owed"] == ["narrate"]
        assert pending["since"]
        assert pending["last_call_ordinal"] == 1  # t1-c1 was spent before the crash

        # Replaying the pre-crash resolve must return the stored result, not roll again.
        replayed = second.table("resolve", call_id="t1-c1", action=ACTION)
        assert replayed == {**resolved, "replayed": True}
        assert [r["id"] for r in second.table("status")["receipts"]] == [resolved["receipt"]]

        # The keeper picks up where it left off and closes the turn.
        narrated = second.table("narrate", call_id="t1-c2", text="办公室里只有雪茄味。")
        assert narrated["commit"]
        assert second.table("open")["pending_turn"] is None
    finally:
        second.close()

    commits_after = git_log(workspace)
    assert len(commits_after) == len(commits_before) + 1


def test_narrate_replayed_after_reopen_makes_no_second_commit(tmp_path):
    workspace = tmp_path / "ws"
    first = RpcClient(workspace)
    try:
        open_turn(first, "我听着走廊里的脚步声。")
        narrated = first.table("narrate", call_id="t1-c1", text="脚步声渐渐远去。")
    finally:
        first.close()  # died right after the commit landed, before anything else

    commits_before = git_log(workspace)

    second = RpcClient(workspace)
    try:
        replay = second.table("narrate", call_id="t1-c1", text="脚步声渐渐远去。")
        assert replay == {**narrated, "replayed": True}
        assert second.table("status")["turn"] == 2  # the replay did not reopen/reclose the turn
    finally:
        second.close()

    assert git_log(workspace) == commits_before  # not one commit more


def test_missing_checkpoint_is_rebuilt_from_head_on_reopen(tmp_path):
    """§12.6: died after the commit landed, before the checkpoint was written. §12.2 calls
    this the case where HEAD is ahead of the checkpoint; the checkpoint is a rebuildable
    cache, so `table.open` reconstructs it from the HEAD turn record instead of failing."""
    workspace = tmp_path / "ws"
    first = RpcClient(workspace)
    try:
        open_turn(first, "我打开了灯。")
        narrated = first.table("narrate", call_id="t1-c1", text="灯光昏黄，照亮了满地的文件。")
    finally:
        first.close()

    checkpoint_path = campaign_dir(workspace) / "save" / "continuation" / "latest.json"
    assert checkpoint_path.exists(), "narrate should have written the continuation checkpoint"
    checkpoint_path.unlink()

    second = RpcClient(workspace)
    try:
        opened = second.table("open")
        assert opened["pending_turn"] is None  # turn.json itself is intact: awaiting_player
        assert opened["turn"] == {"number": 2, "state": "awaiting_player"}
        resume = opened["resume"]
        assert resume is not None
        assert resume["turn"] == 1
        assert resume["commit"] == narrated["commit"]
        assert resume["one_line"]

        rebuilt = read_json(checkpoint_path)
        assert rebuilt["turn"] == 1
        assert rebuilt["commit"] == narrated["commit"]
    finally:
        second.close()


def test_corrupted_turn_json_rebuilds_a_fresh_turn_from_the_checkpoint(tmp_path):
    """§12.2: `turn.json` missing/corrupt, checkpoint present, HEAD == checkpoint.commit ->
    `fresh_turn(checkpoint.turn + 1)` rebuilds `turn.json`, `resume.rebuilt: true`."""
    workspace = tmp_path / "ws"
    first = RpcClient(workspace)
    try:
        open_turn(first, "我检查抽屉。")
        narrated = first.table("narrate", call_id="t1-c1", text="抽屉里空空如也。")
    finally:
        first.close()

    turn_path = campaign_dir(workspace) / "turn.json"
    turn_path.write_text("{not valid json", encoding="utf-8")

    second = RpcClient(workspace)
    try:
        opened = second.table("open")
        assert opened["pending_turn"] is None
        assert opened["turn"] == {"number": 2, "state": "awaiting_player"}
        resume = opened["resume"]
        assert resume is not None
        assert resume["turn"] == 1
        assert resume["commit"] == narrated["commit"]
        assert resume["rebuilt"] is True

        rebuilt_turn = read_json(turn_path)
        assert rebuilt_turn["turn"] == 2
        assert rebuilt_turn["state"] == "awaiting_player"
        assert rebuilt_turn.get("pending_choice") is None

        # The rebuilt table plays on normally.
        second.table("player_input", text="我走出办公室。")
        assert second.table("status")["turn"] == 2
    finally:
        second.close()


def test_first_player_input_after_reopen_carries_resume_the_second_does_not(tmp_path):
    """§12.2: 「重开进程后的第一条 player_input 胶囊带 resume 节，之后不再带」."""
    workspace = tmp_path / "ws"
    first = RpcClient(workspace)
    try:
        open_turn(first, "我检查这扇门。")
        first.table("narrate", call_id="t1-c1", text="门锁着。")
    finally:
        first.close()

    second = RpcClient(workspace)
    try:
        opened = second.table("open")
        resume = opened["resume"]
        assert resume is not None

        first_input = second.table("player_input", text="我试着撬锁。")
        assert first_input["capsule"]["resume"] == resume

        second.table("narrate", call_id="t2-c1", text="锁被撬开了。")
        second_input = second.table("player_input", text="我推门进去。")
        assert "resume" not in second_input["capsule"]
    finally:
        second.close()
