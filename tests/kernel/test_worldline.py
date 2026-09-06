"""Contract §15 (#23), first half: storage and identity (§15.1), the module declarations a
time loop needs (§15.2), `apply fork` / `apply switch` (§15.3) and the capsule, Director
signals and resume of §15.6.

The old tree's behaviour list is the checklist: a fork does not disturb the line it came
from, switching moves only the active line, a replayed call forks once, and a failed state
write rolls the reference back. `merge`, the confluence report (§15.4) and the cross-line
memory projection (§15.5) are the second half and are only asserted to be refused."""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

from conftest import (CAMPAIGN, CONTENT_DIR, MODULE, RpcClient, campaign_dir, create_campaign,
                      narrate, narrate_opening, read_json, read_jsonl, repo_dir)

BRIEFING = "commission-briefing"
HOUSE = "corbitt-house-ground"
KEEPER_NPC = "npc-steven-knott"
PERSISTENT_CLUE = "clue-knott-keys"
FORGOTTEN_CLUE = "clue-knott-commission"


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


def world_of(client: RpcClient) -> dict:
    return read_json(campaign_dir(client.workspace) / "world.json")


# ---- a book that declares a loop (§15.2) ----------------------------------------------------

def _mirror(source: Path, target: Path, skip: set[str]) -> None:
    target.mkdir(parents=True, exist_ok=True)
    for child in source.iterdir():
        if child.name not in skip:
            os.symlink(child, target / child.name)


def loop_content(tmp_path: Path, *, reset: dict | None = None, persists: bool = True,
                 remembers: bool = True) -> Path:
    """The shipped content with one file replaced: the starter's graph, given a `resets-to`
    from the house back to the briefing, one clue that survives a rewind, an NPC who
    remembers, and `structure_type: time_loop` on the module node."""
    root = tmp_path / "content"
    _mirror(CONTENT_DIR, root, {"starters"})
    starters = root / "starters"
    _mirror(CONTENT_DIR / "starters", starters, {MODULE})
    book = starters / MODULE
    _mirror(CONTENT_DIR / "starters" / MODULE, book, {"module-graph.json"})
    graph = json.loads((CONTENT_DIR / "starters" / MODULE / "module-graph.json").read_text(encoding="utf-8"))
    relations = graph["relations"]
    relations.append({"relation_id": "relation-resets-to-1", "relation_kind": "resets-to",
                      "from_node_id": f"scene-{HOUSE}", "to_node_id": f"scene-{BRIEFING}",
                      "properties": {"reset": reset or {"clock": "anchor", "investigators": "anchor"}}})
    if persists:
        relations.append({"relation_id": "relation-persists-1", "relation_kind": "persists-across-loop",
                          "from_node_id": PERSISTENT_CLUE, "to_node_id": "module-the-haunting",
                          "properties": {}})
    for node in graph["nodes"]:
        if node["node_id"] == "module-the-haunting":
            # A module node declares itself in `module-meta.json`, never in a `record`.
            for document in node["properties"]["runtime_projection"]["documents"]:
                if document["filename"] == "module-meta.json":
                    document["root"]["structure_type"] = "time_loop"
        if remembers and node["node_id"] == KEEPER_NPC:
            node["properties"]["runtime_projection"]["record"]["remembers_across_loops"] = True
    (book / "module-graph.json").write_text(json.dumps(graph, ensure_ascii=False), encoding="utf-8")
    return root


def client_for(tmp_path: Path, name: str = "ws", content: Path | None = None,
               env: dict | None = None) -> RpcClient:
    return RpcClient(tmp_path / name, content=content, env=env)


# ---- turn shortcuts -------------------------------------------------------------------------

def play_to_turn(client: RpcClient, turns: int) -> None:
    """Open the table, narrate the opening and close `turns` ordinary turns."""
    create_campaign(client)
    client.table("open")
    narrate_opening(client)
    for number in range(1, turns + 1):
        client.table("player_input", text=f"第 {number} 步，我环顾四周。")
        narrate(client, f"t{number}-c1", f"你看了看四周（第 {number} 回合）。")


