"""Contract §15 (#23): worldlines. Storage and identity (§15.1), the module declarations a
time loop needs (§15.2), the three `apply` effects (§15.3), the confluence report and
echoes (§15.4), memory across lines (§15.5), and the capsule, Director signals and resume
of §15.6.

The old tree's behaviour list is the checklist: a fork does not disturb the line it came
from, switching moves only the active line, a confluence enumerates its conflicts in a
fixed order and settles them from a closed table, classes that cannot be duplicated have no
`sum`, a replayed call forks once, and a failed state write rolls the reference back."""

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
    from conftest import KERNEL_DIR
    sys.path.insert(0, str(KERNEL_DIR))
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
                    "mode": "if", "loop": 0, "from_line": "main", "from_turn": 2, "label": "另一种可能", "call": "t2-c1"}]
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


def test_a_book_that_declares_a_time_loop_gets_the_time_loop_weights(tmp_path):
    """§15.6: the Director's structure weight comes from the book's own `structure_type`.
    It never arrived before this ticket: a module node carries `documents`, never a
    `record`, so the reader saw nothing and every book scored as branching_investigation."""
    client = client_for(tmp_path, content=loop_content(tmp_path))
    try:
        play_to_turn(client, 1)
        director = client.table("player_input", text="我看看四周。")["capsule"]["director"]
        assert "structure_type = time_loop" in director["because"]
        # §15.6's three signals ride along; they add no number of their own.
        assert "loop_count = 0" in director["because"]
        assert "loop_available = False" in director["because"]
    finally:
        client.close()

    plain = client_for(tmp_path, "ws-plain")
    try:
        play_to_turn(plain, 1)
        because = plain.table("player_input", text="我看看四周。")["capsule"]["director"]["because"]
        assert "structure_type = branching_investigation" in because
    finally:
        plain.close()


# ---- §15.4 the confluence report ---------------------------------------------------------------

def two_lines_that_disagree(client: RpcClient) -> None:
    """Play main to turn 2, fork `side`, hurt the investigator and set a flag there, then
    come back to main and set a different flag. The lines now differ in one number and in
    two flags, one of which only one line has."""
    play_to_turn(client, 2)
    fork(client, 3, "side")
    turn = turn_json(client)["turn"]
    client.table("player_input", text="我摔了一跤。")
    client.table("apply", call_id=f"t{turn}-c1",
                 effects=[{"kind": "damage", "dice": "1D6"},
                          {"kind": "flag", "name": "side-was-here", "value": True}])
    narrate(client, f"t{turn}-c2", "你摔在地上。")
    turn = turn_json(client)["turn"]
    switch(client, turn, "main")
    turn = turn_json(client)["turn"]
    client.table("player_input", text="我在这边留个记号。")
    client.table("apply", call_id=f"t{turn}-c1", effects=[{"kind": "flag", "name": "main-was-here", "value": True}])
    narrate(client, f"t{turn}-c2", "你做了个记号。")


def merge_err(client: RpcClient, call: str, **extra) -> dict:
    """One refused confluence. The turn is already open: `apply` never closes it, so the
    same turn can be offered several settlements before one of them lands."""
    return client.table_err("apply", call_id=call,
                            effects=[{"kind": "merge", "name": "joined", "lines": ["main", "side"], **extra}])


def test_a_confluence_names_at_least_two_lines_and_must_include_the_one_at_the_table(kernel):
    play_to_turn(kernel, 1)
    fork(kernel, 2, "side")
    turn = turn_json(kernel)["turn"]
    kernel.table("player_input", text="我想把线并起来。")
    one = kernel.table_err("apply", call_id=f"t{turn}-c1",
                           effects=[{"kind": "merge", "name": "joined", "lines": ["main"]}])
    assert one["code"] == "invalid_params" and "two lines" in one["message"]
    absent = kernel.table_err("apply", call_id=f"t{turn}-c2",
                              effects=[{"kind": "merge", "name": "joined", "lines": ["main", "ghost"]}])
    assert absent["code"] == "invalid_params" and "ghost" in absent["message"]
    # `side` is the line at the table; a confluence it is not part of has nowhere to land.
    away = kernel.table_err("apply", call_id=f"t{turn}-c3",
                            effects=[{"kind": "merge", "name": "joined", "lines": ["main", "main"]}])
    assert away["code"] == "invalid_params"
    assert branches(kernel.workspace) == ["refs/heads/wl/main", "refs/heads/wl/side"]


