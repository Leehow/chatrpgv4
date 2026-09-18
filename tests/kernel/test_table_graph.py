"""Contract §29.1: `table.graph`, the host-facing full-graph read behind the memory-line panel.

Every commit reachable from any `wl/*` ref comes back classified (setup / turn / worldline /
merge) with its game clock, the calendar projection the capsule machine computes, and the
lines' tips. The read never writes: a cold process (no open table) and a live one answer the
same bytes of history."""

from __future__ import annotations

import json
import shutil
import subprocess
from datetime import datetime, timedelta
from pathlib import Path

import pytest

from conftest import CAMPAIGN, CONTENT_DIR, RpcClient, campaign_dir, narrate, narrate_opening, read_json, repo_dir
from rpc_support import snapshot

ROOT = Path(__file__).resolve().parents[2]
TS_COMMAND = ["node", str(ROOT / "build/kernel/rpc.mjs")]

# the-haunting declares start_clock.local_datetime 1920-10-12T10:00:00; the kernel projects it
# as a UTC instant, so the panel's calendar fields are this base plus the node's minutes.
CLOCK_BASE = datetime(1920, 10, 12, 10, 0)


def expected_when(minutes: int) -> dict:
    at = CLOCK_BASE + timedelta(minutes=minutes)
    return {"y": at.year, "mo": at.month, "d": at.day, "hh": at.hour, "mm": at.minute}


def ts_client(workspace: Path, env: dict | None = None) -> RpcClient:
    return RpcClient(workspace, command=TS_COMMAND, env=env)


def git(workspace: Path, *args: str) -> str:
    result = subprocess.run(["git", "-c", "user.name=coc-test", "-c", "user.email=test@coc.invalid",
                             f"--git-dir={repo_dir(workspace)}", f"--work-tree={campaign_dir(workspace)}", *args],
                            capture_output=True, text=True, check=True)
    return result.stdout.strip()


def create(client: RpcClient) -> None:
    client.ok("campaign.create", {"id": CAMPAIGN, "module": "the-haunting", "pregen": "thomas-hayes",
                                  "play_language": "en"})


def play(client: RpcClient, turns: int) -> None:
    """Create, open, narrate the opening and close `turns` ordinary turns on the active line."""
    create(client)
    client.table("open")
    narrate_opening(client, "The case begins.\n\nA letter waits on the desk.")
    for number in range(1, turns + 1):
        client.table("player_input", text=f"Turn {number}: I look around.")
        narrate(client, f"t{number}-c1", f"You look around the room, turn {number}.")


def fork(client: RpcClient, turn: int, name: str, from_turn: int) -> None:
    """During the open `turn`, fork `name` off `from_turn`'s commit and close the turn."""
    client.table("player_input", text="I take the other road.")
    client.table("apply", call_id=f"t{turn}-c1",
                 effects=[{"kind": "fork", "name": name, "mode": "if", "from_turn": from_turn}])
    narrate(client, f"t{turn}-c2", "The world shifts underfoot.")


def graph(client: RpcClient, **params) -> dict:
    return client.table("graph", **params)


def by_sha(result: dict) -> dict:
    return {node["sha"]: node for node in result["nodes"]}


def line_refs(workspace: Path) -> dict[str, str]:
    """Actual wl/* tips, as short shas (what the kernel reports)."""
    refs = git(workspace, "for-each-ref", "--format=%(objectname:short) %(refname:strip=3)", "refs/heads/wl/")
    return {name: sha for sha, name in (line.split() for line in refs.splitlines())}


def turn_clock(workspace: Path, turn: int) -> int:
    return read_json(campaign_dir(workspace) / "turns" / f"{turn:04d}.json")["world"]["clock"]["minutes"]


@pytest.fixture
def client(tmp_path: Path):
    session = ts_client(tmp_path / "ws")
    yield session
    session.close()


# ---- result shape and the setup commits ------------------------------------------------------