def fork(client: RpcClient, turn: int, name: str, mode: str = "if", **extra) -> dict:
    client.table("player_input", text="我要换一条路走。")
    result = client.table("apply", call_id=f"t{turn}-c1",
                          effects=[{"kind": "fork", "name": name, "mode": mode, **extra}])
    narrate(client, f"t{turn}-c2", "眼前一黑，世界换了一条线。")
    return result


def switch(client: RpcClient, turn: int, line: str) -> dict:
    client.table("player_input", text="我回到原来那条路。")
    result = client.table("apply", call_id=f"t{turn}-c1", effects=[{"kind": "switch", "line": line}])
    narrate(client, f"t{turn}-c2", "你回到了原来的那一条线。")
    return result


# ---- §15.1 storage and identity --------------------------------------------------------------

def test_a_new_campaign_is_born_on_wl_main(kernel):
    create_campaign(kernel)
    meta = meta_of(kernel)
    assert meta["active_worldline"] == "main"
    main = meta["worldlines"]["main"]
    assert main["kind"] == "main" and main["loop"] == 0 and main["forked_from"] is None
    assert main["status"] == "active" and len(main["seed"]) == 16
    assert head_ref(kernel.workspace) == "refs/heads/wl/main"
    assert branches(kernel.workspace) == ["refs/heads/wl/main"]


def test_the_seed_is_the_campaign_the_line_and_the_fork_point(kernel, tmp_path):
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "kernel"))
    from coc.worldline import line_seed
    assert line_seed("c1", "main", None) == line_seed("c1", "main", "")
    assert line_seed("c1", "main", None) != line_seed("c2", "main", None)
    assert line_seed("c1", "side", "abc1234") != line_seed("c1", "side", "def5678")


def test_a_campaign_without_worldlines_is_adopted_as_main_without_rewriting_a_commit(kernel):
    """§15.1: a campaign made before worldlines existed keeps every commit; only HEAD moves."""
    create_campaign(kernel)
    workspace = kernel.workspace
    before = git(workspace, "rev-parse", "HEAD")
    # Undo the registry and the branch by hand, as an older kernel would have left them.
    path = campaign_dir(workspace) / "campaign.json"
    meta = read_json(path)
    meta.pop("active_worldline")
    meta.pop("worldlines")
    path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    git(workspace, "symbolic-ref", "HEAD", "refs/heads/legacy")
    git(workspace, "update-ref", "refs/heads/legacy", before)
    git(workspace, "update-ref", "-d", "refs/heads/wl/main")

    kernel.table("open")
    assert head_ref(workspace) == "refs/heads/wl/main"
    assert git(workspace, "rev-parse", "HEAD") == before
    assert meta_of(kernel)["active_worldline"] == "main"
    assert meta_of(kernel)["worldlines"]["main"]["kind"] == "main"


# ---- §15.3 fork ------------------------------------------------------------------------------

def test_forking_moves_the_table_and_leaves_the_line_it_came_from_whole(kernel):
    play_to_turn(kernel, 2)
    staged = fork(kernel, 3, "side")
    assert staged["worldline"] == {"operation": "fork", "line": "side", "mode": "if", "loop": 0,
                                   "when": "after this turn's narrate commits"}
    workspace = kernel.workspace
    assert head_ref(workspace) == "refs/heads/wl/side"
    assert branches(workspace) == ["refs/heads/wl/main", "refs/heads/wl/side"]

    meta = meta_of(kernel)
    assert meta["active_worldline"] == "side"
    assert meta["worldlines"]["main"]["status"] == "dormant"
    assert meta["worldlines"]["main"]["last_turn"] == 3
    side = meta["worldlines"]["side"]
    assert side["kind"] == "if" and side["loop"] == 0 and side["status"] == "active"
    assert side["forked_from"]["line"] == "main" and side["forked_from"]["turn"] == 3
    assert side["seed"] != meta["worldlines"]["main"]["seed"]
    # §15.1: the turn number continues -- forked on turn 3, the new line opens turn 4.
    assert turn_json(kernel)["turn"] == 4 and turn_json(kernel)["state"] == "awaiting_player"
    # The line it came from still holds every turn it played, unchanged.
    assert json.loads(blob(workspace, "wl/main", "turns/0003.json"))["closed_by"] == "narrate"
    assert json.loads(blob(workspace, "wl/main", "campaign.json"))["id"] == CAMPAIGN


