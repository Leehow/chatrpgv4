"""Contract §29.2: `table.branch`, the host-level action that opens a new worldline from an
arbitrary committed node reachable from any `wl/*` ref, plus the one-time capsule `branched`
section that the next player_input carries.

The Keeper-facing fork (§15.3, test_worldline.py) needs an open turn and an apply batch; this
method is the table-level counterpart: no turn is opened, no dice roll, the old line keeps every
commit, and a replay of the same (campaign, commit, name) is a no-op that only ensures the active
line."""

from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path

import pytest

from conftest import (CAMPAIGN, MODULE, RpcClient, campaign_dir, create_campaign,
                      narrate, narrate_opening, read_json, read_jsonl, repo_dir)

ROOT = Path(__file__).resolve().parents[2]
TS_COMMAND = ["node", str(ROOT / "build" / "kernel" / "rpc.mjs")]


@pytest.fixture
def kernel(tmp_path: Path):
    entry = ROOT / "build" / "kernel" / "rpc.mjs"
    if not entry.is_file():
        pytest.skip("build the TypeScript kernel first (npm run build:runtime)")
    client = RpcClient(tmp_path / "ws", command=TS_COMMAND)
    yield client
    client.close()


# ---- git helpers (read only; the kernel is the only writer) ---------------------------------

def git(workspace: Path, *args: str, campaign_id: str = CAMPAIGN) -> str:
    result = subprocess.run(["git", f"--git-dir={repo_dir(workspace, campaign_id)}",
                             f"--work-tree={campaign_dir(workspace, campaign_id)}", *args],
                            capture_output=True, text=True, check=True)
    return result.stdout.strip()


def branches(workspace: Path) -> list[str]:
    refs = git(workspace, "for-each-ref", "--format=%(refname)", "refs/heads/")
    return sorted(ref for ref in refs.split() if ref)


def head_ref(workspace: Path) -> str:
    return git(workspace, "symbolic-ref", "HEAD")


def blob(workspace: Path, rev: str, path: str) -> str:
    return git(workspace, "show", f"{rev}:{path}")


def meta_of(client: RpcClient) -> dict:
    return read_json(campaign_dir(client.workspace) / "campaign.json")


def turn_json(client: RpcClient) -> dict:
    return read_json(campaign_dir(client.workspace) / "turn.json")


def turn_commit(client: RpcClient, turn: int) -> str:
    return read_json(campaign_dir(client.workspace) / "turns" / f"{turn:04d}.json")["commit"]


def capsule(client: RpcClient) -> dict:
    return client.table("capsule")


def play_to_turn(client: RpcClient, turns: int) -> None:
    create_campaign(client)
    client.table("open")
    narrate_opening(client)
    for number in range(1, turns + 1):
        client.table("player_input", text=f"第 {number} 步，我环顾四周。")
        narrate(client, f"t{number}-c1", f"你看了看四周（第 {number} 回合）。")


# ---- §29.2 happy path ------------------------------------------------------------------------

def test_branch_from_a_mid_history_commit_on_main(kernel):
    play_to_turn(kernel, 3)
    workspace = kernel.workspace
    commit = turn_commit(kernel, 2)
    main_tip = git(workspace, "rev-parse", "--short", "wl/main")

    result = kernel.table("branch", commit=commit, name="side")

    assert result["ok"] is True
    assert result["active"] == "side"
    assert result["branched_from"] == {"line": "main", "turn": 2, "commit": commit}
    line = result["line"]
    assert line["name"] == "side" and line["kind"] == "if" and line["loop"] == 0
    assert line["forked_from"] == {"line": "main", "turn": 2, "commit": commit}

    # HEAD moved onto the new branch; the old line keeps every commit it had. Branching seals
    # the dirty post-narrate files onto main first (contract: seal if needed), so main's tip may
    # advance by exactly that seal commit while the pre-branch tip stays reachable.
    assert head_ref(workspace) == "refs/heads/wl/side"
    assert branches(workspace) == ["refs/heads/wl/main", "refs/heads/wl/side"]
    sealed_tip = git(workspace, "rev-parse", "--short", "wl/main")
    git(workspace, "merge-base", "--is-ancestor", main_tip, "wl/main")
    assert json.loads(blob(workspace, "wl/main", "turns/0003.json"))["closed_by"] == "narrate"

    meta = meta_of(kernel)
    assert meta["active_worldline"] == "side"
    main = meta["worldlines"]["main"]
    assert main["status"] == "dormant" and main["last_turn"] == 3 and main["last_commit"] == sealed_tip
    side = meta["worldlines"]["side"]
    assert side["kind"] == "if" and side["loop"] == 0 and side["status"] == "active"
    assert side["forked_from"] == {"line": "main", "turn": 2, "commit": commit}
    assert side["seed"] == hashlib.sha256(f"{CAMPAIGN}:side:{commit}".encode()).hexdigest()[:16]

    # The working tree sits at the fork point: turn 2's record is the newest closed turn, and the
    # table awaits the next player input on the new line's turn 3.
    assert json.loads(blob(workspace, "wl/side", "turns/0002.json"))["closed_by"] == "narrate"
    state = turn_json(kernel)
    assert state["turn"] == 3 and state["state"] == "awaiting_player"

    # The checkpoint was rebuilt from the fork point's turn record and follows the new line.
    checkpoint = read_json(campaign_dir(workspace) / "save" / "continuation" / "latest.json")
    assert checkpoint["worldline"] == "side" and checkpoint["turn"] == 2