def test_shape_and_setup_before_opening(client: RpcClient):
    create(client)
    client.table("open")
    result = graph(client)
    assert result["campaign"] == CAMPAIGN
    assert result["active"] == "main"
    assert result["truncated"] is False
    main = [line for line in result["lines"] if line["name"] == "main"]
    assert len(main) == 1 and main[0]["kind"] == "main" and main[0]["status"] == "active"
    assert main[0]["forked_from"] is None and main[0]["parents"] == []
    assert len(result["nodes"]) == 1
    node = result["nodes"][0]
    assert node["kind"] == "setup" and node["turn"] is None and node["parents"] == []
    assert node["clock"] == 0
    assert node["when"] == expected_when(0)
    assert node["tip_of"] == ["main"]
    assert isinstance(node["at"], str) and node["at"]
    assert node["title"]


# ---- turn nodes carry the turn record's clock, projected by the capsule machine ---------------


def test_turn_nodes_clock_and_projection(client: RpcClient):
    play(client, 2)
    result = graph(client)
    nodes = by_sha(result)
    turns = {node["turn"]: node for node in result["nodes"] if node["kind"] == "turn"}
    assert set(turns) == {0, 1, 2}
    for turn, node in turns.items():
        clock = turn_clock(client.workspace, turn)
        assert node["clock"] == clock
        assert node["when"] == expected_when(clock)
        assert not node["title"].startswith(f"turn {turn}")
        assert node["title"]
    assert all(node["kind"] == "setup" for node in result["nodes"] if node["turn"] is None)
    # The graph is closed: every parent edge lands on a reported node.
    assert all(parent in nodes for node in result["nodes"] for parent in node["parents"])
    # Newest first: the tip precedes the root, and a commit never precedes its own parent.
    order = [node["sha"] for node in result["nodes"]]
    for node in result["nodes"]:
        for parent in node["parents"]:
            assert order.index(node["sha"]) < order.index(parent)


@pytest.fixture(params=[None, "23:30"])
def undated_client(tmp_path: Path, request):
    content = tmp_path / "content"
    shutil.copytree(CONTENT_DIR, content)

    def remove_date(value):
        if isinstance(value, dict):
            if "start_clock" in value:
                value.pop("start_clock")
                value.pop("start_time", None)
                if request.param is not None:
                    value["start_time"] = request.param
            for child in value.values():
                remove_date(child)
        elif isinstance(value, list):
            for child in value:
                remove_date(child)

    path = content / "starters/the-haunting/module-graph.json"
    data = json.loads(path.read_text())
    remove_date(data)
    path.write_text(json.dumps(data))
    session = RpcClient(tmp_path / "ws", content=content, command=TS_COMMAND)
    yield session, request.param
    session.close()


def test_undated_nodes_share_the_view_day_clock(undated_client):
    client, start_time = undated_client
    play(client, 0)
    client.table("player_input", text="I wait for a while.")
    client.table("apply", call_id="t1-c1", effects=[{"kind": "time", "minutes": 90}])
    narrate(client, "t1-c2", "The wait ends.")
    clock = client.table("view")["clock"]
    node = next(node for node in graph(client)["nodes"] if node["turn"] == 1)
    assert node["clock"] == clock["minutes"] == 90
    expected = {"day": 1, "hh": 10, "mm": 30} if start_time is None else {"day": 2, "hh": 1, "mm": 0}
    assert node["when"] == expected
    assert node["when"] == {key: int(clock[key]) for key in ("day", "hh", "mm")}


def test_pinned_nodes_use_their_own_committed_anchor(undated_client):
    client, start_time = undated_client
    play(client, 0)
    before = by_sha(graph(client))
    client.table("player_input", text="I wait for a while.")
    client.table("apply", call_id="t1-c1", effects=[
        {"kind": "clock", "local_datetime": f"1975-07-12T{start_time or '09:00'}",
         "why": "The opening date is now established."},
        {"kind": "time", "minutes": 90},
    ])
    narrate(client, "t1-c2", "The wait ends on the established date.")
    nodes = by_sha(graph(client))
    node = next(node for node in nodes.values() if node["turn"] == 1)
    at = datetime.fromisoformat(client.table("view")["clock"]["at"])
    assert node["clock"] == 90
    expected = {"y": 1975, "mo": 7, "d": 12, "hh": 10, "mm": 30} if start_time is None else {"y": 1975, "mo": 7, "d": 13, "hh": 1, "mm": 0}
    assert node["when"] == expected
    assert node["when"] == {"y": at.year, "mo": at.month, "d": at.day, "hh": at.hour, "mm": at.minute}
    assert all(nodes[sha]["when"] == old["when"] for sha, old in before.items())