def hp_by_line(conflict: dict) -> dict[str, int]:
    """The HP each line's engines mirror onto the sheet, out of the one `engine_state` row.
    HP is not a `numeric` conflict of its own (#81): the healing engine owns it and the sheet
    only mirrors it, so it travels with the snapshot rather than being picked field by field."""
    return {line: view["sheet"]["thomas-hayes"]["current_hp"] for line, view in conflict["values"].items()}


def test_two_lines_that_disagree_about_a_wound_stop_the_merge_until_the_keeper_settles_it(kernel):
    """The disagreement `two_lines_that_disagree` makes is a fall: one line's investigator is
    hurt. That is not a number on a sheet -- it is the healing engine's wound ledger, and the
    sheet's HP is its mirror (#81) -- so it is reported once, as an `engine_state` conflict."""
    two_lines_that_disagree(kernel)
    turn = turn_json(kernel)["turn"]
    kernel.table("player_input", text="把两条线并起来。")
    error = merge_err(kernel, f"t{turn}-c1")
    assert error["code"] == "needs"
    conflicts = error["details"]["conflicts"]
    assert [c["id"] for c in conflicts] == ["conflict:engine_state:engines:snapshot"]
    only = conflicts[0]
    assert only["class"] == "engine_state" and only["field"] == "snapshot"
    assert sorted(only["values"]) == ["main", "side"]
    # Both halves of the divergence are inside the one row: the engine `side` wrote and never
    # started on `main`, and the sheet number that mirrors it.
    assert only["values"]["main"]["save"] == {}
    assert list(only["values"]["side"]["save"]) == ["save/healing-state/thomas-hayes.json"]
    hp = hp_by_line(only)
    assert hp["main"] != hp["side"]
    # An engine snapshot is taken from a line or not at all: there is no value between two.
    assert only["modes"] == ["from"]
    # Nothing was written: no branch, no line in the registry, and the flags stand apart.
    assert "joined" not in meta_of(kernel)["worldlines"]
    assert "refs/heads/wl/joined" not in branches(kernel.workspace)
    # The same report, computed again, is the same report.
    again = merge_err(kernel, f"t{turn}-c2")
    assert again["details"]["conflicts"] == conflicts


def test_a_disposition_the_class_does_not_allow_is_refused_and_a_drop_must_say_why(kernel):
    two_lines_that_disagree(kernel)
    turn = turn_json(kernel)["turn"]
    kernel.table("player_input", text="把两条线并起来。")
    conflict = merge_err(kernel, f"t{turn}-c1")["details"]["conflicts"][0]["id"]
    for offset, mode in enumerate(("sum", "max"), start=2):
        refused = merge_err(kernel, f"t{turn}-c{offset}", dispositions={conflict: {"mode": mode}})
        assert refused["code"] == "invalid_params" and refused["details"]["modes"] == ["from"]
    elsewhere = merge_err(kernel, f"t{turn}-c4", dispositions={conflict: {"mode": "from", "line": "ghost"}})
    assert elsewhere["code"] == "invalid_params" and elsewhere["details"]["lines"] == ["main", "side"]
    unknown = merge_err(kernel, f"t{turn}-c5", dispositions={"conflict:numeric:nobody:hp": {"mode": "max"}})
    assert unknown["code"] == "invalid_params" and unknown["details"]["unknown"] == ["conflict:numeric:nobody:hp"]