def test_branch_from_a_commit_that_lives_on_a_dormant_line(kernel):
    """The fork point may be reachable only from a non-active wl/* ref; forked_from names it."""
    play_to_turn(kernel, 2)
    kernel.table("player_input", text="我要换一条路走。")
    kernel.table("apply", call_id="t3-c1", effects=[{"kind": "fork", "name": "other", "mode": "if"}])
    narrate(kernel, "t3-c2", "眼前一黑，世界换了一条线。")
    kernel.table("player_input", text="继续走。")
    narrate(kernel, "t4-c1", "你继续走。")
    commit = turn_commit(kernel, 4)  # written on `other`, not on main
    workspace = kernel.workspace
    assert git(workspace, "symbolic-ref", "HEAD") == "refs/heads/wl/other"

    result = kernel.table("branch", commit=commit, name="side")
    assert result["branched_from"] == {"line": "other", "turn": 4, "commit": commit}
    meta = meta_of(kernel)
    assert meta["active_worldline"] == "side"
    assert meta["worldlines"]["other"]["status"] == "dormant"
    assert meta["worldlines"]["main"]["status"] == "dormant"
    assert branches(workspace) == ["refs/heads/wl/main", "refs/heads/wl/other", "refs/heads/wl/side"]


def test_replaying_the_same_branch_call_is_a_noop(kernel):
    play_to_turn(kernel, 2)
    commit = turn_commit(kernel, 1)
    first = kernel.table("branch", commit=commit, name="side")
    tip = git(kernel.workspace, "rev-parse", "wl/side")
    second = kernel.table("branch", commit=commit, name="side")
    assert second == first
    assert branches(kernel.workspace) == ["refs/heads/wl/main", "refs/heads/wl/side"]
    assert git(kernel.workspace, "rev-parse", "wl/side") == tip
    assert meta_of(kernel)["active_worldline"] == "side"


def test_branch_refuses_while_a_turn_is_open(kernel):
    play_to_turn(kernel, 2)
    commit = turn_commit(kernel, 1)
    kernel.table("player_input", text="我还没说完。")
    error = kernel.table_err("branch", commit=commit, name="side")
    assert error["code"] == "operation_in_progress"
    assert meta_of(kernel)["active_worldline"] == "main"
    assert branches(kernel.workspace) == ["refs/heads/wl/main"]


def test_branch_refuses_a_commit_no_line_reaches(kernel):
    play_to_turn(kernel, 2)
    error = kernel.table_err("branch", commit="0" * 40, name="side")
    assert error["code"] == "invalid_params"
    assert error["details"]["commit"] == "0" * 40
    error = kernel.table_err("branch", commit="deadbeefdeadbeef", name="side")
    assert error["code"] == "invalid_params"
    assert error["details"]["commit"] == "deadbeefdeadbeef"


def test_branch_mints_a_name_from_the_fork_turn(kernel):
    play_to_turn(kernel, 3)
    commit = turn_commit(kernel, 2)
    result = kernel.table("branch", commit=commit)
    name = result["line"]["name"]
    assert name == "if-2-1"
    assert result["active"] == name
    # A second anonymous branch from the same turn takes the next index.
    other = kernel.table("branch", commit=commit)
    assert other["line"]["name"] == "if-2-2"