def test_the_fork_happens_after_the_commit_not_during_the_batch(kernel):
    play_to_turn(kernel, 1)
    kernel.table("player_input", text="我要换一条路走。")
    kernel.table("apply", call_id="t2-c1", effects=[{"kind": "fork", "name": "side", "mode": "if"}])
    # Staged only: the batch wrote a receipt, nothing in git has moved yet.
    assert head_ref(kernel.workspace) == "refs/heads/wl/main"
    assert branches(kernel.workspace) == ["refs/heads/wl/main"]
    assert [r["id"] for r in kernel.table("status")["receipts"]] == ["fork:side-t2"]
    narrate(kernel, "t2-c2", "你眨了眨眼。")
    assert head_ref(kernel.workspace) == "refs/heads/wl/side"


def test_the_fork_receipt_projects_as_a_worldline_mechanics_row(kernel):
    play_to_turn(kernel, 1)
    kernel.table("player_input", text="我要换一条路走。")
    kernel.table("apply", call_id="t2-c1",
                 effects=[{"kind": "fork", "name": "side", "mode": "if", "label": "另一种可能"}])
    delivered = narrate(kernel, "t2-c2", "你眨了眨眼。")
    row = [m for m in delivered["mechanics"] if m["kind"] == "worldline"]
    assert row == [{"kind": "worldline", "receipt": "fork:side-t2", "operation": "fork", "line": "side",
                    "mode": "if", "loop": 0, "from_line": "main", "from_turn": 2, "label": "另一种可能"}]
    # §16: the kernel renders nothing; the keeper's text is delivered verbatim.
    assert delivered["rendered_text"] == "你眨了眨眼。"


def test_a_fork_from_an_earlier_turn_rewinds_the_tree_to_that_turn(kernel):
    play_to_turn(kernel, 3)
    scene_at_three = world_of(kernel)["active_scene"]
    kernel.table("player_input", text="我走去柯比特老宅。")
    kernel.table("apply", call_id="t4-c1", effects=[{"kind": "move", "to": HOUSE}])
    narrate(kernel, "t4-c2", "你走到了老宅门前。")
    assert world_of(kernel)["active_scene"] == HOUSE

    fork(kernel, 5, "rewound", from_turn=2)
    assert meta_of(kernel)["worldlines"]["rewound"]["forked_from"]["turn"] == 2
    # The tree is turn 2's: the move never happened on this line, and turn 3 is next.
    assert world_of(kernel)["active_scene"] == scene_at_three
    assert turn_json(kernel)["turn"] == 3
    assert not (campaign_dir(kernel.workspace) / "turns" / "0004.json").exists()
    # And the line it left keeps turn 4 and turn 5.
    assert json.loads(blob(kernel.workspace, "wl/main", "turns/0004.json"))["turn"] == 4


def test_a_repeated_call_id_forks_once(kernel):
    play_to_turn(kernel, 1)
    kernel.table("player_input", text="我要换一条路走。")
    effects = [{"kind": "fork", "name": "side", "mode": "if"}]
    first = kernel.table("apply", call_id="t2-c1", effects=effects)
    again = kernel.table("apply", call_id="t2-c1", effects=effects)
    assert again["replayed"] is True and again["receipts"] == first["receipts"]
    narrate(kernel, "t2-c2", "你眨了眨眼。")
    assert branches(kernel.workspace) == ["refs/heads/wl/main", "refs/heads/wl/side"]
    assert [r["id"] for r in read_json(campaign_dir(kernel.workspace) / "turns" / "0002.json")["receipts"]] \
        == ["fork:side-t2"]


# ---- §15.3 switch ----------------------------------------------------------------------------