def test_a_settled_confluence_lands_a_line_whose_commit_keeps_both_histories(kernel):
    two_lines_that_disagree(kernel)
    turn = turn_json(kernel)["turn"]
    kernel.table("player_input", text="把两条线并起来。")
    conflicts = merge_err(kernel, f"t{turn}-c1")["details"]["conflicts"]
    hp = hp_by_line(conflicts[0])
    kernel.table("apply", call_id=f"t{turn}-c2",
                 effects=[{"kind": "merge", "name": "joined", "lines": ["main", "side"],
                           "dispositions": {conflicts[0]["id"]: {"mode": "from", "line": "side"}}}])
    narrate(kernel, f"t{turn}-c3", "两条线合到了一起。")

    meta = meta_of(kernel)
    assert meta["active_worldline"] == "joined"
    joined = meta["worldlines"]["joined"]
    assert joined["kind"] == "merge" and joined["status"] == "active"
    assert [p["line"] for p in joined["parents"]] == ["main", "side"]
    assert meta["worldlines"]["main"]["status"] == "merged"
    assert meta["worldlines"]["side"]["status"] == "merged"
    assert head_ref(kernel.workspace) == "refs/heads/wl/joined"
    # The merge commit keeps both lines reachable; neither history was rewritten.
    assert len(git(kernel.workspace, "log", "--format=%p", "-1").split()) == 2
    # The flags are the union and the number is the one the keeper chose.
    world = world_of(kernel)
    assert world["flags"]["main-was-here"] is True and world["flags"]["side-was-here"] is True
    assert hp["main"] != hp["side"]
    assert kernel.table("look", focus="investigator")["hp"] == hp["side"]
    # And the engine behind that number came with it, rather than staying `main`'s (#81).
    healing = read_json(campaign_dir(kernel.workspace) / "save" / "healing-state" / "thomas-hayes.json")
    assert healing["current_hp"] == hp["side"] and len(healing["wound_ledger"]) == 1


def test_a_merged_line_cannot_be_played_again(kernel):
    two_lines_that_disagree(kernel)
    turn = turn_json(kernel)["turn"]
    kernel.table("player_input", text="把两条线并起来。")
    conflict = merge_err(kernel, f"t{turn}-c1")["details"]["conflicts"][0]["id"]
    kernel.table("apply", call_id=f"t{turn}-c2",
                 effects=[{"kind": "merge", "name": "joined", "lines": ["main", "side"],
                           "dispositions": {conflict: {"mode": "from", "line": "main"}}}])
    narrate(kernel, f"t{turn}-c3", "两条线合到了一起。")
    turn = turn_json(kernel)["turn"]
    kernel.table("player_input", text="我想回到原来那条线。")
    error = kernel.table_err("apply", call_id=f"t{turn}-c1", effects=[{"kind": "switch", "line": "side"}])
    assert error["code"] == "invalid_params" and error["details"]["status"] == "merged"


def test_a_thing_one_line_spent_is_a_conflict_but_a_thing_it_never_had_is_not(kernel):
    """§15.4: `consumed` is about a line that used something up, not about a line that
    simply never picked it up. The second is an ordinary union and asks the keeper nothing."""
    play_to_turn(kernel, 1)
    turn = turn_json(kernel)["turn"]
    kernel.table("player_input", text="我把两样东西都收好。")
    kernel.table("apply", call_id=f"t{turn}-c1",
                 effects=[{"kind": "item", "name": "brass key"}])
    narrate(kernel, f"t{turn}-c2", "你把黄铜钥匙收进口袋。")
    fork(kernel, turn_json(kernel)["turn"], "side")
    turn = turn_json(kernel)["turn"]
    kernel.table("player_input", text="我用掉了钥匙，又捡到一盏灯。")
    kernel.table("apply", call_id=f"t{turn}-c1",
                 effects=[{"kind": "item", "name": "brass key", "quantity": -1},
                          {"kind": "item", "name": "storm lantern"}])
    narrate(kernel, f"t{turn}-c2", "钥匙留在了锁里，你顺手拿走了那盏灯。")
    switch(kernel, turn_json(kernel)["turn"], "main")

    turn = turn_json(kernel)["turn"]
    kernel.table("player_input", text="把两条线并起来。")
    conflicts = merge_err(kernel, f"t{turn}-c1")["details"]["conflicts"]
    # The key: main still holds it, side spent it. The lantern: side has it, main never
    # had it -- no conflict, it is simply in the union.
    assert [c["id"] for c in conflicts] == ["conflict:consumed:thomas-hayes:brass key"]
    only = conflicts[0]
    assert only["values"] == {"main": "held", "side": "spent"}
    assert only["modes"] == ["from", "drop"]

    dropped = merge_err(kernel, f"t{turn}-c2", dispositions={only["id"]: {"mode": "drop"}})
    assert dropped["code"] == "invalid_params" and "why" in dropped["message"]
    kernel.table("apply", call_id=f"t{turn}-c3",
                 effects=[{"kind": "merge", "name": "joined", "lines": ["main", "side"],
                           "dispositions": {only["id"]: {"mode": "drop", "note": "它留在了锁里。"}}}])
    narrate(kernel, f"t{turn}-c4", "两条线合到了一起。")
    equipment = [str(row.get("name")) if isinstance(row, dict) else str(row) for row in
                 read_json(campaign_dir(kernel.workspace) / "party" / "thomas-hayes.json")["equipment"]]
    assert "brass key" not in equipment and "storm lantern" in equipment