def test_branch_refuses_a_name_that_collides(kernel):
    play_to_turn(kernel, 2)
    kernel.table("player_input", text="我要换一条路走。")
    kernel.table("apply", call_id="t3-c1", effects=[{"kind": "fork", "name": "side", "mode": "if"}])
    narrate(kernel, "t3-c2", "眼前一黑，世界换了一条线。")
    commit = turn_commit(kernel, 1)
    error = kernel.table_err("branch", commit=commit, name="side")
    assert error["code"] == "invalid_params"


def test_branch_lands_the_label_on_the_worldline_forked_event(kernel):
    play_to_turn(kernel, 2)
    commit = turn_commit(kernel, 1)
    kernel.table("branch", commit=commit, name="side", label="回到那个下午。")
    forked = [event for event in read_jsonl(campaign_dir(kernel.workspace) / "events.jsonl")
              if event["type"] == "worldline-forked"]
    assert len(forked) == 1
    assert forked[0]["data"]["label"] == "回到那个下午。"
    assert forked[0]["data"]["from"] == {"line": "main", "turn": 1, "commit": commit}


def test_a_replay_that_switches_back_still_announces_the_branch_once(kernel):
    play_to_turn(kernel, 2)
    first = turn_commit(kernel, 1)
    kernel.table("branch", commit=first, name="side")
    # Consume the first notice on the new line, then leave it for another branch.
    result = kernel.table("player_input", text="从这里再看看。")
    assert result["capsule"]["branched"] == {"name": "side", "from_line": "main", "from_turn": 1}
    narrate(kernel, "t2-c1", "你回到了那个下午。")
    kernel.table("branch", commit=first, name="other")
    assert meta_of(kernel)["active_worldline"] == "other"

    replay = kernel.table("branch", commit=first, name="side")
    assert replay["active"] == "side" and meta_of(kernel)["active_worldline"] == "side"
    result = kernel.table("player_input", text="我又回来了。")
    assert result["capsule"]["branched"] == {"name": "side", "from_line": "main", "from_turn": 1}
    narrate(kernel, "t3-c1", "还是那条岔路。")
    result = kernel.table("player_input", text="继续。")
    assert "branched" not in result["capsule"]


def test_the_next_player_input_capsule_carries_the_branched_section_exactly_once(kernel):
    play_to_turn(kernel, 2)
    commit = turn_commit(kernel, 1)
    kernel.table("branch", commit=commit, name="side")
    result = kernel.table("player_input", text="我从这里重新走。")
    branched = result["capsule"]["branched"]
    assert branched == {"name": "side", "from_line": "main", "from_turn": 1}
    narrate(kernel, "t2-c1", "你回到了那个下午。")
    result = kernel.table("player_input", text="再看看。")
    assert "branched" not in result["capsule"]


def test_host_switch_restores_both_lines_and_preserves_their_turns(kernel):
    play_to_turn(kernel, 3)
    original = turn_commit(kernel, 2)
    kernel.table('branch', commit=original, name='alternate')
    assert kernel.table('switch', line='main')['active'] == 'main'
    assert head_ref(kernel.workspace) == 'refs/heads/wl/main'
    assert kernel.table('switch', line='alternate')['active'] == 'alternate'
    assert head_ref(kernel.workspace) == 'refs/heads/wl/alternate'
    assert kernel.table('switch', line='alternate')['ok'] is True
    assert meta_of(kernel)['worldlines']['main']['status'] == 'dormant'
    assert json.loads(blob(kernel.workspace, 'wl/main', 'turns/0003.json'))['closed_by'] == 'narrate'


def test_host_switch_refuses_during_a_turn_without_changing_the_active_line(kernel):
    play_to_turn(kernel, 2)
    kernel.table('branch', commit=turn_commit(kernel, 1), name='alternate')
    kernel.table('player_input', text='I inspect the door.')
    try:
        kernel.table('switch', line='main')
    except Exception as error:
        assert 'operation_in_progress' in str(error)
    else:
        raise AssertionError('An open turn must prevent switching')
    assert head_ref(kernel.workspace) == 'refs/heads/wl/alternate'