def test_switching_moves_only_the_active_line(kernel):
    play_to_turn(kernel, 2)
    fork(kernel, 3, "side")
    kernel.table("player_input", text="我在这条线上多走一步。")
    kernel.table("apply", call_id="t4-c1", effects=[{"kind": "clue", "clue": "knott-keys"}])
    narrate(kernel, "t4-c2", "你在这条线上拿到了钥匙。")
    assert "knott-keys" in world_of(kernel)["discovered_clues"]

    switch(kernel, 5, "main")
    workspace = kernel.workspace
    assert head_ref(workspace) == "refs/heads/wl/main"
    meta = meta_of(kernel)
    assert meta["active_worldline"] == "main"
    assert meta["worldlines"]["main"]["status"] == "active"
    assert meta["worldlines"]["side"]["status"] == "dormant" and meta["worldlines"]["side"]["last_turn"] == 5
    # main is where it was: the side line's clue and its turns are not here.
    assert "knott-keys" not in world_of(kernel)["discovered_clues"]
    assert not (campaign_dir(workspace) / "turns" / "0004.json").exists()
    assert turn_json(kernel)["turn"] == 4
    # ...but the side line still holds all of it.
    assert json.loads(blob(workspace, "wl/side", "turns/0004.json"))["turn"] == 4
    assert "knott-keys" in json.loads(blob(workspace, "wl/side", "world.json"))["discovered_clues"]
    types = [e["type"] for e in read_jsonl(campaign_dir(workspace) / "events.jsonl")]
    assert "worldline-switched" in types


def test_switching_to_an_unknown_or_current_line_is_refused(kernel):
    play_to_turn(kernel, 1)
    kernel.table("player_input", text="我想换线。")
    missing = kernel.table_err("apply", call_id="t2-c1", effects=[{"kind": "switch", "line": "nowhere"}])
    assert missing["code"] == "invalid_params" and "nowhere" in missing["message"]
    same = kernel.table_err("apply", call_id="t2-c2", effects=[{"kind": "switch", "line": "main"}])
    assert same["code"] == "invalid_params" and "already" in same["message"]
    assert branches(kernel.workspace) == ["refs/heads/wl/main"]


def test_a_name_another_line_already_has_is_refused_before_anything_is_written(kernel):
    play_to_turn(kernel, 2)
    fork(kernel, 3, "side")
    kernel.table("player_input", text="再来一条同名的。")
    error = kernel.table_err("apply", call_id="t4-c1", effects=[{"kind": "fork", "name": "side", "mode": "if"}])
    assert error["code"] == "invalid_params" and "already exists" in error["message"]
    assert error["details"]["lines"] == ["main", "side"]
    assert kernel.table("status")["receipts"] == []


# ---- §15.3 the two batch rules ----------------------------------------------------------------

def test_a_worldline_effect_must_be_the_last_of_its_batch(kernel):
    play_to_turn(kernel, 1)
    kernel.table("player_input", text="我要换一条路走。")
    error = kernel.table_err("apply", call_id="t2-c1",
                             effects=[{"kind": "fork", "name": "side", "mode": "if"},
                                      {"kind": "time", "minutes": 5}])
    assert error["code"] == "invalid_params" and "last effect" in error["message"]
    assert branches(kernel.workspace) == ["refs/heads/wl/main"]
    assert kernel.table("status")["receipts"] == []


def test_a_turn_carries_at_most_one_worldline_effect(kernel):
    play_to_turn(kernel, 1)
    kernel.table("player_input", text="我要换一条路走。")
    kernel.table("apply", call_id="t2-c1", effects=[{"kind": "fork", "name": "side", "mode": "if"}])
    error = kernel.table_err("apply", call_id="t2-c2", effects=[{"kind": "fork", "name": "other", "mode": "if"}])
    assert error["code"] == "invalid_params" and "at most one" in error["message"]
    same_batch = kernel.table_err("apply", call_id="t2-c3",
                                  effects=[{"kind": "switch", "line": "main"}])
    assert same_batch["code"] == "invalid_params"