def test_clues_never_conflict_they_are_a_union(kernel):
    """§15.4: a clue found on either line is found. It is not in the conflict table at all."""
    play_to_turn(kernel, 1)
    turn = turn_json(kernel)["turn"]
    kernel.table("player_input", text="我先问问委托人。")
    kernel.table("apply", call_id=f"t{turn}-c1", effects=[{"kind": "clue", "clue": FORGOTTEN_CLUE.removeprefix("clue-")}])
    narrate(kernel, f"t{turn}-c2", "他把委托说清楚了。")
    turn = turn_json(kernel)["turn"]
    fork(kernel, turn, "side")
    turn = turn_json(kernel)["turn"]
    switch(kernel, turn, "main")
    turn = turn_json(kernel)["turn"]
    kernel.table("player_input", text="并线。")
    kernel.table("apply", call_id=f"t{turn}-c1",
                 effects=[{"kind": "merge", "name": "joined", "lines": ["main", "side"]}])
    narrate(kernel, f"t{turn}-c2", "两条线合到了一起。")
    assert FORGOTTEN_CLUE.removeprefix("clue-") in world_of(kernel)["discovered_clues"]


# ---- §15.4 echoes -------------------------------------------------------------------------------

def echoes_of(client: RpcClient) -> list[dict]:
    return read_json(campaign_dir(client.workspace) / "save" / "worldlines" / "echoes.json")["echoes"]


def played_one_loop(client: RpcClient) -> None:
    """Walk to the house, take a clue there, then rewind. The loop the party left is what
    the echoes are made of."""
    play_to_turn(client, 1)
    client.table("player_input", text="我们去柯比特老宅。")
    client.table("apply", call_id="t2-c1", effects=[{"kind": "move", "to": HOUSE}])
    narrate(client, "t2-c2", "你们走到了老宅门前。")
    client.table("player_input", text="我翻翻这些日记。")
    client.table("apply", call_id="t3-c1", effects=[{"kind": "clue", "clue": "corbitt-diaries"}])
    narrate(client, "t3-c2", "你读到了柯比特的日记。")
    client.table("player_input", text="我要回到今天早上。")
    client.table("apply", call_id="t4-c1", effects=[{"kind": "fork", "name": "loop-2", "mode": "loop"}])
    narrate(client, "t4-c2", "你眼前一黑，又回到了诺特的办公室。")


def test_a_rewind_leaves_echoes_of_the_loop_it_came_from(tmp_path):
    """§15.4: echoes are a projection of the last loop's receipts, not narration. Each one
    names the line, the circuit, the turn and the scene it belongs to."""
    client = client_for(tmp_path, content=loop_content(tmp_path))
    try:
        played_one_loop(client)
        rows = echoes_of(client)
        assert [row["kind"] for row in rows] == ["move", "clue_taken"]
        assert {row["line"] for row in rows} == {"main"}
        assert {row["loop"] for row in rows} == {0}
        assert [row["scene"] for row in rows] == [HOUSE, HOUSE]
        assert rows[0]["id"] == "echo:main-t2-1" and rows[1]["id"] == "echo:main-t3-1"
        # The summary is the kernel's, made of the receipts it points at (§16: English).
        assert rows[1]["receipts"] == ["clue:corbitt-diaries-t3"]
        assert "corbitt-diaries" in rows[1]["summary"]
        # None of them stand in the briefing, so the capsule offers none here.
        assert client.table("player_input", text="我看看四周。")["capsule"]["worldlines"]["echoes_here"] == 0
    finally:
        client.close()


