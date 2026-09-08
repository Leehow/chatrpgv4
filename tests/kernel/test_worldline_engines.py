"""#81: a confluence compares the rule engines, not only the sheets.

The sheets are a mirror. `rules.runtime.mirror_investigator` writes an engine's view of an
investigator onto the sheet *and* into `save/`, and the contract says the same thing about a
`damage` in a batch. The state itself -- the wound ledger, the bout of madness and the hours
it still owes, the spells being studied -- lives under `save/`.

A merge never read any of it. `history.merge_parents` records the other lines as parents with
`-s ours`, so the work tree the merge commit lands on is `parents[0]`'s, and `confluence`
compared four numbers off the sheets. An investigator who went mad on one line, merged into
the line that kept their mind, came out of the confluence sane, and the report said nothing:
`save/sanity-state/<inv>.json` simply was not there any more.

These tests take that path through the real seam -- fork, play one line into a bout of
madness or an experience tick, come back, merge -- and pin: the confluence refuses until the
keeper chooses a line; the line the keeper chooses is the one whose engines land on disk, in
both directions, so the deletion half is covered too; a divergence no sheet can show is found
anyway; and `numeric` still holds what no engine owns, so one divergence is reported once."""

from __future__ import annotations

from typing import Any

from conftest import (RpcClient, campaign_dir, create_campaign, narrate, narrate_opening,
                      open_turn, read_json)
from test_rules_families import CONFRONTATION_PATH, first_failure, first_success, resolve
from test_worldline import fork, switch, turn_json

INVESTIGATOR = "thomas-hayes"
ENGINE_CONFLICT = "conflict:engine_state:engines:snapshot"


def save_state(client: RpcClient, engine: str) -> dict[str, Any]:
    """One engine's snapshot for the pregen, or `{}` when it has none. Absent is a real
    answer: an engine that never ran on the line the keeper chose has nothing to say, and the
    next load seeds it from the sheet."""
    path = campaign_dir(client.workspace) / "save" / engine / f"{INVESTIGATOR}.json"
    return read_json(path) if path.exists() else {}


def sheet_of(client: RpcClient) -> dict[str, Any]:
    return read_json(campaign_dir(client.workspace) / "party" / f"{INVESTIGATOR}.json")


def merge_err(client: RpcClient, call: str, lines: list[str], **extra: Any) -> dict[str, Any]:
    return client.table_err("apply", call_id=call,
                            effects=[{"kind": "merge", "name": "joined", "lines": lines, **extra}])


def merge(client: RpcClient, call: str, lines: list[str], **extra: Any) -> dict[str, Any]:
    return client.table("apply", call_id=call,
                        effects=[{"kind": "merge", "name": "joined", "lines": lines, **extra}])


def one_line_went_mad(client: RpcClient) -> None:
    """Open the table, fork `side`, and on `side` walk down to Walter Corbitt and fail the SAN
    check his profile prices at 1/1D8. Comes back to `main`, whose investigator never saw him,
    with the merge turn open.

    Seed 1 fails that check, so the madness is the seeded engines' own doing and not a fixture
    written onto disk behind the kernel's back."""
    create_campaign(client)
    narrate_opening(client)
    client.table("player_input", text="我先在办公室里坐了一会儿。")
    narrate(client, "t1-c1", "你在诺特的办公室里坐了一会儿。")
    fork(client, 2, "side")

    turn = turn_json(client)["turn"]
    client.table("player_input", text="我们直接去老宅，下到地窖。")
    call = 1
    for scene in CONFRONTATION_PATH:
        client.table("apply", call_id=f"t{turn}-c{call}", effects=[{"kind": "move", "to": scene}])
        call += 1
    checked = resolve(client, f"t{turn}-c{call}", intent="investigate", goal="看见科比特的尸体动了",
                      method="", target="Walter Corbitt", decision="sanity:check",
                      involuntary={"kind": "freeze", "summary": "手电筒的光柱僵在原地"})
    assert checked["outcome"]["temporary_insane"] is True
    call += 1
    # The bout is a session of its own; close it so the confluence is an ordinary batch.
    while save_state(client, "sanity-state").get("bout_active"):
        resolve(client, f"t{turn}-c{call}", intent="montage", goal="等这阵过去", method="",
                decision="sanity:bout-end")
        call += 1
    narrate(client, f"t{turn}-c{call}", "他坐了起来，你僵在原地。")

    switch(client, turn_json(client)["turn"], "main")
    client.table("player_input", text="把两条线并起来。")