def test_a_turn_that_changes_the_line_cannot_be_closed_by_ask(kernel):
    play_to_turn(kernel, 1)
    kernel.table("player_input", text="我要换一条路走。")
    kernel.table("apply", call_id="t2-c1", effects=[{"kind": "fork", "name": "side", "mode": "if"}])
    error = kernel.table_err("ask", call_id="t2-c2", prompt="要走哪条路？", options=["左", "右"], text="你眨了眨眼。")
    assert error["code"] == "invalid_params" and "ask" in error["message"]
    assert branches(kernel.workspace) == ["refs/heads/wl/main"]


def test_merge_is_reserved(kernel):
    play_to_turn(kernel, 1)
    kernel.table("player_input", text="我想把两条线并起来。")
    error = kernel.table_err("apply", call_id="t2-c1",
                             effects=[{"kind": "merge", "name": "joined", "lines": ["main"]}])
    assert error["code"] == "not_implemented"


# ---- §15.3 rollback ---------------------------------------------------------------------------

def test_a_failed_transition_rolls_the_reference_back_and_keeps_the_turn(kernel):
    """The branch the fork would create is taken out from under it between the batch and
    the commit. The turn still commits; the line does not move; nothing is lost."""
    play_to_turn(kernel, 2)
    kernel.table("player_input", text="我要换一条路走。")
    kernel.table("apply", call_id="t3-c1", effects=[{"kind": "fork", "name": "side", "mode": "if"}])
    workspace = kernel.workspace
    git(workspace, "update-ref", "refs/heads/wl/side", git(workspace, "rev-parse", "HEAD"))
    delivered = narrate(kernel, "t3-c2", "你眨了眨眼。")

    assert delivered["commit"] and "worldline" not in delivered
    assert head_ref(workspace) == "refs/heads/wl/main"
    meta = meta_of(kernel)
    assert meta["active_worldline"] == "main"
    assert "side" not in meta["worldlines"]
    assert meta["worldlines"]["main"]["status"] == "active"
    telemetry = [r for r in read_jsonl(campaign_dir(workspace) / "telemetry.jsonl") if r.get("lane") == "worldline"]
    assert telemetry and telemetry[-1]["ok"] is False
    # The table still plays: the turn is committed and the next one opens on main.
    assert read_json(campaign_dir(workspace) / "turns" / "0003.json")["commit"]
    assert kernel.table("player_input", text="我继续走。")["turn"] == 4


# ---- §15.1 per-line dice -----------------------------------------------------------------------

def test_the_same_action_on_two_lines_does_not_roll_the_same_numbers(kernel):
    action = {"intent": "investigate", "goal": "找出房间里藏着的东西", "method": "用侦查扫视桌面和墙角"}

    def three_rolls(turn: int) -> list[int]:
        kernel.table("player_input", text="我仔细看看。")
        return [kernel.table("resolve", call_id=f"t{turn}-c{n}", action=action)["outcome"]["roll"]
                for n in (1, 2, 3)]

    play_to_turn(kernel, 2)
    fork(kernel, 3, "side")
    # Both lines now open turn 4; the only difference is which line it is.
    on_side = three_rolls(4)
    kernel.table("apply", call_id="t4-c4", effects=[{"kind": "switch", "line": "main"}])
    narrate(kernel, "t4-c5", "你回到了原来的那一条线。")
    on_main = three_rolls(4)
    assert on_side != on_main


def test_an_explicit_seed_still_pins_the_dice(tmp_path):
    """§15.1: COC_KERNEL_SEED overrides the per-line seeding entirely, so the seeded tests
    of every other slice keep their one sequence."""
    action = {"intent": "investigate", "goal": "找出房间里藏着的东西", "method": "用侦查扫视桌面和墙角"}
    rolls = []
    for name in ("ws-a", "ws-b"):
        client = client_for(tmp_path, name, env={"COC_KERNEL_SEED": "7"})
        try:
            play_to_turn(client, 1)
            client.table("player_input", text="我仔细看看。")
            rolls.append(client.table("resolve", call_id="t2-c1", action=action)["outcome"]["roll"])
        finally:
            client.close()
    assert rolls[0] == rolls[1]