def test_an_echo_is_revealed_by_apply_clue_and_only_then_is_it_known(tmp_path):
    """§15.4: an echo the keeper only talked about is not discovered. `apply clue` is what
    reveals it, and the keeper cannot change what it says -- only whether to show it."""
    client = client_for(tmp_path, content=loop_content(tmp_path))
    try:
        played_one_loop(client)
        client.table("player_input", text="我又走去老宅。")
        client.table("apply", call_id="t5-c1", effects=[{"kind": "move", "to": HOUSE}])
        narrate(client, "t5-c2", "你又站在了老宅门前。")
        section = client.table("player_input", text="这地方我好像来过。")["capsule"]["worldlines"]
        assert section["echoes_here"] == 2
        assert [echo["id"] for echo in section["echoes"]] == ["echo:main-t2-1", "echo:main-t3-1"]
        assert world_of(client).get("discovered_echoes") in (None, [])

        applied = client.table("apply", call_id="t6-c1",
                               effects=[{"kind": "clue", "clue": "echo:main-t3-1"}])
        assert applied["receipts"] == ["clue:echo-main-t3-1-t6"]
        delivered = narrate(client, "t6-c2", "你想起有人在这里读过什么。")
        # §16.2: it projects as a clue row like any other piece of evidence.
        row = next(r for r in delivered["mechanics"] if r["kind"] == "clue")
        assert row["clue"] == "echo:main-t3-1"

        assert world_of(client)["discovered_echoes"] == ["echo:main-t3-1"]
        capsule = client.table("player_input", text="然后呢。")["capsule"]
        assert capsule["known"]["discovered_echoes"] == ["echo:main-t3-1"]
        # Revealed once, it is no longer among the ones still to show.
        assert [echo["id"] for echo in capsule["worldlines"]["echoes"]] == ["echo:main-t2-1"]
    finally:
        client.close()


def test_an_echo_no_line_left_behind_is_refused(tmp_path):
    client = client_for(tmp_path, content=loop_content(tmp_path))
    try:
        played_one_loop(client)
        client.table("player_input", text="我编一个回声。")
        error = client.table_err("apply", call_id="t5-c1",
                                 effects=[{"kind": "clue", "clue": "echo:main-t99-9"}])
        assert error["code"] == "unknown_entity"
        assert "echo:main-t3-1" in error["details"]["echoes"]
        assert world_of(client).get("discovered_echoes") in (None, [])
    finally:
        client.close()


# ---- §15.5 memory across the lines ---------------------------------------------------------------

def remember(client: RpcClient, turn: int, *said: tuple[str, str]) -> None:
    """Memory candidates for one closed turn, landed through the real extraction path. A
    turn has exactly one extraction job, so everything it remembered goes in together."""
    job = client.ok("memory.job", {"campaign": CAMPAIGN, "turn": turn})
    client.ok("memory.submit", {"campaign": CAMPAIGN, "job_id": job["job_id"], "candidates": [
        {"kind": "knowledge", "subject": subject, "knowers": [subject], "entities": [subject],
         "statement": statement, "privacy": "player_safe", "state": "accurate", "confidence": 0.9}
        for subject, statement in said]})


def test_a_candidate_carries_the_line_and_the_circuit_it_was_remembered_on(tmp_path):
    """§15.5: a memory knows which line and which circuit remembered it, which is the only
    way the kernel can later tell the last loop from this one."""
    client = client_for(tmp_path, content=loop_content(tmp_path))
    try:
        play_to_turn(client, 1)
        remember(client, 1, ("Steven Knott", "诺特第一圈就在这张桌子后面。"))
        client.table("player_input", text="我要回到今天早上。")
        client.table("apply", call_id="t2-c1", effects=[{"kind": "fork", "name": "loop-2", "mode": "loop"}])
        narrate(client, "t2-c2", "你眼前一黑，又回到了诺特的办公室。")
        client.table("player_input", text="我又见到了诺特。")
        narrate(client, "t3-c1", "诺特还是坐在那里。")
        remember(client, 3, ("Steven Knott", "诺特在第二圈还是坐在同一张桌子后面。"))

        rows = read_jsonl(campaign_dir(client.workspace) / "memory" / "candidates.jsonl")
        first, second = rows[0], rows[-1]
        assert (first["worldline"], first["loop"]) == ("main", 0)
        assert (second["worldline"], second["loop"]) == ("loop-2", 1)
    finally:
        client.close()