def test_a_line_whose_investigator_went_mad_does_not_merge_away_in_silence(seeded_one):
    """The report says the lines' engines disagree, names both, and refuses to land until the
    keeper picks one. Before #81 this merge succeeded with no conflicts at all."""
    one_line_went_mad(seeded_one)
    turn = turn_json(seeded_one)["turn"]
    error = merge_err(seeded_one, f"t{turn}-c1", ["main", "side"])
    assert error["code"] == "needs"
    conflicts = error["details"]["conflicts"]
    assert [row["id"] for row in conflicts] == [ENGINE_CONFLICT]
    only = conflicts[0]
    assert only["class"] == "engine_state" and only["modes"] == ["from"]
    # `side` has a sanity engine with something to say; `main`'s never ran.
    assert only["values"]["main"]["save"] == {}
    assert list(only["values"]["side"]["save"]) == [f"save/sanity-state/{INVESTIGATOR}.json"]
    # The mirror moved with it: the SAN on the sheet differs, and it is inside the same row
    # rather than beside it as a `numeric` conflict of its own.
    san = {line: view["sheet"][INVESTIGATOR]["current_san"] for line, view in only["values"].items()}
    assert san["side"] < san["main"]
    # Nothing was written while the keeper had not answered.
    assert save_state(seeded_one, "sanity-state") == {}
    assert "joined" not in read_json(campaign_dir(seeded_one.workspace) / "campaign.json")["worldlines"]


def test_the_madness_lands_on_disk_when_the_keeper_takes_the_line_that_holds_it(seeded_one):
    """`from: side` and the merged campaign is the one where the investigator went mad -- the
    sanity engine's own snapshot, not just a lower number on the sheet. The branch still starts
    from `main`, which is exactly what used to swallow it."""
    one_line_went_mad(seeded_one)
    turn = turn_json(seeded_one)["turn"]
    conflict = merge_err(seeded_one, f"t{turn}-c1", ["main", "side"])["details"]["conflicts"][0]
    san = {line: view["sheet"][INVESTIGATOR]["current_san"] for line, view in conflict["values"].items()}
    merge(seeded_one, f"t{turn}-c2", ["main", "side"],
          dispositions={ENGINE_CONFLICT: {"mode": "from", "line": "side"}})
    narrate(seeded_one, f"t{turn}-c3", "两条线合到了一起，他还在发抖。")

    state = save_state(seeded_one, "sanity-state")
    assert state.get("temporary_insane") is True
    assert [bout["bout_kind"] for bout in state["bouts_of_madness"]] == ["flee"]
    assert state["san_current"] == san["side"]
    # And the mirror agrees with the engine it mirrors, rather than staying `main`'s.
    assert sheet_of(seeded_one)["current_san"] == san["side"]
    assert seeded_one.table("look", focus="investigator")["san"] == san["side"]


def test_taking_the_line_that_kept_its_mind_removes_the_other_line_s_snapshot(seeded_one):
    """The other direction, which needs the merge to *delete*: `side` is named first, so the
    branch starts there and the work tree arrives holding the bout of madness. Choosing `main`
    has to take it away again -- a snapshot the losing line wrote and the winner never did is
    not part of the history the keeper chose."""
    one_line_went_mad(seeded_one)
    turn = turn_json(seeded_one)["turn"]
    conflict = merge_err(seeded_one, f"t{turn}-c1", ["side", "main"])["details"]["conflicts"][0]
    san = {line: view["sheet"][INVESTIGATOR]["current_san"] for line, view in conflict["values"].items()}
    merge(seeded_one, f"t{turn}-c2", ["side", "main"],
          dispositions={ENGINE_CONFLICT: {"mode": "from", "line": "main"}})
    narrate(seeded_one, f"t{turn}-c3", "两条线合到了一起，他从没见过那具尸体。")

    assert save_state(seeded_one, "sanity-state") == {}
    assert sheet_of(seeded_one)["current_san"] == san["main"]
    assert seeded_one.table("look", focus="investigator")["san"] == san["main"]