# ---- §15.2 / §15.6 the loop ---------------------------------------------------------------------

def test_a_module_without_a_reset_refuses_a_loop_fork_but_never_an_if(kernel):
    play_to_turn(kernel, 1)
    kernel.table("player_input", text="我想回到早上。")
    error = kernel.table_err("apply", call_id="t2-c1", effects=[{"kind": "fork", "name": "loop-1", "mode": "loop"}])
    assert error["code"] == "invalid_params"
    assert "no loop anchor" in error["message"] and "mode: if" in error["fix"]
    kernel.table("apply", call_id="t2-c2", effects=[{"kind": "fork", "name": "loop-1", "mode": "if"}])
    narrate(kernel, "t2-c3", "你眨了眨眼。")
    assert meta_of(kernel)["active_worldline"] == "loop-1"


def test_a_loop_fork_rewinds_to_the_anchor_and_keeps_what_persists(tmp_path):
    client = client_for(tmp_path, content=loop_content(tmp_path))
    try:
        play_to_turn(client, 1)
        client.table("player_input", text="我拿走钥匙，也听完了委托。")
        client.table("apply", call_id="t2-c1",
                     effects=[{"kind": "clue", "clue": "knott-keys"}, {"kind": "clue", "clue": "knott-commission"}])
        narrate(client, "t2-c2", "你收好钥匙，也记下了委托。")
        client.table("player_input", text="我们去柯比特老宅。")
        client.table("apply", call_id="t3-c1", effects=[{"kind": "move", "to": HOUSE}])
        narrate(client, "t3-c2", "你们走到了老宅门前。")
        assert world_of(client)["active_scene"] == HOUSE

        client.table("player_input", text="我要回到今天早上。")
        client.table("apply", call_id="t4-c1", effects=[{"kind": "fork", "name": "loop-2", "mode": "loop"}])
        narrate(client, "t4-c2", "你眼前一黑，又回到了诺特的办公室。")

        meta = meta_of(client)
        line = meta["worldlines"]["loop-2"]
        assert line["kind"] == "loop" and line["loop"] == 1
        world = world_of(client)
        assert world["active_scene"] == BRIEFING
        # §15.2: only the clue the book declared persistent is still discovered.
        assert world["discovered_clues"] == ["knott-keys"]
        assert turn_json(client)["turn"] == 5
        subjects = git(client.workspace, "log", "--format=%s", "-3").splitlines()
        assert subjects[0] == "loop 1 reset"
        # The anchor snapshot is kept, so the next rewind returns to the same morning.
        anchor = read_json(campaign_dir(client.workspace) / "save" / "worldlines" / "anchor.json")
        assert anchor["scene"] == BRIEFING and anchor["turn"] == 0
        assert anchor["world"]["discovered_clues"] == []
        # And the line it came from still stands at the house with both clues.
        left = json.loads(blob(client.workspace, "wl/main", "world.json"))
        assert left["active_scene"] == HOUSE and sorted(left["discovered_clues"]) == \
            ["knott-commission", "knott-keys"]
    finally:
        client.close()


def test_the_capsule_carries_the_line_the_anchor_and_who_remembers(tmp_path):
    client = client_for(tmp_path, content=loop_content(tmp_path))
    try:
        play_to_turn(client, 1)
        capsule = client.table("player_input", text="我看看诺特。")["capsule"]
        section = capsule["worldlines"]
        assert section["line"] == "main" and section["kind"] == "main" and section["loop"] == 0
        assert section["anchor"] == {"scene": BRIEFING, "since_turn": 0}
        assert section["persisted"] == ["Corbitt house keys"] or section["persisted"]
        assert "Steven Knott" in " ".join(section["remembers"])
        assert section["echoes_here"] == 0 and section["echoes"] == [] and section["previous_loop"] == []
        assert section["lines"] == [{"name": "main", "kind": "main", "loop": 0, "last_turn": None,
                                     "status": "active"}]
        # The briefing is not a reset endpoint, so nothing here can be rewound yet.
        assert section["loop_available"] is False
        assert not [o for o in capsule["obligations"] if o["kind"] == "loop"]
        because = " ".join(capsule["director"]["because"])
        assert "loop_count = 0" in because and "loop_available = False" in because
        assert "echoes_here = 0" in because
    finally:
        client.close()