# ---- a forked line: registry forked_from, fork edges through parents, tips on both lines ------


def test_fork_lines_edges_and_tips(client: RpcClient):
    play(client, 2)
    fork(client, 3, "if-road", from_turn=2)
    client.table("player_input", text="I keep walking.")
    narrate(client, "t4-c1", "The new road holds.")
    result = graph(client)
    nodes = by_sha(result)
    names = {line["name"] for line in result["lines"]}
    assert names == {"main", "if-road"}
    assert result["active"] == "if-road"
    forked = next(line for line in result["lines"] if line["name"] == "if-road")
    assert forked["kind"] == "if" and forked["forked_from"]["line"] == "main" and forked["forked_from"]["turn"] == 2
    fork_commit = forked["forked_from"]["commit"]
    assert fork_commit in nodes
    # The fork edge is mechanical: the landing commit on the new line names the fork point as parent.
    children = [node for node in result["nodes"] if fork_commit in node["parents"]]
    assert children and any(node["kind"] == "worldline" for node in children)
    # Both refs' tips are reported, on the right nodes.
    refs = line_refs(client.workspace)
    assert set(refs) == {"main", "if-road"}
    for name, sha in refs.items():
        assert sha in nodes and name in nodes[sha]["tip_of"]


# ---- truncation keeps every line's tip ---------------------------------------------------------


def test_truncation_retains_tips(client: RpcClient):
    play(client, 3)
    full = graph(client)
    assert full["truncated"] is False
    cut = graph(client, max_nodes=2)
    assert cut["truncated"] is True
    assert len(cut["nodes"]) >= 2
    tips = set(line_refs(client.workspace).values())
    assert tips <= {node["sha"] for node in cut["nodes"]}
    assert {node["sha"] for node in cut["nodes"]} <= {node["sha"] for node in full["nodes"]}


def test_max_nodes_validation_and_cap(client: RpcClient):
    play(client, 1)
    assert client.table_err("graph", max_nodes=0)["code"] == "invalid_params"
    assert client.table_err("graph", max_nodes="many")["code"] == "invalid_params"
    capped = graph(client, max_nodes=999999)  # clamped to the contract's 1000, not an error
    assert capped["truncated"] is False


# ---- merge and worldline kinds, read by a cold process -----------------------------------------


def test_merge_and_worldline_kinds_cold(client: RpcClient):
    play(client, 1)
    workspace = client.workspace
    side_commit_message = "worldline side: sealed at turn 1"
    git(workspace, "branch", "wl/side", "wl/main")
    git(workspace, "checkout", "--quiet", "--force", "wl/side")
    (campaign_dir(workspace) / "side-note.txt").write_text("kept only on the side line\n", encoding="utf-8")
    git(workspace, "add", "-A")
    git(workspace, "commit", "--quiet", "-m", side_commit_message)
    git(workspace, "checkout", "--quiet", "--force", "wl/main")
    git(workspace, "merge", "-s", "ours", "--no-commit", "--no-ff", "wl/side")
    git(workspace, "commit", "--quiet", "-m", "worldline main: merged side")
    # A cold process — it never opened a table — answers from the same history.
    cold = RpcClient(workspace, command=TS_COMMAND)
    try:
        result = cold.table("graph")
    finally:
        cold.close()
    nodes = by_sha(result)
    merges = [node for node in result["nodes"] if node["kind"] == "merge"]
    assert len(merges) == 1 and len(merges[0]["parents"]) == 2
    assert "main" in merges[0]["tip_of"]
    side = next(node for node in result["nodes"] if node["title"] == side_commit_message)
    assert side["kind"] == "worldline" and side["turn"] is None
    assert "side" in side["tip_of"]
    assert side["clock"] == turn_clock(workspace, 1)


# ---- the read never writes ----------------------------------------------------------------------


def test_read_only(client: RpcClient):
    play(client, 2)
    before = snapshot(client.workspace)
    graph(client)
    graph(client, max_nodes=3)
    assert snapshot(client.workspace) == before


def test_unknown_campaign(client: RpcClient):
    assert client.table_err("graph")["code"] == "campaign_not_found"