def test_a_tick_only_one_line_earned_is_a_disagreement_no_sheet_can_show(seeded_kernel):
    """Not every engine writes a number onto a sheet. An experience tick lives in the
    development engine's own state and nowhere else, so two lines can carry identical sheets
    and still be in different histories -- which is the case a merge comparing four sheet
    numbers could not see at all, however carefully it compared them."""
    open_turn(seeded_kernel, "我先四下看看。")
    narrate(seeded_kernel, "t1-c1", "没什么特别的。")
    fork(seeded_kernel, 2, "side")

    turn = turn_json(seeded_kernel)["turn"]
    seeded_kernel.table("player_input", text="我仔细找那个暗格。")
    found, _ = first_success(seeded_kernel, f"t{turn}-c", intent="investigate", goal="找到暗格", method="用侦查")
    narrate(seeded_kernel, f"t{turn}-c{int(found.split('-c')[1]) + 1}", "你摸到了一道缝。")
    assert save_state(seeded_kernel, "development-state")["ticks"]
    switch(seeded_kernel, turn_json(seeded_kernel)["turn"], "main")

    turn = turn_json(seeded_kernel)["turn"]
    seeded_kernel.table("player_input", text="把两条线并起来。")
    conflicts = merge_err(seeded_kernel, f"t{turn}-c1", ["main", "side"])["details"]["conflicts"]
    assert [row["id"] for row in conflicts] == [ENGINE_CONFLICT]
    values = conflicts[0]["values"]
    # Every number a sheet carries is the same on both lines. The engines are not.
    assert values["main"]["sheet"] == values["side"]["sheet"]
    assert values["main"]["save"] == {}
    assert list(values["side"]["save"]) == [f"save/development-state/{INVESTIGATOR}.json"]

    merge(seeded_kernel, f"t{turn}-c2", ["main", "side"],
          dispositions={ENGINE_CONFLICT: {"mode": "from", "line": "side"}})
    narrate(seeded_kernel, f"t{turn}-c3", "两条线合到了一起。")
    assert save_state(seeded_kernel, "development-state")["ticks"]


def test_luck_is_still_a_numeric_conflict_because_no_engine_keeps_it(seeded_kernel):
    """The other half of the ruling. `numeric` did not go away; it retreated to what the
    engines do not own. Luck is spent through the real push-luck path, and the confluence
    reports it as `numeric` with the bounded modes intact -- and nothing else."""
    open_turn(seeded_kernel, "我搜。")
    failed_id, _ = first_failure(seeded_kernel, "t1-c", intent="investigate", goal="找到暗格",
                                 method="用侦查", modifiers={"difficulty": "hard"})
    narrate(seeded_kernel, f"t1-c{int(failed_id.split('-c')[1]) + 1}", "暗格没有找到。")
    fork(seeded_kernel, 2, "side")

    turn = turn_json(seeded_kernel)["turn"]
    seeded_kernel.table("player_input", text="我再搜一次，这次赌运气。")
    failed_id, _ = first_failure(seeded_kernel, f"t{turn}-c", intent="investigate", goal="找到暗格",
                                 method="用侦查", modifiers={"difficulty": "hard"})
    call = int(failed_id.split("-c")[1])
    spent = resolve(seeded_kernel, f"t{turn}-c{call + 1}", intent="investigate", goal="找到暗格",
                    method="用侦查", luck=3)
    assert spent["outcome"]["kind"] == "luck"
    narrate(seeded_kernel, f"t{turn}-c{call + 2}", "你花了 3 点运气，暗格还是没有找到。")
    switch(seeded_kernel, turn_json(seeded_kernel)["turn"], "main")

    turn = turn_json(seeded_kernel)["turn"]
    seeded_kernel.table("player_input", text="把两条线并起来。")
    conflicts = merge_err(seeded_kernel, f"t{turn}-c1", ["main", "side"])["details"]["conflicts"]
    assert [row["id"] for row in conflicts] == [f"conflict:numeric:{INVESTIGATOR}:luck"]
    only = conflicts[0]
    assert only["modes"] == ["from", "min", "max"] and only["sheet_field"] == "current_luck"
    assert only["values"]["main"] - only["values"]["side"] == 3
    merge(seeded_kernel, f"t{turn}-c2", ["main", "side"], dispositions={only["id"]: {"mode": "min"}})
    narrate(seeded_kernel, f"t{turn}-c3", "两条线合到了一起。")
    assert sheet_of(seeded_kernel)["current_luck"] == only["values"]["side"]