def test_the_house_is_where_the_loop_can_be_rewound(tmp_path):
    client = client_for(tmp_path, content=loop_content(tmp_path))
    try:
        play_to_turn(client, 1)
        client.table("player_input", text="我们去柯比特老宅。")
        client.table("apply", call_id="t2-c1", effects=[{"kind": "move", "to": HOUSE}])
        narrate(client, "t2-c2", "你们走到了老宅门前。")
        capsule = client.table("player_input", text="我站在门口想事情。")["capsule"]
        assert capsule["worldlines"]["loop_available"] is True
        loop_rows = [o for o in capsule["obligations"] if o["kind"] == "loop"]
        assert loop_rows and loop_rows[0]["who"] == "keeper"
        assert "loop_available = True" in " ".join(capsule["director"]["because"])
    finally:
        client.close()


def test_a_reset_that_keeps_the_clock_keeps_it(tmp_path):
    content = loop_content(tmp_path, reset={"clock": "keep", "investigators": "anchor"})
    client = client_for(tmp_path, content=content)
    try:
        play_to_turn(client, 1)
        client.table("player_input", text="我们花点时间打听消息，再去老宅。")
        client.table("apply", call_id="t2-c1",
                     effects=[{"kind": "time", "minutes": 90}, {"kind": "move", "to": HOUSE}])
        narrate(client, "t2-c2", "你们花了 90 分钟打听，然后走到老宅门前。")
        minutes = world_of(client)["clock"]["minutes"]
        assert minutes >= 90
        client.table("player_input", text="我要回到今天早上。")
        client.table("apply", call_id="t3-c1", effects=[{"kind": "fork", "name": "loop-2", "mode": "loop"}])
        narrate(client, "t3-c2", "你眼前一黑，又回到了诺特的办公室。")
        world = world_of(client)
        assert world["active_scene"] == BRIEFING
        assert world["clock"]["minutes"] == minutes
    finally:
        client.close()


# ---- §15.6 open, resume and the line tree --------------------------------------------------------

def test_open_returns_to_the_active_line_and_the_checkpoint_names_it(kernel):
    play_to_turn(kernel, 2)
    fork(kernel, 3, "side")
    opened = kernel.table("open")
    assert opened["worldline"] == {"name": "side", "kind": "if", "loop": 0}
    assert opened["resume"]["worldline"] == "side"
    checkpoint = read_json(campaign_dir(kernel.workspace) / "save" / "continuation" / "latest.json")
    assert checkpoint["worldline"] in ("main", "side")


def test_a_new_process_opens_the_line_the_last_one_left_on(kernel, tmp_path):
    play_to_turn(kernel, 2)
    fork(kernel, 3, "side")
    kernel.close()
    again = RpcClient(kernel.workspace)
    try:
        opened = again.table("open")
        assert opened["worldline"]["name"] == "side"
        assert head_ref(kernel.workspace) == "refs/heads/wl/side"
        assert opened["turn"]["number"] == 4
    finally:
        again.close()


def test_recall_history_lines_returns_the_tree_of_worldlines(kernel):
    play_to_turn(kernel, 2)
    fork(kernel, 3, "side")
    kernel.table("player_input", text="我看看四周。")
    tree = kernel.table("recall", what="history", lines=True)["lines"]
    assert tree["active"] == "side"
    rows = {row["name"]: row for row in tree["lines"]}
    assert rows["main"]["status"] == "dormant" and rows["main"]["active"] is False
    assert rows["side"]["active"] is True and rows["side"]["kind"] == "if"
    assert rows["side"]["forked_from"]["line"] == "main" and rows["side"]["forked_from"]["turn"] == 3
    assert rows["side"]["forked_from"]["commit"]
    # Without the flag nothing changes.
    assert "lines" not in kernel.table("recall", what="history")