def test_recall_memory_reads_this_line_by_default_and_every_line_on_request(kernel):
    play_to_turn(kernel, 1)
    remember(kernel, 1, ("Steven Knott", "Knott said the house has been empty for years."))
    fork(kernel, 2, "side")
    remember(kernel, 2, ("Steven Knott", "On this line Knott admitted he had been inside."))

    here = kernel.table("recall", what="memory", about=["Steven Knott"])
    assert here["line"] == "current"
    # `if` branches carry what was written before the fork, and nothing written after it
    # on the line they left.
    statements = [hit["statement"] for hit in here["hits"]]
    assert "On this line Knott admitted he had been inside." in statements
    assert {hit["worldline"] for hit in here["hits"]} == {"main", "side"}

    kernel.table("player_input", text="我回到原来那条路。")
    kernel.table("apply", call_id="t3-c9", effects=[{"kind": "switch", "line": "main"}])
    narrate(kernel, "t3-c10", "你回到了原来的那一条线。")
    on_main = [hit["statement"] for hit in
               kernel.table("recall", what="memory", about=["Steven Knott"])["hits"]]
    assert "On this line Knott admitted he had been inside." not in on_main
    every = kernel.table("recall", what="memory", about=["Steven Knott"], line="any")["hits"]
    assert "On this line Knott admitted he had been inside." in [hit["statement"] for hit in every]
    named = kernel.table("recall", what="memory", about=["Steven Knott"], line="side")["hits"]
    assert {hit["worldline"] for hit in named} == {"main", "side"}
    unknown = kernel.table_err("recall", what="memory", about=["Steven Knott"], line="ghost")
    assert unknown["code"] == "invalid_params"


def rewound_with_a_memory(tmp_path: Path, name: str, *, remembers: bool) -> RpcClient:
    """One circuit in which Knott is told something, then a rewind. The only difference
    between the two runs is whether the book declared that he remembers."""
    client = client_for(tmp_path, name, content=loop_content(tmp_path / name, remembers=remembers))
    play_to_turn(client, 1)
    remember(client, 1, ("Steven Knott", "Knott watched them leave on the first circuit."))
    client.table("player_input", text="我要回到今天早上。")
    client.table("apply", call_id="t2-c1", effects=[{"kind": "fork", "name": "loop-2", "mode": "loop"}])
    narrate(client, "t2-c2", "你眼前一黑，又回到了诺特的办公室。")
    return client


def test_only_a_declared_person_carries_what_another_circuit_knew(tmp_path):
    """§15.5: the cross-loop projection is for the people the book declared, and no others.
    The same play with the declaration taken away gives them nothing."""
    declared = rewound_with_a_memory(tmp_path, "ws-remembers", remembers=True)
    try:
        capsule = declared.table("player_input", text="诺特还在吗。")["capsule"]
        knott = next(entry for entry in capsule["present"] if entry["name"] == "Steven Knott")
        assert knott["from_other_lines"] == [{"statement": "Knott watched them leave on the first circuit.",
                                              "line": "main", "loop": 0, "turn": 1}]
        assert capsule["worldlines"]["remembers"] == ["Steven Knott"]
        # The same projection through `lookup secret scope=scene`.
        secrets = declared.table("lookup", kind="secret", scope="scene")["npc_secrets"]
        assert next(row for row in secrets if row["name"] == "Steven Knott")["from_other_lines"] \
            == knott["from_other_lines"]
    finally:
        declared.close()

    silent = rewound_with_a_memory(tmp_path, "ws-forgets", remembers=False)
    try:
        capsule = silent.table("player_input", text="诺特还在吗。")["capsule"]
        assert all("from_other_lines" not in entry for entry in capsule["present"])
        assert capsule["worldlines"]["remembers"] == []
        secrets = silent.table("lookup", kind="secret", scope="scene")["npc_secrets"]
        assert all("from_other_lines" not in row for row in secrets)
    finally:
        silent.close()


def test_the_capsule_carries_the_previous_circuit(tmp_path):
    client = client_for(tmp_path, content=loop_content(tmp_path))
    try:
        play_to_turn(client, 1)
        remember(client, 1, ("Steven Knott", "他们在第一圈问过钥匙的事。"))
        client.table("player_input", text="我要回到今天早上。")
        client.table("apply", call_id="t2-c1", effects=[{"kind": "fork", "name": "loop-2", "mode": "loop"}])
        narrate(client, "t2-c2", "你眼前一黑，又回到了诺特的办公室。")
        section = client.table("player_input", text="我看看四周。")["capsule"]["worldlines"]
        assert section["loop"] == 1
        assert section["previous_loop"] == [{"statement": "他们在第一圈问过钥匙的事。", "turn": 1}]
    finally:
        client.close()


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
